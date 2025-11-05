import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { google } from "googleapis";
import { randomUUID, createHash } from "crypto";
import { runProphetForecast, type ProphetForecastResult } from "./prophet";
import ExcelJS from "exceljs";
import type { GAReportResponse, GSCReportResponse, ProjectionResults } from "@shared/schema";
import type {
  CombinedSessionsDatum,
  DashboardBootstrapPayload,
  ProphetForecastResponse,
  ProphetStoredResults,
  ScalingSummarySnapshot,
} from "@shared/prophetTypes";
import { loadSnapshot, saveSnapshot, getSnapshotInfo } from "./snapshotStore";
import { promises as fs } from "fs";
import path from "path";

declare module "express-session" {
  interface SessionData {
    gaTokens?: any;
    gscTokens?: any;
    gaConnected?: boolean;
    gscConnected?: boolean;
    oauthState?: string;
    oauthService?: "ga" | "gsc";
    selectedGAProperty?: {
      name: string;
      displayName: string;
    };
    selectedGSCSite?: {
      siteUrl: string;
    };
    gaReportSummary?: {
      propertyId: string;
      propertyName: string;
      fetchedAt: string;
      headline90Day: import("@shared/schema").GAHeadlineMetrics;
    };
    gscBrandTerms?: string[];
    gscReportSummary?: {
      siteUrl: string;
      brandTerms: string[];
      fetchedAt: string;
      headline: import("@shared/schema").GSCHeadlineMetrics;
    };
    prophetResults?: ProphetStoredResults | null;
    upliftResults?: ProjectionResults | null;
    gaReport?: GAReportResponse | null;
    gscReport?: GSCReportResponse | null;
    reportSessionStart?: string | null;
    lastUploadedCsvName?: string | null;
    upliftCtrValues?: number[] | null;
  }
}

