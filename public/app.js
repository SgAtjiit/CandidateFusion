// Simplified Dashboard Logic (Eightfold Aligned & Multi-Candidate Selector)
let uploadedFile = null;

const DEFAULT_ATS_JSON = {
  "candidateName": "Asha Rao",
  "Email-Addresses": "asha.rao@example.com, asha.dev@work.com",
  "phone_numbers": "+91 98765 43210",
  "curr_company": "Initech",
  "headline": "Software Engineer",
  "skills": ["JS", "node", "k8s"],
  "location": "Bengaluru, India",
  "social_links": [
    "https://linkedin.com/in/asharao",
    "https://github.com/asharao"
  ]
};

const DEFAULT_CONFIG = {
  "fields": [
    { "path": "name", "from": "full_name", "type": "string", "required": true },
    { "path": "primary_email", "from": "emails[0]", "type": "string", "required": true },
    { "path": "phone", "from": "phones[0]", "type": "string", "normalize": "E164" },
    { "path": "skills", "from": "skills[].name", "type": "string[]", "normalize": "canonical" }
  ],
  "include_confidence": true,
  "on_missing": "null"
};

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const atsJsonInput = document.getElementById('ats-json-input');
const projectionConfigInput = document.getElementById('projection-config');
const btnProcess = document.getElementById('btn-process');

const resultsPanel = document.getElementById('results-panel');
const activeCandidateSelect = document.getElementById('active-candidate-select');
const warningsCard = document.getElementById('warnings-card');
const warningsList = document.getElementById('warnings-list');
const outputRaw = document.getElementById('output-raw');
const outputFormatted = document.getElementById('output-formatted');

const profileName = document.getElementById('profile-name');
const profileTitle = document.getElementById('profile-title');
const profileEmail = document.getElementById('profile-email');
const profilePhone = document.getElementById('profile-phone');
const profileLocation = document.getElementById('profile-location');
const profileSkills = document.getElementById('profile-skills');

document.addEventListener('DOMContentLoaded', () => {
  // Selector change handler
  activeCandidateSelect.addEventListener('change', (e) => {
    loadCandidateProfile(e.target.value);
  });

  // Load sample click handler
  const btnLoadSample = document.getElementById('btn-load-sample');
  if (btnLoadSample) {
    btnLoadSample.addEventListener('click', () => {
      atsJsonInput.value = JSON.stringify(DEFAULT_ATS_JSON, null, 2);
      projectionConfigInput.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
    });
  }

  // Reset click handler
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      atsJsonInput.value = '';
      projectionConfigInput.value = '';
      uploadedFile = null;
      fileInput.value = '';
      uploadStatus.innerText = 'Drag & Drop Resume PDF/DOCX or Click to Browse';
      uploadStatus.style.color = '#94a3b8';
      resultsPanel.classList.add('hidden');
      warningsCard.classList.add('hidden');
    });
  }
});

// File Upload Event Listeners
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drop-zone-mini');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    setFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    setFile(e.target.files[0]);
  }
});

function setFile(file) {
  uploadedFile = file;
  uploadStatus.innerText = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  uploadStatus.style.color = '#10b981';
}

/**
 * Loads and displays a candidate's unified profile and projection.
 */
