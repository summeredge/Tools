import { normalizeShortcutUrl } from "./logic";
import { fetchWeatherForecast, getAmapWeatherKey, renderWeatherForecast, weatherErrorMessage } from "./weather";

type Feed = { name: string; url: string };
type RssItem = { title: string; url: string; source: string; timestamp: number };
const rssStorageKey = "workbench:rss-feeds";
const weatherStorageKey = "workbench:weather-city";
const legacyDefaultFeedUrls = new Set(["https://hnrss.org/frontpage", "https://rsshub.app/zhihu/hot", "https://rsshub.app/zhihu/hotlist", "https://tgmeng.com/community/zhihu/rss.xml", "https://api.xunjinlu.fun/api/rebang/zhihu.php"]);
const defaultFeedUrl = "https://api.xunjinlu.fun/api/rebang/zhihu.php";
const defaultFeeds: Feed[] = [{ name: "知乎热榜", url: defaultFeedUrl }];
let rssFeeds = readFeeds();
let calendarTimer: number | undefined;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function readFeeds(): Feed[] {
  const storage = getStorage();
  if (!storage) return [...defaultFeeds];
  try {
    const raw = storage.getItem(rssStorageKey);
    if (!raw) return [...defaultFeeds];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [...defaultFeeds];
    const feeds = value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.url !== "string") return [];
      const url = normalizeShortcutUrl(record.url);
      if (!url) return [];
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : new URL(url).hostname;
      return [{ name, url }];
    });
    if (feeds.length > 0 && feeds.every((feed) => legacyDefaultFeedUrls.has(feed.url))) return [...defaultFeeds];
    return feeds.length ? feeds : [...defaultFeeds];
  } catch {
    return [...defaultFeeds];
  }
}

function saveFeeds(): void {
  try { getStorage()?.setItem(rssStorageKey, JSON.stringify(rssFeeds)); } catch { /* 本地存储不可用时继续使用当前页面状态 */ }
}

function readWeatherCity(): string {
  try { return getStorage()?.getItem(weatherStorageKey)?.trim() ?? ""; } catch { return ""; }
}

function saveWeatherCity(city: string): void {
  try { getStorage()?.setItem(weatherStorageKey, city.trim()); } catch { /* 本地存储不可用时继续使用当前页面状态 */ }
}

async function requestText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("request failed");
    return await response.text();
  } finally {
    window.clearTimeout(timeout);
  }
}

function readNodeText(node: Element, selector: string): string {
  return node.querySelector(selector)?.textContent?.trim() ?? "";
}

export function parseFeed(feed: Feed, text: string): RssItem[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const payload = JSON.parse(trimmed) as unknown;
    if (!payload || typeof payload !== "object") throw new Error("invalid feed");
    const data = (payload as Record<string, unknown>).data;
    if (!data || typeof data !== "object") throw new Error("invalid feed");
    const dataRecord = data as Record<string, unknown>;
    if (!Array.isArray(dataRecord.list)) throw new Error("invalid feed");
    const timestamp = Date.parse(typeof dataRecord.update_time === "string" ? dataRecord.update_time : "");
    return dataRecord.list.slice(0, 8).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const url = normalizeShortcutUrl(typeof record.url === "string" ? record.url : "");
      return title && url ? [{ title, url, source: feed.name, timestamp: Number.isFinite(timestamp) ? timestamp : 0 }] : [];
    });
  }
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("invalid feed");
  return Array.from(xml.querySelectorAll("item, entry")).slice(0, 8).flatMap((node) => {
    const title = readNodeText(node, "title");
    const linkNode = node.querySelector("link");
    const link = linkNode?.getAttribute("href")?.trim() || linkNode?.textContent?.trim() || readNodeText(node, "guid");
    const url = normalizeShortcutUrl(link);
    if (!title || !url) return [];
    const dateText = readNodeText(node, "pubDate, published, updated, dc\\:date");
    const timestamp = Date.parse(dateText);
    return [{ title, url, source: feed.name, timestamp: Number.isFinite(timestamp) ? timestamp : 0 }];
  });
}

