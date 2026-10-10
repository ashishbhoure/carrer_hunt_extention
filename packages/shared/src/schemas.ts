import { z } from "zod";

export const SKILL_LEVELS = ["experienced", "working", "learning", "not_applicable"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const APPLICATION_STATUSES = [
  "discovered", "saved", "interested", "preparing", "applied",
  "assessment", "interview", "offer", "rejected", "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const isoDate = z.string();
const confidence = z.number().min(0).max(1);

export const profileSkillSchema = z.object({
  name: z.string().min(1),
  level: z.enum(SKILL_LEVELS),
  /** true once the user has confirmed this entry; parsed skills start unverified */
  verified: z.boolean().default(false),
  primary: z.boolean().default(false),
});
export type ProfileSkill = z.infer<typeof profileSkillSchema>;

export const workExperienceSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  company: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  current: z.boolean().default(false),
  bullets: z.array(z.string()).default([]),
  verified: z.boolean().default(false),
});
export type WorkExperience = z.infer<typeof workExperienceSchema>;

export const educationSchema = z.object({
  id: z.string(),
  institution: z.string().default(""),
  degree: z.string().default(""),
  year: z.string().default(""),
  verified: z.boolean().default(false),
});
export type Education = z.infer<typeof educationSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  technologies: z.array(z.string()).default([]),
  bullets: z.array(z.string()).default([]),
  link: z.string().default(""),
  verified: z.boolean().default(false),
});
export type Project = z.infer<typeof projectSchema>;

export const contactSchema = z.object({
  fullName: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  links: z.array(z.string()).default([]),
});
export type Contact = z.infer<typeof contactSchema>;

export const salaryPreferencesSchema = z.object({
  currency: z.string().default("INR"),
  minimum: z.number().nonnegative().nullable().default(null),
  target: z.number().nonnegative().nullable().default(null),
});

export const careerProfileSchema = z.object({
  id: z.string(),
  contact: contactSchema,
  summary: z.string().default(""),
  currentRole: z.string().default(""),
  yearsOfExperience: z.number().nonnegative().nullable().default(null),
  skills: z.array(profileSkillSchema).default([]),
  workExperience: z.array(workExperienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  projects: z.array(projectSchema).default([]),
  certifications: z.array(z.string()).default([]),
  targetRoles: z.array(z.string()).default([]),
  preferredIndustries: z.array(z.string()).default([]),
  preferredLocations: z.array(z.string()).default([]),
  workModes: z.array(z.enum(WORK_MODES)).default([]),
  employmentTypes: z.array(z.string()).default([]),
  salaryPreferences: salaryPreferencesSchema.default({}),
  noticePeriod: z.string().default(""),
  verifiedFields: z.array(z.string()).default([]),
  updatedAt: isoDate,
});
export type CareerProfile = z.infer<typeof careerProfileSchema>;

export const parsedFieldFlagSchema = z.object({
  field: z.string(),
  message: z.string(),
  confidence,
});
export type ParsedFieldFlag = z.infer<typeof parsedFieldFlagSchema>;

export const resumeSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  extractedText: z.string(),
  parsedProfile: careerProfileSchema.nullable(),
  parsingConfidence: confidence,
  parsingFlags: z.array(parsedFieldFlagSchema).default([]),
  parsingStatus: z.enum(["pending", "parsed", "needs_review", "failed"]),
  isDefault: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Resume = z.infer<typeof resumeSchema>;

export const jobSchema = z.object({
  id: z.string(),
  provider: z.string().default("manual"),
  providerJobId: z.string().optional(),
  canonicalUrl: z.string().default(""),
  originalUrl: z.string().default(""),
  applicationUrl: z.string().default(""),
  title: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  workMode: z.enum(WORK_MODES).default("unknown"),
  employmentType: z.string().default(""),
  salaryRange: z.string().default(""),
  experienceRequirements: z.string().default(""),
  minYears: z.number().nullable().default(null),
  maxYears: z.number().nullable().default(null),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
  description: z.string(),
  datePosted: z.string().optional(),
  extractionConfidence: confidence.default(0),
  extractionNotes: z.array(z.string()).default([]),
  discoveredAt: isoDate,
  savedAt: isoDate.optional(),
  contentHash: z.string(),
  fingerprint: z.string(),
});
export type Job = z.infer<typeof jobSchema>;

export const categoryKeys = ["requiredSkills", "experience", "roleAlignment", "projects", "preferred"] as const;
export type CategoryKey = (typeof categoryKeys)[number];

export const scoreBreakdownItemSchema = z.object({
  key: z.enum(categoryKeys),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number(),
  weighted: z.number(),
  explanation: z.string(),
  /** category had no data in the job, so it is excluded and weights are re-normalized */
  notApplicable: z.boolean().default(false),
});
export type ScoreBreakdownItem = z.infer<typeof scoreBreakdownItemSchema>;

export const skillMatchSchema = z.object({
  skill: z.string(),
  status: z.enum(["matched_verified", "matched_learning", "matched_text_only", "not_found", "marked_not_applicable"]),
  evidence: z.string().default(""),
  required: z.boolean(),
});
export type SkillMatch = z.infer<typeof skillMatchSchema>;

export const jobAnalysisSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  resumeId: z.string(),
  cacheKey: z.string(),
  totalScore: z.number().min(0).max(100),
  label: z.enum(["Excellent match", "Strong match", "Partial match", "Low match"]),
  breakdown: z.array(scoreBreakdownItemSchema),
  skillMatches: z.array(skillMatchSchema),
  keywordCoverage: z.number().min(0).max(100),
  relevantProjects: z.array(z.object({ name: z.string(), reason: z.string() })),
  experienceGaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  explanation: z.string(),
  incomplete: z.boolean(),
  incompleteReasons: z.array(z.string()),
  modelVersion: z.string(),
  createdAt: isoDate,
});
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

