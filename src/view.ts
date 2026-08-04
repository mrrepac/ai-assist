import {
  App,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  Platform,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { ApiConfig, ApiError, ChatMessage, Usage, chat, listModels } from "./api";
import { DiffResult, diffWords } from "./diff";
import { contextWindow, messageText } from "./history";
import { t } from "./i18n";
import { ModelSuggestModal } from "./modals";
import { RECENT_LIMIT, grouped } from "./quickmenu";
import { ParsedCall, ToolHost, parseCall, runCall, toolSpecs } from "./tools";
import {
  ActionEntry,
  AiAssistSettings,
  HistoryItem,
  ProviderProfile,
  StoredChatMessage,
  configFor,
  isActionEntry,
  providerLabel,
  providerOf,
  providerRank,
  streamAllowed,
  switchProvider,
} from "./types";

/** Сколько раз подряд модель может ходить за инструментами в одном запросе. */
const MAX_TOOL_STEPS = 5;

/** Приписка модели к обрезанной заметке — по-английски, как и весь служебный текст. */
const CLIPPED = "[The note is longer than this — only the beginning is shown.]";

/** Реплика пользователя: не ответ модели и не запись журнала правок. */
function isAsk(item: HistoryItem): boolean {
  return !isActionEntry(item) && item.role === "user";
}

/** Знаки покрупному, для подписи на кнопке: 840, 12к, 148к. Точное — в подсказке. */
function brief(n: number): string {
  return n < 1000 ? String(n) : t("chatCtxK", { n: Math.round(n / 1000) });
}

export const VIEW_TYPE_CHAT = "ai-assist-chat";

/** То, что панели нужно от плагина, — чтобы не тянуть main.ts кольцом импортов. */
export interface ChatHost extends ToolHost {
  app: App;
  settings: AiAssistSettings;
  apiConfig(): ApiConfig;
  history: HistoryItem[];
  persistHistory(): void;
  /** Записать настройки: панель меняет модель и провайдера прямо из шапки. */
  saveSettings(): Promise<void>;
  /** То же, но отложенно: черновик вопроса меняется на каждую букву. */
  saveSettingsSoon(): void;
  /** Весь разговор в markdown — для копирования и для сохранения в заметку. */
  chatMarkdown(): string;
  /** Сложить разговор в новую заметку и открыть её. */
  saveChat(): Promise<void>;
  /** Вернуть заметку к тому, что было до правки. false — уже не получится. */
  undoAction(id: string): Promise<boolean>;
  /** Вернуть текст и прогнать по нему то же действие ещё раз, можно и другой моделью. */
  repeatAction(id: string, config?: ApiConfig): Promise<void>;
  /** Прервать идущую правку выделенного. */
  stopAction(): void;
  /** Текст активной заметки, если контекст включён; clipped — отдано началом. */
  noteContext(): { path: string; text: string; clipped: boolean } | null;
  /** Что выделено в открытой заметке прямо сейчас. */
  selectionContext(): { path: string; text: string } | null;
  /** Вставить текст в открытую заметку; false — вставлять некуда. */
  insertIntoEditor(text: string): boolean;
}

export interface SubmitOptions {
  /** Что показать в панели как реплику пользователя (по умолчанию — сам текст). */
  display?: string;
  /** Разовый системный промпт поверх общего (для действий над выделением). */
  system?: string;
  /** Не тащить в запрос предыдущие сообщения: действие само по себе. */
  fresh?: boolean;
  /**
   * Запрос пришёл из заметки, а не из панели: действие над выделенным. Такой
   * сам себе контекст — на что показали, с тем и работаем. Поэтому ни
   * инструментов правки (режим «показать в панели» уже сказал «не трогай
   * заметку»), ни текущей заметки в довесок к выделенному куску.
   */
  fromEditor?: boolean;
  /**
   * Фрагмент заметки, о котором вопрос. Не передан — берётся прикреплённое
   * выделение; null — вопрос идёт без фрагмента, чем бы ни была занята плашка.
   * Так повторный запрос уходит ровно тем же, каким был.
   */
  quote?: string | null;
  /**
   * Чем спрашивать, если не тем, что стоит в настройках. Так «ещё раз» умеет
   * позвать другую модель, не переключая на неё плагин.
   */
  config?: ApiConfig;
}

export class ChatView extends ItemView {
  private listEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private downEl!: HTMLButtonElement;
  private attachEl!: HTMLElement;
  /** Кнопка «заметку в контекст»: на ней же видно, сколько знаков уедет. */
  private ctxEl!: HTMLButtonElement;
  /** Метка приватного чата в шапке — вместо кнопки заметки, которой там нет. */
  private privateEl!: HTMLElement;
  /** Общий расход за разговор — строкой под полем ввода. */
  private totalEl!: HTMLElement;
  private controller: AbortController | null = null;
  /** Карточки журнала по id записи — чтобы обновлять их на ходу, а не рисовать заново. */
  private actionEls = new Map<string, HTMLElement>();
  /** Выделение, о котором пойдёт вопрос. Показано плашкой над полем ввода. */
  private attached: { path: string; text: string } | null = null;
  /** Снятый крестиком фрагмент: пока выделение то же, обратно не подхватываем. */
  private dismissed: string | null = null;
  /** Где стоим, листая прошлые вопросы стрелками; -1 — не листаем. */
  private askIndex = -1;

  constructor(leaf: WorkspaceLeaf, private host: ChatHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return t("chatTitle");
  }

  getIcon(): string {
    return "bot-message-square";
  }

  get busy(): boolean {
    return this.controller !== null;
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ai-assist-chat");

    const bar = root.createDiv({ cls: "ai-bar" });
    // Имя модели — кнопка: менять модель из-за одного вопроса, проходя через
    // настройки, слишком долго.
    const model = bar.createEl("button", { cls: "ai-bar-model", text: this.host.settings.model });
    model.setAttr("aria-label", t("chatPickModel"));
    model.onclick = (e) => this.openModelMenu(e);

    this.ctxEl = bar.createEl("button", { cls: "ai-bar-btn ai-bar-ctx clickable-icon" });
    this.ctxEl.onclick = () => {
      this.host.settings.chatContextNote = !this.host.settings.chatContextNote;
      this.paintReach();
      // Это настройка, а не лента: пишется в data.json. Через persistHistory
      // значение оседало только в памяти и к следующему запуску пропадало.
      void this.host.saveSettings();
    };

    // Метка приватного чата встаёт на место кнопки заметки — и не кнопкой: режим
    // выбирается, когда разговор заводят, и посреди него не переключается.
    this.privateEl = bar.createSpan({ cls: "ai-bar-private" });
    setIcon(this.privateEl, "unplug");
    this.paintReach();
    const more = bar.createEl("button", { cls: "ai-bar-btn clickable-icon" });
    setIcon(more, "ellipsis");
    more.setAttr("aria-label", t("chatMore"));
    more.onclick = (e) => this.openMoreMenu(e);

    const clear = bar.createEl("button", { cls: "ai-bar-btn clickable-icon" });
    setIcon(clear, "message-square-plus");
    clear.setAttr("aria-label", t("chatNew"));
    clear.onclick = () => this.newChat();

    // Обёртка нужна кнопке «вниз»: она держится за низ ленты, а не за низ
    // панели, иначе разросшееся поле ввода наезжало бы на неё.
    const listWrap = root.createDiv({ cls: "ai-list-wrap" });
    this.listEl = listWrap.createDiv({ cls: "ai-list" });

    // Кнопка «вниз»: во время длинного ответа лента сама за текстом не тянется,
    // если её пролистали вверх, — иначе нельзя было бы читать написанное.
    this.downEl = listWrap.createEl("button", { cls: "ai-down clickable-icon" });
    setIcon(this.downEl, "chevron-down");
    this.downEl.setAttr("aria-label", t("chatToBottom"));
    this.downEl.onclick = () => {
      this.listEl.scrollTop = this.listEl.scrollHeight;
      this.paintDown();
    };
    this.registerDomEvent(this.listEl, "scroll", () => this.paintDown());

    // Esc — привычный способ прервать: тянуться к кнопке ради этого не хочется.
    this.registerDomEvent(root, "keydown", (e) => {
      if (e.key === "Escape" && this.busy) {
        e.preventDefault();
        this.stop();
      }
    });

    const foot = root.createDiv({ cls: "ai-foot" });
    // Плашка выделения живёт над полем ввода: вопрос задают здесь, и здесь же
    // должно быть видно, о чём он.
    this.attachEl = foot.createDiv({ cls: "ai-attach" });
    this.attachEl.hide();

    // Выделили в заметке и пришли сюда — момент перехода и есть смена активного
    // листа. Плюс фокус: в панель попадают и не меняя лист. Заодно пересчитываем
    // контекст: заметка сменилась — сменился и размер того, что уедет.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.catchSelection();
        this.paintReach();
      }),
    );
    this.registerDomEvent(root, "focusin", () => this.catchSelection());
    this.catchSelection();

    this.inputEl = foot.createEl("textarea", {
      cls: "ai-input",
      attr: { rows: "2", placeholder: t("chatPlaceholder") },
    });
    // Недописанный вопрос переживает и закрытие панели, и перезапуск Obsidian:
    // мысль, которую печатали, дороже поля, которое её потеряло.
    this.inputEl.value = this.host.settings.draft;
    this.inputEl.addEventListener("keydown", (e) => {
      // На телефоне Enter — это перенос строки, отправка только кнопкой.
      if (e.key === "Enter" && !e.shiftKey && !Platform.isMobile) {
        e.preventDefault();
        void this.send();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (this.walkAsks(e.key === "ArrowUp" ? 1 : -1)) e.preventDefault();
      }
    });
    this.inputEl.addEventListener("input", () => {
      this.autoGrow();
      this.saveDraft();
    });

    this.sendBtn = foot.createEl("button", { cls: "ai-send mod-cta" });
    this.paintSendButton();
    this.sendBtn.onclick = () => {
      if (this.busy) this.stop();
      else void this.send();
    };

    // Счёт за разговор — последней строкой подвала: под каждым ответом видна
    // только его цена, а сколько набежало всего, до сих пор нигде не считалось.
    this.totalEl = foot.createDiv({ cls: "ai-total" });
    this.paintTotal();

    // Восстановленный черновик может быть в несколько строк — поле подгоняем
    // под него сразу, а не при первой букве.
    this.autoGrow();
    this.repaint();
  }

  async onClose(): Promise<void> {
    this.stop();
  }

  /** Панель могла быть открыта до правки настроек — освежаем подпись модели. */
  refreshHeader(): void {
    const model = this.contentEl.querySelector(".ai-bar-model");
    if (model) model.textContent = this.host.settings.model;
    this.paintReach();
    this.paintTotal();
  }

  /**
   * Докуда модель дотягивается — шапка целиком.
   *
   * Заметка вместе с ценой вопроса: пока на кнопке была одна иконка, включённой
   * она выглядела одинаково и для строчки, и для сценария на двенадцать тысяч
   * знаков — а уезжает он заново с каждым вопросом.
   *
   * В приватном чате кнопки нет вовсе: включать там нечего, и погашенная она
   * только предлагала бы нажать на себя. Вместо неё метка — как в приватном
   * окне браузера, чтобы видеть, где находишься, а не вспоминать.
   */
  private paintReach(): void {
    // Настройки могли записать до того, как панель успела построиться.
    if (!this.ctxEl) return;
    const priv = this.host.settings.privateChat;
    this.contentEl.toggleClass("is-private", priv);
    this.ctxEl.toggle(!priv);
    this.privateEl.toggle(priv);
    if (priv) {
      this.privateEl.setAttr("aria-label", t("chatPrivateOn"));
      return;
    }

    const on = this.host.settings.chatContextNote;
    const note = on ? this.host.noteContext() : null;
    // Ровно то, что уйдёт в запрос: у ленты свой бюджет, и старое в него не лезет.
    const talk = contextWindow(this.host.history).reduce((n, m) => n + messageText(m).length, 0);

    this.ctxEl.empty();
    this.ctxEl.toggleClass("is-active", on);
    setIcon(this.ctxEl, "file-text");
    if (note) this.ctxEl.createSpan({ cls: "ai-bar-ctx-size", text: brief(note.text.length) });
    this.ctxEl.setAttr(
      "aria-label",
      note
        ? t("chatCtxOn", { note: grouped(note.text.length), talk: grouped(talk) })
        : t("chatCtxOff", { talk: grouped(talk) }),
    );
  }

  /** Итог по всей ленте: и разговор, и правки выделенного — платят за всё. */
  private paintTotal(): void {
    if (!this.totalEl) return;
    let prompt = 0;
    let completion = 0;
    for (const item of this.host.history) {
      if (!item.usage) continue;
      prompt += item.usage.prompt;
      completion += item.usage.completion;
    }
    const show = this.host.settings.showUsage && prompt + completion > 0;
    this.totalEl.toggle(show);
    if (show) this.totalEl.setText(t("chatTotal", { prompt: grouped(prompt), completion: grouped(completion) }));
  }

  /**
   * Меню моделей: сначала то, что уже настроено по провайдерам, — один клик и
   * готово. Полный список у провайдера просить незачем, пока он не понадобился.
   */
  private openModelMenu(e: MouseEvent): void {
    const s = this.host.settings;
    const current = providerOf(s);
    const menu = new Menu();

    // Профили лежат в data.json в том порядке, в каком их когда-то завели, —
    // раскладываем по общему списку, свои адреса в конец.
    const configured = Object.entries(s.profiles)
      .filter(([, profile]) => profile.model)
      .sort(([a], [b]) => providerRank(a) - providerRank(b) || a.localeCompare(b));

    for (const [name, profile] of configured) {
      menu.addItem((item) =>
        item
          .setTitle(`${providerLabel(name)} · ${profile.model}`)
          .setChecked(name === current)
          .onClick(async () => {
            if (name === current) return;
            switchProvider(s, name);
            await this.host.saveSettings();
            new Notice(t("chatModelSwitched", { model: s.model }));
          }),
      );
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("chatOtherModel"))
        .setIcon("list")
        .onClick(() => void this.pickModel()),
    );
    menu.showAtMouseEvent(e);
  }

  /**
   * Настроенные профили в общем порядке — для меню моделей.
   * Активный провайдер идёт отдельным пунктом, поэтому его тут нет.
   */
  private otherModels(): [string, ProviderProfile][] {
    const s = this.host.settings;
    const current = providerOf(s);
    return Object.entries(s.profiles)
      .filter(([name, p]) => p.model && name !== current)
      .sort(([a], [b]) => providerRank(a) - providerRank(b) || a.localeCompare(b));
  }

  /**
   * «Ещё раз» с выбором, чем именно. Ответ модели — вещь случайная, и чаще
   * всего переспрашивают не от той же самой: дешёвая не справилась — дай
   * дорогую. Выбор разовый, плагин на другую модель не переключается, иначе
   * следующий вопрос ушёл бы туда же незаметно для спросившего.
   *
   * Когда настроена одна модель, выбирать не из чего — прогоняем сразу.
   */
  private againMenu(e: MouseEvent, run: (config?: ApiConfig) => void): void {
    const others = this.otherModels();
    if (others.length === 0) {
      run();
      return;
    }

    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("chatAgainSame", { model: this.host.settings.model }))
        .setIcon("refresh-cw")
        .onClick(() => run()),
    );
    menu.addSeparator();
    for (const [name, profile] of others) {
      const config = configFor(this.host.settings, name);
      if (!config) continue;
      menu.addItem((item) =>
        item
          .setTitle(`${providerLabel(name)} · ${profile.model}`)
          .onClick(() => run(config)),
      );
    }
    menu.showAtMouseEvent(e);
  }

  /** Список моделей текущего провайдера — тот же, что кнопкой в настройках. */
  private async pickModel(): Promise<void> {
    try {
      const models = await listModels(this.host.apiConfig());
      new ModelSuggestModal(this.host.app, models, (model) => {
        this.host.settings.model = model;
        void this.host.saveSettings();
      }).open();
    } catch (err) {
      new Notice(err instanceof ApiError ? err.message : String(err), 8000);
    }
  }

  private openMoreMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("chatCopyAll"))
        .setIcon("copy")
        .onClick(async () => {
          const md = this.host.chatMarkdown();
          if (!md) {
            new Notice(t("chatNothingToSave"));
            return;
          }
          try {
            await navigator.clipboard.writeText(md);
            new Notice(t("chatCopied"));
          } catch {
            new Notice(t("chatCopyFailed"));
          }
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("chatSave"))
        .setIcon("file-down")
        .onClick(() => void this.host.saveChat()),
    );

    // Приватный чат заводится отсюда, как приватное окно из меню браузера: своей
    // кнопки в шапке он не заслуживает — начинают его редко, а места там нет.
    // Обратная дорога и так на виду, кнопкой «Новый чат».
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("cmdPrivateChat"))
        .setIcon("unplug")
        .setChecked(this.host.settings.privateChat)
        .onClick(() => this.newChat(true)),
    );
    menu.showAtMouseEvent(e);
  }

  /** Кнопка «вниз» нужна, только если снизу действительно что-то осталось. */
  private paintDown(): void {
    const el = this.listEl;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    this.downEl.toggleClass("is-visible", away);
  }

  /**
   * Новый разговор. Приватный заводится только так — отдельной командой, а не
   * тумблером посреди беседы: это свойство самого разговора, как приватное окно
   * в браузере. Обычный «новый чат» из него же и выводит.
   */
  newChat(priv = false): void {
    this.stop();
    const wasPrivate = this.host.settings.privateChat;
    if (this.host.history.length === 0 && wasPrivate === priv) return;

    // Спрашивать перед очисткой — лишний клик на каждый новый разговор, поэтому
    // чистим сразу, но держим копию: нажатие по уведомлению возвращает ленту.
    // Терять нечего — и предлагать вернуть незачем.
    const undo = this.host.history.length > 0 ? this.snapshot() : null;
    this.host.history.length = 0;
    this.host.persistHistory();
    if (wasPrivate !== priv) {
      this.host.settings.privateChat = priv;
      void this.host.saveSettings();
      // Плашка переживает очистку ленты — за ней стоит живое выделение в
      // заметке, и после «нового чата» о том же куске часто спрашивают снова.
      // А вот смену режима переживать ей нечего: приватному чату фрагмент
      // заметки не положен вовсе.
      this.attach(null);
      this.dismissed = null;
    }
    this.repaint();
    // Смену режима видно по шапке, а вот исчезнувший разговор — нет.
    if (undo) undo(priv ? t("chatPrivateStarted") : t("chatCleared"));
    else if (priv) new Notice(t("chatPrivateStarted"));
  }

  // ——————————————————————— правка ленты ———————————————————————

  /**
   * Снимок ленты: вернуть её можно нажатием по уведомлению. Кнопки под
   * сообщениями снимают уже написанное, и без возврата каждая из них была бы
   * кнопкой «потерять разговор».
   */
  private snapshot(): (label: string) => void {
    const kept = this.host.history.slice();
    return (label) => {
      const notice = new Notice(`${label}\n${t("chatUndoClear")}`, 8000);
      notice.noticeEl.addClass("ai-undo-notice");
      notice.noticeEl.onclick = () => {
        this.host.history.length = 0;
        this.host.history.push(...kept);
        this.host.persistHistory();
        this.repaint();
        notice.hide();
      };
    };
  }

  /**
   * Убрать кусок ленты. Записи журнала правок остаются на месте: это отчёт о
   * работе над заметкой, а не часть разговора, и к снятому вопросу они
   * отношения не имеют.
   */
  private cut(from: number, to: number): void {
    const removed = this.host.history.splice(from, to - from);
    this.host.history.splice(from, 0, ...removed.filter(isActionEntry));
    this.host.persistHistory();
    this.repaint();
  }

  /** Последняя реплика разговора; записи журнала не в счёт. */
  private lastChat(): StoredChatMessage | null {
    for (let i = this.host.history.length - 1; i >= 0; i--) {
      const item = this.host.history[i];
      if (!isActionEntry(item)) return item;
    }
    return null;
  }

  /**
   * Спросить заново: ответ снимается вместе с вопросом, и вопрос уходит тем же,
   * каким был, — вплоть до системного промпта действия, если он был.
   */
  private async regenerate(msg: StoredChatMessage, config?: ApiConfig): Promise<void> {
    const history = this.host.history;
    const from = history.indexOf(msg);
    if (from === -1) return;
    // Ниже мог появиться новый разговор: снимать его ради одного ответа — не
    // то, чего ждут от кнопки.
    if (this.lastChat() !== msg) {
      new Notice(t("chatAgainLast"));
      return;
    }
    // Вопрос ищем выше ответа: между ними могли встать записи журнала правок,
    // да и сам ответ мог прийти вторым кругом инструментов.
    let at = from - 1;
    while (at >= 0 && !isAsk(history[at])) at--;
    if (at < 0) {
      new Notice(t("chatNoQuestion"));
      return;
    }

    const ask = history[at] as StoredChatMessage;
    this.cut(at, history.length);
    await this.submit(ask.resend?.text ?? ask.content, {
      display: ask.resend ? ask.content : undefined,
      system: ask.resend?.system,
      fresh: ask.resend?.fresh,
      // Запрос из действия — значит и повтор его идёт по тем же правилам.
      fromEditor: !!ask.resend,
      // Ровно тот фрагмент, о котором спрашивали: подхватывать вместо него то,
      // что выделено в заметке сейчас, — это уже другой вопрос.
      quote: ask.quote ?? null,
      config,
    });
  }

  /** Вопрос возвращается в поле ввода, а разговор — к тому месту, где он был. */
  private editAsk(msg: StoredChatMessage): void {
    const at = this.host.history.indexOf(msg);
    if (at === -1) return;
    this.stop();

    const undo = this.snapshot();
    // Сколько разговора уйдёт следом за вопросом. Записи журнала правок не в
    // счёт — они остаются в ленте.
    const tail = this.host.history.slice(at + 1).filter((item) => !isActionEntry(item)).length;
    this.cut(at, this.host.history.length);

    this.setInput(msg.resend?.text ?? msg.content);
    this.inputEl.focus();
    // Фрагмент, о котором был вопрос, возвращается на плашку вместе с ним.
    if (msg.quote) this.takeSelection(msg.quote);
    // Снялся не только сам вопрос: дальше мог быть разговор на десять реплик,
    // и молча его терять нельзя.
    if (tail > 0) undo(t("chatCutTail"));
  }

  /** Убрать реплику из разговора. Вопрос уходит вместе с ответами на него. */
  private dropMessage(msg: StoredChatMessage): void {
    const history = this.host.history;
    const at = history.indexOf(msg);
    if (at === -1) return;

    // Идущий ответ пишется в свой пузырь, а перерисованная лента этот пузырь
    // выбросит — оборвать запрос честнее, чем писать в никуда.
    this.stop();

    let end = at + 1;
    // Ответ без вопроса в ленте повисает, а в следующий запрос уезжает
    // разговором с дырой посередине.
    if (msg.role === "user") {
      while (end < history.length && !isAsk(history[end])) end++;
    }
    const undo = this.snapshot();
    this.cut(at, end);
    undo(t("chatDropped"));
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.paintSendButton();
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  /**
   * Подхватывает выделение из заметки. Само по себе оно ни к чему не обязывает:
   * плашку видно, вопрос уйдёт вместе с фрагментом, а крестик её убирает.
   */
  private catchSelection(): void {
    // В приватном чате заметки нет вовсе, а выделение в ней — та же заметка,
    // только куском. Оставшееся от прошлой работы, оно подхватилось бы само и
    // уехало вместе с первым же вопросом, которого никто об этом не просил.
    if (this.host.settings.privateChat) {
      if (this.attached) this.attach(null);
      return;
    }
    const found = this.host.selectionContext();
    // Тот же кусок, что уже на плашке или что сняли крестиком, — не трогаем:
    // событий тут много, а перерисовка на каждое давала бы мельтешение.
    if (found && (found.text === this.attached?.text || found.text === this.dismissed)) return;
    if (!found && this.attached === null) return;
    // Выделение снялось (щёлкнули в заметке) — но если пользователь уже начал
    // печатать вопрос, отнимать у него фрагмент нельзя.
    if (!found && this.inputEl?.value.trim()) return;
    this.dismissed = null;
    this.attach(found);
  }

  /** Взять выделение в чат по команде — даже если плашку до этого снимали. */
  takeSelection(text?: string): void {
    // Даже прямая просьба не отменяет приватности: молча отправить кусок заметки
    // оттуда, где заметки нет, было бы обманом. Говорим вслух — и не отправляем.
    if (this.host.settings.privateChat) {
      new Notice(t("chatPrivateNoQuote"));
      return;
    }
    this.dismissed = null;
    const path = this.host.targetPath() ?? "";
    this.attach(text ? { path, text } : this.host.selectionContext());
  }

  private attach(found: { path: string; text: string } | null): void {
    this.attached = found;
    this.attachEl.empty();
    if (!found) {
      this.attachEl.hide();
      return;
    }
    this.attachEl.show();

    setIcon(this.attachEl.createSpan({ cls: "ai-attach-icon" }), "text-quote");
    const preview = found.text.replace(/\s+/g, " ").trim();
    this.attachEl.createSpan({
      cls: "ai-attach-text",
      text: preview.length > 120 ? preview.slice(0, 119) + "…" : preview,
    });
    this.attachEl.createSpan({
      cls: "ai-attach-size",
      text: t("chatAttachSize", { chars: found.text.length }),
    });

    const drop = this.attachEl.createEl("button", { cls: "ai-attach-drop clickable-icon" });
    setIcon(drop, "x");
    drop.setAttr("aria-label", t("chatAttachDrop"));
    drop.onclick = () => {
      this.dismissed = found.text;
      this.attach(null);
    };
  }

  private autoGrow(): void {
    // Сначала отпускаем высоту, иначе scrollHeight покажет прежнюю, а не нужную.
    this.inputEl.setCssStyles({ height: "auto" });
    this.inputEl.setCssStyles({ height: Math.min(this.inputEl.scrollHeight, 200) + "px" });
  }

  private saveDraft(): void {
    this.host.settings.draft = this.inputEl.value;
    this.host.saveSettingsSoon();
  }

  /** Положить текст в поле: вместе с высотой, курсором в конце и черновиком. */
  private setInput(text: string): void {
    this.inputEl.value = text;
    this.autoGrow();
    this.inputEl.setSelectionRange(text.length, text.length);
    this.saveDraft();
  }

  /**
   * Стрелки листают прошлые вопросы — те же, что в быстром меню, только свои.
   * Возвращает true, если стрелку забрали себе: пока в поле начатый текст, она
   * должна двигать курсор, а не подменять написанное.
   */
  private walkAsks(dir: 1 | -1): boolean {
    const recent = this.host.settings.recentAsks;
    if (!recent.length) return false;
    // Листаем с пустого поля или пока в нём стоит нетронутый прошлый вопрос:
    // стоило его поправить — и поле снова принадлежит пользователю.
    const walking = this.askIndex >= 0 && this.inputEl.value === recent[this.askIndex];
    if (!walking && this.inputEl.value) return false;

    const next = Math.min(Math.max(this.askIndex + dir, -1), recent.length - 1);
    if (next === this.askIndex) return false;
    this.askIndex = next;
    this.setInput(next === -1 ? "" : recent[next]);
    return true;
  }

  /** Отправленный вопрос — в список для стрелок, свежий первым. */
  private rememberAsk(text: string): void {
    const s = this.host.settings;
    s.recentAsks = [text, ...s.recentAsks.filter((p) => p !== text)].slice(0, RECENT_LIMIT);
    this.askIndex = -1;
  }

  private paintSendButton(): void {
    this.sendBtn.empty();
    setIcon(this.sendBtn, this.busy ? "square" : "send-horizontal");
    this.sendBtn.setAttr("aria-label", this.busy ? t("chatStop") : t("chatSend"));
    this.sendBtn.toggleClass("is-stop", this.busy);
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.rememberAsk(text);
    this.inputEl.value = "";
    this.autoGrow();
    this.saveDraft();
    await this.submit(text);
  }

  /** Отправить запрос и показать ответ. Точка входа и для действий из редактора. */
  async submit(text: string, opts: SubmitOptions = {}): Promise<void> {
    if (this.busy) this.stop();

    // С какого места история принадлежит этому заходу: по нему кнопка «Ещё раз»
    // отматывает всё сказанное, включая круги инструментов.
    const startAt = this.host.history.length;
    // Чем спрашиваем. Обычно тем, что в настройках, но «ещё раз» умеет позвать
    // другую модель на один запрос — и подпись под ответом должна сойтись с ней,
    // а не с той, что осталась в шапке.
    const cfg = opts.config ?? this.host.apiConfig();
    // Прикреплённое выделение уходит с вопросом и тут же снимается: следующий
    // вопрос — уже про своё, если не выделить заново. Явный null в опциях
    // означает «без фрагмента» и плашку не смотрит вовсе. Приватный чат не
    // отправляет фрагмент ни при каких условиях — последняя застава на пути
    // всего, что могло уцелеть от прошлого разговора.
    const asked = opts.quote === undefined ? this.attached?.text : opts.quote;
    const quote = (this.host.settings.privateChat ? null : asked) ?? undefined;
    this.attach(null);
    // Про этот кусок уже спросили, и он остался в ленте. Выделение в заметке
    // никуда не делось — без этого плашка тут же вернулась бы, и фрагмент уехал
    // бы вторым разом за те же деньги.
    if (quote) this.dismissed = quote;

    // Реплику держим объектом: по нему кнопки под сообщением находят своё место
    // в ленте, как бы она ни менялась под ними.
    const ask: StoredChatMessage = {
      role: "user",
      content: opts.display ?? text,
      quote,
      // Показано не то, что уходит в запрос, — запоминаем настоящий вопрос
      // вместе с его системным промптом, иначе «спросить заново» отправит
      // подпись действия.
      resend:
        opts.display || opts.system || opts.fresh
          ? { text, system: opts.system, fresh: opts.fresh }
          : undefined,
    };
    this.host.history.push(ask);
    const userEl = this.addMessage("user", ask.content, quote, ask);
    userEl.scrollIntoView({ block: "end" });

    const messages: ChatMessage[] = [];
    // Без объяснения, где она находится, модель на просьбу «вставь в заметку»
    // отвечает лекцией о том, что у неё нет доступа к хранилищу. Умеет ли модель
    // инструменты, заранее не знает никто — это выясняется отказом провайдера,
    // и на такой отказ ApiError отвечает подсказкой.
    // Действие, запущенное из заметки в режиме «показать в панели», — это
    // просьба ответить, а не править. С инструментами «перескажи главу»
    // кончалось тем, что модель сама клала пересказ на место главы.
    // Приватный чат: модель не знает ни про Obsidian, ни про заметку — разговор
    // как в веб-чате провайдера. На действие из заметки не распространяется:
    // оно само про неё, и выключать там нечего.
    const priv = this.host.settings.privateChat && !opts.fromEditor;
    const canUseTools = this.host.settings.tools && !opts.fromEditor && !priv;
    const hint = canUseTools ? t("chatSystemHintTools") : t("chatSystemHint");

    // «Отправлять заметку как контекст» — это про разговор в панели. Действие
    // над выделенным уже сказало, над чем работать, и заметка сверху — лишние
    // деньги и лишняя путаница: модель видит один и тот же текст дважды.
    const note = opts.fromEditor || priv ? null : this.host.noteContext();

    // Видит ли модель заметку — половина того, что ей надо знать про инструменты.
    // Без этой оговорки она лезет читать заметку на любой вопрос, даже когда он
    // вовсе не про неё, а когда заметка уже приложена — читает её вторым разом,
    // целым кругом запроса за те же деньги.
    const reach = canUseTools ? (note ? t("chatToolsNoteHere") : t("chatToolsNoteHidden")) : "";
    // В приватном чате не уходит ничего своего — ни объяснений про панель, ни
    // общего промпта из настроек. Остаётся только промпт действия, но его в
    // этом режиме и не бывает.
    const own = priv ? [] : [hint, reach, this.host.settings.systemPrompt.trim()];
    const system = [...own, opts.system?.trim()].filter(Boolean).join("\n\n");
    if (system) messages.push({ role: "system", content: system });

    if (note) {
      messages.push({
        role: "system",
        content: `Note "${note.path}":\n\n${note.text}` + (note.clipped ? "\n\n" + CLIPPED : ""),
      });
      // Ответ по началу длинной заметки выглядит точно так же, как ответ по всей,
      // — про обрезку надо сказать вслух, иначе о ней никто не узнает.
      if (note.clipped) {
        this.listEl.createDiv({ cls: "ai-notice", text: t("chatContextClipped") });
      }
    }

    if (!opts.fresh) {
      // История без последней реплики — её кладём отдельно, уже настоящим текстом.
      for (const m of contextWindow(this.host.history.slice(0, -1))) {
        messages.push({ role: m.role, content: messageText(m) });
      }
    }
    messages.push({ role: "user", content: messageText({ role: "user", content: text, quote }) });

    // Локальная ссылка: stop() обнуляет this.controller, а в catch ещё нужно
    // знать, оборвали запрос или он упал сам.
    const controller = new AbortController();
    this.controller = controller;
    this.paintSendButton();

    let bubble = this.addMessage("assistant", "");
    let body = bubble.querySelector(".ai-msg-body") as HTMLElement;
    let answer = "";
    let reasoning = "";
    /** Круги кончились, а модель всё ещё правила — работа осталась недоделанной. */
    let unfinished = false;

    try {
      // Модель может ответить не текстом, а просьбой вызвать инструмент —
      // тогда выполняем его и идём на следующий круг с результатом.
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        if (step > 0) {
          bubble = this.addMessage("assistant", "");
          body = bubble.querySelector(".ai-msg-body") as HTMLElement;
          answer = "";
          reasoning = "";
        }
        body.addClass("ai-streaming");
        body.setText(t("chatWaiting"));

        let reasoningEl: HTMLElement | null = null;
        let first = true;

        const result = await chat(cfg, messages, {
          stream: this.host.settings.stream && streamAllowed(providerOf(cfg)),
          signal: controller.signal,
          wantUsage: this.host.settings.showUsage,
          tools: canUseTools ? toolSpecs() : undefined,
          onReasoning: (chunk) => {
            reasoning += chunk;
            if (!reasoningEl) reasoningEl = this.addReasoningBlock(bubble);
            const pre = reasoningEl.querySelector(".ai-think-body") as HTMLElement;
            pre.appendText(chunk);
            this.followBottom();
          },
          onDelta: (chunk) => {
            if (first) {
              body.empty();
              first = false;
            }
            answer += chunk;
            body.appendText(chunk);
            this.followBottom();
          },
        });

        answer = result.text || answer;
        reasoning = result.reasoning || reasoning;
        body.removeClass("ai-streaming");

        // На потоке остановка приходит не ошибкой, а обычным возвратом с тем,
        // что успело прийти: без этой проверки оборванный ответ шёл дальше как
        // целый — в ленту, а с ним и на следующий круг инструментов.
        if (controller.signal.aborted) {
          await this.keepPartial(bubble, body, answer, reasoning, controller, ask, cfg.model);
          new Notice(t("aborted"));
          return;
        }

        // Ответа нет, а размышления есть — значит ответ в них и лежит. Рассуждающие
        // модели то и дело упираются в предел длины сразу после размышлений, а часть
        // провайдеров и вовсе не делит поля и шлёт весь текст размышлениями. Сказать
        // тут «пустой ответ» и выбросить написанное — худшее из возможного: за эти
        // токены заплачено, ответ в них обычно уже есть, а после перезагрузки панели
        // от запроса не осталось бы и следа.
        //
        // Но только когда модель и правда договорила. Пошла за инструментом — текста
        // и не должно быть, а в размышлениях там «сейчас прочитаю заметку»: в ленте
        // это мусор, а в истории — реплика, которая уедет в следующий запрос.
        if (!answer.trim() && reasoning.trim() && result.toolCalls.length === 0) {
          answer = reasoning;
          reasoning = "";
          // Иначе один и тот же текст встанет дважды: и свёрнутым блоком, и ответом.
          bubble.querySelector(".ai-think")?.remove();
          this.listEl.createDiv({ cls: "ai-notice", text: t("chatOnlyReasoning") });
        }

        if (answer.trim()) {
          const reply: StoredChatMessage = {
            role: "assistant",
            content: answer,
            reasoning,
            usage: result.usage ?? undefined,
            model: cfg.model,
          };
          this.host.history.push(reply);
          await this.renderMarkdown(answer, body);
          this.addFooter(bubble, answer, result.usage, reply);
        } else if (result.toolCalls.length === 0) {
          body.setText(t("emptyReply"));
        } else {
          bubble.remove(); // текста не было, дальше идут карточки правок
        }
        // Ответ оборван на пределе длины модели. В чате это не всегда видно, а
        // следующий вопрос уедет вместе с огрызком и продолжится от него.
        if (result.truncated) {
          this.listEl.createDiv({ cls: "ai-notice", text: t("chatCutOff") });
        }
        this.followBottom();

        if (result.toolCalls.length === 0) break;

        messages.push({
          role: "assistant",
          content: answer,
          tool_calls: result.toolCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: c.arguments },
          })),
        });

        for (const call of result.toolCalls) {
          const parsed = parseCall(call, this.host.targetPath());
          const outcome = await this.performCall(parsed, controller.signal);
          messages.push({ role: "tool", tool_call_id: call.id, content: outcome });
        }
        if (controller.signal.aborted) break;
        // Следующего круга не будет: правки применены, а сказать «готово» модели
        // уже негде — без объяснения это выглядит как оборвавшийся на полуслове
        // разговор.
        unfinished = step === MAX_TOOL_STEPS - 1;
      }
      if (unfinished) {
        this.listEl.createDiv({
          cls: "ai-notice",
          text: t("chatToolLimit", { steps: MAX_TOOL_STEPS }),
        });
        this.followBottom();
      }
      this.host.persistHistory();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      body.removeClass("ai-streaming");
      if (err.aborted || controller.signal.aborted) {
        await this.keepPartial(bubble, body, answer, reasoning, controller, ask, cfg.model);
        new Notice(t("aborted"));
      } else {
        body.empty();
        body.addClass("ai-error");
        body.setText(err.message);
        const retry = body.createEl("button", { cls: "ai-retry", text: t("chatRetry") });
        retry.onclick = () => {
          // Ошибка могла случиться и на втором круге инструментов — тогда сверху
          // лежит не вопрос, а ответ или след правки. Снимаем весь заход целиком
          // и перерисовываем ленту, чтобы она сошлась с историей.
          const tail = this.host.history.splice(startAt);
          // Правка выделенного могла идти своим чередом — к этому запросу она
          // отношения не имеет, и её запись остаётся в ленте.
          this.host.history.push(...tail.filter(isActionEntry));
          this.host.persistHistory();
          this.repaint();
          void this.submit(text, opts);
        };
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.paintSendButton();
      // Лента подросла: и в контекст следующего вопроса влезет уже другое, и
      // счёт за разговор стал больше.
      this.paintReach();
      this.paintTotal();
    }
  }

  /**
   * Хвост оборванного ответа: то, что успело прийти, остаётся на экране —
   * половину ответа тоже копируют и вставляют.
   *
   * А вот в ленту он идёт, только если этот заход всё ещё её хозяин. Прервать
   * могли и новым вопросом, и очисткой чата, и снятием самого вопроса: ответ,
   * дописанный в конец после любого из них, встал бы посреди чужого разговора
   * — и в ленте, и в контексте следующего запроса.
   */
  private async keepPartial(
    bubble: HTMLElement,
    body: HTMLElement,
    answer: string,
    reasoning: string,
    controller: AbortController,
    ask: StoredChatMessage,
    model: string,
  ): Promise<void> {
    if (!answer.trim()) {
      bubble.remove();
      return;
    }
    await this.renderMarkdown(answer, body);

    let reply: StoredChatMessage | undefined;
    const current = this.controller === null || this.controller === controller;
    if (current && this.host.history.includes(ask)) {
      reply = { role: "assistant", content: answer, reasoning, model };
      this.host.history.push(reply);
      this.host.persistHistory();
    }
    this.addFooter(bubble, answer, null, reply);
    // Оборвать могли и правкой ленты — тогда пузырь, в который писался ответ,
    // остался вне документа, и увидеть ответ можно только заново.
    if (!bubble.isConnected) this.repaint();
  }

  /**
   * Показывает предложенную правку и, если включено подтверждение, ждёт кнопку.
   * Возвращает текст результата — его увидит модель следующим сообщением.
   */
  private async performCall(parsed: ParsedCall, signal: AbortSignal): Promise<string> {
    const card = this.addToolCard(parsed);
    const status = card.querySelector(".ai-tool-status") as HTMLElement;
    const buttons = card.querySelector(".ai-tool-buttons") as HTMLElement;

    // Чтение заметки ничего не меняет — спрашивать не о чем.
    if (parsed.writes && this.host.settings.toolsConfirm) {
      const approved = await this.waitForDecision(buttons, signal);
      if (!approved) {
        buttons.remove();
        status.setText(t("toolRejected"));
        card.addClass("is-rejected");
        return "The user declined this edit. Do not repeat it — ask what to change instead.";
      }
    }
    buttons.remove();

    const outcome = await runCall(this.host, parsed);
    // Правка запросто не проходит: фрагмент не нашёлся, заметку закрыли, модель
    // назвала несуществующий инструмент. Показывать это «применено» — врать в
    // обе стороны: и пользователю на карточке, и модели следом, записью о
    // сделанной работе, которой не было.
    if (outcome.ok) {
      // Чтение нечего применять — и зелёной отметки «сделано» оно не заслуживает:
      // заметка от него не изменилась.
      status.setText(parsed.writes ? t("toolApplied") : t("toolReadDone"));
      if (parsed.writes) {
        card.addClass("is-applied");
        // В историю кладём след правки: иначе после перезагрузки панели в диалоге
        // будет провал — вопрос есть, а что было сделано, непонятно.
        this.host.history.push({
          role: "assistant",
          content: t("toolDone", { title: parsed.title }),
        });
      }
    } else {
      status.setText(t("toolNotApplied"));
      card.addClass("is-failed");
    }
    this.followBottom();
    return outcome.text;
  }

  private waitForDecision(buttons: HTMLElement, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (value: boolean) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => finish(false);
      signal.addEventListener("abort", onAbort);

      const apply = buttons.createEl("button", { cls: "mod-cta", text: t("toolApply") });
      apply.onclick = () => finish(true);
      const reject = buttons.createEl("button", { text: t("toolReject") });
      reject.onclick = () => finish(false);
      // Фокус кнопке «Применить» не даём. Карточка появляется сама, посреди
      // чтения ответа, и Enter в этот момент — что угодно, только не согласие
      // переписать заметку: его только что нажали, отправляя вопрос.
      this.followBottom();
    });
  }

  private addToolCard(parsed: ParsedCall): HTMLElement {
    this.listEl.querySelector(".ai-empty")?.remove();
    const card = this.listEl.createDiv({ cls: "ai-tool" });

    const head = card.createDiv({ cls: "ai-tool-head" });
    setIcon(head.createSpan({ cls: "ai-tool-icon" }), parsed.writes ? "file-pen-line" : "book-open");
    head.createSpan({ cls: "ai-tool-title", text: parsed.title });
    head.createSpan({ cls: "ai-tool-status" });

    // Подтверждать «вставить текст», не видя, в какую заметку, — это
    // подтверждать вслепую.
    if (parsed.path) card.createDiv({ cls: "ai-tool-path", text: parsed.path });

    // Переписывание всей заметки нельзя подтверждать по стене текста — вместо
    // неё показываем, что именно изменится. Для остальных инструментов превью
    // и есть то, что будет написано.
    const before = parsed.name === "replace_note" && parsed.path ? this.host.noteText(parsed.path) : null;
    const diff = before !== null ? diffWords(before, parsed.preview) : null;
    if (diff) {
      this.renderChanges(card, diff);
    } else if (parsed.preview.trim()) {
      card.createDiv({ cls: "ai-tool-preview", text: parsed.preview });
    }
    card.createDiv({ cls: "ai-tool-buttons" });
    return card;
  }

  /**
   * Правки в потоке текста: убранное зачёркнуто, добавленное подсвечено,
   * между далеко разнесёнными правками — многоточие. Один и тот же вид в
   * журнале правок и на карточке подтверждения.
   */
  private renderChanges(parent: HTMLElement, diff: DiffResult): void {
    if (diff.segments.length) {
      const body = parent.createDiv({ cls: "ai-diff" });
      for (const s of diff.segments) {
        switch (s.kind) {
          case "same":
            body.createSpan({ cls: "ai-diff-same", text: s.text });
            break;
          case "del":
            body.createEl("del", { cls: "ai-diff-del", text: s.text });
            break;
          case "ins":
            body.createEl("ins", { cls: "ai-diff-ins", text: s.text });
            break;
          default:
            body.createSpan({ cls: "ai-diff-gap", text: " … " });
        }
      }
    }
    if (diff.tooMany) {
      parent.createDiv({
        cls: "ai-log-more",
        text: t("logMore", { added: diff.added, removed: diff.removed }),
      });
    }
  }

  /** Перерисовать всю историю: при открытии панели и после очистки. */
  private repaint(): void {
    this.listEl.empty();
    this.actionEls.clear();
    // Считаем до выхода по пустой ленте: очистка чата обнуляет и счёт за него.
    this.paintReach();
    this.paintTotal();
    if (this.host.history.length === 0) {
      this.listEl.createDiv({
        cls: "ai-empty",
        text: this.host.settings.privateChat ? t("chatEmptyPrivate") : t("chatEmpty"),
      });
      return;
    }
    for (const m of this.host.history) {
      if (isActionEntry(m)) {
        this.renderAction(m);
        continue;
      }
      const el = this.addMessage(m.role, "", m.quote, m);
      const body = el.querySelector(".ai-msg-body") as HTMLElement;
      if (m.role === "assistant") {
        if (m.reasoning) {
          const block = this.addReasoningBlock(el);
          (block.querySelector(".ai-think-body") as HTMLElement).setText(m.reasoning);
        }
        void this.renderMarkdown(m.content, body);
        this.addFooter(el, m.content, m.usage ?? null, m);
      } else {
        body.setText(m.content);
      }
    }
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  /**
   * Рисует (или перерисовывает) запись журнала правок. Панель могла быть
   * закрыта в момент правки — тогда карточка появится при следующем открытии
   * из истории, поэтому источником правды остаётся сама запись.
   */
  renderAction(entry: ActionEntry): void {
    this.listEl.querySelector(".ai-empty")?.remove();
    const existing = this.actionEls.get(entry.id);
    const card = existing ?? this.listEl.createDiv({ cls: "ai-log" });
    this.actionEls.set(entry.id, card);
    card.empty();
    card.toggleClass("is-running", entry.status === "running");
    card.toggleClass("is-error", entry.status === "error");
    card.toggleClass("is-undone", entry.undone === true);

    const head = card.createDiv({ cls: "ai-log-head" });
    setIcon(head.createSpan({ cls: "ai-log-icon" }), entry.status === "running" ? "loader" : "wand-sparkles");
    head.createSpan({ cls: "ai-log-title", text: entry.action });
    head.createSpan({ cls: "ai-log-status", text: this.statusLabel(entry) });

    if (entry.status === "running") {
      const stop = head.createEl("button", { cls: "ai-log-stop", text: t("chatStop") });
      stop.onclick = () => this.host.stopAction();
      if (entry.content) card.createDiv({ cls: "ai-log-text", text: entry.content });
      this.followBottom();
      return;
    }

    if (entry.status === "error") {
      card.createDiv({ cls: "ai-log-error", text: entry.error ?? "" });
      // Ответ, который не удалось применить, всё равно показываем: за него уже
      // заплачено, и его можно забрать руками.
      if (entry.content) card.createDiv({ cls: "ai-log-text", text: entry.content });
      return;
    }

    if (entry.segments?.length || entry.tooMany) {
      this.renderChanges(card, {
        segments: entry.segments ?? [],
        tooMany: entry.tooMany ?? false,
        added: entry.added ?? 0,
        removed: entry.removed ?? 0,
      });
    } else if (entry.content) {
      card.createDiv({ cls: "ai-log-text", text: entry.content });
    }

    const foot = card.createDiv({ cls: "ai-log-foot" });
    if (entry.status === "done" && !entry.undone) {
      const undo = foot.createEl("button", { cls: "ai-log-undo", text: t("logUndo") });
      undo.onclick = async () => {
        if (await this.host.undoAction(entry.id)) {
          entry.undone = true;
          this.host.persistHistory();
          this.renderAction(entry);
        } else {
          new Notice(t("logUndoFail"));
        }
      };

      // Ответ модели — вещь случайная: то же действие по тому же тексту может
      // выйти лучше — а другой моделью тем более. Карточку помечает отменённой
      // сама правка, новая ляжет отдельной записью ниже.
      const again = foot.createEl("button", { cls: "ai-log-undo", text: t("logRepeat") });
      again.onclick = (e) =>
        this.againMenu(e, (config) => void this.host.repeatAction(entry.id, config));
    }
    // Чем правили: обычно моделью из настроек, но «переделать» могло позвать
    // другую — иначе не понять, чем вышло лучше.
    if (entry.model) foot.createSpan({ cls: "ai-log-model", text: entry.model });
    if (entry.usage && this.host.settings.showUsage) {
      foot.createSpan({
        cls: "ai-log-usage",
        text: t("chatUsage", { prompt: entry.usage.prompt, completion: entry.usage.completion }),
      });
    }
    this.followBottom();
  }

  private statusLabel(entry: ActionEntry): string {
    if (entry.undone) return t("logUndone");
    switch (entry.status) {
      case "running":
        return t("logRunning");
      case "unchanged":
        return t("logNothing");
      case "stopped":
        return t("aborted");
      case "error":
        return t("logFailed");
      default:
        return t("logDone");
    }
  }

  private addMessage(
    role: "user" | "assistant",
    text: string,
    quote?: string,
    msg?: StoredChatMessage,
  ): HTMLElement {
    this.listEl.querySelector(".ai-empty")?.remove();
    // «Спросить заново» живёт только на последнем ответе: на прежнем эта кнопка
    // означала бы «снять полразговора», а выглядит она как «переспросить».
    this.listEl.findAll(".ai-msg-again").forEach((b) => b.remove());
    const el = this.listEl.createDiv({ cls: `ai-msg ai-msg-${role}` });
    el.createDiv({ cls: "ai-msg-role", text: role === "user" ? t("chatYou") : t("chatModel") });
    // Фрагмент, о котором спрашивали, — сворачиваемой цитатой: он бывает длиннее
    // самого вопроса, и разворачивают его редко.
    if (quote) {
      const details = el.createEl("details", { cls: "ai-msg-quote" });
      details.createEl("summary", { text: t("chatAttached", { chars: quote.length }) });
      details.createDiv({ cls: "ai-msg-quote-body", text: quote });
    }
    const body = el.createDiv({ cls: "ai-msg-body" });
    if (text) body.setText(text);
    // У ответа кнопки в общем подвале, а у вопроса свой: он и рисуется сразу,
    // и ждать в нём нечего.
    if (msg && role === "user") this.askFooter(el, msg);
    return el;
  }

  /**
   * Кнопки под своим вопросом: переписать его и убрать из разговора. Нужны они
   * реже, чем «скопировать» под ответом, поэтому и держатся в тени.
   */
  private askFooter(el: HTMLElement, msg: StoredChatMessage): void {
    const foot = el.createDiv({ cls: "ai-msg-foot ai-msg-foot-ask" });

    const edit = foot.createEl("button", { cls: "ai-msg-btn clickable-icon" });
    setIcon(edit, "pencil");
    edit.setAttr("aria-label", t("chatEditAsk"));
    edit.onclick = () => this.editAsk(msg);

    this.dropButton(foot, msg);
  }

  private dropButton(foot: HTMLElement, msg: StoredChatMessage): void {
    const drop = foot.createEl("button", { cls: "ai-msg-btn clickable-icon" });
    setIcon(drop, "trash-2");
    drop.setAttr("aria-label", t("chatDrop"));
    drop.onclick = () => this.dropMessage(msg);
  }

  private addReasoningBlock(bubble: HTMLElement): HTMLElement {
    const details = bubble.createEl("details", { cls: "ai-think" });
    details.createEl("summary", { text: t("chatThinking") });
    details.createDiv({ cls: "ai-think-body" });
    // Размышления идут перед ответом, а .ai-msg-body уже создан — ставим выше.
    const body = bubble.querySelector(".ai-msg-body");
    if (body) bubble.insertBefore(details, body);
    return details;
  }

  private addFooter(
    bubble: HTMLElement,
    text: string,
    usage: Usage | null,
    msg?: StoredChatMessage,
  ): void {
    bubble.querySelector(".ai-msg-foot")?.remove();
    const foot = bubble.createDiv({ cls: "ai-msg-foot" });

    const copy = foot.createEl("button", { cls: "ai-msg-btn clickable-icon" });
    setIcon(copy, "copy");
    copy.setAttr("aria-label", t("chatCopy"));
    copy.onclick = async () => {
      await navigator.clipboard.writeText(text);
      new Notice(t("chatCopied"));
    };

    // Кнопка с подписью, а не иконка: модель то и дело пишет «вставь сам», и
    // путь к вставке должен быть виден без наведения и догадок.
    const insert = foot.createEl("button", { cls: "ai-msg-insert" });
    setIcon(insert.createSpan({ cls: "ai-msg-insert-icon" }), "between-horizontal-end");
    insert.createSpan({ text: t("chatInsert") });
    insert.onclick = () => {
      new Notice(this.host.insertIntoEditor(text) ? t("chatInserted") : t("chatNoEditor"));
    };

    // Оборванный ответ в ленту не попадает — переспрашивать и убирать нечего.
    if (msg) {
      const again = foot.createEl("button", { cls: "ai-msg-btn ai-msg-again clickable-icon" });
      setIcon(again, "refresh-cw");
      again.setAttr("aria-label", t("chatAgain"));
      again.onclick = (e) => this.againMenu(e, (config) => void this.regenerate(msg, config));

      this.dropButton(foot, msg);
    }

    // Чей это ответ. Модель меняется прямо из шапки панели, и без подписи в
    // одной ленте лежат ответы разных моделей, неотличимые друг от друга.
    if (msg?.model) foot.createSpan({ cls: "ai-msg-model", text: msg.model });

    if (usage && this.host.settings.showUsage) {
      const text =
        t("chatUsage", { prompt: usage.prompt, completion: usage.completion }) +
        (usage.cached ? t("chatCached", { cached: usage.cached }) : "");
      foot.createSpan({ cls: "ai-msg-usage", text });
    }
  }

  private async renderMarkdown(md: string, el: HTMLElement): Promise<void> {
    el.empty();
    const path = this.host.app.workspace.getActiveFile()?.path ?? "";
    await MarkdownRenderer.render(this.host.app, md, el, path, this);
  }

  /** Тянуться за текстом, только если пользователь и так внизу списка. */
  private followBottom(): void {
    const el = this.listEl;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
    // Лента растёт без прокрутки, событие scroll при этом не приходит — кнопку
    // «вниз» пересчитываем здесь же.
    this.paintDown();
  }
}
