import { afterEach, describe, expect, it } from "vitest";
import { createStorageAdapter } from "../src/logic";
import { fetchSafety } from "../src/safety";

describe("存储降级", () => {
  it("浏览器存储不可用时工具仍可读写失败而不抛错", () => {
    const adapter = createStorageAdapter({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(adapter.available).toBe(false);
    expect(adapter.read("key", "fallback")).toBe("fallback");
    expect(adapter.write("key", "value")).toBe(false);
  });
});

describe("化学品安全信息服务", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("按名称解析 PubChem CID 并提取 GHS 摘要", async () => {
    const requestedUrls: string[] = [];
    const safetyPayload = {
      Record: {
        RecordTitle: "Ethanol",
        Section: [{
          TOCHeading: "Safety and Hazards",
          Section: [{
            TOCHeading: "Hazards Identification",
            Section: [
              { TOCHeading: "GHS Classification", Information: [{ Name: "Pictogram(s)", Value: { StringWithMarkup: [{ String: " ", Markup: [{ Extra: "Flammable" }] }] } }, { Name: "Signal", Value: { StringWithMarkup: [{ String: "Danger" }] } }, { Name: "GHS Hazard Statements", Value: { StringWithMarkup: [{ String: "H225: Highly Flammable liquid and vapor" }] } }, { Name: "Precautionary Statement Codes", Value: { StringWithMarkup: [{ String: "P210, P233" }] } }] },
              { TOCHeading: "Health Hazards", Information: [{ Name: "Summary", Value: { String: "Toxic by inhalation" } }] },
              { TOCHeading: "First Aid Measures", Information: [{ Name: "Inhalation First Aid", Value: { String: "Fresh air and medical attention" } }] },
            ],
          }],
        }],
      },
    };
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("wbsearchentities")) return new Response(JSON.stringify({ search: [{ id: "Q14982", label: "甲醇" }] }));
      if (url.includes("wbgetentities")) return new Response(JSON.stringify({ entities: { Q14982: { claims: { P662: [{ mainsnak: { datavalue: { value: "887" } } }] } } } }));
      if (url.includes("/cids/")) return new Response(JSON.stringify({ IdentifierList: { CID: [702] } }));
      if (url.includes("/property/")) return new Response(JSON.stringify({ PropertyTable: { Properties: [{ IUPACName: "ethanol", MolecularFormula: "C2H6O", MolecularWeight: "46.07" }] } }));
      return new Response(JSON.stringify(safetyPayload));
    }) as typeof fetch;

    const result = await fetchSafety("ethanol");

    expect(requestedUrls[0]).toContain("/compound/name/ethanol/cids/JSON");
    expect(result.cid).toBe(702);
    expect(result.formula).toBe("C2H6O");
    expect(result.pictograms).toEqual(["Flammable"]);
    expect(result.signal).toBe("Danger");
    expect(result.hazards).toContain("H225");
    expect(result.safetySections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "健康危害", content: expect.stringContaining("Toxic by inhalation") }),
      expect.objectContaining({ title: "急救措施", content: expect.stringContaining("Fresh air") }),
    ]));

    requestedUrls.length = 0;
    await fetchSafety("64-17-5");
    expect(requestedUrls[0]).toContain("/compound/identifier/64-17-5/cids/JSON?identifier_type=CAS");

    requestedUrls.length = 0;
    const chineseResult = await fetchSafety("甲醇");
    expect(requestedUrls[0]).toContain("wikidata.org/w/api.php?action=wbsearchentities");
    expect(chineseResult.cid).toBe(887);
    expect(chineseResult.nameSource).toBe("Wikidata");
  });

  it("没有 CID 时返回可理解的空结果错误", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ IdentifierList: { CID: [] } }))) as typeof fetch;
    await expect(fetchSafety("不存在的化学品")).rejects.toMatchObject({ kind: "empty" });
  });
});
