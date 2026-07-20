import DOMPurify from "dompurify";
import "./styles.css";
import { diffLines } from "diff";
import QRCode from "qrcode";
import { renderMarkdown } from "./markdown";
import {
  UNIT_CATEGORIES,
  adjustDate,
  convertInteger,
  convertUnit,
  createStorageAdapter,
  dateDifference,
  dateToTimestamp,
  decodeBase64,
  decodeUrl,
  encodeBase64,
  encodeUrl,
  evaluateExpression,
  formatNumber,
  jsonTransform,
  parseColor,
  rgbToHex,
  rgbToHsl,
  sortLines,
  textStats,
  timestampToDate,
  uniqueLines,
  type UnitCategory,
} from "./logic";
import { fetchWeather, weatherCodeText, WeatherError, type WeatherResult } from "./weather";

type ToolId = "calculator" | "units" | "weather" | "markdown" | "datetime" | "text" | "json" | "diff" | "encoding" | "qr" | "color";
type HomeMode = "all" | "favorites" | "recent";
type Theme = "system" | "light" | "dark";

type Tool = { id: ToolId; name: string; description: string; category: string; mark: string; keywords: string[] };

const tools: Tool[] = [
  { id: "calculator", name: "科学计算器", description: "表达式、函数、百分比与幂运算", category: "计算", mark: "ƒx", keywords: ["四则", "平方根", "三角", "对数"] },
  { id: "units", name: "单位换算", description: "长度、温度、压力等常用单位双向转换", category: "计算", mark: "↔", keywords: ["长度", "温度", "压力", "质量", "数据"] },
  { id: "weather", name: "天气查询", description: "查询城市当前天气与未来 5 日预报", category: "外部数据", mark: "☁", keywords: ["天气", "温度", "预报", "城市"] },
  { id: "markdown", name: "Markdown", description: "边写边预览，安全净化并下载草稿", category: "文档", mark: "MD", keywords: ["文档", "预览", "表格", "代码"] },
  { id: "datetime", name: "日期、时间与时间戳", description: "秒/毫秒互转、日期差值与日期加减", category: "时间", mark: "T", keywords: ["Unix", "UTC", "本地时间", "日期"] },
  { id: "text", name: "文本处理", description: "统计、清理、排序、去重与大小写转换", category: "文本", mark: "Aa", keywords: ["字符", "行", "空白", "排序"] },
  { id: "json", name: "JSON 工具", description: "格式化、压缩与语法错误提示", category: "文本", mark: "{}", keywords: ["格式化", "压缩", "校验"] },
  { id: "diff", name: "文本对比", description: "逐行查看新增、删除与未变化内容", category: "文本", mark: "Δ", keywords: ["差异", "比较", "新增", "删除"] },
  { id: "encoding", name: "编码与进制", description: "Base64、URL 编码与二/八/十/十六进制", category: "编码", mark: "01", keywords: ["Base64", "URL", "二进制", "十六进制"] },
  { id: "qr", name: "二维码", description: "在浏览器本地生成并下载 PNG", category: "实用", mark: "QR", keywords: ["二维码", "PNG", "网址"] },
  { id: "color", name: "颜色工具", description: "颜色选择器与 HEX、RGB、HSL 互转", category: "实用", mark: "●", keywords: ["颜色", "HEX", "RGB", "HSL"] },
];

const categories = ["全部", ...Array.from(new Set(tools.map((tool) => tool.category)))];
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("应用根节点不存在");
const appRoot = app;

function getStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

const storage = createStorageAdapter(getStorage());
const favoriteIds = new Set<ToolId>(storage.read<ToolId[]>("workbench:favorites", []));
const recentIds = storage.read<ToolId[]>("workbench:recent", []).filter((id): id is ToolId => tools.some((tool) => tool.id === id));
const state: { query: string; category: string; homeMode: HomeMode; theme: Theme } = {
  query: "", category: "全部", homeMode: "all", theme: storage.read<Theme>("workbench:theme", "system"),
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getTool(id: ToolId): Tool { return tools.find((tool) => tool.id === id) ?? tools[0]!; }

function setTheme(theme: Theme): void {
  state.theme = theme;
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  storage.write("workbench:theme", theme);
}

function saveFavorites(): void { storage.write("workbench:favorites", [...favoriteIds]); }

function saveRecent(): void { storage.write("workbench:recent", recentIds); }

function recordRecent(id: ToolId): void {
  const next = [id, ...recentIds.filter((recentId) => recentId !== id)].slice(0, 8);
  recentIds.splice(0, recentIds.length, ...next);
  saveRecent();
}

function formatLocalDate(date: Date): string { return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }); }

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function feedback(element: HTMLElement | null, message: string, kind: "ok" | "error" | "muted" = "muted"): void {
  if (!element) return;
  element.textContent = message;
  element.className = `feedback ${kind}`;
}

async function copyText(value: string, target: HTMLElement | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    feedback(target, "已复制到剪贴板", "ok");
  } catch {
    feedback(target, "浏览器阻止了自动复制，请手动选择并复制。", "error");
  }
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderHeader(): string {
  const themeLabel = state.theme === "system" ? "跟随系统" : state.theme === "light" ? "浅色" : "深色";
  return `<header class="topbar">
    <button class="brand" data-nav="home" aria-label="回到工具首页"><span class="brand-mark">▦</span><span><strong>日常工作工具箱</strong><small>清晰、快速、默认留在本机</small></span></button>
    <div class="topbar-actions"><span class="storage-state ${storage.available ? "" : "warning"}">${storage.available ? "本地偏好已启用" : "本地存储不可用，工具仍可使用"}</span><label class="theme-select"><span class="sr-only">主题</span><select id="theme-select" aria-label="选择主题"><option value="system" ${state.theme === "system" ? "selected" : ""}>跟随系统</option><option value="light" ${state.theme === "light" ? "selected" : ""}>浅色</option><option value="dark" ${state.theme === "dark" ? "selected" : ""}>深色</option></select><span>${themeLabel}</span></label></div>
  </header>`;
}

