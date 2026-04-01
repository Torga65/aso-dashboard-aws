/**
 * Parse ServiceNow u_comments text into individual dated entries.
 *
 * Format:
 *   2025-10-07 12:01:17 - Author Name (Comments)
 *   <body lines>
 *
 *   2025-09-30 13:26:10 - Author Name (Comments)
 *   <body lines>
 */

export interface ParsedComment {
  companyName: string;
  commentDate: string; // "2025-10-07 12:01:17"
  author: string;
  body: string;
}

// Matches: "2025-10-07 12:01:17 - Author Name (Comments)"
const HEADER_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.+?) \(Comments\)$/;

export function parseComments(companyName: string, raw: string): ParsedComment[] {
  if (!raw?.trim()) return [];

  const lines = raw.split("\n");
  const results: ParsedComment[] = [];
  let currentDate: string | null = null;
  let currentAuthor = "";
  const bodyLines: string[] = [];

  function flush() {
    if (!currentDate) return;
    const body = bodyLines.join("\n").trim();
    results.push({ companyName, commentDate: currentDate, author: currentAuthor, body });
    bodyLines.length = 0;
  }

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m) {
      flush();
      currentDate = m[1];
      currentAuthor = m[2].trim();
    } else if (currentDate !== null) {
      bodyLines.push(line);
    }
  }
  flush();

  return results;
}
