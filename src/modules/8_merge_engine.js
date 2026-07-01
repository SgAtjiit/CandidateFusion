import { canonicalizeSkills } from './3_skill_canonicalizer.js';
import { normalizeDate } from './6_date_normalizer.js';
import { normalizeLocation } from './7_location_normalizer.js';

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function valuesAgree(valA, valB, field) {
  if (valA === valB) return true;
  if (!valA || !valB) return false;

  if (field === "location") {
    return valA.country === valB.country && valA.city === valB.city;
  }

  const normA = String(valA).toLowerCase().replace(/[^a-z0-9]/g, "");
  const normB = String(valB).toLowerCase().replace(/[^a-z0-9]/g, "");
  return normA === normB;
}

/**
 * Merges a single canonical field, tracking source, method, and confidence.
 */
function mergeSingleField(field, atsVal, resumeVal, normalizer = x => x) {
  const normAts = atsVal ? normalizer(atsVal) : null;
  const normResume = resumeVal ? normalizer(resumeVal) : null;

  const hasAts = normAts !== null && normAts !== undefined && normAts !== "";
  const hasResume = normResume !== null && normResume !== undefined && normResume !== "";

  if (hasAts && !hasResume) {
    return {
      value: normAts,
      source: "ats",
      method: "single_source",
      confidence: 0.85
    };
  }

  if (!hasAts && hasResume) {
    return {
      value: normResume,
      source: "resume",
      method: "single_source",
      confidence: 0.6
    };
  }

  if (hasAts && hasResume) {
    if (valuesAgree(normAts, normResume, field)) {
      return {
        value: normAts,
        source: "merged",
        method: "agreement",
        confidence: 0.95
      };
    } else {
      // Conflict: ATS wins, Resume is alt/ignored
      return {
        value: normAts,
        source: "ats",
        method: "priority_override",
        confidence: 0.7
      };
    }
  }

  return { value: null, source: "merged", method: "none", confidence: 0.0 };
}

/**
 * Merges array fields (emails, phones) with overlap detection.
 */
function mergeArrayField(field, atsArr = [], resumeArr = [], normalizer = x => x) {
  const cleanAts = (atsArr || []).map(normalizer).filter(Boolean);
  const cleanResume = (resumeArr || []).map(normalizer).filter(Boolean);

  const hasAts = cleanAts.length > 0;
  const hasResume = cleanResume.length > 0;

  const union = Array.from(new Set([...cleanAts, ...cleanResume]));

  if (hasAts && !hasResume) {
    return { value: cleanAts, source: "ats", method: "single_source", confidence: 0.85 };
  }

  if (!hasAts && hasResume) {
    return { value: cleanResume, source: "resume", method: "single_source", confidence: 0.6 };
  }

  if (hasAts && hasResume) {
    const atsSet = new Set(cleanAts);
    const overlap = cleanResume.some(x => atsSet.has(x));

    return {
      value: union,
      source: "merged",
      method: overlap ? "agreement" : "priority_override",
      confidence: overlap ? 0.95 : 0.7
    };
  }

  return { value: [], source: "merged", method: "none", confidence: 0.0 };
}

/**
 * Merges location schemas.
 */
function mergeLocation(atsLoc, resumeLoc) {
  const normAts = atsLoc ? (typeof atsLoc === "string" ? normalizeLocation(atsLoc) : atsLoc) : null;
  const normRes = resumeLoc ? (typeof resumeLoc === "string" ? normalizeLocation(resumeLoc) : resumeLoc) : null;

  const hasAts = normAts && (normAts.city || normAts.region || normAts.country);
  const hasRes = normRes && (normRes.city || normRes.region || normRes.country);

  if (hasAts && !hasRes) {
    return { value: normAts, source: "ats", method: "single_source", confidence: 0.85 };
  }
  if (!hasAts && hasRes) {
    return { value: normRes, source: "resume", method: "single_source", confidence: 0.6 };
  }
  if (hasAts && hasRes) {
    const agree = normAts.country === normRes.country && normAts.city === normRes.city;
    return {
      value: normAts,
      source: "merged",
      method: agree ? "agreement" : "priority_override",
      confidence: agree ? 0.95 : 0.7
    };
  }
  return { value: { city: null, region: null, country: null }, source: "merged", method: "none", confidence: 0.0 };
}

/**
 * Merges links structures.
 */
