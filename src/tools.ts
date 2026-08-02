import { ToolCall, ToolSpec } from "./api";
import { t } from "./i18n";

export type ToolName =
  | "read_note"
  | "insert_text"
  | "replace_in_note"
  | "replace_note"
  | "replace_selection"
  | "append_to_note"
  | "create_note";

const TOOL_NAMES: ToolName[] = [
  "read_note",
  "insert_text",
  "replace_in_note",
  "replace_note",
  "replace_selection",
  "append_to_note",
  "create_note",
];

/**
 * Почему не просто «получилось / не получилось»: модель должна понять, что
 * делать дальше. Не нашли фрагмент — перечитать заметку, нашли несколько —
 * удлинить искомое, ушли из заметки — не пытаться снова.
 */
export type ReplaceResult = "ok" | "missing" | "many" | "gone";

/**
 * Что панель умеет делать с хранилищем по просьбе модели. Пишущие инструменты
 * принимают путь заметки: он выбирается один раз, когда карточка появляется на
 * экране, и правка либо ложится туда, либо не ложится никуда.
 */
export interface ToolHost {
  /** Заметка, в которую сейчас пошла бы правка. */
  targetPath(): string | null;
  readNote(): { path: string; text: string } | null;
  /** Текст заметки целиком, без урезания, — чтобы показать правку на карточке. */
  noteText(path: string): string | null;
  insertText(text: string, path: string): boolean;
  replaceInNote(find: string, replace: string, path: string): ReplaceResult;
  replaceNote(text: string, path: string): boolean;
  replaceSelection(text: string, path: string): boolean;
  appendToNote(text: string, path: string): boolean;
  createNote(title: string, text: string): Promise<string | null>;
}

const TEXT_PARAM = {
  type: "object",
  properties: { text: { type: "string", description: "Markdown text to write." } },
  required: ["text"],
};

/**
 * Описания идут модели, поэтому по-английски и подчёркнуто конкретно: без
 * «use it when appropriate» модель либо не зовёт инструмент вовсе, либо зовёт
 * его на каждый чих.
 */
export function toolSpecs(): ToolSpec[] {
  return [
    {
      type: "function",
      function: {
        name: "read_note",
        description:
          "Read the note the user currently has open in the editor. Call this before editing " +
          "when you need to know what is already written there.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "insert_text",
        description:
          "Insert new text into the open note at the cursor. Use it to add something that is " +
          "not in the note yet — do it instead of telling the user to copy it. To change text " +
          "that is already written, use replace_in_note instead, or you will duplicate it.",
        parameters: TEXT_PARAM,
      },
    },
    {
      type: "function",
      function: {
        name: "replace_in_note",
        description:
          "Replace one exact fragment of the open note with new text. This is the normal way " +
          "to fix or reword something the user has already written, and nothing needs to be " +
          "selected for it. `find` must match the note character for character and must occur " +
          "exactly once — include enough surrounding text to make it unique. For several edits " +
          "call this once per edit.",
        parameters: {
          type: "object",
          properties: {
            find: { type: "string", description: "The exact text to look for in the note." },
            replace: {
              type: "string",
              description: "What to put in its place. An empty string deletes the fragment.",
            },
          },
          required: ["find", "replace"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "replace_note",
        description:
          "Replace the whole contents of the open note. Only for a wholesale rewrite of the " +
          "entire text; for a local fix use replace_in_note, which is cheaper and safer.",
        parameters: TEXT_PARAM,
      },
    },
    {
      type: "function",
      function: {
        name: "replace_selection",
        description:
          "Replace the text the user has selected in the open note. Fails if nothing is " +
          "selected — use replace_in_note in that case.",
        parameters: TEXT_PARAM,
      },
    },
    {
      type: "function",
      function: {
        name: "append_to_note",
        description: "Add text to the very end of the open note.",
        parameters: TEXT_PARAM,
      },
    },
    {
      type: "function",
      function: {
        name: "create_note",
        description:
          "Create a new note in the vault root. Use it only when the user asks for a separate " +
          "note; to write into the note they already have open use insert_text.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "File name without the .md extension." },
            text: { type: "string", description: "Markdown content of the new note." },
          },
          required: ["title", "text"],
        },
      },
    },
  ];
}

export interface ParsedCall {
  call: ToolCall;
  name: ToolName | null;
  /** Что прислала модель: каждое поле проверяем по месту, доверия ему нет. */
  args: Record<string, unknown>;
  /** Читающие инструменты выполняются молча, пишущие — по кнопке. */
  writes: boolean;
  title: string;
  preview: string;
  /** Заметка-цель на момент показа карточки; у create_note её нет. */
  path: string | null;
}

