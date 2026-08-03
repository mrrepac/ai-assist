/*
 * Тесты разбора ответа модели и потока SSE.
 * Запуск: npm test
 *
 * Почему они есть: поток режется сетью на произвольных границах — событие
 * запросто приходит половиной, и наивный разбор теряет куски текста. А ответ
 * модели, как её ни проси, регулярно приезжает в кавычках или в блоке кода,
 * и это нельзя класть в заметку как есть.
 */
import esbuild from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";

// i18n тянет moment из obsidian — в Node его нет, подменяем заглушкой.
const obsidianStub = {
  name: "obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, (args) => ({ path: args.path, namespace: "obsidian-stub" }));
    build.onLoad({ filter: /.*/, namespace: "obsidian-stub" }, () => ({
      contents: `export const moment = { locale: () => "en" };
                 export const requestUrl = async () => { throw new Error("not in tests"); };`,
      loader: "js",
    }));
  },
};

async function load(entry, name) {
  const outfile = join(tmpdir(), `ai-assist-${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    outfile,
    plugins: [obsidianStub],
    logLevel: "error",
  });
  return import("file:///" + outfile.replace(/\\/g, "/"));
}

const { drainSse, endpoint, collectToolCalls, isLocalUrl } = await load("src/api.ts", "api");
const { cleanReply, offsetAt } = await load("src/actions.ts", "actions");
const { contextWindow } = await load("src/history.ts", "history");
const { mergeSettings, providerOf, streamAvailable, switchProvider, defaultSettings, PROVIDER_ORDER, providerRank } = await load("src/types.ts", "types");
const { chatToMarkdown } = await load("src/chatnote.ts", "chatnote");
const { parseCall, runCall } = await load("src/tools.ts", "tools");
const { diffWords } = await load("src/diff.ts", "diff");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${name}` + (ok ? "" : `\n    получил: ${JSON.stringify(got)}\n    ожидал:  ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// ——— endpoint ———
check("адрес без хвоста", endpoint("https://api.deepseek.com", "/chat/completions"), "https://api.deepseek.com/chat/completions");
check("адрес со слэшем", endpoint("https://api.deepseek.com/", "/chat/completions"), "https://api.deepseek.com/chat/completions");
check("адрес с /v1", endpoint("https://openrouter.ai/api/v1", "/chat/completions"), "https://openrouter.ai/api/v1/chat/completions");
check("уже полный путь", endpoint("https://x.ai/v1/chat/completions", "/chat/completions"), "https://x.ai/v1/chat/completions");
check("без протокола", endpoint("api.deepseek.com", "/models"), "https://api.deepseek.com/models");
check("пустая строка → DeepSeek", endpoint("", "/models"), "https://api.deepseek.com/models");

// ——— разбор потока ———
const collect = (chunks) => {
  let text = "";
  let buffer = "";
  for (const c of chunks) {
    buffer += c;
    buffer = drainSse(buffer, (e) => {
      const d = e.choices?.[0]?.delta?.content;
      if (d) text += d;
    });
  }
  return text;
};

const event = (s) => `data: {"choices":[{"delta":{"content":${JSON.stringify(s)}}}]}\n\n`;

check("целые события", collect([event("При"), event("вет")]), "Привет");
check(
  "событие разорвано пополам",
  collect(["data: {\"choices\":[{\"delta\":{\"cont", "ent\":\"Привет\"}}]}\n\n"]),
  "Привет",
);
check("хвост без перевода строки ждёт", collect([event("Раз") + "data: {\"choices\":[{\"delta\":{\"content\":\"два\"}}]}"]), "Раз");
check("[DONE] не ломает разбор", collect([event("Всё"), "data: [DONE]\n\n"]), "Всё");
check("пинги двоеточием игнорируются", collect([": keep-alive\n\n", event("ок")]), "ок");
check("битый JSON пропускается", collect(["data: {не json}\n\n", event("живо")]), "живо");
check("несколько событий в одном чанке", collect([event("а") + event("б") + event("в")]), "абв");

// ——— чистка ответа ———
check("блок кода снимается", cleanReply("```\nтекст\n```", "текст"), "текст");
check("блок кода с языком снимается", cleanReply("```markdown\n# Заголовок\n```", "# Заголовок"), "# Заголовок");
check("код остаётся кодом, если и был им", cleanReply("```js\nlet a = 1;\n```", "```js\nlet b = 2;\n```"), "```js\nlet a = 1;\n```");
check("кавычки вокруг ответа снимаются", cleanReply('"Привет, мир"', "привет мир"), "Привет, мир");
check("кавычки внутри текста не трогаются", cleanReply('Он сказал "нет" и ушёл', 'Он сказал "нет" и ушел'), 'Он сказал "нет" и ушёл');
check("ёлочки снимаются", cleanReply("«Тишина»", "тишина"), "Тишина");
check("отступ слева сохраняется", cleanReply("исправлено", "    ошибка"), "    исправлено");
check("перевод строки справа сохраняется", cleanReply("исправлено", "ошибка\n\n"), "исправлено\n\n");
check("пробелы по обоим краям", cleanReply("текст", " ошибка "), " текст ");

// ——— слияние настроек ———
check(
  "пустые данные дают встроенные действия",
  mergeSettings(null).actions.map((a) => a.id),
  ["spelling", "clarify", "expand", "shorten", "evaluate", "transcript"],
);
check("температура за пределами чинится", mergeSettings({ temperature: 9 }).temperature, 2);
check("температура строкой читается", mergeSettings({ temperature: "0.7" }).temperature, 0.7);
check("мусор в temperature → значение по умолчанию", mergeSettings({ temperature: "нет" }).temperature, 0.3);
check(
  "правленый промпт встроенного действия переживает обновление",
  mergeSettings({ actions: [{ id: "spelling", name: "Свой корректор", prompt: "мой промпт", mode: "replace", icon: "x" }] })
    .actions.find((a) => a.id === "spelling").prompt,
  "мой промпт",
);

// Заготовки правятся от версии к версии, и обновление должно доезжать до тех,
// кто промпт не трогал, — иначе новый текст увидят только новые пользователи.
const legacySpelling =
  "Ты корректор. Исправь в тексте орфографию, пунктуацию и опечатки. " +
  "Не меняй стиль, порядок слов, лексику и разметку Markdown. " +
  "Сохраняй авторский голос, сленг и намеренные отступления от нормы. " +
  "Если исправлять нечего — верни текст без изменений.";
const fresh = mergeSettings(null).actions.find((a) => a.id === "spelling").prompt;
check(
  "заводский промпт прошлой версии обновляется",
  mergeSettings({ actions: [{ id: "spelling", name: "Исправить орфографию", prompt: legacySpelling, mode: "replace", icon: "x" }] })
    .actions.find((a) => a.id === "spelling").prompt,
  fresh,
);
check(
  "промпт с приписанной строкой считается своим",
  mergeSettings({ actions: [{ id: "spelling", name: "x", prompt: legacySpelling + "\nИ ещё не трогай мат.", mode: "replace", icon: "x" }] })
    .actions.find((a) => a.id === "spelling").prompt,
  legacySpelling + "\nИ ещё не трогай мат.",
);
check("новые промпты не пустые", fresh.length > 500, true);
// Заглушка obsidian в тестах отдаёт локаль en, поэтому и заготовки английские.
check("новый промпт бережёт вики-ссылки", fresh.includes("[[double square brackets]]"), true);
check("новый промпт бережёт разбивку на строки", fresh.includes("broken into lines"), true);
check(
  "удалённое встроенное действие возвращается",
  mergeSettings({ actions: [] }).actions.length,
  6,
);
check(
  "новые заготовки доезжают до старой установки",
  mergeSettings({ actions: [{ id: "spelling", name: "x", prompt: "p", mode: "replace", icon: "i" }] })
    .actions.map((a) => a.id)
    .includes("clarify"),
  true,
);
check(
  "пользовательское действие сохраняется",
  mergeSettings({ actions: [{ id: "custom-1", name: "Моё", prompt: "п", mode: "chat", icon: "x" }] })
    .actions.map((a) => a.id),
  ["spelling", "clarify", "expand", "shorten", "evaluate", "transcript", "custom-1"],
);

// Перевод убрали из заготовок совсем. Доставшееся от плагина действие вычищаем,
// но только пока промпт заводской: переписанный под себя — это уже своя работа.
const legacyTranslate =
  "Переведи текст на {lang}. Сохрани разметку Markdown, переносы строк и структуру " +
  "оригинала. Имена собственные оставляй как есть, если нет устоявшегося перевода. " +
  "Передавай смысл и интонацию, а не переводи дословно.";
check(
  "заводский перевод вычищается",
  mergeSettings({ actions: [{ id: "translate", name: "Перевести", prompt: legacyTranslate, mode: "replace", icon: "languages" }] })
    .actions.map((a) => a.id)
    .includes("translate"),
  false,
);
// «Форматирование» правило чистки делало само, промпта у него не было — такое
// действие после сноса заготовки просто нечего сохранять.
check(
  "форматирование вычищается",
  mergeSettings({ actions: [{ id: "format", name: "Форматирование", prompt: "", mode: "replace", icon: "eraser" }] })
    .actions.map((a) => a.id)
    .includes("format"),
  false,
);
check(
  "переписанный под себя перевод остаётся",
  mergeSettings({ actions: [{ id: "translate", name: "Мой перевод", prompt: "переведи на клингонский", mode: "replace", icon: "languages" }] })
    .actions.find((a) => a.id === "translate").builtin,
  false,
);
check("встроенное нельзя пометить удаляемым", mergeSettings({ actions: [{ id: "spelling", name: "x", prompt: "p", mode: "replace", icon: "i", builtin: false }] }).actions[0].builtin, true);

// ——— вызовы инструментов из потока ———
const toolCalls = (chunks) => {
  const calls = new Map();
  let buffer = "";
  for (const c of chunks) {
    buffer += c;
    buffer = drainSse(buffer, (e) => {
      const delta = e.choices?.[0]?.delta;
      if (delta) collectToolCalls(delta, calls);
    });
  }
  return [...calls.values()];
};
const toolEvent = (obj) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [obj] } }] })}\n\n`;

check(
  "аргументы склеиваются из кусков",
  toolCalls([
    toolEvent({ index: 0, id: "call_1", type: "function", function: { name: "insert_text", arguments: "" } }),
    toolEvent({ index: 0, function: { arguments: '{"text":"При' } }),
    toolEvent({ index: 0, function: { arguments: 'вет"}' } }),
  ]),
  [{ id: "call_1", name: "insert_text", arguments: '{"text":"Привет"}' }],
);
check(
  "два инструмента в одном ответе не смешиваются",
  toolCalls([
    toolEvent({ index: 0, id: "a", function: { name: "insert_text", arguments: '{"text":"раз"}' } }),
    toolEvent({ index: 1, id: "b", function: { name: "create_note", arguments: '{"title":"Сыр"}' } }),
  ]).map((c) => c.name),
  ["insert_text", "create_note"],
);
check("имя тоже может приехать частями", toolCalls([
  toolEvent({ index: 0, id: "c", function: { name: "insert_", arguments: "" } }),
  toolEvent({ index: 0, function: { name: "text", arguments: "{}" } }),
])[0].name, "insert_text");

// ——— разбор вызова ———
const HERE = "Заметки/Текущая.md";
check("аргументы разбираются", parseCall({ id: "1", name: "insert_text", arguments: '{"text":"Привет"}' }, HERE).args.text, "Привет");
check("пишущий инструмент помечается", parseCall({ id: "1", name: "insert_text", arguments: "{}" }, HERE).writes, true);
check("чтение не считается правкой", parseCall({ id: "1", name: "read_note", arguments: "{}" }, HERE).writes, false);
check("неизвестный инструмент не выполняется", parseCall({ id: "1", name: "rm_rf", arguments: "{}" }, HERE).name, null);
check("неизвестный инструмент не пишет", parseCall({ id: "1", name: "rm_rf", arguments: "{}" }, HERE).writes, false);
check("оборванный JSON не роняет разбор", parseCall({ id: "1", name: "insert_text", arguments: '{"text":"обры' }, HERE).args, {});
check("пустые аргументы допустимы", parseCall({ id: "1", name: "read_note", arguments: "" }, HERE).args, {});
check("превью берётся из текста", parseCall({ id: "1", name: "append_to_note", arguments: '{"text":"хвост"}' }, HERE).preview, "хвост");

// ——— цель правки прибита к карточке ———
// Пока карточка ждёт «Применить», пользователь уходит смотреть другую заметку.
// Правка обязана либо лечь туда, где её показали, либо не лечь никуда.
check("цель запоминается при разборе", parseCall({ id: "1", name: "insert_text", arguments: "{}" }, HERE).path, HERE);
check("замена выделения тоже помнит цель", parseCall({ id: "1", name: "replace_selection", arguments: "{}" }, HERE).path, HERE);
check("новой заметке цель не нужна", parseCall({ id: "1", name: "create_note", arguments: '{"title":"Т"}' }, HERE).path, null);
check("неизвестному инструменту цель не нужна", parseCall({ id: "1", name: "rm_rf", arguments: "{}" }, HERE).path, null);
check("без открытой заметки цели нет", parseCall({ id: "1", name: "insert_text", arguments: "{}" }, null).path, null);

const hostAt = (path, noteBody = "текст", clipped = false) => ({
  targetPath: () => path,
  readNote: () => (path ? { path, text: noteBody, clipped } : null),
  noteText: (want) => (want === path ? noteBody : null),
  insertText: (_text, want) => want === path,
  replaceNote: (_text, want) => want === path,
  replaceSelection: (_text, want) => want === path,
  appendToNote: (_text, want) => want === path,
  createNote: async () => null,
  replaceInNote: (find, _replace, want) => {
    if (want !== path) return "gone";
    const at = noteBody.indexOf(find);
    if (at === -1) return "missing";
    if (noteBody.indexOf(find, at + find.length) !== -1) return "many";
    return "ok";
  },
});
const write = (name, args, notePath, hostPath) =>
  runCall(hostAt(hostPath), parseCall({ id: "1", name, arguments: JSON.stringify(args) }, notePath));

check("правка ложится в ту же заметку", (await write("insert_text", { text: "х" }, HERE, HERE)).startsWith("Inserted"), true);
check("ушли в другую заметку — правки нет", (await write("insert_text", { text: "х" }, HERE, "Другая.md")).startsWith("Failed"), true);
check("закрыли заметку — правки нет", (await write("append_to_note", { text: "х" }, HERE, null)).startsWith("Failed"), true);
check("без открытой заметки писать некуда", (await write("replace_selection", { text: "х" }, null, HERE)).startsWith("Failed"), true);
check("пустой текст не пишется", (await write("insert_text", { text: "" }, HERE, HERE)).startsWith("Nothing"), true);

// ——— правка без выделения ———
// Раньше менять уже написанный текст умел только replace_selection, а он без
// выделения падал: в чате заметку было не отредактировать вовсе.
const inNote = (args, body) =>
  runCall(hostAt(HERE, body), parseCall({ id: "1", name: "replace_in_note", arguments: JSON.stringify(args) }, HERE));

check("фрагмент заменяется без выделения", (await inNote({ find: "сыра", replace: "сыру" }, "кусок сыра тут")).startsWith("Replaced"), true);
check("не найденный фрагмент — понятный отказ", (await inNote({ find: "нетути", replace: "х" }, "кусок сыра тут")).includes("read_note"), true);
// Два вхождения — угадывать нельзя: правка уедет не туда, и заметит уже человек.
check("два вхождения — просим уточнить", (await inNote({ find: "сыр", replace: "х" }, "сыр и ещё сыр")).includes("more than once"), true);
check("пустой find не ищется", (await inNote({ find: "", replace: "х" }, "текст")).startsWith("Nothing"), true);
check("замена помнит цель", parseCall({ id: "1", name: "replace_in_note", arguments: "{}" }, HERE).path, HERE);
check("замена считается правкой", parseCall({ id: "1", name: "replace_in_note", arguments: "{}" }, HERE).writes, true);
check(
  "на карточке видно, что на что меняется",
  parseCall({ id: "1", name: "replace_in_note", arguments: '{"find":"было","replace":"стало"}' }, HERE).preview,
  "было\n↓\nстало",
);
check("переписывание заметки — тоже правка", parseCall({ id: "1", name: "replace_note", arguments: "{}" }, HERE).writes, true);
check("заметка переписывается целиком", (await write("replace_note", { text: "новый текст" }, HERE, HERE)).startsWith("Rewrote"), true);
check("ушли из заметки — переписывания нет", (await write("replace_note", { text: "х" }, HERE, "Другая.md")).startsWith("Failed"), true);

// ——— чтение обрезанной заметки ———
// Начало длинной заметки модель иначе примет за весь текст и перепишет её по
// половине — про обрезку ей надо сказать прямо.
const readWith = (clipped) =>
  runCall(hostAt(HERE, "текст", clipped), parseCall({ id: "1", name: "read_note", arguments: "{}" }, HERE));
check("обрезка заметки видна модели", (await readWith(true)).includes("only the beginning"), true);
check("целая заметка отдаётся без оговорок", (await readWith(false)).includes("only the beginning"), false);

// ——— что уходит в контекст ———
// Мерить контекст штуками сообщений нельзя: двадцать реплик бывают и на строчку,
// и на страницу, а платят за символы.
const said = (n, size = 10) =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "я".repeat(size) }));
check("короткий разговор уходит целиком", contextWindow(said(6)).length, 6);
check("в бюджет влезает столько, сколько влезает", contextWindow(said(10, 100), 250).length, 2);
check("берётся хвост разговора, а не начало", contextWindow([...said(2), { role: "user", content: "последнее" }], 20).at(-1).content, "последнее");
check("порядок реплик не переворачивается", contextWindow(said(4)).map((m) => m.role), ["user", "assistant", "user", "assistant"]);
check("одна огромная реплика всё равно берётся", contextWindow([{ role: "user", content: "я".repeat(500) }], 100).length, 1);
check("предел на число реплик работает", contextWindow(said(50, 1), 100000, 10).length, 10);
check(
  "записи журнала в запрос не уходят",
  contextWindow([{ kind: "action", id: "1", action: "Правка", status: "done", content: "х" }, ...said(2)]).length,
  2,
);
check("пустая лента — пустой контекст", contextWindow([]).length, 0);

// ——— координаты правки в закрытой заметке ———
// Редактора нет, а вернуть текст надо ровно на то место, где он был.
const LINES = "первая\nвторая\nтретья";
check("начало текста", offsetAt(LINES, 0, 0), 0);
check("вторая строка", offsetAt(LINES, 1, 0), 7);
check("середина строки", offsetAt(LINES, 2, 3), 17);
check("конец строки", offsetAt(LINES, 0, 6), 6);
check("строки за концом текста нет", offsetAt(LINES, 9, 0), null);
check("колонки за концом строки нет", offsetAt(LINES, 0, 99), null);

// ——— слоты быстрого меню ———
const FRESH_SLOTS = [
  "spelling",
  "expand",
  "clarify",
  "shorten",
  "evaluate",
  "transcript",
  "@ask",
  "",
  "",
];
check("слотов всегда девять", mergeSettings({ quickSlots: ["spelling"] }).quickSlots.length, 9);
check("слоты по умолчанию", mergeSettings(null).quickSlots, FRESH_SLOTS);
check(
  "набор из прошлой версии заменяется новым",
  mergeSettings({ quickSlots: ["spelling", "translate", "evaluate", "transcript", "@ask"] }).quickSlots,
  FRESH_SLOTS,
);
check(
  "ещё более старый набор тоже заменяется",
  mergeSettings({ quickSlots: ["spelling", "translate", "evaluate"] }).quickSlots,
  FRESH_SLOTS,
);
check(
  "набор с переводом заменяется",
  mergeSettings({ quickSlots: ["spelling", "clarify", "shorten", "evaluate", "translate"] }).quickSlots,
  FRESH_SLOTS,
);
// Наборы времён «форматирования»: заготовки уже нет, но слоты, оставшиеся от
// тех версий, должны замениться нынешними, а не просто потерять одну клавишу.
check(
  "набор с форматированием заменяется",
  mergeSettings({ quickSlots: ["spelling", "format", "clarify", "shorten", "evaluate"] }).quickSlots,
  FRESH_SLOTS,
);
check(
  "сдвинутый ряд возвращается на место",
  mergeSettings({ quickSlots: ["spelling", "expand", "format", "shorten", "evaluate"] }).quickSlots,
  FRESH_SLOTS,
);
check(
  "набор 0.1.x заменяется новым",
  mergeSettings({ quickSlots: ["spelling", "expand", "clarify", "shorten", "evaluate"] }).quickSlots,
  FRESH_SLOTS,
);
// Ряд стал длиннее: разложенное вручную остаётся на своих клавишах, а новые
// слоты добираются умолчаниями — теми, что в набор ещё не попали.
check(
  "переложенный вручную набор не переставляют",
  mergeSettings({ quickSlots: ["transcript", "spelling", "@ask", "", ""] }).quickSlots,
  ["transcript", "spelling", "@ask", "", "", "expand", "clarify", "shorten", "evaluate"],
);
check(
  "при удлинении ряда действие не задваивается",
  mergeSettings({ quickSlots: ["transcript", "spelling", "@ask", "", ""] })
    .quickSlots.filter((id) => id === "spelling").length,
  1,
);
check(
  "осознанно пустой слот остаётся пустым",
  mergeSettings({ quickSlots: ["spelling", "", "", "", ""] }).quickSlots[1],
  "",
);
check("ссылка на удалённое действие вычищается", mergeSettings({ quickSlots: ["нет-такого", "", "", "", ""] }).quickSlots[0], "");
check("спецпункт переживает проверку", mergeSettings({ quickSlots: ["@ask", "", "", "", ""] }).quickSlots[0], "@ask");
// Перевода больше нет — слот, где он лежал, освобождается сам.
check("убранный спецпункт вычищается", mergeSettings({ quickSlots: ["@ask", "@translate-to", "", "", ""] }).quickSlots[1], "");

// ——— сравнение «было → стало» ———
// Диф отдаёт поток кусков; для проверок сворачиваем его обратно в пары
// «было→стало» — так видно суть правки, а не разметку.
const changes = (a, b) => {
  const segs = diffWords(a, b)?.segments ?? [];
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].kind === "del") {
      const next = segs[i + 1];
      if (next?.kind === "ins") {
        out.push(`${segs[i].text.trim()}→${next.text.trim()}`);
        i++;
      } else {
        out.push(`${segs[i].text.trim()}→`);
      }
    } else if (segs[i].kind === "ins") {
      out.push(`→${segs[i].text.trim()}`);
    }
  }
  return out;
};
const segs = (a, b) => (diffWords(a, b)?.segments ?? []).map((s) => `${s.kind}:${s.text}`);

check("одно исправленное слово", changes("на лугу пасётся карова", "на лугу пасётся корова"), ["карова→корова"]);
check("две правки в разных местах", changes("карова и лашадь", "корова и лошадь"), ["карова→корова", "лашадь→лошадь"]);
check("вставленное слово", changes("идёт дождь", "идёт сильный дождь"), ["→сильный"]);
check("убранное слово", changes("идёт сильный дождь", "идёт дождь"), ["сильный→"]);
check("замена нескольких слов подряд", changes("он шёл очень медленно домой", "он брёл домой"), ["шёл очень медленно→брёл"]);
check("одинаковый текст — правок нет", diffWords("текст", "текст"), null);
check("правка в начале", changes("превет мир", "привет мир"), ["превет→привет"]);
check("правка в конце", changes("привет мор", "привет мир"), ["мор→мир"]);
check("пунктуация считается частью слова", changes("да,конечно", "да, конечно"), ["да,конечно→да, конечно"]);
// Общий пробел внутри группы правок раньше проглатывался, и соседние слова
// склеивались: «сыравкуснейшего! → вкуснейшегосыра!».
check("переставленные слова не склеиваются", changes("сыра вкуснейшего!", "вкуснейшего сыра!"), ["сыра вкуснейшего!→вкуснейшего сыра!"]);
// Слово, пережившее перестановку без изменений, становится якорем: обмен
// местами раскладывается на «убрали здесь» и «добавили там» — это правильно.
check("перестановка вокруг общего слова — две правки", changes("купил сыра вкуснейшего вчера", "купил вкуснейшего сыра вчера"), ["сыра→", "→сыра"]);
check("замена двух слов подряд сохраняет пробел", changes("очень вкусный сыр", "крайне приятный сыр"), ["очень вкусный→крайне приятный"]);
check(
  "перенос строки не считается правкой сам по себе",
  changes("первая строка\nвторая строка", "первая строка\nвторая строка"),
  [],
);
// Счётчики в словах: замена — это и убранное слово, и добавленное.
check("замена считается с обеих сторон", (() => { const d = diffWords("а б в", "а г в"); return [d.added, d.removed]; })(), [1, 1]);
check("чистая вставка ничего не убирает", (() => { const d = diffWords("идёт дождь", "идёт сильный дождь"); return [d.added, d.removed]; })(), [1, 0]);
check("чистое удаление ничего не добавляет", (() => { const d = diffWords("идёт сильный дождь", "идёт дождь"); return [d.added, d.removed]; })(), [0, 1]);

// ——— правка показывается в окружении ———
check(
  "уцелевший текст остаётся рядом с правкой",
  segs("купил сыр вчера", "купил хлеб вчера"),
  ["same:купил ", "del:сыр", "ins:хлеб", "same: вчера"],
);
const far = (() => {
  const filler = "ровный текст ".repeat(30);
  return segs("начало " + filler + "конец", "старт " + filler + "финиш");
})();
check("далёкие правки разделяются многоточием", far.some((s) => s.startsWith("gap:")), true);
check("окружение не разрастается на весь текст", far.filter((s) => s.startsWith("same:")).every((s) => s.length - 5 <= 140), true);
check(
  "огромная переделка сворачивается в счётчики",
  diffWords("слово ".repeat(4000), "иное ".repeat(4000)).tooMany,
  true,
);
check(
  "мелкая правка в огромном тексте всё равно находится",
  changes("хвост ".repeat(5000) + "карова", "хвост ".repeat(5000) + "корова"),
  ["карова→корова"],
);

// ——— провайдеры ———
check("адрес ChadGPT достраивается", endpoint("https://ask.chadgpt.ru/api/v1", "/chat/completions"), "https://ask.chadgpt.ru/api/v1/chat/completions");
check("deepseek узнаётся по адресу", providerOf({ baseUrl: "https://api.deepseek.com" }), "deepseek");
check("хвостовой слэш не мешает", providerOf({ baseUrl: "https://api.polza.ai/api/v1/" }), "polza");
check("polza узнаётся по адресу", providerOf({ baseUrl: "https://api.polza.ai/api/v1" }), "polza");
check("chadgpt узнаётся по адресу", providerOf({ baseUrl: "https://ask.chadgpt.ru/api/v1" }), "chadgpt");
// У ChadGPT нет CORS-заголовков, поэтому поток недоступен — ответ забирается целиком.
check("поток у ChadGPT выключен", streamAvailable({ baseUrl: "https://ask.chadgpt.ru/api/v1" }), false);
check("поток у DeepSeek доступен", streamAvailable({ baseUrl: "https://api.deepseek.com" }), true);
check("поток у Polza доступен", streamAvailable({ baseUrl: "https://api.polza.ai/api/v1" }), true);
check("gptunnel узнаётся по адресу", providerOf({ baseUrl: "https://gptunnel.ru/v1" }), "gptunnel");
check("поток у GPTunnel доступен", streamAvailable({ baseUrl: "https://gptunnel.ru/v1" }), true);
check("чужой адрес — свой провайдер", providerOf({ baseUrl: "https://openrouter.ai/api/v1" }), "custom");

// ——— профили провайдеров ———
check("профилей по умолчанию нет", mergeSettings(null).profiles, {});
check(
  "ключ из версии без профилей достаётся текущему провайдеру",
  mergeSettings({ baseUrl: "https://api.deepseek.com", apiKey: "sk-старый", model: "deepseek-v4-pro" }).profiles,
  { deepseek: { apiKey: "sk-старый", model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com" } },
);
check(
  "сохранённые профили переживают загрузку",
  mergeSettings({
    profiles: {
      deepseek: { apiKey: "sk-1", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com" },
      polza: { apiKey: "sk-2", model: "openai/gpt-4o", baseUrl: "https://api.polza.ai/api/v1" },
    },
  }).profiles.polza.apiKey,
  "sk-2",
);
check(
  "битый профиль не роняет загрузку",
  mergeSettings({ profiles: { polza: { apiKey: 42 } } }).profiles.polza,
  { apiKey: "", model: "", baseUrl: "" },
);
// Строка вместо объекта отбрасывается целиком, а дальше обычная миграция
// заводит профиль активного провайдера — пустых ключей в нём быть не должно.
check("мусор вместо профилей", Object.keys(mergeSettings({ profiles: "ой" }).profiles), ["deepseek"]);
check(
  "готовый профиль не перетирается текущими полями",
  mergeSettings({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-текущий",
    profiles: { deepseek: { apiKey: "sk-сохранённый", model: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com" } },
  }).profiles.deepseek.apiKey,
  "sk-сохранённый",
);

// ——— поведение без выделения ———
check("по умолчанию берётся вся заметка", mergeSettings(null).noSelection, "note");
check("старый выключенный фолбэк остаётся запретом", mergeSettings({ paragraphFallback: false }).noSelection, "none");
check("старый включённый фолбэк становится заметкой", mergeSettings({ paragraphFallback: true }).noSelection, "note");
check("явно выбранный абзац сохраняется", mergeSettings({ noSelection: "paragraph" }).noSelection, "paragraph");
check("мусор в поле чинится", mergeSettings({ noSelection: "ой" }).noSelection, "note");
check(
  "своё действие остаётся в слоте",
  mergeSettings({
    actions: [{ id: "custom-9", name: "Моё", prompt: "п", mode: "replace", icon: "x" }],
    quickSlots: ["custom-9", "", "", "", ""],
  }).quickSlots[0],
  "custom-9",
);
check("мусор вместо массива → умолчания", mergeSettings({ quickSlots: "ой" }).quickSlots.length, 9);

// ——— свои промпты ———
check("промпты по умолчанию пусты", mergeSettings(null).recentPrompts, []);
check("промпты переживают загрузку", mergeSettings({ recentPrompts: ["сократи", "разверни"] }).recentPrompts, ["сократи", "разверни"]);
check("не-строки отсеиваются", mergeSettings({ recentPrompts: ["ок", 5, null] }).recentPrompts, ["ок"]);
check("мусор вместо списка промптов", mergeSettings({ recentPrompts: "ой" }).recentPrompts, []);

// ——— порядок провайдеров ———
// Один список на выпадающее меню в настройках и на меню в шапке панели.
check("порядок провайдеров", PROVIDER_ORDER, ["deepseek", "chadgpt", "gptunnel", "polza", "ollama"]);
check("ollama узнаётся по адресу", providerOf({ baseUrl: "http://localhost:11434/v1" }), "ollama");
// Пресет LM Studio убран, но его адрес у кого-то остался в настройках: он
// должен работать дальше как «свой адрес», а не превратиться в поломку.
check("адрес убранного пресета становится своим", providerOf({ baseUrl: "http://localhost:1234/v1" }), "custom");
check("и остаётся локальным, то есть без ключа", isLocalUrl("http://localhost:1234/v1"), true);

// ——— локальный сервер ———
// Ключа у него нет и спрашивать не у кого: решаем по адресу, а не по пресету,
// потому что «свой адрес» тоже запросто оказывается локальным.
check("localhost — локальный", isLocalUrl("http://localhost:11434/v1"), true);
check("127.0.0.1 — локальный", isLocalUrl("http://127.0.0.1:1234/v1"), true);
check("ipv6-петля — локальная", isLocalUrl("http://[::1]:11434/v1"), true);
check("свой порт тоже локальный", isLocalUrl("http://localhost:8080"), true);
check("облако не локальное", isLocalUrl("https://api.deepseek.com"), false);
// Домен, начинающийся с localhost, — чужой: localhost.evil.com локальным не считаем.
check("похожий домен не локальный", isLocalUrl("https://localhost.example.com/v1"), false);
check("пустой адрес не локальный", isLocalUrl(""), false);
check("локальный адрес без протокола идёт по http", endpoint("localhost:11434/v1", "/chat/completions"), "http://localhost:11434/v1/chat/completions");
check("облачный адрес без протокола идёт по https", endpoint("api.deepseek.com", "/models"), "https://api.deepseek.com/models");
check("свой адрес уходит в конец", providerRank("custom") > providerRank("polza"), true);
check(
  "профили из data.json раскладываются по списку",
  ["polza", "custom", "deepseek", "gptunnel", "chadgpt"].sort((a, b) => providerRank(a) - providerRank(b)),
  ["deepseek", "chadgpt", "gptunnel", "polza", "custom"],
);

// ——— хоткей по умолчанию ———
// Своя клавиша на чужой клавиатуре — навязанное решение, поэтому новая
// установка получает её выключенной. А у того, кто к Alt+1 уже привык, она
// должна остаться: настройки без этого поля — признак прежней установки.
check("новая установка без хоткея", mergeSettings(null).defaultHotkey, false);
check("прежняя установка сохраняет Alt+1", mergeSettings({ freshStart: true }).defaultHotkey, true);
check("выключенный вручную не включается обратно", mergeSettings({ defaultHotkey: false }).defaultHotkey, false);
check("включённый вручную переживает загрузку", mergeSettings({ defaultHotkey: true }).defaultHotkey, true);
check("мусор в поле чинится", mergeSettings({ defaultHotkey: "ага" }).defaultHotkey, true);

// ——— чистая лента при запуске ———
check("по умолчанию чат открывается пустым", mergeSettings(null).freshStart, true);
check("выключенный режим переживает загрузку", mergeSettings({ freshStart: false }).freshStart, false);

// ——— переключение провайдера ———
// Уходя, ключ и модель прежнего должны остаться в его профиле, иначе при первом
// же переключении туда-обратно ключ теряется.
const moved = (() => {
  const s = defaultSettings();
  s.apiKey = "ключ-deepseek";
  s.model = "deepseek-v4-pro";
  s.profiles.polza = { apiKey: "ключ-polza", model: "google/gemini", baseUrl: "https://api.polza.ai/api/v1" };
  switchProvider(s, "polza");
  return s;
})();
check("ключ прежнего провайдера сохранился", moved.profiles.deepseek.apiKey, "ключ-deepseek");
check("модель прежнего провайдера сохранилась", moved.profiles.deepseek.model, "deepseek-v4-pro");
check("ключ нового подставился", moved.apiKey, "ключ-polza");
check("модель нового подставилась", moved.model, "google/gemini");
check("адрес взят из пресета", moved.baseUrl, "https://api.polza.ai/api/v1");
check("вид эндпоинта сменился", moved.kind, "openai");
check("возврат обратно достаёт свой ключ", (() => { switchProvider(moved, "deepseek"); return moved.apiKey; })(), "ключ-deepseek");
check("незнакомый провайдер без профиля — модели нет", (() => { const s = defaultSettings(); switchProvider(s, "gptunnel"); return s.model; })(), "");

// ——— разговор в заметку ———
const talk = [
  { kind: "action", id: "1", action: "Исправить орфографию", status: "done", content: "текст" },
  { role: "user", content: "Первый вопрос" },
  { role: "assistant", content: "Первый ответ" },
];
const md = chatToMarkdown(talk, "модель-1", "02.08.2026 04:41");
check("вопрос уходит цитатой", md.includes("> Первый вопрос"), true);
check("ответ идёт как есть", md.includes("\nПервый ответ"), true);
check("модель и дата в шапке", md.includes("*модель-1, 02.08.2026 04:41*"), true);
// Журнал правок — отчёт о работе, а не разговор: в сохранённом чате он лишний.
check("записи журнала не попадают в заметку", md.includes("Исправить орфографию"), false);
check("многострочный вопрос цитируется целиком", chatToMarkdown([{ role: "user", content: "раз\nдва" }], "м", "д").includes("> раз\n> два"), true);
check("пустая строка внутри цитаты не ломает разметку", chatToMarkdown([{ role: "user", content: "раз\n\nдва" }], "м", "д").includes("> раз\n>\n> два"), true);
check("сохранять нечего — пустая строка", chatToMarkdown([], "м", "д"), "");
check("один журнал без разговора — сохранять нечего", chatToMarkdown([talk[0]], "м", "д"), "");
check("пустые реплики пропускаются", chatToMarkdown([{ role: "user", content: "   " }], "м", "д"), "");

console.log(`\n${pass} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
