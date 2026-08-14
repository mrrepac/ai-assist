/*
 * Вложения чата: картинка, о которой вопрос.
 *
 * Зачем отдельным модулем: панель и без того большая, а работы здесь хватает —
 * прочитать файл, ужать его до разумного, при желании положить в хранилище и
 * превратить в адрес data:, который понимают модели. Чистые части — подгонка
 * сторон, имена, размеры — проверяются тестом, не поднимая Obsidian.
 *
 * Картинка уходит модели адресом data:image/…;base64,… прямо в реплике: так её
 * принимают все OpenAI-совместимые провайдеры, и не нужно никуда её выкладывать,
 * чтобы модель дотянулась.
 */
import { App, TFile } from "obsidian";
import { t } from "./i18n";
import { isPdfPath, pdfText } from "./pdf";
import { Attachment, isDoc } from "./types";

/**
 * Длинная сторона, до которой ужимаем. Модель всё равно смотрит на картинку
 * плитками своего размера, а платит пользователь за каждую: фотография с
 * телефона в исходном виде — это мегабайты base64 и заметная строчка в счёте,
 * тогда как читается на ней ровно то же самое.
 */
export const MAX_SIDE = 1200;

/**
 * Ниже этого веса картинку не трогаем вовсе, даже если формат необычный:
 * пересжатие всегда чуть портит текст на скриншоте, и ради сотни килобайт
 * этого делать не стоит.
 */
export const SOFT_BYTES = 700 * 1024;

/** Форматы, которые понимают модели: остальные пересобираем через canvas. */
const SAFE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Что плагин соглашается взять вложением. Всё это Electron умеет нарисовать. */
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  pdf: "application/pdf",
};

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.includes(extOf(path));
}

/** Всё, что плагин соглашается взять вложением: картинка или документ. */
export function isAttachablePath(path: string): boolean {
  return isImagePath(path) || isPdfPath(path);
}

/** MIME по имени файла: у файла с диска он есть, у пути в хранилище — нет. */
export function mimeOf(path: string): string {
  return MIME_BY_EXT[extOf(path)] ?? "application/octet-stream";
}

/**
 * Стороны после подгонки под предел. Пропорции сохраняются, увеличивать
 * нечего: маленькую картинку растягивать бессмысленно — деталей в ней от
 * этого не прибавится, а платить придётся как за большую.
 */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const side = Math.max(w, h);
  if (!Number.isFinite(side) || side <= 0) return { w: 1, h: 1 };
  if (side <= max) return { w, h };
  const k = max / side;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Вес человеческими единицами — он же цена вопроса, поэтому всегда на виду. */
export function humanSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return t("attachKb", { n: 1 });
  if (kb < 1024) return t("attachKb", { n: Math.round(kb) });
  return t("attachMb", { n: (kb / 1024).toFixed(1) });
}

/**
 * Имя для картинки, у которой его нет: из буфера приезжает голый Blob. Формат
 * как у самого Obsidian — «что это» плюс отметка времени, чтобы в папке
 * вложений такие файлы стояли рядом и опознавались с одного взгляда.
 */
export function pastedName(mime: string, stamp: string): string {
  const ext = Object.keys(MIME_BY_EXT).find((e) => MIME_BY_EXT[e] === mime) ?? "png";
  return `${t("attachPasted")} ${stamp}.${ext === "jpeg" ? "jpg" : ext}`;
}

/** Отметка времени для имени файла: без двоеточий, их не любит ни одна ФС. */
export function stamp(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}` +
    `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  );
}

/**
 * Картинки и документы, встроенные в текст заметки. Нужны, чтобы предложить их
 * списком: заметка уезжает модели как есть, и `![[photo.png]]` она видит
 * строчкой текста, а не изображением.
 */
