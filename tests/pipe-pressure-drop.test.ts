/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { calculatePipePressure, PipePressureError, type PipePressureInput } from "../src/tools/pipe-pressure-drop/logic";
import { bindPipePressure } from "../src/tools/pipe-pressure-drop/bind";
import { DEFAULT_PIPE_FORM, renderPipePressure, renderPipePressureResult } from "../src/tools/pipe-pressure-drop/view";
import type { ToolRuntime, ToolStorage } from "../src/tools/runtime";

const baseline: PipePressureInput = {
  flowM3s: Math.PI * 0.01 ** 2 / 4 * 0.1,
  diameterM: 0.01,
  lengthM: 10,
  densityKgM3: 1000,
  viscosityPas: 0.001,
  roughnessM: 0,
  sumK: 2,
};

describe("管道流速与压降（既有行为回归）", () => {
  it("通过层流基准算例", () => {
    const result = calculatePipePressure(baseline);
    expect(result.velocityMs).toBeCloseTo(0.1, 8);
    expect(result.reynolds).toBeCloseTo(1000, 6);
    expect(result.frictionFactor).toBeCloseTo(0.064, 8);
    expect(result.straightDropPa).toBeCloseTo(320, 6);
    expect(result.localDropPa).toBeCloseTo(10, 6);
    expect(result.totalDropPa).toBeCloseTo(330, 6);
  });

  it("标记过渡区并拒绝同时填写两种流量", () => {
    const transition = calculatePipePressure({ ...baseline, flowM3s: Math.PI * 0.01 ** 2 / 4 * 0.3 });
    expect(transition.regime).toBe("过渡流");
    expect(transition.warnings[0]).toContain("过渡区");
    expect(() => calculatePipePressure({ ...baseline, massFlowKgs: 1 })).toThrow(PipePressureError);
  });
});

describe("管道：水（IF97 自动物性）", () => {
  it("D=50 mm、L=100 m、Q=10 m³/h、粗糙度 0.045 mm、水约 20°C 基准案例", () => {
    const result = calculatePipePressure({
      flowM3s: 10 / 3600,
      diameterM: 0.05,
      lengthM: 100,
      roughnessM: 0.045e-3,
      sumK: 0,
      inletPressurePa: 2e5,
      fluid: { kind: "water", temperatureK: 293.15 },
    });
    expect(result.velocityMs).toBeCloseTo(1.4147, 3);
    expect(result.reynolds).toBeCloseTo(7.05e4, -2.5);
    expect(result.frictionFactor).toBeCloseTo(0.02269, 2);
    expect(result.straightDropPa).toBeCloseTo(45.3e3, -3);
    expect(result.densityKgM3).toBeCloseTo(998.25, 1);
    expect(result.flowModel).toBe("incompressible");
    expect(result.propertyNote).toContain("IF97");
  });

  it("两相区/蒸汽区温度被拒绝，缺少压力时拒绝", () => {
    const base = { flowM3s: 0.001, diameterM: 0.05, lengthM: 10, roughnessM: 0, sumK: 0 };
    expect(() => calculatePipePressure({ ...base, inletPressurePa: 101325, fluid: { kind: "water", temperatureK: 473.15 } })).toThrow(/蒸汽/);
    expect(() => calculatePipePressure({ ...base, fluid: { kind: "water", temperatureK: 293.15 } })).toThrow(/入口绝对压力/);
    expect(() => calculatePipePressure({ ...base, inletPressurePa: 101325, fluid: { kind: "water" } })).toThrow(/温度/);
  });
});

describe("管道：空气（等温低压降近似）", () => {
  const airInput: PipePressureInput = {
    flowM3s: 100 / 3600,
    diameterM: 0.05,
    lengthM: 50,
    roughnessM: 0.045e-3,
    sumK: 0,
    inletPressurePa: 500000,
    fluid: { kind: "air", temperatureK: 293.15, zFactor: 1 },
  };

  it("低压降案例收敛且结果合理", () => {
    const result = calculatePipePressure(airInput);
    expect(result.flowModel).toBe("isothermal-gas-iterative");
    expect(result.outletPressurePa).not.toBeNull();
    expect(result.outletPressurePa!).toBeLessThan(500000);
    expect(result.outletPressurePa!).toBeGreaterThan(400000);
    expect(result.iterations).not.toBeNull();
    expect(result.densityKgM3).toBeCloseTo(500000 * 28.9647 / (8314.462618 * 293.15), 6);
  });

  it("压降超过 10% 时产生警告", () => {
    const result = calculatePipePressure({ ...airInput, lengthM: 5, diameterM: 0.04, flowM3s: 420 / 3600, sumK: 0 });
    expect(result.totalDropPa / 500000).toBeGreaterThan(0.1);
    expect(result.warnings.some((warning) => warning.includes("10%"))).toBe(true);
  });

  it("马赫数达到 0.3 时产生警告", () => {
    const result = calculatePipePressure({
      flowM3s: 450 / 3600,
      diameterM: 0.04,
      lengthM: 3,
      roughnessM: 0.045e-3,
      sumK: 0,
      inletPressurePa: 500000,
      fluid: { kind: "air", temperatureK: 293.15, zFactor: 1 },
    });
    expect(result.mach).not.toBeNull();
    expect(result.mach!).toBeGreaterThanOrEqual(0.3);
    expect(result.warnings.some((warning) => warning.includes("马赫数"))).toBe(true);
  });
});

