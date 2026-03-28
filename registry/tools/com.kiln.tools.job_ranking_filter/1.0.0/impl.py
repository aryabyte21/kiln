"""
Job Ranking Filter Implementation
"""
from typing import List, Dict, Any
from datetime import datetime
import math

REQUIRED_ENV_VARS = []


def calculate_relevance_score(job: Dict[str, Any], location: str) -> float:
    """
    Calculate relevance score based on location match, recency, and company rating.
    """
    score = 0.0
    
    # Location match (higher if location matches)
    job_location = job.get("location", "").lower()
    if location.lower() in job_location:
        score += 50.0
    
    # Recency (newer jobs get higher scores)
    created_date = job.get("created")
    if created_date:
        try:
            created = datetime.strptime(created_date, "%Y-%m-%d")
            days_old = (datetime.now() - created).days
            # Inverse relationship: newer jobs get higher scores
            recency_score = max(0, 50.0 - (days_old * 0.5))
            score += recency_score
        except (ValueError, TypeError):
            # If date parsing fails, give average recency score
            score += 25.0
    
    # Company rating (higher rating = better)
    rating = job.get("rating", 0)
    if rating:
        try:
            score += float(rating) * 10.0
        except (ValueError, TypeError):
            score += 0.0
    
    # Salary boost (higher salary = better)
    salary_max = job.get("salary_max")
    if salary_max:
        try:
            normalized_salary = min(100000, float(salary_max)) / 100000.0
            score += normalized_salary * 20.0
        except (ValueError, TypeError):
            score += 0.0
    
    return score


def job_ranking_filter(job_listings: List[Dict[str, Any]], location: str, top_n: int) -> Dict[str, Any]:
    """
    Filter and rank job postings based on relevance, recency, and company reputation.
    
    Args:
        job_listings: List of parsed job postings with structured details
        location: Location to prioritize in ranking
        top_n: Number of top job listings to return
    
    Returns:
        Dict with 'top_jobs' containing ranked job listings
    """
    try:
        # Calculate scores for all jobs
        scored_jobs = []
        for job in job_listings:
            score = calculate_relevance_score(job, location)
            scored_jobs.append((score, job))
        
        # Sort by score (descending)
        scored_jobs.sort(key=lambda x: x[0], reverse=True)
        
        # Get top N jobs
        top_jobs = [job for score, job in scored_jobs[:top_n]]
        
        return {"top_jobs": top_jobs}
    
    except Exception as e:
        # Return error if something goes wrong
        return {"error": f"Error processing job listings: {str(e)}"}
