# Wind Forecast Accuracy Portal — GB Day-Ahead Wholesale Trading

> **Enterprise Renewable Generation Forecast Evaluation & Decision Support System**  
> Tailored for UK Energy Utility Commercial Trading & Optimization Teams.

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19.3-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ed.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 1. Executive Summary & Business Context

In Great Britain's wholesale electricity market, day-ahead power purchases for delivery day **$D$** must be committed and scheduled on day **$D-1$** prior to auction gate closures (e.g., EPEX Spot 11:00 UTC, N2EX 09:30 UTC). 

Energy utilities rely heavily on weather-dependent wind generation forecasts to determine net residual demand:
$$\text{Net Thermal Need} = \max(\text{Consumer Demand} - \text{Wind Generation}, 0)$$

An over-forecast creates a costly physical shortfall in the Balancing Mechanism (cash-out penalties or last-minute thermal peaking plants). Conversely, an under-forecast results in excess contracted power that must be spilled or sold at discount imbalance prices.

This portal provides quantitative decision support for traders and portfolio managers:
1. **Decision Replay**: Reconstructs the exact national wind forecast visible to the trader at the D-1 decision cutoff time (default: `09:00 UTC`), completely free of look-ahead leaks.
2. **Quantitative Accuracy Evaluation**: Evaluates empirical forecast accuracy across January 2026 delivery days with statistically robust metrics (avoiding misleading MAPE blowups).
3. **Wholesale Buy Range Recommendation**: Derives empirical confidence bands and recommended procurement ranges (MW and MWh) based strictly on historical outturn errors up to the day before delivery.

---

## 2. Core Domain Principles & Methodology

### 2.1 The Decision Cutoff Rule (Zero Look-Ahead Guarantee)
For any target half-hour interval ($\text{startTime}$) on delivery day **$D$**, the "decision-time forecast" is defined strictly as:
$$\text{forecast}_{\text{decision}} = \operatorname*{argmax}_{\text{publishTime} \le \text{cutoff}_{D-1}} (\text{publishTime})$$

*Using forecasts published after the cutoff time represents an illegal look-ahead leak that invalidates real-world utility performance.*

### 2.2 Why MAPE is Prohibited (and Normalized MAE is Used)
Mean Absolute Percentage Error ($\text{MAPE} = \frac{1}{N} \sum \left|\frac{\text{forecast} - \text{actual}}{\text{actual}}\right|$) divides by the actual generation outturn. In wind power, generation frequently approaches near-zero during calm high-pressure periods. Dividing by near-zero causes MAPE to diverge asymptotically (e.g., $10,000\%+$), rendering the metric commercially meaningless.

We standardize on **Normalized MAE (nMAE)**:
$$\text{nMAE} = \frac{\text{MAE}}{\mu(\text{Actual})} = \frac{\frac{1}{N} \sum_{i=1}^N |\hat{y}_i - y_i|}{\frac{1}{N} \sum_{i=1}^N y_i}$$
This normalizes error relative to average fleet delivery while preserving stability.

### 2.3 Transparent Empirical Quantiles (No Black-Box ML)
Uncertainty bounds and shortfall risk are estimated using empirical quantiles of historical forecast error ($\text{error} = \text{forecast} - \text{actual}$) derived strictly from prior days ($D-k \dots D-1$). No black-box neural networks or untestable ML models are used.

---

