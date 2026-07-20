import { calculateGasFlow, GasFlowError, type GasFlowInput } from "./logic";
import { DEFAULT_GAS_FLOW_FORM, renderGasFlowResult, type GasFlowFormState } from "./view";
import type { ToolRuntime } from "../runtime";

const PRESSURE_FACTORS = { kPa: 1e3, bar: 1e5, MPa: 1e6 } as const;
const FLOW_FACTORS = { "m3/h": 1 / 3600, "L/min": 1e-3 / 60, "m3/s": 1 } as const;

function numberValue(id: string): number { return Number.parseFloat(document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? ""); }
function stringValue(id: string): string { return document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? ""; }
function temperatureK(value: number, unit: string): number { return unit === "C" ? value + 273.15 : value; }

function collectInput(): GasFlowInput {
  const flowUnit = stringValue("gas-flow-unit") as keyof typeof FLOW_FACTORS;
  const pressureUnit = stringValue("gas-pressure-unit") as keyof typeof PRESSURE_FACTORS;
  const actualPressure = numberValue("gas-actual-pressure") * PRESSURE_FACTORS[pressureUnit];
  const atmosphericPressure = numberValue("gas-atmospheric-pressure") * 1000;
  const pressureMode = stringValue("gas-pressure-mode");
  const molecularWeight = numberValue("gas-molecular-weight");
  return {
    flowM3s: numberValue("gas-flow-value") * FLOW_FACTORS[flowUnit],
    flowBasis: stringValue("gas-flow-basis") as GasFlowInput["flowBasis"],
    actualTemperatureK: temperatureK(numberValue("gas-actual-temperature"), stringValue("gas-actual-temperature-unit")),
    actualPressurePa: pressureMode === "gauge" ? actualPressure + atmosphericPressure : actualPressure,
    standardTemperatureK: temperatureK(numberValue("gas-standard-temperature"), stringValue("gas-standard-temperature-unit")),
    standardPressurePa: numberValue("gas-standard-pressure") * 1000,
    zActual: numberValue("gas-z-actual"), zStandard: numberValue("gas-z-standard"),
    molecularWeightKgPerKmol: Number.isFinite(molecularWeight) && molecularWeight > 0 ? molecularWeight : undefined,
    moistureConversion: stringValue("gas-moisture-conversion") as GasFlowInput["moistureConversion"],
    moistureFraction: numberValue("gas-moisture-fraction"),
  };
}

function formState(): GasFlowFormState {
  return {
    flowValue: numberValue("gas-flow-value"), flowUnit: stringValue("gas-flow-unit") as GasFlowFormState["flowUnit"], flowBasis: stringValue("gas-flow-basis") as GasFlowFormState["flowBasis"],
    actualTemperature: numberValue("gas-actual-temperature"), actualTemperatureUnit: stringValue("gas-actual-temperature-unit") as GasFlowFormState["actualTemperatureUnit"], actualPressure: numberValue("gas-actual-pressure"), pressureUnit: stringValue("gas-pressure-unit") as GasFlowFormState["pressureUnit"], pressureMode: stringValue("gas-pressure-mode") as GasFlowFormState["pressureMode"], atmosphericPressure: numberValue("gas-atmospheric-pressure"),
    standardTemperature: numberValue("gas-standard-temperature"), standardTemperatureUnit: stringValue("gas-standard-temperature-unit") as GasFlowFormState["standardTemperatureUnit"], standardPressure: numberValue("gas-standard-pressure"), zActual: numberValue("gas-z-actual"), zStandard: numberValue("gas-z-standard"), molecularWeight: numberValue("gas-molecular-weight"), moistureConversion: stringValue("gas-moisture-conversion") as GasFlowFormState["moistureConversion"], moistureFraction: numberValue("gas-moisture-fraction"),
  };
}

export function bindGasFlow(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".gas-flow-tool"); const output = document.querySelector<HTMLElement>("#gas-flow-output"); const status = document.querySelector<HTMLElement>("#gas-flow-feedback");
  if (!form || !output || !status) return;
  const calculate = (showError = true): void => {
    try {
      const result = calculateGasFlow(collectInput());
      runtime.storage.write("workbench:gas-flow", formState()); output.innerHTML = renderGasFlowResult(result); output.querySelector("[data-copy-result]")?.addEventListener("click", () => void runtime.copyText(output.innerText, status)); runtime.feedback(status, "计算完成", "ok");
    } catch (error) { if (showError) runtime.feedback(status, error instanceof GasFlowError ? error.message : "输入无法计算，请检查数值。", "error"); }
  };
  form.querySelector("#gas-flow-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#gas-flow-reset")?.addEventListener("click", () => { Object.entries(DEFAULT_GAS_FLOW_FORM).forEach(([key, value]) => { const id = ({ flowValue: "gas-flow-value", flowUnit: "gas-flow-unit", flowBasis: "gas-flow-basis", actualTemperature: "gas-actual-temperature", actualTemperatureUnit: "gas-actual-temperature-unit", actualPressure: "gas-actual-pressure", pressureUnit: "gas-pressure-unit", pressureMode: "gas-pressure-mode", atmosphericPressure: "gas-atmospheric-pressure", standardTemperature: "gas-standard-temperature", standardTemperatureUnit: "gas-standard-temperature-unit", standardPressure: "gas-standard-pressure", zActual: "gas-z-actual", zStandard: "gas-z-standard", molecularWeight: "gas-molecular-weight", moistureConversion: "gas-moisture-conversion", moistureFraction: "gas-moisture-fraction" } as Record<string, string>)[key]; const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`); if (element) element.value = String(value); }); runtime.storage.write("workbench:gas-flow", DEFAULT_GAS_FLOW_FORM); output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`; runtime.feedback(status, "已恢复默认值", "ok"); });
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((element) => { element.addEventListener("input", () => calculate(false)); element.addEventListener("change", () => calculate(false)); });
}
