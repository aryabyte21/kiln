"""
Paper Extractor Tool Implementation
Extracts structured details from plain-text research paper content using Crossref API.
"""
import json
import re
from typing import Dict, Any
import urllib.parse
import urllib.request

REQUIRED_ENV_VARS = []

def paper_extractor(**kwargs: Any) -> Dict[str, Any]:
    """
    Extract structured details (title, authors, abstract, publication date) from plain-text research paper content.
    
    Args:
        text_content (str): The plain-text content of a research paper.
    
    Returns:
        dict: Structured details including title, authors, abstract, publication_date, and url.
    """
    text_content = kwargs.get("text_content", "")
    
    # Extract title from text content (first line or after "Title:")
    title = ""
    lines = text_content.split('\n')
    if lines:
        title = lines[0].strip()
        # Try to find a line that starts with "Title:"
        for line in lines:
            if line.lower().startswith("title:"):
                title = line.split(":", 1)[1].strip()
                break
    
    if not title:
        return {"error": "Could not extract title from text content"}
    
    # Query Crossref API
    try:
        # URL encode the title for the API query
        encoded_title = urllib.parse.quote(title)
        api_url = f"https://api.crossref.org/works?query.title={encoded_title}"
        
        # Set User-Agent header
        headers = {
            "User-Agent": "YourAppName (your@email.com)"
        }
        
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            
        # Extract information from API response
        if data.get("message", {}).get("items"):
            item = data["message"]["items"][0]
            
            # Extract authors
            authors_list = []
            for author in item.get("author", []):
                given = author.get("given", "")
                family = author.get("family", "")
                if given and family:
                    authors_list.append(f"{given} {family}")
                elif family:
                    authors_list.append(family)
            authors = ", ".join(authors_list)
            
            # Extract abstract
            abstract = ""
            if "abstract" in item:
                abstract = item["abstract"]
            
            # Extract publication date
            publication_date = ""
            created = item.get("created", {})
            if created:
                date_parts = created.get("date-parts", [])
                if date_parts and len(date_parts) > 0 and len(date_parts[0]) >= 3:
                    year, month, day = date_parts[0][0], date_parts[0][1], date_parts[0][2]
                    publication_date = f"{year:04d}-{month:02d}-{day:02d}"
            
            # Extract URL
            url = ""
            if "URL" in item:
                url = item["URL"]
            
            return {
                "title": item.get("title", [""])[0] if item.get("title") else title,
                "authors": authors,
                "abstract": abstract,
                "publication_date": publication_date,
                "url": url
            }
        else:
            return {"error": "No results found from Crossref API"}
            
    except Exception as e:
        return {"error": f"Failed to query Crossref API: {str(e)}"}
