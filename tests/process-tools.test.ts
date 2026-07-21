import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertGasFlowDisplayValue, convertGasPressureDisplayValue, convertGasTemperatureDisplayValue } from "../src/tools/gas-flow/bind";
import { calculateGasFlow } from "../src/tools/gas-flow/logic";
import { renderGasFlowResult } from "../src/tools/gas-flow/view";
import { calculateHeatExchanger } from "../src/tools/heat-exchanger/logic";
import { renderHeatExchangerResult } from "../src/tools/heat-exchanger/view";
import { convertPipeFlowBasisDisplayValue } from "../src/tools/pipe-pressure-drop/bind";
import { calculatePipePressure } from "../src/tools/pipe-pressure-drop/logic";
import { renderPipePressureResult } from "../src/tools/pipe-pressure-drop/view";
import { processToolModules } from "../src/tools/registry";
import { calculateTank, convertTankDisplayValue, generateTankTable } from "../src/tools/tank-volume/logic";
import { renderTankResult } from "../src/tools/tank-volume/view";
import type { ToolStorage } from "../src/tools/runtime";

const storage: ToolStorage = { read<T>(_key: string, fallback: T): T { return fallback; }, write<T>(_key: string, _value: T): boolean { return true; } };

describe("过程工程统一模块接口", () => {
  it("四个工具均通过 metadata、render、bind 接入注册表", () => {
    expect(processToolModules.map((module) => module.id)).toEqual(["gas-flow", "pipe-pressure-drop", "tank-volume", "heat-exchanger"]);
    processToolModules.forEach((module) => { expect(module.name).toBeTruthy(); expect(typeof module.render).toBe("function"); expect(typeof module.bind).toBe("function"); });
  });

  it("主入口通过注册表分发，未保留四个工具的独立分支", () => {
    const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(mainSource).toContain("processToolModules.find");
    ["gas-flow", "pipe-pressure-drop", "tank-volume", "heat-exchanger"].forEach((id) => expect(mainSource).not.toContain(`id === "${id}"`));
  });

  it("专业分类与旧功能索引保持可筛选、可搜索的元数据", () => {
    const categories = new Map(processToolModules.map((module) => [module.id, module.category]));
    expect(categories.get("gas-flow")).toBe("热力与物性");
    expect(categories.get("pipe-pressure-drop")).toBe("流体与管道");
    expect(categories.get("heat-exchanger")).toBe("换热与能源");
    expect(categories.get("tank-volume")).toBe("储罐与设备");
    processToolModules.forEach((module) => expect(module.keywords.length).toBeGreaterThan(0));
    const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
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
});
