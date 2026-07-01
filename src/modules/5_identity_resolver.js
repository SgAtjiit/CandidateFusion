import crypto from 'crypto';

function normalizeEmail(email) {
  if (!email) return "";
  return email.toLowerCase().trim();
}

function normalizePhone(phone) {
  if (!phone) return "";
  return phone.replace(/[^0-9]/g, "");
}

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Checks if there is any overlap between two arrays of items after applying a normalizer.
 */
function arraysOverlap(arrA, arrB, normalizer) {
  if (!Array.isArray(arrA) || !Array.isArray(arrB)) return false;
  const setA = new Set(arrA.map(normalizer).filter(Boolean));
  for (const item of arrB) {
    const normVal = normalizer(item);
    if (normVal && setA.has(normVal)) {
      return true;
    }
  }
  return false;
}

/**
 * Generates a deterministic candidate ID from seed email or name.
 */
export function generateDeterministicId(str) {
  const hash = crypto.createHash("sha256").update(str.toLowerCase().trim()).digest("hex");
  return `c_${hash.substring(0, 6)}`;
}

/**
 * Clusters ATS and Resume records using overlap checks on arrays.
 * 
 * @param {Array<Object>} atsRecords - Mapped ATS records.
 * @param {Array<Object>} resumeRecords - Parsed resume records.
 * @returns {Array<Object>} Clusters
 */
export function resolveIdentities(atsRecords = [], resumeRecords = []) {
  const clusters = [];
  const matchedResumeIndices = new Set();

  for (const ats of atsRecords) {
    let matchedResume = null;
    let matchMethod = null;
    let matchedIndex = -1;

    for (let i = 0; i < resumeRecords.length; i++) {
      if (matchedResumeIndices.has(i)) continue;
      const resume = resumeRecords[i];

      const atsId = ats.candidate_id;
      const resumeFields = resume.fields || {};
      const resId = resume.candidate_id || (resumeFields.candidate_id);
      const filename = resume.filename || "";

      // 1. candidate_id match
      if (atsId) {
        const idMatches = (resId && String(resId) === String(atsId)) || 
                          (filename && filename.toLowerCase().includes(String(atsId).toLowerCase()));
        if (idMatches) {
          matchedResume = resume;
          matchMethod = "candidate_id_match";
          matchedIndex = i;
          break;
        }
      }

      // 2. emails overlap match
      const atsEmails = ats.emails || [];
      const resEmails = resume.emails || resumeFields.emails || [];
      if (arraysOverlap(atsEmails, resEmails, normalizeEmail)) {
        matchedResume = resume;
        matchMethod = "email_match";
        matchedIndex = i;
        break;
      }

      // 3. phones overlap match
      const atsPhones = ats.phones || [];
      const resPhones = resume.phones || resumeFields.phones || [];
      if (arraysOverlap(atsPhones, resPhones, normalizePhone)) {
        matchedResume = resume;
        matchMethod = "phone_match";
        matchedIndex = i;
        break;
      }

      // 4. name match
      const atsName = normalizeName(ats.full_name || ats.name);
      const resName = normalizeName(resume.full_name || resumeFields.full_name || resume.name || resumeFields.name);
      if (atsName && resName && atsName === resName) {
        matchedResume = resume;
        matchMethod = "name_match";
        matchedIndex = i;
        break;
      }
    }

    if (matchedResume) {
      matchedResumeIndices.add(matchedIndex);
    }

    // Determine candidate ID
    let candidateId = ats.candidate_id;
    if (!candidateId) {
      const emailSeed = (ats.emails && ats.emails[0]) || 
                        (matchedResume && ((matchedResume.emails && matchedResume.emails[0]) || 
                                           (matchedResume.fields?.emails && matchedResume.fields.emails[0])));
      if (emailSeed) {
        candidateId = generateDeterministicId(emailSeed);
      } else {
        const nameSeed = ats.full_name || (matchedResume && (matchedResume.full_name || matchedResume.fields?.full_name)) || "unknown";
        candidateId = generateDeterministicId(nameSeed);
      }
    }

    clusters.push({
      candidate_id: candidateId,
      ats_record: ats,
      resume_record: matchedResume,
      match_method: matchedResume ? matchMethod : null
    });
  }

  // Add remaining unmatched resumes
  for (let i = 0; i < resumeRecords.length; i++) {
    if (matchedResumeIndices.has(i)) continue;
    const resume = resumeRecords[i];

    const resumeFields = resume.fields || {};
    let candidateId = resume.candidate_id || (resumeFields.candidate_id);
    
    if (!candidateId) {
      const emailSeed = (resume.emails && resume.emails[0]) || (resumeFields.emails && resumeFields.emails[0]);
      if (emailSeed) {
        candidateId = generateDeterministicId(emailSeed);
      } else {
        const nameSeed = resume.full_name || resumeFields.full_name || resume.filename || "unknown";
        candidateId = generateDeterministicId(nameSeed);
      }
    }

    clusters.push({
      candidate_id: candidateId,
      ats_record: null,
      resume_record: resume,
      match_method: null
    });
  }

  return clusters;
}
