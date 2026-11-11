/* ZEC AI Intelligence Worker V4.7.0
   Stable Intelligence Mission
   Market research & simulation only.
*/

const VERSION = "4.7.0";

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

/*
  IMPORTANT:
  FRED release dates are economic-data release dates.
  They are NOT treated as FOMC policy meetings.
*/
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

/*
  Official Federal Reserve 2026 scheduled FOMC meetings.
  We only need remaining/current-year dates for V4.7.
  The decision day is the second day of each meeting.
*/
const FOMC_2026 = [
  {
    start: "2026-01-27",
    date: "2026-01-28"
  },
  {
    start: "2026-03-17",
    date: "2026-03-18"
  },
  {
    start: "2026-04-28",
    date: "2026-04-29"
  },
  {
    start: "2026-06-16",
    date: "2026-06-17"
  },
  {
    start: "2026-07-28",
    date: "2026-07-29"
  },
  {
    start: "2026-09-15",
    date: "2026-09-16"
  },
  {
    start: "2026-10-27",
    date: "2026-10-28"
  },
  {
    start: "2026-12-08",
    date: "2026-12-09"
  }
];

const GEO_QUERY =
  '(war OR military OR missile OR sanctions OR embargo OR tariff OR "trade war" OR "Red Sea" OR "Strait of Hormuz" OR "Suez Canal" OR OPEC OR pipeline)';

const GEO_WORDS = {
  WAR: [
    "war",
    "military",
    "missile",
    "invasion",
    "airstrike",
    "attack"
  ],
  SANCTIONS: [
    "sanction",
    "embargo"
  ],
  ENERGY: [
    "oil",
    "opec",
    "pipeline",
    "energy"
  ],
  TRADE: [
    "tariff",
    "trade war",
    "export control"
  ],
  SHIPPING: [
    "red sea",
    "strait of hormuz",
    "suez canal",
    "shipping"
  ]
};

const GEO_WEIGHT = {
  WAR: 3,
  SANCTIONS: 2,
  ENERGY: 2,
  TRADE: 2,
  SHIPPING: 3
};

function reply(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: HEADERS
    }
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timeoutValue(ms, value) {
  return new Promise(
    resolve => setTimeout(() => resolve(value), ms)
  );
}

async function getJSON(url, timeout = 7000) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    const response = await fetch(
      url,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": `ZEC-AI-Intelligence/${VERSION}`
        }
      }
    );

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return await response.json();

  } catch (err) {
    if (err && err.name === "AbortError") {
      const timeoutError = new Error("TIMEOUT");
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
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
  const data = await getJSON(
    `https://api.coinlore.net/api/ticker/?id=${IDS[symbol]}`,
    5000
  );

  if (!Array.isArray(data) || !data[0]) {
    throw new Error("CoinLore invalid response");
  }

  const x = data[0];

  return {
    symbol,
    price: num(x.price_usd),
    change1h: num(x.percent_change_1h),
    change24h: num(x.percent_change_24h),
    change7d: num(x.percent_change_7d),
    volume24h: num(x.volume24),
    marketCap: num(x.market_cap_usd),
    source: "CoinLore"
  };
}

const BINANCE = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com"
];

