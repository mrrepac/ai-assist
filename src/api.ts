import { requestUrl } from "obsidian";
import { t } from "./i18n";

export interface ToolCall {
  id: string;
  name: string;
  /** Аргументы приходят строкой JSON — разбирает их тот, кто вызывает. */
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Ответ модели, попросившей вызвать инструменты. */
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  /** Ответ на конкретный вызов (role: "tool"). */
  tool_call_id?: string;
}

/*
 * Что приезжает по проводу. Описываем ровно те поля, которые читаем, и все
 * необязательными: провайдеры OpenAI-совместимы «в основном», и лишнее поле
 * или его отсутствие не должно ронять разбор.
 */
interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface WireToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** Кусок потока и ответ целиком устроены одинаково — отличается только имя поля. */
interface WireDelta {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: WireToolCall[];
}

export interface WireChunk {
  usage?: WireUsage;
  choices?: { delta?: WireDelta; message?: WireDelta }[];
}

/** Описание инструмента в формате OpenAI function calling. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Какого рода эндпоинт: у DeepSeek есть свои поля сверх OpenAI-формата. */
export type ProviderKind = "deepseek" | "openai";

export interface ApiConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 0 — не ограничивать (решает сервер). */
  maxTokens: number;
  /** Режим размышления DeepSeek; на openai-совместимых игнорируется. */
  thinking: boolean;
  reasoningEffort: "low" | "medium" | "high";
}

export interface Usage {
  prompt: number;
  completion: number;
  cached: number;
}

export interface ChatResult {
  text: string;
  reasoning: string;
  usage: Usage | null;
  toolCalls: ToolCall[];
}

export interface ChatOptions {
  stream: boolean;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  /** Просить сервер прислать расход токенов последним чанком стрима. */
  wantUsage?: boolean;
  /** Инструменты, которые модель вправе попросить вызвать. */
  tools?: ToolSpec[];
}

/**
 * Сколько ждём молчания в потоке. Отсчёт начинается заново на каждом куске:
 * длинный ответ печатается минутами, и ограничивать надо не его, а паузу —
 * без этого повисший запрос ждётся до перезапуска Obsidian.
 */
const IDLE_TIMEOUT = 120_000;

/**
 * Столько ждём ответ целиком, когда потока нет. Здесь пауза — это весь запрос:
 * пока модель не договорит, не приходит ничего, поэтому предел щедрее.
 */
const REPLY_TIMEOUT = 300_000;

/** Отсчёт до отказа: сам прерывает запрос и помнит, что это был именно он. */
interface Deadline {
  signal: AbortSignal;
  /** Ответ подал признаки жизни — начинаем отсчёт заново. */
  ping(): void;
  /** Ждать больше нечего: снимаем таймер и отписываемся. */
  done(): void;
  /** Прервано по тишине, а не кнопкой «Стоп». */
  expired: boolean;
}

/** Свой сигнал поверх пользовательского: прерываем и по кнопке, и по тишине. */
function deadline(outer: AbortSignal | undefined, ms: number): Deadline {
  const ctrl = new AbortController();
  const state: Deadline = { signal: ctrl.signal, expired: false, ping: () => {}, done: () => {} };

  const fire = () => {
    state.expired = true;
    ctrl.abort();
  };
  let timer = window.setTimeout(fire, ms);
  const relay = () => ctrl.abort();
  outer?.addEventListener("abort", relay);
  if (outer?.aborted) ctrl.abort();

  state.ping = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fire, ms);
  };
  state.done = () => {
    window.clearTimeout(timer);
    outer?.removeEventListener("abort", relay);
  };
  return state;
}

/**
 * Промис, который сам по себе не сбывается никогда, а отказывает по таймеру или
 * по кнопке «Стоп». Нужен там, где запрос отменить нечем, — с ним ожидание всё
 * равно заканчивается.
 */
