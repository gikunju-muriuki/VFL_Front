/**
 * Unified Hybrid VFL Predictive Engine
 * Combines Poisson xG modeling, Dynamic Elo, Fuzzy Odds Clusters, Python Risk/Trap Context, and Kelly Criterion.
 */

(function () {
  'use strict';

  // --- Mathematical Utilities ---

  const MathEngine = {
    factorial(n) {
      if (n <= 1) return 1;
      let res = 1;
      for (let i = 2; i <= n; i++) res *= i;
      return res;
    },

    poissonProb(k, lambda) {
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / this.factorial(k);
    },

    calculatexG(home, away, historicalMatches) {
      let hScored = 0, hConceded = 0, hGames = 0;
      let aScored = 0, aConceded = 0, aGames = 0;
      let totalGoals = 0, totalGames = 0;

      historicalMatches.forEach(m => {
        const hG = Number(m.actualHomeGoals || 0);
        const aG = Number(m.actualAwayGoals || 0);
        totalGoals += (hG + aG);
        totalGames += 1;

        if (m.home === home) { hScored += hG; hConceded += aG; hGames++; }
        if (m.away === away) { aScored += aG; aConceded += hG; aGames++; }
      });

      const avgLeagueGoalsPerGame = totalGames > 0 ? Math.max(1.0, totalGoals / (totalGames * 2)) : 1.35;

      const homeAttack = hGames > 0 ? (hScored / hGames) / avgLeagueGoalsPerGame : 1.1;
      const homeDefense = hGames > 0 ? (hConceded / hGames) / avgLeagueGoalsPerGame : 1.0;
      const awayAttack = aGames > 0 ? (aScored / aGames) / avgLeagueGoalsPerGame : 0.9;
      const awayDefense = aGames > 0 ? (aConceded / aGames) / avgLeagueGoalsPerGame : 1.1;

      const lambdaHome = Math.max(0.2, Math.min(homeAttack * awayDefense * avgLeagueGoalsPerGame, 4.5));
      const lambdaAway = Math.max(0.2, Math.min(awayAttack * homeDefense * avgLeagueGoalsPerGame, 4.5));

      return { lambdaHome, lambdaAway };
    },

    generateScoreMatrix(lambdaHome, lambdaAway, maxGoals = 5) {
      const matrix = [];
      let probOver25 = 0;
      let probUnder25 = 0;

      for (let h = 0; h <= maxGoals; h++) {
        matrix[h] = [];
        const pH = this.poissonProb(h, lambdaHome);
        for (let a = 0; a <= maxGoals; a++) {
          const pA = this.poissonProb(a, lambdaAway);
          const prob = pH * pA;
          matrix[h][a] = prob;

          if (h + a > 2.5) probOver25 += prob;
          else probUnder25 += prob;
        }
      }

      return { matrix, probOver25, probUnder25 };
    },

    calculateKelly(probability, decimalOdds, bankrollFraction = 0.25) {
      const b = decimalOdds - 1;
      const p = probability;
      const q = 1 - p;

      if (b <= 0 || p <= 0) return { rawKelly: 0, recommendedStakePct: 0 };

      const fStar = (p * b - q) / b;
      const recommendedStakePct = Math.max(0, fStar * bankrollFraction);

      return {
        rawKelly: (fStar * 100).toFixed(2),
        recommendedStakePct: (recommendedStakePct * 100).toFixed(2)
      };
    }
  };

  // --- Python Trap & H2H Context Logic ---

  function evaluatePythonContext(home, away, hOdds, dOdds, aOdds, h2hRecords) {
    let riskFlag = "NONE";
    let confidenceOverride = null;
    let forceDrawSignal = false;
    let matchTemplates = [];

    // Favorite trap detection
    if (hOdds <= 1.45 || aOdds <= 1.45) {
      const fav = hOdds <= 1.45 ? home : away;
      riskFlag = `⚠️ Heavy-Favorite Trap Detected on ${fav} (${Math.min(hOdds, aOdds).toFixed(2)})! High 0-0/1-1 Risk.`;
      forceDrawSignal = true;
      matchTemplates = ["0-0_A", "1-1_C", "1-0_B"];
    } else if (hOdds < dOdds && hOdds < aOdds) {
      matchTemplates = ["2-0_A", "3-1_A", "2-1_B"];
    } else if (aOdds < dOdds && aOdds < hOdds) {
      matchTemplates = ["1-2_A", "1-3_B", "0-2_A"];
    } else {
      riskFlag = "DRAW MATRIX: Compressed Margin Under 2.5";
      matchTemplates = ["1-1_A", "0-0_A"];
    }

    // Head-to-Head analysis
    if (h2hRecords && h2hRecords.length >= 2) {
      const total = h2hRecords.length;
      let hWins = 0, aWins = 0, draws = 0;

      h2hRecords.forEach(m => {
        if (m.home === home) {
          if (m.hGoals > m.aGoals) hWins++;
          else if (m.aGoals > m.hGoals) aWins++;
          else draws++;
        } else {
          if (m.aGoals > m.hGoals) hWins++;
          else if (m.hGoals > m.aGoals) aWins++;
          else draws++;
        }
      });

      if (hWins / total >= 0.6) confidenceOverride = "VERY HIGH (Home H2H Dominance)";
      else if (aWins / total >= 0.6) confidenceOverride = "VERY HIGH (Away H2H Dominance)";
      else if (draws / total >= 0.5) confidenceOverride = "HIGH (H2H Draw Tendency)";
    }

    return { riskFlag, forceDrawSignal, confidenceOverride, matchTemplates };
  }

  // --- Robust Text Parser ---

  function parseGameweekClipboardData(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const fixtures = [];

    // Pattern matching: "Home vs Away" or "Home - Away" followed by odds
    const oddsRegex = /(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})/;
    const teamVersusRegex = /([A-Za-z0-9\s]+)\s+(?:vs|v|-)\s+([A-Za-z0-9\s]+)/i;

    let currentHome = null, currentAway = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const versusMatch = line.match(teamVersusRegex);
      if (versusMatch) {
        currentHome = versusMatch[1].trim();
        currentAway = versusMatch[2].trim();
      }

      const oddsMatch = line.match(oddsRegex);
      if (oddsMatch && currentHome && currentAway) {
        fixtures.push({
          home: currentHome,
          away: currentAway,
          hOdds: parseFloat(oddsMatch[1]),
          dOdds: parseFloat(oddsMatch[2]),
          aOdds: parseFloat(oddsMatch[3])
        });
        currentHome = null;
        currentAway = null;
      }
    }

    return fixtures;
  }

  // --- Main Predictive Pipeline ---

  async function analyzeFixtureHybridML(fixture, idx) {
    const { home, away, hOdds, dOdds, aOdds } = fixture;

    // 1. Fetch persistent history & Elo
    const historicalMatches = await window.VFLHistory.readLocalMatches();
    const homeElo = await window.VFLHistory.getTeamElo(home);
    const awayElo = await window.VFLHistory.getTeamElo(away);

    // 2. Implied Probabilities & Vig Margin
    const rawH = 1 / hOdds, rawD = 1 / dOdds, rawA = 1 / aOdds;
    const totalMargin = rawH + rawD + rawA;
    const vigAnomaly = totalMargin > 1.11; // Flag bookmaker margin spike (>111%)

    // 3. Fuzzy Historical Odds Lookup
    const fuzzyCluster = await window.VFLHistory.queryFuzzyHistoricalCluster(hOdds, dOdds, aOdds, 0.05);

    // 4. Poisson Distribution xG Model
    const xG = MathEngine.calculatexG(home, away, historicalMatches);
    const scoreMatrix = MathEngine.generateScoreMatrix(xG.lambdaHome, xG.lambdaAway);

    // 5. Head-to-Head & PRNG Streaks
    const h2h = await window.VFLHistory.getHeadToHead(home, away);
    const homeStreak = await window.VFLHistory.getTeamRecentForm(home);
    const awayStreak = await window.VFLHistory.getTeamRecentForm(away);

    // 6. Python Context & Trap Detection
    const pythonContext = evaluatePythonContext(home, away, hOdds, dOdds, aOdds, h2h);

    // 7. Dynamic Weights & Blend Calculation
    const eloDiff = homeElo - awayElo;
    const eloProbHome = 1 / (1 + Math.pow(10, -eloDiff / 400));
    const eloProbAway = 1 - eloProbHome;

    let blendH = (rawH / totalMargin) * 0.20 + 
                 (fuzzyCluster.pHome ?? rawH) * 0.35 + 
                 eloProbHome * 0.20 + 
                 (scoreMatrix.matrix[1][0] + scoreMatrix.matrix[2][0] + scoreMatrix.matrix[2][1]) * 0.25;

    let blendD = (rawD / totalMargin) * 0.20 + 
                 (fuzzyCluster.pDraw ?? rawD) * 0.35 + 
                 (scoreMatrix.matrix[0][0] + scoreMatrix.matrix[1][1] + scoreMatrix.matrix[2][2]) * 0.45;

    let blendA = (rawA / totalMargin) * 0.20 + 
                 (fuzzyCluster.pAway ?? rawA) * 0.35 + 
                 eloProbAway * 0.20 + 
                 (scoreMatrix.matrix[0][1] + scoreMatrix.matrix[0][2] + scoreMatrix.matrix[1][2]) * 0.25;

    // PRNG Mean Reversion adjustment
    if (homeStreak.consecutiveLosses >= 4) blendH += 0.08;
    if (awayStreak.consecutiveLosses >= 4) blendA += 0.08;

    const normSum = blendH + blendD + blendA;
    blendH /= normSum; blendD /= normSum; blendA /= normSum;

    // Prediction selection
    let prediction = blendH > blendD && blendH > blendA ? '1' : blendA > blendD ? '2' : 'X';
    if (pythonContext.forceDrawSignal && blendD >= 0.27) {
      prediction = 'X';
    }

    // Kelly Bet Sizing
    const chosenProb = prediction === '1' ? blendH : prediction === 'X' ? blendD : blendA;
    const chosenOdds = prediction === '1' ? hOdds : prediction === 'X' ? dOdds : aOdds;
    const kelly = MathEngine.calculateKelly(chosenProb, chosenOdds, 0.25);

    return {
      idx, home, away, hOdds, dOdds, aOdds,
      homeElo, awayElo,
      totalMarginPct: (totalMargin * 100).toFixed(1),
      vigAnomaly,
      hProb: (blendH * 100).toFixed(1),
      dProb: (blendD * 100).toFixed(1),
      aProb: (blendA * 100).toFixed(1),
      prediction,
      xGHome: xG.lambdaHome.toFixed(2),
      xGAway: xG.lambdaAway.toFixed(2),
      probOver25: (scoreMatrix.probOver25 * 100).toFixed(1),
      probUnder25: (scoreMatrix.probUnder25 * 100).toFixed(1),
      fuzzyMatches: fuzzyCluster.matchCount,
      riskFlag: pythonContext.riskFlag,
      templates: pythonContext.matchTemplates,
      confidence: pythonContext.confidenceOverride || (chosenProb > 0.52 ? "HIGH CONVICTION" : "MEDIUM SIGNAL"),
      kellyPct: kelly.recommendedStakePct
    };
  }

  // --- UI Rendering Engine ---

  function renderMatchCard(m) {
    const badgeText = m.prediction === '1' ? 'HOME WIN (1)' : m.prediction === 'X' ? 'DRAW (X)' : 'AWAY WIN (2)';
    const badgeClass = m.prediction === '1' ? 'home-win' : m.prediction === 'X' ? 'draw-win' : 'away-win';

    return `
      <div class="match-card" data-idx="${m.idx}">
        <div class="match-header">
          <div class="match-title">
            <strong>${m.home}</strong> <small>(${m.homeElo})</small> vs <strong>${m.away}</strong> <small>(${m.awayElo})</small>
          </div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>

        ${m.vigAnomaly ? `<div class="alert alert-danger">⚠️ High Bookie Margin Detected (${m.totalMarginPct}% Vig)</div>` : ''}
        ${m.riskFlag !== "NONE" ? `<div class="alert alert-warning">${m.riskFlag}</div>` : ''}

        <div class="odds-grid">
          <div class="odds-box ${m.prediction === '1' ? 'highlight' : ''}">
            <span class="label">1 (${m.hOdds.toFixed(2)})</span>
            <span class="value">${m.hProb}%</span>
          </div>
          <div class="odds-box ${m.prediction === 'X' ? 'highlight' : ''}">
            <span class="label">X (${m.dOdds.toFixed(2)})</span>
            <span class="value">${m.dProb}%</span>
          </div>
          <div class="odds-box ${m.prediction === '2' ? 'highlight' : ''}">
            <span class="label">2 (${m.aOdds.toFixed(2)})</span>
            <span class="value">${m.aProb}%</span>
          </div>
        </div>

        <div class="stats-panel">
          <div><strong>xG:</strong> ${m.xGHome} - ${m.xGAway}</div>
          <div><strong>O/U 2.5:</strong> Over ${m.probOver25}% | Under ${m.probUnder25}%</div>
          <div><strong>Fuzzy Cluster Matches:</strong> ${m.fuzzyMatches}</div>
          <div><strong>Confidence:</strong> ${m.confidence}</div>
          <div><strong>Kelly Stake:</strong> <span class="kelly-value">${m.kellyPct}% Bankroll</span></div>
          <div><strong>Templates:</strong> ${m.templates.join(', ')}</div>
        </div>

        <div class="result-input-row">
          <input type="number" id="hGoals_${m.idx}" placeholder="Home Goals" min="0" max="15">
          <input type="number" id="aGoals_${m.idx}" placeholder="Away Goals" min="0" max="15">
          <button class="btn btn-save" onclick="window.saveMatchResult(${m.idx})">Save Result</button>
        </div>
      </div>
    `;
  }

  // --- App State & DOM Binding ---

  let currentPredictions = [];

  async function processGameweek() {
    const rawInput = document.getElementById('rawClipboardInput').value;
    if (!rawInput.trim()) {
      alert("Please paste gameweek data standard text.");
      return;
    }

    const fixtures = parseGameweekClipboardData(rawInput);
    if (fixtures.length === 0) {
      alert("No valid fixtures or odds found in parsed text. Check input format.");
      return;
    }

    const container = document.getElementById('predictionsContainer');
    container.innerHTML = '<div class="loading">Running Hybrid ML Models & Processing History...</div>';

    currentPredictions = [];
    let html = '';

    for (let i = 0; i < fixtures.length; i++) {
      const result = await analyzeFixtureHybridML(fixtures[i], i);
      currentPredictions.push(result);
      html += renderMatchCard(result);
    }

    container.innerHTML = html;
  }

  window.saveMatchResult = async function (idx) {
    const pred = currentPredictions[idx];
    if (!pred) return;

    const hGInput = document.getElementById(`hGoals_${idx}`);
    const aGInput = document.getElementById(`aGoals_${idx}`);

    if (hGInput.value === '' || aGInput.value === '') {
      alert("Enter valid score values.");
      return;
    }

    const actualHomeGoals = parseInt(hGInput.value, 10);
    const actualAwayGoals = parseInt(aGInput.value, 10);

    await window.VFLHistory.saveLocalMatch({
      home: pred.home,
      away: pred.away,
      hOdds: pred.hOdds,
      dOdds: pred.dOdds,
      aOdds: pred.aOdds,
      actualHomeGoals,
      actualAwayGoals
    });

    alert(`Result for ${pred.home} vs ${pred.away} saved and Elo ratings updated!`);
    hGInput.disabled = true;
    aGInput.disabled = true;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const parseBtn = document.getElementById('btnParseGameweek');
    if (parseBtn) parseBtn.addEventListener('click', processGameweek);

    const clearBtn = document.getElementById('btnClearHistory');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (confirm("Are you sure you want to clear all stored match history and Elo ratings?")) {
          await window.VFLHistory.clearAllHistory();
          alert("Match history reset successfully.");
        }
      });
    }
  });

})();