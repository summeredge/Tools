import { calculateGasValve, calculateLiquidValve, ValveSizingError } from "./logic";
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
  } else {
    common.ratedCoefficient = rated;
  }
  if (medium === "liquid") {
    return {
      result: calculateLiquidValve({
        ...common,
        temperatureK: numberValue("valve-temperature") + 273.15,
        relativeDensity: numberValue("valve-relative-density"),
        vaporPressureBar: optionalNumberValue("valve-vapor-pressure"),
        criticalPressureBar: optionalNumberValue("valve-critical-pressure"),
        fl: optionalNumberValue("valve-fl"),
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
      standardTemperatureK: 273.15,
      standardPressureBar: 1.01325,
      zFactor: numberValue("valve-z"),
      molecularWeight: numberValue("valve-mw"),
      xt: optionalNumberValue("valve-xt"),
      fGamma: optionalNumberValue("valve-fgamma"),
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
    fp: numberValue("valve-fp"),
    zFactor: numberValue("valve-z"),
    molecularWeight: numberValue("valve-mw"),
    xt: optionalNumberValue("valve-xt") ?? "",
    fGamma: optionalNumberValue("valve-fgamma") ?? "",
  };
}

export function bindControlValve(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".valve-tool");
  const output = document.querySelector<HTMLElement>("#valve-output");
  const status = document.querySelector<HTMLElement>("#valve-feedback");
  if (!form || !output || !status) return;

  const syncVisibility = (): void => {
    const medium = stringValue("valve-medium");
    const mode = stringValue("valve-mode");
    const isLiquid = medium !== "gas";
    const isSize = mode !== "predict";
    form.querySelectorAll<HTMLElement>(".valve-liquid-field").forEach((el) => { el.hidden = !isLiquid; });
    form.querySelectorAll<HTMLElement>(".valve-gas-field").forEach((el) => { el.hidden = isLiquid; });
    form.querySelectorAll<HTMLElement>(".valve-size-field").forEach((el) => { el.hidden = !isSize; });
    form.querySelectorAll<HTMLElement>(".valve-predict-field").forEach((el) => { el.hidden = isSize; });
    const flowUnit = form.querySelector<HTMLElement>(".valve-flow-unit");
    if (flowUnit) flowUnit.textContent = isLiquid ? "m³/h" : "Nm³/h";
    const ratedUnit = form.querySelector<HTMLElement>(".valve-rated-unit");
    if (ratedUnit) ratedUnit.textContent = stringValue("valve-coefficient-unit");
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

  ["valve-medium", "valve-mode", "valve-coefficient-unit"].forEach((id) => {
    form.querySelector(`#${id}`)?.addEventListener("change", () => { syncVisibility(); calculate(false); });
  });
  form.querySelector("#valve-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#valve-reset")?.addEventListener("click", () => {
    const mapping: Record<keyof ValveFormState, string> = {
      medium: "valve-medium", mode: "valve-mode", coefficientUnit: "valve-coefficient-unit", flowValue: "valve-flow",
      ratedCoefficient: "valve-rated", p1Bar: "valve-p1", p2Bar: "valve-p2", safetyFactor: "valve-safety",
      temperatureC: "valve-temperature", relativeDensity: "valve-relative-density", vaporPressureBar: "valve-vapor-pressure",
      criticalPressureBar: "valve-critical-pressure", fl: "valve-fl", fp: "valve-fp", zFactor: "valve-z",
      molecularWeight: "valve-mw", xt: "valve-xt", fGamma: "valve-fgamma",
    };
    Object.entries(DEFAULT_VALVE_FORM).forEach(([key, value]) => {
      const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${mapping[key as keyof ValveFormState]}`);
      if (element) element.value = String(value);
    });
    syncVisibility();
    runtime.storage.write("workbench:control-valve-sizing", DEFAULT_VALVE_FORM);
    output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`;
    runtime.feedback(status, "已恢复默认值", "ok");
  });
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((element) => {
    element.addEventListener("input", () => calculate(false));
    element.addEventListener("change", () => calculate(false));
  });
  syncVisibility();
}
