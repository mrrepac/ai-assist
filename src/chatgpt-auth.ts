/**
 * Local, opt-in Sign in with ChatGPT for the subscription provider.
 * No tokens enter Obsidian settings, browser storage, logs or the synced vault.
 * Docs: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 *       https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
 *
 * Importing this module does nothing. connectChatGPT must only be called from
 * an explicit user sign-in action; the system browser owns OpenAI consent.
 */
import type { JsonWebKey } from "crypto";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE = ISSUER + "/api/accounts/authorize";
const TOKEN = ISSUER + "/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const DIRECT = "chatgpt.tokens.use.direct";
function hasPlanPermission(tokens?: Tokens): boolean {
  return !!tokens?.scopes.includes(DIRECT) && tokens.scopes.includes("resource.invoke");
}
const NEW_CLIENT = "dynamic_agent_client";
const CALLBACK = "/auth/callback";
const LOGIN_TIMEOUT = 5 * 60_000;

interface SafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface Desktop {
  safe: SafeStorage;
  directory: string;
  openExternal(url: string): Promise<void>;
}
interface Tokens {
  access: string;
  refresh: string;
  id: string;
  expiresAt: number;
  earliestRefreshAt?: number;
  scopes: string[];
}
interface Registration {
  clientId: string;
  subject?: string;
  email?: string;
  tokens?: Tokens;
  pendingRefresh?: { tokens: Tokens; verifyIdentity: boolean };
}
interface Store {
  version: 1;
  hostId: string;
  active?: string;
  registrations: Registration[];
}
export interface ChatGPTAccount {
  id: string;
  label: string;
  email?: string;
  connected: boolean;
}
export interface ChatGPTStatus {
  available: boolean;
  connected: boolean;
  planUsageEnabled: boolean;
  email?: string;
  activeAccountId?: string;
  verificationPending?: boolean;
  accounts: ChatGPTAccount[];
  error?: string;
}
interface Discovery { issuer: string; jwks_uri: string; revocation_endpoint?: string; }
interface WireTokens {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  earliest_refresh_at?: unknown;
  scope?: unknown;
}
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; key_ops?: string[] };
interface Identity { subject: string; email?: string; }

let pendingCancel: (() => void) | undefined;
let revision = 0;
let discoveryPromise: Promise<Discovery> | undefined;

