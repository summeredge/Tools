export type ToolStorage = {
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): boolean;
};

export type ToolRuntime = {
  storage: ToolStorage;
  feedback(element: HTMLElement | null, message: string, kind?: "ok" | "error" | "muted"): void;
  copyText(value: string, target: HTMLElement | null): Promise<void>;
  downloadText(filename: string, content: string, mimeType: string): void;
};

export type ProcessGuidance = {
  assumptions: string[];
  applicability: string[];
  limitations: string[];
};

export const ENGINEERING_REVIEW_NOTICE = "计算结果用于工程估算，正式设计、选型或安全判断应依据适用标准和设计条件复核。";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function formatToolNumber(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits, maximumSignificantDigits: 6 }).format(value);
}

export function formatToolPercent(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatToolNumber(value, digits)}%`;
}

export function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderProcessGuidance(guidance: ProcessGuidance): string {
  const renderList = (items: string[]): string => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<section class="pe-guidance" aria-label="工程计算说明"><div class="pe-guidance-grid"><article><h3>计算假设</h3>${renderList(guidance.assumptions)}</article><article><h3>适用范围</h3>${renderList(guidance.applicability)}</article><article><h3>主要限制</h3>${renderList(guidance.limitations)}</article></div><div class="pe-review-note"><strong>工程复核提示</strong><p>${escapeHtml(ENGINEERING_REVIEW_NOTICE)}</p></div></section>`;
}
