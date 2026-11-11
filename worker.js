/*
 ZEC AI INTELLIGENCE WORKER V4.9.1
 Market Intelligence + Technical Analysis
 AI Geopolitical Intelligence
 Global Risk Fusion
 BUY / SELL / WAIT Simulation
 Stop Loss / Take Profit
 Persistent KV Cache

 Research and Simulation Only
 No Automatic Broker Trading
*/

const VERSION = "4.9.1";

const AI_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const IDS = {
  ZEC: "134",
  BTC: "90",
  ETH: "80"
};

const TIMEFRAMES = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440
};

const FRED_SERIES = {
  DGS10: "US Treasury 10Y",
  DFF: "Federal Funds Rate",
  DTWEXBGS: "US Dollar Index",
  VIXCLS: "VIX"
};

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

const GEO_KEY = "geo:ai:last_reliable:v3";

function now() {
  return new Date().toISOString();
}

function num(v) {
  if (v === null || v === undefined || v === "")
    return null;

  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  return Number(v.toFixed(d));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    }
  );
}

async function fetchJSON(url, timeout = 8000, headers = {}) {
  const controller = new AbortController();

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

    if (!res.ok)
      throw new Error("HTTP_" + res.status);

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* MARKET DATA */

async function coinLore(symbol) {
  const id = IDS[symbol];

  const data = await fetchJSON(
    "https://api.coinlore.net/api/ticker/?id=" + id
  );

  const item = Array.isArray(data) ? data[0] : null;

  if (!item || num(item.price_usd) === null)
    throw new Error("COINLORE_DATA_UNAVAILABLE");

  return {
    symbol,
    price: num(item.price_usd),
    change1h: num(item.percent_change_1h),
    change24h: num(item.percent_change_24h),
    change7d: num(item.percent_change_7d),
    volume24h: num(item.volume24),
    marketCap: num(item.market_cap_usd),
    source: "CoinLore",
    priceType: "INDICATIVE_AGGREGATE",
    fetchedAt: now(),
    priceTimestampVerified: false
  };
}

async function marketData() {
  const results = await Promise.allSettled(
    ["ZEC", "BTC", "ETH"].map(coinLore)
  );

  const market = {};
  const errors = [];

  ["ZEC", "BTC", "ETH"].forEach((symbol, i) => {
    if (results[i].status === "fulfilled") {
      market[symbol] = results[i].value;
    } else {
      market[symbol] = null;
      errors.push(symbol + ": " + results[i].reason.message);
    }
  });

  return {
    ok: Boolean(market.ZEC),
    market,
    errors
  };
}

function marketContext(market) {
  const btc = market.BTC;
  const eth = market.ETH;
  const zec = market.ZEC;

  if (!btc || !eth || !zec) {
    return {
      regime: "UNKNOWN",
      score: 0,
      relativeStrength: "UNKNOWN"
    };
  }

  let score = 0;

  if (btc.change24h > 0) score++;
  else score--;

  if (eth.change24h > 0) score++;
  else score--;

  if (zec.change24h > 0) score++;
  else score--;

  return {
    regime:
      score >= 2 ? "RISK_ON" :
      score <= -2 ? "RISK_OFF" :
      "MIXED",
    score,
    relativeStrength:
      zec.change24h > btc.change24h
        ? "STRONG"
        : "WEAK"
  };
}

/* FREE KRAKEN OHLCV */

async function krakenCandles(timeframe) {
  const interval = TIMEFRAMES[timeframe];

  if (!interval)
    throw new Error("INVALID_TIMEFRAME");

  const url = new URL(
    "https://api.kraken.com/0/public/OHLC"
  );

  url.searchParams.set("pair", "ZECUSD");
  url.searchParams.set("interval", String(interval));

  const data = await fetchJSON(url.toString());

  if (!Array.isArray(data.error) || data.error.length)
    throw new Error("KRAKEN_API_ERROR");

  const entries = Object.entries(data.result || {})
    .filter(([key, value]) =>
      key !== "last" && Array.isArray(value)
    );

  if (entries.length !== 1)
    throw new Error("KRAKEN_PAIR_UNAVAILABLE");

  const candles = entries[0][1].map(row => ({
    time: Number(row[0]) * 1000,
    open: num(row[1]),
    high: num(row[2]),
    low: num(row[3]),
    close: num(row[4]),
    volume: num(row[6])
  }));

  return validateCandles(candles, timeframe);
}

function validateCandles(candles, timeframe) {
  if (!Array.isArray(candles) || candles.length < 60)
    throw new Error("INSUFFICIENT_CANDLES");

  const duration = TIMEFRAMES[timeframe] * 60000;
  const current = Date.now();

  const valid = candles.filter(c => {
    if (!Number.isFinite(c.time)) return false;

    if (![c.open,c.high,c.low,c.close].every(
      x => x !== null && x > 0
    )) return false;

    if (c.high < Math.max(c.open,c.close,c.low))
      return false;

    if (c.low > Math.min(c.open,c.close,c.high))
      return false;

    return c.time + duration <= current;
  });

  if (valid.length < 55)
    throw new Error("INSUFFICIENT_CLOSED_CANDLES");

  for (let i = 1; i < valid.length; i++) {
    if (valid[i].time <= valid[i-1].time)
      throw new Error("CANDLES_NOT_SORTED");
  }

  const last = valid[valid.length - 1];

  if (current - (last.time + duration) > duration * 2)
    throw new Error("STALE_CANDLES");

  return valid.slice(-240);
}

/* TECHNICAL INDICATORS */

function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  let result = values
    .slice(0, period)
    .reduce((a,b) => a+b,0) / period;

  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1-k);
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length < period + 1)
    return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i-1];

    gains += Math.max(diff,0);
    losses += Math.max(-diff,0);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i-1];

    avgGain = (
      avgGain * (period-1) + Math.max(diff,0)
    ) / period;

    avgLoss = (
      avgLoss * (period-1) + Math.max(-diff,0)
    ) / period;
  }

  if (avgLoss === 0)
    return avgGain === 0 ? 50 : 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(candles, period = 14) {
  if (candles.length < period + 1)
    return null;

  const tr = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const previous = candles[i-1].close;

    tr.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - previous),
      Math.abs(c.low - previous)
    ));
  }

  let value = tr
    .slice(0,period)
    .reduce((a,b) => a+b,0) / period;

  for (let i = period; i < tr.length; i++) {
    value = (
      value * (period-1) + tr[i]
    ) / period;
  }

  return value;
}