/** Resolve Electron only at the user's request. Never fall back to plaintext. */
function desktop(): Desktop {
  if (typeof process === "undefined" || !process.versions?.electron) {
    throw new Error("ChatGPT sign-in is available only in Obsidian Desktop.");
  }
  const electron = require("electron");
  let remote = electron.remote;
  if (!remote && (!electron.safeStorage || !electron.app)) {
    try { const optionalRemote = "@electron/remote"; remote = require(optionalRemote); } catch { /* fail closed below */ }
  }
  const safe: SafeStorage | undefined = electron.safeStorage ?? remote?.safeStorage;
  const app = electron.app ?? remote?.app;
  if (!safe?.isEncryptionAvailable() || safe.getSelectedStorageBackend?.() === "basic_text" || !app?.getPath) {
    throw new Error("Protected operating-system credential storage is unavailable. ChatGPT sign-in is disabled; no plaintext credentials will be saved.");
  }
  const path = require("path") as typeof import("path");
  const userData: string = app.getPath("userData");
  if (!path.isAbsolute(userData)) throw new Error("Cannot locate protected application storage.");
  return {
    safe,
    directory: path.join(userData, "ru-ai-assist-chatgpt"),
    openExternal: async (url: string) => { await (electron.shell ?? remote?.shell).openExternal(url); },
  };
}
function filename(d: Desktop): string {
  return (require("path") as typeof import("path")).join(d.directory, "accounts.enc");
}
function emptyStore(): Store { return { version: 1, hostId: "", registrations: [] }; }
function readStore(d: Desktop): Store {
  const fs = require("fs") as typeof import("fs");
  if (!fs.existsSync(filename(d))) return emptyStore();
  let value: Store;
  try {
    const bytes = fs.readFileSync(filename(d));
    if (bytes.length > 4_000_000) throw new Error();
    value = JSON.parse(d.safe.decryptString(bytes));
  } catch { throw new Error("Could not open protected ChatGPT credentials. They were not overwritten."); }
  if (value?.version !== 1 || typeof value.hostId !== "string" || !Array.isArray(value.registrations) ||
      value.registrations.some(r => typeof r.clientId !== "string" || !r.clientId || r.clientId === NEW_CLIENT)) {
    throw new Error("Protected ChatGPT account data is invalid. It was not overwritten.");
  }
  return value;
}
function writeStore(d: Desktop, value: Store): void {
  const fs = require("fs") as typeof import("fs");
  const crypto = require("crypto") as typeof import("crypto");
  fs.mkdirSync(d.directory, { recursive: true, mode: 0o700 });
  const target = filename(d);
  const temporary = target + "." + crypto.randomBytes(12).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(temporary, d.safe.encryptString(JSON.stringify(value)), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/**
 * One lock covers read + mutation + atomic replace, including refresh.
 * Separate Obsidian windows cannot race rotating refresh tokens.
 * A lock left by a crashed process is removed only if its process is gone.
 */
async function locked<T>(d: Desktop, run: () => Promise<T>): Promise<T> {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const crypto = require("crypto") as typeof import("crypto");
  fs.mkdirSync(d.directory, { recursive: true, mode: 0o700 });
  const lock = path.join(d.directory, "session.lock");
  const owner = { pid: process.pid, nonce: crypto.randomBytes(16).toString("hex") };
  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("Could not lock protected ChatGPT storage.");
      try {
        const raw = fs.readFileSync(lock, "utf8");
        const previous = JSON.parse(raw);
        if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error();
        try { process.kill(previous.pid, 0); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH" && fs.readFileSync(lock, "utf8") === raw) {
            fs.unlinkSync(lock);
            continue;
          }
        }
      } catch { /* unknown lock owner is not permission to remove it */ }
      throw new Error("Another Obsidian window is changing this ChatGPT connection. Finish or cancel that operation, then retry.");
    }
  }
  if (!acquired) throw new Error("Could not lock protected ChatGPT storage.");
  try { return await run(); }
  finally {
    try {
      const current = JSON.parse(fs.readFileSync(lock, "utf8"));
      if (current.nonce === owner.nonce) fs.unlinkSync(lock);
    } catch { /* do not remove another owner's lock */ }
  }
}

