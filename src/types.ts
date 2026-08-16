import { AiAction, defaultActions } from "./actions";
import { ApiConfig, Source, listModels } from "./api";
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
  /**
   * Разговор без плагина: ни заметки, ни инструментов, ни системного промпта —
   * как в веб-чате провайдера. Нужен, когда спрашивают не про хранилище, а
   * просто так: всё, что плагин добавляет от себя, там только мешает и стоит
   * денег. На действия из заметки не распространяется — они сами про неё.
   */
  privateChat: boolean;
  /**
   * Чьей моделью отвечает приватный чат. Пусто — той же, что в шапке.
   *
   * Зачем отдельно: приватный разговор заводят не для работы с заметками, а
   * чтобы спросить «просто так», и модель там нужна другая — обычно подешевле
   * или та, которой не жалко чужого вопроса. Держать это в шапке значит
   * переключать её на входе и на выходе, и однажды забыть на выходе.
   */
  privateProvider: string;
  /**
   * Класть картинку, принесённую в чат, в папку вложений хранилища — туда же,
   * куда её кладёт сам Obsidian при вставке в заметку. Выключено — картинка
   * живёт только до перезапуска: хранилище чистое, но «спросить заново» про
   * вчерашний скриншот уже не выйдет. В приватном чате не пишем никогда.
   */
  saveAttachments: boolean;
  /** Давать модели инструменты правки заметок. */
  tools: boolean;
  /** Показывать каждую правку на подтверждение. */
  toolsConfirm: boolean;
  /** Куда класть новые заметки: сохранённый чат и то, что создала модель. */
  newNoteFolder: NewNoteFolder;
  /** Путь для режима «в свою папку». Пустой — всё равно что корень. */
  newNoteFolderPath: string;
  actions: AiAction[];
  /**
   * Что лежит на цифрах быстрого меню (1…9): id действия, спецпункт (@ask)
   * или пустая строка.
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
   * Запуск из заметки начинает разговор заново. За прежнюю беседу платят на
   * каждом следующем вопросе, а действие из заметки само себе контекст: на
   * что показали, с тем и работаем.
   */
  freshOnAction: boolean;
  /**
   * Занимать ли Alt+1 под быстрое меню. Своя раскладка на чужой клавиатуре —
   * навязанное решение, и гайдлайн каталога не зря её не рекомендует: команда
   * и так доступна из палитры, а хоткей на неё вешается свой.
   */
  defaultHotkey: boolean;
}

/**
 * Куда ложатся новые заметки:
 *  root   — в корень хранилища;
 *  folder — в одну заданную папку, она же создаётся, если её нет;
 *  beside — рядом с заметкой, над которой шла работа.
 */
export type NewNoteFolder = "root" | "folder" | "beside";

export const NEW_NOTE_FOLDERS: NewNoteFolder[] = ["root", "folder", "beside"];

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

/**
 * Картинка, приложенная к вопросу.
 *
 * Данных здесь нет и быть не может: лента переписывается на каждое слово, а
 * фотография в base64 — это мегабайты, которые уехали бы на диск вместе с ней.
 * Лежит либо путь в хранилище, либо только id — ключ, по которому картинку
 * помнит текущий сеанс и забывает перезапуск.
 */
export interface Attachment {
  id: string;
  /** Имя файла — то, что видно на плашке и в сохранённом чате. */
  name: string;
  mime: string;
  /** Сколько весит то, что уедет модели: цену вопроса задаёт именно это. */
  size: number;
  /** Путь в хранилище. Пусто — картинка живёт только до перезапуска. */
  path?: string;
  /**
   * Сколько в документе страниц и знаков. Сам текст здесь не лежит: он весит
   * десятки тысяч знаков, а лента переписывается на каждое слово — держим его
   * в памяти сеанса и перечитываем по пути. А вот числа нужны на плашке и
   * после перезапуска: по ним видно цену вопроса, не открывая файл.
   */
  pages?: number;
  chars?: number;
  /** Документ длиннее предела и отдан началом — знать это надо до отправки. */
  clipped?: boolean;
}

/** Документ (PDF) — он уходит модели текстом, а не изображением. */
export function isDoc(att: Attachment): boolean {
  return att.mime === "application/pdf";
}

