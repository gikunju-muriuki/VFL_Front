import sys
import json
import os
import re
from datetime import datetime, timezone

TEAM_TIERS = {
    "London Blues": 1, "Liverpool": 1, "Manchester Blue": 1, "London Reds": 1,
    "Manchester Reds": 2, "Aston V": 2, "Newcastle": 2, "Tottenham": 2, "Everton": 2,
    "Leicester": 3, "West Brom": 3, "Wolves": 3, "Palace": 3, "Brighton": 3, "West Ham": 3,
    "Leeds": 4, "Burnley": 4, "Fulham": 4, "Southampton": 4, "Sheffield U": 4,
}
VALID_TEAMS = sorted(TEAM_TIERS)
HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "match_history.json")


def load_history():
    try:
        with open(HISTORY_FILE, encoding="utf-8") as file:
            data = json.load(file)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def save_match(home, away, home_goals, away_goals):
    history = load_history()
    history.append({
        "home": home, "away": away,
        "home_goals": int(home_goals), "away_goals": int(away_goals),
        "saved_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as file:
            json.dump(history, file, indent=2)
        print(f"Saved result: {home} {home_goals}-{away_goals} {away}")
    except OSError as error:
        print(f"Warning: could not save match history: {error}")


def parse_result(text):
    score = re.search(r"\b(\d+)\s*[-:]\s*(\d+)\b", text)
    if not score:
        return None
    before, after = text[:score.start()], text[score.end():]

    def find_team(value):
        value = value.strip().lower()
        return next((team for team in VALID_TEAMS if team.lower() == value), None)

    home, away = find_team(before), find_team(after)
    if home and away and home != away:
        return home, away, int(score.group(1)), int(score.group(2))
    return None


def head_to_head(home, away):
    meetings = []
    for match in load_history():
        if {match.get("home"), match.get("away")} == {home, away}:
            if match["home"] == home:
                meetings.append((match["home_goals"], match["away_goals"], match))
            else:
                meetings.append((match["away_goals"], match["home_goals"], match))
    return meetings


def display_team_menu():
    print("\n=============================================")
    print("      VIRTUAL FOOTBALL ENGINE CRACKER")
    print("=============================================")
    for index, team in enumerate(VALID_TEAMS, 1):
        print(f"{index:2d}. {team:<20}", end="" if index % 2 else "\n")
    print("\n=============================================")


def get_team_selection(prompt):
    while True:
        try:
            choice = int(input(prompt))
            if 1 <= choice <= len(VALID_TEAMS):
                return VALID_TEAMS[choice - 1]
        except ValueError:
            pass
        print(f"Error: choose a number from 1 to {len(VALID_TEAMS)}.")


def get_float_input(prompt):
    while True:
        try:
            value = float(input(prompt))
            if value > 1:
                return value
        except ValueError:
            pass
        print("Error: odds must be a valid number greater than 1.0.")


def analyze_fixture(home, away, h_odds, d_odds, a_odds):
    raw = [1 / h_odds, 1 / d_odds, 1 / a_odds]
    margin = sum(raw)
    probabilities = [value / margin for value in raw]
    differential = TEAM_TIERS[away] - TEAM_TIERS[home]
    templates = []

    # Base prediction logic remains the anchor.
    if h_odds <= 1.45 or a_odds <= 1.45:
        favorite = home if h_odds <= 1.45 else away
        prediction = f"DRAW (X) or {favorite} Narrow Win"
        confidence = "MEDIUM-LOW (High Upset Probability)"
        risk = "CRITICAL: heavy-favorite trap; 0-0/1-1 is possible."
        templates = ["0-0_A", "1-1_C", "1-0_B"]
    elif h_odds < d_odds and h_odds < a_odds and differential >= 1:
        prediction = f"HOME WIN (1) - {home}" if h_odds <= 1.85 else "HOME WIN (1) or DRAW (X)"
        confidence = "HIGH" if h_odds <= 1.85 else "MEDIUM"
        risk = "NONE"
        templates = ["2-0_A", "3-1_A"]
    elif a_odds < d_odds and a_odds < h_odds and differential <= -1:
        prediction = f"AWAY WIN (2) - {away}" if a_odds <= 1.85 else "AWAY WIN (2) or DRAW (X)"
        confidence = "HIGH" if a_odds <= 1.85 else "MEDIUM"
        risk = "NONE"
        templates = ["1-2_A", "1-3_B"]
    else:
        prediction = "DRAW (X)"
        confidence = "MEDIUM"
        risk = "HIGH DRAW MATRIX: under-2.5 goals are possible."
        templates = ["1-1_A", "0-0_A"]

    meetings = head_to_head(home, away)
    if meetings:
        home_wins = sum(hg > ag for hg, ag, _ in meetings)
        away_wins = sum(ag > hg for hg, ag, _ in meetings)
        draws = len(meetings) - home_wins - away_wins
        avg_home = sum(hg for hg, _, _ in meetings) / len(meetings)
        avg_away = sum(ag for _, ag, _ in meetings) / len(meetings)
        print("\n--- Historical head-to-head data ---")
        print(f"Meetings: {len(meetings)} | Home wins: {home_wins} | Away wins: {away_wins} | Draws: {draws}")
        print(f"Average goals in this fixture order: {avg_home:.2f}-{avg_away:.2f}")
        print("Recent: " + ", ".join(f"{hg}-{ag}" for hg, ag, _ in meetings[-5:]))
        # Historical data streamlines only confidence; base outcome is preserved.
        if len(meetings) >= 2:
            if "HOME" in prediction and home_wins / len(meetings) >= 0.6:
                confidence = "VERY HIGH"
            elif "AWAY" in prediction and away_wins / len(meetings) >= 0.6:
                confidence = "VERY HIGH"
            elif "DRAW" in prediction and draws / len(meetings) >= 0.6:
                confidence = "HIGH"

    print("\n=============================================")
    print("             CRACKER DATA OUTPUT")
    print("=============================================")
    print(f"Matchup:         {home} (Tier {TEAM_TIERS[home]}) vs {away} (Tier {TEAM_TIERS[away]})")
    print(f"True Math Odds:  Home: {probabilities[0]*100:.1f}% | Draw: {probabilities[1]*100:.1f}% | Away: {probabilities[2]*100:.1f}%")
    print(f"Bookie Margin:   {(margin - 1) * 100:.2f}% Extra Profit Margin Detected")
    print(f"PROBABLE WINNER: {prediction}")
    print(f"ALGO CONFIDENCE: {confidence}")
    print(f"RISK ASSESSMENT: {risk}")
    print("MATCH TIMELINE TEMPLATES: " + ", ".join(templates))
    print("=============================================\n")


def main():
    while True:
        pasted = input("Paste a completed result (Team A 2-1 Team B), or press Enter to continue: ").strip()
        if pasted:
            parsed = parse_result(pasted)
            if parsed:
                save_match(*parsed)
            else:
                print("Could not parse it. Use exact team names and a score such as 2-1.")

        display_team_menu()
        home = get_team_selection("Enter Home Team Number: ")
        while True:
            away = get_team_selection("Enter Away Team Number: ")
            if away != home:
                break
            print("Error: a team cannot play against itself.")
        h_odds = get_float_input(f"Enter {home} Win Odds (1): ")
        d_odds = get_float_input("Enter Draw Odds (X): ")
        a_odds = get_float_input(f"Enter {away} Win Odds (2): ")
        analyze_fixture(home, away, h_odds, d_odds, a_odds)

        score = input("Save the actual final score as A-B (or press Enter to skip): ").strip()
        parsed_score = re.fullmatch(r"(\d+)\s*[-:]\s*(\d+)", score)
        if parsed_score:
            save_match(home, away, int(parsed_score.group(1)), int(parsed_score.group(2)))
        elif score:
            print("Invalid score; nothing was saved.")
        if input("Crack another match? (y/n): ").strip().lower() != "y":
            print("Exiting Cracker Engine. Good luck!")
            sys.exit()


if __name__ == "__main__":
    main()
