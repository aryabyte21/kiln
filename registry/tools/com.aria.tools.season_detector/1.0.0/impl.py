from datetime import datetime

REQUIRED_ENV_VARS = []


def determine_season(date_str, hemisphere):
    """Determine the season based on the date and hemisphere."""
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return {"error": "Invalid date format. Use YYYY-MM-DD."}
    
    month = date_obj.month
    day = date_obj.day
    
    if hemisphere.lower() == "northern":
        if (month == 12 and day >= 21) or month in [1, 2] or (month == 3 and day < 20):
            return "Winter"
        elif (month == 3 and day >= 20) or month in [4, 5] or (month == 6 and day < 21):
            return "Spring"
        elif (month == 6 and day >= 21) or month in [7, 8] or (month == 9 and day < 22):
            return "Summer"
        elif (month == 9 and day >= 22) or month in [10, 11] or (month == 12 and day < 21):
            return "Autumn"
        else:
            return "Winter"
    elif hemisphere.lower() == "southern":
        if (month == 6 and day >= 21) or month in [7, 8] or (month == 9 and day < 22):
            return "Winter"
        elif (month == 9 and day >= 22) or month in [10, 11] or (month == 12 and day < 21):
            return "Spring"
        elif (month == 12 and day >= 21) or month in [1, 2] or (month == 3 and day < 20):
            return "Summer"
        elif (month == 3 and day >= 20) or month in [4, 5] or (month == 6 and day < 21):
            return "Autumn"
        else:
            return "Summer"
    else:
        return {"error": "Invalid hemisphere. Use 'Northern' or 'Southern'."}


def season_detector(**kwargs) -> dict:
    """Determine the current season based on a given date and hemisphere."""
    date_str = kwargs.get("date", "")
    hemisphere = kwargs.get("hemisphere", "Northern")
    
    result = determine_season(date_str, hemisphere)
    
    if isinstance(result, dict) and "error" in result:
        return result
    else:
        return {"season": result}