export interface StoredChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Картинки, приложенные к вопросу. У ответа модели их не бывает. */
  attachments?: Attachment[];
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
   * Ссылки, на которых построен ответ. Хранятся вместе с ним: у поискового
   * ответа без источников нельзя проверить ни одного утверждения, а после
   * перезагрузки панели они пропадали бы вместе с запросом.
   */
  sources?: Source[];
  /**
   * Ответ оборван на пределе длины. Отдельным полем, а не по виду текста:
   * по нему кнопка «Продолжить» живёт и после перезагрузки панели.
   */
  truncated?: boolean;
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
  /**
   * Чем правили. Обычно это модель из настроек, но «переделать» умеет позвать
   * другую — и тогда без подписи не понять, чем вышло лучше.
   */
  model?: string;
  error?: string;
  undone?: boolean;
  /**
   * Модель упёрлась в предел длины и не дописала. Такой ответ в заметку не
   * идёт, но его можно дозапросить — пока плагин помнит начало, у карточки
   * есть кнопка «Продолжить».
   */
  truncated?: boolean;
}

export type HistoryItem = StoredChatMessage | ActionEntry;

export function isActionEntry(item: HistoryItem): item is ActionEntry {
  return (item as ActionEntry).kind === "action";
}

/**
 * Что лежит в data.json. Лента переехала в свой history.json — она меняется на
 * каждое слово, а data.json переписывается целиком вместе с настройками. Поле
 * history осталось лишь для настроек прежних версий: прочитали — и перенесли.
 *
 * Верхний уровень открыт нарочно: поле, которого мы не знаем, написала версия
 * новее нашей, и записать его обратно нетронутым дешевле, чем потерять.
 */
export interface StoredData {
  /** Номер формата. Файл прежних версий его не имеет — это версия 0. */
  schemaVersion?: number;
  settings: AiAssistSettings;
  history?: HistoryItem[];
  [key: string]: unknown;
}

/** Что лежит в history.json. Голый массив без обёртки — формат версии 0. */
export interface StoredHistory {
  schemaVersion: number;
  items: HistoryItem[];
}

/** С какой модели DeepSeek начинать: подсказка в настройках и умолчание. */
export const DEEPSEEK_MODEL = "deepseek-v4-flash";

/**
 * Готовые провайдеры. Всё это OpenAI-совместимые адреса, поэтому пресет только
 * подставляет URL — работает с ними один и тот же клиент.
 */
export const PROVIDERS: Record<string, { baseUrl: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com" },
  chadgpt: { baseUrl: "https://ask.chadgpt.ru/api/v1" },
  gptunnel: { baseUrl: "https://gptunnel.ru/v1" },
  polza: { baseUrl: "https://api.polza.ai/api/v1" },
  perplexity: { baseUrl: "https://api.perplexity.ai" },
  // Локальные серверы — в конец списка: у них свой разговор про ключ и порт.
  ollama: { baseUrl: "http://localhost:11434/v1" },
  lmstudio: { baseUrl: "http://localhost:1234/v1" },
};

/**
 * Модели, которые провайдер по имени не отдаёт. Обычный путь — спросить у него
 * GET /models, но у Perplexity такого метода нет вовсе, и кнопка «Получить
 * список» упиралась бы в 404 с подписью «по этому адресу такой модели нет» —
 * то есть врала бы дважды.
 *
 * Список короткий и меняется редко; поле модели всё равно остаётся текстовым,
 * так что новое имя можно вписать руками, не дожидаясь обновления плагина.
 */
export const BUILTIN_MODELS: Record<string, string[]> = {
  perplexity: ["sonar", "sonar-pro", "sonar-reasoning-pro", "sonar-deep-research"],
};

/** Готовый список моделей провайдера, если спрашивать у него нечего. */
export function builtinModels(provider: string): string[] | null {
  return BUILTIN_MODELS[provider] ?? null;
}

/**
 * Модели провайдера для кнопки «Получить список». У кого есть метод — спросим
 * его, у кого нет — отдадим готовый список, не тратя запрос впустую.
 */
export async function modelsFor(cfg: ApiConfig): Promise<string[]> {
  return builtinModels(providerOf(cfg)) ?? listModels(cfg);
}