async function binance(symbol) {
  let lastError = "";

  for (const host of BINANCE) {
    try {
      const x = await getJSON(
        `${host}/api/v3/ticker/24hr?symbol=${symbol}USDT`,
        3000
      );

      return {
        symbol,
        price: num(x.lastPrice),
        change1h: null,
        change24h: num(x.priceChangePercent),
        change7d: null,
        volume24h: num(x.quoteVolume),
        marketCap: null,
        source: "Binance"
      };

    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(lastError || "Binance unavailable");
}

async function asset(symbol) {
  try {
    return await coinLore(symbol);
  } catch (err) {
    const x = await binance(symbol);
    x.fallbackReason = err.message;
    return x;
  }
}

function marketContext(zec, btc, eth) {
  let score = 0;

  if (btc?.change24h > 0) score++;
  if (btc?.change24h >= 2) score++;

  if (btc?.change24h < 0) score--;
  if (btc?.change24h <= -2) score--;

  if (eth?.change24h > 0) score++;
  if (eth?.change24h >= 2) score++;

  if (eth?.change24h < 0) score--;
  if (eth?.change24h <= -2) score--;

  const regime =
    score >= 3
      ? "RISK_ON"
      : score <= -3
        ? "RISK_OFF"
        : "NEUTRAL";

  let relativeStrength = "NEUTRAL";

  if (
    zec?.change24h != null &&
    btc?.change24h != null &&
    eth?.change24h != null
  ) {
    const rel =
      zec.change24h -
      (btc.change24h + eth.change24h) / 2;

    if (rel >= 2) {
      relativeStrength = "STRONG";
    } else if (rel <= -2) {
      relativeStrength = "WEAK";
    }
  }

  return {
    regime,
    score,
    relativeStrength
  };
}

async function marketData() {
  const results = await Promise.allSettled([
    asset("ZEC"),
    asset("BTC"),
    asset("ETH")
  ]);

  const market = {
    ZEC:
      results[0].status === "fulfilled"
        ? results[0].value
        : null,

    BTC:
      results[1].status === "fulfilled"
        ? results[1].value
        : null,

    ETH:
      results[2].status === "fulfilled"
        ? results[2].value
        : null
  };

  return {
    market,
    context: marketContext(
      market.ZEC,
      market.BTC,
      market.ETH
    )
  };
}

/* =========================================================
   FRED MACRO
========================================================= */

async function fredSeries(id, key, timeout = 7000) {
  const params = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: "json",
    sort_order: "desc",
    limit: "5"
  });

  const data = await getJSON(
    `https://api.stlouisfed.org/fred/series/observations?${params}`,
    timeout
  );

  const values = (data.observations || []).filter(
    x =>
      x.value !== "." &&
      Number.isFinite(Number(x.value))
  );

  if (!values.length) {
    throw new Error("No observations");
  }

  return {
    seriesId: id,
    name: FRED[id],
    value: Number(values[0].value),
    date: values[0].date,

    previousValue:
      values[1]
        ? Number(values[1].value)
        : null,

    change:
      values[1]
        ? Number(values[0].value) -
          Number(values[1].value)
        : null,

    source: "FRED"
  };
}

function macroAnalysis(indicators) {
  let score = 0;
  const reasons = [];

  if (indicators.DTWEXBGS?.change > 0) {
    score++;

    reasons.push(
      "美元指数走强，对加密资产形成压力"
    );
  }

  if (indicators.DTWEXBGS?.change < 0) {
    score--;

    reasons.push(
      "美元指数回落，对风险资产相对有利"
    );
  }

  if (indicators.VIXCLS?.value >= 30) {
    score += 3;

    reasons.push(
      "VIX高于30，市场压力显著升高"
    );

  } else if (indicators.VIXCLS?.value >= 20) {
    score += 2;

    reasons.push(
      "VIX高于20，市场风险偏好谨慎"
    );
  }

  if (indicators.DGS10?.change >= 0.08) {
    score += 2;

    reasons.push(
      "美国10年期国债收益率上升"
    );
  }

  if (indicators.CPIAUCSL?.change > 0) {
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

    riskScore: score,
    reasons
  };
}

