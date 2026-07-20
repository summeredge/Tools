export type GasFlowBasis = "actual" | "standard";
export type MoistureConversion = "none" | "wet-to-dry" | "dry-to-wet";

export type GasFlowInput = {
  flowM3s: number;
  flowBasis: GasFlowBasis;
  actualTemperatureK: number;
  actualPressurePa: number;
  standardTemperatureK: number;
  standardPressurePa: number;
  zActual: number;
  zStandard: number;
  molecularWeightKgPerKmol?: number;
  moistureFraction?: number;
  moistureConversion: MoistureConversion;
};

export type GasFlowResult = {
  inputFlowM3s: number;
  inputFlowBasis: GasFlowBasis;
  actualFlowM3s: number;
  standardFlowM3s: number;
  actualPressurePa: number;
  standardPressurePa: number;
  actualTemperatureK: number;
  standardTemperatureK: number;
  zActual: number;
  zStandard: number;
  molarFlowKmolH: number;
  massFlowKgH: number | null;
  moistureAdjustedFlowM3h: number | null;
  moistureDescription: string;
  formula: string;
  warnings: string[];
};

export class GasFlowError extends Error {}

const GAS_CONSTANT = 8.314462618;

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new GasFlowError(`${label}必须大于 0。`);
}

export function calculateGasFlow(input: GasFlowInput): GasFlowResult {
  requirePositive(input.flowM3s, "体积流量");
  requirePositive(input.actualTemperatureK, "实际绝对温度");
  requirePositive(input.actualPressurePa, "实际绝压");
  requirePositive(input.standardTemperatureK, "标准绝对温度");
  requirePositive(input.standardPressurePa, "标准绝压");
  requirePositive(input.zActual, "实际压缩因子 Z");
  requirePositive(input.zStandard, "标准压缩因子 Z");
  if (input.moistureConversion !== "none" && (!Number.isFinite(input.moistureFraction) || input.moistureFraction! < 0 || input.moistureFraction! > 1)) {
    throw new GasFlowError("水蒸气摩尔分数/体积分数必须在 0～1 之间。");
  }
  if (input.moistureConversion === "dry-to-wet" && input.moistureFraction === 1) throw new GasFlowError("干基转湿基时含水率不能等于 100%。");
  if (input.molecularWeightKgPerKmol !== undefined) requirePositive(input.molecularWeightKgPerKmol, "平均分子量");

  const ratio = input.actualPressurePa / input.standardPressurePa
    * input.standardTemperatureK / input.actualTemperatureK
    * input.zStandard / input.zActual;
  const actualFlowM3s = input.flowBasis === "actual" ? input.flowM3s : input.flowM3s / ratio;
  const standardFlowM3s = input.flowBasis === "standard" ? input.flowM3s : input.flowM3s * ratio;
  const molarFlowKmolH = input.actualPressurePa * actualFlowM3s / (input.zActual * GAS_CONSTANT * input.actualTemperatureK) * 3.6;
  const massFlowKgH = input.molecularWeightKgPerKmol === undefined ? null : molarFlowKmolH * input.molecularWeightKgPerKmol;
  const moistureFraction = input.moistureFraction ?? 0;
  let moistureAdjustedFlowM3h: number | null = null;
  let moistureDescription = "未启用湿基/干基换算。";
  if (input.moistureConversion === "wet-to-dry") {
    moistureAdjustedFlowM3h = input.flowM3s * (1 - moistureFraction) * 3600;
    moistureDescription = `湿基 → 干基：输入基准流量 × (1 − ${moistureFraction})`;
  } else if (input.moistureConversion === "dry-to-wet") {
    moistureAdjustedFlowM3h = input.flowM3s / (1 - moistureFraction) * 3600;
    moistureDescription = `干基 → 湿基：输入基准流量 ÷ (1 − ${moistureFraction})`;
  }

  const warnings = ["该工具不处理冷凝、化学反应和组成随状态变化。"];
  if (input.moistureConversion !== "none" && moistureFraction > 0.2) warnings.push("含水率较高，湿基/干基换算未模拟冷凝或组成变化。");
  return {
    inputFlowM3s: input.flowM3s,
    inputFlowBasis: input.flowBasis,
    actualFlowM3s,
    standardFlowM3s,
    actualPressurePa: input.actualPressurePa,
    standardPressurePa: input.standardPressurePa,
    actualTemperatureK: input.actualTemperatureK,
    standardTemperatureK: input.standardTemperatureK,
    zActual: input.zActual,
    zStandard: input.zStandard,
    molarFlowKmolH,
    massFlowKgH,
    moistureAdjustedFlowM3h,
    moistureDescription,
    formula: "Qstd = Qactual × Pactual_abs / Pstd_abs × Tstd_abs / Tactual_abs × Zstd / Zactual",
    warnings,
  };
}
