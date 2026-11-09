// Fully offline: no real CLI, auth, network, credentials, or filesystem mutations.
// Run from any working directory: node /absolute/path/tools/test-chatgpt-quota.mjs
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runInNewContext } from "node:vm";
import esbuild from "esbuild";

const built = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/chatgpt-quota.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "error",
});
const source = built.outputFiles[0].text;
const NOW = 1_800_000_000_000;
const EMAIL = "synthetic@example.invalid";
const SECRET = "NEVER_EXPOSE_SYNTHETIC_CLI_BODY";
const root = process.platform === "win32" ? "C:\\synthetic\\bin" : "/synthetic/bin";
const appData = process.platform === "win32" ? "C:\\synthetic\\appdata" : "/synthetic/appdata";
const binary = path.join(root, process.platform === "win32" ? "codex.exe" : "codex");
const npmRoot = process.platform === "win32"
  ? path.join(appData, "npm", "node_modules", "@openai", "codex")
  : path.join(root, "node_modules", "@openai", "codex");
const target = (process.arch === "arm64" ? "aarch64" : "x86_64") + "-" +
  (process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-musl");
const npmBinary = path.join(npmRoot, "node_modules", "@openai", "codex-" + process.platform + "-" + process.arch,
  "vendor", target, "bin", process.platform === "win32" ? "codex.exe" : "codex");
const syntheticHome = process.platform === "win32" ? "C:\\synthetic\\home" : "/synthetic/home";
const executable = path.join(root, process.platform === "win32" ? "node.exe" : "node");
const account = { type: "chatgpt", email: EMAIL, planType: "prolite" };
const window = { usedPercent: 22, windowDurationMins: 10080, resetsAt: NOW / 1000 + 86400 };
const quota = { rateLimits: { limitId: "codex", primary: window, secondary: null, planType: "prolite" } };
let checks = 0;

function setup(options = {}) {
  const requests = [];
  const spawns = [];
  const files = [];
  const logs = [];
  const timers = new Map();
  let nextTimer = 0;
  let child;
  const fakeProcess = {
    platform: process.platform, arch: process.arch, execPath: executable,
    versions: options.electron ? { electron: "synthetic" } : {},
    env: { PATH: options.path ?? root, ...(options.noAppData ? {} : { APPDATA: appData }) },
  };
  const fakeFS = {
    realpathSync(file) { return options.symlink ? path.join(npmRoot, "bin", "codex.js") : file; },
    statSync(file) {
      files.push(file);
      if (options.cli !== "missing" && file === (options.cli === "npm" ? npmBinary : binary)) {
        return { isFile: () => true };
      }
      throw new Error(SECRET);
    },
  };
  function deliver(message) {
    const raw = JSON.stringify(message) + "\n";
    if (options.fragmented) {
      for (let i = 0; i < raw.length; i += 7) child.stdout.emit("data", raw.slice(i, i + 7));
    } else child.stdout.emit("data", raw);
  }
  const fakeSubprocess = {
    spawn(file, args, config) {
      spawns.push({ file, args, config });
      if (options.throwSpawn) throw new Error(SECRET);
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdout.setEncoding = encoding => { assert.equal(encoding, "utf8"); return child.stdout; };
      child.kills = [];
      child.ends = 0;
      child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit("close", 0)); return true; };
      child.stdin.end = () => { child.ends++; };
      child.stdin.write = payload => {
        const request = JSON.parse(payload);
        requests.push(request);
        queueMicrotask(() => {
          if (request.method === "initialized") return;
          if (options.onRequest?.(request, child) === false) return;
          if (options.hold) return;
          if (options.special && request.id === 1) {
            options.special({ child, deliver, request });
            return;
          }
          if (request.id === 1) deliver({ id: 1, result: { userAgent: "synthetic" } });
          else if (request.id === 2) deliver({ id: 2, result: {
            account: Object.prototype.hasOwnProperty.call(options, "account") ? options.account : account,
          } });
          else if (request.id === 3) deliver({ id: 3, result:
            Object.prototype.hasOwnProperty.call(options, "quota") ? options.quota : quota });
          else throw new Error("Unexpected outbound RPC");
        });
        return true;
      };
      return child;
    },
  };
  const module = { exports: {} };
  runInNewContext(source, {
    module, exports: module.exports, Buffer, process: fakeProcess,
    Date: class extends Date { static now() { return NOW; } },
    console: Object.fromEntries(["log", "warn", "error", "info", "debug"].map(key => [key, (...args) => logs.push(args)])),
    setTimeout(callback, milliseconds) {
      assert.equal(milliseconds, 20_000);
      const id = ++nextTimer;
      timers.set(id, callback);
      if (options.timeout) queueMicrotask(() => { if (timers.has(id)) callback(); });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === "fs") return fakeFS;
      if (name === "path") return path;
      if (name === "os") return { homedir: () => syntheticHome };
      if (name === "child_process") return fakeSubprocess;
      throw new Error("Unexpected module: " + name);
    },
  });
  return {
    async read(expected = EMAIL, signal) {
      let guard;
      try {
        const result = await Promise.race([
          module.exports.readChatGPTSharedQuota(expected, signal),
          new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("Mock check did not settle")), 1000); }),
        ]);
        await Promise.resolve();
        const safeResult = JSON.parse(JSON.stringify(result));
        assert.equal(safeResult.source, "codex-app-server");
        assert.equal(safeResult.appCapAvailable, false);
        assert.equal(safeResult.checkedAt, NOW);
        assert.equal(JSON.stringify(safeResult).includes(SECRET), false);
        assert.equal(logs.length, 0, "CLI content must never be logged");
        assert.equal(timers.size, 0, "Timeout must be cleared");
        if (child) {
          assert.equal(child.ends, 1);
          assert.deepEqual(child.kills, ["SIGKILL"]);
        }
        assert.ok(files.every(file => !/auth|token|credentials/i.test(file)));
        return safeResult;
      } finally { clearTimeout(guard); }
    },
    requests, spawns, files, get child() { return child; },
  };
}
async function fails(reason, options, expected = EMAIL, signal) {
  const run = setup(options);
  const result = await run.read(expected, signal);
  assert.equal(result.available, false);
  assert.equal(result.reason, reason);
  assert.equal(typeof result.error, "string");
  assert.equal("account" in result, false);
  assert.equal("windows" in result, false);
  checks++;
  return run;
}

