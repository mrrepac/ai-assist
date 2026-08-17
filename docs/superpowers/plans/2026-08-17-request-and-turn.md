# Разбор `submit()`: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вынуть из `ChatView.submit()` две проверяемые заботы — «что уедет
модели» и «чей это заход» — в модули `src/request.ts` и `src/turn.ts`, покрыть
их тестами, не изменив ни одного наблюдаемого поведения.

**Architecture:** `planRequest()` принимает данные (опции захода, настройки,
ленту, плашку, заметку) и возвращает план: что уедет, что снять с плашки, какой
системный промпт, какие прошлые реплики. `assembleMessages()` складывает из
плана и уже прочитанных вложений массив `ChatMessage`. `turn.ts` держит правило
владения лентой. `submit()` становится исполнителем: читает диск, рисует,
крутит инструменты.

**Tech Stack:** TypeScript, Obsidian API, esbuild. Тесты — `tools/test-parse.mjs`,
запуск `npm test`, сборка `npm run build` (она же кладёт файлы в хранилище).

## Global Constraints

- **Поведение не меняется.** Ни одной правки «заодно». Найденный дефект
  показывается словами и чинится отдельным коммитом после захода.
- **Спека:** `docs/superpowers/specs/2026-08-17-request-and-turn-design.md`.
- **Новые модули не зовут API Obsidian.** Импорт типов из `attach.ts` допустим.
- **Ни `TODO`, ни `console.log`, ни `as any`, ни `innerHTML`, ни lookbehind в
  регулярках** — правила каталога Obsidian, проверяются на каждом ревью.
- **Комментарии — по-русски, объясняют «почему», а не «что»**: так написан весь
  проект. Каждое перенесённое правило сохраняет свой комментарий.
- **Тесты пишутся в `tools/test-parse.mjs`** в конец файла, стиль —
  `check("имя по-русски", получено, ожидалось)`; сравнение через
  `JSON.stringify`, поэтому поля со значением `undefined` в сравнении не
  участвуют.
- **Модуль подключается к тестам** строкой вида
  `const { … } = await load("src/request.ts", "request");` рядом с прочими
  загрузками (`tools/test-parse.mjs:41–52`).
- После каждой задачи: `npx tsc -noEmit -skipLibCheck` и `npm test` — обе
  команды обязаны быть чистыми до коммита.

---

### Task 1: `src/turn.ts` — чей это заход

**Files:**
- Create: `src/turn.ts`
- Test: `tools/test-parse.mjs` (загрузка модуля рядом со строкой 47, тесты — в конец файла)

**Interfaces:**
- Consumes: `HistoryItem`, `StoredChatMessage`, `isActionEntry` из `./types`; `dropTalk` из `./history`.
- Produces: `Turn`, `beginTurn(history, ask) → Turn`, `ownsTurn(history, turn) → boolean`, `rollbackTurn(history, turn) → boolean`.

Модуль пока никто не зовёт — подключение к `view.ts` идёт в задаче 6.

- [ ] **Step 1: Написать падающий тест**

В `tools/test-parse.mjs` рядом с остальными загрузками (после строки с
`store.ts`) добавить:

```js
const { beginTurn, ownsTurn, rollbackTurn } = await load("src/turn.ts", "turn");
```

В конец файла, перед `console.log(`\n${pass} прошло…`)`:

```js
// ——— turn: чей это заход ———
// Пока идёт ответ, ленту могли увести: очисткой, новым разговором, возвратом
// по уведомлению, снятием самого вопроса. Ответ, дописанный после любого из
// них, встал бы посреди чужого разговора — и в ленте, и в контексте
// следующего запроса.
const mkAsk = (text) => ({ role: "user", content: text });
const mkLog = (id) => ({ kind: "action", id, action: "Исправить орфографию", status: "done", content: "" });

const feed = [mkAsk("первый"), { role: "assistant", content: "ответ" }];
const ask1 = mkAsk("второй");
const turn1 = beginTurn(feed, ask1);
check("вопрос лёг в ленту", feed.length, 3);
check("место захода запомнено", turn1.startAt, 2);
check("лента принадлежит заходу", ownsTurn(feed, turn1), true);

const cleared = [];
check("после очистки лента не наша", ownsTurn(cleared, turn1), false);

const returned = [mkAsk("первый")];
check("после возврата ленты по уведомлению — не наша", ownsTurn(returned, turn1), false);

// откат захода: кнопка «Повторить» после ошибки
const feed2 = [mkAsk("первый")];
const ask2 = mkAsk("второй");
const turn2 = beginTurn(feed2, ask2);
feed2.push({ role: "assistant", content: "половина" }, mkLog("7"));
check("заход снят целиком", rollbackTurn(feed2, turn2), true);
check("остался только прежний разговор и журнал", feed2.map((m) => m.content ?? m.id), ["первый", "7"]);

// правка выделенного шла своим чередом — её запись к заходу отношения не имеет
const feed3 = [mkAsk("первый")];
const ask3 = mkAsk("второй");
const turn3 = beginTurn(feed3, ask3);
feed3.length = 0;
feed3.push(mkAsk("чужой разговор"));
check("чужую ленту откат не трогает", rollbackTurn(feed3, turn3), false);
check("чужая лента цела", feed3.length, 1);
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test`
Expected: падение с `TypeError: beginTurn is not a function` (модуля ещё нет —
esbuild сообщит `Could not resolve "src/turn.ts"`).

