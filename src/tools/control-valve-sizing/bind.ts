import {
  calculateGasValve,
  calculateLiquidValve,
  convertCoefficient,
  GAS_PRESET_VALUES,
  waterValveProperties,
  ValveSizingError,
  type ValveGasPreset,
} from "./logic";
import { DEFAULT_VALVE_FORM, renderControlValveResult, type ValveFormState } from "./view";
import type { ToolRuntime } from "../runtime";

function numberValue(id: string): number {
  return Number.parseFloat(document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "");
}

function optionalNumberValue(id: string): number | undefined {
  const raw = document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
  if (raw.trim() === "") return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function stringValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? "";
}

function setInputValue(form: HTMLElement, id: string, value: number | string): void {
  const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (input) input.value = String(value);
}

function setDisabled(form: HTMLElement, ids: string[], disabled: boolean): void {
  ids.forEach((id) => {
    const input = form.querySelector<HTMLInputElement>(`#${id}`);
    if (input) input.disabled = disabled;
  });
}

function collectAndCompute() {
  const medium = stringValue("valve-medium") as ValveFormState["medium"];
  const mode = stringValue("valve-mode") as ValveFormState["mode"];
  const unit = stringValue("valve-coefficient-unit") as ValveFormState["coefficientUnit"];
  const flow = numberValue("valve-flow");
  const rated = numberValue("valve-rated");
  const common = {
    flowM3h: undefined as number | undefined,
    flowNm3h: undefined as number | undefined,
    ratedCoefficient: undefined as number | undefined,
    p1Bar: numberValue("valve-p1"),
    p2Bar: numberValue("valve-p2"),
    safetyFactor: numberValue("valve-safety"),
    fp: numberValue("valve-fp"),
  };
  if (mode === "size") {
    if (medium === "liquid") common.flowM3h = flow;
    else common.flowNm3h = flow;
    if (Number.isFinite(rated) && rated > 0) common.ratedCoefficient = rated;
  } else {
    common.ratedCoefficient = rated;
  }

  if (medium === "liquid") {
    const temperatureK = numberValue("valve-temperature") + 273.15;
    const preset = stringValue("valve-liquid-preset") as ValveFormState["liquidPreset"];
    const water = preset === "water" ? waterValveProperties(common.p1Bar, temperatureK) : null;
    return {
      result: calculateLiquidValve({
        ...common,
        temperatureK,
        relativeDensity: water?.relativeDensity ?? numberValue("valve-relative-density"),
        vaporPressureBar: water?.vaporPressureBar ?? optionalNumberValue("valve-vapor-pressure"),
        criticalPressureBar: water?.criticalPressureBar ?? optionalNumberValue("valve-critical-pressure"),
        fl: optionalNumberValue("valve-fl"),
        flp: optionalNumberValue("valve-flp"),
      }, unit),
      unit,
      medium,
      mode,
    };
  }

  return {
    result: calculateGasValve({
      ...common,
      temperatureK: numberValue("valve-temperature") + 273.15,
      zFactor: numberValue("valve-z"),
      molecularWeight: numberValue("valve-mw"),
      specificHeatRatio: numberValue("valve-k"),
      xt: optionalNumberValue("valve-xt"),
      xtp: optionalNumberValue("valve-xtp"),
    }, unit),
    unit,
    medium,
    mode,
  };
}

