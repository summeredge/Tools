/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertGasFlowDisplayValue, convertGasPressureDisplayValue, convertGasTemperatureDisplayValue } from "../src/tools/gas-flow/bind";
import { calculateGasFlow } from "../src/tools/gas-flow/logic";
import { renderGasFlowResult } from "../src/tools/gas-flow/view";
import { calculateHeatExchanger } from "../src/tools/heat-exchanger/logic";
import { bindHeatExchanger } from "../src/tools/heat-exchanger/bind";
import { convertHeatLoadDisplayValue, renderHeatExchanger, renderHeatExchangerResult } from "../src/tools/heat-exchanger/view";
import { convertPipeFlowBasisDisplayValue, convertPipeFlowDisplayValue } from "../src/tools/pipe-pressure-drop/bind";
import { calculatePipePressure } from "../src/tools/pipe-pressure-drop/logic";
import { renderPipePressureResult } from "../src/tools/pipe-pressure-drop/view";
import { processToolModules } from "../src/tools/registry";
import { calculateTank, convertTankDisplayValue, generateTankTable } from "../src/tools/tank-volume/logic";
import { renderTankResult } from "../src/tools/tank-volume/view";
import type { ToolRuntime, ToolStorage } from "../src/tools/runtime";

const storage: ToolStorage = { read<T>(_key: string, fallback: T): T { return fallback; }, write<T>(_key: string, _value: T): boolean { return true; } };

describe("过程工程统一模块接口", () => {
  it("过程工具均通过 metadata、render、bind 接入注册表", () => {
    expect(processToolModules.map((module) => module.id)).toEqual(["gas-flow", "pipe-pressure-drop", "tank-volume", "heat-exchanger", "control-valve-sizing", "steam-prds"]);
    const ids = processToolModules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    processToolModules.forEach((module) => { expect(module.name).toBeTruthy(); expect(module.description).toBeTruthy(); expect(module.category).toBeTruthy(); expect(module.mark).toBeTruthy(); expect(module.keywords.length).toBeGreaterThan(0); expect(typeof module.render).toBe("function"); expect(typeof module.bind).toBe("function"); });
  });

  it("主入口通过注册表分发，未保留四个工具的独立分支", () => {
    const mainSource = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(mainSource).toContain("processToolModules.find");
    expect(mainSource).toContain("...processToolModules");
    ["气体工况/标况换算", "管道流速与压降", "储罐液位—体积换算", "换热器热量平衡与 LMTD", "控制阀 Cv/Kv 初步选型", "蒸汽减压与喷水减温"].forEach((name) => expect(mainSource).not.toContain(`name: "${name}"`));
    ["gas-flow", "pipe-pressure-drop", "tank-volume", "heat-exchanger", "control-valve-sizing", "steam-prds"].forEach((id) => expect(mainSource).not.toContain(`id === "${id}"`));
  });

  it("专业分类与旧功能索引保持可筛选、可搜索的元数据", () => {
    const categories = new Map(processToolModules.map((module) => [module.id, module.category]));
    expect(categories.get("gas-flow")).toBe("热力与物性");
    expect(categories.get("pipe-pressure-drop")).toBe("流体与管道");
    expect(categories.get("heat-exchanger")).toBe("换热与能源");
    expect(categories.get("tank-volume")).toBe("储罐与设备");
    expect(categories.get("control-valve-sizing")).toBe("流体与管道");
    expect(categories.get("steam-prds")).toBe("换热与能源");
    processToolModules.forEach((module) => expect(module.keywords.length).toBeGreaterThan(0));
    const mainSource = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(mainSource).toContain("favoriteIds.has(tool.id)");
    expect(mainSource).toContain("recentIds.includes(tool.id)");
    expect(mainSource).toContain("haystack.includes(query)");
  });
});

