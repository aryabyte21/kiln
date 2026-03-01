import requests
from datetime import datetime
from typing import List, Dict, Any

REQUIRED_ENV_VARS = []

def calculate_relevance_score(paper: Dict[str, Any]) -> float:
    """Calculate a relevance score based on citation count and publication date."""
    citation_count = paper.get("citation_count", 0)
    published_date_str = paper.get("publication_date", "1970-01-01")
    
    # Parse publication date
    try:
        published_date = datetime.strptime(published_date_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        published_date = datetime(1970, 1, 1)
    
    # Calculate age in days
    age_days = (datetime.now() - published_date).days
    
    # Relevance score: citation count divided by age (with minimum age of 1 day)
    age_factor = max(1, age_days)
    relevance_score = citation_count / age_factor
    
    return relevance_score

def paper_ranker(**kwargs) -> Dict[str, Any]:
    """Rank a list of research papers based on relevance, citation count, and publication date."""
    papers = kwargs.get("papers", [])
    
    # Calculate relevance score for each paper
    for paper in papers:
        paper["relevance_score"] = calculate_relevance_score(paper)
    
    # Sort papers by relevance score (descending), then citation count (descending), then publication date (newest first)
    ranked_papers = sorted(
        papers,
        key=lambda x: (
            -x.get("relevance_score", 0),
            -x.get("citation_count", 0),
            x.get("publication_date", "1970-01-01")
        )
    )
    
    return {"ranked_papers": ranked_papers}
