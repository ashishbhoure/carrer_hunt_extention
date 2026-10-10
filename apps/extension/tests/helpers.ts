import { Document, Packer, Paragraph } from "docx";
import { resetDbForTests } from "../src/storage/db";

export { RESUME_TEXT, JD_TEXT } from "./fixtures";
import { RESUME_TEXT } from "./fixtures";

/** Build a real DOCX file in memory. */
export async function makeDocx(text = RESUME_TEXT, name = "resume.docx"): Promise<File> {
  const doc = new Document({ sections: [{ children: text.split("\n").map((l) => new Paragraph(l)) }] });
  const buf = await Packer.toBuffer(doc);
  return new File([new Uint8Array(buf)], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export const resetAll = async () => { await resetDbForTests(); };