## 3. Architecture & Tech Stack

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser / Client                      │
│      React 19 + TypeScript + Vite + Recharts + Lucide       │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / REST (/api/*)
┌──────────────────────────────▼──────────────────────────────┐
│                  FastAPI Analytical Backend                 │
│         - Routing, validation (Pydantic v2), OpenAPI        │
│         - In-memory Parquet Analytics Store (PyArrow)       │
│         - Pure mathematical evaluation & uncertainty engine │
└──────────────────────────────┬──────────────────────────────┘
                               │ Fast Parquet I/O
┌──────────────────────────────▼──────────────────────────────┐
│                   Reproducible Data Store                   │
│         - Elexon BMRS FUELHH (WIND) actual outturns         │
│         - Elexon BMRS WINDFOR multi-horizon forecasts       │
└─────────────────────────────────────────────────────────────┘
```

- **Backend**: Python 3.12, FastAPI, Pydantic v2, PyArrow, Pandas, Pytest
- **Frontend**: React 19, TypeScript 5.6, Vite, Recharts, Lucide Icons
- **Design System**: Monochromatic, high-contrast palette (zero gradients), crisp typography (Inter, JetBrains Mono)
- **Containerization**: Multi-stage Docker build, single deployable image serving both API and static frontend assets

---

## 4. Repository Structure

```
.
├── backend/
│   ├── app/
│   │   ├── elexon/              # Elexon BMRS REST API stream client
│   │   │   ├── __init__.py
│   │   │   └── client.py
│   │   ├── pipeline/            # Ingestion, normalization, & selection
│   │   │   ├── __init__.py
│   │   │   ├── join.py          # Clean UTC time joins & audits
│   │   │   ├── normalize.py     # Schema normalization & casting
│   │   │   └── selection.py     # Decision-time cutoff filtering
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app & static files mount
│   │   ├── metrics.py           # Pure math: MAE, RMSE, nMAE, box plots
│   │   ├── routes.py            # Analytical REST endpoints
│   │   ├── schemas.py           # Pydantic response models with explicit units
│   │   ├── store.py             # Sub-millisecond in-memory Parquet store
│   │   └── uncertainty.py       # Empirical quantile & walk-forward engine
│   ├── tests/                   # 66 comprehensive pytest unit & integration tests
│   └── requirements.txt         # Pinned Python production dependencies
├── frontend/
│   ├── public/                  # Favicon and vector assets
│   ├── src/
│   │   ├── api/                 # Typed API client
│   │   │   └── client.ts
│   │   ├── components/          # Decision-oriented views
│   │   │   ├── BoxPlotChart.tsx # SVG Box-and-Whisker plot
│   │   │   ├── IntervalTable.tsx# Sortable settlement period audit table
│   │   │   ├── KPICard.tsx      # Compact metrics card widget
│   │   │   ├── Page1Accuracy.tsx# Page 1: Accuracy & historical KPIs
│   │   │   ├── Page2DecisionReplay.tsx # Page 2: Day-Ahead forecast & bounds
│   │   │   └── Page3BuyRange.tsx# Page 3: Buy range recommendation
│   │   ├── utils/               # Date formatting utilities
│   │   │   └── date.ts
│   │   ├── App.tsx              # Main application tab router
│   │   ├── index.css            # Design tokens & responsive styles
│   │   ├── main.tsx             # Application bootstrap
│   │   └── theme.ts             # Brand tokens & color constants
│   ├── eslint.config.js         # ESLint configuration
│   ├── index.html               # HTML5 entry with metadata & favicon
│   ├── package.json             # Frontend dependency manifest
│   ├── tsconfig.json            # TypeScript configuration
│   └── vite.config.ts           # Vite build configuration
├── data/
│   ├── processed/               # Reproducible Parquet analytical snapshots
│   └── raw/                     # Raw Elexon BMRS JSON dumps
├── docs/
│   ├── DECISIONS.md             # Technical trade-offs & architecture records
│   └── replay_definition.md     # Mathematical replay definition
├── scripts/
│   ├── build_snapshot.py        # Snapshot generation & validation script
│   ├── build_december_and_january.py # Extended history builder
│   └── explore_data.py          # Elexon BMRS exploratory script
├── Dockerfile                   # Multi-stage production container build
├── docker-compose.yml           # Local multi-container orchestration
├── pytest.ini                   # Pytest configuration
├── CLAUDE.md                    # Project guidance & rules
└── README.md                    # Project documentation
```

---

## 5. Getting Started

### 5.1 Prerequisites
- **Python**: 3.12+
- **Node.js**: 20+
- **Docker**: Optional, for containerized run

### 5.2 Running Locally (Development Mode)

#### 1. Start the Backend API
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
- API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health Check: [http://localhost:8000/api/health](http://localhost:8000/api/health)

#### 2. Start the Frontend Dev Server
```bash
cd frontend
npm install
npm run dev
```
- Web Application: [http://localhost:5173](http://localhost:5173)

---

### 5.3 Running with Docker

Build and run the entire unified application in a single production-ready container:

```bash
# Using Docker Compose
docker compose up --build

# Or using plain Docker
docker build -t wind-forecast-portal .
docker run -p 8000:8000 wind-forecast-portal
```
Open [http://localhost:8000](http://localhost:8000) to view the application.

---

## 6. Running Tests & Quality Checks

### 6.1 Backend Test Suite (Pytest)
Run the 66 integration and unit tests covering domain correctness, temporal integrity, and API schemas:
```bash
cd backend
pytest -v
```

### 6.2 Frontend Typecheck & Linter
Validate strict TypeScript compilation and ESLint zero-warning policy:
```bash
cd frontend
npm run build
npm run lint
```

---

## 7. Commercial Application Features

The portal answers three core trader questions across three dedicated views:

1. **Page 1: Accuracy & History**
   - 4 High-level KPI widgets: MAE, Normalized MAE (nMAE), Bias, and P90 Shortfall Buffer.
   - 7-Day / 30-Day Forecast vs Actual outturn trend with shortfall delta indicators.
   - Precision Tukey Box-and-Whisker plot displaying error dispersion, median, and extreme outliers.
   - Comprehensive settlement period audit table with CSV export.

2. **Page 2: Decision Replay (Day-Ahead Forecast & Downside Risk)**
   - Reconstructs the D-1 09:00 UTC forecast for any chosen January 2026 delivery day.
   - Empirical plausible uncertainty bands (80% / 90% coverage) derived from prior days without look-ahead.
   - Half-hourly shortfall risk probability bar chart highlighting hours most exposed to deficits.

3. **Page 3: Wholesale Buy Range (The Recommendation)**
   - Interactive consumer demand input with presets (8k, 10k, 12k, 15k MW).
   - Recommended daily procurement volumes (Base Need, Recommended Need, Buffer).
   - Half-hourly procurement schedule band chart translating wind forecasts into actionable wholesale power purchase orders.

---

## 8. Deployment & Deliverables

- **Live Deployment**: Sample application is configured for deployment on Heroku Container Stack (or any Docker-compatible cloud platform).
- **Video Demonstration**: Max 10-minute demonstration covering:
  - *Part 1 (Client Pitch)*: Presentation to utility power procurement managers.
  - *Part 2 (Tech Lead Review)*: Software architecture, domain correctness, and testing practices.

---

## 9. AI Assistance Disclosure

In full compliance with challenge requirements, AI tools (**Antigravity / Claude 3.5 Sonnet & Claude Code**) were utilized as pair programming assistants during research, domain exploration, test creation, and architectural refactoring. All code, domain logic, and empirical backtests were rigorously reviewed, validated, and verified against the live Elexon BMRS API specifications.
