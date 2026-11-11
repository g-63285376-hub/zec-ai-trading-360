/* =========================================================
   ZEC AI Intelligence Worker V4.8.1
   AI Geopolitical Intelligence
   Cloudflare Web Search + Workers AI
   Persistent KV Intelligence Cache
   Market Research & Simulation Only
========================================================= */

const VERSION = "4.8.1";

const AI_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json;charset=UTF-8",
  "Cache-Control": "no-store"
};

const IDS = {
  ZEC: "134",
  BTC: "90",
  ETH: "80"
};

const FRED = {
  DGS10: "US 10Y Treasury",
  DFF: "Fed Funds Rate",
  DTWEXBGS: "US Dollar Index Broad",
  VIXCLS: "VIX",
  CPIAUCSL: "US CPI",
  UNRATE: "US Unemployment"
};

const RELEASES = [
  {
    id: 10,
    name: "Consumer Price Index",
    nameCN: "消费者价格指数 CPI",
    impact: "HIGH"
  },
  {
    id: 50,
    name: "Employment Situation",
    nameCN: "美国就业报告",
    impact: "HIGH"
  },
  {
    id: 53,
    name: "Gross Domestic Product",
    nameCN: "美国国内生产总值 GDP",
    impact: "HIGH"
  }
];

const FOMC_2026 = [
  { start: "2026-01-27", date: "2026-01-28" },
  { start: "2026-03-17", date: "2026-03-18" },
  { start: "2026-04-28", date: "2026-04-29" },
  { start: "2026-06-16", date: "2026-06-17" },
  { start: "2026-07-28", date: "2026-07-29" },
  { start: "2026-09-15", date: "2026-09-16" },
  { start: "2026-10-27", date: "2026-10-28" },
  { start: "2026-12-08", date: "2026-12-09" }
];

/* =========================================================
   KV CACHE
========================================================= */

const KV_KEYS = {
  GEO: "geo:ai:last_reliable:v2"
};

const GEO_CACHE_MAX_AGE_MS =
  6 * 60 * 60 * 1000;

async function kvGet(env, key) {
  try {
    if (!env.INTEL_KV) return null;

    const raw =
      await env.INTEL_KV.get(key);

    return raw
      ? JSON.parse(raw)
      : null;

  } catch (_) {
    return null;
  }
}

async function kvPut(env, key, value) {
  try {
    if (!env.INTEL_KV) return false;

    await env.INTEL_KV.put(
      key,
      JSON.stringify(value),
      {
        expirationTtl: 86400
      }
    );

    return true;

  } catch (_) {
    return false;
  }
}

function geoFreshness(ageMs) {
  if (
    ageMs <=
    60 * 60 * 1000
  ) {
    return "FRESH";
  }

  if (
    ageMs <=
    3 * 60 * 60 * 1000
  ) {
    return "AGING";
  }

  if (
    ageMs <=
    GEO_CACHE_MAX_AGE_MS
  ) {
    return "STALE";
  }

  return "EXPIRED";
}

async function saveGeoCache(
  env,
  geo
) {
  if (
    !geo ||
    !geo.dataAvailable ||
    geo.risk === "UNKNOWN"
  ) {
    return false;
  }

  return kvPut(
    env,
    KV_KEYS.GEO,
    {
      savedAt:
        new Date()
          .toISOString(),

      data:
        geo
    }
  );
}

async function loadGeoCache(env) {
  const cached =
    await kvGet(
      env,
      KV_KEYS.GEO
    );

  if (
    !cached?.savedAt ||
    !cached?.data
  ) {
    return null;
  }

  const saved =
    Date.parse(
      cached.savedAt
    );

  if (
    !Number.isFinite(saved)
  ) {
    return null;
  }

  const ageMs =
    Date.now() - saved;

  if (
    ageMs < 0 ||
    ageMs >
      GEO_CACHE_MAX_AGE_MS
  ) {
    return null;
  }

  const freshness =
    geoFreshness(ageMs);

  const factor =
    freshness === "FRESH"
      ? 0.90
      : freshness === "AGING"
        ? 0.72
        : 0.55;

  return {
    ...cached.data,

    ok: true,

    status:
      "KV_CACHE",

    live:
      false,

    cacheUsed:
      true,

    freshness,

    cachedAt:
      cached.savedAt,

    cacheAgeMinutes:
      Math.round(
        ageMs / 60000
      ),

    confidence:
      Math.max(
        20,
        Math.round(
          (
            cached.data
              .confidence ||
            50
          ) * factor
        )
      ),

    messageCN:
      "实时AI地缘政治分析暂时不可用，正在使用最近可靠KV缓存；置信度已按时间衰减。",

    methodology:
      "Live Web Search/AI unavailable. Last reliable AI geopolitical KV cache is used with time-decayed confidence. Cache never independently creates BUY or SELL signals."
  };
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function reply(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: HEADERS
    }
  );
}

