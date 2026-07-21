/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { calculatePrds } from "../src/tools/steam-prds/logic";
import { bindSteamPrds } from "../src/tools/steam-prds/bind";
import { DEFAULT_PRDS_FORM, renderSteamPrds } from "../src/tools/steam-prds/view";
import { saturationProperties, solvePT } from "../src/tools/shared/if97-adapter";
import type { ToolRuntime, ToolStorage } from "../src/tools/runtime";

describe("蒸汽减压（模式 A）", () => {
  it("节流前后焓守恒（h2 = h1）", () => {
    const h1 = solvePT(1, 573.15).enthalpyKjKg;
    const result = calculatePrds({ mode: "throttle", p1Mpa: 1, t1K: 573.15, p2Mpa: 0.2 });
    expect(result.upstreamEnthalpyKjKg).toBeCloseTo(h1, 8);
    // 节流后仍为过热蒸汽，温度由 P-h 反算且焓不变
    expect(result.throttledPhase).toBe("过热蒸汽");
    expect(result.throttledTemperatureK!).toBeCloseTo(563.08, 1);
    const h2 = solvePT(0.2, result.throttledTemperatureK!).enthalpyKjKg;
    expect(h2).toBeCloseTo(h1, 4);
  });

  it("两相节流输出干度", () => {
    // 2 MPa 饱和液（h≈908.6 kJ/kg）节流到 0.1 MPa → 两相，x≈0.218
    const result = calculatePrds({ mode: "throttle", p1Mpa: 2, t1K: 485.53, p2Mpa: 0.1 });
    expect(result.throttledPhase).toBe("两相");
    expect(result.throttledQuality).not.toBeNull();
    expect(result.throttledQuality!).toBeCloseTo(0.218, 2);
    expect(result.warnings.some((warning) => warning.includes("两相"))).toBe(true);
  });

  it("下游压力高于上游被拒绝", () => {
    expect(() => calculatePrds({ mode: "throttle", p1Mpa: 0.5, t1K: 573.15, p2Mpa: 1 })).toThrow(/下游绝压/);
  });
});

describe("喷水减温（模式 B：目标温度求喷水量）", () => {
  it("Spirax Sarco 公开案例：10000 kg/h、10 bar(a)、300°C、喷水 150°C、目标约 185°C → 喷水约 1208 kg/h", () => {
    const result = calculatePrds({
      mode: "target-temperature",
      p1Mpa: 1,
      t1K: 573.15,
      p2Mpa: 1,
      steamFlowKgs: 10000 / 3600,
      sprayTemperatureK: 423.15,
      targetTemperatureK: 458.15,
    });
    expect(result.sprayFlowKgs! * 3600).toBeCloseTo(1208, -1.5);
    expect(Math.abs(result.energyResidual!)).toBeLessThan(1e-6);
    expect(result.outletPhase).toBe("过热蒸汽");
  });

  it("能量平衡残差小于 1e-6 且与模式 C 互逆", () => {
    const sized = calculatePrds({
      mode: "target-temperature",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 0.3,
      steamFlowKgs: 2, sprayTemperatureK: 353.15, targetTemperatureK: 420,
    });
    const back = calculatePrds({
      mode: "fixed-water",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 0.3,
      steamFlowKgs: 2, sprayTemperatureK: 353.15, sprayFlowKgs: sized.sprayFlowKgs!,
    });
    expect(back.outletTemperatureK!).toBeCloseTo(420, 2);
    expect(back.totalOutletFlowKgs!).toBeCloseTo(sized.totalOutletFlowKgs!, 8);
  });

  it("目标温度低于饱和温度时拒绝", () => {
    expect(() => calculatePrds({
      mode: "target-temperature",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 0.3,
      steamFlowKgs: 2, sprayTemperatureK: 353.15, targetTemperatureK: 400,
    })).toThrow(/饱和温度/);
  });

  it("目标温度高于节流后温度时报错（负喷水量）", () => {
    expect(() => calculatePrds({
      mode: "target-temperature",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 0.3,
      steamFlowKgs: 2, sprayTemperatureK: 353.15, targetTemperatureK: 600,
    })).toThrow(/负喷水量|目标温度高于节流后温度/);
  });

  it("目标过热度低于 3 K 时给出夹带水风险警告", () => {
    const result = calculatePrds({
      mode: "target-temperature",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 0.3,
      steamFlowKgs: 2, sprayTemperatureK: 353.15, targetSuperheatK: 2,
    });
    expect(result.warnings.some((warning) => warning.includes("夹带水"))).toBe(true);
  });

  it("喷水压力不高于减温器处蒸汽压力时拒绝", () => {
    expect(() => calculatePrds({
      mode: "target-temperature",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 0.3,
      steamFlowKgs: 2, sprayTemperatureK: 353.15, sprayPressureMpa: 0.3, targetSuperheatK: 5,
    })).toThrow(/喷水压力/);
  });
});

