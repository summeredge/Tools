import { escapeHtml, formatToolNumber, renderProcessGuidance, type ProcessGuidance, type ToolStorage } from "../runtime";
import type { PipeFlowBasis, PipeFluidKind, PipePressureResult } from "./logic";

export type PipeFlowUnit = "m3/h" | "L/min" | "kg/h";
export type PipeFormState = {
  fluidKind: PipeFluidKind;
  flowBasis: PipeFlowBasis;
  flowValue: number;
  flowUnit: PipeFlowUnit;
  diameterMm: number;
  lengthM: number;
  densityKgM3: number;
  viscosityMpas: number;
  roughnessMm: number;
  sumK: number;
  temperatureC: number;
  inletPressureKpa: number;
  zFactor: number;
};
export const DEFAULT_PIPE_FORM: PipeFormState = {
  fluidKind: "custom",
  flowBasis: "volume",
  flowValue: 0.0282743,
  flowUnit: "m3/h",
  diameterMm: 10,
  lengthM: 10,
  densityKgM3: 1000,
  viscosityMpas: 1,
  roughnessMm: 0.0015,
  sumK: 2,
  temperatureC: 20,
  inletPressureKpa: 101.325,
  zFactor: 1,
};

export const PIPE_PRESSURE_GUIDANCE: ProcessGuidance = {
  assumptions: [
    "单相、稳态、牛顿流体，使用圆形等径水平管。",
    "水与自定义液体按不可压缩 Darcy–Weisbach 计算。",
    "空气与蒸汽采用等温、单相、低压降近似：以平均压力密度迭代出口压力（≤50 次，相对变化 <1e-6）。",
    "总压降包含直管摩擦和输入的局部阻力系数 ΣK。",
  ],
  applicability: [
    "适用于 Darcy–Weisbach 管道流速与压降的工程估算。",
    "层流使用 f = 64/Re；湍流优先 Colebrook–White 数值求解，失败时回退 Swamee–Jain。",
    "水与蒸汽物性来自 IAPWS-IF97；空气按理想气体 + Sutherland 黏度。",
  ],
  limitations: [
    "Re 为 2300～4000 时处于过渡区，不宜作为最终设计依据。",
    "湿蒸汽、两相流与超临界状态不属于本工具计算范围，会被拒绝。",
    "气体模型为低压降近似：压降超过入口绝压 10% 或出口马赫数 ≥0.3 时仅供参考。",
    "不包含静压高度差、公称管径或 Schedule 数据库，不构成可压缩管网正式设计模型。",
  ],
};

