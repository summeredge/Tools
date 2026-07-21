import { describe, expect, it } from "vitest";
import {
  airViscositySutherland,
  classifySteam,
  classifyWater,
  gasDensity,
  If97AdapterError,
  saturationProperties,
  saturationTemperature,
  solvePH,
  solvePT,
} from "../src/tools/shared/if97-adapter";

describe("IF97 适配层：IAPWS 官方校验点", () => {
  // IAPWS R7-97(2012) 表 5 / 补充释放的数值校验点
  it("Region 1：p=3 MPa, T=300 K", () => {
    const state = solvePT(3, 300);
    expect(state.region).toBe(1);
    expect(1 / state.densityKgM3).toBeCloseTo(0.100215168e-2, 8);
    expect(state.enthalpyKjKg).toBeCloseTo(0.115331273e3, 6);
  });

  it("Region 2：p=0.0035 MPa, T=300 K", () => {
    const state = solvePT(0.0035, 300);
    expect(state.region).toBe(2);
    expect(1 / state.densityKgM3).toBeCloseTo(0.394913866e2, 6);
    expect(state.enthalpyKjKg).toBeCloseTo(0.254991145e4, 5);
  });

  it("Region 1 饱和侧：0.1 MPa 饱和液焓约 417.5 kJ/kg", () => {
    const { liquid, vapor, temperatureK } = saturationProperties(0.1);
    expect(temperatureK).toBeCloseTo(372.7559, 3);
    expect(liquid.enthalpyKjKg).toBeCloseTo(417.5, 0);
    expect(vapor.enthalpyKjKg).toBeCloseTo(2675.0, 0);
    expect(liquid.densityKgM3).toBeCloseTo(958.35, 0);
    expect(vapor.densityKgM3).toBeCloseTo(0.5903, 3);
  });

  it("10 bar(a)、300°C 过热蒸汽：焓约 3051.7 kJ/kg", () => {
    const state = solvePT(1, 573.15);
    expect(state.region).toBe(2);
    expect(state.enthalpyKjKg).toBeCloseTo(3051.7, 0);
    expect(state.densityKgM3).toBeCloseTo(3.876, 2);
  });
});

describe("IF97 适配层：相态判断", () => {
  it("水在 20°C、常压为单相液体，密度与黏度符合手册值", () => {
    const result = classifyWater(0.101325, 293.15);
    expect(result.phase).toBe("compressed-liquid");
    expect(result.state.densityKgM3).toBeCloseTo(998.2, 1);
    expect(result.state.viscosityPas!).toBeCloseTo(0.0010016, 6);
  });

  it("温度低于饱和温度的蒸汽输入判为湿/液侧，高于饱和温度为过热", () => {
    const tsat = saturationTemperature(1);
    expect(tsat).toBeCloseTo(453.03, 1);
    expect(classifySteam(1, tsat - 1).phase).toBe("wet");
    expect(classifySteam(1, tsat + 0.01).phase).toBe("sat-vapor");
    expect(classifySteam(1, tsat + 40).phase).toBe("superheated");
  });

  it("超出 IF97 范围的压力给出中文错误", () => {
    expect(() => saturationTemperature(30)).toThrow(If97AdapterError);
    expect(() => solvePT(0, 300)).toThrow(If97AdapterError);
  });
});

describe("IF97 适配层：P-h 反算", () => {
  it("过热区反算：P=1 MPa, h=3051.7 kJ/kg → T≈573.15 K", () => {
    const result = solvePH(1, 3051.7031855840214);
    expect(result.phase).toBe("superheated");
    expect(result.temperatureK).toBeCloseTo(573.15, 2);
    expect(result.state!.densityKgM3).toBeCloseTo(3.876, 2);
  });

  it("两相区反算：h 位于 hf 与 hg 之间时返回干度", () => {
    const { liquid, vapor, temperatureK } = saturationProperties(0.5);
    const quality = 0.9;
    const h = liquid.enthalpyKjKg + quality * (vapor.enthalpyKjKg - liquid.enthalpyKjKg);
    const result = solvePH(0.5, h);
    expect(result.phase).toBe("wet");
    expect(result.quality!).toBeCloseTo(quality, 6);
    expect(result.temperatureK).toBeCloseTo(temperatureK, 6);
  });

  it("过冷区反算与 PT 正算互逆", () => {
    const forward = solvePT(2, 400);
    const back = solvePH(2, forward.enthalpyKjKg);
    expect(back.phase).toBe("sat-liquid");
    expect(back.temperatureK).toBeCloseTo(400, 2);
  });
});

describe("IF97 适配层：气体辅助公式", () => {
  it("Sutherland 空气黏度：20°C 约 1.81e-5 Pa·s", () => {
    expect(airViscositySutherland(293.15)).toBeCloseTo(1.81e-5, 7);
  });

  it("理想气体密度：101325 Pa、273.15 K、Z=1 时约 1.293 kg/m³", () => {
    expect(gasDensity(101325, 273.15, 28.9647, 1)).toBeCloseTo(1.2923, 4);
  });
});
