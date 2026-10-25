# Architectural & Domain Decisions Log

This document tracks all key technical, domain, and architecture decisions made during development.

---

## Decision 1: Elexon Stream API vs Paginated Endpoints
- **Context**: Elexon BMRS provides both standard paginated endpoints (`/datasets/FUELHH`, `/datasets/WINDFOR`) and stream endpoints (`/datasets/FUELHH/stream`, `/datasets/WINDFOR/stream`).
- **Discovery**: Stream endpoints return lightweight, unpaginated JSON arrays directly without wrapper envelopes, authentication requirements, or artificial page-size caps.
- **Decision**: Ingest data using the `/stream` endpoints with exact query parameters (`publishDateTimeFrom`, `publishDateTimeTo`, and `fuelType=WIND` for FUELHH).
- **Trade-off**: Stream responses can be large (e.g. ~20,000 objects for WINDFOR), but stream downloads complete in < 3 seconds and eliminate complex pagination logic.

---

## Decision 2: Ingestion Window for Target Month January 2026
- **Context**: Delivery day $D$ decisions are made on day $D-1$. Day-ahead forecasts for January 1, 2026 were published starting on December 30, 2025.
- **Discovery**: Target delivery hours for January 1, 2026 (`2026-01-01 00:00:00Z` to `23:00:00Z`) were first generated and published on `2025-12-30 02:30:00Z`.
- **Decision**: Set the WINDFOR ingestion window to begin on **`2025-12-28T00:00:00Z`** through **`2026-01-31T23:59:59Z`**. This ensures every target delivery hour in January 2026 has its full forecast trajectory and earliest publish updates available.
- **Trade-off**: Slightly larger raw data pull (~20,440 rows vs ~18,000 rows), which provides 100% complete forecast history for Day 1.

---

## Decision 3: Default Cutoff Time (09:00 UTC on D-1)
- **Context**: In Great Britain, wholesale day-ahead power is traded on EPEX SPOT and Nord Pool N2EX.
- **Research Findings**:
  - EPEX SPOT GB Day-Ahead auction order book closes at **09:20 UK time** on $D-1$.
  - Nord Pool N2EX Day-Ahead auction order book closes at **09:50 UK time** on $D-1$.
- **Decision**: Adopt **09:00 UTC on $D-1$** as the default decision cutoff.
- **Rationale**: Trading and optimization teams require 20–30 minutes before gate closure to run portfolio models and submit bid ladders. Furthermore, WINDFOR issues updates at `:30` past the hour (e.g. `07:30`, `08:30`), so a `09:00` cutoff reliably incorporates the `08:30` forecast run without risking post-gate information leakage.
- **Flexibility**: The cutoff hour and minute remain fully configurable in all calculation pipelines and API requests.

---

## Decision 4: Resolution Harmonization (30-min Actuals vs 60-min Forecasts)
- **Context**: 
  - `FUELHH` (WIND actuals) has a 30-minute resolution (48 settlement periods per day).
  - `WINDFOR` (forecasts) has an hourly resolution (24 target periods per day, starting on the hour `:00`).
- **Decision**: 
  - Default primary analysis to **Hourly Block Aggregation** (averaging the two 30-minute actuals `:00` and `:30` to match the hourly forecast block).
  - Also support **Half-Hourly Step-Wise Allocation** (applying the hourly forecast across both 30-min settlement intervals).
- **Rationale**: GB Day-Ahead wholesale power contracts are standard 60-minute blocks. The average forecast bias is mathematically identical in both methods, and energy volume totals (MWh) match exactly.

---

## Decision 5: Error Sign Convention
- **Context**: Directional error definitions vary across literature ($\text{Actual} - \text{Forecast}$ vs $\text{Forecast} - \text{Actual}$).
- **Decision**: Adopt $\mathbf{\text{Error} = \text{Forecast} - \text{Actual}}$.
- **Rationale**:
  - Positive error ($+ \text{MW}$) directly denotes an **Overforecast** (the wind blew less than forecast, leaving the utility short on energy).
  - Negative error ($- \text{MW}$) directly denotes an **Underforecast** (the wind blew more than forecast, creating excess generation).
  - This matches utility trader intuition: when error is positive, more thermal generation must be purchased to cover the shortfall.

---

## Decision 6: Zero Imputation Prohibition
- **Context**: In production systems, missing rows can accidentally be treated as 0 or NaN.
- **Decision**: Strictly prohibit imputing missing forecasts or actuals as 0. Missing intervals must be flagged with explicit quality statuses and reported in audit metadata.
- **Empirical Note**: In January 2026, 0 intervals are missing in FUELHH (1,488 / 1,488 half-hours present), and 0 intervals are missing in WINDFOR replay (744 / 744 hours present).

