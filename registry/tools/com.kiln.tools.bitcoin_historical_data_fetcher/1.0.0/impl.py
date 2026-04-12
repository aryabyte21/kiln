import json
import urllib.request
from datetime import datetime

REQUIRED_ENV_VARS = []

def bitcoin_historical_data_fetcher(days: int, currency: str) -> dict:
    """Fetch historical Bitcoin price data for a specified time range."""
    try:
        url = f"https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency={currency.lower()}&days={days}"
        headers = {"User-Agent": "KilnToolRegistry/1.0"}

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        prices = data.get("prices", [])

        formatted_prices = [
            {
                "date": datetime.fromtimestamp(price[0] / 1000).strftime("%Y-%m-%d"),
                "price": price[1]
            }
            for price in prices
        ]

        metadata = {
            "currency": currency,
            "days": days,
            "source": "CoinGecko",
            "timestamp": datetime.now().isoformat()
        }

        return {"prices": formatted_prices, "metadata": metadata}
    except Exception as e:
        return {"error": f"Failed to fetch Bitcoin historical data: {e}"}
