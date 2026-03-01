"""
Job Parser Implementation
Parses plain-text job postings to extract structured details.
"""

REQUIRED_ENV_VARS = []


def job_parser(**kwargs) -> dict:
    """
    Parse plain-text job postings to extract structured details.
    
    Args:
        text_content (str): The plain-text content of a job posting.
    
    Returns:
        dict: Structured job details with keys: title, company, location, salary, description, posted_date.
    """
    text_content = kwargs.get("text_content", "")
    
    # Default values for all fields
    result = {
        "title": "",
        "company": "",
        "location": "",
        "salary": "",
        "description": text_content,  # Use the entire text as description by default
        "posted_date": ""
    }
    
    # Simple parsing logic to extract common fields
    # This is a basic implementation that looks for common patterns
    lines = text_content.split('\n')
    
    for line in lines:
        line_lower = line.lower().strip()
        
        # Extract title (common patterns)
        if "title:" in line_lower:
            result["title"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        elif "position:" in line_lower:
            result["title"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        
        # Extract company
        if "company:" in line_lower:
            result["company"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        elif "employer:" in line_lower:
            result["company"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        
        # Extract location
        if "location:" in line_lower:
            result["location"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        elif "where:" in line_lower:
            result["location"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        
        # Extract salary
        if "salary:" in line_lower:
            result["salary"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        elif "pay:" in line_lower:
            result["salary"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        elif "compensation:" in line_lower:
            result["salary"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
        
        # Extract posted date
        if "date:" in line_lower or "posted:" in line_lower:
            result["posted_date"] = line.split(":", 1)[1].strip() if ":" in line else line.strip()
    
    return result
