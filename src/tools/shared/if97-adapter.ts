// IF97 统一工程适配层：为过程工具提供中文相态判断、饱和性质与 P-h 反算。
// 数值实现全部来自 ./if97-vendor（iapws-if97 v2.1.5，MIT），项目内不允许第二套系数。
import if97 from "./if97-vendor";

export type If97Region = 1 | 2 | 3 | 4 | 5;

export type If97RawState = {
  region: If97Region;
  pressure: number;
  temperature: number;
  specificVolume: number;
  internalEnergy: number;
  entropy: number;
  enthalpy: number;
  cp: number | null;
  cv: number | null;
  speedOfSound: number | null;
  quality: number | null;
  isobaricExpansion: number | null;
  isothermalCompressibility: number | null;
  density: number;
  viscosity: number | null;
  thermalConductivity: number | null;
  surfaceTension: number | null;
  dielectricConstant: number | null;
  ionizationConstant: number | null;
};

export type If97SteamPhase = "sat-liquid" | "wet" | "sat-vapor" | "superheated" | "supercritical";
export type If97WaterPhase = "compressed-liquid" | "sat-liquid" | "wet" | "vapor" | "supercritical";

export type If97State = {
  pressureMpa: number;
  temperatureK: number;
  densityKgM3: number;
  enthalpyKjKg: number;
  entropyKjKgK: number;
  internalEnergyKjKg: number;
  cpKjKgK: number | null;
  cvKjKgK: number | null;
  speedOfSoundMs: number | null;
  viscosityPas: number | null;
  region: If97Region;
};

export type If97SteamState = If97State & { phase: If97SteamPhase; quality: number | null; saturationTemperatureK: number | null };
export type If97SaturationProperties = { temperatureK: number; liquid: If97State; vapor: If97State };
export type If97PhState = { phase: If97SteamPhase; temperatureK: number; quality: number | null; state: If97State | null; saturationTemperatureK: number };

export class If97AdapterError extends Error {}

const vendor = if97 as unknown as {
  solvePT: (pressureMpa: number, temperatureK: number) => If97RawState;
  saturationTemperatureK: (pressureMpa: number) => number;
  saturationPressureMpa: (temperatureK: number) => number;
  constants: { criticalPressureMpa: number; criticalTemperatureK: number; triplePressureMpa: number };
};

/** 饱和线附近的容差：比饱和温度高该值即视为过热蒸汽，低该值即视为液体。 */
export const IF97_SATURATION_TOLERANCE_K = 0.02;

function ensureFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new If97AdapterError(`${label}必须是有限数值。`);
}

function toState(raw: If97RawState): If97State {
  return {
    pressureMpa: raw.pressure,
    temperatureK: raw.temperature,
    densityKgM3: raw.density,
    enthalpyKjKg: raw.enthalpy,
    entropyKjKgK: raw.entropy,
    internalEnergyKjKg: raw.internalEnergy,
    cpKjKgK: raw.cp,
    cvKjKgK: raw.cv,
    speedOfSoundMs: raw.speedOfSound,
    viscosityPas: raw.viscosity,
    region: raw.region,
  };
}

function isFiniteState(state: If97State): boolean {
  return Number.isFinite(state.densityKgM3) && state.densityKgM3 > 0 && Number.isFinite(state.enthalpyKjKg) && state.viscosityPas !== null && Number.isFinite(state.viscosityPas) && state.viscosityPas > 0;
}

