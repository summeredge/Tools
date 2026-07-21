import {
  airViscositySutherland,
  classifySteam,
  classifyWater,
  gasDensity,
  saturationTemperature,
  solvePT,
} from "../shared/if97-adapter";

export type PipeFlowBasis = "volume" | "mass";
export type PipeFluidKind = "custom" | "water" | "air" | "steam";

export type PipeFluidInput = {
  kind: PipeFluidKind;
  densityKgM3?: number;
  viscosityPas?: number;
  temperatureK?: number;
  /** 压缩因子，空气可用，默认 1 */
  zFactor?: number;
};

export type PipePressureInput = {
  flowM3s?: number;
  massFlowKgs?: number;
  diameterM: number;
  lengthM: number;
  densityKgM3?: number;
  viscosityPas?: number;
  roughnessM: number;
  sumK: number;
  inletPressurePa?: number;
  fluid?: PipeFluidInput;
};

export type PipeFlowModel = "incompressible" | "isothermal-gas-iterative";

export type PipePressureResult = {
  flowM3s: number;
  massFlowKgs: number;
  areaM2: number;
  velocityMs: number;
  reynolds: number;
  regime: "层流" | "过渡流" | "湍流";
  frictionFactor: number;
  frictionFactorMethod: "层流公式" | "Colebrook–White" | "Swamee–Jain 近似回退";
  straightDropPa: number;
  localDropPa: number;
  totalDropPa: number;
  headLossM: number;
  densityKgM3: number;
  viscosityPas: number;
  outletPressurePa: number | null;
  mach: number | null;
  flowModel: PipeFlowModel;
  fluidKind: PipeFluidKind;
  propertyNote: string;
  iterations: number | null;
  warnings: string[];
};

export class PipePressureError extends Error {}

const AIR_MOLAR_MASS = 28.9647; // kg/kmol
const AIR_GAS_CONSTANT = 8314.462618 / AIR_MOLAR_MASS; // J/(kg·K)
const AIR_HEAT_RATIO = 1.4;
const COMPRESSIBLE_DROP_FRACTION = 0.1;
const MACH_LIMIT = 0.3;
const GAS_MAX_ITERATIONS = 50;
const GAS_CONVERGENCE = 1e-6;

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new PipePressureError(`${label}必须大于 0。`);
}

function colebrook(reynolds: number, relativeRoughness: number): { value: number; method: PipePressureResult["frictionFactorMethod"] } {
  let friction = 0.02;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const next = 1 / Math.pow(-2 * Math.log10(relativeRoughness / 3.7 + 2.51 / (reynolds * Math.sqrt(friction))), 2);
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - friction) < 1e-10) return { value: next, method: "Colebrook–White" };
    friction = next;
  }
  const fallback = 0.25 / Math.pow(Math.log10(relativeRoughness / 3.7 + 5.74 / Math.pow(reynolds, 0.9)), 2);
  if (!Number.isFinite(fallback) || fallback <= 0) throw new PipePressureError("Colebrook–White 求解失败，且近似回退也无法得到摩阻系数。");
  return { value: fallback, method: "Swamee–Jain 近似回退" };
}

/** 水力摩阻与压降（Darcy–Weisbach 单相核心，既有实现保持不变）。 */
function darcyCore(flowM3s: number, diameterM: number, lengthM: number, roughnessM: number, sumK: number, densityKgM3: number, viscosityPas: number) {
  const areaM2 = Math.PI * diameterM ** 2 / 4;
  const velocityMs = flowM3s / areaM2;
  const reynolds = densityKgM3 * velocityMs * diameterM / viscosityPas;
  const regime = reynolds < 2300 ? "层流" as const : reynolds <= 4000 ? "过渡流" as const : "湍流" as const;
  const friction = reynolds < 2300 ? { value: 64 / reynolds, method: "层流公式" as const } : colebrook(reynolds, roughnessM / diameterM);
  const velocityHeadPa = densityKgM3 * velocityMs ** 2 / 2;
  const straightDropPa = friction.value * lengthM / diameterM * velocityHeadPa;
  const localDropPa = sumK * velocityHeadPa;
  return { areaM2, velocityMs, reynolds, regime, friction, straightDropPa, localDropPa, totalDropPa: straightDropPa + localDropPa };
}

