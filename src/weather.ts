export type WeatherDay = { date: string; code: number; condition: string; high: number; low: number };
export type WeatherResult = { city: string; country: string; timezone: string; fetchedAt: string; temperature: number; apparent: number; humidity: number; wind: number; code: number; condition: string; days: WeatherDay[] };

export class WeatherError extends Error {
  readonly kind: "empty" | "rate" | "network" | "service";
  constructor(kind: WeatherError["kind"], message: string) { super(message); this.kind = kind; }
}

export function weatherCodeText(condition: string): string { return condition || "天气变化"; }

export function weatherIcon(condition: string): string {
  if (/晴/u.test(condition)) return "☀";
  if (/雨|雷/u.test(condition)) return "☂";
  if (/雪/u.test(condition)) return "❄";
  return "☁";
}

function validatePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new WeatherError("service", "天气服务返回的数据无效，请稍后重试。");
  const result = payload as Record<string, unknown>;
  if (result.code !== undefined && result.code !== 0 && result.code !== "0") throw new WeatherError("service", "天气服务返回的数据无效，请稍后重试。");
  return result;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url);
    if (response.status === 429) throw new WeatherError("rate", "天气服务暂时限流，请稍后重试。");
    if (!response.ok) throw new WeatherError("service", `天气服务返回 HTTP ${response.status}。`);
    return validatePayload(await response.json());
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    throw new WeatherError("network", "无法连接天气服务，请检查网络后重试。");
  }
}

function toNumber(value: unknown, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

type NmcStation = { id: string; city: string; province: string; url: string };

function stationFromValue(value: unknown): NmcStation | null {
  if (typeof value !== "string") return null;
  const [id, city, province, url] = value.split("|");
  if (!id || !city || !province || !url) return null;
  return { id, city, province, url };
}

function conditionFromDay(day: Record<string, unknown>): string {
  const dayWeather = day.day as Record<string, unknown> | undefined;
  const nightWeather = day.night as Record<string, unknown> | undefined;
  const dayInfo = dayWeather?.weather as Record<string, unknown> | undefined;
  const nightInfo = nightWeather?.weather as Record<string, unknown> | undefined;
  const dayText = String(dayInfo?.info ?? "").trim();
  const nightText = String(nightInfo?.info ?? "").trim();
  if (dayText && nightText && dayText !== nightText) return `${dayText}转${nightText}`;
  return dayText || nightText || "天气变化";
}

export async function fetchWeather(city: string): Promise<WeatherResult> {
  const query = city.trim();
  if (!query) throw new WeatherError("empty", "请输入城市名称。");

  const autocompleteUrl = `https://www.nmc.cn/essearch/api/autocomplete?q=${encodeURIComponent(query)}&_=${Date.now()}`;
  const autocomplete = await fetchJson(autocompleteUrl);
  const stations = Array.isArray(autocomplete.data) ? autocomplete.data.map(stationFromValue).filter((item): item is NmcStation => item !== null) : [];
  const station = stations.find((item) => item.city === query)
    ?? stations.find((item) => item.city.includes(query) || query.includes(item.city))
    ?? (stations.length === 1 ? stations[0] : undefined);
  if (!station) throw new WeatherError("empty", "没有找到这个城市，请尝试更完整的城市名称。");

  const forecastUrl = `https://www.nmc.cn/rest/weather?stationid=${encodeURIComponent(station.id)}&_=${Date.now()}`;
  const forecast = await fetchJson(forecastUrl);
  const data = forecast.data as Record<string, unknown> | undefined;
  const real = data?.real as Record<string, unknown> | undefined;
  const current = real?.weather as Record<string, unknown> | undefined;
  const currentWind = real?.wind as Record<string, unknown> | undefined;
  const predict = data?.predict as Record<string, unknown> | undefined;
  const daily = Array.isArray(predict?.detail) ? predict.detail as Array<Record<string, unknown>> : [];
  const firstDay = daily[0];
  const temperature = Number(current?.temperature);
  if (!real || !current || !predict || !Number.isFinite(temperature) || !firstDay) throw new WeatherError("service", "天气服务返回的数据不完整，请稍后重试。");

  const condition = String(current.info ?? conditionFromDay(firstDay));
  return {
    city: station.city, country: "中国", timezone: "Asia/Shanghai", fetchedAt: String(real.publish_time ?? new Date().toISOString()),
    temperature, apparent: toNumber(current.feelst, temperature), humidity: toNumber(current.humidity, 0), wind: toNumber(currentWind?.speed, 0), code: toNumber(current.img, -1), condition,
    days: daily.slice(0, 5).map((day) => {
      const dayWeather = day.day as Record<string, unknown> | undefined;
      const nightWeather = day.night as Record<string, unknown> | undefined;
      const dayInfo = dayWeather?.weather as Record<string, unknown> | undefined;
      const nightInfo = nightWeather?.weather as Record<string, unknown> | undefined;
      return { date: String(day.date ?? ""), code: toNumber(dayInfo?.img, -1), condition: conditionFromDay(day), high: toNumber(dayInfo?.temperature, 0), low: toNumber(nightInfo?.temperature, 0) };
    }).filter((day) => day.date),
  };
}
