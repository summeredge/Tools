import { escapeHtml, formatToolNumber, renderProcessGuidance, type ProcessGuidance, type ToolStorage } from "../runtime";
import type { PrdsMode, PrdsResult } from "./logic";

export type PrdsFormState = {
  mode: PrdsMode;
  p1Bar: number;
  t1C: number;
  p2Bar: number;
  steamFlowKgH: number;
  sprayTempC: number;
  sprayPressureBar: number | "";
  targetTempC: number | "";
  targetSuperheatK: number | "";
  sprayFlowKgH: number;
};

export const DEFAULT_PRDS_FORM: PrdsFormState = {
  mode: "throttle",
  p1Bar: 10,
  t1C: 300,
  p2Bar: 2,
  steamFlowKgH: 10000,
  sprayTempC: 150,
  sprayPressureBar: "",
  targetTempC: "",
  targetSuperheatK: 5,
  sprayFlowKgH: 500,
};

export const PRDS_GUIDANCE: ProcessGuidance = {
  assumptions: [
    "减压阀视为绝热节流，h2 = h1；喷水混合忽略环境散热。",
    "所有压力均为绝对压力；水焓与蒸汽焓均来自同一 IAPWS-IF97 实现。",
    "两相区使用饱和液焓与饱和蒸汽焓计算干度，过热区通过 P-h 反算温度。",
  ],
  applicability: [
    "适用于干饱和或过热蒸汽的减压估算，以及喷水减温的能量平衡估算。",
    "模式 B 目标温度默认建议为饱和温度以上 5 °C。",
  ],
  limitations: [
    "不计算减压阀 Cv、喷嘴尺寸、雾化粒径、蒸发距离、管径、噪声、水质或设备机械强度。",
    "目标过热度低于 3 K 时提示夹带水风险；喷水压力不高于减温器处蒸汽压力时拒绝。",
    "结果为热力平衡估算，正式设计应按适用标准复核减温器结构与控制回路。",
  ],
};

