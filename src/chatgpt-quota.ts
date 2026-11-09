/**
 * Opt-in shared Codex allowance, read through the installed official CLI.
 * Importing this module does nothing. Call only after a user's Refresh action.
 * No OAuth, token reads, inference, session creation, polling, or app-cap guesses.
 * Matching email does NOT verify the same workspace or an app-specific limit.
 */
export type ChatGPTQuotaFailure =
  | "missing-cli" | "account-mismatch" | "signed-out" | "no-limits"
  | "invalid-response" | "expired" | "cancelled" | "timeout" | "unavailable";

export interface ChatGPTQuotaWindow {
  kind: "primary" | "secondary";
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number;
  /** Unix timestamp in milliseconds. */
  resetsAt: number;
}
interface QuotaMetadata {
  source: "codex-app-server";
  /** Unix timestamp in milliseconds. */
  checkedAt: number;
  appCapAvailable: false;
}
export type ChatGPTSharedQuota = QuotaMetadata & (
  | { available: true; account: { email: string; planType?: string }; windows: ChatGPTQuotaWindow[] }
  | { available: false; reason: ChatGPTQuotaFailure; error: string }
);

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_LINE_BYTES = 128 * 1024;
const ERRORS: Record<ChatGPTQuotaFailure, string> = {
  "missing-cli": "An installed Codex CLI could not be found. Shared allowance is unavailable.",
  "account-mismatch": "Codex is signed in with a different email. Shared allowance was not read.",
  "signed-out": "A matching ChatGPT account must be signed in to both AI Assist and Codex.",
  "no-limits": "Codex did not return a shared allowance.",
  "invalid-response": "Codex returned an invalid shared allowance response.",
  "expired": "The returned allowance reset time has passed. Refresh to check again.",
  "cancelled": "Shared allowance check was cancelled.",
  "timeout": "The Codex shared allowance check timed out.",
  "unavailable": "The Codex shared allowance check is unavailable.",
};
function failure(reason: ChatGPTQuotaFailure): ChatGPTSharedQuota {
  return { available: false, source: "codex-app-server", appCapAvailable: false,
    checkedAt: Date.now(), reason, error: ERRORS[reason] };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function email(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 320) return;
  const normalized = value.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+$/.test(normalized)) return normalized;
}
interface Command { file: string; args: string[]; }

/**
 * Only known CLI filenames in absolute local PATH/standard npm directories.
 * Never invokes a shell, .cmd/.bat shim, downloaded executable, or current-dir
 * relative PATH entry. It inspects filenames only, never credential files.
 */
