"""
currency_convert.py — Babel tool implementation
────────────────────────────────────────────────
Mock implementation using fixed exchange rates pegged to USD.
Replace with a live FX API (e.g. exchangerate-api.com) in production.

No framework imports. Pure Python only.
"""


def currency_convert(amount: float, from_currency: str, to_currency: str) -> dict:
    # ── Real API call goes here ──────────────────────────────────────────
    # import requests
    # resp = requests.get(
    #     f"https://api.exchangerate-api.com/v4/latest/{from_currency}",
    #     headers={"Authorization": f"Bearer {os.environ['FX_API_KEY']}"},
    # )
    # rates = resp.json()["rates"]
    # converted = amount * rates[to_currency]
    # ────────────────────────────────────────────────────────────────────

    rates_to_usd = {
        "USD": 1.0000,
        "SGD": 0.7410,
        "EUR": 1.0820,
        "GBP": 1.2710,
        "JPY": 0.0067,
    }

    if from_currency not in rates_to_usd or to_currency not in rates_to_usd:
        return {"error": "Unsupported currency pair", "success": False}

    usd_amount = amount * rates_to_usd[from_currency]
    converted  = usd_amount / rates_to_usd[to_currency]
    rate       = rates_to_usd[from_currency] / rates_to_usd[to_currency]

    return {
        "amount":        amount,
        "from_currency": from_currency,
        "to_currency":   to_currency,
        "converted":     round(converted, 2),
        "rate":          round(rate, 6),
        "success":       True,
    }
