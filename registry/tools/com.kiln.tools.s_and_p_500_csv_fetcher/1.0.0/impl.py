import urllib.request
from datetime import datetime

REQUIRED_ENV_VARS = []

def s_and_p_500_csv_fetcher(**kwargs) -> dict:
    """Fetch S&P 500 stock data in CSV format for a specified date."""
    date = kwargs.get("date", "")

    base_url = "https://query1.finance.yahoo.com/v7/finance/download/%5EGSPC"

    try:
        start_ts = int(datetime.strptime(date, '%Y-%m-%d').timestamp())
        end_ts = start_ts + 86400
        url = f"{base_url}?period1={start_ts}&period2={end_ts}&interval=1d&events=history&includeAdjustedClose=true"

        headers = {"User-Agent": "Mozilla/5.0"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            csv_data = response.read().decode('utf-8')

        if not csv_data.strip():
            return {"error": f"No S&P 500 data available for {date}."}

        return {
            "csv_content": csv_data,
            "source_url": url
        }
    except Exception as e:
        return {"error": f"Failed to fetch S&P 500 data: {e}"}
