import fs from 'fs';
import path from 'path';
import { mapAtsFields } from '../modules/2_ats_mapper.js';
import { mergeProfiles } from '../modules/8_merge_engine.js';
import { projectProfile } from '../modules/9_projection_layer.js';

const SAMPLE_ATS = {
  "candidateName": "Asha Rao",
  "Email-Addresses": "asha.rao@example.com, asha.dev@work.com",
  "phone_numbers": "+91 98765 43210",
  "curr_company": "Initech",
  "headline": "Software Engineer",
  "skills": ["JS", "node", "k8s"],
  "location": "Bengaluru, India"
};

const SAMPLE_CONFIG = {
  "fields": [
    { "path": "name", "from": "full_name", "type": "string", "required": true },
    { "path": "primary_email", "from": "emails[0]", "type": "string", "required": true },
    { "path": "phone", "from": "phones[0]", "type": "string", "normalize": "E164" },
    { "path": "skills", "from": "skills[].name", "type": "string[]", "normalize": "canonical" }
  ],
  "include_confidence": true,
  "on_missing": "null"
};

async function generateSample() {
  const mapped = mapAtsFields(SAMPLE_ATS);
  
  // Create candidate profile
  const merged = await mergeProfiles(mapped.canonical, {}, "c_8f2a91");
  
  // Project profile
  const projected = await projectProfile(merged, SAMPLE_CONFIG);

  const outDir = path.resolve('outputs');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }

  const outFile = path.join(outDir, 'sample_output.json');
  fs.writeFileSync(outFile, JSON.stringify(projected, null, 2), 'utf8');
  console.log(`Successfully generated sample output at: ${outFile}`);
}

generateSample().catch(err => {
  console.error("Failed to dump sample output", err);
});
