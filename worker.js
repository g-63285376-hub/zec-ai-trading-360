/*
  ZEC AI Intelligence Worker V4.5.2
  --------------------------------------------------
  FAST-FAIL GEOPOLITICAL ENGINE

  Market:
    CoinLore primary
    Binance fallback

  Macro:
    FRED

  Intelligence:
    Economic Event Radar
    Geopolitical Intelligence
    Data Quality Engine
    Global Risk Fusion

  V4.5.2:
    ONE combined GDELT request
    6-second geopolitical timeout
    NO retry loop
    429 / timeout => UNKNOWN
    Geopolitical failure never => LOW
    Market / Macro / Events remain independent

  Market research & simulation only.
  Not investment advice.
*/

const VERSION = "4.5.2";

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
   HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: CORS
    }
  );
}

function clamp(v, min, max) {
  return Math.max(
    min,
    Math.min(max, v)
  );
}

function number(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

async function fetchJSON(
  url,
  options = {},
  timeout = 9000
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
          ...options,
          signal: controller.signal,
          headers: {
            "User-Agent":
              "ZEC-AI-Intelligence/4.5.2",
            ...(options.headers || {})
          }
        }
      );

    if (!response.ok) {
      const error =
        new Error(
          `HTTP ${response.status}`
        );

      error.status =
        response.status;

      throw error;
    }

    return await response.json();

  } catch (e) {

    if (
      e?.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error("TIMEOUT");

      timeoutError.code =
        "TIMEOUT";

      throw timeoutError;
    }

    throw e;

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   COINLORE MARKET
========================================================= */

async function coinLoreCoin(symbol) {

  const id =
    COINLORE_IDS[symbol];

  if (!id) {
    throw new Error(
      "Unknown CoinLore symbol"
    );
  }

  const data =
    await fetchJSON(
      `https://api.coinlore.net/api/ticker/?id=${id}`
    );

  if (
    !Array.isArray(data) ||
    !data[0]
  ) {
    throw new Error(
      `CoinLore ${symbol}: invalid response`
    );
  }

  const x = data[0];

  return {
    symbol,
    name:
      x.name || symbol,

    price:
      number(x.price_usd),

    change1h:
      number(
        x.percent_change_1h
      ),

    change24h:
      number(
        x.percent_change_24h
      ),

    change7d:
      number(
        x.percent_change_7d
      ),

    marketCap:
      number(
        x.market_cap_usd
      ),

    volume24h:
      number(
        x.volume24
      ),

    rank:
      number(x.rank),

    source:
      "CoinLore",

    sourceId:
      id
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

  const pair =
    `${symbol}USDT`;

  let lastError = "";

  for (
    const host of
    BINANCE_HOSTS
  ) {

    try {

      const x =
        await fetchJSON(
          `${host}/api/v3/ticker/24hr?symbol=${pair}`,
          {},
          4500
        );

      return {
        symbol,
        name: symbol,

        price:
          number(
            x.lastPrice
          ),

        change1h:
          null,

        change24h:
          number(
            x.priceChangePercent
          ),

        change7d:
          null,

        marketCap:
          null,

        volume24h:
          number(
            x.quoteVolume
          ),

        rank:
          null,

        source:
          "Binance",

        sourceId:
          pair
      };

    } catch (e) {

      lastError +=
        `${host}: ${e.message} | `;
    }
  }

  throw new Error(
    lastError
  );
}

async function marketCoin(symbol) {

  try {

    return await coinLoreCoin(
      symbol
    );

  } catch (coinLoreError) {

    const fallback =
      await binance24(
        symbol
      );

    fallback.fallbackReason =
      coinLoreError.message;

    return fallback;
  }
}

/* =========================================================
   MARKET CONTEXT
========================================================= */

function marketContext(
  zec,
  btc,
  eth
) {

  let score = 0;

  const reasons = [];

  if (
    btc?.change24h != null
  ) {

    if (
      btc.change24h >= 2
    ) {

      score += 2;

      reasons.push(
        "BTC 24H momentum positive"
      );

    } else if (
      btc.change24h > 0
    ) {

      score += 1;

    } else if (
      btc.change24h <= -2
    ) {

      score -= 2;

      reasons.push(
        "BTC 24H momentum weak"
      );

    } else {

      score -= 1;
    }
  }

  if (
    eth?.change24h != null
  ) {

    if (
      eth.change24h >= 2
    ) {
      score += 2;

    } else if (
      eth.change24h > 0
    ) {
      score += 1;

    } else if (
      eth.change24h <= -2
    ) {
      score -= 2;

    } else {
      score -= 1;
    }
  }

  let regime =
    "NEUTRAL";

  if (
    score >= 3
  ) {
    regime =
      "RISK_ON";
  }

  if (
    score <= -3
  ) {
    regime =
      "RISK_OFF";
  }

  let relativeStrength =
    "NEUTRAL";

  if (
    zec?.change24h != null &&
    btc?.change24h != null &&
    eth?.change24h != null
  ) {

    const benchmark =
      (
        btc.change24h +
        eth.change24h
      ) / 2;

    const relative =
      zec.change24h -
      benchmark;

    if (
      relative >= 2
    ) {

      relativeStrength =
        "STRONG";

    } else if (
      relative <= -2
    ) {

      relativeStrength =
        "WEAK";
    }
  }

  return {
    regime,
    score,
    relativeStrength,
    reasons
  };
}

/* =========================================================
   FRED MACRO
========================================================= */

async function fredSeries(
  seriesId,
  meta,
  apiKey
) {

  const params =
    new URLSearchParams({
      series_id:
        seriesId,

      api_key:
        apiKey,

      file_type:
        "json",

      sort_order:
        "desc",

      limit:
        "10"
    });

  const data =
    await fetchJSON(
      `https://api.stlouisfed.org/fred/series/observations?${params}`,
      {},
      8000
    );

  const valid =
    (
      data.observations ||
      []
    ).filter(
      x =>
        x.value !== "." &&
        Number.isFinite(
          Number(x.value)
        )
    );

  if (
    !valid.length
  ) {
    throw new Error(
      `${seriesId}: no observations`
    );
  }

  const latest =
    valid[0];

  const previous =
    valid[1] || null;

  const value =
    Number(
      latest.value
    );

  const previousValue =
    previous
      ? Number(
          previous.value
        )
      : null;

  const change =
    previousValue == null
      ? null
      : value -
        previousValue;

  const changePercent =
    previousValue
      ? (
          change /
          Math.abs(
            previousValue
          )
        ) * 100
      : null;

  return {
    seriesId,

    name:
      meta.name,

    type:
      meta.type,

    value,

    date:
      latest.date,

    previousValue,

    previousDate:
      previous
        ? previous.date
        : null,

    change,

    changePercent,

    source:
      "FRED"
  };
}

function analyseMacro(
  indicators
) {

  let score = 0;

  const reasons = [];

  const dollar =
    indicators.DTWEXBGS;

  const vix =
    indicators.VIXCLS;

  const yield10 =
    indicators.DGS10;

  const cpi =
    indicators.CPIAUCSL;

  const unemployment =
    indicators.UNRATE;

  if (
    dollar?.change != null
  ) {

    if (
      dollar.change > 0
    ) {

      score += 1;

      reasons.push(
        "US dollar strengthening: crypto headwind"
      );

    } else if (
      dollar.change < 0
    ) {

      score -= 1;

      reasons.push(
        "US dollar easing: supportive for risk assets"
      );
    }
  }

  if (
    vix?.value != null
  ) {

    if (
      vix.value >= 30
    ) {

      score += 3;

      reasons.push(
        "VIX above 30: elevated market stress"
      );

    } else if (
      vix.value >= 20
    ) {

      score += 2;

      reasons.push(
        "VIX above 20: risk appetite cautious"
      );

    } else if (
      vix.value < 15
    ) {

      score -= 1;
    }
  }

  if (
    yield10?.change != null
  ) {

    if (
      yield10.change >=
      0.08
    ) {

      score += 2;

      reasons.push(
        "US 10Y yield rising: pressure on risk assets"
      );

    } else if (
      yield10.change <=
      -0.08
    ) {

      score -= 1;
    }
  }

  if (
    cpi?.changePercent !=
      null &&
    cpi.changePercent >
      0.2
  ) {

    score += 1;

    reasons.push(
      "Latest CPI index increase remains elevated"
    );
  }

  if (
    unemployment?.change !=
      null &&
    unemployment.change >=
      0.2
  ) {

    score += 1;

    reasons.push(
      "Unemployment rate increased"
    );
  }

  let regime =
    "NEUTRAL";

  let risk =
    "MEDIUM";

  if (
    score >= 3
  ) {

    regime =
      "RISK_OFF";

    risk =
      "HIGH";

  } else if (
    score <= -2
  ) {

    regime =
      "RISK_ON";

    risk =
      "LOW";
  }

  return {
    regime,
    risk,
    riskScore:
      score,
    reasons
  };
}

async function macroData(env) {

  if (
    !env.FRED_API_KEY
  ) {

    return {
      ok: false,

      status:
        "NOT_CONFIGURED",

      source:
        "FRED",

      risk:
        "UNKNOWN",

      regime:
        "UNKNOWN",

      error:
        "FRED_API_KEY not configured"
    };
  }

  const indicators = {};

  const errors = [];

  await Promise.all(
    Object.entries(
      FRED_SERIES
    ).map(
      async (
        [id, meta]
      ) => {

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
      }
    )
  );

  const count =
    Object.keys(
      indicators
    ).length;

  if (
    count === 0
  ) {

    return {
      ok: false,

      status:
        "DATA_UNAVAILABLE",

      version:
        VERSION,

      source:
        "FRED",

      timestamp:
        new Date()
          .toISOString(),

      risk:
        "UNKNOWN",

      regime:
        "UNKNOWN",

      riskScore:
        null,

      reasons: [
        "Macro source unavailable"
      ],

      indicators,

      errors
    };
  }

  const analysis =
    analyseMacro(
      indicators
    );

  return {
    ok: true,

    status:
      count ===
      Object.keys(
        FRED_SERIES
      ).length
        ? "OK"
        : "DEGRADED",

    version:
      VERSION,

    source:
      "FRED",

    timestamp:
      new Date()
        .toISOString(),

    availableIndicators:
      count,

    requestedIndicators:
      Object.keys(
        FRED_SERIES
      ).length,

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
    name:
      "Consumer Price Index",
    category:
      "INFLATION",
    impact:
      "HIGH"
  },

  {
    id: 50,
    name:
      "Employment Situation",
    category:
      "LABOR",
    impact:
      "HIGH"
  },

  {
    id: 53,
    name:
      "Gross Domestic Product",
    category:
      "GDP",
    impact:
      "HIGH"
  },

  {
    id: 101,
    name:
      "FOMC / Federal Reserve",
    category:
      "FED",
    impact:
      "HIGH"
  }
];

function utcDateOnly() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function daysBetween(
  dateString
) {

  const today =
    Date.parse(
      `${utcDateOnly()}T00:00:00Z`
    );

  const event =
    Date.parse(
      `${dateString}T00:00:00Z`
    );

  if (
    !Number.isFinite(
      event
    )
  ) {
    return null;
  }

  return Math.round(
    (
      event -
      today
    ) /
    86400000
  );
}

async function fredReleaseDates(
  release,
  apiKey
) {

  const today =
    utcDateOnly();

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
        String(
          release.id
        ),

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

  const data =
    await fetchJSON(
      `https://api.stlouisfed.org/fred/release/dates?${params}`,
      {},
      8000
    );

  const dates =
    (
      data.release_dates ||
      []
    )
      .map(
        x => x.date
      )
      .filter(Boolean)
      .filter(
        d =>
          d >= today
      )
      .sort();

  return dates.map(
    date => ({
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
        daysBetween(
          date
        ),

      source:
        "FRED"
    })
  );
}

function eventRisk(
  events
) {

  if (
    !events.length
  ) {

    return {
      risk:
        "LOW",

      score:
        0,

      nextEvent:
        null,

      reason:
        "No tracked high-impact release found in current window"
    };
  }

  const sorted =
    [...events].sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    );

  const next =
    sorted[0];

  let risk =
    "LOW";

  let score =
    1;

  if (
    next.daysAway <= 1
  ) {

    risk =
      "HIGH";

    score =
      4;

  } else if (
    next.daysAway <= 3
  ) {

    risk =
      "MEDIUM";

    score =
      3;

  } else if (
    next.daysAway <= 7
  ) {

    risk =
      "MEDIUM";

    score =
      2;
  }

  return {
    risk,
    score,
    nextEvent:
      next,

    reason:
      `${next.name} scheduled ${next.date}`
  };
}

async function economicEvents(
  env
) {

  if (
    !env.FRED_API_KEY
  ) {

    return {
      ok: false,

      status:
        "NOT_CONFIGURED",

      source:
        "FRED",

      risk:
        "UNKNOWN",

      score:
        null,

      error:
        "FRED_API_KEY not configured"
    };
  }

  const events = [];

  const errors = [];

  await Promise.all(
    IMPORTANT_RELEASES
      .map(
        async release => {

          try {

            const result =
              await fredReleaseDates(
                release,
                env.FRED_API_KEY
              );

            events.push(
              ...result
            );

          } catch (e) {

            errors.push(
              `${release.name}: ${e.message}`
            );
          }
        }
      )
  );

  const successCount =
    IMPORTANT_RELEASES.length -
    errors.length;

  if (
    successCount === 0
  ) {

    return {
      ok: false,

      status:
        "DATA_UNAVAILABLE",

      version:
        VERSION,

      source:
        "FRED",

      timestamp:
        new Date()
          .toISOString(),

      risk:
        "UNKNOWN",

      score:
        null,

      nextEvent:
        null,

      events: [],

      errors,

      note:
        "Economic event data unavailable. UNKNOWN is not LOW risk."
    };
  }

  const unique = [];

  const seen =
    new Set();

  for (
    const event of
    events.sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    )
  ) {

    const key =
      `${event.releaseId}-${event.date}`;

    if (
      !seen.has(key)
    ) {

      seen.add(key);

      unique.push(
        event
      );
    }
  }

  const analysis =
    eventRisk(
      unique
    );

  return {
    ok: true,

    status:
      errors.length
        ? "DEGRADED"
        : "OK",

    version:
      VERSION,

    source:
      "FRED",

    timestamp:
      new Date()
        .toISOString(),

    horizonDays:
      45,

    ...analysis,

    events:
      unique.slice(
        0,
        20
      ),

    errors,

    note:
      "FRED provides date-level release scheduling. Exact announcement time, consensus and surprise are not fabricated."
  };
}

