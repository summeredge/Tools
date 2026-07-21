// 控制阀 Cv/Kv 初步选型：IEC 60534-2-1 单相液体与气体公式。
// 所有压力内部一律使用绝对压力；不提供根据 Cv 推算阀门开度的功能。
export type ValveMedium = "liquid" | "gas";
export type ValveMode = "size" | "predict";
export type ChokedStatus = "yes" | "no" | "not-evaluated";

export const CV_PER_KV = 1.156; // Emerson《控制阀手册》：Cv = 1.156 × Kv

export type ValveLiquidInput = {
  flowM3h?: number;
  ratedCoefficient?: number;
  p1Bar: number;
  p2Bar: number;
  temperatureK?: number;
  relativeDensity: number;
  vaporPressureBar?: number;
  criticalPressureBar?: number;
  fl?: number;
  fp?: number;
  safetyFactor?: number;
};

export type ValveGasInput = {
  flowNm3h?: number;
  ratedCoefficient?: number;
  p1Bar: number;
  p2Bar: number;
  standardTemperatureK?: number;
  standardPressureBar?: number;
  temperatureK: number;
  zFactor: number;
  molecularWeight: number;
  xt?: number;
  fGamma?: number;
  fp?: number;
  safetyFactor?: number;
};

export type ValveResult = {
  requiredCoefficient: number | null;
  predictedFlow: number | null;
  capacityRatio: number | null;
  capacityMarginPercent: number | null;
  deltaPRatio: number | null;
  expansionFactor: number | null;
  choked: ChokedStatus;
  cavitationRisk: boolean | null;
  effectiveDeltaPBar: number;
  formulaNote: string;
  missingInputs: string[];
  warnings: string[];
};

export class ValveSizingError extends Error {}

function positive(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) throw new ValveSizingError(`${label}必须大于 0。`);
  return value;
}

function checkPressures(p1Bar: number, p2Bar: number): void {
  if (!Number.isFinite(p1Bar) || p1Bar <= 0) throw new ValveSizingError("上游绝对压力必须大于 0，且必须使用绝压，不得输入表压。");
  if (!Number.isFinite(p2Bar) || p2Bar < 0) throw new ValveSizingError("下游绝对压力不能为负，且必须使用绝压。");
  if (p2Bar >= p1Bar) throw new ValveSizingError("下游绝压必须小于上游绝压（P2 ≥ P1 无法形成流经阀门的压差）。");
}

function coefficientKind(input: { ratedCoefficient?: number }, coefficientUnit: "Cv" | "Kv"): { rated: number | null; toKv: (c: number) => number; fromKv: (k: number) => number } {
  const rated = input.ratedCoefficient !== undefined && Number.isFinite(input.ratedCoefficient) && input.ratedCoefficient > 0 ? input.ratedCoefficient : null;
  return {
    rated,
    toKv: (c) => (coefficientUnit === "Cv" ? c / CV_PER_KV : c),
    fromKv: (k) => (coefficientUnit === "Cv" ? k * CV_PER_KV : k),
  };
}

/**
 * 液体（IEC 60534-2-1）：
 * 非阻塞：Kv = Q·sqrt(G/ΔP)；阻塞：ΔPmax = FL²·(P1 − FF·Pv)，FF = 0.96 − 0.28·sqrt(Pv/Pc)。
 * 缺少 Pv/Pc/FL 时只做非阻塞简化计算，阻塞状态为「未评估」。
 */