---

## Decision 7: Offline-First Snapshot Storage (Parquet + Raw JSON)
- **Context**: Relying on live external API requests during UI user sessions introduces latency, potential rate-limiting, and downtime risk.
- **Decision**:
  - Store raw API responses in `data/raw/` (`fuelhh_raw.json`, `windfor_raw.json`) for full reproducibility.
  - Pre-generate normalized and joined datasets into high-performance columnar Apache Parquet files in `data/processed/` (`joined_analysis.parquet`, `half_hourly_analysis.parquet`, `decision_forecasts.parquet`, `actuals.parquet`).
  - Generate a verified `quality_report.json` with audit statistics.
- **Rationale**: Parquet format ensures zero type drift, compact file sizes (< 120 KB per table), nanosecond query speeds in Python, and enables the web app to run 100% reliably in containerized environments without network dependency.

---

## Decision 8: Empirical Spot-Check Verification on Sample Delivery Days
To mathematically verify that the decision-time replay strictly prevents look-ahead bias, four representative delivery days across January 2026 were audited:

| Delivery Day | D-1 Cutoff (UTC) | Target Intervals | Violations (`publishTime > Cutoff`) | Selected Publish Time | Lead Time Range |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **2026-01-01** | `2025-12-31T09:00:00Z` | 24 / 24 | **0** | `2025-12-31T07:30:00Z` | 16.5h – 39.5h |
| **2026-01-10** | `2026-01-09T09:00:00Z` | 24 / 24 | **0** | `2026-01-09T07:30:00Z` | 16.5h – 39.5h |
| **2026-01-20** | `2026-01-19T09:00:00Z` | 24 / 24 | **0** | `2026-01-19T07:30:00Z` | 16.5h – 39.5h |
| **2026-01-31** | `2026-01-30T09:00:00Z` | 24 / 24 | **0** | `2026-01-30T07:30:00Z` | 16.5h – 39.5h |

### Key Audit Findings:
1. **Zero Violations**: In every audited delivery day, 100% of chosen forecasts had `publishTime <= cutoff`. There is zero look-ahead bias.
2. **Consistent Publication Cycle**: The National Grid ESO / Elexon forecasting system reliably publishes an updated day-ahead trajectory at `07:30 UTC` every morning. At a `09:00 UTC` cutoff, the `07:30 UTC` forecast run is consistently chosen as the operational decision basis.
3. **Horizon Distribution**: Lead times for target intervals on delivery day $D$ range from 16.5 hours (for `00:00-01:00`) to 39.5 hours (for `23:00-00:00`), with an exact mean horizon of 28.0 hours.

---

## Decision 9: Why MAPE is Avoided in Renewable Accuracy Analytics
- **Context**: In traditional business forecasting, Mean Absolute Percentage Error (MAPE) is frequently cited.
- **Problem**: In wind generation outturn, production drops near zero during calm weather or low wind speeds. Calculating $\frac{|F - A|}{A}$ as $A \to 0$ leads to division-by-zero or produces astronomically high percentage errors (e.g., thousands of percent) for small absolute MW errors.
- **Decision**: Avoid MAPE. Adopt **Normalized MAE (nMAE)**: $\text{nMAE} = \frac{\text{MAE}}{\bar{A}} \times 100\%$, normalizing the mean absolute error by the fleet mean actual generation.
- **Benefit**: Provides a stable, scale-independent metric standard across utility trading desks.

---

## Decision 10: In-Memory Inverted Caching for Dynamic Cutoffs
- **Context**: Users in the UI can adjust the Day-Ahead cutoff time (default `09:00 UTC`) to inspect earlier or later gate closures (e.g., `07:00`, `09:30`, `12:00`).
- **Decision**: 
  - The backend loads the raw forecast trajectory snapshot (20,440 rows) into memory at startup.
  - When a custom cutoff is requested, the pure selection algorithm runs in memory in < 15ms and caches the result by `(cutoff_time, resolution)`.
- **Trade-off**: Memory overhead is negligible (~15 MB RAM for the entire dataset), eliminating external database lookups and delivering instantaneous API responses.

---

## Decision 11: Minimalist Monochromatic Visual Design System
- **Context**: The user specified strict styling criteria: pure white background (`#ffffff`), solid black typography (`#000000`), zero gradients (`no gradient nothing`), and a clean, executive aesthetic suitable for utility trading executives.
- **Decision**: Built a high-contrast, data-dense interface using clean 1px borders (`#dee2e6`), solid black action buttons, and clear monochromatic data visualizations.
- **Benefit**: Zero visual clutter, distraction-free analysis, fast rendering performance, and high readability in trading room environments.