function options(values: Array<[string, string]>, selected: string): string {
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function optionalNumber(value: number | ""): string {
  return value === "" ? "" : String(value);
}

function renderPrdsForm(storage: ToolStorage): string {
  const state = storage.read<PrdsFormState>("workbench:steam-prds", DEFAULT_PRDS_FORM);
  const mode = state.mode ?? "throttle";
  const showSteam = mode !== "throttle";
  const showTarget = mode === "target-temperature";
  const showWater = mode === "fixed-water";
  return `<div class="process-tool prds-tool"><div class="pe-input-section"><div class="pe-form-grid"><label>计算模式<select id="prds-mode">${options([["throttle", "仅减压"], ["target-temperature", "给定目标温度 → 喷水量"], ["fixed-water", "给定喷水量 → 出口状态"]], mode)}</select></label><label>上游绝压 P1<input id="prds-p1" type="number" value="${state.p1Bar}"><small>bar(a)</small></label><label>上游温度 T1<input id="prds-t1" type="number" value="${state.t1C}"><small>°C</small></label><label>下游绝压 P2<input id="prds-p2" type="number" value="${state.p2Bar}"><small>bar(a)</small></label><label class="prds-steam-field"${showSteam ? "" : " hidden"}>蒸汽质量流量<input id="prds-steam-flow" type="number" value="${state.steamFlowKgH}"><small>kg/h</small></label><label class="prds-steam-field"${showSteam ? "" : " hidden"}>喷水温度<input id="prds-spray-temp" type="number" value="${state.sprayTempC}"><small>°C</small></label><label class="prds-steam-field"${showSteam ? "" : " hidden"}>喷水压力（可选）<input id="prds-spray-pressure" type="number" value="${optionalNumber(state.sprayPressureBar)}"><small>bar(a)，需高于减温器处蒸汽压力</small></label><label class="prds-target-field"${showTarget ? "" : " hidden"}>目标出口温度（可选）<input id="prds-target-temp" type="number" value="${optionalNumber(state.targetTempC)}"><small>°C</small></label><label class="prds-target-field"${showTarget ? "" : " hidden"}>目标过热度（可选）<input id="prds-target-superheat" type="number" value="${optionalNumber(state.targetSuperheatK)}"><small>K，默认建议 5</small></label><label class="prds-water-field"${showWater ? "" : " hidden"}>喷水质量流量<input id="prds-spray-flow" type="number" value="${state.sprayFlowKgH}"><small>kg/h</small></label></div><div class="pe-actions"><button class="button primary" id="prds-calculate">计算</button><button class="button secondary" id="prds-reset">恢复默认值</button></div><div class="feedback" id="prds-feedback" aria-live="polite">请输入参数后计算。</div></div><div class="pe-output" id="prds-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

export function renderSteamPrds(storage: ToolStorage): string {
  return `${renderPrdsForm(storage)}${renderProcessGuidance(PRDS_GUIDANCE)}`;
}

function fmtTemp(valueK: number | null): string {
  return valueK === null ? "—" : `${formatToolNumber(valueK - 273.15, 2)} °C`;
}

export function renderSteamPrdsResult(result: PrdsResult): string {
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const isThrottle = result.mode === "throttle";
  const qualityLine = result.outletQuality !== null ? `<p>干度 x：${formatToolNumber(result.outletQuality, 4)}</p>` : "";
  return `<div class="pe-result-heading"><div><p class="eyebrow">STEAM PRDS / ${escapeHtml(result.mode)}</p><h2>${isThrottle ? "减压结果" : "减压 + 喷水减温结果"}</h2><p>绝热节流 h₂ = h₁${isThrottle ? "" : "，喷水绝热混合"}</p></div><button class="button secondary" data-copy-result>复制结果</button></div><div class="pe-metrics"><div><small>上游焓 h₁</small><strong>${formatToolNumber(result.upstreamEnthalpyKjKg, 2)} kJ/kg</strong></div><div><small>节流后温度</small><strong>${fmtTemp(result.throttledTemperatureK)}</strong></div><div><small>P2 饱和温度</small><strong>${fmtTemp(result.p2SaturationTemperatureK)}</strong></div><div><small>出口温度</small><strong>${fmtTemp(result.outletTemperatureK)}</strong></div></div><div class="pe-result-grid"><section><h3>出口状态</h3><p>出口过热度：${result.outletSuperheatK !== null ? `${formatToolNumber(result.outletSuperheatK, 2)} K` : "—"}</p><p>相态：${result.outletPhase}</p>${qualityLine}${result.sprayFlowKgs !== null ? `<p>${result.mode === "target-temperature" ? "所需喷水量" : "实际喷水量"}：${formatToolNumber(result.sprayFlowKgs * 3600, 2)} kg/h</p>` : ""}${result.waterSteamRatio !== null ? `<p>水汽比：${formatToolNumber(result.waterSteamRatio * 100, 3)}%</p>` : ""}${result.totalOutletFlowKgs !== null ? `<p>总出口流量：${formatToolNumber(result.totalOutletFlowKgs * 3600, 2)} kg/h</p>` : ""}</section><section><h3>能量平衡</h3><p>上游密度：${formatToolNumber(result.upstreamDensityKgM3, 3)} kg/m³</p>${result.energyResidual !== null ? `<p>能量平衡残差：${formatToolNumber(result.energyResidual, 3)}</p>` : ""}<p>节流后相态：${result.throttledPhase}</p>${result.throttledQuality !== null ? `<p>节流后干度：${formatToolNumber(result.throttledQuality, 4)}</p>` : ""}</section></div>${warnings ? `<div class="pe-notes warning"><strong>工程风险提示</strong><ul>${warnings}</ul></div>` : ""}<div class="pe-notes"><strong>适用范围</strong><p>仅覆盖减压与喷水减温的热力平衡估算；不计算减压阀 Cv、喷嘴尺寸、雾化粒径、蒸发距离、管径、噪声、水质或设备机械强度。</p></div>`;
}
