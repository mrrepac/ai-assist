import { App, Modal, Platform, setIcon } from "obsidian";
import { t } from "./i18n";

/** Пять пресетов, выбираемых цифрой. */
export const QUICK_KEYS = ["1", "2", "3", "4", "5"];

/**
 * Ловим физическую клавишу, а не символ: так меню работает и на русской
 * раскладке, и с цифрового блока.
 */
const QUICK_CODES = [
  ["Digit1", "Numpad1"],
  ["Digit2", "Numpad2"],
  ["Digit3", "Numpad3"],
  ["Digit4", "Numpad4"],
  ["Digit5", "Numpad5"],
];

/** Сколько своих промптов помним для листания стрелками. */
export const RECENT_LIMIT = 10;

export interface QuickPreset {
  label: string;
  icon: string;
  run: () => void;
}

export interface QuickMenuOptions {
  presets: (QuickPreset | null)[];
  /** Текст, к которому всё применится, — показываем, чтобы не гадать. */
  selection: string;
  recent: string[];
  onPrompt: (prompt: string, toChat: boolean) => void;
}

/**
 * Окно над выделением: сверху пресеты на цифрах, ниже поле для своего промпта.
 * Цифра срабатывает как выбор, только пока поле пустое, — иначе в промпт
 * нельзя было бы написать «сократи до 3 абзацев».
 */
export class QuickMenu extends Modal {
  private input!: HTMLTextAreaElement;
  private recentIndex = -1;

  constructor(app: App, private opts: QuickMenuOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ai-quick-modal");
    this.titleEl.setText(t("quickTitle"));

    const preview = this.opts.selection.replace(/\s+/g, " ").trim();
    if (preview) {
      this.contentEl.createDiv({
        cls: "ai-quick-selection",
        text: preview.length > 160 ? preview.slice(0, 160) + "…" : preview,
      });
    }

    // Список, а не ряд кнопок: названия у действий разной длины, и в строку они
    // выстраиваются рвано.
    const list = this.contentEl.createDiv({ cls: "ai-quick-list" });
    QUICK_KEYS.forEach((key, i) => {
      const preset = this.opts.presets[i];
      if (!preset) return;
      const row = list.createEl("button", { cls: "ai-quick-item" });
      row.createEl("kbd", { cls: "ai-quick-key", text: key });
      setIcon(row.createSpan({ cls: "ai-quick-icon" }), preset.icon);
      row.createSpan({ cls: "ai-quick-item-label", text: preset.label });
      row.onclick = () => {
        this.close();
        preset.run();
      };
    });

    this.input = this.contentEl.createEl("textarea", {
      cls: "ai-quick-input",
      attr: { rows: "3", placeholder: t("quickPlaceholder") },
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));

    this.contentEl.createDiv({
      cls: "ai-quick-hint",
      text: Platform.isMacOS ? t("quickHintMac") : t("quickHint"),
    });

    window.setTimeout(() => this.input.focus(), 0);
  }

  private onKey(e: KeyboardEvent): void {
    // Пока не набрано ни символа, цифра выбирает пресет — именно за этим
    // окно и открывают.
    if (!this.input.value) {
      const i = QUICK_CODES.findIndex((codes) => codes.includes(e.code));
      const preset = i === -1 ? null : this.opts.presets[i];
      if (preset && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.close();
        preset.run();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const prompt = this.input.value.trim();
      if (!prompt) return;
      this.close();
      this.opts.onPrompt(prompt, e.ctrlKey || e.metaKey);
      return;
    }

    // Стрелки листают прошлые промпты: правки часто повторяются слово в слово.
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && this.opts.recent.length) {
      const atEdge = e.key === "ArrowUp" ? this.input.selectionStart === 0 : false;
      if (e.key === "ArrowUp" && !atEdge && this.input.value) return;
      e.preventDefault();
      const last = this.opts.recent.length - 1;
      this.recentIndex =
        e.key === "ArrowUp"
          ? Math.min(this.recentIndex + 1, last)
          : Math.max(this.recentIndex - 1, -1);
      this.input.value = this.recentIndex === -1 ? "" : this.opts.recent[this.recentIndex];
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
