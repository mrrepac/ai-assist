import { AiAction, defaultActions } from "./actions";
import { ProviderKind } from "./api";
import { DiffSegment } from "./diff";
import { t } from "./i18n";
import { isLegacyName, isLegacyPrompt, isLegacySlots, isRetired } from "./legacy";

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
  systemPrompt: string;
  /** С чем работать, когда ничего не выделено. */
  noSelection: "note" | "section" | "paragraph" | "none";
  /**
   * Порог в знаках, после которого плагин переспрашивает, прежде чем отправить
   * текст; 0 — не спрашивать никогда. Не запрет: решает пользователь, ему надо
   * только знать цену — и деньги, и то, что длинный ответ вернётся оборванным.
   */
  warnOver: number;
  showUsage: boolean;
  /** Класть текущую заметку в контекст чата. */
  chatContextNote: boolean;
  /** Давать модели инструменты правки заметок. */
  tools: boolean;
  /** Показывать каждую правку на подтверждение. */
  toolsConfirm: boolean;
  actions: AiAction[];
  /**
   * Что лежит на цифрах быстрого меню (1…9): id действия,
   * спецпункт (@ask, @translate-to) или пустая строка.
   */
  quickSlots: string[];
  /** Что плагин добавляет в контекстное меню редактора над выделением. */
  editorMenu: EditorMenuMode;
  /** Последние свои промпты из быстрого меню — листаются стрелками. */
  recentPrompts: string[];
  /** Последние вопросы из чата — листаются стрелками в поле ввода. */
  recentAsks: string[];
  /**
   * Недописанный вопрос из панели. Живёт в настройках, а не в ленте: лента
   * стирается «новым чатом» и на запуске, а черновик должен пережить и то, и
   * другое — панель закрывают на середине фразы чаще, чем кажется.
   */
  draft: string;
  /** Открывать Obsidian с пустой лентой, не подхватывая вчерашний разговор. */
  freshStart: boolean;
  /**
   * Занимать ли Alt+1 под быстрое меню. Своя раскладка на чужой клавиатуре —
   * навязанное решение, и гайдлайн каталога не зря её не рекомендует: команда
   * и так доступна из палитры, а хоткей на неё вешается свой.
   */
  defaultHotkey: boolean;
}

/** Спецпункт быстрого меню — не действие, а отдельная команда плагина. */
export const QUICK_ASK = "@ask";

/**
 * Что плагин кладёт в контекстное меню редактора:
 *  none    — ничего;
 *  quick   — быстрое меню и вопрос в чат, два пункта;
 *  actions — плюс сами действия с клавиш быстрого меню, каждое своей строкой.
 */
export type EditorMenuMode = "none" | "quick" | "actions";

export const EDITOR_MENU_MODES: EditorMenuMode[] = ["none", "quick", "actions"];

/** Сколько клавиш в быстром меню сразу: рука помнит первые пять. */
export const QUICK_SLOTS_DEFAULT = 5;

/** Дальше цифры кончаются — больше девяти клавиш не бывает. */
export const QUICK_SLOTS_MAX = 9;

export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * Выделенный кусок заметки, о котором был вопрос. Хранится отдельно от текста
   * вопроса: так его видно в ленте цитатой и после перезагрузки панели, и в
   * следующий запрос он уходит вместе с вопросом, а не теряется.
   */
  quote?: string;
  reasoning?: string;
  /** Расход на этот ответ: иначе после перезагрузки панели счёт пропадал. */
  usage?: { prompt: number; completion: number; cached: number };
  /**
   * Чей это ответ. Модель переключается прямо из шапки панели, и через десять
   * реплик уже не вспомнить, кто что сказал.
   */
  model?: string;
  /**
   * Запрос, стоящий за репликой, когда показано не то, что ушло: действие над
   * выделением рисуется в ленте своим названием, а модели уходил сам текст со
   * своим системным промптом. Без этого «спросить заново» пересобрало бы вопрос
   * из подписи действия.
   */
  resend?: { text: string; system?: string; fresh?: boolean };
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

/**
 * Что лежит в data.json. Лента переехала в свой history.json — она меняется на
 * каждое слово, а data.json переписывается целиком вместе с настройками. Поле
 * history осталось лишь для настроек прежних версий: прочитали — и перенесли.
 */