- [ ] **Step 3: Написать модуль**

Создать `src/turn.ts`:

```ts
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
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx tsc -noEmit -skipLibCheck && npm test`
Expected: `tsc` молчит, тесты зелёные, счётчик вырос на 9.

- [ ] **Step 5: Коммит**

```bash
git add src/turn.ts tools/test-parse.mjs
git commit -m "turn.ts: one rule for whose feed this is"
```

---

### Task 2: типы переезжают — `NoteContext` и `SubmitOptions`

**Files:**
- Modify: `src/types.ts` (добавить `NoteContext`)
- Create: `src/request.ts` (пока только `SubmitOptions`)
- Modify: `src/view.ts:95–134` (интерфейс `ChatHost` — `noteContext` возвращает `NoteContext`), объявление `SubmitOptions` удаляется и импортируется из `./request`

**Interfaces:**
- Produces: `NoteContext { path: string; text: string; clipped: boolean }` в `types.ts`; `SubmitOptions` в `request.ts`.

Чистый перенос: ни одной строки логики. Тестов не добавляет — проверка в `tsc`.

- [ ] **Step 1: Завести `NoteContext` в `types.ts`**

Дописать рядом с прочими интерфейсами:

```ts
/**
 * Заметка, уходящая в запрос контекстом. Обрезанную надо назвать обрезанной:
 * ответ по началу длинного текста выглядит точно так же, как ответ по всему.
 */
export interface NoteContext {
  path: string;
  text: string;
  clipped: boolean;
}
```

- [ ] **Step 2: Создать `src/request.ts` с перенесённым `SubmitOptions`**

Взять объявление `SubmitOptions` — это `view.ts:137–168`, ровно 32 строки —
дословно, вместе со всеми комментариями (они описывают те грабли, ради которых
поля и заведены: `quote: null` = «без фрагмента, что бы ни висело на плашке»,
`files: null` — то же про картинки), и положить в новый файл под шапкой:

```ts
/*
 * Что уедет модели.
 *
 * Здесь живут решения, а не действия: какой фрагмент и какие вложения уходят с
 * вопросом, видит ли модель заметку, разрешены ли ей инструменты, что снять с
 * плашки. Отдельно от панели — потому что каждое из этих решений когда-нибудь
 * оказывалось неверным, а проверить их, не поднимая Obsidian, было нельзя.
 */
import { Attachment } from "./attach";
import { ApiConfig } from "./types";

export interface SubmitOptions { /* … перенесено без изменений … */ }
```

- [ ] **Step 3: Поправить `view.ts`**

- удалить объявление `SubmitOptions`;
- добавить `import { SubmitOptions } from "./request";`
- в интерфейсе `ChatHost` заменить `noteContext(): { path: string; text: string; clipped: boolean } | null;` на `noteContext(): NoteContext | null;`, импортировав тип из `./types`;
- `SubmitOptions` экспортируется из `view.ts` дальше не нужно — проверить грепом, что вне `view.ts` его никто не импортирует: `grep -rn "SubmitOptions" src/`.

- [ ] **Step 4: Проверка**

Run: `npx tsc -noEmit -skipLibCheck && npm test`
Expected: `tsc` молчит, тестов столько же, сколько после задачи 1.

- [ ] **Step 5: Коммит**

```bash
git add src/types.ts src/request.ts src/view.ts
git commit -m "SubmitOptions describes a turn, not a panel, and moves out"
```

---

### Task 3: `planRequest` — фрагмент, вложения, плашка, приватность, инструменты

**Files:**
- Modify: `src/request.ts`
- Test: `tools/test-parse.mjs`

**Interfaces:**
- Consumes: `SubmitOptions` (задача 2), `Attachment` из `./attach`, `AiAssistSettings`, `StoredChatMessage`, `HistoryItem`, `NoteContext`, `toolsAllowed` из `./types`.
- Produces: `RequestInput`, `RequestPlan`, `planRequest(input: RequestInput): RequestPlan`.

