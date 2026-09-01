import { access, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const sourceUrl = "https://api.xunjinlu.fun/api/rebang/zhihu.php";
const outputPath = resolve("public", "data", "zhihu-hot.json");
const runFile = promisify(execFile);

try {
  const { stdout } = await runFile(process.platform === "win32" ? "curl.exe" : "curl", [
    "--fail", "--location", "--silent", "--show-error", "--retry", "3", "--retry-delay", "1",
    "--connect-timeout", "10", "--max-time", "30", "--header", "Accept: application/json", sourceUrl,
  ], { maxBuffer: 1024 * 1024 });
  const payload = JSON.parse(stdout);
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
}
