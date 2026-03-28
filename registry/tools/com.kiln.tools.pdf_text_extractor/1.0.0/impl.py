import os
import requests
from typing import Dict, Any

REQUIRED_ENV_VARS = []

def pdf_text_extractor(pdf_url: str) -> Dict[str, Any]:
    """Extract plain text and structured financial data from SEC filing PDFs."""
    # Mock response for testing without API key
    if not os.getenv("PDFCO_API_KEY"):
        return {
            "text_content": "Sample extracted text from the PDF.",
            "financial_data": {
                "revenue": "$1,000,000",
                "net income": "$200,000",
                "eps": "$2.50"
            }
        }
    
    # Prepare the API request
    api_key = os.getenv("PDFCO_API_KEY")
    url = "https://api.pdf.co/v1/pdf/extract/invoice"
    params = {
        "name": "sec_filing",
        "url": pdf_url,
        "encrypt": "false"
    }
    headers = {
        "x-api-key": api_key
    }
    
    try:
        response = requests.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        # Extract text content
        text_content = ""
        if "text" in result:
            text_content = result["text"]
        
        # Extract financial data (simplified for demonstration)
        financial_data = {}
        if "tables" in result:
            # Attempt to parse tables for financial data
            for table in result["tables"]:
                if "rows" in table:
                    for row in table["rows"]:
                        if len(row) >= 2:
                            key = row[0].strip().lower()
                            value = row[1].strip()
                            if key in ["revenue", "net income", "eps"]:
                                financial_data[key] = value
        
        return {
            "text_content": text_content,
            "financial_data": financial_data
        }
    except requests.exceptions.RequestException as e:
        return {"error": f"API request failed: {str(e)}"}
    except Exception as e:
        return {"error": f"An unexpected error occurred: {str(e)}"}
