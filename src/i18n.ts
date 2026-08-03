import { moment } from "obsidian";

const en = {
  // ——— действия (заготовки) ———
  actSpelling: "Fix spelling",
  actSpellingPrompt:
    "Act as a professional proofreader. Fix every grammatical, spelling and punctuation mistake in " +
    "the text below. Keep the original meaning, the sentence structure and the author's style " +
    "strictly intact. Rewrite nothing — only fix the mistakes.",
  actClarify: "Improve the text",
  actClarifyPrompt:
    "Act as an experienced editor. Rewrite this text to improve its style, readability and flow. " +
    "Get rid of bureaucratese and tautology, make the sentences more rhythmic and the text itself " +
    "convincing and beautiful.",
  actExpand: "Expand the text",
  actExpandPrompt:
    "Expand and develop the following text. Open the subject up in more detail: add fitting " +
    "specifics, sound arguments and examples. Make the text deeper, fuller and more interesting to " +
    "read, keeping the original thought.",
  actShorten: "Shorten the text",
  actShortenPrompt:
    "Squeeze the essence out of this text. Shorten it by removing all the padding, the digressions " +
    "and the needless repetition. Keep only the key facts and the main thought, making the text as " +
    "concise and easy to read as possible.",
  actEvaluate: "Evaluate the text",
  actEvaluatePrompt:
    "Give this text a strict critical analysis. Judge its structure, clarity, logic and style. " +
    "Point out the strong sides, then write a concrete numbered list of recommendations: what " +
    "exactly to fix and how, to make the text perfect.",
  promptKeepMarkup:
    "The text comes from a note, so preserve its markup character for character: markdown symbols, " +
    "indentation, line breaks and blank lines, ==highlights==, code blocks with their contents, " +
    "URLs, formulas and #tags. Never change a single character inside [[double square brackets]] — " +
    "those are file names, and editing them breaks the links between notes; in a [[file|label]] " +
    "link edit the label only. In poems and songs never change how the text is broken into lines: " +
    "a line without a full stop, a dash instead of a comma or a lower-case letter starting a line " +
    "is the author's device, not a mistake.",
  promptOnlyText:
    "Your reply must contain the resulting text ONLY, exactly as it should sit in the note: no " +
    "preamble, no closing remarks, no explanation of what you changed, no alternatives to choose " +
    "from, no quotation marks around it and no ``` code fences. Never write “Here is the corrected " +
    "text”. If there is nothing to change, return the original verbatim.",

  // ——— команды ———
  cmdOpenChat: "Open AI chat",
  cmdStop: "Stop generation",
  cmdSendSelection: "Ask about the selection",
  cmdRepeat: "Repeat the last action",
  cmdQuick: "Quick menu over the selection",
  quickTitle: "What to do with the text",
  quickPlaceholder: "Write your own instruction…",
  quickHint: "A digit — a preset · Enter — rewrite the text · Ctrl+Enter — answer in the chat · ↑ — previous prompts",
  quickHintMac: "A digit — a preset · Enter — rewrite the text · ⌘Enter — answer in the chat · ↑ — previous prompts",
  quickHead: "Quick menu",
  quickDesc:
    "The quick menu opens a window over the selected text: type your own instruction, or press " +
    "a digit for a preset. The digit only picks a preset while the field is empty, so a prompt " +
    "can start with a number. The physical key matters, not the character, so any layout " +
    "works.\n\n" +
    "There are five keys to begin with, and up to nine if you add them. Drag a row by its " +
    "handle to move an action to another key. The pencil opens the action itself: name, icon, " +
    "prompt and what to do with the answer. An action taken off a key is not lost: it keeps " +
    "its own command, and a command can be given a hotkey.",
  quickSlot: "Key {key}",
  quickAddKey: "Add a key",
  quickDropKey: "Remove key {key}",
  quickNone: "— empty —",
  quickAsk: "Ask about the selection (chat)",
  quickNew: "+ New action…",
  chatTitle: "AI chat",
  chatPlaceholder: "Ask something… (Enter — send, Shift+Enter — new line)",
  chatEmpty: "Ask a question, or select text in a note and use the AI menu.",
  chatSend: "Send",
  chatStop: "Stop",
  chatNew: "New chat",
  chatCopy: "Copy",
  chatInsert: "Insert into note",
  chatRetry: "Retry",
  chatYou: "You",
  chatModel: "Model",
  chatThinking: "Thinking",
  chatContextNote: "Send the current note as context",
  chatContextOn: "Context: note",
  chatWaiting: "Thinking…",
  chatCleared: "Chat cleared",
  chatUndoClear: "Click to bring it back",
  chatContextClipped: "The note is long — only its beginning went into the context.",
  chatAttachSize: "{chars} chars",
  chatAttachDrop: "Do not ask about this fragment",
  chatAttached: "Selected fragment ({chars} chars)",
  chatNoteFragment: "About the fragment:",
  chatCopied: "Copied",
  chatInserted: "Inserted into the note",
  chatNoEditor: "Open a note to insert the answer into",
  chatSystemHint:
    "You are answering inside a side panel in Obsidian and cannot edit notes yourself. " +
    "When asked to write something into the note, simply output the finished text — there is " +
    "an “Insert into note” button under your answer, and the user will press it. " +
    "Never explain that you have no access to the vault and never ask the user to copy by hand.",
  chatUsage: "{prompt} in / {completion} out",
  chatCached: ", {cached} cached",

  // ——— инструменты ———
  chatSystemHintTools:
    "You are working inside Obsidian and you can edit the user's note yourself through the " +
    "tools: read_note, replace_in_note, replace_note, insert_text, replace_selection, " +
    "append_to_note, create_note. " +
    "To change text that is already written, call read_note and then replace_in_note — it " +
    "needs nothing to be selected, and it is the right tool even when the user selected " +
    "nothing at all. Do not use insert_text or append_to_note for that: they would leave the " +
    "old text in place and add a second copy. " +
    "When the user asks you to write something into the note, call the tool — never tell them " +
    "to copy the text by hand and never claim you have no access to the vault. " +
    "Every edit is shown to the user for approval, so it is safe to propose one.",
  toolRead: "Read the note",
  toolInsert: "Insert into the note",
  toolReplaceIn: "Replace a fragment",
  toolReplaceNote: "Rewrite the note",
  toolReplace: "Replace the selection",
  toolAppend: "Append to the end of the note",
  toolCreate: "Create note “{title}”",
  toolUnknown: "Unknown tool “{name}”",
  toolApply: "Apply",
  toolReject: "Reject",
  toolApplied: "Applied",
  toolRejected: "Rejected",
  toolDone: "({title} — done)",
  toolFailed: "Could not do it: {reason}",
  toolNoteCreated: "Note created: {path}",
  setToolsHead: "Editing notes",
  setTools: "Let the model edit the note",
  setToolsDesc:
    "The model gets tools for writing into the open note and creating new ones, and uses them " +
    "instead of telling you to copy text by hand. It can also read the open note by itself — " +
    "even when the note is not sent as context — and every call is shown in the panel. " +
    "Costs a couple of hundred extra tokens per request.",
  setToolConfirm: "Ask before every edit",
  setToolConfirmDesc:
    "An edit appears in the panel with an Apply button. Turn off and the model writes into the " +
    "note straight away — the undo is Ctrl+Z.",

  // ——— работа с выделением ———
  busy: "AI: {action}…",
  busyBar: "AI…",
  busyStop: "Click to stop",
  busyStopTap: "Tap to stop",
  logRunning: "working…",
  logDone: "done",
  logNothing: "nothing to change",
  logFailed: "failed",
  logUndo: "Undo the edit",
  logUndone: "undone",
  logUndoFail: "The text has changed since — undoing it now would break things",
  logMore: "and more: {added} added, {removed} removed",
  actNewName: "New action",
  actEdit: "Edit",
  actDelete: "Delete",
  actDeleteConfirm: "Delete “{name}”? The prompt will be lost.",
  actName: "Name",
  actPrompt: "Prompt",
  actPromptDesc: "{lang} is replaced with the translation language from the settings",
  actMode: "What to do with the answer",
  actModeDesc: "Replacing and appending edit the note; Ctrl+Z undoes it as usual",
  actModeReplace: "Replace the text",
  actModeAppend: "Add below",
  actModeChat: "Show in the panel",
  actIcon: "Icon",
  actIconDesc: "A name from lucide.dev, e.g. sparkles",
  actBuiltinNote: "A built-in action: it cannot be deleted, but the prompt is yours to change",
  actReset: "Reset the prompt",
  actResetDone: "The prompt is back to the built-in one",
  actNameRequired: "Give the action a name",
  modalCancel: "Cancel",
  chatPickModel: "Model — click to switch",
  chatModelSwitched: "Model: {model}",
  chatOtherModel: "Another model…",
  chatMore: "More",
  chatCopyAll: "Copy the whole chat",
  chatCopyFailed: "Could not copy",
  chatSave: "Save the chat to a note",
  chatNothingToSave: "There is no conversation to save yet",
  chatNoteTitle: "Chat {when}",
  chatNoteHead: "{model}, {when}",
  chatToBottom: "Scroll to the bottom",
  setFresh: "Start with an empty chat",
  setFreshDesc:
    "When Obsidian starts, the panel opens empty and yesterday's conversation is dropped. Save what you need to a note first.",
  noSelection: "Select the text to work on",
  tooBig: "The note is too long ({chars} characters, limit {limit}) — select the part to work on",
  stale: "The text changed while the model was working, so nothing was replaced. The answer is below — copy it by hand if you still need it.",
  emptyReply: "The model returned an empty answer",
  applied: "{action}: done",
  unchanged: "{action}: nothing to change",
  aborted: "Stopped",
  nothingToRepeat: "Nothing to repeat yet",
  askLangPlaceholder: "English, Deutsch, 中文…",
  defaultLang: "English",

  // ——— настройки ———
  setProviderHead: "Model",
  setProvider: "Provider",
  setProviderDesc: "DeepSeek is set up out of the box. Any OpenAI-compatible API works too.",
  setProviderDeepseek: "DeepSeek",
  setProviderPolza: "Polza.ai",
  setProviderChad: "ChadGPT",
  setProviderTunnel: "GPTunnel",
  setProviderOllama: "Ollama (on this computer)",
  setProviderCustom: "Another OpenAI-compatible one",
  setModelFetchHint: "Press “Fetch the list” — the names come from the provider.",
  setModelOllama:
    "Press “Fetch the list” — it shows the models you have pulled. Ollama has to be running; " +
    "no key is needed. From a phone the model runs on the desktop, so it is out of reach.",
  setModelChad: "Names look like gpt-5.4 or claude-4.5-sonnet — press “Fetch the list”.",
  setPickModel: "Now press “Fetch the list” and pick a model — the names here are different",
  setModelPolza: "Names look like provider/model, for example deepseek/deepseek-v4-flash.",
  setBaseUrl: "API address",
  setBaseUrlDesc: "For example https://api.deepseek.com or https://openrouter.ai/api/v1",
  setApiKey: "API key",
  setApiKeyDesc:
    "Kept per provider: switching back and forth does not lose it. Stored in the plugin folder as " +
    "plain text, like every Obsidian plugin does — keep that in mind if your vault is synced or shared.",
  setModel: "Model",
  setModelDesc: "deepseek-v4-flash is faster and cheaper, deepseek-v4-pro is stronger.",
  setModelFetch: "Fetch the list",
  setModelFetched: "Models found: {n}",
  setTest: "Connection",
  setTestDesc: "Send a test request and check the key and the model.",
  setTestBtn: "Check",
  setTestGoing: "Checking…",
  setTestOk: "Works: {model} answered",
  setTestFail: "Failed: {err}",
  setBehaviourHead: "Behaviour",
  setTemperature: "Temperature",
  setTemperatureDesc:
    "0 — the model sticks to the text and repeats itself less, 1.5 — it improvises. " +
    "0.3 suits proofreading, 1.0 suits writing.",
  setMaxTokens: "Answer length limit",
  setMaxTokensDesc: "In tokens; 0 — no limit (the server decides).",
  setStream: "Stream the answer",
  setStreamDesc:
    "Show the answer as it is generated. Turn off if your provider blocks streaming " +
    "requests from the app.",
  setThinking: "Thinking mode",
  setThinkingDesc:
    "The model reasons before answering: better for evaluation and hard questions, " +
    "slower and pricier for proofreading. DeepSeek only.",
  setEffort: "Depth of reasoning",
  setEffortLow: "Low",
  setEffortMedium: "Medium",
  setEffortHigh: "High",
  setLang: "Translation language",
  setLangDesc: "What {lang} in an action prompt resolves to.",
  setNoSelection: "When nothing is selected",
  setNoSelectionDesc:
    "What an action works on if you did not select anything. The whole note is the handy default " +
    "— just mind that a long note costs more tokens per request.",
  setNoSelectionNote: "The whole note",
  setNoSelectionParagraph: "The paragraph under the cursor",
  setNoSelectionNone: "Nothing — ask to select",
  setSystem: "System prompt",
  setSystemDesc: "Added to every request — tell the model who it is talking to and how.",
  setSystemPlaceholder: "You are helping to write and edit notes in Obsidian.",
  setHotkeysDesc:
    "Every action is also a command: give it a hotkey and call it without the menu. Actions that " +
    "did not get a key keep their commands too.",
  setHotkeysBtn: "Open hotkeys",
  setHotkey: "Take Alt+1 for the quick menu",
  setHotkeyDesc:
    "Off, the plugin claims no keys at all: open the quick menu from the command palette, or bind " +
    "whatever suits you in the hotkey settings. Your own binding beats this default either way.",
  setHotkeyReload: "The hotkey changes once the plugin is reloaded (or Obsidian restarts).",
  setUsage: "Show token usage",
  setUsageDesc: "Print how many tokens each answer cost under it.",

  modalSave: "Save",

  // ——— ошибки ———
  errNoKey: "No API key — add it in the plugin settings",
  errNoModel: "No model selected — pick one in the plugin settings",
  errNoUrl: "No address — type the API base URL in the plugin settings",
  errAuth: "The API rejected the key",
  errBalance: "Not enough balance on the API account",
  errForbidden: "Access denied",
  errModel: "No such model at this address",
  errRateLimit: "Rate limit — too many requests, try again in a moment",
  errServer: "The provider returned an error",
  errBusy: "The provider is overloaded, try again",
  errBadRequest: "The provider rejected the request",
  errHttp: "HTTP error",
  errNetwork: "The provider is unreachable:",
  errNetworkStream:
    "The streaming request failed. If it keeps happening, turn off “Stream the answer” " +
    "in the settings:",
  errNoStream: "The provider answered without a stream",
  errStreamBroken: "The stream broke:",
  errAborted: "Stopped",
  chatToolLimit:
    "The model used up all {steps} rounds of edits and is still going. What it did is applied; " +
    "ask again if the work is not finished.",
  errTimeout: "The provider stopped answering — the request was dropped",
  errTools: "This model does not seem to support tools — turn them off in the settings",
  errModelList: "The provider did not return a list of models",
};

