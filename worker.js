/* =========================================================
   ZEC AI INTELLIGENCE WORKER V4.9.0

   MARKET INTELLIGENCE + TECHNICAL ANALYSIS
   AI GEOPOLITICAL INTELLIGENCE
   GLOBAL RISK FUSION
   BUY / SELL / WAIT SIMULATION
   STOP LOSS / TAKE PROFIT
   PERSISTENT KV CACHE

   Research and Simulation Only
   No Automatic Broker Trading
========================================================= */

const VERSION = "4.9.0";

const AI_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const IDS = {
  ZEC: "134",
  BTC: "90",
  ETH: "80"
};

const FRED = {
  DGS10: "US Treasury 10Y",
  DFF: "Federal Funds Rate",
  DTWEXBGS: "US Dollar Index",
  VIXCLS: "VIX",
  CPIAUCSL: "US CPI",
  UNRATE: "US Unemployment"
};

const RELEASES = [
  {
    id: 10,
    name: "CPI",
    nameCN: "美国消费者价格指数"
  },
  {
    id: 50,
    name: "Employment Situation",
    nameCN: "美国就业报告"
  },
  {
    id: 53,
    name: "GDP",
    nameCN: "美国GDP"
  }
];

const FOMC_2026 = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09"
];

const GEO_KEY =
  "geo:ai:last_reliable:v2";

const GEO_MAX_AGE =
  6 * 60 * 60 * 1000;

const TIMEFRAMES = {
  "15m": 900000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000
};

/* =========================================================
   GENERAL UTILITIES
========================================================= */

function now() {
  return new Date().toISOString();
}

function number(v) {
  if (
    v === null ||
    v === undefined ||
    v === ""
  ) {
    return null;
  }

  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function clamp(v, min, max) {
  return Math.max(
    min,
    Math.min(max, v)
  );
}

function errorText(err) {
  return err?.message || String(err);
}

function response(data, status = 200, env = {}) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type":
          "application/json;charset=UTF-8",

        "Cache-Control":
          "no-store",

        "Access-Control-Allow-Origin":
          env.ALLOWED_ORIGIN || "*",

        "Access-Control-Allow-Methods":
          "GET,OPTIONS",

        "Access-Control-Allow-Headers":
          "Content-Type"
      }
    }
  );
}

async function getJSON(
  url,
  timeout = 7000,
  headers = {}
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...headers
      }
    });

    if (!res.ok) {
      throw new Error(
        "HTTP_" + res.status
      );
    }

    return await res.json();

  } finally {
    clearTimeout(timer);
  }
}

function dateOnly() {
  return now().slice(0, 10);
}

function daysAway(date) {
  return Math.round(
    (
      Date.parse(date + "T00:00:00Z") -
      Date.parse(dateOnly() + "T00:00:00Z")
    ) / 86400000
  );
}

/* =========================================================
   CLOUDFLARE KV
========================================================= */

async function kvGet(env, key) {
  if (!env.INTEL_KV) {
    return null;
  }

  try {
    const raw =
      await env.INTEL_KV.get(key);

    return raw
      ? JSON.parse(raw)
      : null;

  } catch (_) {
    return null;
  }
}

async function kvPut(env, key, data) {
  if (!env.INTEL_KV) {
    return false;
  }

  try {
    await env.INTEL_KV.put(
      key,
      JSON.stringify(data),
      {
        expirationTtl: 86400
      }
    );

    return true;

  } catch (_) {
    return false;
  }
}

/* =========================================================
   COINLORE MARKET ENGINE
========================================================= */

async function coinLore(symbol) {
  const id = IDS[symbol];

  if (!id) {
    throw new Error(
      "UNKNOWN_SYMBOL"
    );
  }

  const data = await getJSON(
    "https://api.coinlore.net/api/ticker/?id=" + id,
    6000
  );

  if (
    !Array.isArray(data) ||
    !data[0]
  ) {
    throw new Error(
      "INVALID_COINLORE_RESPONSE"
    );
  }

  const x = data[0];

  const price = number(x.price_usd);

  if (
    price === null ||
    price <= 0
  ) {
    throw new Error(
      "INVALID_MARKET_PRICE"
    );
  }

  return {
    symbol,
    price,

    change1h:
      number(x.percent_change_1h),

    change24h:
      number(x.percent_change_24h),

    change7d:
      number(x.percent_change_7d),

    volume24h:
      number(x.volume24),

    marketCap:
      number(x.market_cap_usd),

    source: "CoinLore",

    priceType:
      "INDICATIVE_AGGREGATE",

    fetchedAt: now(),

    priceTimestampVerified: false
  };
}

function marketContext(market) {
  const btc = market.BTC;
  const eth = market.ETH;
  const zec = market.ZEC;

  let score = 0;

  for (const asset of [btc, eth]) {
    if (
      asset?.change24h === null ||
      asset?.change24h === undefined
    ) {
      continue;
    }

    const change = asset.change24h;

    if (change > 0) score++;
    if (change >= 2) score++;
    if (change < 0) score--;
    if (change <= -2) score--;
  }

  const regime =
    score >= 3
      ? "RISK_ON"
      : score <= -3
        ? "RISK_OFF"
        : "NEUTRAL";

  let relativeStrength = "UNKNOWN";

  if (
    zec?.change24h != null &&
    btc?.change24h != null &&
    eth?.change24h != null
  ) {
    const relative =
      zec.change24h -
      (
        btc.change24h +
        eth.change24h
      ) / 2;

    relativeStrength =
      relative >= 2
        ? "STRONG"
        : relative <= -2
          ? "WEAK"
          : "NEUTRAL";
  }

  return {
    regime,
    score,
    relativeStrength
  };
}

