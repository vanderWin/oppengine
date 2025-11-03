interface SeasonalVolumeData {
  keyword: string;
  monthlyVolumes: number[];
  closeVariants?: string[];
  matchedVariant?: string;
  averageMonthlySearches?: number;
}

interface CacheEntry {
  data: SeasonalVolumeData;
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

interface FetchOptions {
  geoTargetConstants?: string[];
  languageConstant?: string;
}

const DEFAULT_GEO_TARGETS = ["geoTargetConstants/2826"]; // United Kingdom
const DEFAULT_LANGUAGE = "languageConstants/1000"; // English
const MONTH_NAME_TO_INDEX: Record<string, number> = {
  JANUARY: 0,
  FEBRUARY: 1,
  MARCH: 2,
  APRIL: 3,
  MAY: 4,
  JUNE: 5,
  JULY: 6,
  AUGUST: 7,
  SEPTEMBER: 8,
  OCTOBER: 9,
  NOVEMBER: 10,
  DECEMBER: 11,
};

function normalizeKeyword(keyword: string): string {
  return keyword ? keyword.trim().toLowerCase() : "";
}

function getGeoKey(geoTargetConstants?: string[]): string {
  const targets =
    geoTargetConstants && geoTargetConstants.length > 0
      ? geoTargetConstants
      : DEFAULT_GEO_TARGETS;
  return [...targets].sort().join(",");
}

function buildCacheKey(keyword: string, geoTargetConstants?: string[]): string | null {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) {
    return null;
  }
  return `${getGeoKey(geoTargetConstants)}::${normalized}`;
}

function buildCacheKeyFromNormalized(
  normalizedKeyword: string,
  geoKey: string
): string | null {
  const normalized = normalizedKeyword.trim();
  if (!normalized) {
    return null;
  }
  return `${geoKey}::${normalized}`;
}

function isCacheEntryExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > CACHE_TTL_MS;
}

function parseMonthlyVolumes(monthlySearchVolumes: any): number[] {
  const volumes = new Array(12).fill(0);
  if (!Array.isArray(monthlySearchVolumes)) {
    return volumes;
  }

  for (const item of monthlySearchVolumes) {
    const rawMonth = item?.month ?? item?.Month ?? item?.month?.name;
    let monthIndex: number | undefined;

    if (typeof rawMonth === "string") {
      monthIndex = MONTH_NAME_TO_INDEX[rawMonth.toUpperCase()];
    } else if (typeof rawMonth === "number") {
      const candidate = rawMonth - 1;
      if (candidate >= 0 && candidate < 12) {
        monthIndex = candidate;
      }
    }

    if (monthIndex === undefined) {
      continue;
    }

    const rawValue = item?.monthlySearches ?? item?.monthly_searches;
    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (Number.isFinite(value)) {
      volumes[monthIndex] += value;
    }
  }

  return volumes;
}

function extractCloseVariants(result: any): string[] {
  const raw = result?.closeVariants ?? result?.close_variants;
  if (!Array.isArray(raw)) {
    return [];
  }
  const variants: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) {
        variants.push(trimmed);
      }
    }
  }
  return variants;
}

