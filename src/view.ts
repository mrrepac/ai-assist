import {
  App,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { ApiConfig, ApiError, ChatMessage, Source, Usage, addUsage, chat } from "./api";
import {
  AttachmentStore,
  attachmentData,
  attachmentText,
  attachmentUrl,
  embeddedFiles,
  humanSize,
  isAttachablePath,
  mimeOf,
  newId,
  pastedName,
  prepareImage,
  saveToVault,
  stamp,
  vaultBlob,
} from "./attach";
import { stripCitations } from "./cite";
import { DiffResult, diffWords } from "./diff";
import {
  AttachedDoc,
  afterFresh,
  clipNote,
  contextWindow,
  dropTalk,
  mergeRestored,
  messageContent,
  messageText,
} from "./history";
import { isPdfPath, pdfText } from "./pdf";
import { t } from "./i18n";
import { ImageSuggestModal, ModelSuggestModal } from "./modals";
import { RECENT_LIMIT, grouped } from "./quickmenu";
import { ParsedCall, ToolHost, parseCall, runCall, toolSpecs } from "./tools";
import {
  ActionEntry,
  AiAssistSettings,
  Attachment,
  HistoryItem,
  ProviderProfile,
  StoredChatMessage,
  configFor,
  imagesAllowed,
  isActionEntry,
  isDoc,
  modelsFor,
  providerLabel,
  providerOf,
  providerRank,
  streamAllowed,
  switchProvider,
  toolsAllowed,
} from "./types";

/** Сколько раз подряд модель может ходить за инструментами в одном запросе. */
const MAX_TOOL_STEPS = 5;

/**
 * Сколько картинок уходит за один вопрос. Предел не от жадности провайдера, а
 * от цены: каждая картинка — это заметная доля запроса, и десяток разом
 * приложить можно только по недосмотру.
 */
const MAX_FILES = 4;

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
  /** Чем отвечает панель сейчас: у приватного чата может быть своя модель. */
  chatConfig(): ApiConfig;
  history: HistoryItem[];
  /**
   * Картинки, у которых нет пути в хранилище. Живут в плагине, а не в панели:
   * панель закрывают и открывают, а приложенная картинка от этого пропадать не
   * должна.
   */
  attachments: AttachmentStore;
  /**
   * Что приложено к следующему вопросу. Здесь по той же причине, что и сами
   * данные: панель закрывают и открывают — и вьюха при этом создаётся заново,
   * — а список приложенного должен пережить это вместе с картинками, иначе
   * хранить их было незачем.
   */
  files: Attachment[];
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
  /** Дописать правку, оборванную на пределе длины, и применить целиком. */
  continueAction(id: string): Promise<void>;
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
   * Картинки, приложенные к вопросу. Не передано — берутся те, что лежат на
   * плашке; null — вопрос идёт без картинок. Так повтор уходит с тем же
   * вложением, что и в первый раз, а не с тем, что успели приложить после.
   */
  files?: Attachment[] | null;
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
  /**
   * Пузырь, в котором нарисован ответ. Нужен, чтобы дописать оборванный ответ
   * в него же, а не отдельной репликой. Ключом сама реплика: считать пузыри по
   * месту в ленте нельзя — её правят кнопками под сообщениями, и номер
   * разъезжается с разметкой. Слабая карта — снятые реплики не должны держаться
   * в памяти до перезапуска.
   */
  private msgEls = new WeakMap<StoredChatMessage, HTMLElement>();
  /** Выделение, о котором пойдёт вопрос. Показано плашкой над полем ввода. */
  private attached: { path: string; text: string } | null = null;
  /** Снятый крестиком фрагмент: пока выделение то же, обратно не подхватываем. */
  private dismissed: string | null = null;
  /** Где стоим, листая прошлые вопросы стрелками; -1 — не листаем. */
  private askIndex = -1;

  constructor(leaf: WorkspaceLeaf, private host: ChatHost) {
    super(leaf);
  }

  /**
   * Картинки и документы, приложенные к следующему вопросу. Хранятся у плагина,
   * а не здесь: вьюха умирает вместе с закрытой вкладкой панели, и приложенное
   * пропадало бы вместе с ней — при том, что сами данные плагин бережно держит.
   */
  private get files(): Attachment[] {
    return this.host.files;
  }

  private set files(list: Attachment[]) {
    this.host.files = list;
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
    // Не `settings.model`, а то, чем панель ответит: у приватного чата модель
    // может быть своя, и шапка обязана называть именно её.
    const model = bar.createEl("button", { cls: "ai-bar-model", text: this.host.chatConfig().model });
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

    // Скрепка — это label с input внутри, а не кнопка: диалог выбора файла из
    // кода не открывается, пока в Obsidian не открыта ни одна заметка, — а чат
    // как раз тогда и открывают. Настоящий щелчок по label работает всегда.
    const clip = foot.createEl("label", { cls: "ai-clip clickable-icon" });
    setIcon(clip, "paperclip");
    clip.setAttr("aria-label", t("chatClip"));
    const picker = clip.createEl("input", {
      cls: "ai-clip-input",
      type: "file",
      attr: { accept: "image/*,application/pdf", multiple: true },
    });
    picker.addEventListener("change", () => {
      const chosen = Array.from(picker.files ?? []);
      // Поле чистим сразу: иначе тот же файл вторым разом не выберется — событие
      // change на прежнем значении не случается.
      picker.value = "";
      void this.takeFiles(chosen);
    });
    // Хранилище — вторым способом, по правой кнопке: своей строки в подвале оно
    // не стоит, а в меню «ещё» те же два пункта есть и на телефоне.
    clip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      this.addClipItems(menu);
      menu.showAtMouseEvent(e);
    });

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
    // Картинка из буфера: скриншот делают и тут же спрашивают о нём, и путь
    // «сохрани файл — найди файл — приложи файл» здесь лишний целиком.
    this.inputEl.addEventListener("paste", (e) => {
      const images = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!images.length) return;
      e.preventDefault();
      void this.takeFiles(images, true);
    });
    this.setupDrop(root);

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
    // Панель могли закрыть с приложенной картинкой: она пережила это у плагина,
    // и плашку надо нарисовать своей рукой — catchSelection выше рисует её
    // только тогда, когда сменилось выделение.
    this.paintAttach();
    this.repaint();
  }

  async onClose(): Promise<void> {
    this.stop();
  }

  /** Панель могла быть открыта до правки настроек — освежаем подпись модели. */
  refreshHeader(): void {
    const model = this.contentEl.querySelector(".ai-bar-model");
    if (model) model.textContent = this.host.chatConfig().model;
    this.paintReach();
    this.paintTotal();
    // Плашку тоже: предупреждение «эта модель не принимает картинки» смотрит на
    // ту модель, что стоит сейчас. Без этого кнопка «спросить другую» внутри
    // самого предупреждения его же и не убирала бы, а переключение на слепую
    // модель проходило бы молча — до отказа провайдера.
    this.paintAttach();
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
   *
   * В приватном чате меню выбирает его собственную сетку, а не панельную: в
   * шапке там написано, чем отвечает приватный разговор, и щелчок по надписи
   * должен менять именно её. Выбор запоминается — это и есть та «сетка по
   * умолчанию» из настроек, только выученная на ходу.
   */
  private openModelMenu(e: MouseEvent): void {
    const s = this.host.settings;
    const priv = s.privateChat;
    const current = priv ? s.privateProvider || providerOf(s) : providerOf(s);
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
            // Панельного провайдера приватный чат не трогает: вышел из него —
            // и всё осталось там, где было.
            if (priv) s.privateProvider = name;
            else switchProvider(s, name);
            await this.host.saveSettings();
            new Notice(t("chatModelSwitched", { model: this.host.chatConfig().model }));
          }),
      );
    }

    // Список у провайдера — про панельного: в приватном чате это меню
    // раскладывает уже настроенное, а настраивают провайдеров в настройках.
    if (!priv) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("chatOtherModel"))
          .setIcon("list")
          .onClick(() => void this.pickModel()),
      );
    }
    menu.showAtMouseEvent(e);
  }

  /**
   * Настроенные профили в общем порядке — для меню моделей.
   * Активный провайдер идёт отдельным пунктом, поэтому его тут нет.
   */
  private otherModels(): [string, ProviderProfile][] {
    const s = this.host.settings;
    // Тот, кто отвечает сейчас: в приватном чате это может быть не панельный.
    const current = s.privateChat && s.privateProvider ? s.privateProvider : providerOf(s);
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
        .setTitle(t("chatAgainSame", { model: this.host.chatConfig().model }))
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
      const models = await modelsFor(this.host.apiConfig());
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
    // Картинка из хранилища: скрепка в подвале открывает диск, а сюда приходят
    // за тем, что уже лежит в заметках. На телефоне это ещё и единственный
    // путь — правой кнопки там нет.
    this.addClipItems(menu);
    menu.addSeparator();
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
    // Картинка на плашке — тоже разговор: пока она там, «новому чату» есть что
    // очищать, даже если лента пуста.
    if (this.host.history.length === 0 && this.files.length === 0 && wasPrivate === priv) return;

    // Спрашивать перед очисткой — лишний клик на каждый новый разговор, поэтому
    // чистим сразу, но держим копию: нажатие по уведомлению возвращает ленту.
    // Терять нечего — и предлагать вернуть незачем.
    const undo = this.host.history.length > 0 ? this.snapshot() : null;
    const gone = this.host.history.slice();
    this.host.history.length = 0;
    this.host.persistHistory();
    this.forgetSaved(gone);
    // Картинки нового разговора не переживают: приготовленные для прежнего, они
    // уехали бы со следующим вопросом — за деньги и без спроса. Фрагмент заметки
    // остаётся: за ним стоит живое выделение, и о том же куске после «нового
    // чата» часто спрашивают снова.
    this.dropFiles();
    if (wasPrivate !== priv) {
      this.host.settings.privateChat = priv;
      void this.host.saveSettings();
      // А вот смену режима плашке переживать нечего: приватному чату фрагмент
      // заметки не положен вовсе.
      this.attach(null);
      this.dismissed = null;
    }
    this.repaint();
    // Смену режима видно по шапке, а вот исчезнувший разговор — нет.
    if (undo) undo(priv ? t("chatPrivateStarted") : t("chatCleared"));
    else if (priv) new Notice(t("chatPrivateStarted"));
  }

  /**
   * Разговор с чистого листа перед запуском из заметки. Сам запрос прошлое и
   * так не тащит, но ответ ложится в ленту — и следующий вопрос, набранный уже
   * в панели, увозит с собой всё накопленное.
   *
   * Сметается и журнал правок: правку запускают из заметки и смотрят сюда за
   * ответом на неё, а не читают прошлые. Кому дорога кнопка «Отменить правку»,
   * тот включает «беречь журнал правок» — тогда карточки остаются. Плашку не
   * трогаем: фрагмент вешает сам вызывающий, а картинки на ней не разговор.
   */
  freshTalk(): void {
    if (!this.host.settings.freshOnAction) return;
    // Живой запрос: его ответ пришёл бы в пустую ленту и повис без вопроса.
    if (this.controller) return;
    const history = this.host.history;
    const keepLog = this.host.settings.freshKeepLog;
    // Чистить нечего — и говорить не о чем: уведомление на пустом месте
    // раздражало бы на каждом нажатии клавиши.
    if (afterFresh(history, keepLog).length === history.length) return;

    const undo = this.snapshot();
    this.cut(0, history.length, keepLog);
    undo(t("chatFreshStarted"));
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
        // Восемь секунд уведомления — ровно то время, пока модель правит текст,
        // и карточка этой правки уже легла в ленту. Голая подмена снимком
        // унесла бы её вместе с кнопкой «Отменить правку».
        const back = mergeRestored(kept, this.host.history);
        this.host.history.length = 0;
        this.host.history.push(...back);
        this.host.persistHistory();
        this.repaint();
        notice.hide();
      };
    };
  }

  /**
   * Убрать кусок ленты. Записи журнала правок по умолчанию остаются на месте:
   * это отчёт о работе над заметкой, а не часть разговора, и к снятому вопросу
   * они отношения не имеют. Сметает их только чистый лист перед запуском из
   * заметки — там на них смотрят как на прошлые, и то по настройке.
   */
  private cut(from: number, to: number, keepLog = true): void {
    const removed = this.host.history.splice(from, to - from);
    // Правило «журнал правок остаётся» живёт в одном месте — dropTalk; так
    // тест на dropTalk и держит в узде оба его применения разом.
    this.host.history.splice(from, 0, ...(keepLog ? dropTalk(removed) : []));
    this.host.persistHistory();
    this.forgetSaved(removed);
    this.repaint();
  }

  /**
   * Снять с плашки все картинки разом и отпустить их из памяти сеанса. В ленту
   * они не попали, значит вернуть их нечем и незачем.
   */
  private dropFiles(): void {
    if (!this.files.length) return;
    for (const att of this.files) this.host.attachments.forget(att.id);
    this.files = [];
    this.paintAttach();
  }

  /**
   * Картинки ушедших реплик — из памяти сеанса вон. Держать их дальше незачем:
   * после очистки ленты до них не добраться ничем, а весит каждая сотни
   * килобайт, и за долгий день их набирается на десятки мегабайт.
   *
   * Только те, что лежат в хранилище: их вернёт диск, и забывать их ничего не
   * стоит. Прожившую один сеанс не трогаем, даже когда реплику сняли, — снятие
   * возвращается нажатием по уведомлению, и картинка должна вернуться с ней.
   */
  private forgetSaved(items: HistoryItem[]): void {
    for (const item of items) {
      if (isActionEntry(item)) continue;
      for (const att of item.attachments ?? []) {
        if (att.path) this.host.attachments.forget(att.id);
      }
    }
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
      // И те же картинки: без них «спросить заново» ушло бы вопросом про
      // изображение, которого в запросе нет.
      files: ask.attachments ?? null,
      config,
    });
  }

  /**
   * Дописать оборванный ответ. Модель упёрлась в свой предел длины и встала на
   * полуслове; до сих пор оставалось либо забирать половину руками, либо
   * спрашивать заново — то есть платить за уже написанное второй раз.
   *
   * Продолжение приклеивается к тому же ответу, а не встаёт отдельной репликой:
   * иначе длинный текст, ради которого всё и затевалось, пришлось бы копировать
   * по кускам и сшивать вручную.
   */
  private async continueReply(msg: StoredChatMessage): Promise<void> {
    if (this.busy) this.stop();
    const history = this.host.history;
    const at = history.indexOf(msg);
    if (at === -1) return;
    // Ниже мог появиться новый разговор: дописывать в середину ленты нельзя —
    // продолжение окажется под чужими репликами.
    if (this.lastChat() !== msg) {
      new Notice(t("chatContinueLast"));
      return;
    }

    // Тем же, чем отвечали: подпись под ответом уже стоит, и менять модель на
    // середине текста — верный способ получить вторую половину другим голосом.
    const cfg = this.configOf(msg.model);
    // Вопрос выше ответа: по нему видно, шёл ли запрос из заметки — тогда
    // прошлого разговора он не видел, и продолжению его тоже не надо.
    let up = at - 1;
    while (up >= 0 && !isAsk(history[up])) up--;
    const ask = up >= 0 ? (history[up] as StoredChatMessage) : null;
    const fresh = ask?.resend?.fresh === true;

    const messages: ChatMessage[] = [];
    const system = [
      ask?.resend?.system?.trim(),
      // Приватному чату своё не положено, как и в обычном запросе.
      this.host.settings.privateChat ? "" : this.host.settings.systemPrompt.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (system) messages.push({ role: "system", content: system });

    // Действие из заметки само себе контекст: в него уезжали только вопрос и
    // ответ, и продолжение идёт по тем же правилам. Оборванный ответ уходит
    // последней репликой — продолжать модель должна свой текст.
    const talk = fresh && ask ? [ask, msg] : contextWindow(history);
    // Картинки во второй раз не возим: дописывают ответ, а не пересматривают
    // изображение — но и молчать о нём нельзя, иначе вопрос «что тут?» уходит
    // указывающим в пустоту. Про это messageContent и приписывает строчку.
    for (const m of talk) messages.push({ role: m.role, content: messageContent(m) });
    messages.push({ role: "user", content: t("chatContinuePrompt") });

    const controller = new AbortController();
    this.controller = controller;
    this.paintSendButton();

    // Пишем в тот же пузырь. Его могло и не остаться — тогда просто перерисуем
    // ленту, когда текст доедет.
    const bubble = this.msgEls.get(msg) ?? null;
    const body = bubble?.isConnected ? (bubble.querySelector(".ai-msg-body") as HTMLElement) : null;
    const tail = this.listEl.createDiv({ cls: "ai-notice", text: t("chatContinuing") });
    let added = "";

    try {
      const result = await chat(cfg, messages, {
        stream: this.host.settings.stream && streamAllowed(providerOf(cfg)),
        signal: controller.signal,
        wantUsage: this.host.settings.showUsage,
        onDelta: (chunk) => {
          added += chunk;
          // Дописываем прямо в конец готового ответа: markdown пересоберём,
          // когда текст доедет целиком.
          body?.appendText(chunk);
          this.followBottom();
        },
      });
      added = result.text || added;
      if (!added.trim()) {
        new Notice(t("emptyReply"));
        // В пузырь могли натечь пробелы — возвращаем ленту к тому, что в истории.
        this.repaint();
        return;
      }

      // Склейка без пробела: модель продолжает с того самого символа, и лишний
      // перенос строки разорвал бы слово или строку песни.
      msg.content += added;
      msg.truncated = result.truncated || undefined;
      msg.usage = addUsage(msg.usage ?? null, result.usage) ?? undefined;
      if (result.sources.length) msg.sources = result.sources;
      this.host.persistHistory();

      if (bubble && body) {
        await this.renderMarkdown(msg.content, body, msg.sources);
        this.addFooter(bubble, msg.content, msg.usage ?? null, msg);
      } else {
        this.repaint();
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      if (err.aborted || controller.signal.aborted) {
        // Оборвали руками — то, что успело прийти, всё равно оплачено.
        if (added.trim()) {
          msg.content += added;
          this.host.persistHistory();
        }
        new Notice(t("aborted"));
        this.repaint();
      } else {
        new Notice(err.message, 8000);
        // Дописанного нет, а в пузыре осталась печать по ходу дела.
        this.repaint();
      }
    } finally {
      tail.remove();
      if (this.controller === controller) this.controller = null;
      this.paintSendButton();
      this.paintReach();
      this.paintTotal();
    }
  }

  /**
   * Настройки запроса под названную модель. Ответ мог прийти от другой — её
   * звали разово через «ещё раз», — и дописывать его надо ею же.
   */
  private configOf(model: string | undefined): ApiConfig {
    const base = this.host.chatConfig();
    if (!model || model === base.model) return base;
    for (const name of Object.keys(this.host.settings.profiles)) {
      const found = configFor(this.host.settings, name);
      if (found?.model === model) return found;
    }
    return base;
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
    // И картинки: правят обычно формулировку, а не то, о чём спрашивали. То, что
    // успели приложить для следующего вопроса, при этом снимается — иначе
    // вернувшийся вопрос уехал бы наполовину с чужими картинками.
    this.dropFiles();
    if (msg.attachments?.length) {
      this.files = [...msg.attachments];
      this.paintAttach();
    }
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
    this.paintAttach();
  }

  /**
   * Плашка над полем ввода: что уедет вместе с вопросом. Фрагмент заметки
   * занимает всю строку — он длинный и читается глазами; картинки встают
   * рядком, каждая своим кусочком.
   */
  private paintAttach(): void {
    const bar = this.attachEl;
    // Настройки могли записать до того, как панель успела построиться, — как и
    // с шапкой: сюда приходят в том числе из saveSettings.
    if (!bar) return;
    bar.empty();
    if (!this.attached && this.files.length === 0) {
      bar.hide();
      return;
    }
    bar.show();
    if (this.attached) this.quoteChip(bar, this.attached);
    for (const att of this.files) this.fileChip(bar, att);

    // Модель, которая картинок не принимает, отвечает на них отказом по
    // формату. Сказать об этом надо до отправки, а не после: до отказа ещё
    // надо дописать вопрос и нажать «отправить».
    //
    // Документов это не касается вовсе: они уходят текстом, и слепая модель
    // читает их не хуже зрячей — предупреждать не о чем.
    if (!this.files.some((f) => !isDoc(f))) return;
    const cfg = this.host.chatConfig();
    if (imagesAllowed(providerOf(cfg))) return;
    const warn = bar.createDiv({ cls: "ai-attach-warn" });
    setIcon(warn.createSpan({ cls: "ai-attach-icon" }), "eye-off");
    warn.createSpan({ text: t("chatAttachBlind", { model: cfg.model }) });
    const swap = warn.createEl("button", { cls: "ai-attach-switch", text: t("chatAttachSwitch") });
    swap.onclick = (e) => this.openModelMenu(e);
  }

  private quoteChip(bar: HTMLElement, found: { path: string; text: string }): void {
    const chip = bar.createDiv({ cls: "ai-attach-item ai-attach-quote" });
    setIcon(chip.createSpan({ cls: "ai-attach-icon" }), "text-quote");
    const preview = found.text.replace(/\s+/g, " ").trim();
    chip.createSpan({
      cls: "ai-attach-text",
      text: preview.length > 120 ? preview.slice(0, 119) + "…" : preview,
    });
    chip.createSpan({
      cls: "ai-attach-size",
      text: t("chatAttachSize", { chars: found.text.length }),
    });

    const drop = chip.createEl("button", { cls: "ai-attach-drop clickable-icon" });
    setIcon(drop, "x");
    drop.setAttr("aria-label", t("chatAttachDrop"));
    drop.onclick = () => {
      this.dismissed = found.text;
      this.attach(null);
    };
  }

  private fileChip(bar: HTMLElement, att: Attachment): void {
    const chip = bar.createDiv({ cls: "ai-attach-item ai-attach-file" });
    if (isDoc(att)) this.docChipBody(chip, att);
    else this.imageChipBody(chip, att);

    const drop = chip.createEl("button", { cls: "ai-attach-drop clickable-icon" });
    setIcon(drop, "x");
    drop.setAttr("aria-label", t("chatAttachRemove"));
    drop.onclick = () => {
      this.files = this.files.filter((f) => f !== att);
      // Из памяти сеанса картинку отпускаем: её сняли руками, и второго такого
      // же вопроса не будет. А вот файл, уже лежащий в хранилище, остаётся на
      // месте: положили его туда по общему правилу, и снятие вложения — не
      // повод удалять чужое молча.
      this.host.attachments.forget(att.id);
      this.paintAttach();
    };
  }

  private imageChipBody(chip: HTMLElement, att: Attachment): void {
    const url = attachmentUrl(this.app, this.host.attachments, att);
    // Ужатая картинка — единственное, по чему её узнают: имена у снимков экрана
    // одинаковые, а размер говорит только о цене.
    if (url) chip.createEl("img", { cls: "ai-attach-thumb", attr: { src: url, alt: att.name } });
    else setIcon(chip.createSpan({ cls: "ai-attach-icon" }), "image-off");
    chip.createSpan({ cls: "ai-attach-text", text: att.name });
    chip.createSpan({ cls: "ai-attach-size", text: humanSize(att.size) });
  }

  /**
   * У документа показывать нечего — вместо миниатюры значок. Зато есть что
   * сказать: страницы и знаки. Знаки тут и есть цена вопроса, а «только
   * начало» надо видеть до отправки, а не узнавать из ответа.
   */
  private docChipBody(chip: HTMLElement, att: Attachment): void {
    setIcon(chip.createSpan({ cls: "ai-attach-icon" }), "file-text");
    chip.createSpan({ cls: "ai-attach-text", text: att.name });
    const size = { pages: att.pages ?? 0, chars: grouped(att.chars ?? 0) };
    chip.createSpan({
      cls: "ai-attach-size",
      text: att.clipped ? t("chatAttachDocClipped", size) : t("chatAttachDoc", size),
    });
  }

  /** Пункты «откуда взять картинку»: и по правой кнопке на скрепке, и в «ещё». */
  private addClipItems(menu: Menu): void {
    menu.addItem((item) =>
      item
        .setTitle(t("chatClipVault"))
        .setIcon("image")
        .onClick(() => this.pickFromVault()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("chatClipNote"))
        .setIcon("file-image")
        .onClick(() => this.pickFromNote()),
    );
  }

  /** Любая картинка хранилища — списком с поиском по имени и папке. */
  private pickFromVault(): void {
    const paths = this.app.vault
      .getFiles()
      .filter((f) => isAttachablePath(f.path))
      .map((f) => f.path)
      .sort();
    if (!paths.length) {
      new Notice(t("chatClipNoImages"));
      return;
    }
    new ImageSuggestModal(this.app, paths, (path) => void this.addFromVault(path)).open();
  }

  /**
   * Картинки, встроенные в открытую заметку. Заметка уезжает модели текстом, и
   * `![[схема.png]]` она видит строчкой, а не изображением: приложить картинку
   * из-под курсора — самый частый способ спросить «что тут не так».
   */
  private pickFromNote(): void {
    const note = this.host.readNote();
    const links = note ? embeddedFiles(note.text) : [];
    // Ссылка в заметке короткая — «схема.png»; настоящий путь ищет Obsidian,
    // он же разбирается с одинаковыми именами в разных папках.
    const paths: string[] = [];
    for (const link of links) {
      const file = this.app.metadataCache.getFirstLinkpathDest(link, note?.path ?? "");
      if (file instanceof TFile && !paths.includes(file.path)) paths.push(file.path);
    }
    if (!paths.length) {
      new Notice(t("chatClipNoneInNote"));
      return;
    }
    if (paths.length === 1) {
      void this.addFromVault(paths[0]);
      return;
    }
    new ImageSuggestModal(this.app, paths, (path) => void this.addFromVault(path)).open();
  }

  /** Перетаскивание в панель: файлы с диска и файлы из проводника Obsidian. */
  private setupDrop(root: HTMLElement): void {
    const dragged = (e: DragEvent): boolean =>
      !!e.dataTransfer && [...e.dataTransfer.types].some((ty) => ty === "Files" || ty === "text/plain");

    this.registerDomEvent(root, "dragover", (e) => {
      if (!dragged(e)) return;
      // Без этого браузер откажется отдавать drop, и файл откроется поверх окна.
      e.preventDefault();
      root.addClass("is-dropping");
    });
    this.registerDomEvent(root, "dragleave", (e) => {
      // Переход с пузыря на поле ввода — это тоже dragleave, хотя из панели
      // никто не уходил: смотрим, куда указатель переехал, а не откуда.
      const to = e.relatedTarget as Node | null;
      if (!to || !root.contains(to)) root.removeClass("is-dropping");
    });
    // Пунктирная рамка говорит «сюда можно», но не говорит, что будет: панель
    // принимает и текст, и заметки, и картинку — вслух надёжнее.
    root.createDiv({ cls: "ai-drop-hint", text: t("chatAttachDropHere") });

    this.registerDomEvent(root, "drop", (e) => {
      root.removeClass("is-dropping");
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void this.takeFiles(files);
        return;
      }
      const text = (e.dataTransfer?.getData("text/plain") ?? "").trim();
      if (!text) return;

      // Из проводника Obsidian приезжает не файл, а ссылка на него. Ищем файл
      // только по ней или по полному пути: голое слово «Идеи» тоже совпало бы с
      // заметкой, и брошенный текст молча превращался бы в чужой файл.
      const wiki = /^!?\[\[.+\]\]$/.test(text);
      const link = text.replace(/^!?\[\[|\]\]$/g, "").split("|")[0].trim();
      const file = wiki
        ? this.app.vault.getAbstractFileByPath(link) ??
          this.app.metadataCache.getFirstLinkpathDest(link, this.host.targetPath() ?? "")
        : this.app.vault.getAbstractFileByPath(text);

      if (file instanceof TFile) {
        e.preventDefault();
        if (isAttachablePath(file.path)) void this.addFromVault(file.path);
        else if (file.extension === "md") void this.attachNote(file);
        else new Notice(t("chatAttachNotImage"));
        return;
      }

      // Текст, который тащат внутри самого поля, оно переставит само: вмешаться
      // значит получить две копии — свою вставку и его перенос.
      if (e.target === this.inputEl) return;
      e.preventDefault();
      this.dropText(text);
    });
  }

  /**
   * Брошенная в панель заметка — фрагментом на плашку, тем же путём, что и
   * выделение: уедет вместе с вопросом и там же будет видна. Рамка обещает
   * «приложу к вопросу», и до сих пор для всего, кроме картинки и документа,
   * это было неправдой — подсветка загоралась, а отпущенное пропадало.
   */
  private async attachNote(file: TFile): Promise<void> {
    // Приватность важнее удобства: молча увезти кусок хранилища оттуда, где
    // хранилища как бы нет, — обман. Говорим вслух и не прикладываем.
    if (this.host.settings.privateChat) {
      new Notice(t("chatPrivateNoQuote"));
      return;
    }
    const raw = await this.app.vault.cachedRead(file).catch(() => "");
    if (!raw.trim()) {
      new Notice(t("chatDropNoteEmpty"));
      return;
    }
    // Тот же нож, что у заметки в контексте: длинную берём началом, иначе на
    // плашку ляжет то, за что заплатят не глядя.
    const { text, clipped } = clipNote(raw);
    this.dismissed = null;
    this.attach({ path: file.path, text });
    if (clipped) new Notice(t("chatContextClipped"));
  }

  /**
   * Брошенный в панель текст — в поле вопроса, на место курсора. Поле могло
   * быть не в фокусе — тогда дописываем в конец: втыкать в начало написанного
   * человек точно не просил.
   */
  private dropText(text: string): void {
    const input = this.inputEl;
    const at =
      input.ownerDocument.activeElement === input ? input.selectionStart : input.value.length;
    const before = input.value.slice(0, at);
    const after = input.value.slice(at);
    // Приклеенное вплотную к чужому слову читается как опечатка.
    const added = (before && !/\s$/.test(before) ? " " : "") + text + (after && !/^\s/.test(after) ? " " : "");
    input.value = before + added + after;
    this.autoGrow();
    this.saveDraft();
    input.focus();
    input.setSelectionRange(at + added.length, at + added.length);
  }

  /**
   * Взять картинки в чат. Всё лишнее отсекаем молча: в перетащенной пачке
   * запросто едут и документы, и ругаться на каждый — только мешать.
   *
   * fromClipboard — имя придумываем сами: из буфера картинка приезжает
   * безымянной, и в папке вложений таких «image.png» скопился бы десяток.
   */
  private async takeFiles(list: File[], fromClipboard = false): Promise<void> {
    const images = list.filter(
      // SVG — не картинка, а разметка: Electron её в холст не кладёт, а модели
      // такого вложения не принимают вовсе.
      (f) =>
        f.type !== "image/svg+xml" &&
        (f.type.startsWith("image/") || f.type === "application/pdf" || isAttachablePath(f.name)),
    );
    // Ни одной картинки во всей пачке — тут молчать нельзя: человек принёс файл
    // и не увидел вообще ничего, а это выглядит как сломанный плагин, а не как
    // «так нельзя». Лишнее в пачке с картинками по-прежнему отсекаем молча.
    if (!images.length) {
      if (list.length) new Notice(t("chatAttachNotImage"));
      return;
    }
    const taken: Attachment[] = [];
    let failed = 0;
    let scans = 0;
    for (const file of images) {
      if (this.files.length >= MAX_FILES) {
        new Notice(t("chatAttachLimit", { n: MAX_FILES }));
        break;
      }
      const name = fromClipboard ? pastedName(file.type, stamp(new Date())) : file.name;
      const got = await this.addFile(file, name);
      if (typeof got === "object") taken.push(got);
      else if (got === "notext") scans++;
      else failed++;
    }
    if (failed) new Notice(t("chatAttachFailed"));
    if (scans) new Notice(t("chatAttachNoText"), 8000);
    // Настройка обещает положить картинку в хранилище, а приватный чат этого
    // обещания не выполнит никогда — сказать об этом надо сразу, а не после
    // отправки, когда файла уже ждут в папке вложений.
    const s = this.host.settings;
    if (taken.length && s.saveAttachments && s.privateChat) new Notice(t("chatAttachPrivate"));
    this.paintAttach();
  }

  /**
   * Картинки вопроса — в папку вложений хранилища, туда же, куда их кладёт сам
   * Obsidian при вставке в заметку.
   *
   * В момент отправки, а не когда картинку принесли: приложенную и снятую —
   * передумал, перетащил не то, выбрал не тот файл — хранилище не увидит вовсе.
   * Уведомление одно на всю пачку: тащат их сразу по нескольку.
   *
   * Не вышло положить — вопрос всё равно уходит, но об этом говорим вслух:
   * иначе человек узнает о потере только после перезапуска, когда повторить
   * вопрос уже нечем.
   */
  private async saveFiles(files: Attachment[]): Promise<void> {
    const s = this.host.settings;
    if (!s.saveAttachments || s.privateChat) return;
    // Картинка из хранилища там уже лежит — класть её второй раз незачем.
    // Документ не кладём вовсе: настройка обещает оставлять картинки, и она
    // права — снимок в чате потом хочется увидеть, а двадцатимегабайтный
    // документ в папке вложений это мусор.
    const fresh = files.filter((a) => !a.path && !isDoc(a));
    if (!fresh.length) return;

    const where = this.host.targetPath() ?? "";
    for (const att of fresh) {
      const blob = this.host.attachments.get(att.id);
      const path = blob ? await saveToVault(this.app, blob, att.name, where) : null;
      if (path) att.path = path;
    }
    const saved = fresh.filter((a) => a.path);
    if (saved.length === 1) new Notice(t("chatAttachSaved", { path: saved[0].path ?? "" }));
    else if (saved.length > 1) new Notice(t("chatAttachSavedMany", { n: saved.length }));
    if (saved.length < fresh.length) new Notice(t("chatAttachSaveFailed"));
  }

  /**
   * Что принесли в чат. Документ и картинка расходятся здесь и дальше нигде не
   * пересекаются: у одного берут текст, у другой — пиксели.
   *
   * `notext` — документ прочитан, а текста в нём нет: это скан, фотографии
   * страниц. Отличать от «не прочитался» надо обязательно, потому что сказать
   * человеку нужно разное.
   */
  private async addFile(blob: Blob, name: string): Promise<Attachment | "unreadable" | "notext"> {
    return isPdfPath(name) || blob.type === "application/pdf"
      ? this.addDoc(blob, name)
      : this.addImage(blob, name);
  }

  /**
   * Документ: текстовый слой читаем сразу, а не при отправке. Во-первых, на
   * плашке должно быть видно, сколько знаков уедет, — это цена вопроса.
   * Во-вторых, скан лучше опознать здесь: приложить пустоту и узнать об этом
   * из ответа модели — худший из порядков.
   */
  private async addDoc(
    blob: Blob,
    name: string,
    path?: string,
  ): Promise<Attachment | "unreadable" | "notext"> {
    const found = await pdfText(await blob.arrayBuffer());
    if (!found) return "unreadable";
    if (!found.text.trim()) return "notext";

    const att: Attachment = {
      id: newId(),
      name,
      mime: "application/pdf",
      size: blob.size,
      path,
      pages: found.pages,
      chars: found.text.length,
      clipped: found.clipped || undefined,
    };
    // Сам файл держим тоже: по нему видно вес, а из хранилища его читать
    // заново незачем, пока идёт этот сеанс.
    this.host.attachments.put(att.id, blob);
    this.host.attachments.putText(att.id, found.text);
    this.files.push(att);
    return att;
  }

  /**
   * Картинка, принесённая в чат: ужать и показать на плашке. До отправки она
   * живёт только в памяти сеанса — на диск её кладёт saveFiles, и только если
   * вопрос действительно уйдёт.
   */
  private async addImage(blob: Blob, name: string): Promise<Attachment | "unreadable"> {
    let ready: Blob | null;
    try {
      ready = await prepareImage(blob);
    } catch {
      ready = null;
    }
    if (!ready) return "unreadable";
    const att: Attachment = {
      id: newId(),
      name,
      mime: ready.type || blob.type || "image/png",
      size: ready.size,
    };
    this.host.attachments.put(att.id, ready);

    this.files.push(att);
    return att;
  }

  /** Файл из хранилища: он там уже лежит, класть его второй раз незачем. */
  private async addFromVault(path: string): Promise<void> {
    if (this.files.length >= MAX_FILES) {
      new Notice(t("chatAttachLimit", { n: MAX_FILES }));
      return;
    }
    const raw = await vaultBlob(this.app, path);
    if (!raw) {
      new Notice(t("chatAttachFailed"));
      return;
    }
    if (isPdfPath(path)) {
      const got = await this.addDoc(raw, path.split("/").pop() ?? path, path);
      if (got === "notext") new Notice(t("chatAttachNoText"), 8000);
      else if (got === "unreadable") new Notice(t("chatAttachFailed"));
      this.paintAttach();
      return;
    }
    const ready = await prepareImage(raw);
    if (!ready) {
      new Notice(t("chatAttachFailed"));
      return;
    }
    const att: Attachment = {
      id: newId(),
      name: path.split("/").pop() ?? path,
      mime: ready.type || mimeOf(path),
      size: ready.size,
      path,
    };
    this.host.attachments.put(att.id, ready);
    this.files.push(att);
    this.paintAttach();
  }

  /**
   * Картинки вложений адресами data: — тем, что уедет модели. Пропавшую (файл
   * удалили, а память сеанса не пережила перезапуск) пропускаем и говорим об
   * этом вслух: вопрос про картинку, которой нет, лучше задать зряче.
   */
  private async imagesFor(files: Attachment[]): Promise<string[]> {
    const out: string[] = [];
    let gone = 0;
    for (const att of files) {
      if (isDoc(att)) continue;
      const data = await attachmentData(this.app, this.host.attachments, att);
      if (data) out.push(data);
      else gone++;
    }
    // Пропали обычно все разом — их и не пережил один и тот же перезапуск.
    if (gone) new Notice(t("chatAttachGone"));
    return out;
  }

  /**
   * Документы вопроса — текстом, тем, что уедет модели. Текст живёт в памяти
   * сеанса, а у документа из хранилища перечитывается по пути; принесённый с
   * диска перезапуска не переживает, и об этом говорим вслух.
   */
  private async docsFor(files: Attachment[]): Promise<AttachedDoc[]> {
    const out: AttachedDoc[] = [];
    let gone = 0;
    for (const att of files) {
      if (!isDoc(att)) continue;
      const text = await attachmentText(this.app, this.host.attachments, att);
      if (text) out.push({ name: att.name, text, clipped: att.clipped === true });
      else gone++;
    }
    if (gone) new Notice(t("chatAttachDocGone"));
    return out;
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
    // Одна картинка без слов — тоже вопрос: «что здесь?» модель понимает и так.
    if (!text && this.files.length === 0) return;
    if (text) this.rememberAsk(text);
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
    const cfg = opts.config ?? this.host.chatConfig();
    // Прикреплённое выделение уходит с вопросом и тут же снимается: следующий
    // вопрос — уже про своё, если не выделить заново. Явный null в опциях
    // означает «без фрагмента» и плашку не смотрит вовсе. Приватный чат не
    // отправляет фрагмент ни при каких условиях — последняя застава на пути
    // всего, что могло уцелеть от прошлого разговора.
    const asked = opts.quote === undefined ? this.attached?.text : opts.quote;
    const quote = (this.host.settings.privateChat ? null : asked) ?? undefined;
    // Картинки уходят с этим вопросом и снимаются с плашки — как фрагмент.
    // Приватности они не касаются: картинку приносят в чат руками, и это уже
    // сказанное «отправь», а не подхваченное само собой из заметки.
    //
    // Действие из заметки плашку не смотрит вовсе и картинок с неё не забирает:
    // приложенная для следующего вопроса, она уехала бы с чужим запросом — за
    // те же деньги и без спроса.
    const files = (opts.files === undefined ? (opts.fromEditor ? [] : this.files) : opts.files) ?? [];
    // С плашки снимаем только то, что с неё и взяли. Картинки, переданные явно
    // («спросить заново», «повторить» после ошибки), к плашке отношения не
    // имеют: приложенное там ждёт следующего вопроса, и стереть его молча —
    // потерять чужую работу, а заодно оставить её висеть в памяти сеанса
    // навсегда: в ленту она не попала, и забыть её будет уже некому.
    if (opts.files === undefined && !opts.fromEditor) this.files = [];
    this.attach(null);
    // Про этот кусок уже спросили, и он остался в ленте. Выделение в заметке
    // никуда не делось — без этого плашка тут же вернулась бы, и фрагмент уехал
    // бы вторым разом за те же деньги.
    if (quote) this.dismissed = quote;
    // Вопрос уходит — значит картинкам пора на диск, если так велено настройкой.
    // Путь проставляется до того, как реплика ляжет в ленту: он в ней и хранится.
    await this.saveFiles(files);

    // Реплику держим объектом: по нему кнопки под сообщением находят своё место
    // в ленте, как бы она ни менялась под ними.
    const ask: StoredChatMessage = {
      role: "user",
      content: opts.display ?? text,
      quote,
      attachments: files.length ? files : undefined,
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
    // Инструментов может не быть и у самого провайдера: Perplexity ищет в вебе и
    // отвечает, а function calling не умеет вовсе — запрос с ними отлетел бы
    // четырёхсотой на каждый вопрос.
    const canUseTools =
      this.host.settings.tools && !opts.fromEditor && !priv && toolsAllowed(providerOf(cfg));
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
      const past = contextWindow(this.host.history.slice(0, -1));
      // Из прошлых реплик картинки уходят только с самой свежей: за каждую
      // платят на каждом вопросе, и разговор, начавшийся с фотографии, иначе
      // возил бы её с собой до конца. Про остальные модели говорят словами —
      // иначе разговор выглядит как вопросы о пустоте.
      // К этому вопросу приложили своё — прежние картинки не нужны и подавно:
      // спрашивают уже про новую.
      const lastWithFiles = files.length
        ? -1
        : past.reduce((at, m, i) => (m.attachments?.length ? i : at), -1);
      for (const [i, m] of past.entries()) {
        // Документ той же меркой, что картинка: он тоже стоит денег на каждом
        // вопросе, и возить сорок тысяч знаков до конца разговора нельзя.
        const own = i === lastWithFiles ? (m.attachments ?? []) : [];
        const seen = await this.imagesFor(own);
        const read = await this.docsFor(own);
        messages.push({ role: m.role, content: messageContent(m, seen, read) });
      }
    }
    const images = await this.imagesFor(files);
    const docs = await this.docsFor(files);
    messages.push({
      role: "user",
      content: messageContent(
        { role: "user", content: text, quote, attachments: files },
        images,
        docs,
      ),
    });

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
          // Уведомление «вернуть разговор» (snapshot в freshTalk/newChat)
          // могло сработать, пока ответ ещё шёл: history.length = 0 плюс
          // push(...kept) меняют весь массив разом, и ask в нём больше нет.
          // Класть ответ в чужую (или уже не открытую) ленту нельзя — та же
          // проверка, что и в keepPartial ниже.
          const owned = this.host.history.includes(ask);
          const reply: StoredChatMessage = {
            role: "assistant",
            content: answer,
            reasoning,
            usage: result.usage ?? undefined,
            model: cfg.model,
            sources: result.sources.length ? result.sources : undefined,
            truncated: result.truncated || undefined,
          };
          if (owned) this.host.history.push(reply);
          await this.renderMarkdown(answer, body, reply.sources);
          this.addFooter(bubble, answer, result.usage, owned ? reply : undefined);
          // Разговор могли не только увести, но и перерисовать при этом —
          // тогда пузырь, в который писался ответ, остался вне документа.
          if (!bubble.isConnected) this.repaint();
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
          // Пока ошибка висела на экране, ленту могли и очистить, и увести в
          // новый разговор. Тогда startAt показывает уже не на наш заход, и
          // splice отрезал бы кусок чужого: повторяем только вопрос.
          if (this.host.history[startAt] === ask) {
            // Ошибка могла случиться и на втором круге инструментов — тогда сверху
            // лежит не вопрос, а ответ или след правки. Снимаем весь заход целиком
            // и перерисовываем ленту, чтобы она сошлась с историей.
            const tail = this.host.history.splice(startAt);
            // Правка выделенного могла идти своим чередом — к этому запросу она
            // отношения не имеет, и её запись остаётся в ленте.
            this.host.history.push(...tail.filter(isActionEntry));
            this.host.persistHistory();
            this.repaint();
          }
          // Фрагмент и картинки задаём явно: плашку сняли ещё в начале захода, и
          // без этого повтор уходил без куска заметки — молча и за те же деньги.
          // С картинками хуже вдвое: пока ошибка висела на экране, на плашку
          // могли положить новые — и повтор уехал бы с чужими вместо своих.
          void this.submit(text, { ...opts, quote: quote ?? null, files });
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
        void this.renderMarkdown(m.content, body, m.sources);
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
      // Оборвано на пределе длины — единственная беда, которую можно поправить
      // не переспрашивая: половина уже написана, осталось дописать остаток.
      if (entry.truncated) {
        const more = card.createDiv({ cls: "ai-log-foot" }).createEl("button", {
          cls: "ai-log-undo",
          text: t("logContinue"),
        });
        more.onclick = () => void this.host.continueAction(entry.id);
      }
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
        // Оборванный ответ — не поломка: он есть, просто не дописан.
        return entry.truncated ? t("logCutOff") : t("logFailed");
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
    // Картинки — над вопросом, как и фрагмент: разговор, в котором не видно, о
    // чём спрашивали, через день не восстановить.
    if (msg?.attachments?.length) this.addThumbs(el, msg.attachments);
    const body = el.createDiv({ cls: "ai-msg-body" });
    if (text) body.setText(text);
    // У ответа кнопки в общем подвале, а у вопроса свой: он и рисуется сразу,
    // и ждать в нём нечего.
    if (msg && role === "user") this.askFooter(el, msg);
    return el;
  }

  /**
   * Картинки под репликой в ленте. Файл хранилища открывается щелчком — так же,
   * как из заметки; картинка из памяти сеанса никуда не ведёт, открывать нечего.
   * Не нашлась вовсе — на её месте честная надпись, а не пустая рамка.
   */
  private addThumbs(el: HTMLElement, files: Attachment[]): void {
    const row = el.createDiv({ cls: "ai-msg-files" });
    for (const att of files) {
      if (isDoc(att)) {
        // У документа показывать нечего — строчка с именем. Она же и ссылка,
        // если файл лежит в хранилище.
        const doc = row.createDiv({ cls: "ai-msg-doc" });
        setIcon(doc.createSpan({ cls: "ai-attach-icon" }), "file-text");
        doc.createSpan({ text: att.name });
        if (att.path) {
          doc.addClass("is-clickable");
          doc.onclick = () => this.openAttachment(att);
        }
        continue;
      }
      const url = attachmentUrl(this.app, this.host.attachments, att);
      if (!url) {
        row.createDiv({ cls: "ai-msg-file-gone", text: t("chatAttachGone") });
        continue;
      }
      const img = row.createEl("img", {
        cls: "ai-msg-file",
        attr: { src: url, alt: att.name, title: att.path ?? att.name },
      });
      if (!att.path) continue;
      img.addClass("is-clickable");
      img.onclick = () => this.openAttachment(att);
    }
  }

  /** Файл вложения новой вкладкой — заметка, над которой работали, остаётся. */
  private openAttachment(att: Attachment): void {
    const file = this.app.vault.getAbstractFileByPath(att.path ?? "");
    if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
  }

  /**
   * Кнопки под своим вопросом: переписать его и убрать из разговора. Нужны они
   * реже, чем «скопировать» под ответом, поэтому и держатся в тени.
   */
  private askFooter(el: HTMLElement, msg: StoredChatMessage): void {
    const foot = el.createDiv({ cls: "ai-msg-foot ai-msg-foot-ask" });

    const edit = foot.createEl("button", { cls: "clickable-icon" });
    setIcon(edit, "pencil");
    edit.setAttr("aria-label", t("chatEditAsk"));
    edit.onclick = () => this.editAsk(msg);

    this.dropButton(foot, msg);
  }

  private dropButton(foot: HTMLElement, msg: StoredChatMessage): void {
    const drop = foot.createEl("button", { cls: "clickable-icon" });
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
    // Подвал рисуется под каждым ответом — и живым, и восстановленным из ленты,
    // — поэтому связь «реплика → пузырь» запоминается здесь же: другого места,
    // где сходятся оба, нет.
    if (msg) this.msgEls.set(msg, bubble);
    // Источники встают между ответом и кнопками, поэтому рисуются здесь же:
    // подвал переписывается и по ходу разговора, и при перерисовке ленты.
    bubble.querySelector(".ai-sources")?.remove();
    if (msg?.sources?.length) this.addSources(bubble, msg.sources);
    const foot = bubble.createDiv({ cls: "ai-msg-foot" });

    const copy = foot.createEl("button", { cls: "clickable-icon" });
    setIcon(copy, "copy");
    copy.setAttr("aria-label", t("chatCopy"));
    // Буфер отдаёт отказ и без видимой причины — окно потеряло фокус, система
    // не дала прав. Без разбора отказа не появлялось вообще ничего: уведомление
    // стоит за await, и до него не доходило.
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        new Notice(t("chatCopied"));
      } catch {
        new Notice(t("chatCopyFailed"));
      }
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
      // Модель упёрлась в предел длины. Раньше оставалось дописывать руками или
      // просить заново — целиком, вместе с уже оплаченной половиной.
      if (msg.truncated) {
        const more = foot.createEl("button", { cls: "ai-msg-more", text: t("chatContinue") });
        more.onclick = () => void this.continueReply(msg);
      }

      const again = foot.createEl("button", { cls: "ai-msg-again clickable-icon" });
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

  /**
   * Ссылки, на которых построен ответ. Свёрнутым списком: их бывает десяток, а
   * разворачивают их, только когда ответу не поверили. Без них поисковый ответ
   * ничем не отличается от выдуманного — проверить нечего.
   */
  private addSources(bubble: HTMLElement, sources: Source[]): void {
    const details = bubble.createEl("details", { cls: "ai-sources" });
    details.createEl("summary", { text: t("chatSources", { n: sources.length }) });
    const list = details.createEl("ol", { cls: "ai-sources-list" });
    for (const source of sources) {
      // Нумерация сквозная, своя: в тексте ответа ссылок на неё уже нет, а
      // выброшенный повтор оставил бы в списке дырку.
      const item = list.createEl("li");
      const link = item.createEl("a", {
        cls: "ai-source-link",
        // Название бывает не у всех провайдеров — тогда показываем сам адрес.
        text: source.title || source.url,
        href: source.url,
      });
      link.setAttr("target", "_blank");
      // Ссылка ведёт наружу, в чужой веб: без rel открытая страница получает
      // доступ к окну, из которого её открыли.
      link.setAttr("rel", "noopener noreferrer");
      if (source.date) item.createSpan({ cls: "ai-source-date", text: source.date });
    }
  }

  private async renderMarkdown(md: string, el: HTMLElement, sources?: Source[]): Promise<void> {
    el.empty();
    const path = this.host.app.workspace.getActiveFile()?.path ?? "";
    // Хвосты вида [1][6][8] из текста убираем: после каждой фразы они мешают
    // читать, а сказать ничего не могут — источники и так лежат списком ниже.
    await MarkdownRenderer.render(this.host.app, stripCitations(md, sources), el, path, this);
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
