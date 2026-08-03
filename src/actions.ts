import { t } from "./i18n";

/**
 * Что делать с ответом модели:
 *  replace — заменить выделение (откат обычным Ctrl+Z);
 *  append  — вставить под выделением, оригинал остаётся;
 *  chat    — ничего не трогать в заметке, показать в панели справа.
 */
export type ActionMode = "replace" | "append" | "chat";

export interface AiAction {
  id: string;
  name: string;
  /** Системный промпт. {lang} подставляется языком перевода из настроек. */
  prompt: string;
  mode: ActionMode;
  /** Иконка для меню редактора (набор lucide). */
  icon: string;
  /** Встроенные действия нельзя удалить, но промпт можно переписать. */
  builtin?: boolean;
}

/** Заготовки создаются на языке интерфейса — их видно и правится в настройках. */
export function defaultActions(): AiAction[] {
  return [
    {
      id: "spelling",
      name: t("actSpelling"),
      prompt: t("actSpellingPrompt"),
      mode: "replace",
      icon: "spell-check",
      builtin: true,
    },
    {
      id: "clarify",
      name: t("actClarify"),
      prompt: t("actClarifyPrompt"),
      mode: "replace",
      icon: "wand-sparkles",
      builtin: true,
    },
    {
      id: "expand",
      name: t("actExpand"),
      prompt: t("actExpandPrompt"),
      mode: "replace",
      icon: "expand",
      builtin: true,
    },
    {
      id: "shorten",
      name: t("actShorten"),
      prompt: t("actShortenPrompt"),
      mode: "replace",
      icon: "scissors",
      builtin: true,
    },
    {
      id: "evaluate",
      name: t("actEvaluate"),
      prompt: t("actEvaluatePrompt"),
      mode: "chat",
      icon: "clipboard-check",
      builtin: true,
    },
  ];
}

/** Заготовка для своего действия: id случайный, чтобы не столкнуться с чужим. */
export function newAction(): AiAction {
  return {
    id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: t("actNewName"),
    prompt: "",
    mode: "replace",
    icon: "sparkles",
  };
}

/** Заводский промпт встроенного действия — для кнопки «Сбросить промпт». */
export function factoryPrompt(id: string): string | null {
  return defaultActions().find((a) => a.id === id)?.prompt ?? null;
}

/**
 * Хвост для правящих действий: без него модель любит поболтать, а заодно
 * причесать разметку. Оговорки про markdown и стихи живут здесь, а не в каждом
 * промпте: в заметках всё это одинаково — и в заводском действии, и в своём.
 */
export function systemFor(action: AiAction, targetLang: string): string {
  const prompt = action.prompt.replace(/\{lang\}/g, targetLang);
  if (action.mode === "chat") return prompt;
  return [prompt, t("promptKeepMarkup"), t("promptOnlyText")].join("\n\n");
}

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;
const QUOTED = /^(["'«“„])([\s\S]*)(["'»”“])$/;

/**
 * Ответ модели → текст, который не стыдно положить в заметку.
 * Снимаем обёртки, которых не было в оригинале, и возвращаем пробелы по краям
 * выделения: пользователь часто цепляет отступ или перевод строки, и без этого
 * замена склеивает слова с соседними.
 */
export function cleanReply(raw: string, original: string): string {
  let out = raw.trim();

  // Обёртка ```…``` — только если исходник не был блоком кода.
  if (!original.trim().startsWith("```")) {
    const fenced = out.match(FENCE);
    if (fenced) out = fenced[1].trim();
  }

  // Кавычки вокруг всего ответа — только если оригинал не был в кавычках и
  // внутри нет закрывающей кавычки того же вида (иначе это часть текста).
  const q = out.match(QUOTED);
  if (q && !QUOTED.test(original.trim()) && !q[2].includes(q[1]) && !q[2].includes(q[3])) {
    out = q[2].trim();
  }

  const lead = original.match(/^\s*/)?.[0] ?? "";
  const tail = original.match(/\s*$/)?.[0] ?? "";
  return lead + out + tail;
}

/**
 * Строка и колонка → смещение в тексте. Нужно там, где редактора уже нет:
 * координаты правки записаны, а считать по ним приходится в сыром файле.
 * null — такого места в тексте нет (заметку успели укоротить).
 */
export function offsetAt(text: string, line: number, ch: number): number | null {
  let at = 0;
  for (let n = 0; n < line; n++) {
    const nl = text.indexOf("\n", at);
    if (nl === -1) return null;
    at = nl + 1;
  }
  const end = text.indexOf("\n", at);
  const width = (end === -1 ? text.length : end) - at;
  return ch > width ? null : at + ch;
}

/** Есть ли в выделении хоть что-то осмысленное. */
export function hasText(s: string): boolean {
  return s.trim().length > 0;
}

/** Короткая подпись действия для уведомлений и статус-бара. */
export function shortName(action: AiAction): string {
  return action.name.length > 28 ? action.name.slice(0, 27) + "…" : action.name;
}
