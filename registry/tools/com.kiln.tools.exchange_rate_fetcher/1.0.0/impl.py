import json
import urllib.request

REQUIRED_ENV_VARS = []


def exchange_rate_fetcher(from_currency: str, to_currency: str) -> dict:
    """Fetch the current exchange rate between two specified currencies."""
    try:
        url = f"https://open.er-api.com/v6/latest/{from_currency}"
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        rates = data.get("rates", {})
        exchange_rate = rates.get(to_currency)
        timestamp = data.get("time_last_update_utc", "")

        if exchange_rate is None:
            return {"error": f"Currency '{to_currency}' not found in exchange rates for '{from_currency}'."}

        return {
            "exchange_rate": exchange_rate,
            "timestamp": timestamp
        }
    except Exception as e:
        return {"error": f"Failed to fetch exchange rate: {e}"}
