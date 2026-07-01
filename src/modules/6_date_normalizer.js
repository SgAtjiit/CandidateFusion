/**
 * Normalizes free-text date strings to YYYY-MM format with precision and confidence tracking.
 * 
 * @param {string} dateStr - Raw date string from ATS or resume.
 * @returns {{ value: string | null, precision: "month_exact" | "year_only" | "Present" | null, confidence: number }}
 */
export function normalizeDate(dateStr) {
  if (!dateStr) {
    return { value: null, precision: null, confidence: 0.0 };
  }

  const str = dateStr.trim().toLowerCase();

  // 1. Present/Current/Now
  if (["present", "current", "now", "ongoing", "till date"].includes(str)) {
    return { value: null, precision: "Present", confidence: 0.9 };
  }

  // 2. Year-only (e.g., 2020)
  const yearOnlyMatch = str.match(/^\d{4}$/);
  if (yearOnlyMatch) {
    return { value: yearOnlyMatch[0], precision: "year_only", confidence: 0.7 };
  }

  // 3. Parse Month & Year format
  const monthsShort = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  ];
  const monthsFull = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];

  // MM/YYYY, MM-YYYY, M/YYYY, or M-YYYY
  const m1 = str.match(/^(\d{1,2})[\/\-]\s*(\d{4})$/);
  if (m1) {
    const month = parseInt(m1[1], 10);
    const year = m1[2];
    if (month >= 1 && month <= 12) {
      const formattedMonth = String(month).padStart(2, "0");
      return { value: `${year}-${formattedMonth}`, precision: "month_exact", confidence: 0.9 };
    }
  }

  // YYYY-MM or YYYY/MM
  const m2 = str.match(/^(\d{4})[\/\-]\s*(\d{1,2})$/);
  if (m2) {
    const year = m2[1];
    const month = parseInt(m2[2], 10);
    if (month >= 1 && month <= 12) {
      const formattedMonth = String(month).padStart(2, "0");
      return { value: `${year}-${formattedMonth}`, precision: "month_exact", confidence: 0.9 };
    }
  }

  // Text month + year, e.g., "March 2022" or "Mar 2022" or "March, 2022"
  const m3 = str.match(/^([a-z]+)[\s,\-]*(\d{4})$/i);
  if (m3) {
    const mName = m3[1].toLowerCase();
    const year = m3[2];
    
    // Match against short names
    let mIdx = monthsShort.findIndex(m => mName.startsWith(m));
    if (mIdx === -1) {
      mIdx = monthsFull.findIndex(m => mName === m);
    }
    
    if (mIdx !== -1) {
      const formattedMonth = String(mIdx + 1).padStart(2, "0");
      return { value: `${year}-${formattedMonth}`, precision: "month_exact", confidence: 0.9 };
    }
  }

  // YYYY text month, e.g., "2022 March"
  const m4 = str.match(/^(\d{4})[\s,\-]*([a-z]+)$/i);
  if (m4) {
    const year = m4[1];
    const mName = m4[2].toLowerCase();
    
    let mIdx = monthsShort.findIndex(m => mName.startsWith(m));
    if (mIdx === -1) {
      mIdx = monthsFull.findIndex(m => mName === m);
    }
    
    if (mIdx !== -1) {
      const formattedMonth = String(mIdx + 1).padStart(2, "0");
      return { value: `${year}-${formattedMonth}`, precision: "month_exact", confidence: 0.9 };
    }
  }

  // 4. Native JS date fallback
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      return { value: `${year}-${month}`, precision: "month_exact", confidence: 0.8 };
    }
  } catch (e) {
    // Fail silently, fall back to null
  }

  // Unparseable
  return { value: null, precision: null, confidence: 0.0 };
}
