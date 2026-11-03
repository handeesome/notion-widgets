# Notion Widgets

一组可以部署到静态托管服务、再通过 `/embed` 嵌入 Notion 的轻量网页组件。每个组件都放在独立目录中，可单独预览和部署。

## 组件

| 目录 | 说明 | 数据来源 / 依赖 | 详细文档 |
| --- | --- | --- | --- |
| [`gallery/`](./gallery/) | 支持多种布局、自动播放和在线配置的图片画廊 | Supabase、Supabase JS CDN | [Gallery Widget](./gallery/README.md) |
| [`weather/`](./weather/) | 展示厦门与宁波实时天气的双城天气卡片 | Open-Meteo | [Weather Widget](./weather/README.md) |
| [`questions/`](./questions/) | 小巧的单入口抽牌与多张历史卡组、自动保存管理页、跨设备同步 | Supabase、Supabase JS CDN；可选本地存储模式 | [对话卡组](./questions/README.md) |

## 本地预览

项目不需要构建。进入任一组件目录并启动静态文件服务器：

```powershell
cd weather
python -m http.server 4173
```

然后访问 `http://localhost:4173`。预览图库时可改为：

```powershell
cd gallery
python -m http.server 4174
```

图库还需要先配置 Supabase，并在 URL 中提供 `gallery_id`；完整步骤见 [`gallery/README.md`](./gallery/README.md)。

问题卡组在 questions 目录运行 python -m http.server 4185 预览。界面优先保持小巧，只提供「抽一张」「抽多张」两个选项，始终共用一个抽牌入口。抽多张的本轮历史默认折叠，展开后最多 120px 高并可滚动。没有人数、玩家、下一位或收回卡片按钮；卡片固定 260px 高，长题在内部滚动。抽牌方式、当前卡片和历史跨设备共享。管理页支持便签新增、每题只读查看/编辑，以及醒目的「批量添加问题」入口，已有题目与新增入口合在一份可编辑 bullet 列表中。打开后自动滚到末尾，可继续输入、Enter 续行或粘贴多行，点击「更新题库」统一保存；弹窗使用 85% 黑色遮罩并锁定底层滚动。详见[卡组文档](./questions/README.md)。

组件已发布到独立 Cloudflare Worker `notion-widgets`，接管 www.ducenhan.com 与 ducenhan.com 的 `/widgets/*` 路径；个人网站首页仍由 `ducenhan-website` 提供。原 Notion 链接、题库 ID、Supabase 配置不变。Cloudflare Git 已连接本仓库 main，push 后构建并独立部署；也可用 `npm run build` 与 `npm run deploy` 手动发布组件。构建日志中的 Release commit 与线上 X-Widgets-Commit 响应头用于核对实际发布版本；Git 授权断开时需在 Cloudflare Builds 的 Manage 中恢复仓库访问。步骤见 [独立部署说明](./docs/independent-deployment.md)。

个人网站仓库保留的组件静态快照仅作回退；新路由优先提供独立 Worker 的资源，组件发布不再要求构建个人网站。

问题支持单个主题：新增时选择或新建主题，问题墙逐题调整并按主题筛选，主页卡组下方按每排 3 个的等宽网格排列主题选项和题数，抽多张旁不重复显示主题。添加便签右上角与问题墙的每张卡片都用完整下拉菜单选择或新建主题，原生菜单适配深色背景，下拉框聚焦时不显示高亮外框或阴影，自定义主题最多 6 个（不含全部与未分类）。批量添加保持纯问题列表，新题先归为未分类。

问题云端升级执行 questions/supabase-tabletop.sql，再执行 questions/supabase-topics.sql；已升级主题功能的安装再执行 questions/supabase-topic-limit.sql，保留原题目、id 和添加时间；新安装先执行 supabase-setup.sql 再执行卡桌升级脚本。

图库配置页支持鼠标和触摸拖拽排序：卡片浮起跟随移动，相邻卡片实时平滑让位，松手后自动保存。长列表支持边缘自动滚动，按 Esc 可取消拖拽，也可聚焦卡片后用 Alt + ↑ / ↓ 调整顺序。

图库上传会按浏览器实际输出保存为 WebP 或 PNG；不支持 WebP 编码的浏览器会使用 PNG。HEIC 照片依赖浏览器原生解码，无法读取时会提示先导出为 JPEG 或 PNG。已有 Supabase 项目需先运行[图片格式升级 SQL](./gallery/supabase-image-formats-migration.sql)，再部署新版页面；详见[图库文档](./gallery/README.md)。

## 部署与嵌入

1. 将仓库部署到 GitHub Pages、Cloudflare Pages 或其他静态托管服务。
2. 确认目标组件目录可通过 HTTPS 访问，例如 `https://example.com/weather/`。
3. 在 Notion 中输入 `/embed`，粘贴对应组件的公开地址。

本仓库的对话卡组个人域名地址为 <https://www.ducenhan.com/widgets/questions/>。跨设备使用时，请在 Notion `/embed` 中粘贴 Supabase 初始化生成的完整专属链接（带 `id`）；不要把真实题库 ID 提交到仓库。

`weather` 不需要 API Key。`gallery` 和 `questions` 的云端功能使用 Supabase，浏览器端配置只应包含 publishable key；不要提交 `service_role` key、数据库密码或其他密钥。对话卡组不带 `id` 时无需数据库。

## 项目结构

```text
Notion_Widgets/
├── gallery/           # 图片画廊与配置页
├── weather/           # 双城天气组件
├── questions/         # 对话卡组、独立 Dashboard 与云端初始化脚本
├── scripts/          # 独立部署资源打包
├── docs/             # 部署切换与回退说明
├── wrangler.jsonc    # 独立 Worker 和路径路由
├── package.json      # Node 22+ 的构建与部署命令
├── AGENTS.md          # 项目维护约定
└── README.md          # 项目总览
```

## 维护说明

每次修改组件功能、配置方式、依赖、目录结构、运行步骤或部署方式时，都要在同一次改动中同步更新本 README；涉及具体组件时，也要检查并更新其目录下的 README。