В этой задаче план заполняет шесть полей: `ask`, `files`, `clearFiles`,
`dismissQuote`, `priv`, `canUseTools`. Остальные поля (`system`, `note`, `past`,
`mediaFrom`, `notices`) добавляются задачей 4 — до тех пор их в интерфейсе нет.

Правила переносятся из `view.ts:1616–1681` дословно.

- [ ] **Step 1: Написать падающие тесты**

Загрузка рядом с прочими:

```js
const { planRequest } = await load("src/request.ts", "request");
```

Тесты в конец файла:

```js
// ——— planRequest: что уедет модели ———
// Три релиза подряд дефекты приходили с плашки: повтор после ошибки уносил
// чужие картинки, «спросить заново» терял фрагмент. Правило «с плашки снимаем
// только то, что с неё и взяли» проверяется здесь, а не на живом Obsidian.
const img = { id: "a1", name: "снимок.png", mime: "image/png" };
const other = { id: "a2", name: "другой.png", mime: "image/png" };
const baseInput = (over = {}) => ({
  text: "привет",
  opts: {},
  settings: defaultSettings(),
  history: [],
  chip: { quote: null, files: [] },
  note: null,
  provider: "deepseek",
  ...over,
});

check(
  "фрагмент берётся с плашки",
  planRequest(baseInput({ chip: { quote: "кусок", files: [] } })).ask.quote,
  "кусок",
);
check(
  "явный фрагмент побеждает плашку",
  planRequest(baseInput({ opts: { quote: "свой" }, chip: { quote: "кусок", files: [] } })).ask.quote,
  "свой",
);
check(
  "явный null — вопрос без фрагмента",
  planRequest(baseInput({ opts: { quote: null }, chip: { quote: "кусок", files: [] } })).ask.quote,
  undefined,
);
check(
  "приватный чат не отправляет фрагмент никогда",
  planRequest(baseInput({
    settings: { ...defaultSettings(), privateChat: true },
    chip: { quote: "кусок", files: [] },
  })).ask.quote,
  undefined,
);
check(
  "спросили о фрагменте — он помечен спрошенным",
  planRequest(baseInput({ chip: { quote: "кусок", files: [] } })).dismissQuote,
  "кусок",
);

check(
  "картинки берутся с плашки",
  planRequest(baseInput({ chip: { quote: null, files: [img] } })).files.map((f) => f.id),
  ["a1"],
);
check(
  "заход из редактора плашку не смотрит",
  planRequest(baseInput({ opts: { fromEditor: true }, chip: { quote: null, files: [img] } })).files,
  [],
);
check(
  "явные картинки побеждают плашку",
  planRequest(baseInput({ opts: { files: [other] }, chip: { quote: null, files: [img] } })).files.map((f) => f.id),
  ["a2"],
);
check(
  "взяли с плашки — её и чистим",
  planRequest(baseInput({ chip: { quote: null, files: [img] } })).clearFiles,
  true,
);
check(
  "картинки переданы явно — плашка не наша, не трогаем",
  planRequest(baseInput({ opts: { files: [other] }, chip: { quote: null, files: [img] } })).clearFiles,
  false,
);
check(
  "заход из редактора плашку не чистит",
  planRequest(baseInput({ opts: { fromEditor: true }, chip: { quote: null, files: [img] } })).clearFiles,
  false,
);

check("обычный заход не приватный", planRequest(baseInput()).priv, false);
check(
  "приватный чат",
  planRequest(baseInput({ settings: { ...defaultSettings(), privateChat: true } })).priv,
  true,
);
check(
  "действие из заметки приватности не касается",
  planRequest(baseInput({
    opts: { fromEditor: true },
    settings: { ...defaultSettings(), privateChat: true },
  })).priv,
  false,
);

check("инструменты по умолчанию разрешены", planRequest(baseInput()).canUseTools, true);
check(
  "выключены настройкой",
  planRequest(baseInput({ settings: { ...defaultSettings(), tools: false } })).canUseTools,
  false,
);
check(
  "провайдер без function calling",
  planRequest(baseInput({ provider: "perplexity" })).canUseTools,
  false,
);
check(
  "действию из заметки инструменты не положены",
  planRequest(baseInput({ opts: { fromEditor: true } })).canUseTools,
  false,
);
check(
  "приватному чату тоже",
  planRequest(baseInput({ settings: { ...defaultSettings(), privateChat: true } })).canUseTools,
  false,
);

check(
  "показано то же, что ушло — переспрашивать нечего",
  planRequest(baseInput()).ask.resend,
  undefined,
);
check(
  "действие рисуется подписью — настоящий вопрос запомнен",
  planRequest(baseInput({ opts: { display: "**Исправить орфографию**", system: "правь", fresh: true } })).ask,
  {
    role: "user",
    content: "**Исправить орфографию**",
    resend: { text: "привет", system: "правь", fresh: true },
  },
);
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test`
Expected: `Could not resolve` или `planRequest is not a function`.

