# 🏠 房屋家具配置工具（room-planner）

> **Summary**：純前端、零安裝的房屋平面配置工具。設定房屋公分尺寸後，拖拉家具、自由畫牆，用真實比例尺快速確認空間與格局。
>
> **Description**：A dependency-free, single-page floor-plan tool. Set your room size in centimetres, then drag furniture (with real cm dimensions), draw walls freely, and verify the layout. Built with vanilla JS + SVG — the SVG `viewBox` is the real-world cm grid, so the scale is exact and automatic. Save to a self-contained HTML, reload to keep editing, or copy the plan as an image.

開瀏覽器即用，無需後端、無相依套件。

## ✨ 功能

- **真實比例尺**：SVG `viewBox` 直接以公分為座標，輸入房屋寬×深即定比例，家具按 cm 自動縮放。即時顯示**坪數**。
- **縮放／平移**：滾輪縮放、右下角縮放鈕、`⤢` 符合視窗；空白鍵／中鍵／✋平移模式拖曳畫布。
- **家具目錄**：床／客廳／餐廚／收納／衛浴／開口，附台灣常見預設尺寸（如雙人床 152×190 cm），**拖曳**放入畫布。支援**自訂家具**（自訂名稱＋寬深）。
- **家具編輯**：四角控制點拖曳改大小（支援任意旋轉角）＋上方旋轉控制點（吸附 15°，Shift 自由）；左側可輸入精確 cm；加標籤。
- **門開門方向**：門顯示開向與迴旋扇形，可循環 4 種方位。
- **自由畫牆＋可編輯**：拖曳畫一道牆，圍出 L 型／不規則隔間，顯示長度 cm；選取後可拖移整段、拖端點改長度。
- **家具貼牆**：拖近牆面自動吸附貼齊。
- **框選群組**：拖框多選、整組移動；Shift 點擊加選。
- **多分頁對比**：同一檔案多個格局分頁，可新增／複製／改名／刪除，方便比較方案。
- **格線吸附**：5／10／25／50 cm 格線，可開關吸附。
- **復原／重做**：80 步，`Ctrl+Z` / `Ctrl+Y`。
- **存檔／讀取**：存成自含 HTML（雙擊即看，含所有分頁），可讀回 `.html` / `.json` 續編；瀏覽器自動暫存。舊版 v1 檔自動轉換。
- **複製圖**：目前分頁平面圖轉 PNG 複製到剪貼簿，直接貼 LINE／Discord。

## ⌨️ 快捷鍵

| 鍵 | 動作 |
|----|------|
| 方向鍵 | 微調選取物件（Shift = 1 cm 微調） |
| `R` | 旋轉家具 90° |
| `空白鍵`＋拖曳 / 中鍵拖曳 | 平移畫布 |
| 滾輪 | 縮放 |
| `Delete` / `Backspace` | 刪除選取 |
| `Ctrl+Z` / `Ctrl+Y` | 復原 / 重做 |
| `Esc` | 取消選取 |

## 🚀 使用

直接打開 `index.html`，或部署到 GitHub Pages 用網址使用。

線上體驗：`https://<your-account>.github.io/room-planner/`（部署後填入）

## 🛠 技術

純 vanilla JavaScript + SVG + CSS，無框架、無建置步驟、無相依套件。

```
index.html   結構、工具列、目錄、SVG 畫布
app.js       狀態、SVG 渲染、拖拉、畫牆、家具目錄、存讀、匯出
style.css    俯視平面圖風格
```

## 📄 授權

[MIT](LICENSE)