const SCOPES = {
  ga: [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  gsc: [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
};

const GEO_TARGETS_BY_REGION: Record<"UK" | "US", string> = {
  UK: "geoTargetConstants/2826",
  US: "geoTargetConstants/2840",
};

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function resolveGeoTargets(regionInput: unknown): {
  region: "UK" | "US";
  geoTargetConstants: string[];
} {
  const normalized =
    typeof regionInput === "string"
      ? regionInput.trim().toUpperCase()
      : "";
  const region = normalized === "US" ? "US" : "UK";

  return {
    region,
    geoTargetConstants: [GEO_TARGETS_BY_REGION[region]],
  };
}

async function loadFirstGaSnapshot(): Promise<{ propertyId: string; report: GAReportResponse } | null> {
  try {
    const gaDir = path.join(process.cwd(), "snapshots", "ga");
    const entries = await fs.readdir(gaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = path.join(gaDir, entry.name, "report.json");
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const report = JSON.parse(raw) as GAReportResponse;
        return { propertyId: entry.name, report };
      } catch {
        // Ignore malformed snapshot and continue searching.
      }
    }
  } catch {
    // No snapshot directory or other filesystem issue; ignore.
  }
  return null;
}

async function loadGaSnapshot(propertyId?: string | null): Promise<{ propertyId: string; report: GAReportResponse } | null> {
  if (propertyId) {
    const snapshot = await loadSnapshot<GAReportResponse>(["ga", propertyId, "report"]);
    if (snapshot) {
      return { propertyId, report: snapshot };
    }
  }
  return loadFirstGaSnapshot();
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const base64 = normalized + "=".repeat(paddingLength);
  try {
    return Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return value;
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyToDateString(key: string): string {
  return `${key}-01`;
}

function monthKeyToIndex(key: string): number {
  const [yearStr, monthStr] = key.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return 0;
  }
  return year * 12 + month;
}

function computeScalingSummary(gscReport: GSCReportResponse, ninetyDaySessions: number): ScalingSummarySnapshot {
  const gaSessions = Number.isFinite(ninetyDaySessions) ? Math.max(0, ninetyDaySessions) : 0;

  let brand = 0;
  let nonBrand = 0;

  const start = new Date(`${gscReport.headline.startDate}T00:00:00`);
  const end = new Date(`${gscReport.headline.endDate}T00:00:00`);

  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    for (const row of gscReport.rows ?? []) {
      const rowDate = new Date(`${row.date}T00:00:00`);
      if (Number.isNaN(rowDate.getTime()) || rowDate < start || rowDate > end) {
        continue;
      }
      if (Number.isFinite(row.brandClicks)) {
        brand += row.brandClicks;
      }
      if (Number.isFinite(row.nonBrandClicks)) {
        nonBrand += row.nonBrandClicks;
      }
    }
  } else {
    brand = gscReport.headline.totalBrandClicks;
    nonBrand = gscReport.headline.totalNonBrandClicks;
  }

  brand = Math.max(0, brand);
  nonBrand = Math.max(0, nonBrand);

  const quantifiableClicks = brand + nonBrand;

  if (quantifiableClicks <= 0 || gaSessions <= 0) {
    return {
      quantifiableClicks,
      ninetyDaySessions: gaSessions,
      brandClicks: brand,
      nonBrandClicks: nonBrand,
      gap: gaSessions - quantifiableClicks,
      shortfallPercent: 0,
      scaleFactor: 1,
      isReady: false,
    };
  }

  const gap = gaSessions - quantifiableClicks;
  const shortfallPercent = gaSessions > 0 ? gap / gaSessions : 0;
  const scaleFactor = gaSessions / quantifiableClicks;

  return {
    quantifiableClicks,
    ninetyDaySessions: gaSessions,
    brandClicks: brand,
    nonBrandClicks: nonBrand,
    gap,
    shortfallPercent,
    scaleFactor,
    isReady: true,
  };
}

function computeCombinedSessions(
  gaReport: GAReportResponse,
  forecast: ProphetForecastResponse,
  scaleFactor: number,
): CombinedSessionsDatum[] {
  if (!gaReport?.rows?.length) {
    return [];
  }

  const brandForecast = forecast?.brand?.forecast ?? [];
  const nonBrandForecast = forecast?.nonBrand?.forecast ?? [];
  if (brandForecast.length === 0 || nonBrandForecast.length === 0) {
    return [];
  }

  const sortedRows = [...gaReport.rows].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  const lastActualRow = sortedRows[sortedRows.length - 1];
  const lastActualDate = new Date(`${lastActualRow.date}T00:00:00`);
  if (Number.isNaN(lastActualDate.getTime())) {
    return [];
  }

  const startWindow = startOfMonth(new Date());
  startWindow.setMonth(startWindow.getMonth() - 12);

  const rawForecastEnd = forecast?.brand?.forecast_end || forecast?.nonBrand?.forecast_end || "";
  const parsedForecastEnd = rawForecastEnd ? new Date(`${rawForecastEnd}T00:00:00`) : lastActualDate;
  const forecastEndDate = Number.isNaN(parsedForecastEnd.getTime()) ? lastActualDate : parsedForecastEnd;
  const endWindow = startOfMonth(forecastEndDate);

  if (endWindow < startWindow) {
    return [];
  }

  const months: string[] = [];
  const cursor = new Date(startWindow);
  while (cursor <= endWindow) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const actualMap = new Map<string, number>();
  for (const row of gaReport.rows) {
    const rowDate = new Date(`${row.date}T00:00:00`);
    if (Number.isNaN(rowDate.getTime()) || rowDate < startWindow) {
      continue;
    }
    const key = monthKey(rowDate);
    const sanitizedSessions = Number.isFinite(row.sessions) ? Math.max(0, row.sessions) : 0;
    actualMap.set(key, (actualMap.get(key) ?? 0) + sanitizedSessions);
  }

  const effectiveScaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  const forecastMap = new Map<string, { brand: number; nonBrand: number }>();

  for (const point of brandForecast) {
    const rowDate = new Date(`${point.date}T00:00:00`);
    if (Number.isNaN(rowDate.getTime()) || rowDate <= lastActualDate || rowDate < startWindow) {
      continue;
    }
    const key = monthKey(rowDate);
    const entry = forecastMap.get(key) ?? { brand: 0, nonBrand: 0 };
    entry.brand += Math.max(0, point.yhat * effectiveScaleFactor);
    forecastMap.set(key, entry);
  }

  for (const point of nonBrandForecast) {
    const rowDate = new Date(`${point.date}T00:00:00`);
    if (Number.isNaN(rowDate.getTime()) || rowDate <= lastActualDate || rowDate < startWindow) {
      continue;
    }
    const key = monthKey(rowDate);
    const entry = forecastMap.get(key) ?? { brand: 0, nonBrand: 0 };
    entry.nonBrand += Math.max(0, point.yhat * effectiveScaleFactor);
    forecastMap.set(key, entry);
  }

  const lastActualMonthKey = monthKey(lastActualDate);
  const lastActualIndex = monthKeyToIndex(lastActualMonthKey);

  return months.map<CombinedSessionsDatum>((key) => {
    const monthIndex = monthKeyToIndex(key);
    const dateString = monthKeyToDateString(key);
    if (monthIndex <= lastActualIndex) {
      return {
        date: dateString,
        monthKey: key,
        actualSessions: Math.max(0, actualMap.get(key) ?? 0),
        scaledBrand: 0,
        scaledNonBrand: 0,
        isForecast: false,
      };
    }
    const entry = forecastMap.get(key) ?? { brand: 0, nonBrand: 0 };
    return {
      date: dateString,
      monthKey: key,
      actualSessions: 0,
      scaledBrand: Math.max(0, entry.brand),
      scaledNonBrand: Math.max(0, entry.nonBrand),
      isForecast: true,
    };
  });
}

async function findLatestProphetSnapshot(): Promise<{ filePath: string; siteSlug: string; brandSlug: string } | null> {
  const root = path.join(process.cwd(), "snapshots", "prophet");
  try {
    const siteEntries = await fs.readdir(root, { withFileTypes: true });
    const candidates: Array<{ filePath: string; siteSlug: string; brandSlug: string; mtimeMs: number }> = [];

    for (const siteEntry of siteEntries) {
      if (!siteEntry.isDirectory()) {
        continue;
      }
      const siteSlug = siteEntry.name;
      const sitePath = path.join(root, siteSlug);
      const brandEntries = await fs.readdir(sitePath, { withFileTypes: true });
      for (const brandEntry of brandEntries) {
        if (!brandEntry.isDirectory()) {
          continue;
        }
        const brandSlug = brandEntry.name;
        const brandPath = path.join(sitePath, brandSlug);
        const files = await fs.readdir(brandPath, { withFileTypes: true });
        for (const fileEntry of files) {
          if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) {
            continue;
          }
          const filePath = path.join(brandPath, fileEntry.name);
          const stats = await fs.stat(filePath);
          candidates.push({ filePath, siteSlug, brandSlug, mtimeMs: stats.mtimeMs });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const { filePath, siteSlug, brandSlug } = candidates[0];
    return { filePath, siteSlug, brandSlug };
  } catch {
    return null;
  }
}

async function loadProphetResultsFromSnapshots(): Promise<{
  results: ProphetStoredResults;
  gscReport: GSCReportResponse;
  siteSlug: string;
  brandSlug: string;
  siteUrl: string;
} | null> {
  const latest = await findLatestProphetSnapshot();
  if (!latest) {
    return null;
  }

  try {
    const raw = await fs.readFile(latest.filePath, "utf-8");
    const forecast = JSON.parse(raw) as ProphetForecastResponse;

    const gaSnapshot = await loadFirstGaSnapshot();
    if (!gaSnapshot) {
      return null;
    }

    const gscReport = await loadSnapshot<GSCReportResponse>(["gsc", latest.siteSlug, latest.brandSlug]);
    if (!gscReport) {
      return null;
    }

    const ninetyDaySessions = gaSnapshot.report?.headline90Day?.totalSessions ?? 0;
    const scalingSummary = computeScalingSummary(gscReport, ninetyDaySessions);
    const combinedSessions = computeCombinedSessions(
      gaSnapshot.report,
      forecast,
      scalingSummary.scaleFactor,
    );

    const siteUrl = gscReport.siteUrl || fromBase64Url(latest.siteSlug);

    return {
      results: {
        forecast,
        scalingSummary,
        combinedSessions,
      },
      gscReport,
      siteSlug: latest.siteSlug,
      brandSlug: latest.brandSlug,
      siteUrl,
    };
  } catch (error) {
    console.warn("[Snapshot] Failed to load prophet snapshot bundle:", error);
    return null;
  }
}

async function findLatestUpliftSnapshot(): Promise<{ filePath: string; region: string } | null> {
  const root = path.join(process.cwd(), "snapshots", "uplift");
  try {
    const regionEntries = await fs.readdir(root, { withFileTypes: true });
    const candidates: Array<{ filePath: string; region: string; mtimeMs: number }> = [];

    for (const regionEntry of regionEntries) {
      if (!regionEntry.isDirectory()) {
        continue;
      }
      const region = regionEntry.name;
      const regionPath = path.join(root, region);
      const files = await fs.readdir(regionPath, { withFileTypes: true });
      for (const fileEntry of files) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) {
          continue;
        }
        const filePath = path.join(regionPath, fileEntry.name);
        const stats = await fs.stat(filePath);
        candidates.push({ filePath, region, mtimeMs: stats.mtimeMs });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0];
  } catch {
    return null;
  }
}

async function loadUpliftResultsFromSnapshots(): Promise<ProjectionResults | null> {
  const latest = await findLatestUpliftSnapshot();
  if (!latest) {
    return null;
  }

  try {
    const raw = await fs.readFile(latest.filePath, "utf-8");
    return JSON.parse(raw) as ProjectionResults;
  } catch (error) {
    console.warn("[Snapshot] Failed to load uplift snapshot:", error);
    return null;
  }
}

interface ExcelReportMetadata {
  generatedAt: string;
  sessionStart?: string | null;
  timeSpentMs?: number | null;
  gaPropertyName?: string | null;
  gaPropertyId?: string | null;
  gscSiteUrl?: string | null;
  gscBrandTerms?: string[] | null;
  csvFileName?: string | null;
}

interface ExcelReportContext {
  uplift: ProjectionResults | null;
  upliftCtrValues?: number[] | null;
  prophet: ProphetStoredResults | null;
  gscReport: GSCReportResponse | null;
  gaReport: GAReportResponse | null;
  metadata: ExcelReportMetadata;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
});

function formatDateTime(iso?: string | null): string {
  if (!iso) {
    return "N/A";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return DATE_TIME_FORMATTER.format(date);
}

function formatDateOnly(iso?: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return iso;
    }
    return DATE_FORMATTER.format(parsed);
  }
  return DATE_FORMATTER.format(date);
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) {
    return "N/A";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  if (hours === 0 && seconds > 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ") || "0s";
}

function addSectionTitle(sheet: ExcelJS.Worksheet, title: string): void {
  const row = sheet.addRow([title]);
  row.font = { bold: true, size: 13 };
  row.alignment = { vertical: "middle" };
}

function addHeaderRow(sheet: ExcelJS.Worksheet, headers: string[]): ExcelJS.Row {
  const row = sheet.addRow(headers);
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD0D7DE" } },
      left: { style: "thin", color: { argb: "FFD0D7DE" } },
      bottom: { style: "thin", color: { argb: "FFD0D7DE" } },
      right: { style: "thin", color: { argb: "FFD0D7DE" } },
    };
  });
  return row;
}

function addNoDataRow(sheet: ExcelJS.Worksheet, message: string): void {
  const row = sheet.addRow([message]);
  row.font = { italic: true, color: { argb: "FF6B7280" } };
}

interface HorizontalTableOptions {
  sheet: ExcelJS.Worksheet;
  startRow: number;
  startCol: number;
  title: string;
  headers: string[];
  rows: any[][];
  columnWidths?: number[];
  numberFormats?: Array<string | null>;
  noDataMessage: string;
}

