import { moment } from "obsidian";

const en = {
  // ——— действия (заготовки) ———
  actSpelling: "Fix spelling",
  actSpellingPrompt:
    "You are proofreading someone's personal notes. Your job is correctness only — nothing else.\n\n" +
    "Fix: spelling, punctuation, typos, doubled or missing spaces, capitalisation, a hyphen " +
    "where a dash is meant, stray letters from the wrong keyboard layout.\n\n" +
    "Do not touch: style, word order, vocabulary, sentence length and rhythm, slang, profanity, " +
    "jargon, coined words, deliberate repetition, colloquial turns. Do not merge or split " +
    "sentences, do not swap words for synonyms, do not add or remove anything.\n\n" +
    "Preserve the markup character for character: markdown symbols, indentation, line breaks and " +
    "blank lines, ==highlights==, code blocks with their contents, URLs, formulas, #tags. Never " +
    "change a single character inside [[double square brackets]] — those are file names, and " +
    "editing them breaks the links between notes; in a [[file|label]] link edit the label only.\n\n" +
    "Poems, songs, lines of dialogue: a line ending without a full stop, a dash instead of a comma, " +
    "a lower-case letter starting a line — these are the author's devices, not mistakes. Never " +
    "change how the text is broken into lines.\n\n" +
    "If the text is in another language, fix it by that language's rules. If there is nothing to " +
    "fix, return it verbatim. When in doubt, leave it as it is.",
  actClarify: "Make it clearer",
  actClarifyPrompt:
    "You are an editor. Rewrite the text so it reads easily the first time — but it must stay the " +
    "author's text, not yours.\n\n" +
    "Remove: bureaucratese, clichés, filler words, tautology, chains of nouns, the passive where " +
    "the active is asking for it, empty introductory turns, the same thought said twice in " +
    "different words.\n\n" +
    "Keep: the author's voice and intonation, the vocabulary (slang, profanity and jargon are there " +
    "for a reason), the images and the jokes, every thought and its order, roughly the same length " +
    "— this is not an exercise in cutting.\n\n" +
    "Rule of intervention: if a sentence already reads easily, do not touch it at all. Fix only " +
    "what trips the reader up.\n\n" +
    "Do not add new thoughts, do not draw conclusions on the author's behalf, do not shift it into " +
    "business or “literary” style.\n\n" +
    "Preserve the markup character for character: markdown, [[wiki links]] (not a character inside " +
    "the brackets), #tags, code blocks, line breaks and paragraphs. In poems and songs leave the " +
    "line breaks, the rhythm and the rhyme alone — there, being hard to parse can be the point.",
  actExpand: "Expand",
  actExpandPrompt:
    "You are an editor. Develop the text: make it fuller without inventing on the author's behalf.\n\n" +
    "Aim for about half again as long. If the text is already dense with detail, add less — length " +
    "is not the goal.\n\n" +
    "Develop: a thought compressed to a hint, a conclusion whose reasoning is missing, a claim with " +
    "no example, a list where every item is a single word, any place where the reader stumbles over " +
    "what was left unsaid.\n\n" +
    "What to develop it with: detail the text already implies, an example from the same range as the " +
    "ones there, the missing link of an argument, something the author clearly saw but did not write " +
    "down.\n\n" +
    "Do not add: new thoughts and conclusions, facts, figures, names and events that are not in the " +
    "text, general reasoning about the subject at large, introductory turns for the sake of length, " +
    "the same thing said twice in different words.\n\n" +
    "Keep: the author's voice and intonation — what you add must not sound like someone else wrote " +
    "it — the vocabulary (slang, profanity and jargon), the images and the jokes, the order of " +
    "thoughts, the markdown markup, [[wiki links]] (not a character inside the brackets), #tags, code " +
    "blocks and the paragraph structure.\n\n" +
    "Poems and songs: hold the metre, the rhythm and the rhyme scheme; add whole lines or stanzas " +
    "rather than inserting inside a line.\n\n" +
    "If you cannot see what could honestly be added, leave it as it is.",
  actShorten: "Shorten",
  actShortenPrompt:
    "You are an editor. Compress the text without losing a single thought.\n\n" +
    "Aim for about a third shorter. If the text is already dense, cut less — but honestly, not by " +
    "throwing meaning away.\n\n" +
    "Cut: repetition, spelling out the obvious, duplicate examples (keep the strongest), " +
    "introductory turns, parenthetical asides that are clear without them, adjectives that add " +
    "nothing.\n\n" +
    "Do not cut: facts, figures, names, the qualifiers “but”, “except”, “if” — they carry meaning — " +
    "and the author's images and jokes when they hold the text up.\n\n" +
    "Keep: the author's voice and intonation, the vocabulary, the order of thoughts, the markdown " +
    "markup, [[wiki links]] (not a character inside the brackets), #tags, code blocks, and the " +
    "paragraph structure. In poems and songs cut by whole stanzas rather than breaking the rhythm.\n\n" +
    "Do not retell in your own words what can stay as it is.",
  actTranscript: "Clean up transcript",
  actTranscriptPrompt:
    "The text is an automatic transcript of speech. Make it readable without turning it into a " +
    "summary.\n\n" +
    "Remove: empty filler words, hesitation sounds, a word repeated twice in a row, slips together " +
    "with their self-correction (keep the corrected version), phrases abandoned mid-sentence.\n\n" +
    "Add: punctuation, capital letters, paragraph breaks by meaning. An enumeration that is spoken " +
    "as a list becomes a list. Dialogue and quotes get quotation marks or dashes.\n\n" +
    "Keep: every thought and its order, the author's own expressions, images and jokes, the living " +
    "spoken intonation. A turn like “and then it hit me” is the author's voice, not noise.\n\n" +
    "Fix obvious recognition errors when the right word is clear from context: homophones, names, " +
    "terms, numbers. If it is not clear, leave it — do not invent.\n\n" +
    "Never: shorten the content, generalise, add anything of your own, or rewrite it into bookish " +
    "or bureaucratic style. Not one thought may be lost and not one new one may appear.",
  actEvaluate: "Evaluate the text",
  actEvaluatePrompt:
    "You are an editor going through someone's draft.\n\n" +
    "First work out the genre — a note, a song, a poem, a line for the stage, a letter, a post, a " +
    "raw thought — and judge it by the laws of that genre, not by “rules of good writing” in " +
    "general.\n\n" +
    "Answer in three parts:\n\n" +
    "**What holds it up** — the specific places the text stands on, quoted. If there is nothing, " +
    "say so instead of inventing merits.\n\n" +
    "**What gets in the way** — weak places, quoted, with what exactly is wrong: a cliché, a blurry " +
    "image, a sagging rhythm, a thought that gets lost, a paragraph too many, broken logic, the " +
    "wrong intonation.\n\n" +
    "**What to do** — two to four concrete steps. For one or two of the weakest lines, show how " +
    "they could be rewritten.\n\n" +
    "Quote, do not paraphrase. Do not praise out of politeness, do not soften — and do not savage " +
    "it for the sake of a sharp line either. Do not rewrite the whole text: your job is to explain, " +
    "not to replace the author. Do not discuss what is not in the text. No filler like “decent " +
    "overall, but there is room to improve”.\n\n" +
    "Be brief: a few sentences per part. Answer in the language of the text.",
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
  quickHint: "1–5 — a preset · Enter — rewrite the text · Ctrl+Enter — answer in the chat · ↑ — previous prompts",
  quickHintMac: "1–5 — a preset · Enter — rewrite the text · ⌘Enter — answer in the chat · ↑ — previous prompts",
  quickHead: "Quick menu",
  quickDesc:
    "Alt+1 opens a window over the selected text: type your own instruction, or press 1–5 for " +
    "a preset. The digit only picks a preset while the field is empty, so a prompt can start " +
    "with a number. The physical key matters, not the character, so any layout works.\n\n" +
    "This is also where an action is edited: pick it in a slot and press the pencil — name, icon, " +
    "prompt and what to do with the answer. An action taken off a slot is not lost: it keeps its " +
    "own command, and a command can be given a hotkey.",
  quickSlot: "Key {key}",
  quickPrompt: "Prompt of “{name}”",
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
    "instead of telling you to copy text by hand. Costs a couple of hundred extra tokens per request.",
  setToolConfirm: "Ask before every edit",
  setToolConfirmDesc:
    "An edit appears in the panel with an Apply button. Turn off and the model writes into the " +
    "note straight away — the undo is Ctrl+Z.",

  // ——— работа с выделением ———
  busy: "AI: {action}…",
  busyBar: "AI…",
  busyStop: "Click to stop",
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
    "did not make it into these five keep their commands too.",
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
  errModelList: "The provider did not return a list of models",
};