/* =========================================================
   V4.5.2 FAST-FAIL GEOPOLITICAL ENGINE
========================================================= */

/*
  ONE combined query only.

  This replaces the previous
  5 separate GDELT calls.
*/

const GEO_COMBINED_QUERY =
  "(" +
  "war OR military OR missile OR invasion OR ceasefire " +
  "OR sanctions OR embargo " +
  "OR oil OR pipeline OR OPEC " +
  "OR tariff OR \"trade war\" OR \"export controls\" " +
  "OR \"Red Sea\" OR \"Strait of Hormuz\" OR \"Suez Canal\"" +
  ")";

const GEO_KEYWORDS = {

  WAR: [
    "war",
    "military",
    "missile",
    "invasion",
    "ceasefire",
    "airstrike",
    "attack"
  ],

  SANCTIONS: [
    "sanction",
    "sanctions",
    "embargo"
  ],

  ENERGY: [
    "oil",
    "pipeline",
    "opec",
    "gas supply",
    "energy"
  ],

  TRADE: [
    "tariff",
    "trade war",
    "export control",
    "trade restriction"
  ],

  SHIPPING: [
    "red sea",
    "strait of hormuz",
    "suez canal",
    "shipping"
  ]
};

const GEO_WEIGHTS = {
  WAR: 3,
  SANCTIONS: 2,
  ENERGY: 2,
  TRADE: 2,
  SHIPPING: 3
};