function renderSidebar(active: ToolId | "home"): string {
  const isHome = active === "home";
  return `<aside class="sidebar" aria-label="工具导航">
    <div class="sidebar-label">工作区</div>
    <button class="side-link ${isHome && state.homeMode === "all" ? "active" : ""}" data-nav="home"><span>⌂</span>全部工具 <em>${tools.length}</em></button>
    <button class="side-link ${isHome && state.homeMode === "favorites" ? "active" : ""}" data-nav="favorites"><span>☆</span>我的收藏 <em>${favoriteIds.size}</em></button>
    <button class="side-link ${isHome && state.homeMode === "recent" ? "active" : ""}" data-nav="recent"><span>◷</span>最近使用 <em>${recentIds.length}</em></button>
    <div class="sidebar-label">工具分类</div>
    <div class="side-categories">${categories.filter((category) => category !== "全部").map((category) => `<button class="side-link compact ${isHome && state.category === category ? "active" : ""}" data-category="${escapeHtml(category)}"><span>·</span>${escapeHtml(category)}</button>`).join("")}</div>
    <div class="sidebar-note"><span class="note-dot"></span><div><strong>专业工具即将加入</strong><p>后续会以独立迭代增加经过验证的过程工程工具，本版不包含专业计算。</p></div></div>
  </aside>`;
}

function filteredTools(): Tool[] {
  const query = state.query.trim().toLowerCase();
  return tools.filter((tool) => {
    const matchesMode = state.homeMode === "all" || (state.homeMode === "favorites" ? favoriteIds.has(tool.id) : recentIds.includes(tool.id));
    const matchesCategory = state.category === "全部" || tool.category === state.category;
    const haystack = [tool.name, tool.description, tool.category, ...tool.keywords].join(" ").toLowerCase();
    return matchesMode && matchesCategory && (!query || haystack.includes(query));
  });
}

function renderToolCards(): string {
  const visible = filteredTools();
  if (visible.length === 0) return `<div class="empty-state"><span class="empty-mark">⌕</span><strong>没有匹配的工具</strong><p>试试其他关键词，或清除当前筛选条件。</p><button class="button secondary" data-clear-filters>清除筛选</button></div>`;
  return visible.map((tool) => `<article class="tool-card" data-open-tool="${tool.id}" tabindex="0" role="button" aria-label="打开${escapeHtml(tool.name)}">
    <div class="tool-card-top"><span class="tool-mark mark-${tool.id}">${escapeHtml(tool.mark)}</span><button class="favorite-button ${favoriteIds.has(tool.id) ? "saved" : ""}" data-favorite="${tool.id}" aria-label="${favoriteIds.has(tool.id) ? "取消收藏" : "收藏"}${escapeHtml(tool.name)}">${favoriteIds.has(tool.id) ? "★" : "☆"}</button></div>
    <div><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.description)}</p></div><div class="tool-card-footer"><span>${escapeHtml(tool.category)}</span><span class="arrow">↗</span></div>
  </article>`).join("");
}

