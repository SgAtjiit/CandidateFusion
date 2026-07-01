import fs from 'fs';
import path from 'path';
import { mapAtsFields } from '../modules/2_ats_mapper.js';
import { parseResume } from '../modules/4_resume_parser.js';
import { generateDeterministicId } from '../modules/5_identity_resolver.js';
import { mergeProfiles } from '../modules/8_merge_engine.js';
import { projectProfile } from '../modules/9_projection_layer.js';

async function runTests() {
  console.log("\n==================================================");
  console.log("   PROCESSING SAMPLE INPUTS & CONFIGS");
  console.log("==================================================\n");

  const inputsDir = path.resolve('sample_inputs');
  const configsDir = path.resolve('sample_configs');
  const outputsDir = path.resolve('sample_outputs');

  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }

  if (!fs.existsSync(inputsDir)) {
    console.error("Error: sample_inputs directory not found.");
    process.exit(1);
  }

  const files = fs.readdirSync(inputsDir).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} sample cases to process...\n`);
  
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const inputPath = path.join(inputsDir, file);
    const configPath = path.join(configsDir, file);
    const outputPath = path.join(outputsDir, file);

    console.log(`Processing ${file}...`);

    if (!fs.existsSync(configPath)) {
      console.error(`  [FAIL] Missing config file in sample_configs: ${file}`);
      failCount++;
      continue;
    }

    try {
      const rawInput = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // 1. Map ATS fields
      const mapped = mapAtsFields(rawInput);
      
      // 2. Check for optional matching PDF resume
      const pdfName = file.replace(/\.json$/, '.pdf');
      const pdfPath = path.join(inputsDir, pdfName);
      let resumeFields = {};

      if (fs.existsSync(pdfPath)) {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const parsedResume = await parseResume(pdfBuffer, pdfName);
        if (parsedResume.status === 'success' && parsedResume.fields) {
          resumeFields = parsedResume.fields;
          console.log(`    -> Integrated matching resume PDF: ${pdfName}`);
        } else {
          console.warn(`    -> [WARN] Failed to parse matching resume PDF: ${pdfName}`);
        }
      }

      // 3. Resolve seed & ID
      const seedEmail = rawInput.email || rawInput.emails || (Array.isArray(rawInput.emails) ? rawInput.emails[0] : null) || "";
      const seedName = rawInput.name || rawInput.fullname || rawInput.candidateName || "sample";
      const seed = String(seedEmail || seedName);
      const candidateId = generateDeterministicId(seed);

      // 4. Merge ATS and Resume
      const merged = await mergeProfiles(mapped.canonical, resumeFields, candidateId);

      // 5. Project profile using config
      const projected = await projectProfile(merged, config);

      // 6. Write output to file
      fs.writeFileSync(outputPath, JSON.stringify(projected, null, 2), 'utf8');
      console.log(`  [PASS] Successfully wrote projected output to sample_outputs/${file}`);
      successCount++;
    } catch (err) {
      console.error(`  [FAIL] Error processing ${file}:`, err.message || err);
      failCount++;
    }
  }

  console.log("\n==================================================");
  console.log(`    EXECUTION SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log("==================================================\n");

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
