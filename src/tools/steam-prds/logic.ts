// 蒸汽减压与喷水减温：绝热节流（h2=h1）+ 绝热喷水混合能量平衡。
// 所有压力均为绝对压力；水焓与蒸汽焓均来自同一 IF97 实现。
import { saturationTemperature, solvePH, solvePT, type If97PhState, type If97State } from "../shared/if97-adapter";

export type PrdsMode = "throttle" | "target-temperature" | "fixed-water";

export type PrdsBaseInput = {
  p1Mpa: number;
  t1K: number;
  p2Mpa: number;
};

export type PrdsThrottleInput = PrdsBaseInput & { mode: "throttle" };
export type PrdsTargetInput = PrdsBaseInput & {
  mode: "target-temperature";
  steamFlowKgs: number;
  sprayTemperatureK: number;
  sprayPressureMpa?: number;
  targetTemperatureK?: number;
  targetSuperheatK?: number;
};
export type PrdsFixedWaterInput = PrdsBaseInput & {
  mode: "fixed-water";
  steamFlowKgs: number;
  sprayTemperatureK: number;
  sprayPressureMpa?: number;
  sprayFlowKgs: number;
};
export type PrdsInput = PrdsThrottleInput | PrdsTargetInput | PrdsFixedWaterInput;

export type PrdsPhase = "过冷液体" | "饱和液体" | "两相" | "干饱和蒸汽" | "过热蒸汽";

export type PrdsResult = {
  mode: PrdsMode;
  upstreamEnthalpyKjKg: number;
  upstreamDensityKgM3: number;
  throttledTemperatureK: number | null;
  throttledPhase: PrdsPhase;
  throttledQuality: number | null;
  p2SaturationTemperatureK: number;
  outletTemperatureK: number | null;
  outletSuperheatK: number | null;
  outletPhase: PrdsPhase;
  outletQuality: number | null;
  sprayFlowKgs: number | null;
  waterSteamRatio: number | null;
  totalOutletFlowKgs: number | null;
  energyResidual: number | null;
  warnings: string[];
};

export class PrdsError extends Error {}

const MIN_SUPERHEAT_K = 3;
const SUGGESTED_SUPERHEAT_K = 5;

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new PrdsError(`${label}必须大于 0。`);
}

function checkBase(input: PrdsBaseInput): void {
  requirePositive(input.p1Mpa, "上游绝对压力");
  requirePositive(input.p2Mpa, "下游绝对压力");
  requirePositive(input.t1K, "上游温度");
  if (input.p2Mpa > input.p1Mpa) throw new PrdsError("下游绝压不能高于上游绝压（减压阀不会升压）。");
}

function phaseOf(ph: If97PhState): PrdsPhase {
  if (ph.phase === "wet") return ph.quality !== null && ph.quality <= 0 ? "饱和液体" : "两相";
  if (ph.phase === "sat-liquid") return "过冷液体";
  return "过热蒸汽";
}

function checkSprayPressure(sprayPressureMpa: number | undefined, p2Mpa: number): string[] {
  if (sprayPressureMpa === undefined) return [];
  if (!Number.isFinite(sprayPressureMpa) || sprayPressureMpa <= 0) throw new PrdsError("喷水压力必须大于 0。");
  if (sprayPressureMpa <= p2Mpa) {
    throw new PrdsError(`喷水压力（${sprayPressureMpa} MPa(a)）不高于减温器处蒸汽压力（${p2Mpa} MPa(a)），无法保证喷水注入，请提高喷水压力或取消该输入。`);
  }
  if (sprayPressureMpa < p2Mpa * 1.1) {
    return ["喷水压力仅略高于减温器处蒸汽压力，雾化与注入裕量不足，存在高风险。"];
  }
  return [];
}

