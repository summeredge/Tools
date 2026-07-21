import { escapeHtml, formatToolNumber, renderProcessGuidance, type ProcessGuidance, type ToolStorage } from "../runtime";
import type { ChokedStatus, ValveMedium, ValveMode, ValveResult } from "./logic";

export type ValveFormState = {
  medium: ValveMedium;
  mode: ValveMode;
  coefficientUnit: "Cv" | "Kv";
  flowValue: number;
  ratedCoefficient: number;
  p1Bar: number;
  p2Bar: number;
  safetyFactor: number;
  temperatureC: number;
  relativeDensity: number;
  vaporPressureBar: number | "";
  criticalPressureBar: number | "";
  fl: number | "";
  fp: number;
  zFactor: number;
  molecularWeight: number;
  xt: number | "";
  fGamma: number | "";
};

export const DEFAULT_VALVE_FORM: ValveFormState = {
  medium: "liquid",
  mode: "size",
  coefficientUnit: "Kv",
  flowValue: 10,
  ratedCoefficient: 16,
  p1Bar: 2,
  p2Bar: 1,
  safetyFactor: 1,
  temperatureC: 20,
  relativeDensity: 1,
  vaporPressureBar: "",
  criticalPressureBar: "",
  fl: "",
  fp: 1,
  zFactor: 1,
  molecularWeight: 28.9647,
  xt: "",
  fGamma: "",
};

export const VALVE_GUIDANCE: ProcessGuidance = {
  assumptions: [
    "单相牛顿流体，稳态流动；所有压力均为绝对压力。",
    "液体按 IEC 60534-2-1：Kv = Q·√(G/ΔP)；阻塞时 ΔPmax = FL²·(P1 − FF·Pv)。",
    "气体按 IEC 60534-2-1 SI 形式：Kv = Qn/(257·Fp·Y)·√(M·T1·Z/(ΔP·(P1+P2)))。",
    "安全系数仅对计算所得需求系数放大，不反推阀门开度。",
  ],
  applicability: [
    "用于控制阀初步选型与容量核对，覆盖单相液体与单相气体。",
    "提供蒸气压、临界压力、FL 或 xT 后才评估阻塞流、汽蚀/闪蒸风险。",
  ],
  limitations: [
    "不支持湿蒸汽、两相流、浆液、非牛顿流体或气液混合物。",
    "不包含噪声计算、执行机构选型与可调比分析。",
    "容量裕量仅表示已有流通能力相对计算需求的余量，不代表阀门开度、控制性能或最终选型结论。",
    "缺少 FL/xT 时阻塞流状态为「未评估」，此时结果为简化估算，需补充参数后复核。",
  ],
};

