/**
 * Classifies an uploaded input as ATS_JSON or RESUME.
 * Uses file extension, MIME type, and content signatures (magic numbers) as a fallback.
 * 
 * @param {string} filename - The uploaded file's name.
 * @param {string} mimeType - The uploaded file's MIME type.
 * @param {Buffer} buffer - The file content buffer.
 * @returns {{ type: "ATS_JSON" | "RESUME" | "UNKNOWN", confidence: number }} Classification result.
 */
export function detectSourceType(filename, mimeType, buffer) {
  const ext = filename ? filename.split(".").pop()?.toLowerCase() : "";

  // 1. Extension check
  if (ext === "json") {
    return { type: "ATS_JSON", confidence: 0.95 };
  }
  if (ext === "pdf" || ext === "docx") {
    return { type: "RESUME", confidence: 0.95 };
  }

  // 2. MIME type check
  if (mimeType === "application/json") {
    return { type: "ATS_JSON", confidence: 0.95 };
  }
  if (
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return { type: "RESUME", confidence: 0.95 };
  }

  // 3. Content sniffing fallback
  if (buffer && buffer.length > 0) {
    // Check PDF magic number: %PDF- (0x25 0x50 0x44 0x46)
    if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { type: "RESUME", confidence: 1.0 };
    }

    // Check DOCX / ZIP magic number: PK.. (0x50 0x4B 0x03 0x04)
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
      return { type: "RESUME", confidence: 0.9 };
    }

    // Check JSON structure
    const sample = buffer.toString("utf8", 0, Math.min(buffer.length, 100)).trim();
    if (sample.startsWith("{") || sample.startsWith("[")) {
      try {
        JSON.parse(buffer.toString("utf8"));
        return { type: "ATS_JSON", confidence: 1.0 };
      } catch (e) {
        // May be partial or malformed, but if it starts with { or [ it's likely intended as JSON
        return { type: "ATS_JSON", confidence: 0.8 };
      }
    }
  }

  return { type: "UNKNOWN", confidence: 0.0 };
}
