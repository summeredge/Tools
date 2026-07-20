import DOMPurify from "dompurify";
import "./styles.css";
import { diffLines } from "diff";
import { renderMarkdown } from "./markdown";
import {
  createStorageAdapter,
  formatNumber,
  sortLines,
  textStats,
  uniqueLines,
} from "./logic";
import { fetchSafety, SafetyError, type SafetyResult } from "./safety";
import { fetchWeather, weatherCodeText, weatherIcon, WeatherError, type WeatherResult } from "./weather";

type ToolId = "weather" | "safety" | "if97" | "markdown" | "text" | "diff";
type HomeMode = "all" | "favorites" | "recent";
type Theme = "system" | "light" | "dark";

type Tool = { id: ToolId; name: string; description: string; category: string; mark: string; keywords: string[] };

const tools: Tool[] = [
  { id: "weather", name: "天气查询", description: "查询城市当前天气与未来 5 日预报", category: "外部数据", mark: "☁", keywords: ["天气", "温度", "预报", "城市"] },
  { id: "safety", name: "化学品安全信息", description: "查询 PubChem 安全摘要与官方数据库链接", category: "外部数据", mark: "SDS", keywords: ["化学品", "SDS", "MSDS", "CAS", "安全", "GHS"] },
  { id: "if97", name: "IF97 水和蒸汽物性", description: "按压力和温度计算水与蒸汽的热力学物性", category: "过程工程", mark: "IF97", keywords: ["水", "蒸汽", "物性", "压力", "温度", "IAPWS"] },
  { id: "markdown", name: "Markdown", description: "边写边预览，安全净化并下载草稿", category: "文档", mark: "MD", keywords: ["文档", "预览", "表格", "代码"] },
  { id: "text", name: "文本处理", description: "统计、清理、排序、去重与大小写转换", category: "文本", mark: "Aa", keywords: ["字符", "行", "空白", "排序"] },
  { id: "diff", name: "文本对比", description: "逐行查看新增、删除与未变化内容", category: "文本", mark: "Δ", keywords: ["差异", "比较", "新增", "删除"] },
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
    <div class="sidebar-note"><span class="note-dot"></span><div><strong>过程工程工具已加入</strong><p>IF97 水和蒸汽物性计算器在浏览器本地运行，关键设计点请按适用标准复核。</p></div></div>
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
    <div class="privacy-banner"><span class="privacy-icon">⌁</span><div><strong>隐私边界清晰</strong><p>本地工具输入默认仅在当前浏览器处理；天气和化学品安全查询会向对应公开数据服务发送搜索内容。本站不含账号、同步、埋点或公司内部资料。</p></div></div>
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
    case "weather": return `<div class="weather-tool"><div class="weather-search"><label for="weather-city">城市</label><div class="calc-input-row"><input id="weather-city" type="search" value="${escapeHtml(storage.read<string>("workbench:weather-city", ""))}" placeholder="例如：上海、北京" autocomplete="off"><button class="button primary" id="weather-search-button">查询天气</button></div><p class="hint">默认摄氏度，不强制获取浏览器定位。数据来自 <a href="https://www.nmc.cn/publish/forecast.html" target="_blank" rel="noreferrer">中央气象台（中国气象局）↗</a>。</p></div><div id="weather-status" class="feedback" aria-live="polite">请输入城市开始查询。</div><div id="weather-result"></div></div>`;
    case "safety": return `<div class="safety-tool"><div class="safety-search"><label for="safety-query">化学品名称或 CAS 号</label><div class="calc-input-row"><input id="safety-query" type="search" value="${escapeHtml(storage.read<string>("workbench:safety-query", ""))}" placeholder="例如：甲醇、ethanol、64-17-5" autocomplete="off"><button class="button primary" id="safety-search-button">查询安全信息</button></div><p class="hint">支持中文名称、英文名称和 CAS 号。中文名称会先通过 <a href="https://www.wikidata.org/" target="_blank" rel="noreferrer">Wikidata</a> 做名称映射，再从 <a href="https://pubchem.ncbi.nlm.nih.gov/" target="_blank" rel="noreferrer">PubChem</a> 获取安全摘要；结果不替代具体产品的最新版供应商 SDS。</p></div><div id="safety-status" class="feedback" aria-live="polite">请输入化学品名称或 CAS 号。</div><div id="safety-result"></div></div>`;
    case "if97": return `<div class="if97-tool"><div class="if97-toolbar"><p class="hint">本工具使用 IAPWS-IF97 模型在浏览器本地计算，不发送压力、温度或计算结果。页面内嵌 <code>iapws-if97 v2.1.5</code>（MIT）实现。</p><a class="button secondary" href="./tools/if97.html" target="_blank" rel="noreferrer">在新页面打开 ↗</a></div><iframe class="if97-frame" src="./tools/if97.html" title="IF97 水和蒸汽物性计算器"></iframe></div>`;
    case "markdown": return `<div class="markdown-tool"><div class="markdown-actions"><span class="hint">草稿仅自动保存到当前浏览器。</span><div><button class="button secondary" id="markdown-copy">复制 Markdown</button><button class="button secondary" id="markdown-copy-html">复制渲染结果</button><button class="button primary" id="markdown-download">下载 .md</button></div></div><div class="markdown-tabs"><button class="active" data-md-tab="edit">编辑</button><button data-md-tab="preview">预览</button></div><div class="markdown-grid"><label class="markdown-editor" data-md-pane="edit"><span class="sr-only">Markdown 编辑器</span><textarea id="markdown-input" spellcheck="false" placeholder="# 今日记录\n\n- 一个清单\n- \`Ctrl + Enter\` 之外也可以直接预览"></textarea></label><article class="markdown-preview" data-md-pane="preview" id="markdown-preview" aria-label="Markdown 预览"></article></div><div class="feedback" id="markdown-feedback" aria-live="polite"></div></div>`;
    case "text": return `<div class="text-tool"><div class="text-actions"><div class="stats" id="text-stats">字符 0 · 字数 0 · 行数 0</div><div class="button-group"><button class="button secondary" data-text-action="upper">大写</button><button class="button secondary" data-text-action="lower">小写</button><button class="button secondary" data-text-action="trim">去首尾空白</button><button class="button secondary" data-text-action="collapse">去多余空白</button><button class="button secondary" data-text-action="sort">行排序</button><button class="button secondary" data-text-action="unique">行去重</button><button class="button primary" data-text-copy>复制</button><button class="button danger" data-text-clear>清空</button></div></div><textarea id="text-input" class="large-textarea" placeholder="在这里输入或粘贴文本…"></textarea><div class="feedback" id="text-feedback" aria-live="polite"></div></div>`;
    case "diff": return `<div class="diff-tool"><div class="split-actions"><span class="hint">长文本会先显示处理状态，比较全程在浏览器内完成。</span><div><button class="button primary" id="diff-run">开始比较</button><button class="button secondary" id="diff-clear">清空</button></div></div><div class="diff-input-grid"><label><span>原文本</span><textarea id="diff-left" spellcheck="false" placeholder="原始内容…"></textarea></label><label><span>新文本</span><textarea id="diff-right" spellcheck="false" placeholder="修改后的内容…"></textarea></label></div><div id="diff-status" class="feedback" aria-live="polite"></div><div id="diff-output" class="diff-output"></div></div>`;
  }
}

