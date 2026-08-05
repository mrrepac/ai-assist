import { t } from "./i18n";

/**
 * Что делать с ответом модели:
 *  replace — заменить выделение (откат обычным Ctrl+Z);
 *  append  — вставить под выделением, оригинал остаётся;
 *  chat    — ничего не трогать в заметке, показать в панели справа.
 */
export type ActionMode = "replace" | "append" | "chat";

export interface AiAction {
  id: string;
  name: string;
  /** Системный промпт: он и есть всё, что модель знает о задаче. */
  prompt: string;
  mode: ActionMode;
  /** Иконка для меню редактора (набор lucide). */
  icon: string;
  /**
   * Чьей моделью прогонять. Пусто — той, что стоит в шапке панели.
   *
   * Зачем: цена вопроса у действий разная. Орфографию правит самая дешёвая
   * модель и правит не хуже дорогой, «оценить текст» без сильной не имеет
   * смысла, а поиск фактов нужно вести там, где есть веб. Держать это в шапке
   * значит переключать её перед каждым нажатием — и однажды забыть.
   *
   * Имя провайдера, а не модель: модель у провайдера уже выбрана в его профиле,
   * и хранить её вторым местом — значит развести два разных ответа на вопрос
   * «чем работает Polza».
   */
  provider?: string;
  /** Встроенные действия нельзя удалить, но промпт можно переписать. */
  builtin?: boolean;
}

/** Заготовки создаются на языке интерфейса — их видно и правится в настройках. */
export function defaultActions(): AiAction[] {
  return [
    {
      id: "spelling",
      name: t("actSpelling"),
      prompt: t("actSpellingPrompt"),
      mode: "replace",
      icon: "spell-check",
      builtin: true,
    },
    {
      id: "clarify",
      name: t("actClarify"),
      prompt: t("actClarifyPrompt"),
      mode: "replace",
      icon: "wand-sparkles",
      builtin: true,
    },
    {
      id: "expand",
      name: t("actExpand"),
      prompt: t("actExpandPrompt"),
      mode: "replace",
      icon: "expand",
      builtin: true,
    },
    {
      id: "shorten",
      name: t("actShorten"),
      prompt: t("actShortenPrompt"),
      mode: "replace",
      icon: "scissors",
      builtin: true,
    },
    {
      id: "evaluate",
      name: t("actEvaluate"),
      prompt: t("actEvaluatePrompt"),
      mode: "chat",
      icon: "clipboard-check",
      builtin: true,
    },
  ];
}

/** Заготовка для своего действия: id случайный, чтобы не столкнуться с чужим. */
export function newAction(): AiAction {
  return {
    id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: t("actNewName"),
    prompt: "",
    mode: "replace",
    icon: "sparkles",
  };
}

/** Заводский промпт встроенного действия — для кнопки «Сбросить промпт». */
export function factoryPrompt(id: string): string | null {
  return defaultActions().find((a) => a.id === id)?.prompt ?? null;
}

/**
 * Хвост для правящих действий: без него модель любит поболтать, а заодно
 * причесать разметку. Оговорки про markdown и стихи живут здесь, а не в каждом
 * промпте: в заметках всё это одинаково — и в заводском действии, и в своём.
 */