export function embeddedFiles(text: string): string[] {
  const out: string[] = [];
  // Оба вида ссылок: внутренняя ![[…]] и обычная markdown ![](…).
  const wiki = /!\[\[([^\]|#^]+)/g;
  const md = /!\[[^\]]*\]\(([^)\s]+)/g;
  for (const re of [wiki, md]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const link = decodeURIComponent(m[1].trim());
      // Картинка из интернета — не файл хранилища, приложить её нечем.
      if (/^https?:/i.test(link)) continue;
      if (isAttachablePath(link) && !out.includes(link)) out.push(link);
    }
  }
  return out;
}

/** Данные вложений, у которых нет пути в хранилище. Живут ровно один сеанс. */
export class AttachmentStore {
  private blobs = new Map<string, Blob>();
  private urls = new Map<string, string>();
  /**
   * Текст документов. Держим здесь, а не в самой ленте: это десятки тысяч
   * знаков, а лента переписывается на диск на каждое слово. Документ из
   * хранилища при надобности читается заново, ему эта память не нужна вовсе.
   */
  private texts = new Map<string, string>();

  put(id: string, blob: Blob): void {
    this.blobs.set(id, blob);
  }

  get(id: string): Blob | null {
    return this.blobs.get(id) ?? null;
  }

  putText(id: string, text: string): void {
    this.texts.set(id, text);
  }

  getText(id: string): string | null {
    return this.texts.get(id) ?? null;
  }

  /**
   * Ссылка для <img>. Держим по одной на вложение: createObjectURL на каждую
   * перерисовку ленты — это утечка ровно на размер картинки за раз.
   */
  url(id: string): string | null {
    const known = this.urls.get(id);
    if (known) return known;
    const blob = this.blobs.get(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }

  forget(id: string): void {
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
    this.blobs.delete(id);
    this.texts.delete(id);
  }

  clear(): void {
    for (const id of [...this.blobs.keys()]) this.forget(id);
    this.texts.clear();
  }
}

/** Свой id вложения: по нему картинку находят и в памяти сеанса, и в ленте. */
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function encode(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
}

/**
 * Картинка в том виде, в каком её не жалко отправить: ужатая до MAX_SIDE и в
 * формате, который модель точно поймёт.
 *
 * Что не так с исходником: снимок экрана 4К весит мегабайты, а разобрать на
 * нём после ужатия можно ровно то же самое.
 *
 * null — картинку не разобрал сам Electron, и формат её моделям незнаком: так
 * приезжают, например, снимки с айфона. Отправлять такое значит платить за
 * запрос, который вернётся отказом, — честнее сказать сразу.
 */
export async function prepareImage(blob: Blob, maxSide = MAX_SIDE): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  // Не разобрали, но формат знакомый (бывает с битым EXIF) — отдаём как есть:
  // лишний вес лучше, чем потерянная картинка.
  if (!bitmap) return SAFE_MIME.includes(blob.type) ? blob : null;
  const { w, h } = fitSize(bitmap.width, bitmap.height, maxSide);
  const asIs = w === bitmap.width && h === bitmap.height;
  if (asIs && SAFE_MIME.includes(blob.type) && blob.size <= SOFT_BYTES) {
    bitmap.close();
    return blob;
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return blob;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // PNG держит текст на скриншоте чётким, но весит втрое больше; JPEG наоборот.
  // Берём то, что легче, — но PNG прощаем полуторакратный перевес: чаще всего
  // прикладывают именно снимок экрана, и читать на нём надо буквы.
  const png = blob.type === "image/png" ? await encode(canvas, "image/png") : null;
  // Прозрачный фон в JPEG становится чёрным, и по чёрному ничего не видно.
  // Подкладываем белое под уже нарисованное — PNG к этому моменту готов.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const jpeg = await encode(canvas, "image/jpeg", 0.85);

  if (png && (!jpeg || png.size <= jpeg.size * 1.5)) return png;
  return jpeg ?? blob;
}

/** Файл хранилища как Blob — картинку оттуда прикладывают чаще всего. */
export async function vaultBlob(app: App, path: string): Promise<Blob | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  try {
    const buf = await app.vault.readBinary(file);
    return new Blob([buf], { type: mimeOf(path) });
  } catch {
    return null;
  }
}

/**
 * Кладёт картинку в папку вложений — туда же, куда её кладёт сам Obsidian при
 * вставке в заметку: путь спрашиваем у него, чтобы настройка вложений
 * соблюдалась, какой бы она ни была.
 *
 * null — не вышло; тогда вложение остаётся жить в памяти сеанса, и вопрос всё
 * равно уходит: не отправить картинку из-за того, что её некуда положить, было
 * бы худшим из решений.
 */
export async function saveToVault(
  app: App,
  blob: Blob,
  name: string,
  sourcePath: string,
): Promise<string | null> {
  try {
    const path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
    // Файловая система Windows регистр не различает, а Obsidian ищет по точному
    // совпадению: «Вложения/Рисунок.png» и «вложения/рисунок.png» для него разные
    // файлы, а для диска один — и createBinary записал бы поверх чужого.
    if (takenIgnoringCase(app, path)) return null;
    const file = await app.vault.createBinary(path, await blob.arrayBuffer());
    return file.path;
  } catch (e) {
    console.error("ai-assist: не удалось сохранить вложение", e);
    return null;
  }
}

function takenIgnoringCase(app: App, path: string): boolean {
  const lower = path.toLowerCase();
  return app.vault.getFiles().some((f) => f.path.toLowerCase() === lower);
}

/**
 * Картинка вложения адресом data: — тем, что уедет модели.
 *
 * Порядок такой: сперва память сеанса, потом хранилище. Пути может не быть
 * вовсе, а может не быть уже самого файла: картинку переименовали или удалили,
 * и тогда честный ответ — null, а не пустая строка вместо изображения.
 */
export async function attachmentData(
  app: App,
  store: AttachmentStore,
  att: Attachment,
): Promise<string | null> {
  let blob = store.get(att.id);
  if (!blob && att.path) {
    const raw = await vaultBlob(app, att.path);
    const ready = raw ? await prepareImage(raw) : null;
    if (ready) {
      blob = ready;
      store.put(att.id, ready);
    }
  }
  if (!blob) return null;
  return blobToDataUrl(blob);
}

/**
 * Текст документа — то, что уедет модели вместо самого файла.
 *
 * Порядок тот же, что у картинки: сперва память сеанса, потом хранилище.
 * Документ, принесённый с диска, в хранилище не копируется, поэтому после
 * перезапуска брать его неоткуда — и это честный null, а не пустой текст.
 */
export async function attachmentText(
  app: App,
  store: AttachmentStore,
  att: Attachment,
): Promise<string | null> {
  if (!isDoc(att)) return null;
  const known = store.getText(att.id);
  if (known !== null) return known;
  if (!att.path) return null;
  const blob = await vaultBlob(app, att.path);
  if (!blob) return null;
  const found = await pdfText(await blob.arrayBuffer());
  if (!found) return null;
  store.putText(att.id, found.text);
  return found.text;
}

/**
 * Ссылка, по которой вложение видно на экране. У файла хранилища она своя и
 * ничего не стоит; у картинки из памяти сеанса — временная.
 */
export function attachmentUrl(app: App, store: AttachmentStore, att: Attachment): string | null {
  const own = store.url(att.id);
  if (own) return own;
  if (!att.path) return null;
  const file = app.vault.getAbstractFileByPath(att.path);
  return file instanceof TFile ? app.vault.getResourcePath(file) : null;
}
