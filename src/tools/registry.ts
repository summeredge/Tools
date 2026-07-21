import { bindGasFlow, renderGasFlow } from "./gas-flow";
import { bindHeatExchanger, renderHeatExchanger } from "./heat-exchanger";
import { bindPipePressure, renderPipePressure } from "./pipe-pressure-drop";
import { bindTankVolume, renderTankVolume } from "./tank-volume";
import type { ToolRuntime, ToolStorage } from "./runtime";

export type ProcessToolId = "gas-flow" | "pipe-pressure-drop" | "tank-volume" | "heat-exchanger";

export type ProcessToolMetadata = {
  id: ProcessToolId;
  name: string;
  description: string;
  category: string;
  mark: string;
  keywords: string[];
};

export type ProcessToolModule = ProcessToolMetadata & {
  render: (storage: ToolStorage) => string;
  bind: (runtime: ToolRuntime) => void;
};

export const processToolModules: ProcessToolModule[] = [
  {
    id: "gas-flow", name: "气体工况/标况换算", description: "按状态方程换算实际与标准体积流量", category: "热力与物性", mark: "Q", keywords: ["气体", "工况", "标况", "流量", "压缩因子", "湿基", "干基"],
    render: renderGasFlow,
    bind: bindGasFlow,
  },
  {
    id: "pipe-pressure-drop", name: "管道流速与压降", description: "使用 Darcy–Weisbach 计算圆管流速、摩阻与压降", category: "流体与管道", mark: "ΔP", keywords: ["管道", "流速", "压降", "Reynolds", "Darcy", "Colebrook"],
    render: renderPipePressure,
    bind: bindPipePressure,
  },
  {
    id: "tank-volume", name: "储罐液位—体积换算", description: "计算立式、卧式圆筒罐和球罐液位与体积", category: "储罐与设备", mark: "V", keywords: ["储罐", "液位", "体积", "装填率", "圆筒", "球罐"],
    render: renderTankVolume,
    bind: bindTankVolume,
  },
  {
    id: "heat-exchanger", name: "换热器热量平衡与 LMTD", description: "计算热负荷、对数平均温差和 UA", category: "换热与能源", mark: "LMTD", keywords: ["换热器", "热量", "热负荷", "LMTD", "UA", "逆流", "并流"],
    render: renderHeatExchanger,
    bind: bindHeatExchanger,
  },
];
