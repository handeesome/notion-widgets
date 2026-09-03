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
