/**
 * VFL Unified Hybrid Predictive & Self-Learning Mathematical ML Engine
 * Fuses Python contextual logic with JS client-side IndexedDB history.
 * Features: Dynamic Elo, Odds Binning, Time-Decay Weighting, Trap Recognition,
 * Vig Anomaly Detection, Poisson xG Matrix, Kelly Bankroll Sizing & O/U 2.5 Modeling.
 */
(() => {
  'use strict';

  const TEAM_TIERS = {
    "London Blues": 1, "Liverpool": 1, "Manchester Blue": 1, "London Reds": 1,
    "Manchester Reds": 2, "Aston V": 2, "Newcastle": 2, "Tottenham": 2, "Everton": 2,
    "Leicester": 3, "West Brom": 3, "Wolves": 3, "Palace": 3, "Brighton": 3, "West Ham": 3,
    "Leeds": 4, "Burnley": 4, "Fulham": 4, "Southampton": 4, "Sheffield U": 4,
  };

  const VALID_TEAMS = Object.keys(TEAM_TIERS).sort();

  const DB_CONFIG = {
    name: 'VFL_MatchHistory',
    version: 2,
    store: 'matches'
  };

  const $ = (id) => document.getElementById(id);
  let currentAnalyses = [];

  // Helper Poisson probability calculator
  function poissonProb(lambda, k) {
    let factorial = 1;
    for (let i = 1; i <= k; i++) factorial *= i;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
  }

  // Database Access Wrappers
  async function getAllMatches() {
    if (window.VFLHistory && typeof window.VFLHistory.readLocalMatches === 'function') {
      return await window.VFLHistory.readLocalMatches();
    }
    return [];
  }

  async function saveMatch(matchRecord) {
    if (window.VFLHistory && typeof window.VFLHistory.saveLocalMatch === 'function') {
      return await window.VFLHistory.saveLocalMatch(matchRecord);
    }
  }

  async function clearAllMatches() {
    if (window.VFLHistory && typeof window.VFLHistory.clearLocalHistory === 'function') {
      return await window.VFLHistory.clearLocalHistory();
    }
  }

  /**
   * INTELLIGENT BULK RESULTS PARSER
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

    const line0 = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    const line3 = lines[i + 3];

    const team0 = findTeamMatch(line0);
    const isGoal1 = isGoalScore(line1);
    const isGoal2 = isGoalScore(line2);
    const team3 = findTeamMatch(line3);

    // Pattern 1: Team / HomeGoals / AwayGoals / Team
    if (team0 && isGoal1 && isGoal2 && team3 && team0 !== team3) {
      const homeGoals = parseInt(line1, 10);
      const awayGoals = parseInt(line2, 10);
      const result = homeGoals > awayGoals ? '1' : homeGoals === awayGoals ? 'X' : '2';
      matches.push({
        home: team0,
        away: team3,
        actualHomeGoals: homeGoals,
        actualAwayGoals: awayGoals,
        result: result,
        timestamp: new Date().toISOString(),
        homeOdds: null,
        drawOdds: null,
        awayOdds: null,
        oddsCombo: null
      });
      i += 4;
      continue;
    }

    // Pattern 2: Team / Team / HomeGoals / AwayGoals (standard)
    const team1 = findTeamMatch(line1);
    if (team0 && team1 && team0 !== team1 && isGoal2 && isGoalScore(line3)) {
      const homeGoals = parseInt(line2, 10);
      const awayGoals = parseInt(line3, 10);
      const result = homeGoals > awayGoals ? '1' : homeGoals === awayGoals ? 'X' : '2';
      matches.push({
        home: team0,
        away: team1,
        actualHomeGoals: homeGoals,
        actualAwayGoals: awayGoals,
        result: result,
        timestamp: new Date().toISOString(),
        homeOdds: null,
        drawOdds: null,
        awayOdds: null,
        oddsCombo: null
      });
      i += 4;
      continue;
    }
    i++;
  }

  if (matches.length === 0) {
    throw new Error('No valid match results found. Supported formats:\n1. Home\nAway\nHomeGoals\nAwayGoals\n\nOR\n\n2. Home\nHomeGoals\nAwayGoals\nAway');
  }
  return matches;
}


  function isGoalScore(str) {
    const num = parseInt(str, 10);
    return !isNaN(num) && num >= 0 && num <= 20;
  }

  /**
   * GAMEWEEK ODDS PARSER
   */
  function parseGameweekData(rawText) {
    if (!rawText || typeof rawText !== 'string') throw new Error('No data provided');

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const matches = [];
    let i = 0;

    while (i < lines.length) {
      if (i + 1 >= lines.length) { i++; continue; }

      const homeTeam = findTeamMatch(lines[i]);
      const awayTeam = findTeamMatch(lines[i + 1]);

      if (homeTeam && awayTeam && homeTeam !== awayTeam) {
        let scanIdx = i + 2;
        let collectedOdds = [];

        while (collectedOdds.length < 3 && scanIdx < lines.length) {
          const currentLine = lines[scanIdx];
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
   * HYBRID SELF-LEARNING PREDICTIVE ENGINE (analyzeFixtureML)
   * Enhanced with Global Entropy Suppression, Rolling PRNG Correction, and Value Overlays.
   */
  async function analyzeFixtureML(home, away, hOdds, dOdds, aOdds, idx) {
    const historicalData = await getAllMatches();
    
    // 1. Raw Implied Probabilities & Vig Margin
    const rawHProb = 1 / hOdds;
    const rawDProb = 1 / dOdds;
    const rawAProb = 1 / aOdds;
    const margin = rawHProb + rawDProb + rawAProb;
    const currentCombo = `${hOdds.toFixed(2)}|${dOdds.toFixed(2)}|${aOdds.toFixed(2)}`;

    // 2. Vig Anomaly Detection
    let rollingMarginSum = 0;
    let oddsMatchesCount = 0;
    historicalData.forEach(m => {
      if (m.homeOdds > 1.0 && m.drawOdds > 1.0 && m.awayOdds > 1.0) {
        rollingMarginSum += (1 / m.homeOdds + 1 / m.drawOdds + 1 / m.awayOdds);
        oddsMatchesCount++;
      }
    });
    const avgMargin = oddsMatchesCount > 0 ? (rollingMarginSum / oddsMatchesCount) : 1.08;
    const marginAnomaly = margin - avgMargin > 0.035;

    // 3. Dynamic Elo Ratings & Tier Differential
    const eloRatings = window.VFLHistory ? window.VFLHistory.calculateEloRatings(historicalData) : {};
    const homeElo = eloRatings[home] || 1500;
    const awayElo = eloRatings[away] || 1500;
    const eloDiff = homeElo - awayElo;

    const baseTierHome = TEAM_TIERS[home] || 3;
    const baseTierAway = TEAM_TIERS[away] || 3;
    const tierDifferential = baseTierAway - baseTierHome;

    // 4. Head-To-Head (H2H) Context
    const h2h = window.VFLHistory ? window.VFLHistory.getHeadToHead(historicalData, home, away) : { total: 0, homeWins: 0, awayWins: 0, draws: 0, recent: [] };

    // 5. Odds Tolerance (Binning ±0.05) & Time-Decay Exponential Weighting
    let binnedWins = { '1': 0, 'X': 0, '2': 0, totalWeighted: 0, count: 0 };
    let singleOddsWins = { '1': 0, 'X': 0, '2': 0, homeCount: 0, drawCount: 0, awayCount: 0 };

    const nowMs = Date.now();
    const DECAY_LAMBDA = 0.03; // Time decay factor

    historicalData.forEach(match => {
      const matchTime = new Date(match.timestamp || Date.now()).getTime();
      const ageDays = Math.max(0, (nowMs - matchTime) / (1000 * 60 * 60 * 24));
      const timeWeight = Math.exp(-DECAY_LAMBDA * ageDays);

      // Single Odds Tolerance
      if (match.homeOdds > 0) {
        if (Math.abs(match.homeOdds - hOdds) <= 0.05) {
          singleOddsWins.homeCount += timeWeight;
          if (match.result === '1') singleOddsWins['1'] += timeWeight;
        }
        if (Math.abs(match.drawOdds - dOdds) <= 0.05) {
          singleOddsWins.drawCount += timeWeight;
          if (match.result === 'X') singleOddsWins['X'] += timeWeight;
        }
        if (Math.abs(match.awayOdds - aOdds) <= 0.05) {
          singleOddsWins.awayCount += timeWeight;
          if (match.result === '2') singleOddsWins['2'] += timeWeight;
        }

        // Binned Odds Combination Match
        if (Math.abs(match.homeOdds - hOdds) <= 0.05 &&
            Math.abs(match.drawOdds - dOdds) <= 0.05 &&
            Math.abs(match.awayOdds - aOdds) <= 0.05) {
          binnedWins.count++;
          binnedWins.totalWeighted += timeWeight;
          binnedWins[match.result] += timeWeight;
        }
      }
    });

    // 6. Empirical Win Ranks
    let dynamicHomeRank = singleOddsWins.homeCount > 0 ? (singleOddsWins['1'] / singleOddsWins.homeCount) : rawHProb;
    let dynamicDrawRank = singleOddsWins.drawCount > 0 ? (singleOddsWins['X'] / singleOddsWins.drawCount) : rawDProb;
    let dynamicAwayRank = singleOddsWins.awayCount > 0 ? (singleOddsWins['2'] / singleOddsWins.awayCount) : rawAProb;

    let binnedHomeRank = binnedWins.totalWeighted > 0 ? (binnedWins['1'] / binnedWins.totalWeighted) : dynamicHomeRank;
    let binnedDrawRank = binnedWins.totalWeighted > 0 ? (binnedWins['X'] / binnedWins.totalWeighted) : dynamicDrawRank;
    let binnedAwayRank = binnedWins.totalWeighted > 0 ? (binnedWins['2'] / binnedWins.totalWeighted) : dynamicAwayRank;

    // 7. PRNG Mean Reversion & Streak Adjustments
    const homeForm = window.VFLHistory ? window.VFLHistory.getTeamFormAndStreaks(historicalData, home) : { streakType: 'N/A', streakCount: 0 };
    const awayForm = window.VFLHistory ? window.VFLHistory.getTeamFormAndStreaks(historicalData, away) : { streakType: 'N/A', streakCount: 0 };

    let meanReversionShiftH = 0;
    let meanReversionShiftA = 0;
    if (homeForm.streakType === 'L' && homeForm.streakCount >= 4) meanReversionShiftH += 0.05;
    if (awayForm.streakType === 'L' && awayForm.streakCount >= 4) meanReversionShiftA += 0.05;

    // 8. Expected Goals (xG) & Poisson Score Distribution
    const xg = window.VFLHistory ? window.VFLHistory.calculatePoissonXG(historicalData, home, away) : { lambdaHome: 1.35, lambdaAway: 1.15 };
    let scoreMatrix = [];
    let probOver25 = 0;
    let probUnder25 = 0;

    for (let hG = 0; hG <= 5; hG++) {
      for (let aG = 0; aG <= 5; aG++) {
        const p = poissonProb(xg.lambdaHome, hG) * poissonProb(xg.lambdaAway, aG);
        scoreMatrix.push({ score: `${hG}-${aG}`, hG, aG, prob: p });
        if (hG + aG > 2.5) probOver25 += p;
        else probUnder25 += p;
      }
    }

    // =========================================================================
    // ENHANCEMENT: HIGH-ORDER PRNG STATE TRANSITION HOOKS
    // =========================================================================
    const leagueMatches = [...historicalData].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    const totalHistoryCount = leagueMatches.length;

    let recentLeagueGoalsSum = 0;
    const SLIDING_WINDOW_SIZE = 10;
    const recentWindowMatches = leagueMatches.slice(-SLIDING_WINDOW_SIZE);

    recentWindowMatches.forEach(m => {
      recentLeagueGoalsSum += (Number(m.actualHomeGoals ?? 0) + Number(m.actualAwayGoals ?? 0));
    });

    const recentLeagueGPG = recentWindowMatches.length > 0 ? (recentLeagueGoalsSum / recentWindowMatches.length) : 2.5;
    const baseHistoricalGPG = totalHistoryCount > 0 
      ? (leagueMatches.reduce((acc, m) => acc + Number(m.actualHomeGoals ?? 0) + Number(m.actualAwayGoals ?? 0), 0) / totalHistoryCount) 
      : 2.5;

    const globalEntropySuppression = recentLeagueGPG - baseHistoricalGPG;

    if (globalEntropySuppression > 0.45) {
      probOver25 *= Math.max(0.70, 1.0 - (globalEntropySuppression * 0.5));
      probUnder25 = 1.0 - probOver25;
    } else if (globalEntropySuppression < -0.45) {
      probOver25 = Math.min(0.95, probOver25 * (1.0 + Math.abs(globalEntropySuppression)));
      probUnder25 = 1.0 - probOver25;
    }

    scoreMatrix.sort((a, b) => b.prob - a.prob);
    const topScores = scoreMatrix.slice(0, 3).map(s => `${s.score} (${(s.prob * 100).toFixed(1)}%)`);

    // 9. Blended Machine Learning Feature Weights
    let weightH = (rawHProb * 0.25) + (dynamicHomeRank * 0.30) + (binnedHomeRank * 0.25) + (eloDiff > 0 ? 0.05 : 0) + meanReversionShiftH;
    let weightX = (rawDProb * 0.25) + (dynamicDrawRank * 0.30) + (binnedDrawRank * 0.25);
    let weightA = (rawAProb * 0.25) + (dynamicAwayRank * 0.30) + (binnedAwayRank * 0.25) + (eloDiff < 0 ? 0.05 : 0) + meanReversionShiftA;

    if (marginAnomaly && hOdds > 2.20 && aOdds > 2.20) {
      weightX += 0.085; 
    }

    const sumW = weightH + weightX + weightA;
    let finalHProb = weightH / sumW;
    let finalDProb = weightX / sumW;
    let finalAProb = weightA / sumW;

    // 10. Heavy Favorite Trap Pattern Recognition
    let isTrap = false;
    let trapNotice = "";
    let templates = [];

    if (hOdds <= 1.45 || aOdds <= 1.45) {
      isTrap = true;
      const favorite = hOdds <= 1.45 ? home : away;
      trapNotice = `CRITICAL TRAP DETECTED: Heavy favorite market on ${favorite}. Upset / 0-0 / 1-1 highly probable.`;
      templates = ["0-0_A", "1-1_C", "1-0_B"];
      finalDProb += 0.10; 
      const newSum = finalHProb + finalDProb + finalAProb;
      finalHProb /= newSum;
      finalDProb /= newSum;
      finalAProb /= newSum;
    } else if (hOdds < dOdds && hOdds < aOdds && tierDifferential >= 1) {
      templates = ["2-0_A", "3-1_A"];
    } else if (aOdds < dOdds && aOdds < hOdds && tierDifferential <= -1) {
      templates = ["1-2_A", "1-3_B"];
    } else {
      templates = ["1-1_A", "0-0_A"];
    }

    // Determine Prediction State
    let prediction = '1';
    let maxWeight = finalHProb;
    if (finalDProb > maxWeight) { prediction = 'X'; maxWeight = finalDProb; }
    if (finalAProb > maxWeight) { prediction = '2'; maxWeight = finalAProb; }

    const ouPrediction = probOver25 >= 0.52 ? `OVER 2.5 (${(probOver25 * 100).toFixed(0)}%)` : `UNDER 2.5 (${(probUnder25 * 100).toFixed(0)}%)`;

    // 11. Kelly Criterion Bet Sizing Formula
    let chosenOdds = prediction === '1' ? hOdds : prediction === 'X' ? dOdds : aOdds;
    let chosenProb = prediction === '1' ? finalHProb : prediction === 'X' ? finalDProb : finalAProb;
    let b = chosenOdds - 1;
    let q = 1 - chosenProb;
    let kellyFraction = (chosenProb * b - q) / b;
    let kellyStakePct = kellyFraction > 0 ? Math.min(10.0, (kellyFraction * 0.25 * 100)).toFixed(1) : "0.0";

    // Value Edge Metric
    let edge = (chosenProb * chosenOdds) - 1;
    let rrClassification = "POOR (Negative Value Line)";
    let rrColor = "#fca5a5";
    if (edge > 0.15) {
      rrClassification = "EXCELLENT (High Empirical Value)";
      rrColor = "#86efac";
    } else if (edge > 0.02) {
      rrClassification = "GOOD (Fair Market Price)";
      rrColor = "#93c5fd";
    }

    // Signal Confidence Determination
    let confidence = 'BOOTSTRAP MODE (Low Local Sample Base)';
    if (historicalData.length > 15) {
      if (h2h.total >= 2 && ((prediction === '1' && h2h.homeWins / h2h.total >= 0.6) || (prediction === '2' && h2h.awayWins / h2h.total >= 0.6) || (prediction === 'X' && h2h.draws / h2h.total >= 0.6))) {
        confidence = 'VERY HIGH CONVICTION (H2H Backed)';
      } else if (isTrap) {
        confidence = 'MEDIUM-LOW (High Upset Trap)';
      } else if (maxWeight > 0.55) {
        confidence = 'HIGH CONVICTION';
      } else if (maxWeight > 0.40) {
        confidence = 'MEDIUM SIGNAL';
      } else {
        confidence = 'SENSITIVE VARIANCE';
      }
    }

    return {
      idx, home, away,
      hOdds, dOdds, aOdds,
      hProb: (finalHProb * 100).toFixed(1),
      dProb: (finalDProb * 100).toFixed(1),
      aProb: (finalAProb * 100).toFixed(1),
      totalMargin: ((margin - 1) * 100).toFixed(2),
      prediction, confidence, ouPrediction,
      oddsCombo: currentCombo,
      rrClassification, rrColor,
      edge: (edge * 100).toFixed(1),
      kellyStakePct,
      sampleCount: binnedWins.count,
      historicalHomeWinPct: (dynamicHomeRank * 100).toFixed(0),
      historicalDrawWinPct: (dynamicDrawRank * 100).toFixed(0),
      historicalAwayWinPct: (dynamicAwayRank * 100).toFixed(0),
      homeElo, awayElo,
      h2hSummary: h2h.total > 0 ? `${h2h.homeWins}H-${h2h.draws}D-${h2h.awayWins}A (Avg ${h2h.avgHomeGoals}-${h2h.avgAwayGoals})` : 'No Prior Meetings',
      topScores: topScores.join(', '),
      templates: templates.join(', '),
      trapNotice, marginAnomaly
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
      if (window.VFLHistory && typeof window.VFLHistory.importHistoryFromJson === 'function') {
        const imported = await window.VFLHistory.importHistoryFromJson(jsonText);
        showNotification(`Imported ${imported} new matches`, 'success');
        return imported;
      }
      throw new Error('History manager bridge not initialized');
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
  // INTERFACE VISUAL RENDERER ENGINE
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
            <div class="badge-container">
              <span class="prediction-badge ${predBadgeClass}">${predLabel}</span>
              <span class="prediction-badge ou">${analysis.ouPrediction}</span>
            </div>
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
            <div><strong>Dynamic Elo Ratings:</strong> ${analysis.home} (${analysis.homeElo}) vs ${analysis.away} (${analysis.awayElo})</div>
            <div><strong>Head-To-Head:</strong> ${analysis.h2hSummary}</div>
            <div><strong>Binned Odds Samples:</strong> ${analysis.sampleCount} recorded matches</div>
            <div style="color:${analysis.rrColor}"><strong>R:R Value & Edge:</strong> ${analysis.rrClassification} (${analysis.edge}% Edge)</div>
            <div style="color:#86efac; margin-top:3px;"><strong>Kelly Stake Sizing:</strong> Recommend ${analysis.kellyStakePct}% Bankroll</div>
            <div style="color:#bfdbfe; margin-top:3px;"><strong>Poisson Top Scores:</strong> ${analysis.topScores}</div>
            <div style="color:#94a3b8; margin-top:3px;"><strong>Timeline Templates:</strong> ${analysis.templates}</div>
            ${analysis.trapNotice ? `<div style="color:#fca5a5; margin-top:4px; font-weight:600;">⚠️ ${analysis.trapNotice}</div>` : ''}
            ${analysis.marginAnomaly ? `<div style="color:#fde047; margin-top:4px; font-weight:600;">⚠️ Vig Anomaly: Extra Profit Margin / Risk Suppression Detected (${analysis.totalMargin}%)</div>` : ''}
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
  // RESULT LOGGING PROCESSOR
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
  // INPUT DATA PROCESSOR
  // =========================================================================
  async function processInput() {
    const inputField = $('data-input');
    if (!inputField || !inputField.value.trim()) {
      showNotification('Please paste data first', 'error');
      return;
    }

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
  if (!inputField || !inputField.value.trim()) {
    showNotification('Please paste data first', 'error');
    return;
  }

  try {
    const results = parseBulkResults(inputField.value);
    const existingMatches = await getAllMatches();
    let saved = 0;

    for (const result of results) {
      // 1. Look for pre-existing odds in memory from active analyses
      const activeMatch = currentAnalyses.find(
        a => a.home === result.home && a.away === result.away
      );

      // 2. Look for existing saved record in database for this matchup
      const historicalMatch = existingMatches.find(
        m => m.home === result.home && m.away === result.away && m.homeOdds > 1.0
      );

      // 3. Resolve actual odds from active session or historical record
      const hOdds = activeMatch?.hOdds || historicalMatch?.homeOdds || null;
      const dOdds = activeMatch?.dOdds || historicalMatch?.drawOdds || null;
      const aOdds = activeMatch?.aOdds || historicalMatch?.awayOdds || null;

      const matchRecord = {
        ...result,
        homeOdds: hOdds,
        drawOdds: dOdds,
        awayOdds: aOdds,
        oddsCombo: hOdds && dOdds && aOdds ? `${hOdds.toFixed(2)}|${dOdds.toFixed(2)}|${aOdds.toFixed(2)}` : null
      };

      await saveMatch(matchRecord);
      saved++;
    }

    inputField.value = '';
    showNotification(`✓ Bulk imported ${saved} match results to history`, 'success');
  } catch (err) {
    showNotification(err.message, 'error');
  }
}


  function clearInput() {
    const inputField = $('data-input');
    if (inputField) {
      inputField.value = '';
      showNotification('Input cleared', 'info');
    }
  }

  // Global API Exposure
  window.VFLBrain = {
    processInput,
    processBulkResults,
    captureResult,
    exportHistory,
    copyHistoryToClipboard,
    importHistoryFromJson,
    handleFileUpload,
    showNotification,
    clearAllMatches,
    clearInput,
    evaluateSystemState
  };
  
  // =========================================================================
  // ADD-ON ENGINE: PRNG SYSTEM STATE VARIANCE MONITOR
  // =========================================================================
  async function evaluateSystemState() {
    const historicalData = await getAllMatches();
    if (historicalData.length < 10) return null;

    const leagueMatches = [...historicalData].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    
    let globalGoalsSum = 0;
    let recentGoalsSum = 0;
    
    leagueMatches.forEach(m => globalGoalsSum += (Number(m.actualHomeGoals ?? 0) + Number(m.actualAwayGoals ?? 0)));
    const globalAvg = globalGoalsSum / leagueMatches.length;

    const recentMatches = leagueMatches.slice(-10);
    recentMatches.forEach(m => recentGoalsSum += (Number(m.actualHomeGoals ?? 0) + Number(m.actualAwayGoals ?? 0)));
    const recentAvg = recentGoalsSum / recentMatches.length;

    const netVariance = recentAvg - globalAvg;
    let actionState = "STABLE PRNG ENGINE MATRIX";
    let adviceColor = "#93c5fd";

    if (netVariance > 0.45) {
      actionState = "CRITICAL HIGH-GOAL CORRECTION WAVE EXPECTED (Target Under 2.5 Selections)";
      adviceColor = "#fca5a5";
    } else if (netVariance < -0.45) {
      actionState = "CRITICAL DRY-RUN CORRECTION WAVE EXPECTED (Target Over 2.5 Selections)";
      adviceColor = "#86efac";
    }

    console.log(`%c[PRNG WAVE MONITOR] State: ${actionState} | Net: ${netVariance.toFixed(2)}`, `color: ${adviceColor}; font-weight: bold;`);
    return { netVariance, actionState, adviceColor };
  }

  window.addEventListener('DOMContentLoaded', () => {
    console.log('VFL Unified Hybrid Engine Initialized');

    const parseBtn = $('parse-btn');
    if (parseBtn) parseBtn.addEventListener('click', () => processInput());

    const bulkBtn = $('bulk-btn');
    if (bulkBtn) bulkBtn.addEventListener('click', () => processBulkResults());

    const clearBtn = $('clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => clearInput());

    const exportBtn = $('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => exportHistory());

    const copyBtn = $('copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => copyHistoryToClipboard());

    const importToggleBtn = $('import-toggle-btn');
    const importPanel = $('import-panel');
    if (importToggleBtn && importPanel) {
      importToggleBtn.addEventListener('click', () => importPanel.classList.toggle('hidden'));
    }

    const pasteImportBtn = $('paste-import-btn');
    if (pasteImportBtn) {
      pasteImportBtn.addEventListener('click', async () => {
        const textarea = $('import-textarea');
        if (textarea && textarea.value.trim()) {
          try {
            await importHistoryFromJson(textarea.value);
            textarea.value = '';
            if (importPanel) importPanel.classList.add('hidden');
          } catch (err) {
            showNotification(`Import error: ${err.message}`, 'error');
          }
        } else {
          showNotification('Please paste JSON data first', 'error');
        }
      });
    }

    const importCancelBtn = $('import-cancel-btn');
    if (importCancelBtn && importPanel) {
      importCancelBtn.addEventListener('click', () => {
        importPanel.classList.add('hidden');
        const textarea = $('import-textarea');
        if (textarea) textarea.value = '';
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
  });
})();
