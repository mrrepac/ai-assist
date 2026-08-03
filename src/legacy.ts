/*
 * Промпты встроенных действий из прошлых версий плагина.
 *
 * Зачем: промпт хранится в data.json, поэтому новые заготовки сами по себе до
 * пользователя не доезжают. Сравнивая сохранённое с этим списком, отличаем
 * «промпт остался заводским» (можно обновить) от «пользователь переписал его
 * под себя» (трогать нельзя). Добавляя новую редакцию заготовок, старую
 * дописывай сюда.
 */
const LEGACY = [
  // v0.1.0, ru
  "Ты корректор. Исправь в тексте орфографию, пунктуацию и опечатки. " +
    "Не меняй стиль, порядок слов, лексику и разметку Markdown. " +
    "Сохраняй авторский голос, сленг и намеренные отступления от нормы. " +
    "Если исправлять нечего — верни текст без изменений.",
  "Переведи текст на {lang}. Сохрани разметку Markdown, переносы строк и структуру " +
    "оригинала. Имена собственные оставляй как есть, если нет устоявшегося перевода. " +
    "Передавай смысл и интонацию, а не переводи дословно.",
  "Текст — расшифровка устной речи. Убери слова-паразиты, запинки, повторы и оговорки, " +
    "расставь пунктуацию и раздели на абзацы. Сохрани смысл, интонацию и авторские " +
    "выражения. Ничего не придумывай, не сокращай содержание и не превращай в пересказ.",
  "Разбери текст: что работает, что слабо и что с этим делать. " +
    "Говори конкретно и цитируй места, о которых речь. Без похвал и воды — " +
    "по нескольку фраз на пункт достаточно. Отвечай на языке текста.",

  // v0.1.0, en
  "You are a proofreader. Fix spelling, punctuation and typos in the text. " +
    "Do not change the style, word order, vocabulary or Markdown formatting. " +
    "Keep the author's voice, slang and deliberate deviations. " +
    "If there is nothing to fix, return the text unchanged.",
  "Translate the text into {lang}. Keep the Markdown formatting, line breaks and " +
    "the structure of the original. Keep proper names as they are unless there is an " +
    "established translation. Convey the tone rather than translating word by word.",
  "The text is a transcript of speech. Remove filler words, stutters, repetitions and " +
    "false starts, add punctuation and split it into paragraphs. Keep the meaning, the " +
    "intonation and the author's expressions. Do not invent anything, do not shorten the " +
    "content and do not turn it into a summary.",
  "Analyse the text: what works, what is weak, and what to do about it. " +
    "Be specific and quote the places you mean. No praise, no filler — a few sentences " +
    "per point is enough. Answer in the language of the text.",

  // v0.2.0, ru — подробные заготовки, замененные короткими промптами Льва.
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

  // Чистка расшифровки: заготовку убрали, промпт лежит здесь — по нему видно,
  // что действие досталось от плагина и его можно вычистить при обновлении.
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

  // v0.2.0, en — те же заготовки на английском.
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

  // Перевод: заготовку убрали совсем, но промпт лежит здесь — по нему видно,
  // что действие досталось от плагина и его можно вычистить при обновлении.
  "Переведи текст на {lang}.\n\n" +
    "Переводи смысл и интонацию, а не слова: читатель не должен догадаться, что перед ним перевод. " +
    "Никаких калек и подстрочника. Держи регистр речи — разговорное переводи разговорным, грубое " +
    "грубым, сленг живым сленгом языка перевода, канцелярит канцеляритом. Идиомы заменяй идиомами, " +
    "а не объяснением их смысла.\n\n" +
    "Сохраняй посимвольно: разметку markdown, переносы строк, абзацы и пустые строки, блоки кода " +
    "вместе с содержимым, ссылки, #теги и текст внутри [[вики-ссылок]] — это имена файлов, их " +
    "перевод рвёт связи в хранилище; в ссылке [[файл|подпись]] переводи только подпись.\n\n" +
    "Имена собственные давай в устоявшемся для языка {lang} виде, а если такого нет — оставляй как " +
    "в оригинале. Реалии без прямого аналога передавай коротким описанием, без сносок и пояснений " +
    "в скобках.\n\n" +
    "Стихи и песни: сохраняй число строк и строфику, держи ритм; рифму — если она не требует " +
    "жертвовать смыслом.\n\n" +
    "Ничего не добавляй от себя: ни примечаний, ни вариантов на выбор, ни комментариев к решениям.",
  "Translate the text into {lang}.\n\n" +
    "Translate the meaning and the tone, not the words: the reader should not be able to tell it " +
    "is a translation. No calques, no word-by-word rendering. Keep the register — casual stays " +
    "casual, rude stays rude, slang becomes living slang of the target language, bureaucratese " +
    "stays bureaucratese. Replace idioms with idioms rather than explaining them.\n\n" +
    "Preserve character for character: markdown markup, line breaks, paragraphs and blank lines, " +
    "code blocks with their contents, URLs, #tags, and the text inside [[wiki links]] — those are " +
    "file names and translating them breaks links in the vault; in a [[file|label]] link translate " +
    "the label only.\n\n" +
    "Give proper names in the form established in {lang}; if there is none, keep the original. " +
    "Render culture-specific things with a short description, without footnotes or parenthetical " +
    "explanations.\n\n" +
    "Poems and songs: keep the number of lines and the stanza structure, hold the rhythm; keep the " +
    "rhyme when it does not cost meaning.\n\n" +
    "Add nothing of your own: no notes, no alternative versions, no comments on your choices.",
].map((s) => s.trim());

