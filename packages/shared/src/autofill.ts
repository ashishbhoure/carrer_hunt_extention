import type { CareerProfile } from "./schemas";

export interface FormFieldDescriptor {
  selector: string;
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  autocomplete: string;
  required: boolean;
  options?: string[];
}

export type FieldKey =
  | "fullName" | "firstName" | "lastName" | "email" | "phone" | "location" | "currentCompany" | "currentRole"
  | "yearsOfExperience" | "education" | "skills" | "noticePeriod" | "expectedSalary" | "portfolio" | "linkedin" | "github";

export interface FieldMapping {
  field: FormFieldDescriptor;
  key: FieldKey | null;
  value: string;
  /** requires an explicit user confirmation before filling (salary, notice, etc.) */
  sensitive: boolean;
  /** why it was not filled, if value is empty */
  reason?: string;
  confidence: number;
}

const SENSITIVE: FieldKey[] = ["expectedSalary", "noticePeriod"];
const NEVER_FILL = /(gender|race|ethnic|religio|caste|disab|veteran|marital|nationality|date of birth|dob|age\b|sexual|pronoun|passport|aadhaar|pan\b|ssn|social security|criminal|visa|sponsor|authori[sz]ed to work)/i;

const RULES: Array<[FieldKey, RegExp, string?]> = [
  ["email", /e-?mail/, "email"],
  ["phone", /(phone|mobile|contact (no|number)|tel)/, "tel"],
  ["firstName", /(first ?name|given ?name|fname)/, "given-name"],
  ["lastName", /(last ?name|sur ?name|family ?name|lname)/, "family-name"],
  ["fullName", /(^|\b)(full ?name|your name|^name$|candidate name|applicant name)/, "name"],
  ["linkedin", /linkedin/],
  ["github", /github/],
  ["portfolio", /(portfolio|website|personal (site|url)|blog)/, "url"],
  ["currentCompany", /(current|present) (company|employer|organi[sz]ation)|employer/],
  ["currentRole", /(current|present) (title|role|designation|position)|job title|designation/],
  ["yearsOfExperience", /(total |relevant )?(years?|yrs?) of (relevant |total |work )?experience|experience \(?years|total experience/],
  ["noticePeriod", /notice ?period|available to join|joining (time|date)|how soon/],
  ["expectedSalary", /(expected|desired|target) (ctc|salary|compensation|pay)|salary expectation|expected ctc/],
  ["location", /(current |preferred )?(city|location|address)|where are you (based|located)/, "address-level2"],
  ["education", /(highest )?(education|qualification|degree)/],
  ["skills", /(key |technical |primary )?skills/],
];

function haystack(f: FormFieldDescriptor): string {
  return `${f.label} ${f.name} ${f.id} ${f.placeholder}`.toLowerCase().replace(/[_-]+/g, " ");
}

export function valueFor(key: FieldKey, p: CareerProfile): string {
  const name = p.contact.fullName.trim();
  const [first = "", ...rest] = name.split(/\s+/);
  const latest = p.workExperience.find((w) => w.current) ?? p.workExperience[0];
  switch (key) {
    case "fullName": return name;
    case "firstName": return first;
    case "lastName": return rest.join(" ");
    case "email": return p.contact.email;
    case "phone": return p.contact.phone;
    case "location": return p.contact.location;
    case "currentCompany": return latest?.company ?? "";
    case "currentRole": return p.currentRole || latest?.title || "";
    case "yearsOfExperience": return p.yearsOfExperience === null ? "" : String(Math.floor(p.yearsOfExperience));
    case "education": { const e = p.education[0]; return e ? [e.degree, e.institution].filter(Boolean).join(", ") : ""; }
    case "skills": return p.skills.filter((s) => s.level === "experienced" || s.level === "working").map((s) => s.name).join(", ");
    case "noticePeriod": return p.noticePeriod;
    case "expectedSalary": return p.salaryPreferences.target !== null ? String(p.salaryPreferences.target) : "";
    case "portfolio": return p.contact.links.find((l) => !/linkedin|github/i.test(l)) ?? "";
    case "linkedin": return p.contact.links.find((l) => /linkedin/i.test(l)) ?? "";
    case "github": return p.contact.links.find((l) => /github/i.test(l)) ?? "";
  }
}

/** Map form fields to verified profile data. Never guesses answers to screening questions. */
export function mapFormFields(fields: FormFieldDescriptor[], profile: CareerProfile): FieldMapping[] {
  return fields.map((field): FieldMapping => {
    const hay = haystack(field);
    if (["password", "hidden", "file", "submit", "button", "checkbox", "radio"].includes(field.type)) return { field, key: null, value: "", sensitive: false, reason: field.type === "file" ? "Attach your resume yourself." : "Not auto-filled.", confidence: 0 };
    if (NEVER_FILL.test(hay)) return { field, key: null, value: "", sensitive: true, reason: "Sensitive / eligibility question — answer it yourself.", confidence: 0 };
    for (const [key, re, ac] of RULES) {
      if (re.test(hay) || (ac && field.autocomplete === ac && key !== "location")) {
        const value = valueFor(key, profile);
        const sensitive = SENSITIVE.includes(key);
        return { field, key, value, sensitive, reason: value ? undefined : "Not in your verified profile — left blank.", confidence: re.test(hay) ? 0.9 : 0.7 };
      }
    }
    return { field, key: null, value: "", sensitive: false, reason: field.tag === "textarea" || /\?/.test(field.label) ? "Screening question — answer it yourself." : "No confident match.", confidence: 0 };
  });
}

export const APPLICATION_CHECKLIST = [
  "Correct resume selected",
  "Contact details checked",
  "Required fields reviewed",
  "Screening answers reviewed",
  "Final submission completed by me on the site",
] as const;
