const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "public, max-age=5"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS
  });
}

async function fetchJSON(url, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 ZEC-AI-Trading-360"
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

/*
  V4.2.1 MARKET DATA GATEWAY

  Priority:
  1. Binance Vision
  2. Binance API
  3. CoinGecko fallback

  The fallback prevents the complete intelligence engine
  from failing when Binance blocks a Cloudflare IP.
*/

const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com"
];

async function binance(path) {
  const errors = [];

  for (const host of BINANCE_HOSTS) {
    try {
      const data = await fetchJSON(host + path);
      return {
        ok: true,
        source: host,
        data
      };
    } catch (e) {
      errors.push(`${host}: ${e.message}`);
    }
  }

  return {
    ok: false,
    errors
  };
}

const COINGECKO_IDS = {
  ZEC: "zcash",
  BTC: "bitcoin",
  ETH: "ethereum"
};

async function coinGeckoPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=zcash,bitcoin,ethereum" +
    "&vs_currencies=usd" +
    "&include_24hr_change=true" +
    "&include_last_updated_at=true";

  try {
    const d = await fetchJSON(url);

    return {
      ok: true,
      source: "CoinGecko",
      data: d
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message
    };
  }
}

async function getTicker(symbol) {
  const r = await binance(
    `/api/v3/ticker/24hr?symbol=${symbol}USDT`
  );

  if (r.ok) {
    return {
      symbol,
      price: Number(r.data.lastPrice),
      change24h: Number(r.data.priceChangePercent),
      high24h: Number(r.data.highPrice),
      low24h: Number(r.data.lowPrice),
      volume: Number(r.data.volume),
      quoteVolume: Number(r.data.quoteVolume),
      source: "Binance",
      sourceHost: r.source
    };
  }

  return null;
}

async function marketSnapshot() {
  const errors = [];

  let ZEC = await getTicker("ZEC");
  let BTC = await getTicker("BTC");
  let ETH = await getTicker("ETH");

  if (!ZEC || !BTC || !ETH) {
    const cg = await coinGeckoPrices();

    if (cg.ok) {
      for (const symbol of ["ZEC", "BTC", "ETH"]) {
        const id = COINGECKO_IDS[symbol];
        const item = cg.data[id];

        if (!item) continue;

        const value = {
          symbol,
          price: Number(item.usd),
          change24h: Number(item.usd_24h_change || 0),
          source: "CoinGecko",
          lastUpdated:
            item.last_updated_at
              ? new Date(item.last_updated_at * 1000).toISOString()
              : null
        };

        if (symbol === "ZEC" && !ZEC) ZEC = value;
        if (symbol === "BTC" && !BTC) BTC = value;
        if (symbol === "ETH" && !ETH) ETH = value;
      }
    } else {
      errors.push(`CoinGecko: ${cg.error}`);
    }
  }

  if (!ZEC) errors.push("ZEC market data unavailable");
  if (!BTC) errors.push("BTC market data unavailable");
  if (!ETH) errors.push("ETH market data unavailable");

  return {
    ZEC,
    BTC,
    ETH,
    errors
  };
}

function calculateRegime(market) {
  let score = 0;
  const reasons = [];

  const btc = market.BTC;
  const eth = market.ETH;
  const zec = market.ZEC;

  if (btc) {
    if (btc.change24h >= 2) {
      score += 2;
      reasons.push("BTC 24H momentum positive");
    } else if (btc.change24h <= -2) {
      score -= 2;
      reasons.push("BTC 24H momentum negative");
    }
  }

  if (eth) {
    if (eth.change24h >= 2) {
      score += 1;
      reasons.push("ETH 24H momentum positive");
    } else if (eth.change24h <= -2) {
      score -= 1;
      reasons.push("ETH 24H momentum negative");
    }
  }

  if (zec) {
    if (zec.change24h >= 3) {
      score += 1;
      reasons.push("ZEC 24H momentum positive");
    } else if (zec.change24h <= -3) {
      score -= 1;
      reasons.push("ZEC 24H momentum negative");
    }
  }

  let regime = "NEUTRAL";

  if (score >= 2) regime = "RISK-ON";
  if (score <= -2) regime = "RISK-OFF";

  return {
    regime,
    score,
    reasons
  };
}

