# Notion Widgets

一组可以部署到静态托管服务、再通过 `/embed` 嵌入 Notion 的轻量网页组件。每个组件都放在独立目录中，可单独预览和部署。

## 组件

| 目录 | 说明 | 数据来源 / 依赖 | 详细文档 |
| --- | --- | --- | --- |
| [`gallery/`](./gallery/) | 支持多种布局、自动播放和在线配置的图片画廊 | Supabase、Supabase JS CDN | [Gallery Widget](./gallery/README.md) |
| [`weather/`](./weather/) | 展示厦门与宁波实时天气的双城天气卡片 | Open-Meteo | [Weather Widget](./weather/README.md) |
| [`questions/`](./questions/) | 支持开盒 / 整卡翻转的问题抽取、自动保存管理页、跨设备同步 | Supabase、Supabase JS CDN；可选本地存储模式 | [问题盲盒](./questions/README.md) |

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

问题盲盒可在 `questions` 目录运行 `python -m http.server 4175`，访问 `http://localhost:4175`。仅卡片中间区域可触发操作，上下文字不响应；盲盒模式播放盒盖打开，卡片模式整张翻转，两种模式均在「封面 → 问题 → 下一张封面」间切换。右下角图标在新标签页打开 Dashboard；每条问题单独配眼睛按钮和添加时间。带 `id` 的专属链接通过 Supabase 同步题库、当前问题及进度；不带 `id` 时使用本地存储。URL 支持 `theme=light|dark` 和 `mode=card|box`，初始化与用法见[问题盲盒文档](./questions/README.md)。

问题组件采用简洁文案，操作说明集中在文档。主页右下角的卡片加号图标打开 Dashboard。Dashboard 顶部左侧为可操作的主页预览，右侧为添加问题的便签，下面是带图钉的问题墙；窄屏上下排列。预览下方可调整默认样式、主题和主页文案，修改立即预览并自动保存；预览抽题不改变共享进度。眼睛只展开只读文字，点击「修改」才显示编辑框，「完成」后回到卡片样式。添加框随内容自动增高，没有手动拖拽手柄，点击「添加问题」直接保存；编辑自动保存，移除直接生效，没有额外保存和重新载入步骤。主界面不显示常驻同步提示或同步按钮。

已有问题云端安装需要执行 [`questions/supabase-presentation.sql`](./questions/supabase-presentation.sql) 启用文案和默认外观设置；全新安装直接执行最新版初始化脚本。此升级保留题目与抽取进度。

图库配置页支持鼠标和触摸拖拽排序：卡片浮起跟随移动，相邻卡片实时平滑让位，松手后自动保存。长列表支持边缘自动滚动，按 Esc 可取消拖拽，也可聚焦卡片后用 Alt + ↑ / ↓ 调整顺序。

图库上传会按浏览器实际输出保存为 WebP 或 PNG；不支持 WebP 编码的浏览器会使用 PNG。HEIC 照片依赖浏览器原生解码，无法读取时会提示先导出为 JPEG 或 PNG。已有 Supabase 项目需先运行[图片格式升级 SQL](./gallery/supabase-image-formats-migration.sql)，再部署新版页面；详见[图库文档](./gallery/README.md)。

## 部署与嵌入

1. 将仓库部署到 GitHub Pages、Cloudflare Pages 或其他静态托管服务。
2. 确认目标组件目录可通过 HTTPS 访问，例如 `https://example.com/weather/`。
3. 在 Notion 中输入 `/embed`，粘贴对应组件的公开地址。

本仓库的 GitHub Pages 问题盲盒基础地址为 <https://handeesome.github.io/notion-widgets/questions/?mode=box>。跨设备使用时，请在 Notion `/embed` 中粘贴 Supabase 初始化生成的完整专属链接（带 `id`）；不要把真实题库 ID 提交到仓库。

`weather` 不需要 API Key。`gallery` 和 `questions` 的云端功能使用 Supabase，浏览器端配置只应包含 publishable key；不要提交 `service_role` key、数据库密码或其他密钥。问题盲盒不带 `id` 时无需数据库。

## 项目结构

```text
Notion_Widgets/
├── gallery/           # 图片画廊与配置页
├── weather/           # 双城天气组件
├── questions/         # 问题盲盒、独立 Dashboard 与云端初始化脚本
├── AGENTS.md          # 项目维护约定
└── README.md          # 项目总览
```

## 维护说明

每次修改组件功能、配置方式、依赖、目录结构、运行步骤或部署方式时，都要在同一次改动中同步更新本 README；涉及具体组件时，也要检查并更新其目录下的 README。
