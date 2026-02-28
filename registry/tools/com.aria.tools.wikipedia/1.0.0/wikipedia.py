"""
com.aria.tools.wikipedia
Wikipedia summary via the MediaWiki REST API. No API key required.
"""
import requests


def wikipedia_search(query: str, sentences: int = 5) -> dict:
    """Fetch a Wikipedia summary for any topic, person, or concept."""
    try:
        # Use the summary endpoint — clean plain text, no parsing needed
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(query.replace(' ', '_'))}"
        resp = requests.get(url, headers={"User-Agent": "ARIA/1.0 (hackathon demo)"}, timeout=10)

        if resp.status_code == 404:
            # Try a search to find the right title
            search_resp = requests.get(
                "https://en.wikipedia.org/w/api.php",
                params={"action": "opensearch", "search": query, "limit": 1, "format": "json"},
                headers={"User-Agent": "ARIA/1.0"},
                timeout=10,
            )
            results = search_resp.json()
            if results[1]:
                title = results[1][0]
                url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(title.replace(' ', '_'))}"
                resp = requests.get(url, headers={"User-Agent": "ARIA/1.0"}, timeout=10)
            else:
                return {"success": False, "error": f"No Wikipedia article found for: {query}"}

        resp.raise_for_status()
        data = resp.json()

        summary = data.get("extract", "")
        # Truncate to requested sentences
        parts = summary.split(". ")
        if len(parts) > sentences:
            summary = ". ".join(parts[:sentences]) + "."

        return {
            "title":   data.get("title", query),
            "summary": summary,
            "url":     data.get("content_urls", {}).get("desktop", {}).get("page", ""),
            "success": True,
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}
