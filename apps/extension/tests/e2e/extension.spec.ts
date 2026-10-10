import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import { jsPDF } from "jspdf";
import { JD_TEXT, RESUME_TEXT } from "../fixtures";

const DIST = resolve(process.cwd(), "dist");
let ctx: BrowserContext;
let extId = "";
let server: http.Server;
let serverUrl = "";
let pdfPath = "";

function makePdf(): string {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  let y = 50;
  for (const line of RESUME_TEXT.split("\n")) { if (line.trim()) { pdf.setFontSize(10); pdf.text(line.replace(/•/g, "-"), 40, y); y += 14; if (y > 800) { pdf.addPage(); y = 50; } } else y += 6; }
  const p = join(mkdtempSync(join(tmpdir(), "cp-")), "resume.pdf");
  writeFileSync(p, Buffer.from(pdf.output("arraybuffer")));
  return p;
}

test.beforeAll(async () => {
  expect(existsSync(join(DIST, "manifest.json")), "run `pnpm build` first").toBe(true);
  pdfPath = makePdf();
  server = http.createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(`<html><body><h1>MERN Stack Developer</h1><pre>${JD_TEXT}</pre></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  serverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/job`;
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "cp-profile-")), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker");
  extId = new URL(sw.url()).host;
});
test.afterAll(async () => { await ctx?.close(); server?.close(); });

const app = (hash: string) => `chrome-extension://${extId}/app.html#${hash}`;

test("manifest requests only minimal permissions", async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/manifest.json`);
  const m = JSON.parse(await page.locator("body").innerText());
  expect(m.permissions.sort()).toEqual(["activeTab", "scripting", "storage"]);
  expect(m.host_permissions).toBeUndefined();
  expect(m.content_scripts).toBeUndefined();
  expect(m.optional_host_permissions).toBeDefined();
  await page.close();
});

test("onboarding with a real PDF → parsed profile → paste job → analysis → save → tailor → tracker", async () => {
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app("/onboarding"));
  await page.getByRole("button", { name: "Get started" }).click();

  // invalid file is rejected clearly
  const bad = join(mkdtempSync(join(tmpdir(), "cp-")), "evil.pdf");
  writeFileSync(bad, "this is not a pdf");
  await page.getByTestId("resume-input").setInputFiles(bad);
  await expect(page.getByText(/contents must match/)).toBeVisible();

  // real PDF is parsed with pdf.js in the browser
  await page.getByTestId("resume-input").setInputFiles(pdfPath);
  await expect(page.getByText(/Parsing confidence/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Review profile" }).click();

  await expect(page.getByLabel("Full name")).toHaveValue("Rahul Sharma");
  await expect(page.getByLabel("Email")).toHaveValue("rahul.sharma@example.com");
  await expect(page.getByText("Unverified").first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm all current levels" }).click();
  await page.getByRole("button", { name: "Save & continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back, Rahul/ })).toBeVisible();

  // paste a job
  await page.getByRole("button", { name: "Analyze a job" }).click();
  const dlg = page.getByRole("dialog", { name: "Add a job" });
  await dlg.getByLabel("Job title").fill("MERN Stack Developer");
  await dlg.getByLabel("Company").fill("LogiCo");
  await dlg.getByLabel("Job description").fill(JD_TEXT);
  await dlg.getByRole("button", { name: "Analyze job" }).click();

  await expect(page.getByText("Score breakdown")).toBeVisible();
  await expect(page.getByText("Required skills coverage")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Not found in your resume/ })).toBeVisible();
  const ring = page.getByRole("img", { name: /Match score/ }).first();
  const score = Number(/Match score (\d+)/.exec((await ring.getAttribute("aria-label")) ?? "")?.[1]);
  expect(score).toBeGreaterThan(40);
  expect(score).toBeLessThanOrEqual(100);

  await page.getByRole("button", { name: "Save job" }).click();
  await expect(page.getByRole("button", { name: "In tracker" })).toBeVisible();

  await page.getByRole("button", { name: "Tailor resume" }).click();
  await page.getByRole("button", { name: "Generate tailored version" }).click();
  await expect(page.getByText("Tailored", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Kubernetes.*NOT added/)).toBeVisible();
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.locator("pre")).not.toContainText("Kubernetes");

  // export works (real download)
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export DOCX" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.docx$/);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Quick PDF" }).click()]);
  expect(dl2.suggestedFilename()).toMatch(/\.pdf$/);

  // LaTeX: .tex downloads directly; the PDF needs explicit consent before anything is sent
  const [tex] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .tex" }).click()]);
  expect(tex.suggestedFilename()).toMatch(/.tex$/);
  await page.getByRole("button", { name: "Export PDF (LaTeX)" }).click();
  await expect(page.getByText(/sent to texlive.net/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(app("/tracker"));
  await expect(page.getByText("MERN Stack Developer")).toBeVisible();
  await expect(page.getByRole("region", { name: "Saved" }).getByText("LogiCo")).toBeVisible();
  // schedule an interview via the board, then delete
  await page.getByLabel("Move MERN Stack Developer to").selectOption("interview");
  const sched = page.getByRole("dialog", { name: "Schedule interview" });
  await expect(sched).toBeVisible();
  await sched.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Delete MERN Stack Developer" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Nothing tracked yet")).toBeVisible();
  await page.goto(app("/jobs"));

  // data persists across a reload (the job itself stays in My jobs)
  await page.reload();
  await expect(page.getByText("MERN Stack Developer")).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test("service worker never reads a page without permission and asks for it instead", async () => {
  const ui = await ctx.newPage();
  await ui.goto(app("/"));
  // open the job page from the extension so we know its tab id (reading tab URLs would itself need a permission)
  const tabId = await ui.evaluate(async (url) => (await chrome.tabs.create({ url, active: false })).id, serverUrl);
  await new Promise((r) => setTimeout(r, 800));
  expect(tabId).toBeTruthy();
  const res = await ui.evaluate((id) => chrome.runtime.sendMessage({ type: "page/extract", tabId: id }), tabId);
  expect(res.ok).toBe(true);
  expect(res.data.needsPermission).toBe(true);
  expect(res.data.status).toBe("failed");
  // malformed requests are rejected
  const bad = await ui.evaluate(() => chrome.runtime.sendMessage({ type: "nope" }));
  expect(bad).toMatchObject({ ok: false, error: { code: "bad_request" } });
  await ui.close();
});

test("popup renders and offers manual paste", async () => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  await expect(p.locator("span", { hasText: "CareerPilot" }).first()).toBeVisible();
  await expect(p.getByRole("button", { name: "Paste a job description" })).toBeVisible();
  await p.getByRole("button", { name: "Paste a job description" }).click();
  await p.getByLabel("Job title").fill("MERN Stack Developer");
  await p.getByLabel("Job description").fill(JD_TEXT);
  await p.getByRole("button", { name: "Analyze" }).click();
  await expect(p.getByRole("img", { name: /Match score/ })).toBeVisible();
  await expect(p.getByRole("button", { name: "Save job" })).toBeVisible();
  await p.close();
});

test("dark theme and keyboard focus are usable", async () => {
  const p = await ctx.newPage();
  await p.goto(app("/settings"));
  await p.getByLabel("Theme").selectOption("dark");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  await p.keyboard.press("Tab");
  const focused = await p.evaluate(() => document.activeElement?.tagName);
  expect(focused).toBeTruthy();
  await p.getByLabel("Theme").selectOption("light");
  await p.close();
});
