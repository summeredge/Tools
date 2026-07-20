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
});
