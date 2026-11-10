/*
  ZEC AI Intelligence Worker V4.2.3
  Primary market source: CoinLore
  Backup market source: Binance
  Market research & simulation only.
*/

const VERSION = "4.2.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "public, max-age=10"
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

function response(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS
  });
}

async function fetchJSON(url, timeout = 7000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "ZEC-AI-Intelligence/4.2.3"
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
   COINLORE
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

      change1h:
        Number(coin.percent_change_1h),

      change24h:
        Number(coin.percent_change_24h),

      change7d:
        Number(coin.percent_change_7d),

      marketCap:
        Number(coin.market_cap_usd),

      volume24h:
        Number(coin.volume24),

      rank:
        Number(coin.rank),

      source: "CoinLore",

      sourceId:
        coin.id
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

      const ticker =
        await fetchJSON(
          `${host}/api/v3/ticker/24hr?symbol=${symbol}`,
          5000
        );

      return {
        symbol:
          symbol.replace("USDT", ""),

        price:
          Number(ticker.lastPrice),

        change24h:
          Number(ticker.priceChangePercent),

        high24h:
          Number(ticker.highPrice),

        low24h:
          Number(ticker.lowPrice),

        volume24h:
          Number(ticker.quoteVolume),

        source:
          "Binance",

        host
      };

    } catch (e) {

      errors.push(
        `${host}: ${e.message}`
      );
    }
  }

  throw new Error(errors.join(" | "));
}

/* =========================================================
   NORMALIZE MARKET DATA
========================================================= */

async function getMarket() {

  const errors = [];

  let market = {
    ZEC: null,
    BTC: null,
    ETH: null
  };

  let primarySource = null;

  let fallbackUsed = false;

  /*
     PRIMARY SOURCE
     CoinLore
  */

  try {

    const data =
      await coinLoreTicker();

    if (
      data.ZEC &&
      data.BTC &&
      data.ETH
    ) {

      market.ZEC = data.ZEC;
      market.BTC = data.BTC;
      market.ETH = data.ETH;

      primarySource =
        "CoinLore";
    }

  } catch (e) {

    errors.push(
      `CoinLore: ${e.message}`
    );
  }

  /*
     FALLBACK
     Binance
  */

  const symbols = {
    ZEC: "ZECUSDT",
    BTC: "BTCUSDT",
    ETH: "ETHUSDT"
  };

  for (
    const asset of
    ["ZEC", "BTC", "ETH"]
  ) {

    if (!market[asset]) {

      try {

        market[asset] =
          await binancePrice(
            symbols[asset]
          );

        fallbackUsed = true;

      } catch (e) {

        errors.push(
          `${asset} fallback: ${e.message}`
        );
      }
    }
  }

  /*
     MARKET REGIME
  */

  let regimeScore = 0;

  const reasons = [];

  if (market.BTC) {

    const btcChange =
      Number(
        market.BTC.change24h || 0
      );

    if (btcChange > 2) {

      regimeScore += 2;

      reasons.push(
        "BTC 24H momentum positive"
      );

    } else if (btcChange < -2) {

      regimeScore -= 2;

      reasons.push(
        "BTC 24H momentum negative"
      );
    }
  }

  if (market.ETH) {

    const ethChange =
      Number(
        market.ETH.change24h || 0
      );

    if (ethChange > 2) {

      regimeScore += 1;

      reasons.push(
        "ETH supports risk-on environment"
      );

    } else if (ethChange < -2) {

      regimeScore -= 1;

      reasons.push(
        "ETH indicates risk-off pressure"
      );
    }
  }

  let regime = "NEUTRAL";

  if (regimeScore >= 2) {
    regime = "RISK_ON";
  }

  if (regimeScore <= -2) {
    regime = "RISK_OFF";
  }

  const ok =
    Boolean(
      market.ZEC &&
      market.BTC &&
      market.ETH
    );

  return {

    ok,

    version:
      VERSION,

    timestamp:
      new Date().toISOString(),

    market,

    regime,

    regimeScore,

    reasons,

    dataQuality: {

      primarySource,

      fallbackUsed,

      ZEC:
        market.ZEC?.source || null,

      BTC:
        market.BTC?.source || null,

      ETH:
        market.ETH?.source || null
    },

    errors
  };
}

