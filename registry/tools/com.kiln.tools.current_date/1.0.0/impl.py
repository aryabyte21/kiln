import requests
from datetime import datetime

REQUIRED_ENV_VARS = []

def current_date(**kwargs) -> dict:
    """Fetch the current date and time in a specified format."""
    try:
        # Fetch current time from WorldTimeAPI
        response = requests.get("http://worldtimeapi.org/api/timezone/Europe/London", timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Extract datetime string and convert to datetime object
        datetime_str = data.get("datetime")
        if not datetime_str:
            return {"error": "Invalid API response: missing datetime field"}
        
        dt = datetime.fromisoformat(datetime_str)
        
        # Handle format parameter
        format_str = kwargs.get("format")
        if format_str:
            try:
                formatted_date = dt.strftime(format_str)
            except ValueError:
                return {"error": f"Invalid format string: {format_str}"}
        else:
            # Default format: ISO 8601
            formatted_date = dt.isoformat()
        
        # Calculate Unix timestamp
        timestamp = int(dt.timestamp())
        
        return {
            "date": formatted_date,
            "timestamp": timestamp
        }
    except requests.RequestException as e:
        # Fallback to local time if API fails
        dt = datetime.now()
        format_str = kwargs.get("format")
        if format_str:
            try:
                formatted_date = dt.strftime(format_str)
            except ValueError:
                return {"error": f"Invalid format string: {format_str}"}
        else:
            formatted_date = dt.isoformat()
        timestamp = int(dt.timestamp())
        return {
            "date": formatted_date,
            "timestamp": timestamp
        }
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}