function formState(): ValveFormState {
  return {
    medium: stringValue("valve-medium") as ValveFormState["medium"],
    mode: stringValue("valve-mode") as ValveFormState["mode"],
    coefficientUnit: stringValue("valve-coefficient-unit") as ValveFormState["coefficientUnit"],
    liquidPreset: stringValue("valve-liquid-preset") as ValveFormState["liquidPreset"],
    gasPreset: stringValue("valve-gas-preset") as ValveFormState["gasPreset"],
    flowValue: numberValue("valve-flow"),
    ratedCoefficient: numberValue("valve-rated"),
    p1Bar: numberValue("valve-p1"),
    p2Bar: numberValue("valve-p2"),
    safetyFactor: numberValue("valve-safety"),
    temperatureC: numberValue("valve-temperature"),
    relativeDensity: numberValue("valve-relative-density"),
    vaporPressureBar: optionalNumberValue("valve-vapor-pressure") ?? "",
    criticalPressureBar: optionalNumberValue("valve-critical-pressure") ?? "",
    fl: optionalNumberValue("valve-fl") ?? "",
    flp: optionalNumberValue("valve-flp") ?? "",
    fp: numberValue("valve-fp"),
    zFactor: numberValue("valve-z"),
    molecularWeight: numberValue("valve-mw"),
    specificHeatRatio: numberValue("valve-k"),
    xt: optionalNumberValue("valve-xt") ?? "",
    xtp: optionalNumberValue("valve-xtp") ?? "",
  };
}