function renderHome(): string {
  const modeLabel = state.homeMode === "favorites" ? "我的收藏" : state.homeMode === "recent" ? "最近使用" : "全部工具";
  return `<section class="home-view">
    <div class="hero"><div><p class="eyebrow">DAILY WORKBENCH / 01</p><h1>把每天会用到的<br><span>小工具放在一起。</span></h1><p class="hero-copy">一个面向小团队的通用工具箱。无需登录，计算与文本处理默认在当前浏览器完成。</p></div><div class="hero-signal"><span class="signal-ring"></span><div><strong>本地优先</strong><small>Local-first utilities</small></div></div></div>
    <div class="privacy-banner"><span class="privacy-icon">⌁</span><div><strong>隐私边界清晰</strong><p>输入默认仅在当前浏览器处理；天气查询会向天气服务发送所搜索的城市。本站不含账号、同步、埋点或公司内部资料。</p></div></div>
    <div class="home-toolbar"><label class="search-box"><span>⌕</span><input id="tool-search" type="search" value="${escapeHtml(state.query)}" placeholder="搜索工具名称或关键词…" autocomplete="off"><kbd>/</kbd></label><div class="category-chips" aria-label="工具分类">${categories.map((category) => `<button class="chip ${state.category === category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div></div>
    <div class="section-heading"><div><p class="eyebrow">TOOL INDEX</p><h2>${modeLabel}</h2></div><span class="result-count">${filteredTools().length} / ${tools.length}</span></div>
    <div class="tool-grid" id="tool-grid">${renderToolCards()}</div>
  </section>`;
}

function renderToolShell(tool: Tool): string {
  return `<section class="tool-view"><div class="tool-crumb"><button class="back-button" data-nav="home">← 返回工具首页</button><span>/</span><span>${escapeHtml(tool.category)}</span></div><div class="tool-heading"><div class="tool-heading-mark mark-${tool.id}">${escapeHtml(tool.mark)}</div><div><p class="eyebrow">LOCAL UTILITY / ${String(tools.findIndex((item) => item.id === tool.id) + 1).padStart(2, "0")}</p><h1>${escapeHtml(tool.name)}</h1><p>${escapeHtml(tool.description)}</p></div></div><div class="tool-panel" id="tool-panel">${renderToolContent(tool.id)}</div></section>`;
}

function renderToolContent(id: ToolId): string {
  switch (id) {
    case "calculator": return `<div class="calculator-layout"><div class="calc-main"><label for="calc-input">表达式</label><div class="calc-input-row"><input id="calc-input" type="text" inputmode="decimal" placeholder="例如：sqrt(81) + 12.5% × 20" autocomplete="off"><button class="button primary" id="calc-run">计算 <kbd>Enter</kbd></button></div><div class="calc-result" id="calc-result" aria-live="polite">等待输入…</div><p class="hint">支持 + − × ÷、括号、^、百分比、sqrt、sin、cos、tan、log、ln、π、e。不会执行任意代码。</p></div><div class="keypad" aria-label="计算器按键">${["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "%", "+", "(", ")", "^", "⌫"].map((key) => `<button class="calc-key ${key === "⌫" ? "danger-key" : ""}" data-calc-key="${escapeHtml(key)}">${escapeHtml(key)}</button>`).join("")}<button class="calc-key function-key" data-calc-key="sqrt(">√</button><button class="calc-key function-key" data-calc-key="pi">π</button><button class="calc-key clear-key" data-calc-clear>清除</button></div></div>`;
    case "units": return `<div class="unit-converter"><div class="form-row"><label>类别<select id="unit-category">${Object.entries(UNIT_CATEGORIES).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join("")}</select></label><label>从<select id="unit-from"></select></label><button class="swap-button" id="unit-swap" aria-label="交换单位">⇄</button><label>换算为<select id="unit-to"></select></label></div><div class="conversion-row"><label><span>输入值</span><input id="unit-input" type="number" inputmode="decimal" value="1"></label><span class="equals">=</span><label><span>结果</span><div class="copy-field"><input id="unit-output" type="text" readonly aria-label="换算结果"><button class="icon-button" id="unit-copy" aria-label="复制结果">⧉</button></div></label></div><div class="feedback" id="unit-feedback" aria-live="polite">选择类别后双向即时换算。</div></div>`;
    case "weather": return `<div class="weather-tool"><div class="weather-search"><label for="weather-city">城市</label><div class="calc-input-row"><input id="weather-city" type="search" value="${escapeHtml(storage.read<string>("workbench:weather-city", ""))}" placeholder="例如：上海、Singapore" autocomplete="off"><button class="button primary" id="weather-search-button">查询天气</button></div><p class="hint">默认摄氏度，不强制获取浏览器定位。数据来自 <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo ↗</a>。</p></div><div id="weather-status" class="feedback" aria-live="polite">请输入城市开始查询。</div><div id="weather-result"></div></div>`;
    case "markdown": return `<div class="markdown-tool"><div class="markdown-actions"><span class="hint">草稿仅自动保存到当前浏览器。</span><div><button class="button secondary" id="markdown-copy">复制 Markdown</button><button class="button secondary" id="markdown-copy-html">复制渲染结果</button><button class="button primary" id="markdown-download">下载 .md</button></div></div><div class="markdown-tabs"><button class="active" data-md-tab="edit">编辑</button><button data-md-tab="preview">预览</button></div><div class="markdown-grid"><label class="markdown-editor" data-md-pane="edit"><span class="sr-only">Markdown 编辑器</span><textarea id="markdown-input" spellcheck="false" placeholder="# 今日记录\n\n- 一个清单\n- \`Ctrl + Enter\` 之外也可以直接预览"></textarea></label><article class="markdown-preview" data-md-pane="preview" id="markdown-preview" aria-label="Markdown 预览"></article></div><div class="feedback" id="markdown-feedback" aria-live="polite"></div></div>`;
    case "datetime": return `<div class="datetime-grid"><section class="subpanel"><div class="subpanel-title"><span class="tool-mark mark-datetime">T</span><div><h2>Unix 时间戳</h2><p>秒和毫秒明确分开，结果同时展示本地时间与 UTC。</p></div></div><label>时间戳<input id="timestamp-input" type="number" inputmode="numeric" placeholder="例如：1720000000"></label><div class="inline-fields"><label>单位<select id="timestamp-unit"><option value="seconds">秒</option><option value="milliseconds">毫秒</option></select></label><button class="button secondary" id="timestamp-now">使用现在</button></div><div id="timestamp-result" class="result-box" aria-live="polite">等待输入…</div><label>日期时间<input id="date-to-timestamp-input" type="datetime-local"></label><div class="inline-fields"><label>输出单位<select id="timestamp-output-unit"><option value="seconds">秒</option><option value="milliseconds">毫秒</option></select></label><button class="button secondary" id="date-to-timestamp">日期转时间戳</button></div><div id="date-to-timestamp-result" class="result-box" aria-live="polite">选择日期后转换。</div></section><section class="subpanel"><div class="subpanel-title"><span class="tool-mark mark-datetime">Δ</span><div><h2>日期差值</h2><p>输入本地日期时间，查看两个时间点之间的差值。</p></div></div><label>开始<input id="date-start" type="datetime-local"></label><label>结束<input id="date-end" type="datetime-local"></label><div id="date-diff-result" class="result-box" aria-live="polite">等待输入…</div></section><section class="subpanel"><div class="subpanel-title"><span class="tool-mark mark-datetime">＋</span><div><h2>日期加减</h2><p>按天、小时或分钟调整日期。</p></div></div><label>基准日期<input id="date-adjust-base" type="datetime-local"></label><div class="inline-fields"><label>数量<input id="date-adjust-amount" type="number" value="1"></label><label>单位<select id="date-adjust-unit"><option value="days">天</option><option value="hours">小时</option><option value="minutes">分钟</option></select></label></div><div id="date-adjust-result" class="result-box" aria-live="polite">等待输入…</div></section></div>`;
    case "text": return `<div class="text-tool"><div class="text-actions"><div class="stats" id="text-stats">字符 0 · 字数 0 · 行数 0</div><div class="button-group"><button class="button secondary" data-text-action="upper">大写</button><button class="button secondary" data-text-action="lower">小写</button><button class="button secondary" data-text-action="trim">去首尾空白</button><button class="button secondary" data-text-action="collapse">去多余空白</button><button class="button secondary" data-text-action="sort">行排序</button><button class="button secondary" data-text-action="unique">行去重</button><button class="button primary" data-text-copy>复制</button><button class="button danger" data-text-clear>清空</button></div></div><textarea id="text-input" class="large-textarea" placeholder="在这里输入或粘贴文本…"></textarea><div class="feedback" id="text-feedback" aria-live="polite"></div></div>`;
    case "json": return `<div class="json-tool"><div class="split-actions"><span class="hint">内容只在浏览器本地处理，不会上传。</span><div><button class="button secondary" id="json-format">格式化</button><button class="button secondary" id="json-compact">压缩</button><button class="button primary" id="json-copy">复制结果</button></div></div><div class="json-grid"><label><span>输入 JSON</span><textarea id="json-input" spellcheck="false" placeholder='{"name":"workbench","enabled":true}'></textarea></label><label><span>结果</span><textarea id="json-output" spellcheck="false" readonly></textarea></label></div><div class="feedback" id="json-feedback" aria-live="polite"></div></div>`;
    case "diff": return `<div class="diff-tool"><div class="split-actions"><span class="hint">长文本会先显示处理状态，比较全程在浏览器内完成。</span><div><button class="button primary" id="diff-run">开始比较</button><button class="button secondary" id="diff-clear">清空</button></div></div><div class="diff-input-grid"><label><span>原文本</span><textarea id="diff-left" spellcheck="false" placeholder="原始内容…"></textarea></label><label><span>新文本</span><textarea id="diff-right" spellcheck="false" placeholder="修改后的内容…"></textarea></label></div><div id="diff-status" class="feedback" aria-live="polite"></div><div id="diff-output" class="diff-output"></div></div>`;
    case "encoding": return `<div class="encoding-tool"><div class="encoding-tabs"><button class="active" data-encoding-tab="base64">Base64</button><button data-encoding-tab="url">URL</button><button data-encoding-tab="integer">进制</button></div><div data-encoding-pane="base64"><div class="split-actions"><span class="hint">UTF-8 文本编码，错误时保留原输入。</span><div><button class="button secondary" data-encoding-action="base64-encode">编码</button><button class="button secondary" data-encoding-action="base64-decode">解码</button><button class="button primary" data-encoding-copy>复制结果</button></div></div><label>输入<textarea id="base64-input" spellcheck="false" placeholder="输入文本或 Base64…"></textarea></label><label>结果<textarea id="base64-output" spellcheck="false" readonly></textarea></label><div class="feedback" id="base64-feedback"></div></div><div class="hidden" data-encoding-pane="url"><div class="split-actions"><span class="hint">使用标准 URL percent-encoding。</span><div><button class="button secondary" data-encoding-action="url-encode">编码</button><button class="button secondary" data-encoding-action="url-decode">解码</button><button class="button primary" data-encoding-copy>复制结果</button></div></div><label>输入<textarea id="url-input" spellcheck="false" placeholder="输入文本或 URL 编码内容…"></textarea></label><label>结果<textarea id="url-output" spellcheck="false" readonly></textarea></label><div class="feedback" id="url-feedback"></div></div><div class="hidden" data-encoding-pane="integer"><div class="split-actions"><span class="hint">仅处理非负、安全范围内的整数。</span><div><button class="button primary" data-integer-convert>转换</button><button class="button secondary" data-encoding-copy>复制结果</button></div></div><div class="inline-fields"><label>输入进制<select id="integer-from"><option value="2">二进制</option><option value="8">八进制</option><option value="10" selected>十进制</option><option value="16">十六进制</option></select></label><label>输出进制<select id="integer-to"><option value="2">二进制</option><option value="8">八进制</option><option value="10">十进制</option><option value="16" selected>十六进制</option></select></label></div><label>输入<input id="integer-input" type="text" placeholder="例如：255"></label><label>结果<input id="integer-output" type="text" readonly></label><div class="feedback" id="integer-feedback"></div></div></div>`;
    case "qr": return `<div class="qr-tool"><div class="qr-input"><label for="qr-input">文本或网址</label><textarea id="qr-input" placeholder="输入要编码的内容…"></textarea><p class="hint">二维码在浏览器本地生成，不会自动访问或校验输入的网址。</p><div class="button-group"><button class="button primary" id="qr-generate">生成二维码</button><button class="button secondary" id="qr-download" disabled>下载 PNG</button></div><div class="feedback" id="qr-feedback"></div></div><div class="qr-result"><div class="qr-canvas-wrap"><div id="qr-placeholder">输入内容后生成<br>本地二维码</div><img id="qr-image" alt="生成的二维码" hidden></div></div></div>`;
    case "color": return `<div class="color-tool"><div class="color-picker-card"><label>颜色选择器<input id="color-picker" type="color" value="#2f6fed"></label><label>输入颜色<input id="color-input" type="text" value="#2F6FED" placeholder="#2F6FED / rgb(...) / hsl(...)" autocomplete="off"></label><div id="color-swatch" class="color-swatch" aria-label="当前颜色"></div></div><div class="color-results"><div class="color-result"><span>HEX</span><strong id="color-hex">—</strong><button data-color-copy="hex">复制</button></div><div class="color-result"><span>RGB</span><strong id="color-rgb">—</strong><button data-color-copy="rgb">复制</button></div><div class="color-result"><span>HSL</span><strong id="color-hsl">—</strong><button data-color-copy="hsl">复制</button></div><div class="feedback" id="color-feedback"></div></div></div>`;
  }
}

function renderWeatherResult(result: WeatherResult, fahrenheit = false): string {
  const convert = (value: number) => fahrenheit ? value * 9 / 5 + 32 : value;
  const unit = fahrenheit ? "°F" : "°C";
  return `<div class="weather-card"><div class="weather-current"><div><p class="eyebrow">CURRENT / ${escapeHtml(result.timezone)}</p><h2>${escapeHtml(result.city)} <small>${escapeHtml(result.country)}</small></h2><div class="weather-temp">${formatNumber(convert(result.temperature))}${unit}</div><p>${weatherCodeText(result.code)} · 体感 ${formatNumber(convert(result.apparent))}${unit}</p></div><div class="weather-big-icon">${result.code === 0 ? "☀" : "☁"}</div></div><div class="weather-metrics"><span><strong>${formatNumber(result.humidity)}%</strong><small>相对湿度</small></span><span><strong>${formatNumber(result.wind)} km/h</strong><small>风速</small></span><label class="unit-toggle">温度单位<select id="weather-unit"><option value="c" ${!fahrenheit ? "selected" : ""}>摄氏度</option><option value="f" ${fahrenheit ? "selected" : ""}>华氏度</option></select></label></div><div class="forecast-grid">${result.days.map((day) => `<div class="forecast-day"><strong>${escapeHtml(new Date(`${day.date}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "short" }))}</strong><span class="forecast-icon">${day.code === 0 ? "☀" : "☁"}</span><span>${formatNumber(convert(day.high))}° / ${formatNumber(convert(day.low))}°</span><small>${weatherCodeText(day.code)}</small></div>`).join("")}</div><div class="weather-footer">数据更新时间：${escapeHtml(formatLocalDate(new Date(result.fetchedAt)))} · 来源：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo ↗</a></div></div>`;
}

function bindCalculator(): void {
  const input = document.querySelector<HTMLInputElement>("#calc-input");
  const result = document.querySelector<HTMLElement>("#calc-result");
  const calculate = () => {
    if (!input || !result) return;
    try { result.textContent = formatNumber(evaluateExpression(input.value)); result.className = "calc-result success"; }
    catch (error) { result.textContent = error instanceof Error ? error.message : "表达式无效"; result.className = "calc-result error"; }
  };
  document.querySelector("#calc-run")?.addEventListener("click", calculate);
  input?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); calculate(); } });
  document.querySelectorAll<HTMLButtonElement>("[data-calc-key]").forEach((button) => button.addEventListener("click", () => {
    if (!input) return;
    const key = button.dataset.calcKey ?? "";
    if (key === "⌫") input.value = input.value.slice(0, -1);
    else input.value += key;
    input.focus();
  }));
  document.querySelector("[data-calc-clear]")?.addEventListener("click", () => { if (input) input.value = ""; if (result) { result.textContent = "等待输入…"; result.className = "calc-result"; } input?.focus(); });
}

function fillUnitSelect(select: HTMLSelectElement, category: UnitCategory, selected?: string): void {
  select.innerHTML = Object.entries(UNIT_CATEGORIES[category].units).map(([key, unit]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${unit.label}</option>`).join("");
}

function bindUnits(): void {
  const category = document.querySelector<HTMLSelectElement>("#unit-category"); const from = document.querySelector<HTMLSelectElement>("#unit-from"); const to = document.querySelector<HTMLSelectElement>("#unit-to"); const input = document.querySelector<HTMLInputElement>("#unit-input"); const output = document.querySelector<HTMLInputElement>("#unit-output"); const status = document.querySelector<HTMLElement>("#unit-feedback");
  if (!category || !from || !to || !input || !output) return;
  const updateUnits = () => { const key = category.value as UnitCategory; fillUnitSelect(from, key); fillUnitSelect(to, key, Object.keys(UNIT_CATEGORIES[key].units)[1]); update(); };
  const update = () => { try { output.value = formatNumber(convertUnit(Number(input.value), category.value as UnitCategory, from.value, to.value)); feedback(status, "双向即时换算", "ok"); } catch (error) { output.value = ""; feedback(status, error instanceof Error ? error.message : "换算失败", "error"); } };
  category.addEventListener("change", updateUnits); from.addEventListener("change", update); to.addEventListener("change", update); input.addEventListener("input", update);
  document.querySelector("#unit-swap")?.addEventListener("click", () => { const value = from.value; from.value = to.value; to.value = value; update(); });
  document.querySelector("#unit-copy")?.addEventListener("click", () => copyText(output.value, status));
  updateUnits();
}

function bindWeather(): void {
  const input = document.querySelector<HTMLInputElement>("#weather-city"); const button = document.querySelector<HTMLButtonElement>("#weather-search-button"); const status = document.querySelector<HTMLElement>("#weather-status"); const resultBox = document.querySelector<HTMLElement>("#weather-result");
  let lastResult: WeatherResult | null = null; let fahrenheit = false;
  const search = async () => {
    if (!input || !status || !resultBox) return;
    button?.setAttribute("aria-busy", "true"); button?.setAttribute("disabled", "true"); feedback(status, "正在查询天气…", "muted");
    try { const result = await fetchWeather(input.value); lastResult = result; storage.write("workbench:weather-city", input.value.trim()); resultBox.innerHTML = renderWeatherResult(result, fahrenheit); feedback(status, "查询成功", "ok"); resultBox.querySelector("#weather-unit")?.addEventListener("change", (event) => { fahrenheit = (event.target as HTMLSelectElement).value === "f"; resultBox.innerHTML = renderWeatherResult(result, fahrenheit); bindWeatherUnit(); }); bindWeatherUnit(); }
    catch (error) { feedback(status, error instanceof WeatherError ? error.message : "天气查询失败，请稍后重试。", "error"); }
    finally { button?.removeAttribute("aria-busy"); button?.removeAttribute("disabled"); }
  };
  const bindWeatherUnit = () => { resultBox?.querySelector("#weather-unit")?.addEventListener("change", (event) => { fahrenheit = (event.target as HTMLSelectElement).value === "f"; if (lastResult && resultBox) resultBox.innerHTML = renderWeatherResult(lastResult, fahrenheit); bindWeatherUnit(); }); };
  button?.addEventListener("click", () => void search()); input?.addEventListener("keydown", (event) => { if (event.key === "Enter") void search(); });
}

function bindMarkdown(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#markdown-input"); const preview = document.querySelector<HTMLElement>("#markdown-preview"); const status = document.querySelector<HTMLElement>("#markdown-feedback");
  if (!input || !preview) return;
  input.value = storage.read<string>("workbench:markdown-draft", "");
  const update = () => { storage.write("workbench:markdown-draft", input.value); preview.innerHTML = renderMarkdown(input.value, (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })); };
  input.addEventListener("input", update); update();
  document.querySelector("#markdown-copy")?.addEventListener("click", () => copyText(input.value, status));
  document.querySelector("#markdown-copy-html")?.addEventListener("click", () => copyText(preview.innerHTML, status));
  document.querySelector("#markdown-download")?.addEventListener("click", () => { downloadText("workbench-note.md", input.value, "text/markdown;charset=utf-8"); feedback(status, "已开始下载 Markdown 文件", "ok"); });
  document.querySelectorAll<HTMLButtonElement>("[data-md-tab]").forEach((tab) => tab.addEventListener("click", () => { const pane = tab.dataset.mdTab; document.querySelectorAll("[data-md-tab]").forEach((item) => item.classList.toggle("active", item === tab)); document.querySelectorAll<HTMLElement>("[data-md-pane]").forEach((item) => item.classList.toggle("mobile-visible", item.dataset.mdPane === pane)); }));
}

function bindDateTime(): void {
  const now = new Date(); const timestamp = document.querySelector<HTMLInputElement>("#timestamp-input"); const timestampUnit = document.querySelector<HTMLSelectElement>("#timestamp-unit"); const timestampResult = document.querySelector<HTMLElement>("#timestamp-result"); const dateToTimestampInput = document.querySelector<HTMLInputElement>("#date-to-timestamp-input"); const timestampOutputUnit = document.querySelector<HTMLSelectElement>("#timestamp-output-unit"); const dateToTimestampResult = document.querySelector<HTMLElement>("#date-to-timestamp-result"); const start = document.querySelector<HTMLInputElement>("#date-start"); const end = document.querySelector<HTMLInputElement>("#date-end"); const diffResult = document.querySelector<HTMLElement>("#date-diff-result"); const base = document.querySelector<HTMLInputElement>("#date-adjust-base"); const amount = document.querySelector<HTMLInputElement>("#date-adjust-amount"); const adjustUnit = document.querySelector<HTMLSelectElement>("#date-adjust-unit"); const adjustResult = document.querySelector<HTMLElement>("#date-adjust-result");
  const updateTimestamp = () => { if (!timestamp || !timestampResult || !timestamp.value) { if (timestampResult) timestampResult.textContent = "等待输入…"; return; } try { const date = timestampToDate(Number(timestamp.value), timestampUnit?.value as "seconds" | "milliseconds"); timestampResult.innerHTML = `<strong>本地</strong> ${escapeHtml(formatLocalDate(date))}<br><strong>UTC</strong> ${escapeHtml(date.toISOString())}`; } catch (error) { timestampResult.textContent = error instanceof Error ? error.message : "时间戳无效"; } };
  const updateDiff = () => { if (!start?.value || !end?.value || !diffResult) return; try { const value = dateDifference(start.value, end.value); diffResult.textContent = `${value.days} 天 ${value.hours} 小时 ${value.minutes} 分 ${value.seconds} 秒（${value.milliseconds} ms）`; } catch (error) { diffResult.textContent = error instanceof Error ? error.message : "日期无效"; } };
  const updateAdjust = () => { if (!base?.value || !amount || !adjustResult) return; try { adjustResult.textContent = new Date(adjustDate(base.value, Number(amount.value), adjustUnit?.value as "days" | "hours" | "minutes")).toLocaleString("zh-CN"); } catch (error) { adjustResult.textContent = error instanceof Error ? error.message : "日期无效"; } };
  const updateDateToTimestamp = () => { if (!dateToTimestampInput?.value || !dateToTimestampResult) return; try { dateToTimestampResult.textContent = String(dateToTimestamp(dateToTimestampInput.value, timestampOutputUnit?.value as "seconds" | "milliseconds")); } catch (error) { dateToTimestampResult.textContent = error instanceof Error ? error.message : "日期无效"; } };
  [timestamp, timestampUnit].forEach((element) => element?.addEventListener("input", updateTimestamp)); [dateToTimestampInput, timestampOutputUnit].forEach((element) => element?.addEventListener("input", updateDateToTimestamp)); [start, end].forEach((element) => element?.addEventListener("input", updateDiff)); [base, amount, adjustUnit].forEach((element) => element?.addEventListener("input", updateAdjust));
  document.querySelector("#timestamp-now")?.addEventListener("click", () => { if (timestamp) { timestamp.value = String(Math.floor(now.getTime() / 1000)); updateTimestamp(); } });
  document.querySelector("#date-to-timestamp")?.addEventListener("click", updateDateToTimestamp);
  if (dateToTimestampInput) dateToTimestampInput.value = localDateTimeValue(now); if (start) start.value = localDateTimeValue(new Date(now.getTime() - 3_600_000)); if (end) end.value = localDateTimeValue(now); if (base) base.value = localDateTimeValue(now); updateDateToTimestamp(); updateDiff(); updateAdjust();
}

function bindText(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#text-input"); const stats = document.querySelector<HTMLElement>("#text-stats"); const status = document.querySelector<HTMLElement>("#text-feedback"); if (!input || !stats) return;
  const update = () => { const value = textStats(input.value); stats.textContent = `字符 ${value.characters} · 字数 ${value.words} · 行数 ${value.lines}`; };
  input.addEventListener("input", update); update();
  document.querySelectorAll<HTMLButtonElement>("[data-text-action]").forEach((button) => button.addEventListener("click", () => { const action = button.dataset.textAction; if (action === "upper") input.value = input.value.toLocaleUpperCase(); if (action === "lower") input.value = input.value.toLocaleLowerCase(); if (action === "trim") input.value = input.value.trim(); if (action === "collapse") input.value = input.value.replace(/\s+/gu, " ").trim(); if (action === "sort") input.value = sortLines(input.value); if (action === "unique") input.value = uniqueLines(input.value); update(); }));
  document.querySelector("[data-text-copy]")?.addEventListener("click", () => copyText(input.value, status)); document.querySelector("[data-text-clear]")?.addEventListener("click", () => { input.value = ""; update(); feedback(status, "已清空", "ok"); });
}

function bindJson(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#json-input"); const output = document.querySelector<HTMLTextAreaElement>("#json-output"); const status = document.querySelector<HTMLElement>("#json-feedback"); if (!input || !output) return;
  const transform = (compact: boolean) => { const result = jsonTransform(input.value, compact); if (result.ok) { output.value = result.value; feedback(status, compact ? "已压缩" : "已格式化", "ok"); } else { output.value = ""; feedback(status, result.error, "error"); } };
  document.querySelector("#json-format")?.addEventListener("click", () => transform(false)); document.querySelector("#json-compact")?.addEventListener("click", () => transform(true)); document.querySelector("#json-copy")?.addEventListener("click", () => copyText(output.value, status));
}

function bindDiff(): void {
  const left = document.querySelector<HTMLTextAreaElement>("#diff-left"); const right = document.querySelector<HTMLTextAreaElement>("#diff-right"); const output = document.querySelector<HTMLElement>("#diff-output"); const status = document.querySelector<HTMLElement>("#diff-status"); if (!left || !right || !output) return;
  document.querySelector("#diff-run")?.addEventListener("click", () => { feedback(status, "正在比较…", "muted"); output.innerHTML = ""; window.setTimeout(() => { const parts = diffLines(left.value, right.value); output.innerHTML = parts.map((part) => `<span class="diff-line ${part.added ? "added" : part.removed ? "removed" : "unchanged"}">${part.value.split("\n").map((line) => line ? escapeHtml(`${part.added ? "+ " : part.removed ? "− " : "  "}${line}`) : "").join("\n")}</span>`).join(""); feedback(status, "比较完成，新增和删除已标色。", "ok"); }, 20); });
  document.querySelector("#diff-clear")?.addEventListener("click", () => { left.value = ""; right.value = ""; output.innerHTML = ""; feedback(status, "已清空", "ok"); });
}

function bindEncoding(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-encoding-tab]").forEach((tab) => tab.addEventListener("click", () => { document.querySelectorAll("[data-encoding-tab]").forEach((item) => item.classList.toggle("active", item === tab)); document.querySelectorAll<HTMLElement>("[data-encoding-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.encodingPane !== tab.dataset.encodingTab)); }));
  const base64Input = document.querySelector<HTMLTextAreaElement>("#base64-input"); const base64Output = document.querySelector<HTMLTextAreaElement>("#base64-output"); const base64Status = document.querySelector<HTMLElement>("#base64-feedback");
  document.querySelectorAll("[data-encoding-action]").forEach((button) => button.addEventListener("click", () => { const action = (button as HTMLElement).dataset.encodingAction; try { if (action === "base64-encode" && base64Input && base64Output) base64Output.value = encodeBase64(base64Input.value); if (action === "base64-decode" && base64Input && base64Output) base64Output.value = decodeBase64(base64Input.value); if (action === "url-encode") { const input = document.querySelector<HTMLTextAreaElement>("#url-input"); const output = document.querySelector<HTMLTextAreaElement>("#url-output"); if (input && output) output.value = encodeUrl(input.value); } if (action === "url-decode") { const input = document.querySelector<HTMLTextAreaElement>("#url-input"); const output = document.querySelector<HTMLTextAreaElement>("#url-output"); if (input && output) output.value = decodeUrl(input.value); } if (action?.startsWith("base64")) feedback(base64Status, "处理完成", "ok"); else feedback(document.querySelector<HTMLElement>("#url-feedback"), "处理完成", "ok"); } catch (error) { feedback(action?.startsWith("base64") ? base64Status : document.querySelector<HTMLElement>("#url-feedback"), error instanceof Error ? error.message : "编码输入无效", "error"); } }));
  document.querySelector("[data-integer-convert]")?.addEventListener("click", () => { const input = document.querySelector<HTMLInputElement>("#integer-input"); const output = document.querySelector<HTMLInputElement>("#integer-output"); const status = document.querySelector<HTMLElement>("#integer-feedback"); try { if (!input || !output) return; output.value = convertInteger(input.value, Number(document.querySelector<HTMLSelectElement>("#integer-from")?.value) as 2 | 8 | 10 | 16, Number(document.querySelector<HTMLSelectElement>("#integer-to")?.value) as 2 | 8 | 10 | 16); feedback(status, "转换完成", "ok"); } catch (error) { feedback(status, error instanceof Error ? error.message : "整数无效", "error"); } });
  document.querySelectorAll("[data-encoding-copy]").forEach((button) => button.addEventListener("click", () => { const pane = (button as HTMLElement).closest("[data-encoding-pane]"); const output = pane?.querySelector<HTMLTextAreaElement>("textarea[readonly]") ?? pane?.querySelector<HTMLInputElement>("input[readonly]"); copyText(output?.value ?? "", pane?.querySelector<HTMLElement>(".feedback") ?? null); }));
}

