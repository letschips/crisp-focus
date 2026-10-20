const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pluginPath = path.join(__dirname, "..", "main.js");
const stylesPath = path.join(__dirname, "..", "styles.css");

test("runtime and release metadata versions stay synchronized", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
  const runtime = fs.readFileSync(pluginPath, "utf8");
  const styles = fs.readFileSync(stylesPath, "utf8");

  assert.equal(packageJson.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.match(runtime, new RegExp(`\\(v${manifest.version.replaceAll(".", "\\.")}\\)`));
  assert.match(styles, new RegExp(`\\(v${manifest.version.replaceAll(".", "\\.")}\\)`));
});

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    contains(name) {
      return values.has(name);
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
  };
}

function createStyle() {
  const values = new Map();
  return {
    getPropertyValue(name) {
      return values.get(name) || "";
    },
    removeProperty(name) {
      values.delete(name);
    },
    setProperty(name, value) {
      values.set(name, value);
    },
  };
}

function createAudioContext() {
  const calls = {
    bufferCreations: 0,
    bufferSourceStarts: 0,
    compressorCreations: 0,
    compressorDestinationConnections: 0,
    directDestinationConnections: 0,
    oscillatorStarts: 0,
    oscillatorStops: 0,
  };
  const audioParam = {
    exponentialRampToValueAtTime() {},
    setValueAtTime() {},
  };
  const context = {
    calls,
    currentTime: 0,
    destination: { kind: "destination" },
    sampleRate: 48_000,
    state: "running",
    close: async () => {},
    createBiquadFilter() {
      return {
        Q: audioParam,
        connect() {},
        frequency: audioParam,
        type: "",
      };
    },
    createBuffer(_channels, length) {
      calls.bufferCreations += 1;
      return {
        getChannelData() {
          return new Float32Array(length);
        },
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        start() {
          calls.bufferSourceStarts += 1;
        },
      };
    },
    createDynamicsCompressor() {
      calls.compressorCreations += 1;
      return {
        attack: audioParam,
        connect(target) {
          if (target === context.destination) {
            calls.compressorDestinationConnections += 1;
          }
        },
        kind: "compressor",
        knee: audioParam,
        ratio: audioParam,
        release: audioParam,
        threshold: audioParam,
      };
    },
    createGain() {
      return {
        connect(target) {
          if (target === context.destination) {
            calls.directDestinationConnections += 1;
          }
        },
        gain: audioParam,
        kind: "gain",
      };
    },
    createOscillator() {
      return {
        connect() {},
        frequency: audioParam,
        start() {
          calls.oscillatorStarts += 1;
        },
        stop() {
          calls.oscillatorStops += 1;
        },
        type: "",
      };
    },
    resume: async () => {},
  };
  return context;
}

function createWindow() {
  const listeners = new Map();
  const context = createAudioContext();
  const cursorEditors = [];
  const cursorElements = [];
  const activeElement = {
    classList: createClassList(),
    closest() {
      return {};
    },
    getAttribute() {
      return null;
    },
    tagName: "DIV",
  };
  const documentObject = {
    activeElement,
    querySelectorAll(selector) {
      if (selector.includes(".cm-editor.crisp-focus-active")) return cursorEditors;
      if (selector.includes(".cm-editor .cm-cursor")) return cursorElements;
      if (selector.includes(".cm-editor")) return cursorEditors;
      return [];
    },
  };
  const windowObject = {
    AudioContext: function AudioContext() {
      return context;
    },
    cancelAnimationFrame() {},
    clearTimeout() {},
    document: documentObject,
    matchMedia() {
      return { matches: false };
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      listeners.set(
        type,
        callbacks.filter((candidate) => candidate !== callback)
      );
    },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) || []) {
        callback(event);
      }
    },
    addCursorFixture(editor, cursor) {
      cursorEditors.push(editor);
      cursorElements.push(cursor);
    },
  };
  return { context, windowObject };
}

// Minimal stand-in for whatever element currently owns focus. The key-sound gate must
// accept every host that really receives text input, not only the CodeMirror editor.
function createHost({ tagName, contentEditable = false, ancestors = [] }) {
  return {
    tagName,
    isContentEditable: contentEditable,
    classList: createClassList(),
    closest(selector) {
      return ancestors.some((ancestor) => selector.includes(ancestor)) ? {} : null;
    },
    getAttribute(name) {
      return name === "contenteditable" ? (contentEditable ? "true" : null) : null;
    },
  };
}

function createObsidianMock(options = {}) {
  class Plugin {
    addCommand() {}
    addSettingTab() {}
    registerEvent() {}
    registerEditorExtension() {}
    addStatusBarItem() {
      return {
        classList: createClassList(),
        textContent: "",
        title: "",
        addEventListener() {},
        remove() {},
        setAttr(name, value) {
          this[name] = value;
        },
        setText(value) {
          this.textContent = value;
        },
      };
    }
  }
  return {
    MarkdownView: class MarkdownView {},
    Notice: class Notice {},
    Platform: { isMobile: !!options.mobile },
    Plugin,
    PluginSettingTab: class PluginSettingTab {},
    Setting: class Setting {},
  };
}

function loadPluginInternals(options = {}) {
  const source = `${fs.readFileSync(pluginPath, "utf8")}
module.exports.__test = {
  CrispFocusAudioEngine,
  CrispFocusLicenseManager: typeof CrispFocusLicenseManager === "function" ? CrispFocusLicenseManager : undefined,
  CrispFocusPlugin,
  CrispTypewriterEngine: typeof CrispTypewriterEngine === "function" ? CrispTypewriterEngine : undefined,
  createTypewriterExtension: typeof createTypewriterExtension === "function" ? createTypewriterExtension : undefined,
  FocusSessionController: typeof FocusSessionController === "function" ? FocusSessionController : undefined,
  FOCUS_SCENES: typeof FOCUS_SCENES === "object" ? FOCUS_SCENES : undefined,
  ensureCursorLayerPatched,
  patchCursorLayer,
  renderAboutCard: typeof renderAboutCard === "function" ? renderAboutCard : undefined,
  pomodoroViewModel: typeof pomodoroViewModel === "function" ? pomodoroViewModel : undefined,
  nextPomodoroBreak: typeof nextPomodoroBreak === "function" ? nextPomodoroBreak : undefined,
  CRISP_LICENSE_PRODUCTS,
};`;
  const timers = [];
  const audioElements = [];
  const sandbox = {
    Audio: class Audio {
      constructor() {
        this.currentTime = 0;
        this.loop = false;
        this.paused = true;
        this.playCalls = 0;
        this.src = "";
        this.volume = 1;
        audioElements.push(this);
      }
      pause() {
        this.paused = true;
      }
      play() {
        this.paused = false;
        this.playCalls += 1;
        return Promise.resolve();
      }
    },
    console,
    module: { exports: {} },
    require(name) {
      if (name === "obsidian") return createObsidianMock(options);
      if (name === "@codemirror/view" && options.codemirrorView) {
        return options.codemirrorView;
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    window: {
      requestAnimationFrame(callback) {
        callback();
      },
      setTimeout(callback) {
        callback();
      },
    },
};
  vm.runInNewContext(source, sandbox, { filename: pluginPath });
  return {
    ...sandbox.module.exports.__test,
    audioElements,
  };
}

function createAboutCardFixture() {
  const createElement = (tagName) => ({
    tagName: tagName.toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    append(...children) {
      this.children.push(...children);
    },
  });
  const ownerDocument = { createElement };
  return {
    ownerDocument,
    children: [],
    append(...children) {
      this.children.push(...children);
    },
  };
}

function findByClass(root, className) {
  if (root.className === className) return root;
  for (const child of root.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return undefined;
}

test("settings About card exposes the plugin purpose and author", () => {
  const { renderAboutCard } = loadPluginInternals();
  assert.equal(typeof renderAboutCard, "function");
  const container = createAboutCardFixture();

  renderAboutCard(
    container,
    "Crisp Focus",
    "用克制的视觉与声音反馈，帮助你专注进入和完成每一次书写。"
  );

  const title = findByClass(container, "crisp-focus-about__title");
  const description = findByClass(
    container,
    "crisp-focus-about__description"
  );
  const author = findByClass(container, "crisp-focus-about__author-link");
  assert.equal(title.textContent, "关于 Crisp Focus");
  assert.equal(
    description.textContent,
    "用克制的视觉与声音反馈，帮助你专注进入和完成每一次书写。"
  );
  assert.equal(author.textContent, "小红书 letschips");
  assert.equal(author.href, "https://xhslink.cn/m/3MwtKu4822b");
  assert.equal(author.target, "_blank");
  assert.equal(author.rel, "noopener noreferrer");
}
);

test("license compatibility includes the complete current Crisp family", () => {
  const { CRISP_LICENSE_PRODUCTS } = loadPluginInternals();
  assert.deepEqual(Array.from(CRISP_LICENSE_PRODUCTS), [
    "Crisp Suite",
    "Crisp Organize",
    "Crisp ASR",
    "Crisp Annotations",
    "Crisp File Explorer",
    "Crisp Focus",
    "Crisp Reading Rail",
    "Crisp Base",
  ]);
});

test("paid audio remains unavailable until the current license is verified", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    licenseCode: "",
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};

  await plugin.onload();

  assert.equal(plugin.audio.getEnabled(), false);
  assert.equal(plugin.audio.getAmbientSound(), "off");
  plugin.onunload();
});

test("license manager accepts online verification and rejects a later revocation", async () => {
  const { CrispFocusLicenseManager } = loadPluginInternals();
  assert.equal(typeof CrispFocusLicenseManager, "function");
  const settings = { licenseCode: "signed-code", licenseLastOnlineAt: 0 };
  let result = {
    valid: true,
    source: "online",
    payload: { product: "Crisp Suite", features: ["all"] },
  };
  let losses = 0;
  const manager = new CrispFocusLicenseManager(null, settings, {
    now: () => 1_000,
    onEntitlementLost: () => {
      losses += 1;
    },
    verifier: async () => result,
  });

  assert.equal((await manager.verify()).valid, true);
  assert.equal(manager.isEntitled(), true);
  assert.equal(settings.licenseLastOnlineAt, 1_000);

  result = { valid: false, reason: "授权已撤销", source: "online" };
  assert.equal((await manager.verify()).valid, false);
  assert.equal(manager.isEntitled(), false);
  assert.equal(losses, 1);
});

test("offline license fallback succeeds on valid cryptographic signature", async () => {
  const { CrispFocusLicenseManager } = loadPluginInternals();
  assert.equal(typeof CrispFocusLicenseManager, "function");
  const now = 10 * 24 * 60 * 60 * 1000;
  const verifier = async () => ({
    valid: true,
    source: "offline",
    payload: { product: "Crisp Suite", features: ["all"] },
    message: "离线验证成功",
  });
  const manager = new CrispFocusLicenseManager(null, {
    licenseCode: "signed-code",
    licenseLastOnlineAt: 0,
  }, { now: () => now, verifier });

  const result = await manager.verify();
  assert.equal(result.valid, true);
  assert.equal(result.source, "offline");
  assert.equal(manager.isEntitled(), true);
});

test("applying a licensed focus scene updates its complete preset atomically", async () => {
  const { CrispFocusPlugin, FOCUS_SCENES } = loadPluginInternals();
  assert.equal(typeof FOCUS_SCENES, "object");
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({});
  plugin.saveData = async () => {};
  await plugin.onload();

  const result = await plugin.applyScene("rainy-writing");

  assert.equal(result.applied, true);
  assert.deepEqual(
    {
      activeSceneId: plugin.settings.activeSceneId,
      ambientSound: plugin.settings.ambientSound,
      ambientVolume: plugin.settings.ambientVolume,
      animatedCursorEnabled: plugin.settings.animatedCursorEnabled,
      cursorSpeed: plugin.settings.cursorSpeed,
      focusModeEnabled: plugin.settings.focusModeEnabled,
      soundTheme: plugin.settings.soundTheme,
      typewriterAudioEnabled: plugin.settings.typewriterAudioEnabled,
      typewriterBellEnabled: plugin.settings.typewriterBellEnabled,
      typewriterVolume: plugin.settings.typewriterVolume,
    },
    {
      activeSceneId: "rainy-writing",
      ambientSound: "rain",
      ambientVolume: 0.45,
      animatedCursorEnabled: true,
      cursorSpeed: 95,
      focusModeEnabled: true,
      soundTheme: "raindrop",
      typewriterAudioEnabled: true,
      typewriterBellEnabled: false,
      typewriterVolume: 0.35,
    }
  );
  plugin.onunload();
});

test("an unlicensed paid scene is rejected without changing the current setup", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    activeSceneId: "silent-writing",
    ambientSound: "off",
    cursorSpeed: 80,
    typewriterAudioEnabled: false,
  });
  plugin.saveData = async () => {};
  await plugin.onload();
  const before = JSON.stringify(plugin.settings);

  const result = await plugin.applyScene("vintage-typewriter");

  assert.equal(result.applied, false);
  assert.match(result.reason, /激活/);
  assert.equal(JSON.stringify(plugin.settings), before);
  plugin.onunload();
});

