# RU AI Assist

A sidebar chat with a language model, and in-place rewriting of the text you selected.

**Built for people working from Russia.** Every provider it ships with is reachable
without a VPN and takes Russian payment cards: DeepSeek directly, plus three Russian
aggregators — Polza.ai, ChadGPT and GPTunnel — which give you GPT, Claude, Gemini and the
rest through a single key. And Ollama, if you would rather run a model on your own
machine.

Most AI plugins are built around the chat. This one is built around the note: you select a
piece of text, press a key, and the text changes. The chat is there too, in the right
sidebar, but the main road is selection → key → done.

*Читаете по-русски? Есть [русская версия README](https://github.com/mrrepac/ai-assist/blob/master/README.ru.md).*

## What it does

- **Actions over the selection.** Fix spelling, improve the text, expand it, shorten it,
  evaluate it — or write your own prompt. The result replaces the selected text; the undo
  is the usual `Ctrl+Z`.
- **Selecting is optional.** The settings decide what an action works on when nothing is
  selected: the whole note, the section under the cursor (from its heading down to the next
  one of the same level, subsections included), the paragraph — or nothing at all, if you
  would rather always be asked to select.
- **Quick menu** opens over the selection: the digits run your presets — five keys to begin
  with, up to nine if you add them — and the field below takes a one-off instruction. The
  digit only picks a preset while the field is empty, so a prompt can start with a number.
  The answer to a one-off instruction comes to the chat; `Ctrl+Enter` puts it into the note
  instead.
  The physical key is what counts, so any keyboard layout works. The menu comes without a
  key of its own: switch on `Alt+1` in the settings, or bind whatever suits you.
- **Nothing selected — you see what was taken.** The menu then grows a row — paragraph,
  section, note — with the size of each, the one from your settings picked and the piece
  itself highlighted in the note. The arrow keys change it for this one run; the setting
  stays as it was.
- **Right-click on the selection.** The editor's context menu offers the quick menu and a
  question to the chat — and the actions themselves, each on its own line, if you want them
  there. On a phone it is the same menu, held down. With nothing selected the plugin adds
  nothing to it.
- **Ask about a fragment.** Select a piece of a note and go to the chat: it comes along as
  an attachment, so the question can be just "and shorter?" — and the fragment stays with
  the conversation for the questions that follow.
- **A journal of edits** in the side panel: what ran, what came back, what exactly changed
  (word-level diff, "was → became"), an "Undo the edit" button and a "Run it again" one —
  it brings the text back and runs the same action over it once more.
- **Chat in the right sidebar** with streaming, thinking blocks, the running cost in
  tokens, and a button that saves the conversation into a note.
- **The conversation can be rewritten.** Under an answer — "ask again"; under your own
  question — a pencil that puts the text back into the field, so the question can leave as
  a different one. The bin removes what is not needed, and whatever was removed comes back
  from the notice.
- **The input field remembers.** An unfinished question survives closing the panel and
  restarting Obsidian, and the up arrow walks through your previous questions.
- **The model can edit the note itself** through tools — every edit is shown as a card
  with an Apply button, so nothing lands in your text without you. An action that answers
  in the panel gets no tools at all: "show it in the panel" already says "leave the note
  alone".

## Providers

Anything that speaks the OpenAI format. The presets are the ones that work from Russia
without a VPN:

- **DeepSeek** — the Chinese model directly: cheap, no middleman;
- **Polza.ai**, **ChadGPT**, **GPTunnel** — Russian aggregators: one key, and behind it
  GPT, Claude, Gemini and dozens of other models, paid for with a Russian card;
- **Ollama** — a model on your own computer, free and offline.

Plus any other base URL you type in. The API key, the model and the address are remembered
separately for each provider, so switching back and forth does not lose your keys.

With **Ollama** running on your machine, nothing leaves it at all: no key is asked for and
none is sent.

## Getting started

1. Install the plugin and open its settings.
2. Pick a provider, paste the API key, and choose a model — the "Fetch" button asks the
   provider for the list. There is a "Test connection" button right below.
3. In the "Quick menu" section, switch on `Alt+1` — or give the "Quick menu over the
   selection" command a key of your own in Obsidian's hotkey settings.
4. Select some text in a note and press it. Or right-click the selection — the plugin is
   already there.

## Settings

Everything lives in three sections:

- **Provider** — service, address, key, model, connection test.
- **Behaviour** — temperature, response length limit, streaming,
  what to do when nothing is selected (the whole note / the section / the paragraph /
  nothing), the length past which it asks before sending, token usage display, where new
  notes go (the vault root / a folder of your own / next to the note being worked on),
  note editing tools, the system prompt for the chat.
- **Quick menu** — the keys: five by default, more if you add them, and a row can be
  dragged by its handle; plus what the plugin puts into the editor's context menu. Each
  key is an action, and this is where an action is
  edited: name, icon, prompt, and what to do with the answer. Your own action is created
  in a slot too. An action taken off a slot is not lost — it keeps its own command, and a
  command can be given a hotkey.

## Commands

Every action is a command, so any of them can get a hotkey of your own. Plus: open the
chat, start a private chat, ask about the selection, repeat the last action, stop generation,
and the quick menu. The last two take `Alt+1` and `Alt+2` if you switch that on in the
settings.

## What is sent where

The text you run an action on goes to the provider you configured, and nowhere else. The
plugin has no telemetry, no analytics and no server of its own; the settings live in
`.obsidian/plugins/ai-assist/data.json` and the chat history in `history.json` next to it,
inside your vault.

Two things send more than the question itself. "Send the current note as context" attaches
the open note to every request in the chat. And a model allowed to edit notes can read the
open one whenever it decides to — that is a separate switch, and every call it makes is
shown in the panel as a card.

When none of that is wanted, there is the **private chat** — the "New private chat" entry in
the header's `…` menu, the command in the palette, or `Alt+2` if you let the plugin take the
keys. It works like a private window in a browser: a separate conversation where nothing
leaves the vault at all — no note, no selected fragment, no tools, no system prompt. Just your
question and the answer, the way it works on the provider's own site. The header is tinted
there, and in place of the context button sits an unplugged cord: there is nothing to switch
on. A normal "New chat" brings everything back.

## Requirements

Obsidian 1.8.7 or newer. Desktop and mobile. An API key from one of the providers, or a
local server on your own machine.

## License

MIT — see [LICENSE](https://github.com/mrrepac/ai-assist/blob/master/LICENSE).
