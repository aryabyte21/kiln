REQUIRED_ENV_VARS = []

import json
import random
from datetime import datetime


def stock_recommendation_engine(
    geopolitical_risk_assessment: dict,
    historical_market_data: dict,
    sectors_of_interest: list = None,
) -> dict:
    """
    Recommend US stocks to invest in based on geopolitical risks, market trends, and sector resilience.
    """
    if sectors_of_interest is None:
        sectors_of_interest = []

    # Mock data for sectors and stocks
    sector_data = {
        "defense": {
            "stocks": [
                {"ticker": "LMT", "name": "Lockheed Martin", "rationale": "Defense sector benefits from increased military spending during geopolitical tensions."},
                {"ticker": "RTX", "name": "Raytheon Technologies", "rationale": "Defense and aerospace contractor with strong government contracts."},
            ],
            "analysis": "Defense sector is resilient during geopolitical conflicts due to increased government spending.",
        },
        "energy": {
            "stocks": [
                {"ticker": "XOM", "name": "ExxonMobil", "rationale": "Energy sector benefits from supply disruptions and higher commodity prices."},
                {"ticker": "CVX", "name": "Chevron", "rationale": "Strong balance sheet and global operations."},
            ],
            "analysis": "Energy sector is resilient during geopolitical conflicts due to supply disruptions and higher commodity prices.",
        },
        "tech": {
            "stocks": [
                {"ticker": "AAPL", "name": "Apple", "rationale": "Strong brand and diversified revenue streams."},
                {"ticker": "MSFT", "name": "Microsoft", "rationale": "Cloud computing and enterprise software are resilient during market volatility."},
            ],
            "analysis": "Tech sector is resilient due to strong balance sheets and diversified revenue streams.",
        },
    }

    # Filter sectors based on input
    selected_sectors = sectors_of_interest if sectors_of_interest else list(sector_data.keys())

    # Generate recommendations
    recommended_stocks = []
    sector_analysis = {}

    for sector in selected_sectors:
        if sector in sector_data:
            recommended_stocks.extend(sector_data[sector]["stocks"])
            sector_analysis[sector] = sector_data[sector]["analysis"]

    # Generate risk assessment
    risk_assessment = (
        "Geopolitical risks may lead to market volatility. "
        "Diversification across sectors is recommended to mitigate risks."
    )

    return {
        "recommended_stocks": recommended_stocks,
        "risk_assessment": risk_assessment,
        "sector_analysis": sector_analysis,
    }
