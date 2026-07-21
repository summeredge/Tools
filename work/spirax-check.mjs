import { solvePT, solvePH, saturationProperties } from "../src/tools/shared/if97-adapter.ts";

// Spirax Sarco 公开案例：10000 kg/h、10 bar(a)、300°C，喷水 150°C，目标约 185°C → 喷水约 1208 kg/h
const P1 = 1.0; // MPa
const T1 = 573.15;
const P2 = 1.0; // 本案例减温为主（或近似等压），先按等压验证能量平衡
const Tw = 423.15; // 150°C
const h1 = solvePT(P1, T1).enthalpyKjKg;
const hw = solvePT(P1, Tw).enthalpyKjKg;
const ms = 10000;
// 目标 185°C
const Ttarget = 458.15;
const hout = solvePT(P2, Ttarget).enthalpyKjKg;
const mw = ms * (h1 - hout) / (hout - hw);
console.log("h1 =", h1.toFixed(2), "hw =", hw.toFixed(2), "hout =", hout.toFixed(2));
console.log("mw =", mw.toFixed(1), "kg/h (expect ~1208)");
// 反向验证：ms*h1 + mw*hw = (ms+mw)*hout
const residual = (ms * h1 + mw * hw - (ms + mw) * hout) / ((ms + mw) * hout);
console.log("residual =", residual.toExponential(3));
// 减压案例：10 bar 300°C 节流到 2 bar
const h2 = h1; // 等焓
const out = solvePH(0.2, h2);
console.log("节流后 T =", (out.temperatureK - 273.15).toFixed(2), "°C, phase =", out.phase, "Tsat =", (out.saturationTemperatureK - 273.15).toFixed(2));
// 两相案例：2 MPa 250°C 节流到 0.1 MPa
const hIn2 = solvePT(2, 523.15).enthalpyKjKg;
const out2 = solvePH(0.1, hIn2);
console.log("两相案例 phase =", out2.phase, "x =", out2.quality);