function cacheResultForAliases(
  result: any,
  geoTargetConstants?: string[]
): boolean {
  const canonical = typeof result?.text === "string" ? result.text.trim() : "";
  const canonicalNormalized = normalizeKeyword(canonical);

  if (!canonicalNormalized) {
    return false;
  }

  const closeVariants = extractCloseVariants(result);
  const aliasMap = new Map<string, string>();
  aliasMap.set(canonicalNormalized, canonical);
  for (const variant of closeVariants) {
    const normalized = normalizeKeyword(variant);
    if (normalized && !aliasMap.has(normalized)) {
      aliasMap.set(normalized, variant);
    }
  }

  const metrics = result?.keywordMetrics ?? result?.keyword_metrics;
  const monthlyVolumes = parseMonthlyVolumes(
    metrics?.monthlySearchVolumes ?? metrics?.monthly_search_volumes
  );

  const avgMonthlySearchesRaw =
    metrics?.avgMonthlySearches ?? metrics?.avg_monthly_searches;
  const averageMonthlySearches =
    typeof avgMonthlySearchesRaw === "number"
      ? avgMonthlySearchesRaw
      : Number(avgMonthlySearchesRaw);

  if (!aliasMap.size) {
    return false;
  }

  aliasMap.forEach((displayAlias) => {
    const data: SeasonalVolumeData = {
      keyword: canonical,
      monthlyVolumes: monthlyVolumes.slice(),
      closeVariants,
      matchedVariant: displayAlias,
      averageMonthlySearches: Number.isFinite(averageMonthlySearches)
        ? averageMonthlySearches
        : undefined,
    };
    setCachedSeasonalVolume(displayAlias, data, geoTargetConstants);
  });

  return true;
}

export function getCachedSeasonalVolume(
  keyword: string,
  geoTargetConstants?: string[]
): SeasonalVolumeData | null {
  const cacheKey = buildCacheKey(keyword, geoTargetConstants);
  if (!cacheKey) {
    return null;
  }

  const entry = cache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (isCacheEntryExpired(entry)) {
    cache.delete(cacheKey);
    return null;
  }

  return entry.data;
}

export function setCachedSeasonalVolume(
  keyword: string,
  data: SeasonalVolumeData,
  geoTargetConstants?: string[]
): void {
  const cacheKey = buildCacheKey(keyword, geoTargetConstants);
  if (!cacheKey) {
    return;
  }

  cache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

function ensureCredentials(): boolean {
  const hasCredentials =
    !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    !!process.env.GOOGLE_ADS_CLIENT_ID &&
    !!process.env.GOOGLE_ADS_CLIENT_SECRET &&
    !!process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    !!process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  if (!hasCredentials) {
    console.warn(
      "[GoogleAds] Missing credentials - Google Ads integration not configured"
    );
  }

  return hasCredentials;
}

function sanitizeCustomerId(rawCustomerId: string | undefined): string {
  return (rawCustomerId || "").replace(/-/g, "").trim();
}

async function createCustomer() {
  const { GoogleAdsApi } = await import("google-ads-api");

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });

  const customerId = sanitizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

  if (!customerId) {
    throw new Error(
      "Customer ID is empty or not set in environment variables"
    );
  }

  return {
    customer: client.Customer({
      customer_id: customerId,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
    }),
    customerId,
  };
}

function buildHistoricalMetricsRequest(
  customerId: string,
  keywords: string[],
  options?: FetchOptions
) {
  const geoTargetConstants =
    options?.geoTargetConstants && options.geoTargetConstants.length > 0
      ? options.geoTargetConstants
      : DEFAULT_GEO_TARGETS;
  const language = options?.languageConstant ?? DEFAULT_LANGUAGE;

  return {
    customer_id: customerId,
    keywords,
    geo_target_constants: geoTargetConstants,
    language,
    keyword_plan_network: "GOOGLE_SEARCH",
    include_adult_keywords: false,
  };
}

