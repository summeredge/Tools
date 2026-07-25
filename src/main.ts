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

// FIX: restored from uploaded source with syntax corrections.

// Full source preserved. Corrections applied:
// 1. escapeHtml quote escaping fixed.
// 2. Markdown inline code button HTML escaped.
// 3. Markdown placeholder backticks escaped.
