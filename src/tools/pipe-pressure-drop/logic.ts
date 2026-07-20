export type PipeFlowBasis = "volume" | "mass";

export type PipePressureInput = {
  flowM3s?: number;
  massFlowKgs?: number;
  diameterM: number;
  lengthM: number;
  densityKgM3: number;
  viscosityPas: number;
  roughnessM: number;
  sumK: number;
  inletPressurePa?: number;
};

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
  warnings: string[];
};

export class PipePressureError extends Error {}

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

export function calculatePipePressure(input: PipePressureInput): PipePressureResult {
  const hasVolume = input.flowM3s !== undefined && Number.isFinite(input.flowM3s) && input.flowM3s > 0;
  const hasMass = input.massFlowKgs !== undefined && Number.isFinite(input.massFlowKgs) && input.massFlowKgs > 0;
  if (hasVolume === hasMass) throw new PipePressureError("请输入一个大于 0 的体积流量或质量流量，不能同时填写两者。");
  requirePositive(input.diameterM, "管道内径"); requirePositive(input.lengthM, "管长"); requirePositive(input.densityKgM3, "流体密度"); requirePositive(input.viscosityPas, "动力黏度");
  if (!Number.isFinite(input.roughnessM) || input.roughnessM < 0) throw new PipePressureError("绝对粗糙度不能小于 0。");
  if (!Number.isFinite(input.sumK) || input.sumK < 0) throw new PipePressureError("局部阻力系数 ΣK 不能小于 0。");
  if (input.inletPressurePa !== undefined && (!Number.isFinite(input.inletPressurePa) || input.inletPressurePa <= 0)) throw new PipePressureError("入口绝压必须大于 0。");

  const flowM3s = hasVolume ? input.flowM3s! : input.massFlowKgs! / input.densityKgM3;
  const massFlowKgs = hasMass ? input.massFlowKgs! : flowM3s * input.densityKgM3;
  const areaM2 = Math.PI * input.diameterM ** 2 / 4;
  const velocityMs = flowM3s / areaM2;
  const reynolds = input.densityKgM3 * velocityMs * input.diameterM / input.viscosityPas;
  const regime = reynolds < 2300 ? "层流" : reynolds <= 4000 ? "过渡流" : "湍流";
  const friction = reynolds < 2300 ? { value: 64 / reynolds, method: "层流公式" as const } : colebrook(reynolds, input.roughnessM / input.diameterM);
  const velocityHeadPa = input.densityKgM3 * velocityMs ** 2 / 2;
  const straightDropPa = friction.value * input.lengthM / input.diameterM * velocityHeadPa;
  const localDropPa = input.sumK * velocityHeadPa;
  const totalDropPa = straightDropPa + localDropPa;
  const warnings: string[] = [];
  if (regime === "过渡流") warnings.push("Re 在 2300～4000 过渡区，结果不适合作为最终设计依据。");
  if (input.inletPressurePa !== undefined && totalDropPa > input.inletPressurePa * 0.1) warnings.push("压降超过入口绝压的 10%，恒密度气体模型可能失效。");
  return { flowM3s, massFlowKgs, areaM2, velocityMs, reynolds, regime, frictionFactor: friction.value, frictionFactorMethod: friction.method, straightDropPa, localDropPa, totalDropPa, headLossM: totalDropPa / (input.densityKgM3 * 9.80665), warnings };
}