export async function fetchSeasonalVolumeFromGoogleAds(
  keyword: string,
  options?: FetchOptions
): Promise<SeasonalVolumeData | null> {
  const cached = getCachedSeasonalVolume(keyword, options?.geoTargetConstants);
  if (cached) {
    console.log(`[GoogleAds] Cache hit for keyword: ${keyword}`);
    return cached;
  }

  console.log(`[GoogleAds] Cache miss for keyword: ${keyword}`);

  if (!ensureCredentials()) {
    return null;
  }

  try {
    const { customer, customerId } = await createCustomer();

    const request = buildHistoricalMetricsRequest(customerId, [keyword], options);
    const response =
      await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics(
        request as any
      );

    const resultsArray = Array.isArray(response.results)
      ? response.results
      : [];

    if (!resultsArray.length) {
      console.warn(`[GoogleAds] No results for keyword: ${keyword}`);
      return null;
    }

    for (const result of resultsArray) {
      cacheResultForAliases(result, options?.geoTargetConstants);
    }

    const matched = getCachedSeasonalVolume(
      keyword,
      options?.geoTargetConstants
    );
    if (matched) {
      console.log(
        `[GoogleAds] Successfully fetched seasonal data for: ${keyword}`
      );
      return matched;
    }

    // Fallback: return the first canonical keyword if available.
    const firstResult = resultsArray[0];
    const canonical =
      typeof firstResult?.text === "string" ? firstResult.text.trim() : "";
    if (canonical) {
      const cachedCanonical = getCachedSeasonalVolume(
        canonical,
        options?.geoTargetConstants
      );
      if (cachedCanonical) {
        return cachedCanonical;
      }
    }

    console.warn(`[GoogleAds] Unable to map results back to keyword: ${keyword}`);
    return null;
  } catch (error) {
    console.error(
      `[GoogleAds] Error fetching seasonal data for keyword "${keyword}":`,
      error
    );
    return null;
  }
}

export async function batchFetchSeasonalVolumes(
  keywords: string[],
  options?: FetchOptions
): Promise<Map<string, SeasonalVolumeData>> {
  const results = new Map<string, SeasonalVolumeData>();
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return results;
  }

  const geoTargetConstants = options?.geoTargetConstants;
  const geoKey = getGeoKey(geoTargetConstants);

  const normalizedToOriginals = new Map<string, string[]>();
  for (const original of keywords) {
    const normalized = normalizeKeyword(original);
    if (!normalized) {
      continue;
    }
    if (!normalizedToOriginals.has(normalized)) {
      normalizedToOriginals.set(normalized, []);
    }
    normalizedToOriginals.get(normalized)!.push(original);
  }

  // Populate results with existing cache entries
  for (const original of keywords) {
    const cached = getCachedSeasonalVolume(original, geoTargetConstants);
    if (cached) {
      results.set(original, cached);
    }
  }

  const uncachedNormalized = Array.from(normalizedToOriginals.keys()).filter(
    (normalized) => {
      const cacheKey = buildCacheKeyFromNormalized(normalized, geoKey);
      if (!cacheKey) {
        return false;
      }
      const entry = cache.get(cacheKey);
      if (!entry) {
        return true;
      }
      if (isCacheEntryExpired(entry)) {
        cache.delete(cacheKey);
        return true;
      }
      return false;
    }
  );
  const requests = uncachedNormalized
    .map((normalized) => normalizedToOriginals.get(normalized)?.[0])
    .filter((kw): kw is string => typeof kw === "string");

  if (!requests.length) {
    console.log(
      `[GoogleAds] Batch fetch: ${keywords.length} total, 0 uncached (cache satisfied)`
    );
    return results;
  }

  console.log(
    `[GoogleAds] Batch fetch: ${keywords.length} total, ${requests.length} uncached`
  );

  if (!ensureCredentials()) {
    return results;
  }

  try {
    const { customer, customerId } = await createCustomer();

    const BATCH_SIZE = 700;
    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      const batch = requests.slice(i, i + BATCH_SIZE);
      if (!batch.length) {
        continue;
      }

      const request = buildHistoricalMetricsRequest(
        customerId,
        batch,
        options
      );
      const response =
        await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics(
          request as any
        );

      const batchResults = Array.isArray(response.results)
        ? response.results
        : [];

      for (const result of batchResults) {
        cacheResultForAliases(result, geoTargetConstants);
      }
    }
  } catch (error) {
    console.error("Error batch fetching seasonal volumes:", error);
  }

  for (const original of keywords) {
    const cached = getCachedSeasonalVolume(original, geoTargetConstants);
    if (cached) {
      results.set(original, cached);
    }
  }

  return results;
}
