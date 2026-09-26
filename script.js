const TEAM_TIERS = {
  "London Blues": 1,
  "Liverpool": 1,
  "Manchester Blue": 1,
  "London Reds": 1,
  "Manchester Reds": 2,
  "Aston V": 2,
  "Newcastle": 2,
  "Tottenham": 2,
  "Everton": 2,
  "Leicester": 3,
  "West Brom": 3,
  "Wolves": 3,
  "Palace": 3,
  "Brighton": 3,
  "West Ham": 3,
  "Leeds": 4,
  "Burnley": 4,
  "Fulham": 4,
  "Southampton": 4,
  "Sheffield U": 4,
};

const VALID_TEAMS = Object.keys(TEAM_TIERS).sort();
const $ = (id) => document.getElementById(id);

// ============================================================================
// DATABASE LAYER - IndexedDB for historical match data
// ============================================================================

const DB_CONFIG = {
  name: 'VFL_MatchHistory',
  version: 1,
  store: 'matches'
};

/**
 * Initialize IndexedDB database
 */
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_CONFIG.store)) {
        const store = db.createObjectStore(DB_CONFIG.store, { keyPath: 'id', autoIncrement: true });
        store.createIndex('matchup', 'matchup', { unique: false });
        store.createIndex('homeTeam', 'home', { unique: false });
        store.createIndex('awayTeam', 'away', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Save a match result to IndexedDB
 */
async function saveMatch(matchData) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_CONFIG.store, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.store);
      
      const request = store.add(matchData);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error saving match:', error);
    throw error;
  }
}

/**
 * Get all matches from IndexedDB
 */
async function getAllMatches() {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_CONFIG.store, 'readonly');
      const store = tx.objectStore(DB_CONFIG.store);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    return [];
  }
}

/**
 * Get head-to-head matches between two teams
 */
async function getHeadToHead(team1, team2) {
  try {
    const allMatches = await getAllMatches();
    return allMatches.filter(m => 
      (m.home === team1 && m.away === team2) || 
      (m.home === team2 && m.away === team1)
    );
  } catch (error) {
    console.error('Error fetching head-to-head:', error);
    return [];
  }
}

/**
 * Get team performance stats
 */
async function getTeamStats(teamName, venue = null) {
  try {
    const allMatches = await getAllMatches();
    let matches = [];
    
    if (venue === 'home') {
      matches = allMatches.filter(m => m.home === teamName && m.result);
    } else if (venue === 'away') {
      matches = allMatches.filter(m => m.away === teamName && m.result);
    } else {
      matches = allMatches.filter(m => (m.home === teamName || m.away === teamName) && m.result);
    }
    
    if (matches.length === 0) {
      return {
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
        avgGoalsFor: 0,
        avgGoalsAgainst: 0,
        cleanSheets: 0,
        prediction: null
      };
    }
    
    let wins = 0, draws = 0, losses = 0;
    let goalsFor = 0, goalsAgainst = 0, cleanSheets = 0;
    
    matches.forEach(m => {
      const isHome = m.home === teamName;
      const teamGoals = isHome ? m.actualHomeGoals : m.actualAwayGoals;
      const opponentGoals = isHome ? m.actualAwayGoals : m.actualHomeGoals;
      
      goalsFor += teamGoals;
      goalsAgainst += opponentGoals;
      
      if (teamGoals > opponentGoals) wins++;
      else if (teamGoals === opponentGoals) draws++;
      else losses++;
      
      if (opponentGoals === 0) cleanSheets++;
    });
    
    return {
      matches: matches.length,
      wins,
      draws,
      losses,
      winRate: (wins / matches.length * 100).toFixed(1),
      avgGoalsFor: (goalsFor / matches.length).toFixed(2),
      avgGoalsAgainst: (goalsAgainst / matches.length).toFixed(2),
      cleanSheets,
      recentMatches: matches.slice(-5)
    };
  } catch (error) {
    console.error('Error getting team stats:', error);
    return null;
  }
}

/**
 * Export all match data as JSON
 */