async function marketData() {
  const symbols = [
    "ZEC",
    "BTC",
    "ETH"
  ];

  const results =
    await Promise.allSettled(
      symbols.map(coinLore)
    );

  const market = {};

  results.forEach((result, i) => {
    market[symbols[i]] =
      result.status === "fulfilled"
        ? result.value
        : null;
  });

  return {
    market,
    context: marketContext(market)
  };
}

/* =========================================================
   FRED MACRO ENGINE
========================================================= */

async function fredSeries(id, key) {
  const params = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: "json",
    sort_order: "desc",
    limit: "5"
  });

  const data = await getJSON(
    "https://api.stlouisfed.org/fred/series/observations?" +
    params,
    6000
  );

  const observations =
    (data.observations || [])
      .filter(
        x => number(x.value) !== null
      );

  if (!observations.length) {
    throw new Error(
      "NO_FRED_OBSERVATIONS"
    );
  }

  const current =
    number(observations[0].value);

  const previous =
    observations[1]
      ? number(observations[1].value)
      : null;

  return {
    seriesId: id,
    name: FRED[id],
    value: current,
    previousValue: previous,

    change:
      previous === null
        ? null
        : current - previous,

    date: observations[0].date,
    source: "FRED"
  };
}

async function macroData(env) {
  if (!env.FRED_API_KEY) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      risk: "UNKNOWN",
      regime: "UNKNOWN"
    };
  }

  const ids = Object.keys(FRED);

  const results =
    await Promise.allSettled(
      ids.map(
        id => fredSeries(
          id,
          env.FRED_API_KEY
        )
      )
    );

  const indicators = {};
  const errors = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      indicators[ids[i]] = result.value;
    } else {
      errors.push(
        ids[i] + ": " +
        errorText(result.reason)
      );
    }
  });

  const count =
    Object.keys(indicators).length;

  if (!count) {
    return {
      ok: false,
      status: "DATA_UNAVAILABLE",
      risk: "UNKNOWN",
      regime: "UNKNOWN",
      indicators,
      errors
    };
  }

  let score = 0;
  const reasons = [];

  if (
    indicators.DTWEXBGS?.change > 0
  ) {
    score++;
    reasons.push("美元走强");
  }

  if (
    indicators.DTWEXBGS?.change < 0
  ) {
    score--;
  }

  if (
    indicators.VIXCLS?.value >= 30
  ) {
    score += 3;
    reasons.push("VIX风险显著升高");

  } else if (
    indicators.VIXCLS?.value >= 20
  ) {
    score += 2;
  }

  if (
    indicators.DGS10?.change >= 0.08
  ) {
    score += 2;
    reasons.push("美国国债收益率上升");
  }

  if (
    indicators.CPIAUCSL?.change > 0
  ) {
    score++;
  }

  return {
    ok: true,

    status:
      count === ids.length
        ? "OK"
        : "DEGRADED",

    risk:
      score >= 3
        ? "HIGH"
        : score <= -2
          ? "LOW"
          : "MEDIUM",

    regime:
      score >= 3
        ? "RISK_OFF"
        : score <= -2
          ? "RISK_ON"
          : "NEUTRAL",

    riskScore: score,
    indicators,
    reasons,
    errors,
    source: "FRED"
  };
}

/* =========================================================
   ECONOMIC EVENT RADAR
========================================================= */

async function releaseDates(release, key) {
  const end = new Date(
    Date.now() + 45 * 86400000
  ).toISOString().slice(0, 10);

  const params = new URLSearchParams({
    release_id: String(release.id),
    api_key: key,
    file_type: "json",
    realtime_start: dateOnly(),
    realtime_end: end,
    include_release_dates_with_no_data:
      "true",
    sort_order: "asc",
    limit: "20"
  });

  const data = await getJSON(
    "https://api.stlouisfed.org/fred/release/dates?" +
    params,
    6000
  );

  return (data.release_dates || [])
    .filter(x => x.date >= dateOnly())
    .map(x => ({
      name: release.name,
      nameCN: release.nameCN,
      family: "FRED-" + release.id,
      date: x.date,
      daysAway: daysAway(x.date),
      impact: "HIGH",
      source: "FRED"
    }));
}

async function eventData(env) {
  const events = [];
  const errors = [];

  if (env.FRED_API_KEY) {
    const results =
      await Promise.allSettled(
        RELEASES.map(
          x => releaseDates(
            x,
            env.FRED_API_KEY
          )
        )
      );

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const nearest =
          result.value.sort(
            (a, b) =>
              a.date.localeCompare(b.date)
          )[0];

        if (nearest) {
          events.push(nearest);
        }

      } else {
        errors.push(
          RELEASES[i].name + ": " +
          errorText(result.reason)
        );
      }
    });
  }

  for (const date of FOMC_2026) {
    if (date >= dateOnly()) {
      events.push({
        name: "FOMC Meeting",
        nameCN: "美联储利率决议",
        family: "FOMC-" + date,
        date,
        daysAway: daysAway(date),
        impact: "HIGH",
        source:
          "Static Federal Reserve 2026 Calendar"
      });
    }
  }

  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date)
  );

  let score = 0;

  for (const event of events) {
    if (event.daysAway <= 1) {
      score += 3;
    } else if (event.daysAway <= 3) {
      score += 2;
    } else if (event.daysAway <= 7) {
      score++;
    }
  }

  score = clamp(score, 0, 6);

  const verified =
    Boolean(env.FRED_API_KEY) &&
    errors.length === 0;

  return {
    ok: verified,

    status:
      verified
        ? "OK"
        : "DEGRADED",

    risk:
      score >= 4
        ? "HIGH"
        : score >= 2
          ? "MEDIUM"
          : "LOW",

    score,
    nextEvent: events[0] || null,
    events,
    errors,

    methodology:
      "Nearest event per release family; static FOMC calendar."
  };
}

