/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  calculateGasValve,
  calculateLiquidValve,
  convertCoefficient,
  CV_PER_KV,
  GAS_N9_KV_NM3H_BAR_K,
  GAS_NORMAL_PRESSURE_BAR,
  ValveSizingError,
  waterValveProperties,
} from "../src/tools/control-valve-sizing/logic";
import { bindControlValve } from "../src/tools/control-valve-sizing/bind";
import { DEFAULT_VALVE_FORM, renderControlValve, renderControlValveResult } from "../src/tools/control-valve-sizing/view";
import type { ToolRuntime, ToolStorage } from "../src/tools/runtime";

describe("控制阀：液体公式（IEC 60534-2-1）", () => {
  it("Q=10 m³/h、水、ΔP=1 bar 时所需 Kv≈10", () => {
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

  it("水预设使用 IF97 计算 20°C 密度、蒸气压与临界压力", () => {
    const properties = waterValveProperties(2, 293.15);
    expect(properties.relativeDensity).toBeCloseTo(0.998, 3);
    expect(properties.vaporPressureBar).toBeCloseTo(0.0234, 3);
    expect(properties.criticalPressureBar).toBeCloseTo(220.64, 6);
  });

  it("水温下入口压力不高于蒸气压时拒绝液体公式", () => {
    expect(() => waterValveProperties(0.02, 293.15)).toThrow(/单相液体/);
  });

  it("裸阀提供 FL/Pv/Pc 后判断阻塞并提示汽蚀风险", () => {
    const result = calculateLiquidValve(
      { flowM3h: 10, p1Bar: 20, p2Bar: 2, relativeDensity: 1, vaporPressureBar: 0.023, criticalPressureBar: 221.2, fl: 0.9 },
      "Kv",
    );
    expect(result.choked).toBe("yes");
    expect(result.cavitationRisk).toBe(true);
    expect(result.pipingModel).toBe("bare-valve");
    expect(result.usedRecoveryFactor).toBeCloseTo(0.9, 8);
    expect(result.warnings.some((warning) => warning.includes("汽蚀"))).toBe(true);
    expect(result.effectiveDeltaPBar).toBeCloseTo(16.18, 1);
  });

  it("Fp<1 时必须使用 FLP，不能用裸阀 FL 代替", () => {
    const missing = calculateLiquidValve(
      { flowM3h: 10, p1Bar: 20, p2Bar: 2, relativeDensity: 1, vaporPressureBar: 0.023, criticalPressureBar: 221.2, fl: 0.9, fp: 0.9 },
      "Kv",
    );
    expect(missing.choked).toBe("not-evaluated");
    expect(missing.missingInputs).toContain("组合压力恢复系数 FLP");

    const installed = calculateLiquidValve(
      { flowM3h: 10, p1Bar: 20, p2Bar: 2, relativeDensity: 1, vaporPressureBar: 0.023, criticalPressureBar: 221.2, flp: 0.8, fp: 0.9 },
      "Kv",
    );
    expect(installed.pipingModel).toBe("installed-fittings");
    expect(installed.choked).toBe("yes");
    expect(installed.usedRecoveryFactor).toBeCloseTo(0.8, 8);
  });
});

describe("控制阀：气体公式（IEC 60534-2-1）", () => {
  const gasBase = { p1Bar: 5, p2Bar: 4, temperatureK: 293.15, zFactor: 1, molecularWeight: 28.9647, specificHeatRatio: 1.4 };

  it("使用 N9=2120 的 Nm³/h、bar(a)、K、kg/kmol 标准形式", () => {
    expect(GAS_N9_KV_NM3H_BAR_K).toBe(2120);
    expect(GAS_NORMAL_PRESSURE_BAR).toBeCloseTo(1.01325, 8);
    const result = calculateGasValve({ ...gasBase, flowNm3h: 100, xt: 0.7 }, "Kv");
    // 独立手算基准：x=0.2，Y=1-0.2/(3×0.7)=0.9047619，
    // Kv=100/(2120×5×Y)×sqrt(28.9647×293.15/0.2)=2.148445282...
    expect(result.requiredCoefficient!).toBeCloseTo(2.148445282, 8);
    expect(result.choked).toBe("no");
    expect(result.expansionFactor).toBeCloseTo(0.9047619048, 8);
  });

  it("缺少 xT 时输出容量粗估且阻塞状态为未评估", () => {
    const result = calculateGasValve({ ...gasBase, flowNm3h: 100 }, "Kv");
    expect(result.choked).toBe("not-evaluated");
    expect(result.missingInputs).toContain("额定压差比系数 xT");
    expect(result.requiredCoefficient!).toBeCloseTo(1.943831446, 8);
    expect(result.expansionFactor).toBe(1);
  });

  it("提供 xT 后正反算互逆", () => {
    const input = { ...gasBase, flowNm3h: 100, xt: 0.7 };
    const sized = calculateGasValve(input, "Kv");
    const predicted = calculateGasValve({ ...gasBase, ratedCoefficient: sized.requiredCoefficient!, xt: 0.7 }, "Kv");
    expect(predicted.predictedFlow!).toBeCloseTo(100, 6);
  });

  it("x ≥ Fγ·xT 时阻塞，Y=2/3，并使用临界压差比", () => {
    const result = calculateGasValve({
      p1Bar: 10,
      p2Bar: 2,
      temperatureK: 293.15,
      zFactor: 1,
      molecularWeight: 28.9647,
      specificHeatRatio: 1.4,
      flowNm3h: 100,
      xt: 0.5,
    }, "Kv");
    expect(result.choked).toBe("yes");
    expect(result.sizingPressureRatio).toBeCloseTo(0.5, 8);
    expect(result.expansionFactor!).toBeCloseTo(2 / 3, 8);
    expect(result.requiredCoefficient!).toBeCloseTo(0.9220402134, 8);
    expect(result.warnings.some((warning) => warning.includes("阻塞"))).toBe(true);
  });

  it("Fp<1 时必须使用 xTP，不能继续使用裸阀 xT", () => {
    const missing = calculateGasValve({ ...gasBase, flowNm3h: 100, fp: 0.9, xt: 0.7 }, "Kv");
    expect(missing.choked).toBe("not-evaluated");
    expect(missing.missingInputs).toContain("安装条件压差比系数 xTP");

    const installed = calculateGasValve({ ...gasBase, flowNm3h: 100, fp: 0.9, xtp: 0.6 }, "Kv");
    expect(installed.pipingModel).toBe("installed-fittings");
    expect(installed.usedPressureRatioFactor).toBeCloseTo(0.6, 8);
    expect(installed.choked).toBe("no");
  });

  it("Cv 与 Kv 模式在换算后给出相同物理容量", () => {
    const kv = calculateGasValve({ ...gasBase, flowNm3h: 100, xt: 0.7 }, "Kv");
    const cv = calculateGasValve({ ...gasBase, flowNm3h: 100, xt: 0.7 }, "Cv");
    expect(cv.requiredCoefficient! / CV_PER_KV).toBeCloseTo(kv.requiredCoefficient!, 8);
  });
});

describe("控制阀：压力口径与输入校验", () => {
  it("P2 ≥ P1 被拒绝", () => {
    expect(() => calculateLiquidValve({ flowM3h: 10, p1Bar: 1, p2Bar: 1, relativeDensity: 1 }, "Kv")).toThrow(/P2/);
    expect(() => calculateGasValve({ flowNm3h: 100, p1Bar: 2, p2Bar: 3, temperatureK: 293.15, zFactor: 1, molecularWeight: 29 }, "Kv")).toThrow(ValveSizingError);
  });

  it("非法压力提示必须使用绝压", () => {
    expect(() => calculateLiquidValve({ flowM3h: 10, p1Bar: 0, p2Bar: -0.5, relativeDensity: 1 }, "Kv")).toThrow(/绝压/);
  });

  it("气体比热比 k 超界时拒绝", () => {
    expect(() => calculateGasValve({ flowNm3h: 100, p1Bar: 5, p2Bar: 4, temperatureK: 293.15, zFactor: 1, molecularWeight: 29, specificHeatRatio: 1 }, "Kv")).toThrow(/比热比/);
  });

  it("阻塞状态保持三态字符串", () => {
    const result = calculateLiquidValve({ flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    expect(["yes", "no", "not-evaluated"]).toContain(result.choked);
    expect(typeof result.choked).toBe("string");
  });
});

describe("控制阀：DOM 事件链、参数帮助与存储", () => {
  function setup(initial?: Partial<typeof DEFAULT_VALVE_FORM>) {
    const store = new Map<string, unknown>();
    if (initial) store.set("workbench:control-valve-sizing", { ...DEFAULT_VALVE_FORM, ...initial });
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
    return { store, copied };
  }

  it("页面明确展示标准状态和 FL/FLP/xT/xTP 参数来源说明", () => {
    setup();
    expect(document.body.textContent).toContain("0°C、1.01325 bar(a)");
    expect(document.body.textContent).toContain("不能用 FL 代替");
    expect(document.body.textContent).toContain("不能用裸阀 xT 代替");
    expect(document.body.textContent).toContain("制造商");
    expect(document.body.textContent).toContain("建议先按 1.0 计算");
  });

  it("默认水预设自动更新并锁定 G、Pv、Pc", () => {
    setup();
    const density = document.querySelector<HTMLInputElement>("#valve-relative-density")!;
    const vaporPressure = document.querySelector<HTMLInputElement>("#valve-vapor-pressure")!;
    const criticalPressure = document.querySelector<HTMLInputElement>("#valve-critical-pressure")!;
    expect(density.disabled).toBe(true);
    expect(vaporPressure.disabled).toBe(true);
    expect(criticalPressure.disabled).toBe(true);
    expect(Number.parseFloat(density.value)).toBeCloseTo(0.998, 3);
    expect(Number.parseFloat(vaporPressure.value)).toBeCloseTo(0.0234, 3);
  });

  it("气体预设自动填写 M、k、Z，并显示 xT 字段", () => {
    setup();
    const medium = document.querySelector<HTMLSelectElement>("#valve-medium")!;
    medium.value = "gas";
    medium.dispatchEvent(new Event("change", { bubbles: true }));

    const preset = document.querySelector<HTMLSelectElement>("#valve-gas-preset")!;
    preset.value = "carbon-dioxide";
    preset.dispatchEvent(new Event("change", { bubbles: true }));
    expect(Number.parseFloat(document.querySelector<HTMLInputElement>("#valve-mw")!.value)).toBeCloseTo(44.0095, 4);
    expect(Number.parseFloat(document.querySelector<HTMLInputElement>("#valve-k")!.value)).toBeCloseTo(1.3, 3);
    expect(document.querySelector<HTMLElement>("#valve-xt")!.closest("label")!.hidden).toBe(false);
  });

  it("Fp<1 时液体切换 FL→FLP、气体切换 xT→xTP", () => {
    setup();
    const fp = document.querySelector<HTMLInputElement>("#valve-fp")!;
    fp.value = "0.9";
    fp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#valve-fl")!.closest("label")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#valve-flp")!.closest("label")!.hidden).toBe(false);

    const medium = document.querySelector<HTMLSelectElement>("#valve-medium")!;
    medium.value = "gas";
    medium.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#valve-xt")!.closest("label")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#valve-xtp")!.closest("label")!.hidden).toBe(false);
  });

  it("预测模式切换 Kv/Cv 时同步换算已有额定系数", () => {
    setup({ mode: "predict", ratedCoefficient: 16, coefficientUnit: "Kv", liquidPreset: "custom" });
    const unit = document.querySelector<HTMLSelectElement>("#valve-coefficient-unit")!;
    unit.value = "Cv";
    unit.dispatchEvent(new Event("change", { bubbles: true }));
    expect(Number.parseFloat(document.querySelector<HTMLInputElement>("#valve-rated")!.value)).toBeCloseTo(16 * CV_PER_KV, 8);
  });

  it("计算、复制结果与恢复默认值", async () => {
    const { store, copied } = setup();
    document.querySelector<HTMLButtonElement>("#valve-calculate")!.click();
    expect(document.querySelector<HTMLElement>("#valve-output")!.textContent).toContain("所需 Kv");
    document.querySelector<HTMLButtonElement>("[data-copy-result]")!.click();
    await Promise.resolve();
    expect(copied[0]).toContain("所需 Kv");

    document.querySelector<HTMLSelectElement>("#valve-medium")!.value = "gas";
    document.querySelector<HTMLButtonElement>("#valve-reset")!.click();
    expect(document.querySelector<HTMLSelectElement>("#valve-medium")!.value).toBe("liquid");
    expect(store.get("workbench:control-valve-sizing")).toEqual(DEFAULT_VALVE_FORM);
  });

  it("结果不输出阀门开度，只说明容量裕量边界", () => {
    const result = calculateLiquidValve({ flowM3h: 10, p1Bar: 2, p2Bar: 1, relativeDensity: 1 }, "Kv");
    const html = renderControlValveResult(result, "Kv", "liquid", "size");
    expect(html).not.toMatch(/开度[为约：:\d]|阀门开度[为约：:\d]/);
    expect(html).toContain("容量裕量");
    expect(html).toContain("不代表阀门开度");
  });
});
