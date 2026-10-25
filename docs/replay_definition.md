# Replay Definition: Decision-Time Wind Forecast Evaluation

## 1. Executive Summary & Problem Setting
In the Great Britain (GB) wholesale power market, utilities and commercial trading desks purchase electricity on day $D-1$ to balance expected consumer demand against renewable generation for each delivery interval on day $D$. 

Thermal and dispatchable generation must be procured to cover net demand (demand minus renewables). Because wind power is weather-dependent and intermittent, procurement decisions must rely on the latest available wind forecasts at the exact moment trading decisions are finalized.

Evaluating forecasts using the most recent data published *after* trade submission introduces severe **look-ahead bias** (data leakage) and distorts historical risk models. This document formalizes the exact mathematical and operational definition of the **historical decision-time replay**.

---

## 2. Decision Time & Cutoff Definition

### 2.1 GB Day-Ahead Market Timelines
GB power exchanges operate primary Day-Ahead auctions on day $D-1$:
- **EPEX SPOT GB Day-Ahead Auction (Hourly contracts)**: Order book closes at **09:20 UK time** on $D-1$.
- **Nord Pool N2EX Day-Ahead Auction**: Order book closes at **09:50 UK time** on $D-1$.
- **EPEX SPOT GB Half-Hour Auction**: Gate closure at **15:30 UK time** on $D-1$.

### 2.2 Operational Cutoff
Before auction gate closure, trading desks require a 20-to-30-minute operational execution window to:
1. Ingest the latest meteorological and generation data.
2. Run net-demand portfolio balancing and optimization models.
3. Determine thermal volume bids, price spreads, and risk tolerances.
4. Format and submit order curves to exchange trading systems.

**Default Cutoff Rule**:
$$\text{Cutoff}(D) = (D - 1\text{ day}) \text{ at } \mathbf{09:00:00\text{ UTC}}$$

- **Configurability**: The cutoff time $T_{\text{cutoff}}$ is parameterized as `(cutoff_hour, cutoff_minute)` (default: `09:00`), allowing users to simulate other market milestones (e.g., `09:30` for N2EX, `12:00` for pan-European comparisons, or `15:00` for the half-hourly auction).

---

## 3. Forecast Selection Rule

Let:
- $D$ be the delivery calendar date (in UTC).
- $\mathcal{T}_D = \{t_1, t_2, \dots, t_N\}$ be the set of target delivery intervals belonging to day $D$, where each interval is identified by its start timestamp $t = \text{startTime}$.
- $\mathcal{F}$ be the universe of published forecasts from Elexon BMRS `WINDFOR`, where each record $f \in \mathcal{F}$ is defined by:
  - $f.\text{startTime}$: target period start time.
  - $f.\text{publishTime}$: time at which the forecast was generated and published by the system operator.
  - $f.\text{generation}$: forecasted national wind generation in Megawatts (MW).

### 3.1 Eligibility Filter
For a given delivery day $D$ and target time $t \in \mathcal{T}_D$, the set of eligible forecasts $\mathcal{F}_{\text{eligible}}(t, D)$ is:
$$\mathcal{F}_{\text{eligible}}(t, D) = \{ f \in \mathcal{F} \mid f.\text{startTime} = t \;\land\; f.\text{publishTime} \le \text{Cutoff}(D) \}$$

### 3.2 Selection Function (Decision-Time Forecast)
The selected forecast $f^*(t)$ for target interval $t$ is the forecast with the **latest publish time** strictly on or prior to the cutoff:
$$f^*(t) = \operatorname*{arg\,max}_{f \in \mathcal{F}_{\text{eligible}}(t, D)} (f.\text{publishTime})$$

- If multiple records exist with the identical latest `publishTime` and `startTime` (an anomaly/tie), the record with the latest ingestion/creation index or highest revision is retained (empirically confirmed 0 duplicates exist in January 2026 data).
- Post-cutoff forecasts ($f.\text{publishTime} > \text{Cutoff}(D)$) are strictly ignored for Day-Ahead evaluation.

### 3.3 Handling Missing Forecasts
If $\mathcal{F}_{\text{eligible}}(t, D) = \emptyset$ (no forecast published before the cutoff for interval $t$):
1. **Explicit Surfacing**: The system marks interval $t$ with `status: "MISSING_FORECAST"`.
2. **No Silent Zeroes**: Missing forecasts are **never** imputed as 0 MW, as 0 MW would erroneously imply a forecast of complete wind stillness and produce catastrophic false error metrics.
3. In downstream metric calculations (MAE, RMSE, Bias), missing intervals are excluded from the denominator and reported in an explicit `dataQuality.missingForecastCount` audit field.
*(Note: In the full January 2026 dataset, 100% of target hours have eligible forecasts available; missing count = 0).*

---