/** Never follow redirects or send auth data to an endpoint supplied by a token. */
function authUrl(value: string): URL {
  const url = new URL(value);
  if (url.origin !== ISSUER || url.username || url.password || url.hash) throw new Error("Unexpected OpenAI authentication endpoint.");
  return url;
}
class AuthHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    // Do not echo response bodies: they can contain account or token details.
    super("OpenAI sign-in request failed (" + status + (code ? ", " + code : "") + ").");
  }
}
async function request(urlString: string, form?: URLSearchParams): Promise<unknown> {
  const url = authUrl(urlString);
  const https = require("https") as typeof import("https");
  const body = form?.toString();
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? { Accept: "application/json" } : {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let bytes = 0;
      const parts: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { req.destroy(); reject(new Error("OpenAI sign-in response exceeded its size limit.")); return; }
        parts.push(chunk);
      });
      res.on("error", () => reject(new Error("OpenAI sign-in response was interrupted.")));
      res.on("end", () => {
        let json: unknown = {};
        const text = Buffer.concat(parts).toString("utf8");
        try { if (text) json = JSON.parse(text); }
        catch { reject(new Error("OpenAI sign-in returned an invalid response.")); return; }
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          const error = (json as { error?: unknown })?.error;
          const code = typeof error === "string" && /^[a-z0-9_]{1,80}$/.test(error) ? error : "";
          reject(new AuthHttpError(res.statusCode ?? 0, code));
        } else resolve(json);
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new Error("Cannot reach OpenAI sign-in. Your saved connection was not changed.")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
async function discovery(): Promise<Discovery> {
  if (!discoveryPromise) {
    discoveryPromise = (async () => {
      const data = await request(ISSUER + "/.well-known/openid-configuration") as Discovery;
      if (data?.issuer !== ISSUER || typeof data.jwks_uri !== "string") throw new Error("Invalid OpenAI identity configuration.");
      authUrl(data.jwks_uri);
      if (data.revocation_endpoint) authUrl(data.revocation_endpoint);
      return data;
    })().catch(e => { discoveryPromise = undefined; throw e; });
  }
  return discoveryPromise;
}

/** Pure verifier, exported for adversarial tests with synthetic keys/tokens. */
export function verifyChatGPTIdentity(
  token: string, keys: Jwk[], clientId: string, nonce?: string, subject?: string, now = Date.now(),
): Identity {
  const crypto = require("crypto") as typeof import("crypto");
  const fail = () => { throw new Error("OpenAI identity verification failed; the connection was not activated."); };
  if (typeof token !== "string" || token.length > 100_000) return fail();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(p => !p || !/^[A-Za-z0-9_-]+$/.test(p))) return fail();
  let header: { alg?: string; kid?: string; crit?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { return fail(); }
  if (!header || !claims || !["RS256", "ES256"].includes(header.alg ?? "") || typeof header.kid !== "string" || header.crit) return fail();
  const matches = keys.filter(k => k.kid === header.kid && (!k.use || k.use === "sig") &&
    (!k.alg || k.alg === header.alg) && (!k.key_ops || k.key_ops.includes("verify")) &&
    (header.alg === "RS256" ? k.kty === "RSA" : k.kty === "EC" && k.crv === "P-256"));
  if (matches.length !== 1) return fail();
  try {
    const key = crypto.createPublicKey({ key: matches[0], format: "jwk" });
    const valid = crypto.verify("sha256", Buffer.from(parts[0] + "." + parts[1]),
      header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key, Buffer.from(parts[2], "base64url"));
    if (!valid) return fail();
  } catch { return fail(); }
  const seconds = now / 1000;
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (claims.iss !== ISSUER || !Array.isArray(audiences) || !audiences.includes(clientId) ||
      (audiences.length > 1 && claims.azp !== clientId) ||
      (claims.azp !== undefined && claims.azp !== clientId) ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= seconds ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > seconds + 60)) ||
      (claims.iat !== undefined && (typeof claims.iat !== "number" || claims.iat > seconds + 60)) ||
      (nonce !== undefined && claims.nonce !== nonce) ||
      typeof claims.sub !== "string" || !claims.sub ||
      (subject !== undefined && claims.sub !== subject)) return fail();
  return { subject: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
}
async function identity(token: string, clientId: string, nonce?: string, subject?: string): Promise<Identity> {
  const config = await discovery();
  const jwks = await request(config.jwks_uri) as { keys?: Jwk[] };
  if (!Array.isArray(jwks.keys)) throw new Error("OpenAI identity keys are unavailable.");
  return verifyChatGPTIdentity(token, jwks.keys, clientId, nonce, subject);
}
function tokenSet(raw: WireTokens, previous?: Tokens): Tokens {
  if (typeof raw.access_token !== "string" || !raw.access_token ||
      typeof raw.refresh_token !== "string" || !raw.refresh_token ||
      typeof raw.token_type !== "string" || raw.token_type.toLowerCase() !== "bearer" ||
      typeof raw.expires_in !== "number" || !Number.isFinite(raw.expires_in) || raw.expires_in <= 0 || raw.expires_in > 86_400) {
    throw new Error("OpenAI returned an incomplete credential set. The connection was not activated.");
  }
  const scopes = typeof raw.scope === "string" ? raw.scope.split(/\s+/).filter(Boolean) : previous?.scopes;
  const id = typeof raw.id_token === "string" ? raw.id_token : previous?.id;
  if (!scopes || !id) throw new Error("OpenAI did not return the required identity and permissions.");
  return {
    access: raw.access_token, refresh: raw.refresh_token, id,
    scopes, expiresAt: Date.now() + raw.expires_in * 1000,
    earliestRefreshAt: typeof raw.earliest_refresh_at === "number" ? raw.earliest_refresh_at * 1000 : undefined,
  };
}
function status(store: Store): ChatGPTStatus {
  const active = store.registrations.find(r => r.clientId === store.active);
  return {
    available: true, connected: !!active?.tokens,
    planUsageEnabled: !active?.pendingRefresh && hasPlanPermission(active?.tokens),
    verificationPending: !!active?.pendingRefresh,
    email: active?.email, activeAccountId: active?.clientId,
    accounts: store.registrations.map((r, i) => ({
      id: r.clientId, label: (r.email || "ChatGPT") + " · " + (i + 1),
      email: r.email, connected: !!r.tokens,
    })),
  };
}
export async function chatGPTStatus(): Promise<ChatGPTStatus> {
  try { const d = desktop(); return status(readStore(d)); }
  catch (error) {
    return { available: false, connected: false, planUsageEnabled: false, accounts: [], error: (error as Error).message };
  }
}
export function cancelChatGPTLogin(): void {
  revision++;
  pendingCancel?.();
}
function constantEqual(a: string, b: string): boolean {
  const crypto = require("crypto") as typeof import("crypto");
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

/** Call only after the user explicitly chooses Continue with ChatGPT. */
export async function connectChatGPT(accountId?: string): Promise<ChatGPTStatus> {
  if (pendingCancel) throw new Error("A ChatGPT sign-in is already in progress.");
  const d = desktop();
  const currentRevision = ++revision;
  return locked(d, async () => {
    const store = readStore(d);
    const crypto = require("crypto") as typeof import("crypto");
    const http = require("http") as typeof import("http");
    const selected = accountId === undefined ? undefined : store.registrations.find(r => r.clientId === accountId);
    if (accountId !== undefined && !selected) throw new Error("The selected ChatGPT account no longer exists.");
    if (!store.hostId) store.hostId = "urn:uuid:" + crypto.randomUUID();
    writeStore(d, store);
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    let redirect = "";
    let consumed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finish: (error?: Error, value?: ChatGPTStatus) => void = () => {};
    const server = http.createServer();
    const sockets = new Set<import("net").Socket>();
    server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    const completed = new Promise<ChatGPTStatus>((resolve, reject) => {
      finish = (error, result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        pendingCancel = undefined;
        server.close();
        for (const socket of sockets) socket.destroy();
        if (error) reject(error); else resolve(result!);
      };
    });
    // Attach rejection handling before opening the browser or waiting on listen.
    completed.catch(() => {});
    server.on("error", () => finish(new Error("The local ChatGPT sign-in callback failed.")));
    pendingCancel = () => finish(new Error("ChatGPT sign-in cancelled locally. Any access already approved may remain in ChatGPT Settings; remote revocation was not confirmed."));
    timer = setTimeout(() => finish(new Error("ChatGPT sign-in timed out locally. Any access already approved may remain in ChatGPT Settings; remote revocation was not confirmed.")), LOGIN_TIMEOUT);
    server.on("request", (req, res) => {
      const send = (code: number, text: string) => {
        res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'", Connection: "close" });
        res.end(text);
      };
      if (settled) { send(410, "This local sign-in has ended. Return to Obsidian."); return; }
      let callback: URL;
      try { callback = new URL(req.url ?? "", redirect); } catch { send(400, "Invalid callback."); return; }
      if (req.method !== "GET" || callback.pathname !== CALLBACK || callback.origin !== new URL(redirect).origin || req.headers.host !== new URL(redirect).host ||
          req.headers.origin || (req.url?.length ?? 0) > 16384) { send(400, "Invalid callback."); return; }
      if (callback.searchParams.getAll("state").length !== 1 || !constantEqual(callback.searchParams.get("state") ?? "", state)) {
        send(400, "The sign-in state did not match. Return to Obsidian."); return;
      }
      if (consumed) { send(409, "This sign-in callback has already been used."); return; }
      consumed = true;
      const oauthError = callback.searchParams.get("error");
      if (oauthError) {
        send(400, "Sign-in was not approved. Return to Obsidian.");
        setTimeout(() => finish(new Error("ChatGPT sign-in was declined or could not be completed.")), 20);
        return;
      }
      const code = callback.searchParams.get("code");
      const issued = callback.searchParams.get("client_id");
      const clientId = issued || selected?.clientId;
      if (!code || callback.searchParams.getAll("code").length !== 1 || callback.searchParams.getAll("client_id").length > 1 ||
          !clientId || clientId === NEW_CLIENT || (selected && clientId !== selected.clientId)) {
        send(400, "Incomplete or mismatched sign-in registration.");
        setTimeout(() => finish(new Error("OpenAI returned an incomplete or mismatched client registration.")), 20);
        return;
      }
      send(200, "You can return to Obsidian. It is verifying the ChatGPT connection.");
      void (async () => {
        // Retain issued registration even if exchanging this single-use code fails.
        let registration = selected ?? store.registrations.find(r => r.clientId === clientId);
        if (!registration) { registration = { clientId }; store.registrations.push(registration); }
        if (settled || currentRevision !== revision) throw new Error("ChatGPT sign-in cancelled locally. Any access already approved may remain in ChatGPT Settings; remote revocation was not confirmed.");
        writeStore(d, store);
        const raw = await request(TOKEN, new URLSearchParams({
          grant_type: "authorization_code", client_id: clientId, code,
          code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE,
        })) as WireTokens;
        const tokens = tokenSet(raw);
        const verified = await identity(tokens.id, clientId, nonce, selected?.subject);
        if (settled || currentRevision !== revision) throw new Error("ChatGPT sign-in cancelled locally. Any access already approved may remain in ChatGPT Settings; remote revocation was not confirmed.");
        registration.subject = verified.subject;
        registration.email = verified.email;
        registration.tokens = tokens;
        registration.pendingRefresh = undefined;
        store.active = clientId;
        writeStore(d, store);
        finish(undefined, status(store));
      })().catch(error => finish(error instanceof Error ? error : new Error("ChatGPT sign-in failed.")));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start local ChatGPT sign-in callback.");
      redirect = "http://127.0.0.1:" + address.port + CALLBACK;
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({
        client_id: selected?.clientId ?? NEW_CLIENT, ext_agent_host_id: store.hostId,
        response_type: "code", redirect_uri: redirect, scope: SCOPE, resource: RESOURCE,
        state, nonce, code_challenge_method: "S256", code_challenge: challenge,
      }).toString();
      if (!selected) url.searchParams.set("agent_name_hint", "RU AI Assist");
      if (selected?.tokens?.id) url.searchParams.set("id_token_hint", selected.tokens.id);
      if (selected?.email) url.searchParams.set("login_hint", selected.email);
      // Explicit reconnect may restore a previously declined plan-usage grant.
      if (selected && !hasPlanPermission(selected.tokens)) url.searchParams.set("prompt", "consent");
      if (settled || currentRevision !== revision) throw new Error("ChatGPT sign-in cancelled locally. Any access already approved may remain in ChatGPT Settings; remote revocation was not confirmed.");
      await d.openExternal(url.toString());
    } catch (error) { finish(error instanceof Error ? error : new Error("Could not open ChatGPT sign-in.")); }
    return completed;
  });
}
export async function selectChatGPTAccount(accountId: string): Promise<ChatGPTStatus> {
  const d = desktop();
  return locked(d, async () => {
    const store = readStore(d);
    const selected = store.registrations.find(r => r.clientId === accountId);
    if (!selected?.subject || !selected.tokens) throw new Error("Continue with this ChatGPT account to sign in again.");
    store.active = accountId;
    writeStore(d, store);
    return status(store);
  });
}

/** Commit a rotated refresh token only after its new identity is verified.
 * The encrypted pending record survives transient JWKS failures and restart.
 * It is never an inference credential until validation succeeds.
 */
async function validatePending(d: Desktop, store: Store, account: Registration): Promise<void> {
  const pending = account.pendingRefresh;
  if (!pending) return;
  if (pending.verifyIdentity) {
    try { await identity(pending.tokens.id, account.clientId, undefined, account.subject); }
    catch {
      throw new Error("ChatGPT renewed access, but identity verification is still pending. No request was sent. Retry later or reconnect in settings.");
    }
  }
  account.tokens = pending.tokens;
  account.pendingRefresh = undefined;
  writeStore(d, store);
}

/** Returns credentials only to the transport, never to settings/UI. */
export async function chatGPTAccessToken(): Promise<string> {
  const d = desktop();
  return locked(d, async () => {
    const store = readStore(d);
    const account = store.registrations.find(r => r.clientId === store.active);
    if (!account?.tokens || !account.subject) throw new Error("Connect ChatGPT in RU AI Assist settings first.");
    await validatePending(d, store, account);
    if (!hasPlanPermission(account.tokens)) throw new Error("ChatGPT plan usage was not authorized. Enable it with Continue with ChatGPT in settings.");
    if (account.tokens!.expiresAt > Date.now() + 60_000) return account.tokens!.access;
    if (account.tokens!.earliestRefreshAt && account.tokens!.earliestRefreshAt > Date.now()) {
      if (account.tokens!.expiresAt > Date.now() + 5000) return account.tokens!.access;
      throw new Error("ChatGPT access cannot be renewed yet. Retry shortly.");
    }
    let raw: WireTokens;
    try {
      raw = await request(TOKEN, new URLSearchParams({
        grant_type: "refresh_token", client_id: account.clientId,
        refresh_token: account.tokens!.refresh, resource: RESOURCE,
      })) as WireTokens;
    } catch (error) {
      if (error instanceof AuthHttpError && ["invalid_grant", "invalid_refresh_token", "token_expired",
        "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(error.code)) {
        account.tokens = undefined;
        account.pendingRefresh = undefined;
        writeStore(d, store);
        throw new Error("The ChatGPT connection expired or was revoked. Continue with ChatGPT in settings to reconnect.");
      }
      throw error;
    }
    // Rotation already happened remotely. Save the replacement before fetching
    // JWKS so a temporary validation/network error never replays the old token.
    account.pendingRefresh = {
      tokens: tokenSet(raw, account.tokens),
      verifyIdentity: typeof raw.id_token === "string",
    };
    writeStore(d, store);
    await validatePending(d, store, account);
    if (!hasPlanPermission(account.tokens)) throw new Error("ChatGPT plan usage is no longer authorized. Reconnect in settings.");
    return account.tokens!.access;
  });
}

export async function disconnectChatGPT(): Promise<{ revoked: boolean }> {
  cancelChatGPTLogin();
  const d = desktop();
  return locked(d, async () => {
    const store = readStore(d);
    const account = store.registrations.find(r => r.clientId === store.active);
    if (!account?.tokens) return { revoked: true };
    let revoked = false;
    try {
      const endpoint = (await discovery()).revocation_endpoint;
      if (endpoint) {
        await request(endpoint, new URLSearchParams({
          token: (account.pendingRefresh?.tokens ?? account.tokens).refresh, token_type_hint: "refresh_token", client_id: account.clientId,
        }));
        revoked = true;
      }
    } catch { /* local sign-out must still complete; caller reports unconfirmed revocation */ }
    account.tokens = undefined;
    account.pendingRefresh = undefined;
    writeStore(d, store);
    return { revoked };
  });
}