function discoverCLI(): Command | undefined {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const win = process.platform === "win32";
  const localAbsolute = (value: string) => path.isAbsolute(value) &&
    (!win || /^[a-z]:[\\/]/i.test(value));
  const isFile = (value: string) => {
    try { return fs.statSync(value).isFile(); } catch { return false; }
  };
  const environmentPath = process.env.PATH ?? process.env.Path ?? "";
  const directories = environmentPath.split(path.delimiter).slice(0, 128)
    .map(value => value.replace(/^"(.*)"$/, "$1")).filter(localAbsolute);
  // Resolve the official native package before considering a PATH executable.
  // Running codex.js would introduce a Node wrapper whose native child could
  // survive killing the wrapper on Windows.
  const packageRoots = directories.flatMap(directory => [
    path.join(directory, "node_modules", "@openai", "codex"),
    path.join(directory, "..", "lib", "node_modules", "@openai", "codex"),
  ]);
  if (win && process.env.APPDATA && localAbsolute(process.env.APPDATA)) {
    packageRoots.unshift(path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex"));
  }
  const architecture = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined;
  const platform = win ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" :
    process.platform === "linux" ? "unknown-linux-musl" : undefined;
  const binaryName = win ? "codex.exe" : "codex";
  const nativeFromPackage = (root: string): Command | undefined => {
    if (!architecture || !platform) return;
    const target = architecture + "-" + platform;
    const packageName = "codex-" + process.platform + "-" + process.arch;
    const vendorRoots = [
      path.join(root, "node_modules", "@openai", packageName, "vendor"),
      path.join(root, "..", packageName, "vendor"),
      path.join(root, "vendor"),
    ];
    for (const vendor of vendorRoots) {
      // Current CLI layout uses bin; older official releases used codex.
      for (const directory of ["bin", "codex"]) {
        const file = path.join(vendor, target, directory, binaryName);
        if (isFile(file)) return { file, args: ["app-server"] };
      }
    }
  };
  for (const root of packageRoots) {
    const native = nativeFromPackage(root);
    if (native) return native;
  }
  // Ignore current-directory/relative PATH entries and resolve npm symlinks to
  // their native package instead of invoking the JavaScript wrapper.
  for (const directory of directories) {
    const file = path.join(directory, binaryName);
    if (!isFile(file)) continue;
    let resolved: string;
    try { resolved = fs.realpathSync(file); } catch { continue; }
    if (path.basename(resolved) === "codex.js") {
      const native = nativeFromPackage(path.dirname(path.dirname(resolved)));
      if (native) return native;
      continue;
    }
    if (localAbsolute(resolved)) return { file: resolved, args: ["app-server"] };
  }
}

function quotaResult(value: unknown, account: { email: string; planType?: string }): ChatGPTSharedQuota {
  if (!record(value)) return failure("invalid-response");
  let snapshot: unknown;
  if (value.rateLimitsByLimitId !== undefined && value.rateLimitsByLimitId !== null) {
    if (!record(value.rateLimitsByLimitId)) return failure("invalid-response");
    snapshot = value.rateLimitsByLimitId.codex;
  }
  if (snapshot === undefined || snapshot === null) snapshot = value.rateLimits;
  if (snapshot === undefined || snapshot === null) return failure("no-limits");
  if (!record(snapshot)) return failure("invalid-response");
  // Other model-specific buckets must not be relabeled as the shared allowance.
  if (snapshot.limitId !== undefined && snapshot.limitId !== null && snapshot.limitId !== "codex") {
    return failure("no-limits");
  }
  const checkedAt = Date.now();
  const windows: ChatGPTQuotaWindow[] = [];
  for (const kind of ["primary", "secondary"] as const) {
    const window = snapshot[kind];
    if (window === undefined || window === null) continue;
    if (!record(window)) return failure("invalid-response");
    const { usedPercent, windowDurationMins, resetsAt } = window;
    if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) ||
        usedPercent < 0 || usedPercent > 100 ||
        typeof windowDurationMins !== "number" || !Number.isSafeInteger(windowDurationMins) ||
        windowDurationMins <= 0 ||
        typeof resetsAt !== "number" || !Number.isSafeInteger(resetsAt) ||
        resetsAt <= 0 || resetsAt > 8_640_000_000_000) return failure("invalid-response");
    const resetMilliseconds = resetsAt * 1000;
    // Never invent replenishment or continue displaying a stale used percentage.
    if (resetMilliseconds <= checkedAt) return failure("expired");
    windows.push({ kind, usedPercent, remainingPercent: 100 - usedPercent,
      windowDurationMins, resetsAt: resetMilliseconds });
  }
  if (!windows.length) return failure("no-limits");
  return { available: true, source: "codex-app-server", appCapAvailable: false,
    checkedAt, account, windows };
}

