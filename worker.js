/* ZEC AI Intelligence Worker V4.7.1
   Multi-Source Geopolitical Intelligence
   Market research & simulation only.
*/

const VERSION = "4.7.1";

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

/*
  Official scheduled 2026 FOMC meeting decision dates.
  FRED release dates are NOT used as FOMC meeting dates.
*/
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
   GEOPOLITICAL CONFIGURATION
========================================================= */

const GEO_CATEGORIES = {
  WAR: {
    weight: 3,
    words: [
      "war",
      "military",
      "missile",
      "missiles",
      "invasion",
      "airstrike",
      "air strike",
      "attack",
      "attacks",
      "conflict",
      "drone strike",
      "ceasefire"
    ]
  },

  SANCTIONS: {
    weight: 2,
    words: [
      "sanction",
      "sanctions",
      "embargo",
      "asset freeze"
    ]
  },

  ENERGY: {
    weight: 2,
    words: [
      "oil",
      "opec",
      "pipeline",
      "energy supply",
      "crude oil",
      "natural gas"
    ]
  },

  TRADE: {
    weight: 2,
    words: [
      "tariff",
      "tariffs",
      "trade war",
      "export control",
      "export controls",
      "trade restrictions"
    ]
  },

  SHIPPING: {
    weight: 3,
    words: [
      "red sea",
      "strait of hormuz",
      "suez canal",
      "shipping",
      "shipping route",
      "shipping routes",
      "vessel attack"
    ]
  }
};

const GOOGLE_GEO_QUERY =
  '("war" OR "military" OR "missile" OR "sanctions" OR "tariff" OR "Red Sea" OR "Strait of Hormuz" OR "Suez Canal" OR "OPEC" OR "oil supply") when:1d';

const GDELT_QUERY =
  '(war OR military OR missile OR sanctions OR embargo OR tariff OR "trade war" OR "Red Sea" OR "Strait of Hormuz" OR "Suez Canal" OR OPEC OR pipeline)';

/* =========================================================
   GENERAL HELPERS
========================================================= */

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
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function timeoutValue(ms, value) {
  return new Promise(
    resolve => setTimeout(
      () => resolve(value),
      ms
    )
  );
}

function cleanText(v) {
  return String(v || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(v) {
  return cleanText(v)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValue(block, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const match = String(block || "").match(re);

  return match
    ? cleanText(match[1])
    : null;
}

function xmlLink(block) {
  const direct =
    xmlValue(block, "link");

  if (direct) {
    return direct;
  }

  const atom = String(block || "").match(
    /<link[^>]+href=["']([^"']+)["'][^>]*>/i
  );

  return atom
    ? cleanText(atom[1])
    : null;
}

function parseRSS(xml, sourceName) {
  const text = String(xml || "");

  let blocks =
    text.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  if (!blocks.length) {
    blocks =
      text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  }

  const items = [];

  for (const block of blocks) {
    const title =
      xmlValue(block, "title");

    if (!title) {
      continue;
    }

    const source =
      xmlValue(block, "source") ||
      sourceName;

    const published =
      xmlValue(block, "pubDate") ||
      xmlValue(block, "published") ||
      xmlValue(block, "updated");

    items.push({
      title,
      url: xmlLink(block),
      publisher: source,
      published: published || null,
      feedSource: sourceName
    });
  }

  return items;
}

async function getJSON(
  url,
  timeout = 7000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent":
              `ZEC-AI-Intelligence/${VERSION}`
          }
        }
      );

    if (!response.ok) {
      const err =
        new Error(
          `HTTP ${response.status}`
        );

      err.status =
        response.status;

      throw err;
    }

    return await response.json();

  } catch (err) {
    if (
      err &&
      err.name === "AbortError"
    ) {
      const timeoutError =
        new Error("TIMEOUT");

      timeoutError.code =
        "TIMEOUT";

      throw timeoutError;
    }

    throw err;

  } finally {
    clearTimeout(timer);
  }
}

async function getText(
  url,
  timeout = 5000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal: controller.signal,
          headers: {
            Accept:
              "application/rss+xml, application/xml, text/xml, text/plain, */*",

            "User-Agent":
              `ZEC-AI-Intelligence/${VERSION}`
          }
        }
      );

    if (!response.ok) {
      const err =
        new Error(
          `HTTP ${response.status}`
        );

      err.status =
        response.status;

      throw err;
    }

    return await response.text();

  } catch (err) {
    if (
      err &&
      err.name === "AbortError"
    ) {
      const timeoutError =
        new Error("TIMEOUT");

      timeoutError.code =
        "TIMEOUT";

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
      num(x.percent_change_1h),

    change24h:
      num(x.percent_change_24h),

    change7d:
      num(x.percent_change_7d),

    volume24h:
      num(x.volume24),

    marketCap:
      num(x.market_cap_usd),

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
  let lastError = "";

  for (const host of BINANCE) {
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
          num(x.priceChangePercent),

        change7d:
          null,

        volume24h:
          num(x.quoteVolume),

        marketCap:
          null,

        source:
          "Binance"
      };

    } catch (err) {
      lastError =
        err.message;
    }
  }

  throw new Error(
    lastError ||
    "Binance unavailable"
  );
}

async function asset(symbol) {
  try {
    return await coinLore(symbol);

  } catch (err) {
    const x =
      await binance(symbol);

    x.fallbackReason =
      err.message;

    return x;
  }
}

function marketContext(
  zec,
  btc,
  eth
) {
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

    } else if (rel <= -2) {
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
    (data.observations || [])
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
    seriesId:
      id,

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

function macroAnalysis(indicators) {
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
  if (!env.FRED_API_KEY) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      risk: "UNKNOWN",
      regime: "UNKNOWN",
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
        `${id}: ${err.message}`
      );
    }

    if (!fast) {
      await sleep(60);
    }
  }

  const total =
    Object.keys(FRED).length;

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

      successfulSeries:
        0,

      totalSeries:
        total,

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
        String(release.id),

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
    data.release_dates || []
  )
    .map(x => x.date)
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
    const event of
    sorted
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
          "HIGH
