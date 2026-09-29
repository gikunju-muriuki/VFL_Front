/**
 * Dynamic History & Persistent DB API
 * Handles IndexedDB interactions, Dynamic Elo calculations, and Fuzzy Cluster lookups.
 */

(function () {
  'use strict';

  const DB_NAME = 'VFL_Predictive_DB';
  const DB_VERSION = 1;
  const STORE_MATCHES = 'matches';
  const STORE_ELO = 'elo_ratings';

  const DEFAULT_ELO = 1200;
  const K_FACTOR = 32;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_MATCHES)) {
          const matchStore = db.createObjectStore(STORE_MATCHES, { keyPath: 'id', autoIncrement: true });
          matchStore.createIndex('teams', ['home', 'away'], { unique: false });
          matchStore.createIndex('odds', ['hOdds', 'dOdds', 'aOdds'], { unique: false });
          matchStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_ELO)) {
          db.createObjectStore(STORE_ELO, { keyPath: 'team' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const VFLHistory = {
    async readLocalMatches() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MATCHES, 'readonly');
        const store = tx.objectStore(STORE_MATCHES);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async getTeamElo(team) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ELO, 'readonly');
        const store = tx.objectStore(STORE_ELO);
        const req = store.get(team);
        req.onsuccess = () => resolve(req.result ? req.result.rating : DEFAULT_ELO);
        req.onerror = () => reject(req.error);
      });
    },

    async updateTeamElo(team, newRating) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ELO, 'readwrite');
        const store = tx.objectStore(STORE_ELO);
        const req = store.put({ team, rating: Math.round(newRating) });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async saveLocalMatch(matchData) {
      const db = await openDB();
      const timestamp = matchData.timestamp || Date.now();
      const record = { ...matchData, timestamp };

      // 1. Save match record
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MATCHES, 'readwrite');
        const store = tx.objectStore(STORE_MATCHES);
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      // 2. Recalculate Dynamic Elo
      const { home, away, actualHomeGoals, actualAwayGoals } = matchData;
      if (typeof actualHomeGoals === 'number' && typeof actualAwayGoals === 'number') {
        const homeElo = await this.getTeamElo(home);
        const awayElo = await this.getTeamElo(away);

        const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo) / 400));
        const expectedAway = 1 - expectedHome;

        let actualHome = 0.5, actualAway = 0.5;
        if (actualHomeGoals > actualAwayGoals) { actualHome = 1; actualAway = 0; }
        else if (actualAwayGoals > actualHomeGoals) { actualHome = 0; actualAway = 1; }

        const newHomeElo = homeElo + K_FACTOR * (actualHome - expectedHome);
        const newAwayElo = awayElo + K_FACTOR * (actualAway - expectedAway);

        await this.updateTeamElo(home, newHomeElo);
        await this.updateTeamElo(away, newAwayElo);
      }
    },

    async queryFuzzyHistoricalCluster(hOdds, dOdds, aOdds, tolerance = 0.05) {
      const matches = await this.readLocalMatches();
      let matchCount = 0;
      let homeWins = 0, draws = 0, awayWins = 0;

      const now = Date.now();
      const halfLifeMs = 30 * 24 * 60 * 60 * 1000; // 30-day exponential time decay
      let weightedCount = 0;

      matches.forEach(m => {
        const hDiff = Math.abs(m.hOdds - hOdds);
        const dDiff = Math.abs(m.dOdds - dOdds);
        const aDiff = Math.abs(m.aOdds - aOdds);

        if (hDiff <= tolerance && dDiff <= tolerance && aDiff <= tolerance) {
          const age = now - (m.timestamp || now);
          const weight = Math.exp(-age / halfLifeMs);

          matchCount++;
          weightedCount += weight;

          if (m.actualHomeGoals > m.actualAwayGoals) homeWins += weight;
          else if (m.actualAwayGoals > m.actualHomeGoals) awayWins += weight;
          else draws += weight;
        }
      });

      if (weightedCount === 0) return { matchCount: 0, pHome: null, pDraw: null, pAway: null };

      return {
        matchCount,
        pHome: homeWins / weightedCount,
        pDraw: draws / weightedCount,
        pAway: awayWins / weightedCount
      };
    },

    async getHeadToHead(home, away) {
      const matches = await this.readLocalMatches();
      return matches.filter(m => 
        (m.home === home && m.away === away) || (m.home === away && m.away === home)
      );
    },

    async getTeamRecentForm(team, limit = 5) {
      const matches = await this.readLocalMatches();
      const teamMatches = matches
        .filter(m => m.home === team || m.away === team)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      let consecutiveLosses = 0;
      for (const m of teamMatches) {
        const isHome = m.home === team;
        const won = isHome ? m.actualHomeGoals > m.actualAwayGoals : m.actualAwayGoals > m.actualHomeGoals;
        const drew = m.actualHomeGoals === m.actualAwayGoals;
        
        if (!won && !drew) consecutiveLosses++;
        else break;
      }

      return { teamMatches, consecutiveLosses };
    },

    async clearAllHistory() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MATCHES, STORE_ELO], 'readwrite');
        tx.objectStore(STORE_MATCHES).clear();
        tx.objectStore(STORE_ELO).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  };

  window.VFLHistory = VFLHistory;
})();