/* =========================================================
   GEOPOLITICAL INTELLIGENCE
========================================================= */

const GEO_QUERIES = [
  "latest geopolitical conflicts sanctions oil shipping global financial markets",

  "latest US China trade tariffs global economic risks",

  "latest cryptocurrency regulation Bitcoin Zcash market policy"
];

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function webSearch(env, query, limit = 5) {
  if (
    !env.AI ||
    typeof env.AI.websearch !== "function"
  ) {
    throw new Error(
      "WEB_SEARCH_UNAVAILABLE"
    );
  }

  const result = await env.AI.websearch({
    gatewayId: "default",
    query,
    provider: "ceramic",
    limit
  });

  const data = await result.json();

  if (!result.ok) {
    throw new Error(
      "WEB_SEARCH_FAILED"
    );
  }

  return (data.items || [])
    .filter(x => x.url)
    .map(x => ({
      title: cleanText(x.title),
      description:
        cleanText(x.description),
      url: x.url,

      publisher:
        new URL(x.url).hostname,

      published:
        x.lastModified ||
        x.last_modified ||
        null
    }));
}

function extractAIJSON(text) {
  const raw = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");

  if (first < 0 || last <= first) {
    throw new Error(
      "AI_JSON_INVALID"
    );
  }

  return JSON.parse(
    raw.slice(first, last + 1)
  );
}

