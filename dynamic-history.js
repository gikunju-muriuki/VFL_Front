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
    const request = indexedDB.open(DB_NAME, 1);
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

    return {
      ...match,
      home,
      away,
      actualHomeGoals,
      actualAwayGoals,
      result,
      totalGoals: actualHomeGoals + actualAwayGoals,
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
      refreshLocalHistory: readLocalMatches
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
