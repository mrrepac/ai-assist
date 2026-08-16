import { requestUrl } from "obsidian";
import { t } from "./i18n";

export interface ToolCall {
  id: string;
  name: string;
  /** Аргументы приходят строкой JSON — разбирает их тот, кто вызывает. */
  arguments: string;
}

/**
 * Кусок реплики, когда в ней не только текст. Картинка уходит адресом
 * data:image/…;base64,… — так её принимают все OpenAI-совместимые провайдеры,
 * и не нужно никуда её выкладывать, чтобы модель дотянулась.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /**
   * Строка — обычная реплика, массив — реплика с вложениями. Второй вид
   * понимают не все модели, поэтому строкой остаётся всё, где картинок нет:
   * лишний массив на пустом месте отдельные провайдеры не принимают.
   */
  content: string | ContentPart[];
  /** Ответ модели, попросившей вызвать инструменты. */
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  /** Ответ на конкретный вызов (role: "tool"). */
  tool_call_id?: string;
}

/** Есть ли в запросе картинки — от этого зависит, чем объяснять отказ провайдера. */
export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
  );
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

/**
 * Откуда взят ответ. Поисковые модели (Perplexity и подобные) кладут ссылки
 * рядом с текстом, каждый по-своему: search_results — с названиями и датами,
 * citations — голым списком адресов. Читаем оба и сводим к одному виду.
 */
interface WireSearchResult {
  title?: string;
  url?: string;
  date?: string;
}

export interface WireChunk {
  usage?: WireUsage;
  citations?: unknown;
  search_results?: unknown;
  /**
   * finish_reason приезжает в последнем чанке: "stop" — модель договорила,
   * "length" — упёрлась в свой предел и оборвала ответ на полуслове.
   */
  choices?: { delta?: WireDelta; message?: WireDelta; finish_reason?: string | null }[];
}

/** Ссылка под ответом: адрес обязателен, название бывает не у всех. */
export interface Source {
  url: string;
  title: string;
  date?: string;
  /**
   * Номер, под которым источник пришёл от провайдера. Не порядковый номер в
   * нашем списке: поисковая модель ссылается прямо в тексте — «родился в
   * Москве[1][6]», — и цифра там означает место в её собственном списке. По
   * этим номерам такие хвосты и опознаются, чтобы вычистить их из ответа и не
   * тронуть при этом чужое число в скобках. Выбросив из списка хоть одну
   * строку, мы сдвинули бы все следующие — и вычистили бы не то.
   */
  n: number;
}

/**
 * Ссылки из ответа. Провайдер, который про них не знает, полей не пришлёт —
 * тогда пусто, и под ответом ничего не появится.
 */
