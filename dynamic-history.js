/**
 * Dynamic History Engine & Persistent IndexedDB Bridge
 * Handles unified database storage, Elo calculation, fuzzy cluster querying, and time-decay weighting.
 */

(function () {
  'use strict';

  const DB_NAME = 'VFL_Unified_DB';
  const DB_VERSION = 1;
  const STORE_MATCHES = 'matches';
  const STORE_RATINGS = 'team_ratings';

  const ELO_DEFAULT = 1500;
  const ELO_K_FACTOR = 32;
  const HALF_LIFE_DAYS = 30;

  let dbPromise = null;

  /**
   * Initialize or upgrade IndexedDB
   */
  function getDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_MATCHES)) {
            const matchStore = db.createObjectStore(STORE_MATCHES, { keyPath: 'id' });
            matchStore.createIndex('timestamp', 'timestamp', { unique: false });
            matchStore.createIndex('home', 'home', { unique: false });
            matchStore.createIndex('away', 'away', { unique: false });
            matchStore.createIndex('oddsCombo', 'oddsCombo', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_RATINGS)) {
            db.createObjectStore(STORE_RATINGS, { keyPath: 'team' });
          }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
      });
    }
    return dbPromise;
  }

  /**
   * Helper: Generate a unique, deterministic hash key for deduplication
   */
  function generateMatchKey(match) {
    const dateStr = match.date || new Date(match.timestamp || Date.now()).toISOString().slice(0, 10);
    return `${dateStr}_${match.home}_vs_${match.away}_${match.hOdds}_${match.dOdds}_${match.aOdds}`.toLowerCase();
  }

  /**
   * Exponential Time Decay Weight
   * w(t) = e^(-lambda * t_days) where lambda = ln(2) / 30
   */
  function calculateTimeDecayWeight(matchTimestamp) {
    if (!matchTimestamp) return 1.0;
    const matchDate = new Date(matchTimestamp);
    const now = new Date();
    const elapsedDays = Math.max(0, (now - matchDate) / (1000 * 60 * 60 * 24));
    const lambda = Math.LN2 / HALF_LIFE_DAYS;
    return Math.exp(-lambda * elapsedDays);
  }

  /**
   * Elo Rating Calculations
   */
  function calculateExpectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  function updateEloRatings(homeRating, awayRating, hGoals, aGoals) {
    const expectedHome = calculateExpectedScore(homeRating, awayRating);
    const expectedAway = calculateExpectedScore(awayRating, homeRating);

    let actualHome = 0.5, actualAway = 0.5;
    if (hGoals > aGoals) { actualHome = 1.0; actualAway = 0.0; }
    else if (aGoals > hGoals) { actualHome = 0.0; actualAway = 1.0; }

    const goalDiff = Math.abs(hGoals - aGoals);
    const marginMult = Math.log2(Math.max(goalDiff, 1) + 1);

    const newHome = homeRating + ELO_K_FACTOR * marginMult * (actualHome - expectedHome);
    const newAway = awayRating + ELO_K_FACTOR * marginMult * (actualAway - expectedAway);

    return {
      newHomeRating: Math.round(newHome),
      newAwayRating: Math.round(newAway)
    };
  }

  const VFLHistory = {
    /**
     * Fetch all historical matches from IndexedDB
     */
    async readLocalMatches() {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MATCHES, 'readonly');
        const store = tx.objectStore(STORE_MATCHES);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    },

    /**
     * Save or update a match record and update team Elo ratings
     */
    async saveLocalMatch(matchData) {
      const db = await getDB();
      const matchId = matchData.id || generateMatchKey(matchData);
      
      const record = {
        id: matchId,
        timestamp: matchData.timestamp || Date.now(),
        saved_at: new Date().toISOString(),
        home: matchData.home,
        away: matchData.away,
        hOdds: Number(matchData.hOdds || matchData.homeOdds),
        dOdds: Number(matchData.dOdds || matchData.drawOdds),
        aOdds: Number(matchData.aOdds || matchData.awayOdds),
        actualHomeGoals: Number(matchData.actualHomeGoals ?? matchData.homeGoals ?? 0),
        actualAwayGoals: Number(matchData.actualAwayGoals ?? matchData.awayGoals ?? 0),
        result: matchData.result || (
          Number(matchData.actualHomeGoals) > Number(matchData.actualAwayGoals) ? '1' :
          Number(matchData.actualAwayGoals) > Number(matchData.actualHomeGoals) ? '2' : 'X'
        ),
        totalGoals: Number(matchData.actualHomeGoals || 0) + Number(matchData.actualAwayGoals || 0),
        oddsCombo: `${Number(matchData.hOdds).toFixed(2)}-${Number(matchData.dOdds).toFixed(2)}-${Number(matchData.aOdds).toFixed(2)}`
      };

      // Save match record
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MATCHES, 'readwrite');
        const store = tx.objectStore(STORE_MATCHES);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // Update team Elo ratings
      await this.recalculateEloForTeams(record.home, record.away, record.actualHomeGoals, record.actualAwayGoals);

      return record;
    },

    /**
     * Recalculate and persist Elo ratings for given teams
     */
    async recalculateEloForTeams(homeTeam, awayTeam, hGoals, aGoals) {
      const db = await getDB();
      const tx = db.transaction(STORE_RATINGS, 'readwrite');
      const store = tx.objectStore(STORE_RATINGS);

      const getRating = (team) => new Promise((resolve) => {
        const req = store.get(team);
        req.onsuccess = () => resolve(req.result ? req.result.rating : ELO_DEFAULT);
      });

      const homeElo = await getRating(homeTeam);
      const awayElo = await getRating(awayTeam);

      const updated = updateEloRatings(homeElo, awayElo, hGoals, aGoals);

      store.put({ team: homeTeam, rating: updated.newHomeRating, updated_at: Date.now() });
      store.put({ team: awayTeam, rating: updated.newAwayRating, updated_at: Date.now() });
    },

    /**
     * Retrieve Elo rating for a specific team
     */
    async getTeamElo(team) {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_RATINGS, 'readonly');
        const store = tx.objectStore(STORE_RATINGS);
        const req = store.get(team);
        req.onsuccess = () => resolve(req.result ? req.result.rating : ELO_DEFAULT);
        req.onerror = () => resolve(ELO_DEFAULT);
      });
    },

    /**
     * Query historical data using Fuzzy Binning (+/- tolerance) & Time-Decay
     */
    async queryFuzzyHistoricalCluster(hOdds, dOdds, aOdds, tolerance = 0.05) {
      const matches = await this.readLocalMatches();

      let weightedHomeWins = 0;
      let weightedDraws = 0;
      let weightedAwayWins = 0;
      let totalWeight = 0;
      let matchCount = 0;

      matches.forEach(m => {
        const hMatch = Math.abs(m.hOdds - hOdds) <= tolerance;
        const dMatch = Math.abs(m.dOdds - dOdds) <= tolerance;
        const aMatch = Math.abs(m.aOdds - aOdds) <= tolerance;

        if (hMatch && dMatch && aMatch) {
          const weight = calculateTimeDecayWeight(m.timestamp || m.saved_at);
          matchCount++;
          totalWeight += weight;

          if (m.result === '1') weightedHomeWins += weight;
          else if (m.result === 'X') weightedDraws += weight;
          else if (m.result === '2') weightedAwayWins += weight;
        }
      });

      return {
        matchCount,
        totalWeight,
        pHome: totalWeight > 0 ? weightedHomeWins / totalWeight : null,
        pDraw: totalWeight > 0 ? weightedDraws / totalWeight : null,
        pAway: totalWeight > 0 ? weightedAwayWins / totalWeight : null
      };
    },

    /**
     * Retrieve head-to-head records between two teams
     */
    async getHeadToHead(teamA, teamB) {
      const matches = await this.readLocalMatches();
      return matches.filter(m => 
        (m.home === teamA && m.away === teamB) || (m.home === teamB && m.away === teamA)
      ).map(m => ({
        home: m.home,
        away: m.away,
        hGoals: Number(m.actualHomeGoals),
        aGoals: Number(m.actualAwayGoals),
        result: m.result
      }));
    },

    /**
     * Retrieve last N chronological results for PRNG streak tracking
     */
    async getTeamRecentForm(team, limit = 6) {
      const matches = await this.readLocalMatches();
      const teamMatches = matches
        .filter(m => m.home === team || m.away === team)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit);

      let consecutiveLosses = 0;
      let consecutiveWins = 0;

      for (const m of teamMatches) {
        const isHome = m.home === team;
        const won = (isHome && m.result === '1') || (!isHome && m.result === '2');
        const lost = (isHome && m.result === '2') || (!isHome && m.result === '1');

        if (won) { consecutiveWins++; consecutiveLosses = 0; }
        else if (lost) { consecutiveLosses++; consecutiveWins = 0; }
        else { break; }
      }

      return { recentMatches: teamMatches, consecutiveWins, consecutiveLosses };
    },

    /**
     * Clear database store
     */
    async clearAllHistory() {
      const db = await getDB();
      const tx = db.transaction([STORE_MATCHES, STORE_RATINGS], 'readwrite');
      tx.objectStore(STORE_MATCHES).clear();
      tx.objectStore(STORE_RATINGS).clear();
      return new Promise(resolve => tx.oncomplete = resolve);
    }
  };

  window.VFLHistory = VFLHistory;
})();
