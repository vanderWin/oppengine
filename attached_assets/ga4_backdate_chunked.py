# ga4_backdate_chunked.py
import os
import pandas as pd
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.cloud import bigquery
from google.oauth2 import service_account

# ===== CONFIG =====
SCOPES = ['https://www.googleapis.com/auth/analytics.readonly']
INPUT_CSV = "refined_properties.csv"  # cols: property_id,property_name,account_id,account_name,user,token_file
PROJECT_ID = "organic-data-361613"
SA_KEY_PATH = r"organic-data-361613-c0202d1cabeb.json"
DATASET = "argus"
STAGE_TABLE = f"{DATASET}.ga4_sessions_stage"
TARGET_TABLE = f"{DATASET}.ga4_sessions_by_channel"

# Properties known to exceed RPC limits
HEAVY_IDS = {"410236109"}  # ids of sites to backdate

# ===== DATES: last 50 months from yesterday (inclusive) =====
end_date = datetime.today().date() - timedelta(days=1)
start_date = (end_date - relativedelta(months=50)) + timedelta(days=1)
start_str = start_date.strftime("%Y-%m-%d")
end_str = end_date.strftime("%Y-%m-%d")

# ===== HELPERS =====
def iter_chunks(start_d, end_d, span_days):
    cur = start_d
    step = timedelta(days=span_days - 1)  # inclusive span
    while cur <= end_d:
        chunk_end = min(end_d, cur + step)
        yield cur, chunk_end
        cur = chunk_end + timedelta(days=1)

def fetch_chunked(analytics_data, property_id, start_d, end_d, base_span=210):
    span = base_span  # start ~7 months
    while True:
        try:
            for s, e in iter_chunks(start_d, end_d, span):
                body = {
                    "dateRanges": [{"startDate": s.strftime("%Y-%m-%d"),
                                    "endDate":   e.strftime("%Y-%m-%d")}],
                    "dimensions": [
                        {"name": "date"},
                        {"name": "sessionDefaultChannelGroup"}
                    ],
                    "metrics": [{"name": "sessions"}],
                    "keepEmptyRows": False
                }
                resp = analytics_data.properties().runReport(
                    property=f"properties/{property_id}",
                    body=body
                ).execute()
                yield resp
            break
        except HttpError as ex:
            msg = str(ex)
            if "exceeds limit" in msg or "too_large" in msg:
                if span <= 31:
                    raise
                span = max(31, span // 2)
                print(f"Property {property_id}: response too large, retry with {span}-day chunks")
            else:
                raise

# ===== LOAD PROPERTIES =====
refined = pd.read_csv(INPUT_CSV, dtype={"property_id": str, "account_id": str})
refined = refined[refined["property_id"].astype(str).isin(HEAVY_IDS)]
if refined.empty:
    raise SystemExit("No heavy profiles found in refined_properties.csv")

# ===== FETCH =====
rows = []
for _, r in refined.iterrows():
    property_id = str(r["property_id"])
    token_file = r["token_file"]

    if not token_file or not os.path.exists(token_file):
        print(f"Token missing for {r.get('user','?')} -> {token_file}. Skip {property_id}")
        continue

    print(f"Fetching (chunked): {r['property_name']} ({property_id}) [{start_str}..{end_str}]")
    try:
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)
        analytics_data = build('analyticsdata', 'v1beta', credentials=creds, cache_discovery=False)

        for resp in fetch_chunked(analytics_data, property_id, start_date, end_date, base_span=210):
            for rr in resp.get("rows", []):
                raw_date = rr["dimensionValues"][0]["value"]  # YYYYMMDD
                ch = rr["dimensionValues"][1]["value"] or "(unassigned)"
                date_dt = datetime.strptime(raw_date, "%Y%m%d").date()
                sessions_val = int(rr["metricValues"][0]["value"])

                rows.append({
                    "property_id": property_id,
                    "property_name": r["property_name"],
                    "account_id": r["account_id"],
                    "account_name": r["account_name"],
                    "user": r["user"],
                    "token_file": token_file,
                    "date": date_dt,
                    "sessionDefaultChannelGroup": ch,
                    "sessions": sessions_val
                })

    except Exception as e:
        print(f"Error {property_id}: {e}")

# ===== DATAFRAME =====
df = pd.DataFrame(rows)
if df.empty:
    print("No data fetched. Exit.")
    raise SystemExit(0)

df.sort_values(["property_id", "date", "sessionDefaultChannelGroup"], inplace=True)

# ===== UPLOAD TO BIGQUERY: stage then MERGE =====
bq_creds = service_account.Credentials.from_service_account_file(
    SA_KEY_PATH,
    scopes=["https://www.googleapis.com/auth/bigquery"]
)
bq = bigquery.Client(project=PROJECT_ID, credentials=bq_creds)

job_cfg = bigquery.LoadJobConfig(write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE)
load_job = bq.load_table_from_dataframe(df, f"{PROJECT_ID}.{STAGE_TABLE}", job_config=job_cfg)
load_job.result()

merge_sql = f"""
MERGE `{PROJECT_ID}.{TARGET_TABLE}` T
USING `{PROJECT_ID}.{STAGE_TABLE}` S
ON  T.property_id = S.property_id
AND T.date = S.date
AND T.sessionDefaultChannelGroup = S.sessionDefaultChannelGroup
WHEN MATCHED THEN UPDATE SET
  sessions = S.sessions,
  property_name = S.property_name,
  account_id = S.account_id,
  account_name = S.account_name,
  user = S.user,
  token_file = S.token_file,
  _ingested_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT
  (property_id, property_name, account_id, account_name, user, token_file,
   date, sessionDefaultChannelGroup, sessions, _ingested_at)
VALUES
  (S.property_id, S.property_name, S.account_id, S.account_name, S.user, S.token_file,
   S.date, S.sessionDefaultChannelGroup, S.sessions, CURRENT_TIMESTAMP());
"""
bq.query(merge_sql).result()

print(f"Backfill window: {start_str} .. {end_str}")
print(f"Stage rows: {len(df)} merged into {TARGET_TABLE}")