test("the free silent scene remains available without a license", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ ambientSound: "rain", typewriterAudioEnabled: true });
  plugin.saveData = async () => {};
  await plugin.onload();

  const result = await plugin.applyScene("silent-writing");

  assert.equal(result.applied, true);
  assert.equal(plugin.settings.activeSceneId, "silent-writing");
  assert.equal(plugin.settings.typewriterAudioEnabled, false);
  assert.equal(plugin.settings.ambientSound, "off");
  plugin.onunload();
});

test("applying a scene refreshes the live typewriter viewport immediately", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const editor = {
    classList: createClassList(),
    querySelector(selector) {
      return selector === ".cm-scroller" ? { clientHeight: 1000 } : null;
    },
    style: createStyle(),
  };
  windowObject.addCursorFixture(editor, { style: {} });

  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    focusModeEnabled: true,
    typewriterScrollEnabled: false,
    typewriterScrollOffset: 70,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  let scrollRequests = 0;
  plugin.typewriterEngine.requestScroll = () => {
    scrollRequests += 1;
  };
  plugin.app.workspace.getActiveViewOfType = () => ({ editor: { cm: {} } });

  const result = await plugin.applyScene("silent-writing");

  assert.equal(result.applied, true);
  assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), true);
  assert.equal(editor.classList.contains("crisp-focus-typewriter-padding"), true);
  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-offset-ratio"), "0.42");
  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-bottom-space"), "580px");
  assert.equal(scrollRequests, 1, "scene application should align the active editor without waiting for another keystroke");
  plugin.onunload();
});

test("focus session countdown pauses, resumes, and completes exactly once", () => {
  const { FocusSessionController } = loadPluginInternals();
  assert.equal(typeof FocusSessionController, "function");
  let now = 0;
  let intervalCallback = null;
  let completions = 0;
  const updates = [];
  const controller = new FocusSessionController({
    clearInterval() {
      intervalCallback = null;
    },
    now: () => now,
    onComplete() {
      completions += 1;
    },
    onUpdate(snapshot) {
      updates.push(snapshot);
    },
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
  });

  controller.start(1);
  assert.deepEqual({ ...controller.getSnapshot() }, {
    status: "running",
    endAt: 60_000,
    remainingMs: 60_000,
  });

  now = 20_000;
  intervalCallback();
  controller.pause();
  assert.deepEqual({ ...controller.getSnapshot() }, {
    status: "paused",
    endAt: 0,
    remainingMs: 40_000,
  });

  now = 50_000;
  controller.resume();
  assert.equal(controller.getSnapshot().endAt, 90_000);
  now = 90_000;
  intervalCallback();

  assert.deepEqual({ ...controller.getSnapshot() }, {
    status: "idle",
    endAt: 0,
    remainingMs: 0,
  });
  assert.equal(completions, 1);
  assert.equal(updates.at(-1).status, "idle");
  controller.tick();
  assert.equal(completions, 1);
});

test("focus session restores an unfinished persisted countdown", () => {
  const { FocusSessionController } = loadPluginInternals();
  assert.equal(typeof FocusSessionController, "function");
  let intervalRegistered = false;
  const controller = new FocusSessionController({
    clearInterval() {},
    now: () => 40_000,
    setInterval() {
      intervalRegistered = true;
      return 1;
    },
  });

  controller.restore({ status: "running", endAt: 100_000, remainingMs: 0 });

  assert.deepEqual({ ...controller.getSnapshot() }, {
    status: "running",
    endAt: 100_000,
    remainingMs: 60_000,
  });
  assert.equal(intervalRegistered, true);
});

test("plugin session controls keep focus mode, persisted state, and status text synchronized", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ sessionDurationMinutes: 25 });
  plugin.saveData = async () => {};
  await plugin.onload();

  await plugin.startFocusSession(25);
  assert.equal(plugin.settings.focusModeEnabled, true);
  assert.equal(plugin.settings.sessionState.status, "running");
  assert.equal(plugin.statusBarEl.textContent, "专注 25:00");

  await plugin.pauseFocusSession();
  assert.equal(plugin.settings.sessionState.status, "paused");
  assert.match(plugin.statusBarEl.textContent, /暂停/);

  await plugin.resumeFocusSession();
  assert.equal(plugin.settings.sessionState.status, "running");

  await plugin.stopFocusSession();
  assert.equal(plugin.settings.focusModeEnabled, false);
  assert.equal(plugin.settings.sessionState.status, "idle");
  assert.equal(plugin.statusBarEl.textContent, "专注");
  plugin.onunload();
});

function createPluginApp(windowObject) {
  const workspaceListeners = new Map();
  return {
    vault: {
      adapter: {
        getResourcePath(relativePath) {
          return relativePath;
        },
      },
      configDir: ".obsidian",
    },
    workspace: {
      containerEl: {
        ownerDocument: {
          defaultView: windowObject,
        },
      },
      getActiveViewOfType() {
        return null;
      },
      on() {
        const [name, callback] = arguments;
        const callbacks = workspaceListeners.get(name) || [];
        callbacks.push(callback);
        workspaceListeners.set(name, callbacks);
        return {};
      },
      emit(name, ...args) {
        for (const callback of workspaceListeners.get(name) || []) {
          callback(...args);
        }
      },
    },
  };
}

function grantTestLicense(plugin) {
  plugin.licenseVerifier = async () => ({
    valid: true,
    source: "online",
    payload: {
      product: "Crisp Suite",
      features: ["all"],
      userName: "Test user",
    },
  });
}

test("default typewriter Backspace sound completes without throwing", () => {
  const { CrispFocusAudioEngine } = loadPluginInternals();
  const { context, windowObject } = createWindow();
  const engine = new CrispFocusAudioEngine(
    createPluginApp(windowObject),
    () => true,
    () => "typewriter",
    () => 0.7,
    () => true,
    () => "off",
    () => 0.65,
    windowObject
  );
  engine.ctx = context;

  assert.doesNotThrow(() => engine.playBackspaceKey());
  assert.equal(context.calls.bufferCreations, 1);
  assert.equal(context.calls.bufferSourceStarts, 1);
  assert.equal(context.calls.oscillatorStarts, 0);
  assert.equal(context.calls.oscillatorStops, 0);
});

test("saved ambient volume zero remains zero at runtime", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ ambientVolume: 0 });
  plugin.saveData = async () => {};

  await plugin.onload();

  assert.equal(plugin.audio.getAmbientVol(), 0);
  plugin.onunload();
});

test("disabling and uninstalling animated cursor removes editor styling", () => {
  const { patchCursorLayer } = loadPluginInternals();
  const editor = {
    classList: createClassList(),
    style: createStyle(),
  };
  const markerElement = { style: { transition: "" } };
  const layer = {
    class: "cm-cursorLayer",
    markers() {
      return [
        {
          adjust() {},
        },
      ];
    },
  };
  const plugin = {
    settings: {
      animatedCursorEnabled: true,
      cursorSpeed: 80,
      focusModeEnabled: true,
    },
  };
  const uninstall = patchCursorLayer({ layer }, plugin);

  let markers = layer.markers({ dom: editor });
  markers[0].adjust(markerElement);
  assert.equal(editor.classList.contains("crisp-focus-active"), true);
  assert.notEqual(markerElement.style.transition, "");

  plugin.settings.animatedCursorEnabled = false;
  layer.markers({ dom: editor });
  assert.equal(editor.classList.contains("crisp-focus-active"), false);
  assert.equal(
    editor.style.getPropertyValue("--crisp-focus-cursor-speed"),
    ""
  );
  assert.equal(markerElement.style.transition, "");

  plugin.settings.animatedCursorEnabled = true;
  layer.markers({ dom: editor });
  uninstall();
  assert.equal(editor.classList.contains("crisp-focus-active"), false);
});

