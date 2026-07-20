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

type Token = { kind: "number" | "name" | "operator" | "left" | "right" | "comma"; text: string };

function tokenizeExpression(source: string): Token[] {
  if (!source.trim()) throw new Error("请输入表达式");
  if (source.length > 240) throw new Error("表达式过长");
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char && /\s/.test(char)) {
      index += 1;
      continue;
    }
    const numberMatch = source.slice(index).match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      tokens.push({ kind: "number", text: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }
    const nameMatch = source.slice(index).match(/^[a-zA-Z_π][a-zA-Z_π0-9]*/);
    if (nameMatch) {
      tokens.push({ kind: "name", text: nameMatch[0].toLowerCase().replace("π", "pi") });
      index += nameMatch[0].length;
      continue;
    }
    if (char && "+-*/^%×÷".includes(char)) {
      tokens.push({ kind: "operator", text: char === "×" ? "*" : char === "÷" ? "/" : char });
      index += 1;
      continue;
    }
    if (char === "(") tokens.push({ kind: "left", text: char });
    else if (char === ")") tokens.push({ kind: "right", text: char });
    else if (char === ",") tokens.push({ kind: "comma", text: char });
    else throw new Error(`无法识别字符“${char}”`);
    index += 1;
  }
  return tokens;
}

const MATH_FUNCTIONS: Record<string, (value: number) => number> = {
  abs: Math.abs,
  cos: Math.cos,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenizeExpression(source);
  }

  parse(): number {
    const result = this.parseAdditive();
    if (this.peek()) throw new Error(`表达式末尾有多余内容“${this.peek()?.text ?? ""}”`);
    if (!Number.isFinite(result)) throw new Error("结果超出可表示范围");
    return result;
  }

  private peek(): Token | undefined { return this.tokens[this.index]; }

  private take(): Token | undefined { const token = this.peek(); this.index += token ? 1 : 0; return token; }

  private expect(kind: Token["kind"], text?: string): Token {
    const token = this.take();
    if (!token || token.kind !== kind || (text !== undefined && token.text !== text)) throw new Error("括号或函数参数不完整");
    return token;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.peek()?.kind === "operator" && (this.peek()?.text === "+" || this.peek()?.text === "-")) {
      const operator = this.take()?.text;
      const right = this.parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (this.peek()?.kind === "operator" && (this.peek()?.text === "*" || this.peek()?.text === "/")) {
      const operator = this.take()?.text;
      const right = this.parseUnary();
      if (operator === "/" && right === 0) throw new Error("不能除以 0");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token?.kind === "operator" && (token.text === "+" || token.text === "-")) {
      this.take();
      const value = this.parseUnary();
      return token.text === "-" ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const value = this.parsePostfix();
    if (this.peek()?.kind === "operator" && this.peek()?.text === "^") {
      this.take();
      const result = value ** this.parseUnary();
      if (!Number.isFinite(result)) throw new Error("幂运算结果超出可表示范围");
      return result;
    }
    return value;
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (this.peek()?.kind === "operator" && this.peek()?.text === "%") {
      this.take();
      value /= 100;
    }
    return value;
  }

  private parsePrimary(): number {
    const token = this.take();
    if (!token) throw new Error("表达式不完整");
    if (token.kind === "number") return Number(token.text);
    if (token.kind === "left") {
      const value = this.parseAdditive();
      this.expect("right");
      return value;
    }
    if (token.kind === "name") {
      if (token.text === "pi") return Math.PI;
      if (token.text === "e") return Math.E;
      const fn = MATH_FUNCTIONS[token.text];
      if (!fn) throw new Error(`不支持的函数或常量“${token.text}”`);
      this.expect("left");
      const value = this.parseAdditive();
      this.expect("right");
      const result = fn(value);
      if (!Number.isFinite(result)) throw new Error(`函数 ${token.text} 的输入无效`);
      return result;
    }
    throw new Error(`此处不应出现“${token.text}”`);
  }
}

export function evaluateExpression(source: string): number {
  return new ExpressionParser(source).parse();
}

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

export function timestampToDate(value: number, unit: "seconds" | "milliseconds"): Date {
  if (!Number.isFinite(value)) throw new Error("请输入有效时间戳");
  const date = new Date(unit === "seconds" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) throw new Error("时间戳超出可表示范围");
  return date;
}

