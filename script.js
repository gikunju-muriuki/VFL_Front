/**
 * VFL Match History & Self-Learning Mathematical ML Engine
 * Fully autonomous local data loop utilizing IndexedDB storage
 * Enhanced with Bulk Results Parser & Import/Export Functionality
 */
(() => {
  'use strict';

  const VALID_TEAMS = [
    "Aston V", "Brighton", "Burnley", "Everton", "Fulham", "Leeds", "Leicester", 
    "Liverpool", "London Blues", "London Reds", "Manchester Blue", "Manchester Reds", 
    "Newcastle", "Palace", "Sheffield U", "Southampton", "Tottenham", "West Brom", 
    "West Ham", "Wolves"
  ].sort();

  const DB_CONFIG = {
    name: 'VFL_MatchHistory',
    version: 2,
    store: 'matches'
  };

  const $ = (id) => document.getElementById(id);
  let currentAnalyses = [];

  // Initialize IndexedDB
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(DB_CONFIG.store)) {
          const store = db.createObjectStore(DB_CONFIG.store, { keyPath: 'id', autoIncrement: true });
          store.createIndex('matchup', 'matchup', { unique: false });
          store.createIndex('home', 'home', { unique: false });
          store.createIndex('away', 'away', { unique: false });
          store.createIndex('oddsCombo', 'oddsCombo', { unique: false });
        }
      };
    });
  }

  // Read all records
  async function getAllMatches() {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.store, 'readonly');
        const store = tx.objectStore(DB_CONFIG.store);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // Save new record
  async function saveMatch(matchRecord) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_CONFIG.store, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.store);
      const request = store.add(matchRecord);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all records
  async function clearAllMatches() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_CONFIG.store, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.store);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * BULK RESULTS PARSER
   * Ultra-fast import: paste results in format
   * Team1
   * Team2
   * Goals1
   * Goals2
   * Team3
   * Team4
   * Goals3
   * Goals4
   * ... etc
   */
  function parseBulkResults(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('No data provided');
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const matches = [];
    let i = 0;

    while (i < lines.length) {
      if (i + 3 >= lines.length) break;

      const homeTeam = findTeamMatch(lines[i]);
      const awayTeam = findTeamMatch(lines[i + 1]);
      const homeGoals = parseInt(lines[i + 2], 10);
      const awayGoals = parseInt(lines[i + 3], 10);

      if (homeTeam && awayTeam && homeTeam !== awayTeam && !isNaN(homeGoals) && !isNaN(awayGoals)) {
        const result = homeGoals > awayGoals ? '1' : homeGoals === awayGoals ? 'X' : '2';
        matches.push({
          home: homeTeam,
          away: awayTeam,
          actualHomeGoals: homeGoals,
          actualAwayGoals: awayGoals,
          result: result,
          timestamp: new Date().toISOString(),
          homeOdds: 0,
          drawOdds: 0,
          awayOdds: 0,
          oddsCombo: '0|0|0'
        });
        i += 4;
      } else {
        i++;
      }
    }

    if (matches.length === 0) {
      throw new Error('No valid match results found. Format: Team1\\nTeam2\\nHomeGoals\\nAwayGoals');
    }
    return matches;
  }

  /**
   * FIXED BUGGY PARSER
   * Reads data stream sequentially, identifying targets and structural slots safely.
   */
  function parseGameweekData(rawText) {
    if (!rawText || typeof rawText !== 'string') throw new Error('No data provided');

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const matches = [];
    let i = 0;

    while (i < lines.length) {
      // Look ahead to check if we can parse a valid team pairing block
      if (i + 1 >= lines.length) { i++; continue; }

      const homeTeam = findTeamMatch(lines[i]);
      const awayTeam = findTeamMatch(lines[i+1]);

      if (homeTeam && awayTeam && homeTeam !== awayTeam) {
        let scanIdx = i + 2;
        let collectedOdds = [];

        // Collect exactly 3 odds metrics corresponding to (1, X, 2)
        while (collectedOdds.length < 3 && scanIdx < lines.length) {
          const currentLine = lines[scanIdx];
          
          // Skip string outcome markers if present in raw clipboard streams
          if (['1', 'X', '2'].includes(currentLine)) {
            scanIdx++;
            continue;
          }
          
          const val = parseFloat(currentLine);
          if (!isNaN(val) && val > 1.0) {
            collectedOdds.push(val);
          }
          scanIdx++;
        }

        // If we found our three specific values, register match block cleanly
        if (collectedOdds.length === 3) {
          matches.push({
            home: homeTeam,
            away: awayTeam,
            homeOdds: collectedOdds[0],
            drawOdds: collectedOdds[1],
            awayOdds: collectedOdds[2]
          });
          i = scanIdx;
          continue;
        }
      }
      i++;
    }

    if (matches.length === 0) {
      throw new Error('No valid matches found. Please ensure exact syntax patterns are present.');
    }
    return matches;
  }

  function findTeamMatch(input) {
    const norm = input.toLowerCase().trim();
    for (const team of VALID_TEAMS) {
      if (team.toLowerCase() === norm) return team;
    }
    for (const team of VALID_TEAMS) {
      if (team.toLowerCase().includes(norm) || norm.includes(team.toLowerCase())) return team;
    }
    return null;
  }

  /**
   * SELF-LEARNING INTELLIGENT MATHEMATICAL MODELLING
   * Evaluates historical records to assign contextual metrics instead of fixed baseline tiers
   */
  async function analyzeFixtureML(home, away, hOdds, dOdds, aOdds, idx) {
    const historicalData = await getAllMatches();
    
    // Implied probabilities (Bookmaker baseline projections)
    const rawHProb = 1 / hOdds;
    const rawDProb = 1 / dOdds;
    const rawAProb = 1 / aOdds;
    const margin = rawHProb + rawDProb + rawAProb;

    // Define unique key strings for combo matching
    const currentCombo = `${hOdds.toFixed(2)}|${dOdds.toFixed(2)}|${aOdds.toFixed(2)}`;

    // Analytics state variables
    let totalStored = historicalData.length;
    let singleOddsWins = { '1': 0, 'X': 0, '2': 0, totalMatchesMatchingValue: 0 };
    let comboWins = { '1': 0, 'X': 0, '2': 0, occurrences: 0 };
    let teamPerformanceWithOdds = { homeWinsWithTheseOdds: 0, awayWinsWithTheseOdds: 0, totalTeamMatchups: 0 };

    // Grouping & calculation loop over local data structures
    historicalData.forEach(match => {
      // 1. Process matching specific configurations
      if (match.homeOdds === hOdds) {
        singleOddsWins.totalMatchesMatchingValue++;
        if (match.result === '1') singleOddsWins['1']++;
      }
      if (match.drawOdds === dOdds) {
        if (match.result === 'X') singleOddsWins['X']++;
      }
      if (match.awayOdds === aOdds) {
        if (match.result === '2') singleOddsWins['2']++;
      }

      // 2. Exact combination cluster verification
      if (match.oddsCombo === currentCombo) {
        comboWins.occurrences++;
        comboWins[match.result]++;
      }

      // 3. Evaluate context specifics for individual team behaviors
      if (match.home === home && match.homeOdds === hOdds) {
        teamPerformanceWithOdds.totalTeamMatchups++;
        if (match.result === '1') teamPerformanceWithOdds.homeWinsWithTheseOdds++;
      }
      if (match.away === away && match.awayOdds === aOdds) {
        teamPerformanceWithOdds.totalTeamMatchups++;
        if (match.result === '2') teamPerformanceWithOdds.awayWinsWithTheseOdds++;
      }
    });

    // Compute Empirical Empirical Tiers dynamically based on historic dataset returns
    let dynamicHomeRank = singleOddsWins.totalMatchesMatchingValue > 0 ? (singleOddsWins['1'] / singleOddsWins.totalMatchesMatchingValue) : rawHProb;
    let dynamicDrawRank = singleOddsWins.totalMatchesMatchingValue > 0 ? (singleOddsWins['X'] / singleOddsWins.totalMatchesMatchingValue) : rawDProb;
    let dynamicAwayRank = singleOddsWins.totalMatchesMatchingValue > 0 ? (singleOddsWins['2'] / singleOddsWins.totalMatchesMatchingValue) : rawAProb;

    // Blend values to calculate final objective probability weights
    let weightH = (rawHProb * 0.3) + (dynamicHomeRank * 0.4) + (comboWins.occurrences > 0 ? (comboWins['1'] / comboWins.occurrences) * 0.3 : dynamicHomeRank * 0.3);
    let weightX = (rawDProb * 0.3) + (dynamicDrawRank * 0.4) + (comboWins.occurrences > 0 ? (comboWins['X'] / comboWins.occurrences) * 0.3 : dynamicDrawRank * 0.3);
    let weightA = (rawAProb * 0.3) + (dynamicAwayRank * 0.4) + (comboWins.occurrences > 0 ? (comboWins['2'] / comboWins.occurrences) * 0.3 : dynamicAwayRank * 0.3);

    const sumWeights = weightH + weightX + weightA;
    const finalHProb = weightH / sumWeights;
    const finalDProb = weightX / sumWeights;
    const finalAProb = weightA / sumWeights;

    // Determine algorithmic prediction path
    let prediction = '1';
    let maxWeight = finalHProb;
    if (finalDProb > maxWeight) { prediction = 'X'; maxWeight = finalDProb; }
    if (finalAProb > maxWeight) { prediction = '2'; maxWeight = finalAProb; }

    // Risk to Reward calculation (R:R Ratio Evaluation)
    let edge1 = (finalHProb * hOdds) - 1;
    let edgeX = (finalDProb * dOdds) - 1;
    let edge2 = (finalAProb * aOdds) - 1;

    let chosenEdge = prediction === '1' ? edge1 : prediction === 'X' ? edgeX : edge2;
    let chosenOdds = prediction === '1' ? hOdds : prediction === 'X' ? dOdds : aOdds;

    let rrClassification = "POOR (Negative Value Line)";
    let rrColor = "#fca5a5";
    if (chosenEdge > 0.15) {
      rrClassification = "EXCELLENT (High Empirical Value)";
      rrColor = "#86efac";
    } else if (chosenEdge > 0.02) {
      rrClassification = "GOOD (Fair Market Price)";
      rrColor = "#93c5fd";
    }

    let confidence = 'INITIALIZING ENGINE';
    if (totalStored > 15) {
      confidence = maxWeight > 0.55 ? 'HIGH CONVICTION' : maxWeight > 0.40 ? 'MEDIUM SIGNAL' : 'SENSITIVE VARIANCE';
    } else {
      confidence = 'BOOTSTRAP MODE (Low Local Sample Base)';
    }

    return {
      idx, home, away,
      hOdds, dOdds, aOdds,
      hProb: (finalHProb * 100).toFixed(1),
      dProb: (finalDProb * 100).toFixed(1),
      aProb: (finalAProb * 100).toFixed(1),
      totalMargin: ((margin - 1) * 100).toFixed(2),
      prediction, confidence,
      oddsCombo: currentCombo,
      rrClassification, rrColor,
      edge: (chosenEdge * 100).toFixed(1),
      sampleCount: comboWins.occurrences,
      historicalHomeWinPct: (dynamicHomeRank * 100).toFixed(0),
      historicalDrawWinPct: (dynamicDrawRank * 100).toFixed(0),
      historicalAwayWinPct: (dynamicAwayRank * 100).toFixed(0)
    };
  }

  // =========================================================================
  // EXPORT/IMPORT & NOTIFICATION SYSTEM
  // =========================================================================
  
  function showNotification(message, type = 'info') {
    const notification = $('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = `notification show notification-${type}`;
    
    setTimeout(() => {
      notification.classList.remove('show');
    }, 3000);
  }

  async function exportHistory() {
    try {
      const matches = await getAllMatches();
      const json = JSON.stringify(matches, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vfl_history_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification(`Exported ${matches.length} matches successfully`, 'success');
    } catch (err) {
      showNotification(`Export failed: ${err.message}`, 'error');
    }
  }

  async function copyHistoryToClipboard() {
    try {
      const matches = await getAllMatches();
      const json = JSON.stringify(matches, null, 2);
      await navigator.clipboard.writeText(json);
      showNotification(`Copied ${matches.length} matches to clipboard`, 'success');
    } catch (err) {
      showNotification(`Copy failed: ${err.message}`, 'error');
    }
  }

  async function importHistoryFromJson(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const matches = Array.isArray(data) ? data : data.matches || [];
      
      if (!matches.length) {
        throw new Error('No matches found in JSON');
      }

      let imported = 0;
      for (const match of matches) {
        try {
          await saveMatch(match);
          imported++;
        } catch (err) {
          // Duplicate or error, skip
        }
      }

      showNotification(`Imported ${imported} new matches`, 'success');
      return imported;
    } catch (err) {
      showNotification(`Import failed: ${err.message}`, 'error');
      throw err;
    }
  }

  async function handleFileUpload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const text = e.target.result;
          const imported = await importHistoryFromJson(text);
          resolve(imported);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsText(file);
    });
  }

  // =========================================================================
  // Interface Visual Renderer Engine Component
  // =========================================================================
  async function renderMatches(analyses) {
    const resultsPanel = $('results-panel');
    const resultsContent = $('results-content');
    if (!resultsPanel || !resultsContent) return;

    currentAnalyses = analyses;
    let html = '<div class="match-grid">';

    analyses.forEach((analysis, idx) => {
      const predBadgeClass = analysis.prediction === '1' ? '' : analysis.prediction === 'X' ? 'draw' : 'away';
      const predLabel = analysis.prediction === '1' ? 'HOME WIN' : analysis.prediction === 'X' ? 'DRAW' : 'AWAY WIN';

      html += `
        <div class="match-card" id="card-${idx}">
          <div class="match-header">
            <span class="match-title">${analysis.home} vs ${analysis.away}</span>
            <span class="prediction-badge ${predBadgeClass}">${predLabel}</span>
          </div>

          <div class="odds-row">
            <div class="odds-cell">
              <span class="odds-label">1 (${analysis.hOdds.toFixed(2)})</span>
              <span class="odds-value">${analysis.hProb}%</span>
              <small style="color:#9ca3af">Hist: ${analysis.historicalHomeWinPct}%</small>
            </div>
            <div class="odds-cell">
              <span class="odds-label">X (${analysis.dOdds.toFixed(2)})</span>
              <span class="odds-value">${analysis.dProb}%</span>
              <small style="color:#9ca3af">Hist: ${analysis.historicalDrawWinPct}%</small>
            </div>
            <div class="odds-cell">
              <span class="odds-label">2 (${analysis.aOdds.toFixed(2)})</span>
              <span class="odds-value">${analysis.aProb}%</span>
              <small style="color:#9ca3af">Hist: ${analysis.historicalAwayWinPct}%</small>
            </div>
          </div>

          <div class="confidence-text" style="border-top:1px dashed #374151; margin-top:8px; padding-top:8px;">
            <div><strong>Signal Strength:</strong> ${analysis.confidence}</div>
            <div><strong>Combo Occurrences:</strong> ${analysis.sampleCount} recorded times</div>
            <div style="color:${analysis.rrColor}"><strong>R:R Value Metric:</strong> ${analysis.rrClassification} (${analysis.edge}% Edge)</div>
          </div>

          <div class="result-section">
            <div class="result-inputs">
              <select id="home-goals-${idx}" class="goal-select">
                <option value="">Home Goals</option>
                ${Array.from({ length: 8 }, (_, i) => `<option value="${i}">${i}</option>`).join('')}
              </select>
              <span class="vs-text">-</span>
              <select id="away-goals-${idx}" class="goal-select">
                <option value="">Away Goals</option>
                ${Array.from({ length: 8 }, (_, i) => `<option value="${i}">${i}</option>`).join('')}
              </select>
            </div>
            <button class="save-result-btn" onclick="VFLBrain.captureResult(${idx})">Log Game Output</button>
          </div>
        </div>
      `;
    });

    html += '</div>';
    resultsContent.innerHTML = html;
    resultsPanel.classList.remove('hidden');
  }

  // =========================================================================
  // Result Logging Strategy Processor
  // =========================================================================
  async function captureResult(idx) {
    const analysis = currentAnalyses[idx];
    const hG = parseInt($(`home-goals-${idx}`).value, 10);
    const aG = parseInt($(`away-goals-${idx}`).value, 10);

    if (isNaN(hG) || isNaN(aG)) {
      showNotification('Please define valid goals parameters', 'error');
      return;
    }

    const empiricalOutcome = hG > aG ? '1' : hG === aG ? 'X' : '2';

    const matchRecord = {
      home: analysis.home,
      away: analysis.away,
      homeOdds: analysis.hOdds,
      drawOdds: analysis.dOdds,
      awayOdds: analysis.aOdds,
      oddsCombo: analysis.oddsCombo,
      actualHomeGoals: hG,
      actualAwayGoals: aG,
      result: empiricalOutcome,
      timestamp: new Date().toISOString()
    };

    await saveMatch(matchRecord);
    $(`home-goals-${idx}`).disabled = true;
    $(`away-goals-${idx}`).disabled = true;
    $(`card-${idx}`).classList.add('result-saved');
    showNotification(`Match logged: ${analysis.home} ${hG}-${aG} ${analysis.away}`, 'success');
  }

  // =========================================================================
  // Input Data Processor Engine Hook
  // =========================================================================
  async function processInput() {
    const inputField = $('data-input');
    if (!inputField || !inputField.value.trim()) return;

    try {
      const basicFixtures = parseGameweekData(inputField.value);
      const mlEvaluatedFixtures = await Promise.all(
        basicFixtures.map((m, idx) => analyzeFixtureML(m.home, m.away, m.homeOdds, m.drawOdds, m.awayOdds, idx))
      );
      await renderMatches(mlEvaluatedFixtures);
      showNotification(`Parsed and analyzed ${basicFixtures.length} matches`, 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  async function processBulkResults() {
    const inputField = $('data-input');
    if (!inputField || !inputField.value.trim()) return;

    try {
      const results = parseBulkResults(inputField.value);
      let saved = 0;
      
      for (const result of results) {
        await saveMatch(result);
        saved++;
      }
      
      inputField.value = '';
      showNotification(`Bulk imported ${saved} match results to history`, 'success');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  // Bind infrastructure hooks safely to window space objects
  window.VFLBrain = {
    processInput,
    processBulkResults,
    captureResult,
    exportHistory,
    copyHistoryToClipboard,
    importHistoryFromJson,
    handleFileUpload,
    showNotification,
    clearAllMatches
  };

  window.addEventListener('DOMContentLoaded', () => {
    const parseBtn = $('parse-btn');
    if (parseBtn) parseBtn.addEventListener('click', processInput);

    const bulkBtn = $('bulk-btn');
    if (bulkBtn) bulkBtn.addEventListener('click', processBulkResults);

    const exportBtn = $('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportHistory);

    const copyBtn = $('copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', copyHistoryToClipboard);

    const importToggleBtn = $('import-toggle-btn');
    const importPanel = $('import-panel');
    if (importToggleBtn && importPanel) {
      importToggleBtn.addEventListener('click', () => {
        importPanel.classList.toggle('hidden');
      });
    }

    const pasteImportBtn = $('paste-import-btn');
    if (pasteImportBtn) {
      pasteImportBtn.addEventListener('click', async () => {
        const textarea = $('import-textarea');
        if (textarea && textarea.value.trim()) {
          try {
            await importHistoryFromJson(textarea.value);
            textarea.value = '';
            importPanel.classList.add('hidden');
          } catch (err) {
            showNotification(`Import error: ${err.message}`, 'error');
          }
        }
      });
    }

    const importCancelBtn = $('import-cancel-btn');
    if (importCancelBtn && importPanel) {
      importCancelBtn.addEventListener('click', () => {
        importPanel.classList.add('hidden');
        $('import-textarea').value = '';
      });
    }

    const uploadBtn = $('upload-btn');
    const fileInput = $('import-file-input');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
          try {
            await handleFileUpload(e.target.files[0]);
          } catch (err) {
            showNotification(`Upload error: ${err.message}`, 'error');
          }
          e.target.value = '';
        }
      });
    }

    const clearHistoryBtn = $('clear-history-btn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all match history? This cannot be undone.')) {
          try {
            await clearAllMatches();
            showNotification('All history cleared', 'success');
          } catch (err) {
            showNotification(`Clear failed: ${err.message}`, 'error');
          }
        }
      });
    }

    const clearBtn = $('clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        $('data-input').value = '';
      });
    }
  });
})();
