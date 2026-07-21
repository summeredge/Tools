import { saturationTemperature, solvePT } from "../shared/if97-adapter";

// 控制阀 Cv/Kv 初步选型。
// 计算口径：IEC 60534-2-1 单相液体与单相气体；所有压力内部均使用绝对压力。
// 本工具不根据 Cv/Kv 推算阀门开度，也不替代制造商正式选型软件。
export type ValveMedium = "liquid" | "gas";
export type ValveMode = "size" | "predict";
export type ChokedStatus = "yes" | "no" | "not-evaluated";
export type ValveLiquidPreset = "water" | "custom";
export type ValveGasPreset = "air" | "nitrogen" | "oxygen" | "carbon-dioxide" | "natural-gas" | "custom";

export const CV_PER_KV = 1.156; // Emerson《控制阀手册》：Cv = 1.156 × Kv
export const GAS_N9_KV_NM3H_BAR_K = 2120; // IEC/ISA：Kv、Qn[Nm³/h@0°C]、P[bar(a)]、T[K]、M[kg/kmol]
export const GAS_NORMAL_TEMPERATURE_K = 273.15;
export const GAS_NORMAL_PRESSURE_BAR = 1.01325;
export const WATER_CRITICAL_PRESSURE_BAR = 220.64;

export const GAS_PRESET_VALUES: Record<Exclude<ValveGasPreset, "custom">, { molecularWeight: number; specificHeatRatio: number; zFactor: number; note: string }> = {
  air: { molecularWeight: 28.9647, specificHeatRatio: 1.4, zFactor: 1, note: "干空气常温低压参考值" },
  nitrogen: { molecularWeight: 28.0134, specificHeatRatio: 1.4, zFactor: 1, note: "氮气常温低压参考值" },
  oxygen: { molecularWeight: 31.998, specificHeatRatio: 1.395, zFactor: 1, note: "氧气常温低压参考值" },
  "carbon-dioxide": { molecularWeight: 44.0095, specificHeatRatio: 1.30, zFactor: 1, note: "二氧化碳常温低压初值；高压时必须复核 Z 与 k" },
  "natural-gas": { molecularWeight: 18, specificHeatRatio: 1.30, zFactor: 1, note: "天然气近似初值；实际组成变化较大，必须按组分复核" },
};

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
  flp?: number;
  fp?: number;
  safetyFactor?: number;
};

export type ValveGasInput = {
  flowNm3h?: number;
  ratedCoefficient?: number;
  p1Bar: number;
  p2Bar: number;
  temperatureK: number;
  zFactor: number;
  molecularWeight: number;
  specificHeatRatio?: number;
  xt?: number;
  xtp?: number;
  fp?: number;
  safetyFactor?: number;
};

export type ValveResult = {
  requiredCoefficient: number | null;
  predictedFlow: number | null;
  capacityRatio: number | null;
  capacityMarginPercent: number | null;
  deltaPRatio: number | null;
  sizingPressureRatio: number | null;
  expansionFactor: number | null;
  choked: ChokedStatus;
  cavitationRisk: boolean | null;
  effectiveDeltaPBar: number;
  formulaNote: string;
  missingInputs: string[];
  warnings: string[];
  pipingModel: "bare-valve" | "installed-fittings";
  usedRecoveryFactor: number | null;
  usedPressureRatioFactor: number | null;
  specificHeatRatio: number | null;
};

export type WaterValveProperties = {
  relativeDensity: number;
  densityKgM3: number;
  vaporPressureBar: number;
  criticalPressureBar: number;
};

export class ValveSizingError extends Error {}

function positive(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) throw new ValveSizingError(`${label}必须大于 0。`);
  return value;
}

function nonNegative(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) throw new ValveSizingError(`${label}不能小于 0。`);
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
 * 通过 IF97 饱和温度函数反求给定温度下的水蒸气压。
 * 仅用于水预设，不新增第二套水物性关联式。
 */
function waterSaturationPressureBar(temperatureK: number): number {
  if (!Number.isFinite(temperatureK) || temperatureK < 273.16 || temperatureK >= 647.096) {
    throw new ValveSizingError("水预设温度必须在 0.01°C 至临界温度以下。");
  }
  let lowMpa = 0.000611657;
  let highMpa = 22.064;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midMpa = (lowMpa + highMpa) / 2;
    if (saturationTemperature(midMpa) < temperatureK) lowMpa = midMpa;
    else highMpa = midMpa;
  }
  return ((lowMpa + highMpa) / 2) * 10;
}

