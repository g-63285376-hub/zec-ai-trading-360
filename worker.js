/*
  ZEC AI Intelligence Worker V4.5.0
  --------------------------------------------------
  Market:
    CoinLore primary
    Binance fallback

  Macro:
    FRED

  V4.5:
    Economic Event Radar
    Geopolitical Intelligence
    Global Risk Fusion

  Market research & simulation only.
  Not investment advice.
*/

const VERSION = "4.5.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json;charset=UTF-8",
  "Cache-Control": "no-store"
};

const COINLORE_IDS = {
  ZEC: "134",
  BTC: "90",
  ETH: "80"
};

const FRED_SERIES = {
  DGS10: {
    name: "US 10Y Treasury",
    type: "yield"
  },
  DFF: {
    name: "Fed Funds Rate",
    type: "rate"
  },
  DTWEXBGS: {
    name: "US Dollar Index Broad",
    type: "dollar"
  },
  VIXCLS: {
    name: "VIX",
    type: "volatility"
  },
  CPIAUCSL: {
    name: "US CPI",
    type: "inflation"
  },
  UNRATE: {
    name: "US Unemployment",
    type: "employment"
  }
};

/* =========================================================
   BASIC HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS
  });
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJSON(url, options = {}, timeout = 9000) {
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "ZEC-AI-Intelligence/4.5",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   COINLORE
========================================================= */

async function coinLoreCoin(symbol) {
  const id = COINLORE_IDS[symbol];

  if (!id) throw new Error("Unknown CoinLore symbol");

  const url =
    `https://api.coinlore.net/api/ticker/?id=${id}`;

  const data = await fetchJSON(url);

  if (!Array.isArray(data) || !data[0]) {
    throw new Error(`CoinLore ${symbol}: invalid response`);
  }

  const x = data[0];

  return {
    symbol,
    name: x.name || symbol,

    price: number(x.price_usd),

    change1h: number(x.percent_change_1h),
    change24h: number(x.percent_change_24h),
    change7d: number(x.percent_change_7d),

    marketCap: number(x.market_cap_usd),
    volume24h: number(x.volume24),

    rank: number(x.rank),

    source: "CoinLore",
    sourceId: id
  };
}

/* =========================================================
   BINANCE FALLBACK
========================================================= */

const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com"
];

async function binance24(symbol) {

  const pair = `${symbol}USDT`;

  let lastError = "";

  for (const host of BINANCE_HOSTS) {

    try {

      const url =
        `${host}/api/v3/ticker/24hr?symbol=${pair}`;

      const x = await fetchJSON(url, {}, 5000);

      return {
        symbol,
        name: symbol,

        price: number(x.lastPrice),

        change1h: null,
        change24h: number(x.priceChangePercent),
        change7d: null,

        marketCap: null,
        volume24h: number(x.quoteVolume),

        rank: null,

        source: "Binance",
        sourceId: pair
      };

    } catch (e) {

      lastError +=
        `${host}: ${e.message} | `;
    }
  }

  throw new Error(lastError);
}

async function marketCoin(symbol) {

  try {
    return await coinLoreCoin(symbol);

  } catch (coinLoreError) {

    const fallback = await binance24(symbol);

    fallback.fallbackReason =
      coinLoreError.message;

    return fallback;
  }
}

/* =========================================================
   MARKET CONTEXT
========================================================= */

function marketContext(zec, btc, eth) {

  let score = 0;
  const reasons = [];

  if (btc?.change24h != null) {

    if (btc.change24h >= 2) {
      score += 2;
      reasons.push("BTC 24H momentum positive");

    } else if (btc.change24h > 0) {
      score += 1;

    } else if (btc.change24h <= -2) {
      score -= 2;
      reasons.push("BTC 24H momentum weak");

    } else {
      score -= 1;
    }
  }

  if (eth?.change24h != null) {

    if (eth.change24h >= 2) score += 2;
    else if (eth.change24h > 0) score += 1;
    else if (eth.change24h <= -2) score -= 2;
    else score -= 1;
  }

  let regime = "NEUTRAL";

  if (score >= 3) regime = "RISK_ON";
  if (score <= -3) regime = "RISK_OFF";

  let relativeStrength = "NEUTRAL";

  if (
    zec?.change24h != null &&
    btc?.change24h != null &&
    eth?.change24h != null
  ) {

    const benchmark =
      (btc.change24h + eth.change24h) / 2;

    const relative =
      zec.change24h - benchmark;

    if (relative >= 2)
      relativeStrength = "STRONG";

    else if (relative <= -2)
      relativeStrength = "WEAK";
  }

  return {
    regime,
    score,
    relativeStrength,
    reasons
  };
}

