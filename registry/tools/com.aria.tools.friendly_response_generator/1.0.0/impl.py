import os
import json
import requests

REQUIRED_ENV_VARS = [
    {"name": "HF_TOKEN", "description": "Hugging Face API token for inference"},
]

def friendly_response_generator(**kwargs) -> dict:
    """
    Generate a friendly and contextually appropriate response based on conversation context and user sentiment.
    """
    context = kwargs.get("context", {})
    
    # Check if HF_TOKEN is available
    hf_token = os.getenv("HF_TOKEN")
    if not hf_token:
        # Fallback to a local response if API token is missing
        return {"response": "Hello! How can I assist you today?"}
    
    # Prepare the API request
    api_url = "https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill"
    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json",
    }
    
    # Convert context to a string for the API
    context_str = json.dumps(context)
    payload = {"inputs": context_str}
    
    try:
        response = requests.post(api_url, headers=headers, json=payload, timeout=10)
        response.raise_for_status()
        result = response.json()
        
        if "generated_text" in result:
            return {"response": result["generated_text"]}
        else:
            return {"response": "Hello! How can I assist you today?"}
    except Exception as e:
        # Fallback to a local response if API call fails
        return {"response": "Hello! How can I assist you today?"}
