/*
 * Разговор → markdown.
 *
 * Зачем: ответ, который пригодился, иначе некуда деть — только копировать по
 * одному сообщению. Отдельным модулем, а не в панели, чтобы формат можно было
 * проверить тестом, не поднимая ItemView.
 */
import { Source } from "./api";
import { stripCitations } from "./cite";
import { t } from "./i18n";
import { Attachment, HistoryItem, isActionEntry, isDoc } from "./types";

/**
 * Вложения над вопросом. Лежащее в хранилище встаёт обычной ссылкой — картинка
 * в заметке и покажется картинкой; у того, что жило в памяти, показывать
 * нечего, и врать про это ссылкой на несуществующий файл нельзя.
 *
 * Документ идёт простой ссылкой, без восклицательного знака: встроенный PDF
 * разворачивается в заметке читалкой на пол-экрана, а сохранённый разговор
 * читают ради разговора.
 */
function attachLines(files: Attachment[] | undefined): string {
  if (!files?.length) return "";
  const lines = files.map((f) => {
    if (!f.path) return `*${t("chatAttachNotSaved")}*`;
    return isDoc(f) ? `[[${f.path}]]` : `![[${f.path}]]`;
  });
  return lines.join("\n") + "\n\n";
}

/**
 * Список источников под ответом. Нумерация сквозная: в самом тексте ссылок на
 * номера уже нет, а выброшенный повтор оставил бы в списке дырку.
 */
function sourceList(sources: Source[] | undefined): string {
  if (!sources?.length) return "";
  const lines = sources.map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url})`);
  return `\n\n*${t("chatSources", { n: sources.length })}*\n\n${lines.join("\n")}`;
}

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
    // Вопрос из одних картинок текста не имеет вовсе, а сохранять его надо.
    if (!item.content.trim() && !(item.role === "user" && item.attachments?.length)) continue;
    if (item.role !== "user") {
      // Хвосты вида [1][6] из текста убираем, а список источников дописываем:
      // сохранённый ответ поисковой модели без них — набор утверждений, которые
      // больше нечем проверить.
      const answer = stripCitations(item.content, item.sources);
      parts.push(`**${t("chatModel")}**\n\n${answer}${sourceList(item.sources)}`);
      continue;
    }
    // Фрагмент, о котором был вопрос, идёт над ним: без него сохранённый
    // разговор начинается с «а покороче?» и ничего не значит.
    // Вопрос мог быть и одной картинкой — тогда цитировать нечего.
    const body = item.content.trim() ? quote(item.content) : "";
    const asked = item.quote
      ? `*${t("chatNoteFragment")}*\n\n${quote(item.quote)}\n\n${body}`
      : body;
    parts.push(`**${t("chatYou")}**\n\n${attachLines(item.attachments)}${asked}`.trimEnd());
  }
  if (parts.length === 0) return "";
  return `*${t("chatNoteHead", { model, when })}*\n\n${parts.join("\n\n---\n\n")}\n`;
}
