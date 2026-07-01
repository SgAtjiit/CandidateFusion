import { normalizeLocation } from './7_location_normalizer.js';
import { canonicalizeSkill } from './3_skill_canonicalizer.js';

const DEFAULT_CONFIG = {
  fields: [
    { path: "full_name", type: "string" },
    { path: "emails", type: "string[]" },
    { path: "phones", type: "string[]" },
    { path: "location", type: "object" },
    { path: "links", type: "object" },
    { path: "skills", type: "object[]" },
    { path: "experience", type: "object[]" },
    { path: "education", type: "object[]" }
  ],
  on_missing: "null",
  include_confidence: true
};

/**
 * Resolves a deep path on a canonical candidate record.
 */
function resolveValueAtPath(record, path) {
  if (!path) return null;

  if (path.includes("[].")) {
    const [arrayPath, fieldPath] = path.split("[].");
    const arr = resolveValueAtPath(record, arrayPath);
    if (!Array.isArray(arr)) return [];
    return arr.map(item => (item && typeof item === "object" ? item[fieldPath] : null)).filter(x => x !== null && x !== undefined);
  }

  const parts = path.split(".");
  let current = record;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return null;
    }

    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const field = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      current = current[field];
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return null;
      }
    } else {
      current = current[part];
    }
  }

  return current === undefined ? null : current;
}

/**
 * Sets a value at a deep path on a target object.
 */
function setValueAtPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Normalizer execution.
 */
async function runNormalization(val, type) {
  if (val === null || val === undefined) return val;

  const t = String(type).toLowerCase();

  if (t === "e164") {
    const digits = String(val).replace(/[^0-9+]/g, "");
    if (digits.length >= 10 && !digits.startsWith("+")) {
      return "+" + digits;
    }
    return digits;
  }

  if (t === "canonical") {
    if (Array.isArray(val)) {
      const canonicalized = [];
      for (const item of val) {
        const res = await canonicalizeSkill(String(item));
        if (res && res.name) canonicalized.push(res.name);
      }
      return canonicalized;
    } else {
      const res = await canonicalizeSkill(String(val));
      return res ? res.name : val;
    }
  }

  return val;
}

/**
 * Validates the output object against config types and required constraint.
 */
export function validateOutput(output, config) {
  const errors = [];

  for (const field of config.fields) {
    const val = resolveValueAtPath(output, field.path);

    // Required check
    if (field.required) {
      if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
        errors.push(`Field '${field.path}' is required but is empty or missing.`);
        continue;
      }
    }

    // Type validation
    if (val !== null && val !== undefined && field.type) {
      const expectedType = String(field.type).toLowerCase();
      if (expectedType === "string") {
        if (typeof val !== "string") {
          errors.push(`Field '${field.path}' must be a String, but got '${typeof val}'.`);
        }
      } else if (expectedType === "string[]") {
        if (!Array.isArray(val) || val.some(x => typeof x !== "string")) {
          errors.push(`Field '${field.path}' must be an array of Strings.`);
        }
      } else if (expectedType === "number") {
        if (typeof val !== "number") {
          errors.push(`Field '${field.path}' must be a Number, but got '${typeof val}'.`);
        }
      } else if (expectedType === "object") {
        if (typeof val !== "object" || Array.isArray(val)) {
          errors.push(`Field '${field.path}' must be an Object, but got '${typeof val}'.`);
        }
      } else if (expectedType === "object[]") {
        if (!Array.isArray(val) || val.some(x => typeof x !== "object")) {
          errors.push(`Field '${field.path}' must be an array of Objects.`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Output Validation Failed:\n${errors.join("\n")}`);
  }
  return true;
}

/**
 * Projects a canonical candidate profile to the shape specified in the config.
 * 
 * @param {Object} canonicalProfile - Merged canonical record.
 * @param {Object} [config] - Optional output projection configuration.
 * @returns {Promise<Object>} Projected JSON shape.
 */
export async function projectProfile(canonicalProfile, config) {
  const activeConfig = config || DEFAULT_CONFIG;
  const onMissing = activeConfig.on_missing || "null";
  const includeConfidence = activeConfig.include_confidence === true;

  const result = {};

  for (const field of activeConfig.fields) {
    const fromPath = field.from || field.path;
    let resolved = resolveValueAtPath(canonicalProfile, fromPath);

    // Apply normalization
    if (field.normalize && resolved !== null && resolved !== undefined) {
      resolved = await runNormalization(resolved, field.normalize);
    }

    const isMissing = resolved === null || resolved === undefined || (Array.isArray(resolved) && resolved.length === 0);

    // Apply missing policy
    if (isMissing) {
      if (field.required && onMissing === "error") {
        throw new Error(`Output Validation Failed: Required field '${field.path}' is missing.`);
      }
      if (onMissing === "omit") {
        continue;
      }
      if (onMissing === "null") {
        setValueAtPath(result, field.path, null);
        continue;
      }
    }

    // Write primary value
    setValueAtPath(result, field.path, resolved);

    // Attach sibling confidence and provenance if requested
    if (includeConfidence) {
      // Find top-level key for looking up confidence
      const topLevelKey = fromPath.split("[")[0].split(".")[0];
      const prov = canonicalProfile.provenance?.find(p => p.field === topLevelKey);
      
      // Look up confidence score
      let conf = null;
      if (topLevelKey === "skills") {
        // If skill array mapping, map individual skill confidences
        if (fromPath.includes("skills[].") && Array.isArray(canonicalProfile.skills)) {
          conf = canonicalProfile.skills.map(s => s.confidence);
        } else {
          // Average of skills
          const skills = canonicalProfile.skills || [];
          conf = skills.length > 0 ? parseFloat((skills.reduce((sum, s) => sum + s.confidence, 0) / skills.length).toFixed(2)) : 0.8;
        }
      } else {
        const score = canonicalProfile.overall_confidence || 0.8;
        conf = prov ? (prov.method === "agreement" ? 0.95 : (prov.method === "priority_override" ? 0.7 : 0.85)) : 0.6;
      }

      setValueAtPath(result, field.path + "_confidence", conf);
      if (prov) {
        setValueAtPath(result, field.path + "_provenance", {
          source: prov.source,
          method: prov.method
        });
      }
    }
  }

  // Include overall metadata if requested
  if (includeConfidence) {
    result.overall_confidence = canonicalProfile.overall_confidence;
    result.provenance = canonicalProfile.provenance;
  }

  // Validate output types and required values
  validateOutput(result, activeConfig);

  return result;
}
