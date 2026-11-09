import { chatGPTEffort } from "./chatgpt-options";
import type { ApiConfig, ChatMessage, ChatOptions, ChatResult, ToolCall } from "./api";

/** Internal provider identifier, never used as a network destination. */
export const CHATGPT_PLAN_URL = "chatgpt://subscription";
export function isChatGPTPlan(cfg: { baseUrl: string }): boolean {
  return cfg.baseUrl.replace(/\/+$/, "") === CHATGPT_PLAN_URL;
}

export function responsesBody(cfg: ApiConfig, messages: ChatMessage[], opts: ChatOptions): Record<string, unknown> {
  const input: Record<string, unknown>[] = [];
  for (const m of messages) {
    // Preserve encrypted reasoning and function call items during a tool loop.
    // This metadata is request-local, not stored in the conversation history.
    if (m.role === "assistant" && m.responseItems?.length) {
      input.push(...m.responseItems);
      continue;
    }
    if (m.role === "tool") {
      if (!m.tool_call_id) throw new Error("Missing tool call ID.");
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      continue;
    }
    const content = typeof m.content === "string"
      ? [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }]
      : m.content.map(p => p.type === "text"
        ? { type: m.role === "assistant" ? "output_text" : "input_text", text: p.text }
        : { type: "input_image", image_url: p.image_url.url });
    if (content.length && (typeof m.content !== "string" || m.content.length)) {
      input.push({ role: m.role === "system" ? "developer" : m.role, content });
    }
    for (const c of m.tool_calls ?? []) {
      input.push({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments, namespace: "obsidian" });
    }
  }
  const body: Record<string, unknown> = {
    model: cfg.model, input, store: false, stream: true, include: ["reasoning.encrypted_content"],
  };
  const effort = chatGPTEffort(cfg.model, cfg.reasoningEffort);
  if (effort) body.reasoning = { effort };
  if (opts.tools?.length) body.tools = [{
    type: "namespace", name: "obsidian", description: "Read and propose reviewed edits to Obsidian notes.",
    tools: opts.tools.map(t => ({ type: "function", ...t.function, strict: false })),
  }];
  // Never forward temperature, max_tokens, metadata or previous_response_id.
  return body;
}

export function subscriptionError(code: string, status = 0): string {
  const suffix = code ? ` (${code})` : status ? ` (HTTP ${status})` : "";
  const messages: Record<string, string> = {
    subscription_sharing_usage_limit_exceeded: "ChatGPT plan allowance for this app is exhausted. Check ChatGPT Settings → Usage. No paid API fallback was used.",
    subscription_sharing_user_not_eligible: "ChatGPT plan usage is unavailable for this account, workspace or policy.",
    subscription_sharing_usage_unavailable: "ChatGPT could not check plan availability. Try again later.",
    subscription_sharing_user_unavailable: "ChatGPT account or workspace information is temporarily unavailable.",
    subscription_sharing_unsupported_capability: "This model or capability is not supported by ChatGPT plan usage.",
    subscription_sharing_route_not_supported: "The subscription route is not supported for this request.",
    subscription_sharing_invalid_user: "ChatGPT could not validate this account. Reconnect in plugin settings.",
  };
  return (messages[code] ?? (status === 401 ? "ChatGPT authorization was not accepted. Reconnect in plugin settings." : status === 403 ? "ChatGPT denied this request. Check account permissions and supported serving region." : "ChatGPT request failed. No paid API fallback was used.")) + suffix;
}

type EventObject = Record<string, any>;

/** SSE parser: handles arbitrary chunks, CRLF, comments and multiline data. */
export class ResponseStream {
  private buffer = "";
  private data: string[] = [];
  private completed = false;
  private result: ChatResult = { text: "", reasoning: "", usage: null, sources: [], toolCalls: [], truncated: false };
  constructor(private opts: Pick<ChatOptions, "onDelta" | "onReasoning"> = {}) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) throw new Error("ChatGPT stream event exceeded the size limit.");
    let at: number;
    while ((at = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.line(line);
    }
  }
  private line(line: string): void {
    if (!line) { this.dispatch(); return; }
    if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
  }
  private dispatch(): void {
    if (!this.data.length) return;
    const raw = this.data.join("\n");
    this.data = [];
    if (raw === "[DONE]") return; // Not a proof of completed inference.
    let e: EventObject;
    try { e = JSON.parse(raw); } catch { throw new Error("Malformed ChatGPT stream event."); }
    if (e.type === "response.failed" || e.type === "error") {
      throw new Error(subscriptionError(String(e.response?.error?.code ?? e.code ?? "")));
    }
    if (e.type === "response.incomplete") throw new Error("ChatGPT returned an incomplete answer. No note edit was applied from this response.");
    if (this.completed) return;
    if (e.type === "response.output_text.delta" && typeof e.delta === "string") {
      this.result.text += e.delta;
      this.opts.onDelta?.(e.delta);
    }
    if (e.type === "response.reasoning_summary_text.delta" && typeof e.delta === "string") {
      this.result.reasoning += e.delta;
      this.opts.onReasoning?.(e.delta);
    }
    if (e.type !== "response.completed") return;
    const r = e.response;
    if (!r || r.status !== "completed" || !Array.isArray(r.output)) throw new Error("ChatGPT did not confirm a completed response.");
    const calls: ToolCall[] = [];
    let finalText = "";
    for (const item of r.output) {
      if (item.type === "function_call") {
        if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") throw new Error("Malformed ChatGPT tool call.");
        if (item.namespace && item.namespace !== "obsidian") throw new Error("Unexpected ChatGPT tool namespace.");
        calls.push({ id: item.call_id, name: item.name.replace(/^obsidian\./, ""), arguments: item.arguments });
      }
      if (item.type === "message") for (const c of item.content ?? []) {
        if (c.type === "output_text" && typeof c.text === "string") finalText += c.text;
        if (c.type === "refusal" && typeof c.refusal === "string") finalText += c.refusal;
      }
    }
    this.result.text = finalText || this.result.text;
    this.result.toolCalls = calls;
    this.result.responseItems = r.output.filter((x: EventObject) => ["reasoning", "message", "function_call"].includes(x.type));
    if (r.usage) this.result.usage = {
      prompt: Number(r.usage.input_tokens) || 0,
      completion: Number(r.usage.output_tokens) || 0,
      cached: Number(r.usage.input_tokens_details?.cached_tokens) || 0,
    };
    this.completed = true;
  }
  finish(): ChatResult {
    if (this.buffer) { this.line(this.buffer.replace(/\r$/, "")); this.buffer = ""; }
    this.dispatch();
    if (!this.completed) throw new Error("ChatGPT stream ended before response.completed. The answer is incomplete.");
    return this.result;
  }
}