async function loadCandidateProfile(candidateId) {
  let config = {};
  const configVal = projectionConfigInput.value.trim();
  if (configVal) {
    try {
      config = JSON.parse(configVal);
    } catch (e) {
      alert("Projection Config has syntax errors: " + e.message);
      return;
    }
  }

  try {
    // 1. Fetch Canonical Profile
    const profileRes = await fetch(`/api/candidates/${candidateId}`);
    const candidateData = await profileRes.json();

    // 2. Post Output Projection
    const projectRes = await fetch(`/api/candidates/${candidateId}/project`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });

    const projectedData = await projectRes.json();

    if (projectRes.status === 200) {
      outputRaw.value = JSON.stringify(projectedData);
      outputFormatted.innerText = JSON.stringify(projectedData, null, 2);
    } else {
      outputRaw.value = "Error: Validation Failed";
      outputFormatted.innerText = "Validation Error:\n" + (projectedData.error || JSON.stringify(projectedData, null, 2));
    }

    // Display Warnings Diagnostics
    const warnings = candidateData.warnings || [];
    warningsList.innerHTML = '';
    if (warnings.length > 0) {
      warningsCard.classList.remove('hidden');
      warnings.forEach(warn => {
        const li = document.createElement('li');
        li.innerText = warn;
        warningsList.appendChild(li);
      });
    } else {
      warningsCard.classList.add('hidden');
    }

    // Render Proper Profile Presentation
    const canon = candidateData.canonical;
    profileName.innerText = canon.full_name || "N/A";
    profileTitle.innerText = canon.headline || "N/A";
    
    profileEmail.innerHTML = `<i class="fa-regular fa-envelope"></i> ${canon.emails && canon.emails.length > 0 ? canon.emails.join(', ') : "N/A"}`;
    profilePhone.innerHTML = `<i class="fa-solid fa-phone"></i> ${canon.phones && canon.phones.length > 0 ? canon.phones.join(', ') : "N/A"}`;
    
    if (canon.location) {
      const loc = canon.location;
      if (!loc.city && !loc.region && !loc.country) {
        profileLocation.innerHTML = `<i class="fa-solid fa-location-dot"></i> Remote`;
      } else {
        profileLocation.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${[loc.city, loc.region, loc.country].filter(Boolean).join(', ')}`;
      }
    } else {
      profileLocation.innerHTML = `<i class="fa-solid fa-location-dot"></i> N/A`;
    }

    // Render skills
    profileSkills.innerHTML = '';
    if (canon.skills && canon.skills.length > 0) {
      canon.skills.forEach(skill => {
        const pill = document.createElement('span');
        pill.className = 'skill-pill';
        pill.innerText = skill.name;
        profileSkills.appendChild(pill);
      });
    } else {
      profileSkills.innerHTML = '<span class="sub-text">No skills found.</span>';
    }

  } catch (err) {
    console.error("Error loading candidate profile view:", err);
    alert("Could not load candidate profile: " + err.message);
  }
}

// Processing Workflow
btnProcess.addEventListener('click', async () => {
  btnProcess.disabled = true;
  btnProcess.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing &amp; Unifying...';
  resultsPanel.classList.add('hidden');
  warningsCard.classList.add('hidden');

  const formData = new FormData();
  
  if (uploadedFile) {
    formData.append('files', uploadedFile);
  }

  const atsJsonValue = atsJsonInput.value.trim();
  if (atsJsonValue) {
    try {
      JSON.parse(atsJsonValue);
      formData.append('atsJson', atsJsonValue);
    } catch (e) {
      alert("ATS JSON field has syntax errors: " + e.message);
      resetButton();
      return;
    }
  }

  const configVal = projectionConfigInput.value.trim();
  if (configVal) {
    try {
      JSON.parse(configVal);
    } catch (e) {
      alert("Projection Config has syntax errors: " + e.message);
      resetButton();
      return;
    }
  }

  try {
    // 1. Run Ingestion / Unification Pipeline
    const ingestRes = await fetch('/api/candidates/ingest', {
      method: 'POST',
      body: formData
    });
    
    const ingestResult = await ingestRes.json();
    
    if (!ingestResult.candidate_ids || ingestResult.candidate_ids.length === 0) {
      alert("Failed to ingest: No candidates could be resolved.");
      resetButton();
      return;
    }

    // Determine default selected candidate ID
    let selectedId = ingestResult.candidate_ids[0];
    
    // Default to candidate resolved from resume if we uploaded one
    const resumeFile = ingestResult.files.find(f => f.type === 'RESUME' && f.matched_candidate_id);
    if (resumeFile) {
      selectedId = resumeFile.matched_candidate_id;
    }

    // Populate active candidate selector dropdown options
    activeCandidateSelect.innerHTML = '';
    for (const cid of ingestResult.candidate_ids) {
      const nameRes = await fetch(`/api/candidates/${cid}`);
      const candidateObj = await nameRes.json();
      const cName = candidateObj.canonical?.full_name || "Unknown Candidate";

      const opt = document.createElement('option');
      opt.value = cid;
      opt.innerText = `${cName} (${cid})`;
      if (cid === selectedId) {
        opt.selected = true;
      }
      activeCandidateSelect.appendChild(opt);
    }

    // 2. Load the default profile and trigger output projection
    resultsPanel.classList.remove('hidden');
    await loadCandidateProfile(selectedId);

  } catch (err) {
    console.error("Processing error:", err);
    alert("An error occurred during profile execution: " + err.message);
  } finally {
    resetButton();
  }
});

function resetButton() {
  btnProcess.disabled = false;
  btnProcess.innerHTML = '<i class="fa-solid fa-play"></i> Process &amp; Project Candidate Profile';
}