function classifyHeadline(
  title
) {

  const text =
    String(
      title || ""
    ).toLowerCase();

  const categories = [];

  for (
    const [
      category,
      keywords
    ] of
    Object.entries(
      GEO_KEYWORDS
    )
  ) {

    if (
      keywords.some(
        keyword =>
          text.includes(
            keyword
          )
      )
    ) {

      categories.push(
        category
      );
    }
  }

  return categories;
}

function buildGeoGroups(
  articles
) {

  const groups = {};

  for (
    const category of
    Object.keys(
      GEO_KEYWORDS
    )
  ) {

    groups[category] = {
      id:
        category,

      weight:
        GEO_WEIGHTS[
          category
        ],

      count:
        0,

      articles:
        []
    };
  }

  for (
    const article of
    articles
  ) {

    const categories =
      classifyHeadline(
        article.title
      );

    for (
      const category of
      categories
    ) {

      groups[
        category
      ].count += 1;

      if (
        groups[
          category
        ].articles.length <
        5
      ) {

        groups[
          category
        ].articles.push(
          article
        );
      }
    }
  }

  return Object.values(
    groups
  );
}

function geopoliticalRisk(
  groups
) {

  let score = 0;

  const reasons = [];

  for (
    const group of
    groups
  ) {

    if (
      !group.count
    ) {
      continue;
    }

    let contribution =
      0;

    if (
      group.count >= 10
    ) {

      contribution =
        group.weight;

    } else if (
      group.count >= 5
    ) {

      contribution =
        Math.max(
          1,
          group.weight - 1
        );

    } else if (
      group.count >= 2
    ) {

      contribution =
        1;
    }

    score +=
      contribution;

    if (
      contribution > 0
    ) {

      reasons.push(
        `${group.id}: ${group.count} monitored headlines`
      );
    }
  }

  score =
    clamp(
      score,
      0,
      10
    );

  let risk =
    "LOW";

  if (
    score >= 7
  ) {

    risk =
      "HIGH";

  } else if (
    score >= 3
  ) {

    risk =
      "MEDIUM";
  }

  return {
    risk,
    score,
    reasons
  };
}

