import { App, Notice, Platform, PluginSettingTab, Setting, debounce, setIcon } from "obsidian";
import { newAction } from "./actions";
import { ApiError, chat, isLocalUrl } from "./api";
import { I18nKey, t } from "./i18n";
import { ActionModal, ConfirmModal, ModelSuggestModal } from "./modals";
import type AiAssistPlugin from "./main";
import { QUICK_KEYS } from "./quickmenu";
import {
  AiAssistSettings,
  DEEPSEEK_MODEL,
  EditorMenuMode,
  NewNoteFolder,
  PROVIDER_ORDER,
  QUICK_ASK,
  QUICK_SLOTS_MAX,
  builtinModels,
  modelsFor,
  providerLabel,
  providerOf,
  providerRank,
  streamAvailable,
  switchProvider,
  toolsAllowed,
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
  perplexity: "setModelPerplexity",
  ollama: "setModelOllama",
  lmstudio: "setModelLmStudio",
};

export class AiAssistSettingTab extends PluginSettingTab {
  /** Какой слот сейчас тянут; null — не тянут ничего. */
  private dragFrom: number | null = null;
  /** Контейнер списка клавиш: перерисовывается сам, без остального экрана. */
  private slotsEl: HTMLElement | null = null;

  constructor(app: App, private plugin: AiAssistPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
    await this.saveSlots();
    // Пустое действие бесполезно, поэтому сразу открываем его на правку.
    new ActionModal(this.app, created, s, (edited) => {
      const at = s.actions.findIndex((a) => a.id === created.id);
      if (at !== -1) s.actions[at] = edited;
      void this.saveSlots();
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

    // Список живёт в своём контейнере: перекладывая клавиши, экран целиком не
    // перерисовываем — иначе настройки отпрыгивают к началу на каждое движение.
    this.slotsEl = containerEl.createDiv();
    this.renderSlots();

    // Меню и клавиша — про одно и то же: как добраться до действий, не заходя
    // в палитру команд. Поэтому дверь рядом с ключом.
    new Setting(containerEl)
      .setName(t("setEditorMenu"))
      .setDesc(t("setEditorMenuDesc"))
      .addDropdown((c) =>
        c
          .addOptions({
            none: t("setMenuNone"),
            quick: t("setMenuQuick"),
            actions: t("setMenuActions"),
          })
          .setValue(s.editorMenu)
          .onChange(async (v) => {
            s.editorMenu = v as EditorMenuMode;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("setHotkey"))
      .setDesc(t("setHotkeyDesc"))
      .addToggle((c) =>
        c.setValue(s.defaultHotkey).onChange(async (v) => {
          s.defaultHotkey = v;
          await this.save();
          // Команды регистрируются один раз при загрузке, поэтому вслух
          // говорим, что клавиша появится не сию секунду.
          new Notice(t("setHotkeyReload"), 6000);
        }),
      );

    // Каждое действие — ещё и команда, так что ему можно дать свой хоткей и
    // вызывать мимо меню.
    new Setting(containerEl)
      .setDesc(t("setHotkeysDesc"))
      .addButton((b) => b.setButtonText(t("setHotkeysBtn")).onClick(() => this.openHotkeys()));
  }

  /** Записать и перерисовать один список клавиш — экран остаётся на месте. */
  private async saveSlots(): Promise<void> {
    await this.save();
    this.renderSlots();
  }

  /**
   * Клавиши быстрого меню. Номер слева закреплён за строкой и никуда не едет —
   * переезжает то, что на него назначено.
   */
  private renderSlots(): void {
    const list = this.slotsEl;
    if (!list) return;
    const s = this.plugin.settings;
    list.empty();

    const options: Record<string, string> = { "": t("quickNone") };
    for (const a of s.actions) options[a.id] = a.name;
    options[QUICK_ASK] = t("quickAsk");
    options[QUICK_NEW] = t("quickNew");

    s.quickSlots.forEach((id, i) => {
      const action = s.actions.find((a) => a.id === id);

      const row = new Setting(list)
        .setName(t("quickSlot", { key: QUICK_KEYS[i] }))
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
              void this.saveSlots();
            }),
        );
      row.settingEl.addClass("ai-slot");

      // Иконку показываем живьём: по названию из lucide не угадать, что выйдет.
      // На пустой клавише место под неё остаётся — иначе её список съезжает
      // влево, и ровный столбик рассыпается.
      const icon = createSpan({ cls: "ai-act-icon" });
      if (action) setIcon(icon, action.icon);
      row.controlEl.prepend(icon);

      // Ручка — уже за разделителем, первой в правой половине строки: слева от
      // линии живёт только номер клавиши, он с места не двигается.
      this.makeDraggable(row.settingEl, row.controlEl, i);

      // Карандаш есть на каждой клавише: на занятой открывает действие, на
      // пустой заводит новое — ряд кнопок ровный, и пустая клавиша не тупик.
      row.addExtraButton((b) =>
        b
          .setIcon("pencil")
          .setTooltip(action ? t("actEdit") : t("quickNew"))
          .onClick(() => {
            if (!action) {
              void this.addAction(i);
              return;
            }
            new ActionModal(this.app, action, s, (edited) => {
              const at = s.actions.findIndex((a) => a.id === action.id);
              if (at !== -1) s.actions[at] = edited;
              void this.saveSlots();
            }).open();
          }),
      );

      // Встроенное действие удалить нельзя — иначе новая версия плагина вернёт
      // его обратно, и получится, что удаление не работает.
      if (action && !action.builtin) {
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
                  void this.saveSlots();
                },
              ).open(),
            ),
        );
      }
    });

    // Пять клавиш хватает почти всегда, поэтому лишние заводятся руками.
    const foot = new Setting(list);
    if (s.quickSlots.length < QUICK_SLOTS_MAX) {
      foot.addButton((b) =>
        b.setButtonText(t("quickAddKey")).onClick(() => {
          s.quickSlots.push("");
          void this.saveSlots();
        }),
      );
    }
    if (s.quickSlots.length > 1) {
      foot.addExtraButton((b) =>
        b
          .setIcon("minus")
          .setTooltip(t("quickDropKey", { key: QUICK_KEYS[s.quickSlots.length - 1] }))
          .onClick(() => {
            // Действие с последней клавиши не пропадает — у него остаётся команда.
            s.quickSlots.pop();
            void this.saveSlots();
          }),
      );
    }
  }

  /**
   * Перетаскивание слота. Раскладка — вещь про руку, а не про список: клавиши
   * удобнее расставлять, двигая строки, чем переназначая каждый выпадающий
   * список по очереди. Строка едет со сдвигом остальных, как в обычном списке.
   */
  private makeDraggable(el: HTMLElement, gripHost: HTMLElement, index: number): void {
    // На телефоне перетаскивания нет — HTML5 drag&drop не работает от касаний, и
    // ручка обещала бы то, чего не будет. Там слоты меняются выпадающим списком.
    if (Platform.isMobile) return;

    el.draggable = true;

    // Ручка ничего не делает сама — она говорит, что строку можно тянуть.
    const grip = createSpan({ cls: "ai-slot-grip" });
    setIcon(grip, "grip-vertical");
    gripHost.prepend(grip);

    el.addEventListener("dragstart", (e) => {
      this.dragFrom = index;
      el.addClass("is-dragging");
      // Без данных в dataTransfer Firefox не начинает перетаскивание вовсе.
      e.dataTransfer?.setData("text/plain", String(index));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      // За курсором едет только правая половина строки: номер клавиши закреплён
      // за местом, а переезжает то, что на него назначено.
      e.dataTransfer?.setDragImage(gripHost, 0, gripHost.clientHeight / 2);
    });
    el.addEventListener("dragend", () => {
      el.removeClass("is-dragging");
      this.clearDropMarks();
      this.dragFrom = null;
    });
    el.addEventListener("dragover", (e) => {
      if (this.dragFrom === null || this.dragFrom === index) return;
      e.preventDefault();
      this.clearDropMarks();
      // Линия с той стороны, с которой строка встанет: сверху, если тянут
      // снизу вверх, и снизу, если наоборот.
      el.addClass(this.dragFrom < index ? "is-drop-after" : "is-drop-before");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = this.dragFrom;
      this.clearDropMarks();
      if (from === null || from === index) return;
      const slots = this.plugin.settings.quickSlots;
      const [moved] = slots.splice(from, 1);
      slots.splice(index, 0, moved);
      void this.saveSlots();
    });
  }

  private clearDropMarks(): void {
    this.containerEl.findAll(".ai-slot").forEach((el) => {
      el.removeClasses(["is-drop-before", "is-drop-after"]);
    });
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
          .setPlaceholder(DEEPSEEK_MODEL)
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
            const models = await modelsFor(this.plugin.apiConfig());
            // У провайдера со встроенным списком спрашивать было нечего —
            // «моделей найдено» тут прозвучало бы как отчёт о запросе, которого
            // не было.
            new Notice(
              builtinModels(provider) ? t("setModelBuiltin") : t("setModelFetched", { n: models.length }),
            );
            new ModelSuggestModal(this.app, models, (model) => {
              s.model = model;
              void this.saveAndRedraw();
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

    new Setting(containerEl)
      .setName(t("setNoSelection"))
      .setDesc(t("setNoSelectionDesc"))
      .addDropdown((c) =>
        c
          .addOptions({
            note: t("setNoSelectionNote"),
            section: t("setNoSelectionSection"),
            paragraph: t("setNoSelectionParagraph"),
            none: t("setNoSelectionNone"),
          })
          .setValue(s.noSelection)
          .onChange(async (v) => {
            s.noSelection = v as AiAssistSettings["noSelection"];
            await this.save();
          }),
      );

    // Порог общий и для выделенного тоже, поэтому показывается всегда — даже
    // когда без выделения плагин не работает вовсе.
    new Setting(containerEl)
      .setName(t("setWarnOver"))
      .setDesc(t("setWarnOverDesc"))
      .addText((c) =>
        c
          .setPlaceholder("20000")
          .setValue(String(s.warnOver))
          .onChange((v) => {
            s.warnOver = Math.max(0, Math.round(Number(v) || 0));
            this.saveLater();
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

    new Setting(containerEl)
      .setName(t("setFreshAction"))
      .setDesc(t("setFreshActionDesc"))
      .addToggle((c) =>
        c.setValue(s.freshOnAction).onChange(async (v) => {
          s.freshOnAction = v;
          keepLog.settingEl.toggle(v);
          await this.save();
        }),
      );

    // Строку прячем по месту, а не перерисовкой всей вкладки: та отбросила бы
    // настройки к началу, и до тумблера, который только что нажали, пришлось бы
    // прокручиваться заново.
    const keepLog = new Setting(containerEl)
      .setName(t("setFreshKeepLog"))
      .setDesc(t("setFreshKeepLogDesc"))
      .addToggle((c) =>
        c.setValue(s.freshKeepLog).onChange(async (v) => {
          s.freshKeepLog = v;
          await this.save();
        }),
      );
    // Чистки нет — и беречь от неё нечего.
    keepLog.settingEl.toggle(s.freshOnAction);

    // Выбирать не из чего, пока настроен один провайдер, — строка стояла бы
    // с единственным пунктом и только спрашивала бы, зачем она.
    const ready = Object.entries(s.profiles)
      .filter(([, profile]) => profile.model)
      .sort(([a], [b]) => providerRank(a) - providerRank(b) || a.localeCompare(b));
    if (ready.length > 1) {
      const options: Record<string, string> = { "": t("actProviderPanel") };
      for (const [name, profile] of ready) {
        options[name] = `${providerLabel(name)} · ${profile.model}`;
      }
      // Выбранного провайдера могли с тех пор лишить модели — держим его в
      // списке, иначе выпадающий список молча вернул бы «как в панели».
      if (s.privateProvider && !options[s.privateProvider]) {
        options[s.privateProvider] = providerLabel(s.privateProvider);
      }
      new Setting(containerEl)
        .setName(t("setPrivateModel"))
        .setDesc(t("setPrivateModelDesc"))
        .addDropdown((c) =>
          c
            .addOptions(options)
            .setValue(s.privateProvider)
            .onChange(async (v) => {
              s.privateProvider = v;
              await this.save();
            }),
        );
    }

    // Заметки создаёт и кнопка «сохранить чат», и сама модель — правило на них
    // общее, поэтому стоит до раздела про инструменты, а не внутри него.
    new Setting(containerEl)
      .setName(t("setNewNote"))
      .setDesc(t("setNewNoteDesc"))
      .addDropdown((c) =>
        c
          .addOptions({
            root: t("setNewNoteRoot"),
            folder: t("setNewNoteFolder"),
            beside: t("setNewNoteBeside"),
          })
          .setValue(s.newNoteFolder)
          .onChange(async (v) => {
            s.newNoteFolder = v as NewNoteFolder;
            await this.save();
            // Поле пути нужно только одному режиму из трёх.
            this.display();
          }),
      );

    if (s.newNoteFolder === "folder") {
      new Setting(containerEl)
        .setName(t("setNewNotePath"))
        .setDesc(t("setNewNotePathDesc"))
        .addText((c) =>
          c
            .setPlaceholder("Архив/ИИ")
            .setValue(s.newNoteFolderPath)
            .onChange((v) => {
              s.newNoteFolderPath = v.trim();
              this.saveLater();
            }),
        );
    }

    // Картинку в чат приносят из буфера и мышью — и она либо остаётся в
    // хранилище, либо не переживает перезапуска. Решение об этом стоит рядом с
    // решением о новых заметках: оба про то, что плагин пишет на диск.
    new Setting(containerEl)
      .setName(t("setSaveAttach"))
      .setDesc(t("setSaveAttachDesc"))
      .addToggle((c) =>
        c.setValue(s.saveAttachments).onChange(async (v) => {
          s.saveAttachments = v;
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

    // Провайдер может не уметь инструменты вовсе — тогда включённая настройка
    // ни на что не влияет, и молчать об этом нельзя: выглядит как поломка.
    const provider = providerOf(s);
    if (s.tools && !toolsAllowed(provider)) {
      containerEl.createEl("p", {
        cls: "setting-item-description ai-setting-warn",
        text: t("setToolsNoProvider", { provider: providerLabel(provider) }),
      });
    }

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
