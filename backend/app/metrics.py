"""
backend/app/metrics.py
Pure, mathematical functions for evaluating renewable energy forecast performance
and linking forecast errors directly to procurement and commercial buying decisions.

Includes:
- Bias / Mean Error (MW)
- Mean Absolute Error (MAE in MW)
- Root Mean Square Error (RMSE in MW)
- Normalized MAE (nMAE: MAE / mean actual generation)
- Overforecast Rate (share of intervals where forecast > actual)
- Data Coverage & Missing Intervals Audit
- Error Percentiles (P50, P90, P95 of absolute error in MW)
- Wind-Shortfall Energy (MWh): volume of expected wind that failed to materialize
- Wind-Surplus Energy (MWh): volume of unforecasted excess wind energy
- Historical P90 Shortfall Buffer (MW): empirical reserve sizing recommendation
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd


def _filter_valid_pairs(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Tuple[np.ndarray, np.ndarray]:
    """Extracts valid numeric pairs where neither forecast nor actual is NaN/None."""
    f = np.asarray(forecast, dtype=float)
    a = np.asarray(actual, dtype=float)

    mask = ~np.isnan(f) & ~np.isnan(a)
    return f[mask], a[mask]


def calculate_bias(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """
    Calculates Mean Bias Error: mean(Forecast - Actual) in MW.
    Positive value indicates systematic overforecasting (procurement deficit).
    Negative value indicates systematic underforecasting (spill / surplus).
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    return float(np.mean(f - a))


