import { escapeHtml, formatToolNumber, type ToolStorage } from "../runtime";
import type { GasFlowResult, MoistureConversion } from "./logic";

export type GasFlowFormState = {
  flowValue: number; flowUnit: "m3/h" | "L/min" | "m3/s"; flowBasis: "actual" | "standard";
  actualTemperature: number; actualTemperatureUnit: "C" | "K"; actualPressure: number; pressureUnit: "kPa" | "bar" | "MPa";
  pressureMode: "absolute" | "gauge"; atmosphericPressure: number;
  standardTemperature: number; standardTemperatureUnit: "C" | "K"; standardPressure: number;
  zActual: number; zStandard: number; molecularWeight: number; moistureConversion: MoistureConversion; moistureFraction: number;
};

export const DEFAULT_GAS_FLOW_FORM: GasFlowFormState = {
  flowValue: 100, flowUnit: "m3/h", flowBasis: "actual", actualTemperature: 100, actualTemperatureUnit: "C",
  actualPressure: 200, pressureUnit: "kPa", pressureMode: "absolute", atmosphericPressure: 101.325,
  standardTemperature: 0, standardTemperatureUnit: "C", standardPressure: 101.325,
  zActual: 1, zStandard: 1, molecularWeight: 28.97, moistureConversion: "none", moistureFraction: 0,
};

function selectOptions(values: Array<[string, string]>, selected: string): string {
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

export function renderGasFlow(storage: ToolStorage): string {
  const state = storage.read<GasFlowFormState>("workbench:gas-flow", DEFAULT_GAS_FLOW_FORM);
  return `<div class="process-tool gas-flow-tool"><div class="pe-input-section"><div class="pe-form-grid"><label>输入流量<input id="gas-flow-value" type="number" value="${state.flowValue}"></label><label>流量单位<select id="gas-flow-unit">${selectOptions([["m3/h", "m³/h"], ["L/min", "L/min"], ["m3/s", "m³/s"]], state.flowUnit)}</select></label><label>流量基准<select id="gas-flow-basis">${selectOptions([["actual", "实际工况"], ["standard", "标准工况"]], state.flowBasis)}</select></label><label>实际温度<input id="gas-actual-temperature" type="number" value="${state.actualTemperature}"><select id="gas-actual-temperature-unit">${selectOptions([["C", "°C"], ["K", "K"]], state.actualTemperatureUnit)}</select></label><label>实际压力<input id="gas-actual-pressure" type="number" value="${state.actualPressure}"><select id="gas-pressure-unit">${selectOptions([["kPa", "kPa"], ["bar", "bar"], ["MPa", "MPa"]], state.pressureUnit)}</select></label><label>实际压力类型<select id="gas-pressure-mode">${selectOptions([["absolute", "绝压"], ["gauge", "表压"]], state.pressureMode)}</select></label><label>当地大气压（表压时使用）<input id="gas-atmospheric-pressure" type="number" value="${state.atmosphericPressure}"> <small>kPa</small></label><label>标准温度<input id="gas-standard-temperature" type="number" value="${state.standardTemperature}"><select id="gas-standard-temperature-unit">${selectOptions([["C", "°C"], ["K", "K"]], state.standardTemperatureUnit)}</select></label><label>标准绝压<input id="gas-standard-pressure" type="number" value="${state.standardPressure}"> <small>kPa</small></label><label>实际状态 Z<input id="gas-z-actual" type="number" step="any" value="${state.zActual}"></label><label>标准状态 Z<input id="gas-z-standard" type="number" step="any" value="${state.zStandard}"></label><label>平均分子量（可选）<input id="gas-molecular-weight" type="number" step="any" value="${state.molecularWeight}"><small>kg/kmol</small></label><label>湿基/干基换算<select id="gas-moisture-conversion">${selectOptions([["none", "不换算"], ["wet-to-dry", "湿基 → 干基"], ["dry-to-wet", "干基 → 湿基"]], state.moistureConversion)}</select></label><label>水蒸气摩尔分数/体积分数<input id="gas-moisture-fraction" type="number" min="0" max="1" step="any" value="${state.moistureFraction}"></label></div><div class="pe-actions"><button class="button primary" id="gas-flow-calculate">计算</button><button class="button secondary" id="gas-flow-reset">恢复默认值</button></div><div class="feedback" id="gas-flow-feedback" aria-live="polite">请输入状态点后计算。</div></div><div class="pe-output" id="gas-flow-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

export function renderGasFlowResult(result: GasFlowResult): string {
  const inputLabel = result.inputFlowBasis === "actual" ? "实际流量" : "标准流量";
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  return `<div class="pe-result-heading"><div><p class="eyebrow">LOCAL CALCULATION / IDEAL-GAS STATE RELATION</p><h2>工况/标况换算结果</h2><p>输入：${inputLabel} ${formatToolNumber(result.inputFlowM3s * 3600)} m³/h</p></div><button class="button secondary" data-copy-result>复制结果</button></div><div class="pe-metrics"><div><small>实际体积流量</small><strong>${formatToolNumber(result.actualFlowM3s * 3600)} m³/h</strong></div><div><small>标准体积流量</small><strong>${formatToolNumber(result.standardFlowM3s * 3600)} Nm³/h</strong></div><div><small>摩尔流量</small><strong>${formatToolNumber(result.molarFlowKmolH)} kmol/h</strong></div><div><small>质量流量</small><strong>${result.massFlowKgH === null ? "未输入分子量" : `${formatToolNumber(result.massFlowKgH)} kg/h`}</strong></div></div><div class="pe-result-grid"><section><h3>绝压与绝对温度中间值</h3><p>实际绝压：${formatToolNumber(result.actualPressurePa / 1000)} kPa</p><p>标准绝压：${formatToolNumber(result.standardPressurePa / 1000)} kPa</p><p>实际温度：${formatToolNumber(result.actualTemperatureK)} K</p><p>标准温度：${formatToolNumber(result.standardTemperatureK)} K</p><p>Zactual / Zstd：${formatToolNumber(result.zActual)} / ${formatToolNumber(result.zStandard)}</p></section><section><h3>计算依据</h3><p class="formula">${escapeHtml(result.formula)}</p><p>${escapeHtml(result.moistureDescription)}</p>${result.moistureAdjustedFlowM3h === null ? "" : `<p>含水修正后的输入基准流量：${formatToolNumber(result.moistureAdjustedFlowM3h)} m³/h</p>`}</section></div><div class="pe-notes"><strong>适用边界</strong><ul>${warnings}</ul></div></div>`;
}
