/**
 * OpenAI 兼容的图片编辑路由 — POST /v1/images/edits
 * 接受 multipart/form-data 格式，包含 image 文件和 prompt
 */

import { Hono } from "hono";
import type { Env } from "../../env";
import { getRandomToken } from "../../repo/tokens";
import { uploadImageFile } from "../../grok/upload";
import { editImage } from "../../grok/imageEdit";
import { incrementApiKeyUsage } from "../../repo/api-keys";
import { encodeAssetPath, toProxyUrl } from "../media";
import type { ApiAuthEnv } from "../../middleware/api-auth";

const app = new Hono<ApiAuthEnv>();

const MAX_RETRIES = 3;

interface OpenAIErrorResponse {
    error: {
        message: string;
        type: string;
        param: string | null;
        code: string | null;
    };
}

function errorResponse(message: string, code: string): OpenAIErrorResponse {
    return {
        error: {
            message,
            type: "invalid_request_error",
            param: null,
            code,
        },
    };
}

// POST /v1/images/edits
app.post("/edits", async (c) => {
    let form: FormData;
    try {
        form = await c.req.formData();
    } catch {
        return c.json(errorResponse("请求必须为 multipart/form-data 格式", "invalid_content_type"), 400);
    }

    // 提取 n (生成图片数量)
    const n = Math.min(Math.max(1, Number(form.get("n") ?? 1)), 10);

    // 提取 response_format: "url" 或 "b64_json"
    const responseFormat = String(form.get("response_format") ?? "url").trim().toLowerCase();

    // 提取 prompt
    const prompt = String(form.get("prompt") ?? "").trim();
    if (!prompt) {
        return c.json(errorResponse("缺少 prompt 参数", "missing_prompt"), 400);
    }

    // 提取图片文件
    const imageFiles: File[] = [...form.getAll("image"), ...form.getAll("image[]")]
        .filter((item): item is File => item instanceof File);

    if (imageFiles.length === 0) {
        return c.json(errorResponse("缺少 image 文件", "missing_image"), 400);
    }

    // 验证图片 MIME 类型
    const allowedMimes = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);
    for (const file of imageFiles) {
        const mime = (file.type || "").toLowerCase();
        if (mime && !allowedMimes.has(mime)) {
            return c.json(
                errorResponse(`不支持的图片格式: ${mime}，仅支持 jpeg/png/webp`, "invalid_image_format"),
                400,
            );
        }
    }

    // 构造 Base URL 用于生成代理地址
    const urlObj = new URL(c.req.url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    const db = c.env.DB;
    const excludedTokenIds: string[] = [];
    let lastError = "";

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
        const token = await getRandomToken(db, excludedTokenIds);

        if (!token) {
            if (excludedTokenIds.length > 0) {
                return c.json(errorResponse(`所有 Token 均不可用 (已尝试 ${excludedTokenIds.length} 个)`, "rate_limit_exceeded"), 429);
            }
            return c.json(errorResponse("没有可用的 Token，请先导入", "no_tokens_available"), 503);
        }

        try {
            // 步骤 1：上传所有图片
            const fileUris: string[] = [];
            for (const file of imageFiles) {
                const result = await uploadImageFile(file, token.sso, token.sso_rw);
                if (result.fileUri) {
                    fileUris.push(result.fileUri);
                }
            }

            if (fileUris.length === 0) {
                lastError = "图片上传失败，未获得有效的 fileUri";
                excludedTokenIds.push(token.id);
                continue;
            }

            // 步骤 2：发送编辑请求
            const editResult = await editImage(prompt, fileUris, token.sso, token.sso_rw);

            if (editResult.urls.length > 0) {
                // 更新 API Key 用量
                const apiKeyInfo = c.get("apiKeyInfo");
                if (apiKeyInfo) {
                    await incrementApiKeyUsage(c.env.DB, apiKeyInfo.id);
                }

                const selectedUrls = editResult.urls.slice(0, n);

                if (responseFormat === "b64_json") {
                    // 下载图片并转为 base64 返回（完全绕开代理 403 问题）
                    const ssoVal = token.sso;
                    const ssoRwVal = token.sso_rw || token.sso;
                    const fetchCookie = `sso-rw=${ssoRwVal}; sso=${ssoVal}`;

                    const data = await Promise.all(selectedUrls.map(async (rawUrl) => {
                        const fullUrl = rawUrl.startsWith("http")
                            ? rawUrl
                            : `https://assets.grok.com/${rawUrl.replace(/^\//, "")}`;
                        try {
                            const resp = await fetch(fullUrl, {
                                headers: {
                                    Cookie: fetchCookie,
                                    Referer: "https://grok.com/",
                                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                                },
                            });
                            if (!resp.ok) return { b64_json: "" };
                            const buf = await resp.arrayBuffer();
                            const bytes = new Uint8Array(buf);
                            let binary = "";
                            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
                            return { b64_json: btoa(binary) };
                        } catch {
                            return { b64_json: "" };
                        }
                    }));

                    return c.json({
                        created: Math.floor(Date.now() / 1000),
                        data: data.filter((d) => d.b64_json),
                    });
                }

                // 默认 URL 模式：通过代理返回
                const data = selectedUrls.map((url) => {
                    const fullUrl = url.startsWith("http") ? url : `https://assets.grok.com/${url.replace(/^\//, "")}`;
                    return { url: toProxyUrl(baseUrl, encodeAssetPath(fullUrl)) };
                });

                return c.json({
                    created: Math.floor(Date.now() / 1000),
                    data,
                });
            }

            // 编辑失败
            lastError = editResult.error || "图片编辑未返回结果";

            // 如果是速率限制，换 Token 重试
            if (lastError.includes("429") || lastError.includes("rate")) {
                excludedTokenIds.push(token.id);
                continue;
            }

            // 其他错误直接返回
            return c.json(errorResponse(lastError, "edit_failed"), 500);

        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            lastError = msg;

            if (msg.includes("429") || msg.includes("Rate limited") || msg.includes("401")) {
                excludedTokenIds.push(token.id);
                continue;
            }

            return c.json(errorResponse(msg, "edit_failed"), 500);
        }
    }

    return c.json(errorResponse(lastError || "图片编辑失败", "edit_failed"), 500);
});

export { app as editsRoutes };