function geoUnavailable(
  reason,
  error = null
) {

  return {
    ok: false,

    status:
      "DATA_DEGRADED",

    dataAvailable:
      false,

    version:
      VERSION,

    source:
      "GDELT",

    timestamp:
      new Date()
        .toISOString(),

    window:
      "24h",

    risk:
      "UNKNOWN",

    score:
      null,

    confidence:
      0,

    reason,

    reasons: [
      reason
    ],

    groups: [],

    headlines: [],

    errors:
      error
        ? [
            String(
              error
            )
          ]
        : [],

    methodology:
      "Geopolitical source failure is reported as UNKNOWN and is never converted to LOW risk."
  };
}

async function geopoliticalData() {

  const params =
    new URLSearchParams({
      query:
        GEO_COMBINED_QUERY,

      mode:
        "ArtList",

      maxrecords:
        "40",

      format:
        "json",

      sort:
        "HybridRel",

      timespan:
        "24h"
    });

  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  let data;

  try {

    /*
      FAST FAIL:
      only ONE request,
      only SIX seconds,
      no retry.
    */

    data =
      await fetchJSON(
        url,
        {},
        6000
      );

  } catch (e) {

    if (
      e?.status === 429 ||
      String(
        e?.message
      ).includes("429")
    ) {

      return geoUnavailable(
        "GDELT rate limited the request. Geopolitical risk is UNKNOWN.",
        "HTTP 429"
      );
    }

    if (
      e?.code ===
        "TIMEOUT" ||
      e?.message ===
        "TIMEOUT"
    ) {

      return geoUnavailable(
        "GDELT did not respond within 6 seconds. Geopolitical risk is UNKNOWN.",
        "TIMEOUT"
      );
    }

    return geoUnavailable(
      "GDELT geopolitical source unavailable. Geopolitical risk is UNKNOWN.",
      e?.message ||
        String(e)
    );
  }

  if (
    !data ||
    !Array.isArray(
      data.articles
    )
  ) {

    return geoUnavailable(
      "GDELT returned no usable article dataset. Geopolitical risk is UNKNOWN."
    );
  }

  const articles =
    data.articles
      .slice(
        0,
        40
      )
      .map(
        a => ({
          title:
            a.title ||
            null,

          url:
            a.url ||
            null,

          domain:
            a.domain ||
            null,

          language:
            a.language ||
            null,

          sourceCountry:
            a.sourcecountry ||
            null,

          seenDate:
            a.seendate ||
            null
        })
      )
      .filter(
        a => a.title
      );

  /*
    Empty valid response is different
    from upstream failure.

    But zero headlines alone is not
    strong evidence of LOW risk.
  */

  if (
    articles.length === 0
  ) {

    return {
      ok: true,

      status:
        "LIMITED_DATA",

      dataAvailable:
        true,

      version:
        VERSION,

      source:
        "GDELT",

      timestamp:
        new Date()
          .toISOString(),

      window:
        "24h",

      risk:
        "UNKNOWN",

      score:
        null,

      confidence:
        25,

      reasons: [
        "GDELT responded but no usable monitored headlines were returned."
      ],

      groups: [],

      headlines: [],

      errors: [],

      methodology:
        "No headlines is insufficient evidence to classify geopolitical risk as LOW."
    };
  }

  const groups =
    buildGeoGroups(
      articles
    );

  const analysis =
    geopoliticalRisk(
      groups
    );

  /*
    Because this is one aggregated
    public-news query, confidence
    is intentionally capped below 100.
  */

  const confidence =
    articles.length >= 20
      ? 85
      : articles.length >= 10
        ? 70
        : 55;

  return {
    ok: true,

    status:
      "OK",

    dataAvailable:
      true,

    version:
      VERSION,

    source:
      "GDELT",

    timestamp:
      new Date()
        .toISOString(),

    window:
      "24h",

    ...analysis,

    confidence,

    articleCount:
      articles.length,

    requestCount:
      1,

    groups,

    headlines:
      articles.slice(
        0,
        15
      ),

    errors: [],

    methodology:
      "One aggregated GDELT query is used for geopolitical monitoring. Headline volume is context only and does not independently create BUY or SELL signals."
  };
}

