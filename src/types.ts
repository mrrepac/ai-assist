import { AiAction, defaultActions } from "./actions";
import { ProviderKind } from "./api";
import { DiffSegment } from "./diff";
import { t } from "./i18n";
import { isLegacyPrompt, isLegacySlots, isRetired } from "./legacy";

/** Что помнится про каждого провайдера отдельно. */
export interface ProviderProfile {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AiAssistSettings {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Ключи и модели по провайдерам. Активные значения лежат в полях выше, а
   * здесь — то, к чему вернёмся при переключении обратно: у каждого сервиса
   * свой ключ и свои имена моделей.
   */
  profiles: Record<string, ProviderProfile>;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  thinking: boolean;
  reasoningEffort: "low" | "medium" | "high";
  targetLang: string;
  systemPrompt: string;
  /** С чем работать, когда ничего не выделено. */
  noSelection: "note" | "paragraph" | "none";
  showUsage: boolean;
  /** Класть текущую заметку в контекст чата. */
  chatContextNote: boolean;
  /** Давать модели инструменты правки заметок. */
  tools: boolean;
  /** Показывать каждую правку на подтверждение. */
  toolsConfirm: boolean;
  actions: AiAction[];
  /**
   * Что лежит на цифрах быстрого меню (1…5): id действия,
   * спецпункт (@ask, @translate-to) или пустая строка.
   */
  quickSlots: string[];
  /** Последние свои промпты из быстрого меню — листаются стрелками. */
  recentPrompts: string[];
  /** Открывать Obsidian с пустой лентой, не подхватывая вчерашний разговор. */
  freshStart: boolean;
}

/** Спецпункт быстрого меню — не действие, а отдельная команда плагина. */
export const QUICK_ASK = "@ask";

export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

/**
 * Запись журнала: правка выделенного текста. Живёт в той же ленте, что и чат,
 * но в запрос к модели не уходит — это отчёт о работе, а не часть разговора.
 */
export interface ActionEntry {
  kind: "action";
  id: string;
  action: string;
  status: "running" | "done" | "unchanged" | "stopped" | "error";
  /** Начало результата — целиком его хранить незачем, он уже в заметке. */
  content: string;
  /** Правки вперемешку с уцелевшим текстом — то, что рисуется в карточке. */
  segments?: DiffSegment[];
  tooMany?: boolean;
  added?: number;
  removed?: number;
  usage?: { prompt: number; completion: number };
  error?: string;
  undone?: boolean;
}

export type HistoryItem = StoredChatMessage | ActionEntry;

export function isActionEntry(item: HistoryItem): item is ActionEntry {
  return (item as ActionEntry).kind === "action";
}

/** Всё, что лежит в data.json: настройки и история чата отдельно. */
export interface StoredData {
  settings: AiAssistSettings;
  history: HistoryItem[];
}

export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

/**
 * Готовые провайдеры. Всё это OpenAI-совместимые адреса, поэтому пресет только
 * подставляет URL — работает с ними один и тот же клиент. Отдельный kind нужен
 * лишь DeepSeek: у него есть свои поля сверх общего формата.
 */
export const PROVIDERS: Record<string, { kind: ProviderKind; baseUrl: string }> = {
  deepseek: { kind: "deepseek", baseUrl: "https://api.deepseek.com" },
  chadgpt: { kind: "openai", baseUrl: "https://ask.chadgpt.ru/api/v1" },
  gptunnel: { kind: "openai", baseUrl: "https://gptunnel.ru/v1" },
  polza: { kind: "openai", baseUrl: "https://api.polza.ai/api/v1" },
  // Локальные сервера — в конец списка: у них свой разговор про ключ и порт.
  ollama: { kind: "openai", baseUrl: "http://localhost:11434/v1" },
  lmstudio: { kind: "openai", baseUrl: "http://localhost:1234/v1" },
};

/**
 * Порядок, в котором провайдеры показываются везде. Ключи объекта перебираются
 * в порядке записи, так что менять порядок надо в PROVIDERS — и список в
 * настройках, и меню в шапке панели пойдут за ним.
 */
export const PROVIDER_ORDER = Object.keys(PROVIDERS);

/** Место провайдера в списке; свой адрес и всё незнакомое — в конец. */
export function providerRank(name: string): number {
  const i = PROVIDER_ORDER.indexOf(name);
  return i === -1 ? PROVIDER_ORDER.length : i;
}

/** Умеет ли выбранный провайдер инструменты правки заметок. */
export function toolsAvailable(settings: AiAssistSettings): boolean {
  return settings.tools;
}

/**
 * Поток идёт обычным fetch, а его связывает CORS. ChadGPT нужных заголовков не
 * отдаёт, поэтому для него ответ забираем целиком через requestUrl — он ходит
 * мимо браузерных ограничений.
 */
export function streamAvailable(settings: AiAssistSettings): boolean {
  return providerOf(settings) !== "chadgpt";
}

/** Человеческое имя провайдера — для настроек и для меню в шапке панели. */
export function providerLabel(name: string): string {
  switch (name) {
    case "deepseek":
      return t("setProviderDeepseek");
    case "polza":
      return t("setProviderPolza");
    case "chadgpt":
      return t("setProviderChad");
    case "gptunnel":
      return t("setProviderTunnel");
    case "ollama":
      return t("setProviderOllama");
    case "lmstudio":
      return t("setProviderLmStudio");
    default:
      return t("setProviderCustom");
  }
}

/** Какой пресет выбран сейчас — определяем по адресу, отдельно не храним. */
export function providerOf(settings: AiAssistSettings): string {
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (settings.baseUrl.replace(/\/+$/, "") === p.baseUrl) return name;
  }
  return "custom";
}

