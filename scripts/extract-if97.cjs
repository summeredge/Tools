// 从 public/tools/if97.html 中提取 iapws-if97 v2.1.5 打包体（IIFE 内部），
// 追加显式导出生成 src/tools/shared/if97-vendor.ts。系数与算法逐字节复用，不重排、不重写。
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/tools/if97.html"), "utf8");
const openEnd = html.indexOf(">", html.indexOf("<script>")) + 1;
const close = html.indexOf("</script>", openEnd);
const script = html.slice(openEnd, close);
const uiMarker = "var E=e=>document.querySelector";
const uiStart = script.indexOf(uiMarker);
if (uiStart < 0) throw new Error("未找到库与界面代码的分界标记");
const lib = script.slice(0, uiStart);
if (!lib.startsWith("(()=>{")) throw new Error("打包体应为 IIFE 开头");

const header = `/* eslint-disable */
// Bundled dependency: iapws-if97 v2.1.5 (MIT)
// MIT License
//
// Copyright (c) 2026 jltonghui
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// 本文件由 scripts/extract-if97.cjs 从 public/tools/if97.html 内嵌打包体提取，
// 是项目唯一的 IF97 数值实现。如需更新，请同步更新该页面与本文件。
// @ts-nocheck
`;

const footer = `;return {
  solvePT: Q0,
  saturationTemperatureK: O,
  saturationPressureMpa: g0,
  Region: S,
  IF97Error: P,
  OutOfRangeError: B,
  ConvergenceError: T,
  constants: { criticalPressureMpa: N, criticalTemperatureK: y, triplePressureMpa: A },
};})()`;

const body = lib.slice("(()=>{".length);
const out = header + "\nconst if97 = (()=>{" + body + footer + ";\n\nexport default if97;\n";
fs.writeFileSync(path.join(root, "src/tools/shared/if97-vendor.ts"), out);
console.log("written src/tools/shared/if97-vendor.ts,", out.length, "chars");