function analyzeTimeframe(candles, timeframe) {
  const closes = candles.map(c => c.close);

  const ema20 = ema(closes,20);
  const ema50 = ema(closes,50);
  const rsi14 = rsi(closes);
  const atr14 = atr(candles);

  const last = candles[candles.length-1];

  let trend = "SIDEWAYS";

  if (last.close > ema20 && ema20 > ema50)
    trend = "BULLISH";

  if (last.close < ema20 && ema20 < ema50)
    trend = "BEARISH";

  return {
    timeframe,
    source: "Kraken ZEC/USD",
    lastClosedCandle: new Date(
      last.time + TIMEFRAMES[timeframe] * 60000
    ).toISOString(),
    close: round(last.close),
    ema20: round(ema20),
    ema50: round(ema50),
    rsi14: round(rsi14),
    atr14: round(atr14),
    trend,
    candlesValidated: candles.length
  };
}

async function technicalData() {
  const frames = Object.keys(TIMEFRAMES);

  const results = await Promise.allSettled(
    frames.map(async frame => {
      const candles = await krakenCandles(frame);
      return analyzeTimeframe(candles,frame);
    })
  );

  const timeframes = {};
  const errors = [];

  results.forEach((result,i) => {
    if (result.status === "fulfilled") {
      timeframes[frames[i]] = result.value;
    } else {
      errors.push(
        frames[i] + ": " + result.reason.message
      );
    }
  });

  const ok = frames.every(
    frame => Boolean(timeframes[frame])
  );

  return {
    ok,
    status: ok ? "VERIFIED" : "INCOMPLETE",
    source: "Kraken Public OHLCV",
    timeframes,
    errors
  };
}

/* FRED MACRO */

async function fredSeries(series, apiKey) {
  const url = new URL(
    "https://api.stlouisfed.org/fred/series/observations"
  );

  url.searchParams.set("series_id",series);
  url.searchParams.set("api_key",apiKey);
  url.searchParams.set("file_type","json");
  url.searchParams.set("sort_order","desc");
  url.searchParams.set("limit","10");

  const data = await fetchJSON(url.toString());

  const observation = (data.observations || [])
    .find(x => num(x.value) !== null);

  if (!observation)
    throw new Error("FRED_DATA_UNAVAILABLE");

  return {
    series,
    value: num(observation.value),
    date: observation.date,
    source: "FRED"
  };
}