function options(values: Array<[string, string]>, selected: string): string {
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function renderPipePressureForm(storage: ToolStorage): string {
  const state = storage.read<PipeFormState>("workbench:pipe-pressure-drop", DEFAULT_PIPE_FORM);
  const flowUnits: Array<[string, string]> = state.flowBasis === "mass" ? [["kg/h", "kg/h"]] : [["m3/h", "m³/h"], ["L/min", "L/min"]];
  const fluidKind = state.fluidKind ?? "custom";
  const hideFluidOnly = fluidKind === "custom" ? " hidden" : "";
  const hideCustom = fluidKind === "custom" ? "" : " hidden";
  return `<div class="process-tool pipe-pressure-tool"><div class="pe-input-section"><div class="pe-form-grid"><label>流体类型<select id="pipe-fluid-kind">${options([["custom", "自定义"], ["water", "水"], ["air", "空气"], ["steam", "蒸汽"]], fluidKind)}</select></label><label>流量类型<select id="pipe-flow-basis">${options([["volume", "体积流量"], ["mass", "质量流量"]], state.flowBasis)}</select></label><label>流量<input id="pipe-flow-value" type="number" value="${state.flowValue}"><select id="pipe-flow-unit">${options(flowUnits, state.flowUnit)}</select></label><label>管道内径<input id="pipe-diameter" type="number" value="${state.diameterMm}"><small>mm</small></label><label>管长<input id="pipe-length" type="number" value="${state.lengthM}"><small>m</small></label><label class="pipe-custom-field"${hideCustom}>流体密度<input id="pipe-density" type="number" value="${state.densityKgM3}"><small>kg/m³</small></label><label class="pipe-custom-field"${hideCustom}>动力黏度<input id="pipe-viscosity" type="number" value="${state.viscosityMpas}"><small>mPa·s</small></label><label class="pipe-fluid-field"${hideFluidOnly}>温度<input id="pipe-temperature" type="number" value="${state.temperatureC}"><small>°C</small></label><label class="pipe-fluid-field"${hideFluidOnly}>入口绝压<input id="pipe-inlet-pressure" type="number" value="${state.inletPressureKpa}"><small>kPa(a)</small></label><label class="pipe-fluid-field pipe-air-field"${fluidKind === "air" ? "" : " hidden"}>压缩因子 Z<input id="pipe-z-factor" type="number" step="0.01" value="${state.zFactor}"><small>默认 1</small></label><label>绝对粗糙度<input id="pipe-roughness" type="number" value="${state.roughnessMm}"><small>mm</small></label><label>局部阻力系数 ΣK<input id="pipe-sum-k" type="number" value="${state.sumK}"></label></div><div class="pe-actions"><button class="button primary" id="pipe-calculate">计算</button><button class="button secondary" id="pipe-reset">恢复默认值</button></div><div class="feedback" id="pipe-feedback" aria-live="polite">请输入参数后计算。</div></div><div class="pe-output" id="pipe-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

export function renderPipePressure(storage: ToolStorage): string {
  return `${renderPipePressureForm(storage)}${renderProcessGuidance(PIPE_PRESSURE_GUIDANCE)}`;
}

const FLUID_LABEL: Record<PipeFluidKind, string> = { custom: "自定义", water: "水", air: "空气", steam: "蒸汽" };

function renderPipePressureResultBase(result: PipePressureResult): string {
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const modelLabel = result.flowModel === "incompressible" ? "不可压缩 Darcy–Weisbach" : "等温单相低压降近似（平均密度迭代）";
  const outletLine = result.outletPressurePa !== null ? `<p>出口绝对压力：${formatToolNumber(result.outletPressurePa / 1000)} kPa(a)</p>` : "";
  const machLine = result.mach !== null ? `<p>出口马赫数：${formatToolNumber(result.mach, 4)}</p>` : "";
  return `<div class="pe-result-heading"><div><p class="eyebrow">DARCY–WEISBACH / ${escapeHtml(FLUID_LABEL[result.fluidKind])}</p><h2>流速与压降结果</h2><p>${result.regime} · 摩阻系数采用 ${escapeHtml(result.frictionFactorMethod)}</p></div><button class="button secondary" data-copy-result>复制结果</button></div><div class="pe-metrics"><div><small>体积流量（入口）</small><strong>${formatToolNumber(result.flowM3s * 3600)} m³/h</strong></div><div><small>质量流量</small><strong>${formatToolNumber(result.massFlowKgs * 3600)} kg/h</strong></div><div><small>流速（入口）</small><strong>${formatToolNumber(result.velocityMs)} m/s</strong></div><div><small>Reynolds 数</small><strong>${formatToolNumber(result.reynolds, 0)}</strong></div></div><div class="pe-result-grid"><section><h3>物性与模型</h3><p>采用密度：${formatToolNumber(result.densityKgM3)} kg/m³</p><p>采用动力黏度：${formatToolNumber(result.viscosityPas * 1000)} mPa·s</p>${result.propertyNote ? `<p>物性来源：${escapeHtml(result.propertyNote)}</p>` : ""}<p>压降模型：${modelLabel}</p>${result.iterations !== null ? `<p>迭代次数：${result.iterations}</p>` : ""}${machLine}</section><section><h3>阻力与压降</h3><p>Darcy 摩阻系数：${formatToolNumber(result.frictionFactor, 6)}</p><p>直管压降：${formatToolNumber(result.straightDropPa)} Pa</p><p>局部压降：${formatToolNumber(result.localDropPa)} Pa</p><p>总压降：${formatToolNumber(result.totalDropPa)} Pa${result.totalDropPa >= 1000 ? `（${formatToolNumber(result.totalDropPa / 1000)} kPa）` : ""}</p>${outletLine}<p>压头损失：${formatToolNumber(result.headLossM)} m</p></section></div>${warnings ? `<div class="pe-notes warning"><strong>提示</strong><ul>${warnings}</ul></div>` : ""}</div>`;
}

export function renderPipePressureResult(result: PipePressureResult): string {
  return `${renderPipePressureResultBase(result)}<div class="pe-notes"><strong>适用范围</strong><p>仅适用于单相牛顿流体、圆形等径水平管。水与自定义液体按不可压缩处理；空气与蒸汽按等温低压降近似，压降超过入口绝压 10% 或马赫数 ≥0.3 时结果仅供参考，不构成可压缩管网正式设计模型。</p></div>`;
}
