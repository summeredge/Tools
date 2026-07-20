export type HeatExchangerMode = "sensible" | "enthalpy";
export type HeatExchangerPattern = "counter" | "parallel";

export type HeatSideInput = {
  massFlowKgs?: number;
  cpJPerKgK?: number;
  inletTemperatureK?: number;
  outletTemperatureK?: number;
  inletEnthalpyJPerKg?: number;
  outletEnthalpyJPerKg?: number;
};

export type HeatExchangerInput = { mode: HeatExchangerMode; pattern: HeatExchangerPattern; correctionFactor: number; hot: HeatSideInput; cold: HeatSideInput };
export type HeatExchangerResult = {
  hotLoadKw: number | null;
  coldLoadKw: number | null;
  heatImbalancePercent: number | null;
  deltaT1K: number | null;
  deltaT2K: number | null;
  lmtdK: number | null;
  effectiveMeanDeltaTK: number | null;
  uaKwPerK: number | null;
  heatLoadBasisKw: number | null;
  lmtdReason: string | null;
  warnings: string[];
};

export class HeatExchangerError extends Error {}

function positive(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) throw new HeatExchangerError(`${label}必须大于 0。`);
  return value;
}

function sideLoad(side: HeatSideInput, mode: HeatExchangerMode, isHot: boolean): number | null {
  if (side.massFlowKgs === undefined) return null;
  const flow = positive(side.massFlowKgs, `${isHot ? "热" : "冷"}侧质量流量`);
  if (mode === "sensible") {
    if (side.cpJPerKgK === undefined || side.inletTemperatureK === undefined || side.outletTemperatureK === undefined) return null;
    positive(side.cpJPerKgK, `${isHot ? "热" : "冷"}侧比热`);
    return flow * side.cpJPerKgK * (isHot ? side.inletTemperatureK - side.outletTemperatureK : side.outletTemperatureK - side.inletTemperatureK) / 1000;
  }
  if (side.inletEnthalpyJPerKg === undefined || side.outletEnthalpyJPerKg === undefined) return null;
  return flow * (isHot ? side.inletEnthalpyJPerKg - side.outletEnthalpyJPerKg : side.outletEnthalpyJPerKg - side.inletEnthalpyJPerKg) / 1000;
}

export function calculateHeatExchanger(input: HeatExchangerInput): HeatExchangerResult {
  if (!Number.isFinite(input.correctionFactor) || input.correctionFactor <= 0 || input.correctionFactor > 1) throw new HeatExchangerError("修正系数 F 必须满足 0 < F ≤ 1。");
  const hotLoadKw = sideLoad(input.hot, input.mode, true);
  const coldLoadKw = sideLoad(input.cold, input.mode, false);
  if (hotLoadKw === null && coldLoadKw === null) throw new HeatExchangerError("至少需要一侧完整的流量与热量数据。");
  const warnings: string[] = [];
  const heatLoadBasisKw = hotLoadKw !== null && coldLoadKw !== null ? (Math.abs(hotLoadKw) + Math.abs(coldLoadKw)) / 2 : Math.abs(hotLoadKw ?? coldLoadKw!);
  const heatImbalancePercent = hotLoadKw !== null && coldLoadKw !== null && heatLoadBasisKw > 0 ? Math.abs(hotLoadKw - coldLoadKw) / heatLoadBasisKw * 100 : null;
  if (heatImbalancePercent !== null && heatImbalancePercent > 5) warnings.push("热量不平衡超过 5%，请检查流量、温度、比热或焓数据。");

  const hotIn = input.hot.inletTemperatureK; const hotOut = input.hot.outletTemperatureK; const coldIn = input.cold.inletTemperatureK; const coldOut = input.cold.outletTemperatureK;
  let deltaT1K: number | null = null; let deltaT2K: number | null = null; let lmtdK: number | null = null; let lmtdReason: string | null = null;
  if ([hotIn, hotOut, coldIn, coldOut].every((value) => value !== undefined && Number.isFinite(value))) {
    deltaT1K = input.pattern === "counter" ? hotIn! - coldOut! : hotIn! - coldIn!;
    deltaT2K = input.pattern === "counter" ? hotOut! - coldIn! : hotOut! - coldOut!;
    if (deltaT1K <= 0 || deltaT2K <= 0) lmtdReason = "两端温差存在零值、负值或温度交叉，不能计算 LMTD。";
    else if (Math.abs(deltaT1K - deltaT2K) < 1e-12) lmtdK = deltaT1K;
    else lmtdK = (deltaT1K - deltaT2K) / Math.log(deltaT1K / deltaT2K);
  } else lmtdReason = "需要两侧进出口温度才能计算 LMTD。";
  const effectiveMeanDeltaTK = lmtdK === null ? null : input.correctionFactor * lmtdK;
  const uaKwPerK = effectiveMeanDeltaTK !== null && effectiveMeanDeltaTK > 0 && heatLoadBasisKw > 0 ? heatLoadBasisKw / effectiveMeanDeltaTK : null;
  return { hotLoadKw, coldLoadKw, heatImbalancePercent, deltaT1K, deltaT2K, lmtdK, effectiveMeanDeltaTK, uaKwPerK, heatLoadBasisKw, lmtdReason, warnings };
}
