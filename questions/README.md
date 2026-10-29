# 留一个问题 · 云端问题盲盒

可嵌入 Notion 的问题组件，支持 Supabase 跨设备共享，也保留不联网的本地模式。默认盲盒模式，右上角可切换卡片模式；深浅色主题跟随系统。

## 使用与嵌入

- 本地模式：<https://handeesome.github.io/notion-widgets/questions/?mode=box>。
- 云端模式：使用初始化时生成的专属链接，格式为 `https://handeesome.github.io/notion-widgets/questions/?mode=box&id=你的题库ID`。
- 将**同一个完整云端链接**放入 Notion `/embed`，并在其他设备上打开。建议嵌入尺寸 **580 × 430 px**；长问题可增加高度。

盲盒初始保持关闭，点击卡片或盒子，整张卡片翻转并显示问题；再点击会翻回下一只未打开的盲盒，再点击才打开。页面不显示抽取数量，没有独立的抽取按钮。支持键盘 Tab 聚焦后按 Enter 或空格操作。卡片模式点击会直接抽取下一题。

同一轮问题不重复，抽完后下次抽取自动开始新一轮；多题时避免新一轮首题与上一题相同。刷新恢复当前问题及开盒状态，未打开的盒子不会自动开启。系统开启「减少动态效果」时直接切换状态。

## 管理问题 Dashboard

点击卡片右下角的调节图标，在**新标签页**打开 `dashboard.html`，云端链接会自动携带同一个题库 ID。

- 每条问题单独用 `*` 遮挡，并配有自己的眼睛按钮；点击该条的眼睛才显示可编辑原文，再点隐藏。重新载入或保存后恢复遮挡。
- 每条问题显示添加时间，云端由数据库生成并转换为当前浏览器的时区显示。编辑文字保留原添加时间，新加入的问题在保存后记录时间。本地旧题没有历史时间时显示「添加时间未记录」。
- 下方输入框支持每行添加一题；可以移除列表中的问题。修改暂存为草稿，点击「保存修改」后才生效，保存会重新开始一轮。
- 题库需有 1–500 个不同的问题，每题 1–500 字。空行忽略，重复或超长内容会提示修改。
- 其他设备修改题库时不会覆盖当前草稿；保存遇到题库版本冲突会保留草稿并提示重新载入。只改变抽取进度时允许在最新版本上重试保存一次。
- 云端 Dashboard 可导入当前设备在同一站点保存的本地题库，确认并保存后才写入云端。不会自动上传本地内容。

眼睛和星号用于避免提前看到题目，**不是加密或密码保护**。知道完整云端链接的人可查看和修改该题库，请只分享给一起使用的人，不要把真实题库 ID 提交到 Git。

## 跨设备同步行为

题库、当前题目、未抽题目和开盒状态保存在 Supabase。各台设备的主题与卡片 / 盲盒显示模式分别选择。

在线时使用 Supabase Realtime 广播通知刷新：一边点击开盒或切到下一只盲盒，其他可见页面会读取同一份状态，并跟随整张卡片翻转。网络会带来延迟，不保证逐帧同时。新进入或从后台回来的页面直接恢复最新状态，不重放旧动画。实时连接不可用时每 5 秒读取一次作为补偿，状态栏会显示「定时同步」。

修改在数据库内按题库加锁，并检查版本。两台设备同时操作时，只接受与当前版本一致的操作，过期操作会显示最新状态并提示重试。广播只包含版本提示，不接收广播中的题目或进度作为可信状态。

网络出错时禁用共享操作并显示重试入口，不会偷偷改为本地模式，也不会自动重试有可能已经执行成功的写入。重新同步后以云端实际状态为准。

不带 `id` 的地址使用浏览器 `localStorage`，不会同步到其他设备。Notion 内嵌与普通浏览器的存储可能隔离；本地存储不可用时显示提示。

## Supabase 首次配置

1. 使用现有 Supabase 项目，在 SQL Editor 中执行 [`supabase-setup.sql`](./supabase-setup.sql)。脚本只创建问题组件的表、函数和初始题库，不修改图库。重复执行不会重置题库，也不会再创建初始题库。
2. 复制结果中的 `embed_url`，在各设备和 Notion 中使用同一个链接。若通过迁移工具运行，随后在 SQL Editor 查询 `select id from public.question_decks order by created_at asc limit 1;`。
3. 浏览器端连接使用 [`supabase-config.js`](./supabase-config.js) 中的 Supabase URL 和 publishable key。使用自己的项目时替换这两个值；不要填写 secret key、service_role key 或数据库密码。
4. 打开共享链接，确认显示「云端已连接」，通过右下角图标管理问题。

表启用 RLS，匿名用户不能直接枚举、读写表，仅能携带对应随机 UUID 和请求头调用限定 RPC。实时频道名称也使用该随机 ID；链接本身是这份题库的访问凭据，不提供账号登录或只读分享权限。

Supabase 安全检查会提示这些 RPC 可由匿名角色执行；这是本组件的免登录专属链接设计，函数内仍检查对应 ID，且直接表访问已撤销。相关检查说明见 [SECURITY DEFINER RPC](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) 和 [RLS 无公开策略](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

## 本地预览与部署

在仓库根目录运行：

```powershell
python -m http.server 4175
```

打开 `http://localhost:4175/questions/?mode=box`，管理页为 `http://localhost:4175/questions/dashboard.html`。也可以直接在 `questions` 目录启动服务器，此时地址不含 `/questions/`。

支持 `theme=light|dark`、`mode=card|box` 和云端 `id` 参数。`questions.js` 控制本地模式的默认示例；修改它不会覆盖现有云端题库，云端请使用 Dashboard 编辑。

随仓库部署到 GitHub Pages，或单独部署此目录的 HTML、CSS 和 JavaScript 文件。Supabase JS 使用 jsDelivr CDN 提供的官方 v2 客户端接收实时广播；RPC 使用原生 fetch，实时客户端加载失败时仍可使用定时同步。

## 检查

在仓库根目录运行 `node --test questions/tests`。Windows 沙箱若阻止 Node 解析文件路径，可逐个使用 `Get-Content -Raw questions/tests/widget.test.cjs | node` 等方式运行。

前端回归覆盖点击与翻转、刷新恢复、不重复抽题、双页面同步、晚加入不重放动画、并发版本冲突、断网保护，以及 RPC 数据校验。数据库另通过可回滚的合成题库验证访问限制、抽取、冲突拒绝、编辑重置和添加时间保留；不修改实际题库。
