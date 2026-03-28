"""
maps_directions.py
------------------
Get directions between two locations using OpenRouteService (ORS).
Requires env var: ORS_API_KEY  (free tier at openrouteservice.org)
"""

import os

REQUIRED_ENV_VARS = [
    {"name": "ORS_API_KEY", "description": "OpenRouteService API key from openrouteservice.org (free tier available)"},
]


def _geocode(location: str, api_key: str) -> tuple[float, float] | None:
    """Convert a place name or 'lat,lng' string to (lng, lat) tuple for ORS."""
    import requests

    location = location.strip()
    # If already 'lat,lng' format
    parts = location.split(",")
    if len(parts) == 2:
        try:
            lat, lng = float(parts[0].strip()), float(parts[1].strip())
            return lng, lat  # ORS wants [lng, lat]
        except ValueError:
            pass

    # Geocode via ORS
    resp = requests.get(
        "https://api.openrouteservice.org/geocode/search",
        params={"api_key": api_key, "text": location, "size": 1},
        timeout=10,
    )
    resp.raise_for_status()
    features = resp.json().get("features", [])
    if not features:
        return None
    coords = features[0]["geometry"]["coordinates"]  # [lng, lat]
    return tuple(coords)


def maps_directions(origin: str, destination: str, mode: str = "driving-car") -> dict:
    """
    Get turn-by-turn directions between two locations.

    Args:
        origin:      Starting location (address or 'lat,lng').
        destination: Destination location (address or 'lat,lng').
        mode:        Travel mode — 'driving-car', 'cycling-regular', 'foot-walking'.

    Returns:
        dict with keys: origin, destination, mode, distance_km,
                        duration_minutes, steps, success
    """
    try:
        import requests

        api_key = os.environ.get("ORS_API_KEY", "").strip()
        if not api_key:
            return {
                "origin": origin, "destination": destination, "mode": mode,
                "success": False,
                "error": "ORS_API_KEY environment variable not set",
            }

        valid_modes = {"driving-car", "cycling-regular", "foot-walking",
                       "driving-hgv", "cycling-mountain", "cycling-electric",
                       "foot-hiking", "wheelchair"}
        if mode not in valid_modes:
            mode = "driving-car"

        origin_coords = _geocode(origin, api_key)
        dest_coords   = _geocode(destination, api_key)

        if not origin_coords:
            return {"origin": origin, "destination": destination, "mode": mode,
                    "success": False, "error": f"Could not geocode origin: {origin}"}
        if not dest_coords:
            return {"origin": origin, "destination": destination, "mode": mode,
                    "success": False, "error": f"Could not geocode destination: {destination}"}

        resp = requests.post(
            f"https://api.openrouteservice.org/v2/directions/{mode}",
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            json={"coordinates": [list(origin_coords), list(dest_coords)],
                  "instructions": True, "language": "en"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        route   = data["routes"][0]
        summary = route["summary"]
        distance_km      = round(summary["distance"] / 1000, 2)
        duration_minutes = round(summary["duration"] / 60, 1)

        steps = []
        for seg in route.get("segments", []):
            for step in seg.get("steps", []):
                instruction = step.get("instruction", "").strip()
                if instruction:
                    steps.append(instruction)

        return {
            "origin":           origin,
            "destination":      destination,
            "mode":             mode,
            "distance_km":      distance_km,
            "duration_minutes": duration_minutes,
            "steps":            steps,
            "success":          True,
        }

    except Exception as exc:
        return {
            "origin": origin, "destination": destination, "mode": mode,
            "success": False, "error": str(exc),
        }