function expiry(ms: number, outer?: AbortSignal): { promise: Promise<never>; cancel: () => void } {
  let timer = 0;
  let onAbort = () => {};
  const promise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new ApiError(t("errTimeout"))), ms);
    if (!outer) return;
    onAbort = () => reject(new ApiError(t("errAborted"), 0, true));
    if (outer.aborted) onAbort();
    else outer.addEventListener("abort", onAbort);
  });
  return {
    promise,
    cancel: () => {
      window.clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/** Ошибка вызова модели: понятный текст + код, чтобы вызывающий мог решать. */
export class ApiError extends Error {
  constructor(message: string, readonly status = 0, readonly aborted = false) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * base URL пользователь пишет как ему привычно: с /v1, без, со слэшем на конце.
 * Приводим к полному адресу метода, не ломая уже полный путь.
 */
export function endpoint(baseUrl: string, path: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) base = "https://api.deepseek.com";
  // Адрес без протокола: локальный сервер по https не отвечает, остальные — да.
  if (!/^https?:\/\//i.test(base)) base = (isLocalUrl("http://" + base) ? "http://" : "https://") + base;
  if (base.endsWith(path)) return base;
  return base + path;
}

/**
 * Локальный сервер (Ollama и подобные) ключа не спрашивает — там и спрашивать
 * не у кого. Смотрим на адрес, а не на выбранный пресет: свой адрес тоже
 * запросто оказывается локальным.
 */
export function isLocalUrl(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(baseUrl.trim());
}

function headers(cfg: ApiConfig): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" };
  // Пустой Bearer лучше не слать вовсе: часть серверов считает это попыткой
  // авторизоваться и отвечает 401 вместо того, чтобы пропустить.
  const key = cfg.apiKey.trim();
  if (key) out.Authorization = `Bearer ${key}`;
  return out;
}

function body(cfg: ApiConfig, messages: ChatMessage[], opts: ChatOptions): string {
  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: opts.stream,
    temperature: cfg.temperature,
  };
  if (cfg.maxTokens > 0) payload.max_tokens = cfg.maxTokens;
  if (cfg.kind === "deepseek" && cfg.thinking) {
    payload.thinking = { type: "enabled" };
    payload.reasoning_effort = cfg.reasoningEffort;
  }
  if (opts.stream && opts.wantUsage) payload.stream_options = { include_usage: true };
  if (opts.tools?.length) {
    payload.tools = opts.tools;
    payload.tool_choice = "auto";
  }
  return JSON.stringify(payload);
}

/** Ответ об ошибке у всех OpenAI-совместимых один: {error:{message}}. */
function describeError(status: number, raw: string): ApiError {
  let detail = "";
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string } | null;
    detail = parsed?.error?.message ?? parsed?.message ?? "";
  } catch {
    detail = raw.slice(0, 300);
  }
  const known: Record<number, string> = {
    400: t("errBadRequest"),
    401: t("errAuth"),
    402: t("errBalance"),
    403: t("errForbidden"),
    404: t("errModel"),
    422: t("errBadRequest"),
    429: t("errRateLimit"),
    500: t("errServer"),
    503: t("errBusy"),
  };
  const head = known[status] ?? `${t("errHttp")} ${status}`;
  // Модель без function calling отвечает на инструменты отказом по формату, и из
  // голого «провайдер отклонил запрос» этого никак не понять.
  const hint = /tool|function[ _-]?call/i.test(detail) ? " " + t("errTools") : "";
  return new ApiError((detail ? `${head} — ${detail}` : head) + hint, status);
}

function readUsage(u: WireUsage | undefined): Usage | null {
  if (!u) return null;
  return {
    prompt: u.prompt_tokens ?? 0,
    completion: u.completion_tokens ?? 0,
    cached: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Один вызов модели. Стрим идёт обычным fetch: Obsidian живёт в Electron и
 * DeepSeek отдаёт CORS-заголовки на app://obsidian.md, поэтому SSE доезжает.
 * Провайдер без CORS ломает ровно fetch, поэтому нестримовый путь сделан на
 * requestUrl — он ходит мимо браузерных ограничений и служит запасным.
 */
export async function chat(
  cfg: ApiConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<ChatResult> {
  if (!cfg.apiKey.trim() && !isLocalUrl(cfg.baseUrl)) throw new ApiError(t("errNoKey"));
  if (!cfg.model.trim()) throw new ApiError(t("errNoModel"));
  return opts.stream ? streamChat(cfg, messages, opts) : plainChat(cfg, messages, opts);
}

async function plainChat(
  cfg: ApiConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<ChatResult> {
  // requestUrl прервать нечем — ждём его наперегонки с таймером и с кнопкой
  // «Стоп». Проигравший запрос дойдёт в никуда, но это лучше, чем ожидание без
  // конца и кнопка, которая на нестримовом пути ничего не делает.
  const race = expiry(REPLY_TIMEOUT, opts.signal);
  let res;
  try {
    res = await Promise.race([
      requestUrl({
        url: endpoint(cfg.baseUrl, "/chat/completions"),
        method: "POST",
        headers: headers(cfg),
        body: body(cfg, messages, opts),
        throw: false,
      }),
      race.promise,
    ]);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(t("errNetwork") + " " + (e instanceof Error ? e.message : String(e)));
  } finally {
    race.cancel();
  }
  if (res.status >= 400) throw describeError(res.status, res.text ?? "");

  const json = res.json as WireChunk | undefined;
  const msg: WireDelta = json?.choices?.[0]?.message ?? {};
  const text = String(msg.content ?? "");
  const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? "");
  if (reasoning && opts.onReasoning) opts.onReasoning(reasoning);
  if (text && opts.onDelta) opts.onDelta(text);
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c) => ({
    id: String(c.id ?? ""),
    name: String(c.function?.name ?? ""),
    arguments: String(c.function?.arguments ?? ""),
  }));
  return { text, reasoning, usage: readUsage(json?.usage), toolCalls };
}

/**
 * Разбирает готовые SSE-строки из буфера и отдаёт распарсенные события.
 * Возвращает хвост: сеть режет поток где попало, и последняя строка обычно
 * приходит недописанной — она должна дождаться следующего чанка.
 */
export function drainSse(buffer: string, onEvent: (chunk: WireChunk) => void): string {
  let rest = buffer;
  let nl: number;
  while ((nl = rest.indexOf("\n")) !== -1) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (!line.startsWith("data:")) continue; // комментарии-пинги и пустые строки
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      onEvent(JSON.parse(data) as WireChunk);
    } catch {
      // недописанный или мусорный JSON — молча пропускаем, поток продолжается
    }
  }
  return rest;
}