function writeHorizontalTable({
  sheet,
  startRow,
  startCol,
  title,
  headers,
  rows,
  columnWidths,
  numberFormats,
  noDataMessage,
}: HorizontalTableOptions): void {
  columnWidths?.forEach((width, index) => {
    sheet.getColumn(startCol + index).width = width;
  });

  const titleCell = sheet.getCell(startRow, startCol);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { vertical: "middle" };
  if (headers.length > 1) {
    sheet.mergeCells(startRow, startCol, startRow, startCol + headers.length - 1);
  }

  const headerRowNumber = startRow + 1;
  headers.forEach((header, index) => {
    const cell = sheet.getCell(headerRowNumber, startCol + index);
    cell.value = header;
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD0D7DE" } },
      left: { style: "thin", color: { argb: "FFD0D7DE" } },
      bottom: { style: "thin", color: { argb: "FFD0D7DE" } },
      right: { style: "thin", color: { argb: "FFD0D7DE" } },
    };
  });

  if (rows.length === 0) {
    const cell = sheet.getCell(headerRowNumber + 1, startCol);
    cell.value = noDataMessage;
    cell.font = { italic: true, color: { argb: "FF6B7280" } };
    if (headers.length > 1) {
      sheet.mergeCells(
        headerRowNumber + 1,
        startCol,
        headerRowNumber + 1,
        startCol + headers.length - 1,
      );
    }
    return;
  }

  rows.forEach((values, rowIndex) => {
    const excelRowNumber = headerRowNumber + 1 + rowIndex;
    values.forEach((value, colIndex) => {
      const cell = sheet.getCell(excelRowNumber, startCol + colIndex);
      cell.value = value;
      const format = numberFormats?.[colIndex];
      if (format) {
        cell.numFmt = format;
      }
    });
  });
}

function addUpliftSummarySheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("Uplift Summary");
  for (let i = 1; i <= 5; i += 1) {
    sheet.getColumn(i).width = i === 1 ? 32 : 18;
  }

  const uplift = context.uplift;
  const monthlyAggregates = uplift?.monthlyAggregates ?? [];
  const baselineLookup = new Map<string, number>();
  if (context.prophet?.combinedSessions?.length) {
    for (const entry of context.prophet.combinedSessions) {
      if (!entry?.date) {
        continue;
      }
      const normalizedDate = entry.date.includes("T") ? entry.date.split("T")[0] : entry.date;
      if (!normalizedDate) {
        continue;
      }
      const baselineValue = entry.isForecast
        ? Math.max(
            0,
            (Number.isFinite(entry.scaledBrand) ? Number(entry.scaledBrand) : 0) +
              (Number.isFinite(entry.scaledNonBrand) ? Number(entry.scaledNonBrand) : 0),
          )
        : Math.max(0, Number.isFinite(entry.actualSessions) ? Number(entry.actualSessions) : 0);
      baselineLookup.set(normalizedDate, baselineValue);
    }
  }

  const monthlyRowsWithBaseline = monthlyAggregates.map((row) => {
    const normalizedMonthStart = row.monthStart.includes("T")
      ? row.monthStart.split("T")[0]
      : row.monthStart;
    const baselineValue = baselineLookup.has(normalizedMonthStart)
      ? baselineLookup.get(normalizedMonthStart)!
      : Math.max(0, row.totalBaseline);
    return { data: row, baselineValue };
  });

  const computedBaselineTotal = monthlyRowsWithBaseline.reduce(
    (acc, entry) => acc + entry.baselineValue,
    0,
  );
  const combinedSessionsBaselineTotal = baselineLookup.size
    ? Array.from(baselineLookup.values()).reduce((acc, value) => acc + value, 0)
    : 0;

  addSectionTitle(sheet, "Headline Figures");
  addHeaderRow(sheet, ["Metric", "Value"]);

  if (uplift) {
    const totalRow = sheet.addRow(["Total projected uplift (visits)", uplift.totalUpliftSum]);
    totalRow.getCell(2).numFmt = "#,##0";
    const baselineSummaryValue =
      monthlyRowsWithBaseline.length > 0
        ? computedBaselineTotal
        : combinedSessionsBaselineTotal || uplift.totalBaselineSum;
    const baselineRow = sheet.addRow(["Baseline visits", baselineSummaryValue]);
    baselineRow.getCell(2).numFmt = "#,##0";
    const percentRow = sheet.addRow(["Uplift percentage", uplift.upliftPercentage ?? 0]);
    percentRow.getCell(2).numFmt = "0.0%";
  } else {
    addNoDataRow(sheet, "No uplift results available.");
  }

  sheet.addRow([]);
  addSectionTitle(sheet, "Monthly Projections");
  addHeaderRow(sheet, ["Month", "Total Visits", "Projected Uplift", "Baseline Visits"]);

  if (monthlyRowsWithBaseline.length) {
    monthlyRowsWithBaseline.forEach(({ data, baselineValue }) => {
      const added = sheet.addRow([
        formatDateOnly(data.monthStart),
        data.totalVisits,
        data.totalUplift,
        baselineValue,
      ]);
      added.getCell(2).numFmt = "#,##0";
      added.getCell(3).numFmt = "#,##0";
      added.getCell(4).numFmt = "#,##0";
    });
  } else {
    addNoDataRow(sheet, "Monthly projection data is not available.");
  }

  sheet.addRow([]);
  addSectionTitle(sheet, "Total Opportunity by Category");
  addHeaderRow(sheet, ["Category", "Total Uplift (Visits)"]);

  if (uplift?.categoryUpliftByMonth?.length) {
    const totals = new Map<string, number>();
    uplift.categoryUpliftByMonth.forEach(({ category, uplift: upliftValue }) => {
      const key = category && category.trim().length > 0 ? category : "Uncategorized";
      totals.set(key, (totals.get(key) ?? 0) + upliftValue);
    });
    const rows = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    rows.forEach(([category, value]) => {
      const added = sheet.addRow([category, value]);
      added.getCell(2).numFmt = "#,##0";
    });
  } else {
    addNoDataRow(sheet, "Category uplift data is not available.");
  }
}

function addKeywordUpliftSheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("Keyword Uplift Report");
  const headers = [
    "Keyword",
    "Volume",
    "Difficulty",
    "Main Category",
    "Start Rank",
    "Month Start",
    "Predicted Rank",
    "Expected CTR",
    "Expected Visits",
    "Baseline Visits",
    "Projected Uplift",
    "Quick Win",
    "Opportunity Score",
  ];
  headers.forEach((_, index) => {
    const widths = [42, 12, 12, 20, 12, 16, 14, 14, 18, 18, 18, 12, 18];
    sheet.getColumn(index + 1).width = widths[index] ?? 16;
  });

  addHeaderRow(sheet, headers);

  const projections = context.uplift?.detailedProjections ?? [];
  if (projections.length === 0) {
    addNoDataRow(sheet, "No detailed projection data available.");
    return;
  }

  projections.forEach((row) => {
    const added = sheet.addRow([
      row.keyword,
      row.volume,
      row.difficulty,
      row.mainCategory ?? "",
      row.startRank,
      formatDateOnly(row.monthStart),
      row.predRank,
      row.expCtr,
      row.expVisits,
      row.baselineVisits,
      row.expUplift,
      row.quickWin ? "Yes" : "No",
      row.opportunityScore,
    ]);
    added.getCell(2).numFmt = "#,##0";
    added.getCell(5).numFmt = "0";
    added.getCell(7).numFmt = "0";
    added.getCell(8).numFmt = "0.0%";
    added.getCell(9).numFmt = "#,##0";
    added.getCell(10).numFmt = "#,##0";
    added.getCell(11).numFmt = "#,##0";
    added.getCell(13).numFmt = "0.0";
  });
}

function addProphetSheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("Prophet Projections");
  const forecast = context.prophet?.forecast ?? null;
  const combinedSessions = context.prophet?.combinedSessions ?? [];

  const combinedRows = combinedSessions.map((row) => [
    formatDateOnly(row.date),
    row.actualSessions,
    row.scaledBrand,
    row.scaledNonBrand,
    row.isForecast ? "Yes" : "No",
  ]);

  const brandRows = (forecast?.brand?.forecast ?? []).map((point) => [
    formatDateOnly(point.date),
    point.yhat,
    point.yhat_lower,
    point.yhat_upper,
  ]);

  const nonBrandRows = (forecast?.nonBrand?.forecast ?? []).map((point) => [
    formatDateOnly(point.date),
    point.yhat,
    point.yhat_lower,
    point.yhat_upper,
  ]);

  writeHorizontalTable({
    sheet,
    startRow: 1,
    startCol: 1,
    title: "Scaled Combined Sessions",
    headers: ["Date", "Actual Sessions", "Scaled Brand", "Scaled Non-Brand", "Is Forecast"],
    rows: combinedRows,
    columnWidths: [18, 18, 18, 18, 14],
    numberFormats: [null, "#,##0", "#,##0", "#,##0", null],
    noDataMessage: "Scaled projections are not available.",
  });

  writeHorizontalTable({
    sheet,
    startRow: 1,
    startCol: 7,
    title: "Brand Forecast",
    headers: ["Date", "Predicted", "Lower", "Upper"],
    rows: brandRows,
    columnWidths: [18, 16, 16, 16],
    numberFormats: [null, "#,##0", "#,##0", "#,##0"],
    noDataMessage: "Brand forecast data is not available.",
  });

  writeHorizontalTable({
    sheet,
    startRow: 1,
    startCol: 12,
    title: "Non-Brand Forecast",
    headers: ["Date", "Predicted", "Lower", "Upper"],
    rows: nonBrandRows,
    columnWidths: [18, 16, 16, 16],
    numberFormats: [null, "#,##0", "#,##0", "#,##0"],
    noDataMessage: "Non-brand forecast data is not available.",
  });
}

function addSearchConsoleSheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("Search Console Traffic");
  for (let i = 1; i <= 6; i += 1) {
    const widths = [20, 16, 16, 16, 16, 16];
    sheet.getColumn(i).width = widths[i - 1] ?? 16;
  }

  const report = context.gscReport;

  addSectionTitle(sheet, "Headline Summary");
  addHeaderRow(sheet, ["Metric", "Value"]);
  if (report?.headline) {
    const totalRow = sheet.addRow(["Total Clicks", report.headline.totalClicks]);
    totalRow.getCell(2).numFmt = "#,##0";
    const brandRow = sheet.addRow(["Total Brand Clicks", report.headline.totalBrandClicks]);
    brandRow.getCell(2).numFmt = "#,##0";
    const nonBrandRow = sheet.addRow(["Total Non-Brand Clicks", report.headline.totalNonBrandClicks]);
    nonBrandRow.getCell(2).numFmt = "#,##0";
    const shareRow = sheet.addRow(["90-day Brand Share", report.headline.ninetyDayBrandShare ?? 0]);
    shareRow.getCell(2).numFmt = "0.0%";
  } else {
    addNoDataRow(sheet, "Search Console headline metrics are not available.");
  }

  sheet.addRow([]);
  addSectionTitle(sheet, "Daily Click Breakdown");
  addHeaderRow(sheet, ["Date", "Total Clicks", "Brand Clicks", "Non-Brand Clicks", "Anonymous Clicks"]);

  if (report?.rows?.length) {
    report.rows.forEach((row) => {
      const added = sheet.addRow([
        formatDateOnly(row.date),
        row.totalClicks,
        row.brandClicks,
        row.nonBrandClicks,
        row.anonymousClicks,
      ]);
      added.getCell(2).numFmt = "#,##0";
      added.getCell(3).numFmt = "#,##0";
      added.getCell(4).numFmt = "#,##0";
      added.getCell(5).numFmt = "#,##0";
    });
  } else {
    addNoDataRow(sheet, "No daily GSC click data available.");
  }
}

function addCtrSheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("Non-Brand CTR");
  for (let i = 1; i <= 6; i += 1) {
    const widths = [12, 14, 20, 16, 16, 40];
    sheet.getColumn(i).width = widths[i - 1] ?? 16;
  }

  const observedCtr = context.gscReport?.nonBrandCtrByPosition ?? [];
  const observedMap = new Map<number, { ctr: number; clicks: number; impressions: number }>();
  observedCtr.forEach((row) => {
    const position = Math.round(row.position);
    if (position >= 1 && position <= 20) {
      observedMap.set(position, {
        ctr: row.ctr,
        clicks: row.clicks,
        impressions: row.impressions,
      });
    }
  });

  addSectionTitle(sheet, "CTR Curve (Positions 1-20)");
  addHeaderRow(sheet, ["Position", "CTR", "Source", "Clicks", "Impressions"]);

  const ctrValues = context.upliftCtrValues ?? null;
  let hasCtrData = false;
  for (let position = 1; position <= 20; position += 1) {
    const curveValue = ctrValues && position - 1 < ctrValues.length ? ctrValues[position - 1] : null;
    const observed = observedMap.get(position);
    const ctr = curveValue ?? observed?.ctr ?? null;
    if (ctr === null) {
      continue;
    }
    hasCtrData = true;
    const source =
      curveValue !== null && observed
        ? "Curve (overrides observed)"
        : curveValue !== null
        ? "Curve"
        : "Observed";
    const added = sheet.addRow([
      position,
      ctr,
      source,
      observed?.clicks ?? "",
      observed?.impressions ?? "",
    ]);
    added.getCell(1).numFmt = "0";
    added.getCell(2).numFmt = "0.0%";
    if (observed?.clicks !== undefined) {
      added.getCell(4).numFmt = "#,##0";
    }
    if (observed?.impressions !== undefined) {
      added.getCell(5).numFmt = "#,##0";
    }
  }

  if (!hasCtrData) {
    addNoDataRow(sheet, "CTR curve data is not available.");
  }

  sheet.addRow([]);
  addSectionTitle(sheet, "Non-Brand Queries (Reference)");
  addHeaderRow(sheet, ["Query", "Clicks", "Impressions", "CTR", "Avg Position"]);

  const queries = context.gscReport?.nonBrandQueries ?? [];
  if (queries.length === 0) {
    addNoDataRow(sheet, "No non-brand query data available.");
    return;
  }

  queries.forEach((row) => {
    const added = sheet.addRow([
      row.query,
      row.clicks,
      row.impressions,
      row.ctr,
      row.position,
    ]);
    added.getCell(2).numFmt = "#,##0";
    added.getCell(3).numFmt = "#,##0";
    added.getCell(4).numFmt = "0.0%";
    added.getCell(5).numFmt = "0.0";
  });
}

function addGaSheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("GA4 Traffic");
  for (let i = 1; i <= 6; i += 1) {
    const widths = [18, 16, 16, 16, 16, 16];
    sheet.getColumn(i).width = widths[i - 1] ?? 16;
  }

  const report = context.gaReport;

  addSectionTitle(sheet, "90-Day Headline");
  addHeaderRow(sheet, ["Metric", "Value"]);
  if (report?.headline90Day) {
    const sessions = sheet.addRow(["Sessions", report.headline90Day.totalSessions]);
    sessions.getCell(2).numFmt = "#,##0";
    const transactions = sheet.addRow(["Transactions", report.headline90Day.totalTransactions]);
    transactions.getCell(2).numFmt = "#,##0";
    const revenue = sheet.addRow(["Revenue", report.headline90Day.totalRevenue]);
    revenue.getCell(2).numFmt = "£#,##0.00";
    const aov = sheet.addRow(["Average Order Value", report.headline90Day.averageOrderValue]);
    aov.getCell(2).numFmt = "£#,##0.00";
    const cr = sheet.addRow(["Conversion Rate", report.headline90Day.conversionRate]);
    cr.getCell(2).numFmt = "0.0%";
  } else {
    addNoDataRow(sheet, "GA4 headline metrics are not available.");
  }

  sheet.addRow([]);
  addSectionTitle(sheet, "Historic Organic Performance");
  addHeaderRow(sheet, ["Date", "Sessions", "Transactions", "Revenue"]);

  if (report?.rows?.length) {
    report.rows.forEach((row) => {
      const added = sheet.addRow([
        formatDateOnly(row.date),
        row.sessions,
        row.transactions,
        row.revenue,
      ]);
      added.getCell(2).numFmt = "#,##0";
      added.getCell(3).numFmt = "#,##0";
      added.getCell(4).numFmt = "£#,##0.00";
    });
  } else {
    addNoDataRow(sheet, "No GA4 time series data available.");
  }
}

