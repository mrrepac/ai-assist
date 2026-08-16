# Заморозка формата данных и разговор с чистого листа — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать файлам плагина номер формата и честный разбор, перестать терять
чужие настройки, и научить запуск из заметки начинать разговор заново.

**Architecture:** Разбор `data.json` и `history.json` уезжает в новый чистый
модуль `src/store.ts` без единого импорта из `obsidian` — только так тестовый
харнесс может его собрать. `main.ts` остаётся хозяином диска: читает байты,
отдаёт разбирать, спасает непрочитанное в `.bak`. Чистка разговора собирается
из уже готовых кусков `view.ts` (`snapshot` + `cut`), а правило «журнал
остаётся» выносится чистой функцией `dropTalk` в `history.ts`.

**Tech Stack:** TypeScript 4.7, esbuild 0.17, Obsidian API 1.13, тесты — свой
харнесс `tools/test-parse.mjs` на Node без зависимостей.

**Спека:** [docs/superpowers/specs/2026-08-16-data-format-and-fresh-chat-design.md](../specs/2026-08-16-data-format-and-fresh-chat-design.md)

## Global Constraints

- Комментарии и имена в коде — по-русски, как во всём проекте; служебный текст,
  уходящий модели, — по-английски.
- Каждый новый ключ i18n добавляется в **оба** словаря `en` и `ru` в
  `src/i18n.ts`. Ключ только в `ru` не существует для типа `I18nKey`; ключ
  только в `en` молча покажется англоязычной строкой русскому пользователю.
- Lookbehind в регулярках запрещён (iOS < 16.4 роняет весь плагин на разборе).
- Ни `TODO`, ни `console.log`, ни `as any`, ни `innerHTML` — это проверяют при
  подаче в каталог.
- Тесты: `npm test` (запускает `node tools/test-parse.mjs`). Другого прогона в
  проекте нет; новые проверки дописываются в тот же файл.
- Сборка: `npm run build` (это `tsc -noEmit -skipLibCheck` плюс esbuild). Она же
  кладёт копию в хранилище `D:/Obsidian/mrrepac/.obsidian/plugins/ai-assist` —
  после неё плагин в Obsidian перезагружается и правку видно вживую.
- Коммиты — по-английски, повествовательным предложением, без префиксов
  `feat:`/`fix:`. Так написана вся история репозитория.
- `git add -p` в этой среде недоступен: если правки для двух коммитов попали в
  один файл, разделять их правкой файла (вернуть старое → коммит → положить
  новое → коммит).
- **Версию не поднимать и тег не ставить.** Релиз — решение Льва, план
  заканчивается работающим кодом в `master`.
- Номер формата заводится равным **1**. Файл без поля `schemaVersion` — это
  версия 0, и читается он тем же кодом.

---

## Структура файлов

| файл | что делает |
|---|---|
| `src/store.ts` | **новый.** Разбор и сборка `data.json` и `history.json`. Чистые функции, импорт только из `./types`. |
| `src/types.ts` | `StoredData` получает `schemaVersion` и открытый верхний уровень; заводится `StoredHistory`; в настройках заводится `freshOnAction`. |
| `src/history.ts` | заводится `dropTalk` — отбор «лента без разговора». |
| `src/main.ts` | читает и пишет через `store.ts`, спасает непрочитанное в `.bak`, отвечает на `onExternalSettingsChange`, зовёт `freshTalk()` перед запуском из заметки. |
| `src/view.ts` | заводится `freshTalk()`. |
| `src/settings.ts` | строка настройки «Запуск из заметки начинает разговор заново». |
| `src/i18n.ts` | новые ключи в оба языка; дописка в `promptKeepMarkup`. |
| `tools/test-parse.mjs` | проверки разбора битых файлов и `dropTalk`. |
| `docs/data-format.md` | **новый.** Описание формата и правило совместимости. |

---

### Task 1: Разбор `data.json` в `src/store.ts`

**Files:**
- Create: `src/store.ts`
- Modify: `src/types.ts` (интерфейс `StoredData`, новый `StoredHistory`)
- Test: `tools/test-parse.mjs`

**Interfaces:**
- Consumes: `mergeSettings`, `AiAssistSettings`, `HistoryItem`, `StoredData` из `./types`.
- Produces: `SCHEMA: number`, `StoreState = "fresh" | "ok" | "ahead" | "broken"`,
  `readStore(raw: unknown): StoreRead`,
  `writeStore(settings: AiAssistSettings, rest?: Record<string, unknown>): StoredData`,
  где `StoreRead = { settings: AiAssistSettings; legacy?: HistoryItem[]; rest: Record<string, unknown>; state: StoreState }`.

