import {
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
  moment,
  setIcon,
} from "obsidian";
import {
  AiAction,
  cleanReply,
  hasText,
  offsetAt,
  sectionAt,
  sectionName,
  shortName,
  systemFor,
} from "./actions";
import { ApiConfig, ApiError, Usage, addUsage, chat } from "./api";
import { AttachmentStore } from "./attach";
import { chatToMarkdown } from "./chatnote";
import { diffWords } from "./diff";
import { clipNote } from "./history";
import { I18nKey, t } from "./i18n";
import { askConfirm } from "./modals";
import { QuickMenu, QuickScope, RECENT_LIMIT } from "./quickmenu";
import { ReplaceResult } from "./tools";
import { AiAssistSettingTab } from "./settings";
import { readHistory, readStore, writeHistoryFile, writeStore } from "./store";
import {
  ActionEntry,
  AiAssistSettings,
  Attachment,
  HistoryItem,
  QUICK_ASK,
  StoredChatMessage,
  activeConfig,
  configFor,
  isActionEntry,
  panelConfig,
  providerLabel,
  providerOf,
  streamAllowed,
} from "./types";
import { ChatHost, ChatView, VIEW_TYPE_CHAT } from "./view";

/** Сколько сообщений храним между запусками. */
const HISTORY_LIMIT = 100;
/** Сколько символов результата показывать в журнале: он и так уже в заметке. */
const LOG_PREVIEW = 600;
/**
 * Сколько последних правок остаются отменяемыми по кнопке. В каждой записи два
 * полных текста, а при работе с целой заметкой это мегабайты: без предела карта
 * растёт всю сессию. Ctrl+Z в редакторе от этого не зависит.
 */
const UNDO_LIMIT = 20;

/**
 * Своя часть контекстного меню редактора. Пункты с одинаковой секцией Obsidian
 * держит вместе и отделяет чертой — иначе они разъехались бы по чужим группам.
 */
const MENU_SECTION = "ai-assist";

/** Куски заметки, которые плагин умеет взять сам, — от меньшего к большему. */
type ScopeKind = "paragraph" | "section" | "note";
const SCOPES: ScopeKind[] = ["paragraph", "section", "note"];
const SCOPE_LABEL: Record<ScopeKind, I18nKey> = {
  paragraph: "scopeParagraph",
  section: "scopeSection",
  note: "scopeNote",
};

/** Что нужно, чтобы отменить одну правку — и чтобы переделать её заново. */
interface UndoRecord {
  path: string;
  from: EditorPosition;
  written: string;
  original: string;
  /**
   * Текст, над которым работали, и где он лежал. Для замены это то же, что
   * original, а для дописывания — нет: там написанное легло рядом с исходным
   * куском, и без его координат прогнать действие ещё раз не по чему.
   */
  source: { from: EditorPosition; text: string };
  /** Какое действие это было. Разовый промпт в настройках не живёт — храним целиком. */
  action: AiAction;
}

interface Selection {
  text: string;
  from: EditorPosition;
  to: EditorPosition;
  /** Текст взят без выделения — заметка, раздел или абзац под курсором. */
  implicit: boolean;
  /** Чем этот кусок назвать в журнале: заголовок раздела, если он есть. */
  label?: string;
}

/** Куда ляжет правка. Файл запоминаем отдельно: пока модель думает, во вьюхе
 * может открыться другая заметка, и одной проверки по вьюхе для этого мало. */
interface EditTarget {
  action: AiAction;
  sel: Selection;
  filePath: string;
  editor: Editor;
  view: MarkdownView;
}

/**
 * Правка, оборванная на пределе длины модели. В карточку журнала кладётся
 * только начало ответа, а дописывать надо от последнего символа — поэтому
 * полный текст живёт здесь, в памяти сессии.
 */
interface Unfinished {
  target: EditTarget;
  cfg: ApiConfig;
  system: string;
  /** Всё, что модель успела написать, — целиком, без обрезки для карточки. */
  text: string;
  /**
   * Расход всех заходов вместе. Первый — самый дорогой (весь кусок туда,
   * тысячи знаков обратно), и потерять его значит показать цену правки вдвое
   * меньше настоящей: до этого он выбрасывался вместе с оборванным ответом.
   */
  usage: Usage | null;
}

export default class AiAssistPlugin extends Plugin implements ChatHost {
  settings!: AiAssistSettings;
  history: HistoryItem[] = [];
  /**
   * Картинки, приложенные к вопросам. Держит их плагин, а не панель: панель
   * закрывают и открывают, а вложение от этого пропадать не должно. Тех, что
   * легли в хранилище, это не касается — они читаются с диска по пути.
   */
  attachments = new AttachmentStore();
  /**
   * Что приложено к следующему вопросу. Здесь, а не в панели, по той же
   * причине: вьюха умирает вместе с закрытой вкладкой, и список приложенного
   * умирал бы с ней — при живых данных, которые её пережили.
   */
  files: Attachment[] = [];
  private undoable = new Map<string, UndoRecord>();
  /** Оборванные правки, которые ещё можно дописать. Живут до перезапуска. */
  private unfinished = new Map<string, Unfinished>();

  private statusEl: HTMLElement | null = null;
  private mobileNotice: Notice | null = null;
  private running: AbortController | null = null;
  private saveTimer: number | null = null;
  private settingsTimer: number | null = null;
  private lastRun: AiAction | null = null;
  /**
   * Поля верхнего уровня data.json, которых мы не знаем: их написала версия
   * новее нашей. Держим их при себе и возвращаем в файл при каждой записи —
   * иначе вторая машина потеряет своё после первого сохранения здесь.
   */
  private rest: Record<string, unknown> = {};
  /** Вкладка настроек: её надо перерисовать, если файл переписали снаружи. */
  private settingTab: AiAssistSettingTab | null = null;

