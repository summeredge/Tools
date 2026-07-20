export type WeatherDay = { date: string; code: number; high: number; low: number };
export type WeatherResult = { city: string; country: string; timezone: string; fetchedAt: string; temperature: number; apparent: number; humidity: number; wind: number; code: number; days: WeatherDay[] };

export class WeatherError extends Error {
  readonly kind: "empty" | "rate" | "network" | "service";
  constructor(kind: WeatherError["kind"], message: string) { super(message); this.kind = kind; }
}

export function weatherCodeText(code: number): string {
  if (code === 0) return "晴朗";
  if ([1, 2, 3].includes(code)) return code === 1 ? "大致晴朗" : code === 2 ? "局部多云" : "阴天";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 65, 66, 67].includes(code)) return "降雨";
  if ([71, 73, 75, 77].includes(code)) return "降雪";
  if ([80, 81, 82].includes(code)) return "阵雨";
  if ([85, 86].includes(code)) return "阵雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "天气变化";
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url);
    if (response.status === 429) throw new WeatherError("rate", "天气服务暂时限流，请稍后重试。");
    if (!response.ok) throw new WeatherError("service", `天气服务返回 HTTP ${response.status}。`);
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    throw new WeatherError("network", "无法连接天气服务，请检查网络后重试。");
  }
}

export async function fetchWeather(city: string): Promise<WeatherResult> {
  const query = city.trim();
  if (!query) throw new WeatherError("empty", "请输入城市名称。");
  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=zh&format=json`;
  const geocode = await fetchJson(geocodeUrl);
  const results = Array.isArray(geocode.results) ? geocode.results as Array<Record<string, unknown>> : [];
  const place = results[0];
  if (!place || typeof place.latitude !== "number" || typeof place.longitude !== "number") throw new WeatherError("empty", "没有找到这个城市，请尝试更完整的城市名称。");
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
  const forecast = await fetchJson(forecastUrl);
  const current = forecast.current as Record<string, unknown> | undefined;
  const daily = forecast.daily as Record<string, unknown> | undefined;
  const dates = Array.isArray(daily?.time) ? daily.time as string[] : [];
  const codes = Array.isArray(daily?.weather_code) ? daily.weather_code as number[] : [];
  const highs = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max as number[] : [];
  const lows = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min as number[] : [];
  if (!current || typeof current.temperature_2m !== "number" || dates.length === 0) throw new WeatherError("service", "天气服务返回的数据不完整，请稍后重试。");
  return {
    city: String(place.name ?? query), country: String(place.country ?? ""), timezone: String(forecast.timezone ?? "当地时区"), fetchedAt: new Date().toISOString(),
    temperature: current.temperature_2m, apparent: Number(current.apparent_temperature ?? current.temperature_2m), humidity: Number(current.relative_humidity_2m ?? 0), wind: Number(current.wind_speed_10m ?? 0), code: Number(current.weather_code ?? -1),
    days: dates.map((date, index) => ({ date, code: Number(codes[index] ?? -1), high: Number(highs[index] ?? 0), low: Number(lows[index] ?? 0) })),
  };
}
