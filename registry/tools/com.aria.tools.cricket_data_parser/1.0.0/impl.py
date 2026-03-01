import re
import json
from typing import Dict, List, Any

REQUIRED_ENV_VARS = []

def parse_plain_text(content: str) -> Dict[str, Any]:
    """Parse plain-text content to extract cricket match details."""
    matches = []
    match_details = {}
    live_updates = []
    
    # Extract team names
    team_pattern = r"([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)"
    team_match = re.search(team_pattern, content)
    if team_match:
        team1, team2 = team_match.groups()
        match_details["team-1"] = team1.strip()
        match_details["team-2"] = team2.strip()
    
    # Extract scores
    score_pattern = r"(\d+)/(\d+)"
    score_matches = re.findall(score_pattern, content)
    if score_matches:
        match_details["score"] = score_matches[0]
    
    # Extract match status
    status_pattern = r"Status:\s*([A-Za-z\s]+)"
    status_match = re.search(status_pattern, content)
    if status_match:
        match_details["status"] = status_match.group(1).strip()
    
    # Extract commentary or live updates
    commentary_pattern = r"Commentary:\s*([A-Za-z\s,.;]+)"
    commentary_match = re.search(commentary_pattern, content)
    if commentary_match:
        live_updates.append(commentary_match.group(1).strip())
    
    if match_details:
        matches.append(match_details)
    
    return {
        "matches": matches,
        "match_details": match_details,
        "live_updates": live_updates
    }

def parse_html(content: str) -> Dict[str, Any]:
    """Parse HTML content to extract cricket match details."""
    matches = []
    match_details = {}
    live_updates = []
    
    # Extract team names from HTML
    team_pattern = r"<div class=[\"']team[\"']>([^<]+)</div>"
    team_matches = re.findall(team_pattern, content)
    if len(team_matches) >= 2:
        match_details["team-1"] = team_matches[0].strip()
        match_details["team-2"] = team_matches[1].strip()
    
    # Extract scores from HTML
    score_pattern = r"<div class=[\"']score[\"']>(\d+)/(\d+)</div>"
    score_matches = re.findall(score_pattern, content)
    if score_matches:
        match_details["score"] = score_matches[0]
    
    # Extract match status from HTML
    status_pattern = r"<div class=[\"']status[\"']>([^<]+)</div>"
    status_match = re.search(status_pattern, content)
    if status_match:
        match_details["status"] = status_match.group(1).strip()
    
    # Extract commentary or live updates from HTML
    commentary_pattern = r"<div class=[\"']commentary[\"']>([^<]+)</div>"
    commentary_matches = re.findall(commentary_pattern, content)
    if commentary_matches:
        live_updates.extend([c.strip() for c in commentary_matches])
    
    if match_details:
        matches.append(match_details)
    
    return {
        "matches": matches,
        "match_details": match_details,
        "live_updates": live_updates
    }

def cricket_data_parser(**kwargs) -> Dict[str, Any]:
    """Parse plain-text or HTML content from cricket websites to extract structured match details."""
    content = kwargs.get("content", "")
    
    if not content:
        return {"error": "No content provided"}
    
    # Determine if content is HTML or plain text
    if "<html>" in content.lower() or "<div>" in content.lower():
        result = parse_html(content)
    else:
        result = parse_plain_text(content)
    
    return result