/** 解析并校验流体物性；自动流体在此完成相态检查。 */
function resolveFluid(input: PipePressureInput): { densityKgM3: number; viscosityPas: number; fluidKind: PipeFluidKind; propertyNote: string; speedOfSoundMs: number | null } {
  const fluid = input.fluid ?? { kind: "custom" as const, densityKgM3: input.densityKgM3, viscosityPas: input.viscosityPas };
  if (fluid.kind === "custom") {
    const densityKgM3 = fluid.densityKgM3 ?? input.densityKgM3;
    const viscosityPas = fluid.viscosityPas ?? input.viscosityPas;
    if (densityKgM3 === undefined || !Number.isFinite(densityKgM3) || densityKgM3 <= 0) throw new PipePressureError("自定义流体必须输入大于 0 的密度。");
    if (viscosityPas === undefined || !Number.isFinite(viscosityPas) || viscosityPas <= 0) throw new PipePressureError("自定义流体必须输入大于 0 的动力黏度。");
    return { densityKgM3, viscosityPas, fluidKind: "custom", propertyNote: "自定义物性，未做相态检查。", speedOfSoundMs: null };
  }

  if (fluid.temperatureK === undefined || !Number.isFinite(fluid.temperatureK) || fluid.temperatureK <= 0) {
    throw new PipePressureError("水、空气和蒸汽必须输入温度。");
  }
  if (input.inletPressurePa === undefined || !Number.isFinite(input.inletPressurePa) || input.inletPressurePa <= 0) {
    throw new PipePressureError("水、空气和蒸汽必须输入大于 0 的入口绝对压力。");
  }
  const pressureMpa = input.inletPressurePa / 1e6;
  const temperatureK = fluid.temperatureK;

  if (fluid.kind === "water") {
    const { phase, state, saturationTemperatureK } = classifyWater(pressureMpa, temperatureK);
    if (phase === "vapor") throw new PipePressureError("该压力、温度下介质为蒸汽而非单相液体水，请将流体类型切换为蒸汽。");
    if (phase === "supercritical") throw new PipePressureError("该状态为超临界/高密度近临界流体，超出本工具单相液体模型范围。");
    if (phase === "sat-liquid") throw new PipePressureError("该状态位于饱和线上，无法保证单相液体，请偏离饱和线后计算。");
    if (!isUsable(state.viscosityPas)) throw new PipePressureError("IF97 未能返回有效的水黏度，无法计算。");
    const tsatNote = saturationTemperatureK !== null ? `（该压力下饱和温度 ${(saturationTemperatureK - 273.15).toFixed(2)} °C）` : "";
    return { densityKgM3: state.densityKgM3, viscosityPas: state.viscosityPas!, fluidKind: "water", propertyNote: `IF97 单相液体${tsatNote}`, speedOfSoundMs: state.speedOfSoundMs };
  }

  if (fluid.kind === "air") {
    const z = fluid.zFactor ?? 1;
    if (!Number.isFinite(z) || z <= 0) throw new PipePressureError("压缩因子 Z 必须大于 0。");
    const densityKgM3 = gasDensity(input.inletPressurePa, temperatureK, AIR_MOLAR_MASS, z);
    const viscosityPas = airViscositySutherland(temperatureK);
    const speedOfSoundMs = Math.sqrt(AIR_HEAT_RATIO * z * AIR_GAS_CONSTANT * temperatureK);
    return { densityKgM3, viscosityPas, fluidKind: "air", propertyNote: `理想气体状态方程（Z=${z}）+ Sutherland 黏度`, speedOfSoundMs };
  }

  const steam = classifySteam(pressureMpa, temperatureK);
  if (steam.phase === "wet") {
    const tsatC = ((steam.saturationTemperatureK ?? saturationTemperature(pressureMpa)) - 273.15).toFixed(2);
    throw new PipePressureError(`温度低于该压力下饱和温度（${tsatC} °C），介质为湿蒸汽或水，单相 Darcy 模型不适用。`);
  }
  if (steam.phase === "supercritical") throw new PipePressureError("该状态为超临界流体，超出本工具单相蒸汽模型范围。");
  if (!isUsable(steam.viscosityPas)) throw new PipePressureError("IF97 未能返回有效的蒸汽黏度，无法计算。");
  const phaseLabel = steam.phase === "sat-vapor" ? "干饱和蒸汽" : "过热蒸汽";
  return { densityKgM3: steam.densityKgM3, viscosityPas: steam.viscosityPas!, fluidKind: "steam", propertyNote: `IF97 ${phaseLabel}`, speedOfSoundMs: steam.speedOfSoundMs };
}

