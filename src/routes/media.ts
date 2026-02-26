/**
 * 图片代理路由 — 从 grok2api 的 media.ts 移植
 * 通过 base64url 编码的路径访问 assets.grok.com 上的图片
 * 路径格式:
 *   /images/p_<base64url(pathname)>  — 代理 assets.grok.com 上的路径
 *   /images/u_<base64url(full_url)>  — 代理完整 URL
 */

import { Hono } from "hono";
import type { Env } from "../env";
import { getRandomToken } from "../repo/tokens";
import { getHeaders, buildCookie } from "../grok/headers";

export const mediaRoutes = new Hono<{ Bindings: Env }>();

const ASSETS_BASE = "https://assets.grok.com";

// base64url 编码
function base64UrlEncode(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// base64url 解码
function base64UrlDecode(input: string): string {
    const s = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const binary = atob(s + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

// 允许代理的上游域名白名单
function isAllowedHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return h === "assets.grok.com" || h === "grok.com" || h.endsWith(".grok.com") || h.endsWith(".x.ai");
}

// 构建代理请求头（与 grok2api 的 toUpstreamHeaders 对齐）
function toUpstreamHeaders(cookie: string): Record<string, string> {
    const headers = getHeaders(cookie);
    delete headers["Content-Type"];
    headers.Accept =
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "same-site";
    headers["Sec-Fetch-User"] = "?1";
    headers["Upgrade-Insecure-Requests"] = "1";
    headers.Referer = "https://grok.com/";
    return headers;
}

/**
 * 将原始 Grok 图片路径编码为代理 URL
 * 供 edits.ts 等路由使用
 */
export function encodeAssetPath(raw: string): string {
    try {
        const u = new URL(raw);
        return `u_${base64UrlEncode(u.toString())}`;
    } catch {
        const p = raw.startsWith("/") ? raw : `/${raw}`;
        return `p_${base64UrlEncode(p)}`;
    }
}

export function toProxyUrl(baseUrl: string, encodedPath: string): string {
    return `${baseUrl.replace(/\/$/, "")}/images/${encodedPath}`;
}

// GET /images/:imgPath — 代理图片请求
mediaRoutes.get("/images/:imgPath{.+}", async (c) => {
    const imgPath = c.req.param("imgPath");

    let upstreamPath: string | null = null;
    let upstreamUrl: URL | null = null;

    // 解码 p_ 格式（路径）
    if (imgPath.startsWith("p_")) {
        try {
            upstreamPath = base64UrlDecode(imgPath.slice(2));
        } catch {
            upstreamPath = null;
        }
    }

    // 解码 u_ 格式（完整 URL）
    if (imgPath.startsWith("u_")) {
        try {
            const decodedUrl = base64UrlDecode(imgPath.slice(2));
            const u = new URL(decodedUrl);
            if (isAllowedHost(u.hostname)) upstreamUrl = u;
        } catch {
            upstreamUrl = null;
        }
    }

    if (upstreamUrl) upstreamPath = upstreamUrl.pathname;

    // 回退：直接当路径用
    if (!upstreamPath) upstreamPath = `/${imgPath}`;

    if (!upstreamPath.startsWith("/")) upstreamPath = `/${upstreamPath}`;
    upstreamPath = upstreamPath.replace(/\/{2,}/g, "/");

    const url = upstreamUrl ?? new URL(`${ASSETS_BASE}${upstreamPath}`);

    // 获取一个可用 Token
    const token = await getRandomToken(c.env.DB);
    if (!token) {
        return c.text("No available token", 503);
    }

    // Cookie 构建：与 grok2api 的 media.ts 完全对齐
    // 关键：sso-rw 在前，且如果 sso_rw 为空则用 sso 值填充
    const ssoValue = token.sso;
    const ssoRwValue = token.sso_rw || token.sso;
    const cookie = `sso-rw=${ssoRwValue}; sso=${ssoValue}`;
    const headers = toUpstreamHeaders(cookie);

    try {
        const upstream = await fetch(url.toString(), { headers });

        if (!upstream.ok) {
            return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
        }

        const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

        return new Response(upstream.body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } catch (e) {
        return c.text(e instanceof Error ? e.message : String(e), 500);
    }
});
