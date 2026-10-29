# Gallery Widget

一个可嵌入 Notion 的云端图库组件。图片和设置保存在 Supabase；页面本身可以部署到 GitHub Pages。图库每 3 秒循环切换，并带有无水印的配置页。

## 第一次设置 Supabase

1. 打开 Supabase 项目的 **SQL Editor**。
2. 新建查询，粘贴 [`supabase-setup.sql`](./supabase-setup.sql) 的全部内容并运行一次。
3. 复制结果表中的 `gallery_id`。不要把这个 ID 提交到 Git。
4. 打开配置页，并把 ID 放进 URL：

   ```text
   https://你的域名/gallery/configure.html?id=你的-gallery-id
   ```

5. 上传图片并调整设置。更改会自动保存到 Supabase。

用于 Notion `/embed` 的展示链接是：

```text
https://你的域名/gallery/?id=你的-gallery-id
```

完整链接相当于编辑密码：知道随机 ID 的人可以查看并修改该图库。仓库中只有 Supabase 的 publishable key；它是为浏览器公开使用而设计的。不要把 secret key、`service_role` key 或数据库密码放进代码。

## 已有项目升级图片格式支持

如果已经运行过旧版初始化 SQL，请先在 Supabase **SQL Editor** 中运行 [`supabase-image-formats-migration.sql`](./supabase-image-formats-migration.sql)，再部署新版静态文件。该脚本可重复运行，不会创建新图库或更改已有 ID、照片；它同步更新 Storage 的 MIME 白名单、上传路径策略和图库保存校验，让 WebP 与 PNG 都能上传及保存。不要为升级重新运行初始化脚本，因为初始化脚本会另建一个图库。

只更新网页而未更新后台时，PNG 上传或保存可能被旧规则拒绝，配置页会提示更新上传规则。新项目直接使用最新的 `supabase-setup.sql` 即可。

## 本地预览

```powershell
cd gallery
python -m http.server 4174
```

然后打开：

```text
http://localhost:4174/configure.html?id=你的-gallery-id
```

没有 `id` 的链接只显示空白提示，不会读取任何人的图片。克隆仓库的人若要使用自己的 Supabase，只需替换 [`supabase-config.js`](./supabase-config.js)，运行初始化 SQL，并使用他们自己的随机 ID。

## 行为

- 自动播放默认每 3 秒切换一张，并一直循环。
- 鼠标悬停、键盘聚焦、触摸操作或页面进入后台时自动暂停。
- 支持 Carousel、Accordion、Fan stack 和 Vertical board 四种布局；Vertical board 会把相邻图片向上下堆叠。
- 支持左右箭头、分页点、键盘方向键和触摸滑动；Accordion 在桌面端悬停图片即可展开，Fan stack 悬停时会在原位显示图片，Vertical board 悬停时会在原位渐显并浮到顶层，滚轮每个刻度切换一张且无需等待上一段动画结束。
- 所有布局都可以点击图片，在新标签页中打开原图；拖动或滑动切换时不会误触。
- 配置页支持上传、替换、删除、拖拽排序、布局、图片尺寸、速度、计数器、卡片圆角、箭头、分页点和颜色。
- 配置页拖拽排序时，整张图片卡片会浮起并跟随鼠标或触摸移动；越过相邻卡片中点时，其他卡片会平滑向上或向下让位，松手后落入空位并自动保存。拖到可视区域边缘会自动滚动；按 Esc 可取消本次拖拽。点击卡片仍可替换图片，聚焦卡片后按 Alt + ↑ / ↓ 也能排序；系统开启减少动态效果时会省略移位动画。
- 图片上传前会在浏览器内缩放，最长边不超过 1800 像素；优先转换为 WebP，浏览器不支持 WebP 编码时使用实际返回的 PNG。上传扩展名与 Content-Type 跟随实际格式，PNG 会保留透明度。转换后超过 8 MB 时会继续缩小，上传后释放处理内存。
- 添加与替换都接受图片类型缺失、但扩展名可识别的图片文件（包括 `.heic` / `.heif`）。HEIC 解码依赖浏览器原生支持，没有额外的 HEIC 解码库；旧浏览器或无法解码的照片会提示先导出成 JPEG 或 PNG。升级修复的是格式兼容问题，不能保证每种 HEIC 编码都能读取。
- 无法读取、转换失败、文件过大、后台规则未升级及上传或保存失败会显示可见提示。
- 最多 20 张图片；单个 Storage 对象上限为 8 MB。

## 本地回归检查

有 Node.js 时，在仓库根目录运行 `node --test gallery/tests/image-upload.test.cjs`。测试模拟浏览器返回 WebP 或 PNG、HEIC 解码失败及文件类型缺失等情况，并检查上传格式和后台规则的一致性；不连接实际 Supabase，也不替代 iPhone 真机验证。
