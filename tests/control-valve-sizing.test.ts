/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  calculateGasValve,
  calculateLiquidValve,
  convertCoefficient,
  CV_PER_KV,
  ValveSizingError,
} from "../src/tools/control-valve-sizing/logic";
import { bindControlValve } from "../src/tools/control-valve-sizing/bind";
import { DEFAULT_VALVE_FORM, renderControlValve, renderControlValveResult } from "../src/tools/control-valve-sizing/view";
import type { ToolRuntime, ToolStorage } from "../src/tools/runtime";

describe("控制阀：液体公式（IEC 60534-2-1）", () => {
  it("Q=10 m³/h、水、ΔP=1 bar 时所需 Kv≈10（Emerson 手册基础关系）", () => {
    const result = calculateLiquidValve({ flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    expect(result.requiredCoefficient!).toBeCloseTo(10, 6);
    expect(result.choked).toBe("not-evaluated");
  });

  it("Cv/Kv 双向换算一致（Cv = 1.156 × Kv）", () => {
    expect(convertCoefficient(10, "Kv", "Cv")).toBeCloseTo(11.56, 6);
    expect(convertCoefficient(11.56, "Cv", "Kv")).toBeCloseTo(10, 6);
    expect(CV_PER_KV).toBeCloseTo(1.156, 6);
  });

  it("已知 Kv 反算流量与正算互逆", () => {
    const sized = calculateLiquidValve({ flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    const predicted = calculateLiquidValve({ ratedCoefficient: sized.requiredCoefficient!, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    expect(predicted.predictedFlow!).toBeCloseTo(10, 6);
  });

  it("提供 FL/Pv/Pc 后判断阻塞：极高出口压力水工况阻塞并提示汽蚀风险", () => {
    // FF = 0.96 − 0.28·√(0.023/221.2) ≈ 0.957；ΔPmax = 0.81×(20 − 0.957×0.023) ≈ 16.18 bar
    // ΔP = 18 > 16.18 → 阻塞；P2 = 2 bar > FF·Pv → 汽蚀风险
    const result = calculateLiquidValve(
      { flowM3h: 10, p1Bar: 20, p2Bar: 2, relativeDensity: 1, vaporPressureBar: 0.023, criticalPressureBar: 221.2, fl: 0.9 },
      "Kv",
    );
    expect(result.choked).toBe("yes");
    expect(result.cavitationRisk).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("汽蚀"))).toBe(true);
    expect(result.effectiveDeltaPBar).toBeCloseTo(16.18, 1);
    expect(result.requiredCoefficient!).toBeCloseTo(10 * Math.sqrt(1 / 16.18), 1);
  });

  it("非阻塞工况提供 FL 后状态为「否」", () => {
    const result = calculateLiquidValve(
      { flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1, vaporPressureBar: 0.023, criticalPressureBar: 221.2, fl: 0.9 },
      "Kv",
    );
    expect(result.choked).toBe("no");
    expect(result.cavitationRisk).toBeNull();
  });
});

describe("控制阀：气体公式（IEC 60534-2-1）", () => {
  const gasBase = { p1Bar: 5, p2Bar: 4, temperatureK: 293.15, zFactor: 1, molecularWeight: 28.9647 };

  it("缺少 xT 时输出简化估算且阻塞状态为「未评估」", () => {
    const result = calculateGasValve({ ...gasBase, flowNm3h: 100 }, "Kv");
    expect(result.choked).toBe("not-evaluated");
    expect(result.missingInputs).toContain("压差比系数 xT");
    expect(result.requiredCoefficient!).toBeGreaterThan(0);
    expect(result.expansionFactor).toBe(1);
  });

  it("提供 xT 后小压差为非阻塞且正反算互逆", () => {
    const input = { ...gasBase, flowNm3h: 100, xt: 0.7, fGamma: 1 };
    const sized = calculateGasValve(input, "Kv");
    expect(sized.choked).toBe("no");
    expect(sized.expansionFactor!).toBeLessThan(1);
    const predicted = calculateGasValve({ ...gasBase, ratedCoefficient: sized.requiredCoefficient!, xt: 0.7, fGamma: 1 }, "Kv");
    expect(predicted.predictedFlow!).toBeCloseTo(100, 4);
  });

  it("x ≥ Fγ·xT 时判断为阻塞并按临界压差计算", () => {
    const result = calculateGasValve({ p1Bar: 10, p2Bar: 2, temperatureK: 293.15, zFactor: 1, molecularWeight: 28.9647, flowNm3h: 100, xt: 0.5, fGamma: 1 }, "Kv");
    expect(result.choked).toBe("yes");
    expect(result.expansionFactor!).toBeCloseTo(2 / 3, 6);
    expect(result.warnings.some((warning) => warning.includes("阻塞"))).toBe(true);
    // 阻塞：Kv = Qn/(257·Y)·sqrt(M·T·Z/(xT·P1·(P1+P2)))，Y=2/3
    const expected = (100 / (257 * (2 / 3))) * Math.sqrt((28.9647 * 293.15) / (0.5 * 10 * 12));
    expect(result.requiredCoefficient!).toBeCloseTo(expected, 6);
  });
});

describe("控制阀：压力口径与输入校验", () => {
  it("P2 ≥ P1 被拒绝", () => {
    expect(() => calculateLiquidValve({ flowM3h: 10, p1Bar: 1, p2Bar: 1, relativeDensity: 1 }, "Kv")).toThrow(/P2/);
    expect(() => calculateGasValve({ flowNm3h: 100, p1Bar: 2, p2Bar: 3, temperatureK: 293.15, zFactor: 1, molecularWeight: 29 }, "Kv")).toThrow(ValveSizingError);
  });

  it("非法压力（零/负值）给出明确错误，提示必须使用绝压", () => {
    expect(() => calculateLiquidValve({ flowM3h: 10, p1Bar: 0, p2Bar: -0.5, relativeDensity: 1 }, "Kv")).toThrow(/绝压/);
  });

  it("既无流量也无额定系数时拒绝", () => {
    expect(() => calculateLiquidValve({ p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv")).toThrow(/流量/);
  });

  it("阻塞状态为三态而非布尔值", () => {
    const result = calculateLiquidValve({ flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    expect(["yes", "no", "not-evaluated"]).toContain(result.choked);
    expect(typeof result.choked).toBe("string");
  });
});

describe("控制阀：DOM 事件链", () => {
  function setup() {
    const store = new Map<string, unknown>();
    const storage: ToolStorage = {
      read<T>(key: string, fallback: T): T { return (store.has(key) ? store.get(key) : fallback) as T; },
      write<T>(key: string, value: T): boolean { store.set(key, value); return true; },
    };
    const copied: string[] = [];
    const runtime: ToolRuntime = { storage, feedback: () => undefined, copyText: async (value) => { copied.push(value); }, downloadText: () => undefined };
    document.body.innerHTML = renderControlValve(storage);
    const output = document.querySelector<HTMLElement>("#valve-output")!;
    Object.defineProperty(output, "innerText", { configurable: true, get: () => output.textContent ?? "" });
    bindControlValve(runtime);
    return { store, runtime, copied };
  }

  it("默认液体模式计算所需 Kv，切换 Cv 单位后结果同步换算", () => {
    setup();
    document.querySelector<HTMLButtonElement>("#valve-calculate")!.click();
    const output = document.querySelector<HTMLElement>("#valve-output")!;
    expect(output.textContent).toContain("所需 Kv");
    expect(output.textContent).toContain("未评估");

    const unit = document.querySelector<HTMLSelectElement>("#valve-coefficient-unit")!;
    unit.value = "Cv";
    unit.dispatchEvent(new Event("change", { bubbles: true }));
    expect(output.textContent).toContain("所需 Cv");
  });

  it("切换介质到气体后显示 xT 字段并标记未评估", () => {
    setup();
    const medium = document.querySelector<HTMLSelectElement>("#valve-medium")!;
    medium.value = "gas";
    medium.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#valve-xt")!.closest("label")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector<HTMLElement>("#valve-vapor-pressure")!.closest("label")!.hasAttribute("hidden")).toBe(true);

    document.querySelector<HTMLButtonElement>("#valve-calculate")!.click();
    expect(document.querySelector<HTMLElement>("#valve-output")!.textContent).toContain("未评估");
  });

  it("复制结果与恢复默认值", async () => {
    const { store, copied } = setup();
    document.querySelector<HTMLButtonElement>("#valve-calculate")!.click();
    document.querySelector<HTMLButtonElement>("[data-copy-result]")!.click();
    await Promise.resolve();
    expect(copied[0]).toContain("所需 Kv");

    document.querySelector<HTMLSelectElement>("#valve-medium")!.value = "gas";
    document.querySelector<HTMLButtonElement>("#valve-reset")!.click();
    expect(document.querySelector<HTMLSelectElement>("#valve-medium")!.value).toBe("liquid");
    expect(store.get("workbench:control-valve-sizing")).toEqual(DEFAULT_VALVE_FORM);
  });

  it("结果视图不输出阀门开度结论，只说明容量裕量口径", () => {
    const result = calculateLiquidValve({ flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    const html = renderControlValveResult(result, "Kv", "liquid", "size");
    expect(html).not.toMatch(/开度[为约：:\d]|阀门开度[为约：:\d]/);
    expect(html).toContain("容量裕量");
    expect(html).toContain("初步选型");
    expect(html).toContain("不代表阀门开度");
  });
});
