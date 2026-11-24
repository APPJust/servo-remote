# 伺服馬達遙控台（Servo Remote）

用手機的**觸控、陀螺儀、加速度計、磁力計、麥克風、語音、相機**控制開發板上的伺服馬達（SG90）。
原本的 Webduino Blockly 預覽程式改成獨立網頁，iPhone 與 Android 都能用。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` | 網頁畫面與樣式 |
| `app.js` | 所有功能：輸出引擎、三種連線方式、13 種控制模式 |
| `firmware/ServoMQTT/ServoMQTT.ino` | 「MQTT Broker」模式用的開發板程式（ESP8266／ESP32） |

## 連線方式（Webduino 與 MQTT 可以同時開啟）

| 方式 | 開發板需要 | 訊息路徑 |
|---|---|---|
| **Webduino 雲端** | Webduino Smart 原廠韌體＋Device ID（預設 `YdrMW`，和 Blockly 相同） | 手機 → `wss://ws.webduino.io`（Webduino 的 MQTT Broker）→ 開發板 |
| **MQTT Broker** | 燒錄 `firmware/ServoMQTT`，改 Wi-Fi 與 Topic | 手機 publish `Topic` → Broker → 開發板 subscribe |
| **模擬** | 不需要（兩種都沒開時自動使用） | 畫面上的 SG90 依真實轉速（約 0.1 秒／60°）模擬 |

連線面板裡 Webduino 和 MQTT 各有自己的「連線」按鈕，兩個都開啟時，每個角度會同時送到 Webduino 開發板和 MQTT Topic（例如一塊板子用 Device ID、另一塊用 MQTT，兩個伺服馬達一起轉）。

分享網址格式：`?conn=webduino,mqtt&device=YdrMW&pin=5&broker=wss://mqtt1.webduino.io/mqtt&topic=30-06`（`conn` 可以只寫其中一個，或寫 `sim`）。

MQTT 模式的 Topic 設計（可當上課範例）：

| Topic | 方向 | 內容 |
|---|---|---|
| `30-06` | 手機 → 開發板 | 角度 `0`–`180`（純文字） |
| `30-06/state` | 開發板 → 手機 | 實際角度回報，網頁上的伺服馬達會跟著回報值轉 |
| `30-06/online` | 開發板 → 手機 | `1` 在線／`0` 離線（保留訊息＋遺囑 Last Will） |

預設 Broker 是 Webduino 的 `wss://mqtt1.webduino.io/mqtt`、預設 Topic 是 `30-06`（連線面板也可以改選 EMQX、HiveMQ、Mosquitto）。網頁走 WebSocket（`wss://mqtt1.webduino.io/mqtt`），開發板走 TCP（`mqtt1.webduino.io:1883`），兩邊連的是同一台 Broker。

## 13 種控制方式

| 分類 | 模式 | 用到的感測器／Web API | iPhone | Android |
|---|---|---|---|---|
| 觸控 | 滑桿 | `<input type="range">` | ✓ | ✓ |
| 觸控 | 旋鈕 | Pointer Events（轉 270° = 伺服 180°，有精細模式） | ✓ | ✓ |
| 觸控 | 搖桿 | Pointer Events（**速度控制**：推越遠轉越快、放手停住） | ✓ | ✓ |
| 觸控 | 快捷 | 常用角度、我的最愛、6 種動作序列（揮手、點頭、敲門、雨刷、掃描、跳舞） | ✓ | ✓ |
| 動作感測 | 傾斜 | DeviceOrientation β／γ（陀螺儀） | ✓ 需按「允許」 | ✓ |
| 動作感測 | 方向盤 | DeviceMotion 重力向量，`atan2(x, y)` | ✓ 需按「允許」 | ✓ |
| 動作感測 | 指南針 | DeviceOrientation α／`webkitCompassHeading`（磁力計） | ✓ 需按「允許」 | ✓ |
| 動作感測 | 搖一搖 | DeviceMotion 加速度（力道→角度，或搖一下→揮手） | ✓ 需按「允許」 | ✓ |
| 聲音與影像 | 聲音 | Web Audio + 麥克風（音量→角度，或拍手切換兩個角度） | ✓ | ✓ |
| 聲音與影像 | 語音 | Web Speech API（「九十度」「往右三十度」「跳舞」…） | ✓ Safari，需開啟「聽寫」 | ✓ Chrome |
| 聲音與影像 | 相機 | getUserMedia + Canvas（顏色追蹤，或光線亮度） | ✓ | ✓ |
| 自動化 | 自動擺動 | 正弦／三角／方波／隨機波形產生器 | ✓ | ✓ |
| 自動化 | 錄製重播 | 把任何模式的動作錄下來，重播、循環、0.5×–4× | ✓ | ✓ |

共通功能：輸出鎖定、角度上下限、反轉方向、感測器平滑、每秒送出上限、即時波形、通訊紀錄（看得到每一則 PUBLISH）、震動回饋（Android）、螢幕常亮、深淺色主題、QR Code 分享連線設定。

## 放上網路（一定要 HTTPS）

手機的動作感測器、麥克風、相機**只能在 HTTPS 網頁使用**，所以要把 `servo-remote` 資料夾放到 HTTPS 網站，例如 GitHub Pages：

1. 在 GitHub 建一個 repository，把 `index.html`、`app.js` 上傳（`firmware` 可一起放）。
2. Settings → Pages → Branch 選 `main`、資料夾 `/ (root)` → Save。
3. 約一分鐘後用 `https://<帳號>.github.io/<repo>/` 開啟。

本機測試：

```powershell
python -m http.server 8766 --directory servo-remote
```

電腦瀏覽器開 `http://localhost:8766` 可以測觸控、連線、自動擺動等功能；手機感測器要用上面的 HTTPS 網址。

## 上課使用建議

- 預設 Topic 都是 `30-06`。**每位同學請改成自己的 Topic**（連線面板的骰子按鈕會隨機產生），開發板程式的 `TOPIC` 也要改成一樣，公開 Broker 上大家才不會互相控制。
- 老師在電腦上設定好連線 → 按「分享」→ 學生用手機掃 QR Code，就會自動套用同樣的連線與控制模式。
- iPhone 第一次用動作感測器要按「允許使用感測器」；如果按過「不允許」，要關閉分頁重新開啟。
- 用傾斜、方向盤時，建議先開啟手機的「螢幕方向鎖定」。
- 打開「通訊紀錄」可以讓學生看到每一則 MQTT 訊息（Topic、Payload、QoS），對照課程內容。

## 第三方函式庫（執行時才從 CDN 載入）

- webduino-js 0.7.0：`https://cdn.jsdelivr.net/npm/webduino-js@0.7.0/dist/webduino-all.min.js`（只在選 Webduino 雲端時載入）
- MQTT.js 5.10.1：`https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js`（只在選 MQTT Broker 時載入）
- qrcode-generator 1.4.4：`https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js`（只在按「分享」時載入）
