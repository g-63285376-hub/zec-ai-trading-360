const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com"
];

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

async function binance(path) {
  let lastError = "";

  for (const host of BINANCE_HOSTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(host + path, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json"
        }
      });

      clearTimeout(timer);

      if (!response.ok) {
        lastError = `${host}: HTTP ${response.status}`;
        continue;
      }

      return {
        data: await response.json(),
        source: host
      };
    } catch (error) {
      lastError = `${host}: ${error.message}`;
    }
  }

  throw new Error(lastError || "All market data sources failed");
}

async function ticker(symbol) {
  const result = await binance(
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
  );

  const d = result.data;

  return {
    symbol,
    price: Number(d.lastPrice),
    change24h: Number(d.priceChangePercent),
    high24h: Number(d.highPrice),
    low24h: Number(d.lowPrice),
    volume: Number(d.volume),
    quoteVolume: Number(d.quoteVolume),
    source: result.source
  };
}

async function klines(symbol, interval = "1h", limit = 200) {
  const allowed = new Set([
    "5m", "15m", "30m", "1h", "4h", "1d"
  ]);

  if (!allowed.has(interval)) interval = "1h";

  limit = Math.min(Math.max(Number(limit) || 200, 50), 500);

  const result = await binance(
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
  );

  return {
    symbol,
    interval,
    source: result.source,
    candles: result.data.map(k => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: k[6]
    }))
  };
}

async function marketSnapshot() {
  const results = await Promise.allSettled([
    ticker("ZECUSDT"),
    ticker("BTCUSDT"),
    ticker("ETHUSDT")
  ]);

  const names = ["ZEC", "BTC", "ETH"];
  const market = {};
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      market[names[index]] = result.value;
    } else {
      market[names[index]] = null;
      errors.push(`${names[index]}: ${result.reason?.message || "Unavailable"}`);
    }
  });

  let regime = "NEUTRAL";
  let score = 0;

  if (market.BTC) {
    if (market.BTC.change24h > 1) score++;
    if (market.BTC.change24h < -1) score--;
  }

  if (market.ETH) {
    if (market.ETH.change24h > 1) score++;
    if (market.ETH.change24h < -1) score--;
  }

  if (score >= 1) regime = "RISK-ON";
  if (score <= -1) regime = "RISK-OFF";

  return {
    market,
    regime,
    regimeScore: score,
    errors
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

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/" || path === "/health") {
        return json({
          ok: true,
          service: "ZEC AI Intelligence",
          version: "4.2",
          status: "ONLINE",
          architecture: "Cloudflare Worker Intelligence Gateway",
          timestamp: new Date().toISOString(),
          modules: {
            marketGateway: "ACTIVE",
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
        const snapshot = await marketSnapshot();

        return json({
          ok: true,
          version: "4.2",
          timestamp: new Date().toISOString(),
          ...snapshot
        });
      }

      if (path === "/api/zec") {
        return json({
          ok: true,
          version: "4.2",
          timestamp: new Date().toISOString(),
          data: await ticker("ZECUSDT")
        });
      }

      if (path === "/api/klines") {
        const symbol = (
          url.searchParams.get("symbol") || "ZECUSDT"
        ).toUpperCase();

        const permittedSymbols = new Set([
          "ZECUSDT",
          "BTCUSDT",
          "ETHUSDT"
        ]);

        if (!permittedSymbols.has(symbol)) {
          return json({
            ok: false,
            error: "Unsupported symbol"
          }, 400);
        }

        const interval = url.searchParams.get("interval") || "1h";
        const limit = url.searchParams.get("limit") || 200;

        return json({
          ok: true,
          version: "4.2",
          timestamp: new Date().toISOString(),
          data: await klines(symbol, interval, limit)
        });
      }

      if (path === "/api/intelligence") {
        const snapshot = await marketSnapshot();

        return json({
          ok: true,
          version: "4.2",
          timestamp: new Date().toISOString(),

          cryptoMarket: snapshot,

          macro: {
            status: "READY_FOR_SECURE_DATA_SOURCE",
            risk: "MONITOR",
            dxy: null,
            us10y: null,
            gold: null,
            oil: null,
            sp500: null,
            nasdaq: null
          },

          geopolitical: {
            status: "READY_FOR_SECURE_NEWS_SOURCE",
            risk: "MONITOR",
            events: []
          },

          economicEvents: {
            status: "READY_FOR_SECURE_CALENDAR_SOURCE",
            risk: "MONITOR",
            events: []
          },

          dataIntegrity: {
            fabricatedData: false,
            missingDataPolicy: "DISPLAY_AS_UNAVAILABLE",
            privateKeysExposedToBrowser: false
          }
        });
      }

      return json({
        ok: false,
        error: "Endpoint not found",
        availableEndpoints: [
          "/health",
          "/api/market",
          "/api/zec",
          "/api/klines?symbol=ZECUSDT&interval=1h&limit=200",
          "/api/intelligence"
        ]
      }, 404);

    } catch (error) {
      return json({
        ok: false,
        version: "4.2",
        error: error.message || "Unknown server error",
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
};
