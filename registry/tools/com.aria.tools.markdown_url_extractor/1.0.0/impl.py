"""
Markdown URL Extractor Tool
Extracts URLs from markdown content and classifies them as GitHub repos or documentation.
"""
import re
from typing import Dict, List

REQUIRED_ENV_VARS = []


def markdown_url_extractor(markdown_content: str) -> Dict[str, List[str]]:
    """
    Extract URLs from markdown content and classify them.
    
    Args:
        markdown_content: Raw markdown content to parse
    
    Returns:
        Dict with 'urls' and 'url_types' keys containing extracted URLs and their types
    """
    # Regular expression to find URLs in markdown
    url_pattern = re.compile(r'https?://[^\s"\)\]]+')
    
    # Find all URLs in the markdown content
    urls = url_pattern.findall(markdown_content)
    
    # Classify URLs
    url_types = []
    for url in urls:
        if 'github.com' in url:
            url_types.append('github_repo')
        elif any(ext in url for ext in ['/docs', '/documentation', '.md', '.rst']):
            url_types.append('documentation')
        else:
            url_types.append('other')
    
    return {
        'urls': urls,
        'url_types': url_types
    }
