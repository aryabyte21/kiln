"""
tools/core_tools.py
───────────────────
Pre-built Babel tools.

Each tool is:
  1. A plain Python function (the actual logic)
  2. Decorated with @babel_tool (adds spec metadata)
  3. Registered into the global registry with register()

To add a new tool: copy the pattern below.
The framework adapters handle everything else.
"""

import os
import json
from babel import babel_tool, register


# ── Weather ───────────────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.weather",
    description="Get current weather conditions and temperature for any city worldwide.",
    tags=["weather", "real-time"],
    category="data",
    param_descriptions={
        "location": "City name or coordinates, e.g. 'Singapore' or '1.3521,103.8198'",
        "units":    "Temperature unit: celsius or fahrenheit",
    },
    param_enums={"units": ["celsius", "fahrenheit"]},
)
def get_weather(location: str, units: str = "celsius") -> dict:
    """Mock implementation — swap in a real API call here."""
    return {
        "location":    location,
        "temperature": 28 if units == "celsius" else 82,
        "units":       units,
        "conditions":  "Partly cloudy",
        "humidity":    75,
        "forecast":    "Chance of afternoon showers",
        "success":     True,
    }

register(get_weather)


# ── Web Search ────────────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.web_search",
    description="Search the web and return the top results with titles, snippets, and URLs.",
    tags=["search", "web", "research"],
    category="search",
    param_descriptions={
        "query":       "Search query string",
        "max_results": "Number of results to return (1-10)",
    },
)
def web_search(query: str, max_results: int = 5) -> dict:
    """Mock implementation — swap in Serper or Tavily API."""
    return {
        "query":   query,
        "results": [
            {
                "title":   f"Result {i+1} for: {query}",
                "snippet": f"This is a relevant snippet about {query}.",
                "url":     f"https://example.com/result-{i+1}",
            }
            for i in range(min(max_results, 3))
        ],
        "success": True,
    }

register(web_search)


# ── Restaurant Search ─────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.restaurant_search",
    description="Find restaurants by cuisine type and location. Returns top-rated options with address and rating.",
    tags=["restaurant", "food", "places"],
    category="search",
    param_descriptions={
        "cuisine":    "Cuisine type, e.g. 'Italian', 'Japanese', 'Indian'",
        "location":   "Area or address to search near, e.g. 'Marina Bay, Singapore'",
        "party_size": "Number of diners",
        "min_rating": "Minimum rating filter (1.0 to 5.0)",
    },
)
def restaurant_search(
    cuisine: str,
    location: str,
    party_size: int = 2,
    min_rating: float = 4.0,
) -> dict:
    """Mock implementation — swap in Google Places API."""
    return {
        "results": [
            {
                "name":       f"Osteria {cuisine.title()}",
                "address":    "101 Victoria Street, Singapore 188018",
                "rating":     4.7,
                "price_level": "$$",
                "place_id":   "mock_place_123",
                "phone":      "+65 6234 5678",
                "open_now":   True,
            }
        ],
        "query":   {"cuisine": cuisine, "location": location},
        "success": True,
    }

register(restaurant_search)


# ── Contact Lookup ────────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.contacts_lookup",
    description="Look up a contact by name. Returns phone number, email, and preferred communication channel.",
    tags=["contacts", "people", "communication"],
    category="personal",
    param_descriptions={
        "name": "Full or partial name of the contact to look up",
    },
)
def contacts_lookup(name: str) -> dict:
    """Mock implementation — swap in a real contacts API or CRM."""
    # Simulated contact store
    mock_contacts = {
        "priya": {
            "name":              "Priya Sharma",
            "phone":             "+65 9123 4567",
            "email":             "priya.sharma@email.com",
            "preferred_channel": "whatsapp",
        },
        "rahul": {
            "name":              "Rahul Gupta",
            "phone":             "+65 9876 5432",
            "email":             "rahul.gupta@email.com",
            "preferred_channel": "email",
        },
    }
    key = name.lower().split()[0]
    contact = mock_contacts.get(key)
    if contact:
        return {"found": True, "contact": contact, "success": True}
    return {"found": False, "query": name, "success": False}

register(contacts_lookup)


# ── Google Calendar ───────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.gcal_create",
    description="Create a Google Calendar event with title, date, time, location, and optional attendees.",
    tags=["calendar", "scheduling", "google"],
    category="productivity",
    param_descriptions={
        "title":       "Event title",
        "date":        "Date in YYYY-MM-DD format",
        "time":        "Start time in HH:MM 24hr format",
        "duration_mins": "Duration in minutes",
        "location":    "Optional event location",
        "description": "Optional event description or notes",
    },
)
def gcal_create(
    title: str,
    date: str,
    time: str,
    duration_mins: int = 60,
    location: str = "",
    description: str = "",
) -> dict:
    """Mock implementation — swap in Google Calendar API."""
    return {
        "event_id":   "mock_event_abc123",
        "title":      title,
        "date":       date,
        "time":       time,
        "location":   location,
        "calendar_url": "https://calendar.google.com/event/mock_event_abc123",
        "success":    True,
    }

register(gcal_create)


# ── WhatsApp Send ─────────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.whatsapp_send",
    description="Send a WhatsApp message to a phone number.",
    tags=["whatsapp", "messaging", "communication"],
    category="communication",
    param_descriptions={
        "phone_number": "Recipient phone number with country code, e.g. '+65 9123 4567'",
        "message":      "Message body to send",
    },
)
def whatsapp_send(phone_number: str, message: str) -> dict:
    """Mock implementation — swap in WhatsApp Business API."""
    print(f"[WhatsApp Mock] → {phone_number}: {message}")
    return {
        "success":    True,
        "message_id": "wamid.mock_abc123",
        "to":         phone_number,
        "status":     "sent",
    }

register(whatsapp_send)


# ── Maps Directions ───────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.maps_directions",
    description="Get directions between two locations. Returns estimated duration, distance, and step-by-step route.",
    tags=["maps", "navigation", "directions"],
    category="location",
    param_descriptions={
        "origin":      "Starting location — address or place name",
        "destination": "Destination — address or place name",
        "mode":        "Travel mode: driving, walking, transit, or bicycling",
    },
    param_enums={"mode": ["driving", "walking", "transit", "bicycling"]},
)
def maps_directions(
    origin: str,
    destination: str,
    mode: str = "driving",
) -> dict:
    """Mock implementation — swap in Google Maps Directions API."""
    return {
        "origin":         origin,
        "destination":    destination,
        "mode":           mode,
        "duration_mins":  12,
        "distance_km":    3.4,
        "steps": [
            f"Head towards {destination}",
            "Continue for 3.4 km",
            f"Arrive at {destination}",
        ],
        "success": True,
    }

register(maps_directions)


# ── Email Send ────────────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.email_send",
    description="Send an email to a recipient. Supports plain text and optional HTML body.",
    tags=["email", "communication"],
    category="communication",
    param_descriptions={
        "to":      "Recipient email address",
        "subject": "Email subject line",
        "body":    "Plain text email body",
    },
)
def email_send(to: str, subject: str, body: str) -> dict:
    """Mock implementation — swap in SMTP or Gmail API."""
    print(f"[Email Mock] To: {to} | Subject: {subject}")
    return {
        "success":    True,
        "message_id": f"<mock_{hash(to+subject)}@aria.local>",
        "to":         to,
        "subject":    subject,
    }

register(email_send)
