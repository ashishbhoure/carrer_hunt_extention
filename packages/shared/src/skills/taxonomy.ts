/** Canonical skill -> aliases. Data-driven so other professions can extend it. */
export const SKILL_TAXONOMY: Record<string, string[]> = {
  JavaScript: ["js", "javascript", "ecmascript", "es6", "es2015"],
  TypeScript: ["ts", "typescript"],
  React: ["react", "reactjs", "react.js", "react js"],
  "Next.js": ["next.js", "nextjs", "next js"],
  "Node.js": ["node", "nodejs", "node.js", "node js"],
  "Express.js": ["express", "expressjs", "express.js"],
  NestJS: ["nestjs", "nest.js"],
  MongoDB: ["mongodb", "mongo", "mongo db", "mongoose"],
  PostgreSQL: ["postgresql", "postgres", "psql"],
  MySQL: ["mysql"],
  SQL: ["sql"],
  Redis: ["redis"],
  GraphQL: ["graphql"],
  "REST APIs": ["rest", "restful", "rest api", "rest apis", "restful api", "restful apis"],
  HTML: ["html", "html5"],
  CSS: ["css", "css3"],
  "Tailwind CSS": ["tailwind", "tailwindcss", "tailwind css"],
  Redux: ["redux", "redux toolkit", "rtk"],
  Angular: ["angular", "angularjs"],
  "Vue.js": ["vue", "vuejs", "vue.js"],
  Python: ["python"],
  Java: ["java"],
  "Spring Boot": ["spring boot", "springboot", "spring"],
  "C#": ["c#", "csharp"],
  ".NET": [".net", "dotnet", "asp.net"],
  "C++": ["c++", "cpp"],
  Go: ["golang"],
  PHP: ["php", "laravel"],
  Docker: ["docker", "containers", "containerization"],
  Kubernetes: ["kubernetes", "k8s"],
  AWS: ["aws", "amazon web services", "ec2", "s3", "lambda"],
  Azure: ["azure"],
  GCP: ["gcp", "google cloud"],
  Git: ["git", "github", "gitlab", "bitbucket"],
  "CI/CD": ["ci/cd", "cicd", "ci cd", "continuous integration", "jenkins", "github actions"],
  Jest: ["jest"],
  Testing: ["unit testing", "integration testing", "tdd", "testing library", "cypress", "playwright", "mocha", "vitest"],
  Webpack: ["webpack", "vite"],
  "WebSockets": ["websocket", "websockets", "socket.io"],
  Microservices: ["microservices", "microservice"],
  Agile: ["agile", "scrum", "kanban"],
  Linux: ["linux", "unix"],
  Firebase: ["firebase", "firestore"],
  "React Native": ["react native"],
  "Material UI": ["material ui", "mui", "material-ui"],
  "Responsive Design": ["responsive design", "responsive"],
  "System Design": ["system design", "scalable systems", "architecture"],
  "Authentication": ["jwt", "oauth", "oauth2", "authentication", "auth0"],
  Prisma: ["prisma"],
  Kafka: ["kafka"],
  RabbitMQ: ["rabbitmq"],
  Terraform: ["terraform"],
  Figma: ["figma"],
  "Machine Learning": ["machine learning", "ml"],
  "Data Structures": ["data structures", "algorithms", "dsa"],
};

const aliasToCanonical = new Map<string, string>();
for (const [canon, aliases] of Object.entries(SKILL_TAXONOMY)) {
  aliasToCanonical.set(canon.toLowerCase(), canon);
  for (const a of aliases) aliasToCanonical.set(a.toLowerCase(), canon);
}

export function canonicalSkill(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[.,;:]+$/, "");
  return aliasToCanonical.get(key) ?? raw.trim();
}

export function isKnownSkill(raw: string): boolean {
  return aliasToCanonical.has(raw.trim().toLowerCase());
}

export function aliasesOf(canonical: string): string[] {
  return [canonical.toLowerCase(), ...(SKILL_TAXONOMY[canonical] ?? []).map((a) => a.toLowerCase())];
}

export const ALL_ALIASES: Array<{ alias: string; canonical: string }> = [...aliasToCanonical.entries()].map(
  ([alias, canonical]) => ({ alias, canonical }),
);