/* =========================================================
   FRED
========================================================= */

async function fredSeries(seriesId, meta, apiKey) {

  const params =
    new URLSearchParams({
      series_id: seriesId,
      api_key: apiKey,
      file_type: "json",
      sort_order: "desc",
      limit: "10"
    });

  const url =
    `https://api.stlouisfed.org/fred/series/observations?${params}`;

  const data = await fetchJSON(url);

  const valid =
    (data.observations || [])
      .filter(x =>
        x.value !== "." &&
        Number.isFinite(Number(x.value))
      );

  if (!valid.length) {
    throw new Error(`${seriesId}: no observations`);
  }

  const latest = valid[0];
  const previous = valid[1] || null;

  const value = Number(latest.value);

  const previousValue =
    previous ? Number(previous.value) : null;

  const change =
    previousValue == null
      ? null
      : value - previousValue;

  const changePercent =
    previousValue
      ? (change / Math.abs(previousValue)) * 100
      : null;

  return {
    seriesId,

    name: meta.name,
    type: meta.type,

    value,
    date: latest.date,

    previousValue,
    previousDate:
      previous ? previous.date : null,

    change,
    changePercent,

    source: "FRED"
  };
}

function analyseMacro(indicators) {

  let score = 0;
  const reasons = [];

  const dollar = indicators.DTWEXBGS;
  const vix = indicators.VIXCLS;
  const yield10 = indicators.DGS10;
  const cpi = indicators.CPIAUCSL;
  const unemployment = indicators.UNRATE;

  if (dollar?.change != null) {

    if (dollar.change > 0) {
      score += 1;

      reasons.push(
        "US dollar strengthening: crypto headwind"
      );

    } else if (dollar.change < 0) {

      score -= 1;

      reasons.push(
        "US dollar easing: supportive for risk assets"
      );
    }
  }

  if (vix?.value != null) {

    if (vix.value >= 30) {

      score += 3;

      reasons.push(
        "VIX above 30: elevated market stress"
      );

    } else if (vix.value >= 20) {

      score += 2;

      reasons.push(
        "VIX above 20: risk appetite cautious"
      );

    } else if (vix.value < 15) {

      score -= 1;
    }
  }

  if (yield10?.change != null) {

    if (yield10.change >= 0.08) {

      score += 2;

      reasons.push(
        "US 10Y yield rising: pressure on risk assets"
      );

    } else if (yield10.change <= -0.08) {

      score -= 1;
    }
  }

  if (
    cpi?.changePercent != null &&
    cpi.changePercent > 0.2
  ) {

    score += 1;

    reasons.push(
      "Latest CPI index increase remains elevated"
    );
  }

  if (
    unemployment?.change != null &&
    unemployment.change >= 0.2
  ) {

    score += 1;

    reasons.push(
      "Unemployment rate increased"
    );
  }

  let regime = "NEUTRAL";
  let risk = "MEDIUM";

  if (score >= 3) {
    regime = "RISK_OFF";
    risk = "HIGH";

  } else if (score <= -2) {
    regime = "RISK_ON";
    risk = "LOW";
  }

  return {
    regime,
    risk,
    riskScore: score,
    reasons
  };
}

async function macroData(env) {

  if (!env.FRED_API_KEY) {

    return {
      ok: false,
      source: "FRED",
      error: "FRED_API_KEY not configured"
    };
  }

  const indicators = {};
  const errors = [];

  await Promise.all(
    Object.entries(FRED_SERIES)
      .map(async ([id, meta]) => {

        try {

          indicators[id] =
            await fredSeries(
              id,
              meta,
              env.FRED_API_KEY
            );

        } catch (e) {

          errors.push(
            `${id}: ${e.message}`
          );
        }
      })
  );

  const analysis =
    analyseMacro(indicators);

  return {
    ok: Object.keys(indicators).length > 0,

    version: VERSION,

    source: "FRED",

    timestamp:
      new Date().toISOString(),

    availableIndicators:
      Object.keys(indicators).length,

    requestedIndicators:
      Object.keys(FRED_SERIES).length,

    ...analysis,

    indicators,

    errors
  };
}

/* =========================================================
   ECONOMIC EVENT RADAR
========================================================= */

const IMPORTANT_RELEASES = [
  {
    id: 10,
    name: "Consumer Price Index",
    category: "INFLATION",
    impact: "HIGH"
  },
  {
    id: 50,
    name: "Employment Situation",
    category: "LABOR",
    impact: "HIGH"
  },
  {
    id: 53,
    name: "Gross Domestic Product",
    category: "GDP",
    impact: "HIGH"
  },
  {
    id: 101,
    name: "FOMC / Federal Reserve",
    category: "FED",
    impact: "HIGH"
  }
];

