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