async function macroData(env) {
  if (!env.FRED_API_KEY) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      indicators: {},
      errors: ["FRED_API_KEY_MISSING"]
    };
  }

  const indicators = {};
  const errors = [];

  await Promise.all(
    Object.keys(FRED_SERIES).map(async series => {
      try {
        indicators[series] = await fredSeries(
          series,env.FRED_API_KEY
        );
      } catch(e) {
        errors.push(series + ": " + e.message);
      }
    })
  );

  return {
    ok: errors.length === 0,
    status: errors.length ? "PARTIAL" : "OK",
    indicators,
    errors,
    source: "FRED"
  };
}

/* ECONOMIC EVENTS */

function economicEvents() {
  const today = Date.now();

  const events = FOMC_2026
    .map(date => ({
      name: "FOMC Meeting",
      nameCN: "美联储利率决议",
      date,
      impact: "HIGH",
      source: "Static 2026 Calendar",
      daysAway: Math.ceil(
        (Date.parse(date+"T00:00:00Z") - today)
        / 86400000
      )
    }))
    .filter(e => e.daysAway >= 0)
    .sort((a,b) => a.daysAway-b.daysAway);

  return {
    ok: true,
    status: "STATIC_CALENDAR",
    nextEvent: events[0] || null,
    events,
    warningCN: "静态日历，事件日期须以官方公告核实。"
  };
}

/* GEOPOLITICAL INTELLIGENCE */

