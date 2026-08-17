/*
 * Чей сейчас заход.
 *
 * Пока модель отвечает, ленту могли увести из-под ответа: очисткой чата, новым
 * разговором, возвратом по уведомлению, снятием самого вопроса кнопкой. Ответ,
 * дописанный в конец после любого из них, встал бы посреди чужого разговора —
 * и в ленте, и в контексте следующего запроса.
 *
 * Правило было записано в трёх местах тремя разными способами, и в четвёртом
 * его просто забыли. Здесь оно одно на всех.
 */
import { dropTalk } from "./history";
import { HistoryItem, StoredChatMessage } from "./types";

export interface Turn {
  /** С какого места лента принадлежит этому заходу. */
  readonly startAt: number;
  /** Сам вопрос: по нему заход и опознаётся, как бы лента ни менялась. */
  readonly ask: StoredChatMessage;
}

/** Положить вопрос в ленту и запомнить место захода. */
export function beginTurn(history: HistoryItem[], ask: StoredChatMessage): Turn {
  const startAt = history.length;
  history.push(ask);
  return { startAt, ask };
}

/**
 * Лента всё ещё принадлежит этому заходу. Ищем сам объект вопроса, а не место:
 * возврат ленты по уведомлению меняет весь массив разом (`length = 0` плюс
 * `push(...kept)`), и по месту там лежало бы чужое.
 */
export function ownsTurn(history: HistoryItem[], turn: Turn): boolean {
  return history.includes(turn.ask);
}

/**
 * Снять заход целиком — то, что делает кнопка «Повторить» после ошибки. Ошибка
 * могла случиться и на втором круге инструментов, поэтому снимается всё от
 * вопроса и до конца, а не одна реплика.
 *
 * Записи журнала правок возвращаются на место: правка выделенного шла своим
 * чередом и к этому заходу отношения не имеет.
 */
export function rollbackTurn(history: HistoryItem[], turn: Turn): boolean {
  if (history[turn.startAt] !== turn.ask) return false;
  const removed = history.splice(turn.startAt);
  history.push(...dropTalk(removed));
  return true;
}
