// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PROVIDERS, arbeitnow, remotive, runDiscovery, searchLinks } from "../src/discovery/providers";
import { emptyFilters, filterJobs, sortJobs } from "../src/app/jobFilters";
import { analyzeJob, buildJob, parseResumeText } from "@careerpilot/shared";
import { JD_TEXT, RESUME_TEXT } from "./helpers";

const DESC = "<p>We need a React developer.</p><h3>Requirements</h3><ul><li>React</li><li>Node.js</li></ul>" + "<p>More detail about the role goes here.</p>".repeat(6);
const remotiveJson = { jobs: [
  { id: 1, url: "https://remotive.com/remote-jobs/software-dev/react-dev-1", title: "React Developer", company_name: "Acme", candidate_required_location: "Worldwide", job_type: "full_time", publication_date: "2026-09-30T10:00:00", salary: "$80k", description: DESC },
  { id: 2, url: "javascript:alert(1)", title: "Evil", company_name: "X", description: DESC },
  { id: 3, title: "", description: DESC },
] };
const arbeitJson = { data: [
  { slug: "react-dev-berlin-1", company_name: "Beta", title: "React Engineer", description: DESC, remote: true, url: "https://www.arbeitnow.com/jobs/react-dev-berlin-1", tags: ["react"], job_types: ["full time"], location: "Berlin", created_at: 1790000000 },
  { slug: "cook-2", company_name: "Gamma", title: "Cook", description: "<p>Cooking</p>", remote: false, url: "https://www.arbeitnow.com/jobs/cook-2", tags: [], job_types: [], location: "Munich", created_at: 1790000000 },
] };
const ok = (b: unknown) => async () => new Response(JSON.stringify(b), { status: 200 });
const memCache = () => { const m = new Map<string, any>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: any) => { m.set(k, v); } }; };

describe("job feed providers", () => {
  it("normalises real-shaped Remotive data, dropping unsafe or incomplete items and keeping attribution", async () => {
    const jobs = await remotive.search({ keywords: "react" }, ok(remotiveJson) as never);
    expect(jobs.map((j) => j.title)).toEqual(["React Developer", "Evil"]);
    expect(jobs[0]).toMatchObject({ provider: "remotive", providerJobId: "1", company: "Acme", workMode: "remote", salaryRange: "$80k" });
    expect(jobs[0]!.originalUrl).toMatch(/^https:\/\/remotive\.com/);
    expect(jobs[1]!.originalUrl).toBe(""); // javascript: URL is not kept
    expect(remotive.attribution.url).toBe("https://remotive.com");
  });
  it("filters Arbeitnow client-side and converts timestamps", async () => {
    const jobs = await arbeitnow.search({ keywords: "react" }, ok(arbeitJson) as never);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.datePosted).toMatch(/^20\d\d-/);
    expect((await arbeitnow.search({ keywords: "react", remoteOnly: true }, ok(arbeitJson) as never))).toHaveLength(1);
  });
  it("isolates provider failures and reports them", async () => {
    const fetcher = vi.fn(async (url: string) => (String(url).includes("remotive") ? new Response("boom", { status: 500 }) : new Response(JSON.stringify(arbeitJson), { status: 200 })));
    const { jobs, outcomes } = await runDiscovery(PROVIDERS, { keywords: "react" }, fetcher as never, memCache());
    expect(jobs).toHaveLength(1);
    expect(outcomes.find((o) => o.provider === "remotive")).toMatchObject({ ok: false });
    expect(outcomes.find((o) => o.provider === "arbeitnow")).toMatchObject({ ok: true, count: 1 });
  });
  it("respects each provider's minimum call interval via the cache", async () => {
    const fetcher = vi.fn(ok(remotiveJson));
    const cache = memCache();
    const t = 1_000_000;
    await runDiscovery([remotive], { keywords: "react" }, fetcher as never, cache, t);
    const second = await runDiscovery([remotive], { keywords: "react" }, fetcher as never, cache, t + 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.outcomes[0]!.cached).toBe(true);
    await runDiscovery([remotive], { keywords: "react" }, fetcher as never, cache, t + 7 * 3600_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("de-duplicates across providers", async () => {
    const dup = { jobs: [{ ...remotiveJson.jobs[0]!, id: 9 }] };
    const arb = { data: [{ ...arbeitJson.data[0]!, title: "React Developer", company_name: "Acme", location: "Worldwide" }] };
    const fetcher = async (url: string) => new Response(JSON.stringify(String(url).includes("remotive") ? dup : arb), { status: 200 });
    const { jobs } = await runDiscovery(PROVIDERS, { keywords: "react" }, fetcher as never, memCache());
    expect(jobs).toHaveLength(1);
  });
  it("only builds search links, never fetches", () => {
    const links = searchLinks("React Developer", "Pune");
    expect(links.map((l) => l.site)).toEqual(["LinkedIn", "Naukri", "Indeed"]);
    expect(links[1]!.url).toBe("https://www.naukri.com/react-developer-jobs-in-pune");
    expect(searchLinks("  ", "x")).toEqual([]);
  });
});

describe("job filtering and ranking", () => {
  const { profile } = parseResumeText(RESUME_TEXT);
  const mk = (o: object) => buildJob({ description: JD_TEXT, ...o } as never);
  const jobs = [mk({ title: "MERN Developer", company: "LogiCo", location: "Pune", url: "https://a.com/1" }), mk({ title: "Cook", company: "Diner", location: "Berlin", description: "Requirements\n- Cooking\n- Knife skills\n" + "x".repeat(50), datePosted: "2020-01-01" }), mk({ title: "Remote React", company: "Acme", location: "Remote", workMode: "remote", datePosted: new Date().toISOString() })];
  const scores = new Map(jobs.map((j) => [j.id, analyzeJob({ job: j, profile, resumeId: "r", resumeText: RESUME_TEXT })]));
  it("filters by keywords, location, mode, score and verified date", () => {
    expect(filterJobs(jobs, scores, { ...emptyFilters, keywords: "react" }).map((j) => j.title)).toContain("Remote React");
    expect(filterJobs(jobs, scores, { ...emptyFilters, location: "berlin" })).toHaveLength(1);
    expect(filterJobs(jobs, scores, { ...emptyFilters, workMode: "remote" }).map((j) => j.title)).toEqual(["Remote React"]);
    expect(filterJobs(jobs, scores, { ...emptyFilters, minScore: 50 }).every((j) => j.title !== "Cook")).toBe(true);
    // jobs without a verified date are excluded when filtering by date
    expect(filterJobs(jobs, scores, { ...emptyFilters, postedWithinDays: 7 }).map((j) => j.title)).toEqual(["Remote React"]);
  });
  it("sorts by score", () => {
    const sorted = sortJobs(jobs, scores, "score");
    expect(sorted.at(-1)!.title).toBe("Cook");
  });
});
