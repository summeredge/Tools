import { bindTankVolume } from "./bind";
import { renderTankVolume } from "./view";
import type { ProcessToolModule } from "../registry";

export const tankVolumeModule: ProcessToolModule = {
  id: "tank-volume", name: "储罐液位—体积换算", description: "计算立式、卧式圆筒罐和球罐液位与体积", category: "储罐与设备", mark: "V", keywords: ["储罐", "液位", "体积", "装填率", "圆筒", "球罐"],
  render: renderTankVolume,
  bind: bindTankVolume,
};

export { bindTankVolume } from "./bind";
export { renderTankVolume } from "./view";
