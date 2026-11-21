# 香港智慧城市地圖

以 [OpenFreeMap](https://openfreemap.org/) 為底圖，顯示港鐵網絡到站班次與運輸署交通快拍。

## 本機開發（Cursor 虛擬電腦）

```bash
npm install
npm run data
npm run dev
```

預覽預設：`http://127.0.0.1:5173`

## 建置

```bash
npm run build
npm run preview
```

## 正式發佈（驗收後）

使用 Cloudflare Workers 免費方案 + Static Assets，網址為 `*.workers.dev`：

```bash
npm run deploy
```

班次與快拍由瀏覽器直連政府開放數據，Worker 只託管靜態網站，以符合課堂最低成本。

## 資料來源

- OpenFreeMap / OpenStreetMap / OpenMapTiles
- 港鐵實時列車服務資訊（Next Train）
- 港鐵綫及車站 CSV
- 測繪處 CSDI 港鐵車站 venue 多邊形（建置時轉成靜態座標）
- 運輸署交通情況快拍圖像