/* =========================================================
   DATA QUALITY
========================================================= */

function calculateDataQuality(
  marketAssets,
  macro,
  events,
  geopolitical
) {

  const marketOK =
    Boolean(
      marketAssets.ZEC &&
      marketAssets.BTC &&
      marketAssets.ETH
    );

  const macroOK =
    Boolean(
      macro?.ok
    );

  const eventsOK =
    Boolean(
      events?.ok
    );

  const geoOK =
    Boolean(
      geopolitical?.ok &&
      geopolitical?.risk !==
        "UNKNOWN"
    );

  let confidence =
    0;

  if (
    marketOK
  ) {
    confidence += 40;
  }

  if (
    macroOK
  ) {
    confidence += 25;
  }

  if (
    eventsOK
  ) {
    confidence += 20;
  }

  if (
    geoOK
  ) {

    confidence +=
      Math.round(
        15 *
        (
          (
            geopolitical
              .confidence ||
            0
          ) /
          100
        )
      );
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  let status =
    "OK";

  if (
    confidence < 60
  ) {

    status =
      "DATA_INCOMPLETE";

  } else if (
    confidence < 90
  ) {

    status =
      "DEGRADED";
  }

  return {
    status,

    confidence,

    market:
      marketOK
        ? "OK"
        : "UNAVAILABLE",

    macro:
      macro?.status ||
      (
        macroOK
          ? "OK"
          : "UNAVAILABLE"
      ),

    events:
      events?.status ||
      (
        eventsOK
          ? "OK"
          : "UNAVAILABLE"
      ),

    geopolitical:
      geopolitical?.status ||
      "UNAVAILABLE",

    geopoliticalRisk:
      geopolitical?.risk ||
      "UNKNOWN",

    rule:
      "Unavailable intelligence is never treated as low risk."
  };
}

/* =========================================================
   GLOBAL RISK FUSION
========================================================= */

function globalRiskFusion(
  market,
  macro,
  events,
  geo,
  dataQuality
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
    macro?.ok
  ) {

    if (
      macro.regime ===
      "RISK_OFF"
    ) {

      riskScore += 3;

      reasons.push(
        "Macro environment risk-off"
      );

    } else if (
      macro.regime ===
      "RISK_ON"
    ) {

      riskScore -= 1;
    }

  } else {

    reasons.push(
      "Macro intelligence unavailable"
    );
  }

  if (
    events?.ok
  ) {

    if (
      events.risk ===
      "HIGH"
    ) {

      riskScore += 3;

      reasons.push(
        "High-impact economic event approaching"
      );

    } else if (
      events.risk ===
      "MEDIUM"
    ) {

      riskScore += 1;
    }

  } else {

    reasons.push(
      "Economic event intelligence unavailable"
    );
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

    reasons.push(
      "Moderate geopolitical monitoring risk"
    );

  } else if (
    geo?.risk ===
    "UNKNOWN"
  ) {

    reasons.push(
      "Geopolitical risk UNKNOWN; no low-risk assumption applied"
    );
  }

  riskScore =
    clamp(
      riskScore,
      0,
      10
    );

  let risk =
    "LOW";

  let posture =
    "NORMAL";

  if (
    riskScore >= 7
  ) {

    risk =
      "HIGH";

    posture =
      "DEFENSIVE";

  } else if (
    riskScore >= 4
  ) {

    risk =
      "MEDIUM";

    posture =
      "CAUTIOUS";
  }

  let eventProtection =
    "NORMAL";

  if (
    events?.nextEvent
      ?.daysAway === 0
  ) {

    eventProtection =
      "EVENT DAY";

  } else if (
    events?.nextEvent
      ?.daysAway === 1
  ) {

    eventProtection =
      "EVENT TOMORROW";
  }

  const confidence =
    dataQuality
      ?.confidence ??
    0;

  let decisionReliability =
    "HIGH";

  if (
    confidence < 90
  ) {

    decisionReliability =
      "MEDIUM";
  }

  if (
    confidence < 60
  ) {

    decisionReliability =
      "LOW";
  }

  let signalPermission =
    "NORMAL";

  if (
    confidence < 60
  ) {

    signalPermission =
      "CAUTION_ONLY";

  } else if (
    geo?.risk ===
      "UNKNOWN" ||
    dataQuality?.status ===
      "DEGRADED"
  ) {

    signalPermission =
      "REDUCED_CONFIDENCE";
  }

  return {
    risk,
    riskScore,
    posture,
    eventProtection,
    decisionReliability,
    signalPermission,
    dataConfidence:
      confidence,
    reasons,

    note:
      "UNKNOWN or unavailable data never receives a LOW-risk assumption."
  };
}

/* =========================================================
   COMPLETE INTELLIGENCE
========================================================= */

async function intelligence(
  env
) {

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
    marketResults[0]
      .status ===
    "fulfilled"
  ) {

    ZEC =
      marketResults[0]
        .value;

  } else {

    errors.push(
      `ZEC: ${marketResults[0].reason}`
    );
  }

  if (
    marketResults[1]
      .status ===
    "fulfilled"
  ) {

    BTC =
      marketResults[1]
        .value;

  } else {

    errors.push(
      `BTC: ${marketResults[1].reason}`
    );
  }

  if (
    marketResults[2]
      .status ===
    "fulfilled"
  ) {

    ETH =
      marketResults[2]
        .value;

  } else {

    errors.push(
      `ETH: ${marketResults[2].reason}`
    );
  }

  const market =
    marketContext(
