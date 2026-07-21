import { calculatePrds, PrdsError, type PrdsInput } from "./logic";
import { DEFAULT_PRDS_FORM, renderSteamPrdsResult, type PrdsFormState } from "./view";
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

function collectInput(): PrdsInput {
  const mode = stringValue("prds-mode") as PrdsFormState["mode"];
  const base = {
    p1Mpa: numberValue("prds-p1") / 10,
    t1K: numberValue("prds-t1") + 273.15,
    p2Mpa: numberValue("prds-p2") / 10,
  };
  if (mode === "throttle") return { mode, ...base };
  const spray = {
    steamFlowKgs: numberValue("prds-steam-flow") / 3600,
    sprayTemperatureK: numberValue("prds-spray-temp") + 273.15,
    sprayPressureMpa: optionalNumberValue("prds-spray-pressure") !== undefined ? optionalNumberValue("prds-spray-pressure")! / 10 : undefined,
  };
  if (mode === "target-temperature") {
    return {
      mode,
      ...base,
      ...spray,
      targetTemperatureK: optionalNumberValue("prds-target-temp") !== undefined ? optionalNumberValue("prds-target-temp")! + 273.15 : undefined,
      targetSuperheatK: optionalNumberValue("prds-target-superheat"),
    };
  }
  return { mode, ...base, ...spray, sprayFlowKgs: numberValue("prds-spray-flow") / 3600 };
}

function formState(): PrdsFormState {
  return {
    mode: stringValue("prds-mode") as PrdsFormState["mode"],
    p1Bar: numberValue("prds-p1"),
    t1C: numberValue("prds-t1"),
    p2Bar: numberValue("prds-p2"),
    steamFlowKgH: numberValue("prds-steam-flow"),
    sprayTempC: numberValue("prds-spray-temp"),
    sprayPressureBar: optionalNumberValue("prds-spray-pressure") ?? "",
    targetTempC: optionalNumberValue("prds-target-temp") ?? "",
    targetSuperheatK: optionalNumberValue("prds-target-superheat") ?? "",
    sprayFlowKgH: numberValue("prds-spray-flow"),
  };
}

export function bindSteamPrds(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".prds-tool");
  const output = document.querySelector<HTMLElement>("#prds-output");
  const status = document.querySelector<HTMLElement>("#prds-feedback");
  if (!form || !output || !status) return;

  const syncVisibility = (): void => {
    const mode = stringValue("prds-mode");
    form.querySelectorAll<HTMLElement>(".prds-steam-field").forEach((el) => { el.hidden = mode === "throttle"; });
    form.querySelectorAll<HTMLElement>(".prds-target-field").forEach((el) => { el.hidden = mode !== "target-temperature"; });
    form.querySelectorAll<HTMLElement>(".prds-water-field").forEach((el) => { el.hidden = mode !== "fixed-water"; });
  };

  const calculate = (showError = true): void => {
    try {
      const result = calculatePrds(collectInput());
      runtime.storage.write("workbench:steam-prds", formState());
      output.innerHTML = renderSteamPrdsResult(result);
      output.querySelector("[data-copy-result]")?.addEventListener("click", () => void runtime.copyText(output.innerText, status));
      runtime.feedback(status, "计算完成", "ok");
    } catch (error) {
      if (showError) runtime.feedback(status, error instanceof PrdsError || error instanceof Error ? error.message : "输入无法计算，请检查数值。", "error");
    }
  };

  form.querySelector("#prds-mode")?.addEventListener("change", () => { syncVisibility(); calculate(false); });
  form.querySelector("#prds-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#prds-reset")?.addEventListener("click", () => {
    const mapping: Record<keyof PrdsFormState, string> = {
      mode: "prds-mode", p1Bar: "prds-p1", t1C: "prds-t1", p2Bar: "prds-p2", steamFlowKgH: "prds-steam-flow",
      sprayTempC: "prds-spray-temp", sprayPressureBar: "prds-spray-pressure", targetTempC: "prds-target-temp",
      targetSuperheatK: "prds-target-superheat", sprayFlowKgH: "prds-spray-flow",
    };
    Object.entries(DEFAULT_PRDS_FORM).forEach(([key, value]) => {
      const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${mapping[key as keyof PrdsFormState]}`);
      if (element) element.value = String(value);
    });
    syncVisibility();
    runtime.storage.write("workbench:steam-prds", DEFAULT_PRDS_FORM);
    output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`;
    runtime.feedback(status, "已恢复默认值", "ok");
  });
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((element) => {
    element.addEventListener("input", () => calculate(false));
    element.addEventListener("change", () => calculate(false));
  });
  syncVisibility();
}