test("empty CM6 cursor layers keep the native caret visible", () => {
  const { patchCursorLayer } = loadPluginInternals();
  const editor = {
    classList: createClassList(),
    style: createStyle(),
  };
  const layer = {
    class: "cm-cursorLayer",
    markers() {
      return [];
    },
  };
  const plugin = {
    settings: {
      animatedCursorEnabled: true,
      cursorSpeed: 80,
      focusModeEnabled: true,
    },
  };
  const uninstall = patchCursorLayer({ layer }, plugin);

  const markers = layer.markers({ dom: editor });

  assert.deepEqual(markers, []);
  assert.equal(editor.classList.contains("crisp-focus-active"), false);
  assert.equal(
    editor.style.getPropertyValue("--crisp-focus-cursor-speed"),
    ""
  );

  uninstall();
});

test("each CodeMirror editor receives its own cursor layer patch", () => {
  const { ensureCursorLayerPatched } = loadPluginInternals();
  const plugin = {
    settings: {
      animatedCursorEnabled: true,
      blinkCount: 10,
      blinkRate: 1000,
      cursorSpeed: 80,
      focusModeEnabled: true,
    },
  };
  const patches = new Map();
  const createEditorView = () => {
    const marker = { adjust() {} };
    const layer = {
      class: "cm-cursorLayer",
      markers() {
        return [marker];
      },
    };
    return {
      layer,
      view: {
        plugins: [{ value: { layer } }],
      },
    };
  };
  const first = createEditorView();
  const second = createEditorView();

  assert.equal(ensureCursorLayerPatched(first.view, plugin, patches), true);
  assert.equal(ensureCursorLayerPatched(first.view, plugin, patches), false);
  assert.equal(ensureCursorLayerPatched(second.view, plugin, patches), true);
  assert.equal(patches.size, 2);

  for (const uninstall of patches.values()) uninstall();
});

test("native caret hiding is limited to editors with an active Focus cursor", () => {
  const css = fs
    .readFileSync(stylesPath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];

  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\bcaret-color\s*:\s*transparent\b/.test(match[2])) continue;
    selectors.push(
      ...match[1]
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean)
    );
  }

  assert.deepEqual(selectors, [
    ".cm-editor.crisp-focus-active .cm-content .cm-line",
  ]);
});

test("IME confirmation produces exactly one confirmation sound", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ typewriterAudioEnabled: true });
  plugin.saveData = async () => {};

  await plugin.onload();
  let confirmations = 0;
  plugin.audio.playSpaceKey = () => {
    confirmations += 1;
  };
  plugin.audio.playCharKey = () => {};

  windowObject.dispatch("compositionstart", {});
  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "Enter",
    metaKey: false,
  });
  windowObject.dispatch("compositionend", {});

  assert.equal(confirmations, 1);
  plugin.onunload();
});

test("disabling animated cursor immediately clears existing editor styles", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const editor = {
    classList: createClassList(),
    style: createStyle(),
  };
  const cursor = { style: { transition: "transform 80ms ease" } };
  editor.classList.add("crisp-focus-active");
  editor.style.setProperty("--crisp-focus-cursor-speed", "80ms");
  windowObject.addCursorFixture(editor, cursor);

  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ animatedCursorEnabled: true });
  plugin.saveData = async () => {};
  await plugin.onload();

  await plugin.setAnimatedCursorEnabled(false);

  assert.equal(plugin.settings.animatedCursorEnabled, false);
  assert.equal(editor.classList.contains("crisp-focus-active"), false);
  assert.equal(
    editor.style.getPropertyValue("--crisp-focus-cursor-speed"),
    ""
  );
  assert.equal(cursor.style.transition, "");
  plugin.onunload();
});

test("one typing keydown starts ambient audio at most once", async () => {
  const { CrispFocusPlugin, audioElements } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    ambientSound: "rain",
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "a",
    metaKey: false,
  });

  assert.equal(audioElements.length, 1);
  assert.equal(audioElements[0].playCalls, 1);
  plugin.onunload();
});

test("repeated typing reuses an already-playing ambient track", async () => {
  const { CrispFocusPlugin, audioElements } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    ambientSound: "rain",
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  const keydown = {
    altKey: false,
    ctrlKey: false,
    key: "a",
    metaKey: false,
  };
  windowObject.dispatch("keydown", keydown);
  windowObject.dispatch("keydown", keydown);

  assert.equal(audioElements.length, 1);
  assert.equal(audioElements[0].playCalls, 1);
  plugin.onunload();
});

test("disabled Focus mode stays audio-lazy on user gestures", async () => {
  const { CrispFocusPlugin, audioElements } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    ambientSound: "rain",
    focusModeEnabled: false,
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  windowObject.dispatch("pointerdown", {});
  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "a",
    metaKey: false,
  });

  assert.equal(plugin.audio.ctx, null);
  assert.equal(audioElements.length, 0);
  plugin.onunload();
});

test("repeated typewriter keypresses reuse the noise buffer", () => {
  const { CrispFocusAudioEngine } = loadPluginInternals();
  const { context, windowObject } = createWindow();
  const engine = new CrispFocusAudioEngine(
    createPluginApp(windowObject),
    () => true,
    () => "typewriter",
    () => 0.7,
    () => true,
    () => "off",
    () => 0.65,
    windowObject
  );
  engine.ctx = context;

  engine.playCharKey();
  engine.playCharKey();

  assert.equal(context.calls.bufferCreations, 1);
});

test("typing audio follows pop-out window lifecycle", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject: mainWindow } = createWindow();
  const { windowObject: popoutWindow } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(mainWindow);
  plugin.loadData = async () => ({ typewriterAudioEnabled: true });
  plugin.saveData = async () => {};
  await plugin.onload();

  let characters = 0;
  plugin.audio.playCharKey = () => {
    characters += 1;
  };
  plugin.app.workspace.emit("window-open", {}, popoutWindow);
  popoutWindow.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "a",
    metaKey: false,
  });
  assert.equal(characters, 1);

  plugin.app.workspace.emit("window-close", {}, popoutWindow);
  popoutWindow.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "b",
    metaKey: false,
  });
  assert.equal(characters, 1);
  plugin.onunload();
});

test("synthesized key sounds share one output limiter", () => {
  const { CrispFocusAudioEngine } = loadPluginInternals();
  const { context, windowObject } = createWindow();
  const engine = new CrispFocusAudioEngine(
    createPluginApp(windowObject),
    () => true,
    () => "mechanical",
    () => 0.7,
    () => true,
    () => "off",
    () => 0.65,
    windowObject
  );
  engine.ctx = context;

  engine.playCharKey();
  engine.playEnterKey();

  assert.equal(context.calls.compressorCreations, 1);
  assert.equal(context.calls.compressorDestinationConnections, 1);
  assert.equal(context.calls.directDestinationConnections, 0);
});

test("Focus mode disables all effects without erasing feature choices", async () => {
  const { CrispFocusPlugin, audioElements } = loadPluginInternals();
  const { windowObject } = createWindow();
  const editor = {
    classList: createClassList(),
    style: createStyle(),
  };
  const cursor = { style: { transition: "transform 80ms ease" } };
  editor.classList.add("crisp-focus-active");
  editor.style.setProperty("--crisp-focus-cursor-speed", "80ms");
  windowObject.addCursorFixture(editor, cursor);

  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    ambientSound: "rain",
    animatedCursorEnabled: true,
    focusModeEnabled: true,
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();
  plugin.audio.updateAmbient();

  await plugin.setFocusModeEnabled(false);

  assert.equal(plugin.settings.animatedCursorEnabled, true);
  assert.equal(plugin.settings.typewriterAudioEnabled, true);
  assert.equal(plugin.settings.ambientSound, "rain");
  assert.equal(plugin.audio.getEnabled(), false);
  assert.equal(plugin.audio.getAmbientSound(), "off");
  assert.equal(editor.classList.contains("crisp-focus-active"), false);
  assert.equal(audioElements[0].paused, true);
  plugin.onunload();
});

test("iOS screen keyboard: beforeinput insertText plays character sound without keydown", () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();

  let charSounds = 0;
  const plugin = new CrispFocusPlugin();
  plugin.settings = {
    focusModeEnabled: true,
    typewriterAudioEnabled: true,
  };
  plugin.audio = {
    handleUserGesture() {},
    playCharKey() {
      charSounds += 1;
    },
    playEnterKey() {},
    playSpaceKey() {},
    playBackspaceKey() {},
  };
  plugin.windowBindings = new Map();

  CrispFocusPlugin.prototype.attachWindow.call(plugin, windowObject);

  // iOS 屏幕键盘：普通字符不触发 keydown，只发 beforeinput/insertText。
  windowObject.dispatch("beforeinput", { inputType: "insertText" });
  assert.equal(charSounds, 1, "iOS 字符输入应通过 beforeinput 发声");

  // iOS 中文输入：组合输入 insertCompositionText 应发声。
  windowObject.dispatch("compositionstart", {});
  windowObject.dispatch("beforeinput", { inputType: "insertCompositionText" });
  assert.equal(charSounds, 2, "iOS 中文组合输入应发声");

  // 桌面端：keydown 字符 + 紧随其后的 beforeinput 只发一次声（80ms 去重）。
  windowObject.dispatch("keydown", { key: "a", ctrlKey: false, altKey: false, metaKey: false });
  assert.equal(charSounds, 3, "桌面 keydown 字符应发声");
  windowObject.dispatch("beforeinput", { inputType: "insertText" });
  assert.equal(charSounds, 3, "keydown 已发声时 insertText 不应重复发声");
  windowObject.dispatch("beforeinput", { inputType: "insertCompositionText" });
  assert.equal(charSounds, 3, "keydown 已发声时 insertCompositionText 不应重复发声");
  windowObject.dispatch("compositionend", {});

  // Enter 仍走 keydown 路径。
  windowObject.dispatch("keydown", { key: "Enter", ctrlKey: false, altKey: false, metaKey: false });
  assert.equal(charSounds, 3, "Enter 不应计入字符音效");

  CrispFocusPlugin.prototype.detachWindow.call(plugin, windowObject);
  windowObject.dispatch("beforeinput", { inputType: "insertText" });
  assert.equal(charSounds, 3, "detach 后监听器应已清理");
});