/** A single bounded read. All errors are static messages; no CLI output is logged. */
export async function readChatGPTSharedQuota(expectedEmail: string, signal?: AbortSignal): Promise<ChatGPTSharedQuota> {
  if (signal?.aborted) return failure("cancelled");
  const expected = email(expectedEmail);
  if (!expected) return failure("signed-out");
  let command: Command | undefined;
  let subprocess: typeof import("child_process");
  try {
    if (typeof process === "undefined") return failure("unavailable");
    command = discoverCLI();
    if (!command) return failure("missing-cli");
    subprocess = require("child_process");
  } catch { return failure("unavailable"); }
  if (signal?.aborted) return failure("cancelled");

  return new Promise(resolve => {
    let child: import("child_process").ChildProcessWithoutNullStreams | undefined;
    let done = false;
    let pendingId = 1;
    let bytes = 0;
    let buffer = "";
    let account: { email: string; planType?: string } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ChatGPTSharedQuota) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      buffer = "";
      // This process exists only for the three read-only requests below.
      // SIGKILL bounds lifetime even if EOF/normal shutdown would hang.
      try { child?.stdin.end(); } catch { /* Never surface process error text. */ }
      try { child?.kill("SIGKILL"); } catch { /* Already exited or not spawned. */ }
      resolve(result);
    };
    const abort = () => finish(failure("cancelled"));
    const send = (message: object) => {
      if (done) return;
      try { child!.stdin.write(JSON.stringify(message) + "\n"); }
      catch { finish(failure("unavailable")); }
    };
    const accept = (message: unknown) => {
      if (done) return;
      if (!record(message)) { finish(failure("invalid-response")); return; }
      // Ignore bounded server notifications, but never execute server requests.
      if (typeof message.method === "string") {
        if (message.id !== undefined) finish(failure("invalid-response"));
        return;
      }
      if (message.id !== pendingId) { finish(failure("invalid-response")); return; }
      if (message.error !== undefined) { finish(failure("unavailable")); return; }
      if (!Object.prototype.hasOwnProperty.call(message, "result")) {
        finish(failure("invalid-response")); return;
      }
      if (pendingId === 1) {
        if (!record(message.result)) { finish(failure("invalid-response")); return; }
        pendingId = 2;
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "account/read", params: { refreshToken: false } });
      } else if (pendingId === 2) {
        if (!record(message.result)) { finish(failure("invalid-response")); return; }
        const readAccount = message.result.account;
        if (readAccount === null || (record(readAccount) && readAccount.type !== "chatgpt")) {
          finish(failure("signed-out")); return;
        }
        if (!record(readAccount) || !email(readAccount.email)) {
          finish(failure("invalid-response")); return;
        }
        if (email(readAccount.email) !== expected) { finish(failure("account-mismatch")); return; }
        account = { email: expected };
        if (typeof readAccount.planType === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(readAccount.planType)) {
          account.planType = readAccount.planType;
        }
        pendingId = 3;
        send({ id: 3, method: "account/rateLimits/read", params: {} });
      } else {
        finish(quotaResult(message.result, account!));
      }
    };
    try {
      child = subprocess.spawn(command!.file, command!.args, {
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false,
        cwd: (require("os") as typeof import("os")).homedir(),
        env: process.env,
      });
      child.on("error", () => finish(failure("unavailable")));
      child.on("close", () => finish(failure("unavailable")));
      child.stdin.on("error", () => finish(failure("unavailable")));
      child.stdout.on("error", () => finish(failure("unavailable")));
      child.stderr.on("error", () => finish(failure("unavailable")));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (done) return;
        bytes += Buffer.byteLength(chunk, "utf8");
        if (bytes > MAX_OUTPUT_BYTES) { finish(failure("invalid-response")); return; }
        buffer += chunk;
        let newline: number;
        while (!done && (newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
            finish(failure("invalid-response")); return;
          }
          if (!line.trim()) continue;
          let message: unknown;
          try { message = JSON.parse(line); }
          catch { finish(failure("invalid-response")); return; }
          accept(message);
        }
        if (!done && Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) finish(failure("invalid-response"));
      });
      // Drain stderr without retaining, interpreting, or displaying its contents.
      child.stderr.on("data", (chunk: Buffer) => {
        if (done) return;
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) finish(failure("invalid-response"));
      });
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => finish(failure("timeout")), TIMEOUT_MS);
      if (signal?.aborted) { abort(); return; }
      send({ id: 1, method: "initialize", params: {
        clientInfo: { name: "ru_ai_assist_quota", title: "RU AI Assist shared allowance", version: "1.1.0" },
      } });
    } catch { finish(failure("unavailable")); }
  });
}
