/**
 * Alias map for mapping raw ATS fields to canonical schema fields.
 * All entries are strictly pre-normalized (lowercase, alphanumeric only) to align with normalized keys.
 */
const ALIAS_MAP = {
  full_name: ["fullname", "name", "candidatename", "displayname"],
  emails: ["email", "emails", "emailaddress", "emailaddresses", "mail", "emailid"],
  phones: ["phone", "phones", "phonenumber", "phonenumbers", "telephone", "mobile", "mobilenumber", "cellphone"],
  location: ["location", "address", "city", "country", "region", "geo", "postaladdress"],
  links: ["links", "socials", "profiles", "urls", "websites", "sociallinks"],
  headline: ["headline", "summary", "bio", "objective", "tagline", "about", "notes", "description"],
  years_experience: ["yearsexperience", "experienceyears", "yoe", "totalexperience"],
  skills: ["skills", "technologies", "techstack", "tags", "skillset", "keyskills"],
  experience: ["experience", "workhistory", "workexperience", "jobs", "history", "positions"],
  education: ["education", "academics", "qualifications", "academichistory", "degrees"],
  current_company: ["currentcompany", "company", "currcompany", "organization", "currentorganization", "employer", "currentemployer"],
  title: ["title", "jobtitle", "role", "currenttitle", "designation", "position", "currtitle"]
};

/**
 * Normalizes a key by lowercasing and removing non-alphanumeric characters.
 */
function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Converts a string or array input into an array of string tokens.
 * Splits on commas, semicolons, newlines, and pipes. Space is preserved to prevent breaking phone numbers.
 */
function toArray(val) {
  if (Array.isArray(val)) return val.map(String);
  if (!val) return [];
  return String(val).split(/[,;\n\r\t|]+/).map(x => x.trim()).filter(Boolean);
}

/**
 * Resolves a raw links input (string, array, or object) into canonical links schema.
 */
function toLinks(val) {
  const result = { linkedin: null, github: null, portfolio: null, other: [] };
  if (!val) return result;

  if (typeof val === "object" && !Array.isArray(val)) {
    result.linkedin = val.linkedin || val.linkedIn || null;
    result.github = val.github || val.gitHub || null;
    result.portfolio = val.portfolio || val.website || val.personalWebsite || null;
    if (Array.isArray(val.other)) {
      result.other = val.other.map(String);
    } else if (val.other) {
      result.other = [String(val.other)];
    }
    return result;
  }

  const arr = Array.isArray(val) ? val : [val];
  for (const url of arr) {
    if (typeof url !== "string") continue;
    const lUrl = url.toLowerCase();
    if (lUrl.includes("linkedin.com")) {
      result.linkedin = url;
    } else if (lUrl.includes("github.com")) {
      result.github = url;
    } else if (lUrl.includes("portfolio") || lUrl.includes("personal") || lUrl.includes("blog") || lUrl.includes("website")) {
      result.portfolio = url;
    } else {
      result.other.push(url);
    }
  }
  return result;
}

/**
 * Maps raw ATS fields to canonical schema fields using aliases.
 * 
 * @param {Object} rawAtsJson - Raw ATS JSON object.
 * @returns {{ canonical: Object, provenance: Array, warnings: { unmapped_fields: string[] } }}
 */
export function mapAtsFields(rawAtsJson) {
  const canonical = {};
  const provenance = [];
  const unmappedFields = [];

  for (const [key, value] of Object.entries(rawAtsJson)) {
    const normalizedKey = normalizeKey(key);
    let matchedCanonicalField = null;

    for (const [canonicalField, aliases] of Object.entries(ALIAS_MAP)) {
      if (aliases.includes(normalizedKey) || canonicalField === normalizedKey) {
        matchedCanonicalField = canonicalField;
        break;
      }
    }

    if (matchedCanonicalField) {
      let mappedValue = value;

      if (matchedCanonicalField === "emails" || matchedCanonicalField === "phones") {
        mappedValue = toArray(value);
      } else if (matchedCanonicalField === "links") {
        mappedValue = toLinks(value);
      } else if (matchedCanonicalField === "years_experience") {
        const num = parseFloat(value);
        mappedValue = isNaN(num) ? null : num;
      }

      if (canonical[matchedCanonicalField] === undefined || (mappedValue && !canonical[matchedCanonicalField])) {
        canonical[matchedCanonicalField] = mappedValue;
      }

      provenance.push({
        field: matchedCanonicalField,
        source: "ats",
        method: "alias_match",
        confidence: 0.95
      });
    } else {
      if (key !== "_source_file") {
        unmappedFields.push(key);
      }
    }
  }

  return {
    canonical,
    provenance,
    warnings: {
      unmapped_fields: unmappedFields
    }
  };
}