async function macroData(env, fast = false) {
  if (!env.FRED_API_KEY) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      risk: "UNKNOWN",
      regime: "UNKNOWN",
      messageCN: "FRED API密钥尚未配置"
    };
  }

  const indicators = {};
  const errors = [];

  for (const id of Object.keys(FRED)) {
    try {
      indicators[id] = await fredSeries(
        id,
        env.FRED_API_KEY,
        fast ? 3500 : 10000
      );

    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }

    if (!fast) {
      await sleep(60);
    }
  }

  const count = Object.keys(indicators).length;

  if (!count) {
    return {
      ok: false,
      status: "DATA_UNAVAILABLE",
      risk: "UNKNOWN",
      regime: "UNKNOWN",
      indicators,
      successfulSeries: 0,
      totalSeries: Object.keys(FRED).length,
      errors,
      messageCN: "FRED宏观数据暂时不可用"
    };
  }

  return {
    ok: true,

    status:
      count === Object.keys(FRED).length
        ? "OK"
        : "DEGRADED",

    source: "FRED",

    requestMode:
      fast
        ? "FAST_SEQUENTIAL"
        : "SEQUENTIAL",

    successfulSeries: count,
    totalSeries: Object.keys(FRED).length,

    ...macroAnalysis(indicators),

    indicators,
    errors,

    messageCN:
      count === Object.keys(FRED).length
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
      Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${today()}T00:00:00Z`)
    ) / 86400000
  );
}

/* =========================================================
   ECONOMIC EVENT RADAR V4.7
========================================================= */

async function releaseDates(
  release,
  key,
  timeout = 7000
) {
  const end = new Date(
    Date.now() + 45 * 86400000
  )
    .toISOString()
    .slice(0, 10);

  const params = new URLSearchParams({
    release_id: String(release.id),
    api_key: key,
    file_type: "json",
    realtime_start: today(),
    realtime_end: end,
    include_release_dates_with_no_data: "true",
    sort_order: "asc",
    limit: "20"
  });

  const data = await getJSON(
    `https://api.stlouisfed.org/fred/release/dates?${params}`,
    timeout
  );

  return (data.release_dates || [])
    .map(x => x.date)
    .filter(date => date >= today())
    .map(date => ({
      eventType: "ECONOMIC_DATA",
      releaseId: release.id,
      family: `FRED-${release.id}`,
      name: release.name,
      nameCN: release.nameCN,
      impact: release.impact,
      date,
      daysAway: daysAway(date),
      source: "FRED"
    }));
}

/*
  V4.7 rule:
  For each FRED release family, only the nearest upcoming
  release contributes to event risk.

  This prevents recurring/duplicate release dates from
  artificially multiplying risk.
*/
function nearestPerReleaseFamily(events) {
  const map = new Map();

  const sorted = [...events].sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  for (const event of sorted) {
    if (!map.has(event.family)) {
      map.set(event.family, event);
    }
  }

  return [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date)
  );
}

function fomcEvents() {
  return FOMC_2026
    .filter(x => x.date >= today())
    .map(x => ({
      eventType: "FOMC",
      releaseId: null,
      family: `FOMC-${x.date}`,
      name: "Federal Open Market Committee Meeting",
      nameCN: "美联储 FOMC 利率决议",
      impact: "HIGH",
      meetingStart: x.start,
      date: x.date,
      daysAway: daysAway(x.date),
      source: "Federal Reserve Official Calendar",
      verified: true
    }));
}

