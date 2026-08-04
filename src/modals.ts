import { App, Modal, Notice, Setting, SuggestModal, setIcon } from "obsidian";
import { AiAction, factoryPrompt } from "./actions";
import { t } from "./i18n";

/**
 * Правка действия целиком: название, промпт, что делать с ответом, иконка.
 * Работаем на копии — «Отмена» должна оставлять исходное нетронутым.
 */
export class ActionModal extends Modal {
  private draft: AiAction;

  constructor(app: App, action: AiAction, private onSave: (action: AiAction) => void) {
    super(app);
    this.draft = { ...action };
  }

  onOpen(): void {
    this.modalEl.addClass("ai-action-modal");
    this.titleEl.setText(this.draft.name || t("actNewName"));

    new Setting(this.contentEl).setName(t("actName")).addText((c) =>
      c.setValue(this.draft.name).onChange((v) => {
        this.draft.name = v;
        this.titleEl.setText(v || t("actNewName"));
      }),
    );

    new Setting(this.contentEl)
      .setName(t("actPrompt"))
      .setClass("ai-setting-stacked")
      .addTextArea((c) => {
        c.setValue(this.draft.prompt).onChange((v) => (this.draft.prompt = v));
        c.inputEl.rows = 10;
      });

    new Setting(this.contentEl)
      .setName(t("actMode"))
      .setDesc(t("actModeDesc"))
      .addDropdown((c) =>
        c
          .addOptions({
            replace: t("actModeReplace"),
            append: t("actModeAppend"),
            chat: t("actModeChat"),
          })
          .setValue(this.draft.mode)
          .onChange((v) => (this.draft.mode = v as AiAction["mode"])),
      );

    // Название иконки проверить нечем — списка имён Obsidian не отдаёт. Поэтому
    // рядом с полем живой пример: нарисовалось — значит имя существует.
    const preview = createSpan({ cls: "ai-icon-preview" });
    setIcon(preview, this.draft.icon);
    new Setting(this.contentEl)
      .setName(t("actIcon"))
      .setDesc(t("actIconDesc"))
      .addText((c) =>
        c
          .setPlaceholder("sparkles")
          .setValue(this.draft.icon)
          .onChange((v) => {
            this.draft.icon = v.trim();
            preview.empty();
            setIcon(preview, this.draft.icon);
          }),
      )
      .controlEl.prepend(preview);

    if (this.draft.builtin) {
      new Setting(this.contentEl)
        .setDesc(t("actBuiltinNote"))
        .addButton((b) =>
          b.setButtonText(t("actReset")).onClick(() => {
            const factory = factoryPrompt(this.draft.id);
            if (!factory) return;
            this.draft.prompt = factory;
            const area = this.contentEl.querySelector("textarea");
            if (area) area.value = factory;
            new Notice(t("actResetDone"));
          }),
        );
    }

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("modalCancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(t("modalSave"))
          .setCta()
          .onClick(() => {
            if (!this.draft.name.trim()) {
              new Notice(t("actNameRequired"));
              return;
            }
            this.draft.name = this.draft.name.trim();
            this.draft.icon = this.draft.icon.trim() || "sparkles";
            this.close();
            this.onSave(this.draft);
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Спросить перед тем, что не отменяется. */
export class ConfirmModal extends Modal {
  /** Согласились — значит закрытие окна отказом уже не считается. */
  private decided = false;

  constructor(
    app: App,
    private title: string,
    private message: string,
    private confirmText: string,
    private onConfirm: () => void,
    /** Отказ: и кнопка «Отмена», и крестик, и Esc — одно и то же. */
    private onCancel?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("modalCancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => {
            this.decided = true;
            this.close();
            this.onConfirm();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.onCancel?.();
  }
}

/**
 * То же согласие, но обещанием: спрашивая посреди работы, ответ надо дождаться,
 * а не продолжать мимо него.
 */
export function askConfirm(
  app: App,
  title: string,
  message: string,
  confirmText: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(
      app,
      title,
      message,
      confirmText,
      () => resolve(true),
      () => resolve(false),
    ).open();
  });
}

/** Выбор модели из того, что отдал провайдер. */
export class ModelSuggestModal extends SuggestModal<string> {
  constructor(app: App, private models: string[], private onPick: (model: string) => void) {
    super(app);
    this.setPlaceholder(t("setModel"));
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.models.filter((m) => m.toLowerCase().includes(q));
  }

  renderSuggestion(model: string, el: HTMLElement): void {
    el.setText(model);
  }

  onChooseSuggestion(model: string): void {
    this.onPick(model);
  }
}

