import { normalizeShortcutUrl } from "./logic";

type Feed = { name: string; url: string };
type RssItem = { title: string; url: string; source: string; timestamp: number };
type WeatherResponse = {
  timezone?: string;
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

const rssStorageKey = "workbench:rss-feeds";
const legacyDefaultFeedUrls = new Set(["https://hnrss.org/frontpage", "https://rsshub.app/zhihu/hot", "https://rsshub.app/zhihu/hotlist"]);
const defaultFeeds: Feed[] = [{ name: "知乎热榜", url: "https://tgmeng.com/community/zhihu/rss.xml" }];
const weatherLabels: Record<number, string> = {
  0: "晴",
  1: "大部晴朗",
  2: "局部多云",
  3: "阴",
  45: "有雾",
  48: "雾凇",
  51: "毛毛雨",
  53: "毛毛雨",
  55: "毛毛雨",
  56: "冻毛毛雨",
  57: "冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "阵雪",
  86: "阵雪",
  95: "雷雨",
  96: "雷雨伴冰雹",
  99: "雷雨伴冰雹",
};

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

function parseFeed(feed: Feed, text: string): RssItem[] {
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
  const urls = [feed.url, "https://api.allorigins.win/raw?url=" + encodeURIComponent(feed.url)];
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

function weatherLabel(code: number | undefined): string {
  return weatherLabels[code ?? -1] ?? "天气未知";
}

function formatTemperature(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) + "°" : "--";
}

function formatRssDate(timestamp: number): string {
  if (!timestamp) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatShortWeekday(value: string): string {
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
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

function renderForecast(data: WeatherResponse): string {
  const times = data.daily?.time ?? [];
  const codes = data.daily?.weather_code ?? [];
  const maximums = data.daily?.temperature_2m_max ?? [];
  const minimums = data.daily?.temperature_2m_min ?? [];
  return times.slice(0, 4).map((time, index) => '<span><b>' + escapeHtml(formatShortWeekday(time)) + "</b><small>" + escapeHtml(weatherLabel(codes[index])) + "</small><em>" + escapeHtml(formatTemperature(maximums[index])) + " / " + escapeHtml(formatTemperature(minimums[index])) + "</em></span>").join("");
}

function getPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) return Promise.reject(new Error("geolocation unavailable"));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }));
}

async function refreshWeather(root: HTMLElement): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-weather-refresh]");
  const status = root.querySelector<HTMLElement>("[data-weather-state]");
  const current = root.querySelector<HTMLElement>("[data-weather-current]");
  const forecast = root.querySelector<HTMLElement>("[data-weather-forecast]");
  if (!button || !status || !current || !forecast) return;
  button.disabled = true;
  button.textContent = "获取中";
  status.textContent = "正在获取当前位置天气…";
  current.classList.add("hidden");
  forecast.innerHTML = "";
  try {
    const position = await getPosition();
    const query = new URLSearchParams({
      latitude: String(position.coords.latitude),
      longitude: String(position.coords.longitude),
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      forecast_days: "4",
      timezone: "auto",
    });
    const data = await requestText("https://api.open-meteo.com/v1/forecast?" + query.toString()).then((value) => JSON.parse(value) as WeatherResponse);
    const currentData = data.current;
    if (!currentData || typeof currentData.temperature_2m !== "number") throw new Error("weather unavailable");
    const temperature = root.querySelector<HTMLElement>("[data-weather-temperature]");
    const label = root.querySelector<HTMLElement>("[data-weather-label]");
    const location = root.querySelector<HTMLElement>("[data-weather-location]");
    if (temperature) temperature.textContent = formatTemperature(currentData.temperature_2m);
    if (label) label.textContent = weatherLabel(currentData.weather_code);
    if (location) location.textContent = "当前位置 · " + (data.timezone ?? "本地时区");
    status.textContent = (typeof currentData.relative_humidity_2m === "number" ? "湿度 " + Math.round(currentData.relative_humidity_2m) + "% · " : "") + "风速 " + (typeof currentData.wind_speed_10m === "number" ? Math.round(currentData.wind_speed_10m) : "--") + " km/h";
    forecast.innerHTML = renderForecast(data);
    current.classList.remove("hidden");
  } catch {
    status.textContent = "暂时无法获取天气，请检查定位权限和网络后重试。";
  } finally {
    button.disabled = false;
    button.textContent = "刷新天气";
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
    '<article class="dashboard-card weather-widget"><div class="widget-card-head"><div><p class="eyebrow">WEATHER</p></div><button class="widget-button" type="button" data-weather-refresh>获取天气</button></div><div class="weather-state" data-weather-state>点击“获取天气”读取当前位置天气。</div><div class="weather-current hidden" data-weather-current><strong class="weather-temperature" data-weather-temperature>--</strong><div><strong data-weather-label>等待定位</strong><small data-weather-location>当前位置</small></div></div><div class="weather-forecast" data-weather-forecast></div></article>',
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
  root.querySelector<HTMLButtonElement>("[data-weather-refresh]")?.addEventListener("click", () => void refreshWeather(root));
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