describe("喷水减温（模式 C：给定喷水量求出口状态）", () => {
  it("过热减温到接近饱和", () => {
    const result = calculatePrds({
      mode: "fixed-water",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 1,
      steamFlowKgs: 10000 / 3600, sprayTemperatureK: 423.15, sprayFlowKgs: 1208 / 3600,
    });
    expect(result.outletTemperatureK!).toBeCloseTo(458.15, 0);
    expect(result.outletPhase).toBe("过热蒸汽");
    expect(result.totalOutletFlowKgs! * 3600).toBeCloseTo(11208, 0);
  });

  it("过量喷水进入两相区并警告", () => {
    const result = calculatePrds({
      mode: "fixed-water",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 1,
      steamFlowKgs: 10000 / 3600, sprayTemperatureK: 353.15, sprayFlowKgs: 6000 / 3600,
    });
    expect(result.outletPhase).toBe("两相");
    expect(result.outletQuality).not.toBeNull();
    expect(result.warnings.some((warning) => warning.includes("两相") || warning.includes("水击"))).toBe(true);
  });

  it("饱和边界：喷水恰好减到饱和温度时判为干饱和蒸汽", () => {
    const { vapor } = saturationProperties(1);
    const h1 = solvePT(1, 573.15).enthalpyKjKg;
    const hw = solvePT(1, 423.15).enthalpyKjKg;
    // 使混合焓等于饱和汽焓：ms·h1 + mw·hw = (ms+mw)·hg
    const ms = 1;
    const mw = ms * (h1 - vapor.enthalpyKjKg) / (vapor.enthalpyKjKg - hw);
    const result = calculatePrds({
      mode: "fixed-water",
      p1Mpa: 1, t1K: 573.15, p2Mpa: 1,
      steamFlowKgs: ms, sprayTemperatureK: 423.15, sprayFlowKgs: mw,
    });
    expect(result.outletPhase).toBe("干饱和蒸汽");
  });
});

describe("蒸汽工具：DOM 事件链", () => {
  function setup() {
    const store = new Map<string, unknown>();
    const storage: ToolStorage = {
      read<T>(key: string, fallback: T): T { return (store.has(key) ? store.get(key) : fallback) as T; },
      write<T>(key: string, value: T): boolean { store.set(key, value); return true; },
    };
    const copied: string[] = [];
    const runtime: ToolRuntime = { storage, feedback: () => undefined, copyText: async (value) => { copied.push(value); }, downloadText: () => undefined };
    document.body.innerHTML = renderSteamPrds(storage);
    const output = document.querySelector<HTMLElement>("#prds-output")!;
    Object.defineProperty(output, "innerText", { configurable: true, get: () => output.textContent ?? "" });
    bindSteamPrds(runtime);
    return { store, copied };
  }

  it("模式切换控制字段可见性，默认仅减压不显示喷水字段", () => {
    setup();
    expect(document.querySelector<HTMLElement>("#prds-spray-temp")!.closest("label")!.hasAttribute("hidden")).toBe(true);
    const mode = document.querySelector<HTMLSelectElement>("#prds-mode")!;
    mode.value = "target-temperature";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#prds-spray-temp")!.closest("label")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector<HTMLElement>("#prds-target-superheat")!.closest("label")!.hasAttribute("hidden")).toBe(false);
  });

  it("目标温度模式计算并复制结果，显示中文标签", async () => {
    const { copied } = setup();
    const mode = document.querySelector<HTMLSelectElement>("#prds-mode")!;
    mode.value = "target-temperature";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLInputElement>("#prds-target-temp")!.value = "185";
    document.querySelector<HTMLInputElement>("#prds-target-superheat")!.value = "";
    document.querySelector<HTMLButtonElement>("#prds-calculate")!.click();
    const output = document.querySelector<HTMLElement>("#prds-output")!;
    ["所需喷水量", "水汽比", "能量平衡残差", "P2 饱和温度", "出口过热度"].forEach((text) => expect(output.textContent).toContain(text));
    document.querySelector<HTMLButtonElement>("[data-copy-result]")!.click();
    await Promise.resolve();
    expect(copied[0]).toContain("所需喷水量");
  });

  it("恢复默认值回到仅减压模式", () => {
    const { store } = setup();
    document.querySelector<HTMLSelectElement>("#prds-mode")!.value = "fixed-water";
    document.querySelector<HTMLButtonElement>("#prds-reset")!.click();
    expect(document.querySelector<HTMLSelectElement>("#prds-mode")!.value).toBe("throttle");
    expect(store.get("workbench:steam-prds")).toEqual(DEFAULT_PRDS_FORM);
  });

  it("单位切换后状态与结果不变（bar(a) 与 °C 为唯一输入口径）", () => {
    setup();
    document.querySelector<HTMLButtonElement>("#prds-calculate")!.click();
    const first = document.querySelector<HTMLElement>("#prds-output")!.textContent;
    document.querySelector<HTMLInputElement>("#prds-p1")!.dispatchEvent(new Event("input", { bubbles: true }));
    const second = document.querySelector<HTMLElement>("#prds-output")!.textContent;
    expect(second).toBe(first);
  });
});
