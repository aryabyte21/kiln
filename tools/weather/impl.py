"""
tools/weather/impl.py
---------------------
Implementation for com.aria.tools.weather

Uses OpenWeatherMap Current Weather + One Call API.
Falls back to a realistic mock response if OPENWEATHERMAP_API_KEY is not set
(so the demo always works even without the key).
"""

from __future__ import annotations

import os
from typing import Any

import requests

_BASE_URL = "https://api.openweathermap.org/data/2.5"
_GEO_URL = "https://api.openweathermap.org/geo/1.0"
_API_KEY = os.getenv("OPENWEATHERMAP_API_KEY", "")


def run(
    location: str,
    units: str = "metric",
    forecast_days: int = 0,
) -> dict[str, Any]:
    """Fetch current weather and optional forecast for a location.

    Args:
        location:      City name, "City, Country", or "lat,lon".
        units:         "metric" | "imperial" | "standard".
        forecast_days: 0–5. 0 returns current conditions only.

    Returns:
        Dict with temperature, feels_like, conditions, humidity, wind_speed,
        location_name, and optionally forecast list.
    """
    if not _API_KEY:
        return _mock_response(location, units, forecast_days)

    try:
        lat, lon, resolved_name = _resolve_location(location)
        current = _fetch_current(lat, lon, units)
        forecast = _fetch_forecast(lat, lon, units, forecast_days) if forecast_days > 0 else []

        return {
            "temperature": current["main"]["temp"],
            "feels_like": current["main"]["feels_like"],
            "conditions": current["weather"][0]["description"],
            "humidity": current["main"]["humidity"],
            "wind_speed": current["wind"]["speed"],
            "location_name": resolved_name,
            "forecast": forecast,
        }
    except requests.RequestException as exc:
        return {"error": f"Network error: {exc}", "code": 503}
    except Exception as exc:
        return {"error": str(exc), "code": 500}


def _resolve_location(location: str) -> tuple[float, float, str]:
    """Resolve location string to (lat, lon, display_name)."""
    # Check if already lat,lon
    if "," in location:
        parts = location.split(",")
        try:
            lat, lon = float(parts[0].strip()), float(parts[1].strip())
            return lat, lon, location
        except ValueError:
            pass  # Not lat,lon — fall through to geocoding

    # Geocode via OpenWeatherMap Geo API
    resp = requests.get(
        f"{_GEO_URL}/direct",
        params={"q": location, "limit": 1, "appid": _API_KEY},
        timeout=8,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data:
        raise ValueError(f"Location not found: {location!r}")

    geo = data[0]
    name = f"{geo['name']}, {geo.get('country', '')}"
    return geo["lat"], geo["lon"], name


def _fetch_current(lat: float, lon: float, units: str) -> dict:
    """Fetch current weather from OpenWeatherMap."""
    resp = requests.get(
        f"{_BASE_URL}/weather",
        params={"lat": lat, "lon": lon, "units": units, "appid": _API_KEY},
        timeout=8,
    )
    resp.raise_for_status()
    return resp.json()


def _fetch_forecast(lat: float, lon: float, units: str, days: int) -> list[dict]:
    """Fetch daily forecast (up to 5 days) from OpenWeatherMap."""
    resp = requests.get(
        f"{_BASE_URL}/forecast",
        params={"lat": lat, "lon": lon, "units": units, "cnt": days * 8, "appid": _API_KEY},
        timeout=8,
    )
    resp.raise_for_status()
    data = resp.json()

    # Aggregate 3-hour blocks into daily summaries
    daily: dict[str, dict] = {}
    for item in data.get("list", []):
        date = item["dt_txt"].split(" ")[0]
        if date not in daily:
            daily[date] = {
                "date": date,
                "high": item["main"]["temp_max"],
                "low": item["main"]["temp_min"],
                "conditions": item["weather"][0]["description"],
            }
        else:
            daily[date]["high"] = max(daily[date]["high"], item["main"]["temp_max"])
            daily[date]["low"] = min(daily[date]["low"], item["main"]["temp_min"])

    return list(daily.values())[:days]


def _mock_response(location: str, units: str, forecast_days: int) -> dict[str, Any]:
    """Realistic mock response for when no API key is present."""
    unit_symbol = "°C" if units == "metric" else ("°F" if units == "imperial" else "K")
    base_temp = 28.5 if units == "metric" else 83.3

    forecast = []
    if forecast_days > 0:
        import datetime
        today = datetime.date.today()
        for i in range(1, forecast_days + 1):
            day = today + datetime.timedelta(days=i)
            forecast.append({
                "date": day.isoformat(),
                "high": round(base_temp + 1.5, 1),
                "low": round(base_temp - 3.0, 1),
                "conditions": "partly cloudy",
            })

    return {
        "temperature": base_temp,
        "feels_like": round(base_temp + 2.0, 1),
        "conditions": "partly cloudy",
        "humidity": 72,
        "wind_speed": 4.2,
        "location_name": location,
        "forecast": forecast,
        "_mock": True,
        "_note": "Set OPENWEATHERMAP_API_KEY for live data",
    }
