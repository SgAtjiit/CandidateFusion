import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { canonicalizeSkills } from './3_skill_canonicalizer.js';
import { normalizeDate } from './6_date_normalizer.js';

// Section headers mapping for segmentation
const SECTION_HEADERS = {
  experience: ["experience", "work history", "employment", "positions", "work experience", "professional experience", "history"],
  education: ["education", "academic", "academics", "degrees", "qualifications", "academic history", "scholastic history"],
  skills: ["skills", "technologies", "technical skills", "core competencies", "skills & tools", "languages and tools", "skills/tools"]
};

// Fallback backup skill list if no skill section is found
const CANONICAL_SKILLS = [
  "JavaScript", "Node.js", "Kubernetes", "React", "React Native", "Python",
  "AWS", "TypeScript", "Docker", "HTML", "CSS", "GCP", "PostgreSQL",
  "MongoDB", "Git", "CI/CD", "SQL", "Vue.js", "Angular", "Rust", "Go",
  "Java", "C++", "C#", "Next.js", "Express.js", "Ruby", "PHP", "Svelte",
  "Redux", "GraphQL", "Tailwind CSS", "Terraform", "Jenkins", "Webpack"
];

/**
 * Limit concurrency helper
 */
export async function limitConcurrency(tasks, limit) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Runs a promise with a timeout limit.
 */
function withTimeout(promise, ms, onTimeout) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(onTimeout);
    }, ms);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise
  ]);
}

/**
 * Sniffs the text of the resume and segments it.
 */
function segmentText(text) {
  const lines = text.split(/\r?\n/);
  let currentSection = "header"; 
  const sections = {
    header: [],
    experience: [],
    education: [],
    skills: []
  };

  for (const line of lines) {
    const cleanLine = line.trim().toLowerCase().replace(/:$/, "").trim();
    let matchedHeader = null;

    for (const [section, keywords] of Object.entries(SECTION_HEADERS)) {
      if (keywords.includes(cleanLine)) {
        matchedHeader = section;
        break;
      }
    }

    if (matchedHeader) {
      currentSection = matchedHeader;
    } else {
      sections[currentSection].push(line);
    }
  }

  return {
    header: sections.header.join("\n"),
    experience: sections.experience.join("\n"),
    education: sections.education.join("\n"),
    skills: sections.skills.join("\n")
  };
}

/**
 * Heuristically extracts the candidate's name.
 */
function extractName(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 2 && trimmed.length < 50 && !trimmed.includes("@") && !/\d/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Extracts all matching emails.
 */
function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return Array.from(new Set(matches.map(e => e.toLowerCase().trim())));
}

/**
 * Extracts and cleans all matching phone numbers.
 */
function extractPhones(text) {
  const phoneRegex = /\+?[0-9\s\-()]{8,20}/g;
  const candidates = text.match(phoneRegex) || [];
  const results = [];
  
  for (const cand of candidates) {
    const digits = cand.replace(/[^0-9+]/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      // Basic E.164 normalization (ensure plus if length >= 10)
      const formatted = digits.startsWith("+") ? digits : "+" + digits;
      if (!results.includes(formatted)) {
        results.push(formatted);
      }
    }
  }
  return results;
}

/**
 * Extracts social profile urls from resume text.
 */
