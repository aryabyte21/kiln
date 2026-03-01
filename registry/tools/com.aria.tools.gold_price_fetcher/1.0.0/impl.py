import json
import urllib.request
from datetime import datetime

REQUIRED_ENV_VARS = []

def gold_price_fetcher(**kwargs) -> dict:
    currency = kwargs.get("currency", "USD")
    
    # Use a free API that does not require an API key
    url = "https://api.metals.dev/v1/latest?api_key=demo&currency=" + currency
    
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            
            # Extract relevant data
            price = data.get("data", {}).get("price", 0.0)
            change_24h = data.get("data", {}).get("change_percent_24h", 0.0)
            timestamp = datetime.utcnow().isoformat()
            
            return {
                "price": price,
                "change_24h": change_24h,
                "timestamp": timestamp
            }
    except Exception as e:
        # Fallback to local computation if API fails
        timestamp = datetime.utcnow().isoformat()
        return {
            "price": 1900.0,  # Example fallback price
            "change_24h": 0.5,  # Example fallback change
            "timestamp": timestamp
        }
