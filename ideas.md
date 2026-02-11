# CS5224 Project Ideas (Pre-Plan)

Based on the project specification (SaaS with web interface, problem-focused, and cloud vs on-prem cost comparison), these ideas are strong candidates.

## Selection Criteria

- Solves a real user problem with measurable impact.
- Can be demonstrated with an end-to-end web flow.
- Has clear usage metrics for evaluation.
- Can be deployed both on-prem and cloud for cost comparison.

## Idea 1: Hawker Queue Predictor (Recommended)

Problem:
Commuters waste time deciding where to eat during peak hours.

SaaS:
A web app that predicts queue time per hawker center/store using public mobility/weather/time signals.

Users:
Office workers, students, mall operators.

Why it is good for CS5224:

- Simple but meaningful machine-learning or rules-based backend.
- Clear metrics: prediction MAE, user-reported usefulness, response latency.
- Straightforward cost comparison: cloud managed DB + serverless vs on-prem VM + self-managed DB.

## Idea 2: HDB Lift Fault Heatmap and Alerting

Problem:
Residents do not get proactive visibility on recurring lift disruptions.

SaaS:
Dashboard that aggregates incident feeds and highlights risk zones with notifications.

Users:
Residents, town councils, facilities teams.

Evaluation:

- Incident detection delay
- Alert precision/recall
- Uptime and dashboard latency

## Idea 3: Campus Study Space Availability Forecaster

Problem:
Students spend time searching for available study seats.

SaaS:
Web platform forecasting occupancy by zone and time slot.

Users:
NUS students and campus planning teams.

Evaluation:

- Occupancy prediction error
- Conversion from forecast view to booking/check-in action

## Idea 4: SME Utility Cost Optimizer

Problem:
Small businesses struggle to detect waste in electricity/water usage.

SaaS:
Upload bills and usage data; service suggests optimization actions and projected savings.

Users:
SME owners and operations managers.

Evaluation:

- Estimated savings quality
- Action adoption rate
- Time saved vs manual analysis

## Idea 5: Last-Mile Delivery Route Stress Index

Problem:
Small logistics teams lack route risk visibility in weather/traffic spikes.

SaaS:
Route scoring and re-plan recommendations with live map.

Users:
Courier SMEs.

Evaluation:

- Delay reduction
- Route recomputation latency
- Cost per optimization run

## Suggested Next Step

Pick one idea this week and lock:

- target users
- top 3 features
- evaluation metrics
- assumed pricing model

Then move to preliminary report draft sections in `docs/`.