async function exportMatchData() {
  try {
    const allMatches = await getAllMatches();
    const json = JSON.stringify(allMatches, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VFL_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification(`Exported ${allMatches.length} matches successfully!`, 'success');
  } catch (error) {
    showNotification('Error exporting data: ' + error.message, 'error');
  }
}

/**
 * Copy match data to clipboard
 */
async function copyToClipboard() {
  try {
    const allMatches = await getAllMatches();
    const json = JSON.stringify(allMatches, null, 2);
    await navigator.clipboard.writeText(json);
    showNotification(`Copied ${allMatches.length} matches to clipboard!`, 'success');
  } catch (error) {
    showNotification('Error copying to clipboard: ' + error.message, 'error');
  }
}

/**
 * Import match data from JSON
 */
async function importMatchData(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) {
      throw new Error('Invalid format: Expected an array of matches');
    }
    
    const db = await initDB();
    const tx = db.transaction(DB_CONFIG.store, 'readwrite');
    const store = tx.objectStore(DB_CONFIG.store);
    
    let count = 0;
    for (const match of data) {
      await new Promise((resolve, reject) => {
        const request = store.add(match);
        request.onsuccess = () => { count++; resolve(); };
        request.onerror = () => reject(request.error);
      });
    }
    
    showNotification(`Imported ${count} matches successfully!`, 'success');
    return true;
  } catch (error) {
    showNotification('Error importing data: ' + error.message, 'error');
    return false;
  }
}

/**
 * Clear all match data
 */
async function clearAllData() {
  if (!confirm('Are you sure? This will delete ALL stored match data.')) return;
  
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_CONFIG.store, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.store);
      const request = store.clear();
      
      request.onsuccess = () => {
        showNotification('All match data cleared!', 'success');
        resolve(true);
      };
    });
  } catch (error) {
    showNotification('Error clearing data: ' + error.message, 'error');
  }
}

// ============================================================================
// PARSING LAYER - Team and odds extraction
// ============================================================================

/**
 * Smart parser for betting data
 * Intelligently extracts matches, teams, and odds regardless of formatting
 */
function parseGameweekData(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('No data provided');
  }

  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    throw new Error('Empty data');
  }

  const matches = [];
  let i = 0;

  while (i < lines.length) {
    const potentialHome = lines[i];
    const potentialAway = lines[i + 1];

    if (!potentialHome || !potentialAway) {
      i++;
      continue;
    }

    const homeTeam = findTeamMatch(potentialHome);
    const awayTeam = findTeamMatch(potentialAway);

    if (!homeTeam || !awayTeam || homeTeam === awayTeam) {
      i++;
      continue;
    }

    i += 2;

    const oddsArray = [];
    let j = i;

    while (oddsArray.length < 6 && j < lines.length) {
      const line = lines[j];
      
      if (line === '1' || line === 'X' || line === '2') {
        j++;
        continue;
      }

      const num = parseFloat(line);
      if (!isNaN(num) && num > 1 && num < 1000) {
        oddsArray.push(num);
        j++;
        if (oddsArray.length === 6) break;
      } else {
        j++;
      }
    }

    if (oddsArray.length === 6) {
      const [homeOdds, drawOdds, awayOdds] = [
        oddsArray[0],
        oddsArray[1],
        oddsArray[2]
      ];

      matches.push({
        home: homeTeam,
        away: awayTeam,
        homeOdds,
        drawOdds,
        awayOdds,
      });

      i = j;
    } else {
      i++;
    }
  }

  if (matches.length === 0) {
    throw new Error('No valid matches found. Please check your data format.');
  }

  return matches;
}

/**
 * Fuzzy team matching to handle variations
 */
function findTeamMatch(input) {
  const normalized = input.toLowerCase().trim();

  for (const team of VALID_TEAMS) {
    if (team.toLowerCase() === normalized) {
      return team;
    }
  }

  for (const team of VALID_TEAMS) {
    const teamLower = team.toLowerCase();
    if (teamLower.includes(normalized) || normalized.includes(teamLower)) {
      return team;
    }
  }

  let closestTeam = null;
  let closestDistance = Infinity;

  for (const team of VALID_TEAMS) {
    const distance = levenshteinDistance(normalized, team.toLowerCase());
    if (distance < closestDistance && distance <= 3) {
      closestDistance = distance;
      closestTeam = team;
    }
  }

  return closestTeam;
}

/**
 * Calculate Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[b.length][a.length];
}

// ============================================================================
// ANALYSIS LAYER - Fixture analysis with historical blending
// ============================================================================

/**
 * Analyze a single fixture with historical context
 */
