const COUNTRY_MAP = {
  "usa": "US", "us": "US", "united states": "US", "united states of america": "US",
  "uk": "GB", "gb": "GB", "united kingdom": "GB", "great britain": "GB", "england": "GB", "scotland": "GB",
  "india": "IN", "in": "IN", "ind": "IN",
  "canada": "CA", "ca": "CA",
  "germany": "DE", "de": "DE", "deutschland": "DE",
  "france": "FR", "fr": "FR",
  "australia": "AU", "au": "AU",
  "singapore": "SG", "sg": "SG",
  "netherlands": "NL", "nl": "NL",
  "japan": "JP", "jp": "JP",
  "china": "CN", "cn": "CN",
  "switzerland": "CH", "ch": "CH"
};

const CITY_COUNTRY_MAP = {
  "bangalore": "IN", "bengaluru": "IN", "mumbai": "IN", "delhi": "IN", "pune": "IN", "hyderabad": "IN", "chennai": "IN", "kolkata": "IN",
  "london": "GB", "manchester": "GB", "birmingham": "GB",
  "new york": "US", "san francisco": "US", "sf": "US", "seattle": "US", "austin": "US", "boston": "US", "chicago": "US", "los angeles": "US", "denver": "US",
  "toronto": "CA", "vancouver": "CA", "montreal": "CA",
  "berlin": "DE", "munich": "DE", "frankfurt": "DE",
  "paris": "FR",
  "tokyo": "JP",
  "sydney": "AU", "melbourne": "AU"
};

/**
 * Resolves free-text locations to structured city, region, and ISO country.
 * 
 * @param {string} rawLocation - Free-text location input.
 * @returns {{ city: string | null, region: string | null, country: string | null, method: string, confidence: number }}
 */
export function normalizeLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== "string") {
    return { city: null, region: null, country: null, method: "unresolvable", confidence: 0.0 };
  }

  const cleaned = rawLocation.trim();
  const lower = cleaned.toLowerCase();

  // 1. Remote handle
  if (lower === "remote" || lower.includes("work from home") || lower.includes("wfh")) {
    return { city: null, region: null, country: null, method: "remote_flag", confidence: 1.0 };
  }

  // 2. Split on comma and check tokens
  const tokens = cleaned.split(",").map(t => t.trim());
  
  if (tokens.length === 1) {
    const singleTokenLower = tokens[0].toLowerCase();
    
    // Check if single token matches country directly
    if (COUNTRY_MAP[singleTokenLower]) {
      return {
        city: null,
        region: null,
        country: COUNTRY_MAP[singleTokenLower],
        method: "country_direct_match",
        confidence: 0.95
      };
    }
    
    // Check if single token matches city
    if (CITY_COUNTRY_MAP[singleTokenLower]) {
      return {
        city: tokens[0],
        region: null,
        country: CITY_COUNTRY_MAP[singleTokenLower],
        method: "city_lookup",
        confidence: 0.9
      };
    }

    // Default unresolvable single token
    return {
      city: tokens[0],
      region: null,
      country: null,
      method: "unresolvable_single_token",
      confidence: 0.5
    };
  }

  // Multi-token: assume last token is country candidate, first token is city, middle tokens are region
  const countryCandidate = tokens[tokens.length - 1];
  const countryCandidateLower = countryCandidate.toLowerCase();
  
  let countryCode = null;
  let method = "alias_match";
  let confidence = 0.9;

  if (COUNTRY_MAP[countryCandidateLower]) {
    countryCode = COUNTRY_MAP[countryCandidateLower];
  } else {
    // If last token is not country, let's scan all tokens to see if any matches country
    for (let i = tokens.length - 1; i >= 0; i--) {
      const tokL = tokens[i].toLowerCase();
      if (COUNTRY_MAP[tokL]) {
        countryCode = COUNTRY_MAP[tokL];
        break;
      }
    }
    
    // If still no country found, check if last token matches city
    if (!countryCode && CITY_COUNTRY_MAP[countryCandidateLower]) {
      countryCode = CITY_COUNTRY_MAP[countryCandidateLower];
      method = "city_lookup";
    }
  }

  const city = tokens[0];
  const region = tokens.length > 2 ? tokens.slice(1, -1).join(", ") : null;

  if (!countryCode) {
    return {
      city,
      region: tokens.slice(1).join(", "),
      country: null,
      method: "country_unresolved",
      confidence: 0.5
    };
  }

  return {
    city,
    region,
    country: countryCode,
    method,
    confidence
  };
}
