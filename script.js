/**
 * VFL Match History & Self-Learning Mathematical ML Engine
 * Fully autonomous local data loop utilizing IndexedDB storage
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
    version: 2, // Upgraded version to reflect new data profiles
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
          i = scanIdx; // Advance main loop directly past processed data cluster
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
    // Formula: Edge = (Calculated Probability * Multiplier) - 1
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
  // Interface Visual Renderer Engine Component
  // =========================================================================
  async function renderMatches(analyses) {
    const resultsPanel = \$('results-panel');
    const resultsContent = \$('results-content');
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
                ${Array.from({ length: 8 }, (_, i) => `<option value="i">{i}</option>`).join('')}
              </select>
              <span class="vs-text">-</span>
              <select id="away-goals-${idx}" class="goal-select">
                <option value="">Away Goals</option>
                ${Array.from({ length: 8 }, (_, i) => `<option value="i">{i}</option>`).join('')}
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
    const hG = parseInt(\$(`home-goals-${idx}`).value, 10);
    const aG = parseInt(\$(`away-goals-${idx}`).value, 10);

    if (isNaN(hG) || isNaN(aG)) {
      alert('Please define valid goals parameters to calculate matching outcomes.');
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
    \$(`home-goals-${idx}`).disabled = true;
    \$(`away-goals-${idx}`).disabled = true;
    \$(`card-${idx}`).style.opacity = '0.5';
    console.log(`Stored execution output context accurately: Match ID index #${idx}`);
  }

  // =========================================================================
  // Input Data Processor Engine Hook
  // =========================================================================
  async function processInput() {
    const inputField = \$('data-input');
    if (!inputField || !inputField.value.trim()) return;

    try {
      const basicFixtures = parseGameweekData(inputField.value);
      const mlEvaluatedFixtures = await Promise.all(
        basicFixtures.map((m, idx) => analyzeFixtureML(m.home, m.away, m.homeOdds, m.drawOdds, m.awayOdds, idx))
      );
      await renderMatches(mlEvaluatedFixtures);
    } catch (err) {
      alert(err.message);
    }
  }

  // Bind infrastructure hooks safely to window space objects
  window.VFLBrain = {
    processInput,
    captureResult
  };

  window.addEventListener('DOMContentLoaded', () => {
    const parseBtn = \$('parse-btn');
    if (parseBtn) parseBtn.addEventListener('click', processInput);
  });
})();