function num(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function clamp(
  v,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(max, v)
  );
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function timeoutValue(
  ms,
  value
) {
  return new Promise(
    resolve =>
      setTimeout(
        () => resolve(value),
        ms
      )
  );
}

function cleanText(v) {
  return String(v || "")
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#39;/g,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeTitle(v) {
  return cleanText(v)
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

async function getJSON(
  url,
  timeout = 7000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            Accept:
              "application/json",

            "User-Agent":
              `ZEC-AI-Intelligence/${VERSION}`
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.json();

  } catch (err) {
    if (
      err?.name ===
      "AbortError"
    ) {
      throw new Error(
        "TIMEOUT"
      );
    }

    throw err;

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   MARKET
========================================================= */

async function coinLore(symbol) {
  const data =
    await getJSON(
      `https://api.coinlore.net/api/ticker/?id=${IDS[symbol]}`,
      5000
    );

  if (
    !Array.isArray(data) ||
    !data[0]
  ) {
    throw new Error(
      "CoinLore invalid response"
    );
  }

  const x = data[0];

  return {
    symbol,

    price:
      num(x.price_usd),

    change1h:
      num(
        x.percent_change_1h
      ),

    change24h:
      num(
        x.percent_change_24h
      ),

    change7d:
      num(
        x.percent_change_7d
      ),

    volume24h:
      num(x.volume24),

    marketCap:
      num(
        x.market_cap_usd
      ),

    source:
      "CoinLore"
  };
}

const BINANCE = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com"
];

async function binance(symbol) {
  let lastError =
    "Binance unavailable";

  for (
    const host of BINANCE
  ) {
    try {
      const x =
        await getJSON(
          `${host}/api/v3/ticker/24hr?symbol=${symbol}USDT`,
          3000
        );

      return {
        symbol,

        price:
          num(x.lastPrice),

        change1h:
          null,

        change24h:
          num(
            x.priceChangePercent
          ),

        change7d:
          null,

        volume24h:
          num(
            x.quoteVolume
          ),

        marketCap:
          null,

        source:
          "Binance"
      };

    } catch (err) {
      lastError =
        err?.message ||
        String(err);
    }
  }

  throw new Error(
    lastError
  );
}

async function asset(symbol) {
  try {
    return await coinLore(
      symbol
    );

  } catch (err) {
    const x =
      await binance(
        symbol
      );

    x.fallbackReason =
      err?.message ||
      String(err);

    return x;
  }
}

function marketContext(
  zec,
  btc,
  eth
) {
  let score = 0;

  if (btc?.change24h > 0)
    score++;

  if (btc?.change24h >= 2)
    score++;

  if (btc?.change24h < 0)
    score--;

  if (btc?.change24h <= -2)
    score--;

  if (eth?.change24h > 0)
    score++;

  if (eth?.change24h >= 2)
    score++;

  if (eth?.change24h < 0)
    score--;

  if (eth?.change24h <= -2)
    score--;

  const regime =
    score >= 3
      ? "RISK_ON"
      : score <= -3
        ? "RISK_OFF"
        : "NEUTRAL";

  let relativeStrength =
    "NEUTRAL";

  if (
    zec?.change24h != null &&
    btc?.change24h != null &&
    eth?.change24h != null
  ) {
    const rel =
      zec.change24h -
      (
        btc.change24h +
        eth.change24h
      ) / 2;

    if (rel >= 2) {
      relativeStrength =
        "STRONG";

    } else if (
      rel <= -2
    ) {
      relativeStrength =
        "WEAK";
    }
  }

  return {
    regime,
    score,
    relativeStrength
  };
}

async function marketData() {
  const results =
    await Promise.allSettled([
      asset("ZEC"),
      asset("BTC"),
      asset("ETH")
    ]);

  const market = {
    ZEC:
      results[0].status ===
        "fulfilled"
        ? results[0].value
        : null,

    BTC:
      results[1].status ===
        "fulfilled"
        ? results[1].value
        : null,

    ETH:
      results[2].status ===
        "fulfilled"
        ? results[2].value
        : null
  };

  return {
    market,

    context:
      marketContext(
        market.ZEC,
        market.BTC,
        market.ETH
      )
  };
}

/* =========================================================
   FRED MACRO
========================================================= */

async function fredSeries(
  id,
  key,
  timeout = 7000
) {
  const params =
    new URLSearchParams({
      series_id: id,
      api_key: key,
      file_type: "json",
      sort_order: "desc",
      limit: "5"
    });

  const data =
    await getJSON(
      `https://api.stlouisfed.org/fred/series/observations?${params}`,
      timeout
    );

  const values =
    (
      data.observations ||
      []
    )
      .filter(
        x =>
          x.value !== "." &&
          Number.isFinite(
            Number(x.value)
          )
      );

  if (!values.length) {
    throw new Error(
      "No observations"
    );
  }

  return {
    seriesId: id,

    name:
      FRED[id],

    value:
      Number(
        values[0].value
      ),

    date:
      values[0].date,

    previousValue:
      values[1]
        ? Number(
            values[1].value
          )
        : null,

    change:
      values[1]
        ? Number(
            values[0].value
          ) -
          Number(
            values[1].value
          )
        : null,

    source:
      "FRED"
  };
}

function macroAnalysis(
  indicators
) {
  let score = 0;

  const reasons = [];

  if (
    indicators
      .DTWEXBGS
      ?.change > 0
  ) {
    score++;

    reasons.push(
      "美元指数走强，对加密资产形成压力"
    );
  }

  if (
    indicators
      .DTWEXBGS
      ?.change < 0
  ) {
    score--;

    reasons.push(
      "美元指数回落，对风险资产相对有利"
    );
  }

  if (
    indicators
      .VIXCLS
      ?.value >= 30
  ) {
    score += 3;

    reasons.push(
      "VIX高于30，市场压力显著升高"
    );

  } else if (
    indicators
      .VIXCLS
      ?.value >= 20
  ) {
    score += 2;

    reasons.push(
      "VIX高于20，市场风险偏好谨慎"
    );
  }

  if (
    indicators
      .DGS10
      ?.change >= 0.08
  ) {
    score += 2;

    reasons.push(
      "美国10年期国债收益率上升"
    );
  }

  if (
    indicators
      .CPIAUCSL
      ?.change > 0
  ) {
    score++;

    reasons.push(
      "最新CPI指数较前值上升"
    );
  }

  return {
    regime:
      score >= 3
        ? "RISK_OFF"
        : score <= -2
          ? "RISK_ON"
          : "NEUTRAL",

    risk:
      score >= 3
        ? "HIGH"
        : score <= -2
          ? "LOW"
          : "MEDIUM",

    riskScore:
      score,

    reasons
  };
}

async function macroData(
  env,
  fast = false
) {
  if (
    !env.FRED_API_KEY
  ) {
    return {
      ok: false,
      status:
        "NOT_CONFIGURED",
      risk:
        "UNKNOWN",
      regime:
        "UNKNOWN",
      messageCN:
        "FRED API密钥尚未配置"
    };
  }

  const indicators = {};
  const errors = [];

  for (
    const id of
    Object.keys(FRED)
  ) {
    try {
      indicators[id] =
        await fredSeries(
          id,
          env.FRED_API_KEY,
          fast
            ? 3500
            : 10000
        );

    } catch (err) {
      errors.push(
        `${id}: ${
          err?.message ||
          String(err)
        }`
      );
    }

    if (!fast) {
      await sleep(60);
    }
  }

  const total =
    Object.keys(FRED)
      .length;

  const count =
    Object.keys(
      indicators
    ).length;

  if (!count) {
    return {
      ok: false,
      status:
        "DATA_UNAVAILABLE",
      risk:
        "UNKNOWN",
      regime:
        "UNKNOWN",
      indicators,
      successfulSeries: 0,
      totalSeries: total,
      errors,
      messageCN:
        "FRED宏观数据暂时不可用"
    };
  }

  return {
    ok: true,

    status:
      count === total
        ? "OK"
        : "DEGRADED",

    source:
      "FRED",

    requestMode:
      fast
        ? "FAST_SEQUENTIAL"
        : "SEQUENTIAL",

    successfulSeries:
      count,

    totalSeries:
      total,

    ...macroAnalysis(
      indicators
    ),

    indicators,
    errors,

    messageCN:
      count === total
        ? "宏观经济数据正常"
        : "部分宏观数据暂时不可用"
  };
}

/* =========================================================
   DATE HELPERS
========================================================= */

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function daysAway(date) {
  return Math.round(
    (
      Date.parse(
        `${date}T00:00:00Z`
      ) -
      Date.parse(
        `${today()}T00:00:00Z`
      )
    ) /
    86400000
  );
}

/* =========================================================
   ECONOMIC EVENTS
========================================================= */

async function releaseDates(
  release,
  key,
  timeout = 7000
) {
  const end =
    new Date(
      Date.now() +
      45 * 86400000
    )
      .toISOString()
      .slice(0, 10);

  const params =
    new URLSearchParams({
      release_id:
        String(
          release.id
        ),

      api_key:
        key,

      file_type:
        "json",

      realtime_start:
        today(),

      realtime_end:
        end,

      include_release_dates_with_no_data:
        "true",

      sort_order:
        "asc",

      limit:
        "20"
    });

  const data =
    await getJSON(
      `https://api.stlouisfed.org/fred/release/dates?${params}`,
      timeout
    );

  return (
    data.release_dates ||
    []
  )
    .map(
      x => x.date
    )
    .filter(
      date =>
        date >= today()
    )
    .map(
      date => ({
        eventType:
          "ECONOMIC_DATA",

        releaseId:
          release.id,

        family:
          `FRED-${release.id}`,

        name:
          release.name,

        nameCN:
          release.nameCN,

        impact:
          release.impact,

        date,

        daysAway:
          daysAway(date),

        source:
          "FRED"
      })
    );
}

function nearestPerReleaseFamily(
  events
) {
  const map =
    new Map();

  const sorted =
    [...events]
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      );

  for (
    const event of sorted
  ) {
    if (
      !map.has(
        event.family
      )
    ) {
      map.set(
        event.family,
        event
      );
    }
  }

  return [
    ...map.values()
  ].sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}

function fomcEvents() {
  return FOMC_2026
    .filter(
      x =>
        x.date >= today()
    )
    .map(
      x => ({
        eventType:
          "FOMC",

        releaseId:
          null,

        family:
          `FOMC-${x.date}`,

        name:
          "Federal Open Market Committee Meeting",

        nameCN:
          "美联储 FOMC 利率决议",

        impact:
          "HIGH",

        meetingStart:
          x.start,

        date:
          x.date,

        daysAway:
          daysAway(x.date),

        source:
          "Federal Reserve Official Calendar",

        verified:
          true
      })
    );
}

function eventRiskScore(
  events
) {
  let score = 0;

  const reasons = [];

  for (
    const event of events
  ) {
    if (
      event.daysAway < 0
    ) {
      continue;
    }

    let contribution = 0;

    if (
      event.impact ===
      "HIGH"
    ) {
      if (
        event.daysAway <= 1
      ) {
        contribution = 3;

      } else if (
        event.daysAway <= 3
      ) {
        contribution = 2;

      } else if (
        event.daysAway <= 7
      ) {
        contribution = 1;
      }
    }

    if (
      contribution > 0
    ) {
      score +=
        contribution;

      reasons.push(
        `${event.nameCN}: ${event.date} (${event.daysAway}天)`
      );
    }
  }

  score =
    clamp(
      score,
      0,
      6
    );

  return {
    score,

    risk:
      score >= 4
        ? "HIGH"
        : score >= 2
          ? "MEDIUM"
          : "LOW",

    reasons
  };
}

async function eventData(
  env,
  fast = false
) {
  if (
    !env.FRED_API_KEY
  ) {
    return {
      ok: false,
      status:
        "NOT_CONFIGURED",
      risk:
        "UNKNOWN",
      score:
        null,
      events: [],
      messageCN:
        "经济事件雷达未配置"
    };
  }

  let rawFredEvents = [];

  const errors = [];

  for (
    const release of
    RELEASES
  ) {
    try {
      const dates =
        await releaseDates(
          release,
          env.FRED_API_KEY,
          fast
            ? 3500
            : 8000
        );

      rawFredEvents.push(
        ...dates
      );

    } catch (err) {
      errors.push(
        `${release.id}: ${
          err?.message ||
          String(err)
        }`
      );
    }
  }

  const fredEvents =
    nearestPerReleaseFamily(
      rawFredEvents
    );

  const events = [
    ...fredEvents,
    ...fomcEvents()
  ].sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );

  if (
    !events.length &&
    errors.length ===
      RELEASES.length
  ) {
    return {
      ok: false,
      status:
        "DATA_UNAVAILABLE",
      risk:
        "UNKNOWN",
      score:
        null,
      events: [],
      errors,
      messageCN:
        "经济事件数据暂时不可用"
    };
  }

  const analysis =
    eventRiskScore(
      events
    );

  return {
    ok: true,

    status:
      errors.length
        ? "DEGRADED"
        : "OK",

    source:
      "FRED + Federal Reserve Official Calendar",

    requestMode:
      fast
        ? "FAST_SEQUENTIAL"
        : "SEQUENTIAL",

    horizonDays: 45,

    risk:
      analysis.risk,

    score:
      analysis.score,

    nextEvent:
      events[0] ||
      null,

    events,

    rawFredEventCount:
      rawFredEvents.length,

    uniqueFredFamilyCount:
      fredEvents.length,

    deduped:
      true,

    errors,

    reasons:
      analysis.reasons,

    methodology:
      "Only the nearest upcoming event per FRED release family contributes. FOMC dates are maintained separately from FRED release dates.",

    messageCN:
      "经济事件已按发布系列去重；FOMC会议日期独立处理。"
  };
}