function bindQr(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#qr-input"); const image = document.querySelector<HTMLImageElement>("#qr-image"); const placeholder = document.querySelector<HTMLElement>("#qr-placeholder"); const generate = document.querySelector<HTMLButtonElement>("#qr-generate"); const download = document.querySelector<HTMLButtonElement>("#qr-download"); const status = document.querySelector<HTMLElement>("#qr-feedback"); let dataUrl = "";
  generate?.addEventListener("click", () => { if (!input || !image || !placeholder || !input.value.trim()) { feedback(status, "请输入要生成二维码的内容。", "error"); return; } void QRCode.toDataURL(input.value, { width: 280, margin: 2, errorCorrectionLevel: "M" }).then((url) => { dataUrl = url; image.src = url; image.hidden = false; placeholder.hidden = true; if (download) download.disabled = false; feedback(status, "二维码已在本地生成", "ok"); }).catch(() => feedback(status, "二维码生成失败，请缩短输入后重试。", "error")); });
  download?.addEventListener("click", () => { if (dataUrl) { const link = document.createElement("a"); link.href = dataUrl; link.download = "workbench-qr.png"; link.click(); feedback(status, "已开始下载 PNG", "ok"); } });
}

function bindColor(): void {
  const picker = document.querySelector<HTMLInputElement>("#color-picker"); const input = document.querySelector<HTMLInputElement>("#color-input"); const swatch = document.querySelector<HTMLElement>("#color-swatch"); const status = document.querySelector<HTMLElement>("#color-feedback"); let values = { hex: "", rgb: "", hsl: "" };
  const update = (value: string) => { try { const rgb = parseColor(value); const hsl = rgbToHsl(rgb); values = { hex: rgbToHex(rgb), rgb: `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`, hsl: `hsl(${Math.round(hsl[0])}, ${Math.round(hsl[1])}%, ${Math.round(hsl[2])}%)` }; document.querySelector("#color-hex")!.textContent = values.hex; document.querySelector("#color-rgb")!.textContent = values.rgb; document.querySelector("#color-hsl")!.textContent = values.hsl; if (swatch) swatch.style.background = values.hex; feedback(status, "颜色有效", "ok"); } catch (error) { feedback(status, error instanceof Error ? error.message : "颜色无效", "error"); } };
  picker?.addEventListener("input", () => { if (picker && input) { input.value = picker.value; update(picker.value); } }); input?.addEventListener("input", () => update(input.value)); document.querySelectorAll<HTMLButtonElement>("[data-color-copy]").forEach((button) => button.addEventListener("click", () => copyText(values[button.dataset.colorCopy as keyof typeof values] ?? "", status))); update(input?.value ?? "#2F6FED");
}