export function readSources(chunk: WireChunk): Source[] {
  const found: Source[] = Array.isArray(chunk.search_results)
    ? (chunk.search_results as WireSearchResult[]).map((r, i) => ({
        url: String(r?.url ?? ""),
        title: String(r?.title ?? ""),
        date: typeof r?.date === "string" ? r.date : undefined,
        n: i + 1,
      }))
    : Array.isArray(chunk.citations)
      // Голый список адресов: название взять неоткуда, покажем сам адрес.
      ? (chunk.citations as unknown[]).map((u, i) => ({ url: String(u ?? ""), title: "", n: i + 1 }))
      : [];

  // Показываем только то, по чему можно щёлкнуть, и один раз — но номер у
  // каждого остаётся свой, тот, что пришёл.
  const seen = new Set<string>();
  return found.filter((s) => {
    if (!/^https?:\/\//i.test(s.url) || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
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

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 0 — не ограничивать (решает сервер). */
  maxTokens: number;
}

export interface Usage {
  prompt: number;
  completion: number;
  cached: number;
}

/**
 * Расход двух запросов в один. Длинный ответ модель отдаёт в несколько заходов,
 * и каждый из них оплачен: показать только последний — значит назвать цену
 * вдвое меньше настоящей.
 */
export function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    prompt: a.prompt + b.prompt,
    completion: a.completion + b.completion,
    cached: a.cached + b.cached,
  };
}

export interface ChatResult {
  text: string;
  reasoning: string;
  usage: Usage | null;
  toolCalls: ToolCall[];
  /** Ссылки, на которых построен ответ; у обычной модели их не бывает. */
  sources: Source[];
  /**
   * Ответ оборван на пределе длины модели. Класть такой в заметку нельзя: он
   * заменит текст своей половиной, а выглядеть будет как обычная правка.
   */
  truncated: boolean;
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
 * Методы, которые пользователь мог захватить, копируя адрес из документации.
 * Снимаем их с хвоста: иначе к адресу с /chat/completions припишется /models,
 * и список моделей уедет в никуда.
 */
const METHODS = ["/chat/completions", "/completions", "/models"];

/**
 * base URL пользователь пишет как ему привычно: с /v1, без, со слэшем на конце,
 * а то и целиком с методом. Приводим к полному адресу нужного метода.
 */
export function endpoint(baseUrl: string, path: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  // Пустой адрес раньше молча подставлял DeepSeek: выбрал «свой адрес», ещё
  // ничего не вписал, нажал «Проверить» — и ключ уехал чужому провайдеру.
  if (!base) throw new ApiError(t("errNoUrl"));
  // Адрес без протокола: локальный сервер по https не отвечает, остальные — да.
  if (!/^https?:\/\//i.test(base)) base = (isLocalUrl("http://" + base) ? "http://" : "https://") + base;
  const method = METHODS.find((m) => base.endsWith(m));
  if (method) base = base.slice(0, -method.length);
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
  if (opts.stream && opts.wantUsage) payload.stream_options = { include_usage: true };
  if (opts.tools?.length) {
    payload.tools = opts.tools;
    payload.tool_choice = "auto";
  }
  return JSON.stringify(payload);
}

/**
 * Ответ об ошибке у всех OpenAI-совместимых один: {error:{message}}.
 * withImages — в запросе были картинки: тогда отказ по формату почти наверняка
 * про них, и сказать это надо прямо.
 */
function describeError(status: number, raw: string, withImages = false): ApiError {
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
  // То же с картинками: незрячая модель отвечает на них жалобой на content, и
  // без подсказки это выглядит как поломка плагина, а не как «эта не умеет».
  // Смотрим не только на текст отказа: провайдеры описывают его кто как, а вот
  // то, что картинка в запросе была, известно наверняка.
  const hint = /tool|function[ _-]?call/i.test(detail)
    ? " " + t("errTools")
    : withImages && status >= 400 && status < 500
      ? " " + t("errImages")
      : "";
  return new ApiError((detail ? `${head} — ${detail}` : head) + hint, status);
}

/**
 * Тело ответа разбором, а не полем res.json: то — геттер, и на не-JSON он
 * бросает голый SyntaxError. А приходит такое не в диковинку — прокси и
 * порталы отдают HTML-страницу со статусом 200, и «Unexpected token <»
 * пользователю не говорит ничего.
 */
function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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
  const url = endpoint(cfg.baseUrl, "/chat/completions");
  // requestUrl прервать нечем — ждём его наперегонки с таймером и с кнопкой
  // «Стоп». Проигравший запрос дойдёт в никуда, но это лучше, чем ожидание без
  // конца и кнопка, которая на нестримовом пути ничего не делает.
  const race = expiry(REPLY_TIMEOUT, opts.signal);
  let res;
  try {
    const request = requestUrl({
      url,
      method: "POST",
      headers: headers(cfg),
      body: body(cfg, messages, opts),
      throw: false,
    });
    // Проигравший гонку промис остаётся без обработчика: упади запрос по сети
    // уже после того, как ожидание сняли, это всплыло бы unhandled rejection.
    request.catch(() => {});
    res = await Promise.race([request, race.promise]);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(t("errNetwork") + " " + (e instanceof Error ? e.message : String(e)));
  } finally {
    race.cancel();
  }
  if (res.status >= 400) throw describeError(res.status, res.text ?? "", hasImages(messages));

  const json = readJson(res.text ?? "") as WireChunk | null;
  if (!json) throw new ApiError(t("errBadReply"));
  const msg: WireDelta = json.choices?.[0]?.message ?? {};
  const text = String(msg.content ?? "");
  const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? "");
  if (reasoning && opts.onReasoning) opts.onReasoning(reasoning);
  if (text && opts.onDelta) opts.onDelta(text);
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c) => ({
    id: String(c.id ?? ""),
    name: String(c.function?.name ?? ""),
    arguments: String(c.function?.arguments ?? ""),
  }));
  return {
    text,
    reasoning,
    usage: readUsage(json.usage),
    toolCalls,
    sources: readSources(json),
    truncated: json.choices?.[0]?.finish_reason === "length",
  };
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
  // Адрес считаем до того, как заведён отсчёт: кривой адрес — это отказ сразу,
  // а не «запрос не прошёл», в который его завернул бы catch ниже.
  const url = endpoint(cfg.baseUrl, "/chat/completions");
  // Свой сигнал поверх пользовательского: кроме кнопки «Стоп», запрос снимает
  // тишина в потоке — иначе оборванное соединение висит молча и бесконечно.
  const guard = deadline(opts.signal, IDLE_TIMEOUT);

  let res: Response;
  try {
    // Здесь и только здесь вместо requestUrl идёт fetch: requestUrl отдаёт ответ
    // целиком и тела по кускам не имеет, а без этого нет и печати ответа на
    // глазах. Провайдер без CORS ломает ровно этот путь — тогда работает
    // нестримовый plainChat на requestUrl, и настройка стрима прячется.
    res = await fetch(url, {
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
    throw describeError(res.status, await res.text().catch(() => ""), hasImages(messages));
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
  let finish = "";
  let sources: Source[] = [];
  const calls = new Map<number, ToolCall>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      guard.ping(); // пришёл кусок — отсчёт тишины начинается заново
      buffer += decoder.decode(value, { stream: true });

      buffer = drainSse(buffer, (chunk) => {
        if (chunk.usage) usage = readUsage(chunk.usage);
        // Ссылки приезжают своим полем и повторяются в каждом чанке — берём
        // последний непустой набор, он самый полный.
        const found = readSources(chunk);
        if (found.length) sources = found;
        // Причина остановки приезжает в последнем чанке — с пустой дельтой,
        // поэтому читаем её до проверки на дельту.
        const reason = chunk.choices?.[0]?.finish_reason;
        if (reason) finish = reason;
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
      return { text, reasoning, usage, toolCalls: [], sources, truncated: false };
    }
    throw new ApiError(t("errStreamBroken") + " " + (e instanceof Error ? e.message : String(e)));
  } finally {
    guard.done();
    reader.releaseLock();
  }

  return {
    text,
    reasoning,
    usage,
    toolCalls: [...calls.values()],
    sources,
    truncated: finish === "length",
  };
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
    // Имя приезжает кусками, но часть провайдеров шлёт его целиком в каждом
    // чанке: без проверки на повтор вышло бы «read_noteread_note», а такого
    // инструмента нет, и правка не состоялась бы.
    const name = tc.function?.name;
    if (name && call.name !== name) call.name += name;
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
  const list = (readJson(res.text ?? "") as { data?: { id?: string }[] } | null)?.data;
  if (!Array.isArray(list)) throw new ApiError(t("errModelList"));
  return list.map((m) => String(m.id ?? "")).filter(Boolean).sort();
}