- [ ] **Step 1: Расширить типы в `src/types.ts`**

Заменить нынешний `StoredData` (около строки 243) на:

```ts
/**
 * Что лежит в data.json. Лента переехала в свой history.json — она меняется на
 * каждое слово, а data.json переписывается целиком вместе с настройками. Поле
 * history осталось лишь для настроек прежних версий: прочитали — и перенесли.
 *
 * Верхний уровень открыт нарочно: поле, которого мы не знаем, написала версия
 * новее нашей, и записать его обратно нетронутым дешевле, чем потерять.
 */
export interface StoredData {
  /** Номер формата. Файл прежних версий его не имеет — это версия 0. */
  schemaVersion?: number;
  settings: AiAssistSettings;
  history?: HistoryItem[];
  [key: string]: unknown;
}

/** Что лежит в history.json. Голый массив без обёртки — формат версии 0. */
export interface StoredHistory {
  schemaVersion: number;
  items: HistoryItem[];
}
```

- [ ] **Step 2: Написать падающие тесты**

В `tools/test-parse.mjs` дописать строку загрузки модуля рядом с остальными
(после строки с `chatnote`):

```js
const { SCHEMA, readStore, writeStore } = await load("src/store.ts", "store");
```

И блок проверок перед итоговым `console.log`:

```js
// ——— store: data.json ———
check("файла нет — это первый запуск", readStore(null).state, "fresh");
check("Obsidian не разобрал файл — битый", readStore(undefined).state, "broken");
check("строка вместо объекта — битый", readStore("настройки").state, "broken");
check("массив вместо объекта — битый", readStore([1, 2]).state, "broken");
check("номер формата без настроек — битый", readStore({ schemaVersion: 1 }).state, "broken");
check("пустой объект — старый формат, настройки в корне", readStore({}).state, "ok");
check("настройки в корне читаются", readStore({ temperature: 0.5 }).settings.temperature, 0.5);
check("настройки в обёртке читаются", readStore({ settings: { temperature: 0.5 } }).settings.temperature, 0.5);
check("файл без номера — версия 0, читается", readStore({ settings: {} }).state, "ok");
check("нынешний номер", readStore({ schemaVersion: SCHEMA, settings: {} }).state, "ok");
check("номер больше нашего — файл из будущего", readStore({ schemaVersion: SCHEMA + 1, settings: {} }).state, "ahead");
check(
  "лента из старого data.json достаётся",
  readStore({ settings: {}, history: [{ role: "user", content: "x" }] }).legacy,
  [{ role: "user", content: "x" }],
);
check("своя версия пишется всегда", writeStore(readStore(null).settings).schemaVersion, SCHEMA);
check("настройки в корне не тащат себя на верхний уровень", readStore({ temperature: 0.5 }).rest, {});
check("лента на верхнем уровне не остаётся", readStore({ settings: {}, history: [] }).rest, {});
check("чужое поле верхнего уровня переживает круг", (() => {
  const read = readStore({ schemaVersion: SCHEMA + 1, settings: {}, archive: [7] });
  return writeStore(read.settings, read.rest).archive;
})(), [7]);
check(
  "чужое поле внутри настроек переживает круг",
  readStore({ schemaVersion: SCHEMA + 1, settings: { futureThing: "keep" } }).settings.futureThing,
  "keep",
);
```

- [ ] **Step 3: Прогнать тесты и убедиться, что они падают**

Run: `npm test`
Expected: прогон обрывается ошибкой сборки — `Could not resolve "src/store.ts"`.

- [ ] **Step 4: Написать `src/store.ts`**

```ts
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
  const wrapped = !!obj.settings && typeof obj.settings === "object";
  if (!wrapped) {
    // Номер формата есть, а настроек нет ни в обёртке, ни в корне — это наш
    // файл, и он испорчен.
    if ("schemaVersion" in obj) return blank("broken");
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
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test`
Expected: все проверки блока «store: data.json» отмечены `✓`, `0 упало`.

- [ ] **Step 6: Проверить типы**

Run: `npm run build`
Expected: `tsc` молчит, сборка проходит.

- [ ] **Step 7: Коммит**

```bash
git add src/store.ts src/types.ts tools/test-parse.mjs && git commit -m "A version number for data.json, and an honest answer when it will not parse"
```

---

### Task 2: Разбор `history.json` в том же модуле

**Files:**
- Modify: `src/store.ts`
- Test: `tools/test-parse.mjs`