function addConfigSheet(workbook: ExcelJS.Workbook, context: ExcelReportContext): void {
  const sheet = workbook.addWorksheet("Report Config");
  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 80;

  addHeaderRow(sheet, ["Setting", "Value"]);
  const metadata = context.metadata;

  sheet.addRow(["Report generated at", formatDateTime(metadata.generatedAt)]);
  sheet.addRow(["Session started at", formatDateTime(metadata.sessionStart ?? null)]);
  sheet.addRow(["Time spent making report", formatDuration(metadata.timeSpentMs)]);
  sheet.addRow([
    "GA4 property",
    metadata.gaPropertyName ? metadata.gaPropertyName : "Not connected",
  ]);
  sheet.addRow([
    "GA4 property ID",
    metadata.gaPropertyId ? metadata.gaPropertyId : "N/A",
  ]);
  sheet.addRow([
    "GSC site URL",
    metadata.gscSiteUrl ? metadata.gscSiteUrl : "Not connected",
  ]);
  sheet.addRow([
    "Brand term filters",
    metadata.gscBrandTerms && metadata.gscBrandTerms.length > 0
      ? metadata.gscBrandTerms.join(", ")
      : "None",
  ]);
  sheet.addRow([
    "Uplift CSV filename",
    metadata.csvFileName ?? "Not provided",
  ]);
}

