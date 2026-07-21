export type TankGeometry = "vertical-cylinder" | "horizontal-cylinder" | "sphere";
export type TankCalculationMode = "level" | "volume" | "fill";

export type TankInput = {
  geometry: TankGeometry;
  diameterM: number;
  heightOrLengthM: number;
  mode: TankCalculationMode;
  value: number;
};

export type TankResult = {
  geometry: TankGeometry;
  diameterM: number;
  heightOrLengthM: number;
  capacityM3: number;
  levelM: number;
  volumeM3: number;
  fillFraction: number;
};

export type TankTableRow = { percentage: number; levelM: number; volumeM3: number };

export class TankVolumeError extends Error {}

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new TankVolumeError(`${label}必须大于 0。`);
}

function dimensions(input: Pick<TankInput, "geometry" | "diameterM" | "heightOrLengthM">): { radius: number; height: number; capacity: number } {
  requirePositive(input.diameterM, "罐体直径");
  const radius = input.diameterM / 2;
  if (input.geometry === "sphere") return { radius, height: input.diameterM, capacity: 4 / 3 * Math.PI * radius ** 3 };
  requirePositive(input.heightOrLengthM, input.geometry === "vertical-cylinder" ? "罐体高度" : "筒体长度");
  return input.geometry === "vertical-cylinder"
    ? { radius, height: input.heightOrLengthM, capacity: Math.PI * radius ** 2 * input.heightOrLengthM }
    : { radius, height: input.diameterM, capacity: Math.PI * radius ** 2 * input.heightOrLengthM };
}

function volumeAtLevel(geometry: TankGeometry, radius: number, length: number, level: number): number {
  if (geometry === "vertical-cylinder") return Math.PI * radius ** 2 * level;
  if (geometry === "sphere") return Math.PI * level ** 2 * (radius - level / 3);
  const segment = radius ** 2 * Math.acos((radius - level) / radius) - (radius - level) * Math.sqrt(Math.max(0, 2 * radius * level - level ** 2));
  return segment * length;
}

function levelAtVolume(geometry: TankGeometry, radius: number, height: number, length: number, target: number, capacity: number): number {
  if (target <= 0) return 0;
  if (target >= capacity) return height;
  let low = 0; let high = height;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (volumeAtLevel(geometry, radius, length, middle) < target) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

export function tankCapacity(geometry: TankGeometry, diameterM: number, heightOrLengthM: number): number {
  return dimensions({ geometry, diameterM, heightOrLengthM }).capacity;
}

export function calculateTank(input: TankInput): TankResult {
  const { radius, height, capacity } = dimensions(input);
  let levelM: number; let volumeM3: number;
  if (!Number.isFinite(input.value)) throw new TankVolumeError("请输入有效的液位、体积或装填率。");
  if (input.mode === "level") {
    levelM = input.value;
    if (levelM < 0 || levelM > height) throw new TankVolumeError(`液位必须在 0～${height} m 范围内。`);
    volumeM3 = volumeAtLevel(input.geometry, radius, input.heightOrLengthM, levelM);
  } else if (input.mode === "volume") {
    volumeM3 = input.value;
    if (volumeM3 < 0 || volumeM3 > capacity) throw new TankVolumeError(`体积必须在 0～${capacity.toFixed(6)} m³ 范围内。`);
    levelM = levelAtVolume(input.geometry, radius, height, input.heightOrLengthM, volumeM3, capacity);
  } else {
    if (input.value < 0 || input.value > 1) throw new TankVolumeError("装填率必须在 0～100% 范围内。");
    volumeM3 = input.value * capacity;
    levelM = levelAtVolume(input.geometry, radius, height, input.heightOrLengthM, volumeM3, capacity);
  }
  return { geometry: input.geometry, diameterM: input.diameterM, heightOrLengthM: input.heightOrLengthM, capacityM3: capacity, levelM, volumeM3, fillFraction: volumeM3 / capacity };
}

export function convertTankDisplayValue(input: TankInput, nextMode: TankCalculationMode): number {
  const result = calculateTank(input);
  return nextMode === "level" ? result.levelM : nextMode === "volume" ? result.volumeM3 : result.fillFraction * 100;
}

export function generateTankTable(input: Omit<TankInput, "mode" | "value">, stepPercent: 1 | 2 | 5): TankTableRow[] {
  const { radius, height, capacity } = dimensions(input);
  const rows: TankTableRow[] = [];
  for (let percentage = 0; percentage <= 100; percentage += stepPercent) {
    const volumeM3 = capacity * percentage / 100;
    rows.push({ percentage, levelM: levelAtVolume(input.geometry, radius, height, input.heightOrLengthM, volumeM3, capacity), volumeM3 });
  }
  if (rows.at(-1)?.percentage !== 100) rows.push({ percentage: 100, levelM: height, volumeM3: capacity });
  return rows;
}
