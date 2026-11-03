# 留一个问题 · 对话卡组

可嵌入 Notion 的小巧抽牌卡组，只保留卡片形式，旧链接中的 mode=box 不再启用盲盒。

## 玩法

- 只提供「抽一张」「抽多张」两种方式，始终只有一个中央抽牌入口，不设置人数或玩家，也没有下一位、收回卡片按钮。
- 点牌背翻开问题，再点问题翻回牌背，再点抽下一题。两种方式都保留整卡翻转，动画期间防止连点。
- 抽一张只展示当前卡片；抽多张将本轮抽到的问题保存在下方「已抽问题」中，默认收起，展开后最多 120px 高，内部滚动。
- 整体最大宽度 580px，卡片固定 260px 高，长问题在卡内滚动，避免撑大 Notion 嵌入。
- 本轮不重复，题库耗尽后重新开始并清空上一轮历史；多题时避免跨轮立即重复。切换抽牌方式会回到牌背并清空历史。

## 主题

每题可设一个不超过 30 字的主题。新增便签右上角的下拉菜单可选择已有主题或打开新建窗口，每张问题卡片也用完整下拉菜单显示全部可选主题与新建入口，不再使用随当前输入过滤的联想框；原生菜单选项显式使用当前深浅色背景和文字颜色。管理页所有下拉框（新增主题、分类筛选、单题主题）聚焦时不显示高亮外框或阴影。自定义主题上限为 6 个（不含全部与未分类），已有超过上限的数据不删除，但不能继续增加，留空为「未分类」；问题墙可按主题筛选。批量窗口保持纯文字列表，新题无主题，已有题目主题保留。主页卡组下方按固定 3 列等宽网格排列「全部」「爱情（1）」等主题选项，括号表示总题数；抽多张按钮旁不再显示重复的主题文字。切换主题回到牌背并清空历史，所选主题及抽取结果在共享链接的设备间同步；主题耗尽后开始新一轮。编辑题目或主题会重置为全部范围并清空历史。旧题不会自动猜测分类。

## 云端与本地

同一个带 id 的链接共享题库、抽牌方式、当前问题和本轮已抽问题历史。Supabase RPC 对题库加锁并校验 revision；同时操作过期版本时显示最新桌面，不自动覆盖。实时广播只作刷新提示，失败时每 5 秒补偿读取。网络错误禁用操作并等待重新读取。

不带 id 时使用当前域名的 localStorage。更换域名不会自动迁移本地题库；云端只需保留原 id，题目和添加时间不变。

## 管理问题

右下角卡片加号在新标签页打开 dashboard.html，自动携带题库 id。左侧「预览可修改」可直接编辑名称和卡片上的六处展示文案（含名称共六处），每处最多 100 字，自动保存。预览只使用三道占位示例，不读取真实题目或写共享桌面；预览的玩法切换仅试效果。

右侧便签添加单条或换行分隔的多条问题，输入框自动增高，聚焦不显示外框。下方问题墙每题独立用星号遮挡，眼睛只读查看，点击「修改」才编辑，自动保存且保留添加时间。

醒目的「批量添加问题」打开一份统一的可编辑 bullet 列表，已有问题和新增问题没有模块分隔。打开后自动滚到列表末尾，空白 bullet 显示「继续添加问题…」，可直接输入、Enter 续行，或粘贴按换行分隔的列表；粘贴时去除项目符号并创建独立 bullet。没有独立输入框。点击「更新题库」统一保存已有修改与新增题目，原 ID 和添加时间保留。同题并发修改阻止整批覆盖并保留输入，窗口内可重试。遮罩为 85% 黑色，仍锁定底层页面滚动；列表可在内部滚动。

题库保留 1–500 道不同问题，每题 1–500 字。编辑题库会回到牌背并清空历史。不同题目的并发修改可合并，同一题冲突需明确重试。完整云端链接是访问凭据，眼睛不提供加密或权限保护，不要把实际 id 提交到仓库。

## 部署与个人域名

个人网站的 Cloudflare Worker 从自己的 public/widgets 目录直接提供组件：

- https://www.ducenhan.com/widgets/questions/
- https://www.ducenhan.com/widgets/questions/dashboard.html

在 Notion 中用 /embed 粘贴完整带 id 地址。替换旧链接时，仅将 https://handeesome.github.io/notion-widgets/questions/ 改为 https://www.ducenhan.com/widgets/questions/，保留 id。旧 GitHub Pages 地址仍兼容。

个人网站仓库 handeesome/handeesome.github.io 的 scripts/sync-notion-widgets.mjs 在每次构建前从本仓库 main 同步静态资源。组件更新推送后，再触发个人网站构建即可同步。不会把 SQL 或测试文件发布到个人网站。

域名直接托管避免了页面向 github.io 跳转，但题库仍依赖 Supabase 和 jsDelivr，天气还依赖 Open-Meteo；各地网络的实际可用性需在手机上验证。

## 数据库升级

全新安装依次运行 supabase-setup.sql、supabase-tabletop.sql。已有安装重新运行最新版 supabase-tabletop.sql，迁移旧多人状态到单张卡片及历史，更新原子抽牌 RPC 和题库编辑时重置的触发器。然后执行 supabase-topics.sql，扩展 metadata 中的 topic 和按主题抽取 RPC，保留访问凭据与 revision 冲突校验。此前已升级主题功能的项目执行 supabase-topic-limit.sql 补充 6 个主题上限；新版 supabase-topics.sql 已包含该检查。原有题目、设置、id 和添加时间保留。若重新执行旧初始化/展示 SQL，之后再次运行卡桌 SQL，确保返回值包含 table 字段。

浏览器只配置 supabase-config.js 中的 URL 和 publishable key。表禁止匿名直接读写；限定 RPC 检查随机 id 和请求头。不得提交 service_role 或数据库密码。

## 本地与验证

在仓库根目录运行 python -m http.server 4185，打开 http://localhost:4185/questions/。

node --test questions/tests/tabletop.test.cjs 检查卡桌规则；dashboard.test.cjs 和 cloud.test.cjs 检查自动保存、并发与 RPC。Windows 可用 Get-Content -Raw questions/tests/dashboard.test.cjs | node。云端卡桌升级另以合成题库在事务中验证单入口抽牌历史、回牌、过期版本和错误访问凭据后回滚，不修改真实题库。

## 独立部署准备

仓库根目录已提供独立 Cloudflare Worker 配置与资源打包命令，路径仍为 /widgets/questions/。目前待 Cloudflare 登录和 Git 连接后切换路由，线上仍由个人网站的旧部署提供。详见 [独立部署与回退](../docs/independent-deployment.md)。
