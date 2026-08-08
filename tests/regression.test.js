const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pluginPath = path.join(__dirname, "..", "main.js");
const stylesPath = path.join(__dirname, "..", "styles.css");

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
      if (selector === ".cm-editor.crisp-focus-active") return cursorEditors;
      if (selector === ".cm-editor .cm-cursor") return cursorElements;
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

function createObsidianMock() {
  class Plugin {
    addCommand() {}
    addSettingTab() {}
    registerEvent() {}
  }
  return {
    MarkdownView: class MarkdownView {},
    Notice: class Notice {},
    Plugin,
    PluginSettingTab: class PluginSettingTab {},
    Setting: class Setting {},
  };
}

function loadPluginInternals() {
  const source = `${fs.readFileSync(pluginPath, "utf8")}
module.exports.__test = {
  CrispFocusAudioEngine,
  CrispFocusPlugin,
  ensureCursorLayerPatched,
  patchCursorLayer,
  renderAboutCard: typeof renderAboutCard === "function" ? renderAboutCard : undefined,
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
      if (name === "obsidian") return createObsidianMock();
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