function daysBetween(dateString) {

  const now = new Date();

  const event =
    new Date(`${dateString}T12:00:00Z`);

  return Math.ceil(
    (event - now) /
    (1000 * 60 * 60 * 24)
  );
}

async function fredReleaseDates(
  release,
  apiKey
) {

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const future =
    new Date(
      Date.now() +
      45 * 86400000
    )
      .toISOString()
      .slice(0, 10);

  const params =
    new URLSearchParams({
      release_id:
        String(release.id),

      api_key:
        apiKey,

      file_type:
        "json",

      realtime_start:
        today,

      realtime_end:
        future,

      include_release_dates_with_no_data:
        "true",

      limit:
        "20"
    });

  const url =
    `https://api.stlouisfed.org/fred/release/dates?${params}`;

  const data =
    await fetchJSON(url);

  const dates =
    (data.release_dates || [])
      .map(x => x.date)
      .filter(Boolean)
      .filter(d => d >= today)
      .sort();

  return dates.map(date => ({
    releaseId:
      release.id,

    name:
      release.name,

    category:
      release.category,

    impact:
      release.impact,

    date,

    daysAway:
      daysBetween(date),

    source:
      "FRED"
  }));
}

function eventRisk(events) {

  if (!events.length) {

    return {
      risk: "LOW",
      score: 0,
      nextEvent: null,
      reason:
        "No tracked high-impact release found in current window"
    };
  }

  const sorted =
    [...events]
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date)
      );

  const next =
    sorted[0];

  let risk = "LOW";
  let score = 1;

  if (next.daysAway <= 1) {
    risk = "HIGH";
    score = 4;

  } else if (next.daysAway <= 3) {
    risk = "MEDIUM";
    score = 3;

  } else if (next.daysAway <= 7) {
    risk = "MEDIUM";
    score = 2;
  }

  return {
    risk,
    score,
    nextEvent: next,

    reason:
      `${next.name} scheduled ${next.date}`
  };
}

async function economicEvents(env) {

  if (!env.FRED_API_KEY) {

    return {
      ok: false,
      source: "FRED",
      error:
        "FRED_API_KEY not configured"
    };
  }

  const events = [];
  const errors = [];

  await Promise.all(
    IMPORTANT_RELEASES
      .map(async release => {

        try {

          const result =
            await fredReleaseDates(
              release,
              env.FRED_API_KEY
            );

          events.push(...result);

        } catch (e) {

          errors.push(
            `${release.name}: ${e.message}`
          );
        }
      })
  );

  const unique = [];

  const seen =
    new Set();

  for (
    const event of
    events.sort(
      (a, b) =>
        a.date.localeCompare(b.date)
    )
  ) {

    const key =
      `${event.releaseId}-${event.date}`;

    if (!seen.has(key)) {

      seen.add(key);
      unique.push(event);
    }
  }

  const risk =
    eventRisk(unique);

  return {
    ok: true,

    version:
      VERSION,

    source:
      "FRED",

    timestamp:
      new Date().toISOString(),

    horizonDays:
      45,

    ...risk,

    events:
      unique.slice(0, 20),

    errors,

    note:
      "FRED release dates are date-level scheduling data. Exact announcement time and market consensus are not fabricated."
  };
}

/* =========================================================
   GDELT GEOPOLITICAL INTELLIGENCE
========================================================= */

const GEO_QUERIES = [
  {
    id: "WAR",
    label:
      "War / military escalation",

    query:
      "(war OR military OR missile OR attack OR invasion OR ceasefire)",

    weight: 3
  },

  {
    id: "SANCTIONS",
    label:
      "Sanctions",

    query:
      "(sanctions OR embargo OR export restrictions)",

    weight: 2
  },

  {
    id: "ENERGY",
    label:
      "Energy supply disruption",

    query:
      "(oil supply OR gas supply OR pipeline OR OPEC OR energy disruption)",

    weight: 2
  },

  {
    id: "TRADE",
    label:
      "Trade conflict",

    query:
      "(tariff OR trade war OR export controls OR trade restrictions)",

    weight: 2
  },

  {
    id: "SHIPPING",
    label:
      "Shipping / strategic routes",

    query:
      "(Red Sea OR Strait of Hormuz OR shipping disruption OR Suez Canal)",

    weight: 3
  }
];

