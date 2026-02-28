"""
tools/maps_directions/impl.py
------------------------------
Implementation for com.aria.tools.maps_directions

Uses Google Maps Directions API.
Falls back to a realistic mock if GOOGLE_MAPS_API_KEY is not set.
"""

from __future__ import annotations

import os
from typing import Any, Optional
from datetime import datetime

import requests

_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")


def run(
    origin: str,
    destination: str,
    mode: str = "driving",
    departure_time: Optional[str] = None,
) -> dict[str, Any]:
    """Get directions between two locations.

    Args:
        origin:         Start address, place name, or "lat,lon".
        destination:    End address, place name, or "lat,lon".
        mode:           "driving" | "walking" | "transit" | "bicycling".
        departure_time: ISO 8601 string for traffic-aware routing (optional).

    Returns:
        Dict with duration_mins, distance_km, steps list, and summary.
    """
    if not _API_KEY:
        return _mock_response(origin, destination, mode)

    try:
        params: dict[str, str] = {
            "origin": origin,
            "destination": destination,
            "mode": mode,
            "key": _API_KEY,
        }
        if departure_time:
            # Convert ISO 8601 to Unix timestamp for Google Maps
            try:
                dt = datetime.fromisoformat(departure_time)
                params["departure_time"] = str(int(dt.timestamp()))
            except ValueError:
                pass  # invalid time — skip parameter

        resp = requests.get(_DIRECTIONS_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()

        if data["status"] != "OK":
            return {
                "error": f"Google Maps API error: {data['status']}",
                "code": 422,
            }

        route = data["routes"][0]
        leg = route["legs"][0]

        steps = [
            _strip_html(step["html_instructions"])
            for step in leg["steps"]
        ]

        return {
            "duration_mins": round(leg["duration"]["value"] / 60, 1),
            "distance_km": round(leg["distance"]["value"] / 1000, 2),
            "steps": steps,
            "summary": route.get("summary", ""),
            "start_address": leg["start_address"],
            "end_address": leg["end_address"],
        }

    except requests.RequestException as exc:
        return {"error": f"Network error: {exc}", "code": 503}
    except Exception as exc:
        return {"error": str(exc), "code": 500}


def _strip_html(text: str) -> str:
    """Remove HTML tags from Google Maps instruction text."""
    import re
    return re.sub(r"<[^>]+>", "", text).strip()


def _mock_response(origin: str, destination: str, mode: str) -> dict[str, Any]:
    """Realistic mock response when no API key is configured."""
    mode_durations = {
        "driving": (18.5, 12.3),
        "walking": (52.0, 3.8),
        "transit": (35.0, 8.5),
        "bicycling": (28.0, 6.2),
    }
    duration_mins, distance_km = mode_durations.get(mode, (20.0, 10.0))

    mock_steps = [
        f"Head north on {origin.split(',')[0]} Rd",
        "Turn right onto Central Expressway",
        "Continue for 8.2 km",
        f"Take exit toward {destination.split(',')[0]}",
        f"Arrive at {destination.split(',')[0]}",
    ]

    return {
        "duration_mins": duration_mins,
        "distance_km": distance_km,
        "steps": mock_steps,
        "summary": "via Central Expressway",
        "start_address": origin,
        "end_address": destination,
        "_mock": True,
        "_note": "Set GOOGLE_MAPS_API_KEY for live directions",
    }