describe("管道：蒸汽", () => {
  const steamBase: PipePressureInput = {
    flowM3s: 50 / 3600,
    diameterM: 0.05,
    lengthM: 30,
    roughnessM: 0.045e-3,
    sumK: 0,
    inletPressurePa: 1e6,
    fluid: { kind: "steam", temperatureK: 573.15 },
  };

  it("低压降过热蒸汽案例收敛", () => {
    const result = calculatePipePressure(steamBase);
    expect(result.flowModel).toBe("isothermal-gas-iterative");
    expect(result.outletPressurePa!).toBeLessThan(1e6);
    expect(result.outletPressurePa!).toBeGreaterThan(0.9e6);
    expect(result.densityKgM3).toBeCloseTo(3.876, 2);
  });

  it("湿蒸汽输入被拒绝（温度低于饱和温度）", () => {
    expect(() => calculatePipePressure({ ...steamBase, fluid: { kind: "steam", temperatureK: 453.15 - 5 } })).toThrow(/饱和温度/);
  });

  it("干饱和蒸汽允许计算", () => {
    const result = calculatePipePressure({ ...steamBase, fluid: { kind: "steam", temperatureK: 453.03 + 0.05 } });
    expect(result.propertyNote).toContain("蒸汽");
  });
});

describe("管道：DOM 事件链与本地存储", () => {
  function setupRuntime() {
    const store = new Map<string, unknown>();
    const storage: ToolStorage = {
      read<T>(key: string, fallback: T): T { return (store.has(key) ? store.get(key) : fallback) as T; },
      write<T>(key: string, value: T): boolean { store.set(key, value); return true; },
    };
    const runtime: ToolRuntime = { storage, feedback: () => undefined, copyText: async () => undefined, downloadText: () => undefined };
    return { store, runtime };
  }

  it("切换流体类型会切换字段可见性，水模式自动计算并显示 IF97 物性", () => {
    const { runtime } = setupRuntime();
    document.body.innerHTML = renderPipePressure(runtime.storage);
    bindPipePressure(runtime);

    const kindSelect = document.querySelector<HTMLSelectElement>("#pipe-fluid-kind")!;
    kindSelect.value = "water";
    kindSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector<HTMLElement>("#pipe-density")!.closest("label")!.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector<HTMLElement>("#pipe-temperature")!.closest("label")!.hasAttribute("hidden")).toBe(false);

    document.querySelector<HTMLInputElement>("#pipe-diameter")!.value = "50";
    document.querySelector<HTMLInputElement>("#pipe-length")!.value = "100";
    document.querySelector<HTMLInputElement>("#pipe-flow-value")!.value = "10";
    document.querySelector<HTMLInputElement>("#pipe-temperature")!.value = "20";
    document.querySelector<HTMLInputElement>("#pipe-inlet-pressure")!.value = "200";
    document.querySelector<HTMLInputElement>("#pipe-sum-k")!.value = "0";
    document.querySelector<HTMLButtonElement>("#pipe-calculate")!.click();

    const output = document.querySelector<HTMLElement>("#pipe-output")!;
    expect(output.textContent).toContain("IF97");
    expect(output.textContent).toContain("出口绝对压力");
    expect(output.textContent).toContain("998");
  });

  it("恢复默认值后 localStorage 与表单一致，流体类型回到自定义", () => {
    const { store, runtime } = setupRuntime();
    document.body.innerHTML = renderPipePressure(runtime.storage);
    bindPipePressure(runtime);

    const kindSelect = document.querySelector<HTMLSelectElement>("#pipe-fluid-kind")!;
    kindSelect.value = "steam";
    kindSelect.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#pipe-reset")!.click();

    expect(document.querySelector<HTMLSelectElement>("#pipe-fluid-kind")!.value).toBe("custom");
    expect(document.querySelector<HTMLSelectElement>("#pipe-flow-basis")!.value).toBe("volume");
    expect(store.get("workbench:pipe-pressure-drop")).toEqual(DEFAULT_PIPE_FORM);
    expect(document.querySelector<HTMLElement>("#pipe-output")!.textContent).toContain("计算结果将显示在这里");
  });

  it("结果包含中文单位标签与适用边界说明", () => {
    const result = calculatePipePressure(baseline);
    const html = renderPipePressureResult(result);
    ["体积流量", "质量流量", "kg/m³", "mPa·s", "直管压降", "局部压降", "总压降", "压头损失", "适用范围"].forEach((text) => expect(html).toContain(text));
  });
});
