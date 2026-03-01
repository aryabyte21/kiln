import os
import requests
from typing import List, Dict

REQUIRED_ENV_VARS = []

def pdf_downloader(pdf_urls: List[str], output_dir: str) -> Dict:
    """Download PDF files from a list of URLs and save them to a specified location."""
    downloaded_files = []
    failed_downloads = []

    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    for url in pdf_urls:
        try:
            # Extract filename from URL
            filename = os.path.basename(url)
            if not filename:
                filename = f"downloaded_file_{len(downloaded_files) + 1}.pdf"

            output_path = os.path.join(output_dir, filename)

            # Download the file
            response = requests.get(url, headers={"User-Agent": "libgen.rs"}, timeout=10)
            response.raise_for_status()

            # Save the file
            with open(output_path, "wb") as f:
                f.write(response.content)

            downloaded_files.append(output_path)

        except Exception as e:
            failed_downloads.append(url)

    return {
        "downloaded_files": downloaded_files,
        "failed_downloads": failed_downloads
    }
