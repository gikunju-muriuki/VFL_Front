/**
 * Core Prediction Brain
 * Ingests historical match data to predict future outcomes using weighted analytics.
 */
class PredictionEngine {
  constructor(historicalData = []) {
    // Initialize with historical data from data.json.txt
    this.historicalData = historicalData;
    this.teamStats = this._compileTeamStats();
    
    // Algorithm weights for final prediction confidence
    this.weights = {
      odds: 0.45,
      historicalForm: 0.35,
      tierDifference: 0.20
    };
  }

  /**
   * Compiles historical goals and results for each team from data.json.txt
   * @private
   */
  _compileTeamStats() {
    const stats = {};

    this.historicalData.forEach(match => {
      // Initialize team objects if they don't exist
      if (!stats[match.home]) stats[match.home] = { goalsScored: 0, goalsConceded: 0, matches: 0, points: 0 };
      if (!stats[match.away]) stats[match.away] = { goalsScored: 0, goalsConceded: 0, matches: 0, points: 0 };

      // Process Home Team[span_1](start_span)[span_1](end_span)
      stats[match.home].goalsScored += match.actualHomeGoals || 0;
      stats[match.home].goalsConceded += match.actualAwayGoals || 0;
      stats[match.home].matches += 1;

      // Process Away Team[span_2](start_span)[span_2](end_span)
      stats[match.away].goalsScored += match.actualAwayGoals || 0;
      stats[match.away].goalsConceded += match.actualHomeGoals || 0;
      stats[match.away].matches += 1;

      // Calculate historical points based on results[span_3](start_span)[span_3](end_span)
      if (match.result === "1") {
        stats[match.home].points += 3;
      } else if (match.result === "2") {
        stats[match.away].points += 3;
      } else if (match.result === "X") {
        stats[match.home].points += 1;
        stats[match.away].points += 1;
      }
    });

    return stats;
  }

  /**
   * Converts standard odds to implied probabilities (removing the bookmaker's overround).
   * @private
   */
  _getImpliedProbabilities(homeOdds, drawOdds, awayOdds) {
    if (!homeOdds || !drawOdds || !awayOdds || homeOdds === 0) {
      return { home: 0.33, draw: 0.34, away: 0.33 }; // Fallback for zeroed odds matches[span_4](start_span)[span_4](end_span)
    }

    const impliedHome = 1 / homeOdds;
    const impliedDraw = 1 / drawOdds;
    const impliedAway = 1 / awayOdds;
    const totalMargin = impliedHome + impliedDraw + impliedAway;

    return {
      home: impliedHome / totalMargin,
      draw: impliedDraw / totalMargin,
      away: impliedAway / totalMargin
    };
  }

  /**
   * Calculates a form index based on historical points per game.
   * @private
   */
  _calculateFormIndex(homeTeam, awayTeam) {
    const homeStats = this.teamStats[homeTeam];
    const awayStats = this.teamStats[awayTeam];

    const homePPG = homeStats ? (homeStats.points / homeStats.matches) : 1.0;
    const awayPPG = awayStats ? (awayStats.points / awayStats.matches) : 1.0;
    
    const totalPPG = homePPG + awayPPG;
    if (totalPPG === 0) return { home: 0.5, away: 0.5 };

    return {
      home: homePPG / totalPPG,
      away: awayPPG / totalPPG
    };
  }

  /**
   * Main predictive function to be called by the application.
   * @param {Object} matchParams - The upcoming match parameters.
   * @returns {Object} Prediction result including outcome ("1", "X", "2") and confidence.
   */
  predictMatch(matchParams) {
    const { home, away, homeOdds, drawOdds, awayOdds, homeTier, awayTier } = matchParams;

    // 1. Odds Base Probabilities
    const oddsProb = this._getImpliedProbabilities(homeOdds, drawOdds, awayOdds);

    // 2. Historical Form Probabilities
    const formProb = this._calculateFormIndex(home, away);

    // 3. Tier Difference Adjustment
    // Lower tier number means a stronger team (Tier 1 > Tier 2).
    const tierDiff = (awayTier || 2) - (homeTier || 2); 
    const tierHomeBoost = tierDiff > 0 ? 0.6 : (tierDiff < 0 ? 0.4 : 0.5);
    const tierAwayBoost = 1 - tierHomeBoost;

    // 4. Weighted Aggregation
    const finalHomeProb = (oddsProb.home * this.weights.odds) + 
                          (formProb.home * this.weights.historicalForm) + 
                          (tierHomeBoost * this.weights.tierDifference);

    const finalAwayProb = (oddsProb.away * this.weights.odds) + 
                          (formProb.away * this.weights.historicalForm) + 
                          (tierAwayBoost * this.weights.tierDifference);

    const finalDrawProb = 1 - (finalHomeProb + finalAwayProb);

    // 5. Determine Result
    let predictedResult = "X";
    let maxProb = finalDrawProb;

    if (finalHomeProb > finalAwayProb && finalHomeProb > finalDrawProb) {
      predictedResult = "1";
      maxProb = finalHomeProb;
    } else if (finalAwayProb > finalHomeProb && finalAwayProb > finalDrawProb) {
      predictedResult = "2";
      maxProb = finalAwayProb;
    }

    return {
      matchup: `${home} vs ${away}`,
      prediction: predictedResult,
      probabilities: {
        home: (finalHomeProb * 100).toFixed(2) + "%",
        draw: (finalDrawProb * 100).toFixed(2) + "%",
        away: (finalAwayProb * 100).toFixed(2) + "%"
      },
      confidence: (maxProb * 100).toFixed(2) + "%"
    };
  }
}

// Example Integration for UI/Backend Controller
/*
  import historicalData from './data.json.txt';
  
  // Initialize the brain
  const predictor = new PredictionEngine(historicalData);
  
  // Predict a new match
  const upcomingMatch = {
    home: "London Blues",
    away: "Manchester Blue",
    homeOdds: 2.50,
    drawOdds: 3.20,
    awayOdds: 2.80,
    homeTier: 1,
    awayTier: 1
  };
  
  const result = predictor.predictMatch(upcomingMatch);
  
  // Inject `result.prediction` and `result.confidence` into existing UI state without changing DOM structure.
*/
export default PredictionEngine;
