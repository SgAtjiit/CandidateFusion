const SYNONYMS = {
  "js": "JavaScript",
  "javascript": "JavaScript",
  "node": "Node.js",
  "nodejs": "Node.js",
  "node.js": "Node.js",
  "k8s": "Kubernetes",
  "kubernetes": "Kubernetes",
  "react": "React",
  "reactjs": "React",
  "react.js": "React",
  "python": "Python",
  "py": "Python",
  "aws": "AWS",
  "ts": "TypeScript",
  "typescript": "TypeScript",
  "docker": "Docker",
  "html": "HTML",
  "html5": "HTML",
  "css": "CSS",
  "css3": "CSS",
  "gcp": "GCP",
  "postgres": "PostgreSQL",
  "postgresql": "PostgreSQL",
  "mongodb": "MongoDB",
  "mongo": "MongoDB",
  "git": "Git",
  "cicd": "CI/CD",
  "ci/cd": "CI/CD",
  "sql": "SQL",
  "vue": "Vue.js",
  "vuejs": "Vue.js",
  "angular": "Angular",
  "rust": "Rust",
  "go": "Go",
  "golang": "Go",
  "java": "Java",
  "cpp": "C++",
  "c++": "C++",
  "csharp": "C#",
  "c#": "C#",
  "nextjs": "Next.js",
  "express": "Express.js",
  "expressjs": "Express.js"
};

const CANONICAL_SKILLS = [
  "JavaScript", "Node.js", "Kubernetes", "React", "React Native", "Python",
  "AWS", "TypeScript", "Docker", "HTML", "CSS", "GCP", "PostgreSQL",
  "MongoDB", "Git", "CI/CD", "SQL", "Vue.js", "Angular", "Rust", "Go",
  "Java", "C++", "C#", "Next.js", "Express.js", "Ruby", "PHP", "Svelte",
  "Redux", "GraphQL", "Tailwind CSS", "Terraform", "Jenkins", "Webpack"
];

function titleCase(str) {
  return str
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function cleanSkillName(name) {
  return name.toLowerCase().replace(/[^a-z0-9+#.\s]/g, "").trim();
}

/**
 * Canonicalizes a single skill name using explicit synonym mapping and direct lists.
 * 
 * @param {string} rawName 
 * @returns {Promise<{ name: string, method: string, confidence: number }>}
 */
export async function canonicalizeSkill(rawName) {
  const cleaned = cleanSkillName(rawName);
  
  if (!cleaned) {
    return {
      name: "",
      method: "empty",
      confidence: 0.0
    };
  }

  // 1. Static synonym map lookup
  if (SYNONYMS[cleaned]) {
    return {
      name: SYNONYMS[cleaned],
      method: "canonical_map",
      confidence: 0.95
    };
  }

  // 2. Direct case-insensitive match on canonical list
  const directMatch = CANONICAL_SKILLS.find(s => s.toLowerCase() === cleaned);
  if (directMatch) {
    return {
      name: directMatch,
      method: "canonical_map",
      confidence: 0.95
    };
  }

  // 3. Passthrough fallback (Title-Cased)
  return {
    name: titleCase(rawName),
    method: "passthrough_normalized",
    confidence: 0.5
  };
}

/**
 * Normalizes, canonicalizes, dedupes, and merges sources for an array of skills.
 * 
 * @param {Array<{ name: string, source: string }>} skillInputs 
 * @returns {Promise<Array<{ name: string, method: string, confidence: number, sources: string[] }>>}
 */
export async function canonicalizeSkills(skillInputs) {
  const mergedMap = new Map();

  for (const skillIn of skillInputs) {
    if (!skillIn.name) continue;
    const canon = await canonicalizeSkill(skillIn.name);
    if (!canon.name) continue;

    const existing = mergedMap.get(canon.name);
    const source = skillIn.source || "unknown";

    if (existing) {
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      if (canon.confidence > existing.confidence) {
        existing.confidence = canon.confidence;
        existing.method = canon.method;
      }
    } else {
      mergedMap.set(canon.name, {
        name: canon.name,
        method: canon.method,
        confidence: canon.confidence,
        sources: [source]
      });
    }
  }

  return Array.from(mergedMap.values());
}
