/*
 * Что из ленты уходит в запрос.
 *
 * Зачем отдельно: за контекст платят на каждом вопросе, и мерить его штуками
 * сообщений нельзя — двадцать реплик бывают и на строчку, и на страницу. Здесь
 * же удобно проверить отбор тестом, не поднимая панель.
 */
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
