/**
 * 图片编辑模块 — 通过 REST 对话 API 实现图片编辑
 * 移植自 grok2api 的 imagineExperimental.ts，适配 art-proxy 架构
 *
 * 编辑策略（双重回退）：
 * 1. 先尝试专用编辑模型 "imagine-image-edit"
 * 2. 若失败则回退到 "grok-3" + imageGen 工具覆盖
 */

import { getHeaders, buildCookie } from "./headers";

const CHAT_API = "https://grok.com/rest/app-chat/conversations/new";
const ASSET_API = "https://assets.grok.com";
const IMAGINE_REFERER = "https://grok.com/imagine";

// 将 fileUri 转换为完整的 asset URL
function normalizeAssetUrl(raw: string): string {
    const value = String(raw ?? "").trim();
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
    return `${ASSET_API}/${value.replace(/^\/+/, "")}`;
}

// 构建图片编辑 Payload
function buildImageEditPayload(args: {
    prompt: string;
    imageReferences: string[];
    modelName: string;
    count: number;
}): Record<string, unknown> {
    // 仅通用对话模型（含 grok 但不含 -edit 后缀）做回退时需要增强提示词
    const isChatFallback = args.modelName.includes("grok") && !args.modelName.includes("-edit");

    const prompt = isChatFallback
        ? `I am providing an image asset. Edit it following these instructions, using the image generation tool: ${args.prompt}`
        : args.prompt;

    const payload: Record<string, unknown> = {
        temporary: true,
        modelName: args.modelName,
        message: prompt,
        fileAttachments: [],
        imageAttachments: [],
        disableSearch: false,
        enableImageGeneration: true,
        returnImageBytes: false,
        returnRawGrokInXaiRequest: false,
        enableImageStreaming: true,
        imageGenerationCount: Math.min(Math.max(1, args.count), 10),
        forceConcise: false,
        toolOverrides: { imageGen: true },
        enableSideBySide: true,
        sendFinalMetadata: true,
        isReasoning: false,
        disableTextFollowUps: false,
        disableMemory: false,
        forceSideBySide: false,
        isAsyncChat: false,
        responseMetadata: {
            modelConfigOverride: {
                modelMap: {
                    imageEditModel: "imagine",
                    imageEditModelConfig: {
                        imageReferences: args.imageReferences,
                    },
                },
            },
            requestModelDetails: {
                modelId: args.modelName,
            },
        },
    };

    // 通用对话模型回退时需要设置快速模式
    if (isChatFallback) {
        payload.modelMode = "MODEL_MODE_FAST";
    }

    return payload;
}

// 从文字或 NDJSON 响应中提取生成的图片 URL
function extractImageUrls(text: string): string[] {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const urls: string[] = [];

    // 兜底：尝试从文本中通过正则提取所有 /v1/ 和 assets.grok.com 的链接
    const assetRegex = /(https?:\/\/assets\.grok\.com\/[a-zA-Z0-9.\/_-]+)|(https?:\/\/grok\.com\/v1\/[a-zA-Z0-9.\/_-]+)/g;
    let match;
    while ((match = assetRegex.exec(text)) !== null) {
        if (match[0]) urls.push(match[0].trim());
    }

    for (const line of lines) {
        let data: any;
        try {
            data = JSON.parse(line);
        } catch {
            continue;
        }

        // 优先检查是否有明确的 API 错误
        const err = data?.error || data?.result?.error;
        if (err?.message) throw new Error(String(err.message));

        // 路径 1: 标准模型响应 (New structure)
        const generatedUrls = data?.result?.response?.modelResponse?.generatedImageUrls;
        if (Array.isArray(generatedUrls)) {
            for (const u of generatedUrls) {
                if (typeof u === "string" && u.trim() && u.trim() !== "/") {
                    urls.push(u.trim());
                }
            }
        }

        // 路径 2: 对话附件 (Old or alternative structure)
        const attachments = data?.result?.response?.message?.attachments;
        if (Array.isArray(attachments)) {
            for (const att of attachments) {
                const u = att?.imageUrl || att?.url || att?.fileUri;
                if (typeof u === "string" && u.trim() && u.trim() !== "/") {
                    urls.push(u.trim());
                }
            }
        }

        // 路径 3: 顶层 result 下的图片信息
        const resultImage = data?.result?.imageUrl || data?.result?.image_url;
        if (typeof resultImage === "string" && resultImage.trim() && resultImage.trim() !== "/") {
            urls.push(resultImage.trim());
        }

        // 路径 4: 消息流中的 token 里的内容 (如果是文本生成的 markdown)
        const token = data?.result?.response?.modelResponse?.token;
        if (typeof token === "string" && (token.includes("http") || token.includes("assets"))) {
            const innerMatches = token.match(assetRegex);
            if (innerMatches) {
                for (const m of innerMatches) urls.push(m.trim());
            }
        }
    }

    // 去重并过滤掉不完整的 URL
    const finalUrls = [...new Set(urls)].filter(u => u.length > 10);
    return finalUrls;
}

export interface ImageEditResult {
    urls: string[];
    error?: string;
}

/**
 * 执行图片编辑请求（含双重回退机制）
 *
 * @param prompt - 编辑指令
 * @param fileUris - 上传后获得的 fileUri 列表
 * @param sso - SSO Token
 * @param sso_rw - SSO-RW Token
 * @param count - 期望返回的图片数量（默认为 2）
 * @returns 编辑后的图片 URL 列表
 */
export async function editImage(
    prompt: string,
    fileUris: string[],
    sso: string,
    sso_rw: string,
    count: number = 2,
): Promise<ImageEditResult> {
    const imageReferences = fileUris.map(normalizeAssetUrl).filter(Boolean);
    if (!imageReferences.length) {
        return { urls: [], error: "没有有效的图片引用" };
    }

    const cookie = buildCookie(sso, sso_rw);
    const headers = getHeaders(cookie, IMAGINE_REFERER);

    // 策略：先尝试专用编辑模型，失败则回退
    const models = ["imagine-image-edit", "grok-3"];
    // const models = ["imagine-image-edit", "grok-3"];

    let lastError = "";

    for (const modelName of models) {
        const payload = buildImageEditPayload({
            prompt,
            imageReferences,
            modelName,
            count,
        });

        try {
            console.log(`[ImageEdit] 尝试模型: ${modelName}`);
            const resp = await fetch(CHAT_API, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });

            if (!resp.ok) {
                const txt = await resp.text().catch(() => "");
                lastError = `[${modelName}] 上游错误 ${resp.status}: ${txt.slice(0, 200)}`;
                console.warn(`[ImageEdit] 模型 ${modelName} 请求失败:`, lastError);
                continue;
            }

            const text = await resp.text();
            const urls = extractImageUrls(text);

            if (urls.length > 0) {
                console.log(`[ImageEdit] 模型 ${modelName} 成功提取到 ${urls.length} 张图片`);
                return { urls };
            }

            lastError = `[${modelName}] 未从响应中提取到图片 URL`;
            console.warn(`[ImageEdit] 模型 ${modelName} 响应解析为空`);
        } catch (e) {
            lastError = `[${modelName}] 异常: ${e instanceof Error ? e.message : String(e)}`;
            console.error(`[ImageEdit] 模型 ${modelName} 运行崩溃:`, lastError);
        }
    }

    return { urls: [], error: lastError || "所有模型均未能完成图片编辑" };
}

