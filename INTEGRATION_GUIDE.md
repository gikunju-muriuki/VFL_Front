# VFL Frontend-Backend Integration Guide

## Architecture Overview

The VFL system consists of three independent components that need synchronization:

1. **Frontend (JavaScript)** - Browser-based prediction engine with IndexedDB persistence
2. **Backend (Python)** - CLI-based fixture analyzer with local JSON file storage
3. **API Bridge** - REST endpoints to unify data flow

## Current State

### Frontend (`script.js` + `dynamic-history.js`)
- **Database**: IndexedDB (browser-based)
- **Data Flow**: Parse gameweek data → Analyze fixtures → Display predictions → Capture results
- **Persistence**: Automatic IndexedDB sync with optional server backend
- **API Configuration**: Via `localStorage.getItem('VFL_HISTORY_API')`

### Backend (`index.py`)
- **Database**: JSON file (`match_history.json`)
- **Data Flow**: CLI prompts → Team selection → Odds input → Analysis → Result saving
- **Team Tiers**: Hard-coded TEAM_TIERS dictionary
- **Prediction Logic**: Tier-based + historical head-to-head analysis

## Synchronization Strategy

### 1. **Unified Data Schema**

Both systems must work with the same match record structure:

```json
{
  "id": 1,
  "home": "Liverpool",
  "away": "Manchester United",
  "homeTier": 1,
  "awayTier": 2,
  "homeOdds": 1.95,
  "drawOdds": 3.20,
  "awayOdds": 4.00,
  "prediction": "1",
  "actualHomeGoals": 2,
  "actualAwayGoals": 1,
  "result": "1",
  "totalGoals": 3,
  "timestamp": "2026-09-26T14:30:00Z",
  "matchup": "Liverpool vs Manchester United",
  "source": "frontend|server|manual"
}
```

### 2. **API Endpoints Required**

The backend must provide these REST endpoints:

#### `GET /api/matches`
Returns all historical matches
```
Response: { matches: [...] } or [...]
```

#### `POST /api/matches`
Creates a new match record
```
Body: { ...match_object }
Response: { id: 123, ...match_object }
```

#### `GET /api/teams`
Returns available teams with tier information
```
Response: { 
  teams: {
    "Liverpool": 1,
    "Manchester United": 2,
    ...
  }
}
```

#### `POST /api/analyze`
Analyzes a single fixture
```
Body: {
  home: "Liverpool",
  away: "Manchester United",
  homeOdds: 1.95,
  drawOdds: 3.20,
  awayOdds: 4.00
}
Response: {
  prediction: "1",
  confidence: "HIGH",
  h2h: {...},
  homeStats: {...},
  awayStats: {...}
}
```

### 3. **Frontend Modifications Needed**

#### File: `script.js`

**Add API client layer** (before database layer):
```javascript
const API_CLIENT = {
  baseUrl: () => localStorage.getItem('VFL_API_BASE') || '/api',
  
  async getMatches() { /* GET /api/matches */ },
  async saveMatch(match) { /* POST /api/matches */ },
  async analyzeFixture(home, away, odds) { /* POST /api/analyze */ },
  async getTeams() { /* GET /api/teams */ }
};
```

**Modify `analyzeFixture()`**:
- First try to fetch analysis from API
- Fall back to client-side calculation if API unavailable

**Modify `captureResult()`**:
- Save to IndexedDB first (primary storage)
- Publish to API asynchronously (via `dynamic-history.js`)

**Update `renderMatches()`**:
- Sync loaded historical data with API results
- Show confidence boost from server-side metrics

#### File: `dynamic-history.js`

**Already handles most of this**, but needs enhancement:
- Merge server analytics (team stats, h2h records) with local data
- Handle bidirectional sync (local → server → local)
- Implement queue for offline match submissions

### 4. **Backend Modifications Needed**

#### File: `index.py`

**Refactor for REST API**:
- Keep CLI mode as-is (for standalone use)
- Export analysis functions for API consumption
- Create Flask/FastAPI wrapper

**Required changes**:
```python
# Expose functions for API
def get_teams():
    return TEAM_TIERS

def get_all_matches():
    return load_history()

def create_match(data):
    save_match(data['home'], data['away'], 
               data['actualHomeGoals'], data['actualAwayGoals'])
    return data

def analyze_api(home, away, h_odds, d_odds, a_odds):
    # Return machine-readable analysis (no print statements)
    return {
        'prediction': prediction,
        'confidence': confidence,
        'probabilities': {...},
        'h2h': h2h_data,
        'homeStats': home_stats,
        'awayStats': away_stats
    }
```

### 5. **Configuration Management**

