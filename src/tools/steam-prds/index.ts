import { bindSteamPrds } from "./bind";
import { renderSteamPrds } from "./view";
import type { ProcessToolModule } from "../registry";

export const steamPrdsModule: ProcessToolModule = {
  id: "steam-prds",
  name: "蒸汽减压与喷水减温",
  description: "绝热节流与喷水减温的能量平衡估算（IAPWS-IF97）",
  category: "换热与能源",
  mark: "PRDS",
  keywords: ["蒸汽", "减压", "减温", "喷水", "PRDS", "IF97", "节流"],
  render: renderSteamPrds,
  bind: bindSteamPrds,
};

export { bindSteamPrds } from "./bind";
export { renderSteamPrds } from "./view";