/** 模式 A：仅减压（绝热节流）。 */
function throttle(input: PrdsThrottleInput): PrdsResult {
  checkBase(input);
  const upstream = solvePT(input.p1Mpa, input.t1K);
  const tsat1 = safeTsat(input.p1Mpa);
  if (tsat1 !== null && input.t1K < tsat1 - 0.02) throw new PrdsError("上游温度低于该压力下饱和温度，介质不是蒸汽，无法按蒸汽减压计算。");
  const p2Tsat = saturationTemperature(input.p2Mpa);
  const throttled = solvePH(input.p2Mpa, upstream.enthalpyKjKg);
  const phase = phaseOf(throttled);
  return {
    mode: "throttle",
    upstreamEnthalpyKjKg: upstream.enthalpyKjKg,
    upstreamDensityKgM3: upstream.densityKgM3,
    throttledTemperatureK: throttled.temperatureK,
    throttledPhase: phase,
    throttledQuality: throttled.quality,
    p2SaturationTemperatureK: p2Tsat,
    outletTemperatureK: throttled.temperatureK,
    outletSuperheatK: throttled.temperatureK !== null ? throttled.temperatureK - p2Tsat : null,
    outletPhase: phase,
    outletQuality: throttled.quality,
    sprayFlowKgs: null,
    waterSteamRatio: null,
    totalOutletFlowKgs: null,
    energyResidual: 0,
    warnings: phase === "两相" || phase === "饱和液体" ? ["节流后进入两相区，输出干度 x；请复核下游管道携水与冲蚀风险。"] : [],
  };
}

function safeTsat(pMpa: number): number | null {
  try {
    return saturationTemperature(pMpa);
  } catch {
    return null;
  }
}

function sprayWaterEnthalpy(input: PrdsTargetInput | PrdsFixedWaterInput): number {
  requirePositive(input.sprayTemperatureK, "喷水温度");
  const pressureMpa = input.sprayPressureMpa ?? input.p2Mpa;
  return solvePT(pressureMpa, input.sprayTemperatureK).enthalpyKjKg;
}

function mixState(p2Mpa: number, steamFlowKgs: number, h1: number, sprayFlowKgs: number, hw: number): { state: If97PhState; residual: number } {
  const total = steamFlowKgs + sprayFlowKgs;
  const hMix = (steamFlowKgs * h1 + sprayFlowKgs * hw) / total;
  const state = solvePH(p2Mpa, hMix);
  const residual = (steamFlowKgs * h1 + sprayFlowKgs * hw - total * hMix) / (total * Math.abs(hMix) || 1);
  return { state, residual };
}

/** 模式 B：给定目标温度/过热度，求喷水量。 */
function targetTemperature(input: PrdsTargetInput): PrdsResult {
  checkBase(input);
  requirePositive(input.steamFlowKgs, "蒸汽质量流量");
  const pressureWarnings = checkSprayPressure(input.sprayPressureMpa, input.p2Mpa);
  const upstream = solvePT(input.p1Mpa, input.t1K);
  const tsat1 = safeTsat(input.p1Mpa);
  if (tsat1 !== null && input.t1K < tsat1 - 0.02) throw new PrdsError("上游温度低于该压力下饱和温度，介质不是蒸汽。");
  const p2Tsat = saturationTemperature(input.p2Mpa);
  const throttled = solvePH(input.p2Mpa, upstream.enthalpyKjKg);

  let targetK: number;
  if (input.targetSuperheatK !== undefined) {
    if (!Number.isFinite(input.targetSuperheatK) || input.targetSuperheatK < 0) throw new PrdsError("目标过热度不能小于 0。");
    targetK = p2Tsat + input.targetSuperheatK;
  } else if (input.targetTemperatureK !== undefined) {
    targetK = input.targetTemperatureK;
  } else {
    targetK = p2Tsat + SUGGESTED_SUPERHEAT_K;
  }
  if (!Number.isFinite(targetK) || targetK <= 0) throw new PrdsError("目标温度必须大于 0。");
  if (targetK < p2Tsat) throw new PrdsError(`目标温度（${(targetK - 273.15).toFixed(1)} °C）低于下游压力下饱和温度（${(p2Tsat - 273.15).toFixed(1)} °C），无法达到。`);

  const hTarget = solvePT(input.p2Mpa, targetK).enthalpyKjKg;
  if (hTarget >= upstream.enthalpyKjKg) {
    throw new PrdsError("按目标温度计算需要负喷水量：目标温度高于节流后温度，请先降低目标温度或提高上游过热度。");
  }
  const hw = sprayWaterEnthalpy(input);
  const mw = input.steamFlowKgs * (upstream.enthalpyKjKg - hTarget) / (hTarget - hw);
  if (mw < 0) throw new PrdsError("计算得到负喷水量：目标温度高于节流后温度。");

  const { state, residual } = mixState(input.p2Mpa, input.steamFlowKgs, upstream.enthalpyKjKg, mw, hw);
  const warnings = [...pressureWarnings];
  const superheat = targetK - p2Tsat;
  if (superheat < MIN_SUPERHEAT_K) warnings.push(`出口过热度仅 ${superheat.toFixed(1)} K，低于 ${MIN_SUPERHEAT_K} K，存在夹带水风险。`);
  return {
    mode: "target-temperature",
    upstreamEnthalpyKjKg: upstream.enthalpyKjKg,
    upstreamDensityKgM3: upstream.densityKgM3,
    throttledTemperatureK: throttled.temperatureK,
    throttledPhase: phaseOf(throttled),
    throttledQuality: throttled.quality,
    p2SaturationTemperatureK: p2Tsat,
    outletTemperatureK: state.temperatureK,
    outletSuperheatK: state.temperatureK !== null ? state.temperatureK - p2Tsat : null,
    outletPhase: phaseOf(state),
    outletQuality: state.quality,
    sprayFlowKgs: mw,
    waterSteamRatio: mw / input.steamFlowKgs,
    totalOutletFlowKgs: input.steamFlowKgs + mw,
    energyResidual: residual,
    warnings,
  };
}

