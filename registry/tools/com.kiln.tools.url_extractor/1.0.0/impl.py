REQUIRED_ENV_VARS = []


def url_extractor(search_results: dict, file_type: str) -> dict:
    """
    Extract direct URLs from a list of web search results based on a specific file type.
    
    Args:
        search_results: A dictionary containing web search results with titles, links, and snippets.
        file_type: The file type to filter URLs by (e.g., 'csv', 'pdf').
    
    Returns:
        A dict with the direct URL to the file matching the specified file type.
    """
    try:
        # Extract URLs from search results
        items = search_results.get("items", [])
        
        # Filter URLs by file type
        matching_urls = [
            item.get("link") 
            for item in items 
            if isinstance(item, dict) and item.get("link") and item.get("link").endswith(f".{file_type}")
        ]
        
        # Return the first matching URL or an empty string if none found
        result = {"url": matching_urls[0] if matching_urls else ""}
        return result
    except Exception as e:
        return {"error": f"An error occurred: {str(e)}"}