async function liveGeo(env) {
  if (!env.AI) {
    throw new Error(
      "AI_NOT_BOUND"
    );
  }

  const results =
    await Promise.allSettled(
      GEO_QUERIES.map(
        q => webSearch(env, q, 6)
      )
    );

  const map = new Map();

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const item of result.value) {
      map.set(item.url, item);
    }
  }

  const articles =
    [...map.values()].slice(0, 18);

  const sourceCount =
    new Set(
      articles.map(x => x.publisher)
    ).size;

  if (
    articles.length < 3 ||
    sourceCount < 2
  ) {
    throw new Error(
      "INSUFFICIENT_GEO_EVIDENCE"
    );
  }

  const prompt = [
    "Analyze geopolitical risk using ONLY supplied evidence.",
    "Do not invent current events.",
    "Do not provide trading instructions.",
    "Return strict JSON:",
    '{"risk":"HIGH|MEDIUM|LOW|UNKNOWN","confidence":0,"marketRegime":"RISK_OFF|NEUTRAL|RISK_ON|UNKNOWN","drivers":["..."]}',
    JSON.stringify(articles)
  ].join("\n");

  const result = await env.AI.run(
    AI_MODEL,
    {
      messages: [
        {
          role: "system",
          content:
            "Evidence-grounded geopolitical risk classification. JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 700,
      temperature: 0.1
    }
  );

  const parsed =
    extractAIJSON(result.response);

  const allowed = [
    "HIGH",
    "MEDIUM",
    "LOW",
    "UNKNOWN"
  ];

  let risk =
    allowed.includes(parsed.risk)
      ? parsed.risk
      : "UNKNOWN";

  let confidence =
    clamp(
      number(parsed.confidence) ?? 0,
      0,
      100
    );

  if (
    confidence < 40 ||
    (
      risk === "LOW" &&
      (
        articles.length < 5 ||
        sourceCount < 3 ||
        confidence < 60
      )
    )
  ) {
    risk = "UNKNOWN";
  }

  return {
    ok: risk !== "UNKNOWN",
    dataAvailable: true,
    live: true,
    cacheUsed: false,
    status:
      risk === "UNKNOWN"
        ? "INSUFFICIENT_CONFIDENCE"
        : "OK",

    risk,
    confidence,

    marketRegime:
      parsed.marketRegime || "UNKNOWN",

    drivers:
      Array.isArray(parsed.drivers)
        ? parsed.drivers.slice(0, 8)
        : [],

    sourceCount,
    articleCount: articles.length,
    headlines: articles.slice(0, 10),
    updatedAt: now(),

    source:
      "Cloudflare Web Search + Workers AI"
  };
}

async function geopoliticalData(env) {
  try {
    const geo = await liveGeo(env);

    if (
      geo.ok &&
      geo.confidence >= 40
    ) {
      await kvPut(env, GEO_KEY, {
        savedAt: now(),
        data: geo
      });

      return geo;
    }

    throw new Error(
      "GEO_CONFIDENCE_INSUFFICIENT"
    );

  } catch (err) {
    const cached =
      await kvGet(env, GEO_KEY);

    if (cached?.savedAt && cached?.data) {
      const age =
        Date.now() -
        Date.parse(cached.savedAt);

      if (
        age >= 0 &&
        age <= GEO_MAX_AGE
      ) {
        const factor =
          age <= 3600000
            ? 0.9
            : age <= 10800000
              ? 0.72
              : 0.55;

        return {
          ...cached.data,

          live: false,
          cacheUsed: true,
          status: "KV_CACHE",

          confidence:
            Math.round(
              cached.data.confidence *
              factor
            ),

          cachedAt: cached.savedAt,

          cacheAgeMinutes:
            Math.round(age / 60000),

          fallbackReason:
            errorText(err)
        };
      }
    }

    return {
      ok: false,
      dataAvailable: false,
      live: false,
      cacheUsed: false,
      status: "UNAVAILABLE",
      risk: "UNKNOWN",
      confidence: 0,
      marketRegime: "UNKNOWN",
      drivers: [],
      error: errorText(err)
    };
  }
}

/* =========================================================
   DATA QUALITY
========================================================= */

function dataQuality(
  market,
  macro,
  events,
  geo
) {
  let score = 0;

  const marketOK =
    Boolean(
      market.ZEC &&
      market.BTC &&
      market.ETH
    );

  if (marketOK) score += 40;
  if (macro.ok) score += 25;
  if (events.ok) score += 20;

  if (
    geo.dataAvailable &&
    geo.risk !== "UNKNOWN"
  ) {
    const weight =
      geo.cacheUsed ? 10 : 15;

    score += Math.round(
      weight *
      geo.confidence / 100
    );
  }

  return {
    status:
      score >= 90
        ? "OK"
        : score >= 60
          ? "DEGRADED"
          : "DATA_INCOMPLETE",

    confidence: score,

    market:
      marketOK
        ? "OK"
        : "UNAVAILABLE",

    macro: macro.status,
    events: events.status,
    geopolitical: geo.status,

    rule:
      "Unknown intelligence is never assumed to be low risk."
  };
}

/* =========================================================
   GLOBAL RISK FUSION
========================================================= */

function globalRiskFusion(
  context,
  macro,
  events,
  geo,
  quality
) {
  let score = 0;
  const reasons = [];

  if (context.regime === "RISK_OFF") {
    score += 2;
    reasons.push("加密市场风险偏好下降");
  }

  if (context.regime === "RISK_ON") {
    score--;
  }

  if (macro.regime === "RISK_OFF") {
    score += 3;
    reasons.push("宏观环境风险较高");
  }

  if (macro.regime === "RISK_ON") {
    score--;
  }

  if (events.risk === "HIGH") {
    score += 3;
    reasons.push("高影响经济事件临近");
  } else if (events.risk === "MEDIUM") {
    score++;
  }

  if (geo.risk === "HIGH") {
    score += 2;
    reasons.push("地缘政治风险较高");
  } else if (geo.risk === "MEDIUM") {
    score++;
  }

  score = clamp(score, 0, 10);

  const knownRiskLevel =
    score >= 7
      ? "HIGH"
      : score >= 4
        ? "MEDIUM"
        : "LOW";

  const risk =
    geo.risk === "UNKNOWN" &&
    knownRiskLevel === "LOW"
      ? "UNCERTAIN"
      : knownRiskLevel;

  let signalPermission = "NORMAL";

  if (quality.confidence < 60) {
    signalPermission = "CAUTION_ONLY";
  } else if (
    geo.risk === "UNKNOWN" ||
    geo.cacheUsed
  ) {
    signalPermission =
      "REDUCED_CONFIDENCE";
  }

  return {
    risk,
    knownRiskLevel,
    riskScore: score,
    signalPermission,

    posture:
      knownRiskLevel === "HIGH"
        ? "DEFENSIVE"
        : knownRiskLevel === "MEDIUM"
          ? "CAUTIOUS"
          : "NORMAL",

    geopoliticalRisk: geo.risk,
    dataConfidence: quality.confidence,
    reasons
  };
}

/* =========================================================
   AI MARKET DECISION ENGINE
========================================================= */

function decisionContext(
  market,
  context,
  macro,
  events,
  geo,
  globalRisk
) {
  const zec = market.ZEC;

  if (!zec) {
    return {
      action: "DATA UNAVAILABLE",
      actionCN: "市场数据不可用",
      trend: "UNKNOWN",
      setupScore: 0,
      entryQuality: 0,
      chaseRisk: "UNKNOWN",
      reasons: []
    };
  }

  let bear = 0;
  let bull = 0;

  const reasons = [];

  const change = zec.change24h;

  if (change != null) {
    if (change <= -4) {
      bear += 3;
      reasons.push("ZEC下跌动能较强");
    } else if (change < 0) {
      bear++;
    } else if (change >= 4) {
      bull += 3;
      reasons.push("ZEC上涨动能较强");
    } else if (change > 0) {
      bull++;
    }
  }

  if (
    context.relativeStrength === "WEAK"
  ) {
    bear += 2;
  }

  if (
    context.relativeStrength === "STRONG"
  ) {
    bull += 2;
  }

  if (macro.regime === "RISK_OFF") {
    bear += 2;
  }

  if (macro.regime === "RISK_ON") {
    bull++;
  }

  const trend =
    bear >= bull + 2
      ? "BEARISH"
      : bull >= bear + 2
        ? "BULLISH"
        : "NEUTRAL";

  let setupScore = clamp(
    35 + Math.abs(bear - bull) * 9,
    0,
    100
  );

  if (trend === "NEUTRAL") {
    setupScore = Math.min(
      setupScore,
      45
    );
  }

  const move =
    Math.abs(change ?? 0);

  const chaseRisk =
    change == null
      ? "UNKNOWN"
      : move >= 7
        ? "HIGH"
        : move >= 4
          ? "MEDIUM"
          : "LOW";

  let entryQuality = 70;

  if (chaseRisk === "HIGH") {
    entryQuality -= 40;
  } else if (chaseRisk === "MEDIUM") {
    entryQuality -= 20;
  } else if (chaseRisk === "UNKNOWN") {
    entryQuality -= 30;
  }

  if (
    globalRisk.knownRiskLevel === "HIGH"
  ) {
    entryQuality -= 20;
  }

  if (
    globalRisk.knownRiskLevel === "MEDIUM"
  ) {
    entryQuality -= 10;
  }

  if (geo.risk === "UNKNOWN") {
    entryQuality -= 5;
  }

  if (geo.cacheUsed) {
    entryQuality -= 5;
  }

  if (events.risk === "HIGH") {
    entryQuality -= 10;
  }

  entryQuality = clamp(
    entryQuality,
    0,
    100
  );

  const eligible =
    trend !== "NEUTRAL" &&
    setupScore >= 70 &&
    entryQuality >= 70 &&
    chaseRisk !== "HIGH" &&
    globalRisk.knownRiskLevel !== "HIGH" &&
    globalRisk.signalPermission === "NORMAL";

  return {
    action:
      eligible
        ? trend === "BULLISH"
          ? "BULLISH SETUP"
          : "BEARISH SETUP"
        : "WAIT FOR CONFIRMATION",

    actionCN:
      eligible
        ? "趋势条件形成，等待K线确认"
        : "等待确认",

    trend,
    setupScore,
    entryQuality,
    chaseRisk,
    reasons,

    forcedBuySell: false,

    methodologyCN:
      "趋势评分不等于入场信号；必须通过真实K线确认。"
  };
}

/* =========================================================
   OHLCV VALIDATION
========================================================= */

function parseTime(value) {
  if (typeof value === "number") {
    return value < 1e11
      ? value * 1000
      : value;
  }

  return Date.parse(value);
}

function validateCandles(raw, timeframe) {
  const input =
    Array.isArray(raw)
      ? raw
      : raw?.candles;

  if (
    !Array.isArray(input) ||
    input.length < 60
  ) {
    throw new Error(
      "INSUFFICIENT_CANDLES"
    );
  }

  if (
    raw?.interval &&
    raw.interval !== timeframe
  ) {
    throw new Error(
      "INTERVAL_MISMATCH"
    );
  }

  if (
    raw?.symbol &&
    ![
      "ZEC",
      "ZECUSD",
      "ZECUSDT"
    ].includes(raw.symbol)
  ) {
    throw new Error(
      "SYMBOL_MISMATCH"
    );
  }

  const candles = input.map(x => ({
    time:
      parseTime(
        x.time ?? x.timestamp
      ),

    open: number(x.open),
    high: number(x.high),
    low: number(x.low),
    close: number(x.close),
    volume: number(x.volume)
  }));

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {
    const c = candles[i];

    if (
      !Number.isFinite(c.time) ||
      ![
        c.open,
        c.high,
        c.low,
        c.close
      ].every(x => x !== null && x > 0)
    ) {
      throw new Error(
        "INVALID_OHLCV"
      );
    }

    if (
      c.high < Math.max(
        c.open,
        c.close,
        c.low
      ) ||
      c.low > Math.min(
        c.open,
        c.close,
        c.high
      )
    ) {
      throw new Error(
        "INVALID_CANDLE_RANGE"
      );
    }

    if (
      i > 0 &&
      c.time <= candles[i - 1].time
    ) {
      throw new Error(
        "CANDLES_NOT_SORTED"
      );
    }
  }

  const duration =
    TIMEFRAMES[timeframe];

  const current = Date.now();

  const closed = candles.filter(
    c =>
      c.time + duration <= current
  );

  if (closed.length < 55) {
    throw new Error(
      "INSUFFICIENT_CLOSED_CANDLES"
    );
  }

  const last = closed.at(-1);

  if (
    current -
    (last.time + duration) >
    duration * 2
  ) {
    throw new Error(
      "STALE_CANDLES"
    );
  }

  return closed.slice(-240);
}

async function getCandles(env, timeframe) {
  if (!env.CANDLES_API_URL) {
    throw new Error(
      "CANDLES_NOT_CONFIGURED"
    );
  }

  const url =
    new URL(env.CANDLES_API_URL);

  if (url.protocol !== "https:") {
    throw new Error(
      "CANDLES_ENDPOINT_MUST_BE_HTTPS"
    );
  }

  url.searchParams.set(
    "symbol",
    "ZEC"
  );

  url.searchParams.set(
    "interval",
    timeframe
  );

  url.searchParams.set(
    "limit",
    "240"
  );

  const headers = {};

  if (env.CANDLES_API_TOKEN) {
    headers.Authorization =
      "Bearer " + env.CANDLES_API_TOKEN;
  }

  const data = await getJSON(
    url.toString(),
    5500,
    headers
  );

  return validateCandles(
    data,
    timeframe
  );
}

/* =========================================================
   TECHNICAL INDICATORS
========================================================= */

function ema(values, period) {
  if (values.length < period) {
    return null;
  }

  const k = 2 / (period + 1);

  let result =
    values.slice(0, period)
      .reduce((a, b) => a + b, 0) /
    period;

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    result =
      values[i] * k +
      result * (1 - k);
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const delta =
      values[i] - values[i - 1];

    gain += Math.max(0, delta);
    loss += Math.max(0, -delta);
  }

  gain /= period;
  loss /= period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const delta =
      values[i] - values[i - 1];

    gain =
      (
        gain * (period - 1) +
        Math.max(0, delta)
      ) / period;

    loss =
      (
        loss * (period - 1) +
        Math.max(0, -delta)
      ) / period;
  }

  if (loss === 0) {
    return gain === 0 ? 50 : 100;
  }

  return 100 -
    100 / (1 + gain / loss);
}

