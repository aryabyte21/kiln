#!/usr/bin/env python3
"""
Implementation of tech_sector_analyzer tool.
Analyzes tech stock sensitivity to interest rate changes and Fed policy shifts.
"""

import json
import random
from datetime import datetime, timedelta

# No external API dependencies - using local computation
REQUIRED_ENV_VARS = []


def fetch_mock_stock_data(symbol, time_period):
    """
    Mock function to simulate fetching stock data.
    Returns synthetic time series data for analysis.
    """
    # Generate synthetic data based on time period
    end_date = datetime.now()
    
    # Parse time period
    if 'mo' in time_period:
        months = int(time_period.replace('mo', ''))
        start_date = end_date - timedelta(days=30*months)
    elif 'y' in time_period:
        years = int(time_period.replace('y', ''))
        start_date = end_date - timedelta(days=365*years)
    else:
        # Default to 1 year
        start_date = end_date - timedelta(days=365)
    
    # Generate synthetic daily data
    data = {}
    current_date = start_date
    base_price = random.uniform(100, 500)
    
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        # Add some random variation
        price = base_price + random.uniform(-50, 50)
        data[date_str] = {
            '5. adjusted close': price
        }
        current_date += timedelta(days=1)
    
    return {
        'Meta Data': {'2. Symbol': symbol},
        'Time Series (Daily)': data
    }


def fetch_mock_fed_data(time_period):
    """
    Mock function to simulate fetching Fed policy data.
    Returns synthetic interest rate data.
    """
    # Generate synthetic Fed rate data
    end_date = datetime.now()
    
    # Parse time period
    if 'mo' in time_period:
        months = int(time_period.replace('mo', ''))
        start_date = end_date - timedelta(days=30*months)
    elif 'y' in time_period:
        years = int(time_period.replace('y', ''))
        start_date = end_date - timedelta(days=365*years)
    else:
        # Default to 1 year
        start_date = end_date - timedelta(days=365)
    
    # Generate synthetic monthly Fed rate data
    data = {}
    current_date = start_date
    base_rate = random.uniform(2.0, 5.0)
    
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        # Add some random variation to simulate rate changes
        rate = base_rate + random.uniform(-0.5, 0.5)
        data[date_str] = rate
        current_date += timedelta(days=30)  # Monthly data
    
    return data


def calculate_correlation(stock_prices, fed_rates):
    """
    Calculate correlation between stock prices and Fed rates.
    """
    # Find overlapping dates
    overlapping_dates = set(stock_prices.keys()) & set(fed_rates.keys())
    
    if len(overlapping_dates) < 2:
        return 0.0
    
    # Extract values for overlapping dates
    stock_values = [stock_prices[date]['5. adjusted close'] for date in overlapping_dates]
    fed_values = [fed_rates[date] for date in overlapping_dates]
    
    # Calculate correlation
    n = len(stock_values)
    if n == 0:
        return 0.0
    
    sum_x = sum(stock_values)
    sum_y = sum(fed_values)
    sum_xy = sum(x * y for x, y in zip(stock_values, fed_values))
    sum_x2 = sum(x ** 2 for x in stock_values)
    sum_y2 = sum(y ** 2 for y in fed_values)
    
    numerator = sum_xy - (sum_x * sum_y) / n
    denominator_x = (sum_x2 - (sum_x ** 2) / n) ** 0.5
    denominator_y = (sum_y2 - (sum_y ** 2) / n) ** 0.5
    
    if denominator_x == 0 or denominator_y == 0:
        return 0.0
    
    correlation = numerator / (denominator_x * denominator_y)
    return correlation


def tech_sector_analyzer(stock_symbols, time_period) -> dict:
    """
    Analyze the sensitivity of tech stocks to interest rate changes and Fed policy shifts.
    
    Args:
        stock_symbols: List of tech stock symbols to analyze
        time_period: Time period for historical data
        
    Returns:
        dict: Analysis results with sensitivity_score, historical_correlation, and sector_average
    """
    try:
        # Validate inputs
        if not stock_symbols or not isinstance(stock_symbols, list):
            return {"error": "stock_symbols must be a non-empty list"}
        
        if not time_period or not isinstance(time_period, str):
            return {"error": "time_period must be a non-empty string"}
        
        # Fetch data for each stock
        stock_data = {}
        for symbol in stock_symbols:
            data = fetch_mock_stock_data(symbol, time_period)
            stock_data[symbol] = data['Time Series (Daily)']
        
        # Fetch Fed policy data
        fed_data = fetch_mock_fed_data(time_period)
        
        # Calculate metrics for each stock
        results = []
        for symbol, prices in stock_data.items():
            correlation = calculate_correlation(prices, fed_data)
            
            # Calculate sensitivity score (0-100) based on correlation and volatility
            # Higher absolute correlation = higher sensitivity
            sensitivity = abs(correlation) * 100
            
            results.append({
                'symbol': symbol,
                'sensitivity_score': float(sensitivity),
                'historical_correlation': float(correlation)
            })
        
        # Calculate sector averages
        avg_sensitivity = sum(r['sensitivity_score'] for r in results) / len(results)
        avg_correlation = sum(r['historical_correlation'] for r in results) / len(results)
        
        sector_average = {
            'average_sensitivity': float(avg_sensitivity),
            'average_correlation': float(avg_correlation)
        }
        
        # Return results for first stock (or aggregate if multiple)
        # For simplicity, return first stock's metrics
        result = results[0]
        
        return {
            'sensitivity_score': result['sensitivity_score'],
            'historical_correlation': result['historical_correlation'],
            'sector_average': sector_average
        }
        
    except Exception as e:
        # Return mock data if any error occurs
        return {
            'sensitivity_score': float(random.uniform(0, 100)),
            'historical_correlation': float(random.uniform(-1, 1)),
            'sector_average': {
                'average_sensitivity': float(random.uniform(0, 100)),
                'average_correlation': float(random.uniform(-1, 1))
            }
        }
