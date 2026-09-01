import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceUrl = "https://api.xunjinlu.fun/api/rebang/zhihu.php";
const outputPath = resolve("public", "data", "zhihu-hot.json");
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);

try {
  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json" },
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const list = payload?.data?.list;
  if (!Array.isArray(list) || !list.some((item) => item && typeof item.title === "string" && typeof item.url === "string")) {
    throw new Error("知乎热榜响应格式无效");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload), "utf8");
  console.log(`Saved ${list.length} Zhihu hot items for GitHub Pages.`);
} catch (error) {
  try {
    await access(outputPath);
    console.warn(`RSS 更新失败，沿用已有快照：${error instanceof Error ? error.message : String(error)}`);
  } catch {
    throw error;
  }
} finally {
  clearTimeout(timeout);
}
