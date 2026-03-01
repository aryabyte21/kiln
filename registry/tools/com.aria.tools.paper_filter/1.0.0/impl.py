from urllib.parse import urlparse
from typing import List, Dict, Any

REQUIRED_ENV_VARS = []


def paper_filter(results: List[str] = None, source_domains: List[str] = None) -> Dict[str, Any]:
    """
    Filter a list of URLs or search results to identify those likely to contain research papers from reputable sources.
    
    Args:
        results: List of search results or URLs to filter.
        source_domains: List of reputable domains to prioritize (e.g., ['arxiv.org', 'ieee.org']).
    
    Returns:
        Dict containing filtered_urls.
    """
    if results is None:
        results = []
    if source_domains is None:
        source_domains = ['arxiv.org', 'ieee.org', 'acm.org', 'springer.com', 'sciencedirect.com', 'jstor.org', 'plos.org', 'nature.com']
    
    filtered_urls = []
    
    for item in results:
        # Extract URL from the item (assuming item is a URL or contains a URL)
        url = item if isinstance(item, str) else str(item)
        
        try:
            parsed_url = urlparse(url)
            domain = parsed_url.netloc
            
            # Check if the domain matches any of the source_domains
            for source_domain in source_domains:
                if source_domain in domain:
                    filtered_urls.append(url)
                    break
        except Exception as e:
            # Skip malformed URLs
            continue
    
    return {"filtered_urls": filtered_urls}