function atr(candles, period = 14) {
  if (
    candles.length < period + 1
  ) {
    return null;
  }

  const ranges = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const current = candles[i];
    const previous = candles[i - 1];

    ranges.push(
      Math.max(
        current.high - current.low,

        Math.abs(
          current.high - previous.close
        ),

        Math.abs(
          current.low - previous.close
        )
      )
    );
  }

  let result =
    ranges.slice(0, period)
      .reduce((a, b) => a + b, 0) /
    period;

  for (
    let i = period;
    i < ranges.length;
    i++
  ) {
    result =
      (
        result * (period - 1) +
        ranges[i]
      ) / period;
  }

  return result;
}

/* =========================================================
   MULTI TIMEFRAME ENGINE
========================================================= */

function analyzeTimeframe(
  candles,
  timeframe
) {
  const closes =
    candles.map(x => x.close);

  const last =
    candles.at(-1);

  const ema20 =
    ema(closes, 20);

  const ema50 =
    ema(closes, 50);

  const rsi14 =
    rsi(closes, 14);

  const atr14 =
    atr(candles, 14);

  const trend =
    ema20 > ema50 &&
    last.close > ema20
      ? "BULLISH"
      : ema20 < ema50 &&
        last.close < ema20
        ? "BEARISH"
        : "MIXED";

  const previous =
    candles.slice(-21, -1);

  const resistance =
    Math.max(
      ...previous.map(x => x.high)
    );

  const support =
    Math.min(
      ...previous.map(x => x.low)
    );

  const breakout =
    last.close > resistance
      ? "UP"
      : last.close < support
        ? "DOWN"
        : "NONE";

  return {
    interval: timeframe,

    status: "VERIFIED",

    source: "EXTERNAL_OHLCV",

    lastClosedAt:
      new Date(
        last.time +
        TIMEFRAMES[timeframe]
      ).toISOString(),

    close: last.close,

    ema20,
    ema50,
    rsi14,
    atr14,

    trend,
    support,
    resistance,
    breakout,

    volumeConfirmed: false,

    volumeNote:
      "Volume confirmation requires venue-specific validation."
  };
}

