/*
 * Что из ленты уходит в запрос.
 *
 * Зачем отдельно: за контекст платят на каждом вопросе, и мерить его штуками
 * сообщений нельзя — двадцать реплик бывают и на строчку, и на страницу. Здесь
 * же удобно проверить отбор тестом, не поднимая панель.
 */
import { ContentPart } from "./api";
import { HistoryItem, StoredChatMessage, isActionEntry } from "./types";

/**
 * Сколько символов ленты максимум уходит в запрос. Примерно 6–8 тысяч токенов:
 * разговор помнится, а счёт за него не растёт с каждым словом.
 */
export const CONTEXT_BUDGET = 24000;

/** Верхний предел на всякий случай: сотня коротких «ага» — тоже не контекст. */
export const CONTEXT_MESSAGES = 40;

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

/**
 * Реплика так, как она уходит в запрос. Без картинок — прежней строкой: массив
 * кусков понимают не все модели, и городить его на каждый вопрос ни за чем
 * нельзя. Картинки идут после текста: сперва вопрос, потом то, о чём он.
 */
export function messageContent(m: StoredChatMessage, images: string[] = []): string | ContentPart[] {
  const gone = !images.length && !!m.attachments?.length;
  const text = gone ? `${messageText(m)}\n\n${IMAGE_GONE}` : messageText(m);
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