describe("工程单位和提示", () => {
  it("单位切换会换算当前显示值，而不是只改变标签", () => {
    expect(convertGasFlowDisplayValue(100, "m3/h", "L/min")).toBeCloseTo(1666.6666667, 6);
    expect(convertGasTemperatureDisplayValue(100, "C", "K")).toBeCloseTo(373.15, 8);
    expect(convertGasPressureDisplayValue(200, "kPa", "bar")).toBeCloseTo(2, 8);
    expect(convertPipeFlowBasisDisplayValue(0.0282743, 1000, "volume", "mass")).toBeCloseTo(28.2743, 7);
    expect(convertPipeFlowDisplayValue(1000, 1000, "m3/h", "L/min")).toBeCloseTo(16666.6666667, 6);
    expect(convertTankDisplayValue({ geometry: "vertical-cylinder", diameterM: 2, heightOrLengthM: 5, mode: "level", value: 2 }, "volume")).toBeCloseTo(6.283185307, 7);
    expect(convertTankDisplayValue({ geometry: "vertical-cylinder", diameterM: 2, heightOrLengthM: 5, mode: "level", value: 2 }, "fill")).toBeCloseTo(40, 8);
  });

  it("四个工具的输入和结果均显示单位及公共工程复核提示", () => {
    const gas = calculateGasFlow({ flowM3s: 100 / 3600, flowBasis: "actual", actualTemperatureK: 373.15, actualPressurePa: 200000, standardTemperatureK: 273.15, standardPressurePa: 101325, zActual: 1, zStandard: 1, moistureConversion: "none" });
    const pipe = calculatePipePressure({ flowM3s: Math.PI * 0.01 ** 2 / 4 * 0.1, diameterM: 0.01, lengthM: 10, densityKgM3: 1000, viscosityPas: 0.001, roughnessM: 0, sumK: 2 });
    const tank = calculateTank({ geometry: "vertical-cylinder", diameterM: 2, heightOrLengthM: 5, mode: "level", value: 2 });
    const heat = calculateHeatExchanger({ mode: "sensible", pattern: "counter", correctionFactor: 1, hot: { massFlowKgs: 1000 / 3600, cpJPerKgK: 4200, inletTemperatureK: 373.15, outletTemperatureK: 353.15 }, cold: { massFlowKgs: 800 / 3600, cpJPerKgK: 4200, inletTemperatureK: 293.15, outletTemperatureK: 318.15 } });
    const html = [
      processToolModules[0]!.render(storage),
      processToolModules[1]!.render(storage),
      processToolModules[2]!.render(storage),
      processToolModules[3]!.render(storage),
      renderGasFlowResult(gas), renderPipePressureResult(pipe), renderTankResult(tank, generateTankTable({ geometry: tank.geometry, diameterM: 2, heightOrLengthM: 5 }, 5)), renderHeatExchangerResult(heat),
    ].join("\n");
    ["计算假设", "适用范围", "主要限制", "工程复核提示", "正式设计、选型或安全判断"].forEach((text) => expect(html).toContain(text));
    ["m³/h", "kPa", "kg/m³", "mPa·s", "m³", "kg/h", "kJ/(kg·K)", "kW/K"].forEach((unit) => expect(html).toContain(unit));
  });

  it("气体、管道和换热器的单位切换保持同一内部计算结果", () => {
    const gasBase = { flowBasis: "actual" as const, actualTemperatureK: 373.15, actualPressurePa: 200000, standardTemperatureK: 273.15, standardPressurePa: 101325, zActual: 1, zStandard: 1, moistureConversion: "none" as const };
    const gasM3h = calculateGasFlow({ flowM3s: 1000 / 3600, ...gasBase });
    const gasLMin = calculateGasFlow({ flowM3s: convertGasFlowDisplayValue(1000, "m3/h", "L/min") * 1e-3 / 60, ...gasBase });
    expect(gasLMin.standardFlowM3s).toBeCloseTo(gasM3h.standardFlowM3s, 10);

    const pipeBase = { diameterM: 0.01, lengthM: 10, densityKgM3: 1000, viscosityPas: 0.001, roughnessM: 0.0000015, sumK: 2 };
    const pipeM3h = calculatePipePressure({ flowM3s: 1000 / 3600, ...pipeBase });
    const pipeLMin = calculatePipePressure({ flowM3s: convertPipeFlowDisplayValue(1000, 1000, "m3/h", "L/min") * 1e-3 / 60, ...pipeBase });
    expect(pipeLMin.totalDropPa).toBeCloseTo(pipeM3h.totalDropPa, 10);

    const heat = calculateHeatExchanger({ mode: "sensible", pattern: "counter", correctionFactor: 1, hot: { massFlowKgs: 1000 / 3600, cpJPerKgK: 4200, inletTemperatureK: 373.15, outletTemperatureK: 353.15 }, cold: { massFlowKgs: 800 / 3600, cpJPerKgK: 4200, inletTemperatureK: 293.15, outletTemperatureK: 318.15 } });
    const heatKw = convertHeatLoadDisplayValue(heat.hotLoadKw!, "kW");
    const heatMw = convertHeatLoadDisplayValue(heat.hotLoadKw!, "MW");
    expect(heatMw * 1000).toBeCloseTo(heatKw, 10);
    expect(renderHeatExchangerResult(heat, "MW")).toContain("MW");
  });

  it("换热器真实事件链保持 MW，并同步显示 MW/K 与复制结果", async () => {
    document.body.innerHTML = renderHeatExchanger(storage);
    const copiedResults: string[] = [];
    const runtime: ToolRuntime = {
      storage,
      feedback: () => undefined,
      copyText: async (value) => { copiedResults.push(value); },
      downloadText: () => undefined,
    };
    const output = document.querySelector<HTMLElement>("#hx-output")!;
    Object.defineProperty(output, "innerText", { configurable: true, get: () => output.textContent ?? "" });
    bindHeatExchanger(runtime);

    document.querySelector<HTMLButtonElement>("#hx-calculate")!.click();
    const unit = document.querySelector<HTMLSelectElement>("#hx-load-unit")!;
    unit.value = "MW";
    unit.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLSelectElement>("#hx-load-unit")?.value).toBe("MW");
    expect(output.textContent).toContain("MW/K");
    expect(output.textContent).not.toContain("kW/K");

    const hotOutlet = document.querySelector<HTMLInputElement>("#hx-hot-out")!;
    hotOutlet.value = "79";
    hotOutlet.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLSelectElement>("#hx-load-unit")?.value).toBe("MW");
    expect(output.textContent).toContain("MW/K");
    expect(output.textContent).not.toContain("kW/K");

    document.querySelector<HTMLButtonElement>("[data-copy-result]")!.click();
    await Promise.resolve();
    expect(copiedResults[0]).toContain("MW");
    expect(copiedResults[0]).toContain("MW/K");
    expect(copiedResults[0]).not.toContain("kW/K");
  });
});
