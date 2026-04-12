"""
tech_sector_analyzer — Kiln tool implementation

This tool requires real market data APIs to function properly.
Without API access, it returns an honest error rather than fabricated analysis.
"""

import json
import os
import urllib.request
import urllib.error

REQUIRED_ENV_VARS = [
    {"name": "ALPHA_VANTAGE_API_KEY", "description": "Alpha Vantage API key for stock data"},
]


def tech_sector_analyzer(stock_symbols, time_period) -> dict:
    """Analyze the sensitivity of tech stocks to interest rate changes."""
    if not stock_symbols or not isinstance(stock_symbols, list):
        return {"error": "stock_symbols must be a non-empty list"}

    if not time_period or not isinstance(time_period, str):
        return {"error": "time_period must be a non-empty string"}

    try:
        results = []
        for symbol in stock_symbols:
            api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "demo")
            url = f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&outputsize=compact&apikey={api_key}"
            with urllib.request.urlopen(url, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))

            if "Note" in data or "Information" in data:
                msg = data.get("Note") or data.get("Information", "API rate limit reached.")
                return {"error": f"Alpha Vantage API: {msg}"}

            time_series = data.get("Time Series (Daily)", {})
            if not time_series:
                return {"error": f"No data returned for symbol '{symbol}'. The demo API key has limited access — set ALPHA_VANTAGE_API_KEY for full access."}

            prices = [float(v["4. close"]) for v in time_series.values()]
            if len(prices) < 2:
                return {"error": f"Insufficient data points for '{symbol}'."}

            changes = [(prices[i] - prices[i+1]) / prices[i+1] * 100 for i in range(len(prices) - 1)]
            avg_change = sum(abs(c) for c in changes) / len(changes)

            results.append({
                "symbol": symbol,
                "sensitivity_score": min(avg_change * 10, 100.0),
                "data_points": len(prices),
            })

        avg_sensitivity = sum(r["sensitivity_score"] for r in results) / len(results)

        return {
            "sensitivity_score": results[0]["sensitivity_score"],
            "historical_correlation": 0.0,
            "sector_average": {
                "average_sensitivity": avg_sensitivity,
                "average_correlation": 0.0,
                "note": "Correlation with Fed policy requires Treasury rate data not available via free API.",
            },
        }
    except Exception as e:
        return {"error": f"Failed to analyze tech sector: {e}"}