/** IF97 范围内求解（P, T）。压力单位 MPa（绝压），温度单位 K。失败时抛出 If97AdapterError。 */
export function solvePT(pressureMpa: number, temperatureK: number): If97State {
  ensureFinite(pressureMpa, "绝对压力");
  ensureFinite(temperatureK, "温度");
  if (pressureMpa <= 0) throw new If97AdapterError("绝对压力必须大于 0。");
  try {
    return toState(vendor.solvePT(pressureMpa, temperatureK));
  } catch (error) {
    throw new If97AdapterError(`IF97 求解失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 给定绝对压力（MPa）返回饱和温度（K）；超出三相点—临界点范围时抛错。 */
export function saturationTemperature(pressureMpa: number): number {
  ensureFinite(pressureMpa, "绝对压力");
  const { triplePressureMpa, criticalPressureMpa } = vendor.constants;
  if (pressureMpa < triplePressureMpa || pressureMpa > criticalPressureMpa) {
    throw new If97AdapterError(`压力 ${pressureMpa} MPa 超出常规液-汽饱和范围（${triplePressureMpa}～${criticalPressureMpa} MPa）。`);
  }
  try {
    return vendor.saturationTemperatureK(pressureMpa);
  } catch (error) {
    throw new If97AdapterError(`IF97 饱和温度求解失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 给定绝对压力返回饱和液与饱和蒸汽性质。
 * 通过饱和线两侧的单相求解获得，与 IF97 补充释放的 Region 4 方程一致。
 */
export function saturationProperties(pressureMpa: number): If97SaturationProperties {
  const temperatureK = saturationTemperature(pressureMpa);
  const liquid = solvePT(pressureMpa, temperatureK - IF97_SATURATION_TOLERANCE_K);
  const vapor = solvePT(pressureMpa, temperatureK + IF97_SATURATION_TOLERANCE_K);
  if (!isFiniteState(liquid) || !isFiniteState(vapor)) {
    throw new If97AdapterError("IF97 饱和性质求解结果不完整，请检查压力是否接近临界区。");
  }
  return { temperatureK, liquid, vapor };
}

/** 水工具相态判断：只接受单相液体。 */
export function classifyWater(pressureMpa: number, temperatureK: number): { phase: If97WaterPhase; state: If97State; saturationTemperatureK: number | null } {
  const state = solvePT(pressureMpa, temperatureK);
  const { criticalPressureMpa, criticalTemperatureK, triplePressureMpa } = vendor.constants;
  if (state.region === 3) {
    return { phase: "supercritical", state, saturationTemperatureK: null };
  }
  if (pressureMpa > criticalPressureMpa || temperatureK > criticalTemperatureK) {
    return { phase: "supercritical", state, saturationTemperatureK: null };
  }
  if (pressureMpa < triplePressureMpa) {
    return { phase: state.region === 1 ? "compressed-liquid" : "vapor", state, saturationTemperatureK: null };
  }
  const tsat = saturationTemperature(pressureMpa);
  const delta = temperatureK - tsat;
  if (Math.abs(delta) <= IF97_SATURATION_TOLERANCE_K) return { phase: "sat-liquid", state, saturationTemperatureK: tsat };
  if (delta < 0) return { phase: "compressed-liquid", state, saturationTemperatureK: tsat };
  return { phase: state.region === 1 ? "compressed-liquid" : "vapor", state, saturationTemperatureK: tsat };
}

/** 蒸汽工具相态判断：区分干饱和、过热、湿蒸汽与超临界。 */
export function classifySteam(pressureMpa: number, temperatureK: number): If97SteamState {
  const state = solvePT(pressureMpa, temperatureK);
  const { criticalPressureMpa, criticalTemperatureK, triplePressureMpa } = vendor.constants;
  if (state.region === 3 || pressureMpa > criticalPressureMpa || temperatureK > criticalTemperatureK) {
    return { ...state, phase: "supercritical", quality: null, saturationTemperatureK: null };
  }
  if (pressureMpa < triplePressureMpa) {
    return { ...state, phase: "superheated", quality: null, saturationTemperatureK: null };
  }
  const tsat = saturationTemperature(pressureMpa);
  const delta = temperatureK - tsat;
  if (delta < -IF97_SATURATION_TOLERANCE_K) {
    return { ...state, phase: "wet", quality: null, saturationTemperatureK: tsat };
  }
  if (Math.abs(delta) <= IF97_SATURATION_TOLERANCE_K) {
    return { ...state, phase: "sat-vapor", quality: 1, saturationTemperatureK: tsat };
  }
  return { ...state, phase: "superheated", quality: null, saturationTemperatureK: tsat };
}

/**
 * 按（P, h）反算出口状态：先与饱和焓比较区分两相区，再在单相区用割线法反解温度。
 * h 单位 kJ/kg，压力单位 MPa（绝压）。
 */
export function solvePH(pressureMpa: number, enthalpyKjKg: number): If97PhState {
  ensureFinite(enthalpyKjKg, "比焓");
  const { temperatureK: tsat, liquid, vapor } = saturationProperties(pressureMpa);
  const hf = liquid.enthalpyKjKg;
  const hg = vapor.enthalpyKjKg;
  if (enthalpyKjKg >= hf && enthalpyKjKg <= hg) {
    const quality = (enthalpyKjKg - hf) / (hg - hf);
    return { phase: "wet", temperatureK: tsat, quality, state: null, saturationTemperatureK: tsat };
  }

  const { criticalTemperatureK } = vendor.constants;
  let lowK: number;
  let highK: number;
  if (enthalpyKjKg < hf) {
    lowK = 273.16;
    highK = tsat - IF97_SATURATION_TOLERANCE_K;
  } else {
    lowK = tsat + IF97_SATURATION_TOLERANCE_K;
    highK = pressureMpa > 50 ? 1073.15 : 2273.15;
  }
  const hAt = (temperatureK: number): number => solvePT(pressureMpa, temperatureK).enthalpyKjKg;
  let hLow = hAt(lowK);
  let hHigh = hAt(highK);
  if (enthalpyKjKg < hLow || enthalpyKjKg > hHigh) {
    if (enthalpyKjKg < hf && pressureMpa > vendor.constants.criticalPressureMpa && tsat > criticalTemperatureK) {
      throw new If97AdapterError("超临界区的 P-h 反算暂不支持。");
    }
    throw new If97AdapterError(`给定比焓 ${enthalpyKjKg} kJ/kg 超出该压力下 IF97 可反算范围（${hLow.toFixed(2)}～${hHigh.toFixed(2)} kJ/kg）。`);
  }
  let temperatureK = lowK;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    if (Math.abs(hHigh - hLow) < 1e-12) break;
    temperatureK = lowK + (enthalpyKjKg - hLow) * (highK - lowK) / (hHigh - hLow);
    const hMid = hAt(temperatureK);
    if (Math.abs(hMid - enthalpyKjKg) < 1e-9) break;
    if (hMid < enthalpyKjKg) { lowK = temperatureK; hLow = hMid; } else { highK = temperatureK; hHigh = hMid; }
  }
  const state = solvePT(pressureMpa, temperatureK);
  const phase: If97SteamPhase = enthalpyKjKg < hf ? "sat-liquid" : "superheated";
  return { phase, temperatureK, quality: null, state, saturationTemperatureK: tsat };
}

/** 空气动力黏度：Sutherland 公式（白盒、可测试）。T 单位 K，返回 Pa·s。 */
export function airViscositySutherland(temperatureK: number): number {
  ensureFinite(temperatureK, "空气温度");
  if (temperatureK <= 0) throw new If97AdapterError("空气温度必须大于 0 K。");
  const mu0 = 1.716e-5;
  const t0 = 273.15;
  const s = 110.4;
  return mu0 * Math.pow(temperatureK / t0, 1.5) * (t0 + s) / (temperatureK + s);
}

/** 理想/真实气体密度：rho = P·M / (Z·R·T)。P 单位 Pa，M 单位 kg/kmol，R = 8314.462618 J/(kmol·K)。 */
export function gasDensity(pressurePa: number, temperatureK: number, molarMassKgKmol: number, z: number): number {
  ensureFinite(pressurePa, "绝对压力");
  ensureFinite(temperatureK, "温度");
  ensureFinite(molarMassKgKmol, "摩尔质量");
  ensureFinite(z, "压缩因子");
  if (pressurePa <= 0 || temperatureK <= 0 || molarMassKgKmol <= 0 || z <= 0) {
    throw new If97AdapterError("气体密度计算要求压力、温度、摩尔质量和压缩因子均大于 0。");
  }
  return pressurePa * molarMassKgKmol / (z * 8314.462618 * temperatureK);
}
