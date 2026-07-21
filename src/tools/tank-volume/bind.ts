import { calculateTank, convertTankDisplayValue, generateTankTable, TankVolumeError, type TankInput, type TankTableRow } from "./logic";
import { DEFAULT_TANK_FORM, renderTankResult, tankResultCsv, updateTankModeLabels, type TankFormState } from "./view";
import type { ToolRuntime } from "../runtime";

function numberValue(id: string): number { return Number.parseFloat(document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? ""); }
function stringValue(id: string): string { return document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? ""; }

function collectInput(): TankInput {
  const mode = stringValue("tank-mode") as TankFormState["mode"];
  const value = numberValue("tank-value");
  return { geometry: stringValue("tank-geometry") as TankFormState["geometry"], diameterM: numberValue("tank-diameter"), heightOrLengthM: numberValue("tank-height-length"), mode, value: mode === "fill" ? value / 100 : value };
}

function formState(): TankFormState { return { geometry: stringValue("tank-geometry") as TankFormState["geometry"], diameterM: numberValue("tank-diameter"), heightOrLengthM: numberValue("tank-height-length"), mode: stringValue("tank-mode") as TankFormState["mode"], value: numberValue("tank-value"), stepPercent: Number.parseInt(stringValue("tank-step"), 10) as TankFormState["stepPercent"] }; }

export function bindTankVolume(runtime: ToolRuntime): void {
  const form = document.querySelector<HTMLElement>(".tank-volume-tool"); const output = document.querySelector<HTMLElement>("#tank-output"); const status = document.querySelector<HTMLElement>("#tank-feedback");
  if (!form || !output || !status) return;
  let lastInput: TankInput | null = null;
  let previousMode = stringValue("tank-mode") as TankFormState["mode"];
  const bindResultActions = (rows: TankTableRow[]): void => { output.querySelector("[data-copy-result]")?.addEventListener("click", () => void runtime.copyText(output.innerText, status)); output.querySelector("#tank-export")?.addEventListener("click", () => runtime.downloadText("tank-level-volume.csv", tankResultCsv(rows), "text/csv;charset=utf-8")); };
  const calculate = (showError = true): void => { try { const input = collectInput(); const result = calculateTank(input); const state = formState(); const rows = generateTankTable({ geometry: input.geometry, diameterM: input.diameterM, heightOrLengthM: input.heightOrLengthM }, state.stepPercent); lastInput = input; runtime.storage.write("workbench:tank-volume", state); output.innerHTML = renderTankResult(result, rows); bindResultActions(rows); runtime.feedback(status, "计算完成", "ok"); } catch (error) { if (showError) runtime.feedback(status, error instanceof TankVolumeError ? error.message : "输入无法计算，请检查数值。", "error"); } };
  const rerenderTable = (): void => { if (!lastInput) return; try { const result = calculateTank(lastInput); const state = formState(); const rows = generateTankTable({ geometry: lastInput.geometry, diameterM: lastInput.diameterM, heightOrLengthM: lastInput.heightOrLengthM }, state.stepPercent); output.innerHTML = renderTankResult(result, rows); bindResultActions(rows); } catch { /* The next explicit calculation reports invalid input. */ } };
  const syncModeValue = (): void => { const nextMode = stringValue("tank-mode") as TankFormState["mode"]; if (nextMode !== previousMode) { try { const value = numberValue("tank-value"); const input: TankInput = { geometry: stringValue("tank-geometry") as TankFormState["geometry"], diameterM: numberValue("tank-diameter"), heightOrLengthM: numberValue("tank-height-length"), mode: previousMode, value: previousMode === "fill" ? value / 100 : value }; const valueInput = form.querySelector<HTMLInputElement>("#tank-value"); if (valueInput) valueInput.value = String(convertTankDisplayValue(input, nextMode)); } catch { /* The next explicit calculation reports invalid input. */ } previousMode = nextMode; } updateTankModeLabels(); };
  form.querySelector("#tank-calculate")?.addEventListener("click", () => calculate());
  form.querySelector("#tank-geometry")?.addEventListener("change", () => { updateTankModeLabels(); calculate(false); });
  form.querySelector("#tank-mode")?.addEventListener("change", () => { syncModeValue(); calculate(false); });
  form.querySelector("#tank-step")?.addEventListener("change", rerenderTable);
  form.querySelectorAll<HTMLInputElement>("input").forEach((element) => element.addEventListener("input", () => calculate(false)));
  form.querySelector("#tank-reset")?.addEventListener("click", () => { const mapping: Record<keyof TankFormState, string> = { geometry: "tank-geometry", diameterM: "tank-diameter", heightOrLengthM: "tank-height-length", mode: "tank-mode", value: "tank-value", stepPercent: "tank-step" }; Object.entries(DEFAULT_TANK_FORM).forEach(([key, value]) => { const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${mapping[key as keyof TankFormState]}`); if (element) element.value = String(value); }); previousMode = DEFAULT_TANK_FORM.mode; lastInput = null; runtime.storage.write("workbench:tank-volume", DEFAULT_TANK_FORM); output.innerHTML = `<div class="pe-empty">计算结果将显示在这里。</div>`; updateTankModeLabels(); runtime.feedback(status, "已恢复默认值", "ok"); });
  updateTankModeLabels();
}
