import json
import urllib.request
from datetime import datetime, timedelta

REQUIRED_ENV_VARS = []

def bitcoin_historical_data_fetcher(days: int, currency: str) -> dict:
    """Fetch historical Bitcoin price data for a specified time range."""
    try:
        # Use CoinGecko API
        url = f"https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency={currency.lower()}&days={days}"
        headers = {"User-Agent": "YourAppName"}
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
        
        prices = data.get("prices", [])
        
        # Format prices
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
        # Local fallback if API fails
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        fallback_prices = []
        current_date = start_date
        while current_date <= end_date:
            fallback_prices.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "price": 50000.0  # Fallback price
            })
            current_date += timedelta(days=1)
        
        metadata = {
            "currency": currency,
            "days": days,
            "source": "Local Fallback",
            "timestamp": datetime.now().isoformat()
        }
        
        return {"prices": fallback_prices, "metadata": metadata}