async function getKlines(symbol, interval, limit) {
  const safeSymbols = ["ZECUSDT", "BTCUSDT", "ETHUSDT"];
  const safeIntervals = [
    "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "12h", "1d"
  ];

  if (!safeSymbols.includes(symbol)) {
    throw new Error("Unsupported symbol");
  }

  if (!safeIntervals.includes(interval)) {
    throw new Error("Unsupported interval");
  }

  limit = Math.min(Math.max(Number(limit) || 200, 10), 500);

  const r = await binance(
    `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );

  if (!r.ok) {
    throw new Error(r.errors.join(" | "));
  }

  return {
    source: "Binance",
    sourceHost: r.source,
    symbol,
    interval,
    candles: r.data
  };
}

async function intelligence() {
  const market = await marketSnapshot();
  const regime = calculateRegime(market);

  return {
    ok: Boolean(market.ZEC),
    service: "ZEC AI Intelligence",
    version: "4.2.1",
    timestamp: new Date().toISOString(),

    market: {
      ZEC: market.ZEC,
      BTC: market.BTC,
      ETH: market.ETH
    },

    marketRegime: {
      status: regime.regime,
      score: regime.score,
      reasons: regime.reasons
    },

    intelligence: {
      technicalRisk: market.ZEC ? "ACTIVE" : "DATA PENDING",
      cryptoRisk:
        market.BTC && market.ETH ? "ACTIVE" : "DATA PENDING",

      macroRisk: {
        status: "DATA PENDING",
        integrity:
          "No macro score is generated until verified live macro data is connected."
      },

      geopoliticalRisk: {
        status: "DATA PENDING",
        integrity:
          "No geopolitical score is generated from fabricated or unverified headlines."
      },

      economicEvents: {
        status: "DATA PENDING",
        integrity:
          "Economic calendar source not connected yet."
      },

      sentiment: {
        status: "DATA PENDING",
        integrity:
          "Social sentiment source not connected yet."
      }
    },

    dataIntegrity: {
      liveMarketConnected: Boolean(market.ZEC),
      BTCConnected: Boolean(market.BTC),
      ETHConnected: Boolean(market.ETH),
      errors: market.errors
    },

    disclaimer:
      "Market research and simulation only. Not investment advice."
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    if (request.method !== "GET") {
      return json(
        {
          ok: false,
          error: "Method not allowed"
        },
        405
      );
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/" || path === "/health") {
        return json({
          ok: true,
          service: "ZEC AI Intelligence",
          version: "4.2.1",
          status: "ONLINE",
          architecture:
            "Cloudflare Worker Multi-Source Intelligence Gateway",
          timestamp: new Date().toISOString(),

          modules: {
            marketGateway: "ACTIVE",
            binanceFallback: "ACTIVE",
            coinGeckoFallback: "ACTIVE",
            btcContext: "ACTIVE",
            ethContext: "ACTIVE",
            macroEngine: "READY",
            geopoliticalEngine: "READY",
            eventRiskEngine: "READY"
          },

          disclaimer:
            "Market research and simulation only. Not investment advice."
        });
      }

      if (path === "/api/market") {
        const market = await marketSnapshot();
        const regime = calculateRegime(market);

        return json({
          ok: Boolean(market.ZEC),
          version: "4.2.1",
          timestamp: new Date().toISOString(),
          market: {
            ZEC: market.ZEC,
            BTC: market.BTC,
            ETH: market.ETH
          },
          regime: regime.regime,
          regimeScore: regime.score,
          reasons: regime.reasons,
          errors: market.errors
        });
      }

      if (path === "/api/zec") {
        const market = await marketSnapshot();

        return json({
          ok: Boolean(market.ZEC),
          version: "4.2.1",
          timestamp: new Date().toISOString(),
          ZEC: market.ZEC,
          errors: market.errors
        });
      }

      if (path === "/api/klines") {
        const symbol =
          (url.searchParams.get("symbol") || "ZECUSDT").toUpperCase();

        const interval =
          url.searchParams.get("interval") || "1h";

        const limit =
          url.searchParams.get("limit") || "200";

        const result =
          await getKlines(symbol, interval, limit);

        return json({
          ok: true,
          version: "4.2.1",
          timestamp: new Date().toISOString(),
          ...result
        });
      }

      if (path === "/api/intelligence") {
        return json(await intelligence());
      }

      return json(
        {
          ok: false,
          error: "Endpoint not found",
          availableEndpoints: [
            "/health",
            "/api/market",
            "/api/zec",
            "/api/klines?symbol=ZECUSDT&interval=1h&limit=200",
            "/api/intelligence"
          ]
        },
        404
      );
    } catch (e) {
      return json(
        {
          ok: false,
          version: "4.2.1",
          error: e.message,
          timestamp: new Date().toISOString()
        },
        500
      );
    }
  }
};