/** 模式 C：给定喷水量，求出口状态。 */
function fixedWater(input: PrdsFixedWaterInput): PrdsResult {
  checkBase(input);
  requirePositive(input.steamFlowKgs, "蒸汽质量流量");
  if (!Number.isFinite(input.sprayFlowKgs) || input.sprayFlowKgs < 0) throw new PrdsError("喷水质量流量不能小于 0。");
  const pressureWarnings = checkSprayPressure(input.sprayPressureMpa, input.p2Mpa);
  const upstream = solvePT(input.p1Mpa, input.t1K);
  const tsat1 = safeTsat(input.p1Mpa);
  if (tsat1 !== null && input.t1K < tsat1 - 0.02) throw new PrdsError("上游温度低于该压力下饱和温度，介质不是蒸汽。");
  const p2Tsat = saturationTemperature(input.p2Mpa);
  const throttled = solvePH(input.p2Mpa, upstream.enthalpyKjKg);
  const hw = sprayWaterEnthalpy(input);
  const { state, residual } = mixState(input.p2Mpa, input.steamFlowKgs, upstream.enthalpyKjKg, input.sprayFlowKgs, hw);

  const warnings = [...pressureWarnings];
  const phase = phaseOf(state);
  if (phase === "两相" || phase === "饱和液体" || phase === "过冷液体") {
    warnings.push("出口进入两相区或液相区，减温过度，存在水击与夹带风险。");
  } else if (state.temperatureK !== null && state.temperatureK - p2Tsat < MIN_SUPERHEAT_K) {
    warnings.push(`出口过热度仅 ${(state.temperatureK - p2Tsat).toFixed(1)} K，低于 ${MIN_SUPERHEAT_K} K，存在夹带水风险。`);
  }
  return {
    mode: "fixed-water",
    upstreamEnthalpyKjKg: upstream.enthalpyKjKg,
    upstreamDensityKgM3: upstream.densityKgM3,
    throttledTemperatureK: throttled.temperatureK,
    throttledPhase: phaseOf(throttled),
    throttledQuality: throttled.quality,
    p2SaturationTemperatureK: p2Tsat,
    outletTemperatureK: state.temperatureK,
    outletSuperheatK: state.temperatureK !== null && phase !== "两相" && phase !== "饱和液体" && phase !== "过冷液体" ? state.temperatureK - p2Tsat : 0,
    outletPhase: phase,
    outletQuality: state.quality,
    sprayFlowKgs: input.sprayFlowKgs,
    waterSteamRatio: input.steamFlowKgs > 0 ? input.sprayFlowKgs / input.steamFlowKgs : null,
    totalOutletFlowKgs: input.steamFlowKgs + input.sprayFlowKgs,
    energyResidual: residual,
    warnings,
  };
}

export function calculatePrds(input: PrdsInput): PrdsResult {
  switch (input.mode) {
    case "throttle": return throttle(input);
    case "target-temperature": return targetTemperature(input);
    case "fixed-water": return fixedWater(input);
  }
}