async function analyzeFixture(home, away, hOdds, dOdds, aOdds, idx) {
  // Base probability calculation
  const rawHProb = 1 / hOdds;
  const rawDProb = 1 / dOdds;
  const rawAProb = 1 / aOdds;
  const totalMargin = rawHProb + rawDProb + rawAProb;

  const hProb = rawHProb / totalMargin;
  const dProb = rawDProb / totalMargin;
  const aProb = rawAProb / totalMargin;

  const homeTier = TEAM_TIERS[home];
  const awayTier = TEAM_TIERS[away];
  const tierDifferential = awayTier - homeTier;

  // Fetch historical data
  const h2h = await getHeadToHead(home, away);
  const homeStats = await getTeamStats(home, 'home');
  const awayStats = await getTeamStats(away, 'away');

  // Base prediction logic (from Python)
  let prediction = "";
  let confidence = "";
  let dangerFlag = "NONE";

  if (hOdds <= 1.45 || aOdds <= 1.45) {
    prediction = hOdds <= 1.45 ? "1" : "2";
    confidence = "MEDIUM-LOW (High Upset Probability)";
    dangerFlag = "CRITICAL: Heavy favorite detected. High probability of upset or stalemate.";
  } else if (hOdds < dOdds && hOdds < aOdds && tierDifferential >= 1) {
    if (hOdds <= 1.85) {
      prediction = "1";
      confidence = "HIGH";
    } else {
      prediction = "1";
      confidence = "MEDIUM";
    }
  } else if (aOdds < dOdds && aOdds < hOdds && tierDifferential <= -1) {
    if (aOdds <= 1.85) {
      prediction = "2";
      confidence = "HIGH";
    } else {
      prediction = "2";
      confidence = "MEDIUM";
    }
  } else {
    prediction = "X";
    confidence = "MEDIUM";
    dangerFlag = "BALANCED MARKET: Draw profile detected.";
  }

  // Calculate historical confidence boost
  let historicalAccuracy = null;
  let h2hResult = null;
  if (h2h.length > 0) {
    const h2hCorrect = h2h.filter(m => {
      // Determine prediction for that match based on its odds
      const expectedResult = calculateExpectedResult(m.home === home ? m.homeOdds : m.awayOdds,
                                                      m.drawOdds, 
                                                      m.home === home ? m.awayOdds : m.homeOdds);
      return expectedResult === m.result;
    }).length;
    
    historicalAccuracy = (h2hCorrect / h2h.length * 100).toFixed(0);
    
    // Summarize H2H pattern
    const h2hHome = h2h.filter(m => m.home === home);
    const h2hHomeWins = h2hHome.filter(m => m.result === '1').length;
    const h2hHomeDraws = h2hHome.filter(m => m.result === 'X').length;
    h2hResult = {
      matches: h2h.length,
      homeWins: h2hHomeWins,
      draws: h2hHomeDraws,
      homeWinRate: h2hHome.length > 0 ? (h2hHomeWins / h2hHome.length * 100).toFixed(0) : 0
    };
  }

  return {
    idx,
    home,
    away,
    homeTier,
    awayTier,
    hProb: (hProb * 100).toFixed(1),
    dProb: (dProb * 100).toFixed(1),
    aProb: (aProb * 100).toFixed(1),
    totalMargin: ((totalMargin - 1) * 100).toFixed(2),
    prediction,
    confidence,
    dangerFlag,
    tierDifferential,
    homeOdds: hOdds,
    drawOdds: dOdds,
    awayOdds: aOdds,
    // Historical context
    h2h: h2hResult,
    homeStats,
    awayStats,
    historicalAccuracy
  };
}

/**
 * Calculate expected result based on odds
 */
function calculateExpectedResult(homeOdds, drawOdds, awayOdds) {
  if (homeOdds <= 1.45 || awayOdds <= 1.45) {
    return homeOdds <= 1.45 ? "1" : "2";
  } else if (homeOdds < drawOdds && homeOdds < awayOdds) {
    return "1";
  } else if (awayOdds < drawOdds && awayOdds < homeOdds) {
    return "2";
  }
  return "X";
}

// ============================================================================
// RENDERING LAYER - Display predictions and capture results
// ============================================================================

let currentAnalyses = [];

/**
 * Render match cards with result capture interface
 */
