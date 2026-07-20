import { describe, expect, it } from "vitest";
import { calculateTank, generateTankTable, TankVolumeError } from "../src/tools/tank-volume/logic";

describe("储罐液位—体积换算", () => {
  it("通过三种几何形状的基准算例", () => {
    const vertical = calculateTank({ geometry: "vertical-cylinder", diameterM: 2, heightOrLengthM: 5, mode: "level", value: 2 });
    const horizontal = calculateTank({ geometry: "horizontal-cylinder", diameterM: 2, heightOrLengthM: 4, mode: "level", value: 1 });
    const sphere = calculateTank({ geometry: "sphere", diameterM: 2, heightOrLengthM: 0, mode: "level", value: 1 });
    expect(vertical.volumeM3).toBeCloseTo(6.283185307, 7);
    expect(vertical.fillFraction).toBeCloseTo(0.4, 8);
    expect(horizontal.volumeM3).toBeCloseTo(6.283185307, 7);
    expect(horizontal.fillFraction).toBeCloseTo(0.5, 8);
    expect(sphere.volumeM3).toBeCloseTo(2.094395102, 7);
    expect(sphere.fillFraction).toBeCloseTo(0.5, 8);
  });

  it("体积和装填率反算液位并生成完整对照表", () => {
    const input = { geometry: "horizontal-cylinder" as const, diameterM: 2, heightOrLengthM: 4 };
    const fromVolume = calculateTank({ ...input, mode: "volume", value: Math.PI * 2 });
    const fromFill = calculateTank({ ...input, mode: "fill", value: 0.5 });
    expect(fromVolume.levelM).toBeCloseTo(1, 7);
    expect(fromFill.levelM).toBeCloseTo(1, 7);
    expect(generateTankTable(input, 5)).toHaveLength(21);
  });

  it("拒绝越界液位和体积", () => {
    expect(() => calculateTank({ geometry: "vertical-cylinder", diameterM: 2, heightOrLengthM: 5, mode: "level", value: 6 })).toThrow(TankVolumeError);
    expect(() => calculateTank({ geometry: "sphere", diameterM: 2, heightOrLengthM: 0, mode: "fill", value: 1.1 })).toThrow(TankVolumeError);
  });
});
