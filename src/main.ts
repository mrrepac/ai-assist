import {
  Editor,
  EditorPosition,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
  moment,
  setIcon,
} from "obsidian";
import { AiAction, cleanReply, hasText, offsetAt, shortName, systemFor } from "./actions";
import { ApiConfig, ApiError, Usage, chat } from "./api";
import { chatToMarkdown } from "./chatnote";
import { diffWords } from "./diff";
import { t } from "./i18n";
import { QuickMenu, RECENT_LIMIT } from "./quickmenu";
import { ReplaceResult } from "./tools";
import { AiAssistSettingTab } from "./settings";
import {
  ActionEntry,
  AiAssistSettings,
  HistoryItem,
  QUICK_ASK,
  StoredData,
  isActionEntry,
  mergeSettings,
  streamAvailable,
} from "./types";
import { ChatHost, ChatView, VIEW_TYPE_CHAT } from "./view";

/** Сколько символов заметки максимум уходит в контекст чата. */
const CONTEXT_LIMIT = 40000;
/**
 * Сколько символов максимум берём, когда ничего не выделено. Обрезать здесь
 * нельзя — обрезанный ответ заменит собой всю заметку, — поэтому не работаем
 * вовсе. Выделенное таких вопросов не вызывает: раз выделили, значит хотели.
 */
const IMPLICIT_LIMIT = 40000;
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
 * Заметка в контекст: длинную берём началом. Что она обрезана, говорим и модели,
 * и пользователю — иначе ответ по половине текста выглядит как ответ по всему.
 */
function clip(text: string): { text: string; clipped: boolean } {
  if (text.length <= CONTEXT_LIMIT) return { text, clipped: false };
  return { text: text.slice(0, CONTEXT_LIMIT), clipped: true };
}

/** Что нужно, чтобы отменить одну правку. */
interface UndoRecord {
  path: string;
  from: EditorPosition;
  written: string;
  original: string;
}

interface Selection {
  text: string;
  from: EditorPosition;
  to: EditorPosition;
  /** Текст взят без выделения — вся заметка или абзац под курсором. */
  implicit: boolean;
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

export default class AiAssistPlugin extends Plugin implements ChatHost {
  settings!: AiAssistSettings;
  history: HistoryItem[] = [];
  private undoable = new Map<string, UndoRecord>();

  private statusEl: HTMLElement | null = null;
  private mobileNotice: Notice | null = null;
  private running: AbortController | null = null;
  private saveTimer: number | null = null;
  private lastRun: AiAction | null = null;

