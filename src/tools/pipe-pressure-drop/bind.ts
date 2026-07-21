import { calculatePipePressure, PipePressureError, type PipePressureInput } from "./logic";
import { DEFAULT_PIPE_FORM, renderPipePressureResult, type PipeFlowUnit, type PipeFormState } from "./view";
import type { ToolRuntime } from "../runtime";

function numberValue(id: string): number { return Number.parseFloat(document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? ""); }
function stringValue(id: string): string { return document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? ""; }

const VOLUME_FLOW_FACTORS = { "m3/h": 1 / 3600, "L/min": 1e-3 / 60 } as const;

export function convertPipeFlowDisplayValue(value: number, densityKgM3: number, from: PipeFlowUnit, to: PipeFlowUnit): number {
  const flowM3s = from === "kg/h" ? value / densityKgM3 / 3600 : value * VOLUME_FLOW_FACTORS[from];
  return to === "kg/h" ? flowM3s * densityKgM3 * 3600 : flowM3s / VOLUME_FLOW_FACTORS[to];
}

export function convertPipeFlowBasisDisplayValue(value: number, densityKgM3: number, from: PipeFormState["flowBasis"], to: PipeFormState["flowBasis"]): number {
  return convertPipeFlowDisplayValue(value, densityKgM3, from === "volume" ? "m3/h" : "kg/h", to === "volume" ? "m3/h" : "kg/h");
}

function collectInput(): PipePressureInput {
  const flowBasis = stringValue("pipe-flow-basis") as PipeFormState["flowBasis"];
  const flow = numberValue("pipe-flow-value"); const flowUnit = stringValue("pipe-flow-unit");
  return {
    flowM3s: flowBasis === "volume" ? flow * (flowUnit === "L/min" ? VOLUME_FLOW_FACTORS["L/min"] : VOLUME_FLOW_FACTORS["m3/h"]) : undefined,
    massFlowKgs: flowBasis === "mass" ? flow / 3600 : undefined,
    diameterM: numberValue("pipe-diameter") / 1000, lengthM: numberValue("pipe-length"), densityKgM3: numberValue("pipe-density"), viscosityPas: numberValue("pipe-viscosity") / 1000, roughnessM: numberValue("pipe-roughness") / 1000, sumK: numberValue("pipe-sum-k"),
    inletPressurePa: numberValue("pipe-inlet-pressure") > 0 ? numberValue("pipe-inlet-pressure") * 1000 : undefined,
  };
}

function formState(): PipeFormState {
  return { flowBasis: stringValue("pipe-flow-basis") as PipeFormState["flowBasis"], flowValue: numberValue("pipe-flow-value"), flowUnit: stringValue("pipe-flow-unit") as PipeFormState["flowUnit"], diameterMm: numberValue("pipe-diameter"), lengthM: numberValue("pipe-length"), densityKgM3: numberValue("pipe-density"), viscosityMpas: numberValue("pipe-viscosity"), roughnessMm: numberValue("pipe-roughness"), sumK: numberValue("pipe-sum-k"), inletPressureKpa: numberValue("pipe-inlet-pressure") };
}

export function bindPipePressure(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".pipe-pressure-tool"); const output = document.querySelector<HTMLElement>("#pipe-output"); const status = document.querySelector<HTMLElement>("#pipe-feedback");
  if (!form || !output || !status) return;
  let flowUnit = stringValue("pipe-flow-unit") as PipeFlowUnit;
  const syncFlowUnit = (convertValue = false): void => {
    const nextBasis = stringValue("pipe-flow-basis") as PipeFormState["flowBasis"];
    const nextUnit: PipeFlowUnit = nextBasis === "mass" ? "kg/h" : flowUnit === "L/min" ? "L/min" : "m3/h";
    const value = numberValue("pipe-flow-value"); const density = numberValue("pipe-density");
    if (convertValue && nextUnit !== flowUnit && Number.isFinite(value) && Number.isFinite(density) && density > 0) {
      const input = form.querySelector<HTMLInputElement>("#pipe-flow-value");
      if (input) input.value = String(convertPipeFlowDisplayValue(value, density, flowUnit, nextUnit));
    }
    flowUnit = nextUnit;
    const select = form.querySelector<HTMLSelectElement>("#pipe-flow-unit");
    if (select) { const units: Array<[string, string]> = nextBasis === "mass" ? [["kg/h", "kg/h"]] : [["m3/h", "m³/h"], ["L/min", "L/min"]]; select.innerHTML = units.map(([value, label]) => `<option value="${value}">${label}</option>`).join(""); select.value = nextUnit; }
  };
  const calculate = (showError = true): void => { try { const result = calculatePipePressure(collectInput()); runtime.storage.write("workbench:pipe-pressure-drop", formState()); output.innerHTML = renderPipePressureResult(result); output.querySelector("[data-copy-result]")?.addEventListener("click", () => void runtime.copyText(output.innerText, status)); runtime.feedback(status, "计算完成", "ok"); } catch (error) { if (showError) runtime.feedback(status, error instanceof PipePressureError ? error.message : "输入无法计算，请检查数值。", "error"); } };
  form.querySelector("#pipe-flow-basis")?.addEventListener("change", () => syncFlowUnit(true));
  form.querySelector("#pipe-flow-unit")?.addEventListener("change", () => {
    const nextUnit = stringValue("pipe-flow-unit") as PipeFlowUnit; const value = numberValue("pipe-flow-value"); const density = numberValue("pipe-density");
    if (nextUnit !== flowUnit && Number.isFinite(value) && Number.isFinite(density) && density > 0) { const input = form.querySelector<HTMLInputElement>("#pipe-flow-value"); if (input) input.value = String(convertPipeFlowDisplayValue(value, density, flowUnit, nextUnit)); }
    flowUnit = nextUnit;
  });
  form.querySelector("#pipe-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#pipe-reset")?.addEventListener("click", () => { const mapping: Record<keyof PipeFormState, string> = { flowBasis: "pipe-flow-basis", flowValue: "pipe-flow-value", flowUnit: "pipe-flow-unit", diameterMm: "pipe-diameter", lengthM: "pipe-length", densityKgM3: "pipe-density", viscosityMpas: "pipe-viscosity", roughnessMm: "pipe-roughness", sumK: "pipe-sum-k", inletPressureKpa: "pipe-inlet-pressure" }; Object.entries(DEFAULT_PIPE_FORM).forEach(([key, value]) => { const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${mapping[key as keyof PipeFormState]}`); if (element) element.value = String(value); }); flowUnit = DEFAULT_PIPE_FORM.flowUnit; syncFlowUnit(); runtime.storage.write("workbench:pipe-pressure-drop", DEFAULT_PIPE_FORM); output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`; runtime.feedback(status, "已恢复默认值", "ok"); });
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((element) => { element.addEventListener("input", () => calculate(false)); element.addEventListener("change", () => calculate(false)); });
  syncFlowUnit();
}
