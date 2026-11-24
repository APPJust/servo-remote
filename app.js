/*!
 * 伺服馬達遙控台 Servo Remote
 * 用手機的觸控、動作感測器、麥克風、語音、相機控制開發板上的伺服馬達。
 * 連線方式：Webduino 雲端（Device ID）／MQTT Broker（WebSocket）／模擬。
 *
 * 程式結構
 *   1. 常數與小工具          5. 連線驅動（模擬／Webduino／MQTT）
 *   2. 設定、紀錄、提示      6. 動作感測器中心（Motion）
 *   3. 輸出引擎（目標角度 → 平滑 → 限速送出）  7. 13 種控制模式
 *   4. 動作序列、錄製        8. 介面組裝（儀表、面板、設定、分享）
 */
(function () {
  'use strict';

  /* ═════════════════════ 1. 常數與小工具 ═════════════════════ */
  const WEBDUINO_JS = 'https://cdn.jsdelivr.net/npm/webduino-js@0.7.0/dist/webduino-all.min.js'; // 與 webduino.io 版相同 API（Paho MQTT、wss://ws.webduino.io）
  const MQTT_JS = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
  const QR_JS = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const BROKERS = [ // 第一個是預設
    { name: 'Webduino', url: 'wss://mqtt1.webduino.io/mqtt' },
    { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
    { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { name: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt' }
  ];
  const PINS = [5, 4, 0, 2, 14, 12, 13, 15, 16];
  const SERVO_SPEED = 600; // °/s，SG90 約 0.1 秒轉 60°

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mapTo = (v, a0, a1, b0, b1) => b0 + clamp((v - a0) / ((a1 - a0) || 1e-9), 0, 1) * (b1 - b0);
  const wrap180 = d => ((((d + 180) % 360) + 360) % 360) - 180;
  const now = () => performance.now();
  const easeIO = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const randId = n => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
  const fmtDeg = v => Math.round(v) + '°';
  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('servo-remote:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('servo-remote:' + k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ } },
    clear() { try { Object.keys(localStorage).filter(k => k.indexOf('servo-remote:') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ } }
  };

  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { delete scriptCache[src]; reject(new Error('無法載入函式庫：' + src.split('/')[2])); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }

  /* ── 圖示（線條風格，24×24） ── */
  const ICONS = {
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    knob: '<circle cx="12" cy="13" r="7"/><path d="M12 13l3.2-3.2"/><path d="M4.2 6.2l1.3 1.3M19.8 6.2l-1.3 1.3M12 2.5V4"/>',
    joystick: '<rect x="4" y="15" width="16" height="6" rx="2.5"/><path d="M12 15V9"/><circle cx="12" cy="6" r="3"/><path d="M7 18h.01M17 18h.01"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
    tilt: '<rect x="7.5" y="3" width="9" height="17" rx="2" transform="rotate(-16 12 11.5)"/><path d="M3.5 20.5a10 10 0 0 1 2.2-5.6M20.5 3.5a10 10 0 0 1-2 5.4"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/><path d="M3.4 10.4l6.3 1M14.3 11.4l6.3-1M12 14.4V21"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z"/>',
    shake: '<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4.5 8.5v7M2 10.5v3M19.5 8.5v7M22 10.5v3"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    voice: '<path d="M3 12h1.5M7 8.5v7M11 5v14M15 8v8M19 10.5v3"/>',
    camera: '<path d="M4 7.5h3l1.8-2.5h6.4L17 7.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    wave: '<path d="M2 12c2.2-6 4.6-6 7 0s4.8 6 7 0 3.6-4.6 6-2"/>',
    rec: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8"/>',
    center: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h3v3h-3zM20.5 14v.01M14 20.5h.01M17.5 20.5h3v-3"/>',
    play: '<path d="M7.5 4.8v14.4L19 12z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    repeat: '<path d="M17 2.5l3 3-3 3"/><path d="M4 11V9a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 13v2a3.5 3.5 0 0 1-3.5 3.5H4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
    alert: '<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2v.01"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
    broker: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    hand: '<path d="M7 11.5V6.2a1.6 1.6 0 0 1 3.2 0V11M10.2 10.5V4.6a1.6 1.6 0 0 1 3.2 0v5.9M13.4 10.5V5.8a1.6 1.6 0 0 1 3.2 0V12M16.6 9.5a1.6 1.6 0 0 1 3.2 0v4.3A7.2 7.2 0 0 1 12.6 21h-.9a6.4 6.4 0 0 1-5.3-2.8L3.6 14a1.6 1.6 0 0 1 2.6-1.9L7 13.2"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6.4-6.4"/>',
    music: '<path d="M9 18V5.5l11-2.2v12.5"/><circle cx="6.2" cy="18" r="2.8"/><circle cx="17.2" cy="15.8" r="2.8"/>',
    knock: '<path d="M5 10h9a3 3 0 0 1 0 6H8a3 3 0 0 1-3-3z"/><path d="M8 10V7a1.5 1.5 0 0 1 3 0v3M11 10V6.5a1.5 1.5 0 0 1 3 0V10"/><path d="M19 7l2-2M19.5 11H22M19 15l2 2"/>',
    nod: '<path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20.5h14"/>',
    dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    flip: '<path d="M20 7h-3l-1.8-2.5H8.8L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><path d="M8.8 13a3.2 3.2 0 0 1 5.6-2.1M15.2 13a3.2 3.2 0 0 1-5.6 2.1M14.6 9.2v1.9h-1.9M9.4 16.8v-1.9h1.9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  const icon = (n, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
  function hydrateIcons(root) { $$('i[data-icon]', root).forEach(i => { const s = h(icon(i.dataset.icon, i.className)); i.replaceWith(s); }); }

  /* ═════════════════════ 2. 設定、紀錄、提示 ═════════════════════ */
  const DEFAULT_CFG = { min: 0, max: 180, invert: false, smooth: 0.35, rate: 15, haptics: true, wake: true, theme: 'auto' };
  const cfg = Object.assign({}, DEFAULT_CFG, store.get('cfg', {}));
  const saveCfg = () => store.set('cfg', cfg);

  function applyTheme() {
    if (cfg.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', cfg.theme);
    readColors();
  }
  const COLORS = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    ['--accent', '--accent-2', '--blue', '--line', '--line-2', '--dim', '--faint', '--ok', '--warn', '--err', '--text', '--panel', '--panel-2', '--track'].forEach(k => { COLORS[k] = cs.getPropertyValue(k).trim(); });
  }

  function haptic(ms) {
    if (!cfg.haptics || !navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // 使用者還沒點過畫面時瀏覽器會擋
    try { navigator.vibrate(ms || 8); } catch (e) { /* ignore */ }
  }

  let toastTimer = 0;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg; t.dataset.kind = kind || 'info'; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  const logBuf = []; let logDirty = true, logPaused = false;
  function log(dir, main, detail) {
    logBuf.unshift({ t: new Date(), dir, main: String(main), detail: detail == null ? '' : String(detail) });
    if (logBuf.length > 200) logBuf.length = 200;
    logDirty = true;
  }

  /* ═════════════════════ 3. 輸出引擎 ═════════════════════ */
  // target：控制模式想要的角度；out：平滑後的輸出；visual：畫面上模擬的伺服馬達實際位置
  const E = {
    target: 90, out: 90, visual: 90,
    lastSent: null, lastSendAt: 0, sent: 0, sendTimes: [],
    source: '待命', locked: false, atLimit: false,
    reported: null, reportedAt: 0,
    hist: [], histAt: 0
  };
  function setTarget(a, opt) {
    opt = opt || {};
    if (!isFinite(a)) return;
    if (opt.user) Seq.stop();
    E.target = clamp(a, cfg.min, cfg.max);
    if (opt.source) E.source = opt.source;
  }

  function sendIfNeeded(t) {
    if (E.locked || Conn.state !== 'online' || !Conn.driver) return;
    const v = Math.round(E.out);
    if (v === E.lastSent) return;
    if (t - E.lastSendAt < 1000 / cfg.rate) return;
    const p = cfg.invert ? 180 - v : v;
    let ok = false;
    try { ok = Conn.driver.send(p) !== false; } catch (e) { log('err', '送出失敗', e.message); }
    if (!ok) return;
    E.lastSent = v; E.lastSendAt = t; E.sent++; E.sendTimes.push(t);
    const d = Conn.driver.describe(p);
    log('out', d[0], d[1]);
    const atLim = v <= cfg.min || v >= cfg.max;
    if (atLim && !E.atLimit) haptic(18);
    E.atLimit = atLim;
  }

  /* ═════════════════════ 4. 動作序列與錄製 ═════════════════════ */
  const Seq = {
    frames: null, t0: 0, from: 90, loop: false, onEnd: null,
    get active() { return !!this.frames; },
    play(name, frames, opt) {
      opt = opt || {};
      this.stop();
      this.frames = frames; this.t0 = now(); this.from = E.out; this.loop = !!opt.loop; this.onEnd = opt.onEnd || null;
      E.source = name;
    },
    stop() {
      if (!this.frames) return;
      this.frames = null; const cb = this.onEnd; this.onEnd = null; if (cb) cb(true);
    },
    tick(t) {
      if (!this.frames) return;
      let el = t - this.t0, prev = this.from;
      for (const f of this.frames) {
        if (el < f[1]) { E.target = clamp(lerp(prev, f[0], easeIO(el / f[1])), cfg.min, cfg.max); return; }
        el -= f[1]; prev = f[0];
      }
      E.target = clamp(prev, cfg.min, cfg.max);
      if (this.loop) { this.t0 = t; this.from = prev; return; }
      this.frames = null; const cb = this.onEnd; this.onEnd = null; if (cb) cb(false);
    }
  };

  const ACTIONS = [
    { id: 'wave', name: '揮手', icon: 'hand', frames: () => [[55, 260], [125, 300], [55, 300], [125, 300], [90, 260]] },
    { id: 'nod', name: '點頭', icon: 'nod', frames: () => [[110, 160], [80, 180], [110, 180], [80, 180], [90, 160]] },
    { id: 'knock', name: '敲門', icon: 'knock', frames: () => { const b = clamp(E.out, cfg.min, Math.max(cfg.min, cfg.max - 30)); return [[b, 60], [b + 30, 110], [b, 100], [b + 30, 110], [b, 100], [b, 280], [b + 30, 110], [b, 120]]; } },
    { id: 'wiper', name: '雨刷', icon: 'wave', frames: () => [[25, 650], [155, 900], [25, 900], [155, 900], [90, 600]] },
    { id: 'scan', name: '全幅掃描', icon: 'radar', frames: () => [[0, 900], [180, 1800], [90, 900]] },
    { id: 'dance', name: '跳舞', icon: 'music', frames: () => [[45, 280], [135, 280], [70, 180], [110, 180], [70, 180], [110, 180], [20, 380], [160, 520], [90, 380]] }
  ];
  const actionById = id => ACTIONS.find(a => a.id === id);
  function runAction(id, onEnd) { const a = actionById(id); if (a) { Seq.play(a.name, a.frames(), { onEnd }); haptic(12); } }

  const clips = store.get('clips', []);
  const saveClips = () => store.set('clips', clips);
  const REC_DT = 50, REC_MAX = 60000;
  const Rec = {
    on: false, t0: 0, next: 0, samples: [],
    start() {
      if (this.on) return;
      this.on = true; this.t0 = now(); this.next = this.t0; this.samples = [];
      log('sys', '開始錄製動作'); renderRec(); haptic(20);
    },
    stop() {
      if (!this.on) return;
      this.on = false;
      if (this.samples.length >= 6) {
        const n = (store.get('clipSeq', 0) || 0) + 1; store.set('clipSeq', n);
        clips.unshift({ id: Date.now(), name: '片段 #' + n, at: Date.now(), dt: REC_DT, data: this.samples.slice() });
        if (clips.length > 8) clips.length = 8;
        saveClips();
        toast('已存成「片段 #' + n + '」，到「錄製重播」播放', 'ok');
        log('sys', '錄製完成', (this.samples.length * REC_DT / 1000).toFixed(1) + ' 秒');
      } else toast('錄製時間太短，沒有儲存', 'warn');
      this.samples = []; renderRec(); haptic(20);
      if (RecordModeHook.refresh) RecordModeHook.refresh();
    },
    tick(t) {
      if (!this.on) return;
      while (t >= this.next) { this.samples.push(Math.round(E.out)); this.next += REC_DT; }
      if (t - this.t0 > REC_MAX) { this.stop(); toast('已達 60 秒上限，自動停止錄製', 'warn'); }
    }
  };
  const RecordModeHook = {};

  /* ═════════════════════ 5. 連線驅動 ═════════════════════ */
  const Conn = {
    kind: 'sim', state: 'offline', msg: '', driver: null, board: null,
    set(state, msg) {
      this.state = state; this.msg = msg || '';
      if (state === 'online') E.lastSent = null; // 連上後重送目前角度
      renderStatus(); syncConnSheet();
    },
    setBoard(v) { this.board = v; renderStatus(); }
  };

  function SimDriver() {
    return {
      kind: 'sim', short: '模擬模式',
      connect() { return Promise.resolve(); },
      send() { return true; },
      describe(a) { return ['模擬 servo.write(' + a + ')', '']; },
      disconnect() { }
    };
  }

  function WebduinoDriver(opts) {
    let board = null, servo = null, closed = false, retryTimer = 0, slowTimer = 0;
    function open() {
      if (closed) return;
      Conn.set('connecting', '連線到 Webduino 雲端（' + opts.device + '）…');
      log('sys', 'CONNECT wss://ws.webduino.io', 'Device ID ' + opts.device);
      let b;
      try {
        b = board = new window.webduino.board.Smart({ device: opts.device, transport: 'mqtt', multi: true });
      } catch (e) { fail(e.message); return; }
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => { if (b === board && !servo && !closed) Conn.set('connecting', '等待開發板回應…請確認板子已通電並連上 Wi-Fi'); }, 9000);
      b.once(window.webduino.BoardEvent.READY, () => {
        if (b !== board || closed) return;
        clearTimeout(slowTimer);
        try { servo = new window.webduino.module.Servo(b, b.getDigitalPin(opts.pin)); } catch (e) { fail('建立伺服馬達失敗：' + e.message); return; }
        Conn.board = true;
        Conn.set('online');
        log('in', '開發板就緒 READY', 'Servo 接在腳位 ' + opts.pin);
        toast('已連上開發板 ' + opts.device, 'ok');
      });
      b.on(window.webduino.BoardEvent.ERROR, err => {
        if (b !== board) return;
        log('err', '開發板連線錯誤', (err && err.message) || String(err));
        fail('連不到開發板（' + ((err && err.message) || '未知錯誤') + '）');
      });
      b.on(window.webduino.BoardEvent.DISCONNECT, () => {
        if (b !== board || closed) return;
        log('sys', '開發板已斷線');
        fail('開發板已斷線');
      });
    }
    function fail(msg) {
      if (closed) return;
      const old = board; board = null; servo = null; Conn.board = false;
      clearTimeout(slowTimer);
      if (old) { try { old.disconnect(); } catch (e) { /* ignore */ } }
      if (opts.autoReconnect) {
        Conn.set('connecting', msg + '，5 秒後重新連線…');
        clearTimeout(retryTimer); retryTimer = setTimeout(open, 5000);
      } else Conn.set('error', msg + '。請確認 Device ID 與開發板電源。');
    }
    return {
      kind: 'webduino', short: 'Webduino · ' + opts.device,
      async connect() {
        Conn.set('connecting', '載入 Webduino 函式庫…');
        await loadScript(WEBDUINO_JS);
        if (!window.webduino || !window.webduino.board || !window.webduino.board.Smart) throw new Error('Webduino 函式庫載入不完整');
        open();
      },
      send(a) { if (!servo) return false; servo.angle = a; return true; },
      describe(a) { return ['servo.angle = ' + a, opts.device + '/PING（Firmata）']; },
      disconnect() {
        closed = true; clearTimeout(retryTimer); clearTimeout(slowTimer);
        const b = board; board = null; servo = null;
        if (b) { try { b.disconnect(); } catch (e) { /* ignore */ } }
      }
    };
  }

  function MqttDriver(opts) {
    let client = null, closed = false, everConnected = false;
    const base = opts.topic.replace(/\/+$/, '');
    const clientId = 'servo-web-' + randId(8);
    let host = opts.broker; try { host = new URL(opts.broker).hostname; } catch (e) { /* ignore */ }
    return {
      kind: 'mqtt', short: 'MQTT · ' + host,
      async connect() {
        Conn.set('connecting', '載入 MQTT.js…');
        await loadScript(MQTT_JS);
        if (!window.mqtt || !window.mqtt.connect) throw new Error('MQTT.js 載入不完整');
        if (closed) return;
        Conn.set('connecting', '連線到 ' + opts.broker + ' …');
        log('sys', 'CONNECT ' + opts.broker, 'clientId ' + clientId);
        client = window.mqtt.connect(opts.broker, {
          clientId, clean: true, keepalive: 30, connectTimeout: 10000, reconnectPeriod: 3000, protocolVersion: 4,
          username: opts.user || undefined, password: opts.pass || undefined
        });
        client.on('connect', () => {
          everConnected = true;
          Conn.set('online');
          log('in', 'CONNACK 已連上 Broker');
          const subs = [base + '/state', base + '/online'];
          client.subscribe(subs, { qos: 0 }, err => {
            if (err) log('err', 'SUBSCRIBE 失敗', err.message);
            else log('sys', 'SUBSCRIBE ' + subs.join('、'));
          });
        });
        client.on('reconnect', () => { if (!closed) Conn.set('connecting', everConnected ? '重新連線中…' : '連線中…（若一直連不上，請檢查 Broker 網址）'); });
        client.on('offline', () => { if (!closed) Conn.set('connecting', '網路中斷，等待重新連線…'); });
        client.on('error', e => { if (closed) return; log('err', 'MQTT 錯誤', e && e.message); if (!everConnected) Conn.set('connecting', 'Broker 拒絕連線：' + (e && e.message)); });
        client.on('message', (topic, payload) => {
          const s = payload.toString().trim();
          if (topic === base + '/online') {
            const on = s === '1' || /^(on|online|true)$/i.test(s);
            Conn.setBoard(on);
            log('in', topic, s + (on ? '（開發板在線）' : '（開發板離線）'));
          } else if (topic === base + '/state') {
            const v = parseFloat(s);
            if (isFinite(v)) { E.reported = v; E.reportedAt = now(); }
            log('in', topic, s);
          }
        });
      },
      send(a) {
        if (!client || !client.connected) return false;
        client.publish(base, String(a), { qos: opts.qos ? 1 : 0, retain: !!opts.retain });
        return true;
      },
      describe(a) { return ['PUBLISH ' + base, String(a) + (opts.qos ? '（QoS 1）' : '')]; },
      disconnect() { closed = true; if (client) { try { client.end(true); } catch (e) { /* ignore */ } } client = null; }
    };
  }

  async function connect(kind, opts) {
    disconnect(true);
    const drv = kind === 'webduino' ? WebduinoDriver(opts) : kind === 'mqtt' ? MqttDriver(opts) : SimDriver();
    Conn.driver = drv; Conn.kind = kind; Conn.board = null; E.reported = null;
    try {
      await drv.connect();
      if (kind === 'sim' && Conn.driver === drv) { Conn.set('online'); log('sys', '模擬模式：不接開發板，只在畫面上模擬'); }
    } catch (e) {
      if (Conn.driver === drv) { Conn.set('error', e.message); log('err', e.message); toast(e.message, 'err'); }
    }
  }
  function disconnect(silent) {
    if (Conn.driver) { try { Conn.driver.disconnect(); } catch (e) { /* ignore */ } if (!silent) log('sys', '已中斷連線'); }
    Conn.driver = null; Conn.board = null; E.reported = null;
    Conn.set('offline');
  }

  /* ═════════════════════ 6. 動作感測器中心 ═════════════════════ */
  const Motion = {
    needsPermission: typeof window.DeviceOrientationEvent !== 'undefined' && typeof window.DeviceOrientationEvent.requestPermission === 'function',
    granted: false, started: false, absSeen: false,
    ori: { a: null, b: null, g: null, heading: null, t: 0 },
    grav: { x: 0, y: 0, z: 0, t: 0, init: false },
    lin: { mag: 0, peak: 0, t: 0 },
    hp: null,
    request() {
      // iOS 13+：必須在使用者點擊的當下呼叫
      if (!this.needsPermission) { this.granted = true; this.start(); return Promise.resolve(true); }
      let p1, p2;
      try { p1 = window.DeviceOrientationEvent.requestPermission(); } catch (e) { p1 = Promise.resolve('denied'); }
      try {
        p2 = (window.DeviceMotionEvent && typeof window.DeviceMotionEvent.requestPermission === 'function') ? window.DeviceMotionEvent.requestPermission() : Promise.resolve('granted');
      } catch (e) { p2 = Promise.resolve('denied'); }
      return Promise.all([p1, p2]).then(r => {
        this.granted = r[0] === 'granted' && r[1] === 'granted';
        if (this.granted) this.start();
        return this.granted;
      }).catch(() => false);
    },
    start() {
      if (this.started) return;
      this.started = true;
      window.addEventListener('deviceorientation', e => {
        if (e.alpha == null && e.beta == null && e.gamma == null) return;
        const o = this.ori;
        o.a = e.alpha; o.b = e.beta; o.g = e.gamma; o.t = now();
        if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) o.heading = e.webkitCompassHeading;
        else if (!this.absSeen && e.alpha != null) o.heading = (360 - e.alpha) % 360;
      });
      window.addEventListener('deviceorientationabsolute', e => {
        if (e.alpha == null) return;
        this.absSeen = true; this.ori.heading = (360 - e.alpha) % 360; this.ori.t = now();
      });
      window.addEventListener('devicemotion', e => {
        const t = now(), ag = e.accelerationIncludingGravity, a = e.acceleration;
        if (ag && ag.x != null) {
          const g = this.grav;
          if (!g.init) { g.x = ag.x; g.y = ag.y; g.z = ag.z; g.init = true; }
          g.x += (ag.x - g.x) * 0.3; g.y += (ag.y - g.y) * 0.3; g.z += (ag.z - g.z) * 0.3; g.t = t;
        }
        let lx, ly, lz;
        if (a && a.x != null) { lx = a.x; ly = a.y; lz = a.z; } else if (ag && ag.x != null) {
          const hp = this.hp || (this.hp = { x: ag.x, y: ag.y, z: ag.z });
          hp.x += (ag.x - hp.x) * 0.1; hp.y += (ag.y - hp.y) * 0.1; hp.z += (ag.z - hp.z) * 0.1;
          lx = ag.x - hp.x; ly = ag.y - hp.y; lz = ag.z - hp.z;
        } else return;
        const m = Math.sqrt(lx * lx + ly * ly + lz * lz);
        this.lin.mag = m; if (m > this.lin.peak) this.lin.peak = m; this.lin.t = t;
      });
    },
    hasData(kind) {
      const t = kind === 'mot' ? Math.max(this.grav.t, this.lin.t) : this.ori.t;
      return t > 0 && now() - t < 1500;
    }
  };
  if (!Motion.needsPermission) Motion.granted = true;

  // 感測器狀態提示（HTTPS、權限、沒資料…）
  function makeGate(kind) {
    const el = document.createElement('div');
    let state = '', lastCheck = 0, startedAt = 0;
    const T = {
      insecure: ['err', 'alert', '需要 HTTPS 才能讀取感測器', '請用 https:// 開頭的網址開啟這個網頁（例如 GitHub Pages）。'],
      unsupported: ['err', 'alert', '這個瀏覽器不支援動作感測器', '請改用手機的 Safari（iPhone）或 Chrome（Android）。'],
      permission: ['info', 'tilt', '需要你允許網頁使用動作感測器', 'iPhone／iPad 請按下按鈕，在跳出的視窗選「允許」。', '<button class="btn primary sm" type="button" data-act="grant">允許使用感測器</button>'],
      nodata: ['warn', 'info', '還沒收到感測器資料', '電腦通常沒有陀螺儀，請用手機開啟。iPhone 若曾按過「不允許」，請關閉分頁後重新開啟網頁。'],
      waiting: ['info', 'info', '等待感測器資料…', '']
    };
    function compute() {
      if (!window.isSecureContext) return 'insecure';
      const sup = kind === 'mot' ? ('DeviceMotionEvent' in window) : ('DeviceOrientationEvent' in window);
      if (!sup) return 'unsupported';
      if (Motion.hasData(kind)) return 'ok';
      // Android Chrome 不用按就有資料；iPhone 要先按「允許」才會有資料
      if (Motion.needsPermission && !Motion.granted) return now() - startedAt > 700 ? 'permission' : 'waiting';
      return now() - startedAt > 1600 ? 'nodata' : 'waiting';
    }
    function render(s) {
      state = s;
      const v = T[s];
      if (!v) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      el.innerHTML = '<div class="notice ' + v[0] + '">' + icon(v[1]) + '<div><b>' + v[2] + '</b>' + (v[3] ? '<p>' + v[3] + '</p>' : '') + '</div>' + (v[4] || '') + '</div>';
    }
    el.addEventListener('click', e => {
      if (!e.target.closest('[data-act="grant"]')) return;
      Motion.request().then(ok => { toast(ok ? '已允許使用感測器' : '沒有取得感測器權限，請關閉分頁後重新開啟再試一次', ok ? 'ok' : 'err'); startedAt = now(); update(true); });
    });
    function update(force) {
      const t = now();
      if (!force && t - lastCheck < 300) return state === 'ok';
      lastCheck = t;
      const s = compute();
      if (s !== state) render(s);
      return s === 'ok';
    }
    return {
      el, update,
      start() { startedAt = now(); Motion.start(); state = ''; update(true); }
    };
  }

  /* ═════════════════════ 7. 介面小元件 ═════════════════════ */
  function setRangeFill(inp) { const p = (inp.value - inp.min) / ((inp.max - inp.min) || 1) * 100; inp.style.setProperty('--p', p + '%'); }
  function rangeField(o) {
    const el = h('<label class="field"><span class="field-row"><span class="field-label">' + o.label + '</span><output class="field-val"></output></span><input type="range" class="rng" min="' + o.min + '" max="' + o.max + '" step="' + (o.step || 1) + '"></label>');
    const inp = $('input', el), out = $('output', el);
    const fmt = o.fmt || (v => v + (o.unit || ''));
    inp.value = o.value;
    const upd = () => { out.textContent = fmt(+inp.value); setRangeFill(inp); };
    inp.addEventListener('input', () => { upd(); if (o.onInput) o.onInput(+inp.value); });
    upd();
    el.set = v => { inp.value = v; upd(); };
    el.input = inp;
    return el;
  }
  function segControl(items, value, onChange) {
    const el = h('<div class="seg" role="radiogroup">' + items.map(it => '<button type="button" role="radio" data-v="' + it[0] + '">' + it[1] + '</button>').join('') + '</div>');
    const set = v => $$('button', el).forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === String(v))));
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); haptic(5); if (onChange) onChange(b.dataset.v); });
    set(value); el.set = set;
    return el;
  }
  function switchField(label, checked, onChange, desc) {
    const el = h('<label class="switch-row"><span><span class="field-label">' + label + '</span>' + (desc ? '<small>' + desc + '</small>' : '') + '</span><input type="checkbox" class="switch"></label>');
    const inp = $('input', el); inp.checked = !!checked;
    inp.addEventListener('change', () => onChange(inp.checked));
    return el;
  }
  function holdRepeat(btn, fn) {
    let t1 = 0, t2 = 0;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); fn(); t1 = setTimeout(() => { t2 = setInterval(fn, 70); }, 380); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }
  function slot(el, sel, node) { $(sel, el).replaceWith(node); return node; }
  function fitCanvas(c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, hh = c.clientHeight;
    if (!w || !hh) return null;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h: hh };
  }
  function miniDial(a) {
    const t = (180 - a) * Math.PI / 180, x = 20 + 15 * Math.cos(t), y = 21 - 15 * Math.sin(t);
    return '<svg viewBox="0 0 40 24" aria-hidden="true"><path class="md-arc" d="M3 21A17 17 0 0 1 37 21"/><line class="md-n" x1="20" y1="21" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '"/></svg>';
  }
  function plotSeries(g, data, w, hh, color, width, n) {
    if (data.length < 2) return;
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath();
    const total = n || data.length;
    data.forEach((v, i) => { const x = (i + (total - data.length)) / (total - 1) * w, y = hh - 3 - v / 180 * (hh - 6); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }

  /* ═════════════════════ 8. 控制模式 ═════════════════════ */
  const GROUPS = [['touch', '觸控'], ['sensor', '動作感測'], ['media', '聲音與影像'], ['auto', '自動化']];
  const MODES = [];
  const mode = def => { MODES.push(def); return def; };
  const hasSR = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasMedia = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /* ── 1 滑桿 ── */
  mode({
    id: 'slider', group: 'touch', name: '滑桿', icon: 'sliders', api: '<input type="range">',
    desc: '最直覺的方式：拖曳滑桿或按微調鍵，精準設定角度。',
    build(el) {
      let snap = store.get('slider.snap', 1);
      el.innerHTML =
        '<div class="big-slider"><input type="range" class="rng xl" min="0" max="180" step="1" aria-label="伺服馬達角度">' +
        '<div class="scale"><span>0°</span><span>45°</span><span>90°</span><span>135°</span><span>180°</span></div></div>' +
        '<div class="stepper"><button class="btn" type="button" data-d="-10">−10</button><button class="btn" type="button" data-d="-1">−1</button>' +
        '<label class="num-input"><input type="number" inputmode="numeric" min="0" max="180" aria-label="輸入角度"><span>°</span></label>' +
        '<button class="btn" type="button" data-d="1">+1</button><button class="btn" type="button" data-d="10">+10</button></div>' +
        '<div class="field"><span class="field-label">刻度對齊</span><i class="seg-slot"></i></div>' +
        '<p class="hint">小技巧：電腦上可以用鍵盤 ← → 微調（加 Shift 一次 10°）。</p>';
      const rng = $('input[type=range]', el), num = $('input[type=number]', el);
      let dragging = false;
      rng.step = snap;
      slot(el, '.seg-slot', segControl([['1', '1°'], ['5', '5°'], ['15', '15°']], snap, v => { snap = +v; rng.step = snap; store.set('slider.snap', snap); }));
      const apply = v => setTarget(Math.round(v / snap) * snap, { user: true, source: '滑桿' });
      rng.addEventListener('input', () => { setRangeFill(rng); apply(+rng.value); });
      rng.addEventListener('pointerdown', () => { dragging = true; });
      window.addEventListener('pointerup', () => { dragging = false; });
      num.addEventListener('change', () => { if (num.value !== '') apply(clamp(+num.value, 0, 180)); });
      num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
      $$('[data-d]', el).forEach(b => holdRepeat(b, () => { setTarget(E.target + (+b.dataset.d), { user: true, source: '微調' }); haptic(4); }));
      let shown = null;
      return {
        tick() {
          const v = Math.round(E.target);
          if (v === shown) return;
          shown = v;
          if (!dragging) { rng.value = v; setRangeFill(rng); }
          if (document.activeElement !== num) num.value = v;
        },
        activate() { shown = null; }
      };
    }
  });

  /* ── 2 旋鈕 ── */
  mode({
    id: 'knob', group: 'touch', name: '旋鈕', icon: 'knob', api: 'Pointer Events',
    desc: '像音響的音量鈕一樣，按住旋轉。每轉過 10° 手機會輕震一下。',
    build(el) {
      const C = 120;
      let fine = store.get('knob.fine', false);
      const ratio = () => (fine ? 4 : 1.5); // 旋鈕轉幾度 = 伺服 1°
      const P = (a, r) => { const ph = (-135 + a * 1.5) * Math.PI / 180; return [C + r * Math.sin(ph), C - r * Math.cos(ph)]; };
      const ring = (a0, a1, r) => { a1 = Math.max(a1, a0 + 0.01); const p0 = P(a0, r), p1 = P(a1, r); return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + ((a1 - a0) * 1.5 > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2); };
      let ticks = '';
      for (let i = 0; i <= 12; i++) { const a = i * 15, major = i % 2 === 0, p0 = P(a, major ? 88 : 91), p1 = P(a, 97); ticks += '<line class="k-tick' + (major ? ' major' : '') + '" x1="' + p0[0].toFixed(1) + '" y1="' + p0[1].toFixed(1) + '" x2="' + p1[0].toFixed(1) + '" y2="' + p1[1].toFixed(1) + '"/>'; }
      let knurl = '';
      for (let i = 0; i < 48; i++) { const ph = i * 7.5 * Math.PI / 180; knurl += '<line x1="' + (C + 66 * Math.sin(ph)).toFixed(1) + '" y1="' + (C - 66 * Math.cos(ph)).toFixed(1) + '" x2="' + (C + 73 * Math.sin(ph)).toFixed(1) + '" y2="' + (C - 73 * Math.cos(ph)).toFixed(1) + '"/>'; }
      el.innerHTML =
        '<div class="knob-wrap"><svg class="knob" viewBox="0 0 240 240" role="slider" tabindex="0" aria-label="旋鈕" aria-valuemin="0" aria-valuemax="180">' +
        '<defs><radialGradient id="kBody" cx="38%" cy="32%" r="78%"><stop offset="0" style="stop-color:var(--knob-hi)"/><stop offset="1" style="stop-color:var(--knob-lo)"/></radialGradient>' +
        '<linearGradient id="kProg" x1="0" x2="1"><stop offset="0" style="stop-color:var(--accent-2)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient></defs>' +
        '<path class="k-track" d="' + ring(0, 180, 107) + '"/><path class="k-prog" d=""/>' + ticks +
        '<circle class="k-shadow" cx="120" cy="126" r="72"/>' +
        '<g class="k-body"><circle cx="120" cy="120" r="74" fill="url(#kBody)" stroke="var(--line-2)"/><g class="k-knurl">' + knurl + '</g>' +
        '<circle class="k-face" cx="120" cy="120" r="60"/><circle class="k-dot" cx="120" cy="70" r="6"/></g>' +
        '<text class="k-cap" x="120" y="104" text-anchor="middle">ANGLE</text><text class="k-val" x="120" y="134" text-anchor="middle">90°</text>' +
        '<text class="glabel" x="' + P(0, 112)[0].toFixed(0) + '" y="' + (P(0, 112)[1] + 16).toFixed(0) + '" text-anchor="middle">0</text>' +
        '<text class="glabel" x="' + P(180, 112)[0].toFixed(0) + '" y="' + (P(180, 112)[1] + 16).toFixed(0) + '" text-anchor="middle">180</text>' +
        '</svg></div><i class="sw-slot"></i>';
      const svg = $('svg', el), body = $('.k-body', el), prog = $('.k-prog', el), val = $('.k-val', el);
      slot(el, '.sw-slot', switchField('精細模式', fine, v => { fine = v; store.set('knob.fine', v); }, '旋鈕要轉約兩圈才走完 0–180°，適合微調'));
      let value = E.target, last = null, dragging = false;
      const pAng = e => { const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 240 - C, y = (e.clientY - r.top) / r.height * 240 - C; return Math.atan2(x, -y) * 180 / Math.PI; };
      const commit = v => {
        const before = Math.floor(value / 10);
        value = clamp(v, cfg.min, cfg.max);
        if (Math.floor(value / 10) !== before) haptic(4);
        setTarget(value, { user: true, source: '旋鈕' });
      };
      svg.addEventListener('pointerdown', e => { dragging = true; last = pAng(e); value = E.target; try { svg.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
      svg.addEventListener('pointermove', e => { if (!dragging) return; const a = pAng(e); const d = wrap180(a - last); last = a; commit(value + d / ratio()); });
      const end = () => { dragging = false; };
      svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
      svg.addEventListener('wheel', e => { e.preventDefault(); value = E.target; commit(value + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
      svg.addEventListener('keydown', e => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (d) { e.preventDefault(); e.stopPropagation(); value = E.target; commit(value + d * (e.shiftKey ? 10 : 1)); }
      });
      let shown = null;
      return {
        tick() {
          if (!dragging) value = E.target;
          const v = Math.round(E.target * 2) / 2;
          if (v === shown) return;
          shown = v;
          body.setAttribute('transform', 'rotate(' + (-135 + E.target * 1.5).toFixed(2) + ' 120 120)');
          prog.setAttribute('d', ring(0, E.target, 107));
          val.textContent = Math.round(E.target) + '°';
          svg.setAttribute('aria-valuenow', Math.round(E.target));
        },
        activate() { shown = null; }
      };
    }
  });

  /* ── 3 搖桿（速度控制） ── */
  mode({
    id: 'jog', group: 'touch', name: '搖桿', icon: 'joystick', api: 'Pointer Events · 速度控制',
    desc: '推得越遠轉得越快、放手就停住。和滑桿「指定位置」不同，這是「控制速度」。',
    build(el) {
      let maxSpeed = store.get('jog.max', 150);
      el.innerHTML =
        '<div class="jog" aria-label="速度搖桿"><div class="jog-fill"></div><div class="jog-mid"></div><span class="jog-arrow l">‹‹</span><span class="jog-arrow r">››</span><div class="jog-thumb"></div></div>' +
        '<div class="viz-row"><div class="ro"><span>轉動速度</span><b class="spd">0°/s</b></div><div class="ro"><span>目前角度</span><b class="cur">90°</b></div></div>' +
        '<i class="max-slot"></i>' +
        '<p class="hint">速度和推動距離是平方關係：輕推慢慢轉、推到底快速轉。到達極限角度時手機會震動。</p>';
      const jog = $('.jog', el), thumb = $('.jog-thumb', el), fill = $('.jog-fill', el), spd = $('.spd', el), cur = $('.cur', el);
      slot(el, '.max-slot', rangeField({ label: '最高速度', min: 30, max: 360, step: 10, value: maxSpeed, unit: '°/s', onInput: v => { maxSpeed = v; store.set('jog.max', v); } }));
      let d = 0, active = false, x0 = 0;
      const travel = () => (jog.clientWidth - thumb.clientWidth) / 2 - 6;
      const setD = v => {
        d = clamp(v, -1, 1);
        thumb.style.transform = 'translateX(' + (d * travel()).toFixed(1) + 'px)';
        const w = Math.abs(d) * 50;
        fill.style.width = w + '%'; fill.style.left = (d < 0 ? 50 - w : 50) + '%';
      };
      jog.addEventListener('pointerdown', e => {
        active = true; jog.classList.add('drag');
        const r = jog.getBoundingClientRect(); x0 = r.left + r.width / 2;
        setD((e.clientX - x0) / travel());
        try { jog.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
        Seq.stop(); haptic(6);
      });
      jog.addEventListener('pointermove', e => { if (active) setD((e.clientX - x0) / travel()); });
      const end = () => { if (!active) return; active = false; jog.classList.remove('drag'); setD(0); };
      jog.addEventListener('pointerup', end); jog.addEventListener('pointercancel', end);
      return {
        tick(t, dt) {
          const s = Math.sign(d) * d * d * maxSpeed;
          if (Math.abs(s) > 0.5) setTarget(E.target + s * dt, { source: '搖桿' });
          spd.textContent = signed(s) + '°/s';
          cur.textContent = fmtDeg(E.target);
        },
        deactivate: end
      };
    }
  });

  /* ── 4 快捷角度與動作 ── */
  mode({
    id: 'presets', group: 'touch', name: '快捷', icon: 'grid', api: 'Vibration API · 動作序列',
    desc: '一鍵轉到常用角度，或播放預先寫好的動作（揮手、雨刷、跳舞…）。',
    build(el) {
      let favs = store.get('favs', [30, 60, 120, 150]), editing = false;
      el.innerHTML =
        '<div class="sub-h">常用角度</div><div class="preset-grid">' + [0, 45, 90, 135, 180].map(a => '<button class="preset" type="button" data-a="' + a + '">' + miniDial(a) + a + '°</button>').join('') + '</div>' +
        '<div class="sub-h">我的最愛 <button class="link-btn" type="button" data-act="edit">編輯</button></div><div class="fav-grid"></div>' +
        '<div class="sub-h">動作序列</div><div class="action-grid">' + ACTIONS.map(a => '<button class="action" type="button" data-id="' + a.id + '">' + icon(a.icon) + a.name + '</button>').join('') + '</div>' +
        '<p class="hint">動作序列就是一連串「角度＋時間」的關鍵影格，和 Blockly 裡「設定角度 → 等待」的積木是同一個概念。</p>';
      const favGrid = $('.fav-grid', el);
      const renderFavs = () => {
        favGrid.innerHTML = favs.map((a, i) => '<button class="fav" type="button" data-a="' + a + '">' + a + '°<span class="del" data-i="' + i + '" aria-label="刪除">×</span></button>').join('') +
          (favs.length < 10 ? '<button class="fav add" type="button" data-act="add">＋ 目前角度</button>' : '');
        favGrid.classList.toggle('editing', editing);
      };
      renderFavs();
      el.addEventListener('click', e => {
        const del = e.target.closest('.del');
        if (del && editing) { favs.splice(+del.dataset.i, 1); store.set('favs', favs); renderFavs(); return; }
        const p = e.target.closest('[data-a]');
        if (p) { setTarget(+p.dataset.a, { user: true, source: p.classList.contains('fav') ? '我的最愛' : '快捷角度' }); haptic(10); return; }
        const act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'add') {
          const a = Math.round(E.target);
          if (favs.indexOf(a) >= 0) toast(a + '° 已經在最愛裡了', 'warn'); else { favs.push(a); favs.sort((x, y) => x - y); store.set('favs', favs); renderFavs(); toast('已加入 ' + a + '°', 'ok'); }
          return;
        }
        if (act && act.dataset.act === 'edit') { editing = !editing; act.textContent = editing ? '完成' : '編輯'; renderFavs(); return; }
        const ab = e.target.closest('.action');
        if (ab) {
          if (ab.classList.contains('playing')) { Seq.stop(); return; }
          $$('.action', el).forEach(b => b.classList.remove('playing'));
          ab.classList.add('playing');
          runAction(ab.dataset.id, () => ab.classList.remove('playing'));
        }
      });
      let shown = null;
      return {
        tick() {
          const v = Math.round(E.target);
          if (v === shown) return;
          shown = v;
          $$('.preset', el).forEach(b => b.classList.toggle('on', +b.dataset.a === v));
        },
        deactivate() { $$('.action', el).forEach(b => b.classList.remove('playing')); }
      };
    }
  });

  /* ── 5 傾斜 ── */
  mode({
    id: 'tilt', group: 'sensor', name: '傾斜', icon: 'tilt', api: 'DeviceOrientationEvent（β／γ）', smooth: true,
    supported: () => 'DeviceOrientationEvent' in window,
    desc: '手機往左右（或前後）傾斜，伺服馬達跟著轉。開啟時的姿勢會被當成 90°。',
    build(el) {
      let axis = store.get('tilt.axis', 'g'), span = store.get('tilt.span', 40), zero = null;
      const gate = makeGate('ori');
      el.innerHTML =
        '<i class="gate-slot"></i>' +
        '<div class="viz-row"><div class="phone3d"><div class="phone"><div class="phone-screen"><span class="phone-ring"></span><span class="bubble"></span></div></div></div>' +
        '<div class="readouts"><div class="ro" data-k="a"><span>α 水平旋轉</span><b>—</b></div><div class="ro" data-k="b"><span>β 前後傾斜</span><b>—</b></div><div class="ro" data-k="g"><span>γ 左右傾斜</span><b>—</b></div><div class="ro hl"><span>相對 90° 姿勢</span><b class="rel">—</b></div></div></div>' +
        '<div class="field"><span class="field-label">使用哪個軸</span><i class="axis-slot"></i></div><i class="span-slot"></i>' +
        '<button class="btn block" type="button" data-act="cal">' + icon('center') + '校正：目前姿勢 ＝ 90°</button>' +
        '<p class="hint">建議先打開手機的「螢幕方向鎖定」，畫面就不會在傾斜時跟著轉向。</p>';
      slot(el, '.gate-slot', gate.el);
      const phone = $('.phone', el), bubble = $('.bubble', el), relEl = $('.rel', el);
      const ro = k => $('.ro[data-k="' + k + '"]', el);
      const hl = () => { ro('b').classList.toggle('hl', axis === 'b'); ro('g').classList.toggle('hl', axis === 'g'); };
      slot(el, '.axis-slot', segControl([['g', '左右傾斜 γ'], ['b', '前後傾斜 β']], axis, v => { axis = v; store.set('tilt.axis', v); zero = null; hl(); }));
      slot(el, '.span-slot', rangeField({ label: '傾斜多少度轉到底', min: 15, max: 90, step: 5, value: span, fmt: v => '±' + v + '°', onInput: v => { span = v; store.set('tilt.span', v); } }));
      hl();
      const calibrate = () => { const o = Motion.ori; if (o.b == null) { toast('還沒有感測器資料', 'warn'); return; } zero = { b: o.b, g: o.g }; haptic(15); toast('已把目前姿勢設為 90°', 'ok'); };
      $('[data-act="cal"]', el).addEventListener('click', calibrate);
      return {
        recenter: calibrate,
        activate() { gate.start(); zero = null; },
        tick() {
          if (!gate.update()) return;
          const o = Motion.ori;
          if (o.b == null) return;
          if (!zero) zero = { b: o.b, g: o.g };
          const rel = axis === 'g' ? o.g - zero.g : wrap180(o.b - zero.b);
          setTarget(90 + rel * 90 / span, { source: '傾斜' });
          $('b', ro('a')).textContent = o.a == null ? '—' : o.a.toFixed(0) + '°';
          $('b', ro('b')).textContent = o.b.toFixed(1) + '°';
          $('b', ro('g')).textContent = o.g.toFixed(1) + '°';
          relEl.textContent = signed(rel) + '°';
          phone.style.transform = 'rotateX(' + clamp(-o.b * 0.8, -70, 70).toFixed(1) + 'deg) rotateY(' + clamp(o.g * 0.9, -70, 70).toFixed(1) + 'deg)';
          bubble.style.transform = 'translate(' + clamp(-o.g * 0.7, -26, 26).toFixed(1) + 'px,' + clamp(-o.b * 0.7, -52, 52).toFixed(1) + 'px)';
        }
      };
    }
  });

  /* ── 6 方向盤 ── */
  mode({
    id: 'wheel', group: 'sensor', name: '方向盤', icon: 'wheel', api: 'DeviceMotionEvent（重力向量）', smooth: true,
    supported: () => 'DeviceMotionEvent' in window,
    desc: '手機直立握在面前，像轉方向盤一樣順時針、逆時針旋轉。',
    build(el) {
      let span = store.get('wheel.span', 90), zero = null;
      const gate = makeGate('mot');
      el.innerHTML =
        '<i class="gate-slot"></i>' +
        '<div class="viz-row"><svg class="dial-svg" viewBox="0 0 180 180" aria-hidden="true"><g class="w-rot"><circle class="w-ring" cx="90" cy="90" r="70"/><path class="w-spoke" d="M90 90L25 80M90 90L155 80M90 90V158"/><circle class="w-hub" cx="90" cy="90" r="20"/><rect class="w-mark" x="83" y="13" width="14" height="15" rx="4"/></g></svg>' +
        '<div class="readouts"><div class="ro"><span>重力 x</span><b class="gx">—</b></div><div class="ro"><span>重力 y</span><b class="gy">—</b></div><div class="ro"><span>手機轉角</span><b class="th">—</b></div><div class="ro hl"><span>轉向</span><b class="rel">—</b></div></div></div>' +
        '<i class="span-slot"></i>' +
        '<button class="btn block" type="button" data-act="cal">' + icon('center') + '校正：目前握法 ＝ 90°</button>' +
        '<p class="hint">原理：手機靜止時加速度計量到的就是重力。手機在自己的平面上轉動，重力在 x、y 兩軸的比例就會改變，用 atan2(x, y) 算出轉角。</p>';
      slot(el, '.gate-slot', gate.el);
      slot(el, '.span-slot', rangeField({ label: '轉多少度到底', min: 30, max: 150, step: 5, value: span, fmt: v => '±' + v + '°', onInput: v => { span = v; store.set('wheel.span', v); } }));
      const rot = $('.w-rot', el);
      const theta = () => Math.atan2(Motion.grav.x, Motion.grav.y) * 180 / Math.PI;
      const calibrate = () => { if (!Motion.hasData('mot')) { toast('還沒有感測器資料', 'warn'); return; } zero = theta(); haptic(15); toast('已把目前握法設為 90°', 'ok'); };
      $('[data-act="cal"]', el).addEventListener('click', calibrate);
      return {
        recenter: calibrate,
        activate() { gate.start(); zero = null; },
        tick() {
          if (!gate.update()) return;
          const g = Motion.grav;
          $('.gx', el).textContent = g.x.toFixed(1);
          $('.gy', el).textContent = g.y.toFixed(1);
          if (Math.hypot(g.x, g.y) < 3) { $('.rel', el).textContent = '請立起手機'; return; }
          const th = theta();
          if (zero == null) zero = th;
          const rel = -wrap180(th - zero);
          setTarget(90 + rel * 90 / span, { source: '方向盤' });
          $('.th', el).textContent = th.toFixed(0) + '°';
          $('.rel', el).textContent = signed(rel) + '°';
          rot.setAttribute('transform', 'rotate(' + clamp(rel, -180, 180).toFixed(1) + ' 90 90)');
        }
      };
    }
  });

  /* ── 7 指南針 ── */
  mode({
    id: 'compass', group: 'sensor', name: '指南針', icon: 'compass', api: 'DeviceOrientation（α／磁力計）', smooth: true,
    supported: () => 'DeviceOrientationEvent' in window,
    desc: '手機平放，像指南針一樣水平轉動，伺服馬達會跟著你轉的方向。',
    build(el) {
      let span = store.get('compass.span', 90), zero = null;
      const gate = makeGate('ori');
      let ticks = '';
      for (let i = 0; i < 72; i++) { const a = i * 5 * Math.PI / 180, major = i % 6 === 0, r0 = major ? 62 : 66; ticks += '<line class="c-tick' + (major ? ' major' : '') + '" x1="' + (90 + r0 * Math.sin(a)).toFixed(1) + '" y1="' + (90 - r0 * Math.cos(a)).toFixed(1) + '" x2="' + (90 + 72 * Math.sin(a)).toFixed(1) + '" y2="' + (90 - 72 * Math.cos(a)).toFixed(1) + '"/>'; }
      const labs = [['北', 0, 'n'], ['東', 90, ''], ['南', 180, ''], ['西', 270, '']].map(l => { const a = l[1] * Math.PI / 180; return '<text class="c-lab ' + l[2] + '" x="' + (90 + 48 * Math.sin(a)).toFixed(1) + '" y="' + (90 - 48 * Math.cos(a)).toFixed(1) + '">' + l[0] + '</text>'; }).join('');
      el.innerHTML =
        '<i class="gate-slot"></i>' +
        '<div class="viz-row"><svg class="dial-svg" viewBox="0 0 180 180" aria-hidden="true"><circle class="c-face" cx="90" cy="90" r="80"/><g class="c-rot">' + ticks + labs + '<line class="c-zero" x1="90" y1="90" x2="90" y2="28"/></g><path class="c-ptr" d="M90 4l8 14H82z"/><circle cx="90" cy="90" r="4" fill="var(--dim)"/></svg>' +
        '<div class="readouts"><div class="ro"><span>方位角</span><b class="hd">—</b></div><div class="ro"><span>方向</span><b class="dir">—</b></div><div class="ro hl"><span>相對起始方向</span><b class="rel">—</b></div></div></div>' +
        '<i class="span-slot"></i>' +
        '<button class="btn block" type="button" data-act="cal">' + icon('center') + '校正：目前方向 ＝ 90°</button>' +
        '<p class="hint">藍線是起始方向。附近有喇叭、磁鐵或金屬桌面時，磁力計可能不準；iPhone 上的值來自 <code>webkitCompassHeading</code>。</p>';
      slot(el, '.gate-slot', gate.el);
      slot(el, '.span-slot', rangeField({ label: '轉多少度到底', min: 30, max: 180, step: 5, value: span, fmt: v => '±' + v + '°', onInput: v => { span = v; store.set('compass.span', v); } }));
      const rotG = $('.c-rot', el), zeroLine = $('.c-zero', el);
      const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
      const calibrate = () => { const hd = Motion.ori.heading; if (hd == null) { toast('還沒有方位資料', 'warn'); return; } zero = hd; haptic(15); toast('已把目前方向設為 90°', 'ok'); };
      $('[data-act="cal"]', el).addEventListener('click', calibrate);
      return {
        recenter: calibrate,
        activate() { gate.start(); zero = null; },
        tick() {
          if (!gate.update()) return;
          const hd = Motion.ori.heading;
          if (hd == null) { $('.hd', el).textContent = '無磁力計'; return; }
          if (zero == null) zero = hd;
          const rel = wrap180(hd - zero);
          setTarget(90 + rel * 90 / span, { source: '指南針' });
          rotG.setAttribute('transform', 'rotate(' + (-hd).toFixed(1) + ' 90 90)');
          zeroLine.setAttribute('transform', 'rotate(' + zero.toFixed(1) + ' 90 90)');
          $('.hd', el).textContent = hd.toFixed(0) + '°';
          $('.dir', el).textContent = DIRS[Math.round(hd / 45) % 8];
          $('.rel', el).textContent = signed(rel) + '°';
        }
      };
    }
  });

  /* ── 8 搖一搖 ── */
  mode({
    id: 'shake', group: 'sensor', name: '搖一搖', icon: 'shake', api: 'DeviceMotionEvent（加速度）', smooth: true,
    supported: () => 'DeviceMotionEvent' in window,
    desc: '搖晃手機：可以讓「力道」決定角度，或是搖一下就觸發揮手動作。',
    build(el) {
      let sub = store.get('shake.sub', 'power'), maxF = store.get('shake.max', 20), decay = store.get('shake.decay', 1.5), th = store.get('shake.th', 14);
      let energy = 0, lastTrig = 0, count = 0, shown = 0;
      const hist = [];
      const gate = makeGate('mot');
      el.innerHTML =
        '<i class="gate-slot"></i><i class="sub-slot"></i>' +
        '<div class="viz-row"><div><div class="sub-h">加速度</div><div class="big-num mag">0.0<small>m/s²</small></div></div><div><div class="sub-h trig-label">觸發次數</div><div class="big-num cnt">0<small>次</small></div></div></div>' +
        '<canvas class="wave-cv" aria-hidden="true"></canvas>' +
        '<div class="opts-power"><i class="max-slot"></i><i class="decay-slot"></i></div>' +
        '<div class="opts-trig"><i class="th-slot"></i></div>' +
        '<p class="hint">加速度已扣掉重力，只看「晃動」的部分。用力甩之前請先握緊手機！</p>';
      slot(el, '.gate-slot', gate.el);
      const optsP = $('.opts-power', el), optsT = $('.opts-trig', el);
      const showSub = () => { optsP.hidden = sub !== 'power'; optsT.hidden = sub !== 'trigger'; $('.trig-label', el).textContent = sub === 'power' ? '能量' : '觸發次數'; };
      slot(el, '.sub-slot', segControl([['power', '力道 → 角度'], ['trigger', '搖一下 → 揮手']], sub, v => { sub = v; store.set('shake.sub', v); showSub(); }));
      slot(el, '.max-slot', rangeField({ label: '多大力道轉到底', min: 6, max: 40, value: maxF, unit: ' m/s²', onInput: v => { maxF = v; store.set('shake.max', v); } }));
      slot(el, '.decay-slot', rangeField({ label: '停下後回落速度', min: 0.3, max: 5, step: 0.1, value: decay, fmt: v => v.toFixed(1) + ' 倍', onInput: v => { decay = v; store.set('shake.decay', v); } }));
      slot(el, '.th-slot', rangeField({ label: '觸發門檻', min: 6, max: 30, value: th, unit: ' m/s²', onInput: v => { th = v; store.set('shake.th', v); } }));
      showSub();
      const cv = $('.wave-cv', el);
      return {
        activate() { gate.start(); energy = 0; Motion.lin.peak = 0; },
        tick(t, dt) {
          if (!gate.update()) return;
          const peak = Motion.lin.peak; Motion.lin.peak = 0;
          shown = Math.max(peak, shown * Math.exp(-dt * 5)); // 顯示用：短暫保持峰值，避免數字閃爍
          hist.push(shown); if (hist.length > 180) hist.shift();
          $('.mag', el).firstChild.nodeValue = shown.toFixed(1);
          if (sub === 'power') {
            energy = Math.max(peak, energy * Math.exp(-dt * decay));
            setTarget(mapTo(energy, 0, maxF, cfg.min, cfg.max), { source: '搖一搖' });
            $('.cnt', el).firstChild.nodeValue = Math.round(energy / maxF * 100);
            $('.cnt small', el).textContent = '%';
          } else {
            if (peak > th && t - lastTrig > 1400 && !Seq.active) {
              lastTrig = t; count++; haptic(40);
              runAction('wave');
              log('sys', '偵測到搖晃 ' + peak.toFixed(1) + ' m/s²', '觸發揮手');
            }
            $('.cnt', el).firstChild.nodeValue = count;
            $('.cnt small', el).textContent = '次';
          }
          const f = fitCanvas(cv); if (!f) return;
          const g = f.g; g.clearRect(0, 0, f.w, f.h);
          const top = Math.max(maxF, th) * 1.2, y = v => f.h - 4 - clamp(v / top, 0, 1) * (f.h - 8);
          g.strokeStyle = COLORS['--line-2']; g.setLineDash([4, 4]); g.lineWidth = 1;
          const ly = y(sub === 'power' ? maxF : th); g.beginPath(); g.moveTo(0, ly); g.lineTo(f.w, ly); g.stroke(); g.setLineDash([]);
          g.strokeStyle = COLORS['--accent']; g.lineWidth = 2; g.beginPath();
          hist.forEach((v, i) => { const x = (i + 180 - hist.length) / 179 * f.w; if (i) g.lineTo(x, y(v)); else g.moveTo(x, y(v)); });
          g.stroke();
        }
      };
    }
  });

  /* ── 9 聲音音量 ── */
  mode({
    id: 'mic', group: 'media', name: '聲音', icon: 'mic', api: 'Web Audio API + getUserMedia', smooth: true,
    supported: hasMedia,
    desc: '對著手機吹氣、說話或拍手：音量決定角度，或拍一下手讓伺服馬達在兩個角度間切換。',
    build(el) {
      let sub = store.get('mic.sub', 'level'), floor = store.get('mic.floor', -58), ceil = store.get('mic.ceil', -18), clapTh = store.get('mic.clap', -24);
      let A = store.get('mic.A', 20), B = store.get('mic.B', 160);
      let ctx = null, stream = null, an = null, buf = null, running = false, db = -100, base = -70, toggled = false, lastClap = 0, calib = null;
      el.innerHTML =
        '<i class="sub-slot"></i>' +
        '<canvas class="wave-cv" aria-hidden="true"></canvas>' +
        '<div><div class="field-row"><span class="field-label">音量</span><span class="field-val dbv">— dB</span></div>' +
        '<div class="meter" style="margin-top:8px"><i></i><span class="mk floor"></span><span class="mk alt ceil"></span></div>' +
        '<div class="meter-scale"><span>−80</span><span>−60</span><span>−40</span><span>−20</span><span>0 dB</span></div></div>' +
        '<button class="btn primary lg block" type="button" data-act="toggle">' + icon('mic') + '<span>開始收音</span></button>' +
        '<div class="opts-level"><i class="floor-slot"></i><i class="ceil-slot"></i><button class="btn block" type="button" data-act="calib">量測環境噪音（2 秒）</button></div>' +
        '<div class="opts-clap"><i class="clap-slot"></i><div class="grid2"><i class="a-slot"></i><i class="b-slot"></i></div></div>' +
        '<p class="hint">黑色標記是「靜音」位置，藍色標記是「轉到底」位置。聲音只在手機上分析，不會錄音、也不會上傳。</p>';
      const optsL = $('.opts-level', el), optsC = $('.opts-clap', el);
      const showSub = () => { optsL.hidden = sub !== 'level'; optsC.hidden = sub !== 'clap'; };
      slot(el, '.sub-slot', segControl([['level', '音量 → 角度'], ['clap', '拍手切換']], sub, v => { sub = v; store.set('mic.sub', v); showSub(); }));
      const fF = slot(el, '.floor-slot', rangeField({ label: '靜音位置（0°）', min: -90, max: -20, value: floor, unit: ' dB', onInput: v => { floor = v; store.set('mic.floor', v); } }));
      slot(el, '.ceil-slot', rangeField({ label: '轉到底的音量（180°）', min: -50, max: 0, value: ceil, unit: ' dB', onInput: v => { ceil = v; store.set('mic.ceil', v); } }));
      slot(el, '.clap-slot', rangeField({ label: '拍手門檻', min: -50, max: -5, value: clapTh, unit: ' dB', onInput: v => { clapTh = v; store.set('mic.clap', v); } }));
      slot(el, '.a-slot', rangeField({ label: '角度 A', min: 0, max: 180, value: A, unit: '°', onInput: v => { A = v; store.set('mic.A', v); } }));
      slot(el, '.b-slot', rangeField({ label: '角度 B', min: 0, max: 180, value: B, unit: '°', onInput: v => { B = v; store.set('mic.B', v); } }));
      showSub();
      const btn = $('[data-act="toggle"]', el), cv = $('.wave-cv', el), bar = $('.meter > i', el);
      const pos = v => clamp((v + 80) / 80, 0, 1) * 100 + '%';
      async function start() {
        if (!hasMedia()) { toast('這個瀏覽器不能使用麥克風', 'err'); return; }
        if (!window.isSecureContext) { toast('麥克風需要 HTTPS 網址', 'err'); return; }
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          ctx = new AC();
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          const src = ctx.createMediaStreamSource(stream);
          an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
          buf = new Float32Array(an.fftSize);
          if (ctx.state === 'suspended') await ctx.resume();
          running = true; btn.classList.remove('primary'); $('span', btn).textContent = '停止收音';
          log('sys', '麥克風已開啟');
        } catch (e) {
          toast('無法使用麥克風：' + (e.name === 'NotAllowedError' ? '權限被拒絕' : e.message), 'err');
          stop();
        }
      }
      function stop() {
        running = false;
        if (stream) stream.getTracks().forEach(tr => tr.stop());
        if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } }
        stream = null; ctx = null; an = null;
        btn.classList.add('primary'); $('span', btn).textContent = '開始收音';
      }
      btn.addEventListener('click', () => (running ? stop() : start()));
      $('[data-act="calib"]', el).addEventListener('click', () => { if (!running) { toast('請先開始收音', 'warn'); return; } calib = { until: now() + 2000, sum: 0, n: 0 }; toast('請保持安靜 2 秒…'); });
      return {
        deactivate: stop,
        tick(t) {
          $('.mk.floor', el).style.left = pos(floor);
          $('.mk.ceil', el).style.left = pos(sub === 'clap' ? clapTh : ceil);
          if (!running || !an) return;
          an.getFloatTimeDomainData(buf);
          let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9);
          db = Math.max(-100, db);
          base += (db - base) * 0.05;
          $('.dbv', el).textContent = db.toFixed(0) + ' dB';
          bar.style.width = pos(db);
          if (calib) {
            calib.sum += db; calib.n++;
            if (t > calib.until) { floor = Math.round(calib.sum / calib.n + 4); if (ceil < floor + 12) ceil = floor + 12; store.set('mic.floor', floor); fF.set(floor); calib = null; toast('環境噪音約 ' + (floor - 4) + ' dB，已調整靜音位置', 'ok'); }
          }
          if (sub === 'level') setTarget(mapTo(db, floor, ceil, 0, 180), { source: '聲音音量' });
          else if (db > clapTh && db - base > 10 && t - lastClap > 380) {
            lastClap = t; toggled = !toggled; haptic(25);
            setTarget(toggled ? B : A, { source: '拍手' });
            log('sys', '偵測到拍手 ' + db.toFixed(0) + ' dB', '切換到 ' + (toggled ? B : A) + '°');
          }
          const f = fitCanvas(cv); if (!f) return;
          const g = f.g; g.clearRect(0, 0, f.w, f.h);
          g.strokeStyle = COLORS['--accent']; g.lineWidth = 2; g.beginPath();
          const step = Math.max(1, Math.floor(buf.length / f.w));
          for (let i = 0, x = 0; i < buf.length; i += step, x += f.w / (buf.length / step)) { const y = f.h / 2 - buf[i] * f.h * 1.6; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
          g.stroke();
        }
      };
    }
  });

  /* ── 10 語音指令 ── */
  function cnToNum(str) {
    const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let total = 0, cur = 0, lastUnit = 1, zeroAfter = false;
    for (const ch of str) {
      if (ch in D) { if (D[ch] === 0) zeroAfter = true; cur = D[ch]; } else if (ch === '十') { total += (cur || 1) * 10; cur = 0; lastUnit = 10; } else if (ch === '百') { total += (cur || 1) * 100; cur = 0; lastUnit = 100; zeroAfter = false; }
    }
    if (cur && lastUnit === 100 && !zeroAfter) cur *= 10; // 「一百八」＝180
    return total + cur;
  }
  function parseCommand(raw) {
    let s = String(raw).replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '');
    if (!s) return null;
    const rel = (d, label) => ({ label, run: () => setTarget(E.target + d, { user: true, source: '語音' }) });
    const abs = (a, label) => ({ label, run: () => setTarget(a, { user: true, source: '語音' }) });
    const act = id => ({ label: '動作：' + actionById(id).name, run: () => runAction(id) });
    if (/停止|停下|暫停|別動|不要動|^停/.test(s)) return { label: '停止動作', run: () => { Seq.stop(); setTarget(E.out, { source: '語音' }); } };
    if (/跳舞|跳支舞|搖擺|嗨起來/.test(s)) return act('dance');
    if (/揮手|打招呼|你好|哈囉|嗨/.test(s)) return act('wave');
    if (/點頭|同意|好喔/.test(s)) return act('nod');
    if (/雨刷/.test(s)) return act('wiper');
    if (/掃描|巡邏/.test(s)) return act('scan');
    if (/敲門|叩叩/.test(s)) return act('knock');
    const small = /一點|一些|一下|一咪|稍微|一點點/.test(s);
    s = s.replace(/一點點|一點|一些|一下|一咪|稍微/g, '');
    let num = null;
    const m1 = s.match(/(\d{1,3}(?:\.\d+)?)/);
    const m2 = s.match(/([零〇一二兩三四五六七八九十百]+)度/) || s.match(/([零〇一二兩三四五六七八九十百]{2,})/);
    if (m1) num = parseFloat(m1[1]); else if (m2) num = cnToNum(m2[1]);
    const left = /往左|向左|左轉|左邊|逆時針|減/.test(s), right = /往右|向右|右轉|右邊|順時針|加/.test(s);
    if (num != null && (left || right)) return rel(right ? num : -num, (right ? '往右 ' : '往左 ') + num + '°');
    if (num != null) return abs(clamp(num, 0, 180), '轉到 ' + clamp(num, 0, 180) + '°');
    if (/中間|中央|回正|置中|歸位|回中|正中/.test(s)) return abs(90, '回到中間 90°');
    if (/最左|最小|最低|關門|關閉/.test(s)) return abs(0, '轉到最左 0°');
    if (/最右|最大|最高|開門|打開/.test(s)) return abs(180, '轉到最右 180°');
    if (left || /左/.test(s)) return rel(small ? -10 : -30, '往左 ' + (small ? 10 : 30) + '°');
    if (right || /右/.test(s)) return rel(small ? 10 : 30, '往右 ' + (small ? 10 : 30) + '°');
    return null;
  }
  mode({
    id: 'voice', group: 'media', name: '語音', icon: 'voice', api: 'Web Speech API（SpeechRecognition）', smooth: true,
    supported: hasSR,
    desc: '用說的：「九十度」「往右三十度」「回到中間」「跳舞」…聽懂就立刻執行。',
    build(el) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      let rec = null, listening = false, cont = store.get('voice.cont', true);
      const hist = [];
      const SAMPLES = ['九十度', '往右三十度', '往左一點', '最右邊', '回到中間', '一百二十度', '揮手', '跳舞', '停止'];
      el.innerHTML =
        (SR ? '' : '<div class="notice warn">' + icon('alert') + '<div><b>這個瀏覽器不支援語音辨識</b><p>請用 Chrome（Android）或 Safari（iPhone，需開啟「聽寫」）。下方仍可用文字輸入指令體驗。</p></div></div>') +
        '<div class="mic-hero"><button class="mic-btn" type="button" aria-label="開始聆聽">' + icon('mic') + '</button><div class="mic-state">點一下麥克風開始說話</div></div>' +
        '<div class="transcript"><span class="placeholder">辨識到的文字會出現在這裡</span></div>' +
        '<i class="cont-slot"></i>' +
        '<div class="field"><span class="field-label">試試看這些指令（也可以直接點）</span><div class="cmd-chips">' + SAMPLES.map(c => '<button class="cmd" type="button">' + c + '</button>').join('') + '</div></div>' +
        '<div class="field"><span class="field-label">或輸入文字指令</span><div class="input-group"><input class="input" placeholder="例如：往左 45 度" enterkeyhint="send"><button class="btn primary" type="button" data-act="send">送出</button></div></div>' +
        '<div class="field"><span class="field-label">指令紀錄</span><ul class="history"><li class="bad"><span class="q">還沒有指令</span><span class="r"></span></li></ul></div>';
      const micBtn = $('.mic-btn', el), state = $('.mic-state', el), tr = $('.transcript', el), list = $('.history', el), input = $('.input', el);
      slot(el, '.cont-slot', switchField('持續聆聽', cont, v => { cont = v; store.set('voice.cont', v); if (listening) { stopL(); startL(); } }, '關閉時，每說一句就要再按一次麥克風'));
      const ui = () => { micBtn.classList.toggle('on', listening); state.textContent = listening ? '聆聽中…請說出指令' : '點一下麥克風開始說話'; };
      function handle(text, from) {
        text = String(text).trim(); if (!text) return;
        const cmd = parseCommand(text);
        tr.innerHTML = esc(text);
        hist.unshift({ q: text, r: cmd ? cmd.label : '聽不懂', ok: !!cmd });
        if (hist.length > 6) hist.length = 6;
        list.innerHTML = hist.map(x => '<li class="' + (x.ok ? '' : 'bad') + '"><span class="q">「' + esc(x.q) + '」</span><span class="r">' + (x.ok ? '✓ ' : '✕ ') + esc(x.r) + '</span></li>').join('');
        if (cmd) { cmd.run(); haptic(15); log('sys', (from === 'voice' ? '語音' : '文字') + '指令「' + text + '」', cmd.label); }
      }
      function startL() {
        if (!SR) { toast('不支援語音辨識，請改用文字輸入', 'warn'); return; }
        try {
          rec = new SR(); rec.lang = 'zh-TW'; rec.interimResults = true; rec.continuous = cont; rec.maxAlternatives = 1;
          rec.onresult = e => {
            let interim = '', fin = '';
            for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript; }
            if (interim) tr.innerHTML = '<span class="interim">' + esc(interim) + '</span>';
            if (fin) handle(fin, 'voice');
          };
          rec.onerror = e => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            const M = { 'not-allowed': '麥克風權限被拒絕', 'service-not-allowed': '語音服務未開啟（iPhone 請到設定開啟「聽寫」）', network: '語音辨識需要網路', 'audio-capture': '找不到麥克風' };
            toast(M[e.error] || ('語音辨識錯誤：' + e.error), 'err');
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { listening = false; ui(); }
          };
          rec.onend = () => { if (listening && cont) { try { rec.start(); return; } catch (er) { /* ignore */ } } listening = false; ui(); };
          rec.start(); listening = true; ui(); haptic(10);
        } catch (e) { toast('無法啟動語音辨識：' + e.message, 'err'); listening = false; ui(); }
      }
      function stopL() { listening = false; try { if (rec) rec.stop(); } catch (e) { /* ignore */ } ui(); }
      micBtn.addEventListener('click', () => (listening ? stopL() : startL()));
      $$('.cmd', el).forEach(b => b.addEventListener('click', () => handle(b.textContent, 'tap')));
      const send = () => { handle(input.value, 'text'); input.value = ''; };
      $('[data-act="send"]', el).addEventListener('click', send);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      return { deactivate: stopL };
    }
  });

  /* ── 11 相機追蹤 ── */
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
    return [hh, mx ? d / mx : 0, mx];
  }
  mode({
    id: 'camera', group: 'media', name: '相機', icon: 'camera', api: 'getUserMedia + Canvas 影像分析', smooth: true,
    supported: hasMedia,
    desc: '讓相機追蹤某個顏色的物體（點畫面選顏色），或用光線亮度控制角度。',
    build(el) {
      let sub = store.get('cam.sub', 'color'), facing = store.get('cam.facing', 'environment'), tol = store.get('cam.tol', 22);
      let pick = store.get('cam.pick', { h: 0, s: 0.75, v: 0.75, rgb: [220, 40, 50] });
      let stream = null, running = false, lastProc = 0, lo = null, hi = null, lastFrame = null, found = false;
      const PW = 96;
      el.innerHTML =
        '<i class="sub-slot"></i>' +
        '<div class="cam-box"><video playsinline muted autoplay></video><canvas class="ov"></canvas>' +
        '<div class="cam-empty">' + icon('camera') + '<div>相機畫面只在手機上分析，不會上傳</div><button class="btn primary" type="button" data-act="start">開啟相機</button></div>' +
        '<div class="cam-hud"><span class="hud-l">—</span><span class="hud-r">—</span></div></div>' +
        '<div class="row"><button class="btn grow" type="button" data-act="toggle">' + icon('camera') + '<span>開啟相機</span></button><button class="btn" type="button" data-act="flip">' + icon('flip') + '<span>切換鏡頭</span></button></div>' +
        '<div class="opts-color"><div class="row"><span class="swatch"></span><div class="grow"><b style="font-size:14px">追蹤顏色</b><div class="hint">點一下畫面中的物體來挑選顏色。物體在畫面左邊 → 0°，右邊 → 180°。</div></div></div><i class="tol-slot"></i></div>' +
        '<div class="opts-light"><div class="meter"><i></i></div><div class="meter-scale"><span>暗</span><span>亮</span></div><button class="btn block" type="button" data-act="reset" style="margin-top:12px">重新校正亮暗範圍</button><p class="hint" style="margin-top:8px">用手遮住鏡頭 → 0°；打開手電筒照鏡頭 → 180°。系統會自動記住最暗與最亮的範圍。</p></div>';
      const video = $('video', el), ov = $('.ov', el), empty = $('.cam-empty', el), box = $('.cam-box', el), sw = $('.swatch', el);
      const pc = document.createElement('canvas'), pctx = pc.getContext('2d', { willReadFrequently: true });
      const optsC = $('.opts-color', el), optsL = $('.opts-light', el);
      const showSub = () => { optsC.hidden = sub !== 'color'; optsL.hidden = sub !== 'light'; };
      slot(el, '.sub-slot', segControl([['color', '顏色追蹤'], ['light', '亮度感測']], sub, v => { sub = v; store.set('cam.sub', v); showSub(); lo = hi = null; }));
      slot(el, '.tol-slot', rangeField({ label: '顏色容許範圍', min: 6, max: 50, value: tol, unit: '°', onInput: v => { tol = v; store.set('cam.tol', v); } }));
      showSub();
      const paintSwatch = () => { sw.style.background = 'rgb(' + pick.rgb.join(',') + ')'; };
      paintSwatch();
      const mirror = () => facing === 'user';
      const toggleBtn = $('[data-act="toggle"]', el);
      async function start() {
        if (!hasMedia()) { toast('這個瀏覽器不能使用相機', 'err'); return; }
        if (!window.isSecureContext) { toast('相機需要 HTTPS 網址', 'err'); return; }
        stop();
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
          video.srcObject = stream;
          await video.play();
          running = true; empty.hidden = true; lo = hi = null;
          video.classList.toggle('mirror', mirror()); ov.classList.toggle('mirror', mirror());
          $('span', toggleBtn).textContent = '關閉相機';
          log('sys', '相機已開啟', facing === 'user' ? '前鏡頭' : '後鏡頭');
        } catch (e) {
          toast('無法開啟相機：' + (e.name === 'NotAllowedError' ? '權限被拒絕' : e.message), 'err');
          stop();
        }
      }
      function stop() {
        running = false;
        if (stream) stream.getTracks().forEach(tr => tr.stop());
        stream = null; video.srcObject = null; empty.hidden = false; lastFrame = null;
        $('span', toggleBtn).textContent = '開啟相機';
        const g = ov.getContext('2d'); g.clearRect(0, 0, ov.width, ov.height);
      }
      $('[data-act="start"]', el).addEventListener('click', start);
      toggleBtn.addEventListener('click', () => (running ? stop() : start()));
      $('[data-act="flip"]', el).addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; store.set('cam.facing', facing); if (running) start(); else toast(facing === 'user' ? '已切換為前鏡頭' : '已切換為後鏡頭'); });
      $('[data-act="reset"]', el).addEventListener('click', () => { lo = hi = null; toast('已重設亮暗範圍'); });
      box.addEventListener('click', e => {
        if (!running || sub !== 'color' || !lastFrame || e.target.closest('button')) return;
        const r = box.getBoundingClientRect();
        let fx = (e.clientX - r.left) / r.width; const fy = (e.clientY - r.top) / r.height;
        if (mirror()) fx = 1 - fx;
        const x = clamp(Math.floor(fx * pc.width), 1, pc.width - 2), y = clamp(Math.floor(fy * pc.height), 1, pc.height - 2);
        let R = 0, G = 0, B = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((y + dy) * pc.width + (x + dx)) * 4; R += lastFrame[i]; G += lastFrame[i + 1]; B += lastFrame[i + 2]; }
        R = Math.round(R / 9); G = Math.round(G / 9); B = Math.round(B / 9);
        const hsv = rgb2hsv(R, G, B);
        pick = { h: hsv[0], s: hsv[1], v: hsv[2], rgb: [R, G, B] };
        store.set('cam.pick', pick); paintSwatch(); haptic(12);
        toast('已選擇顏色 rgb(' + R + ', ' + G + ', ' + B + ')', 'ok');
      });
      function process() {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        const ph = Math.round(PW * vh / vw);
        if (pc.width !== PW || pc.height !== ph) { pc.width = PW; pc.height = ph; box.style.aspectRatio = vw + ' / ' + vh; }
        pctx.drawImage(video, 0, 0, PW, ph);
        const data = pctx.getImageData(0, 0, PW, ph).data;
        lastFrame = data;
        const f = fitCanvas(ov); if (!f) return;
        const g = f.g; g.clearRect(0, 0, f.w, f.h);
        const sx = f.w / PW, sy = f.h / ph;
        if (sub === 'color') {
          const gray = pick.s < 0.2;
          let n = 0, sxSum = 0, sySum = 0;
          g.fillStyle = 'rgba(255,122,46,.55)';
          for (let y = 0; y < ph; y++) {
            for (let x = 0; x < PW; x++) {
              const i = (y * PW + x) * 4, c = rgb2hsv(data[i], data[i + 1], data[i + 2]);
              let ok;
              if (gray) ok = c[1] < 0.25 && Math.abs(c[2] - pick.v) < tol / 180;
              else { const dh = Math.abs(((c[0] - pick.h + 540) % 360) - 180); ok = dh <= tol && c[1] >= Math.max(0.22, pick.s * 0.45) && c[2] >= Math.max(0.18, pick.v * 0.4); }
              if (ok) { n++; sxSum += x; sySum += y; g.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5); }
            }
          }
          found = n > PW * ph * 0.004;
          if (found) {
            const cx = sxSum / n, cy = sySum / n;
            let fx = (cx + 0.5) / PW; if (mirror()) fx = 1 - fx;
            setTarget(fx * 180, { source: '顏色追蹤' });
            g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc((cx + 0.5) * sx, (cy + 0.5) * sy, 16, 0, Math.PI * 2); g.stroke();
            g.beginPath(); g.moveTo((cx + 0.5) * sx, 0); g.lineTo((cx + 0.5) * sx, f.h); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
          }
          $('.hud-l', el).textContent = found ? '追蹤中 ' + (n / (PW * ph) * 100).toFixed(1) + '%' : '找不到這個顏色';
          $('.hud-r', el).textContent = found ? Math.round(E.target) + '°' : '—';
        } else {
          let sum = 0, n = 0;
          for (let i = 0; i < data.length; i += 8) { sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++; }
          const Y = sum / n;
          if (lo == null) { lo = Y - 15; hi = Y + 15; }
          lo = Math.min(lo, Y); hi = Math.max(hi, Y);
          lo += (Y - lo) * 0.0015; hi += (Y - hi) * 0.0015;
          if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
          const k = clamp((Y - lo) / (hi - lo), 0, 1);
          setTarget(k * 180, { source: '亮度' });
          $('.opts-light .meter > i', el).style.width = (k * 100).toFixed(1) + '%';
          $('.hud-l', el).textContent = '亮度 ' + Y.toFixed(0) + '／255';
          $('.hud-r', el).textContent = Math.round(k * 180) + '°';
        }
      }
      return {
        deactivate: stop,
        tick(t) { if (running && t - lastProc > 66) { lastProc = t; process(); } }
      };
    }
  });

  /* ── 12 自動擺動 ── */
  mode({
    id: 'sweep', group: 'auto', name: '自動擺動', icon: 'wave', api: 'requestAnimationFrame · 波形產生器',
    desc: '用正弦波、三角波、方波或隨機方式自動來回轉動，適合測試或做出節奏動作。',
    build(el) {
      let wave = store.get('sweep.wave', 'sine'), period = store.get('sweep.period', 3), from = store.get('sweep.from', 20), to = store.get('sweep.to', 160);
      let running = false, t0 = 0, phase = 0, rA = 0.5, rB = 0.5, rSeg = -1;
      el.innerHTML =
        '<i class="wave-slot"></i><canvas class="sweep-cv" aria-hidden="true"></canvas>' +
        '<button class="btn primary lg block" type="button" data-act="run">' + icon('play') + '<span>開始擺動</span></button>' +
        '<i class="p-slot"></i><div class="grid2"><i class="f-slot"></i><i class="t-slot"></i></div>' +
        '<p class="hint">週期越短擺得越快。SG90 轉 180° 約需 0.3 秒，週期太短時馬達會跟不上。</p>';
      slot(el, '.wave-slot', segControl([['sine', '正弦'], ['tri', '三角'], ['square', '方波'], ['random', '隨機']], wave, v => { wave = v; store.set('sweep.wave', v); }));
      slot(el, '.p-slot', rangeField({ label: '週期', min: 0.4, max: 10, step: 0.1, value: period, fmt: v => v.toFixed(1) + ' 秒', onInput: v => { const ph = phase; period = v; store.set('sweep.period', v); t0 = now() - ph * period * 1000; } }));
      slot(el, '.f-slot', rangeField({ label: '起點', min: 0, max: 180, value: from, unit: '°', onInput: v => { from = v; store.set('sweep.from', v); } }));
      slot(el, '.t-slot', rangeField({ label: '終點', min: 0, max: 180, value: to, unit: '°', onInput: v => { to = v; store.set('sweep.to', v); } }));
      const btn = $('[data-act="run"]', el), cv = $('.sweep-cv', el);
      const W = {
        sine: p => 0.5 - 0.5 * Math.cos(p * 2 * Math.PI),
        tri: p => (p < 0.5 ? p * 2 : 2 - p * 2),
        square: p => (p < 0.5 ? 0 : 1)
      };
      const rnd = (cyc) => { const seg = Math.floor(cyc * 2); if (seg !== rSeg) { rA = rSeg < 0 ? 0.5 : rB; rB = Math.random(); rSeg = seg; } const k = cyc * 2 - seg; return lerp(rA, rB, easeIO(k)); };
      const setRun = v => {
        running = v; t0 = now(); rSeg = -1;
        btn.innerHTML = icon(v ? 'stop' : 'play') + '<span>' + (v ? '停止擺動' : '開始擺動') + '</span>';
        btn.classList.toggle('primary', !v);
        if (v) { Seq.stop(); log('sys', '自動擺動開始', wave + '，週期 ' + period + ' 秒'); }
      };
      btn.addEventListener('click', () => setRun(!running));
      return {
        deactivate() { if (running) setRun(false); },
        tick(t) {
          const cyc = (t - t0) / 1000 / period;
          phase = cyc % 1;
          if (running) { const k = wave === 'random' ? rnd(cyc) : W[wave](phase); setTarget(lerp(from, to, k), { source: '自動擺動' }); }
          const f = fitCanvas(cv); if (!f) return;
          const g = f.g; g.clearRect(0, 0, f.w, f.h);
          const y = a => f.h - 10 - a / 180 * (f.h - 20);
          g.strokeStyle = COLORS['--line-2']; g.lineWidth = 1; g.setLineDash([3, 5]);
          [0, 90, 180].forEach(a => { g.beginPath(); g.moveTo(0, y(a)); g.lineTo(f.w, y(a)); g.stroke(); });
          g.setLineDash([]);
          if (wave !== 'random') {
            g.strokeStyle = COLORS['--accent']; g.lineWidth = 2.5; g.beginPath();
            for (let x = 0; x <= f.w; x += 2) { const p = (x / f.w * 2) % 1, v = lerp(from, to, W[wave](p)); if (x) g.lineTo(x, y(v)); else g.moveTo(x, y(v)); }
            g.stroke();
            const px = ((running ? phase : 0) / 2) * f.w;
            g.fillStyle = COLORS['--blue']; g.beginPath(); g.arc(px, y(running ? E.target : from), 6, 0, Math.PI * 2); g.fill();
          } else {
            g.fillStyle = COLORS['--faint']; g.font = '12px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'center';
            g.fillText('隨機模式：每半個週期挑一個新的角度', f.w / 2, f.h / 2 - 8);
            g.fillStyle = COLORS['--blue']; g.beginPath(); g.arc(f.w / 2, y(E.target), 6, 0, Math.PI * 2); g.fill();
          }
        }
      };
    }
  });

  /* ── 13 錄製重播 ── */
  mode({
    id: 'record', group: 'auto', name: '錄製重播', icon: 'rec', api: 'localStorage · 時間序列',
    desc: '把任何一種控制方式的動作錄下來，再重播、循環播放或調整速度。',
    build(el) {
      let speed = store.get('rec.speed', 1), play = null;
      el.innerHTML =
        '<div class="rec-hero"><button class="rec-big" type="button"><span class="dot"></span><span class="lab">開始錄製</span><span class="t"></span></button>' +
        '<p class="hint">錄製中可以切換到傾斜、聲音、相機等任何模式操作，最長 60 秒；下方快捷列的「錄製」鍵也能開始／停止。</p></div>' +
        '<div class="field"><span class="field-label">播放速度</span><i class="spd-slot"></i></div>' +
        '<div class="clips"></div>';
      slot(el, '.spd-slot', segControl([['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×']], speed, v => { speed = +v; store.set('rec.speed', speed); if (play) { play.t0 = now() - play.pos / speed; } }));
      const list = $('.clips', el), recBtn = $('.rec-big', el);
      recBtn.addEventListener('click', () => { stopPlay(); if (Rec.on) Rec.stop(); else Rec.start(); });
      function render() {
        if (!clips.length) { list.innerHTML = '<div class="empty">還沒有錄製的片段。按上面的「開始錄製」，然後用任何方式轉動伺服馬達。</div>'; return; }
        list.innerHTML = clips.map(c => {
          const secs = (c.data.length * c.dt / 1000).toFixed(1), p = play && play.clip === c;
          return '<div class="clip' + (p ? ' playing' : '') + '" data-id="' + c.id + '"><div><div class="clip-meta"><b>' + esc(c.name) + '</b><span>' + secs + ' 秒 · ' + new Date(c.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) + '</span></div><canvas></canvas></div>' +
            '<div class="clip-btns"><button class="btn" type="button" data-act="play" aria-label="播放">' + icon(p ? 'stop' : 'play') + '</button><button class="btn' + (p && play.loop ? ' on' : '') + '" type="button" data-act="loop" aria-label="循環播放">' + icon('repeat') + '</button><button class="btn" type="button" data-act="del" aria-label="刪除">' + icon('trash') + '</button></div></div>';
        }).join('');
        requestAnimationFrame(drawAll);
      }
      function drawAll() {
        $$('.clip', list).forEach(row => {
          const c = clips.find(x => String(x.id) === row.dataset.id); if (!c) return;
          const f = fitCanvas($('canvas', row)); if (!f) return;
          f.g.clearRect(0, 0, f.w, f.h);
          plotSeries(f.g, c.data, f.w, f.h, COLORS['--accent'], 1.8);
          if (play && play.clip === c) { const x = clamp(play.pos / (c.data.length * c.dt), 0, 1) * f.w; f.g.fillStyle = COLORS['--blue']; f.g.fillRect(x - 1, 0, 2, f.h); }
        });
      }
      function startPlay(c, loop) {
        if (Rec.on) Rec.stop();
        Seq.stop();
        play = { clip: c, loop: !!loop, t0: now(), pos: 0 };
        log('sys', '重播「' + c.name + '」', (loop ? '循環 · ' : '') + speed + '×');
        render();
      }
      function stopPlay() { if (!play) return; play = null; render(); }
      list.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const row = b.closest('.clip'), c = clips.find(x => String(x.id) === row.dataset.id); if (!c) return;
        const a = b.dataset.act;
        if (a === 'del') { if (play && play.clip === c) play = null; clips.splice(clips.indexOf(c), 1); saveClips(); render(); return; }
        if (a === 'play') { if (play && play.clip === c) stopPlay(); else startPlay(c, false); return; }
        if (a === 'loop') { if (play && play.clip === c) { play.loop = !play.loop; render(); } else startPlay(c, true); }
      });
      RecordModeHook.refresh = render;
      let lastDraw = 0;
      return {
        activate: render,
        deactivate: stopPlay,
        tick(t) {
          recBtn.classList.toggle('on', Rec.on);
          $('.lab', recBtn).textContent = Rec.on ? '停止錄製' : '開始錄製';
          $('.t', recBtn).textContent = Rec.on ? ((t - Rec.t0) / 1000).toFixed(1) + ' 秒' : '';
          if (!play) return;
          const c = play.clip, dur = c.data.length * c.dt;
          play.pos = (t - play.t0) * speed;
          if (play.pos >= dur) {
            if (play.loop) { play.t0 = t; play.pos = 0; } else { setTarget(c.data[c.data.length - 1], { source: '重播' }); stopPlay(); return; }
          }
          const fi = play.pos / c.dt, i = Math.floor(fi);
          setTarget(lerp(c.data[i], c.data[Math.min(i + 1, c.data.length - 1)], fi - i), { source: '重播' });
          if (t - lastDraw > 80) { lastDraw = t; drawAll(); }
        }
      };
    }
  });

  /* ═════════════════════ 9. 儀表（SVG） ═════════════════════ */
  const CX = 180, CY = 196, GR = 146;
  const polar = (a, r) => { const t = (180 - a) * Math.PI / 180; return [CX + r * Math.cos(t), CY - r * Math.sin(t)]; };
  const arcD = (a0, a1, r) => { if (a1 - a0 < 0.05) a1 = a0 + 0.05; const p0 = polar(a0, r), p1 = polar(a1, r); return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2); };
  const G = {};
  function buildGauge() {
    const svg = $('#gauge');
    let ticks = '', labels = '';
    for (let a = 0; a <= 180; a += 5) { const major = a % 30 === 0, p0 = polar(a, GR - (major ? 30 : 23)), p1 = polar(a, GR - 15); ticks += '<line class="tk' + (major ? ' major' : '') + '" x1="' + p0[0].toFixed(1) + '" y1="' + p0[1].toFixed(1) + '" x2="' + p1[0].toFixed(1) + '" y2="' + p1[1].toFixed(1) + '"/>'; }
    for (let a = 0; a <= 180; a += 30) { const p = polar(a, GR + 16); labels += '<text class="glabel" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="middle">' + a + '</text>'; }
    const holes = [40, 58, 76, 94].map(d => '<circle cx="' + CX + '" cy="' + (CY - d) + '" r="2.6" fill="#9aa6b8"/>').join('');
    svg.innerHTML =
      '<defs>' +
      '<linearGradient id="gProg" x1="0" x2="1"><stop offset="0" style="stop-color:var(--accent-2)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient>' +
      '<linearGradient id="gBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f82f2"/><stop offset="1" stop-color="#1f55c2"/></linearGradient>' +
      '<linearGradient id="gHornFill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe5ee"/></linearGradient>' +
      '<filter id="fSh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".35"/></filter>' +
      '</defs>' +
      '<path class="g-track" d="' + arcD(0, 180, GR) + '"/>' +
      '<path class="g-limit" id="gLimLo"/><path class="g-limit" id="gLimHi"/>' +
      '<path class="g-prog" id="gProgress"/>' + ticks + labels +
      // 伺服馬達本體（SG90 俯視）
      '<g filter="url(#fSh)">' +
      '<path d="M' + (CX + 84) + ' ' + (CY + 12) + ' C' + (CX + 110) + ' ' + (CY + 14) + ' ' + (CX + 118) + ' ' + (CY + 36) + ' ' + (CX + 150) + ' ' + (CY + 52) + '" stroke="#f08a24" stroke-width="3.4" fill="none"/>' +
      '<path d="M' + (CX + 84) + ' ' + (CY + 17) + ' C' + (CX + 106) + ' ' + (CY + 20) + ' ' + (CX + 112) + ' ' + (CY + 42) + ' ' + (CX + 142) + ' ' + (CY + 58) + '" stroke="#e0383e" stroke-width="3.4" fill="none"/>' +
      '<path d="M' + (CX + 84) + ' ' + (CY + 22) + ' C' + (CX + 102) + ' ' + (CY + 26) + ' ' + (CX + 106) + ' ' + (CY + 48) + ' ' + (CX + 134) + ' ' + (CY + 64) + '" stroke="#5b3a29" stroke-width="3.4" fill="none"/>' +
      '<rect x="' + (CX - 54) + '" y="' + (CY - 9) + '" width="150" height="18" rx="4" fill="#2a5fcf"/>' +
      '<circle cx="' + (CX - 46) + '" cy="' + CY + '" r="3.2" fill="#0d1a33"/><circle cx="' + (CX + 88) + '" cy="' + CY + '" r="3.2" fill="#0d1a33"/>' +
      '<rect x="' + (CX - 36) + '" y="' + (CY - 28) + '" width="114" height="56" rx="8" fill="url(#gBody)"/>' +
      '<circle cx="' + (CX + 26) + '" cy="' + CY + '" r="13" fill="#4a8af5" opacity=".9"/>' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="25" fill="#5893f6"/>' +
      '<text x="' + (CX + 56) + '" y="' + (CY + 5) + '" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" font-weight="700" fill="#fff" fill-opacity=".85">SG90</text>' +
      '</g>' +
      // 目標指示
      '<g class="g-target" id="gTarget"><line x1="' + CX + '" y1="' + (CY - 30) + '" x2="' + CX + '" y2="' + (CY - GR + 28) + '"/><circle cx="' + CX + '" cy="' + (CY - GR) + '" r="7"/></g>' +
      // 擺臂
      '<g id="gHorn" filter="url(#fSh)">' +
      '<path d="M' + (CX - 15) + ' ' + CY + ' L' + (CX - 7) + ' ' + (CY - 104) + ' A7 7 0 0 1 ' + (CX + 7) + ' ' + (CY - 104) + ' L' + (CX + 15) + ' ' + CY + ' L' + (CX + 9) + ' ' + (CY + 22) + ' A9 9 0 0 1 ' + (CX - 9) + ' ' + (CY + 22) + ' Z" fill="url(#gHornFill)"/>' +
      holes + '<circle cx="' + CX + '" cy="' + CY + '" r="8" fill="#c7cfdb"/><path d="M' + (CX - 4) + ' ' + CY + 'h8M' + CX + ' ' + (CY - 4) + 'v8" stroke="#7d8899" stroke-width="1.6"/>' +
      '</g>';
    G.prog = $('#gProgress'); G.horn = $('#gHorn'); G.target = $('#gTarget'); G.lo = $('#gLimLo'); G.hi = $('#gLimHi');
    updateLimits();
    // 在儀表上拖曳（觸控類模式才啟用）
    let drag = false;
    const angleAt = e => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      if (p.y > CY) return p.x < CX ? 0 : 180;
      return 180 - Math.atan2(CY - p.y, p.x - CX) * 180 / Math.PI;
    };
    svg.addEventListener('pointerdown', e => {
      if (!active || active.def.group !== 'touch') { toast('目前由「' + (active ? active.def.name : '') + '」控制，切換到觸控類模式才能拖曳儀表'); return; }
      drag = true; try { svg.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      setTarget(angleAt(e), { user: true, source: '拖曳儀表' });
    });
    svg.addEventListener('pointermove', e => { if (drag) setTarget(angleAt(e), { user: true, source: '拖曳儀表' }); });
    const end = () => { drag = false; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  function updateLimits() {
    if (!G.lo) return;
    G.lo.setAttribute('d', cfg.min > 0 ? arcD(0, cfg.min, GR) : '');
    G.hi.setAttribute('d', cfg.max < 180 ? arcD(cfg.max, 180, GR) : '');
    E.target = clamp(E.target, cfg.min, cfg.max);
  }

  /* ═════════════════════ 10. 畫面更新 ═════════════════════ */
  const UI = {};
  function setText(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
  function renderStatus() {
    const pill = $('#statusBtn'); if (!pill) return;
    let cls, text;
    const d = Conn.driver;
    if (Conn.state === 'connecting') { cls = 'warn pulse'; text = '連線中…'; } else if (Conn.state === 'error') { cls = 'err'; text = '連線失敗'; } else if (Conn.state === 'offline' || !d) { cls = 'off'; text = '未連線'; } else if (Conn.kind === 'sim') { cls = 'sim'; text = '模擬模式'; } else if (Conn.kind === 'mqtt') { cls = Conn.board === false ? 'warn' : 'ok'; text = d.short + (Conn.board === false ? ' · 板子離線' : ''); } else { cls = 'ok'; text = d.short; }
    pill.className = 'status ' + cls;
    $('#statusText').textContent = text;
    const online = Conn.state === 'online' && Conn.kind !== 'sim';
    $('#qbConn').classList.toggle('on', online);
    $('#qbConnLabel').textContent = online ? '已連線' : Conn.state === 'connecting' ? '連線中' : '連線';
    renderBoardFlag();
  }
  function renderBoardFlag() {
    const f = $('#boardFlag'), s = $('span', f);
    let text, cls = 'flag board';
    if (Conn.state !== 'online') { text = Conn.state === 'connecting' ? (Conn.msg || '連線中…') : '未連線 · 畫面預覽'; } else if (Conn.kind === 'sim') { text = '模擬 SG90（0.1 秒／60°）'; } else if (Conn.kind === 'webduino') { text = 'Webduino Smart · 腳位 ' + (connForm.webduino.pin); cls += ' on'; } else {
      const fresh = E.reported != null && now() - E.reportedAt < 2000;
      if (Conn.board === false) { text = '開發板離線'; cls += ' off'; } else if (fresh) { text = '開發板回報 ' + Math.round(E.reported) + '°'; cls += ' on'; } else if (Conn.board === true) { text = '開發板在線'; cls += ' on'; } else { text = 'Broker 已連線 · 等待開發板'; }
    }
    if (f.className !== cls) f.className = cls;
    setText(s, text);
  }
  function renderRec() {
    $('#qbRec').classList.toggle('on', Rec.on);
    $('#qbRecLabel').textContent = Rec.on ? '停止' : '錄製';
    $('#recFlag').hidden = !Rec.on;
  }
  function drawSpark() {
    const f = fitCanvas(UI.spark); if (!f) return;
    const g = f.g; g.clearRect(0, 0, f.w, f.h);
    g.strokeStyle = COLORS['--line-2']; g.lineWidth = 1; g.setLineDash([2, 5]);
    [0, 90, 180].forEach(a => { const y = f.h - 3 - a / 180 * (f.h - 6); g.beginPath(); g.moveTo(0, y); g.lineTo(f.w, y); g.stroke(); });
    g.setLineDash([]);
    const n = 200;
    g.globalAlpha = 0.75; plotSeries(g, E.hist.map(x => x[0]), f.w, f.h, COLORS['--blue'], 1.4, n);
    g.globalAlpha = 1; plotSeries(g, E.hist.map(x => x[1]), f.w, f.h, COLORS['--accent'], 2.2, n);
  }
  let lastStats = 0, lastLog = 0;
  function render(t) {
    setText(UI.angle, String(Math.round(E.out)));
    setText(UI.target, fmtDeg(E.target));
    setText(UI.source, E.source);
    G.horn.setAttribute('transform', 'rotate(' + (E.visual - 90).toFixed(2) + ' ' + CX + ' ' + CY + ')');
    G.prog.setAttribute('d', arcD(0, E.visual, GR));
    G.target.setAttribute('transform', 'rotate(' + (E.target - 90).toFixed(2) + ' ' + CX + ' ' + CY + ')');
    drawSpark();
    if (Rec.on) setText(UI.recTime, ((t - Rec.t0) / 1000).toFixed(1));
    if (t - lastStats > 250) {
      lastStats = t;
      while (E.sendTimes.length && E.sendTimes[0] < t - 1000) E.sendTimes.shift();
      setText(UI.rate, String(E.sendTimes.length));
      setText(UI.sent, E.sent.toLocaleString('zh-TW'));
      renderBoardFlag();
    }
    if (t - lastLog > 200) { lastLog = t; renderLog(); }
  }
  const DIR = { out: ['↑', 'out'], in: ['↓', 'in'], sys: ['•', 'sys'], err: ['!', 'err'] };
  const pad = (n, l) => String(n).padStart(l || 2, '0');
  function renderLog() {
    if (!logDirty) return;
    setText($('#logCount'), logBuf.length + ' 則');
    const card = $('#logCard');
    if (!card.open || logPaused) return;
    logDirty = false;
    $('#logList').innerHTML = logBuf.slice(0, 120).map(e => '<li class="' + DIR[e.dir][1] + '"><time>' + pad(e.t.getHours()) + ':' + pad(e.t.getMinutes()) + ':' + pad(e.t.getSeconds()) + '.' + pad(e.t.getMilliseconds(), 3) + '</time><span class="dir">' + DIR[e.dir][0] + '</span><span class="m">' + esc(e.main) + '</span>' + (e.detail ? '<span class="d">' + esc(e.detail) + '</span>' : '') + '</li>').join('');
  }

  /* ═════════════════════ 11. 主迴圈 ═════════════════════ */
  let active = null, lastT = now();
  function loop(t) {
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000)); lastT = t;
    if (active && active.ctl.tick) { try { active.ctl.tick(t, dt); } catch (e) { console.error(e); } }
    Seq.tick(t);
    const smooth = active && active.def.smooth && !Seq.active, tau = cfg.smooth * 0.6;
    if (smooth && tau > 0.005) E.out += (E.target - E.out) * (1 - Math.exp(-dt / tau)); else E.out = E.target;
    E.out = clamp(E.out, cfg.min, cfg.max);
    sendIfNeeded(t);
    Rec.tick(t);
    let goal = E.out;
    if (Conn.state === 'online' && E.lastSent != null) {
      goal = E.lastSent;
      if (E.reported != null && t - E.reportedAt < 2000) goal = cfg.invert ? 180 - E.reported : E.reported;
    }
    const step = SERVO_SPEED * dt;
    E.visual += clamp(goal - E.visual, -step, step);
    if (t - E.histAt >= 50) { E.histAt = t; E.hist.push([E.target, E.visual]); if (E.hist.length > 200) E.hist.shift(); }
    render(t);
    requestAnimationFrame(loop);
  }

  /* ═════════════════════ 12. 模式切換 ═════════════════════ */
  function buildDock() {
    const dock = $('#dock');
    dock.innerHTML = GROUPS.map(gr => '<div class="dock-group"><span class="dock-label">' + gr[1] + '</span><div class="dock-chips">' +
      MODES.filter(m => m.group === gr[0]).map(m => '<button class="chip' + (m.supported && !m.supported() ? ' na' : '') + '" type="button" role="tab" data-id="' + m.id + '" aria-selected="false"' + (m.supported && !m.supported() ? ' title="這個瀏覽器可能不支援"' : '') + '>' + icon(m.icon) + '<span>' + m.name + '</span></button>').join('') +
      '</div></div>').join('');
    dock.addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) { activate(c.dataset.id); haptic(6); } });
  }
  function activate(id) {
    const def = MODES.find(m => m.id === id) || MODES[0];
    if (active && active.def === def) return;
    if (active) { try { if (active.ctl.deactivate) active.ctl.deactivate(); } catch (e) { console.error(e); } active.el.hidden = true; }
    Seq.stop();
    const panels = $('#panels');
    let el = $('[data-mode="' + def.id + '"]', panels);
    if (!el) {
      el = document.createElement('div'); el.className = 'panel-body'; el.dataset.mode = def.id; el.setAttribute('role', 'tabpanel');
      panels.appendChild(el);
      def.ctl = def.build(el) || {};
    }
    el.hidden = false;
    active = { def, ctl: def.ctl, el };
    $('#panelIco').innerHTML = icon(def.icon);
    $('#panelTitle').textContent = def.name;
    $('#panelDesc').textContent = def.desc;
    const api = $('#panelApi'), sup = !def.supported || def.supported();
    api.textContent = def.api + (sup ? '' : ' · 此瀏覽器不支援');
    api.classList.toggle('na', !sup);
    $$('#dock .chip').forEach(c => c.setAttribute('aria-selected', String(c.dataset.id === def.id)));
    $('#gauge').classList.toggle('draggable', def.group === 'touch');
    E.source = def.name;
    E.out = E.target;
    store.set('mode', def.id);
    try { if (active.ctl.activate) active.ctl.activate(); } catch (e) { console.error(e); }
    // 只把模式列「水平」捲到目前的模式，不要讓整頁上下捲動
    const dock = $('#dock'), chip = $('#dock .chip[data-id="' + def.id + '"]');
    if (chip && dock.scrollWidth > dock.clientWidth) {
      const dr = dock.getBoundingClientRect(), cr = chip.getBoundingClientRect();
      const left = dock.scrollLeft + (cr.left - dr.left) - (dock.clientWidth - cr.width) / 2;
      try { dock.scrollTo({ left, behavior: 'smooth' }); } catch (e) { dock.scrollLeft = left; }
    }
  }

  /* ═════════════════════ 13. 底部面板（連線、分享、設定） ═════════════════════ */
  let openSheetEl = null;
  function openSheet(id) {
    if (openSheetEl) closeSheet(true);
    const s = $(id), bd = $('#backdrop');
    bd.hidden = false; s.hidden = false;
    requestAnimationFrame(() => { bd.classList.add('show'); s.classList.add('show'); });
    openSheetEl = s;
    const f = $('[data-close]', s); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
  }
  function closeSheet(instant) {
    const s = openSheetEl; if (!s) return;
    const bd = $('#backdrop');
    s.classList.remove('show'); bd.classList.remove('show');
    openSheetEl = null;
    const done = () => { if (!s.classList.contains('show')) s.hidden = true; if (!openSheetEl) bd.hidden = true; };
    if (instant) done(); else setTimeout(done, 320);
  }

  const DEFAULT_DEVICE = 'YdrMW'; // 預設的 Webduino Device ID
  const DEFAULT_TOPIC = '30-06';  // 預設的 MQTT Topic
  const defaultForm = () => ({ kind: 'sim', webduino: { device: DEFAULT_DEVICE, pin: 5, autoReconnect: true }, mqtt: { broker: BROKERS[0].url, topic: DEFAULT_TOPIC, qos: 0, retain: false, user: '' } });
  const connForm = (function () {
    const d = defaultForm(), s = store.get('connForm', null) || {};
    const f = { kind: s.kind || d.kind, webduino: Object.assign(d.webduino, s.webduino), mqtt: Object.assign(d.mqtt, s.mqtt) };
    if (!f.webduino.device) f.webduino.device = DEFAULT_DEVICE; // 之前存過空白時也補上預設值
    return f;
  })();
  let mqPass = '', connWaiting = false, uiKind = connForm.kind;

  function readForm() {
    connForm.webduino.device = $('#wdDevice').value.trim();
    connForm.webduino.pin = +$('#wdPin').value;
    connForm.webduino.autoReconnect = $('#wdAuto').checked;
    connForm.mqtt.broker = $('#mqBroker').value.trim();
    connForm.mqtt.topic = $('#mqTopic').value.trim();
    connForm.mqtt.user = $('#mqUser').value.trim();
    connForm.mqtt.retain = $('#mqRetain').checked;
    mqPass = $('#mqPass').value;
  }
  function fillForm() {
    $('#wdDevice').value = connForm.webduino.device;
    $('#wdPin').value = String(connForm.webduino.pin);
    $('#wdAuto').checked = connForm.webduino.autoReconnect;
    $('#mqBroker').value = connForm.mqtt.broker;
    $('#mqTopic').value = connForm.mqtt.topic;
    $('#mqUser').value = connForm.mqtt.user;
    $('#mqRetain').checked = connForm.mqtt.retain;
    UI.qos.set(connForm.mqtt.qos);
    showKind(uiKind);
    updateTopicTable(); updateBrokerChips();
  }
  function showKind(k) {
    uiKind = k;
    $$('#connSheet .kind').forEach(b => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
    $$('#connSheet .kind-pane').forEach(p => { p.hidden = p.dataset.pane !== k; });
    syncConnSheet();
  }
  function updateTopicTable() { const base = $('#mqTopic').value.trim().replace(/\/+$/, '') || '（Topic）'; $$('#connSheet [data-topic]').forEach(c => { c.textContent = base + c.dataset.topic; }); }
  function updateBrokerChips() { const v = $('#mqBroker').value.trim(); $$('#brokerChips .pill-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.url === v))); }
  function validate(k) {
    if (k === 'webduino') {
      const d = connForm.webduino.device;
      if (!d) return '請輸入 Device ID（在 Webduino 開發板的貼紙或 Blockly 的開發板積木上）';
      if (!/^[A-Za-z0-9_-]+$/.test(d)) return 'Device ID 只能包含英文與數字';
    }
    if (k === 'mqtt') {
      const b = connForm.mqtt.broker, t = connForm.mqtt.topic;
      if (!/^wss?:\/\//i.test(b)) return 'Broker 網址要以 wss:// 或 ws:// 開頭（瀏覽器只能用 WebSocket 連 MQTT）';
      if (location.protocol === 'https:' && /^ws:\/\//i.test(b)) return 'HTTPS 網頁不能連 ws://，請改用 wss:// 的 Broker';
      if (!t) return '請輸入 Topic';
      if (/[+#]/.test(t)) return 'Publish 用的 Topic 不能包含萬用字元 + 或 #';
    }
    return '';
  }
  function setConnMsg(kind, text) {
    const m = $('#connMsg');
    if (!text) { m.hidden = true; m.innerHTML = ''; return; }
    m.hidden = false;
    m.innerHTML = '<div class="notice ' + kind + '">' + icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info') + '<div><p style="margin:0;color:var(--text)">' + esc(text) + '</p></div></div>';
  }
  function syncConnSheet() {
    const btn = $('#connectBtn'); if (!btn) return;
    const same = Conn.driver && Conn.kind === uiKind;
    if (same && Conn.state === 'online' && uiKind !== 'sim') { btn.textContent = '中斷連線'; btn.className = 'btn danger'; } else if (same && Conn.state === 'connecting') { btn.textContent = '取消連線'; btn.className = 'btn'; } else { btn.textContent = uiKind === 'sim' ? '使用模擬模式' : '連線'; btn.className = 'btn primary'; }
    if (!openSheetEl || openSheetEl.id !== 'connSheet') return;
    if (same && Conn.state === 'connecting') setConnMsg('info', Conn.msg || '連線中…');
    else if (same && Conn.state === 'error') setConnMsg('err', Conn.msg);
    else if (same && Conn.state === 'online') setConnMsg('ok', uiKind === 'sim' ? '目前是模擬模式。' : '已連線：' + Conn.driver.short);
    if (connWaiting && Conn.state === 'online') { connWaiting = false; setTimeout(() => { if (openSheetEl && openSheetEl.id === 'connSheet') closeSheet(); }, 500); }
    if (connWaiting && Conn.state === 'error') connWaiting = false;
  }
  function doConnect() {
    readForm();
    const k = uiKind;
    if (Conn.driver && Conn.kind === k && (Conn.state === 'online' || Conn.state === 'connecting') && k !== 'sim') { disconnect(); setConnMsg('', ''); syncConnSheet(); return; }
    const err = validate(k);
    if (err) { setConnMsg('err', err); return; }
    connForm.kind = k;
    store.set('connForm', connForm);
    connWaiting = true;
    if (k === 'webduino') connect('webduino', Object.assign({}, connForm.webduino));
    else if (k === 'mqtt') connect('mqtt', Object.assign({}, connForm.mqtt, { pass: mqPass }));
    else connect('sim', {});
  }
  function buildConnSheet() {
    $('#wdPin').innerHTML = PINS.map(p => '<option value="' + p + '">' + (p < 10 ? '0' + p : p) + (p === 5 ? '（接線圖預設）' : '') + '</option>').join('');
    $('#brokerChips').innerHTML = BROKERS.map(b => '<button class="pill-btn" type="button" data-url="' + b.url + '">' + b.name + '</button>').join('');
    UI.qos = segControl([['0', 'QoS 0 最多一次'], ['1', 'QoS 1 至少一次']], connForm.mqtt.qos, v => { connForm.mqtt.qos = +v; });
    $('#mqQosSlot').replaceWith(UI.qos);
    $$('#connSheet .kind').forEach(b => b.addEventListener('click', () => { showKind(b.dataset.kind); setConnMsg('', ''); haptic(6); }));
    $('#brokerChips').addEventListener('click', e => { const b = e.target.closest('.pill-btn'); if (!b) return; $('#mqBroker').value = b.dataset.url; updateBrokerChips(); });
    $('#mqBroker').addEventListener('input', updateBrokerChips);
    $('#mqTopic').addEventListener('input', updateTopicTable);
    $('#mqRandom').addEventListener('click', () => { $('#mqTopic').value = 'classroom/servo/' + randId(4); updateTopicTable(); haptic(8); });
    $('#connectBtn').addEventListener('click', doConnect);
    $('#shareBtn').addEventListener('click', () => { readForm(); openShare(); });
    fillForm();
  }

  // 分享：把連線設定放進網址，產生 QR Code
  function shareUrl() {
    const u = new URL(location.href); u.hash = '';
    const p = new URLSearchParams();
    if (uiKind === 'webduino') { p.set('conn', 'webduino'); if (connForm.webduino.device) p.set('device', connForm.webduino.device); p.set('pin', connForm.webduino.pin); } else if (uiKind === 'mqtt') { p.set('conn', 'mqtt'); p.set('broker', connForm.mqtt.broker); p.set('topic', connForm.mqtt.topic); if (connForm.mqtt.qos) p.set('qos', '1'); if (connForm.mqtt.user) p.set('user', connForm.mqtt.user); } else p.set('conn', 'sim');
    if (active) p.set('mode', active.def.id);
    u.search = p.toString();
    return u.toString();
  }
  async function openShare() {
    const url = shareUrl();
    openSheet('#shareSheet');
    $('#shareUrl').value = url;
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
    $('#shareWarn').innerHTML = local
      ? '<div class="notice warn">' + icon('alert') + '<div><b>這是電腦本機的網址</b><p>手機掃描後打不開。請先把 servo-remote 資料夾放到 GitHub Pages 等 HTTPS 網站，再從那個網址分享。</p></div></div>'
      : (location.protocol !== 'https:' ? '<div class="notice warn">' + icon('alert') + '<div><b>不是 HTTPS</b><p>手機可以開啟，但感測器、麥克風、相機會被封鎖。</p></div></div>' : '');
    const box = $('#qrBox');
    box.className = 'qr-box loading'; box.textContent = '產生中…';
    try {
      await loadScript(QR_JS);
      const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
      let svg = '';
      try { svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { svg = ''; }
      if (svg.indexOf('<svg') < 0) svg = qr.createSvgTag(4, 0);
      box.className = 'qr-box'; box.innerHTML = svg;
    } catch (e) { box.className = 'qr-box loading'; box.textContent = '無法產生 QR Code（需要網路），請直接複製網址'; }
  }

  // 設定面板
  function buildSettings() {
    const body = $('#settingsBody');
    body.innerHTML = '';
    const sec = (title, nodes) => { const s = h('<section class="set-sec"><h3>' + title + '</h3></section>'); nodes.forEach(n => s.appendChild(n)); body.appendChild(s); return s; };
    const fMin = rangeField({ label: '最小角度', min: 0, max: 90, value: cfg.min, unit: '°', onInput: v => { cfg.min = Math.min(v, cfg.max - 10); fMin.set(cfg.min); saveCfg(); updateLimits(); } });
    const fMax = rangeField({ label: '最大角度', min: 90, max: 180, value: cfg.max, unit: '°', onInput: v => { cfg.max = Math.max(v, cfg.min + 10); fMax.set(cfg.max); saveCfg(); updateLimits(); } });
    sec('輸出安全', [
      fMin, fMax,
      switchField('反轉方向', cfg.invert, v => { cfg.invert = v; saveCfg(); E.lastSent = null; }, '伺服馬達裝反了？送出 180 − 角度'),
      rangeField({ label: '感測器平滑程度', min: 0, max: 1, step: 0.05, value: cfg.smooth, fmt: v => Math.round(v * 100) + '%', onInput: v => { cfg.smooth = v; saveCfg(); } }),
      rangeField({ label: '每秒最多送出', min: 5, max: 30, value: cfg.rate, unit: ' 則', onInput: v => { cfg.rate = v; saveCfg(); } }),
      h('<p class="hint">限制角度可避免機構卡死；平滑可減少感測器抖動；限制送出頻率可避免塞爆 Broker 和開發板。</p>')
    ]);
    const theme = segControl([['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']], cfg.theme, v => { cfg.theme = v; saveCfg(); applyTheme(); });
    const themeF = h('<div class="field"><span class="field-label">外觀</span></div>'); themeF.appendChild(theme);
    sec('操作體驗', [
      switchField('震動回饋', cfg.haptics, v => { cfg.haptics = v; saveCfg(); haptic(20); }, 'Android 支援；iPhone 的 Safari 不支援網頁震動'),
      switchField('螢幕保持開啟', cfg.wake, v => { cfg.wake = v; saveCfg(); requestWake(); }, '用感測器控制時避免螢幕自動關閉'),
      themeF
    ]);
    const S = [
      ['HTTPS 安全連線', window.isSecureContext, 'isSecureContext'],
      ['方向感測（陀螺儀）', 'DeviceOrientationEvent' in window, 'DeviceOrientationEvent'],
      ['動作感測（加速度計）', 'DeviceMotionEvent' in window, 'DeviceMotionEvent'],
      ['麥克風／相機', hasMedia(), 'getUserMedia'],
      ['語音辨識', hasSR(), 'SpeechRecognition'],
      ['震動', !!navigator.vibrate, 'navigator.vibrate'],
      ['螢幕常亮', 'wakeLock' in navigator, 'Wake Lock API']
    ];
    sec('這支手機／瀏覽器支援', [h('<ul class="support">' + S.map(r => '<li><span>' + r[0] + ' <code>' + r[2] + '</code></span><span class="' + (r[1] ? 'y' : 'n') + '">' + (r[1] ? '✓ 支援' : '✕ 不支援') + '</span></li>').join('') + '</ul>')]);
    const reset = h('<button class="btn danger block" type="button">清除這個網頁在本機的所有設定</button>');
    reset.addEventListener('click', () => { if (confirm('要清除連線設定、最愛角度與錄製片段嗎？')) { store.clear(); location.reload(); } });
    sec('重設', [reset]);
  }

  // 螢幕常亮
  let wakeLock = null;
  async function requestWake() {
    if (!cfg.wake) { if (wakeLock) { try { await wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; } return; }
    if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { /* 需要使用者互動或不支援 */ }
  }

  /* ═════════════════════ 14. 啟動 ═════════════════════ */
  function init() {
    hydrateIcons(document);
    applyTheme();
    UI.angle = $('#angleNum'); UI.target = $('#targetNum'); UI.source = $('#sourceText'); UI.rate = $('#rateNum'); UI.sent = $('#sentNum'); UI.spark = $('#spark'); UI.recTime = $('#recTime');
    if (!window.isSecureContext) $('#secureBanner').hidden = false;
    buildGauge();
    buildDock();
    buildConnSheet();

    // 快捷列
    $('#qbCenter').addEventListener('click', () => {
      if (active && active.ctl.recenter) active.ctl.recenter();
      else { setTarget(clamp(90, cfg.min, cfg.max), { user: true, source: '回中' }); toast('回到 90°'); }
      haptic(12);
    });
    $('#qbRec').addEventListener('click', () => (Rec.on ? Rec.stop() : Rec.start()));
    $('#qbLock').addEventListener('click', () => {
      E.locked = !E.locked;
      const b = $('#qbLock'); b.classList.toggle('on', E.locked);
      $('svg', b).outerHTML = icon(E.locked ? 'lock' : 'unlock');
      $('span', b).textContent = E.locked ? '解除鎖定' : '鎖定輸出';
      $('#lockFlag').hidden = !E.locked;
      if (!E.locked) E.lastSent = null;
      toast(E.locked ? '輸出已鎖定：手機怎麼動，伺服馬達都不會轉' : '已解除鎖定', E.locked ? 'warn' : 'ok');
      haptic(15);
    });
    $('#qbConn').addEventListener('click', () => { showKind(Conn.driver ? Conn.kind : connForm.kind); openSheet('#connSheet'); syncConnSheet(); });
    $('#statusBtn').addEventListener('click', () => { showKind(Conn.driver ? Conn.kind : connForm.kind); openSheet('#connSheet'); syncConnSheet(); });
    $('#settingsBtn').addEventListener('click', () => { buildSettings(); openSheet('#settingsSheet'); });
    $('#backdrop').addEventListener('click', () => closeSheet());
    $$('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet()));
    $('#copyUrl').addEventListener('click', async () => {
      const inp = $('#shareUrl');
      try { await navigator.clipboard.writeText(inp.value); toast('已複製網址', 'ok'); } catch (e) { inp.select(); try { document.execCommand('copy'); toast('已複製網址', 'ok'); } catch (er) { toast('請手動複製', 'warn'); } }
    });
    $('#logPause').addEventListener('click', e => { logPaused = !logPaused; e.currentTarget.textContent = logPaused ? '繼續' : '暫停'; logDirty = true; });
    $('#logClear').addEventListener('click', () => { logBuf.length = 0; logDirty = true; $('#logList').innerHTML = ''; });
    $('#logCard').addEventListener('toggle', () => { logDirty = true; });

    // 新手導覽
    if (!store.get('introDone', false)) $('#intro').hidden = false;
    $('#introClose').addEventListener('click', () => { $('#intro').hidden = true; store.set('introDone', true); });

    // 鍵盤（電腦投影示範用）
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && openSheetEl) { closeSheet(); return; }
      if (openSheetEl || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (!active || active.def.group !== 'touch') return;
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key];
      if (d) { e.preventDefault(); setTarget(E.target + d * (e.shiftKey ? 10 : 1), { user: true, source: '鍵盤' }); } else if (e.key === 'Home') setTarget(cfg.min, { user: true, source: '鍵盤' }); else if (e.key === 'End') setTarget(cfg.max, { user: true, source: '鍵盤' });
    });

    window.addEventListener('pointerdown', requestWake, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestWake(); });
    if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', readColors); }

    // 網址參數（QR 分享）優先，其次是上次的模式
    const q = new URLSearchParams(location.search);
    const startMode = q.get('mode') || store.get('mode', 'slider');
    activate(MODES.some(m => m.id === startMode) ? startMode : 'slider');
    renderRec();

    const qc = q.get('conn');
    if (qc === 'webduino' && q.get('device')) {
      Object.assign(connForm.webduino, { device: q.get('device'), pin: PINS.indexOf(+q.get('pin')) >= 0 ? +q.get('pin') : 5 });
      connForm.kind = uiKind = 'webduino'; fillForm(); store.set('connForm', connForm);
      connect('webduino', Object.assign({}, connForm.webduino));
    } else if (qc === 'mqtt' && q.get('topic')) {
      Object.assign(connForm.mqtt, { broker: q.get('broker') || BROKERS[0].url, topic: q.get('topic'), qos: q.get('qos') === '1' ? 1 : 0, user: q.get('user') || '' });
      connForm.kind = uiKind = 'mqtt'; fillForm(); store.set('connForm', connForm);
      if (!validate('mqtt')) connect('mqtt', Object.assign({}, connForm.mqtt));
    } else {
      connect('sim', {});
    }
    log('sys', '伺服馬達遙控台已啟動', navigator.userAgent.indexOf('iPhone') >= 0 ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : '電腦');
    requestAnimationFrame(t => { lastT = t; loop(t); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
