// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RESUME_BYTES, validateResumeFile } from "../src/services/extractText";
import { deleteResume, importResume, mergeIntoMaster, replaceResumeFile, setDefaultResume, updateResume } from "../src/services/resumes";
import { profileRepo, resumesRepo } from "../src/storage/db";
import { makeDocx, resetAll, RESUME_TEXT } from "./helpers";

beforeEach(resetAll);

describe("resume file validation", () => {
  const f = (bytes: number[] | string, name: string, size?: number) => {
    const body = typeof bytes === "string" ? bytes : new Uint8Array(bytes);
    const file = new File([body], name);
    return size === undefined ? file : Object.defineProperty(file, "size", { value: size });
  };
  it("accepts pdf and docx by magic bytes", async () => {
    expect(await validateResumeFile(f("%PDF-1.7 data", "a.pdf"))).toBe("pdf");
    expect(await validateResumeFile(f([0x50, 0x4b, 3, 4], "a.docx"))).toBe("docx");
  });
  it("rejects spoofed extensions", async () => {
    await expect(validateResumeFile(f("MZ-not-a-pdf", "evil.pdf"))).rejects.toThrow(/contents must match/);
    await expect(validateResumeFile(f("%PDF-1.7", "evil.docx"))).rejects.toThrow(/contents must match/);
  });
  it("rejects empty, oversized, legacy and unknown files", async () => {
    await expect(validateResumeFile(f("", "a.pdf"))).rejects.toThrow(/empty/);
    await expect(validateResumeFile(f("%PDF-", "a.pdf", MAX_RESUME_BYTES + 1))).rejects.toThrow(/too large/);
    await expect(validateResumeFile(f("x", "a.doc"))).rejects.toThrow(/Legacy/);
    await expect(validateResumeFile(f("x", "a.txt"))).rejects.toThrow(/Only PDF and DOCX/);
  });
});

describe("resume vault", () => {
  it("imports a real DOCX, parses it and builds the master profile", async () => {
    const r = await importResume(await makeDocx());
    expect(r.isDefault).toBe(true);
    expect(r.parsedProfile?.contact.email).toBe("rahul.sharma@example.com");
    expect(r.parsingConfidence).toBeGreaterThan(0.6);
    const master = await profileRepo.get();
    expect(master?.contact.fullName).toBe("Rahul Sharma");
    expect(master?.skills.map((s) => s.name)).toContain("React");
    expect(await resumesRepo.getFile(r.id)).toBeInstanceOf(Blob);
  });
  it("rejects a corrupt file without writing anything", async () => {
    const bad = new File([new Uint8Array([0x50, 0x4b, 0, 0, 1, 2, 3])], "bad.docx");
    await expect(importResume(bad)).rejects.toThrow(/Could not read/);
    expect(await resumesRepo.list()).toHaveLength(0);
    expect(await profileRepo.get()).toBeUndefined();
  });
  it("supports multiple versions, default switching, rename, replace and delete", async () => {
    const a = await importResume(await makeDocx(RESUME_TEXT, "a.docx"), { title: "Full stack", description: "MERN focus" });
    const b = await importResume(await makeDocx(RESUME_TEXT.replace("Rahul Sharma", "Rahul S"), "b.docx"));
    expect(a.title).toBe("Full stack");
    expect(b.isDefault).toBe(false);
    await setDefaultResume(b.id);
    expect((await resumesRepo.list()).filter((r) => r.isDefault).map((r) => r.id)).toEqual([b.id]);
    await updateResume(a.id, { title: "Renamed" });
    expect((await resumesRepo.get(a.id))?.title).toBe("Renamed");
    const replaced = await replaceResumeFile(a.id, await makeDocx(RESUME_TEXT + "\nSKILLS\nKubernetes", "a2.docx"));
    expect(replaced.id).toBe(a.id);
    expect(replaced.title).toBe("Renamed");
    expect(replaced.fileName).toBe("a2.docx");
    await deleteResume(b.id); // deleting default promotes another
    const left = await resumesRepo.list();
    expect(left).toHaveLength(1);
    expect(left[0]!.isDefault).toBe(true);
    expect(await resumesRepo.getFile(b.id)).toBeUndefined();
  });
  it("merges into master without overwriting user edits", async () => {
    const r = await importResume(await makeDocx());
    const master = { ...(await profileRepo.get())!, currentRole: "Staff Engineer", skills: [{ name: "React", level: "experienced" as const, verified: true, primary: true }] };
    const merged = mergeIntoMaster(master, r.parsedProfile!);
    expect(merged.currentRole).toBe("Staff Engineer");
    expect(merged.skills.find((s) => s.name === "React")?.level).toBe("experienced");
    expect(merged.skills.map((s) => s.name)).toContain("MongoDB");
    expect(merged.workExperience.length).toBeGreaterThan(0);
  });
});