function isUsable(viscosityPas: number | null): viscosityPas is number {
  return viscosityPas !== null && Number.isFinite(viscosityPas) && viscosityPas > 0;
}

function checkShared(input: PipePressureInput): { hasVolume: boolean; hasMass: boolean } {
  const hasVolume = input.flowM3s !== undefined && Number.isFinite(input.flowM3s) && input.flowM3s > 0;
  const hasMass = input.massFlowKgs !== undefined && Number.isFinite(input.massFlowKgs) && input.massFlowKgs > 0;
  if (hasVolume === hasMass) throw new PipePressureError("请输入一个大于 0 的体积流量或质量流量，不能同时填写两者。");
  if (hasVolume) requirePositive(input.flowM3s!, "体积流量");
  if (hasMass) requirePositive(input.massFlowKgs!, "质量流量");
  requirePositive(input.diameterM, "管道内径");
  requirePositive(input.lengthM, "管长");
  if (!Number.isFinite(input.roughnessM) || input.roughnessM < 0) throw new PipePressureError("绝对粗糙度不能小于 0。");
  if (!Number.isFinite(input.sumK) || input.sumK < 0) throw new PipePressureError("局部阻力系数 ΣK 不能小于 0。");
  if (input.inletPressurePa !== undefined && (!Number.isFinite(input.inletPressurePa) || input.inletPressurePa <= 0)) throw new PipePressureError("入口绝压必须大于 0。");
  return { hasVolume, hasMass };
}

/** 不可压缩（水与自定义液体）路径：直接一次计算。 */
function computeIncompressible(input: PipePressureInput, flowM3s: number, densityKgM3: number, viscosityPas: number): PipePressureResult {
  const core = darcyCore(flowM3s, input.diameterM, input.lengthM, input.roughnessM, input.sumK, densityKgM3, viscosityPas);
  const warnings: string[] = [];
  if (core.regime === "过渡流") warnings.push("Re 在 2300～4000 过渡区，结果不适合作为最终设计依据。");
  if (input.inletPressurePa !== undefined && core.totalDropPa > input.inletPressurePa * COMPRESSIBLE_DROP_FRACTION) warnings.push("压降超过入口绝压的 10%，请复核输入或按可压缩模型评估。");
  return {
    flowM3s,
    massFlowKgs: flowM3s * densityKgM3,
    ...core,
    frictionFactor: core.friction.value,
    frictionFactorMethod: core.friction.method,
    headLossM: core.totalDropPa / (densityKgM3 * 9.80665),
    densityKgM3,
    viscosityPas,
    outletPressurePa: input.inletPressurePa !== undefined ? input.inletPressurePa - core.totalDropPa : null,
    mach: null,
    flowModel: "incompressible",
    fluidKind: "custom",
    propertyNote: "",
    iterations: null,
    warnings,
  };
}

/**
 * 等温、单相、低压降近似（空气/蒸汽）：
 * 以入口与出口平均压力对应密度迭代出口压力，相对变化小于 1e-6 或最多 50 次。
 * 仅用于初步估算，不构成可压缩管网正式设计模型。
 */
