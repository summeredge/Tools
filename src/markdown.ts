import { marked } from "marked";

export function renderMarkdown(source: string, sanitize: (html: string) => string): string {
  const html = marked.parse(source, { gfm: true, breaks: true, async: false });
  return sanitize(String(html));
}
