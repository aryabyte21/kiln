"""
news_headlines.py
-----------------
Fetch top news headlines via NewsAPI.org.
Requires env var: NEWS_API_KEY
"""

import os

REQUIRED_ENV_VARS = [
    {"name": "NEWS_API_KEY", "description": "API key from newsapi.org (free tier available)"},
]


def news_headlines(topic: str = "", country: str = "us", num_results: int = 5) -> dict:
    """
    Fetch top news headlines.

    Args:
        topic:       Keyword/topic to search (uses /everything endpoint).
                     If empty, fetches top headlines by country.
        country:     Two-letter country code (used when topic is empty).
        num_results: Number of articles (1-20, default 5).

    Returns:
        dict with keys: articles (list), total_results, success
    """
    try:
        import requests

        api_key = os.environ.get("NEWS_API_KEY", "").strip()
        if not api_key:
            return {"articles": [], "total_results": 0, "success": False,
                    "error": "NEWS_API_KEY environment variable not set"}

        num_results = max(1, min(20, num_results))

        if topic.strip():
            url = "https://newsapi.org/v2/everything"
            params = {"q": topic, "pageSize": num_results, "sortBy": "publishedAt",
                      "language": "en", "apiKey": api_key}
        else:
            url = "https://newsapi.org/v2/top-headlines"
            params = {"country": country, "pageSize": num_results, "apiKey": api_key}

        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        articles = []
        for item in data.get("articles", [])[:num_results]:
            articles.append({
                "title":       item.get("title", ""),
                "source":      (item.get("source") or {}).get("name", ""),
                "url":         item.get("url", ""),
                "publishedAt": item.get("publishedAt", ""),
                "description": item.get("description", ""),
            })

        return {
            "articles":      articles,
            "total_results": data.get("totalResults", len(articles)),
            "success":       True,
        }

    except Exception as exc:
        return {"articles": [], "total_results": 0, "success": False, "error": str(exc)}
