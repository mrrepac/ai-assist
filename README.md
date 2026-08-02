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

*Читаете по-русски? Есть [русская версия README](README.ru.md).*

## What it does

- **Actions over the selection.** Fix spelling, make it clearer, expand, shorten,
  evaluate, clean up a transcript — or write your own prompt. The result replaces the
  selected text; the undo is the usual `Ctrl+Z`.
- **Quick menu** (`Alt+1`) opens over the selection: keys `1`–`5` run your five presets,
  and the field below takes a one-off instruction. The digit only picks a preset while the
  field is empty, so a prompt can start with a number. The physical key is what counts, so
  any keyboard layout works.
- **A journal of edits** in the side panel: what ran, what came back, what exactly changed
  (word-level diff, "was → became") and an "Undo the edit" button.
- **Chat in the right sidebar** with streaming, thinking blocks, the running cost in
  tokens, and a button that saves the conversation into a note.
- **The model can edit the note itself** through tools — every edit is shown as a card
  with an Apply button, so nothing lands in your text without you.

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
3. Select some text in a note and press `Alt+1`.

## Settings

Everything lives in three sections:

- **Provider** — service, address, key, model, connection test.
- **Behaviour** — temperature, response length limit, streaming, thinking (DeepSeek),
  what to do when nothing is selected (the whole note / the paragraph under the cursor /
  nothing), token usage display, note editing tools, the system prompt for the chat.
- **Quick menu** — the five slots. Each slot is an action, and this is where an action is
  edited: name, icon, prompt, and what to do with the answer. Your own action is created
  in a slot too. An action taken off a slot is not lost — it keeps its own command, and a
  command can be given a hotkey.

## Commands

Every action is a command, so any of them can get a hotkey of your own. Plus: open the
chat, ask about the selection, repeat the last action, stop generation, and the quick menu
(`Alt+1` out of the box).

## What is sent where

The text you run an action on goes to the provider you configured, and nowhere else. The
plugin has no telemetry, no analytics and no server of its own; the chat history and the
settings live in `.obsidian/plugins/ai-assist/data.json` inside your vault.

## Requirements

Obsidian 1.8.7 or newer. Desktop and mobile. An API key from one of the providers, or a
local server on your own machine.

## License

MIT — see [LICENSE](LICENSE).
