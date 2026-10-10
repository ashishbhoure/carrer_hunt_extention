import { describe, expect, it } from "vitest";
import { extractFromPage, pickAdapter } from "../src/adapters/adapters";
import { htmlToText } from "../src/adapters/dom";
import { fillFields, scanForm } from "../src/content/forms";
import { mapFormFields, parseResumeText } from "@careerpilot/shared";
import { RESUME_TEXT } from "./helpers";

const page = (html: string, url: string, selection = "") => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (selection) Object.defineProperty(doc, "defaultView", { value: { getSelection: () => ({ toString: () => selection }), getComputedStyle: () => ({ display: "block", visibility: "visible" }) } });
  return { doc, url: new URL(url) };
};

const LONG = "We are looking for a developer to build web apps. ".repeat(8);

const JSONLD = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "JobPosting", title: "React Developer", hiringOrganization: { "@type": "Organization", name: "Acme" },
  jobLocation: { address: { addressLocality: "Pune", addressRegion: "MH", addressCountry: "IN" } }, employmentType: "FULL_TIME", datePosted: "2026-05-01",
  baseSalary: { currency: "INR", value: { minValue: 1200000, maxValue: 1800000, unitText: "YEAR" } },
  description: `<p>${LONG}</p><h3>Requirements</h3><ul><li>3+ years of experience</li><li>React and Node.js</li></ul><h3>Nice to have</h3><ul><li>TypeScript</li></ul>`,
})}</script></head><body><h1>ignored</h1></body></html>`;

describe("extraction adapters", () => {
  it("reads structured JobPosting metadata with high confidence", () => {
    const r = extractFromPage(page(JSONLD, "https://www.naukri.com/job-listings-react-developer-acme-123"));
    expect(r.adapterId).toBe("naukri");
    expect(r.status).toBe("ok");
    expect(r.fields).toMatchObject({ title: "React Developer", company: "Acme", location: "Pune, MH, IN", employmentType: "Full time", datePosted: "2026-05-01" });
    expect(r.fields.salaryRange).toMatch(/1200000/);
    expect(r.fields.confidence).toBeGreaterThan(0.8);
    expect(r.fields.description).toContain("- React and Node.js");
  });
  it("falls back to semantic selectors with lower confidence and a verification note", () => {
    const html = `<html><body><h1 class="jd-header-title">Node Developer</h1><div class="jd-header-comp-name"><a>Beta Corp</a></div><section class="job-desc"><p>${LONG}</p><h3>Requirements</h3><ul><li>Node.js</li><li>MongoDB</li></ul></section></body></html>`;
    const r = extractFromPage(page(html, "https://www.naukri.com/job-listings-node-1"));
    expect(r.fields.title).toBe("Node Developer");
    expect(r.fields.company).toBe("Beta Corp");
    expect(r.fields.confidence).toBeLessThan(0.7);
    expect(r.fields.notes?.join(" ")).toMatch(/verify/i);
    expect(r.status).toBe("ok");
  });
  it("reports unsupported / non-job pages instead of guessing", () => {
    const r = extractFromPage(page("<html><body><h1>My blog</h1><p>Hello world</p></body></html>", "https://example.com/blog"));
    expect(r.adapterId).toBe("generic");
    expect(["not_a_job_page", "partial", "failed"]).toContain(r.status);
    expect(r.fields.description ?? "").toBe("");
  });
  it("never reads the LinkedIn DOM, only the user's selection", () => {
    const html = `<html><body><h1>Secret Title</h1><div class="description">${LONG}</div></body></html>`;
    const none = extractFromPage(page(html, "https://www.linkedin.com/jobs/view/3812345678/"));
    expect(none.adapterId).toBe("linkedin");
    expect(none.status).toBe("unsupported");
    expect(none.fields.title ?? "").toBe("");
    expect(none.fields.description).toBe("");
    const sel = extractFromPage(page(html, "https://www.linkedin.com/jobs/view/3812345678/", LONG));
    expect(sel.fields.description).toBe(LONG.trim());
    expect(sel.fields.title ?? "").toBe("");
  });
  it("picks adapters by host", () => {
    expect(pickAdapter(new URL("https://www.hirist.tech/j/1")).id).toBe("hirist");
    expect(pickAdapter(new URL("https://in.indeed.com/viewjob")).id).toBe("indeed");
    expect(pickAdapter(new URL("https://careers.unknown.io/x")).id).toBe("generic");
  });
  it("converts html lists to readable text and drops scripts", () => {
    expect(htmlToText("<p>Hi</p><script>alert(1)</script><ul><li>a</li><li>b</li></ul>")).toBe("Hi\n\n- a\n- b");
  });
  it("tolerates malformed JSON-LD", () => {
    const r = extractFromPage(page(`<html><head><script type="application/ld+json">{oops</script></head><body><h1>Dev</h1></body></html>`, "https://x.com/j"));
    expect(r.fields.title).toBe("Dev");
  });
});

const FORM = `<form>
  <label for="n">Full Name</label><input id="n" name="name">
  <label for="e">Email</label><input id="e" type="email" name="email">
  <label for="c">Expected CTC</label><input id="c" name="ctc">
  <label for="g">Gender</label><input id="g" name="gender">
  <input type="password" name="pw"><input type="hidden" name="h" value="x">
  <label for="p">Phone</label><input id="p" name="phone" value="12345">
  <label for="q">Why do you want to join us?</label><textarea id="q" name="why"></textarea>
  <input type="file" name="cv"><button type="submit" id="go">Submit application</button>
</form>`;

describe("application form scan and fill", () => {
  const { profile } = parseResumeText(RESUME_TEXT);
  it("scans only fillable fields (no passwords/hidden/buttons)", () => {
    const doc = new DOMParser().parseFromString(FORM, "text/html");
    const fields = scanForm(doc);
    expect(fields.map((f) => f.name)).toEqual(["name", "email", "ctc", "gender", "phone", "why", "cv"]);
    expect(fields.find((f) => f.name === "name")?.label).toBe("Full Name");
  });
  it("maps carefully and never guesses sensitive or screening answers", () => {
    const doc = new DOMParser().parseFromString(FORM, "text/html");
    const maps = mapFormFields(scanForm(doc), { ...profile, salaryPreferences: { currency: "INR", minimum: null, target: null } });
    const by = (n: string) => maps.find((m) => m.field.name === n)!;
    expect(by("email").value).toBe("rahul.sharma@example.com");
    expect(by("gender").value).toBe("");
    expect(by("why").value).toBe("");
    expect(by("ctc")).toMatchObject({ key: "expectedSalary", value: "", sensitive: true });
    expect(by("cv").value).toBe("");
  });
  it("fills approved values, never overwrites, never submits", () => {
    const doc = new DOMParser().parseFromString(FORM, "text/html");
    let submitted = false, clicked = false;
    doc.querySelector("form")!.addEventListener("submit", () => { submitted = true; });
    doc.getElementById("go")!.addEventListener("click", () => { clicked = true; });
    const res = fillFields(doc, [
      { selector: "#n", value: "Rahul Sharma" }, { selector: "#p", value: "99999" },
      { selector: "input[name=pw]", value: "x" }, { selector: "input[name=cv]", value: "x" }, { selector: "#missing", value: "x" },
    ]);
    expect((doc.getElementById("n") as HTMLInputElement).value).toBe("Rahul Sharma");
    expect((doc.getElementById("p") as HTMLInputElement).value).toBe("12345");
    expect(res.map((r) => r.filled)).toEqual([true, false, false, false, false]);
    expect((doc.querySelector("input[name=pw]") as HTMLInputElement).value).toBe("");
    expect(submitted || clicked).toBe(false);
  });
});
