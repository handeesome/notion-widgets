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
- 支持左右箭头、分页点、键盘方向键和触摸滑动；Accordion 在桌面端悬停图片即可展开，Fan stack 悬停时会在原位显示图片，Vertical board 悬停时会渐显图片并继续使用滚轮切换。
- 所有布局都可以点击图片，在新标签页中打开原图；拖动或滑动切换时不会误触。
- 配置页支持上传、替换、删除、拖拽排序、布局、图片尺寸、速度、计数器、卡片圆角、箭头、分页点和颜色。
- 图片上传前会在浏览器内缩放，并转换为 WebP。
- 最多 20 张图片；单个 Storage 对象上限为 8 MB。