export function dateToTimestamp(value: string, unit: "seconds" | "milliseconds"): number {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) throw new Error("日期格式无效");
  return unit === "seconds" ? Math.floor(milliseconds / 1000) : milliseconds;
}

export type DateDifference = { milliseconds: number; days: number; hours: number; minutes: number; seconds: number };

export function dateDifference(start: string, end: string): DateDifference {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) throw new Error("请输入两个有效日期");
  const milliseconds = endMs - startMs;
  const sign = milliseconds < 0 ? -1 : 1;
  let remainder = Math.abs(milliseconds);
  const days = Math.floor(remainder / 86_400_000) * sign;
  remainder %= 86_400_000;
  const hours = Math.floor(remainder / 3_600_000) * sign;
  remainder %= 3_600_000;
  const minutes = Math.floor(remainder / 60_000) * sign;
  remainder %= 60_000;
  const seconds = Math.floor(remainder / 1000) * sign;
  return { milliseconds, days, hours, minutes, seconds };
}

export function adjustDate(value: string, amount: number, unit: "days" | "hours" | "minutes"): string {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds) || !Number.isFinite(amount)) throw new Error("请输入有效日期和数字");
  const multiplier = unit === "days" ? 86_400_000 : unit === "hours" ? 3_600_000 : 60_000;
  return new Date(milliseconds + amount * multiplier).toISOString();
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

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function encodeBase64(value: string): string { return bytesToBase64(encodeUtf8(value)); }

export function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeUrl(value: string): string { return encodeURIComponent(value); }

export function decodeUrl(value: string): string { return decodeURIComponent(value); }

export function convertInteger(value: string, fromBase: 2 | 8 | 10 | 16, toBase: 2 | 8 | 10 | 16): string {
  const clean = value.trim().replace(/^0[bBoOxX]/, "");
  const pattern = fromBase === 2 ? /^[01]+$/ : fromBase === 8 ? /^[0-7]+$/ : fromBase === 10 ? /^\d+$/ : /^[0-9a-f]+$/i;
  if (!clean || !pattern.test(clean)) throw new Error("请输入该进制中的有效整数");
  const decimal = Number.parseInt(clean, fromBase);
  if (!Number.isSafeInteger(decimal)) throw new Error("整数超出安全范围");
  if (decimal < 0) throw new Error("暂不支持负数进制转换");
  return decimal.toString(toBase).toUpperCase();
}

export type RgbColor = { r: number; g: number; b: number };

export function parseColor(value: string): RgbColor {
  const input = value.trim();
  const hex = input.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? hex.split("").map((char) => char + char).join("") : hex;
    return { r: Number.parseInt(expanded.slice(0, 2), 16), g: Number.parseInt(expanded.slice(2, 4), 16), b: Number.parseInt(expanded.slice(4, 6), 16) };
  }
  const rgb = input.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (rgb) {
    const values = rgb.slice(1, 4).map(Number);
    if (values.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) throw new Error("RGB 每个通道必须在 0 到 255 之间");
    return { r: values[0] ?? 0, g: values[1] ?? 0, b: values[2] ?? 0 };
  }
  const hsl = input.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (hsl) {
    const hue = Number(hsl[1]);
    const saturation = Number(hsl[2]);
    const lightness = Number(hsl[3]);
    if (![hue, saturation, lightness].every(Number.isFinite) || saturation > 100 || lightness > 100) throw new Error("HSL 参数无效");
    return hslToRgb(hue, saturation, lightness);
  }
  throw new Error("请输入 HEX、RGB 或 HSL 颜色");
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function rgbToHsl({ r, g, b }: RgbColor): [number, number, number] {
  const red = r / 255; const green = g / 255; const blue = b / 255;
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue); const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [hue, saturation * 100, lightness * 100];
}

export function hslToRgb(hue: number, saturation: number, lightness: number): RgbColor {
  const h = ((hue % 360) + 360) % 360 / 60;
  const s = saturation / 100; const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h % 2) - 1)); const match = l - chroma / 2;
  const channels: [number, number, number] = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: Math.round((channels[0] + match) * 255), g: Math.round((channels[1] + match) * 255), b: Math.round((channels[2] + match) * 255) };
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