- [ ] **Step 3: Дописать `request.ts`**

```ts
export interface RequestInput {
  /** Текст вопроса — то, что уходит модели. */
  text: string;
  opts: SubmitOptions;
  settings: AiAssistSettings;
  /** Лента ДО того, как в неё лёг этот вопрос. */
  history: HistoryItem[];
  /** Что лежит на плашке над полем ввода. */
  chip: { quote: string | null; files: Attachment[] };
  /** Заметка-контекст, уже прочитанная панелью (в задаче 4). */
  note: NoteContext | null;
  /** Имя провайдера выбранной модели. */
  provider: string;
}

export interface RequestPlan {
  /** Реплика пользователя, как она ляжет в ленту. */
  ask: StoredChatMessage;
  /**
   * Настоящий текст вопроса — тот, что уедет модели. От `ask.content` отличается
   * у действия из заметки: в ленте там подпись действия, а в запросе текст.
   */
  text: string;
  /** Вложения этого вопроса. */
  files: Attachment[];
  /** Снять ли картинки с плашки. */
  clearFiles: boolean;
  /** Фрагмент, о котором уже спросили: плашка не должна вернуть его снова. */
  dismissQuote?: string;
  priv: boolean;
  canUseTools: boolean;
}

export function planRequest(input: RequestInput): RequestPlan {
  const { text, opts, settings, chip, provider } = input;

  // Прикреплённое выделение уходит с вопросом и тут же снимается: следующий
  // вопрос — уже про своё, если не выделить заново. Явный null означает «без
  // фрагмента» и плашку не смотрит вовсе. Приватный чат не отправляет фрагмент
  // ни при каких условиях — последняя застава на пути всего, что могло уцелеть
  // от прошлого разговора.
  const asked = opts.quote === undefined ? chip.quote : opts.quote;
  const quote = (settings.privateChat ? null : asked) ?? undefined;

  // Действие из заметки плашку не смотрит и картинок с неё не забирает:
  // приложенная для следующего вопроса, она уехала бы с чужим запросом — за те
  // же деньги и без спроса.
  const files = (opts.files === undefined ? (opts.fromEditor ? [] : chip.files) : opts.files) ?? [];
  // С плашки снимаем только то, что с неё и взяли. Картинки, переданные явно
  // («спросить заново», «повторить» после ошибки), к плашке отношения не имеют:
  // приложенное там ждёт следующего вопроса, и стереть его молча — потерять
  // чужую работу, а заодно оставить её висеть в памяти сеанса навсегда.
  const clearFiles = opts.files === undefined && !opts.fromEditor;

  // Приватный чат: модель не знает ни про Obsidian, ни про заметку — разговор
  // как в веб-чате провайдера. На действие из заметки не распространяется: оно
  // само про неё, и выключать там нечего.
  const priv = settings.privateChat && !opts.fromEditor;
  // Инструментов может не быть и у провайдера: Perplexity ищет в вебе и
  // отвечает, а function calling не умеет вовсе — запрос с ними отлетел бы
  // четырёхсотой на каждый вопрос.
  const canUseTools = settings.tools && !opts.fromEditor && !priv && toolsAllowed(provider);

  const ask: StoredChatMessage = {
    role: "user",
    content: opts.display ?? text,
    quote,
    attachments: files.length ? files : undefined,
    // Показано не то, что уходит в запрос, — запоминаем настоящий вопрос вместе
    // с его системным промптом, иначе «спросить заново» отправит подпись
    // действия.
    resend:
      opts.display || opts.system || opts.fresh
        ? { text, system: opts.system, fresh: opts.fresh }
        : undefined,
  };

  return { ask, text, files, clearFiles, dismissQuote: quote, priv, canUseTools };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx tsc -noEmit -skipLibCheck && npm test`
Expected: зелено, счётчик вырос на 20.

- [ ] **Step 5: Коммит**

```bash
git add src/request.ts tools/test-parse.mjs
git commit -m "planRequest: what travels with the question, and what leaves the chip"
```

---

### Task 4: `planRequest` — промпт, заметка, прошлые реплики, предупреждение

**Files:**
- Modify: `src/request.ts`
- Test: `tools/test-parse.mjs`

**Interfaces:**
- Consumes: `contextWindow` из `./history`. Из `./i18n` не берётся ничего:
  готовые тексты подсказок приходят входом (`hints`), а предупреждение
  возвращается перечислением — переводит его панель.
- Produces: `RequestNotice` (`"noteClipped"`), поля плана `system`, `note`, `past`, `mediaFrom`, `notices`.