test("TypewriterEngine: Soft mode maintains cursor in tolerance band", () => {
  const { CrispTypewriterEngine } = loadPluginInternals();
  const mockPlugin = {
    licenseManager: { isEntitled: () => true },
    settings: {
      focusModeEnabled: true,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "soft",
      typewriterScrollOffset: 42, // target: 420px in 1000px height
      typewriterScrollTolerance: 10, // band: 320px ~ 520px
    },
  };
  const engine = new CrispTypewriterEngine(mockPlugin);

  function createMockView(cursorTop) {
    return {
      scrollDOM: {
        getBoundingClientRect: () => ({ top: 0, height: 1000 }),
        scrollTop: 100,
        scrollHeight: 3000,
        clientHeight: 1000,
      },
      state: {
        selection: { main: { head: 10 } },
      },
      coordsAtPos: () => ({ top: cursorTop }),
    };
  }

  // Inside tolerance band (e.g. 400px, 350px, 500px) -> delta should be 0
  assert.equal(engine.calculateScrollDelta(createMockView(420)), 0, "Exact target should not scroll");
  assert.equal(engine.calculateScrollDelta(createMockView(350)), 0, "Inside soft band should not scroll");
  assert.equal(engine.calculateScrollDelta(createMockView(500)), 0, "Inside soft band should not scroll");

  // Outside top band (e.g. 200px < 320px) -> delta should be negative (scroll up to 420)
  // currentY(200) - targetY(420) = -220
  assert.equal(engine.calculateScrollDelta(createMockView(200)), -220, "Above top band should scroll up");

  // Outside bottom band (e.g. 700px > 520px) -> delta should be positive (scroll down to 420)
  // currentY(700) - targetY(420) = +280
  assert.equal(engine.calculateScrollDelta(createMockView(700)), 280, "Below bottom band should scroll down");
});

test("TypewriterEngine: Strict mode locks cursor precisely to target height", () => {
  const { CrispTypewriterEngine } = loadPluginInternals();
  const mockPlugin = {
    licenseManager: { isEntitled: () => true },
    settings: {
      focusModeEnabled: true,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "strict",
      typewriterScrollOffset: 42, // target: 420px in 1000px height
    },
  };
  const engine = new CrispTypewriterEngine(mockPlugin);

  function createMockView(cursorTop) {
    return {
      scrollDOM: {
        getBoundingClientRect: () => ({ top: 0, height: 1000 }),
        scrollTop: 100,
        scrollHeight: 3000,
        clientHeight: 1000,
      },
      state: {
        selection: { main: { head: 10 } },
      },
      coordsAtPos: () => ({ top: cursorTop }),
    };
  }

  assert.equal(engine.calculateScrollDelta(createMockView(420)), 0, "Exact target delta is 0");
  assert.equal(engine.calculateScrollDelta(createMockView(460)), 40, "Offset of +40px strictly moves +40px");
  assert.equal(engine.calculateScrollDelta(createMockView(380)), -40, "Offset of -40px strictly moves -40px");
});

test("TypewriterEngine: user scroll pause and resume on user activity", () => {
  const { CrispTypewriterEngine } = loadPluginInternals();
  let scheduledScroll = null;
  const mockPlugin = {
    licenseManager: { isEntitled: () => true },
    settings: {
      focusModeEnabled: true,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "strict",
      typewriterScrollOffset: 42,
      typewriterScrollSmooth: false,
    },
    mainWindow: {
      setTimeout: (fn) => setTimeout(fn, 50),
      clearTimeout: (id) => clearTimeout(id),
    },
  };
  const engine = new CrispTypewriterEngine(mockPlugin);

  const mockView = {
    scrollDOM: {
      getBoundingClientRect: () => ({ top: 0, height: 1000 }),
      scrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 1000,
    },
    state: {
      selection: { main: { head: 10 } },
    },
    coordsAtPos: () => ({ top: 600 }), // delta = 180
  };

  // Normal request scrolls
  engine.requestScroll(mockView, "normal");
  assert.equal(mockView.scrollDOM.scrollTop, 280, "Initial scroll applies delta");

  // User manual scroll occurs -> suppresses typewriter scroll
  mockView.scrollDOM.scrollTop = 500;
  engine.onUserScroll();
  assert.equal(engine.userScrolling, true);
  engine.requestScroll(mockView, "during-user-scroll");
  assert.equal(mockView.scrollDOM.scrollTop, 500, "Scroll should be suppressed while user is scrolling");

  // User typing activity resumes typewriter scroll
  engine.onUserActivity();
  assert.equal(engine.userScrolling, false);
  engine.requestScroll(mockView, "after-user-activity");
  assert.equal(mockView.scrollDOM.scrollTop, 680, "Scroll resumes upon user activity");

  engine.destroy();
});

test("TypewriterEngine: reduced-motion preference disables smooth scrolling", () => {
  const { CrispTypewriterEngine } = loadPluginInternals();
  let smoothScrollCalls = 0;
  const mockPlugin = {
    licenseManager: { isEntitled: () => true },
    settings: {
      focusModeEnabled: true,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "strict",
      typewriterScrollOffset: 42,
      typewriterScrollSmooth: true,
    },
    mainWindow: {
      matchMedia(query) {
        return { matches: query === "(prefers-reduced-motion: reduce)" };
      },
    },
  };
  const engine = new CrispTypewriterEngine(mockPlugin);
  const mockView = {
    dom: { ownerDocument: { defaultView: mockPlugin.mainWindow } },
    scrollDOM: {
      clientHeight: 1000,
      getBoundingClientRect: () => ({ top: 0, height: 1000 }),
      scrollHeight: 3000,
      scrollTop: 100,
      scrollTo() {
        smoothScrollCalls += 1;
      },
    },
    state: { selection: { main: { head: 10 } } },
    coordsAtPos: () => ({ top: 600 }),
  };

  engine.requestScroll(mockView, "reduced-motion");

  assert.equal(smoothScrollCalls, 0, "reduced-motion should never invoke smooth scrolling");
  assert.equal(mockView.scrollDOM.scrollTop, 280, "alignment should still happen instantly");
});

test("Typewriter ViewPlugin distinguishes user scroll intent from programmatic scroll events", () => {
  const codemirrorView = {
    ViewPlugin: {
      fromClass(ViewPluginClass) {
        return ViewPluginClass;
      },
    },
  };
  const { createTypewriterExtension } = loadPluginInternals({ codemirrorView });
  const listeners = new Map();
  const scrollDOM = {
    clientHeight: 800,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
  };
  const style = createStyle();
  const windowObject = {
    cancelAnimationFrame() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
  };
  let userScrollSignals = 0;
  const plugin = {
    licenseManager: { isEntitled: () => true },
    mainWindow: windowObject,
    settings: {
      focusModeEnabled: true,
      typewriterScrollBottomPadding: true,
      typewriterScrollEnabled: true,
      typewriterScrollOffset: 42,
    },
    typewriterEngine: {
      onUserScroll() {
        userScrollSignals += 1;
      },
    },
  };
  const view = {
    dom: {
      classList: createClassList(),
      closest() {
        return null;
      },
      ownerDocument: { defaultView: windowObject },
      querySelector(selector) {
        return selector === ".cm-scroller" ? scrollDOM : null;
      },
      style,
    },
    scrollDOM,
  };
  const TypewriterViewPlugin = createTypewriterExtension(plugin);
  const instance = new TypewriterViewPlugin(view);

  listeners.get("scroll")?.({});
  assert.equal(userScrollSignals, 0, "programmatic scroll events must not pause typewriter alignment");
  listeners.get("wheel")?.({});
  listeners.get("touchmove")?.({});
  listeners.get("pointerdown")?.({});
  assert.equal(userScrollSignals, 3, "wheel, touch, and scrollbar pointer intent should pause alignment");

  instance.destroy();
  assert.equal(listeners.size, 0, "all user-intent listeners should be removed on destroy");
});

test("typewriter bottom padding follows each editor viewport instead of the app window", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const scroller = { clientHeight: 500 };
  const editor = {
    classList: createClassList(),
    querySelector(selector) {
      return selector === ".cm-scroller" ? scroller : null;
    },
    style: createStyle(),
  };
  windowObject.addCursorFixture(editor, { style: {} });

  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    focusModeEnabled: true,
    typewriterScrollBottomPadding: true,
    typewriterScrollEnabled: true,
    typewriterScrollOffset: 42,
  });
  plugin.saveData = async () => {};
  await plugin.onload();
  plugin.updateTypewriterStyles();

  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-bottom-space"), "290px");
  const styles = fs.readFileSync(stylesPath, "utf8");
  assert.match(styles, /padding-bottom:\s*var\(--crisp-focus-typewriter-bottom-space,\s*0px\)/);
  assert.doesNotMatch(styles, /padding-bottom:\s*calc\(100vh/);
  plugin.onunload();
});

test("Typewriter styles and toggle commands update editor classes and CSS variables", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const editor = {
    classList: createClassList(),
    style: createStyle(),
  };
  const cursor = { style: {} };
  windowObject.addCursorFixture(editor, cursor);

  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    focusModeEnabled: true,
    typewriterScrollEnabled: true,
    typewriterScrollMode: "soft",
    typewriterScrollOffset: 42,
    typewriterScrollTolerance: 10,
    typewriterScrollBottomPadding: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  plugin.updateTypewriterStyles();

  assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), true);
  assert.equal(editor.classList.contains("crisp-focus-typewriter-padding"), true);
  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-bottom-ratio"), "0.58");
  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-offset-ratio"), "0.42");

  // Switch to custom offset (50%)
  await plugin.setTypewriterScrollOffset(50);
  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-bottom-ratio"), "0.5");
  assert.equal(editor.style.getPropertyValue("--crisp-focus-typewriter-offset-ratio"), "0.5");

  // Toggle typewriter off
  await plugin.setTypewriterScrollEnabled(false);
  assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), false);
  assert.equal(editor.classList.contains("crisp-focus-typewriter-padding"), false);

  plugin.onunload();
});

