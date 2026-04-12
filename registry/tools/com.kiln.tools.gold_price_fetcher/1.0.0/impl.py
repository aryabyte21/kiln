import json
import urllib.request
from datetime import datetime

REQUIRED_ENV_VARS = []

def gold_price_fetcher(**kwargs) -> dict:
    """Fetch the real-time gold price from a public API."""
    currency = kwargs.get("currency", "USD")

    url = "https://api.metals.dev/v1/latest?api_key=demo&currency=" + currency

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

            price = data.get("data", {}).get("price", None)
            change_24h = data.get("data", {}).get("change_percent_24h", None)
            timestamp = datetime.utcnow().isoformat()

            if price is None:
                return {"error": f"Gold price not available for currency '{currency}' from metals.dev API."}

            return {
                "price": price,
                "change_24h": change_24h if change_24h is not None else 0.0,
                "timestamp": timestamp
            }
    except Exception as e:
        return {"error": f"Failed to fetch gold price: {e}"}
