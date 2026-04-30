const HTML_CHAR_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
  "/": "&#47;",
  "`": "&#96;"
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"'/`]/g, (character) => HTML_CHAR_ESCAPES[character] ?? character);
}
