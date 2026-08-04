import { App, Modal, Platform, setIcon } from "obsidian";
import { t } from "./i18n";
import { QUICK_SLOTS_MAX } from "./types";

/** Цифры, которыми выбирается пресет. Сколько их занято — решают настройки. */
export const QUICK_KEYS = Array.from({ length: QUICK_SLOTS_MAX }, (_, i) => String(i + 1));

/**
 * Ловим физическую клавишу, а не символ: так меню работает и на русской
 * раскладке, и с цифрового блока.
 */
const QUICK_CODES = QUICK_KEYS.map((key) => [`Digit${key}`, `Numpad${key}`]);

/** Сколько своих промптов помним для листания стрелками. */
export const RECENT_LIMIT = 10;

export interface QuickPreset {
  label: string;
  icon: string;
  run: () => void;
}

/** Кусок заметки, который можно взять в работу: абзац, раздел, вся заметка. */
export interface QuickScope {
  /** Те же значения, что у настройки «если ничего не выделено». */
  kind: string;
  label: string;
  text: string;
}

export interface QuickMenuOptions {
  presets: (QuickPreset | null)[];
  /** Текст, к которому всё применится, — показываем, чтобы не гадать. */
  selection: string;
  /**
   * Чем можно заменить взятый кусок, когда выделения не было. Пусто — работаем
   * с выделенным, и менять тут нечего.
   */
  scopes: QuickScope[];
  /** Что из этого выбрано сейчас: по умолчанию — то, что стоит в настройках. */
  scope: string;
  recent: string[];
  onScope: (kind: string) => void;
  /** Окно закрыли, ничего не запустив. */
  onCancel: () => void;
  onPrompt: (prompt: string, toChat: boolean) => void;
}

/** Тысячи неразрывным пробелом: «27 600» читается, «27600» — считается. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Окно над выделением: сверху пресеты на цифрах, ниже поле для своего промпта.
 * Цифра срабатывает как выбор, только пока поле пустое, — иначе в промпт
 * нельзя было бы написать «сократи до 3 абзацев».
 */
export class QuickMenu extends Modal {
  private input!: HTMLTextAreaElement;
  private recentIndex = -1;
  /** Какой кусок берём сейчас; пустая строка — работаем с выделенным. */
  private chosen = "";
  private scopesEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  /** Что-то запустили — значит закрытие окна отменой не считается. */
  private started = false;

  constructor(app: App, private opts: QuickMenuOptions) {
    super(app);
    this.chosen = opts.scope;
  }

  onOpen(): void {
    this.modalEl.addClass("ai-quick-modal");
    this.titleEl.setText(t("quickTitle"));

    // Выделения не было, и плагин взял кусок сам — покажем, какой именно, и
    // дадим передумать не заходя в настройки.
    if (this.opts.scopes.length > 1) {
      this.scopesEl = this.contentEl.createDiv({ cls: "ai-quick-scopes" });
    }
    this.previewEl = this.contentEl.createDiv({ cls: "ai-quick-selection" });
    this.paintScopes();

    // Список, а не ряд кнопок: названия у действий разной длины, и в строку они
    // выстраиваются рвано.
    const list = this.contentEl.createDiv({ cls: "ai-quick-list" });
    this.opts.presets.forEach((preset, i) => {
      if (!preset) return;
      const row = list.createEl("button", { cls: "ai-quick-item" });
      row.createEl("kbd", { cls: "ai-quick-key", text: QUICK_KEYS[i] });
      setIcon(row.createSpan({ cls: "ai-quick-icon" }), preset.icon);
      row.createSpan({ cls: "ai-quick-item-label", text: preset.label });
      row.onclick = () => {
        this.started = true;
        this.close();
        preset.run();
      };
    });

    this.input = this.contentEl.createEl("textarea", {
      cls: "ai-quick-input",
      attr: { rows: "3", placeholder: t("quickPlaceholder") },
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));

    const hint = Platform.isMacOS ? t("quickHintMac") : t("quickHint");
    this.contentEl.createDiv({
      cls: "ai-quick-hint",
      text: this.opts.scopes.length > 1 ? `${hint} · ${t("quickHintScope")}` : hint,
    });

    window.setTimeout(() => this.input.focus(), 0);
  }

  /** Кнопки охвата и текст под ними: рисуются заново на каждую смену. */
  private paintScopes(): void {
    const current = this.opts.scopes.find((s) => s.kind === this.chosen);

    if (this.scopesEl) {
      this.scopesEl.empty();
      for (const scope of this.opts.scopes) {
        const btn = this.scopesEl.createEl("button", { cls: "ai-quick-scope" });
        btn.createSpan({ text: scope.label });
        btn.createSpan({ cls: "ai-quick-scope-size", text: grouped(scope.text.length) });
        btn.toggleClass("is-active", scope.kind === this.chosen);
        btn.onclick = () => this.pick(scope.kind);
      }
    }

    if (!this.previewEl) return;
    const source = current ? current.text : this.opts.selection;
    const preview = source.replace(/\s+/g, " ").trim();
    this.previewEl.setText(preview.length > 160 ? preview.slice(0, 160) + "…" : preview);
    this.previewEl.toggle(preview.length > 0);
  }

  private pick(kind: string): void {
    if (kind === this.chosen) return;
    this.chosen = kind;
    this.paintScopes();
    // Выделение в заметке едет следом: видно, что именно уйдёт в модель.
    this.opts.onScope(kind);
  }

  /** Соседний охват: стрелки ходят по ряду, не выходя за края. */
  private step(dir: 1 | -1): boolean {
    const list = this.opts.scopes;
    if (list.length < 2) return false;
    const at = list.findIndex((s) => s.kind === this.chosen);
    const next = Math.min(Math.max(at + dir, 0), list.length - 1);
    if (next === at) return true; // край ряда: стрелку всё равно съедаем
    this.pick(list[next].kind);
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    // Пока не набрано ни символа, цифра выбирает пресет — именно за этим
    // окно и открывают.
    if (!this.input.value) {
      const i = QUICK_CODES.findIndex((codes) => codes.includes(e.code));
      const preset = i === -1 ? null : this.opts.presets[i];
      if (preset && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.started = true;
        this.close();
        preset.run();
        return;
      }
      // По тому же правилу — стрелки вбок меняют охват: в пустом поле им всё
      // равно нечего двигать.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (this.step(e.key === "ArrowRight" ? 1 : -1)) {
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const prompt = this.input.value.trim();
      if (!prompt) return;
      this.started = true;
      this.close();
      // Enter отвечает в чате, и только Ctrl+Enter правит заметку. Наоборот
      // было опаснее: «перескажи главу», набранное сгоряча, стирало главу
      // пересказом — а Enter жмут не глядя.
      this.opts.onPrompt(prompt, !(e.ctrlKey || e.metaKey));
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
    if (!this.started) this.opts.onCancel();
  }
}
