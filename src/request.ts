/*
 * Что уедет модели.
 *
 * Здесь живут решения, а не действия: какой фрагмент и какие вложения уходят с
 * вопросом, видит ли модель заметку, разрешены ли ей инструменты, что снять с
 * плашки. Отдельно от панели — потому что каждое из этих решений когда-нибудь
 * оказывалось неверным, а проверить их, не поднимая Obsidian, было нельзя.
 */
import { ApiConfig, ChatMessage } from "./api";
import { AttachedDoc, contextWindow, messageContent } from "./history";
import {
  AiAssistSettings,
  Attachment,
  HistoryItem,
  NoteContext,
  StoredChatMessage,
  toolsAllowed,
} from "./types";

export interface SubmitOptions {
  /** Что показать в панели как реплику пользователя (по умолчанию — сам текст). */
  display?: string;
  /** Разовый системный промпт поверх общего (для действий над выделением). */
  system?: string;
  /** Не тащить в запрос предыдущие сообщения: действие само по себе. */
  fresh?: boolean;
  /**
   * Запрос пришёл из заметки, а не из панели: действие над выделенным. Такой
   * сам себе контекст — на что показали, с тем и работаем. Поэтому ни
   * инструментов правки (режим «показать в панели» уже сказал «не трогай
   * заметку»), ни текущей заметки в довесок к выделенному куску.
   */
  fromEditor?: boolean;
  /**
   * Фрагмент заметки, о котором вопрос. Не передан — берётся прикреплённое
   * выделение; null — вопрос идёт без фрагмента, чем бы ни была занята плашка.
   * Так повторный запрос уходит ровно тем же, каким был.
   */
  quote?: string | null;
  /**
   * Картинки, приложенные к вопросу. Не передано — берутся те, что лежат на
   * плашке; null — вопрос идёт без картинок. Так повтор уходит с тем же
   * вложением, что и в первый раз, а не с тем, что успели приложить после.
   */
  files?: Attachment[] | null;
  /**
   * Чем спрашивать, если не тем, что стоит в настройках. Так «ещё раз» умеет
   * позвать другую модель, не переключая на неё плагин.
   */
  config?: ApiConfig;
}

export interface RequestInput {
  /** Текст вопроса — то, что уходит модели. */
  text: string;
  opts: SubmitOptions;
  settings: AiAssistSettings;
  /** Лента ДО того, как в неё лёг этот вопрос. */
  history: HistoryItem[];
  /** Что лежит на плашке над полем ввода. */
  chip: { quote: string | null; files: Attachment[] };
  /** Заметка-контекст, уже прочитанная панелью. */
  note: NoteContext | null;
  /** Имя провайдера выбранной модели. */
  provider: string;
  /**
   * Тексты подсказок, уже переведённые. Приходят входом, чтобы модуль не тянул
   * i18n, а с ним moment из obsidian: решение о том, ЧТО сказать модели, — здесь,
   * а на каком языке — не здесь.
   */
  hints: { tools: string; plain: string; noteHere: string; noteHidden: string };
}

/** Что панель скажет в ленте до того, как уйдёт запрос. */
export type RequestNotice = "noteClipped";

/** Заметка длиннее предела уходит началом — и об этом сказано модели. */
const CLIPPED = "[The note is longer than this — only the beginning is shown.]";

/**
 * Вложения, уже прочитанные панелью: картинки адресами `data:`, документы
 * текстом. Читать их умеет только она — там и хранилище, и память сеанса.
 */
export interface ResolvedMedia {
  /** Вложения этого вопроса. */
  own: { images: string[]; docs: AttachedDoc[] };
  /** Вложения реплики `plan.past[plan.mediaFrom]`; пусто, если её нет. */
  past: { images: string[]; docs: AttachedDoc[] };
}

export interface RequestPlan {
  /** Реплика пользователя, как она ляжет в ленту. */
  ask: StoredChatMessage;
  /**
   * Настоящий текст вопроса — тот, что уедет модели. От `ask.content`
   * отличается у действия из заметки: в ленте там подпись действия, а в
   * запросе текст.
   */
  text: string;
  /** Вложения этого вопроса. */
  files: Attachment[];
  /** Снять ли картинки с плашки. */
  clearFiles: boolean;
  /** Фрагмент, о котором уже спросили: плашка не должна вернуть его снова. */
  dismissQuote?: string;
  priv: boolean;
  canUseTools: boolean;
  /** Склеенный системный промпт; пустой — системного сообщения не будет. */
  system: string;
  /** Заметка, которая реально уедет контекстом. */
  note: NoteContext | null;
  /** Прошлые реплики, влезшие в бюджет контекста. */
  past: StoredChatMessage[];
  /** Индекс в past, чьи вложения уедут; -1 — ничьи. */
  mediaFrom: number;
  notices: RequestNotice[];
}