function computeGas(input: PipePressureInput, flowM3sInlet: number, inlet: { densityKgM3: number; viscosityPas: number; fluidKind: "air" | "steam"; speedOfSoundMs: number | null }, temperatureK: number, zFactor: number): PipePressureResult {
  const inletPressurePa = input.inletPressurePa!;
  const areaM2 = Math.PI * input.diameterM ** 2 / 4;
  const massFlowKgs = flowM3sInlet * inlet.densityKgM3;
  const velocityMsInlet = flowM3sInlet / areaM2;

  let outletPressurePa = inletPressurePa;
  let core = darcyCore(flowM3sInlet, input.diameterM, input.lengthM, input.roughnessM, input.sumK, inlet.densityKgM3, inlet.viscosityPas);
  let averageDensity = inlet.densityKgM3;
  let iterations = 0;
  let converged = false;

  for (iterations = 1; iterations <= GAS_MAX_ITERATIONS; iterations += 1) {
    averageDensity = inlet.fluidKind === "air"
      ? gasDensity((inletPressurePa + outletPressurePa) / 2, temperatureK, AIR_MOLAR_MASS, zFactor)
      : solvePT((inletPressurePa + outletPressurePa) / 2 / 1e6, temperatureK).densityKgM3;
    const flowM3sAvg = massFlowKgs / averageDensity;
    core = darcyCore(flowM3sAvg, input.diameterM, input.lengthM, input.roughnessM, input.sumK, averageDensity, inlet.viscosityPas);
    const nextOutlet = inletPressurePa - core.totalDropPa;
    if (nextOutlet <= 0) throw new PipePressureError("计算得到的出口绝压不大于 0，压降过大，该低压降近似模型不适用。");
    if (Math.abs(nextOutlet - outletPressurePa) / outletPressurePa < GAS_CONVERGENCE) {
      outletPressurePa = nextOutlet;
      converged = true;
      break;
    }
    outletPressurePa = nextOutlet;
  }
  if (!converged) throw new PipePressureError("等温气体压降迭代超过 50 次未收敛，请检查输入或改用可压缩管网模型。");

  const densityAtState = inlet.fluidKind === "air"
    ? (pressurePa: number) => gasDensity(pressurePa, temperatureK, AIR_MOLAR_MASS, zFactor)
    : (pressurePa: number) => solvePT(pressurePa / 1e6, temperatureK).densityKgM3;
  const densityOutlet = densityAtState(outletPressurePa);
  const velocityOutlet = massFlowKgs / densityOutlet / areaM2;
  const mach = inlet.speedOfSoundMs !== null ? velocityOutlet / inlet.speedOfSoundMs : null;

  const warnings: string[] = [];
  if (core.regime === "过渡流") warnings.push("Re 在 2300～4000 过渡区，结果不适合作为最终设计依据。");
  if (core.totalDropPa > inletPressurePa * COMPRESSIBLE_DROP_FRACTION) warnings.push("总压降超过入口绝压的 10%，等温低压降近似误差增大，请改用可压缩管网模型复核。");
  if (mach !== null && mach >= MACH_LIMIT) warnings.push(`出口马赫数约 ${mach.toFixed(3)} ≥ 0.3，不可压缩假设已不适用，该结果不能作为设计依据。`);
  if (inlet.fluidKind === "steam") {
    const outletTsat = saturationTemperature(outletPressurePa / 1e6);
    if (temperatureK <= outletTsat) warnings.push("出口状态已接近或低于该压力下的饱和温度，蒸汽可能凝结，单相气体模型失效。");
  }

  return {
    flowM3s: flowM3sInlet,
    massFlowKgs,
    ...core,
    velocityMs: velocityMsInlet,
    frictionFactor: core.friction.value,
    frictionFactorMethod: core.friction.method,
    headLossM: core.totalDropPa / (averageDensity * 9.80665),
    densityKgM3: inlet.densityKgM3,
    viscosityPas: inlet.viscosityPas,
    outletPressurePa,
    mach,
    flowModel: "isothermal-gas-iterative",
    fluidKind: inlet.fluidKind,
    propertyNote: "",
    iterations,
    warnings,
  };
}

export function calculatePipePressure(input: PipePressureInput): PipePressureResult {
  const { hasVolume } = checkShared(input);
  const fluid = resolveFluid(input);
  const flowM3sInlet = hasVolume ? input.flowM3s! : input.massFlowKgs! / fluid.densityKgM3;

  const isGas = fluid.fluidKind === "air" || fluid.fluidKind === "steam";
  const result = isGas
    ? computeGas(input, flowM3sInlet, { densityKgM3: fluid.densityKgM3, viscosityPas: fluid.viscosityPas, fluidKind: fluid.fluidKind as "air" | "steam", speedOfSoundMs: fluid.speedOfSoundMs }, input.fluid!.temperatureK!, input.fluid!.zFactor ?? 1)
    : computeIncompressible(input, flowM3sInlet, fluid.densityKgM3, fluid.viscosityPas);
  result.fluidKind = fluid.fluidKind;
  result.propertyNote = fluid.propertyNote;
  return result;
}