/**
 * Умеет ли провайдер function calling. Perplexity — поисковик с моделью
 * поверх, инструментов у неё нет: запрос с ними отлетает четырёхсотой, и
 * получалось бы, что при выбранной Perplexity плагин не работает вовсе.
 */
export function toolsAllowed(provider: string): boolean {
  return provider !== "perplexity";
}

/**
 * Заведомо ли провайдер слеп к картинкам. Знать это наверняка нельзя: у
 * агрегаторов зрячесть зависит от выбранной модели, и списка таких моделей
 * никто не отдаёт. Поэтому здесь только то, что известно точно и про всего
 * провайдера сразу: у DeepSeek картинок не принимает ни одна модель — в их
 * схеме content у пользователя обязан быть строкой.
 *
 * Остальное выясняется отказом провайдера, и на такой отказ ApiError отвечает
 * подсказкой — ровно так же, как с инструментами.
 */
export function imagesAllowed(provider: string): boolean {
  return provider !== "deepseek";
}

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
 * Поток идёт обычным fetch, а его связывает CORS. Кто нужных заголовков не
 * отдаёт, у того ответ забираем целиком через requestUrl — он ходит мимо
 * браузерных ограничений.
 */
export function streamAvailable(settings: AiAssistSettings): boolean {
  return streamAllowed(providerOf(settings));
}

/**
 * Провайдеры, до которых потоком не достучаться.
 *
 * ChadGPT не отдаёт CORS-заголовков вовсе. LM Studio по умолчанию тоже:
 * заголовка нет, а preflight на /chat/completions отвечает четырёхсотой — то
 * есть POST до сервера даже не доходит. Отсюда и брался прежний симптом, из-за
 * которого пресет однажды убрали: список моделей приходит (он идёт через
 * requestUrl, мимо CORS), а на вопрос тишина. В её настройках сервера CORS
 * включается переключателем, но по умолчанию он выключен — а настройка,
 * которая работает только после похода в чужие настройки, не умолчание.
 *
 * Ollama, для сравнения, отдаёт заголовок эхом на app://obsidian.md, и поток
 * до неё идёт без обходных путей.
 */
const NO_STREAM = ["chadgpt", "lmstudio"];

/** То же по имени провайдера: разовый прогон идёт мимо активных настроек. */
export function streamAllowed(provider: string): boolean {
  return !NO_STREAM.includes(provider);
}

/**
 * Настройки запроса под чужой профиль. Нужны, чтобы переспросить другой
 * моделью, не переключая на неё плагин: выбор в меню — дело разовое, а
 * следующий вопрос должен уйти тем, чем уходил до сих пор.
 * null — у профиля нет модели, и спрашивать нечем.
 */
export function configFor(s: AiAssistSettings, provider: string): ApiConfig | null {
  const profile = s.profiles[provider];
  if (!profile?.model) return null;
  return {
    baseUrl: profile.baseUrl || PROVIDERS[provider]?.baseUrl || "",
    apiKey: profile.apiKey,
    model: profile.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
  };
}

/** Настройки запроса из шапки панели — то, что вписано в настройках. */
export function panelConfig(s: AiAssistSettings): ApiConfig {
  return {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
  };
}

/**
 * Чем отвечает панель прямо сейчас. У приватного чата может быть своя модель:
 * его заводят, чтобы спросить не про хранилище, и держать ради этого нужную
 * модель в шапке — значит переключать её на входе и на выходе.
 *
 * Своей модели нет или она не настроена — отвечает та же, что и обычно.
 * Приватность держится на том, что из хранилища ничего не уходит, и от того,
 * какая модель отвечает, не зависит: подменять здесь нечего.
 */
export function activeConfig(s: AiAssistSettings): ApiConfig {
  if (!s.privateChat || !s.privateProvider) return panelConfig(s);
  return configFor(s, s.privateProvider) ?? panelConfig(s);
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
    case "perplexity":
      return t("setProviderPerplexity");
    case "ollama":
      return t("setProviderOllama");
    case "lmstudio":
      return t("setProviderLmStudio");
    default:
      return t("setProviderCustom");
  }
}