async function streamChat(
  cfg: ApiConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<ChatResult> {
  // Свой сигнал поверх пользовательского: кроме кнопки «Стоп», запрос снимает
  // тишина в потоке — иначе оборванное соединение висит молча и бесконечно.
  const guard = deadline(opts.signal, IDLE_TIMEOUT);

  let res: Response;
  try {
    // Здесь и только здесь вместо requestUrl идёт fetch: requestUrl отдаёт ответ
    // целиком и тела по кускам не имеет, а без этого нет и печати ответа на
    // глазах. Провайдер без CORS ломает ровно этот путь — тогда работает
    // нестримовый plainChat на requestUrl, и настройка стрима прячется.
    res = await fetch(endpoint(cfg.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: headers(cfg),
      body: body(cfg, messages, opts),
      signal: guard.signal,
    });
  } catch (e) {
    guard.done();
    if (guard.expired) throw new ApiError(t("errTimeout"));
    if (opts.signal?.aborted) throw new ApiError(t("errAborted"), 0, true);
    // Сюда же попадает CORS-отказ: браузерный fetch не различает его и обрыв сети.
    throw new ApiError(t("errNetworkStream") + " " + (e instanceof Error ? e.message : String(e)));
  }
  if (!res.ok) {
    guard.done();
    throw describeError(res.status, await res.text().catch(() => ""));
  }
  if (!res.body) {
    guard.done();
    throw new ApiError(t("errNoStream"));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let usage: Usage | null = null;
  const calls = new Map<number, ToolCall>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      guard.ping(); // пришёл кусок — отсчёт тишины начинается заново
      buffer += decoder.decode(value, { stream: true });

      buffer = drainSse(buffer, (chunk) => {
        if (chunk.usage) usage = readUsage(chunk.usage);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        collectToolCalls(delta, calls);
        const r = delta.reasoning_content ?? delta.reasoning;
        if (r) {
          reasoning += r;
          opts.onReasoning?.(r);
        }
        if (delta.content) {
          text += delta.content;
          opts.onDelta?.(delta.content);
        }
      });
    }
  } catch (e) {
    if (guard.expired) throw new ApiError(t("errTimeout"));
    if (opts.signal?.aborted) {
      // Остановка по кнопке — не ошибка: отдаём то, что успело прийти.
      // Недособранные вызовы инструментов при этом выбрасываем: половина
      // JSON-аргументов хуже, чем ничего.
      return { text, reasoning, usage, toolCalls: [] };
    }
    throw new ApiError(t("errStreamBroken") + " " + (e instanceof Error ? e.message : String(e)));
  } finally {
    guard.done();
    reader.releaseLock();
  }

  return { text, reasoning, usage, toolCalls: [...calls.values()] };
}

/**
 * Вызов инструмента приезжает по кускам: id и имя в первом чанке, аргументы —
 * фрагментами JSON в следующих. Собираем по индексу, пока поток не кончится.
 */
export function collectToolCalls(delta: WireDelta, calls: Map<number, ToolCall>): void {
  if (!Array.isArray(delta.tool_calls)) return;
  for (const tc of delta.tool_calls) {
    const index = typeof tc.index === "number" ? tc.index : 0;
    const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
    if (tc.id) call.id = tc.id;
    if (tc.function?.name) call.name += tc.function.name;
    if (tc.function?.arguments) call.arguments += tc.function.arguments;
    calls.set(index, call);
  }
}

/** Список моделей провайдера (GET /models) — чтобы не вбивать имена руками. */
export async function listModels(cfg: ApiConfig): Promise<string[]> {
  const res = await requestUrl({
    url: endpoint(cfg.baseUrl, "/models"),
    method: "GET",
    headers: headers(cfg),
    throw: false,
  });
  if (res.status >= 400) throw describeError(res.status, res.text ?? "");
  const list = (res.json as { data?: { id?: string }[] } | undefined)?.data;
  if (!Array.isArray(list)) throw new ApiError(t("errModelList"));
  return list.map((m) => String(m.id ?? "")).filter(Boolean).sort();
}
