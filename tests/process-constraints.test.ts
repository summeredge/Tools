import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { processToolModules } from "../src/tools/registry";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(root, dir))) {
    const full = `${dir}/${entry}`;
    if (statSync(resolve(root, full)).isDirectory()) collectTs(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("源码约束", () => {
  it("main.ts 不含新工具的独立分发分支", () => {
    const main = read("src/main.ts");
    ["control-valve-sizing", "steam-prds"].forEach((id) => {
      expect(main).not.toContain(`id === "${id}"`);
      expect(main).not.toContain(`case "${id}"`);
    });
    expect(main).toContain("processToolModules.find");
  });

  it("项目内只存在一套 IF97 数值实现", () => {
    const sources = collectTs("src").map((path) => [path, read(path)] as const);
    const withCoefficients = sources.filter(([, content]) => content.includes(".14632971213167"));
    expect(withCoefficients.map(([path]) => path)).toEqual(["src/tools/shared/if97-vendor.ts"]);
    const vendorConsumers = sources.filter(([path, content]) => path !== "src/tools/shared/if97-vendor.ts" && content.includes("solvePT("));
    vendorConsumers.forEach(([path, content]) => {
      expect(content.includes('from "../shared/if97-adapter"') || content.includes('from "./if97-adapter"') || content.includes("./if97-vendor"), `${path} 应通过 if97-adapter 使用 IF97`).toBe(true);
    });
  });

  it("过程工程工具不使用 fetch 或远程 API", () => {
    const toolSources = collectTs("src/tools");
    toolSources.forEach((path) => {
      const content = read(path);
      expect(content, `${path} 不应包含 fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(content, `${path} 不应包含 XMLHttpRequest`).not.toContain("XMLHttpRequest");
    });
  });

  it("既有工具 id 与 localStorage key 不变，新工具 key 使用 workbench: 前缀", () => {
    const registry = read("src/tools/registry.ts");
    ["gas-flow", "pipe-pressure-drop", "tank-volume", "heat-exchanger"].forEach((id) => expect(registry).toContain(`"${id}"`));
    const binds = ["src/tools/pipe-pressure-drop/bind.ts", "src/tools/control-valve-sizing/bind.ts", "src/tools/steam-prds/bind.ts", "src/tools/heat-exchanger/bind.ts"].map(read).join("\n");
    expect(binds).toContain('"workbench:pipe-pressure-drop"');
    expect(binds).toContain('"workbench:heat-exchanger"');
    expect(binds).toContain('"workbench:control-valve-sizing"');
    expect(binds).toContain('"workbench:steam-prds"');
  });

  it("每个新工具具备 logic、view、bind、index 四个模块", () => {
    ["control-valve-sizing", "steam-prds"].forEach((dir) => {
      ["logic.ts", "view.ts", "bind.ts", "index.ts"].forEach((file) => {
        expect(() => statSync(resolve(root, `src/tools/${dir}/${file}`)), `${dir}/${file} 缺失`).not.toThrow();
      });
    });
  });

  it("控制阀阻塞状态为三态，且输出不包含阀门开度结论", () => {
    const logic = read("src/tools/control-valve-sizing/logic.ts");
    expect(logic).toContain('"not-evaluated"');
    expect(logic).toContain('choked: ChokedStatus');
    const view = read("src/tools/control-valve-sizing/view.ts");
    expect(view).toContain("未评估");
    expect(view).not.toMatch(/开度[为约]\s*\d/);
  });

  it("新工具通过 processToolModules 注册", () => {
    const ids = processToolModules.map((module) => module.id);
    expect(ids).toContain("control-valve-sizing");
    expect(ids).toContain("steam-prds");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("天气、化学品安全、Markdown、文本、文本对比功能未被本任务修改", () => {
    // 这些模块在任务禁止清单中；其源文件不应引用过程工具或 IF97
    ["src/weather.ts", "src/safety.ts", "src/markdown.ts", "src/logic.ts"].forEach((path) => {
      const content = read(path);
      expect(content).not.toContain("if97");
      expect(content).not.toContain("processToolModules");
    });
  });
});
