#!/usr/bin/env python3
"""Implementation of job_filter tool."""

from datetime import datetime, timedelta
from typing import List, Dict, Any

REQUIRED_ENV_VARS = []


def job_filter(
    job_postings: List[Dict[str, Any]],
    date_range: str = None,
    location: str = None,
    salary_min: int = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Filter job postings based on criteria such as date, location, salary range, or job type.
    
    Args:
        job_postings: List of job postings in structured format.
        date_range: Date range to filter job postings (e.g., 'last 7 days').
        location: Location to filter job postings (e.g., 'San Francisco').
        salary_min: Minimum salary to filter job postings.
    
    Returns:
        Dict with key 'filtered_jobs' containing the filtered job postings.
    """
    try:
        filtered_jobs = []
        
        for job in job_postings:
            # Filter by location
            if location is not None:
                job_location = job.get("location", "").lower()
                if location.lower() not in job_location:
                    continue
            
            # Filter by salary
            if salary_min is not None:
                salary = job.get("salary", 0)
                if isinstance(salary, str):
                    # Extract numeric value from salary string (e.g., "$50,000")
                    salary_numeric = int("".join(c for c in salary if c.isdigit()))
                    if salary_numeric < salary_min:
                        continue
                elif isinstance(salary, (int, float)):
                    if salary < salary_min:
                        continue
                else:
                    continue
            
            # Filter by date range
            if date_range is not None:
                job_date_str = job.get("date", "")
                if job_date_str:
                    try:
                        job_date = datetime.strptime(job_date_str, "%Y-%m-%d")
                        today = datetime.now()
                        
                        if date_range == "last 7 days":
                            week_ago = today - timedelta(days=7)
                            if job_date < week_ago:
                                continue
                        elif date_range == "last 30 days":
                            month_ago = today - timedelta(days=30)
                            if job_date < month_ago:
                                continue
                        elif date_range == "last 90 days":
                            three_months_ago = today - timedelta(days=90)
                            if job_date < three_months_ago:
                                continue
                    except ValueError:
                        continue
            
            filtered_jobs.append(job)
        
        return {"filtered_jobs": filtered_jobs}
    
    except Exception as e:
        return {"error": f"An error occurred: {str(e)}"}