test("TypewriterEngine: skips canvas nodes, modal prompts, and protects text range selections", () => {
  const { CrispTypewriterEngine } = loadPluginInternals();
  const mockPlugin = {
    licenseManager: { isEntitled: () => true },
    settings: {
      focusModeEnabled: true,
      typewriterScrollEnabled: true,
      typewriterScrollMode: "strict",
      typewriterScrollOffset: 42,
    },
  };
  const engine = new CrispTypewriterEngine(mockPlugin);

  // 1. Canvas node editor view -> delta should be 0
  const canvasView = {
    dom: {
      closest: (sel) => sel.includes("canvas-node") ? {} : null,
    },
    scrollDOM: {
      getBoundingClientRect: () => ({ top: 0, height: 1000 }),
    },
    state: { selection: { main: { head: 10, empty: true } } },
    coordsAtPos: () => ({ top: 700 }),
  };
  assert.equal(engine.calculateScrollDelta(canvasView), 0, "Canvas editor should be excluded from typewriter scrolling");

  // 2. Active range selection (drag selection / text highlight) without typing -> delta should be 0
  const rangeSelectionView = {
    dom: { closest: () => null },
    scrollDOM: {
      getBoundingClientRect: () => ({ top: 0, height: 1000 }),
    },
    state: { selection: { main: { head: 100, empty: false, from: 10, to: 100 } } },
    coordsAtPos: () => ({ top: 700 }),
  };
  assert.equal(engine.calculateScrollDelta(rangeSelectionView, false), 0, "Range selection should not scroll while dragging selection");
  assert.equal(engine.calculateScrollDelta(rangeSelectionView, true), 280, "Typing over a range selection should scroll");

  // 3. Virtualized line fallback via lineBlockAt when coordsAtPos returns null
  const virtualizedView = {
    dom: { closest: () => null },
    scrollDOM: {
      getBoundingClientRect: () => ({ top: 0, height: 1000 }),
      scrollTop: 500,
    },
    state: { selection: { main: { head: 500, empty: true } } },
    coordsAtPos: () => null, // temporarily outside viewport
    lineBlockAt: () => ({ top: 1200, height: 24 }), // 1200 - 500 = 700px relative Y
  };
  assert.equal(engine.calculateScrollDelta(virtualizedView), 280, "Fallback to lineBlockAt when coordsAtPos is null");
});

test("inline input hosts outside the Markdown editor receive key sounds", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    focusModeEnabled: true,
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  let characters = 0;
  plugin.audio.playCharKey = () => {
    characters += 1;
  };

  // Crisp Mind edits node text through a plain <input>, not a CodeMirror content host.
  windowObject.document.activeElement = createHost({ tagName: "INPUT" });
  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "a",
    metaKey: false,
  });
  assert.equal(characters, 1, "typing in an inline input should play a key sound");

  windowObject.document.activeElement = createHost({
    tagName: "DIV",
    contentEditable: true,
  });
  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "b",
    metaKey: false,
  });
  assert.equal(characters, 2, "contenteditable hosts should keep playing key sounds");

  plugin.onunload();
});

test("key sounds stay silent when focus is not in a text input", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({
    focusModeEnabled: true,
    typewriterAudioEnabled: true,
  });
  plugin.saveData = async () => {};
  await plugin.onload();

  let characters = 0;
  plugin.audio.playCharKey = () => {
    characters += 1;
  };

  windowObject.document.activeElement = createHost({ tagName: "DIV" });
  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "a",
    metaKey: false,
  });
  assert.equal(characters, 0, "a non-editable surface must not play key sounds");

  windowObject.document.activeElement = null;
  windowObject.dispatch("keydown", {
    altKey: false,
    ctrlKey: false,
    key: "b",
    metaKey: false,
  });
  assert.equal(characters, 0, "a missing active element must not play key sounds");

  plugin.onunload();
});

// Audio event regressions: authored before the 1.4.4 implementation.
async function setupAudioRegression(settings = {}) {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject, context } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ typewriterAudioEnabled: true, ...settings });
  plugin.saveData = async () => {};
  grantTestLicense(plugin);
  await plugin.onload();
  return { plugin, windowObject, context };
}

test('space preference defaults on and silences only space/confirmation across themes', async () => {
  const { plugin, context } = await setupAudioRegression();
  try {
    assert.equal(plugin.settings.typewriterSpaceEnabled, true);
    for (const theme of ['typewriter', 'mechanical', 'raindrop', 'retro8bit', 'woodenFish']) {
      plugin.settings.soundTheme = theme;
      plugin.settings.typewriterSpaceEnabled = false;
      const before = context.calls.oscillatorStarts + context.calls.bufferSourceStarts;
      plugin.audio.playSpaceKey();
      assert.equal(context.calls.oscillatorStarts + context.calls.bufferSourceStarts, before, theme);
      plugin.audio.playEnterKey();
      assert.ok(context.calls.oscillatorStarts + context.calls.bufferSourceStarts > before, theme);
    }
  } finally { plugin.onunload(); }
});

test('desktop space keydown and beforeinput produce one sound', async () => {
  const { plugin, windowObject } = await setupAudioRegression();
  try {
    let count = 0;
    plugin.audio.playSpaceKey = plugin.audio.playCharKey = () => count++;
    windowObject.dispatch('keydown', { key: ' ' });
    windowObject.dispatch('beforeinput', { inputType: 'insertText', data: ' ' });
    assert.equal(count, 1);
  } finally { plugin.onunload(); }
});

test('mobile space respects muted space preference without muting ordinary typing', async () => {
  const { plugin, windowObject, context } = await setupAudioRegression({ typewriterSpaceEnabled: false });
  try {
    windowObject.dispatch('beforeinput', { inputType: 'insertText', data: ' ' });
    assert.equal(context.calls.oscillatorStarts + context.calls.bufferSourceStarts, 0);
    windowObject.dispatch('beforeinput', { inputType: 'insertText', data: 'a' });
    assert.ok(context.calls.oscillatorStarts + context.calls.bufferSourceStarts > 0);
  } finally { plugin.onunload(); }
});

test('IME cancellation and non-editor composition end stay silent', async () => {
  const { plugin, windowObject } = await setupAudioRegression();
  try {
    let count = 0;
    plugin.audio.playSpaceKey = () => count++;
    windowObject.dispatch('compositionstart', {});
    windowObject.dispatch('compositionend', { data: '' });
    assert.equal(count, 0);
    windowObject.document.activeElement = { tagName: 'BUTTON', closest: () => null };
    windowObject.dispatch('compositionend', { data: '中' });
    assert.equal(count, 0);
  } finally { plugin.onunload(); }
});

test('IME commit followed by insertText does not play a second sound', async () => {
  const { plugin, windowObject } = await setupAudioRegression();
  try {
    let count = 0;
    plugin.audio.playSpaceKey = plugin.audio.playCharKey = () => count++;
    windowObject.dispatch('compositionstart', {});
    windowObject.dispatch('compositionend', { data: '中' });
    windowObject.dispatch('beforeinput', { inputType: 'insertText', data: '中' });
    assert.equal(count, 1);
  } finally { plugin.onunload(); }
});

// ---- 1.4.5 regressions -------------------------------------------------------

test('a paused session keeps ambient audio silent through later typing and clicks', async () => {
  const { CrispFocusPlugin, audioElements } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  grantTestLicense(plugin);
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ ambientSound: 'rain', typewriterAudioEnabled: true });
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    await plugin.startFocusSession(25);
    await plugin.pauseFocusSession();
    windowObject.dispatch('keydown', { altKey: false, ctrlKey: false, metaKey: false, key: 'a' });
    windowObject.dispatch('pointerdown', {});
    assert.equal(audioElements.filter((el) => !el.paused).length, 0, 'ambient must stay stopped while paused');
    await plugin.resumeFocusSession();
    assert.equal(audioElements.filter((el) => !el.paused).length, 1, 'resume brings ambient back');
  } finally { plugin.onunload(); }
});

test('stopping without an active session leaves Focus mode untouched', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({ focusModeEnabled: true });
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    await plugin.stopFocusSession();
    assert.equal(plugin.settings.focusModeEnabled, true);
  } finally { plugin.onunload(); }
});

test('a session that expired while Obsidian was closed is cleared from saved state', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  let saved = null;
  plugin.loadData = async () => ({ sessionState: { status: 'running', endAt: 1, remainingMs: 50_000 } });
  plugin.saveData = async (data) => { saved = JSON.parse(JSON.stringify(data)); };
  await plugin.onload();
  try {
    assert.equal(plugin.settings.sessionState.status, 'idle');
    assert.equal(saved?.sessionState?.status, 'idle', 'the stale running state must be persisted as idle');
  } finally { plugin.onunload(); }
});

test('pointer-driven selections do not scroll the typewriter viewport under the mouse', () => {
  const codemirrorView = { ViewPlugin: { fromClass: (C) => C } };
  const { createTypewriterExtension } = loadPluginInternals({ codemirrorView });
  const windowObject = { cancelAnimationFrame() {}, requestAnimationFrame(cb) { cb(); return 1; } };
  let scrolls = 0;
  const plugin = {
    licenseManager: { isEntitled: () => true },
    mainWindow: windowObject,
    settings: { focusModeEnabled: true, typewriterScrollEnabled: true, typewriterScrollOffset: 42 },
    typewriterEngine: { onUserActivity() {}, onUserScroll() {}, requestScroll() { scrolls += 1; } },
  };
  const view = {
    dom: { classList: createClassList(), closest: () => null, ownerDocument: { defaultView: windowObject }, querySelector: () => null, style: createStyle() },
    scrollDOM: { addEventListener() {}, removeEventListener() {} },
  };
  const ViewPluginClass = createTypewriterExtension(plugin);
  const instance = new ViewPluginClass(view);
  const tr = (event) => ({ isUserEvent: (name) => name === event || event.startsWith(`${name}.`) });

  instance.update({ view, docChanged: false, selectionSet: true, transactions: [tr('select.pointer')] });
  assert.equal(scrolls, 0, 'mouse click / drag must not move the page');
  instance.update({ view, docChanged: false, selectionSet: true, transactions: [tr('select')] });
  assert.equal(scrolls, 1, 'keyboard cursor moves still re-centre');
  instance.update({ view, docChanged: true, selectionSet: true, transactions: [tr('input.type')] });
  assert.equal(scrolls, 2, 'typing re-centres');
  instance.destroy();
});

test('cursor selection changes do not restyle every editor on each keystroke', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  plugin.loadData = async () => ({});
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    const cm = { plugins: [], hasFocus: true };
    plugin.app.workspace.getActiveViewOfType = () => ({ editor: { cm } });
    let restyles = 0;
    plugin.updateTypewriterStyles = () => { restyles += 1; };
    plugin.app.workspace.emit('editor-selection-change');
    plugin.app.workspace.emit('editor-selection-change');
    assert.equal(restyles, 0);
    plugin.app.workspace.emit('active-leaf-change');
    assert.equal(restyles, 1);
  } finally { plugin.onunload(); }
});

function createDataFileApp(windowObject, files, { failCopy = false, failWrite = false } = {}) {
  const app = createPluginApp(windowObject);
  const writes = [];
  app.vault.adapter = {
    ...app.vault.adapter,
    async exists(p) { return files.has(p); },
    async read(p) {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(p);
    },
    async copy(from, to) {
      if (failCopy) throw new Error('EACCES');
      files.set(to, files.get(from));
    },
    async write(p, text) {
      if (failWrite) throw new Error('EACCES');
      writes.push(p);
      files.set(p, text);
    },
  };
  return { app, writes };
}

const DATA_PATH = '.obsidian/plugins/crisp-focus/data.json';