/* =========================================================
   WEB SEARCH
========================================================= */

function normalizeWebItems(
  payload
) {
  const items =
    Array.isArray(
      payload?.items
    )
      ? payload.items
      : [];

  const seen =
    new Set();

  const output = [];

  for (
    const x of items
  ) {
    const url =
      String(
        x?.url || ""
      ).trim();

    const title =
      cleanText(
        x?.title ||
        url
      );

    if (
      !url ||
      !title
    ) {
      continue;
    }

    const key =
      url.toLowerCase();

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    let publisher =
      "web";

    try {
      publisher =
        new URL(url)
          .hostname
          .replace(
            /^www\./,
            ""
          );

    } catch (_) {}

    output.push({
      title,
      url,

      description:
        cleanText(
          x?.description ||
          ""
        ).slice(
          0,
          1600
        ),

      published:
        x?.lastModified ||
        x?.last_modified ||
        null,

      publisher,

      feedSource:
        "Cloudflare Web Search"
    });
  }

  return output;
}

async function cloudflareWebSearch(
  env,
  query,
  limit = 6
) {
  if (
    !env.AI
  ) {
    throw new Error(
      "AI_NOT_BOUND"
    );
  }

  if (
    typeof
      env.AI.websearch !==
      "function"
  ) {
    throw new Error(
      "WEBSEARCH_NOT_AVAILABLE"
    );
  }

  const response =
    await env.AI.websearch({
      gatewayId:
        "default",

      query,

      provider:
        "ceramic",

      limit:
        clamp(
          Math.round(limit),
          1,
          10
        )
    });

  let payload;

  try {
    payload =
      await response.json();

  } catch (_) {
    throw new Error(
      "WEBSEARCH_INVALID_JSON"
    );
  }

  if (!response.ok) {
    const detail =
      payload
        ?.errors
        ?.[0]
        ?.message ||
      payload?.error ||
      `HTTP_${response.status}`;

    throw new Error(
      `WEBSEARCH_FAILED: ${detail}`
    );
  }

  return {
    items:
      normalizeWebItems(
        payload
      ),

    provider:
      payload?.provider ||
      "ceramic",

    metadata:
      payload?.metadata ||
      null
  };
}

/* =========================================================
   WEB SEARCH TEST
========================================================= */

async function webSearchTest(
  env
) {
  const started =
    Date.now();

  try {
    const result =
      await cloudflareWebSearch(
        env,

        "latest major geopolitical risks affecting global financial markets cryptocurrency Bitcoin Zcash today",

        5
      );

    return {
      ok:
        result.items.length >
        0,

      version:
        VERSION,

      test:
        "CLOUDFLARE_WEB_SEARCH",

      binding:
        "AI",

      gateway:
        "default",

      provider:
        result.provider,

      status:
        result.items.length
          ? "OK"
          : "NO_RESULTS",

      liveWebAccess:
        result.items.length >
        0,

      elapsedMs:
        Date.now() -
        started,

      resultCount:
        result.items.length,

      results:
        result.items.slice(
          0,
          5
        ),

      metadata:
        result.metadata,

      messageCN:
        result.items.length
          ? "Cloudflare Web Search 调用成功，Worker 已取得实时互联网搜索结果。"
          : "Web Search 已响应，但没有返回可使用的搜索结果。"
    };

  } catch (err) {
    return {
      ok: false,

      version:
        VERSION,

      test:
        "CLOUDFLARE_WEB_SEARCH",

      binding:
        "AI",

      gateway:
        "default",

      provider:
        "ceramic",

      status:
        "ERROR",

      liveWebAccess:
        false,

      elapsedMs:
        Date.now() -
        started,

      error:
        err?.message ||
        String(err),

      messageCN:
        "Cloudflare Web Search 调用失败。请检查AI Gateway credits、provider配置或runtime兼容性。"
    };
  }
}

/* =========================================================
   AI GEOPOLITICAL INTELLIGENCE
========================================================= */

const GEO_SEARCH_QUERIES = [
  "latest geopolitical war military conflict sanctions global markets oil shipping Red Sea Strait of Hormuz today",

  "latest US China trade tariffs export controls sanctions global financial markets today",

  "latest cryptocurrency regulation government policy Bitcoin crypto markets global today"
];

function dedupeArticles(
  items
) {
  const map =
    new Map();

  for (
    const item of items
  ) {
    const key =
      item.url ||
      normalizeTitle(
        item.title
      );

    if (
      !key ||
      map.has(key)
    ) {
      continue;
    }

    map.set(
      key,
      item
    );
  }

  return [
    ...map.values()
  ];
}

