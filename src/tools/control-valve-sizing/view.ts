import { CV_PER_KV, GAS_NORMAL_PRESSURE_BAR, type ChokedStatus, type ValveGasPreset, type ValveLiquidPreset, type ValveMedium, type ValveMode, type ValveResult } from "./logic";
import { escapeHtml, formatToolNumber, renderProcessGuidance, type ProcessGuidance, type ToolStorage } from "../runtime";

export type ValveFormState = {
  medium: ValveMedium;
  mode: ValveMode;
  coefficientUnit: "Cv" | "Kv";
  liquidPreset: ValveLiquidPreset;
  gasPreset: ValveGasPreset;
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
  flp: number | "";
  fp: number;
  zFactor: number;
  molecularWeight: number;
  specificHeatRatio: number;
  xt: number | "";
  xtp: number | "";
};

export const DEFAULT_VALVE_FORM: ValveFormState = {
  medium: "liquid",
  mode: "size",
  coefficientUnit: "Kv",
  liquidPreset: "water",
  gasPreset: "air",
  flowValue: 10,
  ratedCoefficient: 16,
  p1Bar: 2,
  p2Bar: 1,
  safetyFactor: 1,
  temperatureC: 20,
  relativeDensity: 0.9982,
  vaporPressureBar: 0.0234,
  criticalPressureBar: 220.64,
  fl: "",
  flp: "",
  fp: 1,
  zFactor: 1,
  molecularWeight: 28.9647,
  specificHeatRatio: 1.4,
  xt: "",
  xtp: "",
};

export const VALVE_GUIDANCE: ProcessGuidance = {
  assumptions: [
    "单相牛顿流体、稳态流动；P1、P2、Pv 和 Pc 均使用绝对压力。",
    "液体按 IEC 60534-2-1；气体 Qn 固定按 0°C、1.01325 bar(a) 的 Nm³/h 计算。",
    "Fp=1 时使用裸阀 FL/xT；Fp<1 时必须改用安装条件组合系数 FLP/xTP。",
    "选型裕量系数只放大计算需求，不反推阀门开度。",
  ],
  applicability: [
    "用于单相液体和单相气体的控制阀容量初步核对。",
    "水预设通过项目现有 IF97 计算入口密度与蒸气压；常用气体预设仅提供低压初值。",
  ],
  limitations: [
    "不支持湿蒸汽、两相流、浆液、非牛顿流体、液体低 Reynolds 数修正或气液混合物。",
    "不包含噪声、执行机构、可调比、固有/安装流量特性及阀门开度计算。",
    "FL、FLP、xT、xTP 必须优先使用制造商对应阀型、内件、流向和开度的数据，不提供通用默认值。",
    "容量裕量仅表示已有流通能力相对计算需求的余量，不代表控制性能或最终选型结论。",
  ],
};