**Interfaces:**
- Consumes: `StoredHistory`, `HistoryItem` из `./types`.
- Produces: `readHistory(raw: unknown): { items: HistoryItem[]; broken: boolean }`,
  `writeHistoryFile(items: HistoryItem[]): StoredHistory`.

- [ ] **Step 1: Написать падающие тесты**

Дополнить строку загрузки модуля в `tools/test-parse.mjs`:

```js
const { SCHEMA, readStore, writeStore, readHistory, writeHistoryFile } = await load("src/store.ts", "store");
```

Дописать блок проверок следом за блоком из первой задачи:

```js
// ——— store: history.json ———
const talk = [{ role: "user", content: "привет" }];
check("голый массив — формат версии 0", readHistory(talk), { items: talk, broken: false });
check("обёртка с номером", readHistory({ schemaVersion: SCHEMA, items: talk }), { items: talk, broken: false });
check("объект без записей — читать нечего", readHistory({ schemaVersion: SCHEMA }), { items: [], broken: true });
check("строка вместо ленты", readHistory("[]"), { items: [], broken: true });
check("ничего вместо ленты", readHistory(null), { items: [], broken: true });
check("мусор внутри отсеивается", readHistory([null, 1, "x", [], talk[0]]), { items: talk, broken: false });
check("пишем с номером формата", writeHistoryFile(talk), { schemaVersion: SCHEMA, items: talk });
```

- [ ] **Step 2: Прогнать тесты и убедиться, что они падают**

Run: `npm test`
Expected: сборка обрывается — `"readHistory" is not exported by "src/store.ts"`.

- [ ] **Step 3: Дописать `src/store.ts`**

Добавить `StoredHistory` в импорт из `./types` и в конец файла:

```ts
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
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: блок «store: history.json» весь `✓`, `0 упало`.

- [ ] **Step 5: Коммит**

```bash
git add src/store.ts tools/test-parse.mjs && git commit -m "The chat log file gets the same treatment, and stops trusting whatever is inside"
```

---

### Task 3: `main.ts` читает и пишет через `store.ts`

Своих проверок задача не приносит — она переключает плагин на уже проверенный
разбор. Гарантия здесь другая: прежние 412 тестов остаются зелёными, а плагин
поднимается на настоящем хранилище со своими настройками на месте.

**Files:**
- Modify: `src/main.ts` (строки 273–276, 339–376, 457–478)

**Interfaces:**
- Consumes: `readStore`, `writeStore`, `readHistory`, `writeHistoryFile` из `./store`.
- Produces: поле `private rest: Record<string, unknown> = {}` — верхний уровень
  чужого файла, который надо вернуть на место при каждой записи.

- [ ] **Step 1: Подключить модуль и завести поле**

В `src/main.ts` добавить импорт рядом с остальными:

```ts
import { readHistory, readStore, writeHistoryFile, writeStore } from "./store";
```

Рядом с `private settingsTimer: number | null = null;` (строка 158):

```ts
/**
 * Поля верхнего уровня data.json, которых мы не знаем: их написала версия
 * новее нашей. Держим их при себе и возвращаем в файл при каждой записи —
 * иначе вторая машина потеряет своё после первого сохранения здесь.
 */
private rest: Record<string, unknown> = {};
```

- [ ] **Step 2: Переписать `loadStore`**

Заменить первые три строки `loadStore` (строки 374–376):

```ts
    const read = readStore(await this.loadData());
    this.settings = read.settings;
    this.rest = read.rest;
    this.history = (await this.loadHistory(read.legacy)).slice(-HISTORY_LIMIT);
```

- [ ] **Step 3: Переписать чтение и запись ленты**

В `loadHistory` заменить тело `try` (строки 347–355) на:

```ts
    try {
      if (await this.app.vault.adapter.exists(path)) {
        return readHistory(JSON.parse(await this.app.vault.adapter.read(path))).items;
      }
    } catch {
      // Файл побился — лента не то, ради чего стоит падать при загрузке.
      return [];
    }
```

В `writeHistory` заменить строку записи (строка 367) на:

```ts
      await this.app.vault.adapter.write(path, JSON.stringify(writeHistoryFile(history)));