function extractJSONObject(
  text
) {
  const raw =
    String(
      text || ""
    )
      .trim()
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      );

  const first =
    raw.indexOf("{");

  const last =
    raw.lastIndexOf("}");

  if (
    first < 0 ||
    last <= first
  ) {
    throw new Error(
      "AI_JSON_NOT_FOUND"
    );
  }

  return JSON.parse(
    raw.slice(
      first,
      last + 1
    )
  );
}

function enumValue(
  value,
  allowed,
  fallback = "UNKNOWN"
) {
  const x =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

  return allowed.includes(x)
    ? x
    : fallback;
}

function validateGeoAI(
  obj,
  sourceCount,
  articleCount
) {
  let risk =
    enumValue(
      obj?.risk,
      [
        "HIGH",
        "MEDIUM",
        "LOW",
        "UNKNOWN"
      ]
    );

  let score =
    num(
      obj?.riskScore ??
      obj?.score
    );

  score =
    score == null
      ? null
      : clamp(
          Math.round(score),
          0,
          100
        );

  let confidence =
    num(
      obj?.confidence
    );

  confidence =
    confidence == null
      ? 0
      : clamp(
          Math.round(
            confidence
          ),
          0,
          100
        );

  const marketRegime =
    enumValue(
      obj?.marketRegime,
      [
        "RISK_OFF",
        "NEUTRAL",
        "RISK_ON",
        "UNKNOWN"
      ]
    );

  const cryptoImpact =
    enumValue(
      obj?.cryptoImpact,
      [
        "NEGATIVE",
        "NEUTRAL",
        "POSITIVE",
        "UNKNOWN"
      ]
    );

  const zecImpact =
    enumValue(
      obj?.zecImpact,
      [
        "BEARISH_PRESSURE",
        "NEUTRAL",
        "BULLISH_SUPPORT",
        "UNKNOWN"
      ]
    );

  const drivers =
    Array.isArray(
      obj?.drivers
    )
      ? obj.drivers
          .map(cleanText)
          .filter(Boolean)
          .slice(0, 8)
      : [];

  /*
    Safety rule:
    insufficient independent evidence
    can NEVER become LOW risk.
  */

  if (
    articleCount < 3 ||
    sourceCount < 2 ||
    confidence < 40
  ) {
    risk =
      "UNKNOWN";

    score =
      null;

    confidence =
      Math.min(
        confidence,
        39
      );
  }

  /*
    LOW requires stronger
    evidence coverage.
  */

  if (
    risk === "LOW" &&
    (
      articleCount < 5 ||
      sourceCount < 3 ||
      confidence < 60
    )
  ) {
    risk =
      "UNKNOWN";

    score =
      null;
  }

  return {
    risk,

    score,

    riskScore:
      score,

    confidence,

    marketRegime,

    cryptoImpact,

    zecImpact,

    drivers
  };
}

async function aiAnalyzeGeopolitical(
  env,
  articles
) {
  if (!env.AI) {
    throw new Error(
      "AI_NOT_BOUND"
    );
  }

  const sources =
    articles
      .slice(0, 18)
      .map(
        (x, index) => ({
          id:
            index + 1,

          title:
            x.title,

          description:
            x.description,

          publisher:
            x.publisher,

          published:
            x.published,

          url:
            x.url
        })
      );

  const sourceCount =
    new Set(
      sources
        .map(
          x =>
            x.publisher
        )
        .filter(Boolean)
    ).size;

  const prompt = [
    "You are the geopolitical risk classifier inside ZEC AI Intelligence.",

    "Analyze ONLY the supplied live web-search evidence.",

    "Never invent current events.",

    "Focus on effects on global risk assets, cryptocurrency, Bitcoin and Zcash.",

    "Consider war and military escalation, sanctions, US-China relations, tariffs and export controls, Middle East and energy supply, shipping routes, major government policy, market-relevant elections and cryptocurrency regulation.",

    "Do NOT provide investment advice.",

    "Do NOT output BUY or SELL.",

    "If evidence is weak, contradictory, stale or insufficient, use UNKNOWN.",

    "LOW is allowed only when evidence has broad independent coverage and does not show meaningful escalation.",

    "Return strict JSON only with these fields:",

    '{"risk":"HIGH|MEDIUM|LOW|UNKNOWN","riskScore":0,"confidence":0,"marketRegime":"RISK_OFF|NEUTRAL|RISK_ON|UNKNOWN","cryptoImpact":"NEGATIVE|NEUTRAL|POSITIVE|UNKNOWN","zecImpact":"BEARISH_PRESSURE|NEUTRAL|BULLISH_SUPPORT|UNKNOWN","drivers":["..."]}',

    "LIVE WEB EVIDENCE:",

    JSON.stringify(
      sources
    )
  ].join("\n");

  const result =
    await env.AI.run(
      AI_MODEL,
      {
        messages: [
          {
            role:
              "system",

            content:
              "Ground every conclusion in supplied evidence. Output strict JSON only. Market research and simulation only."
          },
          {
            role:
              "user",

            content:
              prompt
          }
        ],

        max_tokens:
          700,

        temperature:
          0.1
      }
    );

  const parsed =
    extractJSONObject(
      result?.response
    );

  return {
    analysis:
      validateGeoAI(
        parsed,
        sourceCount,
        sources.length
      ),

    usage:
      result?.usage ||
      null,

    sourceCount,

    articleCount:
      sources.length
  };
}

