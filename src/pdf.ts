/*
 * Текст из PDF.
 *
 * Зачем: документ уходит модели текстом, а не файлом. Так он понятен всем
 * провайдерам без исключения — включая DeepSeek, который картинок не принимает
 * вовсе, — и не стоит ничего сверх самих знаков.
 *
 * Читаем текстовый слой, который в PDF уже лежит. Это не распознавание: в
 * фотографии страницы текста нет вовсе, и оттуда взять нечего — про такой
 * документ честнее сказать вслух.
 *
 * Свою pdf.js не тащим: она уже внутри Obsidian — на ней стоит его читалка
 * PDF. Полтора мегабайта в сборке плагина за то, что и так лежит рядом,
 * платить незачем.
 */

/**
 * Сколько знаков документа максимум уходит в запрос. Тот же нож, что у заметки
 * в контексте: PDF на тридцать страниц — это больше, чем весь разговор.
 */
export const PDF_LIMIT = 40000;

/** Где Obsidian держит свою pdf.js. Тот же путь, каким её грузит он сам. */
const PDFJS_SRC = "/lib/pdfjs/pdf.min.mjs";
const PDFJS_WORKER = "/lib/pdfjs/pdf.worker.min.mjs";

/** Ровно те поля pdf.js, которые читаем: полных типов у неё здесь нет. */
interface TextItem {
  str?: string;
  /** Кусок закрывает строку — иначе абзацы слиплись бы в одну простыню. */
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface Pdfjs {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
}

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

/**
 * Куски текста одной страницы — в связный текст. pdf.js отдаёт их так, как они
 * нарисованы: обрывками строк, и склеенные подряд они превращаются в простыню
 * без единого переноса.
 *
 * Пробел между обрывками одной строки нужен, а перед знаком препинания — нет:
 * иначе каждая запятая отъезжает от слова.
 */
export function joinItems(items: TextItem[]): string {
  let out = "";
  for (const item of items) {
    const part = item?.str ?? "";
    if (part) {
      const last = out.slice(-1);
      const needsSpace = last && last !== " " && last !== "\n" && !/^[\s.,;:!?)\]»…]/.test(part);
      out += (needsSpace ? " " : "") + part;
    }
    if (item?.hasEOL) out += "\n";
  }
  return out;
}

/**
 * Пустые строки пачками и пробелы по краям строк: в PDF они берутся из
 * вёрстки, а модели уезжают знаками, за которые платят.
 */
export function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Документ до предела длины. Режем по границе страницы, а не по знаку:
 * оборванная на полуслове страница читается как ошибка чтения, а не как
 * сознательная обрезка.
 */
export function clipPages(pages: string[], limit = PDF_LIMIT): { text: string; clipped: boolean } {
  const kept: string[] = [];
  let left = limit;
  for (const page of pages) {
    // Первую страницу берём даже если она одна длиннее предела: документ без
    // начала бесполезен, а обрезку мы всё равно называем вслух.
    if (kept.length > 0 && page.length > left) return { text: kept.join("\n\n"), clipped: true };
    kept.push(page);
    left -= page.length;
  }
  return { text: kept.join("\n\n"), clipped: false };
}

/** Что вышло из документа. null оттуда, где читать было нечем. */
export interface PdfText {
  text: string;
  pages: number;
  clipped: boolean;
}

/**
 * pdf.js из самого Obsidian. Она грузится лениво — пока в приложении не
 * открыли ни одного PDF, глобали нет, — поэтому при её отсутствии подгружаем
 * тем же путём, каким это делает он сам.
 *
 * Импорт через `new Function`: обычный `import()` esbuild разбирает на сборке
 * и попытался бы уложить чужой файл внутрь main.js, которого там нет и быть не
 * может. Так строка доживает до рантайма нетронутой.
 */
export async function loadPdfjs(): Promise<Pdfjs | null> {
  const w = window as unknown as { pdfjsLib?: Pdfjs };
  if (w.pdfjsLib) return w.pdfjsLib;
  try {
    const load = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
    const mod = (await load(PDFJS_SRC)) as Pdfjs | null;
    const lib = w.pdfjsLib ?? mod;
    if (!lib?.getDocument) return null;
    // Свой воркер выставляем, только если его ещё нет: у загруженной самим
    // Obsidian библиотеки это поле только для чтения, и присваивание туда
    // молча ни к чему не приводит.
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return lib;
  } catch (e) {
    console.error("ai-assist: не удалось загрузить pdf.js", e);
    return null;
  }
}

/**
 * Текст документа. null — прочитать нечем или файл не открылся; пустой текст
 * при живом документе означает скан: страницы есть, а текстового слоя в них
 * нет, и говорить об этом надо отдельно.
 */
export async function pdfText(bytes: ArrayBuffer, limit = PDF_LIMIT): Promise<PdfText | null> {
  const lib = await loadPdfjs();
  if (!lib) return null;

  let doc: PdfDoc | null = null;
  try {
    // Копия, а не сам буфер: pdf.js забирает его себе, и второе чтение того же
    // вложения нашлось бы уже опустошённым.
    doc = await lib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false })
      .promise;
    const pages: string[] = [];
    let total = 0;
    /** Вышли из чтения, не дойдя до последней страницы, — часть файла не видели. */
    let stopped = false;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = tidy(joinItems(content.items as TextItem[]));
      if (text) pages.push(text);
      total += text.length;
      // Дальше читать незачем: в запрос всё равно уедет только начало, а
      // страницы разбираются не бесплатно.
      if (total > limit) {
        stopped = n < doc.numPages;
        break;
      }
    }
    const { text, clipped } = clipPages(pages, limit);
    // Не «total > limit»: единственная страница длиннее предела уезжает целиком
    // — так решено в clipPages, — и объявлять её началом значит врать дважды.
    // На плашке появлялось «только начало», а модель получала приписку о том,
    // что документ обрезан, и отказывалась судить по «неполному» тексту.
    return { text, pages: doc.numPages, clipped: clipped || stopped };
  } catch (e) {
    console.error("ai-assist: не удалось прочитать PDF", e);
    return null;
  } finally {
    // Документ держит воркер и разобранные страницы: без этого память уходит
    // на каждый прочитанный файл до конца сеанса.
    void doc?.destroy().catch(() => {});
  }
}
