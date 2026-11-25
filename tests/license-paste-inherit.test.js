"use strict";

// Paste normalisation and the local scan for sibling codes, with the real verifier and a test key.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");

const pair = generateKeyPairSync("ed25519");
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const original = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function makeCode(overrides = {}, key = pair.privateKey) {
  const payload = Buffer.from(JSON.stringify({
    product: "Crisp Suite", licenseId: "PASTE-TEST", features: ["all"], expiresAt: "2999-01-01T00:00:00Z", ...overrides,
  })).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), key).toString("base64url")}`;
}

function load() {
  const requests = [];
  const requestUrl = async (options) => {
    requests.push(JSON.parse(options.body));
    return { status: 200, json: { valid: true } };
  };
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, Buffer, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
    console: { debug() {}, log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    require(name) {
      if (name !== "obsidian") return require(name);
      return new Proxy({ requestUrl, addIcon() {}, debounce(fn) { return fn; } }, { get: (o, k) => o[k] || class {} });
    },
  };
  sandbox.window = sandbox;
  const source = original.replace(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/, publicPem);
  vm.runInNewContext(`${source}\nmodule.exports.__t = { normalizeLicenseCode, verifyLicenseCode, discoverVaultCrispLicenses };`, sandbox);
  return { ...module.exports.__t, requests };
}

const CLEAN = makeCode();
const [P, S] = CLEAN.split(".");

test("normalize: breaks, spaces, full-width space and zero-width characters are removed", async () => {
  const { normalizeLicenseCode, verifyLicenseCode } = load();
  const messy = `${P.slice(0, 10)}\n${P.slice(10, 20)}\r\n${P.slice(20)}.${S.slice(0, 15)}\u3000${S.slice(15, 30)}\u200B ${S.slice(30)}`;
  assert.equal(normalizeLicenseCode(messy), CLEAN);
  assert.equal((await verifyLicenseCode(messy, "crisp-focus", null, undefined, { skipOnline: true })).valid, true);
});

test("normalize: surrounding text is dropped and the server receives the clean code", async () => {
  const { verifyLicenseCode, requests } = load();
  for (const wrapped of [`卡密：${CLEAN}。`, `${CLEAN}\n复制卡密发送给买家`]) {
    assert.equal((await verifyLicenseCode(wrapped, "crisp-focus")).valid, true);
  }
  assert.equal(requests.length, 2);
  for (const body of requests) assert.equal(body.licenseCode, CLEAN);
});

test("normalize: garbage and empty input stay invalid with the same reasons", async () => {
  const { normalizeLicenseCode, verifyLicenseCode } = load();
  assert.equal(normalizeLicenseCode(undefined), "");
  const empty = await verifyLicenseCode(" \n ", "crisp-focus", null, undefined, { skipOnline: true });
  assert.deepEqual([empty.valid, empty.reason], [false, "授权码为空"]);
  const junk = await verifyLicenseCode("not a code", "crisp-focus", null, undefined, { skipOnline: true });
  assert.deepEqual([junk.valid, junk.reason], [false, "授权码格式无效"]);
});

test("normalize: a clean code is unchanged", async () => {
  const { normalizeLicenseCode, verifyLicenseCode } = load();
  assert.equal(normalizeLicenseCode(CLEAN), CLEAN);
  assert.equal((await verifyLicenseCode(CLEAN, "crisp-focus", null, undefined, { skipOnline: true })).valid, true);
});

function fakeApp(siblings) {
  const files = new Map();
  const folders = [];
  for (const [id, data] of Object.entries(siblings)) {
    folders.push(`.config/plugins/${id}`);
    files.set(`.config/plugins/${id}/data.json`, JSON.stringify(data));
  }
  return { vault: { configDir: ".config", adapter: {
    exists: async (p) => p === ".config/plugins" || files.has(p),
    list: async () => ({ folders, files: [] }),
    read: async (p) => files.get(p),
  } } };
}

test("scan: reads data.json under the configured dir, cleans codes, and accepts Tempo's licenseKey", async () => {
  const { discoverVaultCrispLicenses, verifyLicenseCode: local } = load();
  const app = fakeApp({ "crisp-mind": { licenseCode: `卡密：${CLEAN}\n` }, "crisp-tempo": { licenseKey: makeCode({ licenseId: "T" }) } });
  const found = await discoverVaultCrispLicenses(app, "crisp-focus", 5, local, undefined);
  assert.equal(found.length, 2);
  assert.equal(found[0], CLEAN);
});

test("scan: forged, wrong-product and other-plugin codes are dropped before any online request", async () => {
  const lib = load();
  const other = generateKeyPairSync("ed25519");
  const app = fakeApp({
    "crisp-mind": { licenseCode: makeCode({}, other.privateKey) },
    "crisp-pulse": { licenseCode: makeCode({ product: "Crisp Pulse" }) },
    "crisp-search": { licenseCode: makeCode({ features: ["crisp-pulse"] }) },
    "crisp-focus": { licenseCode: CLEAN },
  });
  const found = await lib.discoverVaultCrispLicenses(app, "crisp-focus", 5,
    (code, id, a, w, o) => lib.verifyLicenseCode(code, id, a, w, o), undefined);
  assert.equal(found.length, 0);
  assert.equal(lib.requests.length, 0);
});