function options(values: Array<[string, string]>, selected: string): string {
  return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function optionalNumber(value: number | ""): string {
  return value === "" ? "" : String(value);
}

function readValveState(storage: ToolStorage): ValveFormState {
  const stored = storage.read<Partial<ValveFormState>>("workbench:control-valve-sizing", {});
  const hasStoredState = Object.keys(stored).length > 0;
  return {
    ...DEFAULT_VALVE_FORM,
    ...stored,
    liquidPreset: stored.liquidPreset ?? (hasStoredState ? "custom" : DEFAULT_VALVE_FORM.liquidPreset),
    gasPreset: stored.gasPreset ?? (hasStoredState ? "custom" : DEFAULT_VALVE_FORM.gasPreset),
    specificHeatRatio: stored.specificHeatRatio ?? DEFAULT_VALVE_FORM.specificHeatRatio,
    flp: stored.flp ?? "",
    xtp: stored.xtp ?? "",
  };
}

function renderParameterHelp(): string {
  return `<details class="pe-notes valve-parameter-help"><summary><strong>参数来源与推荐设置</strong></summary>
    <ul>
      <li><strong>选型裕量系数：</strong>建议先按 1.0 计算，再从制造商可用 Kvs/Cv 规格中选下一档；不要无条件放大到 1.2～1.5。</li>
      <li><strong>FL：</strong>裸阀液体压力恢复系数。随阀型、内件、流向和开度变化；未知时留空，阻塞流显示“未评估”。</li>
      <li><strong>FLP：</strong>阀门带紧邻异径管件时的组合压力恢复系数。Fp&lt;1 时必须使用 FLP，不能用 FL 代替。</li>
      <li><strong>xT：</strong>裸阀气体额定压差比系数。必须来自制造商数据；未知时留空。</li>
      <li><strong>xTP：</strong>带附接管件时的安装条件压差比系数。Fp&lt;1 时必须使用 xTP。</li>
      <li><strong>Fp：</strong>无紧邻异径管、扩径管、弯头或三通时取 1；存在附接管件时应由安装几何计算或制造商软件确定。</li>
      <li><strong>气体 k：</strong>比热比。空气/氮气常温附近约 1.4，CO₂ 和天然气近似约 1.3；应按实际温压和组成复核。</li>
      <li><strong>Z：</strong>低压理想气体可暂取 1；高压、接近临界区或高精度选型必须使用实际工况压缩因子。</li>
      <li><strong>标准流量：</strong>本工具的 Nm³/h 固定指 0°C、${GAS_NORMAL_PRESSURE_BAR} bar(a)，不能与 15°C/20°C 标准状态直接混用。</li>
    </ul>
  </details>`;
}

function renderValveForm(storage: ToolStorage): string {
  const state = readValveState(storage);
  const isLiquid = state.medium !== "gas";
  const isSize = state.mode !== "predict";
  const hasFittings = state.fp < 0.999999;
  return `<div class="process-tool valve-tool"><div class="pe-input-section">
    <div class="pe-form-grid">
      <label>介质类型<select id="valve-medium">${options([["liquid", "液体"], ["gas", "气体"]], state.medium)}</select></label>
      <label>计算模式<select id="valve-mode">${options([["size", "已知工况 → 所需系数"], ["predict", "已知系数 → 可通过流量"]], state.mode)}</select></label>
      <label>系数类型<select id="valve-coefficient-unit">${options([["Kv", "Kv"], ["Cv", "Cv"]], state.coefficientUnit)}</select><small>Cv = 1.156 × Kv</small></label>

      <label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>液体预设<select id="valve-liquid-preset">${options([["water", "水（IF97 自动物性）"], ["custom", "自定义液体"]], state.liquidPreset)}</select></label>
      <label class="valve-gas-field"${isLiquid ? " hidden" : ""}>气体预设<select id="valve-gas-preset">${options([["air", "空气"], ["nitrogen", "氮气"], ["oxygen", "氧气"], ["carbon-dioxide", "二氧化碳"], ["natural-gas", "天然气近似"], ["custom", "自定义气体"]], state.gasPreset)}</select></label>

      <label class="valve-size-field"${isSize ? "" : " hidden"}>流量<input id="valve-flow" type="number" value="${state.flowValue}">
        <small class="valve-flow-unit">${isLiquid ? "m³/h" : `Nm³/h（0°C、${GAS_NORMAL_PRESSURE_BAR} bar(a)）`}</small>
      </label>
      <label>已有/拟选额定系数<input id="valve-rated" type="number" value="${state.ratedCoefficient}">
        <small class="valve-rated-unit">${state.coefficientUnit}；正算时用于计算容量裕量，反算时为必填</small>
      </label>

      <label>上游绝压 P1<input id="valve-p1" type="number" value="${state.p1Bar}"><small>bar(a)，禁止输入表压</small></label>
      <label>下游绝压 P2<input id="valve-p2" type="number" value="${state.p2Bar}"><small>bar(a)，必须小于 P1</small></label>
      <label>选型裕量系数<input id="valve-safety" type="number" step="0.05" value="${state.safetyFactor}">
        <small>建议先用 1.0，再选制造商下一档 Kvs/Cv</small>
      </label>
      <label>入口温度<input id="valve-temperature" type="number" value="${state.temperatureC}"><small>°C</small></label>

      <label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>相对密度 G<input id="valve-relative-density" type="number" step="0.0001" value="${state.relativeDensity}">
        <small>水预设自动计算；自定义液体按工况密度/1000</small>
      </label>
      <label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>蒸气压 Pv<input id="valve-vapor-pressure" type="number" step="any" value="${optionalNumber(state.vaporPressureBar)}">
        <small>bar(a)；缺失时不评估液体阻塞、汽蚀或闪蒸</small>
      </label>
      <label class="valve-liquid-field"${isLiquid ? "" : " hidden"}>临界压力 Pc<input id="valve-critical-pressure" type="number" step="any" value="${optionalNumber(state.criticalPressureBar)}">
        <small>bar(a)；从可靠物性资料获取</small>
      </label>

      <label class="valve-liquid-field valve-bare-liquid-factor"${isLiquid && !hasFittings ? "" : " hidden"}>压力恢复系数 FL<input id="valve-fl" type="number" step="0.01" value="${optionalNumber(state.fl)}">
        <small>裸阀参数；制造商数据，未知时留空</small>
      </label>
      <label class="valve-liquid-field valve-installed-liquid-factor"${isLiquid && hasFittings ? "" : " hidden"}>组合压力恢复系数 FLP<input id="valve-flp" type="number" step="0.01" value="${optionalNumber(state.flp)}">
        <small>Fp&lt;1 时使用；不能用裸阀 FL 代替</small>
      </label>

      <label class="valve-gas-field"${isLiquid ? " hidden" : ""}>压缩因子 Z<input id="valve-z" type="number" step="0.01" value="${state.zFactor}">
        <small>低压初值可取 1，高压必须复核</small>
      </label>
      <label class="valve-gas-field"${isLiquid ? " hidden" : ""}>分子量 M<input id="valve-mw" type="number" step="0.0001" value="${state.molecularWeight}">
        <small>kg/kmol；气体预设可自动填充</small>
      </label>
      <label class="valve-gas-field"${isLiquid ? " hidden" : ""}>比热比 k<input id="valve-k" type="number" step="0.001" value="${state.specificHeatRatio}">
        <small>Fγ = k/1.4；应按实际温压与组成复核</small>
      </label>
      <label class="valve-gas-field valve-bare-gas-factor"${!isLiquid && !hasFittings ? "" : " hidden"}>压差比系数 xT<input id="valve-xt" type="number" step="0.01" value="${optionalNumber(state.xt)}">
        <small>裸阀制造商参数；未知时留空</small>
      </label>
      <label class="valve-gas-field valve-installed-gas-factor"${!isLiquid && hasFittings ? "" : " hidden"}>安装条件压差比 xTP<input id="valve-xtp" type="number" step="0.01" value="${optionalNumber(state.xtp)}">
        <small>Fp&lt;1 时使用；不能用裸阀 xT 代替</small>
      </label>

      <label>管道几何修正系数 Fp<input id="valve-fp" type="number" step="0.01" value="${state.fp}">
        <small>无紧邻附接管件时取 1；Fp&lt;1 时需 FLP/xTP</small>
      </label>
    </div>
    <div class="pe-actions"><button class="button primary" id="valve-calculate">计算</button><button class="button secondary" id="valve-reset">恢复默认值</button></div>
    <div class="feedback" id="valve-feedback" aria-live="polite">请输入参数后计算。</div>
    ${renderParameterHelp()}
  </div><div class="pe-output" id="valve-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

export function renderControlValve(storage: ToolStorage): string {
  return `${renderValveForm(storage)}${renderProcessGuidance(VALVE_GUIDANCE)}`;
}

const CHOKED_LABEL: Record<ChokedStatus, string> = { yes: "是", no: "否", "not-evaluated": "未评估" };

export function renderControlValveResult(result: ValveResult, unit: "Cv" | "Kv", medium: ValveMedium, mode: ValveMode): string {
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const missing = result.missingInputs.length > 0 ? `<p>未提供：${result.missingInputs.map(escapeHtml).join("、")}，相关评估未进行。</p>` : "";
  const otherUnit = unit === "Cv" ? "Kv" : "Cv";
  const requiredOther = result.requiredCoefficient === null ? null : unit === "Cv"
    ? result.requiredCoefficient / CV_PER_KV
    : result.requiredCoefficient * CV_PER_KV;
  const flowUnit = medium === "liquid" ? "m³/h" : `Nm³/h@0°C`;
  const chokedClass = result.choked === "yes" ? "warning" : "";
  const ratioText = result.capacityRatio !== null ? formatToolNumber(result.capacityRatio, 3) : "—";
  const marginText = result.capacityMarginPercent !== null ? `${formatToolNumber(result.capacityMarginPercent, 1)}%` : "—";
  const pipingText = result.pipingModel === "bare-valve" ? "裸阀/无紧邻附接管件" : "带附接管件的安装条件";
  return `<div class="pe-result-heading"><div><p class="eyebrow">IEC 60534-2-1 / ${medium === "liquid" ? "LIQUID" : "GAS"}</p>
    <h2>${mode === "size" ? "所需流通系数" : "可通过流量"}</h2><p>${escapeHtml(result.formulaNote)}</p></div>
    <button class="button secondary" data-copy-result>复制结果</button></div>
    <div class="pe-metrics">
      ${result.requiredCoefficient !== null ? `<div><small>所需 ${unit}</small><strong>${formatToolNumber(result.requiredCoefficient, 4)}</strong></div><div><small>所需 ${otherUnit}</small><strong>${formatToolNumber(requiredOther, 4)}</strong></div>` : ""}
      ${result.predictedFlow !== null ? `<div><small>可通过流量</small><strong>${formatToolNumber(result.predictedFlow, 4)} ${flowUnit}</strong></div>` : ""}
      <div><small>可用/所需系数比</small><strong>${ratioText}</strong></div>
      <div><small>容量裕量</small><strong>${marginText}</strong></div>
    </div>
    <div class="pe-result-grid"><section><h3>流动状态</h3>
      <p>安装条件：${pipingText}</p>
      <p>实际压差比 x：${result.deltaPRatio !== null ? formatToolNumber(result.deltaPRatio, 4) : "—"}</p>
      ${result.sizingPressureRatio !== null ? `<p>用于 sizing 的压差比：${formatToolNumber(result.sizingPressureRatio, 4)}</p>` : ""}
      ${result.expansionFactor !== null ? `<p>膨胀系数 Y：${formatToolNumber(result.expansionFactor, 4)}</p>` : ""}
      ${result.specificHeatRatio !== null ? `<p>比热比 k：${formatToolNumber(result.specificHeatRatio, 4)}</p>` : ""}
      ${result.usedRecoveryFactor !== null ? `<p>采用压力恢复系数：${formatToolNumber(result.usedRecoveryFactor, 4)}</p>` : ""}
      ${result.usedPressureRatioFactor !== null ? `<p>采用压差比系数：${formatToolNumber(result.usedPressureRatioFactor, 4)}</p>` : ""}
      <p>有效 sizing 压差：${formatToolNumber(result.effectiveDeltaPBar, 4)} bar</p>
      <p class="${chokedClass}">阻塞流状态：${CHOKED_LABEL[result.choked]}</p>
      ${result.cavitationRisk !== null ? `<p>汽蚀/闪蒸风险：${result.cavitationRisk ? "汽蚀风险" : "闪蒸风险"}</p>` : ""}
    </section><section><h3>公式与边界</h3>
      <p>${escapeHtml(result.formulaNote)}</p>${missing}
      <p>容量裕量只表示额定流通能力相对计算需求的余量，不代表阀门开度、可调比或控制性能。</p>
      <p>正式选型还应校核阀型、阀径、流量特性、可调比、噪声、出口速度和执行机构。</p>
    </section></div>
    ${warnings ? `<div class="pe-notes warning"><strong>提示</strong><ul>${warnings}</ul></div>` : ""}
    <div class="pe-notes"><strong>适用范围</strong><p>仅用于单相液体或单相气体容量初步估算；制造商 FL/FLP/xT/xTP 数据和正式选型软件结果优先。</p></div>`;
}
