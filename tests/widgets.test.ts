import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let parseFeed: typeof import("../src/widgets").parseFeed;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("DOMParser", dom.window.DOMParser);
  ({ parseFeed } = await import("../src/widgets"));
});

afterAll(() => vi.unstubAllGlobals());

describe("RSS 数据解析", () => {
  it("解析知乎热榜接口的 JSON 返回", () => {
    const items = parseFeed(
      { name: "知乎热榜", url: "https://api.xunjinlu.fun/api/rebang/zhihu.php" },
      JSON.stringify({
        code: 200,
        data: {
          update_time: "2026-09-01T04:51:52.781Z",
          list: [
            { title: "测试问题", url: "https://www.zhihu.com/question/1" },
            { title: "缺少链接" },
          ],
        },
      }),
    );

    expect(items).toEqual([{
      title: "测试问题",
      url: "https://www.zhihu.com/question/1",
      source: "知乎热榜",
      timestamp: Date.parse("2026-09-01T04:51:52.781Z"),
    }]);
  });
});
