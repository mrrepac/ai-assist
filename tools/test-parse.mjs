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
                 export const requestUrl = async () => { throw new Error("not in tests"); };
                 export class TFile {}`,
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

const { drainSse, endpoint, collectToolCalls, isLocalUrl, readSources } = await load("src/api.ts", "api");
const { cleanReply, offsetAt, sectionAt, sectionName } = await load("src/actions.ts", "actions");
const { contextWindow, messageText, messageContent, docBlock } = await load("src/history.ts", "history");
const { fitSize, isImagePath, isAttachablePath, embeddedFiles, pastedName, stamp, humanSize, AttachmentStore } = await load("src/attach.ts", "attach");
const { isPdfPath, joinItems, tidy, clipPages } = await load("src/pdf.ts", "pdf");
const { mergeSettings, providerOf, streamAvailable, streamAllowed, configFor, switchProvider, defaultSettings, PROVIDER_ORDER, providerRank, toolsAllowed, builtinModels, activeConfig } = await load("src/types.ts", "types");
const { chatToMarkdown } = await load("src/chatnote.ts", "chatnote");
const { stripCitations } = await load("src/cite.ts", "cite");
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
// Пустой адрес когда-то подставлял DeepSeek: выбрал «свой адрес», ещё ничего не
// вписал, нажал «Проверить» — и ключ уехал чужому провайдеру.
const thrown = (fn) => {
  try {
    fn();
    return "без ошибки";
  } catch (e) {
    return e.name;
  }
};
check("пустой адрес — отказ, а не чужой провайдер", thrown(() => endpoint("", "/models")), "ApiError");
check("метод в адресе не мешает списку моделей", endpoint("https://x.ai/v1/chat/completions", "/models"), "https://x.ai/v1/models");
check("хвостовой /models тоже снимается", endpoint("https://x.ai/v1/models", "/chat/completions"), "https://x.ai/v1/chat/completions");

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

// Причина остановки приезжает последним событием, с пустой дельтой: по ней
// видно, что ответ оборван на пределе длины, — такой в заметку писать нельзя.
const finishOf = (raw) => {
  let reason = "";
  drainSse(raw, (e) => {
    const r = e.choices?.[0]?.finish_reason;
    if (r) reason = r;
  });
  return reason;
};
check(
  "предел длины виден в последнем событии",
  finishOf(event("текст") + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'),
  "length",
);
check(
  "обычное окончание — не обрыв",
  finishOf(event("текст") + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'),
  "stop",
);
check("без причины остановки поле пустое", finishOf(event("текст")), "");

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
  ["spelling", "clarify", "expand", "shorten", "evaluate"],
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
// Чистка расшифровки дожила до 0.2.0 и убрана после неё — её заводский промпт
// нужен тут, чтобы проверить, что сохранённая копия вычищается при загрузке.
const legacyTranscript =
  "Текст — автоматическая расшифровка устной речи. Сделай её читаемой, не превращая в пересказ.\n\n" +
  "Убери: пустые слова-паразиты (ну, вот, как бы, типа, значит, короче, это самое), звуки-заминки, " +
  "повтор слова подряд, оговорки вместе с самоисправлением — оставляй итоговый вариант, " +
  "фразы, брошенные на полуслове.\n\n" +
  "Расставь: пунктуацию, заглавные буквы, абзацы по смысловым кускам. Перечисление, которое в " +
  "речи звучит списком, оформи списком. Диалог и цитаты — тире или кавычками.\n\n" +
  "Сохрани: все мысли и их порядок, авторские выражения, образы и шутки, живую разговорную " +
  "интонацию. Оборот вроде «и тут до меня дошло» — это голос автора, а не мусор.\n\n" +
  "Исправляй явные ошибки распознавания, когда верное слово очевидно из контекста: омофоны, " +
  "имена, термины, числа. Не очевидно — оставь как есть, выдумывать нельзя.\n\n" +
  "Запрещено: сокращать содержание, обобщать, дописывать своё, переводить в книжный стиль или " +
  "канцелярит. Ни одна мысль не должна пропасть, ни одной новой — появиться.";
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
check("новые промпты не пустые", fresh.length > 120, true);
// Название заготовки лежит в data.json так же, как промпт, и так же не доезжает
// само: прежнее меняем на нынешнее, своё не трогаем.
check(
  "прежнее название заготовки обновляется",
  mergeSettings({ actions: [{ id: "clarify", name: "Сделать понятнее", prompt: "п", mode: "replace", icon: "x" }] })
    .actions.find((a) => a.id === "clarify").name,
  "Improve the text",
);
check(
  "своё название заготовки остаётся",
  mergeSettings({ actions: [{ id: "clarify", name: "Причесать", prompt: "п", mode: "replace", icon: "x" }] })
    .actions.find((a) => a.id === "clarify").name,
  "Причесать",
);
// Заглушка obsidian в тестах отдаёт локаль en, поэтому и заготовки английские.
check("промпт орфографии запрещает переписывать", fresh.includes("Rewrite nothing"), true);
check(
  "удалённое встроенное действие возвращается",
  mergeSettings({ actions: [] }).actions.length,
  5,
);
// Чистку расшифровки убрали: заводская копия вычищается, переписанная остаётся.
check(
  "заводская расшифровка вычищается",
  mergeSettings({ actions: [{ id: "transcript", name: "Почистить расшифровку", prompt: legacyTranscript, mode: "replace", icon: "mic" }] })
    .actions.map((a) => a.id)
    .includes("transcript"),
  false,
);
check(
  "переписанная под себя расшифровка остаётся",
  mergeSettings({ actions: [{ id: "transcript", name: "Моя чистка", prompt: "убери мусор", mode: "replace", icon: "mic" }] })
    .actions.find((a) => a.id === "transcript").builtin,
  false,
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
  ["spelling", "clarify", "expand", "shorten", "evaluate", "custom-1"],
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

// Обязательны у действия только id и промпт: остальные поля дописывались в
// разные версии, да и data.json правят руками. Недостающее имя тут роняло
// загрузку целиком — вместе с настройками и лентой.
check(
  "действие без имени не роняет загрузку",
  mergeSettings({ actions: [{ id: "custom-7", prompt: "п" }] }).actions.length,
  6,
);
check(
  "имени нет — подставляется заготовочное",
  mergeSettings({ actions: [{ id: "custom-7", prompt: "п" }] }).actions.at(-1).name.length > 0,
  true,
);
check(
  "мусор в режиме действия чинится",
  mergeSettings({ actions: [{ id: "custom-7", name: "Моё", prompt: "п", mode: "ой" }] }).actions.at(-1).mode,
  "replace",
);
check(
  "иконки нет — берётся запасная",
  mergeSettings({ actions: [{ id: "custom-7", name: "Моё", prompt: "п" }] }).actions.at(-1).icon,
  "sparkles",
);
check(
  "встроенное без имени тоже переживает загрузку",
  mergeSettings({ actions: [{ id: "spelling", prompt: "мой промпт" }] }).actions[0].prompt,
  "мой промпт",
);

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
// Часть провайдеров шлёт имя целиком в каждом чанке: склейка дала бы
// «read_noteread_note», а такого инструмента нет — правка бы не состоялась.
check("повторённое имя не удваивается", toolCalls([
  toolEvent({ index: 0, id: "d", function: { name: "read_note", arguments: "" } }),
  toolEvent({ index: 0, function: { name: "read_note", arguments: "{}" } }),
])[0].name, "read_note");

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
// Результат вызова — пара «получилось / что сказать модели». Проверки текста
// смотрят на текст, а отдельные — на сам признак: по нему панель решает, писать
// на карточке «Применено» или «Не прошло».
const call = (name, args, notePath, hostPath) =>
  runCall(hostAt(hostPath), parseCall({ id: "1", name, arguments: JSON.stringify(args) }, notePath));
const write = async (...args) => (await call(...args)).text;

check("правка ложится в ту же заметку", (await write("insert_text", { text: "х" }, HERE, HERE)).startsWith("Inserted"), true);
check("ушли в другую заметку — правки нет", (await write("insert_text", { text: "х" }, HERE, "Другая.md")).startsWith("Failed"), true);
check("закрыли заметку — правки нет", (await write("append_to_note", { text: "х" }, HERE, null)).startsWith("Failed"), true);
check("без открытой заметки писать некуда", (await write("replace_selection", { text: "х" }, null, HERE)).startsWith("Failed"), true);
check("пустой текст не пишется", (await write("insert_text", { text: "" }, HERE, HERE)).startsWith("Nothing"), true);

// ——— правка без выделения ———
// Раньше менять уже написанный текст умел только replace_selection, а он без
// выделения падал: в чате заметку было не отредактировать вовсе.
const inNoteCall = (args, body) =>
  runCall(hostAt(HERE, body), parseCall({ id: "1", name: "replace_in_note", arguments: JSON.stringify(args) }, HERE));
const inNote = async (...args) => (await inNoteCall(...args)).text;

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
const readWith = async (clipped) =>
  (await runCall(hostAt(HERE, "текст", clipped), parseCall({ id: "1", name: "read_note", arguments: "{}" }, HERE))).text;
check("обрезка заметки видна модели", (await readWith(true)).includes("only the beginning"), true);
check("целая заметка отдаётся без оговорок", (await readWith(false)).includes("only the beginning"), false);

// ——— получилось или нет ———
// Панель до этого писала «Применено» на любой исход и клала в ленту запись о
// сделанной работе — даже когда фрагмент не нашёлся и заметка осталась прежней.
check("удавшаяся правка помечается", (await call("insert_text", { text: "х" }, HERE, HERE)).ok, true);
check("ушли из заметки — правки не было", (await call("insert_text", { text: "х" }, HERE, "Другая.md")).ok, false);
check("пустой текст правкой не считается", (await call("insert_text", { text: "" }, HERE, HERE)).ok, false);
check("ненайденный фрагмент — не правка", (await inNoteCall({ find: "нетути", replace: "х" }, "текст")).ok, false);
check("два вхождения — не правка", (await inNoteCall({ find: "сыр", replace: "х" }, "сыр и сыр")).ok, false);
check("замена одного вхождения удалась", (await inNoteCall({ find: "сыра", replace: "сыру" }, "кусок сыра")).ok, true);
check("неизвестный инструмент не выполнен", (await call("rm_rf", {}, HERE, HERE)).ok, false);
check("чтение заметки удалось", (await call("read_note", {}, HERE, HERE)).ok, true);
check("читать нечего — не удалось", (await call("read_note", {}, HERE, null)).ok, false);

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

// ——— выделенный фрагмент при вопросе ———
// Вопрос «а покороче?» без фрагмента, о котором он задан, ничего не значит —
// значит фрагмент обязан уходить и в этот запрос, и во все следующие.
check("фрагмент уходит вместе с вопросом", messageText({ role: "user", content: "а покороче?", quote: "длинный кусок" }).includes("длинный кусок"), true);
check("вопрос без фрагмента не обрастает служебным", messageText({ role: "user", content: "привет" }), "привет");
check("сам вопрос никуда не девается", messageText({ role: "user", content: "а покороче?", quote: "кусок" }).endsWith("а покороче?"), true);
check(
  "фрагмент считается в бюджет контекста",
  contextWindow([{ role: "user", content: "х", quote: "я".repeat(300) }, { role: "user", content: "второй" }], 100).length,
  1,
);

// ——— координаты правки в закрытой заметке ———
// Редактора нет, а вернуть текст надо ровно на то место, где он был.
const LINES = "первая\nвторая\nтретья";
check("начало текста", offsetAt(LINES, 0, 0), 0);
check("вторая строка", offsetAt(LINES, 1, 0), 7);
check("середина строки", offsetAt(LINES, 2, 3), 17);
check("конец строки", offsetAt(LINES, 0, 6), 6);
check("строки за концом текста нет", offsetAt(LINES, 9, 0), null);
check("колонки за концом строки нет", offsetAt(LINES, 0, 99), null);

// ——— раздел под курсором ———
// Правка идёт по невидимым границам: ошибка здесь — это переписанный не тот
// кусок заметки, и заметит её пользователь, а не тест.
const SONG = [
  "---",              // 0
  "tags: [песня]",    // 1
  "# заголовок в frontmatter не заголовок",  // 2
  "---",              // 3
  "черновик",         // 4
  "",                 // 5
  "## Куплет 1",      // 6
  "строка про снег",  // 7
  "",                 // 8
  "### Вариант",      // 9
  "строка про дождь", // 10
  "",                 // 11
  "",                 // 12
  "## Припев",        // 13
  "строка про свет",  // 14
];
check("курсор в куплете — от заголовка", sectionAt(SONG, 7), { from: 6, to: 10 });
// Подраздел — часть раздела сверху, но если курсор стоит в нём самом, берём
// его: это ближайшая граница, и она мельче.
check("подраздел входит в раздел целиком", sectionAt(SONG, 7).to, 10);
check("курсор в подразделе — берётся подраздел", sectionAt(SONG, 10), { from: 9, to: 10 });
check("курсор на заголовке — его же раздел", sectionAt(SONG, 6), { from: 6, to: 10 });
check("пустые строки перед следующим заголовком отброшены", sectionAt(SONG, 7).to, 10);
check("последний раздел — до конца заметки", sectionAt(SONG, 14), { from: 13, to: 14 });
check("до первого заголовка — начало заметки", sectionAt(SONG, 4), { from: 4, to: 4 });
check("frontmatter в раздел не попадает", sectionAt(SONG, 0), { from: 4, to: 4 });

// Черта между разделами: в сценариях Льва ею отбит каждый эпизод, и уехать в
// модель она не должна — вернётся текст без неё, и разделы слипнутся.
const RULED = ["текст", "", "---", "", "## Дальше", "ещё текст"];
check("черта между разделами в раздел не входит", sectionAt(RULED, 0), { from: 0, to: 0 });
check("«Заголовок\\n---» — сетекст, черту не трогаем", sectionAt(["Заголовок", "---", "текст"], 2), {
  from: 0,
  to: 2,
});

// Заметка из одного frontmatter: текста нет вовсе, и диапазон не должен
// оказаться вывернутым — по нему пойдёт замена в редакторе.
const ONLY_FRONT = sectionAt(["---", "tags: [x]", "---"], 1);
check("заметка без текста — диапазон не вывернут", ONLY_FRONT.to >= ONLY_FRONT.from, true);

const PLAIN = ["просто заметка", "", "без заголовков"];
check("заголовков нет — вся заметка", sectionAt(PLAIN, 1), { from: 0, to: 2 });
check("пустых строк нет — одна строка", sectionAt(["строка"], 0), { from: 0, to: 0 });

const CODE = [
  "# Заметка",        // 0
  "```bash",          // 1
  "# это комментарий, а не заголовок",  // 2
  "echo привет",      // 3
  "```",              // 4
  "хвост",            // 5
  "# Другая заметка", // 6
];
check("решётка в блоке кода не заголовок", sectionAt(CODE, 3), { from: 0, to: 5 });
check("равный уровень обрывает раздел", sectionAt(CODE, 6), { from: 6, to: 6 });
check("~~~ внутри ``` не закрывает ограду", sectionAt(["# Т", "```", "~~~", "# нет", "```", "хвост"], 3), { from: 0, to: 5 });

