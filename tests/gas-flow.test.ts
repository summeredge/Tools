import { describe, expect, it } from "vitest";
import { calculateGasFlow, GasFlowError, type GasFlowInput } from "../src/tools/gas-flow/logic";

const baseline: GasFlowInput = {
  flowM3s: 100 / 3600,
  flowBasis: "actual",
  actualTemperatureK: 373.15,
  actualPressurePa: 200000,
  standardTemperatureK: 273.15,
  standardPressurePa: 101325,
  zActual: 1,
  zStandard: 1,
  molecularWeightKgPerKmol: 28.97,
  moistureConversion: "none",
};

describe("气体工况/标况换算", () => {
  it("按状态方程完成基准换算", () => {
    const result = calculateGasFlow(baseline);
    expect(result.standardFlowM3s * 3600).toBeCloseTo(144.4877879, 5);
    expect(result.actualPressurePa).toBe(200000);
    expect(result.standardTemperatureK).toBe(273.15);
    expect(result.massFlowKgH).toBeGreaterThan(0);
  });

  it("拒绝非正温压和无效含水率", () => {
    expect(() => calculateGasFlow({ ...baseline, actualTemperatureK: 0 })).toThrow(GasFlowError);
    expect(() => calculateGasFlow({ ...baseline, moistureConversion: "wet-to-dry", moistureFraction: 1.1 })).toThrow(GasFlowError);
    expect(() => calculateGasFlow({ ...baseline, moistureConversion: "dry-to-wet", moistureFraction: 1 })).toThrow(GasFlowError);
  });
});