export const applicationEventSchema = z.object({
  at: isoDate,
  type: z.enum(["created", "status", "note", "followup", "interview", "document", "user_confirmed_submitted"]),
  detail: z.string(),
});

export const applicationSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  title: z.string(),
  company: z.string(),
  jobUrl: z.string().default(""),
  source: z.string().default("manual"),
  matchScoreAtSave: z.number().nullable().default(null),
  resumeId: z.string().nullable().default(null),
  tailoredDocumentId: z.string().nullable().default(null),
  coverLetterId: z.string().nullable().default(null),
  status: z.enum(APPLICATION_STATUSES),
  savedAt: isoDate,
  appliedAt: isoDate.nullable().default(null),
  followUpAt: isoDate.nullable().default(null),
  followUpNote: z.string().default(""),
  interviewAt: isoDate.nullable().default(null),
  interviewNote: z.string().default(""),
  recruiter: z.object({ name: z.string().default(""), email: z.string().default(""), phone: z.string().default("") }).default({}),
  interviewNotes: z.string().default(""),
  notes: z.string().default(""),
  history: z.array(applicationEventSchema).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Application = z.infer<typeof applicationSchema>;

export const documentSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  original: z.string(),
  proposed: z.string(),
  decision: z.enum(["pending", "accepted", "rejected", "edited"]),
  warnings: z.array(z.string()),
});
export type DocumentSection = z.infer<typeof documentSectionSchema>;

export const tailoredDocumentSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  sourceResumeId: z.string(),
  documentType: z.enum(["resume", "cover_letter"]),
  content: z.string(),
  sections: z.array(documentSectionSchema).default([]),
  version: z.number(),
  source: z.enum(["deterministic", "ai"]),
  createdAt: isoDate,
});
export type TailoredDocument = z.infer<typeof tailoredDocumentSchema>;

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("light"),
  onboardingComplete: z.boolean().default(false),
  remoteUploadConsent: z.boolean().default(false),
  ai: z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(["openai-compatible", "anthropic"]).default("openai-compatible"),
    baseUrl: z.string().default("https://api.openai.com/v1"),
    model: z.string().default(""),
    apiKey: z.string().default(""),
    dailyLimit: z.number().int().min(0).default(20),
    timeoutMs: z.number().int().default(30000),
  }).default({}),
  weights: z.object({
    requiredSkills: z.number().default(35),
    experience: z.number().default(25),
    roleAlignment: z.number().default(20),
    projects: z.number().default(10),
    preferred: z.number().default(10),
  }).default({}),
  notifications: z.object({
    enabled: z.boolean().default(false),
    followUps: z.boolean().default(true),
    interviews: z.boolean().default(true),
    savedJobsReview: z.boolean().default(false),
    /** minutes before an interview/follow-up time to notify */
    leadMinutes: z.number().int().min(0).default(60),
    resumeReview: z.boolean().default(false),
  }).default({}),
  latexConsent: z.boolean().default(false),
  grantedOrigins: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => settingsSchema.parse({});
