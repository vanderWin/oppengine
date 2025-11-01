import { google } from "googleapis";

interface GAReportRow {
  date: string; // YYYY-MM-DD
  sessions: number;
  transactions: number;
  revenue: number;
}

interface GAHeadlineMetrics {
  startDate: string;
  endDate: string;
  totalSessions: number;
  totalTransactions: number;
  totalRevenue: number;
  averageOrderValue: number;
  conversionRate: number;
}

export interface GAReportData {
  propertyId: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  rows: GAReportRow[];
  headline90Day: GAHeadlineMetrics;
  generatedAt: string;
  fromCache: boolean;
}

interface CacheEntry {
  data: GAReportData;
  timestamp: number;
}

const GA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function normalizeDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

function getCacheKey(propertyId: string): string {
  return propertyId;
}

function getCachedReport(propertyId: string): GAReportData | null {
  const key = getCacheKey(propertyId);
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > GA_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedReport(propertyId: string, data: GAReportData): void {
  const key = getCacheKey(propertyId);
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

function buildAnalyticsDataClient(oauth2Client: any) {
  return google.analyticsdata({
    version: "v1beta",
    auth: oauth2Client,
  });
}

async function runChunkedReport(
  analyticsData: ReturnType<typeof buildAnalyticsDataClient>,
  propertyId: string,
  startDate: Date,
  endDate: Date
): Promise<GAReportRow[]> {
  let chunkSpan = 210; // roughly 7 months

  const startStr = normalizeDate(startDate);
  const endStr = normalizeDate(endDate);
  console.log(
    `[GA] Fetching organic data for ${propertyId} from ${startStr} to ${endStr}`
  );

  while (chunkSpan >= 31) {
    try {
      const rows: GAReportRow[] = [];
      for (
        let cur = new Date(startDate);
        cur <= endDate;
        cur = addDays(cur, chunkSpan)
      ) {
        const chunkStart = new Date(cur);
        const chunkEnd = addDays(cur, chunkSpan - 1);
        if (chunkEnd > endDate) {
          chunkEnd.setTime(endDate.getTime());
        }

        const response = await analyticsData.properties.runReport({
          property: `properties/${propertyId}`,
          requestBody: {
            dateRanges: [
              {
                startDate: normalizeDate(chunkStart),
                endDate: normalizeDate(chunkEnd),
              },
            ],
            dimensions: [{ name: "date" }],
            metrics: [
              { name: "sessions" },
              { name: "transactions" },
              { name: "purchaseRevenue" },
            ],
            dimensionFilter: {
              filter: {
                fieldName: "sessionDefaultChannelGroup",
                stringFilter: {
                  matchType: "EXACT",
                  value: "Organic Search",
                },
              },
            },
            keepEmptyRows: false,
          },
        });

        for (const row of response.data.rows ?? []) {
          const [dateDim] = row.dimensionValues ?? [];
          const metrics = row.metricValues ?? [];
          const dateRaw = dateDim?.value ?? "";
          if (!dateRaw) {
            continue;
          }

          const dateFormatted = `${dateRaw.slice(0, 4)}-${dateRaw.slice(
            4,
            6
          )}-${dateRaw.slice(6, 8)}`;

          const sessions = Number(metrics[0]?.value ?? 0);
          const transactions = Number(metrics[1]?.value ?? 0);
          const revenue = Number(metrics[2]?.value ?? 0);

          rows.push({
            date: dateFormatted,
            sessions: Number.isFinite(sessions) ? sessions : 0,
            transactions: Number.isFinite(transactions) ? transactions : 0,
            revenue: Number.isFinite(revenue) ? revenue : 0,
          });
        }
      }

      return rows;
    } catch (error: any) {
      const message = String(error?.message || "");
      if (
        message.includes("exceeds") ||
        message.includes("too_large") ||
        message.includes("quotaExceeded") ||
        message.includes("RESOURCE_EXHAUSTED")
      ) {
        chunkSpan = Math.max(31, Math.floor(chunkSpan / 2));
        console.warn(
          `[GA] Chunk too large for ${propertyId}, retrying with ${chunkSpan} day spans`
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Unable to fetch GA data for ${propertyId}: minimum chunk size still failing`
  );
}

function calculateHeadlineMetrics(
  rows: GAReportRow[],
  endDate: Date
): GAHeadlineMetrics {
  const ninetyDayEnd = new Date(endDate);
  const ninetyDayStart = addDays(new Date(endDate), -89);

  let totalSessions = 0;
  let totalTransactions = 0;
  let totalRevenue = 0;

  for (const row of rows) {
    const rowDate = new Date(row.date + "T00:00:00");
    if (rowDate >= ninetyDayStart && rowDate <= ninetyDayEnd) {
      totalSessions += row.sessions;
      totalTransactions += row.transactions;
      totalRevenue += row.revenue;
    }
  }

  const averageOrderValue =
    totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const conversionRate =
    totalSessions > 0 ? (totalTransactions / totalSessions) * 100 : 0;

  return {
    startDate: normalizeDate(ninetyDayStart),
    endDate: normalizeDate(ninetyDayEnd),
    totalSessions: Math.round(totalSessions),
    totalTransactions: Math.round(totalTransactions),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    conversionRate: Math.round(conversionRate * 100) / 100,
  };
}

export async function getOrganicReportForProperty(options: {
  oauth2Client: any;
  propertyId: string;
  propertyName: string;
  forceRefresh?: boolean;
}): Promise<GAReportData> {
  const { oauth2Client, propertyId, propertyName, forceRefresh } = options;

  if (!forceRefresh) {
    const cached = getCachedReport(propertyId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const analyticsData = buildAnalyticsDataClient(oauth2Client);

  const endDate = addDays(new Date(), -1);
  const startDate = addDays(subtractMonths(endDate, 50), 1);

  const rows = await runChunkedReport(analyticsData, propertyId, startDate, endDate);
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const headline90Day = calculateHeadlineMetrics(rows, endDate);

  const report: GAReportData = {
    propertyId,
    propertyName,
    startDate: normalizeDate(startDate),
    endDate: normalizeDate(endDate),
    rows,
    headline90Day,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };

  setCachedReport(propertyId, report);
  return report;
}

export function clearGAReportCache() {
  cache.clear();
}
