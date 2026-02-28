def stock_price(ticker: str, exchange: str = "NYSE") -> dict:
    """Mock stock price lookup."""
    prices = {"AAPL": 213.5, "GOOGL": 178.2, "MSFT": 415.0, "NVDA": 875.0}
    price = prices.get(ticker.upper(), 100.0)
    return {"ticker": ticker.upper(), "price": price, "exchange": exchange, "currency": "USD", "success": True}
