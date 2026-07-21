import { bindControlValve } from "./bind";
import { renderControlValve } from "./view";
import type { ProcessToolModule } from "../registry";

export const controlValveModule: ProcessToolModule = {
  id: "control-valve-sizing",
  name: "控制阀 Cv/Kv 初步选型",
  description: "按 IEC 60534-2-1 估算单相液体与气体控制阀的所需流通系数或可通过流量",
  category: "流体与管道",
  mark: "Cv",
  keywords: ["控制阀", "Cv", "Kv", "选型", "IEC", "阻塞流", "汽蚀"],
  render: renderControlValve,
  bind: bindControlValve,
};

export { bindControlValve } from "./bind";
export { renderControlValve } from "./view";
