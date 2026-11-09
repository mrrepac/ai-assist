import { moment, setIcon } from "obsidian";
import { chatGPTStatus } from "./chatgpt-auth";
import { readChatGPTSharedQuota } from "./chatgpt-quota";
import { t } from "./i18n";

/** Explicit, read-only refresh. Never polls, signs in or sends conversation content. */
export function renderChatGPTQuota(container: HTMLElement, compact = false): () => void {
  const doc = container.ownerDocument;
  const box = doc.createElement("div");
  box.className = "ai-shared-quota";
  container.appendChild(box);
  const summary = doc.createElement("span");
  summary.className = "ai-quota-summary";
  summary.tabIndex = 0;
  summary.setAttribute("aria-description", t("chatGPTQuotaSourceHint"));
  summary.setAttribute("aria-live", "polite");
  summary.textContent = t("chatGPTQuotaUnloaded");
  box.appendChild(summary);
  const refresh = doc.createElement("button");
  refresh.className = "ai-quota-refresh clickable-icon";
  refresh.type = "button";
  refresh.setAttribute("aria-label", t("chatGPTQuotaRefresh"));
  setIcon(refresh, "refresh-cw");
  box.appendChild(refresh);
  let windowDetails = "";
  // Obsidian uses aria-label for its tooltip. Do not also set native title attributes.
  const describe = (detail = "") => {
    summary.setAttribute("aria-label", [windowDetails || summary.textContent, detail].filter(Boolean).join("\n"));
  };
  describe();
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  refresh.onclick = async () => {
    if (controller || disposed) return;
    controller = new AbortController();
    refresh.disabled = true;
    summary.textContent = t("chatGPTQuotaLoading");
    windowDetails = "";
    describe();
    if (timer) clearTimeout(timer);
    try {
      const status = await chatGPTStatus();
      if (disposed) return;
      if (!status.connected || !status.email) { summary.textContent = t("chatGPTDisconnected"); describe(t("chatGPTQuotaSignedOut")); return; }
      const result = await readChatGPTSharedQuota(status.email, controller.signal);
      const current = await chatGPTStatus();
      if (disposed) return;
      if (current.activeAccountId !== status.activeAccountId || current.email !== status.email) {
        summary.textContent = t("chatGPTQuotaUnloaded"); describe(); return;
      }
      if (!result.available) {
        summary.textContent = t("chatGPTQuotaUnknown");
        const reason = result.reason === "missing-cli" ? "chatGPTQuotaMissingCLI"
          : result.reason === "account-mismatch" ? "chatGPTQuotaMismatch"
          : result.reason === "signed-out" ? "chatGPTQuotaSignedOut"
          : result.reason === "expired" ? "chatGPTQuotaStale"
          : "chatGPTQuotaReadFailed";
        describe(t(reason));
        return;
      }
      const locale = moment.locale();
      const fullDate = (value: number) => new Date(value).toLocaleString(locale);
      const shortDate = (value: number) => new Date(value).toLocaleString(locale, {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      const duration = (minutes: number) => minutes < 1440
        ? t("chatGPTQuotaHours", { n: minutes / 60 })
        : t("chatGPTQuotaDays", { n: minutes / 1440 });
      summary.textContent = "";
      const label = doc.createElement("span");
      label.className = "ai-quota-label";
      label.textContent = t("chatGPTQuotaShared");
      summary.appendChild(label);
      for (const window of result.windows) {
        const item = doc.createElement("span");
        item.className = "ai-quota-window";
        const windowDetail = t("chatGPTQuotaRemaining") + ": " + window.remainingPercent + "% · " +
          duration(window.windowDurationMins) + "; " + t("chatGPTQuotaReset") + " " +
          (compact ? shortDate(window.resetsAt) : fullDate(window.resetsAt));
        const percent = doc.createElement("strong");
        percent.className = "ai-quota-percent";
        percent.textContent = window.remainingPercent + "%";
        if (result.windows.length > 1) percent.textContent += " / " + duration(window.windowDurationMins);
        item.appendChild(percent);
        windowDetails += (windowDetails ? "\n" : "") + windowDetail;
        if (!compact) {
          const reset = doc.createElement("span");
          reset.className = "ai-quota-reset";
          reset.textContent = "· " + shortDate(window.resetsAt);
          item.appendChild(reset);
        }
        summary.appendChild(item);
      }
      const snapshotMark = doc.createElement("span");
      snapshotMark.className = "ai-quota-snapshot";
      snapshotMark.textContent = "*";
      snapshotMark.setAttribute("aria-hidden", "true");
      snapshotMark.hidden = true;
      summary.appendChild(snapshotMark);
      const detail = t("chatGPTQuotaChecked") + ": " + (compact ? shortDate(result.checkedAt) : fullDate(result.checkedAt));
      describe(detail);
      // Keep old readings visibly marked, then remove percentages at reset. Never poll.
      const reset = Math.min(...result.windows.map(w => w.resetsAt));
      const expire = () => {
        if (disposed) return;
        if (reset > Date.now()) { timer = setTimeout(expire, Math.min(reset - Date.now(), 2_147_483_647)); return; }
        summary.textContent = t("chatGPTQuotaStale");
        describe(t("chatGPTQuotaSnapshot") + " " + detail);
      };
      const markSnapshot = () => {
        if (disposed) return;
        if (reset <= Date.now()) { expire(); return; }
        snapshotMark.hidden = false;
        describe(t("chatGPTQuotaSnapshot") + " " + detail);
        timer = setTimeout(expire, Math.min(reset - Date.now(), 2_147_483_647));
      };
      const expires = Math.min(result.checkedAt + 60_000, reset);
      if (expires <= Date.now()) markSnapshot();
      else timer = setTimeout(markSnapshot, expires - Date.now());
    } catch { if (!disposed) { summary.textContent = t("chatGPTQuotaUnknown"); describe(t("chatGPTQuotaReadFailed")); } }
    finally { controller = null; if (!disposed) refresh.disabled = false; }
  };
  return () => { disposed = true; controller?.abort(); if (timer) clearTimeout(timer); };
}