function eventRiskScore(events) {
  let score = 0;
  const reasons = [];

  for (const event of events) {
    if (event.daysAway < 0) {
      continue;
    }

    let contribution = 0;

    if (event.impact === "HIGH") {
      if (event.daysAway <= 1) {
        contribution = 3;
      } else if (event.daysAway <= 3) {
        contribution = 2;
      } else if (event.daysAway <= 7) {
        contribution = 1;
      }
    }

    if (contribution > 0) {
      score += contribution;

      reasons.push(
        `${event.nameCN}: ${event.date} (${event.daysAway}天)`
      );
    }
  }

  score = clamp(score, 0, 6);

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

async function eventData(env, fast = false) {
  if (!env.FRED_API_KEY) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      risk: "UNKNOWN",
      score: null,
      events: [],
      messageCN: "经济事件雷达未配置"
    };
  }

  let rawFredEvents = [];
  const errors = [];

  for (const release of RELEASES) {
    try {
      const dates = await releaseDates(
        release,
        env.FRED_API_KEY,
        fast ? 3000 : 10000
      );

      rawFredEvents.push(...dates);

    } catch (err) {
      errors.push(
        `${release.name}: ${err.message}`
      );
    }

    if (!fast) {
      await sleep(60);
    }
  }

  const fredEvents =
    nearestPerReleaseFamily(rawFredEvents);

  const officialFomc =
    fomcEvents();

  const events = [
    ...fredEvents,
    ...officialFomc
  ].sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  if (
    !events.length &&
    errors.length === RELEASES.length
  ) {
    return {
      ok: false,
      status: "DATA_UNAVAILABLE",
      risk: "UNKNOWN",
      score: null,
      events: [],
      errors,
      messageCN: "经济事件数据暂时不可用"
    };
  }

  const analysis =
    eventRiskScore(events);

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

    risk: analysis.risk,
    score: analysis.score,

    nextEvent:
      events[0] || null,

    events:
      events.slice(0, 10),

    rawFredEventCount:
      rawFredEvents.length,

    uniqueFredReleaseFamilies:
      fredEvents.length,

    fomcEventCount:
      officialFomc.length,

    deduplication:
      "NEAREST_EVENT_PER_RELEASE_FAMILY",

    reasons:
      analysis.reasons,

    errors,

    messageCN:
      analysis.risk === "HIGH"
        ? "近期存在高影响经济事件，需要提高风险控制"
        : analysis.risk === "MEDIUM"
          ? "近期经济事件风险需要关注"
          : "近期经济事件风险相对有限",

    noteCN:
      "FRED发布日期与FOMC政策会议已分开处理。事件日期仅用于风险监控，不代表市场必然产生特定方向反应。"
  };
}

/* =========================================================
   GEOPOLITICAL INTELLIGENCE
========================================================= */

function geoUnknown(
  reason,
  error = null,
  status = "DATA_DEGRADED"
) {
  return {
    ok: false,
    status,
    dataAvailable: false,
    source: "GDELT",
    risk: "UNKNOWN",
    score: null,
    confidence: 0,
    reason,
    reasons: [reason],
    groups: [],
    headlines: [],
    errors:
      error
        ? [String(error)]
        : [],

    messageCN:
      "地缘政治数据源暂时不可用，因此风险保持未知，不会被错误判断为低风险。",

    methodology:
      "Unavailable geopolitical data is UNKNOWN, never LOW."
  };
}

function analyseGeo(articles) {
  const groups = {};

  for (const key of Object.keys(GEO_WORDS)) {
    groups[key] = {
      id: key,
      count: 0,
      weight: GEO_WEIGHT[key]
    };
  }

  for (const article of articles) {
    const title =
      String(article.title || "")
        .toLowerCase();

    for (
      const [key, words]
      of Object.entries(GEO_WORDS)
    ) {
      if (
        words.some(
          word => title.includes(word)
        )
      ) {
        groups[key].count++;
      }
    }
  }

  let score = 0;
  const reasons = [];

  for (const group of Object.values(groups)) {
    if (group.count >= 10) {
      score += group.weight;

    } else if (group.count >= 5) {
      score += Math.max(
        1,
        group.weight - 1
      );

    } else if (group.count >= 2) {
      score++;
    }

    if (group.count >= 2) {
      reasons.push(
        `${group.id}: ${group.count} monitored headlines`
      );
    }
  }

  score = clamp(score, 0, 10);

  return {
    risk:
      score >= 7
        ? "HIGH"
        : score >= 3
          ? "MEDIUM"
          : "LOW",

    score,
    reasons,
    groups: Object.values(groups)
  };
}

