import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchWeatherForecast = vi.hoisted(() => vi.fn());

vi.mock("../src/weather", () => ({
  fetchWeatherForecast,
  getAmapWeatherKey: () => "test-key",
  renderWeatherForecast: () => "",
  weatherErrorMessage: () => "天气数据获取失败，请稍后重试",
}));

let bindDashboardWidgets: typeof import("../src/widgets").bindDashboardWidgets;
let disposeDashboardWidgets: typeof import("../src/widgets").disposeDashboardWidgets;
let renderDashboardWidgets: typeof import("../src/widgets").renderDashboardWidgets;

function installDom(dom: JSDOM): void {
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("DOMParser", dom.window.DOMParser);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("RSS disabled in weather widget test")));
}

beforeEach(async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
  installDom(dom);
  ({ bindDashboardWidgets, disposeDashboardWidgets, renderDashboardWidgets } = await import("../src/widgets"));
  fetchWeatherForecast.mockReset().mockResolvedValue({ city: "北京市", days: [] });
});

afterEach(() => {
  disposeDashboardWidgets();
  vi.unstubAllGlobals();
});

describe("天气城市记忆", () => {
  it("保存成功查询的城市，并在下次打开时自动查询；输入新城市仍可更新", async () => {
    const firstDom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
    installDom(firstDom);
    document.body.innerHTML = renderDashboardWidgets();
    bindDashboardWidgets();

    const input = document.querySelector<HTMLInputElement>("[data-weather-city]")!;
    input.value = "北京";
    document.querySelector<HTMLFormElement>("[data-weather-form]")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetchWeatherForecast).toHaveBeenCalledWith("北京"));
    expect(firstDom.window.localStorage.getItem("workbench:weather-city")).toBe("北京");

    disposeDashboardWidgets();
    const secondDom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
    secondDom.window.localStorage.setItem("workbench:weather-city", "北京");
    installDom(secondDom);
    document.body.innerHTML = renderDashboardWidgets();
    fetchWeatherForecast.mockClear().mockResolvedValue({ city: "北京市", days: [] });
    bindDashboardWidgets();
    await vi.waitFor(() => expect(fetchWeatherForecast).toHaveBeenCalledWith("北京"));
    expect(document.querySelector<HTMLInputElement>("[data-weather-city]")?.value).toBe("北京");

    const newInput = document.querySelector<HTMLInputElement>("[data-weather-city]")!;
    newInput.value = "上海";
    document.querySelector<HTMLFormElement>("[data-weather-form]")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetchWeatherForecast).toHaveBeenCalledWith("上海"));
    expect(secondDom.window.localStorage.getItem("workbench:weather-city")).toBe("上海");
  });
});