def calculate_mae(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """Calculates Mean Absolute Error in MW: mean(|Forecast - Actual|)."""
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    return float(np.mean(np.abs(f - a)))


def calculate_rmse(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """
    Calculates Root Mean Square Error in MW: sqrt(mean((Forecast - Actual)^2)).
    Penalizes large errors quadratically, critical for reserve sizing.
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    return float(np.sqrt(np.mean((f - a) ** 2)))


def calculate_nmae(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """
    Calculates Normalized MAE (nMAE): MAE / mean(Actual).
    Returned as a fraction between 0.0 and 1.0 (multiply by 100 for percentage).
    
    Why MAPE is avoided:
    In wind power, outturn frequently approaches zero during calm weather. Division by near-zero actuals
    causes MAPE to diverge asymptotically to huge numbers. Normalizing by the period-mean actual outturn
    avoids division-by-zero and gives a realistic assessment of error relative to average output.
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    mean_actual = np.mean(a)
    if mean_actual <= 0:
        return None
    mae = np.mean(np.abs(f - a))
    return float(mae / mean_actual)


def calculate_overforecast_rate(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """
    Calculates the share of intervals where Forecast > Actual (0.0 to 1.0).
    A well-calibrated forecast should approach 0.50 (50%).
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    return float(np.mean(f > a))


def calculate_underforecast_rate(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """
    Calculates the share of intervals where Forecast < Actual (0.0 to 1.0).
    Surplus / spill risk direction.
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    return float(np.mean(f < a))


def calculate_boxplot_statistics(
    errors: Union[pd.Series, np.ndarray, List[float]],
) -> Dict[str, Any]:
    """
    Calculates standard Tukey box-plot statistics for signed forecast error (Forecast - Actual) in MW:
    - min_mw: absolute minimum error
    - whisker_low_mw: smallest data point >= Q1 - 1.5 * IQR
    - q1_mw: 25th percentile
    - median_mw: 50th percentile
    - q3_mw: 75th percentile
    - whisker_high_mw: largest data point <= Q3 + 1.5 * IQR
    - max_mw: absolute maximum error
    - iqr_mw: interquartile range (Q3 - Q1)
    - outliers: list of data points outside whiskers
    """
    e = np.asarray(errors, dtype=float)
    valid_e = e[~np.isnan(e)]
    if len(valid_e) == 0:
        return {
            "min_mw": None,
            "whisker_low_mw": None,
            "q1_mw": None,
            "median_mw": None,
            "q3_mw": None,
            "whisker_high_mw": None,
            "max_mw": None,
            "iqr_mw": None,
            "outliers": [],
            "sample_count": 0,
        }

    q1 = float(np.percentile(valid_e, 25))
    med = float(np.percentile(valid_e, 50))
    q3 = float(np.percentile(valid_e, 75))
    iqr = q3 - q1

    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr

    # Tukey whiskers: smallest and largest points within fences
    inside_points = valid_e[(valid_e >= lower_fence) & (valid_e <= upper_fence)]
    whisker_low = float(np.min(inside_points)) if len(inside_points) > 0 else q1
    whisker_high = float(np.max(inside_points)) if len(inside_points) > 0 else q3

    outliers = [float(x) for x in valid_e[(valid_e < lower_fence) | (valid_e > upper_fence)]]
    outliers.sort()

    return {
        "min_mw": round(float(np.min(valid_e)), 2),
        "whisker_low_mw": round(whisker_low, 2),
        "q1_mw": round(q1, 2),
        "median_mw": round(med, 2),
        "q3_mw": round(q3, 2),
        "whisker_high_mw": round(whisker_high, 2),
        "max_mw": round(float(np.max(valid_e)), 2),
        "iqr_mw": round(iqr, 2),
        "outliers": [round(x, 2) for x in outliers],
        "sample_count": len(valid_e),
    }


def calculate_error_percentiles(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
    percentiles: Tuple[int, ...] = (50, 90, 95),
) -> Dict[str, Optional[float]]:
    """Calculates percentiles of absolute error |Forecast - Actual| in MW."""
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return {f"p{p}_mw": None for p in percentiles}
    
    abs_errors = np.abs(f - a)
    results: Dict[str, Optional[float]] = {}
    for p in percentiles:
        results[f"p{p}_mw"] = float(np.percentile(abs_errors, p))
    return results


def calculate_coverage(
    total_expected: int,
    valid_count: int,
) -> Dict[str, Any]:
    """
    Calculates data coverage ratio and explicit missing interval count.
    Never lets missing intervals silently become zero.
    """
    missing_count = max(0, total_expected - valid_count)
    rate = float(valid_count / total_expected) if total_expected > 0 else 0.0
    return {
        "total_expected_intervals": total_expected,
        "valid_intervals": valid_count,
        "missing_intervals": missing_count,
        "coverage_rate": round(rate, 4),
        "coverage_pct": round(rate * 100.0, 2),
    }


def calculate_shortfall_energy_mwh(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
    interval_hours: float = 1.0,
) -> Optional[float]:
    """
    Calculates total wind-shortfall energy in MWh:
    Sum over intervals of max(Forecast - Actual, 0) * interval_hours.
    Represents the energy deficit the utility had to cover by purchasing thermal or balancing power.
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    shortfalls = np.maximum(f - a, 0.0)
    return float(np.sum(shortfalls) * interval_hours)


def calculate_surplus_energy_mwh(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
    interval_hours: float = 1.0,
) -> Optional[float]:
    """
    Calculates total wind-surplus energy in MWh:
    Sum over intervals of max(Actual - Forecast, 0) * interval_hours.
    Represents unexpected excess wind energy delivered above forecast.
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    surpluses = np.maximum(a - f, 0.0)
    return float(np.sum(surpluses) * interval_hours)


def calculate_p90_shortfall_mw(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
) -> Optional[float]:
    """
    Calculates the 90th percentile of wind shortfalls (MW) when Forecast > Actual.
    Provides a historical buffer suggestion: sizing backup thermal capacity to this MW
    would have covered 90% of hourly wind deficits.
    (Clearly labelled as a historical empirical benchmark, not predictive machine learning).
    """
    f, a = _filter_valid_pairs(forecast, actual)
    if len(f) == 0:
        return None
    positive_shortfalls = (f - a)[(f - a) > 0]
    if len(positive_shortfalls) == 0:
        return 0.0
    return float(np.percentile(positive_shortfalls, 90))


def compute_kpi_summary(
    forecast: Union[pd.Series, np.ndarray, List[float]],
    actual: Union[pd.Series, np.ndarray, List[float]],
    total_expected_intervals: Optional[int] = None,
    interval_hours: float = 1.0,
) -> Dict[str, Any]:
    """
    Computes all standard accuracy metrics with explicit units and commercial buying metrics.
    """
    f, a = _filter_valid_pairs(forecast, actual)
    valid_n = len(f)
    expected_n = total_expected_intervals if total_expected_intervals is not None else valid_n

    coverage = calculate_coverage(expected_n, valid_n)
    percentiles = calculate_error_percentiles(f, a, percentiles=(50, 90, 95))

    bias = calculate_bias(f, a)
    mae = calculate_mae(f, a)
    rmse = calculate_rmse(f, a)
    nmae = calculate_nmae(f, a)
    overforecast_rate = calculate_overforecast_rate(f, a)
    underforecast_rate = calculate_underforecast_rate(f, a)

    shortfall_mwh = calculate_shortfall_energy_mwh(f, a, interval_hours=interval_hours)
    surplus_mwh = calculate_surplus_energy_mwh(f, a, interval_hours=interval_hours)
    p90_shortfall_mw = calculate_p90_shortfall_mw(f, a)
    net_imbalance_mwh = float(np.sum(f - a) * interval_hours) if valid_n > 0 else None

    mean_f = float(np.mean(f)) if valid_n > 0 else None
    mean_a = float(np.mean(a)) if valid_n > 0 else None
    max_overforecast = float(np.max(f - a)) if valid_n > 0 else None
    max_underforecast = float(np.min(f - a)) if valid_n > 0 else None

    return {
        "units": {
            "generation": "MW",
            "error": "MW",
            "rates": "fraction (0.0 to 1.0)",
            "energy": "MWh",
            "buffer": "MW"
        },
        "coverage": coverage,
        "mean_actual_mw": round(mean_a, 2) if mean_a is not None else None,
        "mean_forecast_mw": round(mean_f, 2) if mean_f is not None else None,
        "bias_mw": round(bias, 2) if bias is not None else None,
        "mae_mw": round(mae, 2) if mae is not None else None,
        "rmse_mw": round(rmse, 2) if rmse is not None else None,
        "normalised_mae": round(nmae, 4) if nmae is not None else None,
        "nmae_pct": round(nmae * 100.0, 2) if nmae is not None else None,
        "overforecast_rate": round(overforecast_rate, 4) if overforecast_rate is not None else None,
        "overforecast_rate_pct": round(overforecast_rate * 100.0, 2) if overforecast_rate is not None else None,
        "underforecast_rate": round(underforecast_rate, 4) if underforecast_rate is not None else None,
        "underforecast_rate_pct": round(underforecast_rate * 100.0, 2) if underforecast_rate is not None else None,
        "share_intervals_overforecast": round(overforecast_rate, 4) if overforecast_rate is not None else None,
        "share_intervals_underforecast": round(underforecast_rate, 4) if underforecast_rate is not None else None,
        "shortfall_energy_mwh": round(shortfall_mwh, 2) if shortfall_mwh is not None else None,
        "surplus_energy_mwh": round(surplus_mwh, 2) if surplus_mwh is not None else None,
        "net_imbalance_energy_mwh": round(net_imbalance_mwh, 2) if net_imbalance_mwh is not None else None,
        "p90_shortfall_buffer_mw": round(p90_shortfall_mw, 2) if p90_shortfall_mw is not None else None,
        "percentiles": {
            "p50_abs_error_mw": round(percentiles["p50_mw"], 2) if percentiles["p50_mw"] is not None else None,
            "p90_abs_error_mw": round(percentiles["p90_mw"], 2) if percentiles["p90_mw"] is not None else None,
            "p95_abs_error_mw": round(percentiles["p95_mw"], 2) if percentiles["p95_mw"] is not None else None,
        },
        "extremes": {
            "max_overforecast_mw": round(max_overforecast, 2) if max_overforecast is not None else None,
            "max_underforecast_mw": round(max_underforecast, 2) if max_underforecast is not None else None,
        }
    }


def calculate_buy_range_for_intervals(
    forecast_values: List[Optional[float]],
    demand_mw: Optional[float],
    p10_error: float,
    p50_error: float,
    p90_error: float,
    interval_hours: float = 0.5,
) -> Tuple[List[Dict[str, Optional[float]]], Optional[Dict[str, float]]]:
    """
    Computes buy range per interval and summary totals according to DECISIONS.md.
    Base need = demand - forecast wind
    Buy range per half-hour = base need + P10 error ... base need + P90 error,
    with central estimate at base need + P50 error, each clamped at 0 MW (cannot buy negative power).

    If demand_mw is None, need calculations are None (wind-only baseline).
    Missing forecasts (None) remain None across all derived need fields.
    """
    intervals_result: List[Dict[str, Optional[float]]] = []

    for f in forecast_values:
        if f is None or (isinstance(f, float) and np.isnan(f)):
            intervals_result.append({
                "forecast_mw": None,
                "base_need_mw": None,
                "low_need_mw": None,
                "central_need_mw": None,
                "high_need_mw": None,
            })
            continue

        f_val = float(f)
        if demand_mw is None:
            intervals_result.append({
                "forecast_mw": round(f_val, 2),
                "base_need_mw": None,
                "low_need_mw": None,
                "central_need_mw": None,
                "high_need_mw": None,
            })
        else:
            raw_base_need = demand_mw - f_val
            base_clamped = max(0.0, raw_base_need)
            low_clamped = max(0.0, raw_base_need + p10_error)
            central_clamped = max(0.0, raw_base_need + p50_error)
            high_clamped = max(0.0, raw_base_need + p90_error)

            intervals_result.append({
                "forecast_mw": round(f_val, 2),
                "base_need_mw": round(base_clamped, 2),
                "low_need_mw": round(low_clamped, 2),
                "central_need_mw": round(central_clamped, 2),
                "high_need_mw": round(high_clamped, 2),
            })

    if demand_mw is None:
        valid_f = [item["forecast_mw"] for item in intervals_result if item["forecast_mw"] is not None]
        totals = {
            "forecast_total_mwh": round(float(sum(valid_f) * interval_hours), 2) if valid_f else None,
            "demand_total_mwh": None,
            "base_need_total_mwh": None,
            "low_need_total_mwh": None,
            "central_need_total_mwh": None,
            "high_need_total_mwh": None,
            "peak_high_need_mw": None,
            "peak_low_need_mw": None,
            "peak_range_mw": None,
        }
        return intervals_result, totals

    valid_f = [item["forecast_mw"] for item in intervals_result if item["forecast_mw"] is not None]
    valid_base = [item["base_need_mw"] for item in intervals_result if item["base_need_mw"] is not None]
    valid_low = [item["low_need_mw"] for item in intervals_result if item["low_need_mw"] is not None]
    valid_central = [item["central_need_mw"] for item in intervals_result if item["central_need_mw"] is not None]
    valid_high = [item["high_need_mw"] for item in intervals_result if item["high_need_mw"] is not None]

    peak_range = 0.0
    for item in intervals_result:
        if item["high_need_mw"] is not None and item["low_need_mw"] is not None:
            r = item["high_need_mw"] - item["low_need_mw"]
            if r > peak_range:
                peak_range = r

    totals = {
        "forecast_total_mwh": round(float(sum(valid_f) * interval_hours), 2) if valid_f else 0.0,
        "demand_total_mwh": round(float(demand_mw * len(intervals_result) * interval_hours), 2),
        "base_need_total_mwh": round(float(sum(valid_base) * interval_hours), 2) if valid_base else 0.0,
        "low_need_total_mwh": round(float(sum(valid_low) * interval_hours), 2) if valid_low else 0.0,
        "central_need_total_mwh": round(float(sum(valid_central) * interval_hours), 2) if valid_central else 0.0,
        "high_need_total_mwh": round(float(sum(valid_high) * interval_hours), 2) if valid_high else 0.0,
        "peak_high_need_mw": round(float(max(valid_high)), 2) if valid_high else 0.0,
        "peak_low_need_mw": round(float(max(valid_low)), 2) if valid_low else 0.0,
        "peak_range_mw": round(float(peak_range), 2),
    }

    return intervals_result, totals

