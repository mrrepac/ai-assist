/*
 * Разговор → markdown.
 *
 * Зачем: ответ, который пригодился, иначе некуда деть — только копировать по
 * одному сообщению. Отдельным модулем, а не в панели, чтобы формат можно было
 * проверить тестом, не поднимая ItemView.
 */
import { t } from "./i18n";
import { HistoryItem, isActionEntry } from "./types";

/** Реплика пользователя идёт цитатой — так видно, где вопрос, а где ответ. */
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? "> " + line : ">"))
    .join("\n");
}

/**
 * Записи журнала правок пропускаем: это отчёт о работе над заметкой, а не
 * разговор, и в сохранённом чате он только мешает. Пустая строка на выходе
 * означает, что сохранять нечего.
 */
export function chatToMarkdown(history: HistoryItem[], model: string, when: string): string {
  const parts: string[] = [];
  for (const item of history) {
    if (isActionEntry(item)) continue;
    if (!item.content.trim()) continue;
    if (item.role !== "user") {
      parts.push(`**${t("chatModel")}**\n\n${item.content}`);
      continue;
    }
    // Фрагмент, о котором был вопрос, идёт над ним: без него сохранённый
    // разговор начинается с «а покороче?» и ничего не значит.
    const asked = item.quote
      ? `*${t("chatNoteFragment")}*\n\n${quote(item.quote)}\n\n${quote(item.content)}`
      : quote(item.content);
    parts.push(`**${t("chatYou")}**\n\n${asked}`);
  }
  if (parts.length === 0) return "";
  return `*${t("chatNoteHead", { model, when })}*\n\n${parts.join("\n\n---\n\n")}\n`;
}