async function technicalData(env) {
  const frames =
    Object.keys(TIMEFRAMES);

  if (!env.CANDLES_API_URL) {
    return {
      ok: false,

      status: "NOT_CONFIGURED",

      timeframes: {},

      errors: [
        "Real OHLCV provider is not configured."
      ],

      messageCN:
        "尚未连接真实K线数据，技术分析保持等待状态。"
    };
  }

  const results =
    await Promise.allSettled(
      frames.map(
        async timeframe => {
          const candles =
            await getCandles(
              env,
              timeframe
            );

          return analyzeTimeframe(
            candles,
            timeframe
          );
        }
      )
    );

  const timeframes = {};
  const errors = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      timeframes[frames[i]] =
        result.value;

    } else {
      errors.push(
        frames[i] + ": " +
        errorText(result.reason)
      );
    }
  });

  const ok =
    frames.every(
      x => Boolean(timeframes[x])
    );

  return {
    ok,

    status:
      ok
        ? "VERIFIED"
        : "INCOMPLETE",

    timeframes,
    errors,

    source:
      "Configured OHLCV Provider"
  };
}

/* =========================================================
   TRADE PLAN ENGINE
========================================================= */

function tradePlan(
  technical,
  decision,
  globalRisk,
  market
) {
  function wait(reason) {
    return {
      action: "WAIT",
      status: "NO_TRADE",
      reason,

      entryZone: null,
      stopLoss: null,

      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,

      riskReward: null,

      signalValidity:
        "NOT_CONFIRMED",

      simulationOnly: true,
      executionEnabled: false
    };
  }

  if (!technical.ok) {
    return wait(
      "真实多周期K线缺失或过期"
    );
  }

  if (
    !market.ZEC ||
    market.ZEC.price <= 0
  ) {
    return wait(
      "CoinLore市场价格不可用"
    );
  }

  if (
    globalRisk.signalPermission !==
      "NORMAL" ||
    globalRisk.knownRiskLevel ===
      "HIGH"
  ) {
    return wait(
      "风险保护机制已启动"
    );
  }

  const t = technical.timeframes;

  const m15 = t["15m"];
  const h1 = t["1h"];
  const h4 = t["4h"];
  const d1 = t["1d"];

  let direction = null;

  if (
    [h1, h4, d1].every(
      x => x.trend === "BULLISH"
    )
  ) {
    direction = "BUY";
  }

  if (
    [h1, h4, d1].every(
      x => x.trend === "BEARISH"
    )
  ) {
    direction = "SELL";
  }

  if (!direction) {
    return wait(
      "H1/H4/D1趋势尚未一致"
    );
  }

  const expectedTrend =
    direction === "BUY"
      ? "BULLISH"
      : "BEARISH";

  const expectedBreakout =
    direction === "BUY"
      ? "UP"
      : "DOWN";

  if (
    m15.trend !== expectedTrend
  ) {
    return wait(
      "M15方向尚未确认"
    );
  }

  if (
    m15.breakout !== expectedBreakout
  ) {
    return wait(
      "等待M15收盘突破确认"
    );
  }

  const entry = m15.close;
  const volatility = m15.atr14;

  if (
    !Number.isFinite(volatility) ||
    volatility <= 0
  ) {
    return wait(
      "ATR数据不足"
    );
  }

  const stop =
    direction === "BUY"
      ? Math.min(
          m15.support,
          entry - 1.5 * volatility
        )
      : Math.max(
          m15.resistance,
          entry + 1.5 * volatility
        );

  const risk =
    Math.abs(entry - stop);

  if (
    risk <= 0 ||
    risk / entry > 0.08
  ) {
    return wait(
      "止损距离不符合风险要求"
    );
  }

  const target = multiplier =>
    direction === "BUY"
      ? entry + risk * multiplier
      : entry - risk * multiplier;

  const tp1 = target(1.5);
  const tp2 = target(2);
  const tp3 = target(3);

  if (
    tp1 <= 0 ||
    tp2 <= 0 ||
    tp3 <= 0
  ) {
    return wait(
      "目标价格无效"
    );
  }

  const divergence =
    Math.abs(
      market.ZEC.price - entry
    ) / market.ZEC.price;

  if (divergence > 0.025) {
    return wait(
      "聚合价格与K线价格偏差过大"
    );
  }

  return {
    action: direction,

    status: "SIMULATED_SETUP",

    reason:
      "多周期趋势一致，M15收盘突破确认。仍需人工复核。",

    entryReference: entry,

    entryZone: {
      min:
        entry - volatility * 0.15,

      max:
        entry + volatility * 0.15
    },

    stopLoss: stop,

    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3,

    riskReward: {
      tp1: 1.5,
      tp2: 2,
      tp3: 3
    },

    riskPerUnit: risk,

    candleClosedAt:
      m15.lastClosedAt,

    signalValidity:
      "VALID_AT_LAST_CANDLE_ONLY",

    simulationOnly: true,

    executionEnabled: false
  };
}

