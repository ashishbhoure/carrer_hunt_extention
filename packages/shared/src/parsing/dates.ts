const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse "Jan 2021", "01/2021", "2021" or "Present" to a month index (year*12+month). null when unparseable. */
export function parseMonthIndex(raw: string, now = new Date()): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^(present|current|now|till date|ongoing|today)$/.test(s)) return now.getFullYear() * 12 + now.getMonth();
  let m = /^([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!);
    if (mi >= 0) return Number(m[2]) * 12 + mi;
  }
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return Number(m[2]) * 12 + (Number(m[1]) - 1);
  m = /^(\d{4})$/.exec(s);
  if (m) return Number(m[1]) * 12;
  return null;
}

export interface DatedRole { start: string; end: string; current?: boolean }

/** Total years across roles, merging overlaps. Returns null if no role has a parseable start. */
export function estimateYears(roles: DatedRole[], now = new Date()): number | null {
  const ranges: Array<[number, number]> = [];
  for (const r of roles) {
    const s = parseMonthIndex(r.start, now);
    const e = r.current ? parseMonthIndex("present", now) : parseMonthIndex(r.end, now);
    if (s === null || e === null || e < s) continue;
    ranges.push([s, e]);
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = ranges[0]!;
  for (const [s, e] of ranges.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else { total += ce - cs; cs = s; ce = e; }
  }
  total += ce - cs;
  return Math.round((total / 12) * 10) / 10;
}