export function calculateLiquidValve(input: ValveLiquidInput, coefficientUnit: "Cv" | "Kv"): ValveResult {
  checkPressures(input.p1Bar, input.p2Bar);
  const G = positive(input.relativeDensity, "相对密度");
  const safety = input.safetyFactor ?? 1;
  if (!Number.isFinite(safety) || safety <= 0) throw new ValveSizingError("安全系数必须大于 0。");
  const fp = input.fp ?? 1;
  if (!Number.isFinite(fp) || fp <= 0 || fp > 1) throw new ValveSizingError("管件修正系数 Fp 必须满足 0 < Fp ≤ 1。");

  const { rated, toKv, fromKv } = coefficientKind(input, coefficientUnit);
  const deltaP = input.p1Bar - input.p2Bar;
  const missing: string[] = [];
  const warnings: string[] = [];

  let choked: ChokedStatus = "not-evaluated";
  let cavitationRisk: boolean | null = null;
  let effectiveDeltaP = deltaP;
  let formulaNote = "IEC 60534-2-1 非阻塞液体公式（未评估阻塞流）";

  const hasChokedInputs = input.vaporPressureBar !== undefined && input.criticalPressureBar !== undefined && input.fl !== undefined;
  if (!hasChokedInputs) {
    if (input.vaporPressureBar === undefined) missing.push("液体蒸气压 Pv");
    if (input.criticalPressureBar === undefined) missing.push("液体临界压力 Pc");
    if (input.fl === undefined) missing.push("压力恢复系数 FL");
  } else {
    const pv = positive(input.vaporPressureBar, "液体蒸气压");
    const pc = positive(input.criticalPressureBar, "液体临界压力");
    const fl = input.fl!;
    if (!Number.isFinite(fl) || fl <= 0 || fl > 1) throw new ValveSizingError("压力恢复系数 FL 必须满足 0 < FL ≤ 1。");
    if (pv >= pc) throw new ValveSizingError("蒸气压必须小于临界压力。");
    const ff = 0.96 - 0.28 * Math.sqrt(pv / pc);
    const deltaPMax = fl * fl * (input.p1Bar - ff * pv);
    effectiveDeltaP = Math.min(deltaP, deltaPMax);
    choked = deltaP >= deltaPMax ? "yes" : "no";
    formulaNote = choked === "yes" ? "IEC 60534-2-1 阻塞液体公式（ΔPmax = FL²·(P1 − FF·Pv)）" : "IEC 60534-2-1 非阻塞液体公式";
    if (choked === "yes") {
      cavitationRisk = input.p2Bar > ff * pv;
      warnings.push(cavitationRisk ? "存在汽蚀风险：阻塞流且 P2 > FF·Pv。" : "存在闪蒸风险：阻塞流且 P2 ≤ FF·Pv。");
    }
  }

  let requiredKv: number | null = null;
  let predictedFlow: number | null = null;
  if (input.flowM3h !== undefined) {
    const q = positive(input.flowM3h, "体积流量");
    requiredKv = (q * Math.sqrt(G / effectiveDeltaP) / fp) * safety;
  }
  if (rated !== null) {
    predictedFlow = toKv(rated) * fp * Math.sqrt(effectiveDeltaP / G);
  }
  if (requiredKv === null && predictedFlow === null) throw new ValveSizingError("请提供流量（计算所需系数）或已有额定系数（计算可通过流量）。");

  const capacityRatio = requiredKv !== null && rated !== null ? toKv(rated) / requiredKv : null;
  return {
    requiredCoefficient: requiredKv !== null ? fromKv(requiredKv) : null,
    predictedFlow,
    capacityRatio,
    capacityMarginPercent: capacityRatio !== null ? (capacityRatio - 1) * 100 : null,
    deltaPRatio: deltaP / input.p1Bar,
    expansionFactor: null,
    choked,
    cavitationRisk,
    effectiveDeltaPBar: effectiveDeltaP,
    formulaNote,
    missingInputs: missing,
    warnings,
  };
}

/**
 * 气体（IEC 60534-2-1，SI 形式）：
 * Kv = Qn/(257·Fp·Y) · sqrt(M·T1·Z/(ΔP·(P1+P2)))，Y = 1 − x/(3·Fγ·xT)。
 * 缺少 xT 时按 Y=1 简化估算，阻塞状态为「未评估」。
 */