export function planRequest(input: RequestInput): RequestPlan {
  const { text, opts, settings, chip, provider } = input;

  // Прикреплённое выделение уходит с вопросом и тут же снимается: следующий
  // вопрос — уже про своё, если не выделить заново. Явный null означает «без
  // фрагмента» и плашку не смотрит вовсе. Приватный чат не отправляет фрагмент
  // ни при каких условиях — последняя застава на пути всего, что могло уцелеть
  // от прошлого разговора.
  const asked = opts.quote === undefined ? chip.quote : opts.quote;
  const quote = (settings.privateChat ? null : asked) ?? undefined;

  // Действие из заметки плашку не смотрит и картинок с неё не забирает:
  // приложенная для следующего вопроса, она уехала бы с чужим запросом — за те
  // же деньги и без спроса.
  const files = (opts.files === undefined ? (opts.fromEditor ? [] : chip.files) : opts.files) ?? [];
  // С плашки снимаем только то, что с неё и взяли. Картинки, переданные явно
  // («спросить заново», «повторить» после ошибки), к плашке отношения не имеют:
  // приложенное там ждёт следующего вопроса, и стереть его молча — потерять
  // чужую работу, а заодно оставить её висеть в памяти сеанса навсегда: в ленту
  // она не попала, и забыть её будет уже некому.
  const clearFiles = opts.files === undefined && !opts.fromEditor;

  // Приватный чат: модель не знает ни про Obsidian, ни про заметку — разговор
  // как в веб-чате провайдера. На действие из заметки не распространяется: оно
  // само про неё, и выключать там нечего.
  const priv = settings.privateChat && !opts.fromEditor;
  // Инструментов может не быть и у самого провайдера: Perplexity ищет в вебе и
  // отвечает, а function calling не умеет вовсе — запрос с ними отлетел бы
  // четырёхсотой на каждый вопрос.
  const canUseTools = settings.tools && !opts.fromEditor && !priv && toolsAllowed(provider);

  // Без объяснения, где она находится, модель на просьбу «вставь в заметку»
  // отвечает лекцией о том, что у неё нет доступа к хранилищу. Умеет ли модель
  // инструменты, заранее не знает никто — это выясняется отказом провайдера.
  const hint = canUseTools ? input.hints.tools : input.hints.plain;

  // «Отправлять заметку как контекст» — это про разговор в панели. Действие над
  // выделенным уже сказало, над чем работать, и заметка сверху — лишние деньги
  // и лишняя путаница: модель видит один и тот же текст дважды.
  const note = opts.fromEditor || priv ? null : input.note;

  // Видит ли модель заметку — половина того, что ей надо знать про инструменты.
  // Без этой оговорки она лезет читать заметку на любой вопрос, даже когда он
  // вовсе не про неё, а когда заметка уже приложена — читает её вторым разом,
  // целым кругом запроса за те же деньги.
  const reach = canUseTools ? (note ? input.hints.noteHere : input.hints.noteHidden) : "";
  // В приватном чате не уходит ничего своего — ни объяснений про панель, ни
  // общего промпта из настроек. Остаётся только промпт действия, но его в этом
  // режиме и не бывает.
  const own = priv ? [] : [hint, reach, settings.systemPrompt.trim()];
  const system = [...own, opts.system?.trim()].filter(Boolean).join("\n\n");

  const past = opts.fresh ? [] : contextWindow(input.history);
  // Из прошлых реплик картинки уходят только с самой свежей: за каждую платят
  // на каждом вопросе, и разговор, начавшийся с фотографии, иначе возил бы её с
  // собой до конца. К этому вопросу приложили своё — прежние не нужны и
  // подавно: спрашивают уже про новую.
  const mediaFrom = files.length
    ? -1
    : past.reduce((at, m, i) => (m.attachments?.length ? i : at), -1);

  const notices: RequestNotice[] = [];
  // Ответ по началу длинной заметки выглядит точно так же, как ответ по всей, —
  // про обрезку надо сказать вслух, иначе о ней никто не узнает.
  if (note?.clipped) notices.push("noteClipped");

  // Реплику держим объектом: по нему кнопки под сообщением находят своё место в
  // ленте, как бы она ни менялась под ними.
  const ask: StoredChatMessage = {
    role: "user",
    content: opts.display ?? text,
    quote,
    attachments: files.length ? files : undefined,
    // Показано не то, что уходит в запрос, — запоминаем настоящий вопрос вместе
    // с его системным промптом, иначе «спросить заново» отправит подпись
    // действия.
    resend:
      opts.display || opts.system || opts.fresh
        ? { text, system: opts.system, fresh: opts.fresh }
        : undefined,
  };

  return {
    ask,
    text,
    files,
    clearFiles,
    dismissQuote: quote,
    priv,
    canUseTools,
    system,
    note,
    past,
    mediaFrom,
    notices,
  };
}

/**
 * План становится запросом. Порядок сообщений тот же, в каком его читает
 * модель: сначала кто она и что ей видно, потом заметка, потом разговор, и
 * последним — сам вопрос.
 */
export function assembleMessages(plan: RequestPlan, media: ResolvedMedia): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (plan.system) messages.push({ role: "system", content: plan.system });

  if (plan.note) {
    messages.push({
      role: "system",
      content:
        `Note "${plan.note.path}":\n\n${plan.note.text}` + (plan.note.clipped ? "\n\n" + CLIPPED : ""),
    });
  }

  const nothing = { images: [], docs: [] };
  for (const [i, m] of plan.past.entries()) {
    // Документ той же меркой, что картинка: он тоже стоит денег на каждом
    // вопросе, и возить сорок тысяч знаков до конца разговора нельзя.
    const own = i === plan.mediaFrom ? media.past : nothing;
    messages.push({ role: m.role, content: messageContent(m, own.images, own.docs) });
  }

  messages.push({
    role: "user",
    // Модели уходит настоящий текст, а не подпись действия, которой реплика
    // подписана в ленте, — потому план и несёт их порознь.
    content: messageContent(
      { role: "user", content: plan.text, quote: plan.ask.quote, attachments: plan.files },
      media.own.images,
      media.own.docs,
    ),
  });
  return messages;
}