/** Совпадает ли промпт с какой-нибудь прежней заготовкой. */
export function isLegacyPrompt(prompt: string): boolean {
  return LEGACY.includes(prompt.trim());
}

/*
 * Прежние названия встроенных действий. Имя лежит в data.json рядом с промптом
 * и так же не доезжает само: без этого списка переименованная заготовка
 * осталась бы под старой вывеской навсегда. Своё название не трогаем.
 */
const LEGACY_NAMES = [
  "Сделать понятнее",
  "Make it clearer",
  "Расширить",
  "Expand",
  "Сократить",
  "Shorten",
];

/** Осталось ли название таким, каким его дала прошлая версия плагина. */
export function isLegacyName(name: string): boolean {
  return LEGACY_NAMES.includes(name.trim());
}

/**
 * Заготовки, которых в плагине больше нет. Сохранённое действие само по себе
 * никуда не девается: без этого списка убранная заготовка так и осталась бы в
 * меню — просто перестав быть встроенной. Вычищаем только пока промпт остался
 * заводским: переписанный под себя — это уже своё действие, его не трогаем.
 */
const RETIRED = ["translate", "format", "transcript"];

export function isRetired(id: string, prompt: string): boolean {
  if (!RETIRED.includes(id)) return false;
  // «Форматирование» правило чистки делало само, промпта у него не было вовсе —
  // терять там нечего. У остальных смотрим на промпт.
  return !prompt.trim() || isLegacyPrompt(prompt);
}

/*
 * Прежние наборы быстрых клавиш. Та же логика, что с промптами: набор, который
 * пользователь не перекладывал под себя, при обновлении заменяем новым, а
 * собранный вручную не трогаем.
 */
const LEGACY_SLOTS = [
  ["spelling", "translate", "evaluate", "transcript", "@ask"],
  ["spelling", "translate", "evaluate", "transcript", "@ask", "@translate-to"],
  ["spelling", "translate", "evaluate"],
  ["spelling", "clarify", "shorten", "evaluate", "translate"],
  ["spelling", "format", "clarify", "shorten", "evaluate"],
  ["spelling", "expand", "format", "shorten", "evaluate"],
].map((s) => s.join("\u0000"));

/** Остались ли слоты такими, какими их поставила прошлая версия плагина. */
export function isLegacySlots(slots: string[]): boolean {
  return LEGACY_SLOTS.includes(slots.join("\u0000"));
}
