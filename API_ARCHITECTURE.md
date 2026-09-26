# Unified Brain Architecture (No External Dependencies)

## Design Principle
**One unified prediction engine that lives in the browser (IndexedDB), with Python as a local utility for batch processing and data export/import.**

## System Flow

```
Browser (Frontend)
├── IndexedDB (Source of Truth)
│   ├── Match history
│   ├── Predictions
│   ├── Team tiers
│   └── Statistical analysis
├── script.js (Prediction Engine)
├── dynamic-history.js (Data Sync)
└── Export to JSON ←→ Python scripts

Python (Local Utility)
├── Import JSON from browser
├── Batch analysis
├── Statistical calculations
├── Export results back to JSON
└── (Does NOT run a server)
```

## No External Files/Servers

✅ **What stays in repo:**
- `index.html` - Main UI
- `script.js` - Prediction engine & IndexedDB management
- `dynamic-history.js` - Simplified for local IndexedDB only
- `index.py` - Converts to utility script for batch processing
- `sw.js` - Service worker for offline support
- Match data stored entirely in IndexedDB (in browser memory/storage)

❌ **What's removed:**
- External API endpoints
- Node server
- Database backend
- External storage

## Data Flow: Browser ↔ Python

### Export Flow (Browser → Python)
1. User clicks "Export Data" in browser
2. IndexedDB → JSON file (automatic download)
3. User runs: `python analyze_batch.py exported_data.json`
4. Python produces enhanced JSON with deeper analytics
5. User imports results back into browser

### Import Flow (Python → Browser)
1. Python script creates/updates `match_data.json`
2. User copies JSON content
3. Browser UI paste → Import button
4. JSON → IndexedDB (automatic sync)

## Single Unified Brain

### JavaScript (script.js)
- **Core engine**: All prediction logic from index.py ported to JS
- **Database**: IndexedDB (persists across sessions)
- **Analysis**: Real-time fixture analysis using cached team stats
- **Exports**: JSON for Python, CSV for spreadsheets

### Python (analyze_batch.py)
- **Input**: JSON file from browser export
- **Process**: Deeper statistical analysis, head-to-head patterns
- **Output**: Enhanced JSON with detailed metrics
- **Purpose**: Utility for advanced analysis, not replacement engine

## File Structure

```
repo/
├── index.html              # Main UI (unchanged)
├── script.js               # Complete prediction engine
├── dynamic-history.js      # Local IndexedDB sync only
├── sw.js                   # Service worker (unchanged)
├── analyze_batch.py        # Python utility (NEW)
├── utils.py                # Shared Python functions (NEW)
├── match_data.json         # Optional: template/seed data
└── API_ARCHITECTURE.md     # This file
```

## Implementation Plan

### Phase 1: Move all Python logic to JavaScript
- Port `analyze_fixture()` completely to JS
- Port team tier system to JS
- Port h2h analysis to JS
- All logic runs in browser, powered by IndexedDB

### Phase 2: Enhance dynamic-history.js
- Remove API calls
- Keep only IndexedDB operations
- Add export/import handlers
- Support offline-only workflow

### Phase 3: Create Python utility
- `analyze_batch.py`: Accept JSON, produce enhanced analytics
- `utils.py`: Shared helper functions (can be imported by both systems if needed)
- Can be run locally anytime for deeper analysis

### Phase 4: Update UI
- Add Export Data button (already exists in script.js)
- Add Import Data UI (already exists)
- Add "Run Advanced Analysis" button (calls Python script instructions)

## Usage Example

### Scenario 1: Online in Browser (No Python)
```
1. Open index.html
2. Paste gameweek data
3. Get predictions instantly (all from JS engine)
4. Enter results
5. Data auto-saves to IndexedDB
6. Close tab = data persists
```

### Scenario 2: Batch Analysis with Python
```
1. Browser: Click "Export Data" → download matches.json
2. Terminal: python analyze_batch.py matches.json
3. Check output: enhanced_matches.json with stats
4. Browser: Import enhanced data back
```

### Scenario 3: Seed Data (Python → Browser)
```
1. Terminal: python generate_seed.py  # Creates match_data.json
2. Browser: Copy JSON content
3. Browser: Import Data → paste → Import
4. All historical data loads into IndexedDB
```

## API Removed, Simplified to Pure Functions

### JavaScript Engine (All in script.js)
```javascript
// Core analysis function
analyzeFixture(home, away, hOdds, dOdds, aOdds) {
  // Same logic as Python index.py
  // Uses team tiers
  // Uses historical data from IndexedDB
  // Returns prediction + confidence
}

// Head-to-head analysis
getHeadToHead(team1, team2) {
  // Query IndexedDB
  // Calculate win rates
  // Return statistics
}

// Export to JSON
exportToJSON() {
  // Get all IndexedDB data
  // Stringify with formatting
  // Trigger download
}

// Import from JSON
importFromJSON(jsonString) {
  // Parse JSON
  // Validate structure
  // Save to IndexedDB
}
```

### Python Utility (New: analyze_batch.py)
```python
def process_matches(json_file):
    """Load exported matches, add deep analysis"""
    with open(json_file) as f:
        matches = json.load(f)
    
    # Add confidence boosters
    # Calculate historical accuracy
    # Generate advanced metrics
    
    return enhanced_matches

def main():
    # CLI: python analyze_batch.py input.json
    # Produces: input_enhanced.json
```

## Data Structure (Single Schema)

All systems use this unified match object:

```javascript
{
  id: 1,
  home: "Liverpool",
  away: "Manchester United",
  homeTier: 1,
  awayTier: 2,
  homeOdds: 1.95,
  drawOdds: 3.20,
  awayOdds: 4.00,
  prediction: "1",
  confidence: "HIGH",
  actualHomeGoals: 2,
  actualAwayGoals: 1,
  result: "1",
  totalGoals: 3,
  timestamp: "2026-09-26T14:30:00Z",
  matchup: "Liverpool vs Manchester United",
  // Optional: added by Python analysis
  deepAnalysis: {
    h2hWinRate: 0.65,
    homeFormTrend: "↑",
    awayFormTrend: "↓",
    statisticalAccuracy: 0.78
  }
}
```

## Offline Guarantee

- ✅ Browser works 100% offline
- ✅ All prediction logic runs client-side
- ✅ IndexedDB persists everything locally
- ✅ Service worker enables offline usage
- ✅ Python script for enhancement (optional, runs locally)

## No External Dependencies

- ❌ No remote API
- ❌ No server
- ❌ No database backend
- ❌ No cloud storage
- ❌ No authentication required
- ✅ Just Git repo + IndexedDB + optional local Python

## Benefits

1. **Zero latency** - Browser is the source of truth
2. **Complete offline** - Works with no internet
3. **No data leaks** - Everything stays on device
4. **Portable** - Just open HTML file in browser
5. **Optional enhancement** - Python adds depth when needed
6. **Version controlled** - All data/logic in Git
7. **Simple deployment** - No infrastructure needed

## This Creates Your "One Brain"

The JavaScript engine in the browser IS the unified brain. It:
- Analyzes fixtures in real-time
- Stores results in IndexedDB
- Ports all Python logic from index.py
- Can export data for Python to enhance
- Never depends on external services

Python becomes a **companion tool** for deeper analysis, not the core system.

