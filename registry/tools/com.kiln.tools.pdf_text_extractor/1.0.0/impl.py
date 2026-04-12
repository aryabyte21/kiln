import os

import requests

REQUIRED_ENV_VARS = [
    {"name": "PDFCO_API_KEY", "description": "API key for pdf.co PDF extraction service"},
]

def pdf_text_extractor(pdf_url: str) -> dict:
    """Extract plain text and structured financial data from SEC filing PDFs."""
    api_key = os.environ.get("PDFCO_API_KEY")
    if not api_key:
        return {"error": "Missing required env var: PDFCO_API_KEY"}

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

        text_content = result.get("text", "")

        financial_data = {}
        if "tables" in result:
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
    except Exception as e:
        return {"error": f"PDF extraction failed: {e}"}
