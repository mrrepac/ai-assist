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
import { t } from "./i18n";
import { ModelSuggestModal } from "./modals";
import { ParsedCall, ToolHost, parseCall, runCall, toolSpecs } from "./tools";
import {
  ActionEntry,
  AiAssistSettings,
  HistoryItem,
  isActionEntry,
  providerLabel,
  providerOf,
  providerRank,
  streamAvailable,
  switchProvider,
  toolsAvailable,
} from "./types";

/** Сколько раз подряд модель может ходить за инструментами в одном запросе. */
const MAX_TOOL_STEPS = 5;

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
  /** Весь разговор в markdown — для копирования и для сохранения в заметку. */
  chatMarkdown(): string;
  /** Сложить разговор в новую заметку и открыть её. */
  saveChat(): Promise<void>;
  /** Вернуть заметку к тому, что было до правки. false — уже не получится. */
  undoAction(id: string): boolean;
  /** Прервать идущую правку выделенного. */
  stopAction(): void;
  /** Текст активной заметки, если контекст включён. */
  noteContext(): { path: string; text: string } | null;
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
}

export class ChatView extends ItemView {
  private listEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private downEl!: HTMLButtonElement;
  private controller: AbortController | null = null;
  /** Карточки журнала по id записи — чтобы обновлять их на ходу, а не рисовать заново. */
  private actionEls = new Map<string, HTMLElement>();

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

    const ctx = bar.createEl("button", { cls: "ai-bar-btn clickable-icon" });
    setIcon(ctx, "file-text");
    ctx.setAttr("aria-label", t("chatContextNote"));
    ctx.toggleClass("is-active", this.host.settings.chatContextNote);
    ctx.onclick = () => {
      this.host.settings.chatContextNote = !this.host.settings.chatContextNote;
      ctx.toggleClass("is-active", this.host.settings.chatContextNote);
      this.host.persistHistory();
    };
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
    this.inputEl = foot.createEl("textarea", {
      cls: "ai-input",
      attr: { rows: "2", placeholder: t("chatPlaceholder") },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      // На телефоне Enter — это перенос строки, отправка только кнопкой.
      if (e.key === "Enter" && !e.shiftKey && !Platform.isMobile) {
        e.preventDefault();
        void this.send();
      }
    });
    this.inputEl.addEventListener("input", () => this.autoGrow());

    this.sendBtn = foot.createEl("button", { cls: "ai-send mod-cta" });
    this.paintSendButton();
    this.sendBtn.onclick = () => {
      if (this.busy) this.stop();
      else void this.send();
    };

