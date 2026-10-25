# Project: Wind forecast accuracy portal for a UK energy utility

## Business context
The client is a UK utility whose team buys power on the GB day-ahead market.
Decisions for delivery day D must be made on day D-1, before the auction gate closes.
They need to know (1) the latest wind forecast available AT DECISION TIME and
(2) how accurate those forecasts have historically been, so they can size how much
extra (e.g. thermal) power to procure.

Scope: national-level wind only, from Elexon BMRS, January 2026 delivery days only.
- Actuals: FUELHH stream, fuelType == "WIND" (fields: startTime, generation)
  https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream
- Forecasts: WINDFOR stream (fields: startTime, publishTime, generation)
  https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream
No other data sources.

## Core domain rule (the most important thing in this project)
For each target half-hour (startTime) on delivery day D, the "decision-time forecast" is
the forecast with the LATEST publishTime that is <= the cutoff on D-1.
It is NOT the newest forecast in the dataset. Using post-cutoff forecasts is a
look-ahead leak and invalidates the whole analysis.
- The cutoff is configurable (default: 09:00 UK time on D-1; verify real GB day-ahead
  gate closure times for EPEX/N2EX and document them, but keep it a parameter).
- Forecasts for early-January targets were published in late December, so ingestion
  must fetch a wider publish window than January.
- All timestamps are handled in UTC internally; state the timezone assumption
  (UK = UTC in January) and convert only at the display edge.

## Tech requirements
- Backend: Python (FastAPI, pandas, pydantic, pytest)
- Frontend: React + TypeScript (Vite), charting with Recharts or Plotly
- Docker (multi-stage build, single deployable container serving API + built frontend,
  plus docker-compose for local run)
- Deploy target: Heroku container stack (Vercel does not run Docker; explain in README)
- README must list files/directories, how to run, live link, and EXPLICITLY state
  that AI tools (Claude Code) were used.
- Total budget is 16 hours: prefer simple, correct, readable, tested code over
  cleverness. No over-engineering (no Celery, Airflow, microservices).

## Working rules
- Work in the phases I give you, one at a time. At the end of each phase, stop,
  summarise what you did, list any assumptions or open questions, and wait for my go-ahead.
- Never hard-code numbers in UI or docs; everything derives from the data.
- Never let missing data silently become zero. Surface it explicitly.
- Every API response includes explicit units (MW, MWh) and ISO-8601 UTC timestamps.
- Keep a running `docs/DECISIONS.md` of assumptions and trade-offs (I will use it
  to explain the design to a technical reviewer).
- Verify API parameters against the live Elexon docs/OpenAPI spec rather than guessing.

## Target repo layout (adjust if needed, but tell me why)
backend/  (app/, tests/, pyproject or requirements.txt)
frontend/ (src/, ...)
data/     (raw/ and processed/ snapshots)
scripts/  (ingestion and analysis experiments)
docs/     (DECISIONS.md, replay definition)
Dockerfile, docker-compose.yml, README.md

## Dependency rules
- The frontend is already scaffolded with the latest Vite + React + TypeScript. Do NOT re-scaffold it or downgrade any package.
- Before adding a dependency, check the latest stable version (`npm view <pkg> version` / `pip index versions <pkg>`) and use it. Don't pin from memory.
- Don't change versions in package.json or requirements.txt unless something is broken, and tell me why if you do.