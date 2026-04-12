import xml.etree.ElementTree as ET
from typing import Optional

import requests

REQUIRED_ENV_VARS = []

TICKER_TO_CIK = {
    "AAPL": "0000320193", "MSFT": "0000789019", "GOOGL": "0001652044",
    "AMZN": "0001018724", "META": "0001326801", "TSLA": "0001318605",
    "NVDA": "0001045810", "JPM": "0000019617", "V": "0001036112",
    "WMT": "0000104169", "NFLX": "0001065280", "INTC": "0000050863",
    "JNJ": "0000200406", "PG": "0000080424", "UNH": "0000073176",
}


def nasdaq_financial_reports_fetcher(ticker: str, report_type: str, limit: Optional[int] = None) -> dict:
    """Fetch financial reports from SEC EDGAR database."""
    try:
        cik = TICKER_TO_CIK.get(ticker.upper())
        if not cik:
            return {"error": f"CIK not found for ticker '{ticker}'. Supported: {', '.join(sorted(TICKER_TO_CIK.keys()))}"}

        url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={report_type}&output=atom"
        headers = {"User-Agent": "KilnToolRegistry/1.0 (research tool)"}

        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        root = ET.fromstring(response.content)

        reports = []
        for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
            accession = entry.find("{http://www.sec.gov/Archives/edgar}accession-number")
            filing_date = entry.find("{http://www.sec.gov/Archives/edgar}filing-date")
            filing_href = entry.find("{http://www.sec.gov/Archives/edgar}filing-href")

            if accession is not None and filing_date is not None and filing_href is not None:
                reports.append({
                    "accession_number": accession.text,
                    "filing_date": filing_date.text,
                    "report_url": filing_href.text
                })

        if limit is not None and len(reports) > limit:
            reports = reports[:limit]

        if not reports:
            return {"error": f"No {report_type} filings found for {ticker} on SEC EDGAR."}

        latest_report = reports[0]
        return {
            "reports": reports,
            "report_url": latest_report["report_url"],
            "filing_date": latest_report["filing_date"]
        }

    except Exception as e:
        return {"error": f"Failed to fetch reports from SEC EDGAR: {e}"}
