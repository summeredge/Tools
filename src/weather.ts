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

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url);
    if (response.status === 429) throw new WeatherError("rate", "天气服务暂时限流，请稍后重试。");
    if (!response.ok) throw new WeatherError("service", `天气服务返回 HTTP ${response.status}。`);
    const payload = await response.json() as Record<string, unknown>;
    if (payload.code !== undefined && payload.code !== 0 && payload.code !== "0") throw new WeatherError("service", "天气服务返回的数据无效，请稍后重试。");
    return payload;
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    throw new WeatherError("network", "无法连接天气服务，请检查网络后重试。");
  }
}

function toNumber(value: unknown, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

type CmaStation = { id: string; city: string; country: string };

const cityStationAliases: Record<string, CmaStation> = {
  上海: { id: "58367", city: "上海", country: "中国" },
  上海市: { id: "58367", city: "上海", country: "中国" },
};

function stationFromValue(value: unknown): CmaStation | null {
  if (typeof value !== "string") return null;
  const [id, city, , country] = value.split("|");
  if (!id || !city) return null;
  return { id, city, country: country || "中国" };
}

function conditionFromDay(day: Record<string, unknown>): string {
  const dayText = String(day.dayText ?? "").trim();
  const nightText = String(day.nightText ?? "").trim();
  if (dayText && nightText && dayText !== nightText) return `${dayText}转${nightText}`;
  return dayText || nightText || "天气变化";
}

export async function fetchWeather(city: string): Promise<WeatherResult> {
  const query = city.trim();
  if (!query) throw new WeatherError("empty", "请输入城市名称。");

  const directStation = cityStationAliases[query];
  let station: CmaStation | undefined = directStation;
  if (!station) {
    const autocompleteUrl = `https://weather.cma.cn/api/autocomplete?q=${encodeURIComponent(query)}&limit=10&timestamp=${Date.now()}`;
    const autocomplete = await fetchJson(autocompleteUrl);
    const stations = Array.isArray(autocomplete.data) ? autocomplete.data.map(stationFromValue).filter((item): item is CmaStation => item !== null) : [];
    station = stations.find((item) => item.city === query)
      ?? stations.find((item) => item.city.includes(query) || query.includes(item.city))
      ?? (stations.length === 1 ? stations[0] : undefined);
  }
  if (!station) throw new WeatherError("empty", "没有找到这个城市，请尝试更完整的城市名称。");

  const forecastUrl = `https://weather.cma.cn/api/weather/view?stationid=${encodeURIComponent(station.id)}`;
  const forecast = await fetchJson(forecastUrl);
  const data = forecast.data as Record<string, unknown> | undefined;
  const location = data?.location as Record<string, unknown> | undefined;
  const current = data?.now as Record<string, unknown> | undefined;
  const daily = Array.isArray(data?.daily) ? data.daily as Array<Record<string, unknown>> : [];
  const firstDay = daily[0];
  const temperature = Number(current?.temperature);
  if (!location || !current || !Number.isFinite(temperature) || !firstDay) throw new WeatherError("service", "天气服务返回的数据不完整，请稍后重试。");

  const condition = String(current.weather ?? current.weatherText ?? conditionFromDay(firstDay));
  return {
    city: directStation?.city ?? String(location.name ?? station.city), country: station.country, timezone: String(location.timezone ?? "Asia/Shanghai"), fetchedAt: String(data?.lastUpdate ?? new Date().toISOString()),
    temperature, apparent: toNumber(current.feelst ?? current.apparentTemperature, temperature), humidity: toNumber(current.humidity, 0), wind: toNumber(current.windSpeed, 0), code: toNumber(current.weatherCode ?? firstDay.dayCode, -1), condition,
    days: daily.slice(0, 5).map((day) => ({ date: String(day.date ?? ""), code: toNumber(day.dayCode, -1), condition: conditionFromDay(day), high: toNumber(day.high, 0), low: toNumber(day.low, 0) })).filter((day) => day.date),
  };
}