    this.repaint();
  }

  async onClose(): Promise<void> {
    this.stop();
  }

  /** Панель могла быть открыта до правки настроек — освежаем подпись модели. */
  refreshHeader(): void {
    const model = this.contentEl.querySelector(".ai-bar-model");
    if (model) model.textContent = this.host.settings.model;
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
    menu.showAtMouseEvent(e);
  }

  /** Кнопка «вниз» нужна, только если снизу действительно что-то осталось. */
  private paintDown(): void {
    const el = this.listEl;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    this.downEl.toggleClass("is-visible", away);
  }

  newChat(): void {
    this.stop();
    this.host.history.length = 0;
    this.host.persistHistory();
    this.repaint();
    new Notice(t("chatCleared"));
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.paintSendButton();
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  private autoGrow(): void {
    // Сначала отпускаем высоту, иначе scrollHeight покажет прежнюю, а не нужную.
    this.inputEl.setCssStyles({ height: "auto" });
    this.inputEl.setCssStyles({ height: Math.min(this.inputEl.scrollHeight, 200) + "px" });
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
    this.inputEl.value = "";
    this.autoGrow();
    await this.submit(text);
  }

  /** Отправить запрос и показать ответ. Точка входа и для действий из редактора. */
  async submit(text: string, opts: SubmitOptions = {}): Promise<void> {
    if (this.busy) this.stop();

    this.host.history.push({ role: "user", content: opts.display ?? text });
    const userEl = this.addMessage("user", opts.display ?? text);
    userEl.scrollIntoView({ block: "end" });

    const messages: ChatMessage[] = [];
    // Без объяснения, где она находится, модель на просьбу «вставь в заметку»
    // отвечает лекцией о том, что у неё нет доступа к хранилищу.
    const canUseTools = toolsAvailable(this.host.settings);
    const hint = canUseTools ? t("chatSystemHintTools") : t("chatSystemHint");
    const system = [hint, this.host.settings.systemPrompt.trim(), opts.system?.trim()]
      .filter(Boolean)
      .join("\n\n");
    if (system) messages.push({ role: "system", content: system });

    const note = this.host.noteContext();
    if (note) {
      messages.push({
        role: "system",
        content: `Note "${note.path}":\n\n${note.text}`,
      });
    }

    if (!opts.fresh) {
      // История без последней реплики — её кладём отдельно, уже настоящим текстом.
      // Записи журнала пропускаем: модели незачем читать отчёт о своей работе.
      for (const m of this.host.history.slice(0, -1).slice(-20)) {
        if (!isActionEntry(m)) messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: "user", content: text });

    // Локальная ссылка: stop() обнуляет this.controller, а в catch ещё нужно
    // знать, оборвали запрос или он упал сам.
    const controller = new AbortController();
    this.controller = controller;
    this.paintSendButton();

    let bubble = this.addMessage("assistant", "");
    let body = bubble.querySelector(".ai-msg-body") as HTMLElement;
    let answer = "";
    let reasoning = "";

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

        const result = await chat(this.host.apiConfig(), messages, {
          stream: this.host.settings.stream && streamAvailable(this.host.settings),
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

        if (answer.trim()) {
          this.host.history.push({ role: "assistant", content: answer, reasoning });
          await this.renderMarkdown(answer, body);
          this.addFooter(bubble, answer, result.usage);
        } else if (result.toolCalls.length === 0) {
          body.setText(t("emptyReply"));
        } else {
          bubble.remove(); // текста не было, дальше идут карточки правок
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
      }
      this.host.persistHistory();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      body.removeClass("ai-streaming");
      if (err.aborted || controller.signal.aborted) {
        // Оборванный ответ всё равно полезен — оставляем то, что успело прийти.
        if (answer.trim()) {
          this.host.history.push({ role: "assistant", content: answer, reasoning });
          this.host.persistHistory();
          await this.renderMarkdown(answer, body);
        } else {
          bubble.remove();
        }
        new Notice(t("aborted"));
      } else {
        body.empty();
        body.addClass("ai-error");
        body.setText(err.message);
        const retry = body.createEl("button", { cls: "ai-retry", text: t("chatRetry") });
        retry.onclick = () => {
          bubble.remove();
          this.host.history.pop(); // убираем реплику пользователя, submit положит заново
          void this.submit(text, opts);
        };
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.paintSendButton();
    }
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
    status.setText(t("toolApplied"));
    card.addClass("is-applied");
    if (parsed.writes) {
      // В историю кладём след правки: иначе после перезагрузки панели в диалоге
      // будет провал — вопрос есть, а что было сделано, непонятно.
      this.host.history.push({ role: "assistant", content: t("toolDone", { title: parsed.title }) });
    }
    this.followBottom();
    return outcome;
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
      apply.focus();
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
    if (this.host.history.length === 0) {
      this.listEl.createDiv({ cls: "ai-empty", text: t("chatEmpty") });
      return;
    }
    for (const m of this.host.history) {
      if (isActionEntry(m)) {
        this.renderAction(m);
        continue;
      }
      const el = this.addMessage(m.role, "");
      const body = el.querySelector(".ai-msg-body") as HTMLElement;
      if (m.role === "assistant") {
        if (m.reasoning) {
          const block = this.addReasoningBlock(el);
          (block.querySelector(".ai-think-body") as HTMLElement).setText(m.reasoning);
        }
        void this.renderMarkdown(m.content, body);
        this.addFooter(el, m.content, null);
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
      undo.onclick = () => {
        if (this.host.undoAction(entry.id)) {
          entry.undone = true;
          this.host.persistHistory();
          this.renderAction(entry);
        } else {
          new Notice(t("logUndoFail"));
        }
      };
    }
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

  private addMessage(role: "user" | "assistant", text: string): HTMLElement {
    this.listEl.querySelector(".ai-empty")?.remove();
    const el = this.listEl.createDiv({ cls: `ai-msg ai-msg-${role}` });
    el.createDiv({ cls: "ai-msg-role", text: role === "user" ? t("chatYou") : t("chatModel") });
    const body = el.createDiv({ cls: "ai-msg-body" });
    if (text) body.setText(text);
    return el;
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

  private addFooter(bubble: HTMLElement, text: string, usage: Usage | null): void {
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
