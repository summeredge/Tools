import { calculateHeatExchanger, HeatExchangerError, type HeatExchangerInput, type HeatSideInput } from "./logic";
import { DEFAULT_HEAT_EXCHANGER_FORM, renderHeatExchangerResult, type HeatExchangerFormState } from "./view";
import type { ToolRuntime } from "../runtime";

function numberValue(id: string): number { return Number.parseFloat(document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? ""); }
function optionalNumber(id: string): number | undefined { const value = numberValue(id); return Number.isFinite(value) ? value : undefined; }
function stringValue(id: string): string { return document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? ""; }
function celsiusToKelvin(value: number | undefined): number | undefined { return value === undefined ? undefined : value + 273.15; }

function collectInput(): HeatExchangerInput {
  const mode = stringValue("hx-mode") as HeatExchangerFormState["mode"];
  const hotTemperatureIn = mode === "sensible" ? optionalNumber("hx-hot-in") : celsiusToKelvin(optionalNumber("hx-hot-in-h"));
  const hotTemperatureOut = mode === "sensible" ? optionalNumber("hx-hot-out") : celsiusToKelvin(optionalNumber("hx-hot-out-h"));
  const coldTemperatureIn = mode === "sensible" ? optionalNumber("hx-cold-in") : celsiusToKelvin(optionalNumber("hx-cold-in-h"));
  const coldTemperatureOut = mode === "sensible" ? optionalNumber("hx-cold-out") : celsiusToKelvin(optionalNumber("hx-cold-out-h"));
  const hot: HeatSideInput = { massFlowKgs: (mode === "sensible" ? optionalNumber("hx-hot-flow") : optionalNumber("hx-hot-flow-h")) === undefined ? undefined : (mode === "sensible" ? optionalNumber("hx-hot-flow") : optionalNumber("hx-hot-flow-h"))! / 3600, cpJPerKgK: mode === "sensible" ? optionalNumber("hx-hot-cp")! * 1000 : undefined, inletTemperatureK: hotTemperatureIn, outletTemperatureK: hotTemperatureOut, inletEnthalpyJPerKg: mode === "enthalpy" ? optionalNumber("hx-hot-hin")! * 1000 : undefined, outletEnthalpyJPerKg: mode === "enthalpy" ? optionalNumber("hx-hot-hout")! * 1000 : undefined };
  const cold: HeatSideInput = { massFlowKgs: (mode === "sensible" ? optionalNumber("hx-cold-flow") : optionalNumber("hx-cold-flow-h")) === undefined ? undefined : (mode === "sensible" ? optionalNumber("hx-cold-flow") : optionalNumber("hx-cold-flow-h"))! / 3600, cpJPerKgK: mode === "sensible" ? optionalNumber("hx-cold-cp")! * 1000 : undefined, inletTemperatureK: coldTemperatureIn, outletTemperatureK: coldTemperatureOut, inletEnthalpyJPerKg: mode === "enthalpy" ? optionalNumber("hx-cold-hin")! * 1000 : undefined, outletEnthalpyJPerKg: mode === "enthalpy" ? optionalNumber("hx-cold-hout")! * 1000 : undefined };
  return { mode, pattern: stringValue("hx-pattern") as HeatExchangerFormState["pattern"], correctionFactor: numberValue("hx-factor"), hot, cold };
}

function formState(): HeatExchangerFormState { return { mode: stringValue("hx-mode") as HeatExchangerFormState["mode"], pattern: stringValue("hx-pattern") as HeatExchangerFormState["pattern"], correctionFactor: numberValue("hx-factor"), hotFlowKgH: numberValue("hx-hot-flow"), hotCpKjKgK: numberValue("hx-hot-cp"), hotInC: numberValue("hx-hot-in"), hotOutC: numberValue("hx-hot-out"), coldFlowKgH: numberValue("hx-cold-flow"), coldCpKjKgK: numberValue("hx-cold-cp"), coldInC: numberValue("hx-cold-in"), coldOutC: numberValue("hx-cold-out"), hotHinKjKg: numberValue("hx-hot-hin"), hotHoutKjKg: numberValue("hx-hot-hout"), coldHinKjKg: numberValue("hx-cold-hin"), coldHoutKjKg: numberValue("hx-cold-hout") }; }

function toggleMode(): void { const mode = stringValue("hx-mode"); document.querySelectorAll<HTMLElement>("[data-hx-panel]").forEach((panel) => { panel.hidden = panel.dataset.hxPanel !== mode; }); }

export function bindHeatExchanger(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".heat-exchanger-tool"); const output = document.querySelector<HTMLElement>("#hx-output"); const status = document.querySelector<HTMLElement>("#hx-feedback");
  if (!form || !output || !status) return;
  const calculate = (showError = true): void => { try { const result = calculateHeatExchanger(collectInput()); runtime.storage.write("workbench:heat-exchanger", formState()); output.innerHTML = renderHeatExchangerResult(result); output.querySelector("[data-copy-result]")?.addEventListener("click", () => void runtime.copyText(output.innerText, status)); runtime.feedback(status, "计算完成", "ok"); } catch (error) { if (showError) runtime.feedback(status, error instanceof HeatExchangerError ? error.message : "输入无法计算，请检查数值。", "error"); } };
  form.querySelector("#hx-mode")?.addEventListener("change", () => { toggleMode(); calculate(false); });
  form.querySelector("#hx-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#hx-reset")?.addEventListener("click", () => { const mapping: Record<keyof HeatExchangerFormState, string> = { mode: "hx-mode", pattern: "hx-pattern", correctionFactor: "hx-factor", hotFlowKgH: "hx-hot-flow", hotCpKjKgK: "hx-hot-cp", hotInC: "hx-hot-in", hotOutC: "hx-hot-out", coldFlowKgH: "hx-cold-flow", coldCpKjKgK: "hx-cold-cp", coldInC: "hx-cold-in", coldOutC: "hx-cold-out", hotHinKjKg: "hx-hot-hin", hotHoutKjKg: "hx-hot-hout", coldHinKjKg: "hx-cold-hin", coldHoutKjKg: "hx-cold-hout" }; Object.entries(DEFAULT_HEAT_EXCHANGER_FORM).forEach(([key, value]) => { const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${mapping[key as keyof HeatExchangerFormState]}`); if (element) element.value = String(value); }); runtime.storage.write("workbench:heat-exchanger", DEFAULT_HEAT_EXCHANGER_FORM); output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`; toggleMode(); runtime.feedback(status, "已恢复默认值", "ok"); });
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((element) => { element.addEventListener("input", () => calculate(false)); element.addEventListener("change", () => calculate(false)); });
  toggleMode();
}
