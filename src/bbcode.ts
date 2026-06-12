/**
 * Convert Nexus Mods BBCode descriptions to readable markdown-ish text.
 * Lossy by design — the goal is token-efficient readability, not fidelity.
 */
export function bbcodeToText(input: string, maxChars = 8000): string {
  let s = input.replace(/\r\n/g, "\n");

  // Nexus descriptions mix HTML line breaks and entities into the BBCode.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Links and media
  s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, "[$2]($1)");
  s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, "$1");
  s = s.replace(/\[img\][\s\S]*?\[\/img\]/gi, "");
  s = s.replace(/\[youtube\]([\s\S]*?)\[\/youtube\]/gi, "https://youtu.be/$1");

  // Inline formatting
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "**$1**");
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "*$1*");
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "`$1`");
  s = s.replace(/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, "\n> $1\n");
  s = s.replace(/\[heading\]([\s\S]*?)\[\/heading\]/gi, "\n## $1\n");

  // Lists
  s = s.replace(/\[\*\]/g, "\n- ");
  s = s.replace(/\[\/?(list|ul|ol)(?:=[^\]]*)?\]/gi, "\n");

  s = s.replace(/\[line\]/gi, "\n---\n");

  // Strip everything else: size, color, font, center, u, s, spoiler, etc.
  s = s.replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi, "");

  // Collapse whitespace
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (s.length > maxChars) {
    s = s.slice(0, maxChars) + "\n…[description truncated]";
  }
  return s;
}