export function systemFor(action: AiAction): string {
  if (action.mode === "chat") return action.prompt;
  return [action.prompt, t("promptKeepMarkup"), t("promptOnlyText")].join("\n\n");
}

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;
const QUOTED = /^(["'«“„])([\s\S]*)(["'»”“])$/;

/**
 * Ответ модели → текст, который не стыдно положить в заметку.
 * Снимаем обёртки, которых не было в оригинале, и возвращаем пробелы по краям
 * выделения: пользователь часто цепляет отступ или перевод строки, и без этого
 * замена склеивает слова с соседними.
 */
export function cleanReply(raw: string, original: string): string {
  let out = raw.trim();

  // Обёртка ```…``` — только если исходник не был блоком кода.
  if (!original.trim().startsWith("```")) {
    const fenced = out.match(FENCE);
    if (fenced) out = fenced[1].trim();
  }

  // Кавычки вокруг всего ответа — только если оригинал не был в кавычках и
  // внутри нет закрывающей кавычки того же вида (иначе это часть текста).
  const q = out.match(QUOTED);
  if (q && !QUOTED.test(original.trim()) && !q[2].includes(q[1]) && !q[2].includes(q[3])) {
    out = q[2].trim();
  }

  const lead = original.match(/^\s*/)?.[0] ?? "";
  const tail = original.match(/\s*$/)?.[0] ?? "";
  return lead + out + tail;
}

/**
 * Строка и колонка → смещение в тексте. Нужно там, где редактора уже нет:
 * координаты правки записаны, а считать по ним приходится в сыром файле.
 * null — такого места в тексте нет (заметку успели укоротить).
 */
export function offsetAt(text: string, line: number, ch: number): number | null {
  let at = 0;
  for (let n = 0; n < line; n++) {
    const nl = text.indexOf("\n", at);
    if (nl === -1) return null;
    at = nl + 1;
  }
  const end = text.indexOf("\n", at);
  const width = (end === -1 ? text.length : end) - at;
  return ch > width ? null : at + ch;
}

/** Есть ли в выделении хоть что-то осмысленное. */
export function hasText(s: string): boolean {
  return s.trim().length > 0;
}

const HEADING = /^(#{1,6})\s/;
/** Строка, открывающая или закрывающая блок кода, — в отличие от FENCE выше, целиком. */
const FENCE_LINE = /^\s{0,3}(```|~~~)/;
/** Черта на всю строку: `---`, `***`, `___` и то же самое через пробелы. */
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/**
 * Уровень заголовка в каждой строке (0 — не заголовок) и с какой строки
 * начинается сама заметка.
 *
 * Считаем сами, а не спрашиваем metadataCache: тот знает файл, каким он
 * записан на диск, а правим мы то, что набрано в редакторе сию секунду, — и
 * разъехавшиеся на пару строк координаты означают правку не того куска.
 * Решётка внутри ``` — это код, а не заголовок; frontmatter не текст заметки
 * вовсе, и модели там делать нечего.
 */
function scanHeadings(lines: string[]): { levels: number[]; start: number } {
  const levels = new Array<number>(lines.length).fill(0);
  let start = 0;
  let fence = "";
  let front = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^---\s*$/.test(line)) {
      front = true;
      continue;
    }
    if (front) {
      if (/^(---|\.\.\.)\s*$/.test(line)) {
        front = false;
        start = i + 1;
      }
      continue;
    }
    const open = line.match(FENCE_LINE);
    if (open) {
      // Закрывает ограду только такая же: ``` внутри ~~~ — это текст примера.
      if (!fence) fence = open[1];
      else if (open[1] === fence) fence = "";
      continue;
    }
    if (fence) continue;
    const heading = line.match(HEADING);
    if (heading) levels[i] = heading[1].length;
  }
  return { levels, start };
}

/**
 * Раздел, в котором стоит курсор: от ближайшего заголовка сверху до
 * следующего того же или старшего уровня. Подразделы — часть раздела, поэтому
 * «###» под «##» его не обрывает.
 *
 * Заголовок входит в раздел: без него модель не знает, о чём текст, а разметку
 * она бережёт по общей оговорке. Выше первого заголовка тоже раздел — начало
 * заметки; заголовков нет вовсе — вся заметка и есть один раздел.
 *
 * Пустые строки и черту с конца отбрасываем: модель их не вернёт, и раздел
 * слипся бы со следующим заголовком.
 */
export function sectionAt(lines: string[], at: number): { from: number; to: number } {
  if (lines.length === 0) return { from: 0, to: 0 };
  const last = lines.length - 1;
  const scanned = scanHeadings(lines);
  // Заметка из одного frontmatter: текст начинается там, где его уже нет.
  // Без этого начало раздела уезжало за последнюю строку, и диапазон
  // получался вывернутым.
  const start = Math.min(scanned.start, last);
  const levels = scanned.levels;
  const cursor = Math.min(Math.max(at, start), last);

  let from = start;
  let level = 0;
  for (let i = cursor; i >= start; i--) {
    if (levels[i]) {
      from = i;
      level = levels[i];
      break;
    }
  }

  // Из начала заметки (заголовка над курсором нет) выходим на первом же
  // заголовке — любого уровня.
  const stop = level || 7;
  let to = last;
  for (let i = from + 1; i < lines.length; i++) {
    if (levels[i] && levels[i] <= stop) {
      to = i - 1;
      break;
    }
  }
  while (to > from) {
    const line = lines[to];
    // Черта между разделами принадлежит промежутку, а не тексту: модель её не
    // вернёт, и разделы слиплись бы. Отбрасываем, только если над ней пустая
    // строка: «Заголовок\n---» — это тоже заголовок, просто сетекстом.
    const rule = RULE.test(line) && !hasText(lines[to - 1] ?? "");
    if (hasText(line) && !rule) break;
    to--;
  }
  return { from, to };
}

/**
 * Заголовок раздела без решёток — подписью в журнале правок. Пусто, если
 * раздел начинается не с заголовка: это начало заметки, и называть его нечем.
 */
export function sectionName(line: string): string {
  if (!HEADING.test(line)) return "";
  const title = line.replace(HEADING, "").trim();
  return title.length > 30 ? title.slice(0, 29) + "…" : title;
}

/** Короткая подпись действия для уведомлений и статус-бара. */
export function shortName(action: AiAction): string {
  return action.name.length > 28 ? action.name.slice(0, 27) + "…" : action.name;
}
