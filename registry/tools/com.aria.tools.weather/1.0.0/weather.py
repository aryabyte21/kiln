"""
weather.py — Babel tool implementation
───────────────────────────────────────
Mock implementation. Replace the return statement with a real
OpenWeatherMap (or similar) API call.

No framework imports. Pure Python only.
"""


def get_weather(location: str, units: str = "celsius") -> dict:
    # ── Real API call goes here ──────────────────────────────────────────
    # import requests
    # resp = requests.get(
    #     "https://api.openweathermap.org/data/2.5/weather",
    #     params={"q": location, "units": "metric" if units == "celsius" else "imperial",
    #             "appid": os.environ["OPENWEATHER_API_KEY"]},
    # )
    # data = resp.json()
    # return {"location": data["name"], "temperature": data["main"]["temp"], ...}
    # ────────────────────────────────────────────────────────────────────

    return {
        "location":    location,
        "temperature": 28 if units == "celsius" else 82,
        "units":       units,
        "conditions":  "Partly cloudy",
        "humidity":    75,
        "forecast":    "Chance of afternoon showers",
        "success":     True,
    }