export function calculateGasValve(input: ValveGasInput, coefficientUnit: "Cv" | "Kv"): ValveResult {
  checkPressures(input.p1Bar, input.p2Bar);
  const M = positive(input.molecularWeight, "气体分子量");
  const T1 = positive(input.temperatureK, "气体温度");
  const Z = positive(input.zFactor, "压缩因子 Z");
  const safety = input.safetyFactor ?? 1;
  if (!Number.isFinite(safety) || safety <= 0) throw new ValveSizingError("安全系数必须大于 0。");
  const fp = input.fp ?? 1;
  if (!Number.isFinite(fp) || fp <= 0 || fp > 1) throw new ValveSizingError("管件修正系数 Fp 必须满足 0 < Fp ≤ 1。");

  const { rated, toKv, fromKv } = coefficientKind(input, coefficientUnit);
  const deltaP = input.p1Bar - input.p2Bar;
  const x = deltaP / input.p1Bar;
  const missing: string[] = [];
  const warnings: string[] = [];

  let choked: ChokedStatus = "not-evaluated";
  let expansionY = 1;
  let effectiveDeltaP = deltaP;
  let formulaNote = "IEC 60534-2-1 气体公式，膨胀系数按 Y=1 简化（未评估阻塞流）";

  if (input.xt === undefined) {
    missing.push("压差比系数 xT");
  } else {
    const xt = positive(input.xt, "压差比系数 xT");
    if (xt > 1) throw new ValveSizingError("压差比系数 xT 不能大于 1。");
    const fGamma = input.fGamma ?? 1;
    if (!Number.isFinite(fGamma) || fGamma <= 0) throw new ValveSizingError("比热比修正系数 Fγ 必须大于 0。");
    const xLimit = fGamma * xt;
    choked = x >= xLimit ? "yes" : "no";
    expansionY = Math.max(1 - x / (3 * xLimit), 2 / 3);
    if (choked === "yes") {
      effectiveDeltaP = xLimit * input.p1Bar;
      formulaNote = "IEC 60534-2-1 阻塞气体公式（x ≥ Fγ·xT，Y = 2/3）";
      warnings.push("气体流动处于阻塞（临界）状态，流量不再随下游压力下降而增加。");
    } else {
      formulaNote = `IEC 60534-2-1 非阻塞气体公式（Y = ${expansionY.toFixed(4)}）`;
    }
  }

  let requiredKv: number | null = null;
  let predictedFlow: number | null = null;
  if (input.flowNm3h !== undefined) {
    const qn = positive(input.flowNm3h, "标准体积流量");
    requiredKv = (qn / (257 * fp * expansionY)) * Math.sqrt((M * T1 * Z) / (effectiveDeltaP * (input.p1Bar + input.p2Bar))) * safety;
  }
  if (rated !== null) {
    predictedFlow = 257 * toKv(rated) * fp * expansionY * Math.sqrt((effectiveDeltaP * (input.p1Bar + input.p2Bar)) / (M * T1 * Z));
  }
  if (requiredKv === null && predictedFlow === null) throw new ValveSizingError("请提供标准体积流量（计算所需系数）或已有额定系数（计算可通过流量）。");

  const capacityRatio = requiredKv !== null && rated !== null ? toKv(rated) / requiredKv : null;
  return {
    requiredCoefficient: requiredKv !== null ? fromKv(requiredKv) : null,
    predictedFlow,
    capacityRatio,
    capacityMarginPercent: capacityRatio !== null ? (capacityRatio - 1) * 100 : null,
    deltaPRatio: x,
    expansionFactor: expansionY,
    choked,
    cavitationRisk: null,
    effectiveDeltaPBar: effectiveDeltaP,
    formulaNote,
    missingInputs: missing,
    warnings,
  };
}

export function convertCoefficient(value: number, from: "Cv" | "Kv", to: "Cv" | "Kv"): number {
  if (from === to) return value;
  return from === "Cv" ? value / CV_PER_KV : value * CV_PER_KV;
}