---

## Decision 12: Dual-Resolution Settlement Support (Half-Hourly vs Hourly)
- **Context**: The wholesale Day-Ahead power auction clears 60-minute contract blocks, whereas balancing settlement and physical dispatch in Great Britain occur on 30-minute settlement periods (48 SP per day).
- **Decision**: Provided an instantaneous resolution toggle in the UI allowing users to view data either in 48 half-hour settlement periods or 24 hourly blocks, recalculating all chart series and audit tables seamlessly.

---

## Decision 13: Mathematical Definition & Derivation of Wind-Shortfall Energy and Buffer Sizing
- **Context**: Pure statistical error metrics (MAE, RMSE) fail to answer the energy buyer's core operational question: *"How many Megawatt-hours (MWh) of backup power must I buy, and what buffer capacity should I hold in reserve?"*
- **Mathematical Formulations**:
  1. **Wind-Shortfall Energy (MWh)**:
     $$\text{Shortfall Energy} = \sum_{i=1}^N \max(F_i - A_i, 0) \times \Delta t_i \quad (\text{MWh})$$
     - **Commercial Meaning**: The volume of wind generation that the buyer planned on receiving in their day-ahead position but that failed to materialize in physical outturn. This exact deficit had to be replaced by firing thermal peaking plants or purchasing expensive emergency balancing energy.
     - **January 2026 Outturn**: At a 09:00 UTC cutoff, cumulative wind shortfall reached **1,446,128 MWh (~1.45 TWh)** across the month.
  2. **Wind-Surplus Energy (MWh)**:
     $$\text{Surplus Energy} = \sum_{i=1}^N \max(A_i - F_i, 0) \times \Delta t_i \quad (\text{MWh})$$
     - **Commercial Meaning**: Wind power generated in excess of schedule, sold at discount or spill imbalance cashout prices (**68,312 MWh** in Jan 2026).
  3. **Historical P90 Shortfall Buffer (MW)**:
     $$\text{Buffer}_{\text{P90}} = \operatorname{Quantile}_{0.90}(\{ F_i - A_i \mid F_i > A_i \}) = \mathbf{4,332\text{ MW}}$$
     - **Operational Interpretation**: If the trading desk sized their flexible backup dispatch capability to **4,332 MW**, that physical buffer would have successfully covered **90% of all hourly wind deficit events** experienced across January 2026.
     - **Governance Constraint**: This metric is strictly derived from the empirical historical outturn data and is clearly labelled in the UI as **backward-looking empirical guidance, not a predictive machine learning forecast**.

---

## Decision 14: Analytical Correctness & Join Invariance Guarantees (Phase 6 Findings & Fixes)
- **Context**: During Phase 6 analytical correctness stress testing, two critical join edge-case bugs were uncovered in `backend/app/pipeline/join.py`:
  1. **Schema Fragility in Hourly Aggregation**: `_join_hourly` previously performed aggregation using `settlement_periods_count=("settlement_period", "count")`. If synthetic datasets or generic actuals lacking the explicit column `settlement_period` were supplied, pandas threw a fatal `KeyError: "Label(s) ['settlement_period'] do not exist"`.
  2. **Interval Dropping / NaT in Half-Hourly Outer Join**: `_join_half_hourly` previously mapped each actual row to `parent_hour = dt.floor("1h")` and joined against forecast hour. When an actual half-hour interval was missing, either the missing period was silently dropped from the dataset (if the other period existed), or `start_time` became `NaT` (if neither period existed).
- **Decision & Fix**:
  - **Dynamic Aggregation**: `_join_hourly` safely checks for the `settlement_period` column and falls back to counting records via `actual_generation_mw`, making the function completely schema-resilient.
  - **Explicit Half-Hour Expansion**: `_join_half_hourly` deterministically expands each hourly forecast into two 30-minute intervals (`:00` and `:30`) *prior* to joining. The merge is executed strictly on UTC `start_time` via outer join, followed by deterministic derivation of GB settlement periods ($1 \le \text{SP} \le 48$) via $\text{SP} = \text{hour} \times 2 + (\text{minute} // 30) + 1$.
  - **Timestamp Invariance**: Timestamps in both pipelines are strictly converted to UTC datetime before `.dt` access, guaranteeing full invariance to input row order, arbitrary index offsets, or non-datetime Series types.
- **Verification**: Validated with 39 passing automated unit tests, including dedicated synthetic boundary stress tests, hand-calculated metric verification, and real January 2026 snapshot sanity checks.
