import { Hono } from "hono";
import type { Env } from "./env";
import { tokenRoutes } from "./routes/tokens";
import { imagineRoutes } from "./routes/imagine";
import { proxyRoutes } from "./routes/proxy";
import { mediaRoutes } from "./routes/media";
import { authRoutes, hasAuthCookie } from "./routes/auth";
import { apiKeyRoutes } from "./routes/api-keys";
import { imagesRoutes } from "./routes/v1/images";
import { editsRoutes } from "./routes/v1/edits";
import { videosRoutes } from "./routes/v1/videos";
import { modelsRoutes } from "./routes/v1/models";
import { chatRoutes } from "./routes/v1/chat";
import { apiAuthMiddleware } from "./middleware/api-auth";

const app = new Hono<{ Bindings: Env }>();

function getAssets(env: Env): Fetcher | null {
  const anyEnv = env as unknown as { ASSETS?: unknown };
  const assets = anyEnv.ASSETS as { fetch?: unknown } | undefined;
  return assets && typeof assets.fetch === "function" ? (assets as Fetcher) : null;
}

function getBuildSha(env: Env): string {
  const v = String((env as unknown as Record<string, unknown>)?.BUILD_SHA ?? "").trim();
  return v || "dev";
}

function withResponseHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function fetchAsset(c: { env: Env; req: { url: string; raw: Request } }, pathname: string): Promise<Response> {
  const assets = getAssets(c.env);
  const buildSha = getBuildSha(c.env);

  if (!assets) {
    return new Response("Internal Server Error: missing ASSETS binding", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "x-grok-imagine-build": buildSha },
    });
  }

  const url = new URL(c.req.url);
  url.pathname = pathname;

  try {
    // Create a simple GET request for the asset
    const res = await assets.fetch(url.toString());
    const extra: Record<string, string> = { "x-grok-imagine-build": buildSha };

    // Avoid caching UI files aggressively
    const lower = pathname.toLowerCase();
    if (lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css")) {
      extra["cache-control"] = "no-store, no-cache, must-revalidate";
      extra["pragma"] = "no-cache";
      extra["expires"] = "0";
    }

    return withResponseHeaders(res, extra);
  } catch (err) {
    console.error(`ASSETS fetch failed (${pathname}):`, err);
    return new Response(`Internal Server Error: failed to fetch asset ${pathname}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "x-grok-imagine-build": buildSha },
    });
  }
}

// Check if authentication is required
function isAuthRequired(env: Env): boolean {
  return !!(env.AUTH_USERNAME && env.AUTH_PASSWORD);
}

// Check if path is for login page resources only
function isLoginPagePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/status" ||
    pathname === "/css/style.css" ||
    pathname === "/css/login.css" ||
    pathname === "/js/login.js" ||
    pathname === "/health"
  );
}

// Check if path is a public proxy path (video/image proxy for API consumers)
function isPublicProxyPath(pathname: string): boolean {
  return (
    pathname === "/api/proxy/video" ||
    pathname.startsWith("/api/proxy/assets/")
  );
}

// Check if path uses API Key authentication (OpenAI compatible API)
function isApiKeyAuthPath(pathname: string): boolean {
  return pathname.startsWith("/v1/");
}

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  const buildSha = getBuildSha(c.env as Env);
  const res = c.text(`Internal Server Error`, 500);
  return withResponseHeaders(res, { "x-grok-imagine-build": buildSha });
});

// Auth middleware - runs on ALL requests
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;

  // If auth not configured, allow all
  if (!isAuthRequired(c.env)) {
    return next();
  }

  // Allow login page resources without auth
  if (isLoginPagePath(pathname)) {
    return next();
  }

  // Allow public proxy paths without auth (they use token param for validation)
  if (isPublicProxyPath(pathname)) {
    return next();
  }

  // Skip cookie auth for API Key authenticated paths (handled by apiAuthMiddleware)
  if (isApiKeyAuthPath(pathname)) {
    return next();
  }

  // Check for auth cookie
  const hasAuth = hasAuthCookie(c.req.raw);

  if (!hasAuth) {
    // For API requests, return 401
    if (pathname.startsWith("/api/")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    // For ALL other requests (pages, static files), redirect to login
    return c.redirect("/");
  }

  return next();
});

// Mount auth routes (before other API routes)
app.route("/", authRoutes);

// Mount API Key management routes (protected by cookie auth)
app.route("/", apiKeyRoutes);

// Mount OpenAI compatible API routes (protected by API Key auth)
app.use("/v1/*", apiAuthMiddleware);
app.route("/v1/chat", chatRoutes);
app.route("/v1/images", imagesRoutes);
app.route("/v1/images", editsRoutes);
app.route("/v1/videos", videosRoutes);
app.route("/v1/models", modelsRoutes);

// Mount API routes
app.route("/", tokenRoutes);
app.route("/", imagineRoutes);
app.route("/", proxyRoutes);
app.route("/", mediaRoutes);

// Health check
app.get("/health", (c) =>
  c.json({
    status: "healthy",
    service: "Grok Imagine",
    runtime: "cloudflare-workers",
    build: { sha: getBuildSha(c.env) },
    auth_required: isAuthRequired(c.env),
    auth_configured: {
      username: !!c.env.AUTH_USERNAME,
      password: !!c.env.AUTH_PASSWORD,
    },
    bindings: {
      db: Boolean((c.env as unknown as Record<string, unknown>)?.DB),
      kv_cache: Boolean((c.env as unknown as Record<string, unknown>)?.KV_CACHE),
      assets: Boolean(getAssets(c.env)),
    },
  })
);

// Root -> login page (public) - index.html is the login page
app.get("/", (c) => fetchAsset(c, "/index.html"));

// Main app (protected by middleware) - app.html is the main application
app.get("/app.html", (c) => fetchAsset(c, "/app.html"));

// CSS files - need to handle explicitly for auth check
app.get("/css/*", (c) => {
  const url = new URL(c.req.url);
  return fetchAsset(c, url.pathname);
});

// JS files - need to handle explicitly for auth check
app.get("/js/*", (c) => {
  const url = new URL(c.req.url);
  return fetchAsset(c, url.pathname);
});

// Static files
app.get("/static/*", (c) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname.replace(/^\/static\//, "/");
  return fetchAsset(c, pathname);
});

// 404 handler - also protected by middleware
app.notFound(async (c) => {
  const assets = getAssets(c.env);
  const buildSha = getBuildSha(c.env);

  if (!assets) {
    return withResponseHeaders(c.text("Not Found", 404), { "x-grok-imagine-build": buildSha });
  }

  try {
    const res = await assets.fetch(c.req.raw);
    return withResponseHeaders(res, { "x-grok-imagine-build": buildSha });
  } catch {
    return withResponseHeaders(c.text("Not Found", 404), { "x-grok-imagine-build": buildSha });
  }
});

const handler: ExportedHandler<Env> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
};

export default handler;
