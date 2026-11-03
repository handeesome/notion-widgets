# 独立部署到 Cloudflare Workers

独立 Worker 与两条 /widgets/* 路由已部署，已验证问题页、管理页、图库、天气页的独立部署响应头及个人网站首页。Cloudflare Git 已连接本仓库 main；push 后会独立构建和部署，原 Notion 链接不变。手动 npm run build 与 npm run deploy 也可用。以下记录生产配置与验证步骤。

## Git 部署配置

在 Cloudflare Workers & Pages 新建或连接 Worker：

- 名称：`notion-widgets`（必须与 `wrangler.jsonc` 一致）
- 仓库：`handeesome/notion-widgets`
- 生产分支：`main`
- 根目录：仓库根目录
- Node：22 或更高
- 构建命令：`npm run build`
- 部署命令：`npm run deploy`

没有应用依赖；部署命令固定使用 Wrangler 4.112.0。Cloudflare 的 Git 集成负责推送后构建，无须把 API Token 写进代码。

生产配置显式关闭 workers.dev 与预览 URL，只通过原有个人域名的组件路径提供服务，避免不同发布方式改变入口设置。

`scripts/build-widgets.mjs` 从 Git 已跟踪文件生成 `dist/widgets/{questions,gallery,weather}/`，只打包浏览器资源，排除测试、SQL、文档和忽略文件。`dist` 不提交。可运行 `npm run build`、`npm run deploy:check` 检查打包与 Wrangler 配置。

## 切换及验证

1. 确认新 Worker 的 `workers.dev/widgets/questions/`、`/widgets/gallery/`、`/widgets/weather/` 和问题管理页均正确，不能把个人网站 SPA 的 HTTP 200 当成组件成功。
2. 部署 `wrangler.jsonc` 中两条路径路由：`www.ducenhan.com/widgets/*`、`ducenhan.com/widgets/*`。路由只接管组件路径，个人网站 Custom Domain 保留。
3. 检查现有带 `id` 链接的数据、抽题和管理功能。URL、域名、题库 ID、Supabase 均保留。
4. 检查响应头 `X-Widgets-Deployment: independent` 及 `X-Widgets-Commit`，确认请求由新 Worker 提供。检查 `/` 仍是个人网站。
5. 验证后才从个人网站移除构建前的 `scripts/sync-notion-widgets.mjs` 调用；旧静态快照可保留为回退。此后组件发布只需 push 到本仓库 main，等待 Cloudflare 成功并刷新 Notion。

若切换失败，删除新 Worker 的两条 `/widgets/*` 路由即可恢复个人网站的旧快照；无需修改题库或 Notion 链接。不要删除个人网站的 Custom Domain 或 DNS。

数据库结构修改仍需执行对应 Supabase 升级 SQL；推送网页代码不会自动迁移数据库。

## 自动部署排查

构建日志会输出 `Release commit`，应与线上响应头 `X-Widgets-Commit` 一致。GitHub Pages 的 build/deploy 成功不代表本 Worker 已发布，应检查 `Workers Builds: notion-widgets` 或上述线上版本号。

若 Settings → Builds 提示项目已断开 Git 账号，点击 Git Repository 的 Manage，恢复 GitHub 安装对 notion-widgets 仓库的访问，再确认生产分支为 main。仅显示仓库名和分支并不能证明 Git 授权正常。

Cloudflare 官方说明：[路径路由优先于同域 Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/routes/)、[Git 自动构建与部署](https://developers.cloudflare.com/workers/ci-cd/builds/)。
