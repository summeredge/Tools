export type SafetyResult = {
  query: string;
  cid: number;
  title: string;
  iupacName: string;
  formula: string;
  molecularWeight: string;
  pictograms: string[];
  signal: string;
  hazards: string;
  precautions: string;
  safetySections: SafetySection[];
  fetchedAt: string;
  nameSource: "PubChem" | "Wikidata";
};

export type SafetySection = { title: string; content: string };

export class SafetyError extends Error {
  readonly kind: "empty" | "rate" | "network" | "service";
  constructor(kind: SafetyError["kind"], message: string) { super(message); this.kind = kind; }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }

function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]; }

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join(" ");
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.String === "string") return record.String.trim();
  if (record.StringWithMarkup !== undefined) return textFromValue(record.StringWithMarkup);
  return "";
}

function extrasFromValue(value: unknown): string[] {
  const extras: string[] = [];
  for (const item of asArray(value)) {
    const record = asRecord(item);
    for (const markup of asArray(record?.Markup)) {
      const extra = asRecord(markup)?.Extra;
      if (typeof extra === "string" && extra.trim()) extras.push(extra.trim());
    }
    const stringWithMarkup = record?.StringWithMarkup;
    if (stringWithMarkup !== undefined) extras.push(...extrasFromValue(stringWithMarkup));
  }
  return [...new Set(extras)];
}

function findSections(value: unknown, heading: string): JsonRecord[] {
  const matches: JsonRecord[] = [];
  const visit = (current: unknown): void => {
    for (const item of asArray(current)) {
      const record = asRecord(item);
      if (!record) continue;
      if (record.TOCHeading === heading) matches.push(record);
      visit(record.Section);
    }
  };
  visit(value);
  return matches;
}

function informationText(section: JsonRecord, name: string): string {
  const entry = asArray(section.Information).find((item) => asRecord(item)?.Name === name);
  return textFromValue(asRecord(entry)?.Value);
}

function informationExtras(section: JsonRecord, name: string): string[] {
  const entry = asArray(section.Information).find((item) => asRecord(item)?.Name === name);
  return extrasFromValue(asRecord(entry)?.Value);
}

function sectionSummary(sections: unknown, heading: string): string {
  const section = findSections(sections, heading)[0];
  if (!section) return "";
  const lines: string[] = [];
  const visit = (current: JsonRecord): void => {
    for (const entry of asArray(current.Information)) {
      const record = asRecord(entry);
      const name = typeof record?.Name === "string" ? record.Name.trim() : "";
      const text = textFromValue(record?.Value);
      if (name && text) lines.push(`${name}: ${text}`);
    }
    for (const child of asArray(current.Section)) {
      const childRecord = asRecord(child);
      if (childRecord) visit(childRecord);
    }
  };
  visit(section);
  return [...new Set(lines)].join("\n");
}

async function fetchJson(url: string, service = "PubChem"): Promise<unknown> {
  try {
    const response = await fetch(url);
    if (response.status === 404) throw new SafetyError("empty", "没有找到对应化学品，请尝试 CAS 号、中文名称或英文名称。");
    if (response.status === 429) throw new SafetyError("rate", `${service} 查询较频繁，请稍后重试。`);
    if (!response.ok) throw new SafetyError("service", `${service} 服务返回 HTTP ${response.status}。`);
    return await response.json();
  } catch (error) {
    if (error instanceof SafetyError) throw error;
    throw new SafetyError("network", `无法连接 ${service}，请检查网络后重试。`);
  }
}

function claimValue(claims: JsonRecord | null, property: string): string {
  for (const claim of asArray(claims?.[property])) {
    const value = asRecord(asRecord(claim)?.mainsnak)?.datavalue;
    const dataValue = asRecord(value)?.value;
    if (typeof dataValue === "string" || typeof dataValue === "number") return String(dataValue);
  }
  return "";
}