Правила из `view.ts:1682–1733`. Тексты подсказок (`chatSystemHint`,
`chatSystemHintTools`, `chatToolsNoteHere`, `chatToolsNoteHidden`) приходят
входом — иначе модуль потянет `i18n`, а с ним `moment` из `obsidian`.

- [ ] **Step 1: Написать падающие тесты**

```js
// ——— planRequest: промпт, заметка, прошлое ———
// Системный промпт склеен из четырёх кусков, и в приватном чате не должно
// уехать ни одного своего: ни подсказки про панель, ни промпта из настроек.
const hints = { tools: "ХИНТ-И", plain: "ХИНТ", noteHere: "ЗАМЕТКА-ВИДНА", noteHidden: "ЗАМЕТКА-СКРЫТА" };
const withHints = (over = {}) => baseInput({ hints, ...over });
const note = { path: "Заметки/План.md", text: "текст заметки", clipped: false };

check(
  "обычный заход: подсказка, оговорка про заметку, промпт настроек",
  planRequest(withHints({ note })).system,
  "ХИНТ-И\n\nЗАМЕТКА-ВИДНА\n\n" + defaultSettings().systemPrompt.trim(),
);
check(
  "заметка не приложена — так и сказано",
  planRequest(withHints()).system,
  "ХИНТ-И\n\nЗАМЕТКА-СКРЫТА\n\n" + defaultSettings().systemPrompt.trim(),
);
check(
  "инструменты выключены — оговорки про заметку нет",
  planRequest(withHints({ settings: { ...defaultSettings(), tools: false } })).system,
  "ХИНТ\n\n" + defaultSettings().systemPrompt.trim(),
);
check(
  "приватный чат: ничего своего",
  planRequest(withHints({ settings: { ...defaultSettings(), privateChat: true } })).system,
  "",
);
check(
  "промпт действия приписывается последним",
  planRequest(withHints({ opts: { fromEditor: true, system: "правь текст" } })).system,
  "ХИНТ\n\nправь текст",
);

check("заметка уезжает контекстом", planRequest(withHints({ note })).note, note);
check(
  "действию из заметки заметка сверху не нужна",
  planRequest(withHints({ note, opts: { fromEditor: true } })).note,
  null,
);
check(
  "в приватном чате заметка не уходит",
  planRequest(withHints({ note, settings: { ...defaultSettings(), privateChat: true } })).note,
  null,
);
check(
  "обрезанную заметку называют обрезанной",
  planRequest(withHints({ note: { ...note, clipped: true } })).notices,
  ["noteClipped"],
);
check("целая заметка молчит", planRequest(withHints({ note })).notices, []);

const past1 = { role: "user", content: "а до этого?" };
const past2 = { role: "assistant", content: "вот так" };
check(
  "прошлое уходит в контекст",
  planRequest(withHints({ history: [past1, past2] })).past.map((m) => m.content),
  ["а до этого?", "вот так"],
);
check(
  "fresh: прошлого нет",
  planRequest(withHints({ history: [past1, past2], opts: { fresh: true } })).past,
  [],
);

const withImage = { role: "user", content: "что тут?", attachments: [img] };
check(
  "картинки берутся у самой свежей реплики",
  planRequest(withHints({ history: [withImage, past2] })).mediaFrom,
  0,
);
check(
  "к вопросу приложили своё — прошлые картинки не нужны",
  planRequest(withHints({ history: [withImage], chip: { quote: null, files: [other] } })).mediaFrom,
  -1,
);
check("в ленте без картинок брать нечего", planRequest(withHints({ history: [past1] })).mediaFrom, -1);
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test`
Expected: `Cannot read properties of undefined (reading 'system')` — поля ещё нет.

- [ ] **Step 3: Дописать `request.ts`**

В `RequestInput` добавить:

```ts
  /**
   * Тексты подсказок, уже переведённые. Приходят входом, чтобы модуль не тянул
   * i18n, а с ним moment из obsidian: решение о том, ЧТО сказать модели, — здесь,
   * а на каком языке — не здесь.
   */
  hints: { tools: string; plain: string; noteHere: string; noteHidden: string };
```

В `RequestPlan`:

```ts
/** Что панель скажет в ленте до того, как уйдёт запрос. */
export type RequestNotice = "noteClipped";

  /** Склеенный системный промпт; пустой — системного сообщения не будет. */
  system: string;
  /** Заметка, которая реально уедет контекстом. */
  note: NoteContext | null;
  /** Прошлые реплики, влезшие в бюджет контекста. */
  past: StoredChatMessage[];
  /** Индекс в past, чьи вложения уедут; -1 — ничьи. */
  mediaFrom: number;
  notices: RequestNotice[];
```

В теле `planRequest`, после вычисления `canUseTools`:

```ts
  // Без объяснения, где она находится, модель на просьбу «вставь в заметку»
  // отвечает лекцией о том, что у неё нет доступа к хранилищу.
  const hint = canUseTools ? input.hints.tools : input.hints.plain;

  // «Отправлять заметку как контекст» — это про разговор в панели. Действие над
  // выделенным уже сказало, над чем работать, и заметка сверху — лишние деньги
  // и лишняя путаница: модель видит один и тот же текст дважды.
  const note = opts.fromEditor || priv ? null : input.note;

  // Видит ли модель заметку — половина того, что ей надо знать про инструменты.
  // Без этой оговорки она лезет читать заметку на любой вопрос, даже когда он
  // вовсе не про неё, а когда заметка уже приложена — читает её вторым разом,
  // целым кругом запроса за те же деньги.
  const reach = canUseTools ? (note ? input.hints.noteHere : input.hints.noteHidden) : "";
  // В приватном чате не уходит ничего своего — ни объяснений про панель, ни
  // общего промпта из настроек. Остаётся промпт действия, но его тут не бывает.
  const own = priv ? [] : [hint, reach, settings.systemPrompt.trim()];
  const system = [...own, opts.system?.trim()].filter(Boolean).join("\n\n");

  const past = opts.fresh ? [] : contextWindow(input.history);
  // Из прошлых реплик картинки уходят только с самой свежей: за каждую платят на
  // каждом вопросе, и разговор, начавшийся с фотографии, иначе возил бы её с
  // собой до конца. К этому вопросу приложили своё — прежние не нужны и подавно.
  const mediaFrom = files.length
    ? -1
    : past.reduce((at, m, i) => (m.attachments?.length ? i : at), -1);

  const notices: RequestNotice[] = [];
  // Ответ по началу длинной заметки выглядит точно так же, как ответ по всей, —
  // про обрезку надо сказать вслух, иначе о ней никто не узнает.
  if (note?.clipped) notices.push("noteClipped");
```

и вернуть их в объекте плана.

- [ ] **Step 4: Прогнать тесты**

Run: `npx tsc -noEmit -skipLibCheck && npm test`
Expected: зелено, счётчик вырос на 16.

- [ ] **Step 5: Коммит**

```bash
git add src/request.ts tools/test-parse.mjs
git commit -m "planRequest: the system prompt, the note, and what the model still remembers"
```

---

### Task 5: `assembleMessages` — из плана в массив сообщений

**Files:**
- Modify: `src/request.ts`
- Test: `tools/test-parse.mjs`

**Interfaces:**
- Consumes: `messageContent` из `./history`, `ChatMessage` из `./api`, план из задач 3–4.
- Produces: `ResolvedMedia`, `assembleMessages(plan: RequestPlan, media: ResolvedMedia): ChatMessage[]`. Текст вопроса берётся из `plan.text` (задача 3) — третьим аргументом его не передают.

Правила из `view.ts:1699–1743`. Строка `CLIPPED` (`view.ts:77`) переезжает сюда:
это часть того, что видит модель.

- [ ] **Step 1: Написать падающие тесты**

```js
// ——— assembleMessages ———
const emptyMedia = { own: { images: [], docs: [] }, past: { images: [], docs: [] } };
const plainPlan = planRequest(withHints());
check(
  "системное сообщение, потом вопрос",
  assembleMessages(plainPlan, emptyMedia).map((m) => m.role),
  ["system", "user"],
);
check(
  "пустой системный промпт не отправляется",
  assembleMessages(
    planRequest(withHints({ settings: { ...defaultSettings(), privateChat: true } })),
    emptyMedia,
  ).map((m) => m.role),
  ["user"],
);
const notePlan = planRequest(withHints({ note }));
const noteMsgs = assembleMessages(notePlan, emptyMedia);
check("заметка идёт отдельным системным сообщением", noteMsgs.length, 3);
check(
  "заметка названа по имени файла",
  noteMsgs[1].content,
  'Note "Заметки/План.md":\n\nтекст заметки',
);
check(
  "обрезанной заметке дописано, что она обрезана",
  assembleMessages(
    planRequest(withHints({ note: { ...note, clipped: true } })),
    emptyMedia,
  )[1].content.endsWith("[The note is longer than this — only the beginning is shown.]"),
  true,
);
check(
  "прошлое встаёт между промптом и вопросом",
  assembleMessages(
    planRequest(withHints({ history: [past1, past2] })),
    emptyMedia,
  ).map((m) => m.role),
  ["system", "user", "assistant", "user"],
);
check(
  "картинка уходит кусками, а не строкой",
  Array.isArray(
    assembleMessages(
      planRequest(withHints({ chip: { quote: null, files: [img] } })),
      { own: { images: ["data:image/png;base64,AAA"], docs: [] }, past: { images: [], docs: [] } },
    ).at(-1).content,
  ),
  true,
);
check(
  "документ уходит текстом",
  assembleMessages(
    planRequest(withHints({ chip: { quote: null, files: [] } })),
    { own: { images: [], docs: [{ name: "счёт.pdf", text: "строка", clipped: false }] }, past: { images: [], docs: [] } },
  ).at(-1).content.startsWith('[Document "счёт.pdf"]'),
  true,
);
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test`
Expected: `assembleMessages is not a function`.

