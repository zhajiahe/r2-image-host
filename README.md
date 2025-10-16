# Cloudflare R2 Image Host

基于 Cloudflare Workers、R2 和 KV 的极简单用户图床系统，实现认证、图片上传、文件管理、文件夹维护与统计功能，配套 TailwindCSS 单页控制台。

## 功能

- 单密码登录，KV 存储 session
- 图片上传（JPEG/PNG/GIF/WebP/SVG）、类型/大小校验
- R2 对象自动按日期或自定义路径命名与缓存配置
- 文件列表、搜索、批量删除、文件夹 CRUD
- 控制台展示统计信息
- 可选公共域名直链输出

## 页面展示
[]()

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 登录 Cloudflare

```bash
npx wrangler login
```

3. 创建 R2 存储桶与 KV 命名空间（记录 ID 并填入 `wrangler.toml`）

```bash
npx wrangler r2 bucket create <your-bucket-name>
npx wrangler kv:namespace create "KV"
```

4. 设置 Worker 密码

```bash
npx wrangler secret put APP_PASSWORD
```

5. 运行开发模式

```bash
npm run dev
```

6. 部署

```bash
npm run deploy
```

## 环境变量

- `APP_PASSWORD`：登录密码（通过 `wrangler secret` 管理）
- `R2_PUBLIC_DOMAIN`：可选，R2 公共访问域名（例如 `https://img.example.com`）

## 安全建议

- 生产环境使用密码哈希或更安全的认证方式
- 配置 Cloudflare 防火墙、Turnstile 或 IP 限制
- 限制 CORS 允许的域名
- 根据需求调整速率限制参数

## 许可证

MIT

