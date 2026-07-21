import { bindHeatExchanger } from "./bind";
import { renderHeatExchanger } from "./view";
import type { ProcessToolModule } from "../registry";

export const heatExchangerModule: ProcessToolModule = {
  id: "heat-exchanger", name: "换热器热量平衡与 LMTD", description: "计算热负荷、对数平均温差和 UA", category: "换热与能源", mark: "LMTD", keywords: ["换热器", "热量", "热负荷", "LMTD", "UA", "逆流", "并流"],
  render: renderHeatExchanger,
  bind: bindHeatExchanger,
};

export { bindHeatExchanger } from "./bind";
export { renderHeatExchanger } from "./view";