export interface StoredData {
  settings: AiAssistSettings;
  history?: HistoryItem[];
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
  // Локальный сервер — в конец списка: у него свой разговор про ключ и порт.
  ollama: { kind: "openai", baseUrl: "http://localhost:11434/v1" },
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
    systemPrompt: t("setSystemPlaceholder"),
    noSelection: "note",
    // Двадцать тысяч знаков — примерно столько модель ещё в состоянии вернуть
    // обратно, а дальше начинается обрыв ответа на полуслове.
    warnOver: 20000,
    showUsage: true,
    chatContextNote: false,
    tools: true,
    toolsConfirm: true,
    actions: defaultActions(),
    quickSlots: ["spelling", "expand", "clarify", "shorten", "evaluate"],
    // Два пункта, а не весь список действий: контекстное меню общее для всех
    // плагинов, и занимать в нём семь строк без спроса — невежливо.
    editorMenu: "quick",
    recentPrompts: [],
    recentAsks: [],
    draft: "",
    freshStart: true,
    defaultHotkey: false,
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
  // Ноль здесь осмысленный («не спрашивать»), поэтому отличаем его от
  // отсутствующего поля по типу, а не по значению.
  merged.warnOver =
    typeof s.warnOver === "number" && Number.isFinite(s.warnOver)
      ? Math.max(0, Math.round(s.warnOver))
      : base.warnOver;
  merged.kind = merged.kind === "openai" ? "openai" : "deepseek";

  // Встроенные действия должны быть на месте даже после ручной правки data.json,
  // а пользовательские — пережить обновление плагина.
  const stored = Array.isArray(s.actions) ? s.actions.filter(isAction) : [];
  const builtins = defaultActions().map((def) => {
    const found = stored.find((a) => a.id === def.id);
    if (!found) return def;
    // Промпт и название лежат в data.json, поэтому новые заготовки сами не
    // доезжают. Заводское (нынешнее или из прошлой версии) обновляем,
    // переписанное под себя — оставляем как есть.
    const ownPrompt =
      found.prompt.trim() !== def.prompt.trim() && !isLegacyPrompt(found.prompt);
    const ownName = found.name.trim() !== def.name.trim() && !isLegacyName(found.name);
    return {
      ...def,
      ...found,
      name: ownName ? found.name : def.name,
      prompt: ownPrompt ? found.prompt : def.prompt,
      builtin: true,
    };
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

  // Alt+1 перестал занимать себя сам, но у того, кто уже привык, он должен
  // остаться: новая установка получает выключенный хоткей, прежняя — включённый.
  if (typeof s.defaultHotkey !== "boolean") merged.defaultHotkey = true;

  merged.recentPrompts = cleanList(s.recentPrompts);
  merged.recentAsks = cleanList(s.recentAsks);
  merged.draft = typeof s.draft === "string" ? s.draft : "";

  if (!EDITOR_MENU_MODES.includes(merged.editorMenu)) merged.editorMenu = base.editorMenu;

  // Раньше поведение без выделения было переключателем «брать абзац». Смотрим
  // именно на сохранённое поле: у merged значение уже подставлено из умолчаний,
  // и по нему не отличить «настройки из старой версии» от осознанного выбора.
  if (!["note", "section", "paragraph", "none"].includes(s.noSelection as string)) {
    const old = (s as { paragraphFallback?: boolean }).paragraphFallback;
    merged.noSelection = old === false ? "none" : base.noSelection;
  }

  // Слотов ровно QUICK_SLOT_COUNT, и в них не должно остаться ссылок на
  // удалённые действия. Набор, доставшийся от прошлой версии, заменяем новым:
  // иначе обновлённые заготовки увидят только те, кто ставит плагин впервые.
  const storedSlots = Array.isArray(s.quickSlots) ? s.quickSlots : base.quickSlots;
  const slots = isLegacySlots(storedSlots) ? base.quickSlots : storedSlots;
  // Клавиш ровно столько, сколько пользователь себе завёл: пять по умолчанию,
  // дальше он добавляет их сам. Пустой хвост отбрасываем — он остаётся от
  // версии с фиксированным рядом и занимал бы место ни за чем.
  const filled = slots.reduce((last, id, i) => (typeof id === "string" && id ? i + 1 : last), 0);
  const size = Math.min(QUICK_SLOTS_MAX, Math.max(QUICK_SLOTS_DEFAULT, filled));

  // Пустая строка — осознанно очищенный слот, undefined — настройки из версии,
  // где слотов было меньше: такому слоту уместнее умолчание, а не дырка.
  const chosen = Array.from({ length: size }, (_, i) =>
    typeof slots[i] === "string" ? slots[i] : null,
  );
  // Но кладём только то, чего в наборе ещё нет: ряд стал длиннее, и без этой
  // проверки после обновления одно действие оказалось бы на двух клавишах.
  const spare = base.quickSlots.filter((id) => id && !chosen.includes(id));
  merged.quickSlots = chosen.map((slot) => {
    const id = slot ?? spare.shift() ?? "";
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

/** Список прошлых промптов из data.json: строки, и не больше десяти. */
function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string").slice(0, 10);
}

function isAction(a: unknown): a is AiAction {
  const x = a as AiAction;
  return !!x && typeof x.id === "string" && typeof x.prompt === "string";
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
