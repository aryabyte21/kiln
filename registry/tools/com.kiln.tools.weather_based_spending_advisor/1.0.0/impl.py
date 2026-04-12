REQUIRED_ENV_VARS = []


def weather_based_spending_advisor(**kwargs) -> dict:
    """
    Recommend a reasonable spending amount for a location based on current weather conditions and local economic factors.
    """
    location = kwargs.get("location", "")
    weather_data = kwargs.get("weather_data", {})
    base_currency = kwargs.get("base_currency", "")

    # Extract temperature and weather description from weather_data
    temperature = weather_data.get("temperature", 20.0)  # Default to 20°C if not provided
    weather_description = weather_data.get("weather_description", "clear")

    # Base spending amount (arbitrary base value for demonstration)
    base_spending = 100.0

    # Adjust spending based on temperature
    if temperature > 30:
        # Hot weather: increase spending for hydration and indoor activities
        spending_amount = base_spending * 1.2
        rationale = "Hot weather increases spending on hydration and indoor activities."
    elif temperature < 10:
        # Cold weather: increase spending for warmth and comfort
        spending_amount = base_spending * 1.15
        rationale = "Cold weather increases spending on warmth and comfort."
    else:
        # Mild weather: moderate spending
        spending_amount = base_spending
        rationale = "Mild weather suggests moderate spending."

    # Adjust for weather description
    if "rain" in weather_description.lower():
        spending_amount *= 1.1
        rationale += " Rainy conditions further increase spending on indoor activities."
    elif "sunny" in weather_description.lower():
        spending_amount *= 0.95
        rationale += " Sunny conditions suggest slightly lower spending."

    return {
        "spending_amount": spending_amount,
        "rationale": rationale
    }
