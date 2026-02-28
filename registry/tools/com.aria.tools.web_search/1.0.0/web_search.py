"""
web_search.py
-------------
Search the web via Serper.dev (Google Search API).
Requires env var: SERPER_API_KEY
"""

import os

REQUIRED_ENV_VARS = [
    {"name": "SERPER_API_KEY", "description": "API key from serper.dev (free tier available)"},
]


def web_search(query: str, num_results: int = 5) -> dict:
    """
    Search the web and return top organic results.

    Args:
        query:       Search query string.
        num_results: Number of results (1-10, default 5).

    Returns:
        dict with keys: results (list of {title, link, snippet}), query, success
    """
    try:
        import requests

        api_key = os.environ.get("SERPER_API_KEY", "").strip()
        if not api_key:
            return {"results": [], "query": query, "success": False,
                    "error": "SERPER_API_KEY environment variable not set"}

        num_results = max(1, min(10, num_results))

        resp = requests.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": query, "num": num_results},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        results = []
        for item in data.get("organic", [])[:num_results]:
            results.append({
                "title":   item.get("title", ""),
                "link":    item.get("link", ""),
                "snippet": item.get("snippet", ""),
            })

        return {"results": results, "query": query, "success": True}

    except Exception as exc:
        return {"results": [], "query": query, "success": False, "error": str(exc)}
