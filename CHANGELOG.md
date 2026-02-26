# Changelog

## [1.1.0] - 2026-02-26

### 新增功能 (Features)

- **图片编辑接口** (`/v1/images/edits`)
  - 支持 OpenAI 兼容的 multipart/form-data 格式
  - 支持 `response_format` 参数：`url`（代理地址）或 `b64_json`（base64 编码）
  - 支持 `n` 参数控制返回图片数量（默认 1）
  - 双模型回退机制：先尝试 `imagine-image-edit`，失败自动切 `grok-3`
  - Token 轮换重试（最多 3 次）

- **图片上传模块** (`src/grok/upload.ts`)
  - 支持 File 对象、URL、data-url、纯 base64 等多种输入格式
  - 自动检测 MIME 类型

- **图片代理路由** (`/images/:path`)
  - base64url 编码路径格式（`p_` 或 `u_` 前缀）
  - 使用正确的鉴权头（含 `x-statsig-id` 签名）
  - 域名白名单校验（`assets.grok.com`、`*.x.ai`）

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/grok/upload.ts` | 图片上传到 Grok 服务 |
| `src/grok/imageEdit.ts` | 图片编辑核心逻辑（Payload 构建 + 双模型回退） |
| `src/routes/v1/edits.ts` | `/v1/images/edits` API 路由 |
| `src/routes/media.ts` | `/images/:path` 图片代理路由 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.ts` | 挂载 `editsRoutes` 和 `mediaRoutes` |
