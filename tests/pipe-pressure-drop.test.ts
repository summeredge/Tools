import { describe, expect, it } from "vitest";
import { calculatePipePressure, PipePressureError, type PipePressureInput } from "../src/tools/pipe-pressure-drop/logic";

const baseline: PipePressureInput = {
  flowM3s: Math.PI * 0.01 ** 2 / 4 * 0.1,
  diameterM: 0.01,
  lengthM: 10,
  densityKgM3: 1000,
  viscosityPas: 0.001,
  roughnessM: 0,
  sumK: 2,
};

describe("管道流速与压降", () => {
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
