/*
 * Пословное сравнение «было → стало» для показа правок.
 *
 * Зачем: после «исправить орфографию» на всей заметке глазами не поймать, что
 * именно изменилось, — а модель могла заодно причесать то, что трогать не
 * просили.
 *
 * Отдаём не пары «слово → слово», а поток кусков вперемешку с уцелевшим
 * текстом: вырванное из фразы слово ничего не говорит, а та же правка внутри
 * своей строки читается сразу. Длинные неизменные куски сворачиваются в «…»,
 * иначе на месте одной опечатки пришлось бы листать всю заметку.
 */

export type SegmentKind = "same" | "del" | "ins" | "gap";

export interface DiffSegment {
  kind: SegmentKind;
  text: string;
}

export interface DiffResult {
  segments: DiffSegment[];
  /** Правок оказалось столько, что показывать их бессмысленно, — только счёт. */
  tooMany: boolean;
  added: number;
  removed: number;
}

/** Больше — считаем слишком долго; общий префикс и суффикс режутся заранее. */
const MAX_TOKENS = 3000;
/**
 * Съедает время и память именно произведение сторон, а не длина каждой: предел
 * в три тысячи с каждой стороны сам по себе разрешает девять миллионов клеток
 * на одно сравнение, чего телефон не прощает. Здесь оставлено столько, чтобы
 * переписанная целиком заметка обычного размера всё ещё показывалась правками —
 * ради этого карточку и смотрят, — а пара огромных текстов свернулась в счёт.
 */
const MAX_CELLS = 6_000_000;
/** Столько правок ещё можно осмотреть глазами. */
const MAX_CHANGES = 24;
/** Сколько символов уцелевшего текста оставляем вокруг правки. */
const CONTEXT = 70;

/** Слова и пробелы отдельными кусками: так замена одного слова видна как одна. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t !== "");
}

/** Счётчики везде в словах — иначе «добавлено 12» значит то одно, то другое. */
function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Сравнивает две версии текста. Возвращает null, если сравнивать нечего или
 * тексты слишком велики: лучше не показать список, чем подвесить Obsidian.
 */
export function diffWords(before: string, after: string): DiffResult | null {
  if (before === after) return null;

  const a = tokenize(before);
  const b = tokenize(after);

  // Совпадающие начало и конец в сравнении не участвуют — обычно это почти
  // весь текст, и без этого длинную заметку не осилить.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (midA.length === 0 && midB.length === 0) return null;
  if (
    midA.length > MAX_TOKENS ||
    midB.length > MAX_TOKENS ||
    midA.length * midB.length > MAX_CELLS
  ) {
    return {
      segments: [],
      tooMany: true,
      added: midB.filter((tk) => tk.trim()).length,
      removed: midA.filter((tk) => tk.trim()).length,
    };
  }

  const middle = collectSegments(midA, midB);
  const count = (kind: SegmentKind) =>
    middle.reduce((n, s) => (s.kind === kind ? n + words(s.text) : n), 0);
  const added = count("ins");
  const removed = count("del");

  // Отрезанные заранее начало и конец возвращаем как обычный уцелевший текст:
  // без них у первой и последней правки не было бы окружения.
  const whole: DiffSegment[] = [];
  if (head > 0) whole.push({ kind: "same", text: a.slice(0, head).join("") });
  whole.push(...middle);
  if (tail > 0) whole.push({ kind: "same", text: a.slice(a.length - tail).join("") });

  const groups = countGroups(middle);
  if (groups > MAX_CHANGES) {
    return { segments: shorten(cut(whole, MAX_CHANGES)), tooMany: true, added, removed };
  }
  return { segments: shorten(whole), tooMany: false, added, removed };
}

/** Соседние del+ins — одна правка, а не две: считаем именно правки. */
function countGroups(segments: DiffSegment[]): number {
  let groups = 0;
  let inside = false;
  for (const s of segments) {
    if (s.kind === "same" || s.kind === "gap") {
      inside = false;
      continue;
    }
    if (!inside) groups++;
    inside = true;
  }
  return groups;
}

/** Оставить первые N правок — дальше показывать всё равно нечего. */
function cut(segments: DiffSegment[], limit: number): DiffSegment[] {
  const out: DiffSegment[] = [];
  let groups = 0;
  let inside = false;
  for (const s of segments) {
    if (s.kind === "same" || s.kind === "gap") {
      inside = false;
    } else {
      if (!inside) groups++;
      inside = true;
      if (groups > limit) break;
    }
    out.push(s);
  }
  return out;
}

/** Обрезать слово по ближайшему пробелу, чтобы не рвать его посередине. */
function headOf(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const at = cut.lastIndexOf(" ");
  return at > n / 2 ? cut.slice(0, at) : cut;
}

function tailOf(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(-n);
  const at = cut.indexOf(" ");
  return at !== -1 && at < n / 2 ? cut.slice(at + 1) : cut;
}

/**
 * Длинные уцелевшие куски ужимаем до окружения правки. Что оставить, зависит от
 * соседей: перед первой правкой нужен только хвост куска, после последней —
 * только начало, между двумя правками — и то и другое.
 */
function shorten(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  segments.forEach((s, i) => {
    if (s.kind !== "same") {
      out.push(s);
      return;
    }
    const changeBefore = i > 0;
    const changeAfter = i < segments.length - 1;
    if (s.text.length <= CONTEXT * 2) {
      out.push(s);
      return;
    }
    if (changeBefore) out.push({ kind: "same", text: headOf(s.text, CONTEXT) });
    out.push({ kind: "gap", text: "…" });
    if (changeAfter) out.push({ kind: "same", text: tailOf(s.text, CONTEXT) });
  });
  return out;
}

/** Наибольшая общая подпоследовательность, дальше — сборка кусков. */
function collectSegments(a: string[], b: string[]): DiffSegment[] {
  const n = a.length;
  const m = b.length;
  // В клетке лежит длина общей подпоследовательности, а она не длиннее короткой
  // стороны: двух байт хватает с запасом, а памяти уходит вдвое меньше.
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  let same = "";
  let del = "";
  let ins = "";

  const flushChange = () => {
    if (del) out.push({ kind: "del", text: del });
    if (ins) out.push({ kind: "ins", text: ins });
    del = "";
    ins = "";
  };
  const flushSame = () => {
    if (same) out.push({ kind: "same", text: same });
    same = "";
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      if (a[i].trim()) {
        flushChange(); // общее слово закрывает группу правок
        same += a[i];
      } else if (del || ins) {
        // Общий пробел группу не закрывает: «сыра вкуснейшего» → «вкуснейшего
        // сыра» — одна правка. Но дописать его надо в обе стороны, иначе
        // соседние слова склеятся в «сыравкуснейшего».
        del += a[i];
        ins += b[j];
      } else {
        same += a[i];
      }
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      if (!del && !ins) flushSame();
      del += a[i++];
    } else {
      if (!del && !ins) flushSame();
      ins += b[j++];
    }
  }
  while (i < n) {
    if (!del && !ins) flushSame();
    del += a[i++];
  }
  while (j < m) {
    if (!del && !ins) flushSame();
    ins += b[j++];
  }
  flushChange();
  flushSame();

  return out;
}
