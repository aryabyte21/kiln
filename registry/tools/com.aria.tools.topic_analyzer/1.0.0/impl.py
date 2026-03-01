#!/usr/bin/env python3
"""Topic Analyzer Implementation"""

REQUIRED_ENV_VARS = []


def topic_analyzer(documents: list, top_n: int) -> dict:
    """
    Analyze a collection of text documents to identify and rank the most common topics.
    
    Args:
        documents: List of text documents (e.g., abstracts) to analyze
        top_n: Number of top topics to return
        
    Returns:
        dict: Contains 'topics' key with list of topic dicts, each having 'topic' and 'score' keys
    """
    # Simple implementation: extract common words as topics
    # This is a basic approach for demonstration purposes
    
    if not documents or top_n <= 0:
        return {"topics": []}
    
    # Combine all documents into one text
    combined_text = " ".join(documents).lower()
    
    # Basic tokenization and word frequency counting
    words = combined_text.split()
    word_freq = {}
    
    for word in words:
        # Simple filtering: skip short words and common stop words
        if len(word) >= 3 and word not in {"the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use"}:
            word_freq[word] = word_freq.get(word, 0) + 1
    
    # Sort by frequency and get top_n
    sorted_topics = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:top_n]
    
    # Format output
    topics = [
        {
            "topic": topic,
            "score": float(score)
        }
        for topic, score in sorted_topics
    ]
    
    return {"topics": topics}