test('a damaged data.json is backed up byte-for-byte before defaults are used', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const damaged = '{"licenseCode":"abc.def","typewriterAudioEnabled":tr';
  const files = new Map([[DATA_PATH, damaged]]);
  const plugin = new CrispFocusPlugin();
  plugin.app = createDataFileApp(windowObject, files).app;
  plugin.loadData = async () => undefined; // Obsidian's readJson result for an unreadable file
  let saves = 0;
  plugin.saveData = async () => { saves += 1; };
  await plugin.onload();
  try {
    const backups = [...files.keys()].filter((p) => p.startsWith(`${DATA_PATH}.corrupt-`));
    assert.equal(backups.length, 1, 'one backup of the damaged file');
    assert.equal(files.get(backups[0]), damaged, 'backup keeps the original bytes');
    assert.equal(plugin.settingsWriteBlocked, false);
    await plugin.saveSettings();
    assert.ok(saves > 0, 'once the damaged file is preserved, settings can be saved again');
  } finally { plugin.onunload(); }
});

test('if the damaged data.json cannot be backed up, the plugin never overwrites it', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const damaged = '{"licenseCode":"abc.def",';
  const files = new Map([[DATA_PATH, damaged]]);
  const plugin = new CrispFocusPlugin();
  plugin.app = createDataFileApp(windowObject, files, { failCopy: true, failWrite: true }).app;
  plugin.loadData = async () => undefined;
  let saves = 0;
  plugin.saveData = async () => { saves += 1; };
  await plugin.onload();
  try {
    assert.equal(plugin.settingsWriteBlocked, true);
    await plugin.setFocusModeEnabled(false);
    await plugin.saveSettings();
    assert.equal(saves, 0, 'no write may reach data.json');
    assert.equal(files.get(DATA_PATH), damaged);
  } finally { plugin.onunload(); }
});

test('a missing data.json is a normal first install without backups', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const files = new Map();
  const plugin = new CrispFocusPlugin();
  plugin.app = createDataFileApp(windowObject, files).app;
  plugin.loadData = async () => null;
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    assert.equal(plugin.settingsWriteBlocked, false);
    assert.equal(files.size, 0);
    assert.equal(plugin.settings.activeSceneId, 'silent-writing');
  } finally { plugin.onunload(); }
});

test('non-object data.json content is treated as damaged, not as settings', async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const files = new Map([[DATA_PATH, '"oops"']]);
  const plugin = new CrispFocusPlugin();
  plugin.app = createDataFileApp(windowObject, files).app;
  plugin.loadData = async () => 'oops';
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    assert.equal([...files.keys()].filter((p) => p.includes('.corrupt-')).length, 1);
    assert.equal(plugin.settings.focusModeEnabled, true);
  } finally { plugin.onunload(); }
});


/* 番茄钟（1.5.0）。失败模式：
   - 休息结束被旧版 Crisp Pulse 当成专注完成计分（旧版 Pulse 包装的是 completeFocusSession）。
   - 第 N 个之后该长休却给了短休；休息结束后不等用户就开始下一个。
   - 未激活也能开始番茄；中途结束没有告诉其他插件「这一段中断了」。
   - 重载后等待中的番茄丢失，或关着 Obsidian 时跑完的番茄被当成完成。 */
