/* ==========================================================================
   Crisp Focus - Spring-Eased Cursor & Local Ambient Engine (v1.1.11)
   Crafted by letschips (Xiaohongshu)
   ========================================================================== */

var obsidian = require("obsidian");
const { requestUrl } = obsidian;

const CRISP_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiz41HIDpD59SH3DjKnovUO+EEhTJXjvmiug/ev9t4ZQ=
-----END PUBLIC KEY-----`;


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

async function importEd25519PublicKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  return await window.crypto.subtle.importKey(
    "spki",
    der.buffer,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

async function verifyLicenseCode(licenseCode, targetPluginId = "crisp-focus") {
  const trimmed = (licenseCode || "").trim();
  if (!trimmed) return { valid: false, reason: "授权码为空" };
  const parts = trimmed.split(".");
  if (parts.length !== 2) return { valid: false, reason: "授权码格式无效" };
  const [payloadBase64, signatureBase64] = parts;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadBase64));
    const payload = JSON.parse(payloadJson);
    const validProducts = ["Crisp Suite", "Crisp ASR", "Crisp Annotations", "Crisp File Explorer", "Crisp Focus", "Crisp Reading Rail"];
    if (!validProducts.includes(payload.product)) return { valid: false, reason: "授权码不属于 Crisp 系列插件" };
    const features = Array.isArray(payload.features) ? payload.features : [];
    if (!features.includes("all") && !features.includes(targetPluginId)) {
      return { valid: false, reason: `该授权码未包含 ${targetPluginId} 权限` };
    }
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: `授权已于 ${payload.expiresAt.split("T")[0]} 到期` };
    }
    const publicKey = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM);
    const isValid = await window.crypto.subtle.verify(
      "Ed25519",
      publicKey,
      base64UrlToUint8Array(signatureBase64),
      new TextEncoder().encode(payloadBase64)
    );
    if (!isValid) return { valid: false, reason: "授权签名无效" };

    try {
      const app = (window.app);
      const deviceId = app?.appId || (app?.vault?.getName ? "vault-" + encodeURIComponent(app.vault.getName()) : "device-default");
      const res = await requestUrl({
        url: "https://crisp-license.helloherve-xsn.workers.dev/api/verify-device",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseCode: trimmed,
          deviceId: deviceId,
          action: "activate",
          pluginId: targetPluginId
        })
      });
      const cloudResult = res.json;
      if (cloudResult && typeof cloudResult.valid === "boolean") {
        if (cloudResult.valid === false) {
          return { valid: false, reason: cloudResult.reason || "设备数已达上限" };
        }
        return { valid: true, payload, message: cloudResult.message };
      }
    } catch (netErr) {}

    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: `解析授权码失败: ${e.message}` };
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
class CrispFocusAudioEngine {
  constructor(app, getEnabled, getTheme, getVolume, getBellEnabled, getAmbientSound, getAmbientVol, windowObj) {
    this.app = app;
    this.getEnabled = getEnabled;
    this.getTheme = getTheme;
    this.getVolume = getVolume;
    this.getBellEnabled = getBellEnabled;
    this.getAmbientSound = getAmbientSound;
    this.getAmbientVol = getAmbientVol;
    this.windowObj = windowObj;
    this.ctx = null;
    this.noiseBuffer = null;
    this.outputContext = null;
    this.outputGain = null;
    this.outputLimiter = null;

    // HD MP3 Ambient Player
    this.ambientAudioEl = null;
    this.currentAmbientSound = null;
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
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.035);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.22));
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
    if (!this.getEnabled()) return;
    this.unlock();
    if (!this.ctx) return;

    const theme = this.getTheme();
    const now = this.ctx.currentTime;
    const vol = this.MasterVolume;

    if (theme === "mechanical") {
      const freq = this.getRandomPitch(320);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.025);

      gain.gain.setValueAtTime(vol * 0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.025);
    } else if (theme === "raindrop") {
      const freq = this.getRandomPitch(1200);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(500, now + 0.02);

      gain.gain.setValueAtTime(vol * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.02);
    } else if (theme === "retro8bit") {
      const freq = this.getRandomPitch(520);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.setValueAtTime(freq * 1.5, now + 0.012);

      gain.gain.setValueAtTime(vol * 0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.025);
    } else if (theme === "woodenFish") {
      const freq = this.getRandomPitch(560);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.04);

      gain.gain.setValueAtTime(vol * 0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.04);
    } else {
      const buffer = this.getNoiseBuffer();
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(this.getRandomPitch(2200), now);
      filter.Q.setValueAtTime(3.8, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol * 0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      noise.connect(filter);
      filter.connect(gain);
      this.connectOutput(gain);
      noise.start(now);
    }
  }

  // 1.2 Spacebar / IME Confirm
  playSpaceKey() {
    if (!this.getEnabled()) return;
    this.unlock();
    if (!this.ctx) return;

    const theme = this.getTheme();
    const now = this.ctx.currentTime;
    const vol = this.MasterVolume;

    if (theme === "mechanical") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.05);

      gain.gain.setValueAtTime(vol * 0.75, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (theme === "raindrop") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.04);

      gain.gain.setValueAtTime(vol * 0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (theme === "retro8bit") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.05);

      gain.gain.setValueAtTime(vol * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (theme === "woodenFish") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);

      gain.gain.setValueAtTime(vol * 0.75, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.08);
    } else {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.06);

      gain.gain.setValueAtTime(vol * 0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  }

  // 1.3 Backspace
  playBackspaceKey() {
    if (!this.getEnabled()) return;
    this.unlock();
    if (!this.ctx) return;

    const theme = this.getTheme();
    const now = this.ctx.currentTime;
    const vol = this.MasterVolume;

    if (theme === "mechanical") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(580, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.022);

      gain.gain.setValueAtTime(vol * 0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.022);
    } else if (theme === "raindrop") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1600, now);
      osc.frequency.exponentialRampToValueAtTime(2400, now + 0.018);

      gain.gain.setValueAtTime(vol * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.018);
    } else if (theme === "retro8bit") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.03);

      gain.gain.setValueAtTime(vol * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.03);
    } else if (theme === "woodenFish") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.02);

      gain.gain.setValueAtTime(vol * 0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.02);
    } else {
      const buffer = this.getNoiseBuffer();
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(1400, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      noise.connect(filter);
      filter.connect(gain);
      this.connectOutput(gain);
      noise.start(now);
    }
  }

  // 1.4 Enter / Return
  playEnterKey() {
    if (!this.getEnabled()) return;
    this.unlock();
    if (!this.ctx) return;

    const theme = this.getTheme();
    const now = this.ctx.currentTime;
    const vol = this.MasterVolume;

    if (theme === "mechanical") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.07);

      gain.gain.setValueAtTime(vol * 0.85, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.07);
    } else if (theme === "raindrop") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.06);

      gain.gain.setValueAtTime(vol * 0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (theme === "retro8bit") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(987.77, now);
      osc.frequency.setValueAtTime(1318.5, now + 0.05);

      gain.gain.setValueAtTime(vol * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (theme === "woodenFish") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.09);

      gain.gain.setValueAtTime(vol * 0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      this.connectOutput(gain);
      osc.start(now);
      osc.stop(now + 0.09);

      if (this.getBellEnabled()) {
        const bowlOsc = this.ctx.createOscillator();
        const bowlGain = this.ctx.createGain();
        bowlOsc.type = "sine";
        bowlOsc.frequency.setValueAtTime(880, now + 0.02);

        bowlGain.gain.setValueAtTime(0.001, now);
        bowlGain.gain.setValueAtTime(vol * 0.7, now + 0.02);
        bowlGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

        bowlOsc.connect(bowlGain);
        this.connectOutput(bowlGain);
        bowlOsc.start(now + 0.02);
        bowlOsc.stop(now + 0.75);
      }
      return;
    } else {
      this.playSpaceKey();
    }

    if (this.getBellEnabled() && theme !== "woodenFish" && theme !== "retro8bit") {
      const bellOsc = this.ctx.createOscillator();
      const bellGain = this.ctx.createGain();
      bellOsc.type = "sine";
      bellOsc.frequency.setValueAtTime(1567.98, now + 0.02);

      bellGain.gain.setValueAtTime(0.001, now);
      bellGain.gain.setValueAtTime(vol * 0.85, now + 0.02);
      bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      bellOsc.connect(bellGain);
      this.connectOutput(bellGain);
      bellOsc.start(now + 0.02);
      bellOsc.stop(now + 0.45);
    }
  }

  // 1.5 HD Local MP3 Ambient Audio Player (Seamless Loop)
  updateAmbient() {
    const soundName = this.getAmbientSound(); // 'off', 'rain', 'campfire', 'ocean', 'wind'
    const vol = this.getAmbientVol();

    if (soundName === "off" || vol <= 0) {
      this.stopAmbient();
      return;
    }

    if (!this.ambientAudioEl) {
      this.ambientAudioEl = new Audio();
      this.ambientAudioEl.loop = true;
    }

    const configDir = this.app.vault.configDir || ".obsidian";
    const relativePath = `${configDir}/plugins/crisp-focus/audio/${soundName}.mp3`;
    const resourceUrl = this.app.vault.adapter.getResourcePath(relativePath);

    const soundChanged = this.currentAmbientSound !== soundName;
    if (soundChanged) {
      this.currentAmbientSound = soundName;
      this.ambientAudioEl.src = resourceUrl;
      this.ambientAudioEl.currentTime = 0;
    }

    this.ambientAudioEl.volume = Math.max(0, Math.min(1, vol));

    if (soundChanged || this.ambientAudioEl.paused) {
      this.ambientAudioEl.play().catch((err) => {
        console.warn("Ambient audio play failed:", err);
      });
    }
  }

  stopAmbient() {
    if (this.ambientAudioEl) {
      this.ambientAudioEl.pause();
      this.currentAmbientSound = null;
    }
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
// 2. CodeMirror 6 Native Cursor Layer Smooth Motion Hook
// --------------------------------------------------------------------------
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
      });
      patchedEditors.delete(editor);
    }
  };

  const unpatch = around(layer, {
    markers: (origMarkers) => function (view) {
      const result = origMarkers.call(this, view);
      if (!plugin.settings.focusModeEnabled || !plugin.settings.animatedCursorEnabled) {
        cleanupEditor(view.dom);
        return result;
      }

      const adjustableMarkers = Array.isArray(result)
        ? result.filter((marker) => marker && typeof marker.adjust === "function")
        : [];
      if (adjustableMarkers.length === 0) {
        cleanupEditor(view.dom);
        return result;
      }

      const speed = plugin.settings.cursorSpeed ?? 80;
      const blinkRate = plugin.settings.blinkRate ?? 1000;
      const blinkCount = plugin.settings.blinkCount ?? 10;

      view.dom.style.setProperty("--crisp-focus-cursor-speed", `${speed}ms`);
      view.dom.style.setProperty("--crisp-focus-blink-rate", `${blinkRate}ms`);
      view.dom.style.setProperty("--crisp-focus-blink-count", `${blinkCount}`);

      if (!patchedEditors.has(view.dom)) {
        patchedEditors.set(view.dom, new Set());
      }

      adjustableMarkers.forEach((marker) => {
        const origAdjust = marker.adjust;
        marker.adjust = function (cursorEl) {
          if (cursorEl) {
            view.dom.classList.add("crisp-focus-active");
            view.dom.classList.toggle("crisp-focus-no-blink", blinkCount === 0);
            cursorEl.style.transition = `transform ${speed}ms cubic-bezier(0.16, 1, 0.3, 1), height 80ms ease`;
            patchedEditors.get(view.dom).add(cursorEl);
          }
          return origAdjust.call(this, cursorEl);
        };
      });
      return result;
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
// 3. Settings Schema & Apple Spring Accordion Settings Tab
// --------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  focusModeEnabled: true,
  animatedCursorEnabled: true,
  cursorSpeed: 80,
  blinkRate: 1000,
  blinkCount: 10,
  typewriterAudioEnabled: true,
  soundTheme: "typewriter", // typewriter, mechanical, raindrop, retro8bit, woodenFish
  typewriterVolume: 0.7,
  typewriterBellEnabled: true,
  ambientSound: "off", // off, rain, campfire, ocean, wind
  ambientVolume: 0.65,
  licenseCode: ""
};

function renderAboutCard(container, pluginName, description) {
  const document = container.ownerDocument;
  const card = document.createElement("section");
  card.className = "crisp-focus-about";

  const title = document.createElement("h3");
  title.className = "crisp-focus-about__title";
  title.textContent = `About ${pluginName}`;

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
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName("Crisp Focus")
      .setHeading();

    new obsidian.Setting(containerEl)
      .setName("Focus mode")
      .setDesc("Master switch for the animated cursor, typing feedback, and ambient sound.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.focusModeEnabled)
          .onChange(async (val) => {
            await this.plugin.setFocusModeEnabled(val);
          })
      );

    const createGroup = (title, description, open = true) => {
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

    const licenseGroup = createGroup(
      "软件授权",
      "纯离线 Ed25519 密钥激活验证",
      true
    );

    const statusSetting = new obsidian.Setting(licenseGroup)
      .setName("当前激活状态")
      .setDesc("正在验证授权状态...");

    if (this.plugin.settings.licenseCode) {
      verifyLicenseCode(this.plugin.settings.licenseCode, "crisp-focus").then((verifyRes) => {
        if (verifyRes.valid && verifyRes.payload) {
          statusSetting.setDesc(
            `✅ 已激活（授权给: ${verifyRes.payload.userName}，到期时间: ${verifyRes.payload.expiresAt.split("T")[0]}）`
          );
        } else {
          statusSetting.setDesc(
            `❌ 未激活（${verifyRes.reason || "授权码无效"}）`
          );
        }
      });
    } else {
      statusSetting.setDesc("❌ 未激活（可免费使用物理动效光标，激活解锁打字音效与 HD 白噪音）");
    }

    new obsidian.Setting(licenseGroup)
      .setName("输入授权码")
      .setDesc("粘贴购买获取的 Crisp Suite 授权字符串进行离线激活。")
      .addText((text) => text
        .setPlaceholder("粘贴 Crisp 授权码...")
        .setValue(this.plugin.settings.licenseCode)
        .onChange(async (value) => {
          this.plugin.settings.licenseCode = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("激活 / 重新验证")
        .setCta()
        .onClick(async () => {
          const result = await verifyLicenseCode(this.plugin.settings.licenseCode, "crisp-focus");
          if (result.valid && result.payload) {
            new obsidian.Notice(`🎉 Crisp Focus 激活成功！欢迎使用，${result.payload.userName}`);
            this.display();
          } else {
            new obsidian.Notice(`❌ 激活失败: ${result.reason}`);
          }
        }));

    // Card 1: Smooth Animated Cursor
    const cursorCard = createGroup(
      "Animated cursor",
      "Configure spring-eased caret movement, transition speed, and blink timing.",
      true
    );

    new obsidian.Setting(cursorCard)
      .setName("Enable animated cursor")
      .setDesc("Smoothly interpolates caret movement across text, line breaks, and selections.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.animatedCursorEnabled)
          .onChange(async (val) => {
            await this.plugin.setAnimatedCursorEnabled(val);
          })
      );

    new obsidian.Setting(cursorCard)
      .setName("Cursor speed")
      .setDesc("The speed of each cursor movement in miliseconds.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.cursorSpeed ?? 80))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.cursorSpeed = num;
              await this.plugin.saveSettings();
            }
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default (80)")
          .onClick(async () => {
            this.plugin.settings.cursorSpeed = 80;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new obsidian.Setting(cursorCard)
      .setName("Blink rate")
      .setDesc("The length of a full cursor blink cycle in miliseconds.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.blinkRate ?? 1000))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.blinkRate = num;
              await this.plugin.saveSettings();
            }
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default (1000)")
          .onClick(async () => {
            this.plugin.settings.blinkRate = 1000;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new obsidian.Setting(cursorCard)
      .setName("Blink count")
      .setDesc("The limit of blink counts in a sequence. Resetted each time it's moving. Stop blinking when it sets to 0.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.blinkCount ?? 10))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.blinkCount = num;
              await this.plugin.saveSettings();
            }
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default (10)")
          .onClick(async () => {
            this.plugin.settings.blinkCount = 10;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Card 2: Multi-Theme Audio Engine
    const audioCard = createGroup(
      "Sound feedback",
      "Tactile keypress themes and an optional carriage return bell.",
      false
    );

    new obsidian.Setting(audioCard)
      .setName("Enable sound effects")
      .setDesc("Play tactile keypress and confirmation sound feedback while typing.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterAudioEnabled)
          .onChange(async (val) => {
            if (val) {
              const check = await verifyLicenseCode(this.plugin.settings.licenseCode, "crisp-focus");
              if (!check.valid) {
                new obsidian.Notice("🔒 开启打字音效属于 Crisp 激活用户专属功能");
                this.plugin.settings.typewriterAudioEnabled = false;
                await this.plugin.saveSettings();
                this.display();
                return;
              }
            }
            this.plugin.settings.typewriterAudioEnabled = val;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("Sound theme")
      .setDesc("Choose your preferred audio preset theme for keypress feedback.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("typewriter", "📜 Vintage Typewriter (复古打字机)")
          .addOption("mechanical", "⌨️ Mechanical Keyboard (麻将轴键盘)")
          .addOption("raindrop", "🌧️ Raindrop & Bubble (雨滴气泡音)")
          .addOption("retro8bit", "👾 8-Bit Retro Game (复古8位元)")
          .addOption("woodenFish", "🪵 Zen Wooden Fish (功德木鱼与磬)")
          .setValue(this.plugin.settings.soundTheme || "typewriter")
          .onChange(async (val) => {
            const check = await verifyLicenseCode(this.plugin.settings.licenseCode, "crisp-focus");
            if (!check.valid) {
              new obsidian.Notice("🔒 切换音效主题属于 Crisp 激活用户专属功能");
              this.display();
              return;
            }
            this.plugin.settings.soundTheme = val;
            await this.plugin.saveSettings();
            this.plugin.audio.playCharKey();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("Master volume")
      .setDesc("Adjust overall keypress and confirmation sound volume.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.typewriterVolume)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.typewriterVolume = val;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(audioCard)
      .setName("Carriage return bell")
      .setDesc("Ring a bell or chime when pressing Enter key.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.typewriterBellEnabled)
          .onChange(async (val) => {
            this.plugin.settings.typewriterBellEnabled = val;
            await this.plugin.saveSettings();
          })
      );

    // Card 3: Zen Ambient Audio Generator
    const ambientCard = createGroup(
      "Ambient sound",
      "Play a continuous local soundscape while Focus mode is active.",
      false
    );

    new obsidian.Setting(ambientCard)
      .setName("Background ambient sound")
      .setDesc("Choose an HD background ambient soundscape.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("off", "Off (关闭)")
          .addOption("rain", "🌧️ Rainy Day in Town (城镇雨声与鸟鸣)")
          .addOption("campfire", "🔥 Campfire in the Woods (森林篝火爆裂)")
          .addOption("ocean", "🌊 Soothing Ocean Waves (舒缓海浪拍岸)")
          .addOption("wind", "❄️ Arctic Cold Wind (极地寒风呼啸)")
          .setValue(this.plugin.settings.ambientSound || "off")
          .onChange(async (val) => {
            if (val !== "off") {
              const check = await verifyLicenseCode(this.plugin.settings.licenseCode, "crisp-focus");
              if (!check.valid) {
                new obsidian.Notice("🔒 播放 HD 白噪音属于 Crisp 激活用户专属功能");
                this.plugin.settings.ambientSound = "off";
                await this.plugin.saveSettings();
                this.display();
                return;
              }
            }
            this.plugin.settings.ambientSound = val;
            await this.plugin.saveSettings();
            this.plugin.audio.updateAmbient();
          })
      );

    new obsidian.Setting(ambientCard)
      .setName("Ambient sound volume")
      .setDesc("Adjust background ambient sound volume.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.ambientVolume ?? 0.65)
          .setDynamicTooltip()
          .onChange(async (val) => {
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    const winObj = this.app.workspace.containerEl.ownerDocument.defaultView || window;
    this.mainWindow = winObj;
    this.audio = new CrispFocusAudioEngine(
      this.app,
      () => this.settings.focusModeEnabled && this.settings.typewriterAudioEnabled,
      () => this.settings.soundTheme || "typewriter",
      () => this.settings.typewriterVolume,
      () => this.settings.typewriterBellEnabled,
      () => this.settings.focusModeEnabled ? (this.settings.ambientSound || "off") : "off",
      () => this.settings.ambientVolume ?? 0.65,
      winObj
    );
    this.windowBindings = new Map();
    this.attachWindow(winObj);
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, windowObj) => {
      this.attachWindow(windowObj);
    }));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, windowObj) => {
      this.detachWindow(windowObj);
    }));

    // Patch CM6 native cursor layer
    this.cursorPatchUninstallers = new Map();
    const tryPatchCursor = () => {
      const activeLeaf = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (!activeLeaf || !activeLeaf.editor || !activeLeaf.editor.cm) return;

      ensureCursorLayerPatched(
        activeLeaf.editor.cm,
        this,
        this.cursorPatchUninstallers
      );
    };

    this.registerEvent(this.app.workspace.on("active-leaf-change", tryPatchCursor));
    this.registerEvent(this.app.workspace.on("editor-selection-change", tryPatchCursor));

    this.cursorPatchTimer = winObj.setTimeout(tryPatchCursor, 100);

    // Add Setting Tab
    this.addSettingTab(new CrispFocusSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle focus mode",
      callback: async () => {
        await this.setFocusModeEnabled(!this.settings.focusModeEnabled);
        new obsidian.Notice(`Focus mode ${this.settings.focusModeEnabled ? "enabled" : "disabled"}`);
      }
    });

    this.addCommand({
      id: "toggle-animated-cursor",
      name: "Toggle animated cursor",
      callback: async () => {
        await this.setAnimatedCursorEnabled(!this.settings.animatedCursorEnabled);
        new obsidian.Notice(`Crisp Focus cursor ${this.settings.animatedCursorEnabled ? "enabled" : "disabled"}`);
      }
    });

    this.addCommand({
      id: "toggle-typewriter-audio",
      name: "Toggle sound effects",
      callback: async () => {
        this.settings.typewriterAudioEnabled = !this.settings.typewriterAudioEnabled;
        await this.saveSettings();
        new obsidian.Notice(`Crisp Focus audio ${this.settings.typewriterAudioEnabled ? "enabled" : "muted"}`);
      }
    });
  }

  onunload() {
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
    if (this.windowBindings) {
      Array.from(this.windowBindings.keys()).forEach((windowObj) => {
        this.detachWindow(windowObj);
      });
    }
    if (this.audio) {
      this.audio.destroy();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

  attachWindow(windowObj) {
    if (!windowObj || this.windowBindings.has(windowObj)) return;
    const state = { isComposing: false, lastCharKeydownAt: 0 };
    const gestureHandler = () => {
      if (!this.settings.focusModeEnabled) return;
      this.audio.handleUserGesture();
    };
    const compositionStartHandler = () => {
      state.isComposing = true;
    };
    const compositionEndHandler = () => {
      state.isComposing = false;
      if (this.settings.focusModeEnabled && this.settings.typewriterAudioEnabled) {
        this.audio.playSpaceKey();
      }
    };
    const keydownHandler = (evt) => {
      gestureHandler();
      if (!this.settings.focusModeEnabled || !this.settings.typewriterAudioEnabled) return;
      if (evt.ctrlKey || evt.altKey || evt.metaKey) return;

      const activeEl = windowObj.document.activeElement;
      const isEditor = activeEl && (
        activeEl.closest(".cm-editor, .markdown-source-view, .cm-content, .markdown-rendered") ||
        activeEl.classList.contains("cm-content") ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.getAttribute("contenteditable") === "true"
      );
      if (!isEditor) return;

      const key = evt.key;
      if (state.isComposing) {
        if (key.length === 1 && key !== " ") {
          state.lastCharKeydownAt = Date.now();
          this.audio.playCharKey();
        }
        return;
      }
      if (key === "Enter") {
        this.audio.playEnterKey();
      } else if (key === " ") {
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
      if (!this.settings.focusModeEnabled || !this.settings.typewriterAudioEnabled) return;
      // iOS 屏幕键盘：英文走 insertText，中文走组合输入 insertCompositionText。
      if (evt.inputType !== "insertText" && evt.inputType !== "insertCompositionText") return;
      if (Date.now() - state.lastCharKeydownAt < 80) return;
      const activeEl = windowObj.document.activeElement;
      const isEditor = activeEl && (
        activeEl.closest(".cm-editor, .markdown-source-view, .cm-content, .markdown-rendered") ||
        activeEl.classList.contains("cm-content") ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.getAttribute("contenteditable") === "true"
      );
      if (!isEditor) return;
      this.audio.playCharKey();
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

  async setAnimatedCursorEnabled(enabled) {
    this.settings.animatedCursorEnabled = enabled;
    await this.saveSettings();
    if (!enabled) {
      this.clearCursorStyles();
    }
  }

  async setFocusModeEnabled(enabled) {
    this.settings.focusModeEnabled = enabled;
    await this.saveSettings();
    if (!enabled) {
      this.clearCursorStyles();
      this.audio.stopAmbient();
      return;
    }
    this.audio.updateAmbient();
  }
}

module.exports = CrispFocusPlugin;