export function defaultSettings(): AiAssistSettings {
  return {
    kind: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: DEEPSEEK_MODELS[0],
    profiles: {},
    temperature: 0.3,
    maxTokens: 0,
    stream: true,
    thinking: false,
    reasoningEffort: "medium",
    targetLang: t("defaultLang"),
    systemPrompt: t("setSystemPlaceholder"),
    noSelection: "note",
    showUsage: true,
    chatContextNote: false,
    tools: true,
    toolsConfirm: true,
    actions: defaultActions(),
    quickSlots: ["spelling", "expand", "clarify", "shorten", "evaluate"],
    recentPrompts: [],
    freshStart: true,
  };
}

/**
 * Смена провайдера: уходя, запоминаем ключ и модель прежнего, приходя — достаём
 * его собственные. Нужно и настройкам, и переключателю в шапке панели, поэтому
 * живёт здесь, а не в экране настроек.
 */
export function switchProvider(s: AiAssistSettings, name: string): void {
  s.profiles[providerOf(s)] = { apiKey: s.apiKey, model: s.model, baseUrl: s.baseUrl };
  const saved = s.profiles[name];
  const preset = PROVIDERS[name];
  s.kind = preset ? preset.kind : "openai";
  s.baseUrl = preset ? preset.baseUrl : saved?.baseUrl ?? "";
  s.apiKey = saved?.apiKey ?? "";
  s.model = saved?.model ?? (name === "deepseek" ? DEEPSEEK_MODELS[0] : "");
}

/**
 * Настройки из data.json могли писаться прошлой версией плагина: подставляем
 * недостающее и чиним типы, чтобы одно кривое поле не роняло загрузку.
 */
export function mergeSettings(raw: unknown): AiAssistSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<AiAssistSettings>;
  const merged: AiAssistSettings = { ...base, ...s };

  merged.temperature = clamp(Number(merged.temperature), 0, 2, base.temperature);
  merged.maxTokens = Math.max(0, Math.round(Number(merged.maxTokens) || 0));
  merged.kind = merged.kind === "openai" ? "openai" : "deepseek";
  if (!["low", "medium", "high"].includes(merged.reasoningEffort)) {
    merged.reasoningEffort = base.reasoningEffort;
  }

  // Встроенные действия должны быть на месте даже после ручной правки data.json,
  // а пользовательские — пережить обновление плагина.
  const stored = Array.isArray(s.actions) ? s.actions.filter(isAction) : [];
  const builtins = defaultActions().map((def) => {
    const found = stored.find((a) => a.id === def.id);
    if (!found) return def;
    // Промпт лежит в data.json, поэтому новые заготовки сами не доезжают.
    // Заводский промпт (нынешний или из прошлой версии) обновляем, переписанный
    // под себя — оставляем как есть.
    const untouched =
      found.prompt.trim() === def.prompt.trim() || isLegacyPrompt(found.prompt);
    return { ...def, ...found, prompt: untouched ? def.prompt : found.prompt, builtin: true };
  });
  const custom = stored
    .filter((a) => !builtins.some((b) => b.id === a.id))
    // Убранную из плагина заготовку вычищаем, свою работу оставляем.
    .filter((a) => !isRetired(a.id, a.prompt));
  merged.actions = [...builtins, ...custom.map((a) => ({ ...a, builtin: false }))];

  merged.profiles = cleanProfiles(s.profiles);
  // Настройки из версии без профилей: то, что уже введено, принадлежит тому
  // провайдеру, который сейчас выбран, — иначе ключ потеряется при первом же
  // переключении.
  const active = providerOf(merged);
  if (!merged.profiles[active] && (merged.apiKey || merged.model)) {
    merged.profiles[active] = {
      apiKey: merged.apiKey,
      model: merged.model,
      baseUrl: merged.baseUrl,
    };
  }

  merged.recentPrompts = Array.isArray(s.recentPrompts)
    ? s.recentPrompts.filter((p) => typeof p === "string").slice(0, 10)
    : [];

  // Раньше поведение без выделения было переключателем «брать абзац». Смотрим
  // именно на сохранённое поле: у merged значение уже подставлено из умолчаний,
  // и по нему не отличить «настройки из старой версии» от осознанного выбора.
  if (!["note", "paragraph", "none"].includes(s.noSelection as string)) {
    const old = (s as { paragraphFallback?: boolean }).paragraphFallback;
    merged.noSelection = old === false ? "none" : base.noSelection;
  }

  // Слотов ровно пять, и в них не должно остаться ссылок на удалённые действия.
  // Набор, доставшийся от прошлой версии, заменяем новым: иначе обновлённые
  // заготовки увидят только те, кто ставит плагин впервые.
  const storedSlots = Array.isArray(s.quickSlots) ? s.quickSlots : base.quickSlots;
  const slots = isLegacySlots(storedSlots) ? base.quickSlots : storedSlots;
  merged.quickSlots = Array.from({ length: 5 }, (_, i) => {
    // Пустая строка — осознанно очищенный слот, undefined — настройки из
    // версии, где слотов было меньше: там уместнее умолчание, а не дырка.
    const id = typeof slots[i] === "string" ? slots[i] : base.quickSlots[i];
    if (id === QUICK_ASK) return id;
    return merged.actions.some((a) => a.id === id) ? id : "";
  });
  return merged;
}

function cleanProfiles(raw: unknown): Record<string, ProviderProfile> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ProviderProfile> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const p = value as Partial<ProviderProfile>;
    out[name] = {
      apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
      model: typeof p.model === "string" ? p.model : "",
      baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : "",
    };
  }
  return out;
}

function isAction(a: unknown): a is AiAction {
  const x = a as AiAction;
  return !!x && typeof x.id === "string" && typeof x.prompt === "string";
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
