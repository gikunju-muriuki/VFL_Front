/**
 * RECOMMENDATION ENGINE ADD-ON
 * Filters VERY HIGH CONVICTION matches and recommends selections with odds 2.70-2.97
 * Displays: "recommended selection - {team name} to win with {odds}"
 */

(() => {
  'use strict';

  /**
   * Extract recommended selection from current analyses
   * Returns single recommendation with highest odds in 2.70-2.97 range
   */
  function getRecommendedSelection() {
    if (!window.VFLBrain || !window.VFLBrain.currentAnalyses) {
      return null;
    }

    const currentAnalyses = window.VFLBrain.currentAnalyses || [];
    
    // Filter: VERY HIGH CONVICTION (H2H Backed) matches only
    const veryHighConvictionMatches = currentAnalyses.filter(
      analysis => analysis.confidence === 'VERY HIGH CONVICTION (H2H Backed)'
    );

    if (veryHighConvictionMatches.length === 0) {
      return null;
    }

    // For each match, extract team + odds combinations within 2.70-2.97 range
    let candidateSelections = [];

    veryHighConvictionMatches.forEach(analysis => {
      // Home team option
      if (analysis.hOdds >= 2.70 && analysis.hOdds <= 2.97) {
        candidateSelections.push({
          team: analysis.home,
          odds: analysis.hOdds,
          prediction: analysis.prediction,
          match: `${analysis.home} vs ${analysis.away}`,
          confidence: analysis.confidence
        });
      }

      // Away team option
      if (analysis.aOdds >= 2.70 && analysis.aOdds <= 2.97) {
        candidateSelections.push({
          team: analysis.away,
          odds: analysis.aOdds,
          prediction: analysis.prediction,
          match: `${analysis.home} vs ${analysis.away}`,
          confidence: analysis.confidence
        });
      }
    });

    if (candidateSelections.length === 0) {
      return null;
    }

    // Select highest odds in 2.70-2.97 range
    const recommendedSelection = candidateSelections.reduce((prev, current) =>
      current.odds > prev.odds ? current : prev
    );

    return recommendedSelection;
  }

  /**
   * Format recommendation for display
   */
  function formatRecommendation(selection) {
    if (!selection) return null;
    
    return {
      text: `recommended selection - ${selection.team} to win with ${selection.odds.toFixed(2)}`,
      fullText: `RECOMMENDED SELECTION\n${selection.team} to win with ${selection.odds.toFixed(2)}\nMatch: ${selection.match}\nConfidence: ${selection.confidence}`,
      team: selection.team,
      odds: selection.odds,
      match: selection.match
    };
  }

  /**
   * Render recommendation banner in results panel
   * This inserts the recommendation at the indicated spot (top of results)
   */
  function renderRecommendationBanner(recommendation) {
    if (!recommendation) return;

    const resultsContent = document.getElementById('results-content');
    if (!resultsContent) return;

    // Create recommendation banner element
    const banner = document.createElement('div');
    banner.id = 'recommendation-banner';
    banner.style.cssText = `
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(167, 139, 250, 0.2));
      border-left: 5px solid #22c55e;
      padding: 20px;
      border-radius: 10px;
      margin-bottom: 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.15);
    `;

    const textContainer = document.createElement('div');
    textContainer.style.cssText = `
      flex: 1;
    `;

    const mainText = document.createElement('div');
    mainText.style.cssText = `
      font-size: 1.2rem;
      font-weight: 700;
      color: #86efac;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    `;
    mainText.textContent = recommendation.text;

    const subText = document.createElement('div');
    subText.style.cssText = `
      font-size: 0.9rem;
      color: #cbd5e1;
      font-weight: 500;
    `;
    subText.textContent = `Match: ${recommendation.match}`;

    textContainer.appendChild(mainText);
    textContainer.appendChild(subText);

    const icon = document.createElement('div');
    icon.style.cssText = `
      font-size: 2rem;
      margin-left: 20px;
      flex-shrink: 0;
    `;
    icon.textContent = '🎯';

    banner.appendChild(textContainer);
    banner.appendChild(icon);

    // Insert at the beginning of results-content
    if (resultsContent.firstChild) {
      resultsContent.insertBefore(banner, resultsContent.firstChild);
    } else {
      resultsContent.appendChild(banner);
    }
  }

  /**
   * Main function to display recommendation
   * Call this after matches are rendered
   */
  function displayRecommendation() {
    const recommendation = getRecommendedSelection();
    if (!recommendation) {
      console.log('[RECOMMENDATION ENGINE] No VERY HIGH CONVICTION matches with 2.70-2.97 odds found.');
      return null;
    }

    const formatted = formatRecommendation(recommendation);
    renderRecommendationBanner(formatted);
    console.log('[RECOMMENDATION ENGINE]', formatted.text);
    return formatted;
  }

  /**
   * Expose functions to global scope
   */
  if (!window.RecommendationEngine) {
    window.RecommendationEngine = {
      getRecommendedSelection,
      formatRecommendation,
      displayRecommendation,
      renderRecommendationBanner
    };
  }
})();