function mergeLinks(atsLinks, resumeLinks) {
  const hasAts = atsLinks && (atsLinks.linkedin || atsLinks.github || atsLinks.portfolio || (atsLinks.other && atsLinks.other.length > 0));
  const hasRes = resumeLinks && (resumeLinks.linkedin || resumeLinks.github || resumeLinks.portfolio || (resumeLinks.other && resumeLinks.other.length > 0));

  const mergedVal = {
    linkedin: (atsLinks && atsLinks.linkedin) || (resumeLinks && resumeLinks.linkedin) || null,
    github: (atsLinks && atsLinks.github) || (resumeLinks && resumeLinks.github) || null,
    portfolio: (atsLinks && atsLinks.portfolio) || (resumeLinks && resumeLinks.portfolio) || null,
    other: Array.from(new Set([...((atsLinks && atsLinks.other) || []), ...((resumeLinks && resumeLinks.other) || [])]))
  };

  if (hasAts && !hasRes) {
    return { value: mergedVal, source: "ats", method: "single_source", confidence: 0.85 };
  }
  if (!hasAts && hasRes) {
    return { value: mergedVal, source: "resume", method: "single_source", confidence: 0.6 };
  }
  if (hasAts && hasRes) {
    const agree = (atsLinks.linkedin === resumeLinks.linkedin) || (atsLinks.github === resumeLinks.github);
    return {
      value: mergedVal,
      source: "merged",
      method: agree ? "agreement" : "priority_override",
      confidence: agree ? 0.95 : 0.7
    };
  }
  return { value: { linkedin: null, github: null, portfolio: null, other: [] }, source: "merged", method: "none", confidence: 0.0 };
}

/**
 * Normalizes dates inside raw experience or education list objects.
 */
function normalizeWorkOrEduList(list, sourceName) {
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    const startNorm = item.start ? normalizeDate(item.start) : { value: null };
    const endNorm = item.end ? normalizeDate(item.end) : (item.end_year ? normalizeDate(String(item.end_year)) : { value: null });
    
    return {
      company: item.company || item.institution || null,
      title: item.title || item.degree || null,
      institution: item.institution || null,
      degree: item.degree || null,
      field: item.field || null,
      start: startNorm.value,
      end: endNorm.value || null,
      end_year: item.end_year || (endNorm.value ? parseInt(endNorm.value.split("-")[0], 10) : null),
      summary: item.summary || null,
      confidence: sourceName === "ats" ? 0.85 : 0.6
    };
  });
}

/**
 * Union and deduplicate experience arrays.
 */
function mergeExperience(atsExp = [], resumeExp = []) {
  const normAts = normalizeWorkOrEduList(atsExp, "ats");
  const normResume = normalizeWorkOrEduList(resumeExp, "resume");
  const combined = [...normAts, ...normResume];
  const unique = [];

  for (const item of combined) {
    const dup = unique.find(x => 
      normalizeName(x.company) === normalizeName(item.company) &&
      normalizeName(x.title) === normalizeName(item.title)
    );
    if (dup) {
      if (item.confidence > dup.confidence) {
        Object.assign(dup, item);
      }
    } else {
      unique.push(item);
    }
  }

  // Map to clean schema: company, title, start, end, summary
  return unique.map(x => ({
    company: x.company,
    title: x.title,
    start: x.start,
    end: x.end,
    summary: x.summary
  }));
}

/**
 * Union and deduplicate education arrays.
 */
function mergeEducation(atsEdu = [], resumeEdu = []) {
  const normAts = normalizeWorkOrEduList(atsEdu, "ats");
  const normResume = normalizeWorkOrEduList(resumeEdu, "resume");
  const combined = [...normAts, ...normResume];
  const unique = [];

  for (const item of combined) {
    const dup = unique.find(x => 
      normalizeName(x.institution) === normalizeName(item.institution) &&
      normalizeName(x.degree) === normalizeName(item.degree)
    );
    if (dup) {
      if (item.confidence > dup.confidence) {
        Object.assign(dup, item);
      }
    } else {
      unique.push(item);
    }
  }

  // Map to clean schema: institution, degree, field, end_year
  return unique.map(x => ({
    institution: x.institution,
    degree: x.degree,
    field: x.field,
    end_year: x.end_year
  }));
}

/**
 * Merges ATS and Resume candidate records.
 * 
 * @param {Object} ats - Normalized ATS profile.
 * @param {Object} resumeFields - Parsed resume fields.
 * @param {string} candidateId - Assigned Candidate ID.
 * @returns {Promise<Object>} The unified canonical profile.
 */
