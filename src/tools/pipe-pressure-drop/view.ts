import { escapeHtml, formatToolNumber, renderProcessGuidance, type ProcessGuidance, type ToolStorage } from "../runtime";
import type { PipeFlowBasis, PipePressureResult } from "./logic";

export type PipeFormState = { flowBasis: PipeFlowBasis; flowValue: number; flowUnit: "m3/h" | "kg/h"; diameterMm: number; lengthM: number; densityKgM3: number; viscosityMpas: number; roughnessMm: number; sumK: number; inletPressureKpa: number };
export const DEFAULT_PIPE_FORM: PipeFormState = { flowBasis: "volume", flowValue: 0.0282743, flowUnit: "m3/h", diameterMm: 10, lengthM: 10, densityKgM3: 1000, viscosityMpas: 1, roughnessMm: 0.0015, sumK: 2, inletPressureKpa: 0 };

export const PIPE_PRESSURE_GUIDANCE: ProcessGuidance = {
  assumptions: ["单相、稳态、牛顿流体，使用圆形等径水平管。", "液体视为不可压缩；低压降气体按密度近似不变处理。", "总压降包含直管摩擦和输入的局部阻力系数 ΣK。"],
  applicability: ["适用于 Darcy–Weisbach 管道流速与压降估算。", "层流使用 f = 64/Re；湍流使用 Colebrook–White 数值求解。"],
  limitations: ["Re 为 2300～4000 时处于过渡区，不宜作为最终设计依据。", "不包含静压高度差、公称管径或 Schedule 数据库。"],
};

function options(values: Array<[string, string]>, selected: string): string { return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join(""); }

function renderPipePressureForm(storage: ToolStorage): string {
  const state = storage.read<PipeFormState>("workbench:pipe-pressure-drop", DEFAULT_PIPE_FORM);
  return `<div class="process-tool pipe-pressure-tool"><div class="pe-input-section"><div class="pe-form-grid"><label>流量类型<select id="pipe-flow-basis">${options([["volume", "体积流量"], ["mass", "质量流量"]], state.flowBasis)}</select></label><label>流量<input id="pipe-flow-value" type="number" value="${state.flowValue}"><select id="pipe-flow-unit">${options([["m3/h", "m³/h"], ["kg/h", "kg/h"]], state.flowUnit)}</select></label><label>管道内径<input id="pipe-diameter" type="number" value="${state.diameterMm}"><small>mm</small></label><label>管长<input id="pipe-length" type="number" value="${state.lengthM}"><small>m</small></label><label>流体密度<input id="pipe-density" type="number" value="${state.densityKgM3}"><small>kg/m³</small></label><label>动力黏度<input id="pipe-viscosity" type="number" value="${state.viscosityMpas}"><small>mPa·s</small></label><label>绝对粗糙度<input id="pipe-roughness" type="number" value="${state.roughnessMm}"><small>mm</small></label><label>局部阻力系数 ΣK<input id="pipe-sum-k" type="number" value="${state.sumK}"></label><label>入口绝压（可选）<input id="pipe-inlet-pressure" type="number" value="${state.inletPressureKpa}"><small>kPa；0 表示不检查气体压降</small></label></div><div class="pe-actions"><button class="button primary" id="pipe-calculate">计算</button><button class="button secondary" id="pipe-reset">恢复默认值</button></div><div class="feedback" id="pipe-feedback" aria-live="polite">请输入参数后计算。</div></div><div class="pe-output" id="pipe-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

export function renderPipePressure(storage: ToolStorage): string {
  return `${renderPipePressureForm(storage)}${renderProcessGuidance(PIPE_PRESSURE_GUIDANCE)}`;
}

function renderPipePressureResultBase(result: PipePressureResult): string {
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  return `<div class="pe-result-heading"><div><p class="eyebrow">DARCY–WEISBACH / SINGLE-PHASE PIPE</p><h2>流速与压降结果</h2><p>${result.regime} · 摩阻系数采用 ${escapeHtml(result.frictionFactorMethod)}</p></div><button class="button secondary" data-copy-result>复制结果</button></div><div class="pe-metrics"><div><small>体积流量</small><strong>${formatToolNumber(result.flowM3s * 3600)} m³/h</strong></div><div><small>质量流量</small><strong>${formatToolNumber(result.massFlowKgs * 3600)} kg/h</strong></div><div><small>流速</small><strong>${formatToolNumber(result.velocityMs)} m/s</strong></div><div><small>Reynolds 数</small><strong>${formatToolNumber(result.reynolds, 0)}</strong></div></div><div class="pe-result-grid"><section><h3>阻力与压降</h3><p>Darcy 摩阻系数：${formatToolNumber(result.frictionFactor, 6)}</p><p>直管压降：${formatToolNumber(result.straightDropPa)} Pa</p><p>局部压降：${formatToolNumber(result.localDropPa)} Pa</p><p>总压降：${formatToolNumber(result.totalDropPa)} Pa</p><p>水头损失：${formatToolNumber(result.headLossM)} m</p></section><section><h3>计算依据</h3><p>Darcy–Weisbach：ΔP直管 = f × L/D × ρv²/2</p><p>局部压降：ΔP局部 = ΣK × ρv²/2</p><p>圆管面积：${formatToolNumber(result.areaM2, 8)} m²</p></section></div>${warnings ? `<div class="pe-notes warning"><strong>提示</strong><ul>${warnings}</ul></div>` : ""}</div>`;
}

export function renderPipePressureResult(result: PipePressureResult): string {
  return `${renderPipePressureResultBase(result)}<div class="pe-notes"><strong>适用范围</strong><p>仅适用于单相牛顿流体、圆形等径水平管，以及不可压缩液体或密度近似不变的低压降气体；不包含静压高度差和公称管径数据库。</p></div>`;
}
