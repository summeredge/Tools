export type UnitCategory = keyof typeof UNIT_CATEGORIES;

type UnitDefinition = {
  label: string;
  factor?: number;
  toBase?: (value: number) => number;
  fromBase?: (value: number) => number;
};

export const UNIT_CATEGORIES = {
  length: {
    label: "长度",
    units: { m: { label: "米 (m)", factor: 1 }, km: { label: "千米 (km)", factor: 1000 }, cm: { label: "厘米 (cm)", factor: 0.01 }, mm: { label: "毫米 (mm)", factor: 0.001 }, in: { label: "英寸 (in)", factor: 0.0254 }, ft: { label: "英尺 (ft)", factor: 0.3048 } },
  },
  area: {
    label: "面积",
    units: { m2: { label: "平方米 (m²)", factor: 1 }, km2: { label: "平方千米 (km²)", factor: 1_000_000 }, cm2: { label: "平方厘米 (cm²)", factor: 0.0001 }, ft2: { label: "平方英尺 (ft²)", factor: 0.09290304 }, acre: { label: "英亩", factor: 4046.8564224 } },
  },
  volume: {
    label: "体积",
    units: { l: { label: "升 (L)", factor: 1 }, ml: { label: "毫升 (mL)", factor: 0.001 }, m3: { label: "立方米 (m³)", factor: 1000 }, gal: { label: "美制加仑 (gal)", factor: 3.785411784 } },
  },
  mass: {
    label: "质量",
    units: { kg: { label: "千克 (kg)", factor: 1 }, g: { label: "克 (g)", factor: 0.001 }, mg: { label: "毫克 (mg)", factor: 0.000001 }, t: { label: "吨 (t)", factor: 1000 }, lb: { label: "磅 (lb)", factor: 0.45359237 } },
  },
  temperature: {
    label: "温度",
    units: {
      c: { label: "摄氏度 (°C)", toBase: (v) => v, fromBase: (v) => v },
      f: { label: "华氏度 (°F)", toBase: (v) => (v - 32) * (5 / 9), fromBase: (v) => v * (9 / 5) + 32 },
      k: { label: "开尔文 (K)", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    },
  },
  pressure: {
    label: "压力",
    units: { pa: { label: "帕 (Pa)", factor: 1 }, kpa: { label: "千帕 (kPa)", factor: 1000 }, mpa: { label: "兆帕 (MPa)", factor: 1_000_000 }, bar: { label: "巴 (bar)", factor: 100_000 }, atm: { label: "标准大气压 (atm)", factor: 101_325 }, psi: { label: "磅力/平方英寸 (psi)", factor: 6894.757293168 } },
  },
  time: {
    label: "时间",
    units: { s: { label: "秒 (s)", factor: 1 }, min: { label: "分钟 (min)", factor: 60 }, h: { label: "小时 (h)", factor: 3600 }, d: { label: "天 (d)", factor: 86400 } },
  },
  speed: {
    label: "速度",
    units: { ms: { label: "米/秒 (m/s)", factor: 1 }, kmh: { label: "千米/时 (km/h)", factor: 1 / 3.6 }, mph: { label: "英里/时 (mph)", factor: 0.44704 }, knot: { label: "节 (kn)", factor: 0.5144444444 } },
  },
  energy: {
    label: "能量",
    units: { j: { label: "焦耳 (J)", factor: 1 }, kj: { label: "千焦 (kJ)", factor: 1000 }, wh: { label: "瓦时 (Wh)", factor: 3600 }, kwh: { label: "千瓦时 (kWh)", factor: 3_600_000 }, cal: { label: "卡路里 (cal)", factor: 4.184 } },
  },
  power: {
    label: "功率",
    units: { w: { label: "瓦 (W)", factor: 1 }, kw: { label: "千瓦 (kW)", factor: 1000 }, mw: { label: "兆瓦 (MW)", factor: 1_000_000 }, hp: { label: "马力 (hp)", factor: 745.699872 } },
  },
  data: {
    label: "数据存储",
    units: { b: { label: "字节 (B)", factor: 1 }, kb: { label: "千字节 (KB)", factor: 1024 }, mb: { label: "兆字节 (MB)", factor: 1024 ** 2 }, gb: { label: "吉字节 (GB)", factor: 1024 ** 3 }, tb: { label: "太字节 (TB)", factor: 1024 ** 4 } },
  },
} as const satisfies Record<string, { label: string; units: Record<string, UnitDefinition> }>;

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 12 }).format(value);
}

export function convertUnit(value: number, category: UnitCategory, from: string, to: string): number {
  const categoryDefinition = UNIT_CATEGORIES[category];
  const units = categoryDefinition.units as Record<string, UnitDefinition>;
  const fromDefinition = units[from];
  const toDefinition = units[to];
  if (!fromDefinition || !toDefinition) throw new Error("请选择有效的单位");
  if (!Number.isFinite(value)) throw new Error("请输入有效数字");
  const base = fromDefinition.toBase ? fromDefinition.toBase(value) : value * (fromDefinition.factor ?? 1);
  const result = toDefinition.fromBase ? toDefinition.fromBase(base) : base / (toDefinition.factor ?? 1);
  if (!Number.isFinite(result)) throw new Error("结果超出可表示范围");
  return result;
}

export type JsonResult = { ok: true; value: string } | { ok: false; error: string };

export function jsonTransform(source: string, compact: boolean): JsonResult {
  if (!source.trim()) return { ok: false, error: "请输入 JSON" };
  try {
    const parsed: unknown = JSON.parse(source);
    return { ok: true, value: JSON.stringify(parsed, null, compact ? 0 : 2) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 语法无效";
    const position = message.match(/position (\d+)/i)?.[1];
    return { ok: false, error: position ? `JSON 语法无效，错误位置约为第 ${Number(position) + 1} 个字符：${message}` : message };
  }
}

export function textStats(value: string): { characters: number; words: number; lines: number } {
  const trimmed = value.trim();
  return { characters: value.length, words: trimmed ? trimmed.split(/\s+/u).length : 0, lines: value ? value.split(/\r?\n/).length : 0 };
}

export function sortLines(value: string): string { return value.split(/\r?\n/).sort((a, b) => a.localeCompare(b, "zh-CN")).join("\n"); }

export function uniqueLines(value: string): string { return [...new Set(value.split(/\r?\n/))].join("\n"); }

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