function renderWeatherResult(result: WeatherResult, fahrenheit = false): string {
  const convert = (value: number) => fahrenheit ? value * 9 / 5 + 32 : value;
  const unit = fahrenheit ? "°F" : "°C";
  return `<div class="weather-card"><div class="weather-current"><div><p class="eyebrow">CURRENT / ${escapeHtml(result.timezone)}</p><h2>${escapeHtml(result.city)} <small>${escapeHtml(result.country)}</small></h2><div class="weather-temp">${formatNumber(convert(result.temperature))}${unit}</div><p>${weatherCodeText(result.condition)} · 体感 ${formatNumber(convert(result.apparent))}${unit}</p></div><div class="weather-big-icon">${weatherIcon(result.condition)}</div></div><div class="weather-metrics"><span><strong>${formatNumber(result.humidity)}%</strong><small>相对湿度</small></span><span><strong>${formatNumber(result.wind)} km/h</strong><small>风速</small></span><label class="unit-toggle">温度单位<select id="weather-unit"><option value="c" ${!fahrenheit ? "selected" : ""}>摄氏度</option><option value="f" ${fahrenheit ? "selected" : ""}>华氏度</option></select></label></div><div class="forecast-grid">${result.days.map((day) => `<div class="forecast-day"><strong>${escapeHtml(new Date(`${day.date}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "short" }))}</strong><span class="forecast-icon">${weatherIcon(day.condition)}</span><span>${formatNumber(convert(day.high))}° / ${formatNumber(convert(day.low))}°</span><small>${weatherCodeText(day.condition)}</small></div>`).join("")}</div><div class="weather-footer">数据更新时间：${escapeHtml(formatLocalDate(new Date(result.fetchedAt)))} · 来源：<a href="https://www.nmc.cn/publish/forecast.html" target="_blank" rel="noreferrer">中央气象台（中国气象局）↗</a></div></div>`;
}

function renderSafetyResult(result: SafetyResult): string {
  const links = [
    ["PubChem 完整安全记录", `https://pubchem.ncbi.nlm.nih.gov/compound/${result.cid}#section=Safety-and-Hazards`],
    ["GESTIS 数据库", "https://gestis.dguv.de/"],
    ["CAMEO Chemicals", "https://cameochemicals.noaa.gov/"],
    ["ECHA CHEM", "https://echa.europa.eu/echa-chem"],
  ];
  const nameSource = result.nameSource === "Wikidata" ? "Wikidata 中文名称映射" : "PubChem 名称/CAS 匹配";
  const details = result.safetySections.map((section) => `<article class="safety-detail-card"><h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(section.content)}</p></article>`).join("");
  return `<div class="safety-card"><div class="safety-card-heading"><div><p class="eyebrow">PUBCHEM / CID ${result.cid}</p><h2>${escapeHtml(result.title)}</h2><p class="safety-query">查询：${escapeHtml(result.query)} · ${nameSource}</p></div><div class="safety-pictograms">${result.pictograms.map((pictogram) => `<span>${escapeHtml(pictogram)}</span>`).join("") || "<span>未提供图标</span>"}</div></div><div class="safety-meta"><div><small>IUPAC 名称</small><strong>${escapeHtml(result.iupacName)}</strong></div><div><small>分子式</small><strong>${escapeHtml(result.formula)}</strong></div><div><small>相对分子质量</small><strong>${escapeHtml(result.molecularWeight)}</strong></div></div><div class="safety-summary"><section><h3>信号词</h3><p>${escapeHtml(result.signal)}</p></section><section><h3>GHS 危害说明</h3><p>${escapeHtml(result.hazards)}</p></section><section><h3>防范说明代码</h3><p>${escapeHtml(result.precautions)}</p></section></div><div class="safety-details"><div class="safety-details-heading"><h3>危害与安全信息</h3><p>以下分段来自 PubChem 的 Safety and Hazards 记录；不同化学品可提供不同项目，内容仅供安全预判，不能替代具体产品 SDS。</p></div><div class="safety-detail-grid">${details || "<p class=\"safety-detail-empty\">PubChem 暂未提供更多分段安全信息，请打开完整安全记录查看。</p>"}</div></div><div class="safety-links"><strong>官方数据库</strong>${links.map(([label, href]) => `<a href="${href}" target="_blank" rel="noreferrer">${label} ↗</a>`).join("")}</div><div class="safety-footer">查询时间：${escapeHtml(formatLocalDate(new Date(result.fetchedAt)))} · 仅供参考，不替代供应商针对具体产品、浓度和地区法规提供的 SDS。</div></div>`;
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

function bindSafety(): void {
  const input = document.querySelector<HTMLInputElement>("#safety-query"); const button = document.querySelector<HTMLButtonElement>("#safety-search-button"); const status = document.querySelector<HTMLElement>("#safety-status"); const resultBox = document.querySelector<HTMLElement>("#safety-result");
  const search = async () => {
    if (!input || !status || !resultBox) return;
    button?.setAttribute("aria-busy", "true"); button?.setAttribute("disabled", "true"); resultBox.innerHTML = ""; feedback(status, "正在查询 PubChem…", "muted");
    try { const result = await fetchSafety(input.value); storage.write("workbench:safety-query", input.value.trim()); resultBox.innerHTML = renderSafetyResult(result); feedback(status, "查询成功", "ok"); }
    catch (error) { feedback(status, error instanceof SafetyError ? error.message : "化学品安全信息查询失败，请稍后重试。", "error"); }
    finally { button?.removeAttribute("aria-busy"); button?.removeAttribute("disabled"); }
  };
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

function bindText(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#text-input"); const stats = document.querySelector<HTMLElement>("#text-stats"); const status = document.querySelector<HTMLElement>("#text-feedback"); if (!input || !stats) return;
  const update = () => { const value = textStats(input.value); stats.textContent = `字符 ${value.characters} · 字数 ${value.words} · 行数 ${value.lines}`; };
  input.addEventListener("input", update); update();
  document.querySelectorAll<HTMLButtonElement>("[data-text-action]").forEach((button) => button.addEventListener("click", () => { const action = button.dataset.textAction; if (action === "upper") input.value = input.value.toLocaleUpperCase(); if (action === "lower") input.value = input.value.toLocaleLowerCase(); if (action === "trim") input.value = input.value.trim(); if (action === "collapse") input.value = input.value.replace(/\s+/gu, " ").trim(); if (action === "sort") input.value = sortLines(input.value); if (action === "unique") input.value = uniqueLines(input.value); update(); }));
  document.querySelector("[data-text-copy]")?.addEventListener("click", () => copyText(input.value, status)); document.querySelector("[data-text-clear]")?.addEventListener("click", () => { input.value = ""; update(); feedback(status, "已清空", "ok"); });
}

function bindDiff(): void {
  const left = document.querySelector<HTMLTextAreaElement>("#diff-left"); const right = document.querySelector<HTMLTextAreaElement>("#diff-right"); const output = document.querySelector<HTMLElement>("#diff-output"); const status = document.querySelector<HTMLElement>("#diff-status"); if (!left || !right || !output) return;
  document.querySelector("#diff-run")?.addEventListener("click", () => { feedback(status, "正在比较…", "muted"); output.innerHTML = ""; window.setTimeout(() => { const parts = diffLines(left.value, right.value); output.innerHTML = parts.map((part) => `<span class="diff-line ${part.added ? "added" : part.removed ? "removed" : "unchanged"}">${part.value.split("\n").map((line) => line ? escapeHtml(`${part.added ? "+ " : part.removed ? "− " : "  "}${line}`) : "").join("\n")}</span>`).join(""); feedback(status, "比较完成，新增和删除已标色。", "ok"); }, 20); });
  document.querySelector("#diff-clear")?.addEventListener("click", () => { left.value = ""; right.value = ""; output.innerHTML = ""; feedback(status, "已清空", "ok"); });
}

function bindTool(id: ToolId): void { if (id === "weather") bindWeather(); if (id === "safety") bindSafety(); if (id === "markdown") bindMarkdown(); if (id === "text") bindText(); if (id === "diff") bindDiff(); }

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
