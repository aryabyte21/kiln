REQUIRED_ENV_VARS = []


def calculate_sma(close_prices, window=14):
    """Calculate Simple Moving Average (SMA)"""
    if len(close_prices) < window:
        return None
    sma = sum(close_prices[-window:]) / window
    return sma


def calculate_rsi(close_prices, window=14):
    """Calculate Relative Strength Index (RSI)"""
    if len(close_prices) < window + 1:
        return None
    
    deltas = [close_prices[i] - close_prices[i-1] for i in range(1, len(close_prices))]
    gains = [delta if delta > 0 else 0 for delta in deltas]
    losses = [-delta if delta < 0 else 0 for delta in deltas]
    
    avg_gain = sum(gains[-window:]) / window
    avg_loss = sum(losses[-window:]) / window
    
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_macd(close_prices, fast=12, slow=26, signal=9):
    """Calculate Moving Average Convergence Divergence (MACD)"""
    if len(close_prices) < slow + signal:
        return None
    
    fast_ema = calculate_ema(close_prices, fast)
    slow_ema = calculate_ema(close_prices, slow)
    macd_line = fast_ema - slow_ema
    signal_line = calculate_ema([macd_line] * signal, signal)
    
    return {
        "macd": macd_line,
        "signal": signal_line,
        "histogram": macd_line - signal_line
    }


def calculate_ema(prices, window):
    """Calculate Exponential Moving Average (EMA)"""
    if len(prices) < window:
        return None
    
    ema = []
    sma = sum(prices[:window]) / window
    multiplier = 2 / (window + 1)
    ema.append(sma)
    
    for price in prices[window:]:
        ema_val = (price - ema[-1]) * multiplier + ema[-1]
        ema.append(ema_val)
    
    return ema[-1]


def identify_trends(indicators):
    """Identify trends based on calculated indicators"""
    trends = {}
    
    if "SMA" in indicators:
        sma = indicators["SMA"]
        if sma:
            trends["SMA"] = "bullish" if sma > indicators.get("previous_close", 0) else "bearish"
    
    if "RSI" in indicators:
        rsi = indicators["RSI"]
        if rsi:
            trends["RSI"] = "overbought" if rsi > 70 else ("oversold" if rsi < 30 else "neutral")
    
    if "MACD" in indicators:
        macd = indicators["MACD"]
        if macd:
            trends["MACD"] = "bullish" if macd["macd"] > macd["signal"] else "bearish"
    
    return trends


def technical_indicators_calculator(historical_data, indicators):
    """Calculate technical indicators from historical stock data"""
    try:
        close_prices = historical_data.get("close_prices", [])
        if not close_prices:
            return {"error": "No close prices provided in historical_data"}
        
        calculated_indicators = {}
        
        for indicator in indicators:
            if indicator == "SMA":
                calculated_indicators["SMA"] = calculate_sma(close_prices)
            elif indicator == "RSI":
                calculated_indicators["RSI"] = calculate_rsi(close_prices)
            elif indicator == "MACD":
                calculated_indicators["MACD"] = calculate_macd(close_prices)
        
        trends = identify_trends(calculated_indicators)
        
        return {
            "indicators": calculated_indicators,
            "trends": trends
        }
    
    except Exception as e:
        return {"error": f"Error calculating indicators: {str(e)}"}
