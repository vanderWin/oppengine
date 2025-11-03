import json
import sys
import io
import logging
import contextlib
from dataclasses import dataclass
from typing import Any, Dict, List

import pandas as pd
from dateutil.relativedelta import relativedelta
from pandas.tseries.offsets import MonthEnd

with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    from prophet import Prophet


logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)


@dataclass
class SeriesConfig:
    data: List[Dict[str, Any]]
    trend: str
    multiplier: float


def parse_input(raw: str) -> Dict[str, Any]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON payload: {exc}") from exc
    return payload


def to_dataframe(series: List[Dict[str, Any]]) -> pd.DataFrame:
    df = pd.DataFrame(series)
    if df.empty:
        raise ValueError("Time series is empty")
    if "date" not in df or "value" not in df:
        raise ValueError("Each point must include 'date' and 'value'")

    df = df.copy()
    df["ds"] = pd.to_datetime(df["date"])
    df["y"] = df["value"].astype(float)
    df = df[["ds", "y"]].sort_values("ds").reset_index(drop=True)
    return df


def determine_periods(last_date: pd.Timestamp, months_ahead: int) -> Dict[str, Any]:
    target = last_date + relativedelta(months=months_ahead)
    end_date = (pd.Timestamp(target) + MonthEnd(0)).normalize()
    periods = int((end_date - last_date).days)
    if periods < 1:
        periods = 1
    return {
        "periods": periods,
        "end_date": end_date,
    }


def run_forecast(series_config: SeriesConfig, months_ahead: int) -> Dict[str, Any]:
    df = to_dataframe(series_config.data)

    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()
    original_stdout = sys.stdout
    original_stderr = sys.stderr

    try:
        sys.stdout = captured_stdout
        sys.stderr = captured_stderr
        model = Prophet(
            growth=series_config.trend,
            weekly_seasonality=True,
            yearly_seasonality=True,
            daily_seasonality=False,
        )
        model.fit(df)
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr

    extra_output = captured_stdout.getvalue().strip()
    if extra_output:
        logging.getLogger(__name__).debug(extra_output)
    extra_error = captured_stderr.getvalue().strip()
    if extra_error:
        logging.getLogger(__name__).debug(extra_error)

    last_date = df["ds"].max()
    horizon = determine_periods(last_date, months_ahead)

    future = model.make_future_dataframe(
        periods=horizon["periods"],
        freq="D",
        include_history=False,
    )
    forecast = model.predict(future)[["ds", "yhat", "yhat_lower", "yhat_upper"]]

    factor = 1.0 + max(0.0, float(series_config.multiplier))
    forecast["yhat"] = forecast["yhat"] * factor
    forecast["yhat_lower"] = forecast["yhat_lower"] * factor
    forecast["yhat_upper"] = forecast["yhat_upper"] * factor

    records = []
    for _, row in forecast.iterrows():
        records.append(
            {
                "date": row["ds"].strftime("%Y-%m-%d"),
                "yhat": float(row["yhat"]),
                "yhat_lower": float(row["yhat_lower"]),
                "yhat_upper": float(row["yhat_upper"]),
            }
        )

    return {
        "forecast": records,
        "last_observed": last_date.strftime("%Y-%m-%d"),
        "forecast_end": horizon["end_date"].strftime("%Y-%m-%d"),
    }


def main() -> None:
    raw_input = sys.stdin.read()
    payload = parse_input(raw_input)

    months_ahead = int(payload.get("monthsAhead", 12))
    if months_ahead < 1 or months_ahead > 36:
        raise ValueError("monthsAhead must be between 1 and 36")

    brand_cfg = SeriesConfig(
        data=payload["brand"]["data"],
        trend=payload["brand"]["trend"],
        multiplier=float(payload["brand"].get("multiplier", 0.0)),
    )
    non_brand_cfg = SeriesConfig(
        data=payload["nonBrand"]["data"],
        trend=payload["nonBrand"]["trend"],
        multiplier=float(payload["nonBrand"].get("multiplier", 0.0)),
    )

    result = {
        "brand": run_forecast(brand_cfg, months_ahead),
        "nonBrand": run_forecast(non_brand_cfg, months_ahead),
    }

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - surface errors to Node
        sys.stderr.write(json.dumps({"error": str(exc)}))
        sys.exit(1)
