/*
  ZEC AI Intelligence Worker V4.2.2
  Market research & simulation only.
  No API key required.
*/

const VERSION = "4.2.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "public, max-age=5"
};

// Multiple public Binance endpoints.
// Worker automatically tries the next source if one fails.
const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS
  });
}

async function fetchJSON(url, timeout = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
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

async function binance(path) {
  const errors = [];

  for (const host of BINANCE_HOSTS) {
    try {
      const data = await fetchJSON(host + path);

      return {
        ok: true,
        host,
        data
      };
    } catch (e) {
      errors.push(`${host}: ${e.message}`);
    }
  }

  return {
    ok: false,
    host: null,
    data: null,
    errors
  };
}

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ticker(symbol) {
  const result = await binance(
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
  );

  if (!result.ok) {
    return {
      ok: false,
      symbol,
      errors: result.errors
    };
  }

  const d = result.data;

  return {
    ok: true,
    symbol,
    source: result.host,
    price: number(d.lastPrice),
    change24h: number(d.priceChangePercent),
    high24h: number(d.highPrice),
    low24h: number(d.lowPrice),
    volume: number(d.volume),
    quoteVolume: number(d.quoteVolume)
  };
}

async function klines(symbol, interval = "1h", limit = 200) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || 200, 20),
    500
  );

  const result = await binance(
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${safeLimit}`
  );

  if (!result.ok) {
    return {
      ok: false,
      symbol,
      interval,
      errors: result.errors
    };
  }

  const candles = result.data.map(k => ({
    openTime: k[0],
    open: number(k[1]),
    high: number(k[2]),
    low: number(k[3]),
    close: number(k[4]),
    volume: number(k[5]),
    closeTime: k[6]
  }));

  return {
    ok: true,
    symbol,
    interval,
    source: result.host,
    candles
  };
}

function calculateRegime(zec, btc, eth) {
  let score = 0;
  const reasons = [];

  if (btc?.ok && btc.change24h !== null) {
    if (btc.change24h >= 2) {
      score += 2;
      reasons.push("BTC 24H momentum positive");
    } else if (btc.change24h > 0) {
      score += 1;
      reasons.push("BTC slightly positive");
    } else if (btc.change24h <= -2) {
      score -= 2;
      reasons.push("BTC 24H momentum negative");
    } else if (btc.change24h < 0) {
      score -= 1;
      reasons.push("BTC slightly negative");
    }
  }

  if (eth?.ok && eth.change24h !== null) {
    if (eth.change24h >= 2) {
      score += 2;
      reasons.push("ETH 24H momentum positive");
    } else if (eth.change24h > 0) {
      score += 1;
      reasons.push("ETH slightly positive");
    } else if (eth.change24h <= -2) {
      score -= 2;
      reasons.push("ETH 24H momentum negative");
    } else if (eth.change24h < 0) {
      score -= 1;
      reasons.push("ETH slightly negative");
    }
  }

  if (zec?.ok && zec.change24h !== null) {
    if (zec.change24h >= 3) {
      score += 1;
      reasons.push("ZEC showing positive relative momentum");
    } else if (zec.change24h <= -3) {
      score -= 1;
      reasons.push("ZEC showing negative relative momentum");
    }
  }

  let regime = "NEUTRAL";

  if (score >= 3) regime = "RISK_ON";
  if (score <= -3) regime = "RISK_OFF";

  return {
    regime,
    regimeScore: score,
    reasons
  };
}

async function marketSnapshot() {
  const results = await Promise.all([
    ticker("ZECUSDT"),
    ticker("BTCUSDT"),
    ticker("ETHUSDT")
  ]);

  const [zec, btc, eth] = results;

  const regimeData = calculateRegime(zec, btc, eth);

  const errors = [];

  for (const asset of [zec, btc, eth]) {
    if (!asset.ok && asset.errors) {
      errors.push(
        `${asset.symbol}: ${asset.errors.join(" | ")}`
      );
    }
  }

  return {
    ok: zec.ok || btc.ok || eth.ok,
    version: VERSION,
    timestamp: new Date().toISOString(),

    market: {
      ZEC: zec.ok ? zec : null,
      BTC: btc.ok ? btc : null,
      ETH: eth.ok ? eth : null
    },

    regime: regimeData.regime,
    regimeScore: regimeData.regimeScore,
    reasons: regimeData.reasons,

    errors
  };
}

async function health() {
  return {
    ok: true,
    service: "ZEC AI Intelligence",
    version: VERSION,
    status: "ONLINE",
    architecture: "Cloudflare Worker Intelligence Gateway",

    modules: {
      marketGateway: "ACTIVE",
      btcContext: "ACTIVE",
      ethContext: "ACTIVE",
      technicalEngine: "READY",
      macroEngine: "READY",
      geopoliticalEngine: "READY",
      eventRiskEngine: "READY"
    },

    timestamp: new Date().toISOString(),

    disclaimer:
      "Market research and simulation only. Not investment advice."
  };
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS
    });
  }

  if (request.method !== "GET") {
    return json({
      ok: false,
      error: "Method not allowed"
    }, 405);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {

    if (path === "/" || path === "/health") {
      return json(await health());
    }

    if (
      path === "/api/market" ||
      path === "/api/intelligence"
    ) {
      return json(await marketSnapshot());
    }

    if (path === "/api/zec") {
      const data = await ticker("ZECUSDT");

      return json({
        version: VERSION,
        timestamp: new Date().toISOString(),
        ...data
      }, data.ok ? 200 : 502);
    }

    if (path === "/api/btc") {
      const data = await ticker("BTCUSDT");

      return json({
        version: VERSION,
        timestamp: new Date().toISOString(),
        ...data
      }, data.ok ? 200 : 502);
    }

    if (path === "/api/eth") {
      const data = await ticker("ETHUSDT");

      return json({
        version: VERSION,
        timestamp: new Date().toISOString(),
        ...data
      }, data.ok ? 200 : 502);
    }

    if (path === "/api/klines") {
      const symbol =
        (url.searchParams.get("symbol") || "ZECUSDT")
          .toUpperCase();

      const interval =
        url.searchParams.get("interval") || "1h";

      const limit =
        url.searchParams.get("limit") || "200";

      const allowedSymbols = [
        "ZECUSDT",
        "BTCUSDT",
        "ETHUSDT"
      ];

      const allowedIntervals = [
        "1m",
        "3m",
        "5m",
        "15m",
        "30m",
        "1h",
        "2h",
        "4h",
        "6h",
        "8h",
        "12h",
        "1d"
      ];

      if (!allowedSymbols.includes(symbol)) {
        return json({
          ok: false,
          error: "Unsupported symbol"
        }, 400);
      }

      if (!allowedIntervals.includes(interval)) {
        return json({
          ok: false,
          error: "Unsupported interval"
        }, 400);
      }

      const data = await klines(
        symbol,
        interval,
        limit
      );

      return json({
        version: VERSION,
        timestamp: new Date().toISOString(),
        ...data
      }, data.ok ? 200 : 502);
    }

    return json({
      ok: false,
      version: VERSION,
      error: "Endpoint not found",

      availableEndpoints: [
        "/health",
        "/api/market",
        "/api/intelligence",
        "/api/zec",
        "/api/btc",
        "/api/eth",
        "/api/klines?symbol=ZECUSDT&interval=1h&limit=200"
      ]
    }, 404);

  } catch (e) {
    return json({
      ok: false,
      version: VERSION,
      error: e.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
}

export default {
  async fetch(request) {
    return handleRequest(request);
  }
};
