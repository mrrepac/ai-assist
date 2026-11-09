import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "ai-quota-view-"));
const require = createRequire(import.meta.url);
const status = { connected: true, email: "test@example.com", activeAccountId: "one" };
let count = 0;
class Element {
  constructor(doc, tag = "div") {
    this.ownerDocument = doc; this.tagName = tag; this.children = []; this.attributes = {};
    this._text = ""; this.hidden = false;
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
}
const doc = { createElement: tag => new Element(doc, tag) };
const original = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
let now = Date.parse("2026-11-09T12:00:00Z"), nextTimer = 0;
const timers = new Map();
Date.now = () => now;
globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
const advance = ms => {
  now += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
};
const result = () => ({ available: true, checkedAt: now, account: { email: status.email }, windows: [
  { remainingPercent: 78, windowDurationMins: 10080, resetsAt: now + 86400000 },
] });
const plugin = { name: "mock", setup(build) {
  build.onResolve({ filter: /chatgpt-auth$/ }, () => ({ path: "auth", namespace: "mock" }));
  build.onResolve({ filter: /chatgpt-quota$/ }, () => ({ path: "quota", namespace: "mock" }));
  build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
  build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ loader: "js", contents:
    path === "auth" ? "export const chatGPTStatus=async()=>{if(globalThis.__statusError)throw Error('offline');return globalThis.__statuses?.shift()??globalThis.__status;};" :
    path === "quota" ? "export const readChatGPTSharedQuota=async(email,signal)=>{globalThis.__calls++;globalThis.__signal=signal;if(globalThis.__quotaError)throw Error('offline');return globalThis.__pending??globalThis.__result;};" :
    "export const moment={locale:()=>globalThis.__locale??'ru'}; export const setIcon=(element,icon)=>{element.icon=icon;};",
  }));
} };
try {
  const file = join(dir, "view.cjs");
  await esbuild.build({ entryPoints: ["src/chatgpt-quota-view.ts"], outfile: file, bundle: true,
    platform: "node", format: "cjs", plugins: [plugin], logLevel: "error" });
  const { renderChatGPTQuota } = require(file);
  globalThis.__status = status; globalThis.__calls = 0; globalThis.__result = result(); globalThis.__locale = "ru";
  const mount = () => {
    const root = new Element(doc), dispose = renderChatGPTQuota(root), box = root.children[0];
    return { root, box, summary: box.children[0], button: box.children[1], dispose };
  };
  let ui = mount();
  assert.equal(globalThis.__calls, 0); assert.equal(timers.size, 0);
  assert.equal(ui.summary.textContent, "Codex · не проверен"); count++;
  assert.equal(ui.box.children.length, 2); assert.equal(ui.button.textContent, "");
  assert.equal(ui.button.icon, "refresh-cw"); assert.equal(ui.button.type, "button");
  assert.equal(ui.button.getAttribute("aria-label"), "Обновить лимит");
  assert.equal(ui.summary.tabIndex, 0);
  assert.match(ui.summary.getAttribute("aria-description"), /рабочего пространства не подтверждено/);
  assert.match(ui.summary.getAttribute("aria-description"), /SIWC недоступен/);
  const singleTooltip = element => {
    assert.equal(element.title, undefined); assert.equal(element.getAttribute("title"), undefined);
    assert.notEqual(element.icon, "info"); assert.notEqual(element.className, "ai-quota-info");
    for (const child of element.children) singleTooltip(child);
  };
  singleTooltip(ui.box); count++;
  await ui.button.onclick();
  assert.match(ui.summary.textContent, /Codex · общий78%/);
  assert.match(ui.summary.children[1].children[1].textContent, /нояб/);
  assert.doesNotMatch(ui.summary.textContent, /2026|app-server|SIWC| h| d|снимок|обновите/);
  assert.match(ui.summary.getAttribute("aria-label"), /7 дн; сброс/);
  assert.match(ui.summary.getAttribute("aria-label"), /Проверено/); assert.equal(ui.button.disabled, false);
  assert.doesNotMatch(ui.summary.getAttribute("aria-label"), /test@example.com|SIWC|app-server/);
  singleTooltip(ui.box);
  assert.equal(ui.summary.children[2].hidden, true); count++;
  const calls = globalThis.__calls;
  advance(60000);
  assert.equal(globalThis.__calls, calls); assert.equal(ui.summary.children[2].hidden, false);
  assert.equal(ui.summary.children[2].textContent, "*"); assert.match(ui.summary.getAttribute("aria-label"), /снимок, обновите/);
  assert.doesNotMatch(ui.summary.textContent, /обновите|актуальных/); count++;
  advance(86400000);
  assert.equal(ui.summary.textContent, "Codex · обновите"); assert.doesNotMatch(ui.summary.textContent, /%/);
  assert.equal(globalThis.__calls, calls); ui.dispose(); assert.equal(timers.size, 0); count++;

  ui = mount(); let resolve;
  globalThis.__pending = new Promise(r => { resolve = r; });
  const before = globalThis.__calls, click = ui.button.onclick();
  await Promise.resolve(); await ui.button.onclick();
  assert.equal(globalThis.__calls, before + 1); assert.equal(ui.button.disabled, true);
  ui.dispose(); assert.equal(globalThis.__signal.aborted, true);
  resolve(result()); await click; delete globalThis.__pending;
  assert.equal(ui.summary.textContent, "Codex · проверка…"); assert.equal(timers.size, 0); count++;

  for (const reason of ["missing-cli", "account-mismatch", "signed-out", "expired", "no-limits"]) {
    globalThis.__result = { available: false, reason, error: "Safe failure" }; ui = mount();
    await ui.button.onclick(); assert.equal(ui.summary.textContent, "Codex · недоступен");
    assert.doesNotMatch(ui.summary.textContent, /%/); assert.equal(ui.button.disabled, false);
    assert.equal(ui.summary.getAttribute("aria-label").split("\n").length, 2); ui.dispose(); count++;
  }
  globalThis.__result = result(); globalThis.__result.windows[0].resetsAt = now - 1000; ui = mount();
  await ui.button.onclick(); assert.equal(ui.summary.textContent, "Codex · обновите");
  assert.equal(timers.size, 0); ui.dispose(); count++;

  globalThis.__result = result(); globalThis.__result.checkedAt = now - 60001; ui = mount();
  await ui.button.onclick(); assert.equal(ui.summary.children[2].hidden, false);
  assert.match(ui.summary.getAttribute("aria-label"), /снимок/); ui.dispose(); count++;

  globalThis.__result = result(); globalThis.__result.windows.unshift({ remainingPercent: 92, windowDurationMins: 300, resetsAt: now + 3600000 });
  ui = mount(); await ui.button.onclick();
  assert.ok(ui.summary.textContent.includes("92% / 5 \u0447")); assert.ok(ui.summary.textContent.includes("78% / 7 \u0434\u043d"));
  assert.doesNotMatch(ui.summary.textContent, / h| d/); ui.dispose(); count++;

  globalThis.__result = result(); globalThis.__statuses = [status, { ...status, activeAccountId: "two" }];
  ui = mount(); await ui.button.onclick();
  assert.equal(ui.summary.textContent, "Codex · не проверен"); assert.doesNotMatch(ui.summary.getAttribute("aria-label"), /test@example.com/);
  assert.equal(timers.size, 0); ui.dispose(); delete globalThis.__statuses; count++;

  globalThis.__status = { connected: false }; ui = mount();
  const disconnectedCalls = globalThis.__calls; await ui.button.onclick();
  assert.equal(ui.summary.textContent, "Не подключено"); assert.equal(globalThis.__calls, disconnectedCalls);
  assert.equal(ui.button.disabled, false); ui.dispose(); globalThis.__status = status; count++;

  globalThis.__quotaError = true; ui = mount(); await ui.button.onclick();
  assert.equal(ui.summary.textContent, "Codex · недоступен"); assert.equal(ui.button.disabled, false);
  assert.match(ui.summary.getAttribute("aria-label"), /Не удалось проверить/); delete globalThis.__quotaError;
  await ui.button.onclick(); assert.match(ui.summary.textContent, /78%/); ui.dispose(); count++;

  globalThis.__locale = "en"; ui = mount(); await ui.button.onclick();
  assert.match(ui.summary.textContent, /Codex · shared78%/); assert.match(ui.summary.getAttribute("aria-label"), /7 d; resets/);
  assert.match(ui.summary.children[1].children[1].textContent, /Nov/); ui.dispose(); count++;
  assert.equal(timers.size, 0);
  console.log(count + " quota UI checks passed. Offline mocked DOM, locales and timers only.");
} finally {
  Date.now = original.now; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout;
  rmSync(dir, { recursive: true, force: true });
}
