import { formatToolNumber, formatToolPercent, type ToolStorage } from "../runtime";
import type { TankCalculationMode, TankGeometry, TankResult, TankTableRow } from "./logic";

export type TankFormState = { geometry: TankGeometry; diameterM: number; heightOrLengthM: number; mode: TankCalculationMode; value: number; stepPercent: 1 | 2 | 5 };
export const DEFAULT_TANK_FORM: TankFormState = { geometry: "vertical-cylinder", diameterM: 2, heightOrLengthM: 5, mode: "level", value: 2, stepPercent: 5 };

function options(values: Array<[string, string]>, selected: string): string { return values.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join(""); }

export function renderTankVolume(storage: ToolStorage): string {
  const state = storage.read<TankFormState>("workbench:tank-volume", DEFAULT_TANK_FORM);
  return `<div class="process-tool tank-volume-tool"><div class="pe-input-section"><div class="pe-form-grid"><label>罐体形状<select id="tank-geometry">${options([["vertical-cylinder", "立式平底圆筒罐"], ["horizontal-cylinder", "卧式平封头圆筒罐"], ["sphere", "球罐"]], state.geometry)}</select></label><label>直径<input id="tank-diameter" type="number" value="${state.diameterM}"><small>m</small></label><label id="tank-height-label">高度 / 筒长<input id="tank-height-length" type="number" value="${state.heightOrLengthM}"><small id="tank-height-unit">m</small></label><label>计算方向<select id="tank-mode">${options([["level", "输入液位 → 体积"], ["volume", "输入体积 → 液位"], ["fill", "输入装填率 → 液位"]], state.mode)}</select></label><label id="tank-value-label">液位<input id="tank-value" type="number" value="${state.value}"><small id="tank-value-unit">m</small></label><label>对照表步长<select id="tank-step">${options([["1", "1%"], ["2", "2%"], ["5", "5%"]], String(state.stepPercent))}</select></label></div><div class="pe-actions"><button class="button primary" id="tank-calculate">计算</button><button class="button secondary" id="tank-reset">恢复默认值</button></div><div class="feedback" id="tank-feedback" aria-live="polite">请输入参数后计算。</div></div><div class="pe-output" id="tank-output"><div class="pe-empty">计算结果将显示在这里。</div></div></div>`;
}

function renderTankResultBase(result: TankResult, rows: TankTableRow[]): string {
  const diagram = result.geometry === "vertical-cylinder"
    ? `<svg viewBox="0 0 180 240" role="img" aria-label="立式圆筒罐液位示意图"><rect x="45" y="20" width="90" height="190" rx="8" class="tank-outline"/><rect x="46" y="${210 - result.fillFraction * 188}" width="88" height="${result.fillFraction * 188}" class="tank-liquid"/></svg>`
    : result.geometry === "horizontal-cylinder"
      ? `<svg viewBox="0 0 220 180" role="img" aria-label="卧式圆筒罐液位示意图"><rect x="25" y="35" width="170" height="110" rx="40" class="tank-outline"/><clipPath id="tank-horizontal-clip"><rect x="25" y="35" width="170" height="110" rx="40"/></clipPath><rect x="25" y="${145 - result.fillFraction * 108}" width="170" height="${result.fillFraction * 108}" class="tank-liquid" clip-path="url(#tank-horizontal-clip)"/></svg>`
      : `<svg viewBox="0 0 180 220" role="img" aria-label="球罐液位示意图"><circle cx="90" cy="105" r="78" class="tank-outline"/><clipPath id="tank-sphere-clip"><circle cx="90" cy="105" r="78"/></clipPath><rect x="12" y="${183 - result.fillFraction * 156}" width="156" height="${result.fillFraction * 156}" class="tank-liquid" clip-path="url(#tank-sphere-clip)"/></svg>`;
  const table = rows.map((row) => `<tr><td>${row.percentage}%</td><td>${formatToolNumber(row.levelM, 6)} m</td><td>${formatToolNumber(row.volumeM3, 6)} m³</td></tr>`).join("");
  return `<div class="pe-result-heading"><div><p class="eyebrow">TANK GEOMETRY / BISECTION INVERSE SOLVER</p><h2>液位—体积结果</h2></div><button class="button secondary" data-copy-result>复制结果</button></div><div class="tank-result-layout"><div class="tank-diagram">${diagram}</div><div class="pe-metrics tank-metrics"><div><small>液位</small><strong>${formatToolNumber(result.levelM)} m</strong></div><div><small>液体体积</small><strong>${formatToolNumber(result.volumeM3)} m³</strong></div><div><small>装填率</small><strong>${formatToolPercent(result.fillFraction * 100)}</strong></div><div><small>罐体容积</small><strong>${formatToolNumber(result.capacityM3)} m³</strong></div></div></div><div class="tank-table-heading"><h3>液位—体积对照表</h3><span>当前步长：${rows.length > 1 ? formatToolNumber(rows[1]!.percentage - rows[0]!.percentage, 0) : "—"}%</span><button class="button secondary" id="tank-export">导出 CSV</button></div><div class="pe-table-wrap"><table><thead><tr><th>装填率</th><th>液位</th><th>体积</th></tr></thead><tbody>${table}</tbody></table></div>`;
}

export function renderTankResult(result: TankResult, rows: TankTableRow[]): string {
  return `${renderTankResultBase(result, rows)}<div class="pe-result-grid"><section><h3>计算依据</h3><p>立式圆筒使用圆柱体公式；卧式圆筒使用圆弓形截面积公式；球罐使用球冠体积公式，体积反算液位使用二分法。</p></section><section><h3>适用范围</h3><p>仅支持立式平底圆筒罐、卧式平封头圆筒罐和球罐；不包含椭圆封头、碟形封头、锥底或不规则标定罐。</p></section></div>`;
}

export function tankResultCsv(rows: TankTableRow[]): string {
  return `\uFEFF装填率,液位(m),体积(m³)\r\n${rows.map((row) => `${row.percentage},${row.levelM},${row.volumeM3}`).join("\r\n")}`;
}

export function updateTankModeLabels(): void {
  const geometry = document.querySelector<HTMLSelectElement>("#tank-geometry")?.value;
  const mode = document.querySelector<HTMLSelectElement>("#tank-mode")?.value;
  const heightLabel = document.querySelector<HTMLElement>("#tank-height-label"); const heightUnit = document.querySelector<HTMLElement>("#tank-height-unit"); const valueLabel = document.querySelector<HTMLElement>("#tank-value-label"); const valueUnit = document.querySelector<HTMLElement>("#tank-value-unit");
  if (heightLabel) heightLabel.firstChild!.textContent = geometry === "vertical-cylinder" ? "高度" : geometry === "sphere" ? "辅助尺寸" : "筒长";
  if (heightUnit) heightUnit.textContent = geometry === "sphere" ? "球罐不使用" : "m";
  if (valueLabel) valueLabel.firstChild!.textContent = mode === "level" ? "液位" : mode === "volume" ? "液体体积" : "装填率";
  if (valueUnit) valueUnit.textContent = mode === "level" ? "m" : mode === "volume" ? "m³" : "%";
  if (geometry === "sphere") { const input = document.querySelector<HTMLInputElement>("#tank-height-length"); if (input) input.disabled = true; } else { const input = document.querySelector<HTMLInputElement>("#tank-height-length"); if (input) input.disabled = false; }
}