export function parseCall(call: ToolCall, notePath: string | null): ParsedCall {
  let args: Record<string, unknown> = {};
  try {
    args = call.arguments.trim() ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
  } catch {
    // Модель иногда шлёт оборванный JSON — тогда просто нечего применять.
    args = {};
  }
  const name = TOOL_NAMES.includes(call.name as ToolName) ? (call.name as ToolName) : null;

  const text = typeof args.text === "string" ? args.text : "";
  const find = typeof args.find === "string" ? args.find : "";
  const replace = typeof args.replace === "string" ? args.replace : "";
  const titles: Record<ToolName, string> = {
    read_note: t("toolRead"),
    insert_text: t("toolInsert"),
    replace_in_note: t("toolReplaceIn"),
    replace_note: t("toolReplaceNote"),
    replace_selection: t("toolReplace"),
    append_to_note: t("toolAppend"),
    create_note: t("toolCreate", { title: String(args.title ?? "") }),
  };

  return {
    call,
    name,
    args,
    writes: name !== null && name !== "read_note",
    title: name ? titles[name] : t("toolUnknown", { name: call.name }),
    // У точечной замены превью — сама пара «что на что», у остальных текст.
    preview: name === "replace_in_note" ? (find ? `${find}\n↓\n${replace}` : "") : text,
    // Цель выбираем сейчас, а не в момент нажатия «Применить»: пока карточка
    // ждёт ответа, в заметку наверняка сходят посмотреть — и «текущей» к тому
    // времени может оказаться совсем другая.
    path: name && name !== "create_note" ? notePath : null,
  };
}

/** Выполняет вызов и возвращает текст результата — его читает модель. */
export async function runCall(host: ToolHost, parsed: ParsedCall): Promise<string> {
  const text = typeof parsed.args.text === "string" ? parsed.args.text : "";
  const path = parsed.path;
  switch (parsed.name) {
    case "read_note": {
      const note = host.readNote();
      return note ? `Note "${note.path}":\n\n${note.text}` : "No note is open.";
    }
    case "insert_text":
      if (!text) return "Nothing to insert: the text argument was empty.";
      if (!path) return "Failed: no note is open.";
      return host.insertText(text, path)
        ? `Inserted at the cursor in "${path}".`
        : `Failed: "${path}" is no longer the open note.`;
    case "replace_in_note": {
      const find = typeof parsed.args.find === "string" ? parsed.args.find : "";
      const replace = typeof parsed.args.replace === "string" ? parsed.args.replace : "";
      if (!find) return "Nothing to look for: the find argument was empty.";
      if (!path) return "Failed: no note is open.";
      switch (host.replaceInNote(find, replace, path)) {
        case "ok":
          return `Replaced that fragment in "${path}".`;
        case "missing":
          return (
            "Failed: that exact text is not in the note. Call read_note and copy the " +
            "fragment character for character, including punctuation and line breaks."
          );
        case "many":
          return (
            "Failed: that text occurs more than once in the note. Make `find` longer, so " +
            "that it matches exactly one place."
          );
        default:
          return `Failed: "${path}" is no longer the open note.`;
      }
    }
    case "replace_note":
      if (!text) return "Nothing to write: the text argument was empty.";
      if (!path) return "Failed: no note is open.";
      return host.replaceNote(text, path)
        ? `Rewrote "${path}".`
        : `Failed: "${path}" is no longer the open note.`;
    case "replace_selection":
      if (!text) return "Nothing to write: the text argument was empty.";
      if (!path) return "Failed: no note is open.";
      return host.replaceSelection(text, path)
        ? `Selection replaced in "${path}".`
        : `Failed: nothing is selected in "${path}", or it is no longer the open note.`;
    case "append_to_note":
      if (!text) return "Nothing to append: the text argument was empty.";
      if (!path) return "Failed: no note is open.";
      return host.appendToNote(text, path)
        ? `Appended to "${path}".`
        : `Failed: "${path}" is no longer the open note.`;
    case "create_note": {
      const title = typeof parsed.args.title === "string" ? parsed.args.title : "";
      if (!title || !text) return "Failed: both title and text are required.";
      const path = await host.createNote(title, text);
      return path ? `Created note "${path}".` : "Failed to create the note.";
    }
    default:
      return `Unknown tool "${parsed.call.name}".`;
  }
}