/**
 * 水预设：根据入口绝压和温度计算入口密度、相对密度和蒸气压。
 * 相对密度按 1000 kg/m³ 基准。若入口状态不是单相液体则拒绝。
 */
export function waterValveProperties(p1Bar: number, temperatureK: number): WaterValveProperties {
  positive(p1Bar, "上游绝对压力");
  positive(temperatureK, "水温");
  const vaporPressureBar = waterSaturationPressureBar(temperatureK);
  if (p1Bar <= vaporPressureBar) {
    throw new ValveSizingError("当前水温下上游绝压不高于蒸气压，入口不是稳定单相液体，不能使用液体控制阀公式。");
  }
  const state = solvePT(p1Bar / 10, temperatureK);
  if (!Number.isFinite(state.densityKgM3) || state.densityKgM3 <= 0) throw new ValveSizingError("IF97 未能得到有效水密度。");
  return {
    relativeDensity: state.densityKgM3 / 1000,
    densityKgM3: state.densityKgM3,
    vaporPressureBar,
    criticalPressureBar: WATER_CRITICAL_PRESSURE_BAR,
  };
}

/**
 * 液体 IEC 60534-2-1：
 * 非阻塞：Kv = Q/Fp × sqrt(G/ΔPsizing)
 * 裸阀阻塞：ΔPmax = FL² × (P1 − FF·Pv)
 * 安装管件阻塞：ΔPmax = (FLP/Fp)² × (P1 − FF·Pv)
 * FF = 0.96 − 0.28 × sqrt(Pv/Pc)
 *
 * 当 Fp < 1 时，不能继续用裸阀 FL 判断阻塞；必须提供组合系数 FLP。
 * 缺少 Pv/Pc/FL（或 FLP）时只做非阻塞简化计算，阻塞状态为「未评估」。
 */
export function calculateLiquidValve(input: ValveLiquidInput, coefficientUnit: "Cv" | "Kv"): ValveResult {
  checkPressures(input.p1Bar, input.p2Bar);
  const G = positive(input.relativeDensity, "相对密度");
  const safety = input.safetyFactor ?? 1;
  if (!Number.isFinite(safety) || safety <= 0) throw new ValveSizingError("选型裕量系数必须大于 0。");
  const fp = input.fp ?? 1;
  if (!Number.isFinite(fp) || fp <= 0 || fp > 1) throw new ValveSizingError("管道几何修正系数 Fp 必须满足 0 < Fp ≤ 1。");

  const pipingModel = fp < 0.999999 ? "installed-fittings" : "bare-valve";
  const { rated, toKv, fromKv } = coefficientKind(input, coefficientUnit);
  const deltaP = input.p1Bar - input.p2Bar;
  const missing: string[] = [];
  const warnings: string[] = [];

  let choked: ChokedStatus = "not-evaluated";
  let cavitationRisk: boolean | null = null;
  let effectiveDeltaP = deltaP;
  let usedRecoveryFactor: number | null = null;
  let formulaNote = "IEC 60534-2-1 非阻塞液体简化公式（阻塞流尚未评估）";

  const recoveryFactor = pipingModel === "installed-fittings" ? input.flp : input.fl;
  const recoveryLabel = pipingModel === "installed-fittings" ? "组合压力恢复系数 FLP" : "压力恢复系数 FL";
  const hasChokedInputs = input.vaporPressureBar !== undefined && input.criticalPressureBar !== undefined && recoveryFactor !== undefined;
  if (!hasChokedInputs) {
    if (input.vaporPressureBar === undefined) missing.push("液体蒸气压 Pv");
    if (input.criticalPressureBar === undefined) missing.push("液体临界压力 Pc");
    if (recoveryFactor === undefined) missing.push(recoveryLabel);
  } else {
    const pv = nonNegative(input.vaporPressureBar, "液体蒸气压");
    const pc = positive(input.criticalPressureBar, "液体临界压力");
    const recovery = positive(recoveryFactor, recoveryLabel);
    if (recovery > 1) throw new ValveSizingError(`${recoveryLabel}必须满足 0 < ${pipingModel === "installed-fittings" ? "FLP" : "FL"} ≤ 1。`);
    if (pv >= pc) throw new ValveSizingError("蒸气压必须小于临界压力。");
    const ff = 0.96 - 0.28 * Math.sqrt(pv / pc);
    const deltaPMax = Math.pow(recovery / fp, 2) * (input.p1Bar - ff * pv);
    if (!Number.isFinite(deltaPMax) || deltaPMax <= 0) throw new ValveSizingError("阻塞压差上限无效，请检查 P1、Pv、Pc、Fp 和压力恢复系数。");
    effectiveDeltaP = Math.min(deltaP, deltaPMax);
    choked = deltaP >= deltaPMax ? "yes" : "no";
    usedRecoveryFactor = recovery;
    formulaNote = pipingModel === "installed-fittings"
      ? `IEC 60534-2-1 安装条件液体公式（使用 Fp=${fp.toFixed(3)}、FLP=${recovery.toFixed(3)}）`
      : `IEC 60534-2-1 裸阀液体公式（使用 FL=${recovery.toFixed(3)}）`;
    if (choked === "yes") {
      cavitationRisk = input.p2Bar > ff * pv;
      warnings.push(cavitationRisk ? "存在汽蚀风险：阻塞流且 P2 > FF·Pv。" : "存在闪蒸风险：阻塞流且 P2 ≤ FF·Pv。");
    }
  }

  if (pipingModel === "installed-fittings") {
    warnings.push("Fp < 1：结果按带附接管件的安装条件计算；FLP 必须来自制造商数据或按 IEC 迭代确定，不能用裸阀 FL 代替。");
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
    sizingPressureRatio: null,
    expansionFactor: null,
    choked,
    cavitationRisk,
    effectiveDeltaPBar: effectiveDeltaP,
    formulaNote,
    missingInputs: missing,
    warnings,
    pipingModel,
    usedRecoveryFactor,
    usedPressureRatioFactor: null,
    specificHeatRatio: null,
  };
}