async function resolveChineseName(query: string): Promise<{ cid: number; source: "Wikidata" } | null> {
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=zh&uselang=zh&type=item&limit=5&format=json&formatversion=2&origin=*`;
  const searchPayload = asRecord(await fetchJson(searchUrl, "Wikidata"));
  const exact = asArray(searchPayload?.search).map(asRecord).find((item) => item?.label === query);
  const entityId = typeof exact?.id === "string" ? exact.id : "";
  if (!entityId) return null;

  const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(entityId)}&props=claims&format=json&formatversion=2&origin=*`;
  const entityPayload = asRecord(await fetchJson(entityUrl, "Wikidata"));
  const entities = asRecord(entityPayload?.entities);
  const entity = asRecord(entities?.[entityId]);
  const claims = asRecord(entity?.claims);
  const cid = Number(claimValue(claims, "P662"));
  if (Number.isInteger(cid) && cid > 0) return { cid, source: "Wikidata" };

  const cas = claimValue(claims, "P231");
  if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return null;
  const casPayload = asRecord(await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/identifier/${encodeURIComponent(cas)}/cids/JSON?identifier_type=CAS`));
  const identifierList = asRecord(casPayload?.IdentifierList);
  const casCid = Number(asArray(identifierList?.CID)[0]);
  return Number.isInteger(casCid) && casCid > 0 ? { cid: casCid, source: "Wikidata" } : null;
}

export async function fetchSafety(query: string): Promise<SafetyResult> {
  const normalized = query.trim();
  if (!normalized) throw new SafetyError("empty", "请输入化学品名称或 CAS 号。");

  const isCas = /^\d{2,7}-\d{2}-\d$/.test(normalized);
  let resolved: { cid: number; source: "PubChem" | "Wikidata" } | null = /[^\x00-\x7F]/u.test(normalized) ? await resolveChineseName(normalized) : null;
  if (!resolved) {
    const cidUrl = isCas
      ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/identifier/${encodeURIComponent(normalized)}/cids/JSON?identifier_type=CAS`
      : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(normalized)}/cids/JSON`;
    const cidPayload = asRecord(await fetchJson(cidUrl));
    const identifierList = asRecord(cidPayload?.IdentifierList);
    const cid = Number(asArray(identifierList?.CID)[0]);
    if (!Number.isInteger(cid) || cid <= 0) throw new SafetyError("empty", "没有找到对应化学品，请尝试 CAS 号、中文名称或英文名称。");
    resolved = { cid, source: "PubChem" };
  }
  const { cid } = resolved;

  const [propertyPayload, safetyPayload] = await Promise.all([
    fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`),
    fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Safety%20and%20Hazards`),
  ]);
  const propertyTable = asRecord(asRecord(propertyPayload)?.PropertyTable);
  const property = asRecord(asArray(propertyTable?.Properties)[0]);
  const record = asRecord(asRecord(safetyPayload)?.Record);
  const ghs = findSections(record?.Section, "GHS Classification")[0];
  const safetySectionDefinitions: Array<[string, string]> = [
    ["健康危害", "Health Hazards"],
    ["火灾危害", "Fire Hazards"],
    ["急救措施", "First Aid Measures"],
    ["泄漏处置", "Accidental Release Measures"],
    ["操作与储存", "Handling and Storage"],
    ["暴露控制与个人防护", "Exposure Control and Personal Protection"],
    ["稳定性与反应性", "Stability and Reactivity"],
    ["运输信息", "Transport Information"],
  ];
  const safetySections = safetySectionDefinitions.map(([title, heading]) => ({ title, content: sectionSummary(record?.Section, heading) })).filter((section) => section.content);

  return {
    query: normalized,
    cid,
    title: typeof record?.RecordTitle === "string" ? record.RecordTitle : normalized,
    iupacName: typeof property?.IUPACName === "string" ? property.IUPACName : "未提供",
    formula: typeof property?.MolecularFormula === "string" ? property.MolecularFormula : "未提供",
    molecularWeight: typeof property?.MolecularWeight === "string" ? property.MolecularWeight : "未提供",
    pictograms: ghs ? informationExtras(ghs, "Pictogram(s)") : [],
    signal: ghs ? informationText(ghs, "Signal") || "未提供" : "未提供",
    hazards: ghs ? informationText(ghs, "GHS Hazard Statements") || "未提供" : "未提供",
    precautions: ghs ? informationText(ghs, "Precautionary Statement Codes") || "未提供" : "未提供",
    safetySections,
    fetchedAt: new Date().toISOString(),
    nameSource: resolved.source,
  };
}
