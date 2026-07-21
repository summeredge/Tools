import { gasFlowModule } from "./gas-flow";
import { heatExchangerModule } from "./heat-exchanger";
import { pipePressureModule } from "./pipe-pressure-drop";
import { tankVolumeModule } from "./tank-volume";
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
  gasFlowModule,
  pipePressureModule,
  tankVolumeModule,
  heatExchangerModule,
];