/**
 * 气体 IEC/ISA 体积流量公式（Qn 为 0°C、1.01325 bar(a) 的 Nm³/h）：
 *
 * Kv = Qn / (N9 × Fp × P1 × Y) × sqrt(M × T1 × Z / xsizing)
 * N9 = 2120（Kv、Nm³/h、bar(a)、K、kg/kmol）
 * xactual = (P1 − P2) / P1
 * xsizing = min(xactual, Fγ × xT)（裸阀）
 * xsizing = min(xactual, Fγ × xTP)（有附接管件）
 * Fγ = k / 1.4
 * Y = 1 − xsizing / (3 × Fγ × xT或xTP)，且 Y ≥ 2/3
 *
 * 当 Fp < 1 时必须使用 xTP，不能继续使用裸阀 xT。
 * 缺少 xT/xTP 时按 Y=1 进行容量粗估，阻塞状态为「未评估」。
 */
export function calculateGasValve(input: ValveGasInput, coefficientUnit: "Cv" | "Kv"): ValveResult {
  checkPressures(input.p1Bar, input.p2Bar);
  const M = positive(input.molecularWeight, "气体分子量");
  const T1 = positive(input.temperatureK, "气体温度");
  const Z = positive(input.zFactor, "压缩因子 Z");
  const k = input.specificHeatRatio ?? 1.4;
  if (!Number.isFinite(k) || k <= 1 || k > 2) throw new ValveSizingError("气体比热比 k 必须满足 1 < k ≤ 2。");
  const fGamma = k / 1.4;
  const safety = input.safetyFactor ?? 1;
  if (!Number.isFinite(safety) || safety <= 0) throw new ValveSizingError("选型裕量系数必须大于 0。");
  const fp = input.fp ?? 1;
  if (!Number.isFinite(fp) || fp <= 0 || fp > 1) throw new ValveSizingError("管道几何修正系数 Fp 必须满足 0 < Fp ≤ 1。");

  const pipingModel = fp < 0.999999 ? "installed-fittings" : "bare-valve";
  const { rated, toKv, fromKv } = coefficientKind(input, coefficientUnit);
  const deltaP = input.p1Bar - input.p2Bar;
  const xActual = deltaP / input.p1Bar;
  const missing: string[] = [];
  const warnings: string[] = [];

  const ratioFactor = pipingModel === "installed-fittings" ? input.xtp : input.xt;
  const ratioLabel = pipingModel === "installed-fittings" ? "安装条件压差比系数 xTP" : "额定压差比系数 xT";
  let choked: ChokedStatus = "not-evaluated";
  let expansionY = 1;
  let xSizing = xActual;
  let usedPressureRatioFactor: number | null = null;
  let formulaNote = `IEC 60534-2-1 气体容量粗估（Qn 基准：0°C、${GAS_NORMAL_PRESSURE_BAR} bar(a)；缺少 ${ratioLabel}，按 Y=1，未评估阻塞流）`;

  if (ratioFactor === undefined) {
    missing.push(ratioLabel);
  } else {
    const factor = positive(ratioFactor, ratioLabel);
    if (factor > 1) throw new ValveSizingError(`${ratioLabel}不能大于 1。`);
    const xLimit = fGamma * factor;
    if (!Number.isFinite(xLimit) || xLimit <= 0) throw new ValveSizingError("临界压差比无效，请检查 k 与 xT/xTP。");
    xSizing = Math.min(xActual, xLimit);
    choked = xActual >= xLimit ? "yes" : "no";
    expansionY = Math.max(1 - xSizing / (3 * xLimit), 2 / 3);
    usedPressureRatioFactor = factor;
    formulaNote = pipingModel === "installed-fittings"
      ? `IEC 60534-2-1 安装条件气体公式（Fp=${fp.toFixed(3)}、xTP=${factor.toFixed(3)}、Fγ=${fGamma.toFixed(4)}）`
      : `IEC 60534-2-1 裸阀气体公式（xT=${factor.toFixed(3)}、Fγ=${fGamma.toFixed(4)}）`;
    if (choked === "yes") warnings.push("气体流动处于阻塞（临界）状态；继续降低下游压力不会按该模型增加流量。");
  }

  if (pipingModel === "installed-fittings") {
    warnings.push("Fp < 1：必须使用安装条件系数 xTP；xTP 应来自制造商数据或按 IEC 迭代确定，不能用裸阀 xT 代替。");
  }
  if (Z === 1 && input.p1Bar >= 10) warnings.push("当前 Z=1 且入口压力较高，建议使用实际工况压缩因子复核。");

  let requiredKv: number | null = null;
  let predictedFlow: number | null = null;
  if (input.flowNm3h !== undefined) {
    const qn = positive(input.flowNm3h, "标准体积流量");
    requiredKv = (qn / (GAS_N9_KV_NM3H_BAR_K * fp * input.p1Bar * expansionY))
      * Math.sqrt((M * T1 * Z) / xSizing) * safety;
  }
  if (rated !== null) {
    predictedFlow = GAS_N9_KV_NM3H_BAR_K * toKv(rated) * fp * input.p1Bar * expansionY
      * Math.sqrt(xSizing / (M * T1 * Z));
  }
  if (requiredKv === null && predictedFlow === null) throw new ValveSizingError("请提供标准体积流量（计算所需系数）或已有额定系数（计算可通过流量）。");

  const capacityRatio = requiredKv !== null && rated !== null ? toKv(rated) / requiredKv : null;
  return {
    requiredCoefficient: requiredKv !== null ? fromKv(requiredKv) : null,
    predictedFlow,
    capacityRatio,
    capacityMarginPercent: capacityRatio !== null ? (capacityRatio - 1) * 100 : null,
    deltaPRatio: xActual,
    sizingPressureRatio: xSizing,
    expansionFactor: expansionY,
    choked,
    cavitationRisk: null,
    effectiveDeltaPBar: xSizing * input.p1Bar,
    formulaNote,
    missingInputs: missing,
    warnings,
    pipingModel,
    usedRecoveryFactor: null,
    usedPressureRatioFactor,
    specificHeatRatio: k,
  };
}

export function convertCoefficient(value: number, from: "Cv" | "Kv", to: "Cv" | "Kv"): number {
  if (from === to) return value;
  return from === "Cv" ? value / CV_PER_KV : value * CV_PER_KV;
}