check("имя раздела без решёток", sectionName("## Куплет 1"), "Куплет 1");
check("длинное имя обрезается", sectionName("### " + "я".repeat(40)).length, 30);
check("не заголовок — имени нет", sectionName("просто строка"), "");

// ——— слоты быстрого меню ———
const FRESH_SLOTS = ["spelling", "expand", "clarify", "shorten", "evaluate"];
check("клавиш по умолчанию пять", mergeSettings({ quickSlots: ["spelling"] }).quickSlots.length, 5);
check("слоты по умолчанию", mergeSettings(null).quickSlots, FRESH_SLOTS);
// Клавиши сверх пяти заводятся руками, и их число должно пережить загрузку.
check(
  "добавленные клавиши остаются",
  mergeSettings({ quickSlots: ["spelling", "expand", "clarify", "shorten", "evaluate", "@ask", "spelling"] })
    .quickSlots.length,
  7,
);
check(
  "пустой хвост от прежнего ряда отбрасывается",
  mergeSettings({ quickSlots: ["spelling", "expand", "clarify", "shorten", "evaluate", "@ask", "", "", ""] })
    .quickSlots.length,
  6,
);
check(
  "больше девяти клавиш не бывает",
  mergeSettings({ quickSlots: Array.from({ length: 12 }, () => "spelling") }).quickSlots.length,
  9,
);
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
  "переложенный вручную набор не трогают",
  mergeSettings({ quickSlots: ["evaluate", "spelling", "@ask", "", ""] }).quickSlots,
  ["evaluate", "spelling", "@ask", "", ""],
);
// Настройки из версии, где клавиш было меньше пяти: недостающие добираются
// умолчаниями, но только теми, что в набор ещё не попали.
check(
  "короткий ряд достраивается без повторов",
  mergeSettings({ quickSlots: ["spelling", "@ask"] }).quickSlots.filter((id) => id === "spelling").length,
  1,
);
check("короткий ряд дорастает до пяти", mergeSettings({ quickSlots: ["spelling", "@ask"] }).quickSlots.length, 5);
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
// Считается n×m клеток, поэтому предел стоит и на произведении: каждая сторона
// сама по себе в MAX_TOKENS укладывается, а вместе они дают почти семь
// миллионов клеток на одно сравнение.
check(
  "две огромные стороны сворачиваются в один счёт",
  diffWords("слово ".repeat(1300), "иное ".repeat(1300)).segments.length,
  0,
);
// Правок тут всё равно больше, чем показывают (это уже про MAX_CHANGES), но
// первые из них видны — а из-за предела на клетки не осталось бы ни одной.
check(
  "переписанная заметка обычного размера всё ещё показывается правками",
  diffWords("слово ".repeat(700), "иное ".repeat(700)).segments.length > 0,
  true,
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
check("раздел сохраняется", mergeSettings({ noSelection: "section" }).noSelection, "section");

// Порог, после которого плагин переспрашивает. Ноль осмысленный — «не
// спрашивать», поэтому пустое поле в старых настройках и ноль это разные вещи.
check("порог по умолчанию", mergeSettings(null).warnOver, 20000);
check("свой порог сохраняется", mergeSettings({ warnOver: 100000 }).warnOver, 100000);
check("ноль — это «не спрашивать», а не мусор", mergeSettings({ warnOver: 0 }).warnOver, 0);
check("настройки прошлой версии получают порог по умолчанию", mergeSettings({ temperature: 1 }).warnOver, 20000);
check("мусор в пороге чинится", mergeSettings({ warnOver: "много" }).warnOver, 20000);
check("отрицательный порог — это ноль", mergeSettings({ warnOver: -5 }).warnOver, 0);
check("дробный порог округляется", mergeSettings({ warnOver: 1000.7 }).warnOver, 1001);
check("мусор в поле чинится", mergeSettings({ noSelection: "ой" }).noSelection, "note");
check(
  "своё действие остаётся в слоте",
  mergeSettings({
    actions: [{ id: "custom-9", name: "Моё", prompt: "п", mode: "replace", icon: "x" }],
    quickSlots: ["custom-9", "", "", "", ""],
  }).quickSlots[0],
  "custom-9",
);
check("мусор вместо массива → умолчания", mergeSettings({ quickSlots: "ой" }).quickSlots.length, 5);

// ——— свои промпты ———
check("промпты по умолчанию пусты", mergeSettings(null).recentPrompts, []);
check("промпты переживают загрузку", mergeSettings({ recentPrompts: ["сократи", "разверни"] }).recentPrompts, ["сократи", "разверни"]);
check("не-строки отсеиваются", mergeSettings({ recentPrompts: ["ок", 5, null] }).recentPrompts, ["ок"]);
check("мусор вместо списка промптов", mergeSettings({ recentPrompts: "ой" }).recentPrompts, []);

// ——— вопросы из чата и черновик ———
// Тот же список, что у промптов быстрого меню, но свой: стрелка в панели листает
// вопросы, а не правки текста.
check("вопросов по умолчанию нет", mergeSettings(null).recentAsks, []);
check("вопросы переживают загрузку", mergeSettings({ recentAsks: ["а покороче?"] }).recentAsks, ["а покороче?"]);
check("не-строки отсеиваются и здесь", mergeSettings({ recentAsks: [1, "ок"] }).recentAsks, ["ок"]);
check("мусор вместо списка вопросов", mergeSettings({ recentAsks: 7 }).recentAsks, []);
check("длинный список обрезается", mergeSettings({ recentAsks: Array.from({ length: 15 }, (_, i) => String(i)) }).recentAsks.length, 10);
check("черновика по умолчанию нет", mergeSettings(null).draft, "");
check("черновик переживает загрузку", mergeSettings({ draft: "недописанный воп" }).draft, "недописанный воп");
check("мусор вместо черновика", mergeSettings({ draft: { a: 1 } }).draft, "");

// ——— контекстное меню ———
check("меню по умолчанию — два пункта", mergeSettings(null).editorMenu, "quick");
check("выбранный режим сохраняется", mergeSettings({ editorMenu: "actions" }).editorMenu, "actions");
check("выключенное меню сохраняется", mergeSettings({ editorMenu: "none" }).editorMenu, "none");
check("мусор в режиме меню чинится", mergeSettings({ editorMenu: "всё" }).editorMenu, "quick");

// ——— порядок провайдеров ———
// Один список на выпадающее меню в настройках и на меню в шапке панели.
check("порядок провайдеров", PROVIDER_ORDER, ["deepseek", "chadgpt", "gptunnel", "polza", "perplexity", "ollama"]);
check("ollama узнаётся по адресу", providerOf({ baseUrl: "http://localhost:11434/v1" }), "ollama");
// Пресет LM Studio убран, но его адрес у кого-то остался в настройках: он
// должен работать дальше как «свой адрес», а не превратиться в поломку.
check("адрес убранного пресета становится своим", providerOf({ baseUrl: "http://localhost:1234/v1" }), "custom");
check("и остаётся локальным, то есть без ключа", isLocalUrl("http://localhost:1234/v1"), true);

// ——— Perplexity ———
// Поисковик с моделью поверх: OpenAI-совместим по адресу и методу, но списка
// моделей не отдаёт, инструментов не умеет и кладёт в ответ ссылки.
check("perplexity узнаётся по адресу", providerOf({ baseUrl: "https://api.perplexity.ai" }), "perplexity");
check("адрес perplexity достраивается", endpoint("https://api.perplexity.ai", "/chat/completions"), "https://api.perplexity.ai/chat/completions");
check("поток у perplexity доступен", streamAvailable({ baseUrl: "https://api.perplexity.ai" }), true);
// Инструменты ей слать нельзя: function calling она не умеет, и запрос с ними
// отлетал бы четырёхсотой на каждый вопрос.
check("инструментов у perplexity нет", toolsAllowed("perplexity"), false);
check("у остальных инструменты на месте", toolsAllowed("deepseek"), true);
check("у своего адреса инструменты не запрещаем", toolsAllowed("custom"), true);
// GET /models у неё отсутствует — кнопка «Получить список» упёрлась бы в 404
// с подписью «по этому адресу такой модели нет», то есть соврала бы дважды.
check("список моделей встроенный", builtinModels("perplexity").includes("sonar-pro"), true);
check("у остальных списка нет — спрашиваем провайдера", builtinModels("deepseek"), null);
// Первая модель из встроенного списка подставляется сама: иначе после выбора
// провайдера поле модели пустое, а угадать имя нельзя.
check("модель подставляется при переключении", (() => { const s = defaultSettings(); switchProvider(s, "perplexity"); return s.model; })(), "sonar");
check("адрес тоже из пресета", (() => { const s = defaultSettings(); switchProvider(s, "perplexity"); return s.baseUrl; })(), "https://api.perplexity.ai");

// ——— ссылки под ответом ———
// Ради них поисковую модель и берут: без источников её ответ ничем не отличается
// от выдуманного, проверить нечего.
check(
  "search_results разбираются",
  readSources({ search_results: [{ title: "Устав", url: "https://a.ru/x", date: "2026-01-02" }] }),
  [{ url: "https://a.ru/x", title: "Устав", date: "2026-01-02", n: 1 }],
);
// Модель ссылается прямо в тексте — «родился в Москве[1][6]», — и цифра там
// означает место в ЕЁ списке. Выброшенный повтор или нерабочий адрес не должен
// сдвигать номера у всего хвоста, иначе ссылки покажут на чужие источники.
check(
  "номер держится за источником, а не за местом в списке",
  readSources({ citations: ["https://a.ru/1", "javascript:alert(1)", "https://a.ru/3"] }).map((s) => s.n),
  [1, 3],
);
check(
  "повтор не сдвигает номера следующих",
  readSources({ citations: ["https://a.ru/1", "https://a.ru/1", "https://a.ru/3"] }).map((s) => s.n),
  [1, 3],
);
check(
  "citations идут запасным вариантом",
  readSources({ citations: ["https://b.ru/1", "https://b.ru/2"] }).map((s) => s.url),
  ["https://b.ru/1", "https://b.ru/2"],
);
check("у голой ссылки названия нет", readSources({ citations: ["https://b.ru/1"] })[0].title, "");
// Провайдер повторяет источник столько раз, сколько на него сослался, — в
// списке под ответом он нужен один.
check(
  "повторы схлопываются",
  readSources({ citations: ["https://b.ru/1", "https://b.ru/1", "https://b.ru/2"] }).length,
  2,
);
check("search_results важнее citations", readSources({ search_results: [{ url: "https://a.ru/x" }], citations: ["https://b.ru/1"] })[0].url, "https://a.ru/x");
check("обычная модель ссылок не шлёт", readSources({}), []);
check("мусор вместо списка не роняет разбор", readSources({ citations: "ой" }), []);
// Ссылка ведёт наружу и открывается по клику: javascript: и file: пускать туда
// нельзя, а без адреса пункт списка бессмыслен.
check("не-веб адреса отбрасываются", readSources({ citations: ["javascript:alert(1)", "file:///c:/x", ""] }), []);
check("битый элемент не роняет разбор", readSources({ search_results: [null, { url: "https://a.ru" }] }).length, 1);

// ——— номера источников вычищаются из текста ———
// Поисковая модель ставит их после каждой фразы — читать мешает, а сказать они
// ничего не могут: источники лежат списком под ответом. Рядом живут блоки кода
// и [[вики-ссылки]], где скобка значит своё, — испортить чужую разметку тут
// проще всего.
const src = (...urls) => urls.map((url, i) => ({ url, title: "", n: i + 1 }));
const two = src("https://a.ru/1", "https://b.ru/2");
const three = src("https://a.ru/1", "https://b.ru/2", "https://c.ru/3");

check("номер убирается", stripCitations("родился в Москве[1]", two), "родился в Москве");
// Ровно то, что на скриншоте Льва: «...раннего русского хип-хопа.[1][6][8]».
check("три маркера подряд", stripCitations("хип-хопа.[1][2][3]", three), "хип-хопа.");
// Пробел перед номером уходит вместе с ним, иначе «текст [1]. Дальше»
// превращается в «текст . Дальше».
check("пробел перед номером не остаётся", stripCitations("текст [1]. Дальше", two), "текст. Дальше");
check("пробел после номера уцелел", stripCitations("текст[1] дальше", two), "текст дальше");
check("маркер в середине фразы", stripCitations("он[1] сказал[2] так", two), "он сказал так");
// Модель ссылается и на то, чего нам не прислали; чужое число в скобках —
// возможно, текст пользователя, и сносить его не за что.
check("номера вне списка остаются", stripCitations("Москве[9]", two), "Москве[9]");
check("без источников текст не меняется", stripCitations("Москве[1]", []), "Москве[1]");
check("текста без скобок не касаемся", stripCitations("просто текст", two), "просто текст");

// Чужая разметка: ни одну из этих штук трогать нельзя.
check("готовая ссылка не разбирается", stripCitations("[1](https://уже.ru)", two), "[1](https://уже.ru)");
check("вики-ссылка не трогается", stripCitations("см. [[1]]", two), "см. [[1]]");
check("вики-ссылка с подписью не трогается", stripCitations("[[файл|1]]", two), "[[файл|1]]");
check("номер в блоке кода не трогается", stripCitations("```js\nlet a = x[1];\n```", two), "```js\nlet a = x[1];\n```");
check("номер в тильдовой ограде не трогается", stripCitations("~~~\nx[1]\n~~~", two), "~~~\nx[1]\n~~~");
check("номер в строчном коде не трогается", stripCitations("вот `x[1]` вот", two), "вот `x[1]` вот");
// Код кончился — за ним чистка снова работает.
check("после блока кода чистка продолжается", stripCitations("`x[1]` и Москве[2]", two), "`x[1]` и Москве");
check("после вики-ссылки чистка продолжается", stripCitations("см. [[заметку]] и Москве[1]", two), "см. [[заметку]] и Москве");
// Чекбокс — не номер, цифр в нём нет; но проверить стоит, разметка живая.
check("чекбокс не ломается", stripCitations("- [ ] дело[1]", two), "- [ ] дело");

// ——— источники в сохранённой заметке ———
// Разговор уходит в заметку целиком, и ответ без источников в ней — набор
// утверждений, которые больше нечем проверить.
const cited = chatToMarkdown(
  [{ role: "assistant", content: "Родился в Москве[1]", sources: [{ url: "https://a.ru/1", title: "Био", n: 1 }] }],
  "м",
  "д",
);
check("номер вычищен и в сохранённой заметке", cited.includes("Москве[1]"), false);
check("список источников дописан", cited.includes("1. [Био](https://a.ru/1)"), true);
check("обычный ответ списком не обрастает", chatToMarkdown([{ role: "assistant", content: "просто" }], "м", "д").includes("1. ["), false);

// ——— своя модель у действия ———
// Орфографию не хуже правит дешёвая модель, оценивать текст без сильной
// бессмысленно, а факты надо искать там, где есть веб.
// Пусто и отсутствующее поле — одно и то же: прогоняем тем, что в шапке.
check("по умолчанию действие идёт тем, что в шапке", !mergeSettings(null).actions[0].provider, true);
check(
  "выбранный провайдер переживает загрузку",
  mergeSettings({ actions: [{ id: "custom-3", name: "Факты", prompt: "п", mode: "chat", icon: "x", provider: "perplexity" }] })
    .actions.at(-1).provider,
  "perplexity",
);
check(
  "мусор вместо провайдера — как в шапке",
  mergeSettings({ actions: [{ id: "custom-3", name: "Х", prompt: "п", mode: "chat", icon: "x", provider: 42 }] })
    .actions.at(-1).provider,
  "",
);
// Встроенному действию провайдер назначается так же, как своему, и обновление
// плагина его не сбрасывает.
check(
  "провайдер встроенного действия сохраняется",
  mergeSettings({ actions: [{ id: "spelling", name: "Исправить орфографию", prompt: "п", mode: "replace", icon: "x", provider: "polza" }] })
    .actions.find((a) => a.id === "spelling").provider,
  "polza",
);

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

// ——— приватный чат ———
// Разговор без всего, что плагин добавляет от себя: ни заметки, ни инструментов,
// ни системного промпта.
check("по умолчанию чат не приватный", mergeSettings(null).privateChat, false);
check("режим переживает загрузку", mergeSettings({ privateChat: true }).privateChat, true);

// ——— куда класть новые заметки ———
// И сохранённый разговор, и то, что создаёт сама модель: до сих пор всё падало
// в корень хранилища, рядом с рабочими заметками.
check("по умолчанию — корень", mergeSettings(null).newNoteFolder, "root");
check("выбранный режим переживает загрузку", mergeSettings({ newNoteFolder: "beside" }).newNoteFolder, "beside");
check("папка сохраняется", mergeSettings({ newNoteFolder: "folder", newNoteFolderPath: "Архив/ИИ" }).newNoteFolderPath, "Архив/ИИ");
check("мусор в режиме папки чинится", mergeSettings({ newNoteFolder: "куда-нибудь" }).newNoteFolder, "root");
check("мусор вместо пути — пусто", mergeSettings({ newNoteFolderPath: 42 }).newNoteFolderPath, "");
check("пути по умолчанию нет", mergeSettings(null).newNoteFolderPath, "");

// ——— разовый прогон чужой моделью ———
// «Ещё раз» умеет позвать другую модель, не переключая на неё плагин: выбор
// разовый, а следующий вопрос должен уйти тем же, чем уходил до сих пор.
const twoProfiles = (() => {
  const s = defaultSettings();
  s.temperature = 0.7;
  s.maxTokens = 500;
  s.profiles.polza = { apiKey: "sk-polza", model: "openai/gpt-4o", baseUrl: "https://api.polza.ai/api/v1" };
  s.profiles.empty = { apiKey: "sk-x", model: "", baseUrl: "https://x.ai/v1" };
  return s;
})();
check("конфиг чужого профиля собирается", configFor(twoProfiles, "polza").model, "openai/gpt-4o");
check("ключ берётся из профиля", configFor(twoProfiles, "polza").apiKey, "sk-polza");
check("общие настройки достаются из активных", configFor(twoProfiles, "polza").temperature, 0.7);
check("предел длины тоже общий", configFor(twoProfiles, "polza").maxTokens, 500);
check("профиль без модели спрашивать нечем", configFor(twoProfiles, "empty"), null);
check("незнакомого профиля нет", configFor(twoProfiles, "нет-такого"), null);
// Адрес мог не сохраниться (профиль из старых настроек) — берём из пресета.
check(
  "адрес достраивается из пресета",
  configFor({ ...twoProfiles, profiles: { gptunnel: { apiKey: "k", model: "m", baseUrl: "" } } }, "gptunnel").baseUrl,
  "https://gptunnel.ru/v1",
);
// Поток запрещён не настройкам, а провайдеру: разовый прогон идёт мимо настроек.
check("поток чужого провайдера считается по нему же", streamAllowed(providerOf(configFor(twoProfiles, "polza"))), true);
check("у ChadGPT поток закрыт и разовому прогону", streamAllowed("chadgpt"), false);
check("активные настройки считаются так же", streamAvailable({ baseUrl: "https://ask.chadgpt.ru/api/v1" }), false);

// ——— сетка приватного чата ———
// Приватный разговор заводят, чтобы спросить не про хранилище, и модель там
// обычно нужна другая. Панельную он при этом не трогает: вышел — и всё осталось
// там, где было.
const withPriv = (privateChat, privateProvider) => {
  const s = defaultSettings();
  s.model = "deepseek-v4-flash";
  s.profiles.polza = { apiKey: "sk-polza", model: "openai/gpt-4o", baseUrl: "https://api.polza.ai/api/v1" };
  s.profiles.empty = { apiKey: "sk-x", model: "", baseUrl: "https://x.ai/v1" };
  return { ...s, privateChat, privateProvider };
};
check("обычный чат идёт панельной моделью", activeConfig(withPriv(false, "")).model, "deepseek-v4-flash");
check("своя сетка приватного чата подхватывается", activeConfig(withPriv(true, "polza")).model, "openai/gpt-4o");
check("и ключ берётся её же", activeConfig(withPriv(true, "polza")).apiKey, "sk-polza");
// Настройка есть, но чат обычный — она молчит: это сетка приватного, а не вторая панельная.
check("вне приватного чата настройка не действует", activeConfig(withPriv(false, "polza")).model, "deepseek-v4-flash");
check("приватный чат без своей сетки идёт панельной", activeConfig(withPriv(true, "")).model, "deepseek-v4-flash");
// Провайдера могли лишить модели уже после выбора. Приватность держится на том,
// что из хранилища ничего не уходит, — от модели она не зависит, поэтому просто
// отвечаем обычной, а не отказываемся разговаривать.
check("сетка без модели — отвечает панельная", activeConfig(withPriv(true, "empty")).model, "deepseek-v4-flash");
check("незнакомая сетка — отвечает панельная", activeConfig(withPriv(true, "нет-такой")).model, "deepseek-v4-flash");

check("по умолчанию сетки приватного чата нет", mergeSettings(null).privateProvider, "");
check("выбранная сетка переживает загрузку", mergeSettings({ privateProvider: "polza" }).privateProvider, "polza");
check("мусор вместо сетки — как в панели", mergeSettings({ privateProvider: 42 }).privateProvider, "");

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
// Сохранённый разговор без фрагмента начинался бы с «а покороче?» и не значил бы
// ничего — фрагмент должен идти над вопросом.
const withQuote = chatToMarkdown([{ role: "user", content: "а покороче?", quote: "исходный кусок" }], "м", "д");
check("фрагмент попадает в сохранённую заметку", withQuote.includes("> исходный кусок"), true);
// Тесты идут на английской локали — заглушка moment отдаёт "en".
check("вопрос о фрагменте подписан", withQuote.includes("About the fragment:"), true);

// ——— вложения ———
// Картинку надо ужать до отправки: фотография с телефона в исходном виде — это
// мегабайты base64 и заметная строчка в счёте, а читается на ней ровно то же.
check("большая сторона подгоняется под предел", fitSize(4000, 3000, 1200), { w: 1200, h: 900 });
check("высокая картинка считается по высоте", fitSize(600, 2400, 1200), { w: 300, h: 1200 });
check("маленькую не растягиваем", fitSize(320, 200, 1200), { w: 320, h: 200 });
check("ровно по пределу — не трогаем", fitSize(1200, 800, 1200), { w: 1200, h: 800 });
// Полоска в один пиксель после деления не должна превратиться в ноль: картинка
// нулевой ширины не нарисуется вовсе.
check("узкая полоска не схлопывается в ноль", fitSize(4000, 3, 1200).h, 1);

check("картинка узнаётся по расширению", isImagePath("Вложения/Снимок.PNG"), true);
check("заметка картинкой не считается", isImagePath("Дневник/сегодня.md"), false);
check("файл без точки не картинка", isImagePath("README"), false);

// Встроенные в заметку картинки: она уезжает модели текстом, и `![[схема.png]]`
// та видит строчкой, а не изображением.
const note = "Текст\n![[схема.png]]\nещё\n![подпись](Вложения/фото%20с%20дачи.jpg)\n![[заметка.md]]\n![](https://site/pic.png)";
check("внутренняя ссылка на картинку находится", embeddedFiles(note).includes("схема.png"), true);
check("markdown-ссылка тоже находится", embeddedFiles(note).includes("Вложения/фото с дачи.jpg"), true);
check("встроенная заметка картинкой не считается", embeddedFiles(note).includes("заметка.md"), false);
check("картинка из интернета не вложение", embeddedFiles(note).some((p) => p.startsWith("http")), false);
check("повтор не задваивается", embeddedFiles("![[один.png]] ![[один.png]]").length, 1);
check("размер по ширине блока", embeddedFiles("![[схема.png|400]]").length, 1);
check("встроенный документ тоже находится", embeddedFiles("![[Книги/устав.pdf]]").length, 1);

check("отметка времени без двоеточий", stamp(new Date(2026, 7, 7, 4, 5, 6)), "20260807040506");
check("имя вставленной картинки с расширением", pastedName("image/png", "20260807040506").endsWith(".png"), true);
check("jpeg получает привычное расширение", pastedName("image/jpeg", "1").endsWith(".jpg"), true);
check("неизвестный формат зовём png", pastedName("image/heic", "1").endsWith(".png"), true);
check("вес считается килобайтами", humanSize(12 * 1024), "12 KB");
check("вес крупной картинки — мегабайтами", humanSize(3 * 1024 * 1024), "3.0 MB");

// Реплика без картинок уходит прежней строкой: массив кусков понимают не все
// модели, и городить его на каждый вопрос ни за чем нельзя.
check("вопрос без картинок остаётся строкой", messageContent({ role: "user", content: "привет" }), "привет");
const withImage = messageContent({ role: "user", content: "что тут?" }, ["data:image/png;base64,AAA"]);
check("картинка едет отдельным куском", withImage.map((p) => p.type), ["text", "image_url"]);
check("текст вопроса идёт первым", withImage[0].text, "что тут?");
check("адрес картинки уходит как есть", withImage[1].image_url.url, "data:image/png;base64,AAA");
// Старую картинку в каждый следующий запрос не возим — но и молчать о ней
// нельзя: иначе разговор выглядит как вопросы о пустоте.
const dropped = messageContent({ role: "user", content: "что тут?", attachments: [{ id: "1", name: "a.png", mime: "image/png", size: 10 }] });
check("про снятую картинку модель предупреждена", dropped.includes("An image was attached"), true);
check("вопрос при этом на месте", dropped.startsWith("что тут?"), true);

// Сохранённый разговор: картинка из хранилища встаёт ссылкой, а прожившая
// только сеанс — оговоркой, иначе заметка ссылалась бы в никуда.
const shots = chatToMarkdown(
  [{ role: "user", content: "что тут?", attachments: [{ id: "1", name: "a.png", mime: "image/png", size: 10, path: "Вложения/a.png" }] }],
  "м",
  "д",
);
check("картинка хранилища попадает в заметку ссылкой", shots.includes("![[Вложения/a.png]]"), true);
const kept = chatToMarkdown(
  [{ role: "user", content: "", attachments: [{ id: "2", name: "b.png", mime: "image/png", size: 10 }] }],
  "м",
  "д",
);
check("вопрос из одной картинки не пропадает", kept.includes("not saved to the vault"), true);

// Память сеанса: картинка весит сотни килобайт, и держать её после того, как
// она ушла из разговора, — это мегабайты, до которых уже никак не добраться.
const store = new AttachmentStore();
const shot = new Blob(["картинка"], { type: "image/png" });
store.put("a", shot);
store.put("b", shot);
check("вложение находится по id", store.get("a") === shot, true);
store.forget("a");
check("забытое вложение больше не отдаётся", store.get("a"), null);
check("соседнее при этом на месте", store.get("b") === shot, true);
store.clear();
check("выгрузка отпускает всё", store.get("b"), null);

// ——— документы ———
check("pdf узнаётся по расширению", isPdfPath("Книги/Устав.PDF"), true);
check("картинка документом не считается", isPdfPath("схема.png"), false);
check("прикладывать можно и то и другое", [isAttachablePath("a.pdf"), isAttachablePath("b.png"), isAttachablePath("c.md")], [true, true, false]);

// pdf.js отдаёт текст обрывками строк, как он нарисован: склеенные подряд, они
// превращаются в простыню без единого переноса и без пробелов между словами.
check(
  "обрывки строки склеиваются через пробел",
  joinItems([{ str: "Первая" }, { str: "строка", hasEOL: true }, { str: "вторая" }]),
  "Первая строка\nвторая",
);
check(
  "перед запятой пробел не ставится",
  joinItems([{ str: "слово" }, { str: ", ещё" }]),
  "слово, ещё",
);
check("пустой кусок с переносом строку всё равно закрывает", joinItems([{ str: "", hasEOL: true }, { str: "низ" }]), "\nниз");

check("вёрстка не превращается в пустоту", tidy("  раз  два  \n\n\n\n три "), "раз два\n\nтри");

// Режем по границе страницы: оборванная на полуслове читается как ошибка
// чтения, а не как сознательная обрезка.
const pages = ["а".repeat(30), "б".repeat(30), "в".repeat(30)];
check("страницы влезают целиком", clipPages(pages, 100).clipped, false);
check("лишняя страница отсекается", clipPages(pages, 70).text.includes("в"), false);
check("про обрезку сказано", clipPages(pages, 70).clipped, true);
check("первая страница берётся даже длиннее предела", clipPages(pages, 5).text.length, 30);

// Документ уходит модели текстом, названным по имени файла: по нему видно, что
// это приложенный файл, а не кусок разговора.
const block = docBlock({ name: "устав.pdf", text: "Пункт 1.", clipped: false });
check("документ назван по имени", block.startsWith('[Document "устав.pdf"]'), true);
check("текст документа на месте", block.includes("Пункт 1."), true);
check("про обрезку документа модель предупреждена", docBlock({ name: "a.pdf", text: "т", clipped: true }).includes("only the beginning"), true);

const withDoc = messageContent({ role: "user", content: "о чём тут?" }, [], [{ name: "у.pdf", text: "Текст", clipped: false }]);
check("документ идёт перед вопросом", withDoc.startsWith('[Document "у.pdf"]'), true);
check("вопрос остаётся в конце", withDoc.endsWith("о чём тут?"), true);
// Документ в каждый следующий запрос не возят — он стоит денег так же, как картинка.
const droppedDoc = messageContent({ role: "user", content: "о чём тут?", attachments: [{ id: "1", name: "у.pdf", mime: "application/pdf", size: 10 }] });
check("про снятый документ модель предупреждена", droppedDoc.includes("A document was attached"), true);
check("и это не путается с картинкой", droppedDoc.includes("An image was attached"), false);

const savedDoc = chatToMarkdown(
  [{ role: "user", content: "разбери", attachments: [{ id: "3", name: "у.pdf", mime: "application/pdf", size: 10, path: "Книги/у.pdf" }] }],
  "м",
  "д",
);
check("документ в заметке — обычной ссылкой, не встроенной", savedDoc.includes("\n[[Книги/у.pdf]]"), true);

console.log(`\n${pass} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
