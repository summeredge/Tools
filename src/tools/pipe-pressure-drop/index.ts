import { bindPipePressure } from "./bind";
import { renderPipePressure } from "./view";
import type { ProcessToolModule } from "../registry";

export const pipePressureModule: ProcessToolModule = {
  id: "pipe-pressure-drop", name: "管道流速与压降", description: "使用 Darcy–Weisbach 计算圆管流速、摩阻与压降", category: "流体与管道", mark: "ΔP", keywords: ["管道", "流速", "压降", "Reynolds", "Darcy", "Colebrook"],
  render: renderPipePressure,
  bind: bindPipePressure,
};

export { bindPipePressure } from "./bind";
export { renderPipePressure } from "./view";
