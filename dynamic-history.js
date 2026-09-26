/*
 * Dynamic history bridge.
 *
 * This file keeps the app working with IndexedDB by default, while allowing
 * optional server syncing when a backend API is available later.
 *
 * Example configuration:
 *   localStorage.setItem('VFL_HISTORY_API', 'https://your-host.example/api');
 *
 * Expected API (optional):
 *   GET /matches  -> [{...}, {...}] or { matches: [...] }
 *   POST /matches -> { ...match } record
 */
(() => {
  'use strict';

  const API_KEY = 'VFL_HISTORY_API';
  const DB_NAME = 'VFL_MatchHistory';
  const STORE_NAME = 'matches';
  const DEFAULT_API = '/api';

  const apiBase = () => {
    const raw = localStorage.getItem(API_KEY) || DEFAULT_API;
    return raw.replace(/\/$/, '');
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

  const readLocalMatches = async () => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  };

  const mergeRemoteMatches = async (matches) => {
    if (!Array.isArray(matches) || !matches.length) return 0;
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let added = 0;
      const seen = new Set();

      const keyFor = (match) => {
        const home = match.home || match.homeTeam || '';
        const away = match.away || match.awayTeam || '';
        const hGoals = Number(match.actualHomeGoals ?? match.home_goals ?? 0);
        const aGoals = Number(match.actualAwayGoals ?? match.away_goals ?? 0);
        const when = match.timestamp || match.saved_at || '';
        return `${home}|${away}|${hGoals}|${aGoals}|${when}`;
      };

      // Avoid duplicates from repeated pulls.
      readLocalMatches().then(existing => {
        existing.forEach(item => seen.add(keyFor(item)));
        matches.forEach(match => {
          const key = keyFor(match);
          if (seen.has(key)) return;
          const normalized = {
            ...match,
            home: match.home || match.homeTeam,
            away: match.away || match.awayTeam,
            actualHomeGoals: Number(match.actualHomeGoals ?? match.home_goals ?? 0),
            actualAwayGoals: Number(match.actualAwayGoals ?? match.away_goals ?? 0),
            result: match.result || (() => {
              const h = Number(match.actualHomeGoals ?? match.home_goals ?? 0);
              const a = Number(match.actualAwayGoals ?? match.away_goals ?? 0);
              return h === a ? 'X' : h > a ? '1' : '2';
            })(),
            matchup: match.matchup || `${match.home || match.homeTeam} vs ${match.away || match.awayTeam}`,
            timestamp: match.timestamp || match.saved_at || new Date().toISOString(),
            source: 'server'
          };

          const req = store.add(normalized);
          req.onsuccess = () => {
            seen.add(key);
            added += 1;
          };
        });

        tx.oncomplete = () => resolve(added);
        tx.onerror = () => reject(tx.error);
      }).catch(reject);
    });
  };

  const loadRemoteHistory = async () => {
    try {
      const response = await fetch(`${apiBase()}/matches`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return 0;

      const payload = await response.json();
      const matches = Array.isArray(payload) ? payload : payload.matches || [];
      const added = await mergeRemoteMatches(matches);

      if (added && typeof window.showNotification === 'function') {
        window.showNotification(`Loaded ${added} historical match${added === 1 ? '' : 'es'} from the server`, 'info');
      }
      return added;
    } catch (error) {
      // Keep the app functioning even if no API is configured.
      console.info('Remote history unavailable; local history remains active.', error.message);
      return 0;
    }
  };

  const publishMatchToApi = async (match) => {
    try {
      const response = await fetch(`${apiBase()}/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(match)
      });
      if (!response.ok) {
        throw new Error(`History API returned ${response.status}`);
      }
    } catch (error) {
      console.info('Could not sync match to the server history endpoint:', error.message);
    }
  };

  const scheduleServerSync = async () => {
    const matches = await readLocalMatches();
    const latest = matches[matches.length - 1];
    if (!latest) return;
    await publishMatchToApi(latest);
  };

  const setupHistoryBridge = () => {
    window.addEventListener('DOMContentLoaded', () => {
      // Load server-side history if configured, without blocking the UI.
      loadRemoteHistory();

      // If a Save Result button is clicked, send the newly saved match to the
      // API in the background. This keeps the prediction engine dynamic while
      // preserving the local database as the primary source of truth.
      document.addEventListener('click', (event) => {
        if (event.target.closest('.save-result-btn')) {
          setTimeout(scheduleServerSync, 150);
        }
      }, true);
    });
  };

  // Expose a manual refresh hook for later use.
  window.refreshRemoteHistory = loadRemoteHistory;

  setupHistoryBridge();
})();