function extractLinks(text) {
  const result = { linkedin: null, github: null, portfolio: null, other: [] };
  
  const linkedinMatch = text.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  if (linkedinMatch) result.linkedin = linkedinMatch[0];

  const githubMatch = text.match(/https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
  if (githubMatch) result.github = githubMatch[0];

  return result;
}

/**
 * Extracts work experience entries.
 */
function extractExperience(expText) {
  const entries = [];
  const expRegex = /([A-Za-z0-9\s.#/()+]+?)\s+[-—–|]\s+([A-Za-z0-9\s.&/()+]+?)\s*\(([^)]+)\)/g;
  let match;
  
  while ((match = expRegex.exec(expText)) !== null) {
    const title = match[1].trim();
    const company = match[2].trim();
    const dateRange = match[3].trim();
    
    if (title.toLowerCase().includes("experience") || company.toLowerCase().includes("experience")) {
      continue;
    }

    const dateParts = dateRange.split(/[-—–to]+/i).map(d => d.trim());
    const startRaw = dateParts[0];
    const endRaw = dateParts.length > 1 ? dateParts[1] : null;

    const startNorm = normalizeDate(startRaw);
    const endNorm = normalizeDate(endRaw);

    entries.push({
      company,
      title,
      start: startNorm.value,
      end: endNorm.value,
      summary: null // placeholder for resume parse
    });
  }
  
  return entries;
}

/**
 * Extracts education entries.
 */
function extractEducation(eduText) {
  const entries = [];
  const eduRegex = /([A-Za-z0-9\s.#/()+]+?)\s+[-—–|]\s+([A-Za-z0-9\s.&/()+]+?)\s*\(([^)]+)\)/g;
  let match;
  
  while ((match = eduRegex.exec(eduText)) !== null) {
    const degree = match[1].trim();
    const institution = match[2].trim();
    const dateRange = match[3].trim();

    if (degree.toLowerCase().includes("education") || institution.toLowerCase().includes("education")) {
      continue;
    }

    const dateParts = dateRange.split(/[-—–to]+/i).map(d => d.trim());
    const endRaw = dateParts.length > 1 ? dateParts[1] : dateParts[0];
    const endNorm = normalizeDate(endRaw);
    const endYear = endNorm.value ? parseInt(endNorm.value.split("-")[0], 10) : null;

    entries.push({
      institution,
      degree,
      field: null, // placeholder
      end_year: endYear
    });
  }
  
  return entries;
}

/**
 * Calculates total experience in years based on work history.
 */
function calculateYearsExperience(experienceList) {
  let totalMonths = 0;
  for (const exp of experienceList) {
    if (!exp.start) continue;
    
    const startYear = parseInt(exp.start.split("-")[0], 10);
    const startMonth = exp.start.includes("-") ? parseInt(exp.start.split("-")[1], 10) : 1;
    
    let endYear, endMonth;
    if (exp.end) {
      endYear = parseInt(exp.end.split("-")[0], 10);
      endMonth = exp.end.includes("-") ? parseInt(exp.end.split("-")[1], 10) : 12;
    } else {
      // Use current date: 2026-06
      endYear = 2026;
      endMonth = 6;
    }
    
    const months = (endYear - startYear) * 12 + (endMonth - startMonth);
    if (months > 0) totalMonths += months;
  }
  return totalMonths > 0 ? parseFloat((totalMonths / 12).toFixed(1)) : null;
}

/**
 * Core function to parse a single resume buffer.
 * Enforces size limits and timeout safety.
 * 
 * @param {Buffer} buffer - File buffer.
 * @param {string} filename - Filename (PDF or DOCX).
 * @returns {Promise<{ status: "success" | "garbage_source", fields: Object | null }>}
 */
export async function parseResume(buffer, filename) {
  const SIZE_LIMIT = 20 * 1024 * 1024; // 20MB
  if (!buffer || buffer.length > SIZE_LIMIT) {
    return { status: "garbage_source", fields: null };
  }

  const parserPromise = (async () => {
    try {
      let text = "";
      const ext = filename.split(".").pop()?.toLowerCase();
      
      const parsePdfSilently = async (buf) => {
        const originalLog = console.log;
        const originalWarn = console.warn;
        console.log = () => {};
        console.warn = () => {};
        try {
          return await pdf(buf);
        } finally {
          console.log = originalLog;
          console.warn = originalWarn;
        }
      };

      if (ext === "pdf") {
        const parsedPdf = await parsePdfSilently(buffer);
        text = parsedPdf.text;
      } else if (ext === "docx") {
        const parsedDoc = await mammoth.extractRawText({ buffer });
        text = parsedDoc.value;
      } else {
        if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
          const parsedPdf = await parsePdfSilently(buffer);
          text = parsedPdf.text;
        } else {
          try {
            const parsedDoc = await mammoth.extractRawText({ buffer });
            text = parsedDoc.value;
          } catch (e) {
            text = buffer.toString("utf8");
          }
        }
      }

      if (!text || text.trim().length === 0) {
        return { status: "garbage_source", fields: null };
      }

      const sections = segmentText(text);

      const nameVal = extractName(text);
      const emailsList = extractEmails(text);
      const phonesList = extractPhones(text);
      const linksObj = extractLinks(text);

      // Skills extraction
      let rawSkills = [];
      if (sections.skills && sections.skills.trim().length > 0) {
        // Replace brackets and parentheses with commas to handle grouped listings (e.g. "AWS (EC2, S3)")
        const cleanedBrackets = sections.skills.replace(/[()\[\]{}]/g, ",");
        
        // Split into lines to identify and strip generic category headers
        const lines = cleanedBrackets.split(/\r?\n/);
        const GENERIC_KEYWORDS = [
          "languages", "frameworks", "libraries", "tools", "databases", "cloud", 
          "infra", "infrastructure", "practices", "methodologies", "skills", 
          "technologies", "platforms", "devops", "other", "others", "backend", 
          "frontend", "fullstack", "web", "competencies", "programming", "core", 
          "technical", "key", "systems", "development", "software", "utilities",
          "stores", "data"
        ];

        for (const line of lines) {
          let contentToSplit = line;
          if (line.includes(":")) {
            const colonIndex = line.indexOf(":");
            const headerPart = line.substring(0, colonIndex);
            const restPart = line.substring(colonIndex + 1);

            const headerWords = headerPart.toLowerCase().split(/[^a-z]+/).filter(Boolean);
            const isGenericHeader = headerWords.length > 0 && headerWords.every(word => GENERIC_KEYWORDS.includes(word));

            if (isGenericHeader) {
              contentToSplit = restPart;
            } else {
              // If not generic (e.g., "Java: Spring"), keep Java as a candidate skill
              const cleanHeader = headerPart.trim();
              if (cleanHeader.length > 1 && cleanHeader.length < 35) {
                rawSkills.push(cleanHeader);
              }
              contentToSplit = restPart;
            }
          }

          // Split the remaining tokens by commas, semicolons, and pipes
          const tokens = contentToSplit.split(/[,•|;\t\r\n]+/).map(s => s.trim()).filter(Boolean);
          for (const token of tokens) {
            if (token.length > 1 && token.length < 35) {
              rawSkills.push(token);
            }
          }
        }
      } else {
        for (const canonicalName of CANONICAL_SKILLS) {
          const escaped = canonicalName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, 'i');
          if (regex.test(text)) {
            rawSkills.push(canonicalName);
          }
        }
      }

      const skillsInputs = rawSkills.map(s => ({ name: s, source: "resume" }));
      const canonicalSkillsList = await canonicalizeSkills(skillsInputs);

      const experienceList = extractExperience(sections.experience || text);
      const educationList = extractEducation(sections.education || text);
      const yoe = calculateYearsExperience(experienceList);

      return {
        status: "success",
        fields: {
          full_name: nameVal,
          emails: emailsList,
          phones: phonesList,
          links: linksObj,
          years_experience: yoe,
          headline: null, // placeholder
          skills: canonicalSkillsList,
          experience: experienceList,
          education: educationList
        }
      };
    } catch (err) {
      // Quietly handle expected parser failures (like bad/corrupt PDF structures in tests)
      return { status: "garbage_source", fields: null };
    }
  })();

  return withTimeout(parserPromise, 5000, { status: "garbage_source", fields: null });
}
