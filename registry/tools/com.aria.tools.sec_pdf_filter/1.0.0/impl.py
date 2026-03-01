REQUIRED_ENV_VARS = []


def sec_pdf_filter(filings: dict) -> dict:
    """
    Filters SEC filings to identify those available as PDFs and extracts their download URLs.
    """
    pdf_urls = []
    
    # Iterate through filings to find PDF URLs
    for filing in filings.values():
        if isinstance(filing, dict):
            # Check for PDF URL pattern in the filing data
            if "pdf_url" in filing:
                pdf_urls.append(filing["pdf_url"])
            elif "url" in filing and filing["url"].endswith(".pdf"):
                pdf_urls.append(filing["url"])
    
    return {"pdf_urls": pdf_urls}