/* =========================================================
   PRICE ALERT SAFETY
========================================================= */

function alertStatus(price) {
  const rounded =
    Math.round(price);

  return {
    roundedPrice: rounded,

    below1150:
      rounded < 1150,

    below1140:
      rounded < 1140,

    above1195:
      rounded > 1195
  };
}

async function priceAlerts(env, zec) {
  if (
    !zec ||
    !Number.isFinite(zec.price) ||
    zec.price <= 0
  ) {
    return {
      status: "NO_VALID_PRICE",
      alert: false
    };
  }

  const current =
    alertStatus(zec.price);

  /*
    IMPORTANT:

    CoinLore ticker API does not provide
    the verified absolute timestamp of
    the exchange table.

    Therefore this endpoint MUST NOT
    overwrite the independent scheduled
    alert automation baseline.

    It also MUST NOT claim that a new
    crossing has been verified.
  */

  return {
    status:
      "UNVERIFIED_SOURCE_TIMESTAMP",

    alert: false,

    crossings: [],

    candidatePrice:
      current.roundedPrice,

    thresholdStatus: current,

    checkedAt: now(),

    baselineUpdated: false,

    messageCN:
      "价格已读取，但缺少可比较的交易所表格绝对时间戳；不更新提醒基准。"
  };
}

/* =========================================================
   COMPLETE INTELLIGENCE
========================================================= */

