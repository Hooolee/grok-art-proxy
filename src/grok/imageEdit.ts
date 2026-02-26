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
    modelName: "imagine-image-edit" | "grok-3";
}): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        temporary: true,
        modelName: args.modelName,
        message: args.prompt,
        fileAttachments: [],
        imageAttachments: [],
        disableSearch: false,
        enableImageGeneration: true,
        returnImageBytes: false,
        returnRawGrokInXaiRequest: false,
        enableImageStreaming: true,
        imageGenerationCount: 2,
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

    // grok-3 回退模式需要设置快速模式
    if (args.modelName === "grok-3") {
        payload.modelMode = "MODEL_MODE_FAST";
    }

    return payload;
}

// 从 NDJSON 响应中提取生成的图片 URL
function extractImageUrls(text: string): string[] {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const urls: string[] = [];

    for (const line of lines) {
        let data: any;
        try {
            data = JSON.parse(line);
        } catch {
            continue;
        }

        // 检查是否有错误
        const err = data?.error;
        if (err?.message) throw new Error(String(err.message));

        // 提取图片 URL
        const grok = data?.result?.response;
        const generatedUrls = grok?.modelResponse?.generatedImageUrls;
        if (Array.isArray(generatedUrls)) {
            for (const u of generatedUrls) {
                if (typeof u === "string" && u.trim() && u.trim() !== "/") {
                    urls.push(u.trim());
                }
            }
        }
    }

    return urls;
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
 * @returns 编辑后的图片 URL 列表
 */
export async function editImage(
    prompt: string,
    fileUris: string[],
    sso: string,
    sso_rw: string,
): Promise<ImageEditResult> {
    const imageReferences = fileUris.map(normalizeAssetUrl).filter(Boolean);
    if (!imageReferences.length) {
        return { urls: [], error: "没有有效的图片引用" };
    }

    const cookie = buildCookie(sso, sso_rw);
    const headers = getHeaders(cookie, IMAGINE_REFERER);

    // 策略：先尝试专用编辑模型，失败则回退到 grok-3
    const models: Array<"imagine-image-edit" | "grok-3"> = [
        "imagine-image-edit",
        "grok-3",
    ];

    let lastError = "";

    for (const modelName of models) {
        const payload = buildImageEditPayload({
            prompt,
            imageReferences,
            modelName,
        });

        try {
            const resp = await fetch(CHAT_API, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });

            if (!resp.ok) {
                const txt = await resp.text().catch(() => "");
                lastError = `上游错误 ${resp.status}: ${txt.slice(0, 200)}`;
                // 403/400 等错误时尝试下一个模型
                continue;
            }

            const text = await resp.text();
            const urls = extractImageUrls(text);

            if (urls.length > 0) {
                return { urls };
            }

            lastError = "未从响应中提取到图片 URL";
        } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            // 继续尝试下一个模型
        }
    }

    return { urls: [], error: lastError || "图片编辑失败" };
}
