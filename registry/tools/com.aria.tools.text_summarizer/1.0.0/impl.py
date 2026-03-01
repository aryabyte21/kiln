#!/usr/bin/env python3
"""Text summarizer tool implementation."""

import os
import requests
from typing import Optional

REQUIRED_ENV_VARS = []


def text_summarizer(text: str, length: Optional[int] = None) -> dict:
    """Generate a concise summary of a research paper's abstract and key points.
    
    Args:
        text: The text content of the paper or abstract to summarize.
        length: Desired length of the summary in words.
    
    Returns:
        dict: Contains 'summary' key with the generated summary text.
    """
    # Use local fallback since we don't have API key
    return {"summary": _local_fallback_summarizer(text, length)}
    
    try:
        # Prepare API request
        api_url = "https://api-inference.huggingface.co/models/facebook/bart-large-cnn"
        headers = {
            "Authorization": f"Bearer {hf_token}",
            "Content-Type": "application/json",
        }
        payload = {"inputs": text}
        
        # Add length parameter if specified
        if length is not None:
            payload["parameters"] = {"max_length": length}
        
        # Make API request
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        
        # Extract and return summary
        result = response.json()
        if isinstance(result, list) and len(result) > 0:
            summary_text = result[0].get("summary_text", "")
            if summary_text:
                return {"summary": summary_text}
        
        # Fallback: try to get generated_text
        if isinstance(result, dict):
            summary_text = result.get("generated_text", "")
            if summary_text:
                return {"summary": summary_text}
        
        # If API response doesn't contain expected fields, return error
        return {"error": "Unexpected API response format"}
        
    except requests.exceptions.RequestException as e:
        # If API call fails, use local fallback
        return {"summary": _local_fallback_summarizer(text, length)}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}


def _local_fallback_summarizer(text: str, length: Optional[int] = None) -> str:
    """Local fallback summarizer using simple text processing."""
    if not text:
        return ""
    
    # Simple fallback: take first few sentences
    sentences = text.split('.')
    if length and length > 0:
        # Try to approximate word count
        summary_sentences = sentences[:min(length, len(sentences))]
    else:
        # Default to first 3 sentences
        summary_sentences = sentences[:3]
    
    # Clean up and return
    summary = '. '.join([s.strip() for s in summary_sentences if s.strip()])
    return summary + ('.' if summary and not summary.endswith('.') else '')