async function pomodoroPlugin({ licensed = true, saved = {} } = {}) {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  const events = [];
  plugin.app.workspace.trigger = (name, payload) => { if (name === "crisp-focus:session") events.push(payload); };
  plugin.app.workspace.getActiveFile = () => ({ path: "notes/draft.md" });
  if (licensed) grantTestLicense(plugin);
  plugin.loadData = async () => ({ sessionDurationMinutes: 25, ...saved });
  let persisted = null;
  plugin.saveData = async (value) => { persisted = JSON.parse(JSON.stringify(value)); };
  await plugin.onload();
  const chimes = [];
  plugin.audio.playChime = (kind) => chimes.push(kind);
  const finish = async () => { plugin.session.complete(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
  return { plugin, events, chimes, finish, persisted: () => persisted };
}

test("a pomodoro cycle alternates focus and breaks, with a long break after the fourth", async () => {
  const { plugin, events, chimes, finish } = await pomodoroPlugin();
  await plugin.startPomodoro();
  assert.equal(plugin.settings.sessionMeta.kind, "focus");
  assert.equal(plugin.settings.focusModeEnabled, true);
  assert.equal(plugin.statusBarEl.textContent, "专注 25:00 · 1/4");
  const breaks = [];
  for (let round = 1; round <= 4; round++) {
    await finish();
    breaks.push(plugin.settings.sessionMeta.phase);
    assert.equal(plugin.settings.focusModeEnabled, false, "休息时关掉专注效果");
    await finish();
    assert.equal(plugin.session.getSnapshot().status, "idle", "休息结束后等用户开始下一个");
    assert.equal(plugin.settings.pomodoroState.waiting, true);
    if (round < 4) await plugin.startNextPomodoro();
  }
  assert.deepEqual(breaks, ["short-break", "short-break", "short-break", "long-break"]);
  assert.equal(plugin.getPomodoroSnapshot().todayCount, 4);
  assert.deepEqual(chimes, ["focus-end", "break-end", "focus-end", "break-end", "focus-end", "break-end", "focus-end", "break-end"]);
  const completes = events.filter((e) => e.type === "complete");
  assert.deepEqual(completes.map((e) => `${e.kind}:${e.round}`), ["focus:1", "break:1", "focus:2", "break:2", "focus:3", "break:3", "focus:4", "break:4"]);
  assert.ok(events.every((e) => e.apiVersion === 2 && e.notePath === "notes/draft.md" && e.task === null));
  plugin.onunload();
});

test("an older Crisp Pulse wrapping completeFocusSession never sees a break completion", async () => {
  const { plugin, finish } = await pomodoroPlugin();
  const seen = [];
  const original = plugin.completeFocusSession;
  plugin.completeFocusSession = async function (...args) { seen.push(this.settings.sessionMeta?.kind); return original.apply(this, args); };
  await plugin.startPomodoro();
  await finish();
  await finish();
  assert.deepEqual(seen, ["focus"], "只有专注阶段经过 completeFocusSession");
  plugin.onunload();
});

test("ending mid-focus reports an interrupted session; skipping a break starts the next focus", async () => {
  const { plugin, events, finish } = await pomodoroPlugin();
  await plugin.startPomodoro();
  await finish();
  await plugin.skipPomodoroBreak();
  assert.equal(plugin.settings.sessionMeta.kind, "focus");
  assert.equal(plugin.settings.sessionMeta.round, 2);
  assert.equal(events.at(-2).type, "skip");
  await plugin.endPomodoro();
  const stop = events.at(-1);
  assert.equal(stop.type, "stop");
  assert.equal(stop.kind, "focus");
  assert.equal(stop.completed, false);
  assert.ok(stop.elapsedMs >= 0 && stop.elapsedMs < 60000);
  assert.equal(plugin.settings.pomodoroState, null);
  assert.equal(plugin.settings.focusModeEnabled, false);
  plugin.onunload();
});

test("pomodoro requires activation while a single focus session stays free", async () => {
  const { plugin, events } = await pomodoroPlugin({ licensed: false });
  assert.equal(await plugin.startPomodoro(), null);
  assert.equal(plugin.session.getSnapshot().status, "idle");
  await plugin.startFocusSession(25);
  assert.equal(plugin.session.getSnapshot().status, "running");
  assert.equal(events.at(-1).pomodoro, false);
  assert.equal(plugin.statusBarEl.textContent, "专注 25:00");
  plugin.onunload();
});

test("a waiting pomodoro survives a reload; one that expired while closed is dropped", async () => {
  const first = await pomodoroPlugin();
  await first.plugin.startPomodoro();
  await first.finish();
  await first.finish();
  first.plugin.onunload();
  const waiting = await pomodoroPlugin({ saved: first.persisted() });
  assert.equal(waiting.plugin.getPomodoroSnapshot().waiting, true);
  assert.equal(waiting.plugin.statusBarEl.textContent, "下一个番茄 · 2/4");
  waiting.plugin.onunload();
  const expired = await pomodoroPlugin({ saved: {
    sessionState: { status: "running", endAt: Date.now() - 1000, remainingMs: 0 },
    sessionMeta: { id: "x", kind: "focus", phase: "focus", pomodoro: true, round: 1, plannedMinutes: 25, startedAt: Date.now() - 26 * 60000 },
    pomodoroState: { active: true, round: 0, cycleId: "c", waiting: false },
  } });
  assert.equal(expired.plugin.settings.pomodoroState, null);
  assert.equal(expired.plugin.settings.sessionMeta, null);
  assert.equal(expired.events.length, 0, "没有亲眼看到跑完，不发完成事件");
  expired.plugin.onunload();
});

test("the panel shows where you are in the set and what the next step is", () => {
  const { pomodoroViewModel, nextPomodoroBreak } = loadPluginInternals();
  const base = { status: "idle", remainingMs: 0, plannedMs: 0, kind: null, phase: null, pomodoro: false, active: false, waiting: false, round: 0, completedRounds: 0, every: 4, focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, todayCount: 0, todayFocusMinutes: 0, goal: 8, entitled: true };
  const focus = pomodoroViewModel({ ...base, status: "running", kind: "focus", phase: "focus", pomodoro: true, active: true, round: 6, completedRounds: 5, remainingMs: 5 * 60000, plannedMs: 25 * 60000 }, 0);
  assert.equal(focus.meta, "第 2 / 4 个", "第二组里的第 2 个");
  assert.deepEqual(focus.slots.map((x) => x.state).join(","), "done,current,next,next");
  assert.equal(focus.slots[1].p, 0.8);
  const long = pomodoroViewModel({ ...base, status: "running", kind: "break", phase: "long-break", pomodoro: true, active: true, round: 4, completedRounds: 4, remainingMs: 60000, plannedMs: 15 * 60000 });
  assert.equal(long.slots.filter((x) => x.state === "done").length, 4, "长休时这一组 4 个都完成");
  assert.equal(long.actions.map((a) => a.id).join(","), "skip,end", "休息时不催你开始");
  const locked = pomodoroViewModel({ ...base, entitled: false });
  assert.equal(locked.actions[0].id, "activate");
  assert.equal(nextPomodoroBreak(8, 4), "long-break");
  assert.equal(nextPomodoroBreak(3, 4), "short-break");
});

/* 绑定任务的专注（1.7.0，配合 Crisp Tempo）。失败模式：
   - 番茄整轮里第二个专注丢了任务，投入只记到第一个。
   - 换任务开始新的专注时，被打断的那段记到新任务上。
   - 别的插件传来的任务字段（来源、标识、标题）原样进事件。
   - 重载后正在进行的专注忘了属于哪个任务；面板看不出在为哪件事专注。
   - 老调用方不传任务却继承了上一轮的任务。 */
const TEMPO_TASK = { source: "crisp-tempo", id: "task-1760000000000-ab12", title: "修复转写回链" };

test("every event of a task-bound pomodoro cycle names the task", async () => {
  const { plugin, events, finish } = await pomodoroPlugin();
  assert.equal(plugin.focusApiVersion, 2);
  await plugin.startPomodoro({ task: TEMPO_TASK });
  await finish();
  await plugin.skipPomodoroBreak();
  await plugin.endPomodoro();
  assert.deepEqual(events.map((e) => `${e.type}:${e.kind}:${e.round}`), ["start:focus:1", "complete:focus:1", "start:break:1", "skip:break:1", "start:focus:2", "stop:focus:2"]);
  assert.ok(events.every((e) => e.apiVersion === 2 && e.task && e.task.id === TEMPO_TASK.id && e.task.source === "crisp-tempo" && e.task.title === "修复转写回链"));
  await plugin.startPomodoro();
  assert.equal(events.at(-1).task, null, "不带任务开始的新一轮不沿用上一轮的任务");
  assert.equal(plugin.getPomodoroSnapshot().task, null);
  plugin.onunload();
});

test("switching tasks closes the running session under the old task", async () => {
  const { plugin, events } = await pomodoroPlugin({ licensed: false });
  await plugin.startFocusSession(undefined, { task: TEMPO_TASK });
  assert.equal(plugin.settings.sessionMeta.plannedMinutes, 25, "不给时长就用设置里的时长");
  assert.equal(plugin.getPomodoroSnapshot().task.title, "修复转写回链");
  const other = { source: "crisp-tempo", id: "task-2", title: "写周报" };
  await plugin.startFocusSession(undefined, { task: other });
  const [stop, start] = events.slice(-2);
  assert.equal(stop.type, "stop");
  assert.equal(stop.task.id, TEMPO_TASK.id);
  assert.equal(start.type, "start");
  assert.equal(start.task.id, "task-2");
  await plugin.startFocusSession(25);
  assert.equal(events.at(-1).task, null);
  plugin.onunload();
});

test("task context from another plugin is validated before it reaches events", async () => {
  const { plugin, events } = await pomodoroPlugin({ licensed: false });
  const bad = [
    "task-1",
    { source: "Crisp Tempo", id: "task-1", title: "x" },
    { source: "crisp-tempo", id: "task 1", title: "x" },
    { source: "crisp-tempo", id: "task-1", title: "   " },
  ];
  for (const task of bad) {
    await plugin.startFocusSession(25, { task });
    assert.equal(events.at(-1).task, null, JSON.stringify(task));
  }
  await plugin.startFocusSession(25, { task: { ...TEMPO_TASK, title: `  ${"长".repeat(300)}\n标题  `, extra: "dropped" } });
  const task = events.at(-1).task;
  assert.equal(task.title.length, 200);
  assert.ok(!task.title.includes("\n"));
  assert.deepEqual(Object.keys(task).sort(), ["id", "source", "title"]);
  plugin.onunload();
});

test("a running task-bound session keeps its task across a reload", async () => {
  const first = await pomodoroPlugin();
  await first.plugin.startPomodoro({ task: TEMPO_TASK });
  first.plugin.onunload();
  const again = await pomodoroPlugin({ saved: first.persisted() });
  assert.equal(again.plugin.getPomodoroSnapshot().task.id, TEMPO_TASK.id);
  await again.plugin.endPomodoro();
  assert.equal(again.events.at(-1).task.id, TEMPO_TASK.id);
  again.plugin.onunload();
});

test("the panel and status bar say which task the session is for", async () => {
  const { pomodoroViewModel } = loadPluginInternals();
  const base = { status: "running", remainingMs: 60000, plannedMs: 25 * 60000, kind: "focus", phase: "focus", pomodoro: true, active: true, waiting: false, round: 1, completedRounds: 0, every: 4, focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, todayCount: 0, todayFocusMinutes: 0, goal: 8, entitled: true };
  assert.equal(pomodoroViewModel({ ...base, task: TEMPO_TASK }).task, "修复转写回链");
  assert.equal(pomodoroViewModel({ ...base, kind: "break", phase: "short-break", task: TEMPO_TASK }).task, "修复转写回链");
  assert.equal(pomodoroViewModel({ ...base, pomodoro: false, task: TEMPO_TASK }).task, "修复转写回链");
  assert.equal(pomodoroViewModel({ ...base, task: null }).task, "");
  assert.equal(pomodoroViewModel({ ...base, status: "idle", active: false, kind: null, task: null }).task, "");
  const { plugin } = await pomodoroPlugin();
  await plugin.startPomodoro({ task: TEMPO_TASK });
  assert.equal(plugin.statusBarEl["aria-label"], "修复转写回链 · 打开番茄钟");
  assert.equal(plugin.statusBarEl["data-tooltip-position"], "top");
  assert.equal(plugin.statusBarEl.title, "", "不再叠一个系统原生提示");
  plugin.onunload();
});

/* 清爽打字（1.6.0）。失败模式：
   - 退出时把用户原本就收着的侧栏也展开了，或者没把原本打开的侧栏放回来。
   - 插件卸载/重载时还停在清爽打字：侧栏不回来、界面元素一直隐藏。
   - 新开的弹出窗口不跟随；状态栏开关要重进一次才生效。
   - 手机端隐藏视图标题栏后没有返回入口。
   - 标签栏被 display:none 拿掉，窗口顶部失去拖动区域。 */
async function cleanTypingPlugin({ left = true, right = true, saved = {}, mobile = false, licensed = true } = {}) {
  const { CrispFocusPlugin } = loadPluginInternals({ mobile });
  const { windowObject } = createWindow();
  windowObject.document.body = { classList: createClassList() };
  const plugin = new CrispFocusPlugin();
  const license = { valid: licensed };
  plugin.licenseVerifier = async () => (license.valid
    ? { valid: true, source: "online", payload: { product: "Crisp Suite", features: ["all"], userName: "Test user" } }
    : { valid: false, reason: "未激活" });
  plugin.app = createPluginApp(windowObject);
  const split = (open) => ({
    collapsed: !open,
    collapse() { this.collapsed = true; },
    expand() { this.collapsed = false; },
  });
  plugin.app.workspace.leftSplit = split(left);
  plugin.app.workspace.rightSplit = split(right);
  plugin.loadData = async () => ({ ...saved });
  plugin.saveData = async () => {};
  await plugin.onload();
  return { plugin, license, windowObject, body: windowObject.document.body, workspace: plugin.app.workspace };
}

test("clean typing collapses open sidebars and restores only the ones it collapsed", async () => {
  const { plugin, body, workspace } = await cleanTypingPlugin({ left: true, right: false });
  try {
    assert.equal(plugin.setCleanTypingEnabled(true), true);
    assert.equal(workspace.leftSplit.collapsed, true);
    assert.equal(workspace.rightSplit.collapsed, true);
    assert.equal(body.classList.contains("crisp-focus-clean-typing"), true);

    plugin.setCleanTypingEnabled(false);
    assert.equal(workspace.leftSplit.collapsed, false);
    assert.equal(workspace.rightSplit.collapsed, true, "a sidebar that was already closed stays closed");
    assert.equal(body.classList.contains("crisp-focus-clean-typing"), false);
  } finally { plugin.onunload(); }
});

test("unloading the plugin during clean typing brings the workspace back", async () => {
  const { plugin, body, workspace } = await cleanTypingPlugin();
  plugin.setCleanTypingEnabled(true);
  plugin.onunload();
  assert.equal(workspace.leftSplit.collapsed, false);
  assert.equal(workspace.rightSplit.collapsed, false);
  assert.equal(body.classList.contains("crisp-focus-clean-typing"), false);
  assert.equal(body.classList.contains("crisp-focus-clean-typing--hide-status"), false);
});

test("clean typing follows pop-out windows and applies the status bar option live", async () => {
  const { plugin, body, workspace } = await cleanTypingPlugin();
  try {
    plugin.setCleanTypingEnabled(true);
    assert.equal(body.classList.contains("crisp-focus-clean-typing--hide-status"), true, "status bar hidden by default");

    const { windowObject: popout } = createWindow();
    popout.document.body = { classList: createClassList() };
    workspace.emit("window-open", {}, popout);
    assert.equal(popout.document.body.classList.contains("crisp-focus-clean-typing"), true);

    await plugin.setCleanTypingHideStatusBar(false);
    assert.equal(body.classList.contains("crisp-focus-clean-typing--hide-status"), false);
    assert.equal(popout.document.body.classList.contains("crisp-focus-clean-typing--hide-status"), false);
    assert.equal(plugin.settings.cleanTypingHideStatusBar, false);
  } finally { plugin.onunload(); }
});

test("clean typing stays off on mobile, where the view header is the way back", async () => {
  const { plugin, body, workspace } = await cleanTypingPlugin({ mobile: true });
  try {
    assert.equal(plugin.setCleanTypingEnabled(true), false);
    assert.equal(plugin.cleanTypingActive, false);
    assert.equal(workspace.leftSplit.collapsed, false);
    assert.equal(body.classList.contains("crisp-focus-clean-typing"), false);
  } finally { plugin.onunload(); }
});

test("clean typing styles keep the window draggable and avoid compositor layers", () => {
  const styles = fs.readFileSync(stylesPath, "utf8");
  const rules = styles.split("}").filter((rule) => rule.includes("crisp-focus-clean-typing"));
  assert.ok(rules.length > 0, "clean typing has styles");
  for (const rule of rules) {
    if (rule.includes("workspace-tab-header-container")) {
      assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden/, "the tab strip is the window's drag region");
    }
    assert.doesNotMatch(rule, /backdrop-filter|will-change|translate3d/);
  }
  // Obsidian 1.9+ marks the ribbons mod-primary / mod-secondary, not mod-left.
  assert.match(styles, /body\.crisp-focus-clean-typing \.workspace-ribbon[,\s{]/);
});

/* 激活门槛（1.6.0）：清爽打字与打字机定焦需要激活。失败模式：
   - 未激活也能进入清爽打字，或打字机定焦照常滚动、注入底部留白。
   - 未激活时把用户已保存的定焦开关改掉，激活后还得重新打开。
   - 激活成功后要重启才生效；授权被撤销后定焦和清爽打字还挂着。 */
function typewriterFixture(windowObject) {
  const editor = { classList: createClassList(), style: createStyle() };
  windowObject.addCursorFixture(editor, { style: {} });
  return editor;
}

function farCursorView() {
  return {
    scrollDOM: {
      getBoundingClientRect: () => ({ top: 0, height: 1000 }),
      scrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 1000,
    },
    state: { selection: { main: { head: 10 } } },
    coordsAtPos: () => ({ top: 900 }),
  };
}

test("clean typing requires activation", async () => {
  const { plugin, body, workspace } = await cleanTypingPlugin({ licensed: false });
  try {
    assert.equal(plugin.setCleanTypingEnabled(true), false);
    assert.equal(plugin.cleanTypingActive, false);
    assert.equal(workspace.leftSplit.collapsed, false);
    assert.equal(body.classList.contains("crisp-focus-clean-typing"), false);
  } finally { plugin.onunload(); }
});

test("typewriter scrolling stays inert until activation, then works without re-enabling", async () => {
  const { plugin, license, windowObject } = await cleanTypingPlugin({
    licensed: false,
    saved: { focusModeEnabled: true, typewriterScrollEnabled: true },
  });
  const editor = typewriterFixture(windowObject);
  try {
    plugin.updateTypewriterStyles();
    assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), false);
    assert.equal(plugin.typewriterEngine.calculateScrollDelta(farCursorView()), 0);
    assert.equal(plugin.settings.typewriterScrollEnabled, true, "the saved choice is kept");

    await plugin.setTypewriterScrollEnabled(false);
    assert.equal(await plugin.setTypewriterScrollEnabled(true), false, "cannot be switched on before activation");
    assert.equal(plugin.settings.typewriterScrollEnabled, false);

    plugin.settings.typewriterScrollEnabled = true;
    license.valid = true;
    assert.equal((await plugin.activateLicense("signed-code")).valid, true);
    assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), true, "applies right after activation");
    assert.notEqual(plugin.typewriterEngine.calculateScrollDelta(farCursorView()), 0);
  } finally { plugin.onunload(); }
});