async function liveAIGeopoliticalData(
  env,
  fast = false
) {
  const started =
    Date.now();

  const errors = [];
  const articles = [];
  const searches = [];

  if (!env.AI) {
    return {
      ok: false,

      status:
        "AI_NOT_BOUND",

      dataAvailable:
        false,

      live:
        false,

      cacheUsed:
        false,

      source:
        "CLOUDFLARE_WEB_SEARCH + WORKERS_AI",

      engine:
        "AI_GEOPOLITICAL_V4.8.1",

      risk:
        "UNKNOWN",

      score:
        null,

      riskScore:
        null,

      confidence:
        0,

      sourceCount:
        0,

      articleCount:
        0,

      freshness:
        "UNKNOWN",

      marketRegime:
        "UNKNOWN",

      cryptoImpact:
        "UNKNOWN",

      zecImpact:
        "UNKNOWN",

      drivers: [],

      reasons: [
        "Workers AI binding unavailable."
      ],

      headlines: [],

      sources: [],

      errors: [
        "AI_NOT_BOUND"
      ],

      messageCN:
        "Workers AI尚未绑定，地缘政治风险保持未知。"
    };
  }

  const queries =
    fast
      ? GEO_SEARCH_QUERIES
          .slice(0, 2)
      : GEO_SEARCH_QUERIES;

  for (
    const query of queries
  ) {
    try {
      const result =
        await cloudflareWebSearch(
          env,
          query,
          fast
            ? 5
            : 7
        );

      articles.push(
        ...result.items
      );

      searches.push({
        query,

        status:
          "OK",

        provider:
          result.provider,

        resultCount:
          result.items.length
      });

    } catch (err) {
      errors.push(
        err?.message ||
        String(err)
      );

      searches.push({
        query,
        status:
          "UNAVAILABLE"
      });
    }
  }

  const unique =
    dedupeArticles(
      articles
    ).slice(
      0,
      fast
        ? 10
        : 18
    );

  const publisherCount =
    new Set(
      unique
        .map(
          x =>
            x.publisher
        )
        .filter(Boolean)
    ).size;

  if (
    unique.length < 3 ||
    publisherCount < 2
  ) {
    return {
      ok: false,

      status:
        "DATA_UNAVAILABLE",

      dataAvailable:
        false,

      live:
        false,

      cacheUsed:
        false,

      source:
        "CLOUDFLARE_WEB_SEARCH + WORKERS_AI",

      engine:
        "AI_GEOPOLITICAL_V4.8.1",

      risk:
        "UNKNOWN",

      score:
        null,

      riskScore:
        null,

      confidence:
        0,

      sourceCount:
        publisherCount,

      articleCount:
        unique.length,

      freshness:
        "UNKNOWN",

      marketRegime:
        "UNKNOWN",

      cryptoImpact:
        "UNKNOWN",

      zecImpact:
        "UNKNOWN",

      drivers: [],

      reasons: [
        "Insufficient independent live web-search evidence."
      ],

      headlines:
        unique.slice(
          0,
          10
        ),

      sources:
        searches,

      errors,

      elapsedMs:
        Date.now() -
        started,

      messageCN:
        "实时Web Search资料不足，地缘政治风险保持未知。"
    };
  }

  try {
    const ai =
      await aiAnalyzeGeopolitical(
        env,
        unique
      );

    const analysis =
      ai.analysis;

    return {
      ok:
        analysis.risk !==
        "UNKNOWN",

      status:
        analysis.risk ===
        "UNKNOWN"
          ? "INSUFFICIENT_CONFIDENCE"
          : errors.length
            ? "DEGRADED"
            : "OK",

      dataAvailable:
        true,

      live:
        true,

      cacheUsed:
        false,

      source:
        "CLOUDFLARE_WEB_SEARCH + WORKERS_AI",

      engine:
        "AI_GEOPOLITICAL_V4.8.1",

      model:
        AI_MODEL,

      risk:
        analysis.risk,

      score:
        analysis.score,

      riskScore:
        analysis.riskScore,

      confidence:
        analysis.confidence,

      marketRegime:
        analysis.marketRegime,

      cryptoImpact:
        analysis.cryptoImpact,

      zecImpact:
        analysis.zecImpact,

      drivers:
        analysis.drivers,

      reasons:
        analysis.drivers,

      sourceCount:
        ai.sourceCount,

      articleCount:
        ai.articleCount,

      publisherCount,

      freshness:
        "FRESH",

      updatedAt:
        new Date()
          .toISOString(),

      headlines:
        unique.slice(
          0,
          10
        ),

      sources:
        searches,

      errors,

      aiUsage:
        ai.usage,

      elapsedMs:
        Date.now() -
        started,

      messageCN:
        analysis.risk ===
          "HIGH"
          ? "AI结合实时Web Search判断地缘政治风险较高。"
          : analysis.risk ===
              "MEDIUM"
            ? "AI结合实时Web Search判断地缘政治风险需要关注。"
            : analysis.risk ===
                "LOW"
              ? "AI结合充分的实时Web Search资料暂未发现明显高风险升级。"
              : "实时资料存在，但证据或AI置信度不足，因此风险保持未知。",

      methodology:
        "Cloudflare Web Search provides live evidence; Workers AI classifies only supplied evidence. LOW requires independent-source coverage and minimum confidence. AI geopolitical intelligence never independently creates BUY or SELL signals."
    };

  } catch (err) {
    errors.push(
      `AI_ANALYSIS: ${
        err?.message ||
        String(err)
      }`
    );

    return {
      ok: false,

      status:
        "AI_ANALYSIS_FAILED",

      dataAvailable:
        false,

      live:
        false,

      cacheUsed:
        false,

      source:
        "CLOUDFLARE_WEB_SEARCH + WORKERS_AI",

      engine:
        "AI_GEOPOLITICAL_V4.8.1",

      risk:
        "UNKNOWN",

      score:
        null,

      riskScore:
        null,

      confidence:
        0,

      sourceCount:
        publisherCount,

      articleCount:
        unique.length,

      freshness:
        "UNKNOWN",

      marketRegime:
        "UNKNOWN",

      cryptoImpact:
        "UNKNOWN",

      zecImpact:
        "UNKNOWN",

      drivers: [],

      reasons: [
        "AI analysis failed; no live risk classification accepted."
      ],

      headlines:
        unique.slice(
          0,
          10
        ),

      sources:
        searches,

      errors,

      elapsedMs:
        Date.now() -
        started,

      messageCN:
        "Web Search取得资料，但AI结构化分析失败；风险保持未知。"
    };
  }
}

async function geopoliticalData(
  env,
  options = {}
) {
  const live =
    await liveAIGeopoliticalData(
      env,
      Boolean(
        options.fast
      )
    );

  if (
    live.dataAvailable &&
    live.risk !==
      "UNKNOWN" &&
    live.confidence >= 40
  ) {
    const stored =
      await saveGeoCache(
        env,
        live
      );

    return {
      ...live,

      kvCache:
        stored
          ? "UPDATED"
          : env.INTEL_KV
            ? "WRITE_FAILED"
            : "NOT_BOUND"
    };
  }

  const cached =
    await loadGeoCache(
      env
    );

  if (cached) {
    return {
      ...cached,

      liveAttemptStatus:
        live.status,

      liveAttemptRisk:
        live.risk,

      liveErrors:
        live.errors,

      fallbackReason:
        live.dataAvailable
          ? "LIVE_CONFIDENCE_INSUFFICIENT"
          : "LIVE_WEB_OR_AI_UNAVAILABLE"
    };
  }

  return {
    ...live,

    risk:
      "UNKNOWN",

    score:
      null,

    riskScore:
      null,

    confidence:
      live.dataAvailable
        ? Math.min(
            live.confidence ||
            0,
            39
          )
        : 0,

    kvCache:
      env.INTEL_KV
        ? "EMPTY_OR_EXPIRED"
        : "NOT_BOUND",

    messageCN:
      "实时Web Search/AI地缘政治分析不可用或置信度不足，并且没有可接受的可靠缓存，因此风险保持未知，不会被错误判断为低风险。",

    methodology:
      "No acceptable live AI geopolitical intelligence and no acceptable KV cache. Risk is UNKNOWN, never LOW."
  };
}

/* =========================================================
   DATA QUALITY
========================================================= */

