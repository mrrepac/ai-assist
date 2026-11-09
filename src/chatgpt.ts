import type { ApiConfig, ChatMessage, ChatOptions, ChatResult } from "./api";
import { ApiError } from "./api";
import { chatGPTAccessToken } from "./chatgpt-auth";
import { ResponseStream, responsesBody, subscriptionError } from "./chatgpt-responses";

/** Only allowlisted metadata leaves a failed response; never raw body text. */
export function responseDiagnostic(status: number, contentType: unknown, requestId: unknown, body: string): string {
  const mime = typeof contentType === "string" ? contentType.split(";")[0].trim().toLowerCase() : "";
  const safeMime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : "missing-or-invalid";
  const details = [`HTTP ${status}`, `format ${safeMime}`];
  if (typeof requestId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) details.push(`request ${requestId}`);
  let shape = /^\s*(?:data:|event:|:)/.test(body) ? "SSE" : /^\s*</.test(body) ? "HTML/XML" : body.trim() ? "text" : "empty";
  try {
    const parsed = JSON.parse(body);
    shape = parsed && typeof parsed === "object" ? (Array.isArray(parsed) ? "JSON array" : "JSON object") : "JSON scalar";
    if (parsed?.error && typeof parsed.error === "object") {
      shape = "JSON error";
      const code = parsed.error.code;
      const param = parsed.error.param;
      if (typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(code)) details.push(`code ${code}`);
      if (typeof param === "string" && /^[a-z][a-z0-9_.\[\]]{0,79}$/.test(param)) details.push(`parameter ${param}`);
    } else if (parsed?.object === "response" || parsed?.type === "response.completed") {
      shape = "Responses JSON";
      const state = parsed.status ?? parsed.response?.status;
      if (["completed", "failed", "incomplete", "in_progress", "queued", "cancelled"].includes(state)) details.push(`status ${state}`);
    }
  } catch { /* Content is never included in diagnostics. */ }
  details.push(`body ${shape}`);
  return details.join("; ");
}

/** Fixed-host desktop transport; never follows redirects or accepts a user URL. */
export function subscriptionRequest(path: "/models" | "/responses", token: string, payload?: string, signal?: AbortSignal, onChunk?: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ApiError("Stopped.", 0, true)); return; }
    if (path !== "/models" && path !== "/responses") { reject(new ApiError("Unsupported subscription endpoint.")); return; }
    let https: typeof import("https");
    try { https = require("https"); } catch { reject(new ApiError("ChatGPT subscription is currently available only in Obsidian desktop.")); return; }
    let settled = false;
    let bytes = 0;
    let body = "";
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(body);
    };
    const req = https.request({
      hostname: "api.openai.com", port: 443, path: "/v1" + path,
      method: payload === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: path === "/responses" ? "text/event-stream" : "application/json" },
    }, res => {
      const status = res.statusCode ?? 0;
      const ok = status >= 200 && status < 300;
      // Native Node lowercases headers; Electron transports may preserve casing.
      const header = (name: string) => Object.entries(res.headers).find(([key]) => key.toLowerCase() === name)?.[1];
      const contentType = header("content-type");
      const unexpectedFormat = ok && path === "/responses" && !String(contentType).toLowerCase().includes("text/event-stream");
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (settled) return;
        ping();
        bytes += Buffer.byteLength(chunk);
        if (bytes > (unexpectedFormat ? 8 * 1024 * 1024 : (ok && onChunk ? 32 : 8) * 1024 * 1024)) { finish(new ApiError("ChatGPT response exceeded the size limit.")); req.destroy(); return; }
        try { if (ok && onChunk && !unexpectedFormat) onChunk(chunk); else body += chunk; }
        catch (e) { finish(e instanceof Error ? e : new Error("ChatGPT stream failed.")); req.destroy(); }
      });
      res.on("end", () => {
        if (unexpectedFormat) {
          // Missing MIME is accepted only for fully validated Responses SSE.
          // Validate without callbacks first: malformed bodies cannot propose edits.
          if (contentType === undefined && /^\s*(?:data:|event:|:)/.test(body)) {
            try {
              const validator = new ResponseStream();
              validator.feed(body); validator.finish();
              onChunk?.(body);
              finish(); return;
            } catch { /* Return safe metadata, not arbitrary payload text. */ }
          }
          finish(new ApiError("ChatGPT returned an unexpected response format. " + responseDiagnostic(status, contentType, header("x-request-id"), body), status));
        } else if (!ok) {
          let code = "";
          try { const parsed = JSON.parse(body); code = typeof parsed.error?.code === "string" ? parsed.error.code : ""; } catch { /* Never expose raw response bodies. */ }
          finish(new ApiError(subscriptionError(code, status), status));
        } else finish();
      });
      res.on("aborted", () => finish(new ApiError("ChatGPT disconnected before completing the response.")));
      res.on("error", () => finish(new ApiError("ChatGPT response connection failed.")));
    });
    const abort = () => { finish(new ApiError("Stopped.", 0, true)); req.destroy(); };
    const ping = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { finish(new ApiError("ChatGPT response timed out.")); req.destroy(); }, 120_000);
    };
    req.on("error", () => finish(new ApiError("Unable to connect to ChatGPT. No alternate billing provider was used.")));
    signal?.addEventListener("abort", abort, { once: true });
    ping();
    if (signal?.aborted) { abort(); return; }
    req.end(payload);
  });
}

export async function chatGPTChat(cfg: ApiConfig, messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  if (!cfg.model.trim()) throw new ApiError("Choose a model from your ChatGPT account in plugin settings.");
  if (opts.signal?.aborted) throw new ApiError("Stopped.", 0, true);
  try {
    const token = await chatGPTAccessToken();
    if (opts.signal?.aborted) throw new ApiError("Stopped.", 0, true);
    const stream = new ResponseStream(opts);
    await subscriptionRequest("/responses", token, JSON.stringify(responsesBody(cfg, messages, opts)), opts.signal, chunk => stream.feed(chunk));
    return stream.finish();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error ? e.message : "ChatGPT subscription request failed.");
  }
}

export async function chatGPTModels(): Promise<string[]> {
  try {
    const token = await chatGPTAccessToken();
    const raw = await subscriptionRequest("/models", token);
    const data = JSON.parse(raw);
    if (!Array.isArray(data.models)) throw new Error("ChatGPT returned an invalid model catalog.");
    return data.models.filter((m: { visibility?: string; slug?: string }) => m.visibility === "list" && typeof m.slug === "string").map((m: { slug: string }) => m.slug);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error ? e.message : "Could not fetch ChatGPT models.");
  }
}