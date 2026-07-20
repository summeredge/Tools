import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import createDOMPurify from "dompurify";
import {
  UNIT_CATEGORIES,
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
  jsonTransform,
  parseColor,
  rgbToHex,
  timestampToDate,
} from "../src/logic";
import { renderMarkdown as renderSafeMarkdown } from "../src/markdown";
import { fetchWeather, WeatherError } from "../src/weather";

describe("科学计算与单位换算", () => {
  it("安全解析优先级、括号、百分比和函数", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) ^ 2")).toBe(25);
    expect(evaluateExpression("12.5% * 80")).toBe(10);
    expect(evaluateExpression("sqrt(81) + sin(pi / 2)")).toBeCloseTo(10);
    expect(() => evaluateExpression("1 / 0")).toThrow("不能除以 0");
    expect(() => evaluateExpression("globalThis.alert(1)")).toThrow();
  });

  it("覆盖温度、压力和全部单位类别", () => {
    expect(convertUnit(32, "temperature", "f", "c")).toBeCloseTo(0);
    expect(convertUnit(100, "temperature", "c", "f")).toBeCloseTo(212);
    expect(convertUnit(1, "pressure", "bar", "kpa")).toBeCloseTo(100);
    for (const category of Object.keys(UNIT_CATEGORIES) as Array<keyof typeof UNIT_CATEGORIES>) {
      const keys = Object.keys(UNIT_CATEGORIES[category].units);
      expect(convertUnit(1, category, keys[0]!, keys[0]!)).toBe(1);
    }
  });
});

describe("日期、编码和 JSON", () => {
  it("区分 Unix 秒和毫秒并计算日期差值", () => {
    expect(timestampToDate(0, "seconds").toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(timestampToDate(0, "milliseconds").toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(dateToTimestamp("1970-01-01T00:00:01.000Z", "seconds")).toBe(1);
    expect(dateToTimestamp("1970-01-01T00:00:01.000Z", "milliseconds")).toBe(1000);
    expect(dateDifference("2025-01-01T00:00:00Z", "2025-01-02T02:03:04Z")).toMatchObject({ days: 1, hours: 2, minutes: 3, seconds: 4 });
  });

  it("支持 UTF-8 Base64、URL 和整数进制", () => {
    expect(decodeBase64(encodeBase64("中文 workbench"))).toBe("中文 workbench");
    expect(decodeUrl(encodeUrl("a b/中文"))).toBe("a b/中文");
    expect(convertInteger("255", 10, 16)).toBe("FF");
    expect(convertInteger("11111111", 2, 10)).toBe("255");
    expect(() => convertInteger("102", 2, 10)).toThrow();
  });

  it("格式化和压缩 JSON，并保留可理解的错误", () => {
    expect(jsonTransform('{"a":1,"b":[true]}', false)).toEqual({ ok: true, value: '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}' });
    expect(jsonTransform('{"a":1}', true)).toEqual({ ok: true, value: '{"a":1}' });
    const bad = jsonTransform('{"a":}', false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/JSON|position|字符/);
  });
});

describe("Markdown 安全净化、颜色和存储降级", () => {
  it("移除脚本和危险链接，同时保留常见 Markdown", () => {
    const dom = new JSDOM("<!doctype html>");
    const purifier = createDOMPurify(dom.window);
    const html = renderSafeMarkdown("# 标题\n\n- [x] 完成\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))", (value) => purifier.sanitize(value));
    expect(html).toContain("<h1");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });

  it("转换颜色并能识别非法颜色", () => {
    expect(rgbToHex(parseColor("rgb(47, 111, 237)"))).toBe("#2F6FED");
    expect(rgbToHex(parseColor("hsl(220, 84%, 56%)"))).toBe("#316FED");
    expect(() => parseColor("not-a-color")).toThrow();
  });

  it("浏览器存储不可用时工具仍可读写失败而不抛错", () => {
    const adapter = createStorageAdapter({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(adapter.available).toBe(false);
    expect(adapter.read("key", "fallback")).toBe("fallback");
    expect(adapter.write("key", "value")).toBe(false);
  });
});

describe("天气服务响应边界", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("成功时返回当前天气、更新时间所需数据和预报", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ results: [{ name: "上海", country: "中国", latitude: 31.2, longitude: 121.5 }] }));
      return new Response(JSON.stringify({ timezone: "Asia/Shanghai", current: { temperature_2m: 25, apparent_temperature: 26, relative_humidity_2m: 60, wind_speed_10m: 12, weather_code: 1 }, daily: { time: ["2025-01-01"], weather_code: [0], temperature_2m_max: [28], temperature_2m_min: [18] } }));
    }) as typeof fetch;
    const result = await fetchWeather("上海");
    expect(result.city).toBe("上海");
    expect(result.days).toHaveLength(1);
    expect(call).toBe(2);
  });

  it("区分空结果、网络错误和限流", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ results: [] }))) as typeof fetch;
    await expect(fetchWeather("不存在的城市")).rejects.toMatchObject({ kind: "empty" });
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await expect(fetchWeather("上海")).rejects.toMatchObject({ kind: "network" });
    globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
    await expect(fetchWeather("上海")).rejects.toBeInstanceOf(WeatherError);
    await expect(fetchWeather("上海")).rejects.toMatchObject({ kind: "rate" });
  });
});
