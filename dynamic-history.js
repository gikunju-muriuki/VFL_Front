/**
 * Dynamic History Manager & Analytics Engine Bridge
 * Provides offline-first IndexedDB persistence, normalization, deduplication,
 * real-time Elo rating calculations, H2H extraction, and Poisson xG modeling.
 */
(() => {
  'use strict';

  const DB_NAME = 'VFL_MatchHistory';
  const STORE_NAME = 'matches';

  const keyFor = (match = {}) => {
    const home = match.home || match.homeTeam || '';
    const away = match.away || match.awayTeam || '';
    const hGoals = Number(match.actualHomeGoals ?? match.home_goals ?? 0);
    const aGoals = Number(match.actualAwayGoals ?? match.away_goals ?? 0);
    const when = match.timestamp || match.saved_at || '';
    return `${home}|${away}|${hGoals}|${aGoals}|${when}`;
  };

  const openHistoryDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('matchup', 'matchup', { unique: false });
        store.createIndex('homeTeam', 'home', { unique: false });
        store.createIndex('awayTeam', 'away', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('oddsCombo', 'oddsCombo', { unique: false });
      } else {
        const store = event.currentTarget.transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('oddsCombo')) {
          store.createIndex('oddsCombo', 'oddsCombo', { unique: false });
        }
      }
    };
  });

  const normalizeStoredMatch = (match = {}) => {
    const home = match.home || match.homeTeam || '';
    const away = match.away || match.awayTeam || '';
    const actualHomeGoals = Number(match.actualHomeGoals ?? match.home_goals ?? 0);
    const actualAwayGoals = Number(match.actualAwayGoals ?? match.away_goals ?? 0);
    const result = match.result || (() => {
      if (actualHomeGoals === actualAwayGoals) return 'X';
      return actualHomeGoals > actualAwayGoals ? '1' : '2';
    })();

    const hOdds = Number(match.homeOdds || 0);
    const dOdds = Number(match.drawOdds || 0);
    const aOdds = Number(match.awayOdds || 0);
    const oddsCombo = match.oddsCombo || `${hOdds.toFixed(2)}|${dOdds.toFixed(2)}|${aOdds.toFixed(2)}`;

    return {
      ...match,
      home,
      away,
      actualHomeGoals,
      actualAwayGoals,
      result,
      totalGoals: actualHomeGoals + actualAwayGoals,
      homeOdds: hOdds,
      drawOdds: dOdds,
      awayOdds: aOdds,
      oddsCombo,
      matchup: match.matchup || `${home} vs ${away}`,
      timestamp: match.timestamp || match.saved_at || new Date().toISOString(),
      source: match.source || 'local'
    };
  };

  const readLocalMatches = async () => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).map(normalizeStoredMatch));
      request.onerror = () => reject(request.error);
    });
  };

  const saveLocalMatch = async (match) => {
    const db = await openHistoryDb();
    const normalized = normalizeStoredMatch(match);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(normalized);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const mergeLocalMatches = async (incomingMatches) => {
    if (!Array.isArray(incomingMatches) || !incomingMatches.length) return 0;

    const db = await openHistoryDb();
    const existing = await readLocalMatches();
    const seen = new Set(existing.map(item => keyFor(item)));
    let added = 0;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      incomingMatches.forEach(match => {
        const normalized = normalizeStoredMatch(match);
        const lookupKey = keyFor(normalized);

        if (seen.has(lookupKey)) return;

        const request = store.add(normalized);
        request.onsuccess = () => {
          seen.add(lookupKey);
          added += 1;
        };
        request.onerror = () => reject(request.error);
      });

      tx.oncomplete = () => resolve(added);
      tx.onerror = () => reject(tx.error);
    });
  };

  const clearLocalHistory = async () => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  };

  const exportHistoryAsJson = async () => {
    const matches = await readLocalMatches();
    return JSON.stringify(matches, null, 2);
  };

  const importHistoryFromJson = async (jsonText) => {
    if (!jsonText || typeof jsonText !== 'string') {
      throw new Error('History data is empty.');
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new Error('Invalid JSON history data.');
    }

    const matches = Array.isArray(parsed) ? parsed : Array.isArray(parsed.matches) ? parsed.matches : [];
    if (!matches.length) {
      throw new Error('No match records found in the import data.');
    }

    return mergeLocalMatches(matches);
  };

  // =========================================================================
  // ADVANCED HYBRID FEATURE ENGINEERING & STATISTICAL ENGINE HELPERS
  // =========================================================================

  /**
   * Calculates Dynamic Elo Ratings for all teams based on chronological matches
   */
  const calculateEloRatings = (matches = []) => {
    const ratings = {};
    const DEFAULT_ELO = 1500;
    const K_FACTOR = 32;

    const sortedMatches = [...matches].sort((a, b) => {
      return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });

    sortedMatches.forEach(m => {
      const h = m.home;
      const a = m.away;
      if (!h || !a) return;

      if (!(h in ratings)) ratings[h] = DEFAULT_ELO;
      if (!(a in ratings)) ratings[a] = DEFAULT_ELO;

      const rH = ratings[h];
      const rA = ratings[a];

      const expH = 1 / (1 + Math.pow(10, (rA - rH) / 400));
      const expA = 1 / (1 + Math.pow(10, (rH - rA) / 400));

      const hG = m.actualHomeGoals ?? 0;
      const aG = m.actualAwayGoals ?? 0;

      let scoreH = 0.5;
      if (hG > aG) scoreH = 1.0;
      else if (hG < aG) scoreH = 0.0;

      const goalDiff = Math.abs(hG - aG);
      const marginMult = 1 + Math.min(3, goalDiff) * 0.5;

      ratings[h] = Math.round(rH + K_FACTOR * marginMult * (scoreH - expH));
      ratings[a] = Math.round(rA + K_FACTOR * marginMult * ((1 - scoreH) - expA));
    });

    return ratings;
  };

  /**
   * Extracts head-to-head match history between specific Home and Away teams
   */
  const getHeadToHead = (matches = [], home = '', away = '') => {
    const meetings = matches.filter(m => {
      return (m.home === home && m.away === away) || (m.home === away && m.away === home);
    }).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let totalHomeGoals = 0;
    let totalAwayGoals = 0;

    meetings.forEach(m => {
      let hG = m.actualHomeGoals;
      let aG = m.actualAwayGoals;
      if (m.home === away) {
        hG = m.actualAwayGoals;
        aG = m.actualHomeGoals;
      }
      totalHomeGoals += hG;
      totalAwayGoals += aG;

      if (hG > aG) homeWins++;
      else if (aG > hG) awayWins++;
      else draws++;
    });

    const total = meetings.length;
    return {
      meetings,
      total,
      homeWins,
      awayWins,
      draws,
      avgHomeGoals: total > 0 ? (totalHomeGoals / total).toFixed(2) : "0.00",
      avgAwayGoals: total > 0 ? (totalAwayGoals / total).toFixed(2) : "0.00",
      recent: meetings.slice(-5).map(m => `${m.actualHomeGoals}-${m.actualAwayGoals}`)
    };
  };

  /**
   * Evaluates sequential PRNG streaks and team form
   */
  const getTeamFormAndStreaks = (matches = [], team = '') => {
    const teamMatches = matches.filter(m => m.home === team || m.away === team)
      .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    const recent = teamMatches.slice(-10);
    let streakCount = 0;
    let streakType = null;

    for (let i = recent.length - 1; i >= 0; i--) {
      const m = recent[i];
      const isHome = m.home === team;
      const teamG = isHome ? m.actualHomeGoals : m.actualAwayGoals;
      const oppG = isHome ? m.actualAwayGoals : m.actualHomeGoals;

      let res = 'D';
      if (teamG > oppG) res = 'W';
      else if (teamG < oppG) res = 'L';

      if (streakType === null) {
        streakType = res;
        streakCount = 1;
      } else if (streakType === res) {
        streakCount++;
      } else {
        break;
      }
    }

    return {
      totalPlayed: teamMatches.length,
      streakType: streakType || 'N/A',
      streakCount: streakCount,
      recent: recent.map(m => {
        const isHome = m.home === team;
        return `${isHome ? m.away : m.home} (${isHome ? m.actualHomeGoals : m.actualAwayGoals}-${isHome ? m.actualAwayGoals : m.actualHomeGoals})`;
      })
    };
  };

  /**
   * Derives expected goals (xG) parameters for Poisson distribution modelling
   */
  const calculatePoissonXG = (matches = [], home = '', away = '') => {
    if (!matches.length) return { lambdaHome: 1.35, lambdaAway: 1.15 };

    let totalHomeGoals = 0;
    let totalAwayGoals = 0;
    let matchCount = matches.length;

    const homeStats = { gf: 0, ga: 0, games: 0 };
    const awayStats = { gf: 0, ga: 0, games: 0 };

    matches.forEach(m => {
      totalHomeGoals += m.actualHomeGoals;
      totalAwayGoals += m.actualAwayGoals;

      if (m.home === home) {
        homeStats.gf += m.actualHomeGoals;
        homeStats.ga += m.actualAwayGoals;
        homeStats.games++;
      }
      if (m.away === away) {
        awayStats.gf += m.actualAwayGoals;
        awayStats.ga += m.actualHomeGoals;
        awayStats.games++;
      }
    });

    const avgLeagueHomeGF = (totalHomeGoals / matchCount) || 1.4;
    const avgLeagueAwayGF = (totalAwayGoals / matchCount) || 1.1;

    const homeAttack = homeStats.games > 0 ? (homeStats.gf / homeStats.games) / avgLeagueHomeGF : 1.0;
    const homeDefense = homeStats.games > 0 ? (homeStats.ga / homeStats.games) / avgLeagueAwayGF : 1.0;

    const awayAttack = awayStats.games > 0 ? (awayStats.gf / awayStats.games) / avgLeagueAwayGF : 1.0;
    const awayDefense = awayStats.games > 0 ? (awayStats.ga / awayStats.games) / avgLeagueHomeGF : 1.0;

    const lambdaHome = Math.max(0.2, Math.min(4.5, homeAttack * awayDefense * avgLeagueHomeGF));
    const lambdaAway = Math.max(0.2, Math.min(4.5, awayAttack * homeDefense * avgLeagueAwayGF));

    return { lambdaHome, lambdaAway };
  };

  const setupOfflineHistoryBridge = () => {
    window.VFLHistory = {
      DB_NAME,
      STORE_NAME,
      openHistoryDb,
      readLocalMatches,
      saveLocalMatch,
      mergeLocalMatches,
      clearLocalHistory,
      exportHistoryAsJson,
      importHistoryFromJson,
      refreshLocalHistory: readLocalMatches,
      calculateEloRatings,
      getHeadToHead,
      getTeamFormAndStreaks,
      calculatePoissonXG
    };

    window.refreshLocalHistory = readLocalMatches;
    window.exportHistory = exportHistoryAsJson;
    window.importHistory = importHistoryFromJson;
    window.clearHistoryData = clearLocalHistory;

    window.addEventListener('DOMContentLoaded', () => {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Offline history ready: local IndexedDB is active.', 'info');
      }
    });
  };

  setupOfflineHistoryBridge();
})();
