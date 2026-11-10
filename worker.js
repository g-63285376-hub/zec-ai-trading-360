/*
  ZEC AI Intelligence Worker V4.4
  Market: CoinLore primary + Binance fallback
  Macro: FRED
  Market research & simulation only.
*/

const VERSION = "4.4.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "public, max-age=60"
};

const COINLORE = {
  ZEC: "134",
  BTC: "90",
  ETH: "80"
};

const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com"
];

/*
  FRED macro series
  DGS10      = 10-Year Treasury Yield
  DFF        = Effective Federal Funds Rate
  DTWEXBGS   = Trade Weighted U.S. Dollar Index: Broad
  VIXCLS     = CBOE VIX
  CPIAUCSL   = CPI
  UNRATE     = Unemployment Rate
*/
const MACRO_SERIES = {
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
    type: "vix"
  },
  CPIAUCSL: {
    name: "US CPI",
    type: "cpi"
  },
  UNRATE: {
    name: "US Unemployment",
    type: "unemployment"
  }
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS
  });
}

async function fetchJSON(url, timeout = 8000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "ZEC-AI-Intelligence/4.4"
      },
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   COINLORE MARKET
========================================================= */

async function coinLoreTicker() {
  const ids =
    `${COINLORE.ZEC},${COINLORE.BTC},${COINLORE.ETH}`;

  const url =
    `https://api.coinlore.net/api/ticker/?id=${ids}`;

  const data = await fetchJSON(url);

  if (!Array.isArray(data)) {
    throw new Error("Invalid CoinLore response");
  }

  const result = {};

  for (const coin of data) {
    result[coin.symbol] = {
      symbol: coin.symbol,
      name: coin.name,
      price: Number(coin.price_usd),
      change1h: Number(coin.percent_change_1h),
      change24h: Number(coin.percent_change_24h),
      change7d: Number(coin.percent_change_7d),
      marketCap: Number(coin.market_cap_usd),
      volume24h: Number(coin.volume24),
      rank: Number(coin.rank),
      source: "CoinLore",
      sourceId: coin.id
    };
  }

  return result;
}

/* =========================================================
   BINANCE FALLBACK
========================================================= */

