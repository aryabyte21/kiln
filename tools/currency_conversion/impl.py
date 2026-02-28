"""
tools/currency_conversion/impl.py
-----------------------------------
Implementation for com.aria.tools.currency_conversion

Uses open.er-api.com — free, no API key required.
Falls back to a hardcoded rate table if the API is unreachable.
"""

from __future__ import annotations

from typing import Any

import requests

_API_URL = "https://open.er-api.com/v6/latest/{base}"

# Fallback rates relative to USD (used when API is unreachable)
_FALLBACK_RATES_USD = {
    "USD": 1.0,
    "SGD": 1.342,
    "EUR": 0.921,
    "GBP": 0.787,
    "JPY": 149.50,
    "AUD": 1.531,
    "CAD": 1.357,
    "CHF": 0.896,
    "CNY": 7.238,
    "INR": 83.12,
    "MYR": 4.721,
    "THB": 35.12,
    "HKD": 7.821,
    "NZD": 1.629,
    "KRW": 1325.0,
}


def run(
    amount: float,
    from_currency: str,
    to_currency: str,
) -> dict[str, Any]:
    """Convert an amount between two currencies.

    Args:
        amount:        The amount to convert.
        from_currency: Source currency ISO code (e.g. 'USD').
        to_currency:   Target currency ISO code (e.g. 'SGD').

    Returns:
        Dict with converted_amount, exchange_rate, from_currency,
        to_currency, and formatted string.
    """
    from_currency = from_currency.upper().strip()
    to_currency = to_currency.upper().strip()

    try:
        rate = _fetch_rate(from_currency, to_currency)
    except Exception:
        rate = _fallback_rate(from_currency, to_currency)

    if rate is None:
        return {
            "error": f"Unsupported currency pair: {from_currency} → {to_currency}",
            "code": 422,
        }

    converted = round(amount * rate, 4)
    formatted = f"{amount:,.2f} {from_currency} = {converted:,.2f} {to_currency}"

    return {
        "converted_amount": converted,
        "exchange_rate": round(rate, 6),
        "from_currency": from_currency,
        "to_currency": to_currency,
        "formatted": formatted,
    }


def _fetch_rate(from_currency: str, to_currency: str) -> float:
    """Fetch live exchange rate from open.er-api.com."""
    resp = requests.get(
        _API_URL.format(base=from_currency),
        timeout=8,
    )
    resp.raise_for_status()
    data = resp.json()

    if data.get("result") != "success":
        raise ValueError(f"API error: {data.get('error-type', 'unknown')}")

    rates = data.get("rates", {})
    if to_currency not in rates:
        raise ValueError(f"Currency not found: {to_currency}")

    return float(rates[to_currency])


def _fallback_rate(from_currency: str, to_currency: str) -> float | None:
    """Compute rate from hardcoded USD-based table."""
    if from_currency not in _FALLBACK_RATES_USD or to_currency not in _FALLBACK_RATES_USD:
        return None
    # Convert via USD as intermediate
    from_to_usd = 1.0 / _FALLBACK_RATES_USD[from_currency]
    usd_to_target = _FALLBACK_RATES_USD[to_currency]
    return from_to_usd * usd_to_target
