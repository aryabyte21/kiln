REQUIRED_ENV_VARS = []

import re
from typing import List, Dict, Any


def calculate_match_score(job: Dict[str, Any], user_profile: Dict[str, Any]) -> float:
    """Calculate match score between job and user profile."""
    score = 0.0
    
    # Extract skills from job description
    job_skills = set()
    if isinstance(job.get('description'), str):
        # Simple skill extraction - look for common skill keywords
        skills_keywords = ['python', 'java', 'javascript', 'c++', 'sql', 'aws', 'docker', 'kubernetes', 'react', 'node']
        for skill in skills_keywords:
            if re.search(r'\b' + skill + r'\b', job['description'].lower()):
                job_skills.add(skill)
    
    # Get user skills
    user_skills = set()
    if isinstance(user_profile.get('skills'), list):
        for skill in user_profile['skills']:
            if isinstance(skill, str):
                user_skills.add(skill.lower())
    elif isinstance(user_profile.get('skills'), str):
        user_skills.add(user_profile['skills'].lower())
    
    # Calculate skill match
    if job_skills and user_skills:
        skill_match = len(job_skills.intersection(user_skills)) / len(job_skills)
        score += skill_match * 0.5  # Skills contribute 50% to total score
    
    # Experience match
    job_experience = job.get('experience', '').lower() if isinstance(job.get('experience'), str) else ''
    user_experience = user_profile.get('experience', '').lower() if isinstance(user_profile.get('experience'), str) else ''
    
    if job_experience and user_experience:
        if job_experience in user_experience or user_experience in job_experience:
            score += 0.2  # Experience match contributes 20%
    
    # Location preference match
    job_location = job.get('location', '').lower() if isinstance(job.get('location'), str) else ''
    user_location = user_profile.get('preferred_location', '').lower() if isinstance(user_profile.get('preferred_location'), str) else ''
    
    if job_location and user_location:
        if job_location == user_location:
            score += 0.3  # Location match contributes 30%
    
    return min(max(score, 0.0), 1.0)  # Ensure score is between 0 and 1


def best_fit_analyzer(job_postings: List[Dict[str, Any]], user_profile: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze job postings to identify the best-fit role based on user profile and job requirements.
    
    Args:
        job_postings: List of job postings in structured format
        user_profile: User's skills, experience, and preferences for job matching
    
    Returns:
        Dict containing best_fit_job and match_score
    """
    try:
        if not job_postings:
            return {
                "best_fit_job": None,
                "match_score": 0.0
            }
        
        best_job = None
        best_score = -1.0
        
        for job in job_postings:
            if not isinstance(job, dict):
                continue
            
            score = calculate_match_score(job, user_profile)
            
            if score > best_score:
                best_score = score
                best_job = job
        
        return {
            "best_fit_job": best_job,
            "match_score": best_score if best_job else 0.0
        }
        
    except Exception as e:
        return {
            "error": f"Error analyzing job postings: {str(e)}"
        }