function bindTool(id: ToolId): void { if (id === "calculator") bindCalculator(); if (id === "units") bindUnits(); if (id === "weather") bindWeather(); if (id === "markdown") bindMarkdown(); if (id === "datetime") bindDateTime(); if (id === "text") bindText(); if (id === "json") bindJson(); if (id === "diff") bindDiff(); if (id === "encoding") bindEncoding(); if (id === "qr") bindQr(); if (id === "color") bindColor(); }

function renderApp(): void {
  const raw = window.location.hash.slice(1) as ToolId | "home";
  const active = tools.some((tool) => tool.id === raw) ? raw as ToolId : "home";
  setTheme(state.theme);
  appRoot.innerHTML = `${renderHeader()}<div class="app-layout">${renderSidebar(active)}<main>${active === "home" ? renderHome() : renderToolShell(getTool(active))}</main></div><footer>日常工作工具箱 · 无需登录 · 本地优先 <span>v1.0</span></footer>`;
  document.querySelector<HTMLSelectElement>("#theme-select")?.addEventListener("change", (event) => setTheme((event.target as HTMLSelectElement).value as Theme));
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) => element.addEventListener("click", () => { const nav = element.dataset.nav; state.homeMode = nav === "favorites" ? "favorites" : nav === "recent" ? "recent" : "all"; state.query = ""; state.category = "全部"; window.location.hash = "home"; renderApp(); }));
  document.querySelectorAll<HTMLElement>("[data-category]").forEach((element) => element.addEventListener("click", () => { state.category = element.dataset.category ?? "全部"; state.homeMode = "all"; window.location.hash = "home"; renderApp(); }));
  document.querySelectorAll<HTMLElement>("[data-favorite]").forEach((element) => element.addEventListener("click", (event) => { event.stopPropagation(); const id = element.dataset.favorite as ToolId; if (favoriteIds.has(id)) favoriteIds.delete(id); else favoriteIds.add(id); saveFavorites(); renderApp(); }));
  document.querySelectorAll<HTMLElement>("[data-open-tool]").forEach((element) => { const open = () => { const id = element.dataset.openTool as ToolId; recordRecent(id); window.location.hash = id; renderApp(); }; element.addEventListener("click", open); element.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }); });
  document.querySelector("[data-clear-filters]")?.addEventListener("click", () => { state.query = ""; state.category = "全部"; state.homeMode = "all"; renderApp(); });
  const search = document.querySelector<HTMLInputElement>("#tool-search"); search?.addEventListener("input", () => { state.query = search.value; const grid = document.querySelector<HTMLElement>("#tool-grid"); const count = document.querySelector<HTMLElement>(".result-count"); if (grid) grid.innerHTML = renderToolCards(); if (count) count.textContent = `${filteredTools().length} / ${tools.length}`; bindHomeCards(); }); search?.addEventListener("keydown", (event) => { if (event.key === "/") event.preventDefault(); });
  bindHomeCards();
  if (active !== "home") bindTool(active);
}

function bindHomeCards(): void {
  document.querySelectorAll<HTMLElement>("[data-open-tool]").forEach((element) => { const open = () => { const id = element.dataset.openTool as ToolId; recordRecent(id); window.location.hash = id; renderApp(); }; element.onclick = open; element.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }; });
  document.querySelectorAll<HTMLElement>("[data-favorite]").forEach((element) => { element.onclick = (event) => { event.stopPropagation(); const id = element.dataset.favorite as ToolId; if (favoriteIds.has(id)) favoriteIds.delete(id); else favoriteIds.add(id); saveFavorites(); renderApp(); }; });
}

window.addEventListener("hashchange", renderApp);
renderApp();