## 4. Actuals Joining & Resolution Harmonization

### 4.1 Resolution Discovery
Empirical inspection of Elexon BMRS streams revealed a resolution mismatch:
- **`FUELHH` (Actuals)**: Published at **30-minute** settlement period resolution (`00` and `30` minutes past the hour). 48 settlement periods per day ($1,488$ periods in January 2026).
- **`WINDFOR` (Forecasts)**: Published at **60-minute (hourly)** resolution (`00` minutes past the hour). 24 hourly periods per day ($744$ hours in January 2026).

### 4.2 Harmonization Strategy
To evaluate forecast accuracy rigorously, we provide two mathematically consistent join modes:

#### Mode A: Hourly Block Aggregation (Primary Standard)
The wholesale Day-Ahead auction primarily clears hourly products. For target hour $H = [t_{:00}, t_{:00} + 1\text{h})$:
- Forecast: $F_H = f^*(t_{:00}).\text{generation}$ (MW).
- Actual: $A_H = \frac{1}{2} \left( \text{actual}(t_{:00}) + \text{actual}(t_{:30}) \right)$ (average MW across both 30-min settlement periods).
- Energy volume: $E_{\text{actual}} = A_H \times 1\text{h}$ (MWh), $E_{\text{forecast}} = F_H \times 1\text{h}$ (MWh).

#### Mode B: Half-Hourly Step-Wise Allocation
For settlement reconciliation and intraday traders:
- Forecast: Step-function applied across the hour:
  $$F(t_{:00}) = f^*(t_{:00}).\text{generation}, \quad F(t_{:30}) = f^*(t_{:00}).\text{generation}$$
- Actual: Respective 30-minute outturn $A(t_{:00})$ and $A(t_{:30})$.
- Mathematical Identity: The average bias across $t_{:00}$ and $t_{:30}$ is identical to the hourly bias in Mode A.

---

## 5. Timezone, Calendar, and DST Rules

1. **Internal Representation**:
   - All timestamps in the backend, storage, API requests, and responses are formatted as **ISO-8601 UTC** strings with explicit timezone offsets (e.g., `2026-01-01T00:00:00Z`).
2. **Local UK Time / DST**:
   - In January, Great Britain operates on Greenwich Mean Time (GMT, UTC+0). Thus, $\text{UTC} = \text{UK Civil Time}$ throughout January 2026.
   - For summer months (BST, UTC+1), conversions to local time occur strictly at the presentation/edge layer.
3. **Settlement Date vs Delivery Date**:
   - Elexon `settlementDate` aligns with the local calendar date. In January 2026, Settlement Date matches the UTC date.

---

## 6. Error & Performance Metrics

For each interval $i$:
- $F_i$: Decision-time forecast generation in MW.
- $A_i$: Actual outturn generation in MW.

### 6.1 Forecast Error
$$\text{Error}_i = F_i - A_i$$
- **Positive Error ($\text{Error}_i > 0$)**: **Overforecast** (Wind delivered less power than anticipated $\implies$ utility faces a generation deficit and must procure costly balancing energy or run thermal peaking units).
- **Negative Error ($\text{Error}_i < 0$)**: **Underforecast** (Wind delivered more power than anticipated $\implies$ excess generation sold at spill/imbalance prices).

### 6.2 Absolute Error & Percentage Error
$$\text{AbsError}_i = |F_i - A_i|$$
$$\text{PercentageError}_i = \frac{F_i - A_i}{A_i} \times 100\% \quad (A_i > 0)$$

### 6.3 Aggregated Metrics (over $N$ valid intervals)
1. **Mean Bias Error (MBE)**:
   $$\text{MBE} = \frac{1}{N} \sum_{i=1}^N (F_i - A_i)$$
   *(Indicates systematic over- or under-forecasting bias)*.

2. **Mean Absolute Error (MAE)**:
   $$\text{MAE} = \frac{1}{N} \sum_{i=1}^N |F_i - A_i|$$

3. **Root Mean Square Error (RMSE)**:
   $$\text{RMSE} = \sqrt{\frac{1}{N} \sum_{i=1}^N (F_i - A_i)^2}$$
   *(Penalizes large outlier forecast misses, crucial for reserve sizing)*.

4. **Capacity-Normalized MAE (nMAE)**:
   $$\text{nMAE} = \frac{\text{MAE}}{\text{Capacity}_{\text{installed}}} \times 100\% \quad \text{or} \quad \frac{\text{MAE}}{\bar{A}} \times 100\%$$
   *(Measures error relative to fleet scale)*.

5. **Energy Imbalance Volume (MWh)**:
   $$\Delta E_{\text{total}} = \sum_{i=1}^N (F_i - A_i) \times \Delta t_i \quad (\text{where } \Delta t_i = 1.0\text{h or } 0.5\text{h})$$
