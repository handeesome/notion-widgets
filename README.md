# Notion Widgets

一组可以部署到静态托管服务、再通过 `/embed` 嵌入 Notion 的轻量网页组件。每个组件都放在独立目录中，可单独预览和部署。

## 组件

| 目录 | 说明 | 数据来源 / 依赖 | 详细文档 |
| --- | --- | --- | --- |
| [`gallery/`](./gallery/) | 支持多种布局、自动播放和在线配置的图片画廊 | Supabase、Supabase JS CDN | [Gallery Widget](./gallery/README.md) |
| [`weather/`](./weather/) | 展示厦门与宁波实时天气的双城天气卡片 | Open-Meteo | [Weather Widget](./weather/README.md) |
| [`questions/`](./questions/) | 支持卡片 / 盲盒切换的问题抽取，内置题库编辑与一轮不重复 | 无外部依赖，浏览器本地存储 | [问题卡片](./questions/README.md) |

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

问题卡片可在 `questions` 目录运行 `python -m http.server 4175`，访问 `http://localhost:4175`。默认使用盲盒：先抽盒子，再点击盒子才打开；也可切换直接显示问题的卡片模式。编辑器默认用星号遮住问题，点击眼睛后才显示和编辑。页面内编辑的题库、开盒状态和抽取进度只保存在当前浏览器，尚未接入跨设备云端同步；要共享默认题库，修改 `questions/questions.js` 后重新部署。URL 支持 `theme=light|dark` 和 `mode=card|box`，完整用法见[问题卡片文档](./questions/README.md)。

图库配置页支持鼠标和触摸拖拽排序：卡片浮起跟随移动，相邻卡片实时平滑让位，松手后自动保存。长列表支持边缘自动滚动，按 Esc 可取消拖拽，也可聚焦卡片后用 Alt + ↑ / ↓ 调整顺序。

图库上传会按浏览器实际输出保存为 WebP 或 PNG；不支持 WebP 编码的浏览器会使用 PNG。HEIC 照片依赖浏览器原生解码，无法读取时会提示先导出为 JPEG 或 PNG。已有 Supabase 项目需先运行[图片格式升级 SQL](./gallery/supabase-image-formats-migration.sql)，再部署新版页面；详见[图库文档](./gallery/README.md)。

## 部署与嵌入

1. 将仓库部署到 GitHub Pages、Cloudflare Pages 或其他静态托管服务。
2. 确认目标组件目录可通过 HTTPS 访问，例如 `https://example.com/weather/`。
3. 在 Notion 中输入 `/embed`，粘贴对应组件的公开地址。

本仓库的 GitHub Pages 问题盲盒地址为 <https://handeesome.github.io/notion-widgets/questions/?mode=box>，可直接用于 Notion `/embed`。

`weather` 和 `questions` 不需要 API Key。`questions` 无需后端，不会同步多人抽取状态或页面内编辑的问题。`gallery` 的浏览器端配置只应包含 Supabase publishable key；不要提交 `service_role` key、数据库密码或其他密钥。

## 项目结构

```text
Notion_Widgets/
├── gallery/           # 图片画廊与配置页
├── weather/           # 双城天气组件
├── questions/         # 问题卡片与盲盒组件
├── AGENTS.md          # 项目维护约定
└── README.md          # 项目总览
```

## 维护说明

每次修改组件功能、配置方式、依赖、目录结构、运行步骤或部署方式时，都要在同一次改动中同步更新本 README；涉及具体组件时，也要检查并更新其目录下的 README。