```

- [ ] **Step 4: Переписать все три записи настроек**

Заменить `this.saveData({ settings: this.settings })` на
`this.saveData(writeStore(this.settings, this.rest))` в **четырёх** местах: в
`onunload` (строка 275), в `loadHistory` (строка 359), в `saveSettings`
(строка 464) и в отложенной записи `saveSettingsSoon` (строка 477).

Проверить, что не осталось ни одного:

```bash
grep -n "saveData({ settings" src/main.ts
```

Expected: пусто.

- [ ] **Step 5: Прогнать тесты и собрать**

Run: `npm test && npm run build`
Expected: `412 прошло, 0 упало` плюс новые проверки задач 1–2; `tsc` молчит;
в конце сборки строка `→ vault`.

- [ ] **Step 6: Проверить на живом хранилище**

1. Перезагрузить плагин в Obsidian (настройки → Community plugins → выключить и включить `RU AI Assist`).
2. Открыть панель: настройки, ключ провайдера и модель на месте, лента на месте.
3. Открыть `D:\Obsidian\mrrepac\.obsidian\plugins\ai-assist\data.json` — первой строкой должно появиться `"schemaVersion": 1`.
4. Открыть `history.json` — он должен стать объектом с `schemaVersion` и `items`.

- [ ] **Step 7: Коммит**

```bash
git add src/main.ts && git commit -m "The plugin now reads and writes its files through store.ts"
```

---

### Task 4: Непрочитанный файл копируется, а не затирается

**Files:**
- Modify: `src/main.ts`, `src/i18n.ts`

**Interfaces:**
- Consumes: `readStore` (`state === "broken"`), `readHistory` (`broken`).
- Produces: `private rescue(name: string): Promise<string | null>` — путь к
  копии или `null`, если скопировать не вышло.

- [ ] **Step 1: Завести ключи в оба языка**

В `src/i18n.ts` в словарь `en`, рядом с прочими сообщениями об ошибках:

```ts
  dataBroken:
    "The settings file could not be read, so the defaults are in use. The old file is kept " +
    "next to it as {path} — your API keys are in there.",
  dataBrokenNoCopy:
    "The settings file could not be read, so the defaults are in use. Copying the old file failed.",
```

В словарь `ru`, на том же месте:

```ts
  dataBroken:
    "Файл настроек не прочитался, поэтому работают умолчания. Прежний файл сохранён рядом: " +
    "{path} — ключи провайдеров в нём.",
  dataBrokenNoCopy:
    "Файл настроек не прочитался, поэтому работают умолчания. Скопировать прежний файл не удалось.",
