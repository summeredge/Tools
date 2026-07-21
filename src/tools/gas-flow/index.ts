import { bindGasFlow } from "./bind";
import { renderGasFlow } from "./view";
import type { ProcessToolModule } from "../registry";

export const gasFlowModule: ProcessToolModule = {
  id: "gas-flow", name: "气体工况/标况换算", description: "按状态方程换算实际与标准体积流量", category: "热力与物性", mark: "Q", keywords: ["气体", "工况", "标况", "流量", "压缩因子", "湿基", "干基"],
  render: renderGasFlow,
  bind: bindGasFlow,
};

export { bindGasFlow } from "./bind";
export { renderGasFlow } from "./view";
