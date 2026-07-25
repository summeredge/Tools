import DOMPurify from "dompurify";
import "./styles.css";
import { diffLines } from "diff";
import { renderMarkdown } from "./markdown";
import {
  createStorageAdapter,
  sortLines,
  textStats,
  uniqueLines,
} from "./logic";
import { fetchSafety, SafetyError, type SafetyResult } from "./safety";

type ToolId = "safety" | "markdown" | "text" | "diff";
type HomeMode = "all" | "favorites" | "recent";
type Theme = "system" | "light" | "dark";

type Tool = { id: ToolId; name: string; description: string; category: string; mark: string; keywords: string[] };

const tools: Tool[] = [
  { id: "safety", name: "化学品安全信息", description: "查询 PubChem 安全摘要与官方数据库链接", category: "外部数据", mark: "SDS", keywords: ["化学品", "SDS", "MSDS", "CAS", "安全", "GHS"] },
  { id: "markdown", name: "Markdown", description: "左侧编辑，右侧实时预览，草稿自动保存在本机", category: "文档", mark: "MD", keywords: ["文档", "预览", "表格", "代码", "markdown"] },
  { id: "text", name: "文本处理", description: "统计、清理、排序、去重与大小写转换", category: "文本", mark: "Aa", keywords: ["字符", "行", "空白", "排序"] },
  { id: "diff", name: "文本对比", description: "逐行查看新增、删除与未变化内容", category: "文本", mark: "Δ", keywords: ["差异", "比较", "新增", "删除"] },
];

// placeholder: will be replaced with original source
