import { App, Notice, PluginSettingTab, Setting, debounce, setIcon } from "obsidian";
import { newAction } from "./actions";
import { ApiError, chat, isLocalUrl, listModels } from "./api";
import { I18nKey, t } from "./i18n";
import { ActionModal, ConfirmModal, ModelSuggestModal } from "./modals";
import type AiAssistPlugin from "./main";
import { QUICK_KEYS } from "./quickmenu";
import {
  DEEPSEEK_MODELS,
  PROVIDER_ORDER,
  QUICK_ASK,
  providerLabel,
  providerOf,
  streamAvailable,
  switchProvider,
} from "./types";

/**
 * Пункт «завести своё действие» в списке слота. В настройках не хранится: по
 * нему сразу создаётся действие, и в слот ложится уже его id.
 */
const QUICK_NEW = "@new";

/** Что подсказать про имена моделей у конкретного провайдера. */
const MODEL_HINT: Record<string, I18nKey> = {
  deepseek: "setModelDesc",
  chadgpt: "setModelChad",
  gptunnel: "setModelFetchHint",
  polza: "setModelPolza",
  ollama: "setModelOllama",
  lmstudio: "setModelLmStudio",
};

export class AiAssistSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AiAssistPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ai-assist-settings");

    this.modelSection();
    this.behaviourSection();
    this.quickSection();
  }

  private async saveAndRedraw(): Promise<void> {
    await this.save();
    this.display();
  }

  /** Своё действие заводится прямо в слоте — другого места для этого нет. */
  private async addAction(slot: number): Promise<void> {
    const s = this.plugin.settings;
    const created = newAction();
    s.actions.push(created);
    s.quickSlots[slot] = created.id;
    await this.saveAndRedraw();
    // Пустое действие бесполезно, поэтому сразу открываем его на правку.
    new ActionModal(this.app, created, (edited) => {
      const at = s.actions.findIndex((a) => a.id === created.id);
      if (at !== -1) s.actions[at] = edited;
      void this.saveAndRedraw();
    }).open();
  }

  // ——————————————————————— быстрое меню ———————————————————————

  private quickSection(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;

    new Setting(containerEl).setName(t("quickHead")).setHeading();
    // Пустая строка в тексте — разрыв абзаца: в HTML он сам собой не появится.
    for (const para of t("quickDesc").split("\n\n")) {
      containerEl.createEl("p", { cls: "setting-item-description", text: para });
    }

    const options: Record<string, string> = { "": t("quickNone") };
    for (const a of s.actions) options[a.id] = a.name;
    options[QUICK_ASK] = t("quickAsk");
    options[QUICK_NEW] = t("quickNew");

    QUICK_KEYS.forEach((key, i) => {
      const id = s.quickSlots[i] ?? "";
      const action = s.actions.find((a) => a.id === id);

      const row = new Setting(containerEl)
        .setName(t("quickSlot", { key }))
        .addDropdown((c) =>
          c
            .addOptions(options)
            .setValue(id)
            .onChange((v) => {
              if (v === QUICK_NEW) {
                void this.addAction(i);
                return;
              }
              s.quickSlots[i] = v;
              // Перерисовываем весь экран: под слотом меняется промпт, а
              // список действий — заодно и подписи в остальных слотах.
              void this.saveAndRedraw();
            }),
        );

      if (!action) return;

      // Иконку показываем живьём: по названию из lucide не угадать, что выйдет.
      const icon = createSpan({ cls: "ai-act-icon" });
      setIcon(icon, action.icon);
      row.controlEl.prepend(icon);

      row.addExtraButton((b) =>
        b
          .setIcon("pencil")
          .setTooltip(t("actEdit"))
          .onClick(() =>
            new ActionModal(this.app, action, (edited) => {
              const at = s.actions.findIndex((a) => a.id === action.id);
              if (at !== -1) s.actions[at] = edited;
              void this.saveAndRedraw();
            }).open(),
          ),
      );
      // Встроенное действие удалить нельзя — иначе новая версия плагина вернёт
      // его обратно, и получится, что удаление не работает.
      if (!action.builtin) {
        row.addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip(t("actDelete"))
            .onClick(() =>
              new ConfirmModal(
                this.app,
                t("actDelete"),
                t("actDeleteConfirm", { name: action.name }),
                t("actDelete"),
                () => {
                  s.actions = s.actions.filter((a) => a.id !== action.id);
                  s.quickSlots = s.quickSlots.map((slot) => (slot === action.id ? "" : slot));
                  void this.saveAndRedraw();
                },
              ).open(),
            ),
        );
      }

      // Промпт правится прямо здесь: ради одной фразы не хочется открывать окно.
      new Setting(containerEl)
        .setDesc(t("quickPrompt", { name: action.name }))
        .setClass("ai-setting-stacked")
        .setClass("ai-quick-prompt")
        .addTextArea((c) => {
          c.setValue(action.prompt).onChange((v) => {
            action.prompt = v;
            this.saveLater();
          });
          c.inputEl.rows = 4;
        });
    });

    // Каждое действие — ещё и команда, так что ему можно дать свой хоткей и
    // вызывать мимо меню.
    new Setting(containerEl)
      .setDesc(t("setHotkeysDesc"))
      .addButton((b) => b.setButtonText(t("setHotkeysBtn")).onClick(() => this.openHotkeys()));
  }

  /** Любая правка полей заодно обновляет профиль текущего провайдера. */
  private async save(): Promise<void> {
    const s = this.plugin.settings;
    s.profiles[providerOf(s)] = { apiKey: s.apiKey, model: s.model, baseUrl: s.baseUrl };
    await this.plugin.saveSettings();
  }

  /**
   * Поля ввода и ползунок шлют onChange на каждую букву и на каждый пиксель, а
   * saveSettings — это запись data.json и перерегистрация всех команд. В памяти
   * значение меняется сразу, на диск уходит, когда рука остановилась.
   */
  private saveLater = debounce(() => void this.save(), 600, true);

  hide(): void {
    // Закрыли настройки, не дождавшись таймера, — дописываем сейчас.
    this.saveLater.run();
    super.hide();
  }

  // ——————————————————————— модель ———————————————————————

  private modelSection(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;

    new Setting(containerEl).setName(t("setProviderHead")).setHeading();

    const provider = providerOf(s);
    new Setting(containerEl)
      .setName(t("setProvider"))
      .setDesc(t("setProviderDesc"))
      .addDropdown((c) =>
        c
          // Порядок берётся из PROVIDERS, «свой адрес» дописывается последним.
          .addOptions(Object.fromEntries(PROVIDER_ORDER.map((n) => [n, providerLabel(n)])))
          .addOption("custom", providerLabel("custom"))
          .setValue(provider)
          .onChange(async (v) => {
            switchProvider(s, v);
            // У каждого сервиса свои имена моделей — угадать их нельзя.
            if (!s.model) new Notice(t("setPickModel"));
            await this.save();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName(t("setBaseUrl"))
      .setDesc(t("setBaseUrlDesc"))
      .addText((c) =>
        c
          .setPlaceholder("https://api.deepseek.com")
          .setValue(s.baseUrl)
          .onChange((v) => {
            s.baseUrl = v.trim();
            this.saveLater();
          }),
      );

    // У локального сервера ключа нет — поле для него только сбивало бы с толку.
    if (!isLocalUrl(s.baseUrl)) {
      new Setting(containerEl)
        .setName(t("setApiKey"))
        .setDesc(t("setApiKeyDesc"))
        .addText((c) => {
          c.inputEl.type = "password";
          c.setPlaceholder("sk-…")
            .setValue(s.apiKey)
            .onChange((v) => {
              s.apiKey = v.trim();
              this.saveLater();
            });
        });
    }

    new Setting(containerEl)
      .setName(t("setModel"))
      .setDesc(MODEL_HINT[provider] ? t(MODEL_HINT[provider]) : "")
      .addText((c) =>
        c
          .setPlaceholder(DEEPSEEK_MODELS[0])
          .setValue(s.model)
          .onChange((v) => {
            s.model = v.trim();
            this.saveLater();
          }),
      )
      .addButton((b) =>
        b.setButtonText(t("setModelFetch")).onClick(async () => {
          b.setDisabled(true);
          try {
            const models = await listModels(this.plugin.apiConfig());
            new Notice(t("setModelFetched", { n: models.length }));
            new ModelSuggestModal(this.app, models, async (model) => {
              s.model = model;
              await this.save();
              this.display();
            }).open();
          } catch (e) {
            new Notice(e instanceof ApiError ? e.message : String(e), 8000);
          } finally {
            b.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("setTest"))
      .setDesc(t("setTestDesc"))
      .addButton((b) =>
        b.setButtonText(t("setTestBtn")).onClick(async () => {
          b.setButtonText(t("setTestGoing")).setDisabled(true);
          try {
            const res = await chat(
              this.plugin.apiConfig(),
              [{ role: "user", content: "ping" }],
              { stream: false },
            );
            new Notice(
              res.text.trim()
                ? t("setTestOk", { model: this.plugin.settings.model })
                : t("emptyReply"),
            );
          } catch (e) {
            new Notice(t("setTestFail", { err: e instanceof ApiError ? e.message : String(e) }), 10000);
          } finally {
            b.setButtonText(t("setTestBtn")).setDisabled(false);
          }
        }),
      );
  }

  // ——————————————————————— поведение ———————————————————————

  private behaviourSection(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;

    new Setting(containerEl).setName(t("setBehaviourHead")).setHeading();

    new Setting(containerEl)
      .setName(t("setTemperature"))
      .setDesc(t("setTemperatureDesc"))
      .addSlider((c) =>
        c
          .setLimits(0, 2, 0.1)
          .setValue(s.temperature)
          .onChange((v) => {
            s.temperature = v;
            this.saveLater();
          }),
      );

    new Setting(containerEl)
      .setName(t("setMaxTokens"))
      .setDesc(t("setMaxTokensDesc"))
      .addText((c) =>
        c
          .setPlaceholder("0")
          .setValue(String(s.maxTokens))
          .onChange((v) => {
            s.maxTokens = Math.max(0, Math.round(Number(v) || 0));
            this.saveLater();
          }),
      );

    // Переключатели, которых у провайдера нет, лучше не показывать вовсе:
    // включённая настройка, которая ни на что не влияет, — это ложь.
    if (streamAvailable(s)) {
      new Setting(containerEl)
        .setName(t("setStream"))
        .setDesc(t("setStreamDesc"))
        .addToggle((c) =>
          c.setValue(s.stream).onChange(async (v) => {
            s.stream = v;
            await this.save();
          }),
        );
    }

    if (s.kind === "deepseek") {
      new Setting(containerEl)
        .setName(t("setThinking"))
        .setDesc(t("setThinkingDesc"))
        .addToggle((c) =>
          c.setValue(s.thinking).onChange(async (v) => {
            s.thinking = v;
            await this.save();
            this.display();
          }),
        );

      if (s.thinking) {
        new Setting(containerEl)
          .setName(t("setEffort"))
          .addDropdown((c) =>
            c
              .addOptions({
                low: t("setEffortLow"),
                medium: t("setEffortMedium"),
                high: t("setEffortHigh"),
              })
              .setValue(s.reasoningEffort)
              .onChange(async (v) => {
                s.reasoningEffort = v as "low" | "medium" | "high";
                await this.save();
              }),
          );
      }
    }

    new Setting(containerEl)
      .setName(t("setLang"))
      .setDesc(t("setLangDesc"))
      .addText((c) =>
        c
          .setPlaceholder(t("askLangPlaceholder"))
          .setValue(s.targetLang)
          .onChange((v) => {
            s.targetLang = v.trim() || t("defaultLang");
            this.saveLater();
          }),
      );

    new Setting(containerEl)
      .setName(t("setNoSelection"))
      .setDesc(t("setNoSelectionDesc"))
      .addDropdown((c) =>
        c
          .addOptions({
            note: t("setNoSelectionNote"),
            paragraph: t("setNoSelectionParagraph"),
            none: t("setNoSelectionNone"),
          })
          .setValue(s.noSelection)
          .onChange(async (v) => {
            s.noSelection = v as "note" | "paragraph" | "none";
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("setUsage"))
      .setDesc(t("setUsageDesc"))
      .addToggle((c) =>
        c.setValue(s.showUsage).onChange(async (v) => {
          s.showUsage = v;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName(t("setFresh"))
      .setDesc(t("setFreshDesc"))
      .addToggle((c) =>
        c.setValue(s.freshStart).onChange(async (v) => {
          s.freshStart = v;
          await this.save();
        }),
      );

    new Setting(containerEl).setName(t("setToolsHead")).setHeading();

    new Setting(containerEl)
      .setName(t("setTools"))
      .setDesc(t("setToolsDesc"))
      .addToggle((c) =>
        c.setValue(s.tools).onChange(async (v) => {
          s.tools = v;
          await this.save();
          this.display();
        }),
      );

    if (s.tools) {
      new Setting(containerEl)
        .setName(t("setToolConfirm"))
        .setDesc(t("setToolConfirmDesc"))
        .addToggle((c) =>
          c.setValue(s.toolsConfirm).onChange(async (v) => {
            s.toolsConfirm = v;
            await this.save();
          }),
        );
    }

    new Setting(containerEl)
      .setName(t("setSystem"))
      .setDesc(t("setSystemDesc"))
      .setClass("ai-setting-stacked")
      .addTextArea((c) => {
        c.setPlaceholder(t("setSystemPlaceholder"))
          .setValue(s.systemPrompt)
          .onChange((v) => {
            s.systemPrompt = v;
            this.saveLater();
          });
        c.inputEl.rows = 3;
      });
  }

  /**
   * Экран горячих клавиш, отфильтрованный по этому плагину. Окно настроек в
   * d.ts не описано, поэтому типизируем ровно те два метода, которыми
   * пользуемся, и каждый проверяем перед вызовом: не окажется — просто ничего
   * не произойдёт, а плагин не упадёт.
   */
  private openHotkeys(): void {
    const { setting } = this.app as App & {
      setting?: {
        openTabById?: (id: string) => void;
        activeTab?: { setQuery?: (query: string) => void };
      };
    };
    if (!setting?.openTabById) return;
    setting.openTabById("hotkeys");
    setting.activeTab?.setQuery?.(this.plugin.manifest.name);
  }
}