async function geopoliticalData(env) {
  let cached = null;

  if (env.INTEL_KV) {
    try {
      cached = await env.INTEL_KV.get(
        GEO_KEY,"json"
      );
    } catch(e) {}
  }

  if (cached && cached.timestamp) {
    const age = Date.now() -
      Date.parse(cached.timestamp);

    if (age >= 0 && age < 21600000 &&
        cached.dataAvailable === true) {
      return {
        ...cached,
        cacheUsed: true,
        live: false
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
    error: "INSUFFICIENT_GEO_EVIDENCE",
    messageCN:
      "缺少可验证的实时地缘政治证据，风险保持未知。"
  };
}

/* GLOBAL RISK */

function globalRiskFusion(
  context,macro,events,geo
) {
  let score = 0;
  const reasons = [];

  if (context.regime === "RISK_OFF") {
    score += 2;
    reasons.push("加密市场风险偏好下降");
  }

  if (context.regime === "RISK_ON")
    score -= 1;

  const vix = macro.indicators?.VIXCLS?.value;

  if (vix !== undefined && vix !== null) {
    if (vix > 30) {
      score += 2;
      reasons.push("VIX处于较高水平");
    }
  }

  if (events.nextEvent &&
      events.nextEvent.daysAway <= 2) {
    score += 1;
    reasons.push("临近重要经济事件");
  }

  const geoUnknown = !geo.dataAvailable;

  return {
    risk: geoUnknown
      ? "UNCERTAIN"
      : score >= 3
        ? "HIGH"
        : score >= 1
          ? "MODERATE"
          : "LOW",
    riskScore: score,
    geopoliticalRisk: geo.risk,
    signalPermission: geoUnknown
      ? "REDUCED_CONFIDENCE"
      : "NORMAL",
    reasons
  };
}

/* DECISION ENGINE */

function decisionEngine(technical,context,risk) {
  if (!technical.ok) {
    return {
      action: "WAIT",
      actionCN: "等待确认",
      trend: "UNVERIFIED",
      setupScore: 0,
      entryQuality: 0,
      reasons: ["真实多周期K线数据未通过验证"]
    };
  }

  const frames = technical.timeframes;

  const bullish = Object.values(frames)
    .filter(x => x.trend === "BULLISH").length;

  const bearish = Object.values(frames)
    .filter(x => x.trend === "BEARISH").length;

  const trend = bullish >= 3
    ? "BULLISH"
    : bearish >= 3
      ? "BEARISH"
      : "MIXED";

  let score = Math.max(bullish,bearish) * 20;

  if (context.regime === "RISK_OFF" &&
      trend === "BEARISH")
    score += 10;

  if (context.regime === "RISK_ON" &&
      trend === "BULLISH")
    score += 10;

  score = clamp(score,0,100);

  const rsi15 = frames["15m"].rsi14;
  const rsi1h = frames["1h"].rsi14;

  const buyConfirm =
    trend === "BULLISH" &&
    rsi15 > 50 &&
    rsi1h > 50;

  const sellConfirm =
    trend === "BEARISH" &&
    rsi15 < 50 &&
    rsi1h < 50;

  let action = "WAIT";

  if (score >= 70 &&
      risk.risk !== "HIGH") {
    if (buyConfirm) action = "BUY";
    if (sellConfirm) action = "SELL";
  }

  return {
    action,
    actionCN:
      action === "BUY" ? "模拟买入" :
      action === "SELL" ? "模拟卖出" :
      "等待确认",
    trend,
    setupScore: score,
    entryQuality: score,
    reasons: [
      "多周期趋势验证",
      "EMA20与EMA50",
      "RSI动量确认",
      "全球风险过滤"
    ],
    forcedBuySell: false
  };
}

/* TRADE SIMULATION */

function tradePlan(technical,decision,risk) {
  const waiting = {
    action: "WAIT",
    status: "NO_TRADE",
    entry: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    takeProfit3: null,
    riskReward: null,
    simulationOnly: true,
    executionEnabled: false
  };

  if (!technical.ok ||
      decision.action === "WAIT")
    return {
      ...waiting,
      reason: "等待真实K线及入场信号确认"
    };

  const h1 = technical.timeframes["1h"];

  const entry = h1.close;
  const volatility = h1.atr14;

  if (!entry || !volatility ||
      volatility <= 0)
    return {
      ...waiting,
      reason: "ATR数据无效"
    };

  const direction =
    decision.action === "BUY" ? 1 : -1;

  const riskDistance = volatility * 1.5;

  const stopLoss =
    entry - direction * riskDistance;

  const tp1 =
    entry + direction * riskDistance;

  const tp2 =
    entry + direction * riskDistance * 2;

  const tp3 =
    entry + direction * riskDistance * 3;

  return {
    action: decision.action,
    status: "SIMULATED_SETUP",
    entry: round(entry),
    stopLoss: round(stopLoss),
    takeProfit1: round(tp1),
    takeProfit2: round(tp2),
    takeProfit3: round(tp3),
    riskReward: {
      TP1: "1:1",
      TP2: "1:2",
      TP3: "1:3"
    },
    referenceMarket: "Kraken ZEC/USD",
    simulationOnly: true,
    executionEnabled: false,
    warningCN:
      "模拟入场价格不代表实际可成交报价。"
  };
}

/* PRICE ALERTS */

function priceAlerts(market) {
  const price = market?.price;

  if (price === null || price === undefined) {
    return {
      ok: false,
      status: "PRICE_UNAVAILABLE"
    };
  }

  return {
    ok: true,
    symbol: "ZECUSD",
    price,
    roundedPrice: Math.round(price),
    source: "CoinLore",
    status: "READ_ONLY",
    baselineWrites: false,
    messageCN:
      "价格仅供参考；未修改任何预设提醒阈值。"
  };
}

/* MAIN INTELLIGENCE */

async function intelligence(env) {
  const started = Date.now();

  const [marketResult,technical,macro,geo] =
    await Promise.all([
      marketData(),
      technicalData(),
      macroData(env),
      geopoliticalData(env)
    ]);

  const events = economicEvents();

  const context = marketContext(
    marketResult.market
  );

  const risk = globalRiskFusion(
    context,macro,events,geo
  );

  const decision = decisionEngine(
    technical,context,risk
  );

  const plan = tradePlan(
    technical,decision,risk
  );

  return {
    ok: marketResult.ok,
    service: "ZEC AI Intelligence",
    version: VERSION,
    mission:
      "AI Market Intelligence and Trading Simulation",
    timestamp: now(),
    elapsedMs: Date.now()-started,
    market: marketResult.market,
    marketContext: context,
    decision,
    technical,
    tradePlan: plan,
    macro,
    events,
    geopolitical: geo,
    globalRisk: risk,
    dataQuality: {
      market: marketResult.ok ? "OK" : "DEGRADED",
      technical: technical.status,
      macro: macro.status,
      geopolitical: geo.status,
      confidence:
        technical.ok && marketResult.ok
          ? 85
          : 40
    },
    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。"
  };
}

/* STATUS */

function status(env) {
  return {
    ok: true,
    service: "ZEC AI Intelligence",
    version: VERSION,
    status: "ONLINE",
    timestamp: now(),
    architecture:
      "Cloudflare Worker + CoinLore + Kraken + FRED + Workers AI + KV",
    modules: {
      coinLoreMarket: "ACTIVE",
      btcContext: "ACTIVE",
      ethContext: "ACTIVE",
      krakenOHLCV: "PUBLIC_API_CONFIGURED",
      multiTimeframeEngine: "ACTIVE",
      emaEngine: "ACTIVE",
      rsiEngine: "ACTIVE",
      atrEngine: "ACTIVE",
      fredMacro:
        env.FRED_API_KEY
          ? "CONFIGURED"
          : "NOT_CONFIGURED",
      economicEventRadar: "STATIC_2026",
      workersAI:
        env.AI ? "BOUND" : "NOT_BOUND",
      geopoliticalEngine:
        "FAIL_CLOSED",
      persistentKV:
        env.INTEL_KV
          ? "CONFIGURED"
          : "NOT_BOUND",
      tradeSimulation: "ACTIVE",
      stopLossEngine: "ACTIVE",
      takeProfitEngine: "ACTIVE",
      globalRiskFusion: "ACTIVE",
      priceAlerts: "READ_ONLY"
    },
    policies: {
      marketSource: "COINLORE",
      candleSource: "KRAKEN_PUBLIC",
      automaticTrading: false,
      simulationOnly: true,
      missingCandles: "WAIT",
      staleCandles: "WAIT",
      unknownRisk: "CAUTION",
      alertBaselineWrites: false
    },
    messageCN:
      "ZEC AI Intelligence V4.9.1 已启动"
  };
}

/* ROUTER */

export default {
  async fetch(request,env) {
    if (request.method === "OPTIONS") {
      return new Response(null,{
        status:204,
        headers:{
          "Access-Control-Allow-Origin":"*",
          "Access-Control-Allow-Methods":"GET,OPTIONS",
          "Access-Control-Allow-Headers":"Content-Type"
        }
      });
    }

    if (request.method !== "GET") {
      return json({
        ok:false,
        error:"METHOD_NOT_ALLOWED"
      },405);
    }

    const path = new URL(request.url).pathname;

    try {
      switch(path) {
        case "/":
        case "/status":
          return json(status(env));

        case "/market":
          return json(await marketData());

        case "/technical":
          return json(await technicalData());

        case "/macro":
          return json(await macroData(env));

        case "/events":
          return json(economicEvents());

        case "/geopolitical":
          return json(await geopoliticalData(env));

        case "/intelligence":
          return json(await intelligence(env));

        case "/trade-plan": {
          const data = await intelligence(env);

          return json({
            ok: data.technical.ok,
            version: VERSION,
            timestamp: data.timestamp,
            market: data.market.ZEC,
            decision: data.decision,
            technical: data.technical,
            globalRisk: data.globalRisk,
            tradePlan: data.tradePlan
          });
        }

        case "/alerts": {
          const data = await marketData();
          return json(priceAlerts(data.market.ZEC));
        }

        case "/fred-test":
          return json(
            env.FRED_API_KEY
              ? await fredSeries(
                  "DGS10",env.FRED_API_KEY
                )
              : {
                  ok:false,
                  status:"NOT_CONFIGURED"
                }
          );

        case "/kv-test":
          return json({
            ok:Boolean(env.INTEL_KV),
            status:env.INTEL_KV
              ? "BOUND"
              : "NOT_BOUND",
            readOnly:true
          });

        case "/ai-test":
          return json({
            ok:Boolean(env.AI),
            status:env.AI
              ? "BOUND"
              : "NOT_BOUND",
            model:AI_MODEL,
            inferenceTested:false
          });

        case "/websearch-test":
          return json({
            ok:typeof env.AI?.websearch === "function",
            status:
              typeof env.AI?.websearch === "function"
                ? "AVAILABLE"
                : "UNAVAILABLE",
            searchExecuted:false
          });

        default:
          return json({
            ok:false,
            version:VERSION,
            error:"ROUTE_NOT_FOUND",
            availableRoutes:[
              "/status",
              "/market",
              "/technical",
              "/macro",
              "/events",
              "/geopolitical",
              "/intelligence",
              "/trade-plan",
              "/alerts",
              "/fred-test",
              "/kv-test",
              "/ai-test",
              "/websearch-test"
            ]
          },404);
      }
    } catch(error) {
      return json({
        ok:false,
        version:VERSION,
        timestamp:now(),
        error:error.message,
        messageCN:
          "数据读取失败，安全机制已阻止无效交易信号。"
      },502);
    }
  }
};

/*
 END OF ZEC AI INTELLIGENCE WORKER V4.9.1
*/