async function binancePrice(symbol) {
  const errors = [];

  for (const host of BINANCE_HOSTS) {
    try {
      const ticker = await fetchJSON(
        `${host}/api/v3/ticker/24hr?symbol=${symbol}`,
        5000
      );

      return {
        symbol: symbol.replace("USDT", ""),
        price: Number(ticker.lastPrice),
        change24h: Number(ticker.priceChangePercent),
        high24h: Number(ticker.highPrice),
        low24h: Number(ticker.lowPrice),
        volume24h: Number(ticker.quoteVolume),
        source: "Binance",
        host
      };

    } catch (e) {
      errors.push(`${host}: ${e.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

/* =========================================================
   MARKET ENGINE
========================================================= */

async function getMarket() {
  const errors = [];

  const market = {
    ZEC: null,
    BTC: null,
    ETH: null
  };

  let primarySource = null;
  let fallbackUsed = false;

  try {
    const data = await coinLoreTicker();

    if (data.ZEC) market.ZEC = data.ZEC;
    if (data.BTC) market.BTC = data.BTC;
    if (data.ETH) market.ETH = data.ETH;

    if (market.ZEC && market.BTC && market.ETH) {
      primarySource = "CoinLore";
    }

  } catch (e) {
    errors.push(`CoinLore: ${e.message}`);
  }

  const symbols = {
    ZEC: "ZECUSDT",
    BTC: "BTCUSDT",
    ETH: "ETHUSDT"
  };

  for (const asset of ["ZEC", "BTC", "ETH"]) {
    if (!market[asset]) {
      try {
        market[asset] =
          await binancePrice(symbols[asset]);

        fallbackUsed = true;

      } catch (e) {
        errors.push(
          `${asset} fallback: ${e.message}`
        );
      }
    }
  }

  let regimeScore = 0;
  const reasons = [];

  if (market.BTC) {
    const c = Number(market.BTC.change24h || 0);

    if (c > 2) {
      regimeScore += 2;
      reasons.push("BTC 24H momentum positive");
    } else if (c < -2) {
      regimeScore -= 2;
      reasons.push("BTC 24H momentum negative");
    }
  }

  if (market.ETH) {
    const c = Number(market.ETH.change24h || 0);

    if (c > 2) {
      regimeScore += 1;
      reasons.push("ETH supports risk-on");
    } else if (c < -2) {
      regimeScore -= 1;
      reasons.push("ETH indicates risk-off pressure");
    }
  }

  let regime = "NEUTRAL";

  if (regimeScore >= 2) regime = "RISK_ON";
  if (regimeScore <= -2) regime = "RISK_OFF";

  return {
    ok: Boolean(
      market.ZEC &&
      market.BTC &&
      market.ETH
    ),

    version: VERSION,
    timestamp: new Date().toISOString(),

    market,
    regime,
    regimeScore,
    reasons,

    dataQuality: {
      primarySource,
      fallbackUsed,
      ZEC: market.ZEC?.source || null,
      BTC: market.BTC?.source || null,
      ETH: market.ETH?.source || null
    },

    errors
  };
}

/* =========================================================
   FRED MACRO ENGINE
========================================================= */

function validObservation(obs) {
  if (!obs) return false;

  const value = Number(obs.value);

  return (
    obs.value !== "." &&
    obs.value !== "" &&
    Number.isFinite(value)
  );
}

async function fredSeries(seriesId, apiKey) {
  if (!apiKey) {
    throw new Error("FRED_API_KEY secret is missing");
  }

  const url =
    "https://api.stlouisfed.org/fred/series/observations" +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    "&file_type=json" +
    "&sort_order=desc" +
    "&limit=12";

  const data = await fetchJSON(url, 9000);

  if (!Array.isArray(data.observations)) {
    throw new Error("Invalid FRED response");
  }

  const valid =
    data.observations.filter(validObservation);

  if (!valid.length) {
    throw new Error("No valid observations");
  }

  const latest = valid[0];
  const previous = valid[1] || null;

  const latestValue = Number(latest.value);

  const previousValue =
    previous ? Number(previous.value) : null;

  let change = null;
  let changePercent = null;

  if (
    previousValue !== null &&
    Number.isFinite(previousValue)
  ) {
    change =
      latestValue - previousValue;

    if (previousValue !== 0) {
      changePercent =
        (change / previousValue) * 100;
    }
  }

  return {
    seriesId,
    name:
      MACRO_SERIES[seriesId]?.name ||
      seriesId,

    type:
      MACRO_SERIES[seriesId]?.type ||
      "other",

    value: latestValue,
    date: latest.date,

    previousValue,
    previousDate:
      previous?.date || null,

    change,
    changePercent,

    source: "FRED"
  };
}

async function getMacro(env) {
  const apiKey = env?.FRED_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      status: "NO_API_KEY",
      source: "FRED",
      timestamp: new Date().toISOString(),
      indicators: {},
      errors: [
        "Cloudflare secret FRED_API_KEY not found"
      ]
    };
  }

  const ids =
    Object.keys(MACRO_SERIES);

  const settled =
    await Promise.allSettled(
      ids.map(id =>
        fredSeries(id, apiKey)
      )
    );

  const indicators = {};
  const errors = [];

  settled.forEach((result, i) => {
    const id = ids[i];

    if (result.status === "fulfilled") {
      indicators[id] = result.value;
    } else {
      indicators[id] = null;
      errors.push(
        `${id}: ${result.reason?.message || "Unknown error"}`
      );
    }
  });

  const available =
    Object.values(indicators)
      .filter(Boolean).length;

  /*
    Macro risk score:
    positive score = more risk-off pressure
    negative score = more risk-on support
  */

  let riskScore = 0;
  const reasons = [];

  const tenY = indicators.DGS10;
  const dollar = indicators.DTWEXBGS;
  const vix = indicators.VIXCLS;
  const fed = indicators.DFF;
  const cpi = indicators.CPIAUCSL;
  const unemployment = indicators.UNRATE;

  if (tenY?.change !== null) {
    if (tenY.change >= 0.08) {
      riskScore += 2;
      reasons.push(
        "US 10Y yield rising: tighter financial conditions"
      );
    } else if (tenY.change <= -0.08) {
      riskScore -= 1;
      reasons.push(
        "US 10Y yield falling: financial pressure easing"
      );
    }
  }

  if (dollar?.changePercent !== null) {
    if (dollar.changePercent >= 0.25) {
      riskScore += 2;
      reasons.push(
        "US dollar strengthening: crypto headwind"
      );
    } else if (dollar.changePercent <= -0.25) {
      riskScore -= 1;
      reasons.push(
        "US dollar weakening: crypto liquidity support"
      );
    }
  }

  if (vix) {
    if (vix.value >= 30) {
      riskScore += 3;
      reasons.push(
        "VIX above 30: elevated market stress"
      );
    } else if (vix.value >= 20) {
      riskScore += 1;
      reasons.push(
        "VIX above 20: risk appetite cautious"
      );
    } else if (vix.value < 17) {
      riskScore -= 1;
      reasons.push(
        "VIX relatively low: calmer risk environment"
      );
    }
  }

  if (fed?.change !== null) {
    if (fed.change >= 0.10) {
      riskScore += 1;
      reasons.push(
        "Effective Fed Funds Rate increased"
      );
    } else if (fed.change <= -0.10) {
      riskScore -= 1;
      reasons.push(
        "Effective Fed Funds Rate decreased"
      );
    }
  }

  /*
    CPI is monthly, so compare latest two observations
    only as a directional inflation-pressure input.
  */
  if (cpi?.changePercent !== null) {
    if (cpi.changePercent >= 0.4) {
      riskScore += 1;
      reasons.push(
        "Latest CPI index increase remains elevated"
      );
    } else if (cpi.changePercent <= 0.1) {
      riskScore -= 1;
      reasons.push(
        "Latest CPI index increase is relatively soft"
      );
    }
  }

  if (unemployment?.change !== null) {
    if (unemployment.change >= 0.2) {
      riskScore += 1;
      reasons.push(
        "Unemployment rate increased"
      );
    }
  }

  let regime = "NEUTRAL";
  let risk = "MEDIUM";

  if (riskScore >= 4) {
    regime = "RISK_OFF";
    risk = "HIGH";
  } else if (riskScore <= -2) {
    regime = "RISK_ON";
    risk = "LOW";
  }

  return {
    ok: available >= 3,

    version: VERSION,
    source: "FRED",

    timestamp:
      new Date().toISOString(),

    availableIndicators:
      available,

    requestedIndicators:
      ids.length,

    regime,
    risk,
    riskScore,

    reasons,

    indicators,
    errors
  };
}

/* =========================================================
   COMBINED GLOBAL INTELLIGENCE
========================================================= */

async function getGlobalIntelligence(env) {
  const [market, macro] =
    await Promise.all([
      getMarket(),
      getMacro(env)
    ]);

  let globalScore = 50;
  const reasons = [];

  if (market.regime === "RISK_ON") {
    globalScore += 10;
    reasons.push(
      "BTC/ETH market environment is risk-on"
    );
  }

  if (market.regime === "RISK_OFF") {
    globalScore -= 10;
    reasons.push(
      "BTC/ETH market environment is risk-off"
    );
  }

  if (macro.regime === "RISK_ON") {
    globalScore += 15;
    reasons.push(
      "Macro environment supports risk assets"
    );
  }

  if (macro.regime === "RISK_OFF") {
    globalScore -= 15;
    reasons.push(
      "Macro environment pressures risk assets"
    );
  }

  const zec =
    market.market.ZEC;

  if (zec) {
    const z24 =
      Number(zec.change24h || 0);

    if (z24 > 3) {
      globalScore += 10;
      reasons.push(
        "ZEC 24H momentum positive"
      );
    }

    if (z24 < -3) {
      globalScore -= 10;
      reasons.push(
        "ZEC 24H momentum negative"
      );
    }
  }

  globalScore =
    Math.max(
      0,
      Math.min(100, globalScore)
    );

  let bias = "NEUTRAL";

  if (globalScore >= 65) {
    bias = "BULLISH";
  } else if (globalScore <= 35) {
    bias = "BEARISH";
  }

  return {
    ok: market.ok,

    version: VERSION,

    timestamp:
      new Date().toISOString(),

    globalScore,
    bias,

    market,
    macro,

    geopolitical: {
      status: "MONITOR",
      engine:
        "NEXT_STAGE",
      note:
        "Verified news intelligence will be added separately; no fabricated geopolitical score."
    },

    eventRisk: {
      status: "MONITOR",
      engine:
        "NEXT_STAGE"
    },

    reasons,

    disclaimer:
      "Market research and simulation only. Not investment advice."
  };
}

/* =========================================================
   EXISTING INTELLIGENCE
========================================================= */

async function getIntelligence(env) {
  const data =
    await getMarket();

  const macro =
    await getMacro(env);

  const zec =
    data.market.ZEC;

  const btc =
    data.market.BTC;

  const eth =
    data.market.ETH;

  let score = 50;

  const reasons = [];

  if (zec) {
    const z24 =
      Number(zec.change24h || 0);

    const z1 =
      Number(zec.change1h || 0);

    if (z24 > 3) {
      score += 10;
      reasons.push(
        "ZEC 24H momentum bullish"
      );
    } else if (z24 < -3) {
      score -= 10;
      reasons.push(
        "ZEC 24H momentum bearish"
      );
    }

    if (z1 > 1) {
      score += 5;
      reasons.push(
        "ZEC short-term momentum positive"
      );
    } else if (z1 < -1) {
      score -= 5;
      reasons.push(
        "ZEC short-term momentum negative"
      );
    }
  }

  if (btc) {
    const c =
      Number(btc.change24h || 0);

    if (c > 2) {
      score += 10;
      reasons.push(
        "BTC context positive"
      );
    } else if (c < -2) {
      score -= 10;
      reasons.push(
        "BTC context negative"
      );
    }
  }

  if (eth) {
    const c =
      Number(eth.change24h || 0);

    if (c > 2) {
      score += 5;
      reasons.push(
        "ETH confirms risk-on"
      );
    } else if (c < -2) {
      score -= 5;
      reasons.push(
        "ETH confirms risk-off"
      );
    }
  }

  if (macro.regime === "RISK_ON") {
    score += 10;
    reasons.push(
      "Macro engine supports risk assets"
    );
  }

  if (macro.regime === "RISK_OFF") {
    score -= 10;
    reasons.push(
      "Macro engine signals risk-off pressure"
    );
  }

  score =
    Math.max(
      0,
      Math.min(100, score)
    );

  let bias = "NEUTRAL";

  if (score >= 65) {
    bias = "BULLISH";
  }

  if (score <= 35) {
    bias = "BEARISH";
  }

  return {
    ok: data.ok,

    version: VERSION,

    timestamp:
      new Date().toISOString(),

    market:
      data.market,

    marketRegime:
      data.regime,

    macro,

    intelligence: {
      compositeScore: score,
      bias,
      reasons
    },

    dataQuality:
      data.dataQuality,

    riskEngine: {
      technical: "MONITOR",
      market: data.regime,
      macro:
        macro.ok
          ? macro.risk
          : "DATA_UNAVAILABLE",
      geopolitical:
        "MONITOR",
      eventRisk:
        "MONITOR"
    },

    disclaimer:
      "Market research and simulation only. Not investment advice.",

    errors:
      data.errors
  };
}

/* =========================================================
   ZEC
========================================================= */

async function getZEC() {
  const market =
    await getMarket();

  return {
    ok:
      Boolean(market.market.ZEC),

    version: VERSION,

    timestamp:
      market.timestamp,

    ZEC:
      market.market.ZEC,

    marketRegime:
      market.regime,

    BTC:
      market.market.BTC,

    ETH:
      market.market.ETH,

    source:
      market.market.ZEC?.source ||
      null,

    errors:
      market.errors
  };
}

/* =========================================================
   HEALTH
========================================================= */

function health(env) {
  return {
    ok: true,

    service:
      "ZEC AI Intelligence",

    version: VERSION,

    status: "ONLINE",

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
        env?.FRED_API_KEY
          ? "ACTIVE"
          : "NO_API_KEY",

      globalRiskEngine:
        "ACTIVE",

      geopoliticalEngine:
        "NEXT",

      eventRiskEngine:
        "NEXT"
    },

    fredSecretConfigured:
      Boolean(env?.FRED_API_KEY),

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
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    const url =
      new URL(request.url);

    const path =
      url.pathname;

    try {

      if (
        path === "/" ||
        path === "/health"
      ) {
        return response(
          health(env)
        );
      }

      if (path === "/api/market") {
        return response(
          await getMarket()
        );
      }

      if (path === "/api/zec") {
        return response(
          await getZEC()
        );
      }

      if (path === "/api/macro") {
        return response(
          await getMacro(env)
        );
      }

      if (
        path === "/api/intelligence"
      ) {
        return response(
          await getIntelligence(env)
        );
      }

      if (
        path === "/api/global"
      ) {
        return response(
          await getGlobalIntelligence(env)
        );
      }

      return response(
        {
          ok: false,
          version: VERSION,
          error:
            "Endpoint not found",

          availableEndpoints: [
            "/",
            "/health",
            "/api/market",
            "/api/zec",
            "/api/macro",
            "/api/intelligence",
            "/api/global"
          ]
        },
        404
      );

    } catch (e) {

      return response(
        {
          ok: false,
          version: VERSION,
          error:
            e.message,
          timestamp:
            new Date().toISOString()
        },
        500
      );
    }
  }
};