async function gdeltSearch(item) {

  const params =
    new URLSearchParams({
      query:
        item.query,

      mode:
        "ArtList",

      maxrecords:
        "25",

      format:
        "json",

      sort:
        "HybridRel",

      timespan:
        "24h"
    });

  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  const data =
    await fetchJSON(
      url,
      {},
      12000
    );

  const articles =
    Array.isArray(data.articles)
      ? data.articles
      : [];

  return {
    id:
      item.id,

    label:
      item.label,

    weight:
      item.weight,

    count:
      articles.length,

    articles:
      articles
        .slice(0, 5)
        .map(a => ({
          title:
            a.title || null,

          url:
            a.url || null,

          domain:
            a.domain || null,

          language:
            a.language || null,

          sourceCountry:
            a.sourcecountry || null,

          seenDate:
            a.seendate || null
        }))
  };
}

function geopoliticalRisk(groups) {

  let score = 0;

  const reasons = [];

  for (const group of groups) {

    if (!group.count)
      continue;

    let contribution = 0;

    if (group.count >= 20)
      contribution =
        group.weight;

    else if (group.count >= 8)
      contribution =
        Math.max(
          1,
          group.weight - 1
        );

    else if (group.count >= 3)
      contribution = 1;

    score += contribution;

    if (contribution > 0) {

      reasons.push(
        `${group.label}: ${group.count} recent monitored articles`
      );
    }
  }

  /*
    Important:
    Article volume is NOT a trading signal.

    Score only represents
    monitoring intensity.
  */

  score =
    clamp(score, 0, 10);

  let risk = "LOW";

  if (score >= 7)
    risk = "HIGH";

  else if (score >= 3)
    risk = "MEDIUM";

  return {
    risk,
    score,
    reasons
  };
}

async function geopoliticalData() {

  const groups = [];
  const errors = [];

  await Promise.all(
    GEO_QUERIES
      .map(async item => {

        try {

          groups.push(
            await gdeltSearch(item)
          );

        } catch (e) {

          errors.push(
            `${item.id}: ${e.message}`
          );
        }
      })
  );

  const analysis =
    geopoliticalRisk(groups);

  const headlines =
    groups
      .flatMap(
        g =>
          g.articles.map(a => ({
            category:
              g.id,

            categoryName:
              g.label,

            ...a
          }))
      )
      .filter(x => x.title)
      .slice(0, 15);

  return {
    ok:
      groups.length > 0,

    version:
      VERSION,

    source:
      "GDELT",

    timestamp:
      new Date().toISOString(),

    window:
      "24h",

    ...analysis,

    groups,

    headlines,

    errors,

    methodology:
      "Headline volume is used only as geopolitical monitoring context. It does not independently create BUY or SELL signals."
  };
}

/* =========================================================
   GLOBAL RISK FUSION
========================================================= */

function globalRiskFusion(
  market,
  macro,
  events,
  geo
) {

  let riskScore = 0;
  const reasons = [];

  if (
    market?.regime ===
    "RISK_OFF"
  ) {

    riskScore += 2;

    reasons.push(
      "Crypto market environment risk-off"
    );

  } else if (
    market?.regime ===
    "RISK_ON"
  ) {

    riskScore -= 1;
  }

  if (
    macro?.regime ===
    "RISK_OFF"
  ) {

    riskScore += 3;

    reasons.push(
      "Macro environment risk-off"
    );

  } else if (
    macro?.regime ===
    "RISK_ON"
  ) {

    riskScore -= 1;
  }

  if (
    events?.risk ===
    "HIGH"
  ) {

    riskScore += 3;

    reasons.push(
      "High-impact economic event approaching"
    );

  } else if (
    events?.risk ===
    "MEDIUM"
  ) {

    riskScore += 1;
  }

  if (
    geo?.risk ===
    "HIGH"
  ) {

    riskScore += 2;

    reasons.push(
      "Elevated geopolitical monitoring risk"
    );

  } else if (
    geo?.risk ===
    "MEDIUM"
  ) {

    riskScore += 1;
  }

  riskScore =
    clamp(
      riskScore,
      0,
      10
    );

  let risk = "LOW";
  let posture = "NORMAL";

  if (riskScore >= 7) {

    risk = "HIGH";
    posture =
      "DEFENSIVE";

  } else if (
    riskScore >= 4
  ) {

    risk = "MEDIUM";
    posture =
      "CAUTIOUS";
  }

  /*
    Event protection:
    Do not pretend we know exact
    intraday release time if FRED
    only gives the date.
  */

  let eventProtection =
    "NORMAL";

  if (
    events?.nextEvent?.daysAway === 0
  ) {

    eventProtection =
      "EVENT DAY";

  } else if (
    events?.nextEvent?.daysAway === 1
  ) {

    eventProtection =
      "EVENT TOMORROW";
  }

  return {
    risk,
    riskScore,
    posture,
    eventProtection,
    reasons
  };
}