/* =========================================================
   ZEC ENDPOINT
========================================================= */

async function getZEC() {

  const market =
    await getMarket();

  return {

    ok:
      Boolean(market.market.ZEC),

    version:
      VERSION,

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
      market.market.ZEC?.source || null,

    errors:
      market.errors
  };
}

/* =========================================================
   INTELLIGENCE
========================================================= */

async function getIntelligence() {

  const data =
    await getMarket();

  const zec =
    data.market.ZEC;

  const btc =
    data.market.BTC;

  const eth =
    data.market.ETH;

  let score = 50;

  const reasons = [];

  if (zec) {

    const zec24 =
      Number(zec.change24h || 0);

    const zec1h =
      Number(zec.change1h || 0);

    if (zec24 > 3) {

      score += 10;

      reasons.push(
        "ZEC 24H momentum bullish"
      );

    } else if (zec24 < -3) {

      score -= 10;

      reasons.push(
        "ZEC 24H momentum bearish"
      );
    }

    if (zec1h > 1) {

      score += 5;

      reasons.push(
        "ZEC short-term momentum positive"
      );

    } else if (zec1h < -1) {

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
        "BTC market context positive"
      );

    } else if (c < -2) {

      score -= 10;

      reasons.push(
        "BTC market context negative"
      );
    }
  }

  if (eth) {

    const c =
      Number(eth.change24h || 0);

    if (c > 2) {

      score += 5;

      reasons.push(
        "ETH confirms risk-on sentiment"
      );

    } else if (c < -2) {

      score -= 5;

      reasons.push(
        "ETH confirms risk-off sentiment"
      );
    }
  }

  score =
    Math.max(
      0,
      Math.min(100, score)
    );

  let bias =
    "NEUTRAL";

  if (score >= 65) {
    bias = "BULLISH";
  }

  if (score <= 35) {
    bias = "BEARISH";
  }

  return {

    ok:
      data.ok,

    version:
      VERSION,

    timestamp:
      data.timestamp,

    market:
      data.market,

    marketRegime:
      data.regime,

    intelligence: {

      compositeScore:
        score,

      bias,

      reasons
    },

    dataQuality:
      data.dataQuality,

    riskEngine: {

      technical:
        "MONITOR",

      market:
        data.regime,

      macro:
        "READY_FOR_V4.3",

      geopolitical:
        "READY_FOR_V4.3",

      eventRisk:
        "READY_FOR_V4.3"
    },

    disclaimer:
      "Market research and simulation only. Not investment advice.",

    errors:
      data.errors
  };
}

/* =========================================================
   HEALTH
========================================================= */

function health() {

  return {

    ok: true,

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    status:
      "ONLINE",

    architecture:
      "Cloudflare Worker Multi-Source Gateway",

    modules: {

      coinLoreMarket:
        "ACTIVE",

      binanceFallback:
        "ACTIVE",

      btcContext:
        "ACTIVE",

      ethContext:
        "ACTIVE",

      technicalEngine:
        "READY",

      macroEngine:
        "NEXT",

      geopoliticalEngine:
        "NEXT",

      eventRiskEngine:
        "NEXT"
    },

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

  async fetch(request) {

    if (
      request.method === "OPTIONS"
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
      new URL(request.url);

    const path =
      url.pathname;

    try {

      if (
        path === "/" ||
        path === "/health"
      ) {

        return response(
          health()
        );
      }

      if (
        path === "/api/market"
      ) {

        return response(
          await getMarket()
        );
      }

      if (
        path === "/api/zec"
      ) {

        return response(
          await getZEC()
        );
      }

      if (
        path ===
        "/api/intelligence"
      ) {

        return response(
          await getIntelligence()
        );
      }

      return response(
        {
          ok: false,

          version:
            VERSION,

          error:
            "Endpoint not found",

          availableEndpoints: [
            "/",
            "/health",
            "/api/market",
            "/api/zec",
            "/api/intelligence"
          ]
        },
        404
      );

    } catch (e) {

      return response(
        {
          ok: false,

          version:
            VERSION,

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