  async onload(): Promise<void> {
    await this.loadStore();

    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));
    this.addRibbonIcon("bot-message-square", t("chatTitle"), () => this.showChat());
    this.settingTab = new AiAssistSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    if (!Platform.isMobile) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass("ai-status");
      this.statusEl.hide();
      // Без подписи синий текст в углу читается как индикатор, а не как кнопка.
      this.statusEl.setAttr("aria-label", t("busyStop"));
      this.statusEl.onclick = () => this.stopAll();
    }

    this.addCommand({
      id: "open-chat",
      name: t("cmdOpenChat"),
      callback: () => this.showChat(),
    });

    this.addCommand({
      id: "clean-chat",
      name: t("cmdPrivateChat"),
      // Alt+2 рядом с быстрым меню на Alt+1 — и занимаются они одной настройкой:
      // раскладку либо отдаёшь плагину, либо расставляешь сам.
      hotkeys: this.settings.defaultHotkey ? [{ modifiers: ["Alt"], key: "2" }] : [],
      callback: () => {
        this.openChat()
          .then((view) => {
            view.newChat(true);
            if (!Platform.isMobile) view.focusInput();
          })
          .catch((e) => new Notice(String(e instanceof Error ? e.message : e)));
      },
    });

    this.addCommand({
      id: "stop",
      name: t("cmdStop"),
      checkCallback: (checking) => {
        const busy = this.running !== null || this.chatView?.busy === true;
        if (busy && !checking) this.stopAll();
        return busy;
      },
    });

    this.addCommand({
      id: "ask-selection",
      name: t("cmdSendSelection"),
      editorCallback: (editor) => void this.askAboutSelection(editor),
    });

    this.addCommand({
      id: "quick-menu",
      name: t("cmdQuick"),
      // Alt+1 предлагается, а не навязывается: команды регистрируются один раз
      // при загрузке, поэтому смена настройки доезжает после перезагрузки
      // плагина. Своё назначение из настроек Obsidian сильнее умолчания всегда.
      hotkeys: this.settings.defaultHotkey ? [{ modifiers: ["Alt"], key: "1" }] : [],
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.openQuickMenu(editor, view);
      },
    });

    this.addCommand({
      id: "repeat",
      name: t("cmdRepeat"),
      editorCallback: (editor, view) => {
        const last = this.lastRun;
        if (!last || !(view instanceof MarkdownView)) {
          new Notice(t("nothingToRepeat"));
          return;
        }
        // Промпт встроенного действия могли переписать в настройках после
        // запуска — берём свежую версию. Разовый промпт из быстрого меню в
        // списке действий не лежит и живёт только здесь: без запасного варианта
        // нельзя было бы повторить ровно то, ради чего повтор и заведён.
        const action = this.settings.actions.find((a) => a.id === last.id) ?? last;
        void this.runAction(action, editor, view);
      },
    });

    this.registerActionCommands();

    // Правая кнопка по выделению: до сих пор в плагин вела только клавиша или
    // палитра команд, а на телефоне — одна палитра.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) =>
        this.fillMenu(menu, editor, info),
      ),
    );
  }

  onunload(): void {
    this.stopAll();
    // Временные ссылки на картинки живут до конца сеанса сами по себе —
    // отпускаем их вместе с плагином, иначе это утечка ровно на их размер.
    this.attachments.clear();
    this.files = [];
    // Отложенная запись истории: таймер мог быть заведён за секунду до
    // выгрузки. Гасим его и дописываем сейчас — иначе он сработает, когда
    // плагина уже нет, а последние сообщения пропадут.
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.writeHistory(this.history.slice(-HISTORY_LIMIT));
    }
    // То же с черновиком: панель закрывают посреди фразы, и последние буквы
    // ушли бы вместе с таймером.
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
      void this.saveData(writeStore(this.settings, this.rest));
    }
  }

  // ——————————————————————— контекстное меню ———————————————————————

  /**
   * Пункты плагина в меню редактора. Без выделения не показываем ничего:
   * работа идёт над выделенным текстом, а случайный щелчок по «Исправить
   * орфографию» в пустом месте переписал бы всю заметку целиком.
   */
  private fillMenu(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    const mode = this.settings.editorMenu;
    if (mode === "none" || !hasText(editor.getSelection())) return;
    if (!(info instanceof MarkdownView)) return;
    const view = info;

    if (mode === "actions") {
      // Ровно то, что лежит на клавишах быстрого меню: держать два разных
      // набора — значит настраивать их по отдельности. Одно действие может
      // стоять на двух клавишах, в меню оно нужно один раз.
      const seen = new Set<string>();
      for (const id of this.settings.quickSlots) {
        if (id === QUICK_ASK || seen.has(id)) continue;
        seen.add(id);
        const action = this.settings.actions.find((a) => a.id === id);
        if (!action) continue;
        menu.addItem((item) =>
          item
            .setSection(MENU_SECTION)
            .setTitle(action.name)
            .setIcon(action.icon)
            .onClick(() => void this.runAction(action, editor, view)),
        );
      }
    }

    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION)
        .setTitle(t("menuQuick"))
        .setIcon("wand-sparkles")
        .onClick(() => this.openQuickMenu(editor, view)),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION)
        .setTitle(t("menuAsk"))
        .setIcon("message-circle-question")
        .onClick(() => void this.askAboutSelection(editor)),
    );
  }

  // ——————————————————————— хранилище ———————————————————————

  /**
   * Где лежит лента. Отдельно от настроек — она меняется на каждое слово.
   * null — своей папки у плагина нет: класть ленту в корень хранилища, к
   * заметкам, нельзя, а пустой путь делал ровно это.
   */
  private historyPath(): string | null {
    return this.manifest.dir ? `${this.manifest.dir}/history.json` : null;
  }

  /**
   * Отложить копию непрочитанного файла, пока мы не написали поверх него свой.
   * Существующую копию не трогаем: в ней настоящие ключи, а сегодняшний файл
   * мог быть уже огрызком, и вторая попытка затёрла бы хорошее плохим.
   *
   * Расширение .bak выбрано не случайно: файлы плагина Obsidian синхронизирует
   * по точному списку (manifest.json, main.js, styles.css, data.json), и копия
   * в него не попадает — она останется на этой машине.
   */
  private async rescue(name: string): Promise<string | null> {
    const dir = this.manifest.dir;
    if (!dir) return null;
    const to = `${dir}/${name}.bak`;
    try {
      if (await this.app.vault.adapter.exists(to)) return to;
      const raw = await this.app.vault.adapter.read(`${dir}/${name}`);
      if (!raw) return null;
      await this.app.vault.adapter.write(to, raw);
      return to;
    } catch {
      return null;
    }
  }

  /**
   * Лента из своего файла, а если его нет — из настроек: там она жила до сих
   * пор. Прочитанное сразу переносим, и в data.json остаются одни настройки.
   */
  private async loadHistory(stored: HistoryItem[] | undefined): Promise<HistoryItem[]> {
    const path = this.historyPath();
    // Писать некуда — переносить тоже некуда: остаётся то, что лежит в настройках.
    if (!path) return Array.isArray(stored) ? stored.slice(-HISTORY_LIMIT) : [];
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const read = readHistory(JSON.parse(await this.app.vault.adapter.read(path)));
        // Лента расходная, поэтому копию делаем молча: пугать человека на
        // старте из-за вчерашнего разговора незачем, а вернуть его — можно.
        if (read.broken) await this.rescue("history.json");
        return read.items;
      }
    } catch {
      await this.rescue("history.json");
      return [];
    }
    if (!Array.isArray(stored) || stored.length === 0) return [];
    const history = stored.slice(-HISTORY_LIMIT);
    await this.writeHistory(history);
    await this.saveData(writeStore(this.settings, this.rest));
    return history;
  }

  private async writeHistory(history: HistoryItem[]): Promise<void> {
    const path = this.historyPath();
    if (!path) return;
    try {
      await this.app.vault.adapter.write(path, JSON.stringify(writeHistoryFile(history)));
    } catch (e) {
      console.error("ai-assist: не удалось записать историю", e);
    }
  }

  private async loadStore(): Promise<void> {
    const read = readStore(await this.loadData());
    this.settings = read.settings;
    this.rest = read.rest;
    if (read.state === "broken") {
      const bak = await this.rescue("data.json");
      // Молчать тут нельзя: настройки заменились умолчаниями, и первое же
      // сохранение закрепит это на диске. Пятнадцать секунд — чтобы успеть
      // прочитать путь.
      new Notice(bak ? t("dataBroken", { path: bak }) : t("dataBrokenNoCopy"), 15000);
    }
    this.history = (await this.loadHistory(read.legacy)).slice(-HISTORY_LIMIT);

    // Вчерашний разговор не подхватываем: Obsidian открывается с чистой лентой.
    // Что стоило сохранить — уходит в заметку кнопкой в шапке панели.
    if (this.settings.freshStart) {
      if (this.history.length > 0) {
        this.history = [];
        this.persistHistory();
      }
      // Приватный чат — свойство разговора, а разговора больше нет. Приватное окно
      // тоже не открывается само на следующий день.
      this.settings.privateChat = false;
      return;
    }

    // Obsidian могли закрыть посреди правки — иначе запись навсегда осталась бы
    // «идёт…», с живой кнопкой «Стоп» для запроса, которого давно нет.
    for (const item of this.history) {
      if (!isActionEntry(item)) continue;
      if (item.status === "running") item.status = "stopped";
      // Дописывать нечего: начало ответа лежало в памяти сессии, а её больше
      // нет. Кнопка «Дописать» тут обещала бы то, чего не сделает.
      item.truncated = false;
    }
  }

  // ——————————————————————— чат в заметку ———————————————————————

  chatMarkdown(): string {
    return chatToMarkdown(this.history, this.chatModel(), moment().format("DD.MM.YYYY HH:mm"));
  }

  /**
   * Кем подписать сохранённый разговор. Не тем, что стоит в шапке настроек: в
   * приватном чате отвечает своя модель, а «спросить заново» умеет позвать
   * третью на один ответ — и в заметке оказывалась бы модель, не сказавшая в
   * этом разговоре ни слова. Берём последнюю, что действительно отвечала.
   */
  private chatModel(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const item = this.history[i];
      if (!isActionEntry(item) && item.role === "assistant" && item.model) return item.model;
    }
    return this.chatConfig().model;
  }

  /**
   * Имя заметки с разговором. Дата файлы различает, но ничего не говорит: в
   * списке заметок все чаты выглядят одинаково. Берём начало первого вопроса —
   * по нему разговор и вспоминается, а дата и модель есть внутри, первой строкой.
   */
  private chatTitle(): string {
    const first = this.history.find(
      (item): item is StoredChatMessage => !isActionEntry(item) && item.role === "user",
    );
    const ask = (first?.content ?? "").replace(/\s+/g, " ").trim();
    if (!ask) return t("chatNoteTitle", { when: moment().format("YYYY-MM-DD HH-mm") });

    let head = ask.slice(0, 40);
    if (ask.length > 40) {
      // Режем по слову, но не оставляем огрызок: «Чат — как» хуже целой строки.
      const space = head.lastIndexOf(" ");
      if (space > 20) head = head.slice(0, space);
    }
    return t("chatNoteTitleAsk", { ask: head });
  }

  async saveChat(): Promise<void> {
    const markdown = this.chatMarkdown();
    if (!markdown) {
      new Notice(t("chatNothingToSave"));
      return;
    }
    const path = await this.createNote(this.chatTitle(), markdown);
    if (!path) return;
    // Открываем новой вкладкой: заметка, над которой шла работа, должна
    // остаться на месте.
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async saveSettings(): Promise<void> {
    // Отложенная запись больше не нужна: сейчас на диск уйдут все настройки
    // разом, вместе с тем, ради чего она была заведена.
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    await this.saveData(writeStore(this.settings, this.rest));
    this.registerActionCommands();
    this.chatView?.refreshHeader();
  }

  /**
   * Тихая запись настроек: черновик вопроса меняется на каждую букву, а
   * saveSettings — это ещё и перерегистрация всех команд плагина.
   */
  saveSettingsSoon(): void {
    if (this.settingsTimer !== null) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = null;
      void this.saveData(writeStore(this.settings, this.rest));
    }, 1000);
  }

  /**
   * Файл настроек переписан снаружи — обычно синхрой со второй машины.
   * Obsidian зовёт этот хук, только если файл на диске новее прочитанного
   * нами, значит привезённое новее того, что лежит в памяти, и побеждает оно.
   * Без хука картина была обратной: плагин держал своё старое, а ближайшее
   * сохранение клало его поверх нового — а взводится оно на каждую букву
   * черновика.
   *
   * Ленту не трогаем нарочно. Во-первых, history.json синхра не возит: в её
   * списке файлов плагина только manifest.json, main.js, styles.css и
   * data.json. Во-вторых, loadStore при включённом «начинать с пустого чата»
   * чистит историю — и привезённые настройки снесли бы живой разговор.
   */
  async onExternalSettingsChange(): Promise<void> {
    // Взведённую запись гасим, не сбрасывая на диск: она затоптала бы то, что
    // мы прямо сейчас собираемся прочитать.
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    const read = readStore(await this.loadData());
    // Разбирать нечего — своё в памяти целее того, что на диске.
    if (read.state === "broken") return;

    // Черновик вопроса — про эту машину и эту секунду, чужой ему не указ.
    const draft = this.settings.draft;
    this.settings = read.settings;
    this.settings.draft = draft;
    this.rest = read.rest;

    // Действия могли поменяться: у каждого своя команда с хоткеем.
    this.registerActionCommands();
    this.chatView?.refreshHeader();
    // Открытая вкладка настроек показывала бы прежние значения.
    if (this.settingTab?.containerEl.isShown()) this.settingTab.display();
  }

  /** История меняется часто — пишем на диск не чаще раза в секунду. */
  persistHistory(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.writeHistory(this.history.slice(-HISTORY_LIMIT));
    }, 1000);
  }

  // ——————————————————————— команды действий ———————————————————————

  /**
   * У каждого действия своя команда, чтобы ей можно было назначить хоткей.
   * Повторный addCommand с тем же id просто перезаписывает команду, а
   * checkCallback прячет команды удалённых действий до перезапуска.
   */
  private registerActionCommands(): void {
    for (const action of this.settings.actions) {
      this.addCommand({
        id: `action-${action.id}`,
        name: action.name,
        icon: action.icon,
        editorCheckCallback: (checking, editor, view) => {
          const live = this.settings.actions.find((a) => a.id === action.id);
          if (!live || !(view instanceof MarkdownView)) return false;
          if (!checking) void this.runAction(live, editor, view);
          return true;
        },
      });
    }
  }

  // ——————————————————————— выполнение действия ———————————————————————

  /**
   * Выделение с проверкой. Отказ объясняем вслух: молчаливое «ничего не
   * произошло» пользователь принимает за поломку плагина.
   */
  private grabChecked(editor: Editor): Selection | null {
    const sel = this.grabSelection(editor);
    if (!sel) {
      new Notice(t("noSelection"));
      return null;
    }
    return sel;
  }

  /**
   * То же, но с вопросом, если текста больше порога. Забыть выделить на длинной
   * заметке — обычное дело, и уезжает она в API целиком: это и деньги, и ответ,
   * который модель почти наверняка оборвёт на полуслове. Поэтому не запрет, а
   * вопрос: решать всё равно пользователю, ему нужно только знать цену.
   */
  private async grabConfirmed(editor: Editor): Promise<Selection | null> {
    const sel = this.grabChecked(editor);
    return sel ? this.confirmSize(sel) : null;
  }

  /** Спросить про длину — для куска, который уже взяли где-то ещё. */
  private async confirmSize(sel: Selection): Promise<Selection | null> {
    const limit = this.settings.warnOver;
    if (limit > 0 && sel.text.length > limit) {
      const go = await askConfirm(
        this.app,
        t("tooBigTitle"),
        t("tooBigAsk", { chars: sel.text.length, limit }),
        t("tooBigGo"),
      );
      if (!go) return null;
    }
    return sel;
  }

  /** Выделение, а если его нет — заметка, раздел или абзац под курсором. */
  private grabSelection(editor: Editor): Selection | null {
    const selected = editor.getSelection();
    if (hasText(selected)) {
      return {
        text: selected,
        from: editor.getCursor("from"),
        to: editor.getCursor("to"),
        implicit: false,
      };
    }
    if (this.settings.noSelection === "none") return null;
    return this.grabScope(editor, this.settings.noSelection);
  }

  /**
   * Кусок заметки заданного охвата. Отдельно от настройки: тот же расчёт нужен
   * быстрому меню, которое показывает соседние охваты и даёт переключить их на
   * один раз, не заходя в настройки.
   */
  private grabScope(editor: Editor, kind: ScopeKind): Selection | null {
    const last = editor.lastLine();
    if (kind === "note") {
      const from = { line: 0, ch: 0 };
      const to = { line: last, ch: editor.getLine(last).length };
      const text = editor.getRange(from, to);
      return hasText(text) ? { text, from, to, implicit: true } : null;
    }

    if (kind === "section") {
      // Разбираем текст редактора, а не файл на диске: правим то, что набрано
      // сию секунду, и заголовки надо считать по нему же.
      const lines = editor.getValue().split("\n");
      const found = sectionAt(lines, editor.getCursor().line);
      const from = { line: found.from, ch: 0 };
      const to = { line: found.to, ch: editor.getLine(found.to).length };
      const text = editor.getRange(from, to);
      if (!hasText(text)) return null;
      return { text, from, to, implicit: true, label: sectionName(lines[found.from]) };
    }

    const cursor = editor.getCursor();
    if (!hasText(editor.getLine(cursor.line))) return null;

    let start = cursor.line;
    while (start > 0 && hasText(editor.getLine(start - 1))) start--;
    let end = cursor.line;
    while (end < last && hasText(editor.getLine(end + 1))) end++;

    const from = { line: start, ch: 0 };
    const to = { line: end, ch: editor.getLine(end).length };
    return { text: editor.getRange(from, to), from, to, implicit: true };
  }

  /**
   * Прогнать действие. Готовый кусок приходит из быстрого меню — там его уже
   * взяли и показали, и брать заново значило бы взять другой, если охват
   * переключили.
   */
  async runAction(
    action: AiAction,
    editor: Editor,
    view: MarkdownView,
    ready?: Selection,
    config?: ApiConfig,
  ): Promise<void> {
    if (this.running) {
      new Notice(t("busyBar"));
      return;
    }
    const sel = ready ? await this.confirmSize(ready) : await this.grabConfirmed(editor);
    if (!sel) return;
    // Вопрос про длину — это модальное окно, и пока оно висело, правку могли
    // запустить ещё раз. Без этой проверки два прогона перетирали друг другу
    // this.running, и «Стоп» доставался только последнему.
    if (this.running) {
      new Notice(t("busyBar"));
      return;
    }

    const target: EditTarget = { action, sel, filePath: view.file?.path ?? "", editor, view };
    this.lastRun = action;

    const system = systemFor(action);
    // Чем прогонять: обычно тем, что стоит в шапке панели, но у действия может
    // быть своя модель, а «переделать» умеет позвать третью на один прогон.
    const cfg = config ?? this.configForAction(action);
    if (!cfg) return;

    if (action.mode === "chat") {
      const chatView = await this.openChat();
      // Действие из заметки само себе контекст: прежний разговор ему не нужен,
      // а платить за него пришлось бы на каждом следующем вопросе.
      chatView.freshTalk();
      await chatView.submit(sel.text, {
        display: `**${action.name}**\n\n${sel.text}`,
        system,
        fresh: true,
        // Запрос из заметки: без инструментов правки и без заметки в контексте.
        fromEditor: true,
        // И берём ровно то, на что показали. Плашка в панели могла держать
        // прошлый фрагмент — целую главу, подхваченную, когда она была
        // выделена, — и он уезжал вместе с выделенным абзацем, за те же деньги.
        quote: null,
        config: cfg,
      });
      return;
    }

    // Ссылку держим локально: stopAll() обнуляет this.running, и по нему уже
    // не узнать, что запрос прервали — прерванный ответ уехал бы в заметку.
    const controller = new AbortController();
    this.running = controller;

    const entry = this.newEntry(action, cfg.model, sel.label);

    // Всё, что может бросить, — внутри try: иначе finally не отработает и
    // this.running останется занятым до перезапуска Obsidian.
    try {
      this.showBusy(shortName(action), 0);
      this.history.push(entry);
      this.chatView?.renderAction(entry);

      const result = await chat(
        cfg,
        [
          { role: "system", content: system },
          { role: "user", content: sel.text },
        ],
        {
          stream: this.settings.stream && streamAllowed(providerOf(cfg)),
          signal: controller.signal,
          wantUsage: this.settings.showUsage,
          onDelta: (chunk) => {
            this.showBusy(shortName(action), chunk.length);
            entry.content = (entry.content + chunk).slice(-LOG_PREVIEW);
            this.chatView?.renderAction(entry);
          },
        },
      );

      if (controller.signal.aborted) {
        this.finishEntry(entry, "stopped");
        return;
      }
      if (!hasText(result.text)) {
        // В заметку размышления не годятся — это не правленый текст, а рассуждения
        // о нём. Но показать их надо: за них заплачено, и это всё, что осталось от
        // запроса. Хвост, а не начало: вывод у модели в конце.
        if (hasText(result.reasoning)) entry.content = result.reasoning.slice(-LOG_PREVIEW);
        this.finishEntry(entry, "error", t("emptyReply"));
        new Notice(t("emptyReply"));
        return;
      }
      // Модель упёрлась в свой предел длины и оборвала ответ на полуслове.
      // В заметку он не пойдёт: замена выглядела бы как обычная правка, а на
      // деле стёрла бы половину текста. Сам ответ остаётся в карточке.
      if (result.truncated) {
        this.holdUnfinished(entry, { target, cfg, system, text: result.text, usage: result.usage });
        new Notice(t("cutOff"), 10000);
        return;
      }

      const replacement = cleanReply(result.text, sel.text);
      if (replacement === sel.text) {
        this.finishEntry(entry, "unchanged");
        new Notice(t("unchanged", { action: shortName(action) }));
        return;
      }

      this.applyResult(entry, target, replacement, result.usage);
    } catch (e) {
      if (controller.signal.aborted) {
        this.finishEntry(entry, "stopped");
        new Notice(t("aborted"));
      } else {
        const message = e instanceof ApiError ? e.message : String(e);
        this.finishEntry(entry, "error", message);
        new Notice(message, 8000);
      }
    } finally {
      if (this.running === controller) this.running = null;
      this.hideBusy();
    }
  }

  /**
   * Запись журнала: правка видна в панели справа — что запущено, что получилось
   * и что именно изменилось. Панель может быть закрыта, поэтому запись живёт в
   * истории, а карточка — лишь её отражение.
   */
  private newEntry(action: AiAction, model: string, scope?: string): ActionEntry {
    return {
      kind: "action",
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      // Раздел взят без выделения, и на экране его границ не видно — пусть
      // хотя бы карточка говорит, над чем шла работа.
      action: scope ? `${shortName(action)} · ${scope}` : shortName(action),
      status: "running",
      content: "",
      model,
    };
  }

  /**
   * Хвост правки: положить результат в заметку, запомнить отмену и закрыть
   * запись журнала.
   */
  private applyResult(
    entry: ActionEntry,
    target: EditTarget,
    replacement: string,
    usage: Usage | null,
  ): void {
    const { action, sel, filePath, editor, view } = target;

    // Пока модель думала, в заметке могли печатать — тогда сохранённые
    // координаты указывают уже не туда, и замена съест чужой текст. Тот же
    // способ, что в undoAction: сверяем, что на месте лежит ровно то, что
    // мы отправляли. Ответ при этом не пропадает — он остался в журнале.
    if (view.file?.path !== filePath || editor.getRange(sel.from, sel.to) !== sel.text) {
      entry.content = replacement.slice(0, LOG_PREVIEW);
      this.finishEntry(entry, "error", t("stale"));
      new Notice(t("stale"), 8000);
      return;
    }

    // Заметку могли перелистнуть, пока модель думала: возвращаемся к ней,
    // иначе правка уедет в чужой файл.
    if (this.app.workspace.getActiveViewOfType(MarkdownView) !== view) {
      this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    }

    let written = replacement;
    if (action.mode === "append") {
      const tail = replacement.startsWith("\n") ? replacement : "\n\n" + replacement;
      editor.replaceRange(tail, sel.to);
      editor.setCursor(editor.offsetToPos(editor.posToOffset(sel.to) + tail.length));
      written = tail;
    } else {
      editor.replaceRange(replacement, sel.from, sel.to);
      // Оставляем результат выделенным: можно сразу отменить (Ctrl+Z) или
      // прогнать другим действием.
      editor.setSelection(sel.from, editor.offsetToPos(editor.posToOffset(sel.from) + replacement.length));
    }

    // Данные для кнопки «Отменить правку» держим в памяти: после перезапуска
    // возвращать текст вслепую опасно — заметку могли переписать вручную.
    this.undoable.set(entry.id, {
      path: filePath,
      from: action.mode === "append" ? sel.to : sel.from,
      written,
      original: action.mode === "append" ? "" : sel.text,
      source: { from: sel.from, text: sel.text },
      action,
    });
    // Map перебирается в порядке добавления — лишнее уходит с самых старых.
    while (this.undoable.size > UNDO_LIMIT) {
      const oldest = this.undoable.keys().next().value;
      if (oldest === undefined) break;
      this.undoable.delete(oldest);
    }

    this.finishEntry(entry, "done", undefined, {
      before: action.mode === "append" ? "" : sel.text,
      after: replacement,
      usage,
    });
    new Notice(t("applied", { action: shortName(action) }));
  }

  /** Закрывает запись журнала: считает список правок и обновляет карточку. */
  private finishEntry(
    entry: ActionEntry,
    status: ActionEntry["status"],
    error?: string,
    result?: { before: string; after: string; usage: Usage | null },
  ): void {
    entry.status = status;
    entry.error = error;
    if (result) {
      entry.content = result.after.slice(0, LOG_PREVIEW);
      const diff = result.before ? diffWords(result.before, result.after) : null;
      if (diff) {
        entry.segments = diff.segments;
        entry.tooMany = diff.tooMany;
        entry.added = diff.added;
        entry.removed = diff.removed;
      }
      if (result.usage) {
        entry.usage = { prompt: result.usage.prompt, completion: result.usage.completion };
      }
    }
    this.persistHistory();
    this.chatView?.renderAction(entry);
  }

  /**
   * Открытая заметка по пути. Проверяем тип, а не приводим к нему: в неактивной
   * вкладке лист держит вместо вьюхи заглушку, и у неё нет ни file, ни editor.
   */
  private openNote(path: string): MarkdownView | null {
    return (
      this.app.workspace
        .getLeavesOfType("markdown")
        .map((leaf) => leaf.view)
        .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === path) ?? null
    );
  }

  /** Возврат правки: меняем написанное обратно, если его ещё не тронули. */
  async undoAction(id: string): Promise<boolean> {
    const record = this.undoable.get(id);
    if (!record) return false;

    const view = this.openNote(record.path);

    // Заметку могли закрыть — тогда правим файл. Открытую правим через редактор:
    // так уцелеет несохранённое и сработает обычный Ctrl+Z.
    if (!view) return this.undoInFile(record, id);

    const editor = view.editor;
    const to = editor.offsetToPos(editor.posToOffset(record.from) + record.written.length);
    // Если на месте правки уже другой текст — молча ничего не портим.
    if (editor.getRange(record.from, to) !== record.written) return false;

    editor.replaceRange(record.original, record.from, to);
    this.undoable.delete(id);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return true;
  }

  /** Тот же возврат, но в закрытой заметке — по координатам в сыром тексте. */
  private async undoInFile(record: UndoRecord, id: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) return false;

    let done = false;
    try {
      await this.app.vault.process(file, (text) => {
        const at = offsetAt(text, record.from.line, record.from.ch);
        if (at === null) return text;
        // Ровно та же проверка, что и в открытой заметке: возвращаем, только
        // если на месте правки лежит в точности написанное нами.
        if (text.slice(at, at + record.written.length) !== record.written) return text;
        done = true;
        return text.slice(0, at) + record.original + text.slice(at + record.written.length);
      });
    } catch {
      return false;
    }
    if (done) this.undoable.delete(id);
    return done;
  }

  /**
   * Переделать правку: вернуть текст и прогнать по нему то же действие ещё раз.
   * Ответ модели — вещь случайная, и «не понравилось» до сих пор означало
   * Ctrl+Z руками плюс поиск того же действия заново.
   */
  async repeatAction(id: string, config?: ApiConfig): Promise<void> {
    // Занятость проверяем до возврата текста: иначе правка была бы снята, а
    // прогнать её заново runAction отказался бы — и текст остался бы прежним.
    if (this.running) {
      new Notice(t("busyBar"));
      return;
    }
    const record = this.undoable.get(id);
    if (!record) {
      // Карта отмены живёт в памяти сессии и не бесконечна — старую правку
      // переделать уже нечем.
      new Notice(t("logUndoFail"));
      return;
    }
    // Заметку нужно открыть до возврата: прогонять действие мы умеем только
    // через редактор, а откатить и остаться ни с чем — плохая мена.
    const view = this.openNote(record.path);
    if (!view) {
      new Notice(t("logRepeatOpen"));
      return;
    }
    if (!(await this.undoAction(id))) {
      new Notice(t("logUndoFail"));
      return;
    }

    // Старая карточка сразу становится отменённой: возврат уже случился, а
    // новая правка ляжет отдельной записью ниже.
    const entry = this.history.find(
      (item): item is ActionEntry => isActionEntry(item) && item.id === id,
    );
    if (entry) {
      entry.undone = true;
      this.persistHistory();
      this.chatView?.renderAction(entry);
    }

    const editor = view.editor;
    const { from, text } = record.source;
    const to = editor.offsetToPos(editor.posToOffset(from) + text.length);
    // Та же проверка, что и при возврате: работаем, только если на месте лежит
    // ровно тот текст, ради которого всё затевалось.
    if (editor.getRange(from, to) !== text) {
      new Notice(t("logUndoFail"));
      return;
    }
    editor.setSelection(from, to);
    await this.runAction(record.action, editor, view, undefined, config);
  }

  stopAction(): void {
    this.running?.abort();
  }

  /**
   * Отложить оборванную правку: карточка помечается «оборвано» и получает
   * кнопку «Дописать», а полный текст остаётся в памяти. Хвост карточки — конец
   * ответа, а не начало: дописывать будут от него, и по нему видно, где встали.
   */
  private holdUnfinished(entry: ActionEntry, held: Unfinished): void {
    this.unfinished.set(entry.id, held);
    // Тот же предел, что у карты отмены: в каждой записи целый текст, и на
    // большой заметке это мегабайты.
    while (this.unfinished.size > UNDO_LIMIT) {
      const oldest = this.unfinished.keys().next().value;
      if (oldest === undefined) break;
      this.unfinished.delete(oldest);
    }
    entry.content = held.text.slice(-LOG_PREVIEW);
    entry.truncated = true;
    // За оборванный ответ уже заплачено, и дописывать его могут не сразу — а то
    // и не станут вовсе. Расход показываем сейчас, иначе карточка молчит о
    // деньгах, которые с человека уже взяли.
    if (held.usage) {
      entry.usage = { prompt: held.usage.prompt, completion: held.usage.completion };
    }
    this.finishEntry(entry, "error", t("cutOff"));
  }

  /**
   * Дописать оборванную правку и применить целиком. Ответ модели обрывается на
   * длинной заметке регулярно, и до сих пор весь прогон уходил впустую: за
   * половину заплачено, а в заметку она не годится.
   */
  async continueAction(id: string): Promise<void> {
    if (this.running) {
      new Notice(t("busyBar"));
      return;
    }
    const held = this.unfinished.get(id);
    const entry = this.history.find(
      (item): item is ActionEntry => isActionEntry(item) && item.id === id,
    );
    if (!held || !entry) {
      new Notice(t("logContinueGone"));
      return;
    }

    const controller = new AbortController();
    this.running = controller;
    const { target, cfg, system } = held;
    const action = target.action;

    entry.status = "running";
    entry.error = undefined;
    this.chatView?.renderAction(entry);

    try {
      this.showBusy(shortName(action), 0);
      const result = await chat(
        cfg,
        [
          { role: "system", content: system },
          { role: "user", content: target.sel.text },
          // То, что уже написано, — репликой модели: продолжать она должна свой
          // текст, а не начинать заново.
          { role: "assistant", content: held.text },
          { role: "user", content: t("chatContinuePrompt") },
        ],
        {
          stream: this.settings.stream && streamAllowed(providerOf(cfg)),
          signal: controller.signal,
          wantUsage: this.settings.showUsage,
          onDelta: (chunk) => {
            this.showBusy(shortName(action), chunk.length);
            entry.content = (entry.content + chunk).slice(-LOG_PREVIEW);
            this.chatView?.renderAction(entry);
          },
        },
      );

      // Заход оплачен в любом случае — и когда его оборвали, и когда модель
      // снова не уложилась. Складываем сразу, пока результат под рукой.
      held.usage = addUsage(held.usage, result.usage);
      if (controller.signal.aborted) {
        // Остановили руками — то, что успело прийти, дописываем к отложенному:
        // следующая попытка начнёт с него, а не с прежнего места.
        held.text += result.text;
        this.holdUnfinished(entry, held);
        return;
      }
      held.text += result.text;
      // Модель может не уложиться и во второй раз — тогда просто предлагаем
      // дописать снова, уже от нового конца.
      if (result.truncated) {
        this.holdUnfinished(entry, held);
        new Notice(t("cutOff"), 10000);
        return;
      }

      const replacement = cleanReply(held.text, target.sel.text);
      this.unfinished.delete(id);
      if (replacement === target.sel.text) {
        entry.truncated = false;
        this.finishEntry(entry, "unchanged");
        new Notice(t("unchanged", { action: shortName(action) }));
        return;
      }
      entry.truncated = false;
      // Не `result.usage`: в карточке должна стоять цена всей правки, а не
      // одного последнего захода.
      this.applyResult(entry, target, replacement, held.usage);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : String(e);
      // Отложенное не выбрасываем: сеть отвалилась — попробуют ещё раз.
      this.holdUnfinished(entry, held);
      if (!controller.signal.aborted) new Notice(message, 8000);
    } finally {
      if (this.running === controller) this.running = null;
      this.hideBusy();
    }
  }

  /** Окно над выделением: пресеты на цифрах плюс поле для своего промпта. */
  private openQuickMenu(editor: Editor, view: MarkdownView): void {
    const sel = this.grabSelection(editor);
    const implicit = !sel || sel.implicit;

    // Кусок взят по настройке — считаем и соседние охваты: в окне их видно
    // размером, и передумать можно на месте, не заходя в настройки. Режим
    // «ничего» обещает не работать без выделения, и предлагать тут нечего.
    const grabbed = new Map<string, Selection>();
    const scopes: QuickScope[] = [];
    if (implicit && this.settings.noSelection !== "none") {
      for (const kind of SCOPES) {
        const found = this.grabScope(editor, kind);
        // Одинаковые куски в ряд не ставим: в заметке без заголовков раздел —
        // это она сама, и две кнопки об одном и том же только путают.
        if (!found || scopes.some((s) => s.text === found.text)) continue;
        grabbed.set(kind, found);
        scopes.push({ kind, label: t(SCOPE_LABEL[kind]), text: found.text });
      }
    }

    // Настройка могла не дать ничего — курсор на пустой строке при «абзаце», —
    // но раздел или заметка под ним есть: меню открываем, начав с них.
    const base = sel ?? (scopes.length ? grabbed.get(scopes[0].kind) ?? null : null);
    if (!base) {
      new Notice(t("noSelection"));
      return;
    }

    // Выбран тот охват, что стоит в настройках; если его вытеснил такой же по
    // тексту — то, что от него осталось в ряду.
    let current = scopes.find((s) => s.text === base.text)?.kind ?? "";
    const taken = (): Selection => grabbed.get(current) ?? base;

    // Курсор до открытия меню: если ничего не запустят, вернём его на место.
    const cursor = editor.getCursor();
    const show = () => {
      const { from, to } = taken();
      editor.setSelection(from, to);
    };
    if (implicit) show();

    const presets = this.settings.quickSlots.map((id) => {
      if (id === QUICK_ASK) {
        return {
          label: t("cmdSendSelection"),
          icon: "message-circle-question",
          run: () => void this.askAboutSelection(editor, taken()),
        };
      }
      const action = this.settings.actions.find((a) => a.id === id);
      if (!action) return null;
      return {
        label: action.name,
        icon: action.icon,
        run: () => void this.runAction(action, editor, view, taken()),
      };
    });

    new QuickMenu(this.app, {
      presets,
      selection: base.text,
      scopes,
      scope: current,
      recent: this.settings.recentPrompts,
      onScope: (kind) => {
        current = kind;
        show();
      },
      onCancel: () => {
        // Ничего не запустили — снимаем подсветку: меню не должно оставлять
        // после себя выделение, которого пользователь не делал.
        if (implicit) editor.setSelection(cursor, cursor);
      },
      onPrompt: (prompt, toChat) => void this.runPrompt(prompt, toChat, editor, view, taken()),
    }).open();
  }

  /** Разовый промпт из быстрого меню — обычное действие, только без имени. */
  private async runPrompt(
    prompt: string,
    toChat: boolean,
    editor: Editor,
    view: MarkdownView,
    ready?: Selection,
  ): Promise<void> {
    const recent = [prompt, ...this.settings.recentPrompts.filter((p) => p !== prompt)];
    this.settings.recentPrompts = recent.slice(0, RECENT_LIMIT);
    await this.saveSettings();

    await this.runAction(
      {
        id: "adhoc",
        name: prompt.length > 40 ? prompt.slice(0, 39) + "…" : prompt,
        prompt,
        mode: toChat ? "chat" : "replace",
        icon: "sparkles",
      },
      editor,
      view,
      ready,
    );
  }

  /**
   * Выделенное — в чат. Раньше фрагмент уходил вопросом сам по себе, и модель
   * отвечала встречным «а что с ним сделать?». Теперь он прикрепляется к полю
   * ввода: сначала вопрос, фрагмент уедет вместе с ним.
   */
  private async askAboutSelection(editor: Editor, ready?: Selection): Promise<void> {
    const sel = ready ? await this.confirmSize(ready) : await this.grabConfirmed(editor);
    if (!sel) return;
    const chatView = await this.openChat();
    chatView.freshTalk();
    chatView.takeSelection(sel.text);
    chatView.focusInput();
  }

  // ——————————————————————— индикатор занятости ———————————————————————

  private showBusy(action: string, delta: number): void {
    const text = t("busy", { action });
    if (this.statusEl) {
      this.statusEl.show();
      if (delta === 0) this.statusEl.dataset.chars = "0";
      const chars = Number(this.statusEl.dataset.chars ?? 0) + delta;
      this.statusEl.dataset.chars = String(chars);
      this.statusEl.empty();
      setIcon(this.statusEl.createSpan({ cls: "ai-status-icon" }), "circle-stop");
      this.statusEl.createSpan({ text: chars > 0 ? `${text} ${chars}` : text });
    } else if (!this.mobileNotice) {
      // На телефоне статус-бара нет, и до этой минуты правку нечем было
      // остановить: уведомление висело до конца запроса, а команда «Остановить»
      // ищется в палитре дольше, чем длится сама правка.
      this.mobileNotice = new Notice(`${text}\n${t("busyStopTap")}`, 0);
      this.mobileNotice.noticeEl.addClass("ai-busy-notice");
      this.mobileNotice.noticeEl.onclick = () => this.stopAll();
    }
  }

  private hideBusy(): void {
    this.statusEl?.hide();
    this.mobileNotice?.hide();
    this.mobileNotice = null;
  }

  stopAll(): void {
    this.running?.abort();
    this.running = null;
    this.chatView?.stop();
    this.hideBusy();
  }

  // ——————————————————————— ChatHost ———————————————————————

  apiConfig(): ApiConfig {
    return panelConfig(this.settings);
  }

  /**
   * Чем отвечает панель прямо сейчас. Отдельно от `apiConfig()`, потому что тот
   * нужен настройкам: кнопки «Получить список» и «Проверить» обязаны проверять
   * ровно того провайдера, которого в этот момент настраивают, а не того, к
   * кому ушёл бы вопрос из панели.
   *
   * Приватный чат может ходить своей моделью. Её нет или она не настроена —
   * отвечает та же, что и обычно: приватность держится на том, что из
   * хранилища ничего не уходит, и от выбора модели не зависит.
   */
  chatConfig(): ApiConfig {
    return activeConfig(this.settings);
  }

  /**
   * Чем прогонять действие. Обычно тем, что стоит в шапке панели, но у действия
   * может быть свой провайдер — дешёвая модель на орфографию, сильная на разбор,
   * поисковая на факты.
   *
   * Провайдер выбран, а модели у него нет — говорим вслух и не запускаем.
   * Молча уйти к тому, что в шапке, было бы подменой: действие, заведённое ради
   * поиска в вебе, отвечало бы из головы, и заметил бы это уже пользователь.
   */
  private configForAction(action: AiAction): ApiConfig | null {
    const name = action.provider;
    if (!name) return this.apiConfig();
    const cfg = configFor(this.settings, name);
    if (cfg) return cfg;
    new Notice(
      t("actProviderGone", { action: shortName(action), provider: providerLabel(name) }),
      8000,
    );
    return null;
  }

  /**
   * Заметка в центре окна. Пока пользователь работает в панели чата, активным
   * листом считается сама панель — тогда getActiveViewOfType вернёт null, и
   * без запасного пути кнопка «вставить» и контекст заметки не работали бы.
   */
  private centralNote(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const recent = this.app.workspace.getMostRecentLeaf();
    return recent?.view instanceof MarkdownView ? recent.view : null;
  }

  noteContext(): { path: string; text: string; clipped: boolean } | null {
    if (!this.settings.chatContextNote) return null;
    const view = this.centralNote();
    if (!view?.file) return null;
    const text = view.editor.getValue();
    if (!hasText(text)) return null;
    return { path: view.file.path, ...clipNote(text) };
  }

  /**
   * Выделение в открытой заметке — чтобы спросить о нём в чате. Уходя в панель,
   * пользователь теряет выделение из виду, но в редакторе оно живо: CodeMirror
   * держит диапазон, пока в заметке не щёлкнут снова.
   */
  selectionContext(): { path: string; text: string } | null {
    const view = this.centralNote();
    if (!view?.file) return null;
    const text = view.editor.getSelection();
    if (!hasText(text)) return null;
    return { path: view.file.path, text: clipNote(text).text };
  }

  insertIntoEditor(text: string): boolean {
    const view = this.centralNote();
    if (!view) return false;
    // Вставка идёт в позицию курсора, а если что-то выделено — на место выделения.
    view.editor.replaceSelection(text);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return true;
  }

  // ——————————————————————— инструменты модели ———————————————————————

  targetPath(): string | null {
    return this.centralNote()?.file?.path ?? null;
  }

  /**
   * Вьюха с той самой заметкой — или ничего, если пользователь успел уйти в
   * другую. Правку по просьбе модели кладём только туда, где её показали.
   */
  private noteAt(path: string): MarkdownView | null {
    const view = this.centralNote();
    return view?.file?.path === path ? view : null;
  }

  readNote(): { path: string; text: string; clipped: boolean } | null {
    const view = this.centralNote();
    if (!view?.file) return null;
    return { path: view.file.path, ...clipNote(view.editor.getValue()) };
  }

  noteText(path: string): string | null {
    return this.noteAt(path)?.editor.getValue() ?? null;
  }

  insertText(text: string, path: string): boolean {
    const view = this.noteAt(path);
    if (!view) return false;
    view.editor.replaceSelection(text);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return true;
  }

  /**
   * Точечная замена: главный способ править уже написанное, когда ничего не
   * выделено. Меняем только найденный кусок, а не весь текст, — так уцелеют
   * положение курсора и прокрутка, а Ctrl+Z вернёт ровно эту правку.
   */
  replaceInNote(find: string, replace: string, path: string): ReplaceResult {
    const view = this.noteAt(path);
    if (!view) return "gone";
    const editor = view.editor;
    const text = editor.getValue();

    const at = text.indexOf(find);
    if (at === -1) return "missing";
    // Второе вхождение — значит непонятно, какое из них имелось в виду.
    // Угадывать нельзя: правка уедет не туда, и заметит это уже пользователь.
    if (text.indexOf(find, at + find.length) !== -1) return "many";

    editor.replaceRange(replace, editor.offsetToPos(at), editor.offsetToPos(at + find.length));
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return "ok";
  }

  replaceNote(text: string, path: string): boolean {
    const view = this.noteAt(path);
    if (!view) return false;
    const editor = view.editor;
    const last = editor.lastLine();
    editor.replaceRange(text, { line: 0, ch: 0 }, { line: last, ch: editor.getLine(last).length });
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return true;
  }

  replaceSelection(text: string, path: string): boolean {
    const view = this.noteAt(path);
    if (!view || !hasText(view.editor.getSelection())) return false;
    view.editor.replaceSelection(text);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return true;
  }

  appendToNote(text: string, path: string): boolean {
    const view = this.noteAt(path);
    if (!view) return false;
    const editor = view.editor;
    const end = { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length };
    const lead = hasText(editor.getLine(end.line)) ? "\n\n" : "";
    editor.replaceRange(lead + text, end);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    return true;
  }

  /**
   * Куда положить новую заметку. Пустая строка — корень хранилища; он же
   * запасной вариант везде, где выбранной папки не оказалось: потерять заметку
   * хуже, чем положить её не туда.
   */
  private async newNoteFolder(): Promise<string> {
    const s = this.settings;
    if (s.newNoteFolder === "beside") {
      const parent = this.centralNote()?.file?.parent?.path ?? "";
      // Корень у Obsidian зовётся "/", а нам нужна пустая строка: иначе путь
      // выйдет с двойным слэшем.
      return parent === "/" ? "" : parent;
    }
    if (s.newNoteFolder === "folder") return this.ensureFolder(s.newNoteFolderPath);
    return "";
  }

  /**
   * Папка по пути из настроек, с созданием недостающего.
   *
   * Идём по одной ступени и каждую сверяем с уже существующими папками в
   * нижнем регистре. Иначе «архив/ии» при живом «Архив» заводит вторую папку
   * рядом с первой — а на Windows, где регистр в именах не различается,
   * createFolder на этом просто спотыкается.
   */
  private async ensureFolder(raw: string): Promise<string> {
    const wanted = raw
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (wanted.length === 0) return "";

    let path = "";
    for (const part of wanted) {
      const next = path ? `${path}/${part}` : part;
      const found = this.app.vault
        .getAllFolders()
        .find((f) => f.path.toLowerCase() === next.toLowerCase());
      if (found) {
        path = found.path;
        continue;
      }
      try {
        path = (await this.app.vault.createFolder(next)).path;
      } catch (e) {
        new Notice(t("toolFailed", { reason: e instanceof Error ? e.message : String(e) }));
        return "";
      }
    }
    return path;
  }

  /**
   * Новая заметка. Существующий файл не трогаем ни при каких условиях — при
   * совпадении имени берём следующий свободный номер.
   */
  async createNote(title: string, text: string): Promise<string | null> {
    const safe = title
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100);
    if (!safe) return null;

    const folder = await this.newNoteFolder();
    const dir = folder ? `${folder}/` : "";

    // Индекс Obsidian регистрозависим, а файловая система Windows и macOS — нет:
    // «Идеи.md» рядом с «идеи.md» коллизией не считается, и vault.create молча
    // пишет поверх чужой заметки. Поэтому сверяем сами, в нижнем регистре.
    const taken = new Set(this.app.vault.getFiles().map((f) => f.path.toLowerCase()));
    let path = `${dir}${safe}.md`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) {
      path = `${dir}${safe} ${n}.md`;
    }
    try {
      const file = await this.app.vault.create(path, text);
      new Notice(t("toolNoteCreated", { path: file.path }));
      return file.path;
    } catch (e) {
      new Notice(t("toolFailed", { reason: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }

  // ——————————————————————— панель ———————————————————————

  /**
   * Панель, если она уже поднята. Лист из неактивной вкладки Obsidian держит
   * отложенным: getLeavesOfType его находит, но вместо ChatView там заглушка
   * без наших методов — поэтому проверяем тип, а не приводим к нему.
   */
  get chatView(): ChatView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
    return leaf?.view instanceof ChatView ? leaf.view : null;
  }

  /** Открыть панель по кнопке: молча провалиться тут хуже, чем сказать вслух. */
  private showChat(): void {
    this.openChat()
      // Панель открывают, чтобы спросить, — курсор сразу в поле ввода. На
      // телефоне так лезет клавиатура на пол-экрана, и это уже помеха.
      .then((view) => {
        if (!Platform.isMobile) view.focusInput();
      })
      .catch((e) => new Notice(String(e instanceof Error ? e.message : e)));
  }

  async openChat(): Promise<ChatView> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("no leaf");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    await this.app.workspace.revealLeaf(leaf);
    // Панель, оставшаяся с прошлого запуска в свёрнутой боковой или в неактивной
    // вкладке, поднимается только здесь — без этого вернётся заглушка.
    await leaf.loadIfDeferred();
    const view = leaf.view;
    if (!(view instanceof ChatView)) throw new Error("chat view failed to load");
    return view;
  }
}
