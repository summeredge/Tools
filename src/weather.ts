const amapGeocodeEndpoint = "https://restapi.amap.com/v3/geocode/geo";
const amapWeatherEndpoint = "https://restapi.amap.com/v3/weather/weatherInfo";

export type WeatherForecastDay = {
  date: string;
  week: string;
  dayWeather: string;
  nightWeather: string;
  highTemp: number | null;
  lowTemp: number | null;
  windDirection: string;
  windPower: string;
};

export type WeatherForecast = { city: string; days: WeatherForecastDay[] };
export type WeatherErrorKind = "missing-key" | "city-not-found" | "network" | "api";

export class WeatherApiError extends Error {
  constructor(public readonly kind: WeatherErrorKind) {
    super(kind);
    this.name = "WeatherApiError";
  }
}

export function getAmapWeatherKey(): string {
  const value = import.meta.env.VITE_AMAP_WEATHER_KEY;
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asText(value: unknown, fallback = "未知"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(new Date(value + "T12:00:00").getTime());
}

function formatWeek(value: unknown, date: string): string {
  const weeks = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= 7) return ["", ...weeks.slice(1), weeks[0]][number] ?? "未知";
  return weeks[new Date(date + "T12:00:00").getDay()] ?? "未知";
}

function formatDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

async function requestJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
  let response: Response;
  try {
    try {
      response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    } catch {
      throw new WeatherApiError("network");
    }
    if (!response.ok) throw new WeatherApiError("network");
    try {
      return await response.json();
    } catch {
      throw new WeatherApiError("api");
    }
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function resolveCityAdcode(city: string, key: string): Promise<string> {
  const params = new URLSearchParams({ address: city, output: "JSON", key });
  const payload = asRecord(await requestJson(`${amapGeocodeEndpoint}?${params}`));
  if (!payload || payload.status !== "1") throw new WeatherApiError("api");
  if (!Array.isArray(payload.geocodes)) throw new WeatherApiError("api");
  const geocode = asRecord(payload.geocodes[0]);
  const adcode = geocode && typeof geocode.adcode === "string" ? geocode.adcode.trim() : "";
  if (!adcode) throw new WeatherApiError("city-not-found");
  return adcode;
}

export function convertAmapWeatherResponse(payload: unknown, fallbackCity = "未知城市"): WeatherForecast {
  const response = asRecord(payload);
  if (!response || response.status !== "1" || !Array.isArray(response.forecasts)) throw new WeatherApiError("api");
  const forecast = asRecord(response.forecasts[0]);
  const casts = forecast && Array.isArray(forecast.casts) ? forecast.casts : [];
  const days = casts.slice(0, 4).flatMap((value): WeatherForecastDay[] => {
    const cast = asRecord(value);
    const date = cast ? asText(cast.date, "") : "";
    if (!cast || !isDate(date)) return [];
    const dayWind = asText(cast.daywind, "");
    const nightWind = asText(cast.nightwind, "");
    const dayPower = asText(cast.daypower, "");
    const nightPower = asText(cast.nightpower, "");
    return [{
      date,
      week: formatWeek(cast.week, date),
      dayWeather: asText(cast.dayweather),
      nightWeather: asText(cast.nightweather),
      highTemp: asNumber(cast.daytemp),
      lowTemp: asNumber(cast.nighttemp),
      windDirection: dayWind || nightWind || "未知",
      windPower: dayPower || nightPower || "未知",
    }];
  });
  if (!days.length) throw new WeatherApiError("api");
  return { city: asText(forecast?.city, fallbackCity), days };
}

export async function fetchWeatherForecast(city: string, key = getAmapWeatherKey()): Promise<WeatherForecast> {
  const normalizedCity = city.trim();
  if (!key.trim()) throw new WeatherApiError("missing-key");
  if (!normalizedCity) throw new WeatherApiError("city-not-found");
  const adcode = await resolveCityAdcode(normalizedCity, key.trim());
  const params = new URLSearchParams({ city: adcode, extensions: "all", output: "JSON", key: key.trim() });
  return convertAmapWeatherResponse(await requestJson(`${amapWeatherEndpoint}?${params}`), normalizedCity);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function formatTemperature(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)}℃`;
}

export function renderWeatherForecast(forecast: WeatherForecast): string {
  return forecast.days.slice(0, 4).map((day) => `<article class="weather-day"><strong>${escapeHtml(formatDate(day.date))}</strong><b>${escapeHtml(day.week)}</b><span class="weather-day-weather"><small>白 ${escapeHtml(day.dayWeather)}</small><small>夜 ${escapeHtml(day.nightWeather)}</small></span><em class="weather-day-temp">${escapeHtml(formatTemperature(day.highTemp))} / ${escapeHtml(formatTemperature(day.lowTemp))}</em><small class="weather-day-wind">${escapeHtml(day.windDirection)} ${escapeHtml(day.windPower)}</small></article>`).join("");
}

export function weatherErrorMessage(error: unknown): string {
  if (error instanceof WeatherApiError) {
    if (error.kind === "missing-key") return "未配置天气服务，请设置高德 API Key";
    if (error.kind === "city-not-found") return "未找到该城市天气";
  }
  return "天气数据获取失败，请稍后重试";
}