async function geopoliticalData(timeout = 5500) {
  const params = new URLSearchParams({
    query: GEO_QUERY,
    mode: "ArtList",
    maxrecords: "25",
    format: "json",
    sort: "DateDesc",
    timespan: "24h"
  });

  try {
    const data = await getJSON(
      `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
      timeout
    );

    if (!Array.isArray(data?.articles)) {
      return geoUnknown(
        "GDELT returned no usable dataset."
      );
    }

    const articles = data.articles
      .slice(0, 25)
      .map(x => ({
        title: x.title || null,
        url: x.url || null,
        domain: x.domain || null,
        sourceCountry:
          x.sourcecountry || null,
        seenDate:
          x.seendate || null
      }))
      .filter(x => x.title);

    if (!articles.length) {
      return {
        ok: true,
        status: "LIMITED_DATA",
        dataAvailable: true,
        source: "GDELT",
        risk: "UNKNOWN",
        score: null,
        confidence: 20,

        reasons: [
          "No usable monitored headlines returned."
        ],

        groups: [],
        headlines: [],
        errors: [],

        messageCN:
          "新闻样本不足，地缘政治风险保持未知。",

        methodology:
          "Insufficient news samples are not classified as LOW risk."
      };
    }

    const analysis =
      analyseGeo(articles);

    return {
      ok: true,
      status: "OK",
      dataAvailable: true,
      source: "GDELT",

      ...analysis,

      confidence:
        articles.length >= 20
          ? 85
          : articles.length >= 10
            ? 70
            : 55,

      articleCount:
        articles.length,

      requestCount: 1,

      headlines:
        articles.slice(0, 10),

      errors: [],

      messageCN:
        analysis.risk === "HIGH"
          ? "全球地缘政治新闻风险较高"
          : analysis.risk === "MEDIUM"
            ? "全球地缘政治风险需要关注"
            : "当前新闻样本未显示明显高风险",

      methodology:
        "Single-request geopolitical news monitor. News context never independently creates BUY or SELL signals."
    };

  } catch (err) {
    if (err?.status === 429) {
      return geoUnknown(
        "GDELT rate limited the request. Geopolitical risk is UNKNOWN.",
        "HTTP 429",
        "RATE_LIMITED"
      );
    }

    if (
      err?.code === "TIMEOUT" ||
      err?.message === "TIMEOUT"
    ) {
      return geoUnknown(
        `GDELT did not respond within ${(timeout / 1000).toFixed(1)} seconds. Geopolitical risk is UNKNOWN.`,
        "TIMEOUT",
        "TIMEOUT"
      );
    }

    return geoUnknown(
      "GDELT source unavailable. Geopolitical risk is UNKNOWN.",
      err?.message || String(err)
    );
  }
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

  /*
    Geo contributes only if actual usable risk
    intelligence exists.

    UNKNOWN receives ZERO positive confidence.
  */
  if (
    geo?.ok &&
    geo?.dataAvailable &&
    geo.risk !== "UNKNOWN"
  ) {
    confidence += Math.round(
      15 *
      (geo.confidence || 0) /
      100
    );
  }

  confidence =
    clamp(confidence, 0, 100);

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

    messageCN:
      status === "OK"
        ? "数据质量良好"
        : status === "DEGRADED"
          ? "部分情报源不可用，决策置信度已自动降低"
          : "数据不足，只能进行谨慎观察",

    rule:
      "Unavailable intelligence is never treated as LOW risk."
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

  if (context.regime === "RISK_OFF") {
    score += 2;

    reasons.push(
      "加密市场环境偏向风险规避"
    );
  }

  if (context.regime === "RISK_ON") {
    score--;
  }

  if (macro?.regime === "RISK_OFF") {
    score += 3;

    reasons.push(
      "宏观经济环境处于风险规避状态"
    );
  }

  if (macro?.regime === "RISK_ON") {
    score--;
  }

  if (events?.risk === "HIGH") {
    score += 3;

    reasons.push(
      "高影响经济事件临近"
    );

  } else if (
    events?.risk === "MEDIUM"
  ) {
    score++;

    reasons.push(
      "近期存在需要关注的经济事件"
    );
  }

  if (geo?.risk === "HIGH") {
    score += 2;

    reasons.push(
      "地缘政治监控风险较高"
    );

  } else if (
    geo?.risk === "MEDIUM"
  ) {
    score++;

    reasons.push(
      "地缘政治风险需要关注"
    );

  } else if (
    geo?.risk === "UNKNOWN"
  ) {
    reasons.push(
      "地缘政治风险未知，不采用低风险假设"
    );
  }

  score =
    clamp(score, 0, 10);

  const risk =
    score >= 7
      ? "HIGH"
      : score >= 4
        ? "MEDIUM"
        : "LOW";

  const posture =
    score >= 7
      ? "DEFENSIVE"
      : score >= 4
        ? "CAUTIOUS"
        : "NORMAL";

  const reliability =
    qualityData.confidence < 60
      ? "LOW"
      : qualityData.confidence < 90
        ? "MEDIUM"
        : "HIGH";

  let signalPermission = "NORMAL";

  if (qualityData.confidence < 60) {
    signalPermission =
      "CAUTION_ONLY";

  } else if (
    geo?.risk === "UNKNOWN"
  ) {
    signalPermission =
      "REDUCED_CONFIDENCE";
  }

  return {
    risk,
    riskScore: score,
    posture,

    postureCN:
      posture === "DEFENSIVE"
        ? "防御"
        : posture === "CAUTIOUS"
          ? "谨慎"
          : "正常观察",

    decisionReliability:
      reliability,

    signalPermission,

    dataConfidence:
      qualityData.confidence,

    reasons,

    messageCN:
      risk === "HIGH"
        ? "综合风险较高，应优先控制风险并等待更清晰确认"
        : risk === "MEDIUM"
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
  const zec = market.ZEC;

  if (!zec) {
    return {
      action: "DATA UNAVAILABLE",
      actionCN: "市场数据不足",
      trend: "UNKNOWN",
      setupScore: 0,
      entryQuality: 0,
      chaseRisk: "UNKNOWN",
      reasons: [
        "ZEC市场数据不可用"
      ]
    };
  }

  let bear = 0;
  let bull = 0;

  const reasons = [];

  if (zec.change24h != null) {
    if (zec.change24h <= -4) {
      bear += 3;

      reasons.push(
        "ZEC 24小时下跌动能较强"
      );

    } else if (zec.change24h < 0) {
      bear++;

      reasons.push(
        "ZEC 24小时动能偏弱"
      );

    } else if (zec.change24h >= 4) {
      bull += 3;

      reasons.push(
        "ZEC 24小时上涨动能较强"
      );

    } else if (zec.change24h > 0) {
      bull++;
    }
  }

  if (context.relativeStrength === "WEAK") {
    bear += 2;

    reasons.push(
      "ZEC表现弱于BTC和ETH"
    );
  }

  if (context.relativeStrength === "STRONG") {
    bull += 2;

    reasons.push(
      "ZEC表现强于BTC和ETH"
    );
  }

  if (macro?.regime === "RISK_OFF") {
    bear += 2;

    reasons.push(
      "宏观环境偏向风险规避"
    );
  }

  if (macro?.regime === "RISK_ON") {
    bull++;
  }

  const trend =
    bear >= bull + 2
      ? "BEARISH"
      : bull >= bear + 2
        ? "BULLISH"
        : "NEUTRAL";

  let setup = clamp(
    35 +
    Math.abs(bear - bull) * 9,
    0,
    100
  );

  if (trend === "NEUTRAL") {
    setup =
      Math.min(setup, 45);
  }

  const move =
    Math.abs(zec.change24h || 0);

  const chaseRisk =
    move >= 7
      ? "HIGH"
      : move >= 4
        ? "MEDIUM"
        : "LOW";

  let entryQuality = 70;

  if (chaseRisk === "MEDIUM") {
    entryQuality -= 20;
  }

  if (chaseRisk === "HIGH") {
    entryQuality -= 40;
  }

  if (globalRisk.risk === "HIGH") {
    entryQuality -= 20;
  }

  if (globalRisk.risk === "MEDIUM") {
    entryQuality -= 10;
  }

  if (geo?.risk === "UNKNOWN") {
    entryQuality -= 5;
  }

  if (events?.risk === "HIGH") {
    entryQuality -= 10;
  }

  entryQuality =
    clamp(entryQuality, 0, 100);

  let action =
    "WAIT FOR CONFIRMATION";

  let actionCN =
    "等待确认";

  /*
    We do not force BUY/SELL.
    A directional setup is only allowed when
    data quality and entry conditions are strong.
  */
  if (
    trend === "BULLISH" &&
    setup >= 70 &&
    entryQuality >= 70 &&
    globalRisk.risk !== "HIGH" &&
    globalRisk.signalPermission === "NORMAL"
  ) {
    action =
      "BULLISH SETUP";

    actionCN =
      "看涨条件正在形成";
  }

  if (
    trend === "BEARISH" &&
    setup >= 70 &&
    entryQuality >= 70 &&
    globalRisk.risk !== "HIGH" &&
    globalRisk.signalPermission === "NORMAL"
  ) {
    action =
      "BEARISH SETUP";

    actionCN =
      "看跌条件正在形成";
  }

  if (chaseRisk === "HIGH") {
    action =
      "WAIT FOR CONFIRMATION";

    actionCN =
      "避免追涨杀跌，等待确认";
  }

  if (
    globalRisk.signalPermission ===
    "CAUTION_ONLY"
  ) {
    action =
      "WAIT FOR CONFIRMATION";

    actionCN =
      "数据不足，等待更多确认";
  }

  return {
    action,
    actionCN,
    trend,

    setupScore:
      Math.round(setup),

    entryQuality:
      Math.round(entryQuality),

    chaseRisk,

    reasons,

    methodologyCN:
      "趋势与入场行动分开判断；强趋势并不代表应该立即追单。"
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
    regime: "UNKNOWN",
    score: 0,
    relativeStrength: "UNKNOWN"
  }
};

const macroFallback = {
  ok: false,
  status: "TIME_BUDGET_EXCEEDED",
  risk: "UNKNOWN",
  regime: "UNKNOWN",

  messageCN:
    "综合分析时间预算内未完成宏观数据读取，风险保持未知。"
};

const eventsFallback = {
  ok: false,
  status: "TIME_BUDGET_EXCEEDED",
  risk: "UNKNOWN",
  score: null,
  events: [],

  messageCN:
    "综合分析时间预算内未完成事件数据读取，风险保持未知。"
};

/* =========================================================
   INTELLIGENCE
========================================================= */

async function intelligence(env) {
  const started = Date.now();

  const tasks = [
    Promise.race([
      marketData(),

      timeoutValue(
        7000,
        marketFallback
      )
    ]),

    Promise.race([
      macroData(env, true),

      timeoutValue(
        9000,
        macroFallback
      )
    ]),

    Promise.race([
      eventData(env, true),

      timeoutValue(
        9000,
        eventsFallback
      )
    ]),

    Promise.race([
      geopoliticalData(1800),

      timeoutValue(
        2200,

        geoUnknown(
          "Geopolitical source exceeded the V4.7 intelligence time budget. Risk remains UNKNOWN.",
          "TIME_BUDGET_EXCEEDED",
          "TIME_BUDGET_EXCEEDED"
        )
      )
    ])
  ];

  const [
    marketResult,
    macro,
    events,
    geo
  ] = await Promise.all(tasks);

  const dataQuality = quality(
    marketResult.market,
    macro,
    events,
    geo
  );

  const globalRisk = fusion(
    marketResult.context,
    macro,
    events,
    geo,
    dataQuality
  );

  const decision = decisionContext(
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
        marketResult.market.ZEC
      ),

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    mission:
      "V4.7 Stable Intelligence Mission",

    language:
      "zh-CN",

    timestamp:
      new Date().toISOString(),

    elapsedMs:
      Date.now() - started,

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
      "V4.7 Stable Intelligence Mission",

    status:
      "ONLINE",

    language:
      "zh-CN",

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
          ? "ACTIVE · DEDUPED"
          : "NOT CONFIGURED",

      fomcCalendar:
        "ACTIVE · OFFICIAL 2026 CALENDAR",

      geopoliticalEngine:
        "ACTIVE · SINGLE REQUEST · FAST-FAIL",

      dataQualityEngine:
        "ACTIVE",

      globalRiskFusion:
        "ACTIVE",

      chineseIntelligence:
        "ACTIVE",

      decisionContext:
        "ACTIVE",

      intelligenceDeadline:
        "ACTIVE"
    },

    policies: {
      fredStandalone:
        "SEQUENTIAL",

      economicEvents:
        "NEAREST EVENT PER FRED RELEASE FAMILY",

      fomc:
        "SEPARATE FROM FRED RELEASE DATES",

      intelligenceMacro:
        "FAST_SEQUENTIAL · 9s BUDGET",

      intelligenceEvents:
        "FAST_SEQUENTIAL · 9s BUDGET",

      geopoliticalMaxRequests:
        1,

      geopoliticalStandaloneTimeoutSeconds:
        5.5,

      geopoliticalIntelligenceTimeoutSeconds:
        1.8,

      geopoliticalFailure:
        "UNKNOWN",

      unavailableRisk:
        "UNKNOWN",

      unavailableIsLow:
        false,

      forcedBuySell:
        false
    },

    fredSecretConfigured:
      Boolean(env.FRED_API_KEY),

    messageCN:
      "ZEC AI Intelligence V4.7.0运行正常",

    timestamp:
      new Date().toISOString(),

    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。"
  };
}

/* =========================================================
   ROUTER
========================================================= */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(
        null,
        {
          status: 204,
          headers: HEADERS
        }
      );
    }

    const url =
      new URL(request.url);

    try {
      if (
        url.pathname === "/" ||
        url.pathname === "/status"
      ) {
        return reply(
          status(env)
        );
      }

      if (url.pathname === "/market") {
        const result =
          await marketData();

        return reply({
          ok: true,
          version: VERSION,
          timestamp:
            new Date().toISOString(),

          ...result
        });
      }

      if (url.pathname === "/macro") {
        return reply(
          await macroData(env)
        );
      }

      if (url.pathname === "/events") {
        return reply(
          await eventData(env)
        );
      }

      if (
        url.pathname ===
        "/geopolitical"
      ) {
        return reply(
          await geopoliticalData(5500)
        );
      }

      if (
        url.pathname ===
        "/intelligence"
      ) {
        return reply(
          await intelligence(env)
        );
      }

      if (
        url.pathname ===
        "/fred-test"
      ) {
        if (!env.FRED_API_KEY) {
          return reply(
            {
              ok: false,
              version: VERSION,
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
            version: VERSION,

            test:
              "FRED_SINGLE_SERIES",

            elapsedMs:
              Date.now() - started,

            result
          });

        } catch (err) {
          return reply(
            {
              ok: false,
              version: VERSION,

              test:
                "FRED_SINGLE_SERIES",

              elapsedMs:
                Date.now() - started,

              error:
                err.message
            },
            502
          );
        }
      }

      return reply(
        {
          ok: false,
          version: VERSION,

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
            "/fred-test"
          ]
        },
        404
      );

    } catch (err) {
      return reply(
        {
          ok: false,
          version: VERSION,

          timestamp:
            new Date().toISOString(),

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