async function loadFeed(feed: Feed): Promise<RssItem[]> {
  const urls = feed.url === defaultFeedUrl
    ? [import.meta.env.DEV ? "/api/zhihu-hot" : "./data/zhihu-hot.json"]
    : [feed.url, "https://api.allorigins.win/raw?url=" + encodeURIComponent(feed.url)];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const items = parseFeed(feed, await requestText(url));
      if (items.length) return items;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("feed empty");
}

function formatRssDate(timestamp: number): string {
  if (!timestamp) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function renderCalendarCells(date: Date): string {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const cells: string[] = [];
  for (let index = 0; index < firstDay; index += 1) cells.push('<span class="calendar-day empty" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) cells.push('<span class="calendar-day' + (day === date.getDate() ? " today" : "") + '">' + day + "</span>");
  while (cells.length % 7 !== 0) cells.push('<span class="calendar-day empty" aria-hidden="true"></span>');
  return cells.join("");
}

function updateCalendar(date: Date): void {
  const root = document.querySelector<HTMLElement>("[data-dashboard-widgets]");
  if (!root) return;
  const monthLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
  const weekdayLabel = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
  const setText = (selector: string, value: string): void => {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  };
  setText("[data-calendar-month]", monthLabel);
  setText("[data-calendar-day]", String(date.getDate()));
  setText("[data-calendar-weekday]", weekdayLabel);
  setText("[data-calendar-date]", dateLabel);
  const grid = root.querySelector<HTMLElement>("[data-calendar-grid]");
  if (grid) grid.innerHTML = renderCalendarCells(date);
}

async function refreshWeather(root: HTMLElement, city: string): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-weather-refresh]");
  const status = root.querySelector<HTMLElement>("[data-weather-state]");
  const forecast = root.querySelector<HTMLElement>("[data-weather-forecast]");
  const queryButton = root.querySelector<HTMLButtonElement>("[data-weather-query]");
  if (!button || !status || !forecast) return;
  if (!city.trim()) { status.textContent = "请输入城市"; return; }
  button.disabled = true;
  if (queryButton) queryButton.disabled = true;
  button.textContent = "获取中";
  status.textContent = "正在获取天气…";
  forecast.innerHTML = "";
  try {
    const data = await fetchWeatherForecast(city);
    saveWeatherCity(city);
    status.textContent = data.city;
    forecast.innerHTML = renderWeatherForecast(data);
  } catch (error) {
    status.textContent = weatherErrorMessage(error);
  } finally {
    button.disabled = false;
    if (queryButton) queryButton.disabled = false;
    button.textContent = "刷新";
  }
}

function renderRssItems(items: RssItem[]): string {
  return items.map((item) => '<a class="rss-item" href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer"><strong>' + escapeHtml(item.title) + "</strong><small>" + escapeHtml(item.source) + " · " + escapeHtml(formatRssDate(item.timestamp)) + "</small></a>").join("");
}

async function refreshRss(root: HTMLElement): Promise<void> {
  const list = root.querySelector<HTMLElement>("[data-rss-list]");
  const button = root.querySelector<HTMLButtonElement>("[data-rss-refresh]");
  if (!list) return;
  if (button) button.disabled = true;
  list.innerHTML = '<p class="rss-state">正在刷新 RSS…</p>';
  const results = await Promise.allSettled(rssFeeds.map(loadFeed));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((left, right) => right.timestamp - left.timestamp).slice(0, 6);
  const failedCount = results.filter((result) => result.status === "rejected").length;
  if (!items.length) list.innerHTML = '<p class="rss-state">暂时没有可展示的内容，请检查 RSS 来源或稍后重试。</p>';
  else list.innerHTML = renderRssItems(items) + (failedCount ? '<p class="rss-state">部分来源暂时无法加载。</p>' : "");
  if (button) button.disabled = false;
}

