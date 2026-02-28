"""
tools/unit_converter/impl.py
------------------------------
Implementation for com.aria.tools.unit_converter

Supports:
  Length      — km, miles, meters, feet, inches, cm
  Weight      — kg, lbs, grams, ounces
  Temperature — celsius, fahrenheit, kelvin

No external dependencies — pure Python stdlib.
"""

from __future__ import annotations

from typing import Any

# Conversion factors to a common base unit (all relative to meters for length, grams for weight)
_LENGTH_TO_METERS = {
    "km":      1000.0,
    "miles":   1609.344,
    "meters":  1.0,
    "m":       1.0,
    "feet":    0.3048,
    "ft":      0.3048,
    "inches":  0.0254,
    "in":      0.0254,
    "cm":      0.01,
}

_WEIGHT_TO_GRAMS = {
    "kg":      1000.0,
    "lbs":     453.592,
    "lb":      453.592,
    "grams":   1.0,
    "g":       1.0,
    "ounces":  28.3495,
    "oz":      28.3495,
}

_TEMP_UNITS = {"celsius", "fahrenheit", "kelvin", "c", "f", "k"}

_TEMP_ALIASES = {"c": "celsius", "f": "fahrenheit", "k": "kelvin"}


def run(value: float, from_unit: str, to_unit: str) -> dict[str, Any]:
    """Convert a value between units of measurement.

    Args:
        value:     The numeric value to convert.
        from_unit: Source unit string (case-insensitive).
        to_unit:   Target unit string (case-insensitive).

    Returns:
        Dict with converted_value, from_unit, to_unit, formatted.
        On error, returns {"error": "<reason>"}.
    """
    from_unit = from_unit.lower().strip()
    to_unit   = to_unit.lower().strip()

    # Normalise temperature aliases
    from_unit = _TEMP_ALIASES.get(from_unit, from_unit)
    to_unit   = _TEMP_ALIASES.get(to_unit, to_unit)

    # Route to the right converter
    if from_unit in _LENGTH_TO_METERS and to_unit in _LENGTH_TO_METERS:
        result = _convert_length(value, from_unit, to_unit)
    elif from_unit in _WEIGHT_TO_GRAMS and to_unit in _WEIGHT_TO_GRAMS:
        result = _convert_weight(value, from_unit, to_unit)
    elif from_unit in _TEMP_UNITS and to_unit in _TEMP_UNITS:
        result = _convert_temperature(value, from_unit, to_unit)
    else:
        return {
            "error": (
                f"Unsupported or mismatched units: '{from_unit}' → '{to_unit}'. "
                "Cannot mix length, weight, and temperature."
            )
        }

    converted = round(result, 6)
    formatted = f"{value} {from_unit} = {converted} {to_unit}"

    return {
        "converted_value": converted,
        "from_unit": from_unit,
        "to_unit": to_unit,
        "formatted": formatted,
    }


def _convert_length(value: float, from_unit: str, to_unit: str) -> float:
    meters = value * _LENGTH_TO_METERS[from_unit]
    return meters / _LENGTH_TO_METERS[to_unit]


def _convert_weight(value: float, from_unit: str, to_unit: str) -> float:
    grams = value * _WEIGHT_TO_GRAMS[from_unit]
    return grams / _WEIGHT_TO_GRAMS[to_unit]


def _convert_temperature(value: float, from_unit: str, to_unit: str) -> float:
    # Convert to Celsius first, then to target
    if from_unit == "celsius":
        celsius = value
    elif from_unit == "fahrenheit":
        celsius = (value - 32) * 5 / 9
    else:  # kelvin
        celsius = value - 273.15

    if to_unit == "celsius":
        return celsius
    elif to_unit == "fahrenheit":
        return celsius * 9 / 5 + 32
    else:  # kelvin
        return celsius + 273.15
