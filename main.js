/* ==========================================================================
   Crisp Focus - Spring-Eased Cursor, Typewriter Scrolling & Local Ambient Engine (v1.8.0)
   Crafted by letschips (Xiaohongshu)
   ========================================================================== */

var obsidian = require("obsidian");
const { requestUrl } = obsidian;

const CRISP_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiz41HIDpD59SH3DjKnovUO+EEhTJXjvmiug/ev9t4ZQ=
-----END PUBLIC KEY-----`;

const CRISP_LICENSE_PRODUCTS = [
  "Crisp Suite",
  "Crisp Organize",
  "Crisp ASR",
  "Crisp Annotations",
  "Crisp File Explorer",
  "Crisp Focus",
  "Crisp Reading Rail",
  "Crisp Base",
];


function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const raw = atob(padded);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}

function getCryptoSubtle(windowObj = window) {
  return windowObj && windowObj.crypto && windowObj.crypto.subtle
    ? windowObj.crypto.subtle
    : null;
}

async function importEd25519PublicKey(pem, windowObj = window) {
  const subtle = getCryptoSubtle(windowObj);
  if (!subtle) {
    throw new Error("当前 Obsidian 版本不支持 WebCrypto Ed25519");
  }
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  return await subtle.importKey(
    "spki",
    der.buffer,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

async function verifyLicenseCode(licenseCode, targetPluginId = "crisp-focus", app = null, windowObj = window, options = {}) {
  const trimmed = (licenseCode || "").trim();
  if (!trimmed) return { valid: false, reason: "授权码为空" };
  const parts = trimmed.split(".");
  if (parts.length !== 2) return { valid: false, reason: "授权码格式无效" };
  const [payloadBase64, signatureBase64] = parts;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadBase64));
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "授权数据无效" };
    }
    if (!CRISP_LICENSE_PRODUCTS.includes(payload.product)) return { valid: false, reason: "授权码不属于 Crisp 系列插件" };
    const features = Array.isArray(payload.features) ? payload.features : [];
    if (!features.includes("all") && !features.includes(targetPluginId)) {
      return { valid: false, reason: `该授权码未包含 ${targetPluginId} 权限` };
    }
    if (payload.expiresAt) {
      const expiresAt = new Date(payload.expiresAt).getTime();
      if (!Number.isFinite(expiresAt)) {
        return { valid: false, reason: "授权到期时间无效" };
      }
      if (expiresAt < Date.now()) {
        return { valid: false, reason: `授权已于 ${String(payload.expiresAt).split("T")[0]} 到期` };
      }
    }
    const publicKey = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM, windowObj);
    const isValid = await getCryptoSubtle(windowObj).verify(
      "Ed25519",
      publicKey,
      base64UrlToUint8Array(signatureBase64),
      new TextEncoder().encode(payloadBase64)
    );
    if (!isValid) return { valid: false, reason: "授权签名无效" };
    if (options.skipOnline) return { valid: true, payload, source: "offline" };

    try {
      const deviceId = app?.appId || (app?.vault?.getName ? "vault-" + encodeURIComponent(app.vault.getName()) : "device-default");
      const res = await Promise.race([
        requestUrl({
          url: "https://license.letschips.xyz/api/verify-device",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            licenseCode: trimmed,
            deviceId: deviceId,
            action: "activate",
            pluginId: targetPluginId
          }),
          throw: false
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Crisp license check timeout")), 2500))
      ]);

      let cloudResult = null;
      try {
        cloudResult = res.json;
      } catch {
        cloudResult = null;
      }

      // 1. 明确的服务端业务拒绝（200/400/401/403 且带有明确的 valid: false）
      const isAuthDenial =
        (res.status === 200 || res.status === 400 || res.status === 401 || res.status === 403) &&
        cloudResult !== null &&
        cloudResult.valid === false;

      if (isAuthDenial) {
        return {
          valid: false,
          reason: cloudResult?.reason || "授权已被服务端拒绝或设备数已达上限"
        };
      }

      // 2. 服务端明确批准（200 OK 且 valid: true）
      if (res.status === 200 && cloudResult && cloudResult.valid === true) {
        return { valid: true, payload, message: cloudResult.message, source: "online" };
      }

      // 其余情况（404/408/429/5xx、网关故障等）均视为服务不可用，降级离线可用
      if (res.status >= 400) {
        console.warn(`[Crisp Focus] License server unavailable (status ${res.status}), offline fallback`);
      }
    } catch (netErr) {
      return { valid: true, payload, message: "离线验证成功", source: "offline" };
    }

    return { valid: true, payload, message: "离线验证成功", source: "offline" };
  } catch (e) {
    return { valid: false, reason: `解析授权码失败: ${e.message}` };
  }
}

const MAX_TIMER_DELAY = 0x7fffffff;

class CrispFocusLicenseManager {
  constructor(app, settings, options = {}) {
    this.app = app;
    this.settings = settings;
    this.verifier = options.verifier || verifyLicenseCode;
    this.now = options.now || (() => Date.now());
    this.onEntitlementLost = options.onEntitlementLost || (() => {});
    this.windowObj = options.windowObj || window;
    this.setTimer = options.setTimeout || ((fn, delay) => this.windowObj.setTimeout(fn, delay));
    this.clearTimer = options.clearTimeout || ((timer) => this.windowObj.clearTimeout(timer));
    this.expiryTimer = null;
    this.status = { valid: false, reason: "尚未验证" };

    this.verificationId = 0;
    this.backgroundVerification = null;
  }

  isEntitled() {
    if (this.status.valid !== true) return false;
    const expiresAt = this.expiryTime();
    return expiresAt === null || expiresAt > this.now();
  }

  expiryTime() {
    const raw = this.status.valid === true ? this.status.payload?.expiresAt : null;
    if (!raw) return null;
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : null;
  }

  // 应用一直开着跨过到期时间时，到点发出失效通知，让各功能收尾。
  // setTimeout 超过 2^31-1 毫秒会溢出立即触发，所以远期到期分段等待。
  scheduleExpiry() {
    if (this.expiryTimer !== null) {
      this.clearTimer(this.expiryTimer);
      this.expiryTimer = null;
    }
    const expiresAt = this.expiryTime();
    if (expiresAt === null) return;
    const delay = expiresAt - this.now();
    if (delay <= 0) {
      this.expire();
      return;
    }
    const clamped = delay + 1000 > MAX_TIMER_DELAY;
    this.expiryTimer = this.setTimer(() => {
      this.expiryTimer = null;
      if (this.expiryTime() !== null && this.expiryTime() <= this.now()) this.expire();
      else if (clamped) this.scheduleExpiry();
    }, clamped ? MAX_TIMER_DELAY : delay + 1000);
  }

  expire() {
    if (this.status.valid !== true) return;
    this.status = { valid: false, reason: `授权已于 ${String(this.status.payload.expiresAt).split("T")[0]} 到期` };
    this.onEntitlementLost(this.status);
  }

  destroy() {
    if (this.expiryTimer !== null) this.clearTimer(this.expiryTimer);
    this.expiryTimer = null;
  }

  getStatus() {
    return this.status;
  }

  async initialize() {
    const id = ++this.verificationId;
    const result = await this.verifier(this.settings.licenseCode, "crisp-focus", this.app, this.windowObj, { skipOnline: true });
    if (id !== this.verificationId) return { valid: false, stale: true, reason: "授权校验已被更新" };
    this.status = result;
    this.scheduleExpiry();
    if (result.valid) this.backgroundVerification = this.verify();
    return result;
  }

  async verify(code = this.settings.licenseCode) {
    const id = ++this.verificationId;
    const wasEntitled = this.isEntitled();
    let result;
    try {
      result = await this.verifier(code, "crisp-focus", this.app, this.windowObj);
    } catch (error) {
      result = { valid: false, reason: `授权验证失败: ${error.message || error}` };
    }

    if (id !== this.verificationId) return { valid: false, stale: true, reason: "授权校验已被更新" };

    if (result.valid && result.source === "online") {
      this.settings.licenseLastOnlineAt = this.now();
    }

    this.status = result;
    if (wasEntitled && !this.isEntitled()) {
      this.onEntitlementLost(result);
    }
    this.scheduleExpiry();
    return result;
  }
}

// Inline monkey-around helper
function around(target, patches) {
  const unhooks = [];
  for (const key of Object.keys(patches)) {
    const orig = target[key];
    if (typeof orig === "function") {
      const patch = patches[key](orig);
      target[key] = patch;
      unhooks.push(() => {
        if (target[key] === patch) target[key] = orig;
      });
    }
  }
  return () => unhooks.forEach((fn) => fn());
}

// --------------------------------------------------------------------------
// 1. Multi-Theme WebAudio Keypress & HD Local MP3 Ambient Audio Engine
// --------------------------------------------------------------------------
/* 环境音素材首尾自带淡入淡出（风声结尾约 2.75 秒），雨声首尾也接不上。
   循环时跳过这两段，再把尾巴交叉淡化进开头，拼成一段首尾相接的 buffer。 */
const AMBIENT_LOOP_HEAD = 0.75;
const AMBIENT_LOOP_TAIL = 3;
const AMBIENT_CROSSFADE = 4;
const AMBIENT_FADE_IN = 1.5;
const AMBIENT_FADE_OUT = 0.8;

function buildAmbientLoop(ctx, source) {
  const rate = source.sampleRate;
  const head = Math.round(AMBIENT_LOOP_HEAD * rate);
  const fade = Math.round(AMBIENT_CROSSFADE * rate);
  const region = source.length - head - Math.round(AMBIENT_LOOP_TAIL * rate);
  if (region <= fade * 2) return source;

  const length = region - fade;
  const loop = ctx.createBuffer(source.numberOfChannels, length, rate);
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel).subarray(head, head + region);
    const output = loop.getChannelData(channel);
    output.set(input.subarray(0, length));
    // 等功率交叉淡化：噪声类素材叠加时响度不塌
    for (let i = 0; i < fade; i++) {
      const angle = ((i + 0.5) / fade) * Math.PI / 2;
      output[i] = input[i] * Math.sin(angle) + input[length + i] * Math.cos(angle);
    }
  }
  return loop;
}

/* 打字音效：每个按键由几层声音叠成，大致是「敲击瞬态 + 键体 + 共鸣」。
   noise 层是滤波后的白噪声，tone 层是振荡器；decay 是衰减到 -60dB 的时间。
   每次按下随机微调力度、音高和滤波，避免一串字听起来一模一样。 */
const RETRO_NOTES = [1046.5, 1174.66, 1318.51, 1567.98, 1760];
const TYPING_SOUNDS = {
  typewriter: {
    gain: 1,
    jitter: 0.05,
    bell: "bell",
    char: [
      { noise: "bandpass", freq: 3800, q: 0.8, level: 0.35, decay: 0.008 },
      { noise: "bandpass", freq: 1500, q: 1.4, level: 0.9, decay: 0.035 },
      { tone: "sine", freq: 190, to: 130, level: 0.3, decay: 0.04 },
    ],
    // 中文每次空格选字都会响，比字符键略沉一点即可，低频别轰
    space: [
      { noise: "bandpass", freq: 2800, q: 0.8, level: 0.32, decay: 0.008 },
      { noise: "bandpass", freq: 900, q: 1.2, level: 1.28, decay: 0.045 },
      { tone: "sine", freq: 220, to: 160, level: 0.32, decay: 0.05 },
    ],
    // 退格更轻、更短、更高，一听就知道是删
    backspace: [
      { noise: "bandpass", freq: 4200, q: 0.8, level: 0.69, decay: 0.005 },
      { noise: "bandpass", freq: 2600, q: 2, level: 1.38, decay: 0.018 },
    ],
    enter: [
      { noise: "bandpass", freq: 2800, q: 0.8, level: 0.37, decay: 0.01 },
      { noise: "bandpass", freq: 1000, q: 1, level: 1.05, decay: 0.06 },
      { tone: "sine", freq: 170, to: 120, level: 0.31, decay: 0.06 },
      // 回车时托架滑回去的一下「刷」
      { noise: "bandpass", freq: 1800, q: 0.8, level: 0.12, delay: 0.05, attack: 0.03, decay: 0.12 },
    ],
  },
  mechanical: {
    gain: 1,
    jitter: 0.04,
    bell: "bell",
    // 1.7.3 原始机械键盘音色：每个键一声下滑的正弦，字符、退格、回车再叠一层中频碰撞作落点和青轴的「哒」；
    // 空格（含中文选字上屏）保持原来那声纯的低沉「咚」
    char: [
      { tone: "sine", freq: 320, to: 80, level: 0.65, decay: 0.025 },
      { noise: "bandpass", freq: 1200, q: 2, level: 0.75, decay: 0.01 },
      // 青轴：越过触发点时簧片弹响的一声「哒」，松开时还有一声更轻的
      { noise: "bandpass", freq: 3200, q: 3, level: 0.9, decay: 0.005 },
      { tone: "sine", freq: 3500, level: 0.12, decay: 0.006 },
      { noise: "bandpass", freq: 2800, q: 3, level: 0.2, delay: 0.07, decay: 0.004 },
    ],
    space: [
      { tone: "sine", freq: 110, to: 45, level: 0.75, decay: 0.05 },
    ],
    backspace: [
      { tone: "sine", freq: 580, to: 260, level: 0.6, decay: 0.022 },
      { noise: "bandpass", freq: 1500, q: 2, level: 0.65, decay: 0.008 },
      { noise: "bandpass", freq: 3400, q: 3, level: 0.78, decay: 0.004 },
      { tone: "sine", freq: 3700, level: 0.1, decay: 0.005 },
      { noise: "bandpass", freq: 3000, q: 3, level: 0.16, delay: 0.06, decay: 0.004 },
    ],
    enter: [
      { tone: "sine", freq: 240, to: 60, level: 0.85, decay: 0.07 },
      { noise: "bandpass", freq: 1000, q: 2, level: 0.8, decay: 0.012 },
      { noise: "bandpass", freq: 3000, q: 3, level: 0.9, decay: 0.006 },
      { tone: "sine", freq: 3300, level: 0.12, decay: 0.007 },
      { noise: "bandpass", freq: 2600, q: 3, level: 0.2, delay: 0.08, decay: 0.005 },
    ],
  },
  raindrop: {
    gain: 0.7,
    jitter: 0.15,
    bell: "bell",
    // 水滴是一声快速上扬的「滴」
    char: [
      { tone: "sine", freq: 1100, to: 1900, sweep: 0.012, level: 0.55, attack: 0.0015, decay: 0.045 },
      { noise: "bandpass", freq: 3000, level: 0.08, decay: 0.01 },
    ],
    space: [
      { tone: "sine", freq: 750, to: 1250, sweep: 0.016, level: 0.55, attack: 0.0015, decay: 0.06 },
      { noise: "bandpass", freq: 1500, q: 0.8, level: 0.088, decay: 0.015 },
    ],
    backspace: [
      { tone: "sine", freq: 1700, to: 2400, sweep: 0.008, level: 0.45, attack: 0.0015, decay: 0.025 },
    ],
    enter: [
      { tone: "sine", freq: 600, to: 1050, sweep: 0.02, level: 0.55, attack: 0.0015, decay: 0.08 },
      { tone: "sine", freq: 1400, to: 2200, sweep: 0.012, level: 0.2, delay: 0.06, attack: 0.0015, decay: 0.035 },
      { noise: "bandpass", freq: 1200, q: 0.7, level: 0.1, attack: 0.005, decay: 0.04 },
    ],
  },
  retro8bit: {
    gain: 1.5,
    jitter: 0,
    // 字符随机落在五声音阶上，连打像一段小旋律
    char: [
      { tone: "square", freq: RETRO_NOTES, cut: 3500, level: 0.22, attack: 0.002, decay: 0.04 },
    ],
    space: [
      { tone: "square", freq: 523.25, cut: 2000, level: 0.24, attack: 0.002, decay: 0.05 },
    ],
    backspace: [
      { tone: "square", freq: 784, to: 523.25, sweep: 0.025, cut: 2500, level: 0.17, attack: 0.002, decay: 0.035 },
    ],
    enter: [
      { tone: "square", freq: 1046.5, cut: 3000, level: 0.18, attack: 0.002, decay: 0.05 },
      { tone: "square", freq: 1318.51, cut: 3000, level: 0.18, delay: 0.05, attack: 0.002, decay: 0.05 },
      { tone: "square", freq: 1567.98, cut: 3000, level: 0.18, delay: 0.1, attack: 0.002, decay: 0.09 },
    ],
  },
  woodenFish: {
    gain: 0.6,
    jitter: 0.03,
    bell: "bowl",
    // 木头的几个共振频率不成整数倍，听起来才「木」
    char: [
      { tone: "sine", freq: 760, level: 0.55, decay: 0.07 },
      { tone: "sine", freq: 1976, level: 0.2, decay: 0.03 },
      { noise: "bandpass", freq: 2500, q: 1.5, level: 0.25, decay: 0.006 },
    ],
    space: [
      { tone: "sine", freq: 480, level: 0.55, decay: 0.1 },
      { tone: "sine", freq: 1248, level: 0.15, decay: 0.04 },
      { noise: "bandpass", freq: 1500, q: 1.5, level: 0.2, decay: 0.007 },
    ],
    backspace: [
      { tone: "sine", freq: 1150, level: 0.49, decay: 0.04 },
      { tone: "sine", freq: 2990, level: 0.17, decay: 0.015 },
      { noise: "bandpass", freq: 3500, q: 1.5, level: 0.21, decay: 0.004 },
    ],
    enter: [
      { tone: "sine", freq: 400, level: 0.6, decay: 0.12 },
      { tone: "sine", freq: 1040, level: 0.2, decay: 0.05 },
      { noise: "bandpass", freq: 1200, q: 1.5, level: 0.25, decay: 0.01 },
    ],
  },
};
// 回车提示音：音高放低到人耳不那么敏感的区段，泛音取整数倍，起音放软，
// 听起来是一声轻「叮」而不是金属铃；颂钵更低、更长
const BELL_SOUNDS = {
  bell: [
    { tone: "sine", freq: 783.99, level: 0.09, delay: 0.015, attack: 0.006, decay: 0.9 },
    { tone: "sine", freq: 1567.98, level: 0.025, delay: 0.015, attack: 0.006, decay: 0.45 },
    { tone: "sine", freq: 2351.97, level: 0.008, delay: 0.015, attack: 0.006, decay: 0.2 },
  ],
  bowl: [
    { tone: "sine", freq: 528, level: 0.11, delay: 0.02, attack: 0.008, decay: 1.6 },
    { tone: "sine", freq: 1430.9, level: 0.03, delay: 0.02, attack: 0.008, decay: 0.7 },
    { tone: "sine", freq: 2719.2, level: 0.008, delay: 0.02, attack: 0.008, decay: 0.25 },
  ],
};

class CrispFocusAudioEngine {
  constructor(app, getEnabled, getTheme, getVolume, getBellEnabled, getAmbientSound, getAmbientVol, windowObj, getSpaceEnabled = () => true) {
    this.app = app;
    this.getEnabled = getEnabled;
    this.getTheme = getTheme;
    this.getVolume = getVolume;
    this.getBellEnabled = getBellEnabled;
    this.getSpaceEnabled = getSpaceEnabled;
    this.getAmbientSound = getAmbientSound;
    this.getAmbientVol = getAmbientVol;
    this.windowObj = windowObj;
    this.ctx = null;
    this.noiseBuffer = null;
    this.outputContext = null;
    this.outputGain = null;
    this.outputLimiter = null;

    // HD MP3 Ambient Player
    this.ambient = null;
    this.ambientBuffer = null;
    this.ambientLoad = null;
    this.ambientPending = null;
    this.ambientRequest = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AudioContextClass = this.windowObj.AudioContext || this.windowObj.webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  handleUserGesture() {
    if (!this.getEnabled() && this.getAmbientSound() === "off") return;
    this.unlock();
    this.updateAmbient();
  }

  get MasterVolume() {
    return Math.max(0, Math.min(1, this.getVolume()));
  }

  getRandomPitch(baseFreq) {
    const jitter = (Math.random() * 0.08 - 0.04);
    return baseFreq * (1 + jitter);
  }

  getNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    // 一秒白噪声，每层从随机位置截一小段，各自加包络
    const bufferSize = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  getOutputNode() {
    if (!this.ctx) return null;
    if (
      this.outputContext === this.ctx
      && this.outputGain
      && this.outputLimiter
    ) {
      return this.outputGain;
    }

    const now = this.ctx.currentTime;
    const outputGain = this.ctx.createGain();
    const limiter = this.ctx.createDynamicsCompressor();
    outputGain.gain.setValueAtTime(1, now);
    limiter.threshold.setValueAtTime(-6, now);
    limiter.knee.setValueAtTime(6, now);
    limiter.ratio.setValueAtTime(12, now);
    limiter.attack.setValueAtTime(0.003, now);
    limiter.release.setValueAtTime(0.08, now);
    outputGain.connect(limiter);
    limiter.connect(this.ctx.destination);

    this.outputContext = this.ctx;
    this.outputGain = outputGain;
    this.outputLimiter = limiter;
    return outputGain;
  }

  connectOutput(node) {
    const output = this.getOutputNode();
    if (output) {
      node.connect(output);
    }
  }

  // 1.1 Character keypress
  playCharKey() {
    this.playKeySound("char");
  }

  // 1.2 Spacebar / IME Confirm
  playSpaceKey() {
    if (!this.getSpaceEnabled()) return;
    this.playSpaceImpact();
  }

  // Shared key body; Enter must remain independent of the space preference.
  playSpaceImpact() {
    this.playKeySound("space");
  }

  // 1.3 Backspace（长按连删时用更轻的一下）
  playBackspaceKey(repeat = false) {
    this.playKeySound("backspace", repeat ? 0.45 : 1);
  }

  playKeySound(kind, scale = 1) {
    if (!this.getEnabled()) return;
    this.unlock();
    if (!this.ctx) return;
    const sound = TYPING_SOUNDS[this.getTheme()] || TYPING_SOUNDS.typewriter;
    const vol = this.MasterVolume * sound.gain * scale;
    if (vol <= 0) return;

    const now = this.ctx.currentTime;
    // 同一下按键的各层共用一组随机值，听起来才是同一个键
    const velocity = 0.75 + Math.random() * 0.25;
    const pitch = 1 + (Math.random() * 2 - 1) * sound.jitter;
    for (const layer of sound[kind]) {
      this.playLayer(layer, now, vol * velocity, pitch);
    }
    if (kind === "enter" && sound.bell && this.getBellEnabled()) {
      for (const layer of BELL_SOUNDS[sound.bell]) {
        this.playLayer(layer, now, this.MasterVolume, 1);
      }
    }
  }

  playLayer(layer, now, vol, pitch) {
    const ctx = this.ctx;
    const at = now + (layer.delay || 0);
    const attack = layer.attack ?? 0.001;
    const end = at + attack + layer.decay;
    const level = vol * layer.level;
    let source;
    let head;

    if (layer.noise) {
      source = ctx.createBufferSource();
      source.buffer = this.getNoiseBuffer();
      const filter = ctx.createBiquadFilter();
      filter.type = layer.noise;
      filter.frequency.setValueAtTime(layer.freq * pitch, at);
      filter.Q.setValueAtTime(layer.q ?? 0.9, at);
      source.connect(filter);
      head = filter;
    } else {
      source = ctx.createOscillator();
      source.type = layer.tone;
      const base = Array.isArray(layer.freq)
        ? layer.freq[Math.floor(Math.random() * layer.freq.length)]
        : layer.freq;
      source.frequency.setValueAtTime(base * pitch, at);
      if (layer.to) {
        source.frequency.exponentialRampToValueAtTime(layer.to * pitch, at + (layer.sweep ?? layer.decay));
      }
      head = source;
      if (layer.cut) {
        // 方波直出太扎耳，削掉高频
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(layer.cut, at);
        source.connect(filter);
        head = filter;
      }
    }

    // 起音给 1-2ms 斜坡，避免波形突变带来的爆音
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.001, 0.00001), end);
    head.connect(gain);
    this.connectOutput(gain);

    if (layer.noise) {
      source.start(at, Math.random() * 0.8, end - at + 0.01);
    } else {
      source.start(at);
      source.stop(end + 0.01);
    }
  }

  // 1.4 Enter / Return
  /* 番茄钟阶段提示音：像轻敲一下小碗。专注结束是上行的两声，休息结束是下行的两声。
     不受打字音效开关影响，由番茄钟自己的「阶段提示音」控制。 */
  playChime(kind = "focus-end") {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = kind === "break-end" ? [[783.99, 0], [587.33, 0.2]] : [[587.33, 0], [880, 0.2]];
    for (const [freq, delay] of notes) {
      for (const [ratio, level] of [[1, 0.2], [2.76, 0.05], [5.4, 0.018]]) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * ratio, now + delay);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(level, now + delay + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + (ratio === 1 ? 1.6 : 0.6));
        osc.connect(gain);
        this.connectOutput(gain);
        osc.start(now + delay);
        osc.stop(now + delay + 1.7);
      }
    }
  }

  playEnterKey() {
    this.playKeySound("enter");
  }

  // 1.5 HD Local MP3 Ambient Audio Player (Seamless Loop)
  updateAmbient() {
    const soundName = this.getAmbientSound(); // 'off', 'rain', 'campfire', 'ocean', 'wind'
    const vol = Math.max(0, Math.min(1, this.getAmbientVol()));

    if (soundName === "off" || vol <= 0) {
      this.stopAmbient();
      return Promise.resolve();
    }

    this.unlock();
    if (!this.ctx) return Promise.resolve();

    if (this.ambient?.name === soundName) {
      if (this.ambient.volume !== vol) {
        this.ambient.volume = vol;
        this.glideGain(this.ambient.gain.gain, vol, 0.05);
      }
      return Promise.resolve();
    }
    if (this.ambientPending === soundName) return this.ambientLoad;

    this.fadeOutAmbient();
    const request = ++this.ambientRequest;
    this.ambientPending = soundName;
    this.ambientLoad = this.loadAmbientBuffer(soundName)
      .then((buffer) => {
        if (request !== this.ambientRequest || !this.ctx) return;
        this.ambientPending = null;
        this.ambientLoad = null;
        this.startAmbient(soundName, buffer);
      })
      .catch((err) => {
        if (request === this.ambientRequest) {
          this.ambientPending = null;
          this.ambientLoad = null;
        }
        console.warn("Ambient audio play failed:", err);
      });
    return this.ambientLoad;
  }

  async loadAmbientBuffer(soundName) {
    if (this.ambientBuffer?.name === soundName) return this.ambientBuffer.buffer;
    const configDir = this.app.vault.configDir || ".obsidian";
    const data = await this.app.vault.adapter.readBinary(`${configDir}/plugins/crisp-focus/audio/${soundName}.mp3`);
    const ctx = this.ctx;
    if (!ctx) throw new Error("Audio context closed while loading ambient sound");
    const buffer = buildAmbientLoop(ctx, await ctx.decodeAudioData(data));
    this.ambientBuffer = { name: soundName, buffer };
    return buffer;
  }

  startAmbient(soundName, buffer) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, this.getAmbientVol()));
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(vol, now, AMBIENT_FADE_IN / 4);
    source.connect(gain);
    // 不走按键音的限幅器，免得快速打字时把环境音一起压下去
    gain.connect(ctx.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(now);
    this.ambient = { name: soundName, source, gain, volume: vol };
  }

  glideGain(param, target, timeConstant) {
    const now = this.ctx.currentTime;
    // 从当前值接着滑，不让正在进行的淡入淡出跳回起点
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.setTargetAtTime(target, now, timeConstant);
  }

  fadeOutAmbient() {
    const ambient = this.ambient;
    if (!ambient) return;
    this.ambient = null;
    try {
      this.glideGain(ambient.gain.gain, 0, AMBIENT_FADE_OUT / 5);
      ambient.source.stop(this.ctx.currentTime + AMBIENT_FADE_OUT);
    } catch {
      ambient.source.stop();
    }
  }

  stopAmbient() {
    this.ambientRequest += 1;
    this.ambientPending = null;
    this.ambientLoad = null;
    // 解码后的整段音频有几十 MB，停下就释放，恢复时重新解码
    this.ambientBuffer = null;
    if (this.ctx) this.fadeOutAmbient();
    else this.ambient = null;
  }

  destroy() {
    this.stopAmbient();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.noiseBuffer = null;
      this.outputContext = null;
      this.outputGain = null;
      this.outputLimiter = null;
    }
  }
}

// --------------------------------------------------------------------------
// 2. CodeMirror 6 Native Cursor Layer Smooth Motion Hook (GPU-Accelerated Engine)
// --------------------------------------------------------------------------
class CrispCursorMarker {
  constructor(className, left, top, height, useTransform = true) {
    this.className = className;
    this.useTransform = useTransform;
    this.left = Math.round(left);
    this.top = Math.round(top);
    this.height = Math.round(height);
  }

  draw() {
    const el = document.createElement("div");
    el.className = this.className;
    this.applyStyle(el);
    return el;
  }

  applyStyle(el) {
    const win = el.win || el.ownerDocument?.defaultView || window;
    win.requestAnimationFrame(() => {
      const styles = { height: `${this.height}px` };
      if (this.useTransform) {
        styles.translate = `${this.left}px ${this.top}px`;
      } else {
        styles.left = `${this.left}px`;
        styles.top = `${this.top}px`;
      }
      if (typeof el.setCssStyles === "function") {
        el.setCssStyles(styles);
      } else {
        if (styles.translate !== undefined) el.style.translate = styles.translate;
        if (styles.left !== undefined) el.style.left = styles.left;
        if (styles.top !== undefined) el.style.top = styles.top;
        if (styles.height !== undefined) el.style.height = styles.height;
      }
    });
  }

  adjust(cursorEl) {
    if (cursorEl) {
      this.applyStyle(cursorEl);
    }
  }

  update(el, oldMarker) {
    if (oldMarker.className !== this.className || oldMarker.useTransform !== this.useTransform) {
      return false;
    }
    this.requestAdjust =
      oldMarker.requestAdjust ||
      this.requestAdjust ||
      debounceHelper((marker, target) => marker.applyStyle(target), 10);
    this.requestAdjust(this, el);
    return true;
  }

  eq(other) {
    return (
      other != null &&
      this.left === other.left &&
      this.top === other.top &&
      this.height === other.height &&
      this.className === other.className &&
      this.useTransform === other.useTransform
    );
  }

  static forRange(view, className, range, useTransform = true) {
    const coords = view.coordsAtPos(range.head, range.assoc || 1);
    if (!coords) return null;
    const offset = getScrollOffset(view);
    return new CrispCursorMarker(
      className,
      coords.left - offset.left,
      coords.top - offset.top,
      coords.bottom - coords.top,
      useTransform
    );
  }

  static forTableCellRange(parentView, cellView, className, range, useTransform = true) {
    const coords = cellView.coordsAtPos(range.head, range.assoc || 1);
    if (!coords) return null;
    const offset = getScrollOffset(parentView);
    return new CrispCursorMarker(
      className,
      coords.left - offset.left,
      coords.top - offset.top,
      coords.bottom - coords.top,
      useTransform
    );
  }
}

function getScrollOffset(view) {
  if (!view || !view.scrollDOM) return { top: 0, left: 0 };
  const rect = view.scrollDOM.getBoundingClientRect();
  const left =
    view.textDirection === 1 || !view.textDirection
      ? rect.left
      : rect.right - view.scrollDOM.clientWidth * (view.scaleX || 1);
  return {
    top: rect.top - view.scrollDOM.scrollTop * (view.scaleY || 1),
    left: left - view.scrollDOM.scrollLeft * (view.scaleX || 1),
  };
}

function getActiveTableCell(state) {
  if (!state || typeof state.field !== "function") return null;
  try {
    const editor = state.field(obsidian.editorInfoField)?.editor;
    return editor && editor.inTableCell ? editor.activeCM : null;
  } catch (e) {
    return null;
  }
}

function debounceHelper(fn, delay, resetTimer = false) {
  if (obsidian && typeof obsidian.debounce === "function") {
    return obsidian.debounce(fn, delay, resetTimer);
  }
  let timer = null;
  return function (...args) {
    if (resetTimer && timer) clearTimeout(timer);
    if (!timer || resetTimer) {
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, delay);
    }
  };
}

const debounceBlink = debounceHelper((dom) => {
  if (!dom) return;
  if (typeof dom.addClass === "function") {
    dom.addClass("cm-blinkLayer");
  } else if (dom.classList) {
    dom.classList.add("cm-blinkLayer");
  }
}, 350, true);

function hookCursorPlugin(view) {
  if (!view || !view.plugins) return null;
  return view.plugins.find((inst) => {
    const val = inst == null ? void 0 : inst.value;
    return val && val.layer && val.layer.class === "cm-cursorLayer";
  });
}

function patchCursorLayer(cursorPluginInstance, plugin) {
  const layer = cursorPluginInstance.layer;
  if (!layer) return () => {};

  const patchedEditors = new Map();
  const cleanupEditor = (editor) => {
    if (!editor) return;
    editor.classList.remove("crisp-focus-active", "crisp-focus-no-blink");
    editor.style.removeProperty("--crisp-focus-cursor-speed");
    editor.style.removeProperty("--crisp-focus-blink-rate");
    editor.style.removeProperty("--crisp-focus-blink-count");
    const cursorElements = patchedEditors.get(editor);
    if (cursorElements) {
      cursorElements.forEach((cursorEl) => {
        cursorEl.style.transition = "";
        cursorEl.style.translate = "";
      });
      patchedEditors.delete(editor);
    }
  };

  const unpatch = around(layer, {
    mount: () => function () {},
    update: () => function (update, dom) {
      if (!plugin.settings.focusModeEnabled || !plugin.settings.animatedCursorEnabled) {
        return false;
      }
      const cell = update && update.state ? getActiveTableCell(update.state) : null;
      if (cell === update.view) return false;
      const isOverTableCell = !update.view.hasFocus && (cell?.hasFocus ?? false);
      if (dom && dom.classList) {
        dom.classList.toggle("cm-overTableCell", Boolean(isOverTableCell));
      }
      if (update && (update.docChanged || update.selectionSet) && (update.view.hasFocus || isOverTableCell)) {
        if (dom && dom.classList) {
          dom.classList.remove("cm-blinkLayer");
          debounceBlink(dom);
        }
        return true;
      }
      return false;
    },
    markers: (origMarkers) => function (view) {
      const origResult = origMarkers ? origMarkers.call(this, view) : [];
      if (!plugin.settings.focusModeEnabled || !plugin.settings.animatedCursorEnabled) {
        cleanupEditor(view && view.dom);
        return origResult;
      }

      const speed = plugin.settings.cursorSpeed ?? 80;
      const blinkRate = plugin.settings.blinkRate ?? 1000;
      const blinkCount = plugin.settings.blinkCount ?? 10;

      // Real CodeMirror 6 EditorView with state & selection
      let state = view ? view.state : null;
      if (state && state.selection && Array.isArray(state.selection.ranges)) {
        const cell = !view.hasFocus ? getActiveTableCell(state) : null;
        if (cell) state = cell.state;
        if (view === cell) return [];

        if (state.selection.ranges.length === 0) {
          cleanupEditor(view.dom);
          return [];
        }

        if (view.dom) {
          view.dom.style.setProperty("--crisp-focus-cursor-speed", `${speed}ms`);
          view.dom.style.setProperty("--crisp-focus-blink-rate", `${blinkRate}ms`);
          view.dom.style.setProperty("--crisp-focus-blink-count", `${blinkCount}`);
          view.dom.classList.add("crisp-focus-active");
          view.dom.classList.toggle("crisp-focus-no-blink", blinkCount === 0);
          if (!patchedEditors.has(view.dom)) {
            patchedEditors.set(view.dom, new Set());
          }
        }

        const markers = [];
        for (const range of state.selection.ranges) {
          const isPrimary = range === state.selection.main;
          const cls = `cm-cursor ${isPrimary ? "cm-cursor-primary" : "cm-cursor-secondary"}`;
          const marker = cell
            ? CrispCursorMarker.forTableCellRange(view, cell, cls, range, true)
            : CrispCursorMarker.forRange(view, cls, range, true);
          if (marker) markers.push(marker);
        }
        return markers.length > 0 ? markers : origResult;
      }

      // Fallback for mocks / synthetic marker layers
      const rawMarkers = Array.isArray(origResult) ? origResult : [];
      if (rawMarkers.length === 0) {
        cleanupEditor(view && view.dom);
        return origResult;
      }

      if (view && view.dom) {
        view.dom.style.setProperty("--crisp-focus-cursor-speed", `${speed}ms`);
        view.dom.style.setProperty("--crisp-focus-blink-rate", `${blinkRate}ms`);
        view.dom.style.setProperty("--crisp-focus-blink-count", `${blinkCount}`);
        if (!patchedEditors.has(view.dom)) {
          patchedEditors.set(view.dom, new Set());
        }
      }

      rawMarkers.forEach((marker) => {
        if (!marker) return;
        const origAdjust = marker.adjust;
        marker.adjust = function (cursorEl) {
          if (cursorEl && view && view.dom) {
            view.dom.classList.add("crisp-focus-active");
            view.dom.classList.toggle("crisp-focus-no-blink", blinkCount === 0);
            cursorEl.style.transition = `translate ${speed}ms ease, top ${speed}ms ease, left ${speed}ms ease, height 60ms ease`;
            patchedEditors.get(view.dom)?.add(cursorEl);
          }
          return origAdjust ? origAdjust.call(this, cursorEl) : undefined;
        };
      });
      return rawMarkers;
    }
  });

  return () => {
    unpatch();
    Array.from(patchedEditors.keys()).forEach(cleanupEditor);
  };
}

function ensureCursorLayerPatched(editorView, plugin, patchUninstallers) {
  const cursorInstance = hookCursorPlugin(editorView);
  const layer = cursorInstance && cursorInstance.value && cursorInstance.value.layer;
  if (!layer || patchUninstallers.has(layer)) return false;

  patchUninstallers.set(layer, patchCursorLayer(cursorInstance.value, plugin));
  return true;
}

// --------------------------------------------------------------------------
// 3. Typewriter Scrolling Engine (CM6 ViewPlugin & Active Viewport Maintainer)
// --------------------------------------------------------------------------
class CrispTypewriterEngine {
  constructor(plugin) {
    this.plugin = plugin;
    this.userScrolling = false;
    this.userScrollTimeout = null;
  }

  calculateScrollDelta(view, docChanged = false) {
    if (!view || !view.scrollDOM || !view.state || !view.state.selection) return 0;
    const settings = this.plugin?.settings;
    if (!isTypewriterActive(this.plugin)) return 0;

    // Avoid hijacking Canvas cards, prompt modals, or non-note editors
    if (view.dom && typeof view.dom.closest === "function") {
      if (view.dom.closest(".canvas-node, .canvas-node-content, .workspace-leaf-content[data-type='canvas'], .prompt, .modal")) {
        return 0;
      }
    }

    const mainSelection = view.state.selection.main;
    if (!mainSelection) return 0;

    // If user is selecting a text range (highlight drag) and not actively typing, don't jerk the viewport
    const hasRangeSelection = mainSelection.empty === false || (
      typeof mainSelection.from === "number" &&
      typeof mainSelection.to === "number" &&
      mainSelection.from !== mainSelection.to
    );
    if (hasRangeSelection && !docChanged) {
      return 0;
    }

    const pos = mainSelection.head;
    const scrollDOM = view.scrollDOM;
    const editorRect = typeof scrollDOM.getBoundingClientRect === "function"
      ? scrollDOM.getBoundingClientRect()
      : null;
    if (!editorRect || editorRect.height <= 0) return 0;

    let currentY;
    const coords = typeof view.coordsAtPos === "function" ? view.coordsAtPos(pos) : null;
    if (coords) {
      currentY = coords.top - editorRect.top;
    } else if (typeof view.lineBlockAt === "function") {
      try {
        const lineBlock = view.lineBlockAt(pos);
        if (lineBlock) {
          currentY = lineBlock.top - (scrollDOM.scrollTop || 0);
        }
      } catch (e) {
        return 0;
      }
    }
    if (currentY === undefined || Number.isNaN(currentY)) return 0;

    const targetRatio = (settings.typewriterScrollOffset ?? 42) / 100;
    const targetY = editorRect.height * targetRatio;

    const mode = settings.typewriterScrollMode || "soft";
    if (mode === "soft") {
      const toleranceRatio = (settings.typewriterScrollTolerance ?? 10) / 100;
      const topBand = targetY - editorRect.height * toleranceRatio;
      const bottomBand = targetY + editorRect.height * toleranceRatio;

      if (currentY >= topBand && currentY <= bottomBand) {
        return 0;
      }
      return currentY - targetY;
    } else {
      const delta = currentY - targetY;
      return Math.abs(delta) > 1 ? delta : 0;
    }
  }

  requestScroll(view, reason = "update", docChanged = false) {
    if (!view || !view.scrollDOM) return;
    if (this.userScrolling) return;
    if (this.plugin?.isComposing) return;
    const settings = this.plugin?.settings;
    if (!isTypewriterActive(this.plugin)) return;

    const delta = this.calculateScrollDelta(view, docChanged);
    if (Math.abs(delta) < 2) return;

    const scrollDOM = view.scrollDOM;
    const currentScrollTop = scrollDOM.scrollTop || 0;
    const scrollHeight = scrollDOM.scrollHeight || 0;
    const clientHeight = scrollDOM.clientHeight || 0;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const newTargetScrollTop = Math.max(0, Math.min(maxScroll, Math.round(currentScrollTop + delta)));

    if (Math.abs(newTargetScrollTop - currentScrollTop) < 2) return;

    const win = view.dom?.ownerDocument?.defaultView
      || this.plugin?.mainWindow
      || (typeof window !== "undefined" ? window : null);
    let smooth = Boolean(settings.typewriterScrollSmooth);
    if (smooth && typeof win?.matchMedia === "function") {
      try {
        smooth = !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (e) {
        // Keep the saved preference when the host cannot evaluate media queries.
      }
    }
    if (!smooth) {
      scrollDOM.scrollTop = newTargetScrollTop;
      return;
    }

    if (typeof scrollDOM.scrollTo === "function") {
      try {
        scrollDOM.scrollTo({
          top: newTargetScrollTop,
          behavior: "smooth",
        });
        return;
      } catch (e) {
        // Fallback below
      }
    }
    scrollDOM.scrollTop = newTargetScrollTop;
  }

  onUserScroll() {
    this.userScrolling = true;
    if (this.userScrollTimeout) {
      const win = this.plugin?.mainWindow || (typeof window !== "undefined" ? window : null);
      const clearTimer = win?.clearTimeout || clearTimeout;
      clearTimer(this.userScrollTimeout);
    }
    const win = this.plugin?.mainWindow || (typeof window !== "undefined" ? window : null);
    const setTimer = win?.setTimeout || setTimeout;
    this.userScrollTimeout = setTimer(() => {
      this.userScrolling = false;
      this.userScrollTimeout = null;
    }, 1200);
  }

  onUserActivity() {
    this.userScrolling = false;
    if (this.userScrollTimeout) {
      const win = this.plugin?.mainWindow || (typeof window !== "undefined" ? window : null);
      const clearTimer = win?.clearTimeout || clearTimeout;
      clearTimer(this.userScrollTimeout);
      this.userScrollTimeout = null;
    }
  }

  destroy() {
    if (this.userScrollTimeout) {
      const win = this.plugin?.mainWindow || (typeof window !== "undefined" ? window : null);
      const clearTimer = win?.clearTimeout || clearTimeout;
      clearTimer(this.userScrollTimeout);
      this.userScrollTimeout = null;
    }
    this.userScrolling = false;
  }
}

// 打字机定焦需要激活。未激活时保留用户的开关选择，激活后直接生效。
function isTypewriterActive(plugin) {
  const settings = plugin?.settings;
  return Boolean(
    settings?.focusModeEnabled
    && settings?.typewriterScrollEnabled
    && plugin?.licenseManager?.isEntitled?.()
  );
}

function applyTypewriterStylesToEditor(editor, settings, entitled = false) {
  if (!editor) return;
  const excluded = typeof editor.closest === "function" && Boolean(
    editor.closest(".canvas-node, .canvas-node-content, .workspace-leaf-content[data-type='canvas'], .prompt, .modal")
  );
  const enabled = Boolean(
    !excluded
    && entitled
    && settings?.focusModeEnabled
    && settings?.typewriterScrollEnabled
  );
  const padEnabled = Boolean(enabled && settings?.typewriterScrollBottomPadding);
  const offsetRatio = (settings?.typewriterScrollOffset ?? 42) / 100;
  const bottomRatio = Math.max(0.2, Math.round((1 - offsetRatio) * 100) / 100);

  if (editor.classList) {
    editor.classList.toggle("crisp-focus-typewriter-active", enabled);
    editor.classList.toggle("crisp-focus-typewriter-padding", padEnabled);
  }
  if (!editor.style) return;

  if (!enabled) {
    editor.style.removeProperty("--crisp-focus-typewriter-bottom-ratio");
    editor.style.removeProperty("--crisp-focus-typewriter-bottom-space");
    editor.style.removeProperty("--crisp-focus-typewriter-offset-ratio");
    return;
  }

  editor.style.setProperty("--crisp-focus-typewriter-bottom-ratio", String(bottomRatio));
  editor.style.setProperty("--crisp-focus-typewriter-offset-ratio", String(offsetRatio));
  const scroller = typeof editor.querySelector === "function"
    ? editor.querySelector(".cm-scroller")
    : null;
  const viewportHeight = Number(scroller?.clientHeight)
    || Number(scroller?.getBoundingClientRect?.().height)
    || 0;
  if (viewportHeight > 0) {
    editor.style.setProperty(
      "--crisp-focus-typewriter-bottom-space",
      `${Math.round(viewportHeight * bottomRatio)}px`
    );
  } else {
    editor.style.removeProperty("--crisp-focus-typewriter-bottom-space");
  }
}

function isPointerSelectionUpdate(update) {
  const transactions = Array.isArray(update?.transactions) ? update.transactions : [];
  return transactions.length > 0 && transactions.every((tr) =>
    typeof tr?.isUserEvent === "function" && tr.isUserEvent("select.pointer")
  );
}

function createTypewriterExtension(plugin) {
  let cmView = null;
  try {
    cmView = require("@codemirror/view");
  } catch (e) {
    return null;
  }
  if (!cmView || typeof cmView.ViewPlugin?.fromClass !== "function") {
    return null;
  }

  class CrispTypewriterViewPlugin {
    constructor(view) {
      this.view = view;
      this.rafId = null;
      this.userScrollHandler = () => {
        plugin.typewriterEngine?.onUserScroll();
      };
      if (view.scrollDOM) {
        view.scrollDOM.addEventListener("wheel", this.userScrollHandler, { passive: true });
        view.scrollDOM.addEventListener("touchmove", this.userScrollHandler, { passive: true });
        view.scrollDOM.addEventListener("pointerdown", this.userScrollHandler, { passive: true });
      }
      this.applyEditorStyles();
    }

    update(update) {
      if (update.geometryChanged) {
        this.applyEditorStyles();
      }
      if (!isTypewriterActive(plugin)) {
        return;
      }
      // Only typewriter scroll on actual content typing or cursor movement
      // DO NOT auto-scroll on pure viewport scrolling (mouse wheel / trackpad / scrollbar)
      if (!update.docChanged && !update.selectionSet) {
        return;
      }
      // Clicking or drag-selecting must not move the page under the mouse;
      // the next keystroke re-centres the line.
      if (!update.docChanged && isPointerSelectionUpdate(update)) {
        return;
      }

      // Re-engage typewriter scrolling on typing or explicit cursor repositioning
      plugin.typewriterEngine?.onUserActivity();

      const win = update.view?.dom?.ownerDocument?.defaultView || plugin.mainWindow || window;
      if (this.rafId && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(this.rafId);
      }
      if (typeof win.requestAnimationFrame === "function") {
        this.rafId = win.requestAnimationFrame(() => {
          this.rafId = null;
          plugin.typewriterEngine?.requestScroll(
            update.view,
            update.docChanged ? "doc-change" : "selection",
            update.docChanged
          );
        });
      }
    }

    applyEditorStyles() {
      if (!this.view || !this.view.dom) return;
      applyTypewriterStylesToEditor(this.view.dom, plugin.settings, plugin.licenseManager?.isEntitled?.());
    }

    destroy() {
      const win = this.view?.dom?.ownerDocument?.defaultView || plugin.mainWindow || window;
      if (this.rafId && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.view && this.view.scrollDOM && this.userScrollHandler) {
        this.view.scrollDOM.removeEventListener("wheel", this.userScrollHandler);
        this.view.scrollDOM.removeEventListener("touchmove", this.userScrollHandler);
        this.view.scrollDOM.removeEventListener("pointerdown", this.userScrollHandler);
      }
      if (this.view && this.view.dom) {
        if (this.view.dom.classList) {
          this.view.dom.classList.remove("crisp-focus-typewriter-active", "crisp-focus-typewriter-padding");
        }
        if (this.view.dom.style) {
          this.view.dom.style.removeProperty("--crisp-focus-typewriter-bottom-ratio");
          this.view.dom.style.removeProperty("--crisp-focus-typewriter-bottom-space");
          this.view.dom.style.removeProperty("--crisp-focus-typewriter-offset-ratio");
        }
      }
    }
  }

  return cmView.ViewPlugin.fromClass(CrispTypewriterViewPlugin);
}

// --------------------------------------------------------------------------
// 4. Settings Schema & Apple Spring Accordion Settings Tab
// --------------------------------------------------------------------------
const FOCUS_SCENES = Object.freeze({
  "silent-writing": Object.freeze({
    name: "静默写作",
    description: "只保留平滑光标与打字机定焦，不播放任何声音。",
    settings: Object.freeze({
      ambientSound: "off",
      ambientVolume: 0.45,
      animatedCursorEnabled: true,
      blinkCount: 10,
      blinkRate: 1000,
      cursorSpeed: 80,
      focusModeEnabled: true,
      soundTheme: "typewriter",
      typewriterAudioEnabled: false,
      typewriterBellEnabled: false,
      typewriterVolume: 0.35,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "soft",
      typewriterScrollOffset: 42,
      typewriterScrollTolerance: 10,
      typewriterScrollBottomPadding: true,
      typewriterScrollSmooth: true,
    }),
  }),
  "vintage-typewriter": Object.freeze({
    name: "复古打字机",
    description: "敏捷光标、严格定焦与清晰的复古打字机反馈。",
    settings: Object.freeze({
      ambientSound: "off",
      ambientVolume: 0.45,
      animatedCursorEnabled: true,
      blinkCount: 10,
      blinkRate: 900,
      cursorSpeed: 75,
      focusModeEnabled: true,
      soundTheme: "typewriter",
      typewriterAudioEnabled: true,
      typewriterBellEnabled: true,
      typewriterVolume: 0.55,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "strict",
      typewriterScrollOffset: 42,
      typewriterScrollTolerance: 10,
      typewriterScrollBottomPadding: true,
      typewriterScrollSmooth: true,
    }),
  }),
  "rainy-writing": Object.freeze({
    name: "雨天写作",
    description: "轻柔雨滴按键音、平滑定焦与本地雨声环境。",
    settings: Object.freeze({
      ambientSound: "rain",
      ambientVolume: 0.45,
      animatedCursorEnabled: true,
      blinkCount: 8,
      blinkRate: 1100,
      cursorSpeed: 95,
      focusModeEnabled: true,
      soundTheme: "raindrop",
      typewriterAudioEnabled: true,
      typewriterBellEnabled: false,
      typewriterVolume: 0.35,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "soft",
      typewriterScrollOffset: 42,
      typewriterScrollTolerance: 10,
      typewriterScrollBottomPadding: true,
      typewriterScrollSmooth: true,
    }),
  }),
  "ocean-zen": Object.freeze({
    name: "海边禅写",
    description: "舒缓光标、木鱼反馈、平滑定焦与低音量海浪。",
    settings: Object.freeze({
      ambientSound: "ocean",
      ambientVolume: 0.4,
      animatedCursorEnabled: true,
      blinkCount: 6,
      blinkRate: 1250,
      cursorSpeed: 110,
      focusModeEnabled: true,
      soundTheme: "woodenFish",
      typewriterAudioEnabled: true,
      typewriterBellEnabled: true,
      typewriterVolume: 0.4,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "soft",
      typewriterScrollOffset: 42,
      typewriterScrollTolerance: 10,
      typewriterScrollBottomPadding: true,
      typewriterScrollSmooth: true,
    }),
  }),
});

function sceneRequiresLicense(scene) {
  return scene.settings.typewriterAudioEnabled || scene.settings.ambientSound !== "off";
}

class FocusSessionController {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.setInterval = options.setInterval || ((callback, delay) => setInterval(callback, delay));
    this.clearInterval = options.clearInterval || ((timer) => clearInterval(timer));
    this.onUpdate = options.onUpdate || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.timer = null;
    this.state = { status: "idle", endAt: 0, remainingMs: 0 };
  }

  getSnapshot() {
    return { ...this.state };
  }

  emit(reason) {
    this.onUpdate(this.getSnapshot(), reason);
  }

  schedule() {
    this.clearTimer();
    this.timer = this.setInterval(() => this.tick(), 1000);
  }

  clearTimer() {
    if (this.timer !== null) {
      this.clearInterval(this.timer);
      this.timer = null;
    }
  }

  start(minutes) {
    const durationMinutes = Math.max(1, Math.min(240, Math.round(Number(minutes) || 25)));
    const durationMs = durationMinutes * 60 * 1000;
    this.state = {
      status: "running",
      endAt: this.now() + durationMs,
      remainingMs: durationMs,
    };
    this.schedule();
    this.emit("start");
    return this.getSnapshot();
  }

  tick() {
    if (this.state.status !== "running") return this.getSnapshot();
    const remainingMs = Math.max(0, this.state.endAt - this.now());
    if (remainingMs === 0) {
      this.complete();
      return this.getSnapshot();
    }
    this.state = { ...this.state, remainingMs };
    this.emit("tick");
    return this.getSnapshot();
  }

  pause() {
    if (this.state.status !== "running") return this.getSnapshot();
    const remainingMs = Math.max(0, this.state.endAt - this.now());
    if (remainingMs === 0) {
      this.complete();
      return this.getSnapshot();
    }
    this.clearTimer();
    this.state = { status: "paused", endAt: 0, remainingMs };
    this.emit("pause");
    return this.getSnapshot();
  }

  resume() {
    if (this.state.status !== "paused" || this.state.remainingMs <= 0) {
      return this.getSnapshot();
    }
    this.state = {
      status: "running",
      endAt: this.now() + this.state.remainingMs,
      remainingMs: this.state.remainingMs,
    };
    this.schedule();
    this.emit("resume");
    return this.getSnapshot();
  }

  stop() {
    this.clearTimer();
    this.state = { status: "idle", endAt: 0, remainingMs: 0 };
    this.emit("stop");
    return this.getSnapshot();
  }

  complete() {
    if (this.state.status === "idle") return;
    this.clearTimer();
    this.state = { status: "idle", endAt: 0, remainingMs: 0 };
    this.emit("complete");
    this.onComplete();
  }

  restore(savedState) {
    if (!savedState || typeof savedState !== "object") return this.getSnapshot();
    if (savedState.status === "running") {
      const endAt = Number(savedState.endAt) || 0;
      const remainingMs = Math.max(0, endAt - this.now());
      if (remainingMs > 0) {
        this.state = { status: "running", endAt, remainingMs };
        this.schedule();
        this.emit("restore");
      }
    } else if (savedState.status === "paused") {
      const remainingMs = Math.max(0, Number(savedState.remainingMs) || 0);
      if (remainingMs > 0) {
        this.state = { status: "paused", endAt: 0, remainingMs };
        this.emit("restore");
      }
    }
    return this.getSnapshot();
  }

  destroy() {
    this.clearTimer();
  }
}

function formatSessionRemaining(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// 番茄钟：专注 → 短休，每 N 个专注后换成长休。专注阶段沿用专注会话的计时与环境音，休息阶段关掉专注效果。
// 2：开始专注/番茄时可传 { task }，事件和快照带上这段专注属于哪个任务（Crisp Tempo）。
const FOCUS_API_VERSION = 2;
const POMODORO_PHASE_LABELS = Object.freeze({ focus: "专注", "short-break": "短休", "long-break": "长休" });

function clampMinutes(value, fallback, max = 240) {
  return Math.max(1, Math.min(max, Math.round(Number(value) || fallback)));
}

/** 别的插件传来的任务：只留来源插件、任务标识和一行标题，格式不对就当没有任务。 */
function focusTaskContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source = typeof raw.source === "string" ? raw.source : "";
  const id = typeof raw.id === "string" ? raw.id : "";
  const title = typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!/^[a-z0-9-]{1,64}$/.test(source) || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !title) return null;
  return { source, id, title };
}

function pomodoroPhaseMinutes(settings, phase) {
  if (phase === "short-break") return clampMinutes(settings.pomodoroShortBreakMinutes, 5, 60);
  if (phase === "long-break") return clampMinutes(settings.pomodoroLongBreakMinutes, 15, 90);
  return clampMinutes(settings.pomodoroFocusMinutes, 25);
}

/** 完成第 completedRounds 个专注后接哪种休息。 */
function nextPomodoroBreak(completedRounds, every) {
  const n = Math.max(2, Math.min(12, Math.round(Number(every) || 4)));
  return completedRounds > 0 && completedRounds % n === 0 ? "long-break" : "short-break";
}

function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function newSessionId() {
  const c = typeof crypto !== "undefined" ? crypto : null;
  return c && typeof c.randomUUID === "function" ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clockTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* 番茄钟面板显示什么：由 getPomodoroSnapshot() 推出来，渲染只照着画。
   state: locked | idle | single | focus | break | waiting；actions 的 id 对应面板按钮。 */
function pomodoroViewModel(snap, now = Date.now()) {
  const vm = pomodoroPhaseViewModel(snap, now);
  // 这段专注属于哪个任务（从 Crisp Tempo 开始时才有）；没在计时、也不在一轮番茄里就不显示
  vm.task = vm.state !== "idle" && vm.state !== "locked" && snap.task?.title ? snap.task.title : "";
  return vm;
}

function pomodoroPhaseViewModel(snap, now) {
  const every = snap.every || 4;
  const paused = snap.status === "paused";
  const running = snap.status !== "idle";
  const progress = snap.plannedMs > 0 ? Math.max(0, Math.min(1, 1 - snap.remainingMs / snap.plannedMs)) : 0;
  const endsAt = running && !paused ? `${clockTime(now + snap.remainingMs)} 结束` : "";
  // 番茄位只显示这一组（每 every 个一组）里的位置
  const doneInSet = snap.completedRounds % every === 0 && snap.completedRounds > 0 && snap.kind === "break" ? every : snap.completedRounds % every;
  const slots = (current, p = 0) => Array.from({ length: every }, (_, i) => ({ state: i < doneInSet ? "done" : i === current ? "current" : "next", p: i === current ? p : 0 }));
  const foot = { count: snap.todayCount, goal: snap.goal, minutes: snap.todayFocusMinutes };
  const time = formatSessionRemaining(snap.remainingMs);
  const plan = `专注 ${snap.focusMinutes} 分钟 · 短休 ${snap.shortBreakMinutes} · 每 ${every} 个长休 ${snap.longBreakMinutes}`;

  if (running && !snap.pomodoro) {
    return { state: "single", tone: "focus", paused, pill: paused ? "已暂停" : "单次专注", meta: "", time, sub: paused ? "暂停中，回来接着写" : endsAt, progress, slots: [], foot,
      actions: [paused ? { id: "resume", label: "继续", primary: true } : { id: "pause", label: "暂停", primary: true }, { id: "stop", label: "结束" }] };
  }
  if (!snap.entitled && !snap.active) {
    return { state: "locked", tone: "focus", pill: "番茄钟", meta: "需要激活", time: formatSessionRemaining(snap.focusMinutes * 60000), sub: "激活后可用 · 单次专注免费", progress: 0,
      slots: Array.from({ length: every }, () => ({ state: "next", p: 0 })), foot: null,
      actions: [{ id: "activate", label: "前往激活", primary: true }, { id: "single", label: "单次专注" }] };
  }
  if (snap.kind === "focus" && running) {
    const index = (snap.round - 1) % every;
    return { state: "focus", tone: "focus", paused, pill: paused ? "已暂停" : "专注", meta: `第 ${index + 1} / ${every} 个`, time,
      sub: paused ? "暂停中，回来接着写" : endsAt, progress, slots: slots(index, progress), foot,
      actions: [paused ? { id: "resume", label: "继续", primary: true } : { id: "pause", label: "暂停", primary: true }, { id: "end", label: "结束" }] };
  }
  if (snap.kind === "break" && running) {
    const long = snap.phase === "long-break";
    return { state: "break", tone: "break", paused, pill: paused ? "休息暂停" : long ? "长休" : "短休", meta: `已完成 ${snap.completedRounds} 个`, time,
      sub: paused ? "休息也暂停了" : long ? "离开屏幕，喝点水" : "站起来走走，看看远处", progress, slots: slots(-1), foot,
      actions: [paused ? { id: "resume", label: "继续", primary: true } : null, { id: "skip", label: "跳过休息" }, { id: "end", label: "结束本轮" }].filter(Boolean) };
  }
  if (snap.waiting) {
    return { state: "waiting", tone: "focus", pill: "休息结束", meta: `第 ${(snap.completedRounds % every) + 1} / ${every} 个`, time: formatSessionRemaining(snap.focusMinutes * 60000),
      sub: "准备好就开始下一个", progress: 0, slots: slots(-1), foot,
      actions: [{ id: "next", label: "开始下一个", primary: true }, { id: "end", label: "结束本轮" }] };
  }
  return { state: "idle", tone: "focus", pill: "番茄钟", meta: `${every} 个一组`, time: formatSessionRemaining(snap.focusMinutes * 60000), sub: plan, progress: 0,
    slots: Array.from({ length: every }, () => ({ state: "next", p: 0 })), foot,
    actions: [{ id: "start", label: "开始番茄", primary: true }, { id: "single", label: "单次专注" }] };
}

const POMO_RING_RADIUS = 46;
const POMO_RING_LENGTH = 2 * Math.PI * POMO_RING_RADIUS;

/* 番茄钟面板：桌面端从状态栏弹出，手机端和命令面板用对话框。每秒只更新数字、进度和当前番茄位；
   状态或按钮变了才重建。 */
class PomodoroPanelView {
  constructor(plugin, host) {
    this.plugin = plugin;
    this.host = host;
    this.signature = null;
    this.root = host.createDiv({ cls: "crisp-focus-pomo" });
    this.update();
  }

  update() {
    if (!this.root?.isConnected) return;
    const snap = this.plugin.getPomodoroSnapshot();
    const vm = pomodoroViewModel(snap);
    const signature = JSON.stringify([vm.state, vm.tone, !!vm.paused, vm.pill, vm.meta, vm.task, vm.slots.map((x) => x.state), vm.actions.map((a) => a.id), vm.foot && [vm.foot.count, vm.foot.goal, vm.foot.minutes]]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(vm);
    }
    this.timeEl.setText(vm.time);
    this.subEl.setText(vm.sub);
    this.ringEl.style.strokeDashoffset = (POMO_RING_LENGTH * (1 - vm.progress)).toFixed(2);
    this.ringEl.toggleClass("is-empty", vm.progress <= 0);
    vm.slots.forEach((slot, i) => this.slotEls[i]?.style.setProperty("--p", String(slot.p)));
  }

  build(vm) {
    const root = this.root;
    root.empty();
    root.dataset.state = vm.state;
    root.dataset.tone = vm.tone;
    root.toggleClass("is-paused", !!vm.paused);
    const head = root.createDiv({ cls: "crisp-focus-pomo__head" });
    head.createSpan({ cls: "crisp-focus-pomo__pill", text: vm.pill });
    if (vm.meta) head.createSpan({ cls: "crisp-focus-pomo__meta", text: vm.meta });
    if (vm.task) root.createDiv({ cls: "crisp-focus-pomo__task", text: vm.task, attr: { title: vm.task } });
    // 进度环：从 12 点方向顺时针走完一圈；时间和结束时刻放在环里
    const dial = root.createDiv({ cls: "crisp-focus-pomo__dial" });
    const svg = dial.createSvg("svg", { cls: "crisp-focus-pomo__ring", attr: { viewBox: "0 0 100 100", "aria-hidden": "true" } });
    svg.createSvg("circle", { cls: "crisp-focus-pomo__ring-track", attr: { cx: 50, cy: 50, r: POMO_RING_RADIUS } });
    this.ringEl = svg.createSvg("circle", { cls: "crisp-focus-pomo__ring-fill", attr: { cx: 50, cy: 50, r: POMO_RING_RADIUS, "stroke-dasharray": POMO_RING_LENGTH.toFixed(2) } });
    const face = dial.createDiv({ cls: "crisp-focus-pomo__face" });
    this.timeEl = face.createDiv({ cls: "crisp-focus-pomo__time", attr: { role: "timer", "aria-live": "off" } });
    // 计时中环里放结束时刻；没在计时时说明文字较长（番茄设置、激活提示），放到环下面
    const resting = vm.state === "idle" || vm.state === "locked" || vm.state === "waiting";
    this.subEl = (resting ? root : face).createDiv({ cls: "crisp-focus-pomo__sub" });
    const slots = root.createDiv({ cls: "crisp-focus-pomo__slots", attr: { "aria-hidden": "true" } });
    this.slotEls = vm.slots.map((slot) => slots.createSpan({ cls: `crisp-focus-pomo__slot is-${slot.state}` }));
    if (!vm.slots.length) slots.addClass("is-empty");
    const actions = root.createDiv({ cls: "crisp-focus-pomo__actions" });
    for (const action of vm.actions) {
      const button = actions.createEl("button", { cls: `crisp-focus-pomo__btn${action.primary ? " is-primary" : ""}`, text: action.label, attr: { type: "button" } });
      button.addEventListener("click", () => { void this.run(action.id); });
    }
    if (vm.foot) {
      const foot = root.createDiv({ cls: "crisp-focus-pomo__foot" });
      const left = foot.createSpan({ cls: "crisp-focus-pomo__today" });
      left.createSpan({ cls: "crisp-focus-pomo__count", text: String(vm.foot.count) });
      left.appendText(` / ${vm.foot.goal} 个番茄`);
      foot.createSpan({ text: vm.foot.minutes ? `今天专注 ${vm.foot.minutes} 分钟` : "今天还没开始" });
    }
  }

  async run(id) {
    const p = this.plugin;
    const actions = {
      start: () => p.startPomodoro(),
      single: () => p.startFocusSession(p.settings.sessionDurationMinutes),
      pause: () => p.pauseFocusSession(),
      resume: () => p.resumeFocusSession(),
      stop: () => p.stopFocusSession(),
      end: () => p.endPomodoro(),
      skip: () => p.skipPomodoroBreak(),
      next: () => p.startNextPomodoro(),
      activate: () => { p.closePomodoroPanel(); p.openSettings(); },
    };
    try { await actions[id]?.(); } catch (error) { new obsidian.Notice(`Crisp Focus：${error.message || error}`); }
    this.update();
  }

  destroy() {
    this.root?.remove();
    this.root = null;
  }
}

const DEFAULT_SETTINGS = {
  activeSceneId: "silent-writing",
  focusModeEnabled: true,
  animatedCursorEnabled: true,
  cursorSpeed: 80,
  blinkRate: 1000,
  blinkCount: 10,
  typewriterScrollEnabled: true,
  typewriterScrollMode: "soft", // "soft" | "strict"
  typewriterScrollOffset: 42, // target Y position % (20 - 80, default 42)
  typewriterScrollTolerance: 10, // soft mode margin % (5 - 25, default 10)
  typewriterScrollBottomPadding: true, // inject viewport bottom padding
  typewriterScrollSmooth: true, // smooth scroll transition
  typewriterAudioEnabled: false,
  soundTheme: "typewriter", // typewriter, mechanical, raindrop, retro8bit, woodenFish
  typewriterVolume: 0.7,
  typewriterBellEnabled: true,
  typewriterSpaceEnabled: true,
  ambientSound: "off", // off, rain, campfire, ocean, wind
  ambientVolume: 0.65,
  licenseCode: "",
  licenseLastOnlineAt: 0,
  sessionDurationMinutes: 25,
  sessionState: { status: "idle", endAt: 0, remainingMs: 0 },
  // 当前计时的身份：单次专注或番茄钟的某个阶段；结束后清空
  sessionMeta: null,
  // 番茄循环：active 表示在循环里，round 是本轮已完成的专注个数，waiting 表示休息结束、等用户开始下一个
  pomodoroState: null,
  pomodoroFocusMinutes: 25,
  pomodoroShortBreakMinutes: 5,
  pomodoroLongBreakMinutes: 15,
  pomodoroLongBreakEvery: 4,
  pomodoroAutoStartFocus: false,
  pomodoroChime: true,
  pomodoroDailyGoal: 8,
  pomodoroToday: { date: "", count: 0, focusMinutes: 0 },
  // 清爽打字本身不保存，重启后回到普通界面；这里只存它的选项
  cleanTypingHideStatusBar: true
};

function renderAboutCard(container, pluginName, description) {
  const document = container.ownerDocument;
  const card = document.createElement("section");
  card.className = "crisp-focus-about";

  const title = document.createElement("h3");
  title.className = "crisp-focus-about__title";
  title.textContent = `关于 ${pluginName}`;

  const copy = document.createElement("p");
  copy.className = "crisp-focus-about__description";
  copy.textContent = description;

  const byline = document.createElement("p");
  byline.className = "crisp-focus-about__author";
  const label = document.createElement("span");
  label.textContent = "作者：";
  const author = document.createElement("a");
  author.className = "crisp-focus-about__author-link";
  author.textContent = "小红书 letschips";
  author.href = "https://xhslink.cn/m/3MwtKu4822b";
  author.target = "_blank";
  author.rel = "noopener noreferrer";
  byline.append(label, author);

  card.append(title, copy, byline);
  container.append(card);
}

class CrispFocusSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.licenseDraft = plugin.settings?.licenseCode || "";
    // Re-rendering must not collapse cards the user opened (or reopen closed ones).
    this.groupOpenState = new Map();
    this.sessionControlSetting = null;
  }

  onSessionUpdate(snapshot, reason) {
    if (!this.sessionControlSetting || !this.containerEl?.isConnected) return;
    if (reason === "tick") {
      this.sessionControlSetting.setDesc(`剩余 ${formatSessionRemaining(snapshot.remainingMs)}`);
    } else if (reason === "complete") {
      this.display();
    }
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName("Crisp Focus")
      .setHeading();

    new obsidian.Setting(containerEl)
      .setName("专注模式")
      .setDesc("光标、定焦、音效与环境音的总开关")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.focusModeEnabled)
          .onChange(async (val) => {
            await this.plugin.setFocusModeEnabled(val);
          })
      );

    const createGroup = (title, description, defaultOpen = true) => {
      const open = this.groupOpenState.has(title) ? this.groupOpenState.get(title) : defaultOpen;
      const details = containerEl.createEl("details", {
        cls: `crisp-focus-setting-card${open ? " is-open" : ""}`,
      });
      if (open) {
        details.open = true;
      }
      const summary = details.createEl("summary", {
        cls: "crisp-focus-setting-card__header",
      });

      const titleEl = summary.createDiv("crisp-focus-setting-card__title-group");
      titleEl.createDiv({ cls: "crisp-focus-setting-card__title", text: title });
      if (description) {
        titleEl.createDiv({ cls: "crisp-focus-setting-card__desc", text: description });
      }

      summary.createDiv({ cls: "crisp-focus-setting-card__chevron" });

      const contentWrapper = details.createDiv("crisp-focus-setting-card__content-wrapper");
      const body = contentWrapper.createDiv("crisp-focus-setting-card__body");

      summary.addEventListener("click", (evt) => {
        evt.preventDefault();
        if (details.classList.contains("is-closing")) {
          return;
        }
        this.groupOpenState.set(title, !details.open);
        if (details.open) {
          details.classList.remove("is-open");
          details.classList.add("is-closing");
          window.setTimeout(() => {
            details.open = false;
            details.classList.remove("is-closing");
          }, 240);
        } else {
          details.open = true;
          window.requestAnimationFrame(() => {
            details.classList.add("is-open");
          });
        }
      });

      return body;
    };

    const sceneGroup = createGroup(
      "专注场景",
      "",
      true
    );

    new obsidian.Setting(sceneGroup)
      .setName("当前场景")
      .setDesc(this.plugin.licenseManager.isEntitled() ? "" : "打字机定焦和带音效的场景需要激活")
      .addDropdown((dropdown) => {
        dropdown.addOption("custom", "自定义（当前设置）");
        Object.entries(FOCUS_SCENES).forEach(([sceneId, scene]) => {
          dropdown.addOption(sceneId, scene.name);
        });
        dropdown
          .setValue(this.plugin.settings.activeSceneId || "custom")
          .onChange(async (sceneId) => {
            if (sceneId === "custom") return;
            const result = await this.plugin.applyScene(sceneId);
            if (!result.applied) {
              new obsidian.Notice(`🔒 ${result.reason}`);
              this.display();
              return;
            }
            new obsidian.Notice(`Crisp Focus 已切换到“${result.scene.name}”`);
            this.display();
          });
      });

    const cleanGroup = createGroup(
      "清爽打字",
      this.plugin.licenseManager.isEntitled() ? "" : "需要激活",
      true
    );

    new obsidian.Setting(cleanGroup)
      .setName("进入清爽打字")
      .setDesc("鼠标移到顶部显示标签栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.cleanTypingActive)
          .onChange((val) => {
            if (!this.plugin.setCleanTypingEnabled(val)) toggle.setValue(this.plugin.cleanTypingActive);
          })
      );

    new obsidian.Setting(cleanGroup)
      .setName("同时隐藏状态栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.cleanTypingHideStatusBar !== false)
          .onChange(async (val) => {
            await this.plugin.setCleanTypingHideStatusBar(val);
          })
      );

    const sessionGroup = createGroup(
      "专注会话",
      "",
      true
    );
    const sessionSnapshot = this.plugin.session.getSnapshot();

    new obsidian.Setting(sessionGroup)
      .setName("默认时长")
      .setDesc("1–240 分钟")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "240";
        text
          .setValue(String(this.plugin.settings.sessionDurationMinutes || 25))
          .onChange(async (value) => {
            if (String(value).trim() === "") return;
            const minutes = Math.max(1, Math.min(240, Math.round(Number(value) || 25)));
            this.plugin.settings.sessionDurationMinutes = minutes;
            await this.plugin.saveSettings();
            this.plugin.renderSessionStatus(this.plugin.session.getSnapshot());
          });
        // Show the value that was actually saved (clamped) once editing ends.
        text.inputEl.addEventListener("blur", () => {
          text.setValue(String(this.plugin.settings.sessionDurationMinutes || 25));
        });
      });

    this.sessionControlSetting = new obsidian.Setting(sessionGroup)
      .setName("会话控制")
      .setDesc(sessionSnapshot.status === "idle"
        ? ""
        : `剩余 ${formatSessionRemaining(sessionSnapshot.remainingMs)}`)
      .addButton((button) => button
        .setButtonText(sessionSnapshot.status === "idle" ? "开始" : "重新开始")
        .setCta()
        .onClick(async () => {
          await this.plugin.startFocusSession(this.plugin.settings.sessionDurationMinutes);
          this.display();
        }))
      .addButton((button) => button
        .setButtonText(sessionSnapshot.status === "paused" ? "继续" : "暂停")
        .setDisabled(sessionSnapshot.status === "idle")
        .onClick(async () => {
          if (sessionSnapshot.status === "paused") {
            await this.plugin.resumeFocusSession();
          } else {
            await this.plugin.pauseFocusSession();
          }
          this.display();
        }))
      .addButton((button) => button
        .setButtonText("结束")
        .setDisabled(sessionSnapshot.status === "idle")
        .onClick(async () => {
          await this.plugin.stopFocusSession();
          this.display();
        }));

    const pomodoroGroup = createGroup(
      "番茄钟",
      this.plugin.licenseManager.isEntitled() ? "" : "需要激活",
      true
    );
    const numberSetting = (name, desc, key, fallback, min, max) => new obsidian.Setting(pomodoroGroup)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(min);
        text.inputEl.max = String(max);
        text.setValue(String(this.plugin.settings[key] ?? fallback)).onChange(async (value) => {
          if (String(value).trim() === "") return;
          this.plugin.settings[key] = Math.max(min, Math.min(max, Math.round(Number(value) || fallback)));
          await this.plugin.saveSettings();
          this.plugin.pomodoroView?.update();
        });
        text.inputEl.addEventListener("blur", () => text.setValue(String(this.plugin.settings[key] ?? fallback)));
      });
    numberSetting("专注时长", "1–240 分钟", "pomodoroFocusMinutes", 25, 1, 240);
    numberSetting("短休", "1–60 分钟", "pomodoroShortBreakMinutes", 5, 1, 60);
    numberSetting("长休", "1–90 分钟", "pomodoroLongBreakMinutes", 15, 1, 90);
    numberSetting("每组几个", "几个番茄后换长休", "pomodoroLongBreakEvery", 4, 2, 12);
    numberSetting("每日目标", "1–24 个", "pomodoroDailyGoal", 8, 1, 24);
    new obsidian.Setting(pomodoroGroup)
      .setName("休息结束自动开始下一个")
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.pomodoroAutoStartFocus).onChange(async (value) => {
        this.plugin.settings.pomodoroAutoStartFocus = value;
        await this.plugin.saveSettings();
      }));
    new obsidian.Setting(pomodoroGroup)
      .setName("阶段提示音")
      .setDesc("不受打字音效开关影响")
      .addButton((button) => button.setButtonText("试听").onClick(() => this.plugin.audio?.playChime("focus-end")))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.pomodoroChime !== false).onChange(async (value) => {
        this.plugin.settings.pomodoroChime = value;
        await this.plugin.saveSettings();
      }));
    new obsidian.Setting(pomodoroGroup)
      .setName("打开番茄钟")
      .addButton((button) => button.setButtonText("打开").setCta().onClick(() => this.plugin.openPomodoroModal()));

    const licenseGroup = createGroup(
      "软件授权",
      "",
      true
    );

    const statusSetting = new obsidian.Setting(licenseGroup)
      .setName("当前激活状态")
      .setDesc("正在验证授权状态...");

    const licenseStatus = this.plugin.licenseManager.getStatus();
    if (licenseStatus.valid && licenseStatus.payload) {
      const owner = licenseStatus.payload.userName || "Crisp 用户";
      const expiry = licenseStatus.payload.expiresAt
        ? `，到期时间: ${String(licenseStatus.payload.expiresAt).split("T")[0]}`
        : "";
      const verification = licenseStatus.source === "offline" ? "离线验证" : "在线验证";
      statusSetting.setDesc(`✅ 已激活（${verification}，授权给: ${owner}${expiry}）`);
    } else if (this.plugin.settings.licenseCode) {
      statusSetting.setDesc(`❌ 未激活（${licenseStatus.reason || "授权码无效"}）`);
    } else {
      statusSetting.setDesc("❌ 未激活");
    }

    new obsidian.Setting(licenseGroup)
      .setName("输入授权码")
      .setDesc("授权码会先在本地验签，再发送授权码、设备标识与插件 ID 完成在线设备校验。")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("粘贴 Crisp 授权码...")
          .setValue(this.licenseDraft || this.plugin.settings.licenseCode)
          .onChange((value) => {
            this.licenseDraft = value;
          });
      })
      .addButton((button) => button
        .setButtonText("激活 / 重新验证")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          let result;
          try {
            result = await this.plugin.activateLicense(this.licenseDraft);
          } finally {
            button.setDisabled(false);
          }
          if (result.stale) return;
          if (result.valid && result.payload) {
            new obsidian.Notice(`🎉 Crisp Focus 激活成功！欢迎使用，${result.payload.userName || "Crisp 用户"}`);
            this.display();
          } else {
            new obsidian.Notice(`❌ 激活失败: ${result.reason}`);
          }
        }));

    // Card 1: Smooth Animated Cursor
    const cursorCard = createGroup(
      "动效光标",
      "",
      true
    );

    new obsidian.Setting(cursorCard)
      .setName("启用动效光标")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.animatedCursorEnabled)
          .onChange(async (val) => {
            await this.plugin.setAnimatedCursorEnabled(val);
          })
      );

    const speedDesc = () => "毫秒";
    const speedSetting = new obsidian.Setting(cursorCard)
      .setName("光标速度")
      .setDesc(speedDesc(this.plugin.settings.cursorSpeed ?? 80))
      .addSlider((slider) =>
        slider
          .setLimits(0, 200, 5)
          .setValue(this.plugin.settings.cursorSpeed ?? 80)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.markSceneCustom();
            this.plugin.settings.cursorSpeed = val;
            speedSetting.setDesc(speedDesc(val));
            await this.plugin.saveSettings();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("恢复默认值（80ms）")
          .onClick(async () => {
            this.plugin.markSceneCustom();
            this.plugin.settings.cursorSpeed = 80;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    const blinkRateDesc = () => "闪烁一次的毫秒数";
    const blinkRateSetting = new obsidian.Setting(cursorCard)
      .setName("闪烁频率")
      .setDesc(blinkRateDesc(this.plugin.settings.blinkRate ?? 1000))
      .addSlider((slider) =>
        slider
          .setLimits(400, 2000, 50)
          .setValue(this.plugin.settings.blinkRate ?? 1000)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.markSceneCustom();
            this.plugin.settings.blinkRate = val;
            blinkRateSetting.setDesc(blinkRateDesc(val));
            await this.plugin.saveSettings();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("恢复默认值（1000ms）")
          .onClick(async () => {
            this.plugin.markSceneCustom();
            this.plugin.settings.blinkRate = 1000;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    const blinkCountDesc = () => "0 为常亮";
    const blinkCountSetting = new obsidian.Setting(cursorCard)
      .setName("闪烁次数")
      .setDesc(blinkCountDesc(this.plugin.settings.blinkCount ?? 10))
      .addSlider((slider) =>
        slider
          .setLimits(0, 30, 1)
          .setValue(this.plugin.settings.blinkCount ?? 10)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.markSceneCustom();
            this.plugin.settings.blinkCount = val;
            blinkCountSetting.setDesc(blinkCountDesc(val));
            await this.plugin.saveSettings();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("恢复默认值（10次）")
          .onClick(async () => {
            this.plugin.markSceneCustom();
            this.plugin.settings.blinkCount = 10;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Card 2: Typewriter Scrolling Engine
    const typewriterCard = createGroup(
      "打字机定焦",
      this.plugin.licenseManager.isEntitled() ? "" : "需要激活",
      true
    );

    new obsidian.Setting(typewriterCard)
      .setName("启用打字机定焦")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterScrollEnabled)
          .onChange(async (val) => {
            await this.plugin.setTypewriterScrollEnabled(val);
            this.display();
          })
      );

    new obsidian.Setting(typewriterCard)
      .setName("滚动模式")
      .setDesc("平滑区间在舒适带内移动，严格定焦每行锁定")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("soft", "🌊 平滑区间 (Soft Mode · 推荐)")
          .addOption("strict", "🎯 严格定焦 (Strict Mode · 经典打字机)")
          .setValue(this.plugin.settings.typewriterScrollMode || "soft")
          .onChange(async (val) => {
            await this.plugin.setTypewriterScrollMode(val);
            this.display();
          })
      );

    const offsetDesc = () => "屏幕高度的百分比";
    const toleranceDesc = () => {
      const offset = this.plugin.settings.typewriterScrollOffset ?? 42;
      const tolerance = this.plugin.settings.typewriterScrollTolerance ?? 10;
      return `光标在 ${Math.max(0, offset - tolerance)}%–${Math.min(100, offset + tolerance)}% 之间移动`;
    };
    let toleranceSetting = null;
    const offsetSetting = new obsidian.Setting(typewriterCard)
      .setName("黄金视线高度")
      .setDesc(offsetDesc(this.plugin.settings.typewriterScrollOffset ?? 42))
      .addSlider((slider) =>
        slider
          .setLimits(20, 80, 1)
          .setValue(this.plugin.settings.typewriterScrollOffset ?? 42)
          .setDynamicTooltip()
          .onChange(async (val) => {
            await this.plugin.setTypewriterScrollOffset(val);
            offsetSetting.setDesc(offsetDesc(this.plugin.settings.typewriterScrollOffset));
            toleranceSetting?.setDesc(toleranceDesc());
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("恢复默认高度（42%）")
          .onClick(async () => {
            await this.plugin.setTypewriterScrollOffset(42);
            this.display();
          })
      );

    if ((this.plugin.settings.typewriterScrollMode || "soft") === "soft") {
      toleranceSetting = new obsidian.Setting(typewriterCard)
        .setName("平滑区间容差")
        .setDesc(toleranceDesc())
        .addSlider((slider) =>
          slider
            .setLimits(5, 25, 1)
            .setValue(this.plugin.settings.typewriterScrollTolerance ?? 10)
            .setDynamicTooltip()
            .onChange(async (val) => {
              await this.plugin.setTypewriterScrollTolerance(val);
              toleranceSetting?.setDesc(toleranceDesc());
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("reset")
            .setTooltip("恢复默认容差（±10%）")
            .onClick(async () => {
              await this.plugin.setTypewriterScrollTolerance(10);
              this.display();
            })
        );
    }

    new obsidian.Setting(typewriterCard)
      .setName("底部留白扩展")
      .setDesc("按窗格高度补足末尾留白")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterScrollBottomPadding)
          .onChange(async (val) => {
            await this.plugin.setTypewriterScrollBottomPadding(val);
          })
      );

    new obsidian.Setting(typewriterCard)
      .setName("平滑缓动滚动")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterScrollSmooth)
          .onChange(async (val) => {
            await this.plugin.setTypewriterScrollSmooth(val);
          })
      );

    // Card 3: Multi-Theme Audio Engine
    const audioCard = createGroup(
      "声音反馈",
      "",
      false
    );

    new obsidian.Setting(audioCard)
      .setName("启用音效")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterAudioEnabled)
          .onChange(async (val) => {
            if (val && !this.plugin.licenseManager.isEntitled()) {
              new obsidian.Notice("🔒 开启打字音效属于 Crisp 激活用户专属功能");
              this.plugin.settings.typewriterAudioEnabled = false;
              await this.plugin.saveSettings();
              this.display();
              return;
            }
            this.plugin.markSceneCustom();
            this.plugin.settings.typewriterAudioEnabled = val;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("音效主题")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("typewriter", "📜 Vintage Typewriter (复古打字机)")
          .addOption("mechanical", "⌨️ Mechanical Keyboard (麻将轴键盘)")
          .addOption("raindrop", "🌧️ Raindrop & Bubble (雨滴气泡音)")
          .addOption("retro8bit", "👾 8-Bit Retro Game (复古8位元)")
          .addOption("woodenFish", "🪵 Zen Wooden Fish (功德木鱼与磬)")
          .setValue(this.plugin.settings.soundTheme || "typewriter")
          .onChange(async (val) => {
            if (!this.plugin.licenseManager.isEntitled()) {
              new obsidian.Notice("🔒 切换音效主题属于 Crisp 激活用户专属功能");
              this.display();
              return;
            }
            this.plugin.markSceneCustom();
            this.plugin.settings.soundTheme = val;
            await this.plugin.saveSettings();
            this.plugin.audio.playCharKey();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("主音量")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.typewriterVolume)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.markSceneCustom();
            this.plugin.settings.typewriterVolume = val;
            await this.plugin.saveSettings();
            this.plugin.audio.playCharKey();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("空格与选字提示音")
      .setDesc("输入法确认选字也算")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterSpaceEnabled)
          .onChange(async (val) => {
            this.plugin.settings.typewriterSpaceEnabled = val;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("回车提示音")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterBellEnabled)
          .onChange(async (val) => {
            this.plugin.markSceneCustom();
            this.plugin.settings.typewriterBellEnabled = val;
            await this.plugin.saveSettings();
          })
      );

    // Card 3: Zen Ambient Audio Generator
    const ambientCard = createGroup(
      "环境音",
      "",
      false
    );

    new obsidian.Setting(ambientCard)
      .setName("背景环境音")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("off", "Off (关闭)")
          .addOption("rain", "🌧️ Rainy Day in Town (城镇雨声与鸟鸣)")
          .addOption("campfire", "🔥 Campfire in the Woods (森林篝火爆裂)")
          .addOption("ocean", "🌊 Soothing Ocean Waves (舒缓海浪拍岸)")
          .addOption("wind", "❄️ Arctic Cold Wind (极地寒风呼啸)")
          .setValue(this.plugin.settings.ambientSound || "off")
          .onChange(async (val) => {
            if (val !== "off" && !this.plugin.licenseManager.isEntitled()) {
              new obsidian.Notice("🔒 播放 HD 环境音属于 Crisp 激活用户专属功能");
              this.plugin.settings.ambientSound = "off";
              await this.plugin.saveSettings();
              this.display();
              return;
            }
            this.plugin.markSceneCustom();
            this.plugin.settings.ambientSound = val;
            await this.plugin.saveSettings();
            this.plugin.audio.updateAmbient();
          })
      );

    new obsidian.Setting(ambientCard)
      .setName("环境音音量")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.ambientVolume ?? 0.65)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.markSceneCustom();
            this.plugin.settings.ambientVolume = val;
            await this.plugin.saveSettings();
            this.plugin.audio.updateAmbient();
          })
      );

    renderAboutCard(
      containerEl,
      "Crisp Focus",
      "用克制的视觉与声音反馈，帮助你专注进入和完成每一次书写。"
    );
  }
}

// --------------------------------------------------------------------------
// 4. Main Plugin Class
// --------------------------------------------------------------------------
class CrispFocusPlugin extends obsidian.Plugin {
  async onload() {
    this.settingsWriteBlocked = false;
    const savedSettings = await this.loadSavedSettings();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
    if (!Object.prototype.hasOwnProperty.call(savedSettings, "activeSceneId")) {
      this.settings.activeSceneId = Object.keys(savedSettings).length > 0
        ? "custom"
        : "silent-writing";
    }

    const winObj = this.app.workspace.containerEl.ownerDocument.defaultView || window;
    this.mainWindow = winObj;
    this.licenseManager = new CrispFocusLicenseManager(this.app, this.settings, {
      verifier: this.licenseVerifier || verifyLicenseCode,
      windowObj: winObj,
      onEntitlementLost: () => {
        if (this.audio) this.audio.stopAmbient();
        this.updateTypewriterStyles();
        if (this.cleanTypingActive) this.setCleanTypingEnabled(false);
      },
    });
    if (this.licenseVerifier) {
      await this.refreshLicense();
    } else {
      await this.licenseManager.initialize();
    }
    this.audio = new CrispFocusAudioEngine(
      this.app,
      () => this.settings.focusModeEnabled
        && this.settings.typewriterAudioEnabled
        && this.licenseManager.isEntitled(),
      () => this.settings.soundTheme || "typewriter",
      () => this.settings.typewriterVolume,
      () => this.settings.typewriterBellEnabled,
      () => this.settings.focusModeEnabled
        && this.licenseManager.isEntitled()
        && this.session?.getSnapshot().status !== "paused"
        ? (this.settings.ambientSound || "off")
        : "off",
      () => this.settings.ambientVolume ?? 0.65,
      winObj,
      () => this.settings.typewriterSpaceEnabled !== false
    );
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.classList.add("crisp-focus-session-status");
    this.statusBarEl.setAttr("aria-label", "Crisp Focus 番茄钟与专注会话");
    // 状态栏贴着窗口底边，提示框默认朝下放不下，会被挤回来盖住状态栏
    this.statusBarEl.setAttr("data-tooltip-position", "top");
    // 点状态栏打开番茄钟面板；开始、暂停、跳过休息和结束都在面板里
    this.statusBarEl.addEventListener("click", () => this.togglePomodoroPanel());
    this.focusApiVersion = FOCUS_API_VERSION;
    this.session = new FocusSessionController({
      setInterval: (callback, delay) => winObj.setInterval(callback, delay),
      clearInterval: (timer) => winObj.clearInterval(timer),
      onUpdate: (snapshot, reason) => this.onSessionUpdate(snapshot, reason),
      onComplete: () => {
        void this.handleSessionComplete();
      },
    });
    const restored = this.session.restore(this.settings.sessionState);
    if (restored.status === "idle" && this.settings.sessionState?.status !== "idle") {
      // The countdown ran out while Obsidian was closed; drop the stale state.
      // 关着 Obsidian 时跑完的番茄不算完成，这一轮循环也随之结束。
      this.settings.sessionState = restored;
      this.settings.sessionMeta = null;
      this.settings.pomodoroState = null;
      await this.saveSettings();
    } else if (restored.status === "idle" && !this.settings.pomodoroState?.waiting) {
      this.settings.sessionMeta = null;
      if (this.settings.pomodoroState) this.settings.pomodoroState = null;
    }
    this.renderSessionStatus(restored);
    this.cleanTypingActive = false;
    this.cleanTypingRestore = null;
    this.windowBindings = new Map();
    this.attachWindow(winObj);
    // 插件启用或重载前已经开着的弹出窗口不会再触发 window-open
    this.attachExistingWindows();
    this.app.workspace.onLayoutReady?.(() => this.attachExistingWindows());
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, windowObj) => {
      this.attachWindow(windowObj);
    }));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, windowObj) => {
      this.detachWindow(windowObj);
    }));

    // Initialize Typewriter Scrolling Engine
    this.typewriterEngine = new CrispTypewriterEngine(this);
    const typewriterExt = createTypewriterExtension(this);
    if (typewriterExt && typeof this.registerEditorExtension === "function") {
      this.registerEditorExtension(typewriterExt);
    }

    // Patch CM6 native cursor layer
    this.cursorPatchUninstallers = new Map();
    const tryPatchCursor = () => {
      const activeLeaf = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (!activeLeaf || !activeLeaf.editor || !activeLeaf.editor.cm) return null;

      ensureCursorLayerPatched(
        activeLeaf.editor.cm,
        this,
        this.cursorPatchUninstallers
      );
      return activeLeaf;
    };
    // editor-selection-change fires on every keystroke; keep it to the cheap
    // patch check. Restyling and re-centring belong to leaf changes, while the
    // typewriter ViewPlugin already follows typing and cursor moves.
    const onActiveLeafChange = () => {
      const activeLeaf = tryPatchCursor();
      if (!activeLeaf) return;
      this.updateTypewriterStyles();
      if (isTypewriterActive(this) && activeLeaf.editor.cm.hasFocus) {
        this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "leaf-change");
      }
    };

    this.registerEvent(this.app.workspace.on("active-leaf-change", onActiveLeafChange));
    this.registerEvent(this.app.workspace.on("editor-selection-change", tryPatchCursor));

    this.cursorPatchTimer = winObj.setTimeout(onActiveLeafChange, 100);

    // Add Setting Tab
    this.settingTab = new CrispFocusSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Commands
    this.addCommand({
      id: "toggle-focus-mode",
      name: "切换专注模式 / Toggle focus mode",
      callback: async () => {
        await this.setFocusModeEnabled(!this.settings.focusModeEnabled);
        new obsidian.Notice(`Crisp Focus 专注模式已${this.settings.focusModeEnabled ? "开启" : "关闭"}`);
      }
    });

    this.addCommand({
      id: "toggle-animated-cursor",
      name: "切换动效光标 / Toggle animated cursor",
      callback: async () => {
        await this.setAnimatedCursorEnabled(!this.settings.animatedCursorEnabled);
        new obsidian.Notice(`Crisp Focus 动效光标已${this.settings.animatedCursorEnabled ? "开启" : "关闭"}`);
      }
    });

    this.addCommand({
      id: "toggle-typewriter-scroll",
      name: "切换打字机定焦 / Toggle typewriter scrolling",
      callback: async () => {
        if (await this.setTypewriterScrollEnabled(!this.settings.typewriterScrollEnabled) === false) return;
        new obsidian.Notice(`Crisp Focus 打字机定焦已${this.settings.typewriterScrollEnabled ? "开启" : "关闭"}`);
      }
    });

    this.addCommand({
      id: "toggle-typewriter-mode",
      name: "切换定焦模式（平滑/严格） / Toggle typewriter mode (Soft/Strict)",
      callback: async () => {
        const newMode = this.settings.typewriterScrollMode === "soft" ? "strict" : "soft";
        await this.setTypewriterScrollMode(newMode);
        new obsidian.Notice(`Crisp Focus 已切换为${newMode === "soft" ? "平滑区间模式" : "严格定焦模式"}`);
      }
    });

    this.addCommand({
      id: "toggle-typewriter-audio",
      name: "切换打字音效 / Toggle sound effects",
      callback: async () => {
        if (!this.settings.typewriterAudioEnabled && !this.licenseManager.isEntitled()) {
          new obsidian.Notice("🔒 开启打字音效属于 Crisp 激活用户专属功能");
          return;
        }
        this.markSceneCustom();
        this.settings.typewriterAudioEnabled = !this.settings.typewriterAudioEnabled;
        await this.saveSettings();
        new obsidian.Notice(`Crisp Focus 音效已${this.settings.typewriterAudioEnabled ? "开启" : "静音"}`);
      }
    });

    this.addCommand({
      id: "toggle-clean-typing",
      name: "切换清爽打字 / Toggle clean typing",
      callback: () => {
        if (this.setCleanTypingEnabled(!this.cleanTypingActive)) {
          new obsidian.Notice(`Crisp Focus 清爽打字已${this.cleanTypingActive ? "开启" : "关闭"}`);
        }
      }
    });

    Object.entries(FOCUS_SCENES).forEach(([sceneId, scene]) => {
      this.addCommand({
        id: `apply-scene-${sceneId}`,
        name: `应用场景 / Apply scene: ${scene.name}`,
        callback: async () => {
          const result = await this.applyScene(sceneId);
          if (result.applied) {
            new obsidian.Notice(`Crisp Focus 已切换到“${scene.name}”`);
          } else {
            new obsidian.Notice(`🔒 ${result.reason}`);
          }
        },
      });
    });

    this.addCommand({
      id: "open-pomodoro",
      name: "打开番茄钟 / Open pomodoro timer",
      callback: () => this.openPomodoroModal(),
    });
    this.addCommand({
      id: "start-pomodoro",
      name: "开始番茄 / Start pomodoro",
      callback: () => this.startPomodoro(),
    });
    this.addCommand({
      id: "skip-pomodoro-break",
      name: "跳过休息 / Skip pomodoro break",
      callback: () => {
        if (this.settings.sessionMeta?.kind !== "break") {
          new obsidian.Notice("现在不是番茄钟的休息时间");
          return;
        }
        return this.skipPomodoroBreak();
      },
    });

    this.addCommand({
      id: "start-focus-session-25",
      name: "开始 25 分钟专注 / Start 25-minute focus session",
      callback: () => this.startFocusSession(25),
    });
    this.addCommand({
      id: "start-focus-session-50",
      name: "开始 50 分钟专注 / Start 50-minute focus session",
      callback: () => this.startFocusSession(50),
    });
    this.addCommand({
      id: "pause-resume-focus-session",
      name: "暂停或继续专注 / Pause or resume focus session",
      callback: () => {
        const status = this.session.getSnapshot().status;
        if (status === "running") return this.pauseFocusSession();
        if (status === "paused") return this.resumeFocusSession();
        new obsidian.Notice("当前没有进行中的专注会话");
      },
    });
    this.addCommand({
      id: "stop-focus-session",
      name: "结束专注 / Stop focus session",
      callback: () => {
        if (this.session.getSnapshot().status === "idle") {
          new obsidian.Notice("当前没有进行中的专注会话");
          return;
        }
        return this.stopFocusSession();
      },
    });
  }

  onunload() {
    if (this.cleanTypingActive) this.setCleanTypingEnabled(false);
    if (this.cursorPatchTimer !== null && this.cursorPatchTimer !== undefined) {
      this.mainWindow.clearTimeout(this.cursorPatchTimer);
      this.cursorPatchTimer = null;
    }
    if (this.cursorPatchUninstallers) {
      for (const uninstall of this.cursorPatchUninstallers.values()) {
        uninstall();
      }
      this.cursorPatchUninstallers.clear();
    }
    this.clearCursorStyles();
    if (this.typewriterEngine) {
      this.typewriterEngine.destroy();
    }
    this.clearTypewriterStyles();
    if (this.windowBindings) {
      Array.from(this.windowBindings.keys()).forEach((windowObj) => {
        this.detachWindow(windowObj);
      });
    }
    if (this.audio) {
      this.audio.destroy();
    }
    if (this.session) {
      this.session.destroy();
    }
    this.licenseManager?.destroy();
    this.closePomodoroPanel?.();
  }

  async saveSettings() {
    // A damaged data.json we could not back up must never be overwritten.
    if (this.settingsWriteBlocked) return;
    await this.saveData(this.settings);
  }

  getDataFilePath() {
    const configDir = this.app?.vault?.configDir || ".obsidian";
    const dir = this.manifest?.dir || `${configDir}/plugins/crisp-focus`;
    return `${dir}/data.json`;
  }

  // Obsidian's loadData() returns null for a missing file and undefined for a file
  // it could not read or parse. Treating the latter as a fresh install would
  // overwrite the damaged file (and the license code in it) on the next save.
  async loadSavedSettings() {
    const raw = await this.loadData();
    if (raw === null) return {};
    if (raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) return raw;

    const adapter = this.app?.vault?.adapter;
    const dataPath = this.getDataFilePath();
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
    const backupPath = `${dataPath}.corrupt-${stamp}`;
    let preserved = false;
    try {
      if (adapter && typeof adapter.exists === "function" && !(await adapter.exists(dataPath))) {
        return {};
      }
      if (adapter && typeof adapter.copy === "function") {
        try {
          await adapter.copy(dataPath, backupPath);
          preserved = true;
        } catch (copyError) {
          // Fall back to read + write below.
        }
      }
      if (!preserved && adapter && typeof adapter.read === "function" && typeof adapter.write === "function") {
        await adapter.write(backupPath, await adapter.read(dataPath));
        preserved = true;
      }
    } catch (error) {
      console.error("[Crisp Focus] Could not back up damaged data.json", error);
    }

    if (preserved) {
      console.warn(`[Crisp Focus] data.json was unreadable; backed up to ${backupPath}`);
      new obsidian.Notice(
        `Crisp Focus 设置文件已损坏，已备份为 ${backupPath.split("/").pop()} 并恢复默认设置。如需继续使用付费音效，请重新输入授权码。`,
        12000
      );
    } else {
      this.settingsWriteBlocked = true;
      new obsidian.Notice(
        "Crisp Focus 无法读取设置文件，也无法备份它。本次使用默认设置运行，且不会写入 data.json，以免覆盖原文件。",
        12000
      );
    }
    return {};
  }

  async refreshLicense() {
    const previousLastOnlineAt = this.settings.licenseLastOnlineAt;
    const result = await this.licenseManager.verify();
    if (this.settings.licenseLastOnlineAt !== previousLastOnlineAt) {
      await this.saveSettings();
    }
    if (!result.valid && this.audio) {
      this.audio.stopAmbient();
    }
    return result;
  }

  async activateLicense(code) {
    const trimmed = (code || "").trim();
    const savedCode = this.settings.licenseCode;
    const result = await this.licenseManager.verify(trimmed);
    // 已被更新的请求取代：结果作废，也不能回滚到旧授权码
    if (result.stale) return result;
    if (result.valid) {
      this.settings.licenseCode = trimmed;
      await this.saveSettings();
      this.updateTypewriterStyles();
      return result;
    }
    if (savedCode && savedCode !== trimmed) {
      await this.licenseManager.verify(savedCode);
    }
    return result;
  }

  async applyScene(sceneId) {
    const scene = FOCUS_SCENES[sceneId];
    if (!scene) {
      return { applied: false, reason: "未知的专注场景" };
    }
    if (sceneRequiresLicense(scene) && !this.licenseManager.isEntitled()) {
      return { applied: false, reason: "此场景包含音效，需要先激活 Crisp Focus" };
    }

    Object.assign(this.settings, scene.settings, { activeSceneId: sceneId });
    await this.saveSettings();
    if (this.audio) {
      this.audio.updateAmbient();
    }
    this.updateTypewriterStyles();
    if (!this.settings.animatedCursorEnabled) {
      this.clearCursorStyles();
    }
    const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
    if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
      this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "scene-change");
    }
    return { applied: true, scene };
  }

  markSceneCustom() {
    this.settings.activeSceneId = "custom";
  }

  onSessionUpdate(snapshot, reason) {
    this.settings.sessionState = snapshot;
    this.renderSessionStatus(snapshot);
    this.pomodoroView?.update();
    this.settingTab?.onSessionUpdate?.(snapshot, reason);
    if (reason !== "tick") {
      void this.saveSettings();
    }
  }

  renderSessionStatus(snapshot) {
    if (!this.statusBarEl) return;
    const meta = this.settings.sessionMeta;
    const pomodoro = this.settings.pomodoroState?.active ? this.settings.pomodoroState : null;
    const isBreak = meta?.kind === "break";
    this.statusBarEl.classList.toggle("is-running", snapshot.status === "running");
    this.statusBarEl.classList.toggle("is-paused", snapshot.status === "paused");
    this.statusBarEl.classList.toggle("is-break", isBreak && snapshot.status !== "idle");
    this.statusBarEl.classList.toggle("is-pomodoro", !!pomodoro);
    this.statusBarEl.classList.toggle("is-waiting", !!pomodoro?.waiting && snapshot.status === "idle");
    const time = formatSessionRemaining(snapshot.remainingMs);
    const round = meta?.pomodoro && meta.kind === "focus" ? ` · ${meta.round}/${this.pomodoroEvery()}` : "";
    if (snapshot.status === "running") {
      this.statusBarEl.setText(isBreak ? `${POMODORO_PHASE_LABELS[meta.phase]} ${time}` : `专注 ${time}${round}`);
    } else if (snapshot.status === "paused") {
      this.statusBarEl.setText(isBreak ? `${POMODORO_PHASE_LABELS[meta.phase]} 暂停 ${time}` : `专注 暂停 ${time}${round}`);
    } else if (pomodoro?.waiting) {
      this.statusBarEl.setText(`下一个番茄 · ${pomodoro.round + 1}/${this.pomodoroEvery()}`);
    } else {
      this.statusBarEl.setText("专注");
    }
    const task = snapshot.status !== "idle" || pomodoro ? focusTaskContext(meta?.task || pomodoro?.task) : null;
    // 用 Obsidian 的提示框（能定在上方），不用 title：原生提示会和它叠在一起
    this.statusBarEl.setAttr("aria-label", task ? `${task.title} · 打开番茄钟` : "打开番茄钟");
  }

  /** 状态栏上方弹出的番茄钟面板；再点一次状态栏、点面板外面或按 Esc 关闭。 */
  togglePomodoroPanel() {
    if (this.pomodoroPopover) return this.closePomodoroPanel();
    const anchor = this.statusBarEl;
    const doc = anchor?.ownerDocument;
    if (!doc?.body?.createDiv) return this.openPomodoroModal();
    const win = doc.defaultView || window;
    const pop = doc.body.createDiv({ cls: "crisp-focus-pomo-popover", attr: { role: "dialog", "aria-label": "番茄钟" } });
    const view = new PomodoroPanelView(this, pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.bottom = `${Math.max(8, win.innerHeight - rect.top + 8)}px`;
    pop.style.right = `${Math.max(8, win.innerWidth - rect.right)}px`;
    const onPointer = (event) => {
      if (pop.contains(event.target) || anchor.contains(event.target)) return;
      this.closePomodoroPanel();
    };
    const onKey = (event) => { if (event.key === "Escape") this.closePomodoroPanel(); };
    doc.addEventListener("pointerdown", onPointer, true);
    doc.addEventListener("keydown", onKey, true);
    this.pomodoroPopover = { pop, view, close: () => {
      doc.removeEventListener("pointerdown", onPointer, true);
      doc.removeEventListener("keydown", onKey, true);
      this.pomodoroViews?.delete(view);
      view.destroy();
      pop.remove();
    } };
    (this.pomodoroViews ||= new Set()).add(view);
    anchor.addClass("is-open");
  }

  closePomodoroPanel() {
    const popover = this.pomodoroPopover;
    if (!popover) return;
    this.pomodoroPopover = null;
    this.statusBarEl?.removeClass?.("is-open");
    popover.close();
  }

  /** 命令面板和手机端：用对话框打开同一个面板。 */
  openPomodoroModal() {
    const Modal = obsidian.Modal;
    if (typeof Modal !== "function") return;
    const modal = new Modal(this.app);
    let view = null;
    modal.onOpen = () => {
      modal.modalEl.addClass("crisp-focus-pomo-modal");
      view = new PomodoroPanelView(this, modal.contentEl);
      (this.pomodoroViews ||= new Set()).add(view);
      // Obsidian 打开对话框时把焦点给第一个按钮，从命令面板打开会画出焦点框，像是已经选中了「暂停」。
      // 焦点放在对话框本身：Esc 照常关闭，按 Tab 再进入按钮。
      window.setTimeout(() => {
        if (!modal.modalEl.isConnected) return;
        modal.modalEl.tabIndex = -1;
        modal.modalEl.focus({ preventScroll: true });
      }, 0);
    };
    modal.onClose = () => {
      this.pomodoroViews?.delete(view);
      view?.destroy();
      modal.contentEl.empty();
    };
    modal.open();
  }

  get pomodoroView() {
    const views = this.pomodoroViews;
    if (!views?.size) return null;
    return { update: () => views.forEach((view) => view.update()) };
  }

  openSettings() {
    const setting = this.app?.setting;
    if (setting?.open) {
      setting.open();
      setting.openTabById?.(this.manifest?.id || "crisp-focus");
    }
  }

  pomodoroEvery() {
    return Math.max(2, Math.min(12, Math.round(Number(this.settings.pomodoroLongBreakEvery) || 4)));
  }

  activeNotePath() {
    try { return this.app?.workspace?.getActiveFile?.()?.path || null; } catch { return null; }
  }

  /** 这一段已经专注了多久（暂停的时间不算）。 */
  elapsedMs() {
    const meta = this.settings.sessionMeta;
    const snap = this.session.getSnapshot();
    if (!meta || snap.status === "idle") return 0;
    const remaining = snap.status === "running" ? Math.max(0, snap.endAt - Date.now()) : snap.remainingMs;
    return Math.max(0, meta.plannedMinutes * 60000 - remaining);
  }

  /* 对外的事件：Crisp Pulse 等插件据此记录每一段专注。
     type: start | pause | resume | stop | skip | complete；kind: focus | break。 */
  emitSessionEvent(type, extra = {}) {
    const meta = this.settings.sessionMeta;
    if (!meta) return;
    const payload = {
      apiVersion: FOCUS_API_VERSION,
      type,
      id: meta.id,
      kind: meta.kind,
      phase: meta.phase,
      pomodoro: !!meta.pomodoro,
      round: meta.round || 0,
      roundsPerCycle: meta.pomodoro ? this.pomodoroEvery() : 0,
      plannedMinutes: meta.plannedMinutes,
      startedAt: meta.startedAt,
      at: Date.now(),
      notePath: meta.notePath || null,
      task: focusTaskContext(meta.task),
      ...extra,
    };
    try {
      this.app?.workspace?.trigger?.("crisp-focus:session", payload);
    } catch (error) {
      console.error("[Crisp Focus] session event listener failed", error);
    }
  }

  /** 番茄钟当前状态，供面板和其他插件读取。 */
  getPomodoroSnapshot() {
    const snap = this.session.getSnapshot();
    const meta = this.settings.sessionMeta;
    const state = this.settings.pomodoroState;
    const today = this.settings.pomodoroToday?.date === localDateKey() ? this.settings.pomodoroToday : { count: 0, focusMinutes: 0 };
    const remainingMs = snap.status === "running" ? Math.max(0, snap.endAt - Date.now()) : snap.remainingMs;
    return {
      status: snap.status,
      remainingMs,
      plannedMs: meta ? meta.plannedMinutes * 60000 : 0,
      kind: meta?.kind || null,
      phase: meta?.phase || null,
      pomodoro: !!meta?.pomodoro || !!state?.active,
      active: !!state?.active,
      waiting: !!state?.waiting && snap.status === "idle",
      round: meta?.round || (state ? state.round + 1 : 0),
      completedRounds: state?.round || 0,
      every: this.pomodoroEvery(),
      focusMinutes: pomodoroPhaseMinutes(this.settings, "focus"),
      shortBreakMinutes: pomodoroPhaseMinutes(this.settings, "short-break"),
      longBreakMinutes: pomodoroPhaseMinutes(this.settings, "long-break"),
      todayCount: today.count || 0,
      todayFocusMinutes: today.focusMinutes || 0,
      goal: Math.max(1, Math.min(24, Math.round(Number(this.settings.pomodoroDailyGoal) || 8))),
      entitled: !!this.licenseManager?.isEntitled(),
      task: focusTaskContext(meta?.task || state?.task),
    };
  }

  /** 番茄钟需要激活；单次专注会话仍然免费。options.task：整轮番茄都记在这个任务上。 */
  async startPomodoro(options = {}) {
    if (!this.licenseManager.isEntitled()) {
      new obsidian.Notice("🔒 番茄钟属于 Crisp 激活用户专属功能，可以先用单次专注会话");
      return null;
    }
    const stopping = this.session.getSnapshot().status !== "idle" ? this.stopFocusSession() : null;
    this.settings.pomodoroState = { active: true, round: 0, cycleId: newSessionId(), waiting: false, task: focusTaskContext(options?.task) };
    const started = this.startPomodoroPhase("focus");
    await stopping;
    return started;
  }

  async startPomodoroPhase(phase) {
    const state = this.settings.pomodoroState;
    if (!state?.active) return null;
    const kind = phase === "focus" ? "focus" : "break";
    if (kind === "focus" && !this.licenseManager.isEntitled()) {
      new obsidian.Notice("🔒 番茄钟属于 Crisp 激活用户专属功能");
      return null;
    }
    const minutes = pomodoroPhaseMinutes(this.settings, phase);
    state.waiting = false;
    this.settings.sessionMeta = {
      id: newSessionId(), kind, phase, pomodoro: true, round: kind === "focus" ? state.round + 1 : state.round,
      plannedMinutes: minutes, startedAt: Date.now(), notePath: this.activeNotePath(), task: focusTaskContext(state.task),
    };
    if (kind === "focus") return this.startFocusSession(minutes, { pomodoro: true });
    // 休息：关掉专注效果和环境音，只留倒计时。
    // 计时和事件先于写盘完成，写盘期间插进来的新动作看到的是一致的状态。
    this.session.start(minutes);
    this.emitSessionEvent("start");
    const snapshot = this.session.getSnapshot();
    await this.setFocusModeEnabled(false);
    await this.saveSettings();
    return snapshot;
  }

  /** 休息结束后开始下一个番茄（不自动开始时由用户点）。 */
  async startNextPomodoro() {
    const state = this.settings.pomodoroState;
    if (!state?.active || this.session.getSnapshot().status !== "idle") return null;
    if (!this.licenseManager.isEntitled()) {
      new obsidian.Notice("🔒 番茄钟属于 Crisp 激活用户专属功能");
      return null;
    }
    return this.startPomodoroPhase("focus");
  }

  async skipPomodoroBreak() {
    const meta = this.settings.sessionMeta;
    if (meta?.kind !== "break" || this.session.getSnapshot().status === "idle") return null;
    if (!this.licenseManager.isEntitled()) {
      new obsidian.Notice("🔒 番茄钟属于 Crisp 激活用户专属功能");
      return null;
    }
    this.emitSessionEvent("skip", { completed: false, elapsedMs: this.elapsedMs() });
    this.settings.sessionMeta = null;
    this.session.stop();
    return this.startPomodoroPhase("focus");
  }

  /** 结束整轮番茄：正在专注的这一个记为中断（只记录、不计分），休息直接结束。 */
  async endPomodoro() {
    if (this.session.getSnapshot().status !== "idle") return this.stopFocusSession();
    this.settings.pomodoroState = null;
    this.settings.sessionMeta = null;
    await this.saveSettings();
    this.renderSessionStatus(this.session.getSnapshot());
    this.pomodoroView?.update();
    return this.session.getSnapshot();
  }

  async handleSessionComplete() {
    if (this.settings.sessionMeta?.kind === "break") return this.completePomodoroBreak();
    return this.completeFocusSession();
  }

  bumpPomodoroToday(minutes) {
    const date = localDateKey();
    const today = this.settings.pomodoroToday?.date === date ? this.settings.pomodoroToday : { date, count: 0, focusMinutes: 0 };
    this.settings.pomodoroToday = { date, count: (today.count || 0) + 1, focusMinutes: (today.focusMinutes || 0) + minutes };
  }

  async completePomodoroBreak() {
    const meta = this.settings.sessionMeta;
    this.emitSessionEvent("complete", { completed: true, elapsedMs: (meta?.plannedMinutes || 0) * 60000 });
    this.settings.sessionMeta = null;
    if (this.settings.pomodoroChime !== false) this.audio?.playChime?.("break-end");
    const state = this.settings.pomodoroState;
    if (!state?.active) {
      await this.saveSettings();
      return;
    }
    if (this.settings.pomodoroAutoStartFocus && this.licenseManager.isEntitled()) {
      new obsidian.Notice(`休息结束，开始第 ${state.round + 1} 个番茄`);
      await this.startPomodoroPhase("focus");
      return;
    }
    state.waiting = true;
    await this.saveSettings();
    this.renderSessionStatus(this.session.getSnapshot());
    this.pomodoroView?.update();
    new obsidian.Notice(`休息结束，准备好就开始第 ${state.round + 1} 个番茄`);
  }

  async startFocusSession(minutes = this.settings.sessionDurationMinutes, options = {}) {
    const duration = Math.max(1, Math.min(240, Math.round(Number(minutes) || 25)));
    if (this.session.getSnapshot().status !== "idle") {
      // 正在计时又开始新的：前一段记为中断
      this.emitSessionEvent("stop", { completed: false, elapsedMs: this.elapsedMs() });
    }
    if (!options.pomodoro) {
      this.settings.sessionDurationMinutes = duration;
      this.settings.pomodoroState = null;
      this.settings.sessionMeta = {
        id: newSessionId(), kind: "focus", phase: "focus", pomodoro: false, round: 0,
        plannedMinutes: duration, startedAt: Date.now(), notePath: this.activeNotePath(), task: focusTaskContext(options.task),
      };
    }
    this.session.start(duration);
    this.emitSessionEvent("start");
    const snapshot = this.session.getSnapshot();
    await this.setFocusModeEnabled(true);
    await this.saveSettings();
    return snapshot;
  }

  async pauseFocusSession() {
    const snapshot = this.session.pause();
    if (snapshot.status === "paused") {
      this.audio?.stopAmbient();
      this.emitSessionEvent("pause", { elapsedMs: this.elapsedMs() });
    }
    await this.saveSettings();
    return snapshot;
  }

  async resumeFocusSession() {
    const snapshot = this.session.resume();
    if (snapshot.status === "running") {
      if (this.settings.sessionMeta?.kind !== "break") await this.setFocusModeEnabled(true);
      this.audio.updateAmbient();
      this.emitSessionEvent("resume");
    }
    await this.saveSettings();
    return snapshot;
  }

  async stopFocusSession() {
    if (this.session.getSnapshot().status === "idle") {
      return this.session.getSnapshot();
    }
    this.emitSessionEvent("stop", { completed: false, elapsedMs: this.elapsedMs() });
    this.settings.sessionMeta = null;
    this.settings.pomodoroState = null;
    const snapshot = this.session.stop();
    await this.setFocusModeEnabled(false);
    await this.saveSettings();
    return snapshot;
  }

  /* 专注（单次或番茄钟的专注阶段）跑完。旧版 Crisp Pulse 会包装这个方法来计入专注分钟，
     所以休息阶段从不经过这里。 */
  async completeFocusSession() {
    const meta = this.settings.sessionMeta;
    if (meta) this.emitSessionEvent("complete", { completed: true, elapsedMs: meta.plannedMinutes * 60000 });
    const state = this.settings.pomodoroState;
    if (meta?.pomodoro && state?.active) {
      state.round += 1;
      this.bumpPomodoroToday(meta.plannedMinutes);
      if (this.settings.pomodoroChime !== false) this.audio?.playChime?.("focus-end");
      const next = nextPomodoroBreak(state.round, this.pomodoroEvery());
      new obsidian.Notice(`第 ${state.round} 个番茄完成，${POMODORO_PHASE_LABELS[next]} ${pomodoroPhaseMinutes(this.settings, next)} 分钟`);
      this.settings.sessionMeta = null;
      await this.startPomodoroPhase(next);
      return;
    }
    this.settings.sessionMeta = null;
    await this.setFocusModeEnabled(false);
    await this.saveSettings();
    new obsidian.Notice("Crisp Focus 专注会话完成");
  }

  clearCursorStyles() {
    const windowObjects = this.windowBindings
      ? Array.from(this.windowBindings.keys())
      : [this.mainWindow];
    windowObjects.forEach((windowObj) => {
      if (!windowObj || !windowObj.document) return;
      windowObj.document.querySelectorAll(".cm-editor.crisp-focus-active").forEach((editor) => {
        editor.classList.remove("crisp-focus-active", "crisp-focus-no-blink");
        editor.style.removeProperty("--crisp-focus-cursor-speed");
        editor.style.removeProperty("--crisp-focus-blink-rate");
        editor.style.removeProperty("--crisp-focus-blink-count");
      });
      windowObj.document.querySelectorAll(".cm-editor .cm-cursor").forEach((cursorEl) => {
        cursorEl.style.transition = "";
      });
    });
  }

  // Key sounds should follow any host that actually receives text input, not only
  // the Markdown editor — otherwise plugins that render their own editor (e.g.
  // Crisp Mind's inline <input>) stay silent while IME confirm sounds still fire.
  isAudioHostTarget(activeEl) {
    if (!activeEl) return false;
    const tag = activeEl.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if (activeEl.isContentEditable) return true;
    return Boolean(
      activeEl.closest
      && activeEl.closest(
        ".cm-editor, .markdown-source-view, .cm-content, .markdown-rendered, .canvas-node, .canvas-node-content"
      )
    );
  }

  attachWindow(windowObj) {
    if (!windowObj || this.windowBindings.has(windowObj)) return;
    const state = { isComposing: false, lastCharKeydownAt: 0, lastRepeatAt: 0 };
    const gestureHandler = () => {
      if (!this.settings.focusModeEnabled) return;
      this.audio.handleUserGesture();
    };
    const compositionStartHandler = () => {
      state.isComposing = true;
      this.isComposing = true;
    };
    const compositionEndHandler = (evt) => {
      state.isComposing = false;
      this.isComposing = false;
      // Cancellation is not a commit; restrict feedback to actual input hosts.
      if (evt.data === "" || !this.isAudioHostTarget(windowObj.document.activeElement)) return;
      state.lastCharKeydownAt = Date.now();
      if (this.settings.focusModeEnabled && this.settings.typewriterAudioEnabled) {
        this.audio.playSpaceKey();
      }
      if (isTypewriterActive(this)) {
        const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
        if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
          const win = windowObj || window;
          if (typeof win.requestAnimationFrame === "function") {
            win.requestAnimationFrame(() => {
              this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "ime-commit");
            });
          }
        }
      }
    };
    const keydownHandler = (evt) => {
      gestureHandler();
      if (this.typewriterEngine) {
        this.typewriterEngine.onUserActivity();
      }
      if (!this.settings.focusModeEnabled || !this.settings.typewriterAudioEnabled) return;
      if (evt.ctrlKey || evt.altKey || evt.metaKey) return;

      const activeEl = windowObj.document.activeElement;
      if (!this.isAudioHostTarget(activeEl)) return;

      const key = evt.key;
      // 长按自动重复：真键盘按住只响一下，只有连删保留一串轻响，提示还在删
      if (evt.repeat) {
        if (key !== "Backspace" && key !== "Delete") return;
        const now = Date.now();
        if (now - state.lastRepeatAt < 70) return;
        state.lastRepeatAt = now;
        this.audio.playBackspaceKey(true);
        return;
      }
      if (state.isComposing || evt.isComposing || evt.keyCode === 229) {
        if (key.length === 1 && key !== " ") {
          state.lastCharKeydownAt = Date.now();
          this.audio.playCharKey();
        }
        return;
      }
      if (key === "Enter") {
        this.audio.playEnterKey();
      } else if (key === " ") {
        state.lastCharKeydownAt = Date.now();
        this.audio.playSpaceKey();
      } else if (key === "Backspace" || key === "Delete") {
        this.audio.playBackspaceKey();
      } else if (key.length === 1) {
        state.lastCharKeydownAt = Date.now();
        this.audio.playCharKey();
      }
    };

    const beforeInputHandler = (evt) => {
      gestureHandler();
      if (this.typewriterEngine) {
        this.typewriterEngine.onUserActivity();
      }
      if (!this.settings.focusModeEnabled || !this.settings.typewriterAudioEnabled) return;
      // iOS 屏幕键盘：英文走 insertText，中文走组合输入 insertCompositionText。
      if (evt.inputType !== "insertText" && evt.inputType !== "insertCompositionText") return;
      if (Date.now() - state.lastCharKeydownAt < 80) return;
      const activeEl = windowObj.document.activeElement;
      if (!this.isAudioHostTarget(activeEl)) return;
      if (evt.data === "") return;
      if (evt.data === " " && !state.isComposing && !evt.isComposing) {
        this.audio.playSpaceKey();
      } else {
        this.audio.playCharKey();
      }
    };

    windowObj.addEventListener("pointerdown", gestureHandler, { capture: true, passive: true });
    windowObj.addEventListener("touchstart", gestureHandler, { capture: true, passive: true });
    windowObj.addEventListener("compositionstart", compositionStartHandler, { capture: true, passive: true });
    windowObj.addEventListener("compositionend", compositionEndHandler, { capture: true, passive: true });
    windowObj.addEventListener("beforeinput", beforeInputHandler, { capture: true, passive: true });
    windowObj.addEventListener("keydown", keydownHandler, { capture: true, passive: true });
    this.windowBindings.set(windowObj, {
      beforeInputHandler,
      compositionEndHandler,
      compositionStartHandler,
      gestureHandler,
      keydownHandler,
    });
    this.applyCleanTypingClasses(windowObj);
  }

  attachExistingWindows() {
    this.app?.workspace?.iterateAllLeaves?.((leaf) => {
      const windowObj = leaf?.view?.containerEl?.ownerDocument?.defaultView;
      if (windowObj) this.attachWindow(windowObj);
    });
  }

  detachWindow(windowObj) {
    const binding = this.windowBindings && this.windowBindings.get(windowObj);
    if (!binding) return;
    windowObj.removeEventListener("pointerdown", binding.gestureHandler, { capture: true });
    windowObj.removeEventListener("touchstart", binding.gestureHandler, { capture: true });
    windowObj.removeEventListener("compositionstart", binding.compositionStartHandler, { capture: true });
    windowObj.removeEventListener("compositionend", binding.compositionEndHandler, { capture: true });
    windowObj.removeEventListener("beforeinput", binding.beforeInputHandler, { capture: true });
    windowObj.removeEventListener("keydown", binding.keydownHandler, { capture: true });
    this.windowBindings.delete(windowObj);
  }

  // 清爽打字：收起两侧栏，标题栏、功能区和侧栏按钮交给 styles.css 隐藏。
  // 只恢复进入时由我们收起的那一侧；用户原本就收着的侧栏保持不动。
  setCleanTypingEnabled(enabled) {
    if (enabled === this.cleanTypingActive) return true;
    // 手机端靠视图标题栏返回和切换笔记，隐藏后没有出口
    if (enabled && obsidian.Platform?.isMobile) {
      new obsidian.Notice("清爽打字目前只支持桌面端");
      return false;
    }
    if (enabled && !this.licenseManager?.isEntitled()) {
      new obsidian.Notice("🔒 清爽打字属于 Crisp 激活用户专属功能");
      return false;
    }
    const workspace = this.app?.workspace;
    if (enabled) {
      this.cleanTypingRestore = {
        left: !!workspace?.leftSplit && !workspace.leftSplit.collapsed,
        right: !!workspace?.rightSplit && !workspace.rightSplit.collapsed,
      };
      if (this.cleanTypingRestore.left) workspace.leftSplit.collapse();
      if (this.cleanTypingRestore.right) workspace.rightSplit.collapse();
    } else {
      const restore = this.cleanTypingRestore || {};
      if (restore.left && workspace?.leftSplit?.collapsed) workspace.leftSplit.expand();
      if (restore.right && workspace?.rightSplit?.collapsed) workspace.rightSplit.expand();
      this.cleanTypingRestore = null;
    }
    this.cleanTypingActive = enabled;
    this.applyCleanTypingClasses();
    return true;
  }

  async setCleanTypingHideStatusBar(hidden) {
    this.settings.cleanTypingHideStatusBar = hidden;
    await this.saveSettings();
    this.applyCleanTypingClasses();
  }

  applyCleanTypingClasses(onlyWindow = null) {
    const windowObjects = onlyWindow
      ? [onlyWindow]
      : (this.windowBindings ? Array.from(this.windowBindings.keys()) : [this.mainWindow]);
    const active = !!this.cleanTypingActive;
    windowObjects.forEach((windowObj) => {
      const body = windowObj?.document?.body;
      if (!body || !body.classList) return;
      body.classList.toggle("crisp-focus-clean-typing", active);
      body.classList.toggle(
        "crisp-focus-clean-typing--hide-status",
        active && this.settings.cleanTypingHideStatusBar !== false
      );
    });
  }

  async setAnimatedCursorEnabled(enabled) {
    this.markSceneCustom();
    this.settings.animatedCursorEnabled = enabled;
    await this.saveSettings();
    if (!enabled) {
      this.clearCursorStyles();
    }
  }

  async setTypewriterScrollEnabled(enabled) {
    if (enabled && !this.licenseManager.isEntitled()) {
      new obsidian.Notice("🔒 打字机定焦属于 Crisp 激活用户专属功能");
      return false;
    }
    this.markSceneCustom();
    this.settings.typewriterScrollEnabled = enabled;
    await this.saveSettings();
    this.updateTypewriterStyles();
    if (enabled) {
      const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
      if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
        this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "toggle");
      }
    }
    return true;
  }

  async setTypewriterScrollMode(mode) {
    this.markSceneCustom();
    this.settings.typewriterScrollMode = mode;
    await this.saveSettings();
    const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
    if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
      this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "mode-change");
    }
  }

  async setTypewriterScrollOffset(offset) {
    this.markSceneCustom();
    this.settings.typewriterScrollOffset = Math.max(20, Math.min(80, Math.round(Number(offset) || 42)));
    await this.saveSettings();
    this.updateTypewriterStyles();
    const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
    if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
      this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "offset-change");
    }
  }

  async setTypewriterScrollTolerance(tolerance) {
    this.markSceneCustom();
    this.settings.typewriterScrollTolerance = Math.max(5, Math.min(25, Math.round(Number(tolerance) || 10)));
    await this.saveSettings();
    const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
    if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
      this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "tolerance-change");
    }
  }

  async setTypewriterScrollBottomPadding(enabled) {
    this.markSceneCustom();
    this.settings.typewriterScrollBottomPadding = enabled;
    await this.saveSettings();
    this.updateTypewriterStyles();
  }

  async setTypewriterScrollSmooth(smooth) {
    this.markSceneCustom();
    this.settings.typewriterScrollSmooth = smooth;
    await this.saveSettings();
  }

  updateTypewriterStyles() {
    const windowObjects = this.windowBindings
      ? Array.from(this.windowBindings.keys())
      : [this.mainWindow];
    windowObjects.forEach((windowObj) => {
      if (!windowObj || !windowObj.document) return;
      windowObj.document.querySelectorAll(".cm-editor").forEach((editor) => {
        applyTypewriterStylesToEditor(editor, this.settings, this.licenseManager?.isEntitled?.());
      });
    });
  }

  clearTypewriterStyles() {
    const windowObjects = this.windowBindings
      ? Array.from(this.windowBindings.keys())
      : [this.mainWindow];
    windowObjects.forEach((windowObj) => {
      if (!windowObj || !windowObj.document) return;
      windowObj.document.querySelectorAll(".cm-editor.crisp-focus-typewriter-active, .cm-editor.crisp-focus-typewriter-padding").forEach((editor) => {
        if (editor.classList) {
          editor.classList.remove("crisp-focus-typewriter-active", "crisp-focus-typewriter-padding");
        }
        if (editor.style) {
          editor.style.removeProperty("--crisp-focus-typewriter-bottom-ratio");
          editor.style.removeProperty("--crisp-focus-typewriter-bottom-space");
          editor.style.removeProperty("--crisp-focus-typewriter-offset-ratio");
        }
      });
    });
  }

  async setFocusModeEnabled(enabled) {
    this.settings.focusModeEnabled = enabled;
    await this.saveSettings();
    // 写盘期间别的动作可能改了开关：按最新值收尾，旧动作不覆盖新动作
    enabled = this.settings.focusModeEnabled;
    this.updateTypewriterStyles();
    if (!enabled) {
      this.clearCursorStyles();
      this.clearTypewriterStyles();
      this.audio.stopAmbient();
      return;
    }
    this.audio.updateAmbient();
    const activeLeaf = this.app?.workspace?.getActiveViewOfType?.(obsidian.MarkdownView);
    if (activeLeaf && activeLeaf.editor && activeLeaf.editor.cm) {
      this.typewriterEngine?.requestScroll(activeLeaf.editor.cm, "focus-enable");
    }
  }
}

module.exports = CrispFocusPlugin;