async function renderMatches(analyses) {
  const resultsPanel = $("results-panel");
  const resultsContent = $("results-content");

  if (!resultsPanel || !resultsContent) return;

  currentAnalyses = analyses;

  // Count predictions
  const predictionCounts = { 1: 0, X: 0, 2: 0 };
  analyses.forEach(a => predictionCounts[a.prediction]++);

  let html = `
    <div class="match-banner success-banner">
      <span>✓</span>
      <span>Successfully parsed ${analyses.length} matches. Predictions: ${predictionCounts[1]} Home Wins | ${predictionCounts.X} Draws | ${predictionCounts[2]} Away Wins</span>
    </div>

    <div class="data-controls">
      <button class="control-btn export-btn" onclick="exportMatchData()">📥 Export Data</button>
      <button class="control-btn copy-btn" onclick="copyToClipboard()">📋 Copy Data</button>
      <button class="control-btn import-btn" onclick="toggleImportPanel()">📤 Import Data</button>
      <button class="control-btn clear-btn" onclick="clearAllData()">🗑️ Clear History</button>
    </div>

    <div id="import-panel" class="import-panel hidden">
      <textarea id="import-textarea" placeholder="Paste JSON data here..." style="width: 100%; height: 150px; margin-bottom: 10px;"></textarea>
      <div style="display: flex; gap: 10px;">
        <button onclick="importFromText()">Import from Text</button>
        <button class="secondary-btn" onclick="toggleImportPanel()">Cancel</button>
      </div>
    </div>

    <div class="match-grid">
  `;

  // Render all match cards
  analyses.forEach((analysis, idx) => {
    const predBadgeClass = analysis.prediction === "1" ? "" : analysis.prediction === "X" ? "draw" : "away";
    const predLabel = analysis.prediction === "1" ? "HOME WIN" : analysis.prediction === "X" ? "DRAW" : "AWAY WIN";

    let h2hHTML = '';
    if (analysis.h2h) {
      h2hHTML = `
        <div class="h2h-section">
          <strong>Head-to-Head (${analysis.h2h.matches} matches)</strong>
          <div class="h2h-stats">
            <span>${analysis.h2h.homeWins}W</span>
            <span>${analysis.h2h.draws}D</span>
            <span>${analysis.h2h.homeWinRate}%</span>
          </div>
        </div>
      `;
    }

    let statsHTML = '';
    if (analysis.homeStats && analysis.awayStats) {
      statsHTML = `
        <div class="team-stats">
          <div class="stat-col">
            <small>${analysis.home} (Home)</small>
            <div>W: ${analysis.homeStats.wins} D: ${analysis.homeStats.draws} L: ${analysis.homeStats.losses}</div>
            <div class="stat-detail">Avg: ${analysis.homeStats.avgGoalsFor} GF | ${analysis.homeStats.avgGoalsAgainst} GA</div>
          </div>
          <div class="stat-col">
            <small>${analysis.away} (Away)</small>
            <div>W: ${analysis.awayStats.wins} D: ${analysis.awayStats.draws} L: ${analysis.awayStats.losses}</div>
            <div class="stat-detail">Avg: ${analysis.awayStats.avgGoalsFor} GF | ${analysis.awayStats.avgGoalsAgainst} GA</div>
          </div>
        </div>
      `;
    }

    html += `
      <div class="match-card" id="card-${idx}">
        <div class="match-header">
          <span class="match-title">${analysis.home} vs ${analysis.away}</span>
          <span class="prediction-badge ${predBadgeClass}">${predLabel}</span>
        </div>

        <div class="odds-row">
          <div class="odds-cell">
            <span class="odds-label">Home Win</span>
            <span class="odds-value">${analysis.hProb}%</span>
            <span class="odds-odds">${analysis.homeOdds.toFixed(2)}</span>
          </div>
          <div class="odds-cell">
            <span class="odds-label">Draw</span>
            <span class="odds-value">${analysis.dProb}%</span>
            <span class="odds-odds">${analysis.drawOdds.toFixed(2)}</span>
          </div>
          <div class="odds-cell">
            <span class="odds-label">Away Win</span>
            <span class="odds-value">${analysis.aProb}%</span>
            <span class="odds-odds">${analysis.awayOdds.toFixed(2)}</span>
          </div>
        </div>

        <div class="confidence-text">
          <strong>Confidence:</strong> ${analysis.confidence}
          ${analysis.dangerFlag !== "NONE" ? `<br><strong style="color: #fca5a5;">⚠ ${analysis.dangerFlag}</strong>` : ""}
        </div>

        ${h2hHTML}
        ${statsHTML}

        <div class="result-section">
          <div class="result-title">Match Result</div>
          <div class="result-inputs">
            <select id="home-goals-${idx}" class="goal-select">
              <option value="">Home Goals</option>
              ${Array.from({length: 10}, (_, i) => `<option value="${i}">${i}</option>`)}
            </select>
            <span class="vs-text">vs</span>
            <select id="away-goals-${idx}" class="goal-select">
              <option value="">Away Goals</option>
              ${Array.from({length: 10}, (_, i) => `<option value="${i}">${i}</option>`)}
            </select>
          </div>
          <button class="save-result-btn" onclick="captureResult(${idx})">Save Result</button>
        </div>
      </div>
    `;
  });

  html += `</div>`;

  // Summary stats
  const totalMarginAvg = analyses.reduce((sum, a) => sum + parseFloat(a.totalMargin), 0) / analyses.length;

  html += `
    <div class="summary-stats">
      <div class="stat-row">
        <span class="stat-label">Total Matches</span>
        <span class="stat-value">${analyses.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Home Win Predictions</span>
        <span class="stat-value">${predictionCounts[1]}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Draw Predictions</span>
        <span class="stat-value">${predictionCounts.X}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Away Win Predictions</span>
        <span class="stat-value">${predictionCounts[2]}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Avg Bookie Margin</span>
        <span class="stat-value">${totalMarginAvg.toFixed(2)}%</span>
      </div>
    </div>
  `;

  resultsContent.innerHTML = html;
  resultsPanel.classList.remove("hidden");
}