```

- [ ] **Step 2: Завести `rescue` в `src/main.ts`**

Рядом с `historyPath()` (строка 335):

```ts
  /**
   * Отложить копию непрочитанного файла, пока мы не написали поверх него свой.
   * Существующую копию не трогаем: в ней настоящие ключи, а сегодняшний файл
   * мог быть уже огрызком, и вторая попытка затёрла бы хорошее плохим.
   *
   * Расширение .bak выбрано не случайно: файлы плагина Obsidian синхронизирует
   * по точному списку (manifest.json, main.js, styles.css, data.json), и копия
   * в него не попадает — она останется на этой машине.
   */
  private async rescue(name: string): Promise<string | null> {
    const dir = this.manifest.dir;
    if (!dir) return null;
    const to = `${dir}/${name}.bak`;
    try {
      if (await this.app.vault.adapter.exists(to)) return to;
      const raw = await this.app.vault.adapter.read(`${dir}/${name}`);
      if (!raw) return null;
      await this.app.vault.adapter.write(to, raw);
      return to;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 3: Позвать спасение из `loadStore`**

Сразу после `this.rest = read.rest;`:

```ts
    if (read.state === "broken") {
      const bak = await this.rescue("data.json");
      // Молчать тут нельзя: настройки заменились умолчаниями, и первое же
      // сохранение закрепит это на диске. Пятнадцать секунд — чтобы успеть
      // прочитать путь.
      new Notice(bak ? t("dataBroken", { path: bak }) : t("dataBrokenNoCopy"), 15000);
    }
```

- [ ] **Step 4: Спасти и ленту, но молча**

В `loadHistory` заменить блок из третьего шага прошлой задачи на:

```ts
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const read = readHistory(JSON.parse(await this.app.vault.adapter.read(path)));
        // Лента расходная, поэтому копию делаем молча: пугать человека на
        // старте из-за вчерашнего разговора незачем, а вернуть его — можно.
        if (read.broken) await this.rescue("history.json");
        return read.items;
      }
    } catch {
      await this.rescue("history.json");
      return [];
    }
```

- [ ] **Step 5: Собрать**

Run: `npm test && npm run build`
Expected: тесты зелёные, `tsc` молчит.

- [ ] **Step 6: Проверить руками на нарочно испорченном файле**

1. Закрыть Obsidian.
2. Сделать копию настоящего `data.json` где-нибудь вне папки плагина.
3. Дописать в конец `D:\Obsidian\mrrepac\.obsidian\plugins\ai-assist\data.json` мусор (например `}{`), чтобы JSON перестал разбираться.
4. Открыть Obsidian. Ожидается: уведомление про умолчания с путём до копии; рядом с `data.json` появился `data.json.bak` с прежним содержимым.
5. Удалить испорченный `data.json` и `data.json.bak`, вернуть сохранённую копию на место, перезапустить Obsidian, убедиться, что ключи и настройки вернулись.

- [ ] **Step 7: Коммит**

```bash
git add src/main.ts src/i18n.ts && git commit -m "A settings file that will not parse is copied aside, not silently replaced"
```

---

### Task 5: Настройки, приехавшие со второй машины, не затаптываются

**Files:**
- Modify: `src/main.ts` (строка 166 — запомнить вкладку; новый метод рядом с `saveSettings`)

**Interfaces:**
- Consumes: `readStore`, поле `this.rest`, `registerActionCommands()`, `chatView?.refreshHeader()`.
- Produces: `async onExternalSettingsChange(): Promise<void>` — метод Obsidian,
  переопределяется у `Plugin`.

- [ ] **Step 1: Запомнить вкладку настроек**

Заменить строку 166 в `src/main.ts`:

```ts
    this.settingTab = new AiAssistSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
```

и завести поле рядом с `private rest`:

```ts
  /** Вкладка настроек: её надо перерисовать, если файл переписали снаружи. */
  private settingTab: AiAssistSettingTab | null = null;
```

- [ ] **Step 2: Написать сам хук**

Сразу после `saveSettingsSoon()` (строка 479):

```ts
  /**
   * Файл настроек переписан снаружи — обычно синхрой со второй машины.
   * Obsidian зовёт этот хук, только если файл на диске новее прочитанного
   * нами, значит привезённое новее того, что лежит в памяти, и побеждает оно.
   * Без хука картина была обратной: плагин держал своё старое, а ближайшее
   * сохранение клало его поверх нового — а взводится оно на каждую букву
   * черновика.
   *
   * Ленту не трогаем нарочно. Во-первых, history.json синхра не возит: в её
   * списке файлов плагина только manifest.json, main.js, styles.css и
   * data.json. Во-вторых, loadStore при включённом «начинать с пустого чата»
   * чистит историю — и привезённые настройки снесли бы живой разговор.
   */
  async onExternalSettingsChange(): Promise<void> {
    // Взведённую запись гасим, не сбрасывая на диск: она затоптала бы то, что
    // мы прямо сейчас собираемся прочитать.
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    const read = readStore(await this.loadData());
    // Разбирать нечего — своё в памяти целее того, что на диске.
    if (read.state === "broken") return;

    // Черновик вопроса — про эту машину и эту секунду, чужой ему не указ.
    const draft = this.settings.draft;
    this.settings = read.settings;
    this.settings.draft = draft;
    this.rest = read.rest;

    // Действия могли поменяться: у каждого своя команда с хоткеем.
    this.registerActionCommands();
    this.chatView?.refreshHeader();
    // Открытая вкладка настроек показывала бы прежние значения.
    if (this.settingTab?.containerEl.childElementCount) this.settingTab.display();
  }
```

- [ ] **Step 3: Собрать**

Run: `npm test && npm run build`
Expected: тесты зелёные, `tsc` молчит.

- [ ] **Step 4: Проверить руками**

1. Открыть Obsidian с плагином, поставить в настройках температуру `0.7`.
2. Не закрывая Obsidian, править `D:\Obsidian\mrrepac\.obsidian\plugins\ai-assist\data.json` сторонним редактором: заменить `"temperature": 0.7` на `"temperature": 1.1` и добавить на верхнем уровне выдуманное поле `"futureThing": 1`.
3. Вернуться в Obsidian, открыть настройки плагина. Ожидается: температура `1.1`.
4. Изменить что-нибудь в настройках, чтобы вызвать запись, и снова открыть файл. Ожидается: `futureThing` на месте — незнакомое поле пережило запись.
5. Проверить черновик: набрать полфразы в поле ввода панели, повторить пункт 2, убедиться, что набранное осталось в поле.

- [ ] **Step 5: Коммит**

```bash
git add src/main.ts && git commit -m "Settings arriving from the other machine are no longer trampled by ours"
```

---

### Task 6: `dropTalk` — лента без разговора

**Files:**
- Modify: `src/history.ts`
- Test: `tools/test-parse.mjs`

**Interfaces:**
- Consumes: `HistoryItem`, `isActionEntry` из `./types` (уже импортированы в `history.ts`).
- Produces: `dropTalk(history: HistoryItem[]): HistoryItem[]`.

- [ ] **Step 1: Написать падающие тесты**

Дополнить строку загрузки `history` в `tools/test-parse.mjs`:

```js
const { contextWindow, messageText, messageContent, docBlock, clipNote, dropTalk } = await load("src/history.ts", "history");
```

Дописать блок проверок:

```js
// ——— dropTalk ———
const logEntry = { kind: "action", id: "1", action: "Исправить орфографию", status: "done", content: "" };
const secondLog = { kind: "action", id: "2", action: "Сократить", status: "done", content: "" };
const askItem = { role: "user", content: "привет" };
const replyItem = { role: "assistant", content: "ага" };
check("разговор снят, журнал остался", dropTalk([askItem, logEntry, replyItem]), [logEntry]);
check("одни записи журнала — чистить нечего", dropTalk([logEntry]), [logEntry]);
check("пустая лента остаётся пустой", dropTalk([]), []);
check(
  "порядок записей журнала не меняется",
  dropTalk([logEntry, askItem, secondLog]).map((item) => item.id),
  ["1", "2"],
);
```

- [ ] **Step 2: Прогнать тесты и убедиться, что они падают**

Run: `npm test`
Expected: `TypeError: dropTalk is not a function`.

- [ ] **Step 3: Написать `dropTalk`**

В конец `src/history.ts`:

```ts
/**
 * Лента без разговора: остаются одни записи журнала правок. В их карточках
 * живёт кнопка «Отменить правку», поэтому чистка разговора их не касается —
 * то же правило, по которому работает обрезка ленты кнопками под сообщениями.
 */
export function dropTalk(history: HistoryItem[]): HistoryItem[] {
  return history.filter(isActionEntry);
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test`
Expected: блок «dropTalk» весь `✓`, `0 упало`.

- [ ] **Step 5: Коммит**

```bash
git add src/history.ts tools/test-parse.mjs && git commit -m "A conversation can be dropped while the edit log stays where it is"
```

---

### Task 7: Запуск из заметки начинает разговор заново

**Files:**
- Modify: `src/types.ts` (настройка), `src/view.ts` (`freshTalk`), `src/main.ts` (два вызова), `src/settings.ts` (строка настройки), `src/i18n.ts` (три ключа × два языка)

**Interfaces:**
- Consumes: `dropTalk` из `./history`, приватные `snapshot()` и `cut()` из `view.ts`, поле `this.controller`.
- Produces: `ChatView.freshTalk(): void`; настройка `AiAssistSettings.freshOnAction: boolean`.

- [ ] **Step 1: Завести настройку**

В `src/types.ts` в интерфейс `AiAssistSettings`, сразу после `freshStart`
(строка 89):

```ts
  /**
   * Запуск из заметки начинает разговор заново. За прежнюю беседу платят на
   * каждом следующем вопросе, а действие из заметки само себе контекст: на
   * что показали, с тем и работаем.
   */
  freshOnAction: boolean;
```

В `defaultSettings()`, рядом с `freshStart: true` (строка 466):

```ts
    freshOnAction: true,
```

- [ ] **Step 2: Завести ключи в оба языка**

В `src/i18n.ts` в словарь `en`: `chatFreshStarted` рядом с `chatCleared`
(строка 92), пара `setFreshAction` — рядом с `setFreshDesc` (строка 277):

```ts
  chatFreshStarted: "New conversation",
```

```ts
  setFreshAction: "A run from a note starts a new conversation",
  setFreshActionDesc:
    "An action from the quick menu, a one-off prompt or “ask about the selection” clears the " +
    "panel first, so the previous conversation is not paid for again. Edits already made stay " +
    "in the log, and the cleared conversation comes back if you click the notice.",
```

В словарь `ru`, на тех же местах (строки 537 и 717):

```ts
  chatFreshStarted: "Разговор начат заново",
```

```ts
  setFreshAction: "Запуск из заметки начинает разговор заново",
  setFreshActionDesc:
    "Действие из быстрого меню, разовый промпт или «спросить о выделенном» сначала очищают " +
    "панель — за прежний разговор не приходится платить снова. Записи о сделанных правках " +
    "остаются, а стёртый разговор возвращается нажатием по уведомлению.",
```

- [ ] **Step 3: Написать `freshTalk` в `src/view.ts`**

Добавить `dropTalk` в импорт из `./history`, и сразу после `newChat()`
(строка 662):

```ts
  /**
   * Разговор с чистого листа перед запуском из заметки. Сам запрос прошлое и
   * так не тащит, но ответ ложится в ленту — и следующий вопрос, набранный уже
   * в панели, увозит с собой всё накопленное.
   *
   * Записи журнала правок остаются: в их карточках живёт кнопка «Отменить
   * правку», и стереть их значит отобрать возврат. Плашку не трогаем — фрагмент
   * вешает сам вызывающий, а картинки на ней не разговор.
   */
  freshTalk(): void {
    if (!this.host.settings.freshOnAction) return;
    // Живой запрос: его ответ пришёл бы в пустую ленту и повис без вопроса.
    if (this.controller) return;
    const history = this.host.history;
    // Разговора нет — и говорить не о чем: уведомление на пустом месте
    // раздражало бы на каждом нажатии клавиши.
    if (dropTalk(history).length === history.length) return;

    const undo = this.snapshot();
    this.cut(0, history.length);
    undo(t("chatFreshStarted"));
  }
```

- [ ] **Step 4: Позвать его из обоих входов в `src/main.ts`**

В `runAction`, в ветке `action.mode === "chat"` (строка 643), между
`openChat()` и `submit`:

```ts
    if (action.mode === "chat") {
      const chatView = await this.openChat();
      // Действие из заметки само себе контекст: прежний разговор ему не нужен,
      // а платить за него пришлось бы на каждом следующем вопросе.
      chatView.freshTalk();
      await chatView.submit(sel.text, {
```

В `askAboutSelection` (строка 1196), между `openChat()` и `takeSelection`:

```ts
    const chatView = await this.openChat();
    chatView.freshTalk();
    chatView.takeSelection(sel.text);
```

- [ ] **Step 5: Добавить строку в настройки**

В `src/settings.ts` сразу после блока `setFresh` (строка 551):

```ts
    new Setting(containerEl)
      .setName(t("setFreshAction"))
      .setDesc(t("setFreshActionDesc"))
      .addToggle((c) =>
        c.setValue(s.freshOnAction).onChange(async (v) => {
          s.freshOnAction = v;
          await this.save();
        }),
      );
```

- [ ] **Step 6: Прогнать тесты и собрать**

Run: `npm test && npm run build`
Expected: тесты зелёные, `tsc` молчит, `→ vault`.

- [ ] **Step 7: Проверить руками**

1. Перезагрузить плагин. В настройках должен появиться новый переключатель, включённый.
2. В панели задать пару вопросов — лента растёт.
3. В заметке выделить абзац, нажать Alt+1, выбрать «Оценить текст» (режим «показать в панели»). Ожидается: лента очистилась, в ней только новый вопрос с ответом, всплыло «Разговор начат заново».
4. Нажать по уведомлению. Ожидается: прежний разговор вернулся.
5. Прогнать по выделению «Исправить орфографию» (правка в заметке) — в ленте появилась карточка журнала. Потом нажать Alt+1 → «Оценить текст». Ожидается: карточка журнала **осталась**, кнопка «Отменить правку» на ней жива.
6. Выключить переключатель в настройках, повторить пункт 3. Ожидается: лента больше не чистится.

- [ ] **Step 8: Коммит**

```bash
git add src/types.ts src/view.ts src/main.ts src/settings.ts src/i18n.ts && git commit -m "A run from the note starts the conversation over, so the old one is not paid for twice"
```

---

### Task 8: Промпт — знаки не подменять

**Files:**
- Modify: `src/i18n.ts` (`promptKeepMarkup`, оба языка: строки 30 и 476)

Правка идёт в общую оговорку, а не в промпт орфографии: знаки модель подменяет
одинаково в «сократить» и «улучшить», а `promptKeepMarkup` живёт в i18n и
потому доезжает до всех сам — промпт действия лежит в `data.json` и потребовал
бы дописки в `LEGACY_PROMPTS`.

- [ ] **Step 1: Дописать фразу в английский словарь**

В конец строки `promptKeepMarkup` в словаре `en`, после слов про два пробела:

```ts
    " Do not swap the characters themselves: a hyphen must not become an em dash and a plain " +
    "space must not become a non-breaking or thin one — return the same character that came in.",
```

- [ ] **Step 2: Дописать фразу в русский словарь**

В конец строки `promptKeepMarkup` в словаре `ru`:

```ts
    " Сами знаки не подменяй: дефис не превращай в длинное тире, а обычный пробел — в " +
    "неразрывный или узкий; какой знак пришёл, такой и верни.",
```

- [ ] **Step 3: Собрать**

Run: `npm test && npm run build`
Expected: тесты зелёные, `tsc` молчит.

- [ ] **Step 4: Проверить вживую — это обязательный шаг**

Прошлая правка этого же промпта уехала в 0.9.0 непроверенной. Здесь проверка
дешёвая:

1. Завести в хранилище заметку с текстом, где есть дефисы в роли тире и обычные пробелы вокруг них, например: `Он пришёл - и сразу всё понял. Кто-то из них - точно врёт.`
2. Выделить, прогнать «Исправить орфографию».
3. Ожидается: в ответе те же дефисы `-`, а не `—`.
4. Проверить пробелы точно, а не на глаз: скопировать получившийся текст в `check.txt` в скрэтчпаде и прогнать там

```bash
node -e "const s=require('fs').readFileSync('check.txt','utf8');const n=r=>(s.match(r)||[]).length;console.log('длинных тире:',n(/[\u2014\u2013]/g),'типографских пробелов:',n(/[\u00A0\u2002\u2003\u2009\u202F]/g))"
```

Ожидается: оба счётчика в нуле — в исходной заметке ни длинных тире, ни типографских пробелов не было.
5. Если модель всё равно ставит тире — не выпускать, а докрутить формулировку и повторить.

- [ ] **Step 5: Коммит**

```bash
git add src/i18n.ts && git commit -m "The characters that came in are the characters that come back"
```

---

### Task 9: Описание формата

**Files:**
- Create: `docs/data-format.md`

- [ ] **Step 1: Написать файл**

```markdown
# Формат данных плагина

Плагин держит два файла в своей папке
(`<хранилище>/.obsidian/plugins/ai-assist/`).

## data.json — настройки

```json
{
  "schemaVersion": 1,
  "settings": { "...": "..." }
}
```

- `schemaVersion` — номер формата. Файл без него написан версией плагина до
  0.10.0 и читается как версия 0.
- `settings` — всё, что видно во вкладке настроек, плюс профили провайдеров
  (`profiles`), где лежат ключи API, список действий и раскладка быстрого меню.

Файл переписывается целиком при каждом сохранении настроек и с задержкой в
секунду — при правке черновика вопроса.

## history.json — лента панели

```json
{
  "schemaVersion": 1,
  "items": [ { "role": "user", "content": "..." } ]
}
```

Голый массив вместо объекта — формат версии 0, он же лежит у всех, кто ставил
плагин до 0.10.0. В `items` вперемешку лежат реплики разговора и записи журнала
правок (у последних есть поле `kind: "action"`).

Лента живёт отдельно от настроек, потому что переписывается на каждое слово
ответа. Obsidian Sync её не возит: в его списке файлов плагина только
`manifest.json`, `main.js`, `styles.css` и `data.json`.

## Правила совместимости

1. **Поля, которых мы не знаем, беречь.** Их написала версия новее нашей —
   значит на второй машине их ждут на месте. Внутри `settings` это делает
   `mergeSettings`, на верхнем уровне файла — `rest` в `store.ts`.
2. **Номер формата растёт, только если прежний файл нельзя прочитать нынешним
   кодом.** Новое поле — это не новый формат.
3. **Файл с номером больше нашего читается как умеем**, без предупреждений и
   без попыток «починить».
4. **Непрочитанный файл не затирается.** Прежде чем писать поверх, плагин
   откладывает копию `<имя>.bak` и, если речь о настройках, говорит об этом
   вслух. Существующая копия не перезаписывается.
5. Разбор живёт в `src/store.ts` и не импортирует `obsidian` — чтобы его можно
   было прогнать тестом (`tools/test-parse.mjs`).
```

- [ ] **Step 2: Коммит**

```bash
git add docs/data-format.md && git commit -m "docs/data-format.md: what lies in the plugin's files and what may not be broken"
```

---

## После плана

Кодом всё закрыто. Дальше — решение Льва, планом не назначается:

- поднимать ли версию до 0.10.0, писать ли `release-notes/0.10.0.md` и ставить
  ли тег; **смену поведения (запуск из заметки чистит разговор) выносить в
  заметках первым разделом** — так делали со сменой Enter/Ctrl+Enter в 0.4.0;
- из списка к 1.0.0 после этого захода остаются: тесты в `view.ts`/`main.ts` с
  выносом машины состояний, мобильный проход по вложениям и «отлежаться».