export function bindControlValve(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".valve-tool");
  const output = document.querySelector<HTMLElement>("#valve-output");
  const status = document.querySelector<HTMLElement>("#valve-feedback");
  if (!form || !output || !status) return;

  let coefficientUnit = stringValue("valve-coefficient-unit") as "Cv" | "Kv";

  const syncWaterPreset = (): void => {
    const isWater = stringValue("valve-liquid-preset") === "water";
    setDisabled(form, ["valve-relative-density", "valve-vapor-pressure", "valve-critical-pressure"], isWater);
    if (!isWater) return;
    try {
      const properties = waterValveProperties(numberValue("valve-p1"), numberValue("valve-temperature") + 273.15);
      setInputValue(form, "valve-relative-density", properties.relativeDensity.toFixed(6));
      setInputValue(form, "valve-vapor-pressure", properties.vaporPressureBar.toFixed(6));
      setInputValue(form, "valve-critical-pressure", properties.criticalPressureBar);
    } catch {
      // 计算按钮会给出完整中文错误；同步阶段不覆盖当前输入和提示。
    }
  };

  const applyGasPreset = (): void => {
    const preset = stringValue("valve-gas-preset") as ValveGasPreset;
    if (preset === "custom") return;
    const values = GAS_PRESET_VALUES[preset];
    setInputValue(form, "valve-mw", values.molecularWeight);
    setInputValue(form, "valve-k", values.specificHeatRatio);
    setInputValue(form, "valve-z", values.zFactor);
  };

  const syncVisibility = (): void => {
    const medium = stringValue("valve-medium");
    const mode = stringValue("valve-mode");
    const isLiquid = medium !== "gas";
    const isSize = mode !== "predict";
    const fp = numberValue("valve-fp");
    const hasFittings = Number.isFinite(fp) && fp < 0.999999;

    form.querySelectorAll<HTMLElement>(".valve-liquid-field").forEach((element) => { element.hidden = !isLiquid; });
    form.querySelectorAll<HTMLElement>(".valve-gas-field").forEach((element) => { element.hidden = isLiquid; });
    form.querySelectorAll<HTMLElement>(".valve-size-field").forEach((element) => { element.hidden = !isSize; });
    form.querySelectorAll<HTMLElement>(".valve-predict-field").forEach((element) => { element.hidden = isSize; });
    form.querySelectorAll<HTMLElement>(".valve-bare-liquid-factor").forEach((element) => { element.hidden = !isLiquid || hasFittings; });
    form.querySelectorAll<HTMLElement>(".valve-installed-liquid-factor").forEach((element) => { element.hidden = !isLiquid || !hasFittings; });
    form.querySelectorAll<HTMLElement>(".valve-bare-gas-factor").forEach((element) => { element.hidden = isLiquid || hasFittings; });
    form.querySelectorAll<HTMLElement>(".valve-installed-gas-factor").forEach((element) => { element.hidden = isLiquid || !hasFittings; });

    const flowUnit = form.querySelector<HTMLElement>(".valve-flow-unit");
    if (flowUnit) flowUnit.textContent = isLiquid ? "m³/h" : "Nm³/h（0°C、1.01325 bar(a)）";
    const ratedUnit = form.querySelector<HTMLElement>(".valve-rated-unit");
    if (ratedUnit) ratedUnit.textContent = `${stringValue("valve-coefficient-unit")}；正算时用于计算容量裕量，反算时为必填`;
    if (isLiquid) syncWaterPreset();
  };

  const calculate = (showError = true): void => {
    try {
      const { result, unit, medium, mode } = collectAndCompute();
      runtime.storage.write("workbench:control-valve-sizing", formState());
      output.innerHTML = renderControlValveResult(result, unit, medium, mode);
      output.querySelector("[data-copy-result]")?.addEventListener("click", () => void runtime.copyText(output.innerText, status));
      runtime.feedback(status, "计算完成", "ok");
    } catch (error) {
      if (showError) runtime.feedback(status, error instanceof ValveSizingError || error instanceof Error ? error.message : "输入无法计算，请检查数值。", "error");
    }
  };

  form.querySelector("#valve-medium")?.addEventListener("change", () => { syncVisibility(); calculate(false); });
  form.querySelector("#valve-mode")?.addEventListener("change", () => { syncVisibility(); calculate(false); });
  form.querySelector("#valve-coefficient-unit")?.addEventListener("change", () => {
    const nextUnit = stringValue("valve-coefficient-unit") as "Cv" | "Kv";
    const rated = numberValue("valve-rated");
    if (nextUnit !== coefficientUnit && Number.isFinite(rated) && rated > 0) {
      setInputValue(form, "valve-rated", convertCoefficient(rated, coefficientUnit, nextUnit));
    }
    coefficientUnit = nextUnit;
    syncVisibility();
    calculate(false);
  });
  form.querySelector("#valve-liquid-preset")?.addEventListener("change", () => { syncWaterPreset(); calculate(false); });
  form.querySelector("#valve-gas-preset")?.addEventListener("change", () => { applyGasPreset(); calculate(false); });
  form.querySelector("#valve-fp")?.addEventListener("input", () => { syncVisibility(); calculate(false); });
  ["valve-p1", "valve-temperature"].forEach((id) => {
    form.querySelector(`#${id}`)?.addEventListener("input", () => {
      if (stringValue("valve-medium") === "liquid" && stringValue("valve-liquid-preset") === "water") syncWaterPreset();
    });
  });

  form.querySelector("#valve-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#valve-reset")?.addEventListener("click", () => {
    const mapping: Record<keyof ValveFormState, string> = {
      medium: "valve-medium",
      mode: "valve-mode",
      coefficientUnit: "valve-coefficient-unit",
      liquidPreset: "valve-liquid-preset",
      gasPreset: "valve-gas-preset",
      flowValue: "valve-flow",
      ratedCoefficient: "valve-rated",
      p1Bar: "valve-p1",
      p2Bar: "valve-p2",
      safetyFactor: "valve-safety",
      temperatureC: "valve-temperature",
      relativeDensity: "valve-relative-density",
      vaporPressureBar: "valve-vapor-pressure",
      criticalPressureBar: "valve-critical-pressure",
      fl: "valve-fl",
      flp: "valve-flp",
      fp: "valve-fp",
      zFactor: "valve-z",
      molecularWeight: "valve-mw",
      specificHeatRatio: "valve-k",
      xt: "valve-xt",
      xtp: "valve-xtp",
    };
    Object.entries(DEFAULT_VALVE_FORM).forEach(([key, value]) => {
      setInputValue(form, mapping[key as keyof ValveFormState], value);
    });
    coefficientUnit = DEFAULT_VALVE_FORM.coefficientUnit;
    syncVisibility();
    runtime.storage.write("workbench:control-valve-sizing", DEFAULT_VALVE_FORM);
    output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`;
    runtime.feedback(status, "已恢复默认值", "ok");
  });

  const handledIds = new Set([
    "valve-medium", "valve-mode", "valve-coefficient-unit", "valve-liquid-preset", "valve-gas-preset", "valve-fp",
  ]);
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((element) => {
    if (handledIds.has(element.id)) return;
    element.addEventListener("input", () => calculate(false));
    element.addEventListener("change", () => calculate(false));
  });

  syncVisibility();
}