/**
 * Capture match result and save to database
 */
async function captureResult(idx) {
  const analysis = currentAnalyses[idx];
  const homeGoalsSelect = $(`home-goals-${idx}`);
  const awayGoalsSelect = $(`away-goals-${idx}`);

  if (!homeGoalsSelect || !awayGoalsSelect) {
    showNotification('Result inputs not found', 'error');
    return;
  }

  const homeGoals = parseInt(homeGoalsSelect.value);
  const awayGoals = parseInt(awayGoalsSelect.value);

  if (isNaN(homeGoals) || isNaN(awayGoals)) {
    showNotification('Please select both home and away goals', 'error');
    return;
  }

  const result = homeGoals > awayGoals ? '1' : homeGoals < awayGoals ? '2' : 'X';

  const matchRecord = {
    home: analysis.home,
    away: analysis.away,
    homeTier: analysis.homeTier,
    awayTier: analysis.awayTier,
    homeOdds: analysis.homeOdds,
    drawOdds: analysis.drawOdds,
    awayOdds: analysis.awayOdds,
    prediction: analysis.prediction,
    actualHomeGoals: homeGoals,
    actualAwayGoals: awayGoals,
    result,
    totalGoals: homeGoals + awayGoals,
    timestamp: new Date().toISOString(),
    matchup: `${analysis.home} vs ${analysis.away}`
  };

  try {
    await saveMatch(matchRecord);
    homeGoalsSelect.disabled = true;
    awayGoalsSelect.disabled = true;
    $(`card-${idx}`).classList.add('result-saved');
    showNotification(`Result saved: ${analysis.home} ${homeGoals}-${awayGoals} ${analysis.away}`, 'success');
  } catch (error) {
    showNotification('Error saving result: ' + error.message, 'error');
  }
}

/**
 * Show/hide import panel
 */
function toggleImportPanel() {
  const panel = $('import-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

/**
 * Import data from text input
 */
async function importFromText() {
  const textarea = $('import-textarea');
  if (!textarea || !textarea.value.trim()) {
    showNotification('Please paste JSON data', 'error');
    return;
  }

  const success = await importMatchData(textarea.value);
  if (success) {
    textarea.value = '';
    toggleImportPanel();
  }
}

/**
 * Show error banner
 */
function showError(message) {
  const resultsPanel = $("results-panel");
  const resultsContent = $("results-content");

  if (!resultsPanel || !resultsContent) return;

  resultsContent.innerHTML = `
    <div class="match-banner error-banner">
      <span>⚠</span>
      <span>${message}</span>
    </div>
  `;

  resultsPanel.classList.remove("hidden");
}

/**
 * Show notification toast
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.classList.add('show'), 10);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

/**
 * Main parse and analyze function
 */
async function processInput() {
  const input = $("data-input");
  if (!input) return;

  const rawData = input.value;

  try {
    const matches = parseGameweekData(rawData);
    const analyses = await Promise.all(
      matches.map((m, idx) =>
        analyzeFixture(m.home, m.away, m.homeOdds, m.drawOdds, m.awayOdds, idx)
      )
    );
    await renderMatches(analyses);
  } catch (error) {
    showError(error.message);
  }
}

/**
 * Initialize event listeners
 */
window.addEventListener("DOMContentLoaded", async () => {
  const parseBtn = $("parse-btn");
  const clearBtn = $("clear-btn");
  const dataInput = $("data-input");

  if (parseBtn) {
    parseBtn.addEventListener("click", processInput);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (dataInput) dataInput.value = "";
      const resultsPanel = $("results-panel");
      if (resultsPanel) resultsPanel.classList.add("hidden");
    });
  }

  if (dataInput) {
    dataInput.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        processInput();
      }
    });
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      console.log('Service Worker registered');
    } catch (error) {
      console.log('Service Worker registration failed:', error);
    }
  }
});
