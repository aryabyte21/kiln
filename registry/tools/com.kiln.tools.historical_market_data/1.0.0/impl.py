import json
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional

REQUIRED_ENV_VARS = []

def historical_market_data(
    symbol: str,
    start_date: str,
    end_date: str,
    event_keywords: Optional[str] = None,
) -> dict:
    """Fetch historical market data for commodities, stocks, or indices."""
    try:
        url = f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&outputsize=full&apikey=demo"
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        if "Note" in data or "Information" in data:
            msg = data.get("Note") or data.get("Information", "Alpha Vantage rate limit reached.")
            return {"error": f"Alpha Vantage API: {msg}"}

        time_series = data.get("Time Series (Daily)", {})
        if not time_series:
            return {"error": f"No time series data returned for symbol '{symbol}'. The demo API key has limited access."}

        historical_data = []
        for date_str, values in time_series.items():
            if start_date <= date_str <= end_date:
                historical_data.append({
                    "date": date_str,
                    "open": values.get("1. open"),
                    "high": values.get("2. high"),
                    "low": values.get("3. low"),
                    "close": values.get("4. close"),
                    "volume": values.get("5. volume"),
                })

        event_correlation = {
            "keywords": event_keywords or "",
            "summary": "No event correlation data available.",
        }

        return {
            "symbol": symbol,
            "historical_data": historical_data,
            "event_correlation": event_correlation,
        }
    except Exception as e:
        return {"error": f"Failed to fetch historical market data for '{symbol}': {e}"}