async function intelligence(env) {
  const started = Date.now();

  const results =
    await Promise.allSettled([
      marketData(),
      macroData(env),
      eventData(env),
      geopoliticalData(env),
      technicalData(env)
    ]);

  function value(index, fallback) {
    return results[index].status ===
      "fulfilled"
      ? results[index].value
      : fallback;
  }

  const marketResult =
    value(0, {
      market: {
        ZEC: null,
        BTC: null,
        ETH: null
      },
      context: {
        regime: "UNKNOWN",
        score: 0,
        relativeStrength: "UNKNOWN"
      }
    });

  const macro =
    value(1, {
      ok: false,
      status: "UNAVAILABLE",
      risk: "UNKNOWN",
      regime: "UNKNOWN"
    });

  const events =
    value(2, {
      ok: false,
      status: "UNAVAILABLE",
      risk: "UNKNOWN",
      events: []
    });

  const geo =
    value(3, {
      ok: false,
      status: "UNAVAILABLE",
      risk: "UNKNOWN",
      confidence: 0,
      dataAvailable: false
    });

  const technical =
    value(4, {
      ok: false,
      status: "UNAVAILABLE",
      timeframes: {}
    });

  const quality =
    dataQuality(
      marketResult.market,
      macro,
      events,
      geo
    );

  const globalRisk =
    globalRiskFusion(
      marketResult.context,
      macro,
      events,
      geo,
      quality
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

  const plan =
    tradePlan(
      technical,
      decision,
      globalRisk,
      marketResult.market
    );

  return {
    ok:
      Boolean(
        marketResult.market.ZEC
      ),

    service:
      "ZEC AI Intelligence",

    version: VERSION,

    mission:
      "AI Market Intelligence and Verified Trading Simulation",

    timestamp: now(),

    elapsedMs:
      Date.now() - started,

    market:
      marketResult.market,

    marketContext:
      marketResult.context,

    decision,
    technical,

    tradePlan: plan,

    macro,
    events,

    geopolitical: geo,

    dataQuality: quality,

    globalRisk,

    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。",

    disclaimer:
      "Market research and simulation only."
  };
}

/* =========================================================
   SYSTEM TESTS
========================================================= */

async function aiTest(env) {
  if (!env.AI) {
    return {
      ok: false,
      status: "NOT_BOUND"
    };
  }

  try {
    const result = await env.AI.run(
      AI_MODEL,
      {
        messages: [
          {
            role: "user",
            content:
              "Return exactly: ZEC_AI_WORKERS_AI_OK"
          }
        ],
        max_tokens: 32,
        temperature: 0
      }
    );

    return {
      ok:
        String(result.response || "")
          .includes(
            "ZEC_AI_WORKERS_AI_OK"
          ),

      status: "RESPONDED",

      response: result.response,

      model: AI_MODEL
    };

  } catch (err) {
    return {
      ok: false,
      status: "ERROR",
      error: errorText(err)
    };
  }
}

async function webSearchTest(env) {
  try {
    const items = await webSearch(
      env,
      "latest geopolitical risk cryptocurrency markets",
      5
    );

    return {
      ok: items.length > 0,

      status:
        items.length
          ? "OK"
          : "NO_RESULTS",

      resultCount: items.length,

      results: items
    };

  } catch (err) {
    return {
      ok: false,
      status: "ERROR",
      error: errorText(err)
    };
  }
}

async function kvTest(env) {
  if (!env.INTEL_KV) {
    return {
      ok: false,
      status: "NOT_BOUND"
    };
  }

  const key = "system:kv-test";

  const data = {
    version: VERSION,
    timestamp: now()
  };

  try {
    await env.INTEL_KV.put(
      key,
      JSON.stringify(data),
      {
        expirationTtl: 3600
      }
    );

    const result =
      await kvGet(env, key);

    return {
      ok: Boolean(result),

      status:
        result
          ? "OK"
          : "READ_FAILED",

      result
    };

  } catch (err) {
    return {
      ok: false,
      status: "ERROR",
      error: errorText(err)
    };
  }
}

/* =========================================================
   SYSTEM STATUS
========================================================= */

function status(env) {
  return {
    ok: true,

    service:
      "ZEC AI Intelligence",

    version: VERSION,

    status: "ONLINE",

    timestamp: now(),

    architecture:
      "Cloudflare Worker + CoinLore + FRED + Workers AI + KV + OHLCV",

    modules: {
      coinLoreMarket: "ACTIVE",

      btcContext: "ACTIVE",

      ethContext: "ACTIVE",

      fredMacro:
        env.FRED_API_KEY
          ? "CONFIGURED"
          : "NOT_CONFIGURED",

      economicEventRadar:
        env.FRED_API_KEY
          ? "CONFIGURED"
          : "PARTIAL_STATIC_ONLY",

      fomcCalendar:
        "STATIC_2026",

      workersAI:
        env.AI
          ? "CONFIGURED"
          : "NOT_BOUND",

      cloudflareWebSearch:
        typeof env.AI?.websearch ===
          "function"
          ? "AVAILABLE"
          : "UNAVAILABLE",

      aiGeopoliticalEngine:
        env.AI
          ? "CONFIGURED"
          : "NOT_BOUND",

      persistentIntelligenceCache:
        env.INTEL_KV
          ? "CONFIGURED"
          : "NOT_BOUND",

      technicalOHLCV:
        env.CANDLES_API_URL
          ? "CONFIGURED"
          : "NOT_CONFIGURED",

      multiTimeframeEngine:
        "ACTIVE",

      emaEngine:
        "ACTIVE",

      rsiEngine:
        "ACTIVE",

      atrEngine:
        "ACTIVE",

      tradeSimulation:
        "ACTIVE",

      stopLossEngine:
        "ACTIVE",

      takeProfitEngine:
        "ACTIVE",

      dataQualityEngine:
        "ACTIVE",

      globalRiskFusion:
        "ACTIVE",

      priceAlerts:
        "READ_ONLY_NO_BASELINE_WRITES"
    },

    bindings: {
      FRED_API_KEY:
        Boolean(env.FRED_API_KEY),

      INTEL_KV:
        Boolean(env.INTEL_KV),

      AI:
        Boolean(env.AI),

      CANDLES_API_URL:
        Boolean(env.CANDLES_API_URL)
    },

    policies: {
      marketSource:
        "COINLORE",

      automaticTrading: false,

      simulationOnly: true,

      missingCandles:
        "WAIT",

      staleCandles:
        "WAIT",

      unknownRisk:
        "CAUTION",

      alertBaselineWrites:
        false
    },

    messageCN:
      "ZEC AI Intelligence V4.9.0 已启动",

    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。"
  };
}

/* =========================================================
   API ROUTER
========================================================= */

const ROUTES = [
  "/",
  "/status",
  "/market",
  "/macro",
  "/events",
  "/geopolitical",
  "/intelligence",
  "/technical",
  "/trade-plan",
  "/alerts",
  "/ai-test",
  "/websearch-test",
  "/kv-test",
  "/fred-test"
];

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,

        headers: {
          "Access-Control-Allow-Origin":
            env.ALLOWED_ORIGIN || "*",

          "Access-Control-Allow-Methods":
            "GET,OPTIONS",

          "Access-Control-Allow-Headers":
            "Content-Type"
        }
      });
    }

    if (request.method !== "GET") {
      return response(
        {
          ok: false,
          error: "METHOD_NOT_ALLOWED"
        },
        405,
        env
      );
    }

    const url =
      new URL(request.url);

    const path = url.pathname;

    try {
      let result;

      switch (path) {

        case "/":
        case "/status":
          result = status(env);
          break;

        case "/market":
          result = {
            ok: true,
            version: VERSION,
            timestamp: now(),
            ...await marketData()
          };
          break;

        case "/macro":
          result =
            await macroData(env);
          break;

        case "/events":
          result =
            await eventData(env);
          break;

        case "/geopolitical":
          result =
            await geopoliticalData(env);
          break;

        case "/intelligence":
          result =
            await intelligence(env);
          break;

        case "/technical":
          result =
            await technicalData(env);
          break;

        case "/trade-plan": {
          const intel =
            await intelligence(env);

          result = {
            ok:
              intel.tradePlan.status ===
              "SIMULATED_SETUP",

            version: VERSION,

            timestamp:
              intel.timestamp,

            market:
              intel.market.ZEC,

            decision:
              intel.decision,

            technical:
              intel.technical,

            globalRisk:
              intel.globalRisk,

            tradePlan:
              intel.tradePlan
          };

          break;
        }

        case "/alerts": {
          const data =
            await marketData();

          result =
            await priceAlerts(
              env,
              data.market.ZEC
            );

          break;
        }

        case "/ai-test":
          result =
            await aiTest(env);
          break;

        case "/websearch-test":
          result =
            await webSearchTest(env);
          break;

        case "/kv-test":
          result =
            await kvTest(env);
          break;

        case "/fred-test":
          result =
            env.FRED_API_KEY
              ? {
                  ok: true,

                  result:
                    await fredSeries(
                      "DGS10",
                      env.FRED_API_KEY
                    )
                }
              : {
                  ok: false,

                  status:
                    "NOT_CONFIGURED"
                };

          break;

        default:
          return response(
            {
              ok: false,

              version: VERSION,

              error:
                "Route not found",

              availableRoutes:
                ROUTES
            },
            404,
            env
          );
      }

      return response(
        result,
        200,
        env
      );

    } catch (err) {
      return response(
        {
          ok: false,

          version: VERSION,

          timestamp: now(),

          error:
            errorText(err),

          messageCN:
            "系统数据读取失败，安全机制已阻止无效交易信号。"
        },
        502,
        env
      );
    }
  }
};

/* =========================================================
   END OF ZEC AI INTELLIGENCE WORKER V4.9.0
========================================================= */
