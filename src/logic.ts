export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 12 }).format(value);
}

export function textStats(value: string): { characters: number; words: number; lines: number } {
  const trimmed = value.trim();
  return { characters: value.length, words: trimmed ? trimmed.split(/\s+/u).length : 0, lines: value ? value.split(/\r?\n/).length : 0 };
}

export function sortLines(value: string): string { return value.split(/\r?\n/).sort((a, b) => a.localeCompare(b, "zh-CN")).join("\n"); }

export function uniqueLines(value: string): string { return [...new Set(value.split(/\r?\n/))].join("\n"); }

export function removeExtraLineBreaks(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/[ \t]*\n(?:[ \t]*\n)+/gu, "\n");
}

export function normalizeShortcutUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createStorageAdapter(storage: StorageLike | null): {
  available: boolean;
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): boolean;
  remove(key: string): void;
} {
  let available = storage !== null;
  if (storage) {
    try { storage.setItem("__workbench_probe__", "1"); storage.removeItem("__workbench_probe__"); }
    catch { available = false; }
  }
  return {
    get available() { return available; },
    read<T>(key: string, fallback: T): T {
      if (!available || !storage) return fallback;
      try { const raw = storage.getItem(key); return raw === null ? fallback : JSON.parse(raw) as T; }
      catch { return fallback; }
    },
    write<T>(key: string, value: T): boolean {
      if (!available || !storage) return false;
      try { storage.setItem(key, JSON.stringify(value)); return true; }
      catch { available = false; return false; }
    },
    remove(key: string): void { try { storage?.removeItem(key); } catch { available = false; } },
  };
}
