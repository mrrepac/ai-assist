/*
 * Что лежит в файлах плагина и как это читать.
 *
 * Отдельным модулем и без единого импорта из obsidian: разбор чужого файла —
 * то место, где одна ошибка стоит всех настроек разом, включая ключи
 * провайдеров, и проверять его надо тестом, а не глазами. Плагин остаётся
 * хозяином диска и отдаёт сюда уже прочитанное.
 */
import {
  AiAssistSettings,
  HistoryItem,
  StoredData,
  StoredHistory,
  mergeSettings,
} from "./types";

/**
 * Номер формата. Меняется только тогда, когда прежний файл нельзя прочитать
 * нынешним кодом: пока поля просто добавляются, номер остаётся прежним.
 */
export const SCHEMA = 1;

/**
 * Чем кончилось чтение:
 *  fresh  — файла нет, первая установка;
 *  ok     — прочитан;
 *  ahead  — написан версией новее нашей: читаем как умеем, чужое бережём;
 *  broken — файл есть, а разобрать нечего.
 */
export type StoreState = "fresh" | "ok" | "ahead" | "broken";

export interface StoreRead {
  settings: AiAssistSettings;
  /** Лента из data.json прежних версий — её переносят в history.json. */
  legacy?: HistoryItem[];
  /** Всё прочее с верхнего уровня файла: записывается обратно нетронутым. */
  rest: Record<string, unknown>;
  state: StoreState;
}

/** Умолчания и пустой верхний уровень — общий ответ на всё непрочитанное. */
function blank(state: StoreState): StoreRead {
  return { settings: mergeSettings(null), rest: {}, state };
}

export function readStore(raw: unknown): StoreRead {
  // undefined — Obsidian прочитал файл и не смог разобрать (его readJson молча
  // возвращает undefined), null — файла нет вовсе. Разница в том, есть ли что
  // спасать, и раньше она терялась: оба случая давали умолчания, а первое же
  // сохранение писало умолчания поверх ключей.
  if (raw === undefined) return blank("broken");
  if (raw === null) return blank("fresh");
  if (typeof raw !== "object" || Array.isArray(raw)) return blank("broken");

  const obj = raw as Record<string, unknown>;
  const wrapped = !!obj.settings && typeof obj.settings === "object" && !Array.isArray(obj.settings);
  if (!wrapped) {
    // Номер формата есть, а настроек нет ни в обёртке, ни в корне — это наш
    // файл, и он испорчен. Ключ settings, который не оказался объектом
    // (например, массив), — та же порча: это не старый формат без обёртки,
    // а попытка обёртки, которую нечем прочитать.
    if ("schemaVersion" in obj || "settings" in obj) return blank("broken");
    // Настройки в корне — формат до появления обёртки. Беречь на верхнем
    // уровне нечего: там лежат сами настройки.
    return { settings: mergeSettings(obj), rest: {}, state: "ok" };
  }

  const { settings, history, schemaVersion, ...rest } = obj;
  const version = typeof schemaVersion === "number" ? schemaVersion : 0;
  return {
    settings: mergeSettings(settings),
    legacy: Array.isArray(history) ? (history as HistoryItem[]) : undefined,
    rest,
    state: version > SCHEMA ? "ahead" : "ok",
  };
}

export function writeStore(
  settings: AiAssistSettings,
  rest: Record<string, unknown> = {},
): StoredData {
  // Незнакомые поля идут первыми: своё они перебить не должны, а вот пропасть
  // им нельзя — их написала версия новее, и на второй машине их ждут на месте.
  return { ...rest, schemaVersion: SCHEMA, settings };
}

export interface HistoryRead {
  items: HistoryItem[];
  broken: boolean;
}

/**
 * Только записи: не-объект в ленте уронил бы отрисовку панели, а прежний код
 * доверял любому массиву вслепую.
 */
function keepItems(raw: unknown[]): HistoryItem[] {
  return raw.filter(
    (item): item is HistoryItem => !!item && typeof item === "object" && !Array.isArray(item),
  );
}

/**
 * Лента из файла. Голый массив — формат версии 0, он же лежит у всех, кто
 * поставил плагин до этой версии.
 */
export function readHistory(raw: unknown): HistoryRead {
  if (Array.isArray(raw)) return { items: keepItems(raw), broken: false };
  if (raw && typeof raw === "object") {
    const items = (raw as { items?: unknown }).items;
    if (Array.isArray(items)) return { items: keepItems(items), broken: false };
  }
  return { items: [], broken: true };
}

export function writeHistoryFile(items: HistoryItem[]): StoredHistory {
  return { schemaVersion: SCHEMA, items };
}
