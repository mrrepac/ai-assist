/*
 * Что из ленты уходит в запрос.
 *
 * Зачем отдельно: за контекст платят на каждом вопросе, и мерить его штуками
 * сообщений нельзя — двадцать реплик бывают и на строчку, и на страницу. Здесь
 * же удобно проверить отбор тестом, не поднимая панель.
 */
import { ContentPart } from "./api";
import { HistoryItem, StoredChatMessage, isActionEntry, isDoc } from "./types";

/**
 * Сколько символов ленты максимум уходит в запрос. Примерно 6–8 тысяч токенов:
 * разговор помнится, а счёт за него не растёт с каждым словом.
 */
export const CONTEXT_BUDGET = 24000;

/** Верхний предел на всякий случай: сотня коротких «ага» — тоже не контекст. */
export const CONTEXT_MESSAGES = 40;

/** Сколько знаков заметки максимум уходит в запрос — целиком или фрагментом. */
export const NOTE_LIMIT = 40000;

/**
 * Заметка под предел: длинную берём началом. Что она обрезана, говорим и
 * модели, и пользователю — иначе ответ по половине текста выглядит как ответ
 * по всему. Живёт здесь, а не в плагине: одну и ту же заметку режут и контекст
 * чата, и фрагмент, брошенный на плашку, — предел у них обязан быть общим.
 */
export function clipNote(text: string, limit = NOTE_LIMIT): { text: string; clipped: boolean } {
  if (text.length <= limit) return { text, clipped: false };
  return { text: text.slice(0, limit), clipped: true };
}

/**
 * Реплика так, как её видит модель: вопрос вместе с фрагментом, о котором он
 * задан. Без фрагмента следующий вопрос («а короче?») повисает в воздухе.
 */
export function messageText(m: StoredChatMessage): string {
  return m.quote ? `[Selected fragment of the note]\n${m.quote}\n\n${m.content}` : m.content;
}

/**
 * Приписка к прошлой реплике, картинки которой в этот запрос не пошли: за
 * каждую платят на каждом вопросе, и старые в какой-то момент остаются позади.
 * Без этой строчки разговор выглядит как вопросы о пустоте.
 */
export const IMAGE_GONE = "[An image was attached to this message; it is not included here.]";
export const DOC_GONE = "[A document was attached to this message; it is not included here.]";
export const DOC_CLIPPED = "[The document is longer than this — only the beginning is shown.]";

/** Документ, приложенный к вопросу: он уходит текстом, а не файлом. */
export interface AttachedDoc {
  name: string;
  text: string;
  clipped: boolean;
}

/**
 * Документ так, как его видит модель. Имя названо вслух: по нему видно, что
 * это приложенный файл, а не кусок разговора, и на него можно сослаться в
 * ответе. Про обрезку говорим там же — ответ по началу документа выглядит
 * точно так же, как ответ по всему.
 */
export function docBlock(doc: AttachedDoc): string {
  return `[Document "${doc.name}"]\n\n${doc.text}` + (doc.clipped ? `\n\n${DOC_CLIPPED}` : "");
}

/**
 * Реплика так, как она уходит в запрос. Без вложений — прежней строкой: массив
 * кусков понимают не все модели, и городить его на каждый вопрос ни за чем
 * нельзя.
 *
 * Документы идут перед вопросом, как и фрагмент заметки: сперва то, о чём
 * спрашивают, потом сам вопрос. Картинки — после текста, отдельными кусками.
 */
export function messageContent(
  m: StoredChatMessage,
  images: string[] = [],
  docs: AttachedDoc[] = [],
): string | ContentPart[] {
  const attached = m.attachments ?? [];
  // Вложение, которое в этот запрос не пошло, называем словами — иначе вопрос
  // «что тут не так?» указывает в пустоту.
  const gone: string[] = [];
  if (!images.length && attached.some((a) => !isDoc(a))) gone.push(IMAGE_GONE);
  if (!docs.length && attached.some(isDoc)) gone.push(DOC_GONE);

  const text = [...docs.map(docBlock), messageText(m), ...gone].filter(Boolean).join("\n\n");
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

/**
 * Последние сообщения разговора, влезающие в бюджет. Идём с конца: ближнее к
 * вопросу нужнее давнего. Записи журнала правок пропускаем — модели незачем
 * читать отчёт о своей работе.
 */
export function contextWindow(
  history: HistoryItem[],
  budget = CONTEXT_BUDGET,
  limit = CONTEXT_MESSAGES,
): StoredChatMessage[] {
  const out: StoredChatMessage[] = [];
  let left = budget;
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (isActionEntry(item)) continue;
    // Первое сообщение берём даже если оно одно длиннее бюджета: разговор без
    // предыдущей реплики понятнее, чем разговор без единой.
    const size = messageText(item).length;
    if (out.length > 0 && (size > left || out.length >= limit)) break;
    left -= size;
    out.push(item);
  }
  return out.reverse();
}