export function renderDashboardWidgets(): string {
  const date = new Date();
  const monthLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
  const weekdayLabel = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
  return [
    '<section class="dashboard-widgets" data-dashboard-widgets aria-label="动态信息">',
    '<article class="dashboard-card calendar-widget"><div class="widget-card-head"><div><p class="eyebrow">CALENDAR</p></div><time data-calendar-month>' + escapeHtml(monthLabel) + "</time></div>",
    '<div class="calendar-body"><div class="calendar-today"><strong data-calendar-day>' + date.getDate() + '</strong><span data-calendar-weekday>' + escapeHtml(weekdayLabel) + '</span><small data-calendar-date>' + escapeHtml(dateLabel) + '</small></div><div class="calendar-month-view"><div class="calendar-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="calendar-grid" data-calendar-grid>' + renderCalendarCells(date) + "</div></div></div></article>",
    '<article class="dashboard-card weather-widget"><div class="widget-card-head"><div><p class="eyebrow">WEATHER</p></div><button class="widget-button" type="button" data-weather-refresh>刷新</button></div><form class="weather-search" data-weather-form><label class="sr-only" for="weather-city">城市</label><input id="weather-city" data-weather-city type="text" placeholder="输入城市，如北京" autocomplete="address-level2" required><button class="widget-button" type="submit" data-weather-query>查询</button></form><p class="weather-state" data-weather-state>请输入城市后查询天气。</p><div class="weather-forecast" data-weather-forecast></div></article>',
    '<article class="dashboard-card rss-widget"><div class="widget-card-head"><div><p class="eyebrow">RSS</p></div><button class="widget-button" type="button" data-rss-refresh>刷新</button></div><div class="rss-list" data-rss-list><p class="rss-state">正在加载 RSS…</p></div><div class="widget-footer"><button class="widget-link" type="button" data-rss-toggle>添加 RSS 来源</button></div><form class="rss-source-form hidden" data-rss-form><label class="sr-only" for="rss-source-url">RSS 地址</label><input id="rss-source-url" type="url" placeholder="https://example.com/feed.xml" autocomplete="url" required><button class="widget-button" type="submit">添加</button><p class="rss-form-status" data-rss-form-status aria-live="polite"></p></form></article>',
    "</section>",
  ].join("");
}

export function disposeDashboardWidgets(): void {
  if (calendarTimer !== undefined) window.clearInterval(calendarTimer);
  calendarTimer = undefined;
}

export function bindDashboardWidgets(): void {
  disposeDashboardWidgets();
  const root = document.querySelector<HTMLElement>("[data-dashboard-widgets]");
  if (!root) return;
  updateCalendar(new Date());
  calendarTimer = window.setInterval(() => updateCalendar(new Date()), 60000);
  const weatherInput = root.querySelector<HTMLInputElement>("[data-weather-city]");
  const weatherForm = root.querySelector<HTMLFormElement>("[data-weather-form]");
  const runWeather = (): void => { void refreshWeather(root, weatherInput?.value ?? ""); };
  root.querySelector<HTMLButtonElement>("[data-weather-refresh]")?.addEventListener("click", runWeather);
  weatherForm?.addEventListener("submit", (event) => { event.preventDefault(); runWeather(); });
  const savedWeatherCity = readWeatherCity();
  if (weatherInput && savedWeatherCity) weatherInput.value = savedWeatherCity;
  if (!getAmapWeatherKey()) root.querySelector<HTMLElement>("[data-weather-state]")!.textContent = "未配置天气服务，请设置高德 API Key";
  else if (savedWeatherCity) void refreshWeather(root, savedWeatherCity);
  root.querySelector<HTMLButtonElement>("[data-rss-refresh]")?.addEventListener("click", () => void refreshRss(root));
  const toggle = root.querySelector<HTMLButtonElement>("[data-rss-toggle]");
  const form = root.querySelector<HTMLFormElement>("[data-rss-form]");
  const input = root.querySelector<HTMLInputElement>("#rss-source-url");
  const formStatus = root.querySelector<HTMLElement>("[data-rss-form-status]");
  toggle?.addEventListener("click", () => {
    if (!form) return;
    const isHidden = form.classList.toggle("hidden");
    if (!isHidden) input?.focus();
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input) return;
    const url = normalizeShortcutUrl(input.value);
    if (!url) { if (formStatus) formStatus.textContent = "请输入有效的 RSS 地址。"; return; }
    if (rssFeeds.some((feed) => feed.url === url)) { if (formStatus) formStatus.textContent = "这个 RSS 来源已经添加。"; return; }
    rssFeeds = [...rssFeeds, { name: new URL(url).hostname, url }];
    saveFeeds();
    input.value = "";
    if (formStatus) formStatus.textContent = "";
    form.classList.add("hidden");
    void refreshRss(root);
  });
  void refreshRss(root);
}
