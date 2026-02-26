/**
 * 图片上传模块 — 将图片上传到 Grok 并获取 fileId / fileUri
 * 移植自 grok2api 项目，适配 grok-art-proxy 的 headers 体系
 */

import { getHeaders, buildCookie } from "./headers";

const UPLOAD_API = "https://grok.com/rest/app-chat/upload-file";
const MIME_DEFAULT = "image/jpeg";

function isUrl(input: string): boolean {
    try {
        const u = new URL(input);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function guessExtFromMime(mime: string): string {
    const m = mime.split(";")[0]?.trim() ?? "";
    const parts = m.split("/");
    return parts.length === 2 && parts[1] ? parts[1] : "jpg";
}

function parseDataUrl(dataUrl: string): { base64: string; mime: string } {
    const trimmed = dataUrl.trim();
    const comma = trimmed.indexOf(",");
    if (comma === -1) return { base64: trimmed, mime: MIME_DEFAULT };
    const header = trimmed.slice(0, comma);
    const base64 = trimmed.slice(comma + 1);
    const match = header.match(/^data:([^;]+);base64$/i);
    return { base64, mime: match?.[1] ?? MIME_DEFAULT };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}

/**
 * 将文件二进制（File 对象）上传到 Grok
 */
export async function uploadImageFile(
    file: File,
    sso: string,
    sso_rw: string,
): Promise<{ fileId: string; fileUri: string }> {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const mime = file.type || MIME_DEFAULT;
    const filename = file.name || `image.${guessExtFromMime(mime)}`;

    return uploadBase64(base64, mime, filename, sso, sso_rw);
}

/**
 * 将 URL / data-url / 纯 base64 字符串上传到 Grok
 */
export async function uploadImageInput(
    imageInput: string,
    sso: string,
    sso_rw: string,
): Promise<{ fileId: string; fileUri: string }> {
    let base64 = "";
    let mime = MIME_DEFAULT;
    let filename = "image.jpg";

    if (isUrl(imageInput)) {
        const r = await fetch(imageInput, { redirect: "follow" });
        if (!r.ok) throw new Error(`下载图片失败: ${r.status}`);
        mime = r.headers.get("content-type")?.split(";")[0] ?? MIME_DEFAULT;
        if (!mime.startsWith("image/")) mime = MIME_DEFAULT;
        base64 = arrayBufferToBase64(await r.arrayBuffer());
        filename = `image.${guessExtFromMime(mime)}`;
    } else if (imageInput.trim().startsWith("data:image")) {
        const parsed = parseDataUrl(imageInput);
        base64 = parsed.base64;
        mime = parsed.mime;
        filename = `image.${guessExtFromMime(mime)}`;
    } else {
        base64 = imageInput.trim();
    }

    return uploadBase64(base64, mime, filename, sso, sso_rw);
}

/**
 * 底层上传：将 base64 数据发送到 Grok upload API
 */
async function uploadBase64(
    base64: string,
    mime: string,
    filename: string,
    sso: string,
    sso_rw: string,
): Promise<{ fileId: string; fileUri: string }> {
    const cookie = buildCookie(sso, sso_rw);
    const headers = getHeaders(cookie);

    const body = JSON.stringify({
        fileName: filename,
        fileMimeType: mime,
        content: base64,
    });

    const resp = await fetch(UPLOAD_API, { method: "POST", headers, body });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`上传失败: ${resp.status} ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as { fileMetadataId?: string; fileUri?: string };
    return { fileId: data.fileMetadataId ?? "", fileUri: data.fileUri ?? "" };
}