const ru: typeof en = {
  // ——— действия (заготовки) ———
  actSpelling: "Исправить орфографию",
  actSpellingPrompt:
    "Действуй как профессиональный корректор. Исправь все грамматические, орфографические и " +
    "пунктуационные ошибки в тексте ниже. Строго сохрани исходный смысл, структуру предложений и " +
    "авторский стиль. Ничего не переписывай, только исправь ошибки.",
  actClarify: "Улучшить текст",
  actClarifyPrompt:
    "Выступи в роли опытного редактора. Перепиши этот текст так, чтобы улучшить его стилистику, " +
    "читабельность и плавность. Избавься от канцеляризмов и тавтологии, сделай предложения более " +
    "ритмичными, а сам текст — убедительным и красивым.",
  actExpand: "Расширить текст",
  actExpandPrompt:
    "Расширь и дополни следующий текст. Раскрой тему подробнее: добавь уместные детали, логичные " +
    "аргументы и примеры. Сделай текст более глубоким, развёрнутым и интересным для чтения, " +
    "сохраняя исходную мысль.",
  actShorten: "Сократить текст",
  actShortenPrompt:
    "Выжми из этого текста самую суть. Сократи его, убрав всю «воду», лирические отступления и " +
    "лишние повторения. Оставь только ключевые факты и главную мысль, сделав текст максимально " +
    "лаконичным и легко читаемым.",
  actEvaluate: "Оценить текст",
  actEvaluatePrompt:
    "Проведи строгий критический анализ этого текста. Оцени его структуру, понятность, логику и " +
    "стилистику. Укажи на сильные стороны, а затем напиши конкретный нумерованный список " +
    "рекомендаций: что именно и как нужно исправить, чтобы сделать текст идеальным.",
  promptKeepMarkup:
    "Текст взят из заметки, поэтому разметку сохраняй посимвольно: знаки markdown, отступы, " +
    "переносы строк и пустые строки, ==выделения==, блоки кода вместе с содержимым, ссылки, " +
    "формулы и #теги. Ни одной буквы не меняй внутри [[двойных квадратных скобок]] — это имена " +
    "файлов, и правка рвёт связи между заметками; в ссылке вида [[файл|подпись]] правь только " +
    "подпись. В стихах и песнях никогда не меняй разбивку на строки: строка без точки в конце, " +
    "тире вместо запятой или строчная буква в начале строки — это авторский приём, а не ошибка.",
  promptOnlyText:
    "В ответе — ТОЛЬКО получившийся текст, ровно в том виде, в каком он должен лежать в заметке: " +
    "без предисловий и послесловий, без пояснений к правкам, без вариантов на выбор, без кавычек " +
    "вокруг и без блоков ```. Не пиши «Вот исправленный текст». Менять нечего — верни исходный " +
    "дословно.",

  // ——— команды ———
  cmdOpenChat: "Открыть чат с ИИ",
  cmdStop: "Остановить генерацию",
  cmdSendSelection: "Спросить о выделенном",
  cmdRepeat: "Повторить последнее действие",
  cmdQuick: "Быстрое меню над выделением",
  quickTitle: "Что сделать с текстом",
  quickPlaceholder: "Напиши, что сделать…",
  quickHint: "Цифра — готовое · Enter — переписать текст · Ctrl+Enter — ответ в чат · ↑ — прошлые промпты",
  quickHintMac: "Цифра — готовое · Enter — переписать текст · ⌘Enter — ответ в чат · ↑ — прошлые промпты",
  quickHead: "Быстрое меню",
  quickDesc:
    "Быстрое меню открывает окно над выделенным текстом: пиши свою инструкцию или жми цифру " +
    "для готового действия. Цифра выбирает действие, только пока поле пустое, — так промпт " +
    "может начинаться с числа. Клавиша считается физическая, так что раскладка не мешает.\n\n" +
    "Клавиш сразу пять, а если мало — добавь ещё, до девяти. Строку можно перетащить за ручку: " +
    "так действие переезжает на другую клавишу. Карандаш открывает само действие: название, " +
    "иконка, промпт и что делать с ответом. Снятое с клавиши действие не пропадает: у него " +
    "остаётся своя команда, а команде можно назначить горячую клавишу.",
  quickSlot: "Клавиша {key}",
  quickAddKey: "Добавить клавишу",
  quickDropKey: "Убрать клавишу {key}",
  quickNone: "— пусто —",
  quickAsk: "Спросить о выделенном (в чат)",
  quickNew: "+ Новое действие…",
  chatTitle: "Чат с ИИ",
  chatPlaceholder: "Спроси что-нибудь… (Enter — отправить, Shift+Enter — новая строка)",
  chatEmpty: "Задай вопрос или выдели текст в заметке и вызови меню ИИ.",
  chatSend: "Отправить",
  chatStop: "Стоп",
  chatNew: "Новый чат",
  chatCopy: "Скопировать",
  chatInsert: "Вставить в заметку",
  chatRetry: "Повторить",
  chatYou: "Ты",
  chatModel: "Модель",
  chatThinking: "Размышления",
  chatContextNote: "Отправлять текущую заметку как контекст",
  chatContextOn: "Контекст: заметка",
  chatWaiting: "Думает…",
  chatCleared: "Чат очищен",
  chatUndoClear: "Нажми, чтобы вернуть",
  chatContextClipped: "Заметка длинная — в контекст ушло только её начало.",
  chatAttachSize: "{chars} зн.",
  chatAttachDrop: "Не спрашивать про этот фрагмент",
  chatAttached: "Выделенный фрагмент ({chars} зн.)",
  chatNoteFragment: "О фрагменте:",
  chatCopied: "Скопировано",
  chatInserted: "Вставлено в заметку",
  chatNoEditor: "Открой заметку, куда вставлять ответ",
  chatSystemHint:
    "Ты отвечаешь в боковой панели Obsidian и сам заметки менять не можешь. " +
    "Если просят что-то написать в заметку — просто выведи готовый текст: под твоим ответом " +
    "есть кнопка «Вставить в заметку», её нажмёт пользователь. " +
    "Никогда не объясняй, что у тебя нет доступа к хранилищу, и не проси копировать вручную.",
  chatUsage: "{prompt} на вход / {completion} на выход",
  chatCached: ", из них {cached} из кэша",

  // ——— инструменты ———
  chatSystemHintTools:
    "Ты работаешь внутри Obsidian и можешь сама править заметку пользователя через инструменты: " +
    "read_note, replace_in_note, replace_note, insert_text, replace_selection, append_to_note, " +
    "create_note. " +
    "Чтобы изменить уже написанный текст, вызывай read_note, а затем replace_in_note: выделения " +
    "для него не нужно, и это правильный инструмент даже тогда, когда пользователь ничего не " +
    "выделил. Не бери для этого insert_text или append_to_note — старый текст останется на " +
    "месте, и получится вторая копия. " +
    "Когда просят что-то написать в заметку — вызывай инструмент, а не проси копировать вручную " +
    "и никогда не говори, что у тебя нет доступа к хранилищу. " +
    "Каждая правка показывается пользователю на подтверждение, так что предлагать её безопасно.",
  toolRead: "Прочитать заметку",
  toolInsert: "Вставить в заметку",
  toolReplaceIn: "Заменить фрагмент",
  toolReplaceNote: "Переписать заметку",
  toolReplace: "Заменить выделенное",
  toolAppend: "Дописать в конец заметки",
  toolCreate: "Создать заметку «{title}»",
  toolUnknown: "Неизвестный инструмент «{name}»",
  toolApply: "Применить",
  toolReject: "Отклонить",
  toolApplied: "Применено",
  toolRejected: "Отклонено",
  toolDone: "({title} — сделано)",
  toolFailed: "Не вышло: {reason}",
  toolNoteCreated: "Заметка создана: {path}",
  setToolsHead: "Правка заметок",
  setTools: "Разрешить модели править заметку",
  setToolsDesc:
    "Модель получает инструменты для записи в открытую заметку и создания новых и пользуется ими " +
    "вместо «скопируй вручную». Открытую заметку она при этом может прочитать сама — даже если " +
    "заметка не отправляется как контекст, — и каждый вызов виден в панели. " +
    "Стоит лишних пары сотен токенов на запрос.",
  setToolConfirm: "Спрашивать перед каждой правкой",
  setToolConfirmDesc:
    "Правка появляется в панели с кнопкой «Применить». Выключишь — модель пишет в заметку сразу, " +
    "откат обычным Ctrl+Z.",

  // ——— работа с выделением ———
  busy: "ИИ: {action}…",
  busyBar: "ИИ…",
  busyStop: "Клик — остановить",
  busyStopTap: "Нажми, чтобы остановить",
  logRunning: "идёт…",
  logDone: "готово",
  logNothing: "менять нечего",
  logFailed: "не вышло",
  logUndo: "Отменить правку",
  logUndone: "отменено",
  logUndoFail: "Текст с тех пор изменился — возвращать вслепую нельзя",
  logMore: "и ещё: добавлено {added}, убрано {removed}",
  actNewName: "Новое действие",
  actEdit: "Править",
  actDelete: "Удалить",
  actDeleteConfirm: "Удалить «{name}»? Промпт пропадёт.",
  actName: "Название",
  actPrompt: "Промпт",
  actPromptDesc: "{lang} подставляется языком перевода из настроек",
  actMode: "Что делать с ответом",
  actModeDesc: "Замена и дописывание правят заметку; отменяется обычным Ctrl+Z",
  actModeReplace: "Заменить текст",
  actModeAppend: "Дописать снизу",
  actModeChat: "Показать в панели",
  actIcon: "Иконка",
  actIconDesc: "Название с lucide.dev, например sparkles",
  actBuiltinNote: "Встроенное действие: удалить нельзя, но промпт можно переписать под себя",
  actReset: "Сбросить промпт",
  actResetDone: "Промпт вернулся к встроенному",
  actNameRequired: "Дай действию название",
  modalCancel: "Отмена",
  chatPickModel: "Модель — нажми, чтобы сменить",
  chatModelSwitched: "Модель: {model}",
  chatOtherModel: "Другая модель…",
  chatMore: "Ещё",
  chatCopyAll: "Копировать весь чат",
  chatCopyFailed: "Скопировать не вышло",
  chatSave: "Сохранить чат в заметку",
  chatNothingToSave: "Разговора, который стоит сохранить, ещё нет",
  chatNoteTitle: "Чат {when}",
  chatNoteHead: "{model}, {when}",
  chatToBottom: "Вниз",
  setFresh: "Начинать с пустого чата",
  setFreshDesc:
    "При запуске Obsidian панель открывается пустой, вчерашний разговор не подхватывается. Что нужно — сохрани в заметку заранее.",
  noSelection: "Выдели текст, с которым работать",
  tooBig: "Заметка слишком длинная ({chars} символов, предел {limit}) — выдели кусок, с которым работать",
  stale: "Пока модель работала, текст изменился, и замены не было. Ответ ниже — если он ещё нужен, перенеси руками.",
  emptyReply: "Модель вернула пустой ответ",
  applied: "{action}: готово",
  unchanged: "{action}: менять нечего",
  aborted: "Остановлено",
  nothingToRepeat: "Повторять пока нечего",
  askLangPlaceholder: "английский, немецкий, 中文…",
  defaultLang: "английский",

  // ——— настройки ———
  setProviderHead: "Модель",
  setProvider: "Провайдер",
  setProviderDesc: "DeepSeek настроен из коробки. Подойдёт любой OpenAI-совместимый API.",
  setProviderDeepseek: "DeepSeek",
  setProviderPolza: "Polza.ai",
  setProviderChad: "ChadGPT",
  setProviderTunnel: "GPTunnel",
  setProviderOllama: "Ollama (на этом компьютере)",
  setProviderCustom: "Другой OpenAI-совместимый",
  setModelFetchHint: "Нажми «Получить список» — имена придут от провайдера.",
  setModelOllama:
    "Нажми «Получить список» — покажет то, что скачано. Ollama должна быть запущена, ключ не " +
    "нужен. С телефона не достать: модель крутится на компьютере.",
  setModelChad: "Имена вида gpt-5.4 или claude-4.5-sonnet — нажми «Получить список».",
  setPickModel: "Теперь нажми «Получить список» и выбери модель — имена здесь другие",
  setModelPolza: "Имена вида провайдер/модель, например deepseek/deepseek-v4-flash.",
  setBaseUrl: "Адрес API",
  setBaseUrlDesc: "Например https://api.deepseek.com или https://openrouter.ai/api/v1",
  setApiKey: "Ключ API",
  setApiKeyDesc:
    "Хранится отдельно для каждого провайдера — переключение туда-обратно его не теряет. Лежит в " +
    "папке плагина открытым текстом, как у всех плагинов Obsidian: имей это в виду, если " +
    "хранилище синхронизируется или лежит в общем доступе.",
  setModel: "Модель",
  setModelDesc: "deepseek-v4-flash быстрее и дешевле, deepseek-v4-pro сильнее.",
  setModelFetch: "Получить список",
  setModelFetched: "Моделей найдено: {n}",
  setTest: "Соединение",
  setTestDesc: "Отправить пробный запрос и проверить ключ и модель.",
  setTestBtn: "Проверить",
  setTestGoing: "Проверяю…",
  setTestOk: "Работает: {model} ответила",
  setTestFail: "Не вышло: {err}",
  setBehaviourHead: "Поведение",
  setTemperature: "Температура",
  setTemperatureDesc:
    "0 — модель держится текста и меньше выдумывает, 1.5 — импровизирует. " +
    "Для вычитки хороша 0.3, для сочинения — 1.0.",
  setMaxTokens: "Предел длины ответа",
  setMaxTokensDesc: "В токенах; 0 — не ограничивать, решает сервер.",
  setStream: "Показывать ответ по мере генерации",
  setStreamDesc:
    "Текст появляется на ходу. Выключи, если провайдер не пропускает потоковые запросы " +
    "из приложения.",
  setThinking: "Режим размышления",
  setThinkingDesc:
    "Модель рассуждает перед ответом: лучше для оценки и сложных вопросов, " +
    "медленнее и дороже для вычитки. Только у DeepSeek.",
  setEffort: "Глубина размышления",
  setEffortLow: "Небольшая",
  setEffortMedium: "Средняя",
  setEffortHigh: "Максимальная",
  setLang: "Язык перевода",
  setLangDesc: "Во что превращается {lang} в промпте действия.",
  setNoSelection: "Если ничего не выделено",
  setNoSelectionDesc:
    "С чем работает действие, когда выделения нет. Вся заметка — самый удобный вариант, только " +
    "помни, что длинная заметка стоит дороже в токенах.",
  setNoSelectionNote: "Вся заметка",
  setNoSelectionParagraph: "Абзац под курсором",
  setNoSelectionNone: "Ничего — просить выделить",
  setSystem: "Системный промпт",
  setSystemDesc: "Добавляется к каждому запросу — скажи модели, с кем и как она говорит.",
  setSystemPlaceholder: "Ты помогаешь писать и править заметки в Obsidian.",
  setHotkeysDesc:
    "Каждое действие — ещё и команда: дай ей хоткей и вызывай мимо меню. У действий, оставшихся " +
    "без клавиши, команда тоже есть.",
  setHotkeysBtn: "Открыть горячие клавиши",
  setHotkey: "Занять Alt+1 под быстрое меню",
  setHotkeyDesc:
    "Выключено — плагин не занимает клавиш вовсе: быстрое меню открывается из палитры команд, а " +
    "хоткей на него вешается свой, какой удобно. Своё назначение сильнее умолчания в любом случае.",
  setHotkeyReload: "Клавиша изменится после перезагрузки плагина (или перезапуска Obsidian).",
  setUsage: "Показывать расход токенов",
  setUsageDesc: "Под ответом выводится, во сколько токенов он обошёлся.",

  modalSave: "Сохранить",

  // ——— ошибки ———
  errNoKey: "Нет ключа API — впиши его в настройках плагина",
  errNoModel: "Не выбрана модель — укажи её в настройках плагина",
  errNoUrl: "Нет адреса — впиши адрес API в настройках плагина",
  errAuth: "API не принял ключ",
  errBalance: "На счету API кончились средства",
  errForbidden: "Доступ запрещён",
  errModel: "По этому адресу такой модели нет",
  errRateLimit: "Слишком часто — лимит запросов, попробуй через минуту",
  errServer: "Провайдер вернул ошибку",
  errBusy: "Провайдер перегружен, попробуй ещё раз",
  errBadRequest: "Провайдер отклонил запрос",
  errHttp: "Ошибка HTTP",
  errNetwork: "Провайдер недоступен:",
  errNetworkStream:
    "Потоковый запрос не прошёл. Если повторяется — выключи в настройках " +
    "«Показывать ответ по мере генерации»:",
  errNoStream: "Провайдер ответил без потока",
  errStreamBroken: "Поток оборвался:",
  errAborted: "Остановлено",
  chatToolLimit:
    "Модель израсходовала все {steps} кругов правок и не закончила. Сделанное применено; " +
    "спроси ещё раз, если работа не доведена до конца.",
  errTimeout: "Провайдер перестал отвечать — запрос снят",
  errTools: "Похоже, эта модель не умеет инструменты — выключи их в настройках",
  errModelList: "Провайдер не отдал список моделей",
};

export type I18nKey = keyof typeof en;

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  const lang = moment.locale();
  let s = (lang === "ru" ? ru[key] : en[key]) ?? en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