function getOAuth2Client() {
  // Use REPLIT_DEV_DOMAIN for dev environment, or construct published URL
  const baseUrl = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPL_SLUG 
    ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.dev`
    : 'http://localhost:5000';
    
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl}/api/google/callback`
  );
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Session middleware for storing Google OAuth tokens temporarily
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "oppengine-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // Google Analytics OAuth initiation
  app.get("/api/google/ga/authorize", (req, res) => {
    const oauth2Client = getOAuth2Client();
    const state = randomUUID();
    req.session.oauthService = "ga";
    req.session.oauthState = state;
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES.ga,
      prompt: "consent",
      state: state
    });

    res.redirect(authUrl);
  });

  // Google Search Console OAuth initiation
  app.get("/api/google/gsc/authorize", (req, res) => {
    const oauth2Client = getOAuth2Client();
    const state = randomUUID();
    req.session.oauthService = "gsc";
    req.session.oauthState = state;
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES.gsc,
      prompt: "consent",
      state: state
    });

    res.redirect(authUrl);
  });

  // OAuth callback handler
  app.get("/api/google/callback", async (req, res) => {
    const { code, error, state } = req.query;

    if (error) {
      return res.send(`
        <html>
          <body>
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <script>
              window.opener?.postMessage({ type: 'oauth-error', error: '${error}' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    }

    if (!code || typeof code !== "string") {
      return res.send(`
        <html>
          <body>
            <h1>Authorization Error</h1>
            <p>Missing authorization code.</p>
            <script>
              window.opener?.postMessage({ type: 'oauth-error', error: 'missing_code' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    }

    const service = req.session.oauthService;
    const savedState = req.session.oauthState;

    if (!service || !savedState) {
      return res.send(`
        <html>
          <body>
            <h1>Session Expired</h1>
            <p>Your session has expired. Please try again.</p>
            <script>
              window.opener?.postMessage({ type: 'oauth-error', error: 'session_expired' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    }

    if (!state || typeof state !== "string" || state !== savedState) {
      return res.send(`
        <html>
          <body>
            <h1>Security Error</h1>
            <p>Invalid state parameter. Possible CSRF attack.</p>
            <script>
              window.opener?.postMessage({ type: 'oauth-error', error: 'invalid_state' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    }

    try {
      const oauth2Client = getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      
      if (service === "ga") {
        req.session.gaTokens = tokens;
        req.session.gaConnected = true;
      } else if (service === "gsc") {
        req.session.gscTokens = tokens;
        req.session.gscConnected = true;
      }

      req.session.oauthState = undefined;
      req.session.oauthService = undefined;

      res.send(`
        <html>
          <body>
            <h1>Authorization Successful!</h1>
            <p>You can close this window and return to OppEngine.</p>
            <script>
              window.opener?.postMessage({ type: 'oauth-success', service: '${service}' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.status(500).send(`
        <html>
          <body>
            <h1>Authorization Error</h1>
            <p>Failed to exchange authorization code for tokens.</p>
            <script>
              window.opener?.postMessage({ type: 'oauth-error', error: 'token_exchange_failed' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
        </html>
      `);
    }
  });

  // Check connection status
  app.get("/api/google/status", async (req, res) => {
    let selectedGAProperty = req.session.selectedGAProperty ?? null;
    let gaReportSummary = req.session.gaReportSummary ?? null;

    if (!gaReportSummary) {
      const propertyIdHint = selectedGAProperty ? selectedGAProperty.name.split("/").pop() ?? null : null;
      const snapshot = await loadGaSnapshot(propertyIdHint);
      if (snapshot) {
        gaReportSummary = {
          propertyId: snapshot.report.propertyId ?? snapshot.propertyId,
          propertyName: snapshot.report.propertyName,
          fetchedAt: snapshot.report.generatedAt,
          headline90Day: snapshot.report.headline90Day,
        };
        req.session.gaReportSummary = gaReportSummary;
        if (!selectedGAProperty) {
          selectedGAProperty = {
            name: `properties/${snapshot.report.propertyId ?? snapshot.propertyId}`,
            displayName: snapshot.report.propertyName,
          };
          req.session.selectedGAProperty = selectedGAProperty;
        }
      }
    }

    res.json({
      ga: {
        connected: req.session.gaConnected || false,
        hasTokens: !!req.session.gaTokens,
        selectedProperty: selectedGAProperty,
        reportSummary: gaReportSummary,
      },
      gsc: {
        connected: req.session.gscConnected || false,
        hasTokens: !!req.session.gscTokens,
        selectedSite: req.session.selectedGSCSite || null,
        brandTerms: req.session.gscBrandTerms || [],
        reportSummary: req.session.gscReportSummary || null,
      }
    });
  });

  app.get("/api/dashboard/bootstrap", async (req, res) => {
    if (!getSnapshotInfo().enabled) {
      const emptyPayload: DashboardBootstrapPayload = { prophet: null, uplift: null };
      return res.json(emptyPayload);
    }

    try {
      const [prophetBundle, upliftResults] = await Promise.all([
        loadProphetResultsFromSnapshots(),
        loadUpliftResultsFromSnapshots(),
      ]);

      const payload: DashboardBootstrapPayload = {
        prophet: prophetBundle?.results ?? null,
        uplift: upliftResults,
      };

      if (prophetBundle?.results) {
        req.session.prophetResults = prophetBundle.results;
        if (!req.session.selectedGSCSite) {
          req.session.selectedGSCSite = { siteUrl: prophetBundle.siteUrl };
        }
        if (!req.session.gscBrandTerms) {
          req.session.gscBrandTerms = prophetBundle.gscReport.brandTerms ?? [];
        }
        if (!req.session.gscReportSummary) {
          req.session.gscReportSummary = {
            siteUrl: prophetBundle.gscReport.siteUrl,
            brandTerms: prophetBundle.gscReport.brandTerms,
            fetchedAt: prophetBundle.gscReport.generatedAt,
            headline: prophetBundle.gscReport.headline,
          };
        }
      }

      if (upliftResults) {
        req.session.upliftResults = upliftResults;
      }

      res.json(payload);
    } catch (error) {
      console.error("Error bootstrapping dashboard snapshots:", error);
      res.status(500).json({ error: "Failed to load dashboard snapshot data" });
    }
  });

  app.post("/api/report/session-start", (req, res) => {
    if (!req.session.reportSessionStart) {
      req.session.reportSessionStart = new Date().toISOString();
    }
    res.json({ startedAt: req.session.reportSessionStart });
  });

  app.get("/api/report/excel", async (req, res) => {
    try {
      const generatedAt = new Date();

      let upliftResults = req.session.upliftResults ?? null;
      if (!upliftResults) {
        upliftResults = await loadUpliftResultsFromSnapshots();
        if (upliftResults) {
          req.session.upliftResults = upliftResults;
        }
      }

      let prophetResults = req.session.prophetResults ?? null;
      let gscReport = req.session.gscReport ?? null;
      if (!prophetResults || !gscReport) {
        const snapshotBundle = await loadProphetResultsFromSnapshots();
        if (snapshotBundle) {
          if (!prophetResults) {
            prophetResults = snapshotBundle.results;
            req.session.prophetResults = snapshotBundle.results;
          }
          if (!gscReport) {
            gscReport = snapshotBundle.gscReport;
            req.session.gscReport = snapshotBundle.gscReport;
          }
          if (!req.session.selectedGSCSite) {
            req.session.selectedGSCSite = { siteUrl: snapshotBundle.siteUrl };
          }
          if (!req.session.gscBrandTerms) {
            req.session.gscBrandTerms = snapshotBundle.gscReport.brandTerms ?? [];
          }
        }
      }

      let gaReport = req.session.gaReport ?? null;
      if (!gaReport) {
        const gaSnapshot = await loadGaSnapshot(req.session.gaReportSummary?.propertyId);
        if (gaSnapshot) {
          gaReport = gaSnapshot.report;
          req.session.gaReport = gaSnapshot.report;
          req.session.gaReportSummary = {
            propertyId: gaSnapshot.report.propertyId ?? gaSnapshot.propertyId,
            propertyName: gaSnapshot.report.propertyName,
            fetchedAt: gaSnapshot.report.generatedAt,
            headline90Day: gaSnapshot.report.headline90Day,
          };
          if (!req.session.selectedGAProperty) {
            req.session.selectedGAProperty = {
              name: `properties/${gaSnapshot.report.propertyId ?? gaSnapshot.propertyId}`,
              displayName: gaSnapshot.report.propertyName,
            };
          }
        }
      }

      const sessionStartIso = req.session.reportSessionStart ?? null;
      let timeSpentMs: number | null = null;
      if (sessionStartIso) {
        const started = new Date(sessionStartIso);
        if (!Number.isNaN(started.getTime())) {
          timeSpentMs = Math.max(0, generatedAt.getTime() - started.getTime());
        }
      }

      const metadata: ExcelReportMetadata = {
        generatedAt: generatedAt.toISOString(),
        sessionStart: sessionStartIso,
        timeSpentMs,
        gaPropertyName:
          req.session.gaReportSummary?.propertyName ??
          req.session.selectedGAProperty?.displayName ??
          null,
        gaPropertyId:
          req.session.gaReportSummary?.propertyId ??
          req.session.selectedGAProperty?.name?.split("/").pop() ??
          null,
        gscSiteUrl:
          req.session.gscReportSummary?.siteUrl ??
          req.session.selectedGSCSite?.siteUrl ??
          gscReport?.siteUrl ??
          null,
        gscBrandTerms:
          req.session.gscReportSummary?.brandTerms ??
          req.session.gscBrandTerms ??
          gscReport?.brandTerms ??
          null,
        csvFileName: req.session.lastUploadedCsvName ?? null,
      };

      const context: ExcelReportContext = {
        uplift: upliftResults,
        upliftCtrValues: req.session.upliftCtrValues ?? null,
        prophet: prophetResults,
        gscReport,
        gaReport,
        metadata,
      };

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "OppEngine";
      workbook.created = generatedAt;
      workbook.modified = generatedAt;
      workbook.properties.date1904 = false;

      addUpliftSummarySheet(workbook, context);
      addKeywordUpliftSheet(workbook, context);
      addProphetSheet(workbook, context);
      addSearchConsoleSheet(workbook, context);
      addCtrSheet(workbook, context);
      addGaSheet(workbook, context);
      addConfigSheet(workbook, context);

      const buffer = await workbook.xlsx.writeBuffer();
      const filenameTimestamp = metadata.generatedAt.replace(/[:.]/g, "-");

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="OppEngine_Report_${filenameTimestamp}.xlsx"`,
      );
      res.send(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    } catch (error: any) {
      console.error("Failed to generate Excel report:", error);
      res.status(500).json({ error: "Failed to generate Excel report" });
    }
  });

  // Disconnect GA
  app.post("/api/google/ga/disconnect", (req, res) => {
    req.session.gaConnected = false;
    req.session.gaTokens = undefined;
    res.json({ success: true });
  });

  // Disconnect GSC
  app.post("/api/google/gsc/disconnect", (req, res) => {
    req.session.gscConnected = false;
    req.session.gscTokens = undefined;
    req.session.selectedGSCSite = undefined;
    req.session.gscBrandTerms = undefined;
    req.session.gscReportSummary = undefined;
    res.json({ success: true });
  });

  // Fetch GA4 properties
  app.get("/api/google/ga/properties", async (req, res) => {
    if (!req.session.gaTokens) {
      return res.status(401).json({ error: "Not authenticated with Google Analytics" });
    }

    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(req.session.gaTokens);

      const analyticsAdmin = google.analyticsadmin({ version: "v1beta", auth: oauth2Client });
      
      // List all account summaries (includes properties)
      const response = await analyticsAdmin.accountSummaries.list();
      
      const properties = response.data.accountSummaries?.flatMap((account) => 
        account.propertySummaries?.map((property) => ({
          name: property.property,
          displayName: property.displayName,
          accountName: account.account,
          accountDisplayName: account.displayName,
        })) || []
      ) || [];

      res.json({ properties });
    } catch (error: any) {
      console.error("Error fetching GA properties:", error);
      res.status(500).json({ 
        error: "Failed to fetch Google Analytics properties",
        details: error.message 
      });
    }
  });

  // Fetch GSC sites
  app.get("/api/google/gsc/sites", async (req, res) => {
    if (!req.session.gscTokens) {
      return res.status(401).json({ error: "Not authenticated with Google Search Console" });
    }

    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(req.session.gscTokens);

      const searchConsole = google.searchconsole({ version: "v1", auth: oauth2Client });
      
      const response = await searchConsole.sites.list();
      
      const sites = response.data.siteEntry?.map((site) => ({
        siteUrl: site.siteUrl,
        permissionLevel: site.permissionLevel,
      })) || [];

      res.json({ sites });
    } catch (error: any) {
      console.error("Error fetching GSC sites:", error);
      res.status(500).json({ 
        error: "Failed to fetch Search Console sites",
        details: error.message 
      });
    }
  });

  // Save selected GA property
  app.post("/api/google/ga/select-property", (req, res) => {
    const { propertyName, displayName } = req.body;
    
    if (!propertyName) {
      return res.status(400).json({ error: "Property name is required" });
    }

    req.session.selectedGAProperty = {
      name: propertyName,
      displayName: displayName || propertyName,
    };

    res.json({ success: true, property: req.session.selectedGAProperty });
  });

  app.post("/api/google/ga/report", async (req, res) => {
    try {
      const forceRefresh = Boolean(req.body?.forceRefresh);
      const propertyIdFromSelection = req.session.selectedGAProperty?.name
        ? req.session.selectedGAProperty.name.split("/").pop() ?? null
        : null;
      let propertyId: string | null =
        propertyIdFromSelection ??
        req.session.gaReportSummary?.propertyId ??
        (typeof req.body?.propertyId === "string" ? req.body.propertyId : null);

      if (!forceRefresh) {
        const snapshotInfo = await loadGaSnapshot(propertyId);
        if (snapshotInfo) {
          propertyId = snapshotInfo.propertyId;
          req.session.gaReportSummary = {
            propertyId: snapshotInfo.report.propertyId ?? snapshotInfo.propertyId,
            propertyName: snapshotInfo.report.propertyName,
            fetchedAt: snapshotInfo.report.generatedAt,
            headline90Day: snapshotInfo.report.headline90Day,
          };
          if (!req.session.selectedGAProperty) {
            req.session.selectedGAProperty = {
              name: `properties/${snapshotInfo.report.propertyId ?? snapshotInfo.propertyId}`,
              displayName: snapshotInfo.report.propertyName,
            };
          }
          req.session.gaReport = snapshotInfo.report;
          return res.json(snapshotInfo.report);
        }
      }

      if (!req.session.gaTokens) {
        return res.status(401).json({ error: "Not authenticated with Google Analytics" });
      }

      if (!req.session.selectedGAProperty) {
        return res.status(400).json({ error: "No Google Analytics property selected" });
      }

      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(req.session.gaTokens);

      const propertyName = req.session.selectedGAProperty.name;
      const propertyDisplayName = req.session.selectedGAProperty.displayName;
      propertyId = propertyName.split("/").pop() || propertyName;
      const snapshotKey = ["ga", propertyId, "report"];

      const { getOrganicReportForProperty } = await import("./googleAnalytics");
      const report = await getOrganicReportForProperty({
        oauth2Client,
        propertyId,
        propertyName: propertyDisplayName,
        forceRefresh,
      });

      // Persist updated tokens (may include refreshed access token)
      req.session.gaTokens = oauth2Client.credentials;
      req.session.gaReportSummary = {
        propertyId: report.propertyId,
        propertyName: report.propertyName,
        fetchedAt: report.generatedAt,
        headline90Day: report.headline90Day,
      };
      req.session.gaReport = report;

      if (!forceRefresh) {
        await saveSnapshot(snapshotKey, report);
      }

      res.json(report);
    } catch (error: any) {
      console.error("Error fetching GA report:", error);
      res.status(500).json({
        error: "Failed to fetch Google Analytics report",
        details: error.message,
      });
    }
  });

  // Save selected GSC site
  app.post("/api/google/gsc/select-site", (req, res) => {
    const { siteUrl } = req.body;
    
    if (!siteUrl) {
      return res.status(400).json({ error: "Site URL is required" });
    }

    req.session.selectedGSCSite = { siteUrl };
    req.session.gscBrandTerms = undefined;
    req.session.gscReportSummary = undefined;

    res.json({ success: true, site: req.session.selectedGSCSite });
  });

  app.post("/api/google/gsc/report", async (req, res) => {
    if (!req.session.gscTokens) {
      return res.status(401).json({ error: "Not authenticated with Google Search Console" });
    }

    if (!req.session.selectedGSCSite) {
      return res.status(400).json({ error: "No Search Console site selected" });
    }

    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(req.session.gscTokens);

      const siteUrl = req.session.selectedGSCSite.siteUrl;
      const forceRefresh = Boolean(req.body?.forceRefresh);

      const fromBody = req.body?.brandTerms;
      let brandTerms: string[] = [];

      if (Array.isArray(fromBody)) {
        brandTerms = fromBody
          .map((term: unknown) => (typeof term === "string" ? term.trim() : ""))
          .filter((term) => term.length > 0);
      } else if (typeof fromBody === "string") {
        brandTerms = fromBody
          .split(",")
          .map((term) => term.trim())
          .filter((term) => term.length > 0);
      }

      if (brandTerms.length === 0 && Array.isArray(req.session.gscBrandTerms)) {
        brandTerms = req.session.gscBrandTerms;
      }

      const brandTermsSlug =
        brandTerms.length > 0
          ? brandTerms
              .map((term) => term.replace(/[^a-zA-Z0-9-_]+/g, "_").toLowerCase())
              .join("__")
          : "none";
      const siteSlug = toBase64Url(siteUrl);
      const snapshotKey = ["gsc", siteSlug, brandTermsSlug];

      const { getSearchConsoleReport } = await import("./searchConsole");
      if (!forceRefresh) {
        const snapshot = await loadSnapshot<GSCReportResponse>(snapshotKey);
        if (snapshot) {
          req.session.gscTokens = oauth2Client.credentials;
          req.session.gscBrandTerms = snapshot.brandTerms;
          req.session.gscReportSummary = {
            siteUrl: snapshot.siteUrl,
            brandTerms: snapshot.brandTerms,
            fetchedAt: snapshot.generatedAt,
            headline: snapshot.headline,
          };
          req.session.gscReport = snapshot;
          return res.json(snapshot);
        }
      }

      const report = await getSearchConsoleReport({
        oauth2Client,
        siteUrl,
        brandTerms,
        forceRefresh: Boolean(req.body?.forceRefresh),
      });

      req.session.gscTokens = oauth2Client.credentials;
      req.session.gscBrandTerms = report.brandTerms;
      req.session.gscReportSummary = {
        siteUrl: report.siteUrl,
        brandTerms: report.brandTerms,
        fetchedAt: report.generatedAt,
        headline: report.headline,
      };
      req.session.gscReport = report;

      if (!forceRefresh) {
        await saveSnapshot(snapshotKey, report);
      }

      res.json(report);
    } catch (error: any) {
      console.error("Error fetching GSC report:", error);
      res.status(500).json({
        error: "Failed to fetch Search Console report",
        details: error.message,
      });
    }
  });

  app.post("/api/prophet/forecast", async (req, res) => {
    if (!req.session.gscTokens || !req.session.selectedGSCSite) {
      return res.status(400).json({ error: "Search Console site is not connected" });
    }

    const forceRefresh = Boolean(req.body?.forceRefresh);
    const rawMonthsAhead = Number(req.body?.monthsAhead ?? 12);
    const monthsAhead = Number.isFinite(rawMonthsAhead)
      ? Math.min(36, Math.max(1, Math.round(rawMonthsAhead)))
      : 12;

    const parseTrend = (value: unknown): "flat" | "linear" => (value === "linear" ? "linear" : "flat");
    const clampMultiplier = (value: unknown): number => {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return Math.min(5, Math.max(0, num));
    };

    const brandTrend = parseTrend(req.body?.brandTrend);
    const nonBrandTrend = parseTrend(req.body?.nonBrandTrend);
    const brandMultiplier = clampMultiplier(req.body?.brandMultiplier);
    const nonBrandMultiplier = clampMultiplier(req.body?.nonBrandMultiplier);

    const brandTermsFromRequest: string[] | undefined = Array.isArray(req.body?.brandTerms)
      ? req.body.brandTerms
          .map((term: unknown) => (typeof term === "string" ? term.trim() : ""))
          .filter((term: string) => term.length > 0)
      : undefined;

    const brandTerms = brandTermsFromRequest ?? req.session.gscBrandTerms ?? [];
    const siteUrl = req.session.selectedGSCSite.siteUrl;
    const siteSlug = toBase64Url(siteUrl);
    const brandTermsSlug =
      brandTerms.length > 0
        ? brandTerms.map((term) => term.replace(/[^a-zA-Z0-9-_]+/g, "_").toLowerCase()).join("__")
        : "none";
    const prophetConfigSlug = [
      monthsAhead,
      brandTrend,
      brandMultiplier.toFixed(2),
      nonBrandTrend,
      nonBrandMultiplier.toFixed(2),
    ].join("-");
    const prophetSnapshotKey = ["prophet", siteSlug, brandTermsSlug, prophetConfigSlug];

    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(req.session.gscTokens);

      if (!forceRefresh) {
        const cachedForecast = await loadSnapshot<{
          monthsAhead: number;
          generatedAt: string;
          brand: ProphetForecastResult["brand"];
          nonBrand: ProphetForecastResult["nonBrand"];
        }>(prophetSnapshotKey);
        if (cachedForecast) {
          return res.json(cachedForecast);
        }
      }

      const { getSearchConsoleReport } = await import("./searchConsole");
      let report: GSCReportResponse | null = null;
      if (!forceRefresh) {
        report = await loadSnapshot<GSCReportResponse>(["gsc", siteSlug, brandTermsSlug]);
      }

      if (!report) {
        report = await getSearchConsoleReport({
          oauth2Client,
          siteUrl,
          brandTerms,
          forceRefresh: false,
        });
      }

      const forecasts = await runProphetForecast({
        monthsAhead,
        brand: {
          trend: brandTrend,
          multiplier: brandMultiplier,
          data: report.rows.map((row) => ({
            date: row.date,
            value: row.brandClicks,
          })),
        },
        nonBrand: {
          trend: nonBrandTrend,
          multiplier: nonBrandMultiplier,
          data: report.rows.map((row) => ({
            date: row.date,
            value: row.nonBrandClicks,
          })),
        },
      });

      const responsePayload = {
        monthsAhead,
        generatedAt: new Date().toISOString(),
        brand: forecasts.brand,
        nonBrand: forecasts.nonBrand,
      };

      if (!forceRefresh) {
        await saveSnapshot(prophetSnapshotKey, responsePayload);
      }

      res.json(responsePayload);
    } catch (error: any) {
      console.error("Error generating Prophet forecast:", error);
      res.status(500).json({
        error: "Failed to generate Prophet forecast",
        details: error?.message,
      });
    }
  });

  // Uplift Calculator - Parse CSV and run projections
  const { batchForecast } = await import("./upliftCalculator");
  const { UpliftParametersSchema, KeywordRowSchema } = await import("@shared/schema");
  
  app.post("/api/uplift/calculate", async (req, res) => {
    try {
      const { csvData, parameters, searchVolumeRegion: requestedRegion } = req.body;
      const { region: searchVolumeRegion, geoTargetConstants } = resolveGeoTargets(requestedRegion);
      const forceRefresh = Boolean(req.body?.forceRefresh);
      const csvFileName =
        typeof req.body?.csvFileName === "string" ? req.body.csvFileName.trim() : null;
      
      if (!csvData || !Array.isArray(csvData)) {
        return res.status(400).json({ error: "CSV data is required as an array of rows" });
      }

      // Validate parameters
      const validatedParams = UpliftParametersSchema.parse(parameters);
      
      // Parse and validate keyword rows
      const keywords = csvData.map((row: any) => {
        const { columnMapping } = validatedParams;
        
        // Robust number parsing with fallback
        const parseNumber = (value: any, fallback: number): number => {
          if (value === null || value === undefined || value === "" || value === "-") {
            return fallback;
          }
          const num = parseFloat(String(value).replace(/[^0-9.-]/g, ""));
          return isNaN(num) ? fallback : num;
        };
        
        return KeywordRowSchema.parse({
          keyword: row[columnMapping.keyword] || "",
          volume: parseNumber(row[columnMapping.volume], 0),
          difficulty: columnMapping.difficulty ? (row[columnMapping.difficulty] || "N/A") : "N/A",
          startRank: columnMapping.startRank ? parseNumber(row[columnMapping.startRank], 100) : 100,
          intent: columnMapping.intent ? row[columnMapping.intent] : undefined,
          category: columnMapping.category ? row[columnMapping.category] : undefined,
        });
      });

      const snapshotSignatureBase = JSON.stringify({
        keywords,
        parameters: validatedParams,
        searchVolumeRegion,
      });
      const snapshotSignature = createHash("sha256").update(snapshotSignatureBase).digest("hex").slice(0, 16);
      const snapshotKey = ["uplift", searchVolumeRegion.toLowerCase(), snapshotSignature];

      if (!forceRefresh) {
        const cachedResults = await loadSnapshot<ProjectionResults>(snapshotKey);
        if (cachedResults) {
          req.session.upliftResults = cachedResults;
          req.session.upliftCtrValues = validatedParams.ctrValues;
          if (csvFileName) {
            req.session.lastUploadedCsvName = csvFileName;
          }
          return res.json(cachedResults);
        }
      }

      // If Seasonal mode, fetch Google Ads data for all keywords before calculation
      if (validatedParams.projectionHorizon.mode === "Seasonal") {
        const { batchFetchSeasonalVolumes } = await import("./googleAdsCache");
        const keywordList = keywords.map(k => k.keyword);
        console.log(
          `[Uplift] Fetching seasonal volumes for ${keywordList.length} keywords in Seasonal mode (${searchVolumeRegion})`
        );
        await batchFetchSeasonalVolumes(keywordList, { geoTargetConstants });
      }

      // Run batch forecast (will use cached seasonal data if available)
      const results = batchForecast(keywords, validatedParams, { geoTargetConstants });
      if (!forceRefresh) {
        await saveSnapshot(snapshotKey, results);
      }

      req.session.upliftResults = results;
      req.session.upliftCtrValues = validatedParams.ctrValues;
      if (csvFileName) {
        req.session.lastUploadedCsvName = csvFileName;
      }

      res.json(results);
    } catch (error: any) {
      console.error("Uplift calculation error:", error);
      res.status(500).json({ 
        error: "Failed to calculate uplift projections",
        details: error.message,
      });
    }
  });

  // Google Ads Cache Management
  const { 
    getCacheStats, 
    clearCache, 
    fetchSeasonalVolumeFromGoogleAds,
    batchFetchSeasonalVolumes 
  } = await import("./googleAdsCache");

  // Get cache statistics
  app.get("/api/google-ads/cache/stats", (req, res) => {
    const stats = getCacheStats();
    res.json(stats);
  });

  // Clear cache
  app.post("/api/google-ads/cache/clear", (req, res) => {
    clearCache();
    res.json({ success: true, message: "Cache cleared" });
  });

  // Test endpoint to list accessible customers
  app.get("/api/google-ads/list-customers", async (req, res) => {
    try {
      console.log('[GoogleAds Test] Listing accessible customers');
      
      const hasCredentials = !!(
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN
      );
      
      if (!hasCredentials) {
        return res.status(400).json({ error: 'Missing Google Ads credentials' });
      }
      
      const { GoogleAdsApi } = await import('google-ads-api');
      
      const client = new GoogleAdsApi({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      });
      
      const customers = await client.listAccessibleCustomers(process.env.GOOGLE_ADS_REFRESH_TOKEN!);
      console.log('[GoogleAds Test] Accessible customers:', customers);
      
      res.json({ customers });
    } catch (error: any) {
      console.error('[GoogleAds Test] Error listing customers:', error);
      res.status(500).json({ 
        error: 'Failed to list customers',
        message: error.message || 'Unknown error'
      });
    }
  });

  // Test endpoint to verify Google Ads API integration
  app.post("/api/google-ads/test-keyword", async (req, res) => {
    try {
      const { keyword, searchVolumeRegion: requestedRegion } = req.body;
      
      if (!keyword || typeof keyword !== "string") {
        return res.status(400).json({ error: "Keyword is required" });
      }

      const { region: searchVolumeRegion, geoTargetConstants } = resolveGeoTargets(requestedRegion);

      console.log(
        `[GoogleAds Test] Testing API for keyword: ${keyword} (${searchVolumeRegion})`
      );
      
      const hasCredentials = !!(
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN &&
        process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      );

      console.log(`[GoogleAds Test] Has credentials: ${hasCredentials}`);

      const data = await fetchSeasonalVolumeFromGoogleAds(keyword, {
        geoTargetConstants,
      });
      
      if (!data) {
        return res.status(404).json({ 
          error: "Unable to fetch seasonal volume data",
          keyword,
          hasCredentials,
          message: "Check server logs for detailed error information"
        });
      }

      res.json({
        success: true,
        keyword,
        monthlyVolumes: data.monthlyVolumes,
        source: "Google Ads API",
        region: searchVolumeRegion,
      });
    } catch (error: any) {
      console.error("[GoogleAds Test] Error:", error);
      res.status(500).json({ 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  });

  // Fetch seasonal volume for a single keyword
  app.post("/api/google-ads/seasonal-volume", async (req, res) => {
    try {
      const { keyword, searchVolumeRegion: requestedRegion } = req.body;
      
      if (!keyword || typeof keyword !== "string") {
        return res.status(400).json({ error: "Keyword is required" });
      }

      const { region: searchVolumeRegion, geoTargetConstants } = resolveGeoTargets(requestedRegion);

      const data = await fetchSeasonalVolumeFromGoogleAds(keyword, {
        geoTargetConstants,
      });
      
      if (!data) {
        return res.status(404).json({ error: "Unable to fetch seasonal volume data" });
      }

      res.json({ ...data, region: searchVolumeRegion });
    } catch (error: any) {
      console.error("Error fetching seasonal volume:", error);
      res.status(500).json({ 
        error: "Failed to fetch seasonal volume",
        details: error.message,
      });
    }
  });

  // Batch fetch seasonal volumes
  app.post("/api/google-ads/seasonal-volumes-batch", async (req, res) => {
    try {
      const { keywords, searchVolumeRegion: requestedRegion } = req.body;
      
      if (!keywords || !Array.isArray(keywords)) {
        return res.status(400).json({ error: "Keywords array is required" });
      }

      const { region: searchVolumeRegion, geoTargetConstants } = resolveGeoTargets(requestedRegion);

      const results = await batchFetchSeasonalVolumes(keywords, {
        geoTargetConstants,
      });
      
      // Convert Map to object for JSON serialization
      const resultsObj = Object.fromEntries(results);

      res.json({ 
        count: results.size,
        data: resultsObj,
        region: searchVolumeRegion,
      });
    } catch (error: any) {
      console.error("Error batch fetching seasonal volumes:", error);
      res.status(500).json({ 
        error: "Failed to batch fetch seasonal volumes",
        details: error.message,
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
