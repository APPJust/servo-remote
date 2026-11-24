/*
 * ServoMQTT：用 MQTT 控制伺服馬達（搭配「伺服馬達遙控台」網頁的 MQTT Broker 模式）
 *
 * 開發板：ESP8266（Webduino Smart、NodeMCU、Wemos D1 mini）或 ESP32
 * 接線：伺服馬達 訊號（橘）→ GPIO5（Webduino Smart 上標示 05）
 *       伺服馬達 VCC（紅）→ 5V（Webduino Smart 的 VCC）
 *       伺服馬達 GND（棕）→ GND
 *
 * 需要的程式庫（Arduino IDE → 工具 → 管理程式庫）：
 *   - PubSubClient（作者 Nick O'Leary）
 *   - 只有 ESP32 需要：ESP32Servo（作者 Kevin Harrington）
 *
 * MQTT 主題（Topic）
 *   TOPIC          網頁 → 開發板：角度 0–180（純文字，例如 "90"）
 *   TOPIC/state    開發板 → 網頁：目前實際角度
 *   TOPIC/online   開發板 → 網頁："1" 在線、"0" 離線（保留訊息＋遺囑 Last Will）
 *
 * 注意：Webduino Smart 燒錄這個程式後，原本的 Webduino 韌體會被覆蓋；
 *       想回到 Blockly／Device ID 的用法，需要重新燒回 Webduino 韌體。
 */
#if defined(ESP32)
  #include <WiFi.h>
  #include <ESP32Servo.h>
#else
  #include <ESP8266WiFi.h>
  #include <Servo.h>
#endif
#include <PubSubClient.h>

// ═══════════ 請改成你的設定 ═══════════
const char* WIFI_SSID = "你的WiFi名稱";
const char* WIFI_PASS = "你的WiFi密碼";
const char* MQTT_HOST = "broker.emqx.io";        // 與網頁選的 Broker 同一台（網頁走 wss，開發板走 1883）
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "";                       // 公開 Broker 留空白
const char* MQTT_PASS = "";
const char* TOPIC     = "classroom/servo/abcd";   // 要和網頁上的 Topic 一字不差
const int   SERVO_PIN = 5;                        // Webduino Smart 的 05 腳 = GPIO5
// ═══════════════════════════════════════

WiFiClient net;
PubSubClient mqtt(net);
Servo servo;

String topicCmd, topicState, topicOnline;
int currentAngle = 90;
int lastReported = -1;
unsigned long lastReportMs = 0;

uint32_t chipId() {
#if defined(ESP32)
  return (uint32_t)ESP.getEfuseMac();
#else
  return ESP.getChipId();
#endif
}

// 收到網頁送來的角度
void onMessage(char* topic, byte* payload, unsigned int length) {
  char buf[16];
  unsigned int n = length < sizeof(buf) - 1 ? length : sizeof(buf) - 1;
  memcpy(buf, payload, n);
  buf[n] = '\0';

  char* end;
  long value = strtol(buf, &end, 10);
  if (end == buf) {                       // 不是數字就忽略
    Serial.printf("忽略非數字訊息：%s\n", buf);
    return;
  }
  int angle = constrain((int)value, 0, 180);
  if (angle != currentAngle) {
    currentAngle = angle;
    servo.write(angle);
  }
  Serial.printf("收到 %s → %d°\n", topic, angle);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("連線 Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.print(" 完成，IP = ");
  Serial.println(WiFi.localIP());
}

void connectMQTT() {
  while (!mqtt.connected()) {
    String clientId = "servo-board-" + String(chipId(), HEX);
    Serial.printf("連線 MQTT %s:%u（%s）… ", MQTT_HOST, MQTT_PORT, clientId.c_str());
    const char* user = strlen(MQTT_USER) ? MQTT_USER : NULL;
    const char* pass = strlen(MQTT_PASS) ? MQTT_PASS : NULL;
    // 遺囑（Last Will）：開發板意外斷線時，Broker 會自動幫它發布 "0"
    if (mqtt.connect(clientId.c_str(), user, pass, topicOnline.c_str(), 0, true, "0")) {
      Serial.println("成功");
      mqtt.publish(topicOnline.c_str(), "1", true);   // 保留訊息：之後才連上的網頁也看得到
      mqtt.subscribe(topicCmd.c_str());
      lastReported = -1;                               // 連上後回報一次目前角度
    } else {
      Serial.printf("失敗 rc=%d，2 秒後重試\n", mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);
  topicCmd = TOPIC;
  topicState = topicCmd + "/state";
  topicOnline = topicCmd + "/online";

#if defined(ESP32)
  servo.setPeriodHertz(50);
  servo.attach(SERVO_PIN, 500, 2400);
#else
  servo.attach(SERVO_PIN, 544, 2400);
#endif
  servo.write(currentAngle);

  connectWiFi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setKeepAlive(30);
  connectMQTT();
}

void loop() {
  connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  // 角度有變化時回報給網頁（最多每 100 ms 一次，避免訊息太多）
  unsigned long nowMs = millis();
  if (currentAngle != lastReported && nowMs - lastReportMs >= 100) {
    char msg[8];
    snprintf(msg, sizeof(msg), "%d", currentAngle);
    mqtt.publish(topicState.c_str(), msg);
    lastReported = currentAngle;
    lastReportMs = nowMs;
  }
}
