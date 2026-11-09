import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import esbuild from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "ai-composer-test-"));
const require = createRequire(import.meta.url);
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log("PASS " + name); };
class Element {
  constructor(doc, tag = "div") {
    this.ownerDocument = doc; this.tagName = tag; this.children = []; this.attributes = {};
    this.style = {}; this.className = ""; this._text = ""; this.value = ""; this.listeners = {};
    this.scrollHeight = 40; this.clientHeight = 40; this.scrollTop = 0; this.clicks = 0;
  }
  get isConnected() { return this.root === true || !!this.parentElement?.isConnected; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  insertBefore(child, before) { child.remove(); child.parentElement = this; this.children.splice(this.children.indexOf(before), 0, child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  setAttr(k, v) { this.setAttribute(k, v); }
  set textContent(v) { this.empty(); this._text = v; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(""); }
  setText(v) { this.textContent = v; }
  empty() { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ""; }
  addClass(c) { this.className = [...new Set([...this.className.split(" "), c])].filter(Boolean).join(" "); }
  removeClass(c) { this.className = this.className.split(" ").filter(x => x !== c).join(" "); }
  toggleClass(c, on) { on ? this.addClass(c) : this.removeClass(c); }
  hasClass(c) { return this.className.split(" ").includes(c); }
  hide() { this.style.display = "none"; }
  toggle(on) { this.style.display = on ? "" : "none"; }
  createEl(tag, options = {}) {
    const el = this.ownerDocument.createElement(tag); el.className = options.cls ?? "";
    if (options.text !== undefined) el.textContent = options.text;
    for (const [k, v] of Object.entries(options.attr ?? {})) el.setAttribute(k, v);
    for (const k of ["type", "value", "href"]) if (options[k] !== undefined) { el[k] = options[k]; el.setAttribute(k, options[k]); }
    return this.appendChild(el);
  }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  matches(selector) { return selector.startsWith(".") ? this.hasClass(selector.slice(1)) : this.tagName === selector; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  findAll(selector) { return this.querySelectorAll(selector); }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  dispatch(name, options = {}) {
    const event = { prevented: false, preventDefault() { this.prevented = true; }, ...options };
    for (const fn of this.listeners[name] ?? []) fn(event);
    return event;
  }
  click() { this.clicks++; this.onclick?.({}); }
  setCssStyles(style) { Object.assign(this.style, style); }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
}
const doc = { createElement: tag => new Element(doc, tag) };
globalThis.__newRoot = () => { const root = new Element(doc); root.root = true; return root; };
globalThis.__platform = { isMobile: false };
globalThis.__status = { connected: true, email: "test@example.com", activeAccountId: "one", planUsageEnabled: true };
globalThis.__quotaCalls = 0;
globalThis.__quota = async () => { globalThis.__quotaCalls++; return { available: true, checkedAt: Date.now(), account: { email: "test@example.com" }, windows: [{ remainingPercent: 78, windowDurationMins: 10080, resetsAt: Date.now() + 86400000 }] }; };
globalThis.__setIcon = (el, icon) => {
  el.icon = icon;
  const paths = {
    paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l10.6-10.6a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l9.19-9.19",
    "arrow-up": "M12 19V5m-7 7 7-7 7 7",
    "chevron-down": "m6 9 6 6 6-6",
    "refresh-cw": "M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12A9 9 0 0 1 5.64 18.36L3 16M3 21v-5h5",
  };
  const svg = el.createEl("svg", { cls: "svg-icon", attr: { viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" } });
  svg.createEl("path", { attr: { d: paths[icon] ?? "M6 12h12M12 6v12" } });
};
const exportsByPath = new Map();
for (const name of ["view", "chatgpt-quota-view"]) {
  const source = readFileSync("src/" + name + ".ts", "utf8");
  for (const match of source.matchAll(/import\s*{([^}]+)}\s*from\s*"([^"]+)"/gs)) {
    const names = match[1].split(",").map(x => x.trim()).filter(Boolean);
    exportsByPath.set(match[2], [...new Set([...(exportsByPath.get(match[2]) ?? []), ...names])]);
  }
}
const keep = new Set(["./i18n", "./chatgpt-options", "./chatgpt-quota-view"]);
const stub = { name: "offline-composer", setup(build) {
  build.onResolve({ filter: /.*/ }, args => exportsByPath.has(args.path) && !keep.has(args.path) ? { path: args.path, namespace: "mock" } : undefined);
  build.onLoad({ filter: /.*/, namespace: "mock" }, ({path}) => {
    if (path === "obsidian") return { loader: "js", contents: `
      export const moment={locale:()=>globalThis.__locale??"ru"};
      export const Platform=globalThis.__platform;
      export const setIcon=globalThis.__setIcon;
      export class ItemView { constructor(){this.contentEl=globalThis.__newRoot();this.app={workspace:{on(){return {};}}};} registerDomEvent(el,name,fn){el.addEventListener(name,fn);} registerEvent(){} }
      export class Menu {} export class Notice {} export class TFile {} export class App {} export class WorkspaceLeaf {} export const MarkdownRenderer={};` };
    return { loader: "js", contents: (exportsByPath.get(path) ?? []).map(name => {
      const value = name === "chatGPTStatus" ? "async()=>globalThis.__status" : name === "readChatGPTSharedQuota" ? "globalThis.__quota" : name === "isChatGPTPlan" ? "cfg=>cfg.plan===true" : name === "RECENT_LIMIT" ? "20" : "(...args)=>{throw Error('Unexpected dependency: '+" + JSON.stringify(name) + ");}";
      return `export const ${name}=${value};`;
    }).join("\n") };
  });
} };
const escape = v => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const html = el => {
  const attrs = { ...el.attributes, class: el.className, style: Object.entries(el.style).map(([k,v]) => k.replace(/[A-Z]/g, m=>"-"+m.toLowerCase())+":"+v).join(";") };
  if (el.title) attrs.title = el.title;
  if (el.tagName === "option" && el.parentElement?.value === el.value) attrs.selected = "";
  if (el.hidden) attrs.hidden = "";
  const body = el.tagName === "textarea" ? el.value : el._text;
  return `<${el.tagName} ${Object.entries(attrs).map(([k,v])=>k+'="'+escape(v)+'"').join(" ")}>${escape(body)}${el.children.map(html).join("")}</${el.tagName}>`;
};
try {
  const bundle = join(dir, "view.cjs");
  await esbuild.build({ entryPoints: ["src/view.ts"], outfile: bundle, bundle: true, platform: "node", format: "cjs", plugins: [stub], logLevel: "error" });
  const { ChatView } = require(bundle);
  const host = {
    settings: { draft: "Draft", recentAsks: [], chatGPTEfforts: {} }, history: [], files: [], saves: 0,
    cfg: { plan: true, model: "gpt-6.1-sol", reasoningEffort: "high" },
    chatConfig() { return this.cfg; }, saveSettings() { this.saves++; return Promise.resolve(); }, saveSettingsSoon() { this.saves++; },
  };
  const view = new ChatView({}, host);
  for (const method of ["paintReach", "catchSelection", "paintAttach", "paintTotal", "setupDrop", "repaint"]) view[method] = () => {};
  await view.onOpen(); await Promise.resolve();
  const root = view.contentEl, composer = root.querySelector(".ai-composer"), toolbar = root.querySelector(".ai-composer-toolbar");
  const input = root.querySelector("textarea"), clip = root.querySelector(".ai-clip"), send = root.querySelector(".ai-send");
  check("one cohesive card contains chips, input and integrated controls", () => {
    assert.deepEqual(composer.children.map(x=>x.className), ["ai-attach", "ai-input", "ai-composer-toolbar"]);
    assert.equal(input.parentElement, composer); assert.equal(clip.parentElement, toolbar); assert.equal(send.parentElement, toolbar);
    assert.equal(root.querySelector(".ai-plan-label"), null);
  });
  check("short localized placeholder and accessible keyboard instructions", () => {
    assert.equal(input.getAttribute("rows"), "1"); assert.equal(input.getAttribute("placeholder"), "Спроси что-нибудь…");
    assert.equal(input.getAttribute("aria-label"), "Сообщение"); assert.match(input.getAttribute("aria-description"), /Shift\+Enter/);
    assert.equal(input.value, "Draft"); assert.equal(send.icon, "arrow-up");
  });
  check("header and composer model selectors retain their handlers", () => {
    let opened = 0; view.openModelMenu = () => opened++;
    root.querySelector(".ai-bar-model").click(); root.querySelector(".ai-composer-model").click();
    assert.equal(opened, 2); assert.match(root.querySelector(".ai-composer-model").getAttribute("aria-label"), /gpt-6.1-sol/);
    assert.equal(root.querySelector(".ai-composer-model").getAttribute("aria-haspopup"), "menu");
  });
  check("effort remains model-specific with no Fast tier", () => {
    const effort = root.querySelector("select"); assert.equal(effort.value, "high");
    assert.deepEqual(effort.children.map(x=>x.value), ["", "low", "medium", "high", "xhigh", "max"]);
    effort.value = "xhigh"; effort.onchange(); assert.equal(host.settings.chatGPTEfforts["gpt-6.1-sol"], "xhigh");
  });
  check("attachment remains native label with keyboard activation", () => {
    assert.equal(clip.tagName, "label"); assert.equal(clip.tabIndex, 0); assert.equal(clip.getAttribute("role"), "button");
    const picker = clip.querySelector("input"); assert.equal(picker.getAttribute("accept"), "image/*,application/pdf");
    assert.equal(clip.dispatch("keydown", { key: "Enter" }).prevented, true);
    assert.equal(clip.dispatch("keydown", { key: " " }).prevented, true); assert.equal(picker.clicks, 2);
    let received; view.takeFiles = files => { received = files; }; picker.files = [{ name: "image.png" }]; picker.value = "chosen";
    picker.dispatch("change"); assert.equal(picker.value, ""); assert.equal(received[0].name, "image.png");
  });
  let submitted = 0; view.submit = async () => submitted++;
  check("Shift+Enter, mobile Enter and IME do not send", () => {
    input.value = "Keep draft";
    assert.equal(input.dispatch("keydown", { key: "Enter", shiftKey: true }).prevented, false);
    assert.equal(input.dispatch("keydown", { key: "Enter", isComposing: true }).prevented, false);
    globalThis.__platform.isMobile = true; assert.equal(input.dispatch("keydown", { key: "Enter" }).prevented, false);
    globalThis.__platform.isMobile = false; assert.equal(submitted, 0); assert.equal(input.value, "Keep draft");
  });
  check("Enter sends once and clears saved draft", () => {
    assert.equal(input.dispatch("keydown", { key: "Enter" }).prevented, true);
    assert.equal(submitted, 1); assert.equal(input.value, ""); assert.equal(host.settings.draft, "");
  });
  check("busy Enter preserves next draft and stop button remains available", () => {
    view.controller = new AbortController(); input.value = "Next draft"; input.dispatch("input"); view.paintSendButton();
    assert.equal(send.icon, "square"); assert.equal(send.hasClass("is-stop"), true);
    input.dispatch("keydown", { key: "Enter" }); assert.equal(submitted, 1); assert.equal(input.value, "Next draft");
    assert.equal(host.settings.draft, "Next draft"); let stops = 0; view.stop = () => stops++; send.click(); assert.equal(stops, 1);
    view.controller = null; view.paintSendButton(); assert.equal(send.icon, "arrow-up");
  });
  check("auto-grow and pane resize stay bounded and reversible", () => {
    input.scrollHeight = 500; input.dispatch("input"); assert.equal(input.style.height, "160px");
    input.scrollHeight = 40; view.onResize(); assert.equal(input.style.height, "40px");
    view.setInput("Edited"); assert.equal(input.selectionStart, 6); assert.equal(host.settings.draft, "Edited");
  });
  check("quota never loads automatically", () => assert.equal(globalThis.__quotaCalls, 0));
  await root.querySelector(".ai-quota-refresh").onclick();
  check("compact quota keeps one concise tooltip and accessible provenance", () => {
    const summary = root.querySelector(".ai-quota-summary"); assert.equal(summary.tabIndex, 0);
    assert.match(summary.textContent, /Codex · общий78%/); assert.doesNotMatch(summary.textContent, /2026|сброс|SIWC/);
    assert.equal(root.querySelector(".ai-quota-reset"), null);
    assert.match(summary.getAttribute("aria-label"), /сброс/); assert.match(summary.getAttribute("aria-label"), /Проверено/);
    assert.match(summary.getAttribute("aria-description"), /SIWC недоступен/);
    assert.doesNotMatch(summary.getAttribute("aria-label"), /app-server|SIWC|test@example.com/);
    assert.ok(summary.getAttribute("aria-label").length < 150);
  });
  check("composer has no info button or native/custom duplicate tooltip targets", () => {
    assert.equal(root.querySelector(".ai-quota-info"), null);
    assert.equal(root.querySelector(".tooltip"), null);
    const verify = element => {
      assert.equal(element.getAttribute("title"), undefined); assert.equal(element.title, undefined);
      for (const child of element.children) verify(child);
    };
    verify(composer);
    assert.equal(root.querySelector(".ai-plan-indicator").getAttribute("aria-hidden"), "true");
    assert.equal(root.querySelector(".ai-plan-indicator").getAttribute("aria-label"), undefined);
  });
  input.value = ""; input.style.height = "40px";
  const normalHTML = html(root);
  host.cfg.model = "a-very-long-provider-model-with-more-details-than-fit-in-the-sidebar";
  view.refreshHeader(); await Promise.resolve();
  check("model refresh updates both selectors, preserving typed draft", () => {
    assert.equal(root.querySelector(".ai-bar-model").textContent, host.cfg.model);
    assert.equal(root.querySelector(".ai-model-name").textContent, host.cfg.model);
    assert.equal(input.value, ""); assert.equal(root.querySelector("select").children.length, 1);
  });
  const longHTML = html(root);
  host.cfg = { plan: false, model: "local-model" }; view.refreshHeader();
  check("switching away removes subscription controls without removing model choice", () => {
    assert.equal(root.querySelector(".ai-shared-quota"), null); assert.equal(root.querySelector("select"), null);
    assert.equal(root.querySelector(".ai-composer-meta").hasClass("ai-plan-status"), false);
    assert.equal(root.querySelector(".ai-model-name").textContent, "local-model");
  });
  await view.onClose();
  const css = readFileSync("styles.css", "utf8");
  check("theme-native single border, wrapping metadata and explicit focus indicators", () => {
    assert.match(css, /\.ai-composer\s*{[^}]*border: 1px solid var\(--background-modifier-border\)/);
    assert.match(css, /textarea\.ai-input:focus\s*{[^}]*border: 0;[^}]*box-shadow: none/s);
    assert.match(css, /\.ai-composer-meta\s*{[^}]*flex-direction: row;[^}]*flex-wrap: wrap/s);
    assert.match(css, /\.ai-model-name\s*{[^}]*text-overflow: ellipsis/s);
    assert.match(css, /\.ai-composer :is\([^}]+:focus-visible/);
  });
  if (process.argv.includes("--layout")) {
    const edge = process.env.AI_ASSIST_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    assert.ok(existsSync(edge), "Set AI_ASSIST_BROWSER to an installed Chromium browser for layout verification");
    const theme = `:root{--font-ui-small:13px;--font-ui-smaller:11px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-2-1:2px;--size-2-2:4px;--radius-s:4px;--radius-m:8px;--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#dedede;--background-modifier-border-focus:#b5a0e9;--background-modifier-hover:#00000008;--interactive-accent:#8064cc;--interactive-accent-hover:#7254bd;--background-modifier-error:#b33434;--text-normal:#222;--text-muted:#666;--text-faint:#888;--text-on-accent:#fff;--color-green:#279456;--text-warning:#ac6a18}body{font:13px Arial;margin:0}*{box-sizing:border-box}.fixture{height:230px;display:inline-block;vertical-align:top}.dark{--background-primary:#202020;--background-modifier-border:#454545;--text-normal:#eee;--text-muted:#aaa;--text-faint:#888}.ai-assist-chat{background:var(--background-primary)}button,select,textarea{font:inherit}textarea{border:3px solid #aaa;box-shadow:0 0 0 2px #ccc}.ai-attach[style*="none"]{display:none}.ai-total{display:none}`;
    const fixtures = [280,360,480,530,800].flatMap(width => ["light","dark"].flatMap(mode => [false,true].map(long => `<section class="fixture ${mode}" data-width="${width}" data-long="${long}" style="width:${width}px">${long?longHTML:normalHTML}</section>`))).join("");
    // Reproduce the host padding that defeats the single-class root rule.
    const hostTheme = `.workspace-leaf-content .view-content{padding:12px 12px 32px}.host-fixture{display:inline-block;vertical-align:top}.status-bar{height:22px}`;
    const hostHTML = normalHTML.replace('class="ai-assist-chat"', 'class="view-content ai-assist-chat"');
    const hostFixtures = [280,530,800].flatMap(width => [230,640].map(height => `<section class="host-fixture" data-width="${width}" data-height="${height}" style="width:${width}px"><div class="workspace-leaf-content" style="height:${height}px">${hostHTML}</div><div class="status-bar"></div></section>`)).join("");
    const otherView = '<div class="workspace-leaf-content"><div id="other-view" class="view-content"></div></div>';
    const script = `const results=[...document.querySelectorAll('.fixture')].map(f=>{
      const c=f.querySelector('.ai-composer'),i=f.querySelector('textarea'),s=f.querySelector('.ai-send'),a=f.querySelector('.ai-clip'),m=f.querySelector('.ai-composer-model'),q=f.querySelector('.ai-shared-quota'),e=f.querySelector('select'),r=c.getBoundingClientRect();
      const controls=[i,s,a,m,q,e,...f.querySelectorAll('.ai-quota-refresh')];
      const center=x=>{const b=x.getBoundingClientRect();return b.top+b.height/2;};
      return {width:+f.dataset.width,theme:f.classList.contains('dark')?'dark':'light',long:f.dataset.long==='true',height:r.height,overflow:f.scrollWidth>f.clientWidth,inside:controls.every(e=>{const x=e.getBoundingClientRect();return x.left>=r.left&&x.right<=r.right+0.5}),border:getComputedStyle(i).borderTopWidth,shadow:getComputedStyle(i).boxShadow,background:getComputedStyle(c).backgroundColor,modelWidth:m.getBoundingClientRect().width,oneRow:Math.max(...[m,e,q].map(center))-Math.min(...[m,e,q].map(center))<1,aligned:Math.abs(center(a)-center(s))<1,wideAligned:Math.abs(center(a)-center(m))<1,titles:c.querySelectorAll('[title]').length,info:c.querySelectorAll('.ai-quota-info').length};
    });document.body.setAttribute('data-results',JSON.stringify(results));
    const hostResults=[...document.querySelectorAll('.host-fixture')].map(f=>{
      const root=f.querySelector('.view-content'),leaf=root.parentElement,c=f.querySelector('.ai-composer'),list=f.querySelector('.ai-list'),foot=f.querySelector('.ai-foot'),status=f.querySelector('.status-bar');
      const measure=()=>({gap:status.getBoundingClientRect().top-c.getBoundingClientRect().bottom,rootGap:status.getBoundingClientRect().top-root.getBoundingClientRect().bottom,footGap:status.getBoundingClientRect().top-foot.getBoundingClientRect().bottom,overflow:root.scrollHeight>root.clientHeight});
      const padding=getComputedStyle(root),before=measure();
      const content=document.createElement('div');content.style.cssText='height:2000px;flex-shrink:0';list.appendChild(content);list.scrollTop=500;
      const scrolled=measure(),scrolls=list.scrollTop>0;
      f.style.width=(+f.dataset.width===280?530:280)+'px';leaf.style.height='300px';f.querySelector('textarea').style.height='160px';
      return {width:+f.dataset.width,height:+f.dataset.height,padding:[padding.paddingTop,padding.paddingRight,padding.paddingBottom,padding.paddingLeft],before,scrolled,resized:measure(),scrolls,otherPadding:getComputedStyle(document.querySelector('#other-view')).paddingBottom};
    });document.body.setAttribute('data-host-results',JSON.stringify(hostResults));`;

    const file = join(dir,"layout.html"); writeFileSync(file,`<!doctype html><html><meta charset="utf-8"><style>${theme}\n${css}\n${hostTheme}</style><body>${fixtures}${hostFixtures}${otherView}<script>${script}</script></body></html>`);
    const screenshot = process.argv.find(arg=>arg.startsWith("--screenshot="))?.slice(13);
    const run = spawnSync(edge,["--headless","--disable-gpu","--disable-extensions","--disable-background-networking","--no-first-run","--no-default-browser-check","--user-data-dir="+join(dir,"browser"),"--dump-dom","--virtual-time-budget=1000",...(screenshot?["--screenshot="+resolve(screenshot),"--window-size=1600,2300"]:[]),pathToFileURL(file).href],{encoding:"utf8",timeout:45000,windowsHide:true,maxBuffer:8*1024*1024});
    assert.equal(run.status,0,run.error?.message??run.stderr);
    const encoded = run.stdout.match(/data-results="([^"]*)"/)?.[1]; assert.ok(encoded,"Headless browser did not return geometry");
    const results=JSON.parse(encoded.replaceAll("&quot;",'"').replaceAll("&amp;","&"));
    for(const result of results) check(`rendered ${result.width}px ${result.theme}${result.long?" long model":""}`,()=>{
      assert.equal(result.overflow,false,JSON.stringify(result)); assert.equal(result.inside,true,JSON.stringify(result));
      assert.equal(result.titles,0); assert.equal(result.info,0); assert.equal(result.aligned,true);
      if ((!result.long && result.width >= 480) || result.width >= 800) {
        assert.equal(result.oneRow,true,JSON.stringify(result)); assert.equal(result.wideAligned,true,JSON.stringify(result));
      }
      if (result.width === 280) assert.equal(result.oneRow,false,JSON.stringify(result));
      assert.equal(result.border,"0px"); assert.equal(result.shadow,"none"); assert.ok(result.height<= (result.long?145:112),JSON.stringify(result));
      assert.equal(result.background,result.theme==="dark"?"rgb(32, 32, 32)":"rgb(255, 255, 255)"); assert.ok(result.modelWidth>20);
    });
    const hostEncoded=run.stdout.match(/data-host-results="([^"]*)"/)?.[1]; assert.ok(hostEncoded,"Headless browser did not return host geometry");
    const hostResults=JSON.parse(hostEncoded.replaceAll("&quot;",'"').replaceAll("&amp;","&"));
    for(const result of hostResults) check(`host padding, scroll and resize ${result.width}x${result.height}`,()=>{
      assert.deepEqual(result.padding,["12px","12px","0px","12px"],JSON.stringify(result));
      assert.equal(result.otherPadding,"32px"); assert.equal(result.scrolls,true,JSON.stringify(result));
      for(const layout of [result.before,result.scrolled,result.resized]) {
        assert.ok(Math.abs(layout.gap-8)<0.5,JSON.stringify(result));
        assert.ok(Math.abs(layout.rootGap)<0.5,JSON.stringify(result));
        assert.ok(Math.abs(layout.footGap)<0.5,JSON.stringify(result));
        assert.equal(layout.overflow,false,JSON.stringify(result));
      }
    });
    console.log("HOST LAYOUT "+JSON.stringify(hostResults));
    console.log("LAYOUT "+JSON.stringify(results));
  }
  console.log(checks+" composer checks passed. Mocked services, no inference or network.");
} finally {
  const target = resolve(dir), base = resolve(tmpdir()) + sep;
  if (!target.startsWith(base) || !target.includes("ai-composer-test-")) throw Error("Unsafe temporary cleanup path");
  rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
