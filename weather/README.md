# Xiamen & Ningbo Weather Widget

一个为 Notion 准备的厦门与宁波实时天气小组件：厦门在上，宁波紧接在下。视觉布局复刻了参考的 Indify 横向天气卡片，但不包含 Indify 水印、设置按钮或追踪脚本。

## 本地预览

```powershell
cd weather
python -m http.server 4173
```

然后打开 `http://localhost:4173`。

## 嵌入 Notion

1. 将这三个前端文件部署到任意静态托管服务：`index.html`、`styles.css`、`app.js`。
2. 在 Notion 中输入 `/embed`，粘贴部署后的 HTTPS 地址。
3. 推荐嵌入尺寸为 **442 × 300 px**。

默认跟随系统深浅色主题。也可以在地址末尾加入 `?theme=dark` 或 `?theme=light` 固定主题。

天气数据来自 [Open-Meteo](https://open-meteo.com/)，每 10 分钟自动刷新；不需要 API Key。

## 个人域名托管

个人网站 Cloudflare Worker 直接提供 https://www.ducenhan.com/widgets/weather/，可用于 Notion 嵌入，无需跳转到 github.io。网站构建时从本仓库 main 同步资源，天气数据仍来自 Open-Meteo。

## 独立部署准备

仓库根目录已提供独立 Cloudflare Worker 配置与资源打包命令，路径仍为 /widgets/weather/。独立 Worker 和现有域名的 /widgets/* 路由已上线，原链接与数据不变；Cloudflare Git 已连接 main，后续 push 到组件仓库即可触发独立构建部署。详见 [独立部署与回退](../docs/independent-deployment.md)。
