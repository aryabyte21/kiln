import urllib.parse
import urllib.request
import json

REQUIRED_ENV_VARS = []

def geocode_fetcher(**kwargs) -> dict:
    location_name = kwargs.get("location_name", "")
    if not location_name:
        return {"error": "location_name is required"}
    
    base_url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": location_name,
        "format": "json",
    }
    
    query_string = urllib.parse.urlencode(params)
    url = f"{base_url}?{query_string}"
    
    headers = {
        "User-Agent": "YourAppName/1.0"
    }
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            if data:
                result = data[0]
                return {
                    "latitude": float(result.get("lat", 0.0)),
                    "longitude": float(result.get("lon", 0.0))
                }
            else:
                return {"error": "No results found"}
    except Exception as e:
        return {"error": f"Failed to fetch data: {str(e)}"}