#### Frontend Configuration (`index.html`)
Add config panel to set API endpoint:
```html
<button onclick="configureAPI()">⚙️ API Settings</button>
```

#### Backend Configuration
Support environment variables:
```bash
VFL_API_PORT=5000
VFL_API_HOST=0.0.0.0
VFL_HISTORY_FILE=/data/match_history.json
VFL_TEAMS_FILE=/data/teams.json  # Optional: externalize tiers
```

### 6. **Sync Flow Diagram**

```
Frontend (Browser)          Backend (Server)
    ↓                              ↓
Parse Input ←→ API (/analyze) → Python Analysis
    ↓                              ↓
IndexedDB ←→ API (/matches) → match_history.json
    ↓                              ↓
Display Results ←→ API (/teams) → TEAM_TIERS
    ↓
Capture Result
    ↓
Queue (offline)
    ↓
Sync when online ←→ API (POST)
```

### 7. **Offline-First Strategy**

**Frontend should work 100% offline**:
1. Parse and analyze locally (no API call needed)
2. Cache all predictions in IndexedDB
3. Queue match submissions when offline
4. Sync on reconnection (via `dynamic-history.js`)

**Service Worker handles this** (`sw.js`):
- Network-first for API calls
- Cache-first for static assets
- Graceful degradation when offline

### 8. **Data Consistency Rules**

1. **Single Source of Truth Per Entity**:
   - Local IndexedDB: User's entered predictions & results (primary)
   - Server: Global analytics, team stats, h2h records (secondary)

2. **No Conflicts**:
   - Frontend never overwrites server-calculated stats
   - Server never overwrites local match results
   - Merge strategy: Server data enriches frontend UI, doesn't replace core logic

3. **Sync Conflict Resolution**:
   - Timestamp-based: Newer data wins
   - Source-based: Local user input always prioritized
   - Queue-based: Offline submissions eventually sync

### 9. **Testing the Integration**

#### Frontend Tests
```javascript
// Test API connectivity
localStorage.setItem('VFL_API_BASE', 'http://localhost:5000/api');
await API_CLIENT.getTeams();  // Should return teams

// Test offline mode
// (disable network in DevTools)
await processInput();  // Should still work locally
```

#### Backend Tests
```bash
# Start API server
python app.py  # (needs to be created)

# Test endpoints
curl http://localhost:5000/api/teams
curl http://localhost:5000/api/matches
curl -X POST http://localhost:5000/api/analyze \
  -d '{"home":"Liverpool","away":"Man Utd","homeOdds":1.95,...}'
```

## Implementation Checklist

### Phase 1: Data Schema Alignment
- [ ] Standardize match record structure across both systems
- [ ] Document API contract in OpenAPI/Swagger format
- [ ] Create data migration script if needed

### Phase 2: API Layer (Backend)
- [ ] Create REST API wrapper (Flask/FastAPI)
- [ ] Implement `/api/teams`, `/api/matches`, `/api/analyze`
- [ ] Add request validation and error handling
- [ ] Support CORS for browser access

### Phase 3: API Client (Frontend)
- [ ] Build `API_CLIENT` module
- [ ] Integrate into `analyzeFixture()`
- [ ] Add fallback to local analysis
- [ ] Implement graceful degradation

### Phase 4: Synchronization
- [ ] Enhance `dynamic-history.js` for bidirectional sync
- [ ] Implement offline queue system
- [ ] Add conflict resolution logic
- [ ] Test sync under various network conditions

### Phase 5: Configuration & Deployment
- [ ] Add API endpoint configuration UI
- [ ] Support environment variables
- [ ] Document deployment steps
- [ ] Create Docker setup if needed

## Security Considerations

1. **CORS Policy**: Allow frontend domain to call backend API
2. **Input Validation**: Sanitize team names, validate odds ranges
3. **Rate Limiting**: Prevent abuse of analyze endpoint
4. **Authentication**: Consider API key or JWT for production
5. **HTTPS**: Use in production (important for credentials)

## Performance Optimization

1. **Caching**:
   - Cache `/api/teams` (rarely changes)
   - Cache recent match analyses
   - Use HTTP caching headers

2. **Batch Operations**:
   - Allow bulk match submission
   - Support batch analysis requests

3. **Pagination**:
   - Paginate `/api/matches` for large datasets
   - Implement efficient filters

## Future Enhancements

1. **Real-time Updates**: WebSocket for live match data
2. **User Accounts**: Login/sync across devices
3. **Machine Learning**: Server-side model training on historical data
4. **Mobile App**: Native frontend using same API
5. **Analytics Dashboard**: Server-side analytics and reporting