function quality(
  market,
  macro,
  events,
  geo
) {
  let confidence = 0;

  const marketOK =
    Boolean(
      market.ZEC &&
      market.BTC &&
      market.ETH
    );

  if (marketOK) {
    confidence += 40;
  }

  if (macro?.ok) {
    confidence += 25;
  }

  if (events?.ok) {
    confidence += 20;
  }

  if (
    geo?.dataAvailable &&
    geo.risk !==
      "UNKNOWN"
  ) {
    const geoWeight =
      geo.cacheUsed
        ? 10
        : 15;

    confidence +=
      Math.round(
        geoWeight *
        (
          geo.confidence ||
          0
        ) /
        100
      );
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  const status =
    confidence < 60
      ? "DATA_INCOMPLETE"
      : confidence < 90
        ? "DEGRADED"
        : "OK";

  return {
    status,
    confidence,

    market:
      marketOK
        ? "OK"
        : "UNAVAILABLE",

    macro:
      macro?.status ||
      "UNAVAILABLE",

    events:
      events?.status ||
      "UNAVAILABLE",

    geopolitical:
      geo?.status ||
      "UNAVAILABLE",

    geopoliticalRisk:
      geo?.risk ||
      "UNKNOWN",

    geopoliticalConfidence:
      geo?.confidence ??
      0,

    geopoliticalCache:
      geo?.cacheUsed
        ? "KV_CACHE"
        : geo?.live
          ? "LIVE_AI_WEB"
          : "NONE",

    messageCN:
      status === "OK"
        ? "数据质量良好"
        : status ===
            "DEGRADED"
          ? "部分情报源置信度不足，决策置信度已自动降低"
          : "数据不足，只能进行谨慎观察",

    rule:
      "Unavailable or insufficient intelligence is never treated as LOW risk."
  };
}

/* =========================================================
   GLOBAL RISK FUSION
========================================================= */

function fusion(
  context,
  macro,
  events,
  geo,
  qualityData
) {
  let score = 0;

  const reasons = [];

  if (
    context.regime ===
    "RISK_OFF"
  ) {
    score += 2;

    reasons.push(
      "加密市场环境偏向风险规避"
    );
  }

  if (
    context.regime ===
    "RISK_ON"
  ) {
    score--;
  }

  if (
    macro?.regime ===
    "RISK_OFF"
  ) {
    score += 3;

    reasons.push(
      "宏观经济环境处于风险规避状态"
    );
  }

  if (
    macro?.regime ===
    "RISK_ON"
  ) {
    score--;
  }

  if (
    events?.risk ===
    "HIGH"
  ) {
    score += 3;

    reasons.push(
      "高影响经济事件临近"
    );

  } else if (
    events?.risk ===
    "MEDIUM"
  ) {
    score++;

    reasons.push(
      "近期存在需要关注的经济事件"
    );
  }

  if (
    geo?.risk ===
    "HIGH"
  ) {
    score += 2;

    reasons.push(
      geo.cacheUsed
        ? "最近可靠AI缓存显示较高地缘政治风险"
        : "实时AI地缘政治情报显示较高风险"
    );

  } else if (
    geo?.risk ===
    "MEDIUM"
  ) {
    score++;

    reasons.push(
      geo.cacheUsed
        ? "最近可靠AI缓存显示地缘政治风险需要关注"
        : "实时AI地缘政治风险需要关注"
    );

  } else if (
    geo?.risk ===
    "UNKNOWN"
  ) {
    reasons.push(
      "地缘政治风险未知，不采用低风险假设"
    );
  }

  score =
    clamp(
      score,
      0,
      10
    );

  const knownRiskLevel =
    score >= 7
      ? "HIGH"
      : score >= 4
        ? "MEDIUM"
        : "LOW";

  const risk =
    geo?.risk ===
      "UNKNOWN" &&
    knownRiskLevel ===
      "LOW"
      ? "UNCERTAIN"
      : knownRiskLevel;

  const posture =
    knownRiskLevel ===
      "HIGH"
      ? "DEFENSIVE"
      : knownRiskLevel ===
          "MEDIUM"
        ? "CAUTIOUS"
        : geo?.risk ===
            "UNKNOWN"
          ? "CAUTIOUS"
          : "NORMAL";

  const reliability =
    qualityData.confidence <
      60
      ? "LOW"
      : qualityData
            .confidence <
          90
        ? "MEDIUM"
        : "HIGH";

  let signalPermission =
    "NORMAL";

  if (
    qualityData.confidence <
    60
  ) {
    signalPermission =
      "CAUTION_ONLY";

  } else if (
    geo?.risk ===
      "UNKNOWN" ||
    geo?.cacheUsed
  ) {
    signalPermission =
      "REDUCED_CONFIDENCE";
  }

  return {
    risk,

    knownRiskLevel,

    geopoliticalRisk:
      geo?.risk ||
      "UNKNOWN",

    geopoliticalDataMode:
      geo?.cacheUsed
        ? "KV_CACHE"
        : geo?.live
          ? "LIVE_AI_WEB"
          : "UNKNOWN",

    geopoliticalMarketRegime:
      geo?.marketRegime ||
      "UNKNOWN",

    cryptoImpact:
      geo?.cryptoImpact ||
      "UNKNOWN",

    zecImpact:
      geo?.zecImpact ||
      "UNKNOWN",

    riskScore:
      score,

    posture,

    postureCN:
      posture ===
        "DEFENSIVE"
        ? "防御"
        : posture ===
            "CAUTIOUS"
          ? "谨慎"
          : "正常观察",

    decisionReliability:
      reliability,

    signalPermission,

    dataConfidence:
      qualityData.confidence,

    reasons,

    messageCN:
      risk ===
        "UNCERTAIN"
        ? "已知风险暂时较低，但部分关键情报不足，因此总体状态保持不确定"
        : risk ===
            "HIGH"
          ? "综合风险较高，应优先控制风险并等待更清晰确认"
          : risk ===
              "MEDIUM"
            ? "综合风险中等，建议保持谨慎并等待确认"
            : "综合风险暂时较低，但仍需结合市场确认"
  };
}

/* =========================================================
   DECISION CONTEXT
========================================================= */

function decisionContext(
  market,
  context,
  macro,
  events,
  geo,
  globalRisk
) {
  const zec =
    market.ZEC;

  if (!zec) {
    return {
      action:
        "DATA UNAVAILABLE",

      actionCN:
        "市场数据不足",

      trend:
        "UNKNOWN",

      setupScore: 0,

      entryQuality: 0,

      chaseRisk:
        "UNKNOWN",

      reasons: [
        "ZEC市场数据不可用"
      ]
    };
  }

  let bear = 0;
  let bull = 0;

  const reasons = [];

  if (
    zec.change24h != null
  ) {
    if (
      zec.change24h <= -4
    ) {
      bear += 3;

      reasons.push(
        "ZEC 24小时下跌动能较强"
      );

    } else if (
      zec.change24h < 0
    ) {
      bear++;

      reasons.push(
        "ZEC 24小时动能偏弱"
      );

    } else if (
      zec.change24h >= 4
    ) {
      bull += 3;

      reasons.push(
        "ZEC 24小时上涨动能较强"
      );

    } else if (
      zec.change24h > 0
    ) {
      bull++;
    }
  }

  if (
    context
      .relativeStrength ===
    "WEAK"
  ) {
    bear += 2;

    reasons.push(
      "ZEC表现弱于BTC和ETH"
    );
  }

  if (
    context
      .relativeStrength ===
    "STRONG"
  ) {
    bull += 2;

    reasons.push(
      "ZEC表现强于BTC和ETH"
    );
  }

  if (
    macro?.regime ===
    "RISK_OFF"
  ) {
    bear += 2;

    reasons.push(
      "宏观环境偏向风险规避"
    );
  }

  if (
    macro?.regime ===
    "RISK_ON"
  ) {
    bull++;
  }

  /*
    AI geopolitical intelligence
    can affect confidence/risk,
    but cannot independently
    create BUY/SELL.
  */

  if (
    geo?.marketRegime ===
    "RISK_OFF"
  ) {
    reasons.push(
      "AI地缘政治环境偏向风险规避"
    );
  }

  const trend =
    bear >= bull + 2
      ? "BEARISH"
      : bull >= bear + 2
        ? "BULLISH"
        : "NEUTRAL";

  let setup =
    clamp(
      35 +
      Math.abs(
        bear - bull
      ) * 9,
      0,
      100
    );

  if (
    trend === "NEUTRAL"
  ) {
    setup =
      Math.min(
        setup,
        45
      );
  }

  const move =
    Math.abs(
      zec.change24h ||
      0
    );

  const chaseRisk =
    move >= 7
      ? "HIGH"
      : move >= 4
        ? "MEDIUM"
        : "LOW";

  let entryQuality = 70;

  if (
    chaseRisk ===
    "MEDIUM"
  ) {
    entryQuality -= 20;
  }

  if (
    chaseRisk ===
    "HIGH"
  ) {
    entryQuality -= 40;
  }

  if (
    globalRisk
      .knownRiskLevel ===
    "HIGH"
  ) {
    entryQuality -= 20;
  }

  if (
    globalRisk
      .knownRiskLevel ===
    "MEDIUM"
  ) {
    entryQuality -= 10;
  }

  if (
    geo?.risk ===
    "UNKNOWN"
  ) {
    entryQuality -= 5;
  }

  if (
    geo?.cacheUsed
  ) {
    entryQuality -= 5;

    reasons.push(
      "地缘政治模块正在使用缓存数据，入场置信度已降低"
    );
  }

  if (
    events?.risk ===
    "HIGH"
  ) {
    entryQuality -= 10;
  }

  entryQuality =
    clamp(
      entryQuality,
      0,
      100
    );

  let action =
    "WAIT FOR CONFIRMATION";

  let actionCN =
    "等待确认";

  if (
    trend ===
      "BULLISH" &&
    setup >= 70 &&
    entryQuality >= 70 &&
    globalRisk
      .knownRiskLevel !==
      "HIGH" &&
    globalRisk
      .signalPermission ===
      "NORMAL"
  ) {
    action =
      "BULLISH SETUP";

    actionCN =
      "看涨条件正在形成";
  }

  if (
    trend ===
      "BEARISH" &&
    setup >= 70 &&
    entryQuality >= 70 &&
    globalRisk
      .knownRiskLevel !==
      "HIGH" &&
    globalRisk
      .signalPermission ===
      "NORMAL"
  ) {
    action =
      "BEARISH SETUP";

    actionCN =
      "看跌条件正在形成";
  }

  if (
    chaseRisk ===
    "HIGH"
  ) {
    action =
      "WAIT FOR CONFIRMATION";

    actionCN =
      "避免追涨杀跌，等待确认";
  }

  if (
    globalRisk
      .signalPermission ===
    "CAUTION_ONLY"
  ) {
    action =
      "WAIT FOR CONFIRMATION";

    actionCN =
      "数据不足，等待更多确认";
  }

  if (
    globalRisk
      .signalPermission ===
      "REDUCED_CONFIDENCE" &&
    (
      action ===
        "BULLISH SETUP" ||
      action ===
        "BEARISH SETUP"
    )
  ) {
    action =
      "WAIT FOR CONFIRMATION";

    actionCN =
      "部分情报仍不确定，等待确认";
  }

  return {
    action,
    actionCN,
    trend,

    setupScore:
      Math.round(
        setup
      ),

    entryQuality:
      Math.round(
        entryQuality
      ),

    chaseRisk,

    reasons,

    forcedBuySell:
      false,

    methodologyCN:
      "趋势与入场行动分开判断；AI地缘政治情报只影响风险和置信度，不会独立强制产生BUY或SELL。"
  };
}

/* =========================================================
   FALLBACKS
========================================================= */

const marketFallback = {
  market: {
    ZEC: null,
    BTC: null,
    ETH: null
  },

  context: {
    regime:
      "UNKNOWN",

    score: 0,

    relativeStrength:
      "UNKNOWN"
  }
};

const macroFallback = {
  ok: false,

  status:
    "TIME_BUDGET_EXCEEDED",

  risk:
    "UNKNOWN",

  regime:
    "UNKNOWN",

  messageCN:
    "综合分析时间预算内未完成宏观数据读取，风险保持未知。"
};

const eventsFallback = {
  ok: false,

  status:
    "TIME_BUDGET_EXCEEDED",

  risk:
    "UNKNOWN",

  score:
    null,

  events: [],

  messageCN:
    "综合分析时间预算内未完成事件数据读取，风险保持未知。"
};

const geoFallback = {
  ok: false,

  status:
    "TIME_BUDGET_EXCEEDED",

  dataAvailable:
    false,

  live:
    false,

  cacheUsed:
    false,

  source:
    "CLOUDFLARE_WEB_SEARCH + WORKERS_AI",

  engine:
    "AI_GEOPOLITICAL_V4.8.1",

  risk:
    "UNKNOWN",

  score:
    null,

  riskScore:
    null,

  confidence: 0,

  sourceCount: 0,

  articleCount: 0,

  freshness:
    "UNKNOWN",

  marketRegime:
    "UNKNOWN",

  cryptoImpact:
    "UNKNOWN",

  zecImpact:
    "UNKNOWN",

  drivers: [],

  reasons: [
    "AI geopolitical intelligence exceeded the intelligence time budget."
  ],

  headlines: [],

  sources: [],

  errors: [
    "TIME_BUDGET_EXCEEDED"
  ],

  messageCN:
    "AI地缘政治情报超过综合分析时间预算，因此风险保持未知。"
};

/* =========================================================
   INTELLIGENCE
========================================================= */

async function intelligence(
  env
) {
  const started =
    Date.now();

  const tasks = [
    Promise.race([
      marketData(),

      timeoutValue(
        7000,
        marketFallback
      )
    ]),

    Promise.race([
      macroData(
        env,
        true
      ),

      timeoutValue(
        9000,
        macroFallback
      )
    ]),

    Promise.race([
      eventData(
        env,
        true
      ),

      timeoutValue(
        9000,
        eventsFallback
      )
    ]),

    Promise.race([
      geopoliticalData(
        env,
        {
          fast: true
        }
      ),

      timeoutValue(
        9000,
        geoFallback
      )
    ])
  ];

  const [
    marketResult,
    macro,
    events,
    geo
  ] =
    await Promise.all(
      tasks
    );

  const dataQuality =
    quality(
      marketResult.market,
      macro,
      events,
      geo
    );

  const globalRisk =
    fusion(
      marketResult.context,
      macro,
      events,
      geo,
      dataQuality
    );

  const decision =
    decisionContext(
      marketResult.market,
      marketResult.context,
      macro,
      events,
      geo,
      globalRisk
    );

  return {
    ok:
      Boolean(
        marketResult
          .market
          .ZEC
      ),

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    mission:
      "V4.8.1 AI Geopolitical Intelligence + Web Search + Persistent KV",

    language:
      "zh-CN",

    timestamp:
      new Date()
        .toISOString(),

    elapsedMs:
      Date.now() -
      started,

    intelligenceTimeBudgetSeconds:
      10,

    market:
      marketResult.market,

    marketContext:
      marketResult.context,

    decision,

    macro,

    events,

    geopolitical:
      geo,

    dataQuality,

    globalRisk,

    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。",

    disclaimer:
      "Market research and simulation only. Not investment advice."
  };
}

/* =========================================================
   WORKERS AI TEST
========================================================= */

async function aiTest(env) {
  const started =
    Date.now();

  if (!env.AI) {
    return {
      ok: false,

      version:
        VERSION,

      test:
        "WORKERS_AI",

      binding:
        "AI",

      status:
        "NOT_BOUND",

      model:
        AI_MODEL,

      elapsedMs:
        Date.now() -
        started,

      messageCN:
        "Workers AI Binding 尚未连接。"
    };
  }

  try {
    const result =
      await env.AI.run(
        AI_MODEL,
        {
          messages: [
            {
              role:
                "system",

              content:
                "You are a connectivity test for ZEC AI Intelligence. Follow the user's instruction exactly. Do not provide financial advice."
            },
            {
              role:
                "user",

              content:
                "Return exactly this text and nothing else: ZEC_AI_WORKERS_AI_OK"
            }
          ],

          max_tokens:
            32,

          temperature:
            0
        }
      );

    const response =
      typeof result
        ?.response ===
        "string"
        ? result
            .response
            .trim()
        : "";

    const passed =
      response.includes(
        "ZEC_AI_WORKERS_AI_OK"
      );

    return {
      ok:
        passed,

      version:
        VERSION,

      test:
        "WORKERS_AI",

      binding:
        "AI",

      status:
        passed
          ? "OK"
          : "UNEXPECTED_RESPONSE",

      model:
        AI_MODEL,

      elapsedMs:
        Date.now() -
        started,

      response,

      usage:
        result?.usage ||
        null,

      messageCN:
        passed
          ? "Workers AI 调用成功。"
          : "Workers AI 已响应，但测试文字与预期不完全一致。"
    };

  } catch (err) {
    return {
      ok: false,

      version:
        VERSION,

      test:
        "WORKERS_AI",

      binding:
        "AI",

      status:
        "ERROR",

      model:
        AI_MODEL,

      elapsedMs:
        Date.now() -
        started,

      error:
        err?.message ||
        String(err),

      messageCN:
        "Workers AI 调用失败。"
    };
  }
}

/* =========================================================
   STATUS
========================================================= */

function status(env) {
  return {
    ok: true,

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    mission:
      "V4.8.1 AI Geopolitical Intelligence + Web Search + Persistent KV",

    status:
      "ONLINE",

    language:
      "zh-CN",

    architecture:
      "Cloudflare Worker + Web Search API + Workers AI + KV Risk Fusion",

    modules: {
      coinLoreMarket:
        "ACTIVE",

      binanceFallback:
        "ACTIVE",

      btcContext:
        "ACTIVE",

      ethContext:
        "ACTIVE",

      fredMacro:
        env.FRED_API_KEY
          ? "ACTIVE"
          : "NOT CONFIGURED",

      economicEventRadar:
        env.FRED_API_KEY
          ? "ACTIVE · DEDUPED"
          : "NOT CONFIGURED",

      fomcCalendar:
        "ACTIVE · OFFICIAL 2026 CALENDAR",

      cloudflareWebSearch:
        env.AI
          ? "READY · TEST REQUIRED"
          : "NOT BOUND",

      aiGeopoliticalEngine:
        env.AI
          ? "ACTIVE"
          : "NOT BOUND",

      persistentIntelligenceCache:
        env.INTEL_KV
          ? "ACTIVE · KV"
          : "NOT BOUND",

      timeDecayCacheFallback:
        env.INTEL_KV
          ? "ACTIVE"
          : "NOT BOUND",

      workersAI:
        env.AI
          ? "ACTIVE"
          : "NOT BOUND",

      dataQualityEngine:
        "ACTIVE",

      globalRiskFusion:
        "ACTIVE · UNCERTAIN PROTECTION",

      chineseIntelligence:
        "ACTIVE",

      decisionContext:
        "ACTIVE",

      intelligenceDeadline:
        "ACTIVE"
    },

    policies: {
      geopoliticalArchitecture:
        "WEB_SEARCH_TO_WORKERS_AI_TO_KV",

      webSearchGateway:
        "default",

      webSearchProvider:
        "ceramic",

      geopoliticalCache:
        "CLOUDFLARE_KV_AI_LAST_RELIABLE_V2",

      geopoliticalCacheMaxAgeHours:
        6,

      geopoliticalFreshMinutes:
        60,

      geopoliticalAgingHours:
        3,

      geopoliticalLowRequiresConfidence:
        true,

      geopoliticalFailure:
        "KV_CACHE_THEN_UNKNOWN",

      unavailableRisk:
        "UNKNOWN",

      unavailableIsLow:
        false,

      unknownGlobalRiskProtection:
        "UNCERTAIN",

      aiUsesOnlySuppliedLiveEvidence:
        true,

      aiCanForceBuySell:
        false,

      forcedBuySell:
        false
    },

    fredSecretConfigured:
      Boolean(
        env.FRED_API_KEY
      ),

    intelKVConfigured:
      Boolean(
        env.INTEL_KV
      ),

    workersAIConfigured:
      Boolean(
        env.AI
      ),

    webSearchMethodAvailable:
      Boolean(
        env.AI &&
        typeof
          env.AI.websearch ===
          "function"
      ),

    messageCN:
      "ZEC AI Intelligence V4.8.1运行正常",

    timestamp:
      new Date()
        .toISOString(),

    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。"
  };
}

/* =========================================================
   KV TEST
========================================================= */

async function kvTest(env) {
  if (!env.INTEL_KV) {
    return {
      ok: false,

      version:
        VERSION,

      binding:
        "INTEL_KV",

      status:
        "NOT_BOUND",

      messageCN:
        "INTEL_KV尚未绑定。"
    };
  }

  const key =
    "system:kv-test";

  const payload = {
    version:
      VERSION,

    timestamp:
      new Date()
        .toISOString(),

    test:
      "KV_READ_WRITE"
  };

  try {
    await env.INTEL_KV.put(
      key,
      JSON.stringify(
        payload
      ),
      {
        expirationTtl:
          3600
      }
    );

    const raw =
      await env.INTEL_KV.get(
        key
      );

    const result =
      raw
        ? JSON.parse(raw)
        : null;

    return {
      ok:
        Boolean(result),

      version:
        VERSION,

      binding:
        "INTEL_KV",

      status:
        result
          ? "OK"
          : "READ_FAILED",

      write:
        "OK",

      read:
        result
          ? "OK"
          : "FAILED",

      result,

      messageCN:
        result
          ? "KV读写测试成功。"
          : "KV写入后无法读取。"
    };

  } catch (err) {
    return {
      ok: false,

      version:
        VERSION,

      binding:
        "INTEL_KV",

      status:
        "ERROR",

      error:
        err?.message ||
        String(err),

      messageCN:
        "KV测试失败。"
    };
  }
}

/* =========================================================
   ROUTER
========================================================= */

export default {
  async fetch(
    request,
    env
  ) {
    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            HEADERS
        }
      );
    }

    const url =
      new URL(
        request.url
      );

    try {
      if (
        url.pathname ===
          "/" ||
        url.pathname ===
          "/status"
      ) {
        return reply(
          status(env)
        );
      }

      if (
        url.pathname ===
        "/market"
      ) {
        const result =
          await marketData();

        return reply({
          ok: true,

          version:
            VERSION,

          timestamp:
            new Date()
              .toISOString(),

          ...result
        });
      }

      if (
        url.pathname ===
        "/macro"
      ) {
        return reply(
          await macroData(
            env
          )
        );
      }

      if (
        url.pathname ===
        "/events"
      ) {
        return reply(
          await eventData(
            env
          )
        );
      }

      if (
        url.pathname ===
        "/geopolitical"
      ) {
        return reply(
          await geopoliticalData(
            env,
            {
              fast: false
            }
          )
        );
      }

      if (
        url.pathname ===
        "/intelligence"
      ) {
        return reply(
          await intelligence(
            env
          )
        );
      }

      if (
        url.pathname ===
        "/ai-test"
      ) {
        const result =
          await aiTest(env);

        return reply(
          result,
          result.ok
            ? 200
            : 502
        );
      }

      if (
        url.pathname ===
        "/websearch-test"
      ) {
        const result =
          await webSearchTest(
            env
          );

        return reply(
          result,
          result.ok
            ? 200
            : 502
        );
      }

      if (
        url.pathname ===
        "/kv-test"
      ) {
        return reply(
          await kvTest(
            env
          )
        );
      }

      if (
        url.pathname ===
        "/fred-test"
      ) {
        if (
          !env.FRED_API_KEY
        ) {
          return reply(
            {
              ok: false,

              version:
                VERSION,

              test:
                "FRED_SINGLE_SERIES",

              error:
                "FRED_API_KEY_NOT_CONFIGURED"
            },
            500
          );
        }

        const started =
          Date.now();

        try {
          const result =
            await fredSeries(
              "DGS10",
              env.FRED_API_KEY
            );

          return reply({
            ok: true,

            version:
              VERSION,

            test:
              "FRED_SINGLE_SERIES",

            elapsedMs:
              Date.now() -
              started,

            result
          });

        } catch (err) {
          return reply(
            {
              ok: false,

              version:
                VERSION,

              test:
                "FRED_SINGLE_SERIES",

              elapsedMs:
                Date.now() -
                started,

              error:
                err?.message ||
                String(err)
            },
            502
          );
        }
      }

      return reply(
        {
          ok: false,

          version:
            VERSION,

          error:
            "Route not found",

          messageCN:
            "找不到此接口",

          availableRoutes: [
            "/",
            "/status",
            "/market",
            "/macro",
            "/events",
            "/geopolitical",
            "/intelligence",
            "/ai-test",
            "/websearch-test",
            "/kv-test",
            "/fred-test"
          ]
        },
        404
      );

    } catch (err) {
      return reply(
        {
          ok: false,

          version:
            VERSION,

          timestamp:
            new Date()
              .toISOString(),

          error:
            err?.message ||
            String(err),

          messageCN:
            "系统发生异常，但安全机制已经阻止错误数据被当作正常信号。"
        },
        500
      );
    }
  }
};
