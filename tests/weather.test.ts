import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertAmapWeatherResponse,
  fetchWeatherForecast,
  renderWeatherForecast,
  weatherErrorMessage,
  WeatherApiError,
} from "../src/weather";

const casts = [
  { date: "2026-09-01", week: "2", dayweather: "晴", nightweather: "多云", daytemp: "28", nighttemp: "18", daywind: "东北风", nightwind: "东风", daypower: "3", nightpower: "2" },
  { date: "2026-09-02", week: "3", dayweather: "多云", nightweather: "阴", daytemp: "27", nighttemp: "19", daywind: "南风", nightwind: "东南风", daypower: "2", nightpower: "2" },
  { date: "2026-09-03", week: "4", dayweather: "小雨", nightweather: "小雨", daytemp: "25", nighttemp: "18", daywind: "西风", nightwind: "西北风", daypower: "1", nightpower: "2" },
  { date: "2026-09-04", week: "5", dayweather: "晴", nightweather: "晴", daytemp: "29", nighttemp: "20", daywind: "北风", nightwind: "北风", daypower: "3", nightpower: "3" },
  { date: "2026-09-05", week: "6", dayweather: "晴", nightweather: "晴", daytemp: "30", nighttemp: "21", daywind: "北风", nightwind: "北风", daypower: "3", nightpower: "3" },
];

const weatherPayload = { status: "1", forecasts: [{ city: "北京市", casts }] };

afterEach(() => vi.restoreAllMocks());

describe("高德天气数据转换", () => {
  it("转换城市和 4 天预报，并把星期转换为中文", () => {
    const result = convertAmapWeatherResponse(weatherPayload);
    expect(result.city).toBe("北京市");
    expect(result.days).toHaveLength(4);
    expect(result.days[0]).toMatchObject({ date: "2026-09-01", week: "星期二", dayWeather: "晴", nightWeather: "多云", highTemp: 28, lowTemp: 18, windDirection: "东北风", windPower: "3" });
  });

  it("4 天数据可以安全渲染，且不泄漏空字段", () => {
    const result = convertAmapWeatherResponse({ status: "1", forecasts: [{ city: "北京", casts: [{ date: "2026-09-01", week: "2" }] }] });
    const html = renderWeatherForecast(result);
    expect((html.match(/class="weather-day"/gu) ?? [])).toHaveLength(1);
    expect(html).toContain("9月1日");
    expect(html).toContain("星期二");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("空预报数据抛出可识别错误而不崩溃", () => {
    expect(() => convertAmapWeatherResponse({ status: "1", forecasts: [] })).toThrowError(new WeatherApiError("api"));
  });
});

describe("高德天气请求", () => {
  it("先解析城市 adcode，再请求高德 4 天预报", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/geocode/geo")) return new Response(JSON.stringify({ status: "1", geocodes: [{ adcode: "110000" }] }));
      return new Response(JSON.stringify(weatherPayload));
    });
    const result = await fetchWeatherForecast("北京", "test-key");
    expect(result.days).toHaveLength(4);
    expect(String(request.mock.calls[0]?.[0])).toContain("restapi.amap.com/v3/geocode/geo");
    expect(String(request.mock.calls[1]?.[0])).toContain("city=110000");
    expect(String(request.mock.calls[1]?.[0])).not.toContain("open-meteo");
  });

  it("缺少 API Key、城市不存在、网络失败和接口异常都有友好提示", async () => {
    await expect(fetchWeatherForecast("北京", "")).rejects.toMatchObject({ kind: "missing-key" });
    expect(weatherErrorMessage(new WeatherApiError("missing-key"))).toContain("未配置天气服务");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ status: "1", geocodes: [] })));
    await expect(fetchWeatherForecast("不存在", "test-key")).rejects.toMatchObject({ kind: "city-not-found" });
    expect(weatherErrorMessage(new WeatherApiError("city-not-found"))).toBe("未找到该城市天气");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    await expect(fetchWeatherForecast("北京", "test-key")).rejects.toMatchObject({ kind: "network" });
    expect(weatherErrorMessage(new WeatherApiError("network"))).toBe("天气数据获取失败，请稍后重试");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "1", geocodes: [{ adcode: "110000" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "0", info: "INVALID_USER_KEY" })));
    await expect(fetchWeatherForecast("北京", "test-key")).rejects.toMatchObject({ kind: "api" });
  });
});