function options(values: Array<[string, string]>, selected: string): string {
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function optionalNumber(value: number | ""): string {
  return value === "" ? "" : String(value);
}

function renderValveForm(storage: ToolStorage): string {
  const state = storage.read<ValveFormState>("workbench:control-valve-sizing", DEFAULT_VALVE_FORM);
  const isLiquid = state.medium !== "gas";
  const isSize = state.mode !== "predict";
  return `<div class="process-tool valve-tool"><div class="pe-input-section"><div class="pe-form-grid"><label>介质类型<select id="valve-medium">${options([["liquid", "液体"], ["gas", "气体"]], state.medium ?? "liquid")}</select></label><label>计算模式<select id="valve-mode">${options([["size", "已知工况 → 所需系数"], ["predict", "已知系数 → 可通过流量"]], state.mode ?? "size")}</select></label><label>系数类型<select id="valve-coefficient-unit">${options([["Kv", "Kv（m³/h·bar）"], ["Cv", "Cv（US gal/min·psi）"]], state.coefficientUnit ?? "Kv")}</select></label><label class="valve-size-field"${isSize ? "" : " hidden"}>流量<input id="valve-flow" type="number" value="${state.flowValue}"><small class="valve-flow-unit">${isLiquid ? "m³/h" : "Nm³/h"}</small></label><label class="valve-predict-field"${isSize ? " hidden" : ""}>已有额定系数<input id="valve-rated" type="number" value="${state.ratedCoefficient}"><small class="valve-rated-unit">${state.coefficientUnit === "Cv" ? "Cv" : "Kv"}</small></label><label>上游绝压 P1<input id="valve-p1" type="number" value="${state.p1Bar}"><small>bar(a)</small></label><label>下游绝压 P2<input id="valve-p2" type="number" value="${state.p2Bar}"><small>bar(a)</small></label><label>安全系数<input id="valve-safety" type="number" step="0.05" value="${state.safetyFactor}"><small>默认 1.0</small></label><label>温度<input id="valve-temperature" type="number" value="${state.temperatureC}"><small>°C</small></label><label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>相对密度 G<input id="valve-relative-density" type="number" step="0.01" value="${state.relativeDensity}"><small>水=1</small></label><label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>蒸气压 Pv（可选）<input id="valve-vapor-pressure" type="number" value="${optionalNumber(state.vaporPressureBar)}"><small>bar(a)</small></label><label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>临界压力 Pc（可选）<input id="valve-critical-pressure" type="number" value="${optionalNumber(state.criticalPressureBar)}"><small>bar(a)</small></label><label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>压力恢复系数 FL（可选）<input id="valve-fl" type="number" step="0.01" value="${optionalNumber(state.fl)}"></label><label class="valve-gas-field"${isLiquid ? " hidden" : ""}>压缩因子 Z<input id="valve-z" type="number" step="0.01" value="${state.zFactor}"></label><label class="valve-gas-field"${isLiquid ? " hidden" : ""}>分子量 M<input id="valve-mw" type="number" step="0.01" value="${state.molecularWeight}"><small>kg/kmol</small></label><label class="valve-gas-field"${isLiquid ? " hidden" : ""}>压差比系数 xT（可选）<input id="valve-xt" type="number" step="0.01" value="${optionalNumber(state.xt)}"></label><label class="valve-gas-field"${isLiquid ? " hidden" : ""}>比热比修正 Fγ（可选）<input id="valve-fgamma" type="number" step="0.01" value="${optionalNumber(state.fGamma)}"><small>默认 1</small></label><label>管件修正系数 Fp<input id="valve-fp" type="number" step="0.01" value="${state.fp}"><small>默认 1</small></label></div><div class="pe-actions"><button class="button primary" id="valve-calculate">计算</button><button class="button secondary" id="valve-reset">恢复默认值</button></div><div class="feedback" id="valve-feedback" aria-live="polite">请输入参数后计算。</div></div><div class="pe-output" id="valve-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

export function renderControlValve(storage: ToolStorage): string {
  return `${renderValveForm(storage)}${renderProcessGuidance(VALVE_GUIDANCE)}`;
}

const CHOKED_LABEL: Record<ChokedStatus, string> = { yes: "是", no: "否", "not-evaluated": "未评估" };

export function renderControlValveResult(result: ValveResult, unit: "Cv" | "Kv", medium: ValveMedium, mode: ValveMode): string {
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const missing = result.missingInputs.length > 0 ? `<p>未提供：${result.missingInputs.map(escapeHtml).join("、")}，相关评估未进行。</p>` : "";
  const otherUnit = unit === "Cv" ? "Kv" : "Cv";
  const convert = (value: number | null) => (value === null ? null : unit === "Cv" ? value / 1.156 : value * 1.156);
  const requiredOther = convert(result.requiredCoefficient);
  const flowUnit = medium === "liquid" ? "m³/h" : "Nm³/h";
  const chokedClass = result.choked === "yes" ? "warning" : "";
  const ratioText = result.capacityRatio !== null ? formatToolNumber(result.capacityRatio, 3) : "—";
  const marginText = result.capacityMarginPercent !== null ? `${formatToolNumber(result.capacityMarginPercent, 1)}%` : "—";
  return `<div class="pe-result-heading"><div><p class="eyebrow">IEC 60534-2-1 / ${medium === "liquid" ? "LIQUID" : "GAS"}</p><h2>${mode === "size" ? "所需流通系数" : "可通过流量"}</h2><p>${escapeHtml(result.formulaNote)}</p></div><button class="button secondary" data-copy-result>复制结果</button></div><div class="pe-metrics">${result.requiredCoefficient !== null ? `<div><small>所需 ${unit}</small><strong>${formatToolNumber(result.requiredCoefficient, 4)}</strong></div><div><small>所需 ${otherUnit}</small><strong>${formatToolNumber(requiredOther, 4)}</strong></div>` : ""}${result.predictedFlow !== null ? `<div><small>可通过流量</small><strong>${formatToolNumber(result.predictedFlow, 4)} ${flowUnit}</strong></div>` : ""}<div><small>可用/所需系数比</small><strong>${ratioText}</strong></div><div><small>容量裕量</small><strong>${marginText}</strong></div></div><div class="pe-result-grid"><section><h3>流动状态</h3><p>压差比 x = ΔP/P1：${result.deltaPRatio !== null ? formatToolNumber(result.deltaPRatio, 4) : "—"}</p>${result.expansionFactor !== null ? `<p>膨胀系数 Y：${formatToolNumber(result.expansionFactor, 4)}</p>` : ""}<p>有效 sizing 压差：${formatToolNumber(result.effectiveDeltaPBar, 4)} bar</p><p class="${chokedClass}">阻塞流状态：${CHOKED_LABEL[result.choked]}</p>${result.cavitationRisk !== null ? `<p>汽蚀/闪蒸风险：${result.cavitationRisk ? "汽蚀风险" : "闪蒸风险"}</p>` : ""}</section><section><h3>公式与边界</h3><p>${escapeHtml(result.formulaNote)}</p>${missing}<p>容量裕量仅表示已有流通能力相对计算需求的余量，不代表阀门开度、可调比或控制性能保证。</p></section></div>${warnings ? `<div class="pe-notes warning"><strong>提示</strong><ul>${warnings}</ul></div>` : ""}<div class="pe-notes"><strong>适用范围</strong><p>单相液体或单相气体的初步选型估算；不支持两相流、湿蒸汽、浆液与非牛顿流体；正式选型应按阀门制造商额定系数、可调比与噪声校核复核。</p></div>`;
}