- [ ] **Step 3: Дописать `request.ts`**

```ts
/** Заметка длиннее предела уходит началом — и об этом сказано модели. */
const CLIPPED = "[The note is longer than this — only the beginning is shown.]";

/**
 * Вложения, уже прочитанные панелью: картинки адресами `data:`, документы
 * текстом. Читать их умеет только она — там и хранилище, и память сеанса.
 */
export interface ResolvedMedia {
  /** Вложения этого вопроса. */
  own: { images: string[]; docs: AttachedDoc[] };
  /** Вложения реплики `plan.past[plan.mediaFrom]`; пусто, если её нет. */
  past: { images: string[]; docs: AttachedDoc[] };
}

export function assembleMessages(plan: RequestPlan, media: ResolvedMedia): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (plan.system) messages.push({ role: "system", content: plan.system });

  if (plan.note) {
    messages.push({
      role: "system",
      content:
        `Note "${plan.note.path}":\n\n${plan.note.text}` + (plan.note.clipped ? "\n\n" + CLIPPED : ""),
    });
  }

  for (const [i, m] of plan.past.entries()) {
    // Документ той же меркой, что картинка: он тоже стоит денег на каждом
    // вопросе, и возить сорок тысяч знаков до конца разговора нельзя.
    const own = i === plan.mediaFrom ? media.past : { images: [], docs: [] };
    messages.push({ role: m.role, content: messageContent(m, own.images, own.docs) });
  }

  messages.push({
    role: "user",
    content: messageContent(
      // Модели уходит настоящий текст, а не подпись действия, которой реплика
      // подписана в ленте, — потому план и несёт их порознь.
      { role: "user", content: plan.text, quote: plan.ask.quote, attachments: plan.files },
      media.own.images,
      media.own.docs,
    ),
  });
  return messages;
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx tsc -noEmit -skipLibCheck && npm test`
Expected: зелено, счётчик вырос на 8.

- [ ] **Step 5: Коммит**

```bash
git add src/request.ts tools/test-parse.mjs
git commit -m "assembleMessages: the plan becomes the request"
```

---

### Task 6: `submit()` начинает звать новые модули

**Files:**
- Modify: `src/view.ts:1606–1934` (тело `submit`), `1945–1971` (`keepPartial`), `77` (константа `CLIPPED` удаляется)

**Interfaces:**
- Consumes: `planRequest`, `assembleMessages`, `ResolvedMedia` из `./request`; `beginTurn`, `ownsTurn`, `rollbackTurn`, `Turn` из `./turn`.
- Produces: ничего нового наружу.

Самая рискованная задача захода: живой путь, тестами не покрытый. Переключение
делается одним куском — ни одного «пока оставлю по-старому».

- [ ] **Step 1: Заменить начало `submit` планом**

Строки с `const startAt` по `await this.saveFiles(files)` заменяются на:

```ts
    const cfg = opts.config ?? this.host.chatConfig();
    const plan = planRequest({
      text,
      opts,
      settings: this.host.settings,
      history: this.host.history,
      chip: { quote: this.attached?.text ?? null, files: this.files },
      note: this.host.noteContext(),
      provider: providerOf(cfg),
      hints: {
        tools: t("chatSystemHintTools"),
        plain: t("chatSystemHint"),
        noteHere: t("chatToolsNoteHere"),
        noteHidden: t("chatToolsNoteHidden"),
      },
    });

    if (plan.clearFiles) this.files = [];
    this.attach(null);
    // Про этот кусок уже спросили, и он остался в ленте. Выделение в заметке
    // никуда не делось — без этого плашка тут же вернулась бы, и фрагмент уехал
    // бы вторым разом за те же деньги.
    if (plan.dismissQuote) this.dismissed = plan.dismissQuote;
    // Вопрос уходит — значит картинкам пора на диск, если так велено настройкой.
    await this.saveFiles(plan.files);

    const turn = beginTurn(this.host.history, plan.ask);
    const userEl = this.addMessage("user", plan.ask.content, plan.ask.quote, plan.ask);
    userEl.scrollIntoView({ block: "end" });
```

Внимание: `this.host.noteContext()` теперь зовётся всегда, а решение «уедет ли
она» принимает план. Это не меняет наблюдаемого поведения — метод только читает
заметку, — но зовётся он и в приватном чате, где раньше не звался. Если чтение
окажется заметно дорогим, обсудить отдельно; молча оптимизировать нельзя.