const happy = setup();
const result = await happy.read();
assert.equal(result.available, true);
assert.deepEqual(result.account, { email: EMAIL, planType: "prolite" });
assert.deepEqual(result.windows, [{ kind: "primary", usedPercent: 22, remainingPercent: 78,
  windowDurationMins: 10080, resetsAt: window.resetsAt * 1000 }]);
assert.deepEqual(happy.requests.map(request => request.method),
  ["initialize", "initialized", "account/read", "account/rateLimits/read"]);
assert.deepEqual(happy.requests[2].params, { refreshToken: false });
assert.deepEqual(happy.requests[3].params, {});
assert.equal(happy.spawns.length, 1);
assert.equal(happy.spawns[0].file, binary);
assert.deepEqual(Array.from(happy.spawns[0].args), ["app-server"]);
assert.equal(happy.spawns[0].config.shell, false);
assert.equal(happy.spawns[0].config.windowsHide, true);
assert.equal(happy.spawns[0].config.cwd, syntheticHome);
assert.deepEqual(Array.from(happy.spawns[0].config.stdio), ["pipe", "pipe", "pipe"]);
checks++;

const two = await setup({ quota: { rateLimits: {
  primary: { ...window, usedPercent: 0, windowDurationMins: 300 },
  secondary: { ...window, usedPercent: 100 },
} } }).read();
assert.deepEqual(two.windows.map(item => item.remainingPercent), [100, 0]); checks++;

const same = await setup({ account: { ...account, email: " SYNTHETIC@EXAMPLE.INVALID " } }).read(" Synthetic@example.invalid ");
assert.equal(same.available, true); checks++;
const mismatch = await fails("account-mismatch", { account: { ...account, email: "other@example.invalid" } });
assert.equal(mismatch.requests.some(item => item.method === "account/rateLimits/read"), false);
const invalidExpected = await fails("signed-out", {}, "");
assert.equal(invalidExpected.spawns.length, 0);
assert.equal(invalidExpected.files.length, 0);
await fails("signed-out", { account: null });
await fails("signed-out", { account: { type: "apiKey" } });
await fails("invalid-response", { account: { type: "chatgpt" } });
await fails("invalid-response", { account: [] });
await fails("invalid-response", { quota: null });
await fails("invalid-response", { quota: "unexpected" });
await fails("no-limits", { quota: {} });
await fails("no-limits", { quota: { rateLimits: { primary: null, secondary: null } } });
await fails("no-limits", { quota: { rateLimits: { ...quota.rateLimits, limitId: "another-model" } } });
await fails("invalid-response", { quota: { rateLimitsByLimitId: [] } });
await fails("invalid-response", { quota: { rateLimits: [] } });

const grouped = await setup({ quota: { rateLimits: { limitId: "another-model" },
  rateLimitsByLimitId: { codex: { ...quota.rateLimits, primary: { ...window, usedPercent: 12.5 } } } } }).read();
assert.equal(grouped.windows[0].remainingPercent, 87.5); checks++;

