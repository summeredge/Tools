import { describe, expect, it } from "vitest";
import { calculateHeatExchanger, HeatExchangerError, type HeatExchangerInput } from "../src/tools/heat-exchanger/logic";

const baseline: HeatExchangerInput = {
  mode: "sensible",
  pattern: "counter",
  correctionFactor: 1,
  hot: { massFlowKgs: 1000 / 3600, cpJPerKgK: 4200, inletTemperatureK: 373.15, outletTemperatureK: 353.15 },
  cold: { massFlowKgs: 800 / 3600, cpJPerKgK: 4200, inletTemperatureK: 293.15, outletTemperatureK: 318.15 },
};

describe("换热器热量平衡与 LMTD", () => {
  it("通过逆流显热基准算例", () => {
    const result = calculateHeatExchanger(baseline);
    expect(result.hotLoadKw).toBeCloseTo(23.3333333, 6);
    expect(result.coldLoadKw).toBeCloseTo(23.3333333, 6);
    expect(result.heatImbalancePercent).toBeCloseTo(0, 8);
    expect(result.lmtdK).toBeCloseTo(57.4637, 4);
    expect(result.uaKwPerK).toBeCloseTo(0.40605, 5);
  });

  it("等温差直接使用该温差，并拒绝无效 F", () => {
    const result = calculateHeatExchanger({ ...baseline, hot: { ...baseline.hot, outletTemperatureK: 343.15 }, cold: { ...baseline.cold, outletTemperatureK: 323.15 } });
    expect(result.deltaT1K).toBeCloseTo(50, 8);
    expect(result.deltaT2K).toBeCloseTo(50, 8);
    expect(result.lmtdK).toBeCloseTo(50, 8);
    expect(() => calculateHeatExchanger({ ...baseline, correctionFactor: 0 })).toThrow(HeatExchangerError);
  });

  it("温度交叉时不计算 LMTD", () => {
    const result = calculateHeatExchanger({ ...baseline, cold: { ...baseline.cold, outletTemperatureK: 383.15 } });
    expect(result.lmtdK).toBeNull();
    expect(result.lmtdReason).toContain("温度交叉");
  });

  it("任务书基准：两侧热负荷均约 23.333 kW、逆流 LMTD 约 57.464 K、UA 约 0.4061 kW/K", () => {
    const result = calculateHeatExchanger(baseline);
    expect(result.hotLoadKw!).toBeCloseTo(23.333, 3);
    expect(result.coldLoadKw!).toBeCloseTo(23.333, 3);
    expect(result.lmtdK!).toBeCloseTo(57.464, 3);
    expect(result.uaKwPerK!).toBeCloseTo(0.4061, 4);
  });

  it("热侧出口高于入口时不计算 LMTD 并给出中文提示", () => {
    const result = calculateHeatExchanger({ ...baseline, hot: { ...baseline.hot, outletTemperatureK: 393.15 } });
    expect(result.lmtdK).toBeNull();
    expect(result.uaKwPerK).toBeNull();
    expect(result.lmtdReason).toContain("热侧出口温度高于入口温度");
  });

  it("冷侧出口低于入口时不计算 LMTD 并给出中文提示", () => {
    const result = calculateHeatExchanger({ ...baseline, cold: { ...baseline.cold, outletTemperatureK: 283.15 } });
    expect(result.lmtdK).toBeNull();
    expect(result.lmtdReason).toContain("冷侧出口温度低于入口温度");
  });

  it("两端温差近似相等时数值稳定（LMTD 退化为算术值）", () => {
    const result = calculateHeatExchanger({
      ...baseline,
      hot: { ...baseline.hot, outletTemperatureK: 343.15 + 1e-13 },
      cold: { ...baseline.cold, outletTemperatureK: 323.15 },
    });
    expect(result.lmtdK).not.toBeNull();
    expect(result.lmtdK!).toBeCloseTo(50, 6);
    expect(Number.isFinite(result.lmtdK!)).toBe(true);
  });

  it("并流模式使用热入-冷入与热出-冷出温差", () => {
    const result = calculateHeatExchanger({ ...baseline, pattern: "parallel" });
    expect(result.deltaT1K).toBeCloseTo(80, 8);   // 100 - 20
    expect(result.deltaT2K).toBeCloseTo(35, 8);   // 80 - 45
    expect(result.lmtdK!).toBeCloseTo((80 - 35) / Math.log(80 / 35), 6);
  });

  it("显热模式与焓差模式结果一致（同一工况用 Cp 折算焓）", () => {
    const sensible = calculateHeatExchanger(baseline);
    const cp = 4200;
    const enthalpy = calculateHeatExchanger({
      mode: "enthalpy",
      pattern: "counter",
      correctionFactor: 1,
      hot: { massFlowKgs: 1000 / 3600, inletEnthalpyJPerKg: 373.15 * cp, outletEnthalpyJPerKg: 353.15 * cp, inletTemperatureK: 373.15, outletTemperatureK: 353.15 },
      cold: { massFlowKgs: 800 / 3600, inletEnthalpyJPerKg: 293.15 * cp, outletEnthalpyJPerKg: 318.15 * cp, inletTemperatureK: 293.15, outletTemperatureK: 318.15 },
    });
    expect(enthalpy.hotLoadKw!).toBeCloseTo(sensible.hotLoadKw!, 8);
    expect(enthalpy.coldLoadKw!).toBeCloseTo(sensible.coldLoadKw!, 8);
    expect(enthalpy.lmtdK!).toBeCloseTo(sensible.lmtdK!, 8);
    expect(enthalpy.uaKwPerK!).toBeCloseTo(sensible.uaKwPerK!, 8);
  });

  it("热量不平衡按两侧平均负荷为口径计算", () => {
    const result = calculateHeatExchanger({ ...baseline, cold: { ...baseline.cold, massFlowKgs: 600 / 3600 } });
    // 热 23.333，冷 17.5；平均 20.417；不平衡 |23.333−17.5|/20.417 ≈ 28.6%
    expect(result.heatImbalancePercent!).toBeCloseTo((23.3333 - 17.5) / ((23.3333 + 17.5) / 2) * 100, 1);
    expect(result.warnings.some((warning) => warning.includes("热量不平衡"))).toBe(true);
  });

  it("UA 使用与热负荷一致的单位口径（UA = Q基准 / (F × LMTD)）", () => {
    const result = calculateHeatExchanger({ ...baseline, correctionFactor: 0.9 });
    expect(result.uaKwPerK!).toBeCloseTo(result.heatLoadBasisKw! / (0.9 * result.lmtdK!), 8);
  });

  it("两侧数据均不完整时拒绝计算", () => {
    expect(() => calculateHeatExchanger({ mode: "sensible", pattern: "counter", correctionFactor: 1, hot: {}, cold: {} })).toThrow(HeatExchangerError);
  });
});