- [ ] **Step 2: Заменить сборку сообщений**

Строки от `const messages: ChatMessage[] = []` до `push` текущего вопроса
заменяются на:

```ts
    for (const notice of plan.notices) {
      if (notice === "noteClipped") {
        this.listEl.createDiv({ cls: "ai-notice", text: t("chatContextClipped") });
      }
    }

    const pastFiles = plan.mediaFrom >= 0 ? (plan.past[plan.mediaFrom].attachments ?? []) : [];
    const media: ResolvedMedia = {
      own: { images: await this.imagesFor(plan.files), docs: await this.docsFor(plan.files) },
      past: { images: await this.imagesFor(pastFiles), docs: await this.docsFor(pastFiles) },
    };
    const messages = assembleMessages(plan, media);
```

`canUseTools` дальше по телу берётся из `plan.canUseTools`, `priv` — из
`plan.priv`; их локальные объявления удаляются.

- [ ] **Step 3: Заменить проверки владения**

- `const owned = this.host.history.includes(ask);` → `const owned = ownsTurn(this.host.history, turn);`
- в `keepPartial` параметр `ask: StoredChatMessage` меняется на `turn: Turn`, а условие — на `current && ownsTurn(this.host.history, turn)`; вызовы (`1805`, `1897`) передают `turn`;
- в кнопке «Повторить» весь блок с `history[startAt] === ask`, `splice` и
  `push(...tail.filter(isActionEntry))` заменяется на:

```ts
          // Пока ошибка висела на экране, ленту могли и очистить, и увести в
          // новый разговор — тогда откат не тронет ничего, и повторится только
          // вопрос.
          if (rollbackTurn(this.host.history, turn)) {
            this.host.persistHistory();
            this.repaint();
          }
          void this.submit(text, { ...opts, quote: plan.ask.quote ?? null, files: plan.files });
```

- [ ] **Step 4: Убрать осиротевшее**

- константа `CLIPPED` (`view.ts:77`) — уехала в `request.ts`;
- импорт `contextWindow` из `./history`, если больше не используется;
- импорт `isActionEntry`, если его последнее применение было в кнопке «Повторить»
  (проверить грепом: `grep -n "isActionEntry" src/view.ts`);
- импорт `toolsAllowed`, `messageContent` — там же.

- [ ] **Step 5: Проверить сборку и тесты**

Run: `npx tsc -noEmit -skipLibCheck && npm test && npm run build`
Expected: `tsc` молчит, все тесты зелёные, сборка прошла и легла в хранилище.

- [ ] **Step 6: Посчитать, что вышло**

Run: `wc -l src/view.ts src/request.ts src/turn.ts`
Expected: `view.ts` — примерно на 180 строк короче (было 2457).

- [ ] **Step 7: Коммит**

```bash
git add src/view.ts
git commit -m "submit() stops deciding and starts doing"
```

---

### Task 7: сверка с оригиналом

**Files:**
- Read: `git show 8202239:src/view.ts` — коммит спеки, последний, где `submit()`
  ещё нетронут. Хэш взят намеренно: считать `HEAD~N` при семи коммитах захода
  значит однажды сверить не с тем.

**Interfaces:** ничего не производит — это проверка.

Ни одной новой строки кода. Задача существует потому, что рефакторинг живого
пути ломается тихо: тесты зелёные, а поведение уехало.

- [ ] **Step 1: Построчно сверить старый `submit` с новым**

```bash
git show 8202239:src/view.ts > "$TMPDIR/view-before.ts"
```

На этой машине временные файлы кладутся в скрэтчпад сессии, не в `/tmp`.

Пройти по каждому правилу из старого тела и найти его новое место. Выписать
списком: правило → где живёт теперь. Любое правило, которому не нашлось места, —
дефект, о нём надо сказать вслух, а не дописывать молча.

- [ ] **Step 2: Проверить порядок побочных действий**

Сверить, что порядок остался прежним: снятие плашки → сохранение картинок →
вопрос в ленту → предупреждение об обрезке → чтение вложений → запрос. Порядок
виден пользователю: картинка, снятая с плашки после отправки, и картинка,
снятая до, выглядят одинаково — но при ошибке ведут себя по-разному.

- [ ] **Step 3: Отчитаться**

Написать в ответе: сколько правил перенесено, сколько строк ушло из `view.ts`,
сколько тестов стало, и что осталось проверить живьём (список из спеки,
раздел «Проверка»).

---

## Что дальше

Живой прогон делает Лев по списку из спеки. Дефект, найденный сверкой или
прогоном, чинится отдельным коммитом поверх — так видно, что сломал именно
рефакторинг.
