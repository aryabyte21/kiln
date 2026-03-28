REQUIRED_ENV_VARS = []

import re


def wikipedia_parser(**kwargs) -> dict:
    """
    Parse structured information from Wikipedia page's plain-text content.
    """
    content = kwargs.get("content", "")
    
    # Initialize output fields
    title = ""
    introduction = ""
    history = ""
    rules = ""
    formats = ""
    notable_events = ""
    
    # Extract title (first line or first heading)
    title_match = re.search(r'^([^\n]+)', content)
    if title_match:
        title = title_match.group(1).strip()
    
    # Extract sections using common Wikipedia section patterns
    sections = {
        "introduction": "",
        "history": "",
        "rules": "",
        "formats": "",
        "notable_events": ""
    }
    
    current_section = None
    lines = content.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Detect section headers
        if line.lower().startswith("introduction") or line.lower().startswith("summary"):
            current_section = "introduction"
            continue
        elif line.lower().startswith("history"):
            current_section = "history"
            continue
        elif line.lower().startswith("rules") or line.lower().startswith("gameplay"):
            current_section = "rules"
            continue
        elif line.lower().startswith("formats"):
            current_section = "formats"
            continue
        elif line.lower().startswith("notable events") or line.lower().startswith("records"):
            current_section = "notable_events"
            continue
        
        # Append content to current section
        if current_section:
            sections[current_section] += line + " "
    
    # Assign extracted sections
    introduction = sections["introduction"].strip()
    history = sections["history"].strip()
    rules = sections["rules"].strip()
    formats = sections["formats"].strip()
    notable_events = sections["notable_events"].strip()
    
    return {
        "title": title,
        "introduction": introduction,
        "history": history,
        "rules": rules,
        "formats": formats,
        "notable_events": notable_events
    }