test("losing the license removes typewriter styling and leaves clean typing", async () => {
  const { plugin, license, windowObject, body, workspace } = await cleanTypingPlugin({
    saved: { focusModeEnabled: true, typewriterScrollEnabled: true },
  });
  const editor = typewriterFixture(windowObject);
  try {
    plugin.updateTypewriterStyles();
    plugin.setCleanTypingEnabled(true);
    assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), true);

    license.valid = false;
    await plugin.refreshLicense();
    assert.equal(editor.classList.contains("crisp-focus-typewriter-active"), false);
    assert.equal(plugin.cleanTypingActive, false);
    assert.equal(workspace.leftSplit.collapsed, false);
    assert.equal(body.classList.contains("crisp-focus-clean-typing"), false);
  } finally { plugin.onunload(); }
});

/* 1.6.1 审核修复。失败模式：
   - 会话转换在写盘期间被新动作插队：旧转换随后启动的计时覆盖新会话，事件与计时对不上。
   - 开始会话的写盘还没结束时暂停/结束无效，写盘结束后会话照样开始。
   - 跳过休息绕过激活检查。
   - 授权到期后仍按「已激活」运行，失效回调不触发；超长到期时间让定时器溢出立即触发。
   - 插件加载前已经开着的弹出窗口没有接入。
   - 并发激活时，过期的旧请求把新激活的状态回滚。
   - 清爽打字把非写作视图（Tempo、Launchpad 等）的标题栏也一起藏掉。 */
function blockNextSave(plugin) {
  const original = plugin.saveData;
  let release;
  let blocked = true;
  plugin.saveData = async (value) => {
    if (blocked) {
      blocked = false;
      await new Promise((resolve) => { release = resolve; });
    }
    return original(value);
  };
  return () => release?.();
}

test("a new session started while a pomodoro break is being saved is not overwritten", async () => {
  const { plugin, events } = await pomodoroPlugin();
  try {
    await plugin.startPomodoro();
    const release = blockNextSave(plugin);
    plugin.session.complete(); // focus done → transition to short break begins and waits on disk
    await plugin.startFocusSession(50);
    release();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const snap = plugin.session.getSnapshot();
    assert.equal(snap.status, "running");
    assert.equal(Math.round(snap.remainingMs / 60000), 50);
    assert.equal(plugin.settings.sessionMeta.plannedMinutes, 50);
    assert.equal(plugin.settings.sessionMeta.pomodoro, false);
    assert.equal(plugin.settings.focusModeEnabled, true, "the older break transition must not switch Focus off");
    assert.equal(events.filter((e) => e.type === "start" && e.plannedMinutes === 50).length, 1);
    const breakStart = events.find((e) => e.type === "start" && e.kind === "break");
    if (breakStart) {
      assert.ok(events.some((e) => e.type === "stop" && e.id === breakStart.id), "an interrupted break is reported as stopped");
    }
  } finally { plugin.onunload(); }
});

test("pause and stop during a slow session start take effect", async () => {
  for (const action of ["stop", "pause"]) {
    const { plugin, events } = await pomodoroPlugin();
    try {
      const release = blockNextSave(plugin);
      const starting = plugin.startFocusSession(25);
      if (action === "stop") await plugin.stopFocusSession();
      else await plugin.pauseFocusSession();
      release();
      await starting;
      const snap = plugin.session.getSnapshot();
      if (action === "stop") {
        assert.equal(snap.status, "idle");
        assert.equal(plugin.settings.focusModeEnabled, false);
        assert.deepEqual(events.map((e) => e.type), ["start", "stop"]);
      } else {
        assert.equal(snap.status, "paused");
        assert.deepEqual(events.map((e) => e.type), ["start", "pause"]);
      }
    } finally { plugin.onunload(); }
  }
});

test("skipping a break needs a valid license like starting the next pomodoro", async () => {
  const { plugin } = await pomodoroPlugin();
  try {
    await plugin.startPomodoro();
    plugin.session.complete();
    await new Promise((r) => setImmediate(r));
    assert.equal(plugin.settings.sessionMeta.kind, "break");
    plugin.licenseManager.status = { valid: false, reason: "revoked" };
    assert.equal(await plugin.skipPomodoroBreak(), null);
    assert.equal(plugin.settings.sessionMeta.kind, "break", "the break keeps running");
  } finally { plugin.onunload(); }
});

test("a verified license expires on time and notifies once, even far in the future", async () => {
  const { CrispFocusLicenseManager } = loadPluginInternals();
  let now = 1_000;
  const timers = [];
  let losses = 0;
  const expiresAt = new Date(5_000).toISOString();
  const manager = new CrispFocusLicenseManager(null, { licenseCode: "code" }, {
    now: () => now,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    onEntitlementLost: () => { losses += 1; },
    verifier: async () => ({ valid: true, source: "online", payload: { product: "Crisp Suite", features: ["all"], expiresAt } }),
  });
  await manager.verify();
  assert.equal(manager.isEntitled(), true);
  now = 6_000;
  assert.equal(manager.isEntitled(), false, "expiry is honoured even before the timer fires");
  timers.at(-1).fn();
  assert.equal(losses, 1);
  assert.equal(manager.isEntitled(), false);

  // Far expiry: delays above 2^31-1 ms would overflow and fire at once.
  now = 0;
  const far = new CrispFocusLicenseManager(null, { licenseCode: "code" }, {
    now: () => now,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    onEntitlementLost: () => { losses += 1; },
    verifier: async () => ({ valid: true, source: "online", payload: { product: "Crisp Suite", features: ["all"], expiresAt: new Date(100 * 86_400_000).toISOString() } }),
  });
  await far.verify();
  const pending = timers.at(-1);
  assert.ok(pending.delay <= 0x7fffffff);
  pending.fn(); // checkpoint before expiry: still valid, re-armed
  assert.equal(far.isEntitled(), true);
  assert.equal(losses, 1);
  far.destroy();
});

test("pop-out windows opened before the plugin loads are attached", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject: main } = createWindow();
  const { windowObject: popout } = createWindow();
  main.document.body = { classList: createClassList() };
  popout.document.body = { classList: createClassList() };
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(main);
  plugin.app.workspace.iterateAllLeaves = (cb) => {
    cb({ view: { containerEl: { ownerDocument: { defaultView: main } } } });
    cb({ view: { containerEl: { ownerDocument: { defaultView: popout } } } });
  };
  grantTestLicense(plugin);
  plugin.loadData = async () => ({});
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    assert.equal(plugin.windowBindings.has(popout), true);
    assert.equal(plugin.windowBindings.size, 2);
    plugin.setCleanTypingEnabled(true);
    assert.equal(popout.document.body.classList.contains("crisp-focus-clean-typing"), true);
  } finally { plugin.onunload(); }
});

test("a stale activation request never rolls back a newer successful one", async () => {
  const { CrispFocusPlugin } = loadPluginInternals();
  const { windowObject } = createWindow();
  const plugin = new CrispFocusPlugin();
  plugin.app = createPluginApp(windowObject);
  const pending = {};
  plugin.licenseVerifier = (code) => {
    if (code === "old") return Promise.resolve({ valid: false, reason: "old revoked" });
    if (!code) return Promise.resolve({ valid: false, reason: "授权码为空" });
    return new Promise((resolve) => { pending[code] = resolve; });
  };
  plugin.loadData = async () => ({ licenseCode: "old" });
  plugin.saveData = async () => {};
  await plugin.onload();
  try {
    const ok = { valid: true, source: "online", payload: { product: "Crisp Suite", features: ["all"] } };
    const first = plugin.activateLicense("candidate-A");
    const second = plugin.activateLicense("candidate-B");
    pending["candidate-B"](ok);
    await second;
    pending["candidate-A"](ok);
    await first;
    assert.equal(plugin.settings.licenseCode, "candidate-B");
    assert.equal(plugin.licenseManager.isEntitled(), true);
  } finally { plugin.onunload(); }
});

test("clean typing hides the view header only in writing views", () => {
  const styles = fs.readFileSync(stylesPath, "utf8");
  const rules = styles.split("}").filter((rule) => rule.includes("crisp-focus-clean-typing") && rule.includes(".view-header"));
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    const selectors = rule.slice(rule.lastIndexOf("{") === -1 ? 0 : 0, rule.indexOf("{")).split(",").filter((s) => s.includes(".view-header"));
    for (const selector of selectors) {
      assert.match(selector, /data-type="markdown"/, `view header rule must be scoped: ${selector.trim()}`);
    }
  }
});
