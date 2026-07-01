import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { detectSourceType } from './modules/1_source_detector.js';
import { mapAtsFields } from './modules/2_ats_mapper.js';
import { parseResume, limitConcurrency } from './modules/4_resume_parser.js';
import { resolveIdentities } from './modules/5_identity_resolver.js';
import { mergeProfiles } from './modules/8_merge_engine.js';
import { projectProfile } from './modules/9_projection_layer.js';

const app = express();
const port = 3000;

// Setup in-memory DB
const DB = {
  candidates: new Map() // candidate_id -> { candidate_id, canonical, warnings }
};

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB limit per file
  }
});

// API Endpoints

/**
 * POST /api/candidates/ingest
 */
app.post('/api/candidates/ingest', upload.any(), async (req, res) => {
  try {
    const files = req.files || [];
    const rawAtsRecords = [];
    const resumeUploads = [];
    const fileStatusList = [];

    // Parse text-based ATS JSON in body if supplied
    if (req.body.atsJson) {
      try {
        const parsed = typeof req.body.atsJson === 'string' ? JSON.parse(req.body.atsJson) : req.body.atsJson;
        if (Array.isArray(parsed)) {
          rawAtsRecords.push(...parsed);
        } else {
          rawAtsRecords.push(parsed);
        }
      } catch (err) {
        console.warn("Failed to parse atsJson body field as JSON", err);
      }
    }

    // Process uploaded files
    for (const file of files) {
      const typeResult = detectSourceType(file.originalname, file.mimetype, file.buffer);
      
      if (typeResult.type === 'ATS_JSON') {
        try {
          const content = file.buffer.toString('utf8');
          const parsed = JSON.parse(content);
          
          let count = 0;
          if (Array.isArray(parsed)) {
            rawAtsRecords.push(...parsed.map(x => ({ ...x, _source_file: file.originalname })));
            count = parsed.length;
          } else {
            rawAtsRecords.push({ ...parsed, _source_file: file.originalname });
            count = 1;
          }
          
          fileStatusList.push({
            filename: file.originalname,
            type: 'ATS_JSON',
            status: 'success',
            message: `Parsed ${count} ATS records.`
          });
        } catch (err) {
          fileStatusList.push({
            filename: file.originalname,
            type: 'ATS_JSON',
            status: 'garbage_source',
            message: 'Malformed JSON payload.'
          });
        }
      } else if (typeResult.type === 'RESUME') {
        resumeUploads.push(file);
      } else {
        fileStatusList.push({
          filename: file.originalname,
          type: 'UNKNOWN',
          status: 'garbage_source',
          message: 'Unsupported file type.'
        });
      }
    }

    // 1. Map ATS JSON fields to canonical schema
    const mappedAtsRecords = rawAtsRecords.map(rawRecord => {
      const mapped = mapAtsFields(rawRecord);
      return {
        ...mapped.canonical,
        _warnings: mapped.warnings.unmapped_fields,
        _source_file: rawRecord._source_file || 'direct_body'
      };
    });

    // 2. Parse resumes with bounded concurrency (limit = 3)
    const resumeParseTasks = resumeUploads.map(file => async () => {
      const parseResult = await parseResume(file.buffer, file.originalname);
      return {
        filename: file.originalname,
        mimeType: file.mimetype,
        parseResult
      };
    });

    const parsedResumesResults = await limitConcurrency(resumeParseTasks, 3);
    const parsedResumes = [];

    for (const res of parsedResumesResults) {
      if (res.parseResult.status === 'success') {
        parsedResumes.push({
          filename: res.filename,
          fields: res.parseResult.fields
        });
        fileStatusList.push({
          filename: res.filename,
          type: 'RESUME',
          status: 'success',
          message: 'Parsed resume sections successfully.'
        });
      } else {
        parsedResumes.push({
          filename: res.filename,
          fields: null,
          status: 'garbage_source'
        });
        fileStatusList.push({
          filename: res.filename,
          type: 'RESUME',
          status: 'garbage_source',
          message: 'Failed to parse resume (corrupted or timeout).'
        });
      }
    }

    // 3. Resolve identities and cluster
    const clusters = resolveIdentities(mappedAtsRecords, parsedResumes);

    const ingestedCandidateIds = [];

    // 4. Merge clusters
    for (const cluster of clusters) {
      const cid = cluster.candidate_id;
      const atsRec = cluster.ats_record || {};
      const resumeRec = cluster.resume_record || {};
      
      const mergedCanonical = await mergeProfiles(atsRec, resumeRec.fields || {}, cid);

      // Collect warnings
      const warningsList = [];
      if (atsRec._warnings && atsRec._warnings.length > 0) {
        warningsList.push(`Unmapped ATS fields in file ${atsRec._source_file}: ${atsRec._warnings.join(', ')}`);
      }
      if (resumeRec.status === 'garbage_source') {
        warningsList.push(`Resume file ${resumeRec.filename} was flagged as a garbage source (parsing failed or timed out).`);
      }

      // Save to memory DB
      DB.candidates.set(cid, {
        candidate_id: cid,
        canonical: mergedCanonical,
        warnings: warningsList,
        match_method: cluster.match_method
      });

      ingestedCandidateIds.push(cid);

      // Associate candidate ID in the fileStatusList
      if (atsRec._source_file) {
        const fileStatus = fileStatusList.find(f => f.filename === atsRec._source_file);
        if (fileStatus) fileStatus.matched_candidate_id = cid;
      }
      if (resumeRec.filename) {
        const fileStatus = fileStatusList.find(f => f.filename === resumeRec.filename);
        if (fileStatus) fileStatus.matched_candidate_id = cid;
      }
    }

    res.json({
      status: 'success',
      candidate_ids: ingestedCandidateIds,
      files: fileStatusList
    });
  } catch (err) {
    console.error("Ingestion server error:", err);
    res.status(500).json({ error: 'Internal server error in ingestion pipeline.' });
  }
});

/**
 * GET /api/candidates/:id
 */
app.get('/api/candidates/:id', (req, res) => {
  const candidate = DB.candidates.get(req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  res.json(candidate);
});

/**
 * POST /api/candidates/:id/project
 */
app.post('/api/candidates/:id/project', async (req, res) => {
  const candidate = DB.candidates.get(req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  try {
    const config = req.body;
    const projected = await projectProfile(candidate.canonical, config);
    res.json(projected);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/candidates/:id/provenance
 */
app.get('/api/candidates/:id/provenance', (req, res) => {
  const candidate = DB.candidates.get(req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  res.json({
    candidate_id: candidate.candidate_id,
    provenance: candidate.canonical.provenance,
    overall_confidence: candidate.canonical.overall_confidence
  });
});

/**
 * GET /api/candidates
 */
app.get('/api/candidates', (req, res) => {
  const list = Array.from(DB.candidates.values()).map(c => {
    return {
      candidate_id: c.candidate_id,
      name: c.canonical.full_name || 'Unknown Name',
      email: c.canonical.emails?.[0] || 'No Email',
      skills_count: c.canonical.skills?.length || 0,
      match_method: c.match_method || 'none',
      warnings_count: c.warnings.length
    };
  });
  res.json(list);
});

// Add Multer error-handling middleware
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File size exceeds the 20MB limit.' });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Internal upload error.' });
  }
  next();
});

// Boot Server
app.listen(port, () => {
  console.log(`Candidate Unification Engine running at http://localhost:${port}`);
});
