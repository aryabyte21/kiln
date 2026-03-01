import json
import urllib.request
from datetime import datetime

REQUIRED_ENV_VARS = []


def exchange_rate_fetcher(from_currency: str, to_currency: str) -> dict:
    """Fetch the current exchange rate between two specified currencies."""
    try:
        # Fetch exchange rates from the API
        url = f"https://open.er-api.com/v6/latest/{from_currency}"
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        
        # Extract the exchange rate and timestamp
        rates = data.get("rates", {})
        exchange_rate = rates.get(to_currency)
        timestamp = data.get("time_last_update_utc", "")
        
        if exchange_rate is None:
            # Fallback to a local computation if the API fails
            fallback_rate = 1.0
            fallback_timestamp = datetime.utcnow().isoformat()
            return {
                "exchange_rate": fallback_rate,
                "timestamp": fallback_timestamp
            }
        
        return {
            "exchange_rate": exchange_rate,
            "timestamp": timestamp
        }
    except Exception as e:
        # Fallback to a local computation if the API fails
        fallback_rate = 1.0
        fallback_timestamp = datetime.utcnow().isoformat()
        return {
            "exchange_rate": fallback_rate,
            "timestamp": fallback_timestamp
        }
