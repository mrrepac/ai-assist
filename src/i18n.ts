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
  cmdPrivateChat: "New private chat",
  cmdSendSelection: "Ask about the selection",
  cmdRepeat: "Repeat the last action",
  cmdQuick: "Quick menu over the selection",
  menuQuick: "AI quick menu",
  menuAsk: "Ask the AI about the selection",
  quickTitle: "What to do with the text",
  quickPlaceholder: "Write your own instruction…",
  quickHint: "A digit — a preset · Enter — answer in the chat · Ctrl+Enter — rewrite the text · ↑ — previous prompts",
  quickHintMac: "A digit — a preset · Enter — answer in the chat · ⌘Enter — rewrite the text · ↑ — previous prompts",
  quickHintScope: "← → — how much to take",
  scopeNote: "The note",
  scopeSection: "The section",
  scopeParagraph: "The paragraph",
  quickHead: "Quick menu",
  quickDesc:
    "The quick menu opens a window over the selected text: type your own instruction, or press " +
    "a digit for a preset. The digit only picks a preset while the field is empty, so a prompt " +
    "can start with a number. The physical key matters, not the character, so any layout " +
    "works. With nothing selected the menu also shows what it took — paragraph, section or " +
    "note — and the arrow keys change it for that one run.\n\n" +
    "There are five keys to begin with, and up to nine if you add them. Drag a row by its " +
    "handle to move an action to another key. The pencil opens the action itself: name, icon, " +
    "prompt, what to do with the answer and which model runs it. An action taken off a key is " +
    "not lost: it keeps its own command, and a command can be given a hotkey.",
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
  chatWaiting: "Thinking…",
  chatCleared: "Chat cleared",
  chatUndoClear: "Click to bring it back",
  chatContextClipped: "The note is long — only its beginning went into the context.",
  chatOnlyReasoning: "The model gave no separate answer — below is what it thought through.",
  chatAttachSize: "{chars} chars",
  chatAttachDrop: "Do not ask about this fragment",
  chatAttached: "Selected fragment ({chars} chars)",
  // ——— вложения ———
  attachKb: "{n} KB",
  attachMb: "{n} MB",
  attachPasted: "Pasted image",
  chatClip: "Attach an image or a PDF",
  chatClipVault: "From the vault…",
  chatClipNote: "From this note…",
  chatClipNoneInNote: "Nothing to attach in the open note",
  chatClipNoImages: "There is nothing to attach in the vault",
  chatAttachRemove: "Do not send this",
  chatAttachDropHere: "Drop it — I will attach it to the question",
  chatDropNoteEmpty: "That note has no text",
  chatAttachFailed: "Could not read the file",
  chatAttachNotImage: "Only an image or a PDF can be attached",
  chatAttachDoc: "{pages} pp. · {chars} chars",
  chatAttachDocClipped: "{pages} pp. · {chars} chars (the beginning only)",
  chatAttachNoText:
    "There is no text layer in this PDF — only pictures of the pages, and there is nothing to " +
    "pull out of them.",
  chatAttachSaved: "Saved to the vault: {path}",
  chatAttachSavedMany: "Saved to the vault: {n} images",
  chatAttachSaveFailed: "Could not save it to the vault — the image will not survive a restart",
  chatAttachLimit: "No more than {n} images per question",
  chatAttachBlind: "{model} does not accept images",
  chatAttachSwitch: "Ask a different one",
  chatAttachGone: "The image did not survive the restart",
  // Документ в хранилище не копируется вовсе, поэтому пропадает он чаще
  // картинки — и говорить про него «картинка» тем более нельзя.
  chatAttachDocGone: "The document did not survive the restart",
  chatAttachPrivate: "In a private chat the image is not saved to the vault",
  chatAttachNotSaved: "(image, not saved to the vault)",
  chatNoteFragment: "About the fragment:",
  chatCopied: "Copied",
  chatInserted: "Inserted into the note",
  chatNoEditor: "Open a note to insert the answer into",
  chatSystemHint:
    "You are answering inside a side panel in Obsidian and cannot edit notes yourself. " +
    "When asked to write something into the note, simply output the finished text — there is " +
    "an “Insert into note” button under your answer, and the user will press it. " +
    "Never explain that you have no access to the vault and never ask the user to copy by hand.",
  chatSources: "Sources ({n})",
  chatContinue: "Continue",
  chatContinuing: "Finishing the answer…",
  chatContinueLast: "Only the last answer can be continued",
  chatContinuePrompt:
    "Your previous message was cut off mid-word because you ran out of room. Carry straight on " +
    "from the exact character where it stopped. Do not repeat a single word of what you already " +
    "wrote, do not start over, do not apologise and do not explain — just continue the text.",
  chatUsage: "{prompt} in / {completion} out",
  chatCached: ", {cached} cached",
  chatTotal: "This conversation: {prompt} in / {completion} out",
  chatCtxK: "{n}k",
  chatCtxOff: "Send the current note as context · the conversation takes {talk} chars",
  chatCtxOn: "The note goes with every question: {note} chars · the conversation, {talk}",
  chatPrivateOn:
    "Private chat: no note, no selection, no editing tools, no system prompt — just the model, " +
    "the way it answers on the provider's own site. “New chat” goes back to the usual one.",
  chatPrivateStarted: "Private chat: nothing from the vault is sent",
  chatEmptyPrivate: "Private chat — the model knows nothing about your vault",
  chatPrivateNoQuote: "A private chat sends no fragments of notes",

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
    "Every edit is shown to the user for approval, so it is safe to propose one. " +
    "Having the tools does not mean using them: a question that is not about the note is " +
    "answered with words, and most questions are like that. Reach for a tool only when the " +
    "user asks about their own text or asks you to change it.",
  chatToolsNoteHere:
    "The note the user is looking at is attached below in full. Do not call read_note — you " +
    "already have the text. The only exception is when the attachment says it was cut short.",
  chatToolsNoteHidden:
    "You have not been shown the note. Do not go and read it just in case: if the question " +
    "does not concern the user's own text, answer it straight away and do not mention the " +
    "note at all.",
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
  toolReadDone: "Read",
  toolRejected: "Rejected",
  toolNotApplied: "Did not go through",
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
  logRepeat: "Run it again",
  logRepeatOpen: "Open the note to run the edit again",
  logUndone: "undone",
  logContinue: "Finish it",
  logCutOff: "cut off",
  logContinueGone: "The beginning of the answer is lost — the plugin only remembers it until it restarts",
  logUndoFail: "The text has changed since — undoing it now would break things",
  logMore: "and more: {added} added, {removed} removed",
  actNewName: "New action",
  actEdit: "Edit",
  actDelete: "Delete",
  actDeleteConfirm: "Delete “{name}”? The prompt will be lost.",
  actName: "Name",
  actPrompt: "Prompt",
  actMode: "What to do with the answer",
  actModeDesc: "Replacing and appending edit the note; Ctrl+Z undoes it as usual",
  actModeReplace: "Replace the text",
  actModeAppend: "Add below",
  actModeChat: "Show in the panel",
  actProvider: "Which model runs it",
  actProviderDesc:
    "Proofreading is done just as well by the cheapest model, and judging a text without a strong " +
    "one is pointless. Pick a provider and the action always goes to it, whatever stands in the " +
    "panel header. Only providers you have already set up are listed.",
  actProviderPanel: "The one in the panel",
  actProviderGone:
    "“{action}” runs on {provider}, but no model is set for it — pick one in the settings",
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
  chatNoteTitleAsk: "Chat — {ask}",
  chatNoteHead: "{model}, {when}",
  chatToBottom: "Scroll to the bottom",
  chatAgain: "Ask again",
  chatAgainSame: "The same model ({model})",
  chatAgainLast: "Only the last answer can be asked again",
  chatNoQuestion: "There is no question above this answer",
  chatEditAsk: "Edit the question",
  chatDrop: "Remove",
  chatDropped: "Removed from the conversation",
  chatCutTail: "Everything after the question was removed too",
  setFresh: "Start with an empty chat",
  setFreshDesc:
    "When Obsidian starts, the panel opens empty and yesterday's conversation is dropped. Save what you need to a note first.",
  setPrivateModel: "The model for a private chat",
  setPrivateModelDesc:
    "A private chat is started to ask something that is not about the vault at all, and the " +
    "model wanted there is usually a different one — cheaper, or simply not the one you keep " +
    "your work with. Pick a provider and every private chat goes to it; the header still shows " +
    "who is answering, and picking a model there while private changes this same setting.",
  setNewNote: "Where new notes go",
  setNewNoteDesc:
    "Both the saved conversation and whatever the model creates on its own end up here.",
  setNewNoteRoot: "The vault root",
  setNewNoteFolder: "One folder",
  setNewNoteBeside: "Next to the note being worked on",
  setSaveAttach: "Keep images brought into the chat",
  setSaveAttachDesc:
    "An image pasted or dropped into the chat goes to the attachment folder along with the " +
    "question — the same folder Obsidian itself uses when you paste into a note. Removed before " +
    "you send, it leaves nothing behind. Turned off, it lives only until the next " +
    "restart: the vault stays clean, but you cannot ask about yesterday’s screenshot again. " +
    "In a private chat nothing is ever written to the vault.",
  setNewNotePath: "The folder",
  setNewNotePathDesc: "It will be created if it is not there yet. Empty means the vault root.",
  noSelection: "Select the text to work on",
  tooBigTitle: "That is a lot of text",
  tooBigAsk:
    "{chars} characters are about to go to the model — more than your threshold of {limit}. " +
    "Send it?",
  tooBigGo: "Send",
  cutOff:
    "The model ran out of room and cut the answer off mid-sentence. It is not going into the note — " +
    "it would replace your text with half of it. Press “Finish it” to have the rest written, or " +
    "take what you need from the card by hand.",
  chatCutOff: "The model hit its length limit and cut the answer off.",
  stale: "The text changed while the model was working, so nothing was replaced. The answer is below — copy it by hand if you still need it.",
  emptyReply: "The model returned an empty answer",
  applied: "{action}: done",
  unchanged: "{action}: nothing to change",
  aborted: "Stopped",
  nothingToRepeat: "Nothing to repeat yet",

  // ——— настройки ———
  setProviderHead: "Model",
  setProvider: "Provider",
  setProviderDesc: "DeepSeek is set up out of the box. Any OpenAI-compatible API works too.",
  setProviderDeepseek: "DeepSeek",
  setProviderPolza: "Polza.ai",
  setProviderChad: "ChadGPT",
  setProviderTunnel: "GPTunnel",
  setProviderPerplexity: "Perplexity",
  setProviderOllama: "Ollama (on this computer)",
  setProviderCustom: "Another OpenAI-compatible one",
  setModelPerplexity:
    "sonar is cheap and quick, sonar-pro digs deeper, sonar-reasoning-pro thinks it through, " +
    "sonar-deep-research writes a long report and costs accordingly. Every answer comes with the " +
    "links it was built on.",
  setModelBuiltin: "Perplexity does not publish a list — these are the models it has.",
  setToolsNoProvider:
    "{provider} has no tools of its own: it searches the web and answers, and cannot edit the " +
    "note. The setting stays on for the other providers.",
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
  setNoSelection: "When nothing is selected",
  setNoSelectionDesc:
    "What an action works on if you did not select anything. The whole note is the handy default " +
    "— just mind that a long note costs more tokens per request. A section runs from the heading " +
    "above the cursor down to the next one of the same level, subsections included; the heading " +
    "itself goes along, so the model knows what the text is about.",
  setNoSelectionNote: "The whole note",
  setNoSelectionSection: "The section under the cursor",
  setNoSelectionParagraph: "The paragraph under the cursor",
  setNoSelectionNone: "Nothing — ask to select",
  setWarnOver: "Ask when the text is longer than",
  setWarnOverDesc:
    "A threshold in characters: anything longer goes to the model only after a question — both " +
    "when you selected the piece yourself and when the plugin took the note or the section for " +
    "you. A long piece costs more and takes longer, and the question is a chance to change your " +
    "mind. 0 never asks.",
  setSystem: "System prompt",
  setSystemDesc: "Added to every request — tell the model who it is talking to and how.",
  setSystemPlaceholder: "You are helping to write and edit notes in Obsidian.",
  setHotkeysDesc:
    "Every action is also a command: give it a hotkey and call it without the menu. Actions that " +
    "did not get a key keep their commands too.",
  setHotkeysBtn: "Open hotkeys",
  setHotkey: "Take Alt+1 and Alt+2",
  setHotkeyDesc:
    "Alt+1 opens the quick menu over the selection, Alt+2 starts a private chat. Off, the plugin " +
    "claims no keys at all: run both from the command palette, or bind whatever suits you in the " +
    "hotkey settings. Your own binding beats these defaults either way.",
  setHotkeyReload: "The hotkeys change once the plugin is reloaded (or Obsidian restarts).",
  setEditorMenu: "Right-click on the selection",
  setEditorMenuDesc:
    "What the editor context menu offers while text is selected — on a phone it is the same menu, " +
    "held down. With nothing selected the plugin adds nothing to it.",
  setMenuNone: "Nothing",
  setMenuQuick: "The quick menu and the chat",
  setMenuActions: "The actions on the keys as well",
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
  errBadReply: "The provider's reply is not JSON — check the API address",
  errStreamBroken: "The stream broke:",
  errAborted: "Stopped",
  chatToolLimit:
    "The model used up all {steps} rounds of edits and is still going. What it did is applied; " +
    "ask again if the work is not finished.",
  errTimeout: "The provider stopped answering — the request was dropped",
  errTools: "This model does not seem to support tools — turn them off in the settings",
  errImages: "This model does not seem to accept images — ask another one, or detach the file",
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
  cmdPrivateChat: "Новый приватный чат",
  cmdSendSelection: "Спросить о выделенном",
  cmdRepeat: "Повторить последнее действие",
  cmdQuick: "Быстрое меню над выделением",
  menuQuick: "Быстрое меню ИИ",
  menuAsk: "Спросить ИИ о выделенном",
  quickTitle: "Что сделать с текстом",
  quickPlaceholder: "Напиши, что сделать…",
  quickHint: "Цифра — готовое · Enter — ответ в чат · Ctrl+Enter — переписать текст · ↑ — прошлые промпты",
  quickHintMac: "Цифра — готовое · Enter — ответ в чат · ⌘Enter — переписать текст · ↑ — прошлые промпты",
  quickHintScope: "← → — сколько брать",
  scopeNote: "Заметка",
  scopeSection: "Раздел",
  scopeParagraph: "Абзац",
  quickHead: "Быстрое меню",
  quickDesc:
    "Быстрое меню открывает окно над выделенным текстом: пиши свою инструкцию или жми цифру " +
    "для готового действия. Цифра выбирает действие, только пока поле пустое, — так промпт " +
    "может начинаться с числа. Клавиша считается физическая, так что раскладка не мешает. " +
    "Когда ничего не выделено, меню показывает, что оно взяло — абзац, раздел или заметку, — " +
    "и стрелки вбок меняют это на один раз.\n\n" +
    "Клавиш сразу пять, а если мало — добавь ещё, до девяти. Строку можно перетащить за ручку: " +
    "так действие переезжает на другую клавишу. Карандаш открывает само действие: название, " +
    "иконка, промпт, что делать с ответом и чем его прогонять. Снятое с клавиши действие не " +
    "пропадает: у него остаётся своя команда, а команде можно назначить горячую клавишу.",
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
  chatWaiting: "Думает…",
  chatCleared: "Чат очищен",
  chatUndoClear: "Нажми, чтобы вернуть",
  chatContextClipped: "Заметка длинная — в контекст ушло только её начало.",
  chatOnlyReasoning: "Модель не дала отдельного ответа — ниже то, что она надумала.",
  chatAttachSize: "{chars} зн.",
  chatAttachDrop: "Не спрашивать про этот фрагмент",
  chatAttached: "Выделенный фрагмент ({chars} зн.)",
  // ——— вложения ———
  attachKb: "{n} КБ",
  attachMb: "{n} МБ",
  attachPasted: "Вставленная картинка",
  chatClip: "Приложить картинку или PDF",
  chatClipVault: "Из хранилища…",
  chatClipNote: "Из этой заметки…",
  chatClipNoneInNote: "В открытой заметке прикладывать нечего",
  chatClipNoImages: "В хранилище прикладывать нечего",
  chatAttachRemove: "Не отправлять это",
  chatAttachDropHere: "Отпусти — приложу к вопросу",
  chatDropNoteEmpty: "В этой заметке нет текста",
  chatAttachFailed: "Не вышло прочитать файл",
  chatAttachNotImage: "Приложить можно картинку или PDF",
  chatAttachDoc: "{pages} стр. · {chars} знаков",
  chatAttachDocClipped: "{pages} стр. · {chars} знаков (только начало)",
  chatAttachNoText:
    "В этом PDF нет текстового слоя — только изображения страниц, и вытащить из них нечего.",
  chatAttachSaved: "Сохранено в хранилище: {path}",
  chatAttachSavedMany: "Сохранено в хранилище: {n} картинки",
  chatAttachSaveFailed: "Не вышло положить в хранилище — картинка не переживёт перезапуск",
  chatAttachLimit: "Больше {n} картинок за раз не отправляю",
  chatAttachBlind: "{model} не принимает картинки",
  chatAttachSwitch: "Спросить другую",
  chatAttachGone: "Картинка не пережила перезапуск",
  chatAttachDocGone: "Документ не пережил перезапуск",
  chatAttachPrivate: "В приватном чате картинка в хранилище не сохраняется",
  chatAttachNotSaved: "(картинка, в хранилище не сохранена)",
  chatNoteFragment: "О фрагменте:",
  chatCopied: "Скопировано",
  chatInserted: "Вставлено в заметку",
  chatNoEditor: "Открой заметку, куда вставлять ответ",
  chatSystemHint:
    "Ты отвечаешь в боковой панели Obsidian и сам заметки менять не можешь. " +
    "Если просят что-то написать в заметку — просто выведи готовый текст: под твоим ответом " +
    "есть кнопка «Вставить в заметку», её нажмёт пользователь. " +
    "Никогда не объясняй, что у тебя нет доступа к хранилищу, и не проси копировать вручную.",
  chatSources: "Источники ({n})",
  chatContinue: "Продолжить",
  chatContinuing: "Дописывает ответ…",
  chatContinueLast: "Продолжается только последний ответ",
  chatContinuePrompt:
    "Твоё прошлое сообщение оборвалось на полуслове: кончилось место. Продолжай ровно с того " +
    "символа, на котором оно остановилось. Не повторяй ни слова из уже написанного, не начинай " +
    "заново, не извиняйся и не объясняй — просто продолжай текст.",
  chatUsage: "{prompt} на вход / {completion} на выход",
  chatCached: ", из них {cached} из кэша",
  chatTotal: "За разговор: {prompt} на вход / {completion} на выход",
  chatCtxK: "{n}к",
  chatCtxOff: "Отправлять текущую заметку как контекст · разговор весит {talk} зн.",
  chatCtxOn: "Заметка уедет с каждым вопросом: {note} зн. · разговор — {talk}",
  chatPrivateOn:
    "Приватный чат: ни заметки, ни выделенного, ни инструментов правки, ни системного промпта — " +
    "только модель, как она отвечает на сайте провайдера. «Новый чат» возвращает обычный.",
  chatPrivateStarted: "Приватный чат: из хранилища не уходит ничего",
  chatEmptyPrivate: "Приватный чат — модель ничего не знает про твоё хранилище",
  chatPrivateNoQuote: "В приватном чате фрагменты заметок не отправляются",

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
    "Каждая правка показывается пользователю на подтверждение, так что предлагать её безопасно. " +
    "Иметь инструменты не значит ими пользоваться: вопрос не про заметку — отвечай словами, а " +
    "таких вопросов большинство. Берись за инструмент, только когда спрашивают про свой текст " +
    "или просят его изменить.",
  chatToolsNoteHere:
    "Заметка, которую смотрит пользователь, приложена ниже целиком. Не вызывай read_note — текст " +
    "у тебя уже есть. Исключение одно: если в приложенном сказано, что оно обрезано.",
  chatToolsNoteHidden:
    "Заметку тебе не показали. Не ходи читать её на всякий случай: если вопрос не про текст " +
    "пользователя — отвечай сразу и заметку не поминай вовсе.",
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
  toolReadDone: "Прочитано",
  toolRejected: "Отклонено",
  toolNotApplied: "Не прошло",
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
  logRepeat: "Ещё раз",
  logRepeatOpen: "Открой заметку, чтобы переделать правку",
  logUndone: "отменено",
  logContinue: "Дописать",
  logCutOff: "оборвано",
  logContinueGone: "Начало ответа потеряно — плагин помнит его только до перезапуска",
  logUndoFail: "Текст с тех пор изменился — возвращать вслепую нельзя",
  logMore: "и ещё: добавлено {added}, убрано {removed}",
  actNewName: "Новое действие",
  actEdit: "Править",
  actDelete: "Удалить",
  actDeleteConfirm: "Удалить «{name}»? Промпт пропадёт.",
  actName: "Название",
  actPrompt: "Промпт",
  actMode: "Что делать с ответом",
  actModeDesc: "Замена и дописывание правят заметку; отменяется обычным Ctrl+Z",
  actModeReplace: "Заменить текст",
  actModeAppend: "Дописать снизу",
  actModeChat: "Показать в панели",
  actProvider: "Чем прогонять",
  actProviderDesc:
    "Орфографию не хуже правит самая дешёвая модель, а оценивать текст без сильной бессмысленно. " +
    "Выберешь провайдера — действие всегда уходит к нему, что бы ни стояло в шапке панели. " +
    "В списке только те, кто уже настроен.",
  actProviderPanel: "Как в панели",
  actProviderGone: "«{action}» настроено на {provider}, но модель там не выбрана — укажи её в настройках",
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
  chatNoteTitleAsk: "Чат — {ask}",
  chatNoteHead: "{model}, {when}",
  chatToBottom: "Вниз",
  chatAgain: "Спросить заново",
  chatAgainSame: "Той же моделью ({model})",
  chatAgainLast: "Заново спрашивается только последний ответ",
  chatNoQuestion: "Над этим ответом нет вопроса",
  chatEditAsk: "Изменить вопрос",
  chatDrop: "Убрать",
  chatDropped: "Убрано из разговора",
  chatCutTail: "Вместе с вопросом снято и всё, что было после него",
  setFresh: "Начинать с пустого чата",
  setFreshDesc:
    "При запуске Obsidian панель открывается пустой, вчерашний разговор не подхватывается. Что нужно — сохрани в заметку заранее.",
  setPrivateModel: "Сетка приватного чата",
  setPrivateModelDesc:
    "Приватный чат заводят, чтобы спросить не про хранилище, и модель там обычно нужна другая — " +
    "подешевле или просто не та, с которой работаешь. Выбери провайдера, и всякий приватный " +
    "разговор пойдёт к нему; в шапке при этом видно, кто отвечает, а выбор модели там же, " +
    "внутри приватного чата, меняет эту же настройку.",
  setNewNote: "Куда класть новые заметки",
  setNewNoteDesc: "И сохранённый разговор, и то, что модель создаёт сама.",
  setNewNoteRoot: "В корень хранилища",
  setNewNoteFolder: "В одну папку",
  setNewNoteBeside: "Рядом с рабочей заметкой",
  setSaveAttach: "Оставлять картинки, принесённые в чат",
  setSaveAttachDesc:
    "Картинка, вставленная или перетащенная в чат, вместе с вопросом ложится в папку вложений — " +
    "ту же, куда её кладёт сам Obsidian при вставке в заметку. Снятая с плашки до отправки следа " +
    "не оставляет. Выключено — живёт только до перезапуска: " +
    "хранилище чистое, но спросить заново про вчерашний скриншот уже не выйдет. " +
    "В приватном чате в хранилище не пишется ничего и никогда.",
  setNewNotePath: "Папка",
  setNewNotePathDesc: "Если её нет — будет создана. Пусто — то же, что корень.",
  noSelection: "Выдели текст, с которым работать",
  tooBigTitle: "Много текста",
  tooBigAsk: "В модель уйдёт {chars} знаков — больше твоего порога в {limit}. Отправлять?",
  tooBigGo: "Отправить",
  cutOff:
    "Модель упёрлась в свой предел длины и оборвала ответ на полуслове. В заметку он не пойдёт — " +
    "заменил бы твой текст его половиной. Нажми «Дописать», чтобы получить остаток, или забери " +
    "с карточки руками, что нужно.",
  chatCutOff: "Модель упёрлась в предел длины и оборвала ответ.",
  stale: "Пока модель работала, текст изменился, и замены не было. Ответ ниже — если он ещё нужен, перенеси руками.",
  emptyReply: "Модель вернула пустой ответ",
  applied: "{action}: готово",
  unchanged: "{action}: менять нечего",
  aborted: "Остановлено",
  nothingToRepeat: "Повторять пока нечего",

  // ——— настройки ———
  setProviderHead: "Модель",
  setProvider: "Провайдер",
  setProviderDesc: "DeepSeek настроен из коробки. Подойдёт любой OpenAI-совместимый API.",
  setProviderDeepseek: "DeepSeek",
  setProviderPolza: "Polza.ai",
  setProviderChad: "ChadGPT",
  setProviderTunnel: "GPTunnel",
  setProviderPerplexity: "Perplexity",
  setProviderOllama: "Ollama (на этом компьютере)",
  setProviderCustom: "Другой OpenAI-совместимый",
  setModelPerplexity:
    "sonar дешёвая и быстрая, sonar-pro копает глубже, sonar-reasoning-pro рассуждает, " +
    "sonar-deep-research пишет длинный отчёт и стоит соответственно. К каждому ответу " +
    "прилагаются ссылки, на которых он построен.",
  setModelBuiltin: "Perplexity списка не публикует — это те модели, что у неё есть.",
  setToolsNoProvider:
    "У {provider} инструментов нет: она ищет в вебе и отвечает, а править заметку не умеет. " +
    "Для остальных провайдеров настройка остаётся включённой.",
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
  setNoSelection: "Если ничего не выделено",
  setNoSelectionDesc:
    "С чем работает действие, когда выделения нет. Вся заметка — самый удобный вариант, только " +
    "помни, что длинная заметка стоит дороже в токенах. Раздел — это от заголовка над курсором " +
    "до следующего того же уровня, вместе с подразделами; сам заголовок уезжает с текстом, чтобы " +
    "модель знала, о чём он.",
  setNoSelectionNote: "Вся заметка",
  setNoSelectionSection: "Раздел под курсором",
  setNoSelectionParagraph: "Абзац под курсором",
  setNoSelectionNone: "Ничего — просить выделить",
  setWarnOver: "Спрашивать, если текста больше",
  setWarnOverDesc:
    "Порог в знаках: всё, что длиннее, уходит в модель только после вопроса — и когда ты выделил " +
    "кусок сам, и когда плагин взял за тебя заметку или раздел. Длинный кусок стоит дороже и " +
    "делается дольше, а вопрос — это возможность передумать. 0 — не спрашивать никогда.",
  setSystem: "Системный промпт",
  setSystemDesc: "Добавляется к каждому запросу — скажи модели, с кем и как она говорит.",
  setSystemPlaceholder: "Ты помогаешь писать и править заметки в Obsidian.",
  setHotkeysDesc:
    "Каждое действие — ещё и команда: дай ей хоткей и вызывай мимо меню. У действий, оставшихся " +
    "без клавиши, команда тоже есть.",
  setHotkeysBtn: "Открыть горячие клавиши",
  setHotkey: "Занять Alt+1 и Alt+2",
  setHotkeyDesc:
    "Alt+1 открывает быстрое меню над выделением, Alt+2 заводит приватный чат. Выключено — плагин не " +
    "занимает клавиш вовсе: обе команды есть в палитре, а хоткеи вешаются свои, какие удобно. " +
    "Своё назначение сильнее умолчания в любом случае.",
  setHotkeyReload: "Клавиши изменятся после перезагрузки плагина (или перезапуска Obsidian).",
  setEditorMenu: "Правая кнопка по выделению",
  setEditorMenuDesc:
    "Что предлагает контекстное меню редактора, пока текст выделен, — на телефоне это то же меню, " +
    "по долгому нажатию. Без выделения плагин в меню не добавляет ничего.",
  setMenuNone: "Ничего",
  setMenuQuick: "Быстрое меню и чат",
  setMenuActions: "И действия с клавиш",
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
  errBadReply: "Ответ провайдера — не JSON, проверь адрес API",
  errStreamBroken: "Поток оборвался:",
  errAborted: "Остановлено",
  chatToolLimit:
    "Модель израсходовала все {steps} кругов правок и не закончила. Сделанное применено; " +
    "спроси ещё раз, если работа не доведена до конца.",
  errTimeout: "Провайдер перестал отвечать — запрос снят",
  errTools: "Похоже, эта модель не умеет инструменты — выключи их в настройках",
  errImages: "Похоже, эта модель не принимает картинки — спроси другую или сними вложение",
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
