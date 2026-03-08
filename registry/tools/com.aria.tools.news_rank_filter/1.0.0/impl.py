"""
News Rank Filter Implementation
"""
from datetime import datetime, timedelta
import re

REQUIRED_ENV_VARS = []


def calculate_relevance_score(article, topic):
    """Calculate relevance score based on topic presence in title and summary."""
    score = 0
    topic_lower = topic.lower()
    
    # Check title
    if 'title' in article and article['title']:
        title_lower = article['title'].lower()
        if topic_lower in title_lower:
            score += 2  # Higher weight for title match
    
    # Check summary/description
    if 'summary' in article and article['summary']:
        summary_lower = article['summary'].lower()
        if topic_lower in summary_lower:
            score += 1
    elif 'description' in article and article['description']:
        description_lower = article['description'].lower()
        if topic_lower in description_lower:
            score += 1
    
    return score


def calculate_recency_score(article):
    """Calculate recency score based on publication date."""
    try:
        if 'date' in article and article['date']:
            pub_date = datetime.fromisoformat(article['date'].replace('Z', '+00:00'))
        elif 'publishedAt' in article and article['publishedAt']:
            pub_date = datetime.fromisoformat(article['publishedAt'].replace('Z', '+00:00'))
        else:
            return 0
        
        # More recent articles get higher scores
        time_diff = datetime.utcnow() - pub_date
        days_diff = time_diff.total_seconds() / (24 * 3600)
        
        # Score decays over time (max 3 for <1 day, min 0 for >30 days)
        if days_diff < 1:
            return 3
        elif days_diff < 7:
            return 2
        elif days_diff < 30:
            return 1
        else:
            return 0
    except (ValueError, TypeError):
        return 0


def calculate_source_credibility_score(article):
    """Calculate source credibility score based on domain."""
    source = article.get('source', {})
    if isinstance(source, str):
        source_name = source
    else:
        source_name = source.get('name', '')
    
    # Known credible sources (can be expanded)
    credible_sources = [
        'bbc', 'reuters', 'ap', 'afp', 'nytimes', 'washington post',
        'wsj', 'ft', 'economist', 'bloomberg', 'cnn', 'npr'
    ]
    
    source_lower = source_name.lower()
    for credible in credible_sources:
        if credible in source_lower:
            return 2
    
    # Check for generic news domains
    if any(keyword in source_lower for keyword in ['news', 'press', 'journal']):
        return 1
    
    return 0


def news_rank_filter(news_list, topic):
    """
    Filter and rank news articles based on recency, relevance, and source credibility.
    
    Args:
        news_list: List of news articles with metadata
        topic: Topic to filter by
        
    Returns:
        dict: {"ranked_news": list} containing ranked articles
    """
    try:
        ranked_articles = []
        
        for article in news_list:
            # Calculate scores
            relevance = calculate_relevance_score(article, topic)
            recency = calculate_recency_score(article)
            credibility = calculate_source_credibility_score(article)
            
            # Total score (weighted: relevance 40%, recency 30%, credibility 30%)
            total_score = (relevance * 0.4) + (recency * 0.3) + (credibility * 0.3)
            
            # Add score to article and collect
            article_copy = article.copy()
            article_copy['_rank_score'] = total_score
            ranked_articles.append(article_copy)
        
        # Sort by score (descending)
        ranked_articles.sort(key=lambda x: x['_rank_score'], reverse=True)
        
        # Remove the score field from output
        for article in ranked_articles:
            article.pop('_rank_score', None)
        
        return {"ranked_news": ranked_articles}
        
    except Exception as e:
        return {"error": f"Error processing news: {str(e)}"}