export async function mergeProfiles(ats = {}, resumeFields = {}, candidateId) {
  const provenanceList = [];
  const confidenceMap = {};

  // 1. Merge Single properties
  const fieldMapping = [
    { key: "full_name", norm: x => String(x).trim() },
    { key: "headline", norm: x => String(x).trim() },
    { key: "years_experience", norm: x => parseFloat(x) },
    { key: "current_company", norm: x => String(x).trim() },
    { key: "title", norm: x => String(x).trim() }
  ];

  const canonical = {
    candidate_id: candidateId
  };

  for (const item of fieldMapping) {
    const merged = mergeSingleField(item.key, ats[item.key], resumeFields[item.key], item.norm);
    canonical[item.key] = merged.value;
    confidenceMap[item.key] = merged.confidence;
    if (merged.method !== "none") {
      provenanceList.push({ field: item.key, source: merged.source, method: merged.method });
    }
  }

  // 2. Merge Arrays (emails, phones)
  const phoneNormalizer = p => {
    const digits = String(p).replace(/[^0-9+]/g, "");
    return digits.startsWith("+") ? digits : "+" + digits;
  };
  const emailNormalizer = e => String(e).toLowerCase().trim();

  const mergedEmails = mergeArrayField("emails", ats.emails, resumeFields.emails, emailNormalizer);
  canonical.emails = mergedEmails.value;
  confidenceMap.emails = mergedEmails.confidence;
  if (mergedEmails.method !== "none") {
    provenanceList.push({ field: "emails", source: mergedEmails.source, method: mergedEmails.method });
  }

  const mergedPhones = mergeArrayField("phones", ats.phones, resumeFields.phones, phoneNormalizer);
  canonical.phones = mergedPhones.value;
  confidenceMap.phones = mergedPhones.confidence;
  if (mergedPhones.method !== "none") {
    provenanceList.push({ field: "phones", source: mergedPhones.source, method: mergedPhones.method });
  }

  // 3. Merge Location
  const mergedLoc = mergeLocation(ats.location, resumeFields.location);
  canonical.location = mergedLoc.value;
  confidenceMap.location = mergedLoc.confidence;
  if (mergedLoc.method !== "none") {
    provenanceList.push({ field: "location", source: mergedLoc.source, method: mergedLoc.method });
  }

  // 4. Merge Links
  const mergedLinks = mergeLinks(ats.links, resumeFields.links);
  canonical.links = mergedLinks.value;
  confidenceMap.links = mergedLinks.confidence;
  if (mergedLinks.method !== "none") {
    provenanceList.push({ field: "links", source: mergedLinks.source, method: mergedLinks.method });
  }

  // 5. Merge skills array
  let atsSkillsInputs = [];
  if (Array.isArray(ats.skills)) {
    atsSkillsInputs = ats.skills.map(s => {
      const name = typeof s === "object" ? s.name : s;
      return { name, source: "ats" };
    });
  }

  let resumeSkillsInputs = [];
  if (Array.isArray(resumeFields.skills)) {
    resumeSkillsInputs = resumeFields.skills.map(s => {
      const name = typeof s === "object" ? s.name : s;
      return { name, source: "resume" };
    });
  }

  const allSkills = await canonicalizeSkills([...atsSkillsInputs, ...resumeSkillsInputs]);
  canonical.skills = allSkills.map(s => ({
    name: s.name,
    confidence: s.confidence,
    sources: s.sources
  }));

  const skillsConf = allSkills.length > 0 
    ? (allSkills.reduce((sum, s) => sum + s.confidence, 0) / allSkills.length)
    : 0.0;
  confidenceMap.skills = skillsConf;
  provenanceList.push({ field: "skills", source: "merged", method: "array_union" });

  // 6. Merge Experience
  canonical.experience = mergeExperience(ats.experience, resumeFields.experience);
  const expConf = ats.experience?.length > 0 && resumeFields.experience?.length > 0 
    ? 0.95 
    : (ats.experience?.length > 0 ? 0.85 : 0.6);
  confidenceMap.experience = expConf;
  provenanceList.push({ field: "experience", source: "merged", method: "array_union" });

  // 7. Merge Education
  canonical.education = mergeEducation(ats.education, resumeFields.education);
  const eduConf = ats.education?.length > 0 && resumeFields.education?.length > 0 
    ? 0.95 
    : (ats.education?.length > 0 ? 0.85 : 0.6);
  confidenceMap.education = eduConf;
  provenanceList.push({ field: "education", source: "merged", method: "array_union" });

  // 8. Calculate overall confidence
  const confValues = Object.values(confidenceMap).filter(val => val > 0);
  const overallConf = confValues.length > 0 
    ? (confValues.reduce((sum, val) => sum + val, 0) / confValues.length)
    : 0.0;

  canonical.provenance = provenanceList;
  canonical.overall_confidence = parseFloat(overallConf.toFixed(2));
  
  // Attach confidences lookup map for projection layer siblings mapping
  canonical.confidences = confidenceMap;

  return canonical;
}