  async onload(): Promise<void> {
    await this.loadStore();

    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));
    this.addRibbonIcon("bot-message-square", t("chatTitle"), () => this.showChat());
    this.addSettingTab(new AiAssistSettingTab(this.app, this));

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
  }

  onunload(): void {
    this.stopAll();
    // Отложенная запись истории: таймер мог быть заведён за секунду до
    // выгрузки. Гасим его и дописываем сейчас — иначе он сработает, когда
    // плагина уже нет, а последние сообщения пропадут.
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.writeHistory(this.history.slice(-HISTORY_LIMIT));
    }
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
   * Лента из своего файла, а если его нет — из настроек: там она жила до сих
   * пор. Прочитанное сразу переносим, и в data.json остаются одни настройки.
   */
  private async loadHistory(stored: HistoryItem[] | undefined): Promise<HistoryItem[]> {
    const path = this.historyPath();
    // Писать некуда — переносить тоже некуда: остаётся то, что лежит в настройках.
    if (!path) return Array.isArray(stored) ? stored.slice(-HISTORY_LIMIT) : [];
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const raw = JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
        return Array.isArray(raw) ? (raw as HistoryItem[]) : [];
      }
    } catch {
      // Файл побился — лента не то, ради чего стоит падать при загрузке.
      return [];
    }
    if (!Array.isArray(stored) || stored.length === 0) return [];
    const history = stored.slice(-HISTORY_LIMIT);
    await this.writeHistory(history);
    await this.saveData({ settings: this.settings });
    return history;
  }

  private async writeHistory(history: HistoryItem[]): Promise<void> {
    const path = this.historyPath();
    if (!path) return;
    try {
      await this.app.vault.adapter.write(path, JSON.stringify(history));
    } catch (e) {
      console.error("ai-assist: не удалось записать историю", e);
    }
  }

  private async loadStore(): Promise<void> {
    const raw = (await this.loadData()) as Partial<StoredData> | null;
    this.settings = mergeSettings(raw?.settings ?? raw);
    this.history = (await this.loadHistory(raw?.history)).slice(-HISTORY_LIMIT);

    // Вчерашний разговор не подхватываем: Obsidian открывается с чистой лентой.
    // Что стоило сохранить — уходит в заметку кнопкой в шапке панели.
    if (this.settings.freshStart) {
      if (this.history.length > 0) {
        this.history = [];
        this.persistHistory();
      }
      return;
    }

    // Obsidian могли закрыть посреди правки — иначе запись навсегда осталась бы
    // «идёт…», с живой кнопкой «Стоп» для запроса, которого давно нет.
    for (const item of this.history) {
      if (isActionEntry(item) && item.status === "running") item.status = "stopped";
    }
  }

  // ——————————————————————— чат в заметку ———————————————————————

  chatMarkdown(): string {
    return chatToMarkdown(this.history, this.settings.model, moment().format("DD.MM.YYYY HH:mm"));
  }

  async saveChat(): Promise<void> {
    const markdown = this.chatMarkdown();
    if (!markdown) {
      new Notice(t("chatNothingToSave"));
      return;
    }
    const path = await this.createNote(
      t("chatNoteTitle", { when: moment().format("YYYY-MM-DD HH-mm") }),
      markdown,
    );
    if (!path) return;
    // Открываем новой вкладкой: заметка, над которой шла работа, должна
    // остаться на месте.
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings });
    this.registerActionCommands();
    this.chatView?.refreshHeader();
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
   * Выделение с проверкой размера. Оба отказа объясняем вслух: молчаливое
   * «ничего не произошло» пользователь принимает за поломку плагина.
   */
  private grabChecked(editor: Editor): Selection | null {
    const sel = this.grabSelection(editor);
    if (!sel) {
      new Notice(t("noSelection"));
      return null;
    }
    // Забыть выделить на длинной заметке — обычное дело, а уезжает она в API
    // целиком: и деньги, и почти наверняка отказ провайдера по длине запроса.
    if (sel.implicit && sel.text.length > IMPLICIT_LIMIT) {
      new Notice(t("tooBig", { chars: sel.text.length, limit: IMPLICIT_LIMIT }), 8000);
      return null;
    }
    return sel;
  }

  /** Выделение, а если его нет — вся заметка или абзац под курсором. */
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

    const last = editor.lastLine();
    if (this.settings.noSelection === "note") {
      const from = { line: 0, ch: 0 };
      const to = { line: last, ch: editor.getLine(last).length };
      const text = editor.getRange(from, to);
      return hasText(text) ? { text, from, to, implicit: true } : null;
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

  async runAction(action: AiAction, editor: Editor, view: MarkdownView): Promise<void> {
    if (this.running) {
      new Notice(t("busyBar"));
      return;
    }
    const sel = this.grabChecked(editor);
    if (!sel) return;

    const target: EditTarget = { action, sel, filePath: view.file?.path ?? "", editor, view };
    this.lastRun = action;

    const system = systemFor(action, this.settings.targetLang);

    if (action.mode === "chat") {
      const chatView = await this.openChat();
      await chatView.submit(sel.text, {
        display: `**${action.name}**\n\n${sel.text}`,
        system,
        fresh: true,
      });
      return;
    }

    // Ссылку держим локально: stopAll() обнуляет this.running, и по нему уже
    // не узнать, что запрос прервали — прерванный ответ уехал бы в заметку.
    const controller = new AbortController();
    this.running = controller;

    const entry = this.newEntry(action);

    // Всё, что может бросить, — внутри try: иначе finally не отработает и
    // this.running останется занятым до перезапуска Obsidian.
    try {
      this.showBusy(shortName(action), 0);
      this.history.push(entry);
      this.chatView?.renderAction(entry);

      const result = await chat(
        this.apiConfig(),
        [
          { role: "system", content: system },
          { role: "user", content: sel.text },
        ],
        {
          stream: this.settings.stream && streamAvailable(this.settings),
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
        this.finishEntry(entry, "error", t("emptyReply"));
        new Notice(t("emptyReply"));
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
  private newEntry(action: AiAction): ActionEntry {
    return {
      kind: "action",
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      action: shortName(action),
      status: "running",
      content: "",
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

  /** Возврат правки: меняем написанное обратно, если его ещё не тронули. */
  async undoAction(id: string): Promise<boolean> {
    const record = this.undoable.get(id);
    if (!record) return false;

    // Проверяем тип, а не приводим к нему: в неактивной вкладке лист держит
    // вместо вьюхи заглушку, и у неё нет ни file, ни editor.
    const view = this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === record.path);

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

  stopAction(): void {
    this.running?.abort();
  }

  /** Окно над выделением: пресеты на цифрах плюс поле для своего промпта. */
  private openQuickMenu(editor: Editor, view: MarkdownView): void {
    const sel = this.grabChecked(editor);
    if (!sel) return;

    const presets = this.settings.quickSlots.map((id) => {
      if (id === QUICK_ASK) {
        return {
          label: t("cmdSendSelection"),
          icon: "message-circle-question",
          run: () => void this.askAboutSelection(editor),
        };
      }
      const action = this.settings.actions.find((a) => a.id === id);
      if (!action) return null;
      return {
        label: action.name,
        icon: action.icon,
        run: () => void this.runAction(action, editor, view),
      };
    });

    new QuickMenu(this.app, {
      presets,
      selection: sel.text,
      recent: this.settings.recentPrompts,
      onPrompt: (prompt, toChat) => void this.runPrompt(prompt, toChat, editor, view),
    }).open();
  }

  /** Разовый промпт из быстрого меню — обычное действие, только без имени. */
  private async runPrompt(
    prompt: string,
    toChat: boolean,
    editor: Editor,
    view: MarkdownView,
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
    );
  }

  /**
   * Выделенное — в чат. Раньше фрагмент уходил вопросом сам по себе, и модель
   * отвечала встречным «а что с ним сделать?». Теперь он прикрепляется к полю
   * ввода: сначала вопрос, фрагмент уедет вместе с ним.
   */
  private async askAboutSelection(editor: Editor): Promise<void> {
    const sel = this.grabChecked(editor);
    if (!sel) return;
    const chatView = await this.openChat();
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
    return {
      kind: this.settings.kind,
      baseUrl: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
      model: this.settings.model,
      temperature: this.settings.temperature,
      maxTokens: this.settings.maxTokens,
      thinking: this.settings.thinking,
      reasoningEffort: this.settings.reasoningEffort,
    };
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
    return { path: view.file.path, ...clip(text) };
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
    return { path: view.file.path, text: clip(text).text };
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
    return { path: view.file.path, ...clip(view.editor.getValue()) };
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
   * Новая заметка в корне хранилища. Существующий файл не трогаем ни при каких
   * условиях — при совпадении имени берём следующий свободный номер.
   */
  async createNote(title: string, text: string): Promise<string | null> {
    const safe = title
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100);
    if (!safe) return null;

    // Индекс Obsidian регистрозависим, а файловая система Windows и macOS — нет:
    // «Идеи.md» рядом с «идеи.md» коллизией не считается, и vault.create молча
    // пишет поверх чужой заметки. Поэтому сверяем сами, в нижнем регистре.
    const taken = new Set(this.app.vault.getFiles().map((f) => f.path.toLowerCase()));
    let path = `${safe}.md`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) {
      path = `${safe} ${n}.md`;
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
    this.openChat().catch((e) => new Notice(String(e instanceof Error ? e.message : e)));
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
