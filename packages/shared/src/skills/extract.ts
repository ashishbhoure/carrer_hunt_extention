import { ALL_ALIASES, canonicalSkill } from "./taxonomy";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Short/ambiguous aliases that must be matched case-sensitively or in tech context only.
const AMBIGUOUS = new Set(["go", "java", "spring", "rest", "ml", "node", "git", "express", "react", "architecture", "responsive", "containers", "auth"]);

const regexCache = new Map<string, RegExp>();
function aliasRegex(alias: string): RegExp {
  let re = regexCache.get(alias);
  if (!re) {
    // Boundaries that tolerate symbols like c++, c#, .net, node.js
    re = new RegExp(`(?<![A-Za-z0-9+#])${escapeRe(alias)}(?![A-Za-z0-9+#])`, "i");
    regexCache.set(alias, re);
  }
  return re;
}

/** Find canonical skills mentioned in text. Each skill returned once (no repetition reward). */
export function extractSkills(text: string): string[] {
  const found = new Set<string>();
  for (const { alias, canonical } of ALL_ALIASES) {
    if (found.has(canonical)) continue;
    if (alias.length <= 2 && !/[+#.]/.test(alias) && !["js", "ts", "ml"].includes(alias)) continue;
    const m = aliasRegex(alias).exec(text);
    if (!m) continue;
    if (AMBIGUOUS.has(alias)) {
      // Require the match to look like a technology mention: capitalized form or near list punctuation.
      const raw = m[0];
      const cap = raw[0] === raw[0]?.toUpperCase();
      if (!cap) continue;
    }
    found.add(canonical);
  }
  return [...found];
}

/** Find a snippet of text where the skill (or an alias) is mentioned; used as evidence. */
export function findEvidence(text: string, canonical: string, maxLen = 160): string {
  const aliases = ALL_ALIASES.filter((a) => a.canonical === canonical).map((a) => a.alias);
  for (const alias of aliases) {
    const m = aliasRegex(alias).exec(text);
    if (m) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(text.length, m.index + alias.length + 90);
      let s = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (s.length > maxLen) s = s.slice(0, maxLen);
      return (start > 0 ? "…" : "") + s + (end < text.length ? "…" : "");
    }
  }
  return "";
}

export function textMentionsSkill(text: string, canonical: string): boolean {
  return ALL_ALIASES.some((a) => a.canonical === canonical && aliasRegex(a.alias).test(text));
}

export { canonicalSkill };
