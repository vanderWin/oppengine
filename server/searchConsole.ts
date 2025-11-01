import { google } from "googleapis";

interface DailyClickMap {
  [date: string]: number;
}

interface GSCReportRow {
  date: string;
  totalClicks: number;
  brandClicks: number;
  nonBrandClicks: number;
  anonymousClicks: number;
}

interface GSCHeadlineMetrics {
  startDate: string;
  endDate: string;
  totalClicks: number;
  totalBrandClicks: number;
  totalNonBrandClicks: number;
  ninetyDayBrandShare: number;
}

interface GSCQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GSCPositionCtrRow {
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface GSCReportData {
  siteUrl: string;
  brandTerms: string[];
  startDate: string;
  endDate: string;
  rows: GSCReportRow[];
  headline: GSCHeadlineMetrics;
  generatedAt: string;
  fromCache: boolean;
  nonBrandQueries: GSCQueryRow[];
  nonBrandCtrByPosition: GSCPositionCtrRow[];
}

interface CacheEntry {
  data: GSCReportData;
  timestamp: number;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
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

function normalizeBrandTerms(rawTerms: string[] | undefined | null): string[] {
  if (!rawTerms) {
    return [];
  }
  const normalized = rawTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return Array.from(new Set(normalized));
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBrandRegex(terms: string[]): string {
  const escaped = terms
    .map((term) => escapeRegex(term))
    .filter((term) => term.length > 0);
  if (!escaped.length) {
    return "";
  }
  return `(?i)(${escaped.join("|")})`;
}

function cacheKeyFor(siteUrl: string, brandTerms: string[]): string {
  const normalizedTerms = [...brandTerms].sort().join("|");
  return `${siteUrl}__${normalizedTerms}`;
}

function getCachedReport(siteUrl: string, brandTerms: string[]): GSCReportData | null {
  const key = cacheKeyFor(siteUrl, brandTerms);
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedReport(siteUrl: string, brandTerms: string[], data: GSCReportData): void {
  const key = cacheKeyFor(siteUrl, brandTerms);
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

function buildSearchConsoleClient(oauth2Client: any) {
  return google.searchconsole({
    version: "v1",
    auth: oauth2Client,
  });
}

async function fetchDailyClicks(options: {
  client: ReturnType<typeof buildSearchConsoleClient>;
  siteUrl: string;
  startDate: string;
  endDate: string;
  brandTerms: string[];
  mode: "total" | "brand" | "nonBrand";
}): Promise<DailyClickMap> {
  const { client, siteUrl, startDate, endDate, brandTerms, mode } = options;

  if (mode !== "total" && brandTerms.length === 0) {
    return {};
  }

  const expression =
    brandTerms.length > 0
      ? buildBrandRegex(brandTerms)
      : "";

  const request: any = {
    startDate,
    endDate,
    dimensions: ["date"],
    rowLimit: 5000,
    dataState: "all",
  };

  if (mode === "brand" && expression) {
    request.dimensionFilterGroups = [
      {
        filters: [
          {
            dimension: "query",
            operator: "includingRegex",
            expression,
          },
        ],
      },
    ];
  } else if (mode === "nonBrand" && expression) {
    request.dimensionFilterGroups = [
      {
        filters: [
          {
            dimension: "query",
            operator: "excludingRegex",
            expression,
          },
        ],
      },
    ];
  }

  const response = await client.searchanalytics.query({
    siteUrl,
    requestBody: request,
  });

  const map: DailyClickMap = {};
  for (const row of response.data.rows ?? []) {
    const dateKey = row.keys?.[0];
    if (!dateKey) {
      continue;
    }
    const clicks = Number(row.clicks ?? 0);
    map[dateKey] = Number.isFinite(clicks) ? clicks : 0;
  }
  return map;
}

async function fetchNonBrandQueries(options: {
  client: ReturnType<typeof buildSearchConsoleClient>;
  siteUrl: string;
  startDate: string;
  endDate: string;
  brandTerms: string[];
}): Promise<GSCQueryRow[]> {
  const { client, siteUrl, startDate, endDate, brandTerms } = options;
  const expression = buildBrandRegex(brandTerms);

  const request: any = {
    startDate,
    endDate,
    dimensions: ["query"],
    rowLimit: 25000,
    dataState: "all",
  };

  if (expression) {
    request.dimensionFilterGroups = [
      {
        filters: [
          {
            dimension: "query",
            operator: "excludingRegex",
            expression,
          },
        ],
      },
    ];
  }

  const response = await client.searchanalytics.query({
    siteUrl,
    requestBody: request,
  });

  const rows: GSCQueryRow[] = [];
  for (const row of response.data.rows ?? []) {
    const query = row.keys?.[0] ?? "";
    if (!query) {
      continue;
    }
    const clicksRaw = Number(row.clicks ?? 0);
    const impressionsRaw = Number(row.impressions ?? 0);
    const positionRaw = Number(row.position ?? 0);
    const clicks = Number.isFinite(clicksRaw) ? clicksRaw : 0;
    const impressions = Number.isFinite(impressionsRaw) ? impressionsRaw : 0;
    const position = Number.isFinite(positionRaw) ? positionRaw : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    rows.push({
      query,
      clicks,
      impressions,
      ctr,
      position,
    });
  }

  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

function buildCtrByPosition(rows: GSCQueryRow[]): GSCPositionCtrRow[] {
  const aggregates = new Map<number, { clicks: number; impressions: number }>();

  for (const row of rows) {
    const rounded = Math.round(row.position);
    if (!Number.isFinite(rounded) || rounded < 1 || rounded > 20) {
      continue;
    }
    const stats = aggregates.get(rounded) ?? { clicks: 0, impressions: 0 };
    stats.clicks += row.clicks;
    stats.impressions += row.impressions;
    aggregates.set(rounded, stats);
  }

  return Array.from(aggregates.entries())
    .map(([position, stats]) => ({
      position,
      clicks: stats.clicks,
      impressions: stats.impressions,
      ctr: stats.impressions > 0 ? stats.clicks / stats.impressions : 0,
    }))
    .sort((a, b) => a.position - b.position);
}

function buildUnifiedRows(options: {
  startDate: Date;
  endDate: Date;
  totalClicks: DailyClickMap;
  brandClicks: DailyClickMap;
  nonBrandClicks: DailyClickMap;
}): GSCReportRow[] {
  const { startDate, endDate, totalClicks, brandClicks, nonBrandClicks } = options;
  const rows: GSCReportRow[] = [];

  for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
    const dateKey = normalizeDate(cursor);
    const total = totalClicks[dateKey] ?? 0;
    const brand = brandClicks[dateKey] ?? 0;
    const nonBrand = nonBrandClicks[dateKey] ?? 0;
    const anonymous = Math.max(0, total - brand - nonBrand);
    rows.push({
      date: dateKey,
      totalClicks: total,
      brandClicks: brand,
      nonBrandClicks: nonBrand,
      anonymousClicks: anonymous,
    });
  }

  return rows;
}

function calculateHeadlineMetrics(rows: GSCReportRow[], endDate: Date): GSCHeadlineMetrics {
  const ninetyDayEnd = new Date(endDate);
  const ninetyDayStart = addDays(new Date(endDate), -89);

  let totalClicks = 0;
  let totalBrandClicks = 0;
  let totalNonBrandClicks = 0;

  let ninetyBrand = 0;
  let ninetyNonBrand = 0;

  for (const row of rows) {
    totalClicks += row.totalClicks;
    totalBrandClicks += row.brandClicks;
    totalNonBrandClicks += row.nonBrandClicks;

    const date = new Date(row.date + "T00:00:00");
    if (date >= ninetyDayStart && date <= ninetyDayEnd) {
      ninetyBrand += row.brandClicks;
      ninetyNonBrand += row.nonBrandClicks;
    }
  }

  const denominator = ninetyBrand + ninetyNonBrand;
  const ninetyDayBrandShare = denominator > 0 ? (ninetyBrand / denominator) * 100 : 0;

  return {
    startDate: normalizeDate(ninetyDayStart),
    endDate: normalizeDate(ninetyDayEnd),
    totalClicks,
    totalBrandClicks,
    totalNonBrandClicks,
    ninetyDayBrandShare: Math.round(ninetyDayBrandShare * 100) / 100,
  };
}

export async function getSearchConsoleReport(options: {
  oauth2Client: any;
  siteUrl: string;
  brandTerms: string[];
  forceRefresh?: boolean;
}): Promise<GSCReportData> {
  const { oauth2Client, siteUrl, brandTerms: rawTerms, forceRefresh } = options;
  const brandTerms = normalizeBrandTerms(rawTerms);

  if (!forceRefresh) {
    const cached = getCachedReport(siteUrl, brandTerms);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const client = buildSearchConsoleClient(oauth2Client);

  const endDateObj = addDays(new Date(), -1);
  const startDateObj = addDays(subtractMonths(endDateObj, 16), 1);
  const startDate = normalizeDate(startDateObj);
  const endDate = normalizeDate(endDateObj);

  const totalMap = await fetchDailyClicks({
    client,
    siteUrl,
    startDate,
    endDate,
    brandTerms,
    mode: "total",
  });

  let brandMap: DailyClickMap = {};
  let nonBrandMap: DailyClickMap = totalMap;

  if (brandTerms.length > 0) {
    [brandMap, nonBrandMap] = await Promise.all([
      fetchDailyClicks({ client, siteUrl, startDate, endDate, brandTerms, mode: "brand" }),
      fetchDailyClicks({ client, siteUrl, startDate, endDate, brandTerms, mode: "nonBrand" }),
    ]);
  }

  const rows = buildUnifiedRows({
    startDate: startDateObj,
    endDate: endDateObj,
    totalClicks: totalMap,
    brandClicks: brandMap,
    nonBrandClicks: nonBrandMap,
  });

  const ninetyDayStartObj = addDays(new Date(endDateObj), -89);
  const ninetyDayStart = normalizeDate(ninetyDayStartObj);

  const nonBrandQueries = await fetchNonBrandQueries({
    client,
    siteUrl,
    startDate: ninetyDayStart,
    endDate,
    brandTerms,
  });

  const nonBrandCtrByPosition = buildCtrByPosition(nonBrandQueries);

  const headline = calculateHeadlineMetrics(rows, endDateObj);

  const report: GSCReportData = {
    siteUrl,
    brandTerms,
    startDate,
    endDate,
    rows,
    headline,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    nonBrandQueries,
    nonBrandCtrByPosition,
  };

  setCachedReport(siteUrl, brandTerms, report);
  return report;
}

export function clearSearchConsoleCache() {
  cache.clear();
}
