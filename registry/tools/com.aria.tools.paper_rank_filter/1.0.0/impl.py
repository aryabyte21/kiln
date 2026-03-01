#!/usr/bin/env python3
"""
Implementation of paper_rank_filter tool.
Filters and ranks research papers based on recency, citation count, relevance, and quality metrics.
"""

REQUIRED_ENV_VARS = []

import re
from typing import List, Dict, Any


def paper_rank_filter(papers: List[Dict[str, Any]], query: str, top_n: int) -> Dict[str, Any]:
    """
    Filter and rank research papers based on recency, citation count, relevance to query, and quality metrics.
    
    Args:
        papers: List of research papers with metadata
        query: Topic or keyword to filter by
        top_n: Number of top papers to return
    
    Returns:
        Dict with 'top_papers' key containing ranked papers
    """
    try:
        # Handle empty input
        if not papers or top_n <= 0:
            return {"top_papers": []}
        
        # Filter papers that match the query (case-insensitive)
        query_lower = query.lower()
        filtered_papers = []
        
        for paper in papers:
            # Check if paper has required fields
            if not isinstance(paper, dict):
                continue
            
            title = paper.get("title", "")
            abstract = paper.get("abstract", "")
            authors = paper.get("authors", [])
            
            # Check relevance by searching in title, abstract, and authors
            paper_text = f"{title} {abstract} {' '.join(authors)}".lower()
            
            if query_lower in paper_text:
                filtered_papers.append(paper)
        
        # Rank papers using multiple criteria
        def calculate_score(paper: Dict[str, Any]) -> float:
            """Calculate a composite score for ranking papers."""
            score = 0.0
            
            # Recency score (newer papers get higher score)
            pub_date = paper.get("publication_date", "")
            if pub_date:
                try:
                    # Simple year extraction for recency
                    year_match = re.search(r'\b(\d{4})\b', pub_date)
                    if year_match:
                        year = int(year_match.group(1))
                        # Normalize to 0-1 range (assuming current year is 2025)
                        recency_score = (year - 2000) / 25.0
                        score += recency_score * 0.4  # 40% weight
                except:
                    pass
            
            # Citation count score
            citation_count = paper.get("citation_count", 0)
            if citation_count > 0:
                # Log scale to reduce impact of very high citation counts
                citation_score = min(1.0, (citation_count ** 0.5) / 100.0)
                score += citation_score * 0.3  # 30% weight
            
            # Relevance score (how well the paper matches the query)
            title = paper.get("title", "").lower()
            abstract = paper.get("abstract", "").lower()
            
            # Count query term occurrences
            query_terms = query_lower.split()
            relevance_count = 0
            for term in query_terms:
                relevance_count += title.count(term)
                relevance_count += abstract.count(term)
            
            if relevance_count > 0:
                relevance_score = min(1.0, relevance_count / 10.0)
                score += relevance_score * 0.3  # 30% weight
            
            return score
        
        # Score and sort papers
        scored_papers = []
        for paper in filtered_papers:
            score = calculate_score(paper)
            scored_papers.append((score, paper))
        
        # Sort by score (descending)
        scored_papers.sort(key=lambda x: x[0], reverse=True)
        
        # Extract top N papers
        top_papers = [paper for score, paper in scored_papers[:top_n]]
        
        return {"top_papers": top_papers}
        
    except Exception as e:
        # Return error in the expected format
        return {"error": f"Error processing papers: {str(e)}"}