const ru: typeof en = {
  // ——— действия (заготовки) ———
  actSpelling: "Исправить орфографию",
  actSpellingPrompt:
    "Ты вычитываешь личные заметки. Твоя работа — только правописание, ничего сверх того.\n\n" +
    "Исправляй: орфографию, пунктуацию, опечатки, удвоенные и пропущенные пробелы, регистр букв, " +
    "дефис там, где по смыслу тире, случайные латинские буквы в русском слове.\n\n" +
    "Не трогай: стиль, порядок слов, лексику, длину и ритм фраз, сленг, мат, жаргон, авторские " +
    "словечки, намеренные повторы, разговорные обороты. Не объединяй и не разбивай предложения, " +
    "не заменяй слова синонимами, ничего не добавляй и не выбрасывай.\n\n" +
    "Разметку сохраняй посимвольно: знаки markdown, отступы, переносы строк и пустые строки, " +
    "==выделения==, блоки кода вместе с содержимым, ссылки, формулы, #теги. Ни одной буквы не " +
    "меняй внутри [[двойных квадратных скобок]] — это имена файлов, и правка рвёт связи между " +
    "заметками; в ссылке вида [[файл|подпись]] правь только подпись.\n\n" +
    "Стихи, песни, реплики: строка без точки в конце, тире вместо запятой, строчная буква в начале " +
    "строки — это авторский приём, а не ошибка. Разбивку на строки не меняй никогда.\n\n" +
    "Текст не на русском — правь по нормам его языка. Исправлять нечего — верни его дословно. " +
    "Сомневаешься — оставь как есть.",
  actClarify: "Сделать понятнее",
  actClarifyPrompt:
    "Ты редактор. Перепиши текст так, чтобы он читался легко с первого раза, — но это должен " +
    "остаться текст автора, а не твой.\n\n" +
    "Убирай: канцелярит, штампы, слова-паразиты, тавтологию, нанизывание родительных падежей, " +
    "страдательный залог там, где просится действительный, пустые вводные обороты, одну и ту же " +
    "мысль, сказанную дважды разными словами.\n\n" +
    "Сохраняй: голос и интонацию автора, лексику (сленг, мат и жаргон стоят там не случайно), " +
    "образы и шутки, все мысли и их порядок, примерный объём — сокращение здесь не задача.\n\n" +
    "Мера вмешательства: фраза и так читается легко — не трогай её вовсе. Правь только то, обо что " +
    "спотыкаешься.\n\n" +
    "Не добавляй новых мыслей, не делай выводов за автора, не сдвигай текст в деловой или " +
    "«литературный» стиль.\n\n" +
    "Разметку сохраняй посимвольно: markdown, [[вики-ссылки]] (ни буквы внутри скобок), #теги, " +
    "блоки кода, переносы строк и абзацы. В стихах и песнях не трогай разбивку на строки, ритм и " +
    "рифму — там непрозрачность бывает приёмом.",
  actExpand: "Расширить",
  actExpandPrompt:
    "Ты редактор. Разверни текст: сделай его полнее, не сочиняя за автора.\n\n" +
    "Ориентир — примерно в полтора раза длиннее. Если текст и так подробный, добавь меньше: объём " +
    "здесь не цель.\n\n" +
    "Разворачивай: мысль, сжатую до намёка; вывод, к которому не показан ход; утверждение без " +
    "примера; перечисление, где каждый пункт брошен одним словом; место, где читатель спотыкается о " +
    "недосказанность.\n\n" +
    "Чем разворачивать: подробностью, которая уже подразумевается в тексте, примером того же ряда, " +
    "что уже есть, недостающим звеном рассуждения, деталью, которую автор явно видел, но не " +
    "записал.\n\n" +
    "Не добавляй: новых мыслей и выводов, фактов, цифр, имён и событий, которых в тексте нет, общих " +
    "рассуждений о предмете вообще, вводных оборотов ради объёма, одной и той же мысли, сказанной " +
    "дважды разными словами.\n\n" +
    "Сохраняй: голос и интонацию автора — дописанное не должно быть слышно как чужое, — лексику " +
    "(сленг, мат и жаргон), образы и шутки, порядок мыслей, разметку markdown, [[вики-ссылки]] (ни " +
    "буквы внутри скобок), #теги, блоки кода и разбивку на абзацы.\n\n" +
    "Стихи и песни: держи размер, ритм и способ рифмовки; добавляй целыми строками и строфами, а не " +
    "вставками внутрь строки.\n\n" +
    "Не видишь, что можно дописать честно, — оставь как есть.",
  actShorten: "Сократить",
  actShortenPrompt:
    "Ты редактор. Сожми текст, не потеряв ни одной мысли.\n\n" +
    "Ориентир — примерно на треть короче. Если текст и так плотный, сократи меньше, но честно, а не " +
    "за счёт выброшенного смысла.\n\n" +
    "Режь: повторы, разжёвывание очевидного, примеры-дубли (оставляй сильнейший), вводные обороты, " +
    "уточнения в скобках, если и без них ясно, прилагательные, которые ничего не добавляют.\n\n" +
    "Не режь: факты, цифры, имена, оговорки «но», «кроме», «если» — они несут смысл, — а также " +
    "авторские образы и шутки, если на них текст держится.\n\n" +
    "Сохраняй: голос и интонацию автора, лексику, порядок мыслей, разметку markdown, " +
    "[[вики-ссылки]] (ни буквы внутри скобок), #теги, блоки кода и разбивку на абзацы. В стихах и " +
    "песнях сокращай целыми строфами, а не ломая ритм.\n\n" +
    "Не пересказывай своими словами то, что можно оставить как есть.",
  actTranscript: "Почистить расшифровку",
  actTranscriptPrompt:
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
    "канцелярит. Ни одна мысль не должна пропасть, ни одной новой — появиться.",
  actEvaluate: "Оценить текст",
  actEvaluatePrompt:
    "Ты редактор, разбирающий чужой черновик.\n\n" +
    "Сначала определи жанр — заметка, песня, стихи, сценическая реплика, письмо, пост, сырая " +
    "мысль — и суди по законам этого жанра, а не по «правилам хорошего текста вообще».\n\n" +
    "Ответь тремя частями:\n\n" +
    "**Что держит** — конкретные места, на которых текст стоит, с цитатами. Держать нечего — так и " +
    "скажи, не выдумывай достоинств.\n\n" +
    "**Что мешает** — слабые места с цитатами и объяснением, чем именно плохо: штамп, невнятный " +
    "образ, провисший ритм, потерянная мысль, лишний абзац, сбитая логика, интонация не та.\n\n" +
    "**Что сделать** — 2–4 конкретных шага. Для одной-двух самых слабых фраз покажи, как их можно " +
    "переписать.\n\n" +
    "Цитируй, а не пересказывай. Не хвали из вежливости, не смягчай — но и не разноси ради красного " +
    "словца. Не переписывай текст целиком: твоё дело объяснить, а не подменить собой автора. Не " +
    "обсуждай того, чего в тексте нет. Никаких общих слов вроде «в целом неплохо, но есть над чем " +
    "поработать».\n\n" +
    "Коротко: по нескольку фраз на часть. Отвечай на языке текста.",
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
  quickHint: "1–5 — готовое · Enter — переписать текст · Ctrl+Enter — ответ в чат · ↑ — прошлые промпты",
  quickHintMac: "1–5 — готовое · Enter — переписать текст · ⌘Enter — ответ в чат · ↑ — прошлые промпты",
  quickHead: "Быстрое меню",
  quickDesc:
    "Alt+1 открывает окно над выделенным текстом: пиши свою инструкцию или жми 1–5 для готового " +
    "действия. Цифра выбирает действие, только пока поле пустое, — так промпт может начинаться " +
    "с числа. Клавиша считается физическая, так что раскладка не мешает.\n\n" +
    "Здесь же действие и правится: выбери его в слоте и жми карандаш — название, иконка, промпт " +
    "и что делать с ответом. Снятое со слота действие не пропадает: у него остаётся своя команда, " +
    "а команде можно назначить горячую клавишу.",
  quickSlot: "Клавиша {key}",
  quickPrompt: "Промпт действия «{name}»",
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
    "вместо «скопируй вручную». Стоит лишних пары сотен токенов на запрос.",
  setToolConfirm: "Спрашивать перед каждой правкой",
  setToolConfirmDesc:
    "Правка появляется в панели с кнопкой «Применить». Выключишь — модель пишет в заметку сразу, " +
    "откат обычным Ctrl+Z.",

  // ——— работа с выделением ———
  busy: "ИИ: {action}…",
  busyBar: "ИИ…",
  busyStop: "Клик — остановить",
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
    "Каждое действие — ещё и команда: дай ей хоткей и вызывай мимо меню. У действий, не попавших " +
    "в эту пятёрку, команда тоже есть.",
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