/**
 * Какой пресет выбран сейчас — определяем по адресу, отдельно не храним.
 * Берём только baseUrl: тот же расчёт нужен и разовому прогону чужой моделью,
 * у которого на руках не настройки, а один конфиг запроса.
 */
export function providerOf(s: { baseUrl: string }): string {
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (s.baseUrl.replace(/\/+$/, "") === p.baseUrl) return name;
  }
  return "custom";
}

export function defaultSettings(): AiAssistSettings {
  return {
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: DEEPSEEK_MODEL,
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
    privateChat: false,
    privateProvider: "",
    saveAttachments: true,
    tools: true,
    toolsConfirm: true,
    newNoteFolder: "root",
    newNoteFolderPath: "",
    actions: defaultActions(),
    quickSlots: ["spelling", "expand", "clarify", "shorten", "evaluate"],
    // Два пункта, а не весь список действий: контекстное меню общее для всех
    // плагинов, и занимать в нём семь строк без спроса — невежливо.
    editorMenu: "quick",
    recentPrompts: [],
    recentAsks: [],
    draft: "",
    freshStart: true,
    freshOnAction: true,
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
  s.baseUrl = preset ? preset.baseUrl : saved?.baseUrl ?? "";
  s.apiKey = saved?.apiKey ?? "";
  s.model = saved?.model ?? defaultModel(name);
}

/**
 * С какой модели начинать у нового провайдера. Пусто — имена придётся спросить
 * у него самого: угадать их нельзя, и подставленное наугад имя дало бы отказ
 * «нет такой модели» вместо честного «выбери».
 */
function defaultModel(name: string): string {
  if (name === "deepseek") return DEEPSEEK_MODEL;
  return builtinModels(name)?.[0] ?? "";
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

  // Встроенные действия должны быть на месте даже после ручной правки data.json,
  // а пользовательские — пережить обновление плагина.
  const stored = Array.isArray(s.actions) ? s.actions.filter(isAction).map(cleanAction) : [];
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

  merged.privateProvider = typeof s.privateProvider === "string" ? s.privateProvider : "";

  merged.recentPrompts = cleanList(s.recentPrompts);
  merged.recentAsks = cleanList(s.recentAsks);
  merged.draft = typeof s.draft === "string" ? s.draft : "";

  if (!EDITOR_MENU_MODES.includes(merged.editorMenu)) merged.editorMenu = base.editorMenu;

  if (!NEW_NOTE_FOLDERS.includes(merged.newNoteFolder)) merged.newNoteFolder = base.newNoteFolder;
  merged.newNoteFolderPath = typeof s.newNoteFolderPath === "string" ? s.newNoteFolderPath : "";

  // Раньше поведение без выделения было переключателем «брать абзац». Смотрим
  // именно на сохранённое поле: у merged значение уже подставлено из умолчаний,
  // и по нему не отличить «настройки из старой версии» от осознанного выбора.
  if (!["note", "section", "paragraph", "none"].includes(s.noSelection as string)) {
    const old = (s as { paragraphFallback?: boolean }).paragraphFallback;
    merged.noSelection = old === false ? "none" : base.noSelection;
  }

  // В слотах не должно остаться ссылок на удалённые действия. Набор,
  // доставшийся от прошлой версии, заменяем новым: иначе обновлённые заготовки
  // увидят только те, кто ставит плагин впервые.
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

/**
 * Действие из data.json с проверенными полями. Из всех у него обязательны
 * только id и промпт: остальное дописывалось в разные версии, да и файл правят
 * руками. Пустое имя тут дороже, чем кажется, — по нему считают подпись в
 * журнале, и без этой чистки одно недостающее поле роняло загрузку плагина
 * целиком, вместе с настройками и лентой.
 */
function cleanAction(a: AiAction): AiAction {
  const mode = a.mode === "append" || a.mode === "chat" ? a.mode : "replace";
  return {
    ...a,
    name: typeof a.name === "string" && a.name.trim() ? a.name : t("actNewName"),
    mode,
    icon: typeof a.icon === "string" && a.icon.trim() ? a.icon : "sparkles",
    // Пусто и отсутствующее поле — одно и то же: прогоняем тем, что в шапке.
    provider: typeof a.provider === "string" ? a.provider : "",
  };
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
