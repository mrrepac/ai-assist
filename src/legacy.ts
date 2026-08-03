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

/**
 * Заготовки, которых в плагине больше нет. Сохранённое действие само по себе
 * никуда не девается: без этого списка убранная заготовка так и осталась бы в
 * меню — просто перестав быть встроенной. Вычищаем только пока промпт остался
 * заводским: переписанный под себя — это уже своё действие, его не трогаем.
 */
const RETIRED = ["translate", "format"];

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
  // v0.1.0—0.1.4: пять слотов. Дальше их девять, и набор по умолчанию другой.
  ["spelling", "expand", "clarify", "shorten", "evaluate"],
].map((s) => s.join("\u0000"));

/** Остались ли слоты такими, какими их поставила прошлая версия плагина. */
export function isLegacySlots(slots: string[]): boolean {
  return LEGACY_SLOTS.includes(slots.join("\u0000"));
}
