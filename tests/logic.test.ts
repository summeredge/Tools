import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import createDOMPurify from "dompurify";
import { createStorageAdapter } from "../src/logic";
import { renderMarkdown as renderSafeMarkdown } from "../src/markdown";
import { fetchSafety } from "../src/safety";
import { fetchWeather, WeatherError } from "../src/weather";

describe("Markdown 安全净化和存储降级", () => {
  it("移除脚本和危险链接，同时保留常见 Markdown", () => {
    const dom = new JSDOM("<!doctype html>");
    const purifier = createDOMPurify(dom.window);
    const html = renderSafeMarkdown("# 标题\n\n- [x] 完成\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))", (value) => purifier.sanitize(value));
    expect(html).toContain("<h1");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });

  it("浏览器存储不可用时工具仍可读写失败而不抛错", () => {
    const adapter = createStorageAdapter({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(adapter.available).toBe(false);
    expect(adapter.read("key", "fallback")).toBe("fallback");
    expect(adapter.write("key", "value")).toBe(false);
  });
});

describe("化学品安全信息服务", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("按名称解析 PubChem CID 并提取 GHS 摘要", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/cids/")) return new Response(JSON.stringify({ IdentifierList: { CID: [702] } }));
      if (url.includes("/property/")) return new Response(JSON.stringify({ PropertyTable: { Properties: [{ IUPACName: "ethanol", MolecularFormula: "C2H6O", MolecularWeight: "46.07" }] } }));
      return new Response(JSON.stringify({ Record: { RecordTitle: "Ethanol", Section: [{ TOCHeading: "Safety and Hazards", Section: [{ TOCHeading: "Hazards Identification", Section: [{ TOCHeading: "GHS Classification", Information: [{ Name: "Pictogram(s)", Value: { StringWithMarkup: [{ String: " ", Markup: [{ Extra: "Flammable" }] }] } }, { Name: "Signal", Value: { StringWithMarkup: [{ String: "Danger" }] } }, { Name: "GHS Hazard Statements", Value: { StringWithMarkup: [{ String: "H225: Highly Flammable liquid and vapor" }] } }, { Name: "Precautionary Statement Codes", Value: { StringWithMarkup: [{ String: "P210, P233" }] } }] }] }] }] } }));
    }) as typeof fetch;

    const result = await fetchSafety("ethanol");

    expect(requestedUrls[0]).toContain("/compound/name/ethanol/cids/JSON");
    expect(result.cid).toBe(702);
    expect(result.formula).toBe("C2H6O");
    expect(result.pictograms).toEqual(["Flammable"]);
    expect(result.signal).toBe("Danger");
    expect(result.hazards).toContain("H225");
    expect(result.precautions).toContain("P210");

    requestedUrls.length = 0;
    await fetchSafety("64-17-5");
    expect(requestedUrls[0]).toContain("/compound/identifier/64-17-5/cids/JSON?identifier_type=CAS");
  });

  it("没有 CID 时返回可理解的空结果错误", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ IdentifierList: { CID: [] } }))) as typeof fetch;
    await expect(fetchSafety("不存在的化学品")).rejects.toMatchObject({ kind: "empty" });
  });
});

describe("天气服务响应边界", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("成功时返回当前天气、更新时间所需数据和预报", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ msg: "success", code: 0, data: ["Wqsps|北京|北京市|/ABJ/beijing.html|116.46|39.8"] }));
      return new Response(JSON.stringify({ msg: "success", code: 0, data: { real: { station: { code: "Wqsps", city: "北京" }, publish_time: "2025-01-01 12:00", weather: { temperature: 25, feelst: 26, humidity: 60, img: "0", info: "晴" }, wind: { speed: 12 } }, predict: { detail: [{ date: "2025-01-01", day: { weather: { info: "晴", img: "0", temperature: "28" } }, night: { weather: { info: "晴", img: "0", temperature: "18" } } }] } } }));
    }) as typeof fetch;
    const result = await fetchWeather("北京");
    expect(result.city).toBe("北京");
    expect(result.wind).toBe(12);
    expect(result.days).toHaveLength(1);
    expect(call).toBe(2);
  });

  it("使用中央气象台站点编码查询上海", async () => {
    let call = 0;
    let requestedForecastUrl = "";
    globalThis.fetch = (async (input) => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ msg: "success", code: 0, data: ["WwcJd|上海|上海市|/ASH/shanghai.html|121.43|31.19"] }));
      requestedForecastUrl = String(input);
      return new Response(JSON.stringify({ msg: "success", code: 0, data: { real: { station: { code: "WwcJd", city: "上海" }, publish_time: "2025-01-01 12:00", weather: { temperature: 25, feelst: 26, humidity: 60, img: "0", info: "晴" }, wind: { speed: 12 } }, predict: { detail: [{ date: "2025-01-01", day: { weather: { info: "晴", img: "0", temperature: "28" } }, night: { weather: { info: "晴", img: "0", temperature: "18" } } }] } } }));
    }) as typeof fetch;

    const result = await fetchWeather("上海");

    expect(requestedForecastUrl).toContain("stationid=WwcJd");
    expect(result.city).toBe("上海");
  });

  it("区分空结果、网络错误和限流", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ msg: "success", code: 0, data: [] }))) as typeof fetch;
    await expect(fetchWeather("不存在的城市")).rejects.toMatchObject({ kind: "empty" });
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await expect(fetchWeather("上海")).rejects.toMatchObject({ kind: "network" });
    globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
    await expect(fetchWeather("上海")).rejects.toBeInstanceOf(WeatherError);
    await expect(fetchWeather("上海")).rejects.toMatchObject({ kind: "rate" });
  });
});
