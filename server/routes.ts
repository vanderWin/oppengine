import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { google } from "googleapis";
import { randomUUID, createHash } from "crypto";
import { runProphetForecast, type ProphetForecastResult } from "./prophet";
import type { GAReportResponse, GSCReportResponse, ProjectionResults } from "@shared/schema";
import { loadSnapshot, saveSnapshot } from "./snapshotStore";
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