for (const patch of [
  { usedPercent: -1 }, { usedPercent: 101 }, { usedPercent: "22" }, { usedPercent: null },
  { usedPercent: Infinity }, { usedPercent: NaN }, { windowDurationMins: 0 },
  { windowDurationMins: -1 }, { windowDurationMins: 1.5 }, { windowDurationMins: "300" },
  { resetsAt: 0 }, { resetsAt: -1 }, { resetsAt: "1900000000" }, { resetsAt: null },
  { resetsAt: NOW / 1000 + 0.5 }, { resetsAt: 8_640_000_000_001 },
]) await fails("invalid-response", { quota: { rateLimits: { primary: { ...window, ...patch } } } });
await fails("invalid-response", { quota: { rateLimits: { primary: false } } });
await fails("expired", { quota: { rateLimits: { primary: { ...window, resetsAt: NOW / 1000 } } } });
await fails("expired", { quota: { rateLimits: { primary: window,
  secondary: { ...window, resetsAt: NOW / 1000 - 1 } } } });

await fails("invalid-response", { special: ({ child }) => child.stdout.emit("data", SECRET + "\n") });
await fails("unavailable", { special: ({ deliver }) => deliver({ id: 1, error: { code: SECRET, message: SECRET } }) });
await fails("invalid-response", { special: ({ deliver }) => deliver({ id: 99, result: {} }) });
await fails("invalid-response", { special: ({ deliver }) => deliver({ id: 1 }) });
await fails("invalid-response", { special: ({ deliver }) => deliver({ id: 1, result: null }) });
await fails("invalid-response", { special: ({ deliver }) => deliver({ id: 44, method: "account/login/start", params: {} }) });
await fails("invalid-response", { special: ({ deliver }) => deliver(null) });
await fails("invalid-response", { special: ({ child }) => child.stdout.emit("data", "x".repeat(128 * 1024 + 1)) });
await fails("invalid-response", { special: ({ child }) => child.stdout.emit("data", "x".repeat(128 * 1024 + 1) + "\n") });
await fails("invalid-response", { special: ({ child }) => child.stdout.emit("data", "\n".repeat(512 * 1024 + 1)) });
await fails("invalid-response", { special: ({ child }) => child.stderr.emit("data", Buffer.alloc(512 * 1024 + 1)) });

const notifications = await setup({ special: ({ child, deliver }) => {
  child.stderr.emit("data", Buffer.from(SECRET));
  deliver({ method: "account/rateLimits/updated", params: { ignored: SECRET } });
  deliver({ id: 1, result: {} });
} }).read();
assert.equal(notifications.available, true); checks++;
assert.equal((await setup({ fragmented: true }).read()).available, true); checks++;
for (const stream of ["child", "stdin", "stdout", "stderr"]) {
  await fails("unavailable", { special: ({ child }) => (stream === "child" ? child : child[stream]).emit("error", new Error(SECRET)) });
}
await fails("unavailable", { special: ({ child }) => child.emit("close", 1) });
await fails("unavailable", { throwSpawn: true });
await fails("timeout", { timeout: true, hold: true });

const cancelled = new AbortController();
cancelled.abort();
const preAbort = await fails("cancelled", {}, EMAIL, cancelled.signal);
assert.equal(preAbort.files.length, 0);
assert.equal(preAbort.spawns.length, 0);
const during = new AbortController();
const midAbort = await fails("cancelled", { onRequest(request) {
  if (request.id === 2) { during.abort(); return false; }
} }, EMAIL, during.signal);
assert.equal(midAbort.requests.some(item => item.method === "account/rateLimits/read"), false);
const after = new AbortController();
await fails("cancelled", { onRequest(request) {
  if (request.id === 3) { after.abort(); return false; }
} }, EMAIL, after.signal);
const missing = await fails("missing-cli", { cli: "missing" });
assert.equal(missing.spawns.length, 0);
const relative = await fails("missing-cli", { path: "." + path.delimiter, noAppData: true });
assert.equal(relative.files.length, 0);

const node = setup({ cli: "npm", electron: true });
assert.equal((await node.read()).available, true);
assert.equal(node.spawns[0].file, npmBinary);
assert.deepEqual(Array.from(node.spawns[0].args), ["app-server"]);
assert.equal(node.spawns[0].config.env.ELECTRON_RUN_AS_NODE, undefined); checks++;
// A JavaScript wrapper without a discoverable native binary is not executed.
await fails("missing-cli", { symlink: true });

// All observed protocol requests are read-only; no inference or token calls.
assert.ok(happy.requests.every(request => ["initialize", "initialized", "account/read", "account/rateLimits/read"].includes(request.method)));
console.log("ChatGPT shared quota: " + checks + " offline checks passed.");