/* =========================================================
   COMPLETE INTELLIGENCE
========================================================= */

async function intelligence(env) {

  const errors = [];

  let ZEC = null;
  let BTC = null;
  let ETH = null;

  const marketResults =
    await Promise.allSettled([
      marketCoin("ZEC"),
      marketCoin("BTC"),
      marketCoin("ETH")
    ]);

  if (
    marketResults[0].status ===
    "fulfilled"
  )
    ZEC =
      marketResults[0].value;

  else
    errors.push(
      `ZEC: ${marketResults[0].reason}`
    );

  if (
    marketResults[1].status ===
    "fulfilled"
  )
    BTC =
      marketResults[1].value;

  else
    errors.push(
      `BTC: ${marketResults[1].reason}`
    );

  if (
    marketResults[2].status ===
    "fulfilled"
  )
    ETH =
      marketResults[2].value;

  else
    errors.push(
      `ETH: ${marketResults[2].reason}`
    );

  const market =
    marketContext(
      ZEC,
      BTC,
      ETH
    );

  const [
    macroResult,
    eventResult,
    geoResult
  ] =
    await Promise.allSettled([
      macroData(env),
      economicEvents(env),
      geopoliticalData()
    ]);

  const macro =
    macroResult.status ===
    "fulfilled"
      ? macroResult.value
      : {
          ok: false,
          error:
            String(
              macroResult.reason
            )
        };

  const events =
    eventResult.status ===
    "fulfilled"
      ? eventResult.value
      : {
          ok: false,
          error:
            String(
              eventResult.reason
            )
        };

  const geopolitical =
    geoResult.status ===
    "fulfilled"
      ? geoResult.value
      : {
          ok: false,
          error:
            String(
              geoResult.reason
            )
        };

  const globalRisk =
    globalRiskFusion(
      market,
      macro,
      events,
      geopolitical
    );

  return {
    ok:
      Boolean(ZEC),

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    timestamp:
      new Date().toISOString(),

    market: {
      ZEC,
      BTC,
      ETH
    },

    marketContext:
      market,

    macro,

    events,

    geopolitical,

    globalRisk,

    errors,

    disclaimer:
      "Market research and simulation only. Not investment advice."
  };
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

    status:
      "ONLINE",

    architecture:
      "Cloudflare Worker Multi-Source Intelligence Gateway",

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
          ? "ACTIVE"
          : "NOT CONFIGURED",

      geopoliticalEngine:
        "ACTIVE",

      globalRiskFusion:
        "ACTIVE"
    },

    fredSecretConfigured:
      Boolean(
        env.FRED_API_KEY
      ),

    timestamp:
      new Date().toISOString(),

    disclaimer:
      "Market research and simulation only. Not investment advice."
  };
}

/* =========================================================
   ROUTER
========================================================= */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers: CORS
        }
      );
    }

    const url =
      new URL(
        request.url
      );

    try {

      if (
        url.pathname === "/" ||
        url.pathname ===
        "/status"
      ) {

        return json(
          status(env)
        );
      }

      if (
        url.pathname ===
        "/market"
      ) {

        const [
          ZEC,
          BTC,
          ETH
        ] =
          await Promise.all([
            marketCoin("ZEC"),
            marketCoin("BTC"),
            marketCoin("ETH")
          ]);

        return json({
          ok: true,

          version:
            VERSION,

          timestamp:
            new Date()
              .toISOString(),

          market: {
            ZEC,
            BTC,
            ETH
          },

          context:
            marketContext(
              ZEC,
              BTC,
              ETH
            )
        });
      }

      if (
        url.pathname ===
        "/macro"
      ) {

        return json(
          await macroData(env)
        );
      }

      if (
        url.pathname ===
        "/events"
      ) {

        return json(
          await economicEvents(
            env
          )
        );
      }

      if (
        url.pathname ===
        "/geopolitical"
      ) {

        return json(
          await geopoliticalData()
        );
      }

      if (
        url.pathname ===
        "/intelligence"
      ) {

        return json(
          await intelligence(env)
        );
      }

      return json(
        {
          ok: false,

          version:
            VERSION,

          error:
            "Route not found",

          availableRoutes: [
            "/",
            "/status",
            "/market",
            "/macro",
            "/events",
            "/geopolitical",
            "/intelligence"
          ]
        },
        404
      );

    } catch (e) {

      return json(
        {
          ok: false,

          version:
            VERSION,

          timestamp:
            new Date()
              .toISOString(),

          error:
            e?.message ||
            String(e)
        },
        500
      );
    }
  }
};
