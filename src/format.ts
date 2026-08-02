/*
 * Чистка пробелов и пустых строк — своими руками, без модели.
 *
 * Зачем без модели: решать тут нечего, правила одни и те же для любого текста.
 * Запрос стоил бы денег и секунд ожидания, а модель попутно правит слова, о
 * которых её не просили. Здесь результат мгновенный, всегда один и тот же, и
 * возвращается обычным Ctrl+Z.
 *
 * Чего не трогаем совсем: блоки кода, шапку YAML, имена файлов в [[…]], код в
 * строке и колонки таблиц — там пробел значит ровно то, что написано. Отступ
 * слева тоже неприкосновенен: на нём держатся списки, цитаты и вложенность.
 */
import { t } from "./i18n";

export interface FormatStats {
  /** Убранные пустые строки. */
  blanks: number;
  /** Пробелы: подряд идущие, лишние в конце строки и перед знаком препинания. */
  spaces: number;
  /** Неразрывные пробелы, знаки нулевой ширины, мягкие переносы. */
  invisible: number;
}

export interface FormatResult {
  text: string;
  stats: FormatStats;
}

/** Пробелы, которые выглядят обычными: приезжают с веба и ломают поиск. */
const ODD_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** Знаков не видно вовсе, а слово они рвут — их место в мусоре из PDF. */
const INVISIBLE = /[\r\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Пробел перед знаком препинания. Правило нарочно узкое, и вот почему:
 *
 * слева должна стоять буква или цифра — иначе «да ведь, , Малые Мытищи»
 * схлопнется в «, ,» → «,,», а разреженное многоточие «. . . odours» из
 * шекспировской реплики станет «... odours»;
 *
 * справа за знаком — пробел или конец строки, то есть знак стоит там, где
 * надо. В «и ,чёрт знает» пробел просто уехал не на ту сторону, и убрать его
 * значит получить «и,чёрт»; такое чинится руками, а не правилом.
 *
 * Двоеточия и скобки в списке нет: « :)» — смайлик. Многоточия тоже: « …А
 * любовник» и «оружие!)* … C’est bon» набраны так намеренно.
 */
const BEFORE_PUNCT = /([\p{L}\p{N})\]»”"'*])[ \t]+([,;.!?»]+)(?=$|[\s"'«»)\]—–-])/gu;

/** Куски, внутри которых пробелы значимы, прячем на время чистки. */
const KEEP = /\[\[[^\]\n]*\]\]|`[^`\n]*`/g;
/** Подстановка вместо спрятанного куска: в тексте заметки такого знака нет. */
const MASK = "\u0000";

/** Открытие и закрытие блока кода: три знака и больше, можно с отступом. */
const FENCE = /^(```+|~~~+)/;

/** Одна строка: невидимое, лишние пробелы, хвост в конце. */
function cleanLine(line: string, stats: FormatStats): string {
  const kept: string[] = [];
  let s = line.replace(KEEP, (m) => {
    kept.push(m);
    return MASK;
  });

  s = s.replace(INVISIBLE, () => {
    stats.invisible++;
    return "";
  });
  s = s.replace(ODD_SPACE, () => {
    stats.invisible++;
    return " ";
  });

  // Строка из одних пробелов — это пустая строка, набранная неаккуратно.
  if (!s.trim()) {
    if (s) stats.spaces++;
    return "";
  }

  const indent = /^[ \t]*/.exec(s)![0];
  let body = s.slice(indent.length);

  // Хвост откладываем сразу, до схлопывания: ровно два пробела на конце —
  // жёсткий перенос строки в markdown, в стихах и песнях их ставят нарочно.
  // Один пробел не значит ничего, три и больше — набрано мимо, это мусор.
  const tail = /[ \t]+$/.exec(body)?.[0] ?? "";
  if (tail) body = body.slice(0, -tail.length);
  const keepTail = tail === "  ";
  if (tail && !keepTail) stats.spaces++;

  body = body.replace(BEFORE_PUNCT, (_m, word: string, punct: string) => {
    stats.spaces++;
    return word + punct;
  });
  // В таблице пробелы держат колонки ровными — там их не трогаем.
  if (!body.startsWith("|")) {
    body = body.replace(/[ \t]{2,}/g, () => {
      stats.spaces++;
      return " ";
    });
  }

  let i = 0;
  return (indent + body + (keepTail ? tail : "")).replace(/\u0000/g, () => kept[i++]);
}

/**
 * Причёсанный текст и счёт того, что убрали.
 *
 * trimEdges — можно ли трогать края. Выделение сделали руками, значит его края
 * упираются в чужой текст: пробел или перенос там надо вернуть как был, иначе
 * замена склеит соседние слова. Когда текст взят целой заметкой, края наши, и
 * пустые строки в начале и в конце тоже лишние.
 */
export function formatText(raw: string, opts: { trimEdges: boolean }): FormatResult {
  const stats: FormatStats = { blanks: 0, spaces: 0, invisible: 0 };
  if (!raw.trim()) return { text: raw, stats };

  const lines = raw.split("\n");
  const out: string[] = [];
  /** Знак открытого блока кода или null, если мы снаружи. */
  let fence: string | null = null;
  let front = lines[0] === "---";
  let blank = 0;

  lines.forEach((line, i) => {
    if (front) {
      out.push(line);
      if (i > 0 && (line === "---" || line === "...")) front = false;
      return;
    }

    const mark = FENCE.exec(line.trim())?.[1] ?? null;
    if (fence !== null) {
      out.push(line);
      // Закрыть блок может только забор не короче открывшего.
      if (mark && mark.startsWith(fence)) fence = null;
      return;
    }
    if (mark) {
      fence = mark;
      blank = 0;
      out.push(cleanLine(line, stats));
      return;
    }

    const cleaned = cleanLine(line, stats);
    if (cleaned === "") {
      blank++;
      // Одна пустая строка отделяет абзац или строфу, вторая подряд — лишняя.
      if (blank > 1) {
        stats.blanks++;
        return;
      }
    } else {
      blank = 0;
    }
    out.push(cleaned);
  });

  let text = out.join("\n");
  if (opts.trimEdges) {
    text = text
      .replace(/^\n+/, (m) => {
        stats.blanks += m.length;
        return "";
      })
      .replace(/\n+$/, (m) => {
        stats.blanks += m.length;
        return "";
      });
  } else {
    text = /^\s*/.exec(raw)![0] + text.trim() + /\s*$/.exec(raw)![0];
  }

  return { text, stats };
}

/** Короткий отчёт для журнала: показывать сам текст незачем, он уже в заметке. */
export function formatSummary(stats: FormatStats): string {
  const parts: string[] = [];
  if (stats.blanks) parts.push(t("fmtBlanks", { n: stats.blanks }));
  if (stats.spaces) parts.push(t("fmtSpaces", { n: stats.spaces }));
  if (stats.invisible) parts.push(t("fmtInvisible", { n: stats.invisible }));
  return parts.length ? t("fmtCleaned", { what: parts.join(", ") }) : "";
}
