/*
 ZEC AI Intelligence Worker V4.6.0
 Chinese Intelligence Mission
 Sequential FRED Macro Engine
 Economic Event Radar
 Fast-Fail Geopolitical Engine
 Global Risk Fusion
 Research & simulation only.
*/

const VERSION="4.6.0";

const HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Content-Type":"application/json;charset=UTF-8",
  "Cache-Control":"no-store"
};

const IDS={
  ZEC:"134",
  BTC:"90",
  ETH:"80"
};

function reply(data,status=200){
  return new Response(
    JSON.stringify(data,null,2),
    {
      status,
      headers:HEADERS
    }
  );
}

function num(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function clamp(v,min,max){
  return Math.max(min,Math.min(max,v));
}

function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

/* =========================================================
   HTTP
========================================================= */

async function getJSON(url,timeout=7000){
  const controller=new AbortController();
  const timer=setTimeout(
    ()=>controller.abort(),
    timeout
  );

  try{
    const response=await fetch(
      url,
      {
        signal:controller.signal,
        headers:{
          "Accept":"application/json",
          "User-Agent":"ZEC-AI-Intelligence/4.6.0"
        }
      }
    );

    if(!response.ok){
      const error=new Error(
        `HTTP ${response.status}`
      );

      error.status=response.status;
      throw error;
    }

    return await response.json();

  }catch(error){

    if(error.name==="AbortError"){
      const timeoutError=
        new Error("TIMEOUT");

      timeoutError.code="TIMEOUT";
      throw timeoutError;
    }

    throw error;

  }finally{
    clearTimeout(timer);
  }
}

/* =========================================================
   MARKET
========================================================= */

async function coinLore(symbol){

  const data=await getJSON(
    `https://api.coinlore.net/api/ticker/?id=${IDS[symbol]}`,
    6000
  );

  if(
    !Array.isArray(data) ||
    !data[0]
  ){
    throw new Error(
      "CoinLore invalid response"
    );
  }

  const x=data[0];

  return {
    symbol,
    price:num(x.price_usd),
    change1h:num(x.percent_change_1h),
    change24h:num(x.percent_change_24h),
    change7d:num(x.percent_change_7d),
    volume24h:num(x.volume24),
    marketCap:num(x.market_cap_usd),
    source:"CoinLore"
  };
}

const BINANCE=[
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com"
];

async function binance(symbol){

  let lastError="";

  for(const host of BINANCE){

    try{

      const x=await getJSON(
        `${host}/api/v3/ticker/24hr?symbol=${symbol}USDT`,
        4000
      );

      return {
        symbol,
        price:num(x.lastPrice),
        change1h:null,
        change24h:num(x.priceChangePercent),
        change7d:null,
        volume24h:num(x.quoteVolume),
        marketCap:null,
        source:"Binance"
      };

    }catch(error){
      lastError=error.message;
    }
  }

  throw new Error(
    lastError || "Binance unavailable"
  );
}

async function asset(symbol){

  try{
    return await coinLore(symbol);

  }catch(error){

    const x=await binance(symbol);

    x.fallbackReason=
      error.message;

    return x;
  }
}

function marketContext(
  zec,
  btc,
  eth
){

  let score=0;

  if(btc?.change24h>0) score++;
  if(btc?.change24h>=2) score++;

  if(btc?.change24h<0) score--;
  if(btc?.change24h<=-2) score--;

  if(eth?.change24h>0) score++;
  if(eth?.change24h>=2) score++;

  if(eth?.change24h<0) score--;
  if(eth?.change24h<=-2) score--;

  let regime="NEUTRAL";

  if(score>=3){
    regime="RISK_ON";
  }

  if(score<=-3){
    regime="RISK_OFF";
  }

  let relativeStrength="NEUTRAL";

  if(
    zec?.change24h!=null &&
    btc?.change24h!=null &&
    eth?.change24h!=null
  ){

    const benchmark=
      (
        btc.change24h+
        eth.change24h
      )/2;

    const relative=
      zec.change24h-
      benchmark;

    if(relative>=2){
      relativeStrength="STRONG";
    }

    if(relative<=-2){
      relativeStrength="WEAK";
    }
  }

  return {
    regime,
    score,
    relativeStrength
  };
}

async function marketData(){

  const results=
    await Promise.allSettled([
      asset("ZEC"),
      asset("BTC"),
      asset("ETH")
    ]);

  const market={

    ZEC:
      results[0].status==="fulfilled"
        ?results[0].value
        :null,

    BTC:
      results[1].status==="fulfilled"
        ?results[1].value
        :null,

    ETH:
      results[2].status==="fulfilled"
        ?results[2].value
        :null
  };

  return {
    market,
    context:marketContext(
      market.ZEC,
      market.BTC,
      market.ETH
    )
  };
}

/* =========================================================
   FRED MACRO
========================================================= */

const FRED={

  DGS10:
    "US 10Y Treasury",

  DFF:
    "Fed Funds Rate",

  DTWEXBGS:
    "US Dollar Index Broad",

  VIXCLS:
    "VIX",

  CPIAUCSL:
    "US CPI",

  UNRATE:
    "US Unemployment"
};

async function fredSeries(
  id,
  key
){

  const params=
    new URLSearchParams({
      series_id:id,
      api_key:key,
      file_type:"json",
      sort_order:"desc",
      limit:"5"
    });

  const data=await getJSON(
    `https://api.stlouisfed.org/fred/series/observations?${params}`,
    10000
  );

  const valid=
    (data.observations||[])
    .filter(
      x=>
        x.value!=="." &&
        Number.isFinite(
          Number(x.value)
        )
    );

  if(!valid.length){
    throw new Error(
      "No observations"
    );
  }

  const latest=valid[0];
  const previous=valid[1];

  return {

    seriesId:id,

    name:FRED[id],

    value:
      Number(latest.value),

    date:
      latest.date,

    previousValue:
      previous
        ?Number(previous.value)
        :null,

    change:
      previous
        ?Number(latest.value)-
         Number(previous.value)
        :null,

    source:"FRED"
  };
}

function macroAnalysis(indicators){

  let score=0;
  const reasons=[];

  if(
    indicators.DTWEXBGS?.change>0
  ){
    score++;

    reasons.push(
      "美元指数走强，对加密资产形成压力"
    );
  }

  if(
    indicators.DTWEXBGS?.change<0
  ){
    score--;

    reasons.push(
      "美元指数回落，对风险资产相对有利"
    );
  }

  if(
    indicators.VIXCLS?.value>=30
  ){

    score+=3;

    reasons.push(
      "VIX高于30，市场压力显著升高"
    );

  }else if(
    indicators.VIXCLS?.value>=20
  ){

    score+=2;

    reasons.push(
      "VIX高于20，市场风险偏好谨慎"
    );
  }

  if(
    indicators.DGS10?.change>=0.08
  ){

    score+=2;

    reasons.push(
      "美国10年期国债收益率上升"
    );
  }

  if(
    indicators.CPIAUCSL?.change>0
  ){

    score++;

    reasons.push(
      "最新CPI指数较前值上升"
    );
  }

  let regime="NEUTRAL";
  let risk="MEDIUM";

  if(score>=3){

    regime="RISK_OFF";
    risk="HIGH";

  }else if(score<=-2){

    regime="RISK_ON";
    risk="LOW";
  }

  return {
    regime,
    risk,
    riskScore:score,
    reasons
  };
}

async function macroData(env){

  if(!env.FRED_API_KEY){

    return {
      ok:false,
      status:"NOT_CONFIGURED",
      risk:"UNKNOWN",
      regime:"UNKNOWN",
      messageCN:
        "FRED API密钥尚未配置"
    };
  }

  const indicators={};
  const errors=[];

  /*
   V4.6:
   sequential requests reduce
   upstream timeout/rate problems
  */

  for(const id of Object.keys(FRED)){

    try{

      const result=
        await fredSeries(
          id,
          env.FRED_API_KEY
        );

      indicators[id]=result;

    }catch(error){

      errors.push(
        `${id}: ${error.message}`
      );
    }

    await sleep(80);
  }

  const count=
    Object.keys(indicators).length;

  if(!count){

    return {
      ok:false,
      status:"DATA_UNAVAILABLE",
      risk:"UNKNOWN",
      regime:"UNKNOWN",
      indicators,
      successfulSeries:0,
      totalSeries:
        Object.keys(FRED).length,
      errors,
      messageCN:
        "FRED宏观数据暂时不可用"
    };
  }

  return {

    ok:true,

    status:
      count===
      Object.keys(FRED).length
        ?"OK"
        :"DEGRADED",

    source:"FRED",

    requestMode:
      "SEQUENTIAL",

    successfulSeries:
      count,

    totalSeries:
      Object.keys(FRED).length,

    ...macroAnalysis(
      indicators
    ),

    indicators,
    errors,

    messageCN:
      count===
      Object.keys(FRED).length
        ?"宏观经济数据正常"
        :"部分宏观数据暂时不可用"
  };
}

/* =========================================================
   ECONOMIC EVENT RADAR
========================================================= */

const RELEASES=[

  {
    id:10,
    name:"Consumer Price Index",
    nameCN:"消费者价格指数 CPI",
    impact:"HIGH"
  },

  {
    id:50,
    name:"Employment Situation",
    nameCN:"美国就业报告",
    impact:"HIGH"
  },

  {
    id:53,
    name:"Gross Domestic Product",
    nameCN:"美国国内生产总值 GDP",
    impact:"HIGH"
  },

  {
    id:101,
    name:"Federal Reserve Release",
    nameCN:"美联储相关数据发布",
    impact:"HIGH"
  }
];

function today(){

  return new Date()
    .toISOString()
    .slice(0,10);
}

function daysAway(date){

  return Math.round(
    (
      Date.parse(
        `${date}T00:00:00Z`
      )-
      Date.parse(
        `${today()}T00:00:00Z`
      )
    )/
    86400000
  );
}

async function releaseDates(
  release,
  key
){

  const end=
    new Date(
      Date.now()+
      45*86400000
    )
    .toISOString()
    .slice(0,10);

  const params=
    new URLSearchParams({

      release_id:
        String(release.id),

      api_key:key,

      file_type:"json",

      realtime_start:
        today(),

      realtime_end:
        end,

      include_release_dates_with_no_data:
        "true",

      limit:"10"
    });

  const data=await getJSON(

    `https://api.stlouisfed.org/fred/release/dates?${params}`,

    10000
  );

  return (
    data.release_dates||[]
  )
  .map(x=>x.date)

  .filter(
    date=>date>=today()
  )

  .map(
    date=>({

      releaseId:
        release.id,

      name:
        release.name,

      nameCN:
        release.nameCN,

      impact:
        release.impact,

      date,

      daysAway:
        daysAway(date),

      source:"FRED"
    })
  );
}

async function eventData(env){

  if(!env.FRED_API_KEY){

    return {
      ok:false,
      status:"NOT_CONFIGURED",
      risk:"UNKNOWN",
      score:null,
      events:[],
      messageCN:
        "经济事件雷达未配置"
    };
  }

  let events=[];
  const errors=[];

  /*
   Sequential event requests
  */

  for(
    const release of RELEASES
  ){

    try{

      const data=
        await releaseDates(
          release,
          env.FRED_API_KEY
        );

      events.push(...data);

    }catch(error){

      errors.push(
        `${release.name}: ${error.message}`
      );
    }

    await sleep(80);
  }

  if(
    !events.length &&
    errors.length===
    RELEASES.length
  ){

    return {
      ok:false,
      status:"DATA_UNAVAILABLE",
      risk:"UNKNOWN",
      score:null,
      events:[],
      errors,
      messageCN:
        "经济事件数据暂时不可用"
    };
  }

  events.sort(
    (a,b)=>
      a.date.localeCompare(
        b.date
      )
  );

  const unique=[];
  const seen=new Set();

  for(const event of events){

    const key=
      `${event.releaseId}-${event.date}`;

    if(!seen.has(key)){

      seen.add(key);
      unique.push(event);
    }
  }

  const nextEvent=
    unique[0]||null;

  let risk="LOW";
  let score=0;

  if(nextEvent){

    score=1;

    if(
      nextEvent.daysAway<=1
    ){

      risk="HIGH";
      score=4;

    }else if(
      nextEvent.daysAway<=7
    ){

      risk="MEDIUM";
      score=2;
    }
  }

  return {

    ok:true,

    status:
      errors.length
        ?"DEGRADED"
        :"OK",

    source:"FRED",

    requestMode:
      "SEQUENTIAL",

    horizonDays:45,

    risk,
    score,

    nextEvent,

    events:
      unique.slice(0,15),

    errors,

    messageCN:
      risk==="HIGH"
        ?"近期存在高影响经济数据发布时间"
        :risk==="MEDIUM"
        ?"近期经济事件风险需要关注"
        :"近期经济事件风险较低",

    noteCN:
      "日期仅用于事件监控，不代表市场一定产生特定方向反应。"
  };
}

/* =========================================================
   GEOPOLITICAL INTELLIGENCE
========================================================= */

const GEO_QUERY=
  "(war OR military OR missile OR sanctions OR embargo OR tariff OR \"trade war\" OR \"Red Sea\" OR \"Strait of Hormuz\" OR \"Suez Canal\" OR OPEC OR pipeline)";

const GEO_WORDS={

  WAR:[
    "war",
    "military",
    "missile",
    "invasion",
    "airstrike",
    "attack"
  ],

  SANCTIONS:[
    "sanction",
    "embargo"
  ],

  ENERGY:[
    "oil",
    "opec",
    "pipeline",
    "energy"
  ],

  TRADE:[
    "tariff",
    "trade war",
    "export control"
  ],

  SHIPPING:[
    "red sea",
    "strait of hormuz",
    "suez canal",
    "shipping"
  ]
};

const GEO_WEIGHT={
  WAR:3,
  SANCTIONS:2,
  ENERGY:2,
  TRADE:2,
  SHIPPING:3
};

function geoUnknown(
  reason,
  error=null
){

  return {

    ok:false,

    status:
      "DATA_DEGRADED",

    dataAvailable:false,

    source:"GDELT",

    risk:"UNKNOWN",

    score:null,

    confidence:0,

    reason,

    reasons:[reason],

    groups:[],

    headlines:[],

    errors:
      error
        ?[String(error)]
        :[],

    messageCN:
      "地缘政治数据源暂时不可用，因此风险保持未知，不会被错误判断为低风险。",

    methodology:
      "Unavailable geopolitical data is UNKNOWN, never LOW."
  };
}

function analyseGeo(articles){

  const groups={};

  for(
    const key of
    Object.keys(GEO_WORDS)
  ){

    groups[key]={
      id:key,
      count:0,
      weight:GEO_WEIGHT[key]
    };
  }

  for(const article of articles){

    const title=
      String(
        article.title||""
      )
      .toLowerCase();

    for(
      const [key,words]
      of Object.entries(
        GEO_WORDS
      )
    ){

      if(
        words.some(
          word=>
            title.includes(word)
        )
      ){

        groups[key].count++;
      }
    }
  }

  let score=0;
  const reasons=[];

  for(
    const group of
    Object.values(groups)
  ){

    if(group.count>=10){

      score+=group.weight;

    }else if(
      group.count>=5
    ){

      score+=Math.max(
        1,
        group.weight-1
      );

    }else if(
      group.count>=2
    ){

      score++;
    }

    if(group.count>=2){

      reasons.push(
        `${group.id}: ${group.count} monitored headlines`
      );
    }
  }

  score=
    clamp(
      score,
      0,
      10
    );

  let risk="LOW";

  if(score>=7){

    risk="HIGH";

  }else if(score>=3){

    risk="MEDIUM";
  }

  return {
    risk,
    score,
    reasons,
    groups:
      Object.values(groups)
  };
}

async function geopoliticalData(){

  const params=
    new URLSearchParams({

      query:
        GEO_QUERY,

      mode:
        "ArtList",

      maxrecords:
        "25",

      format:
        "json",

      sort:
        "DateDesc",

      timespan:
        "24h"
    });

  try{

    const data=
      await getJSON(

        `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,

        5500
      );

    if(
      !Array.isArray(
        data?.articles
      )
    ){

      return geoUnknown(
        "GDELT returned no usable dataset."
      );
    }

    const articles=
      data.articles

      .slice(0,25)

      .map(
        article=>({

          title:
            article.title||null,

          url:
            article.url||null,

          domain:
            article.domain||null,

          sourceCountry:
            article.sourcecountry||null,

          seenDate:
            article.seendate||null
        })
      )

      .filter(
        article=>
          article.title
      );

    if(!articles.length){

      return {

        ok:true,

        status:
          "LIMITED_DATA",

        dataAvailable:true,

        source:"GDELT",

        risk:"UNKNOWN",

        score:null,

        confidence:25,

        reasons:[
          "No usable monitored headlines returned."
        ],

        groups:[],

        headlines:[],

        errors:[],

        messageCN:
          "新闻样本不足，地缘政治风险保持未知。"
      };
    }

    const analysis=
      analyseGeo(
        articles
      );

    return {

      ok:true,

      status:"OK",

      dataAvailable:true,

      source:"GDELT",

      ...analysis,

      confidence:
        articles.length>=20
          ?85
          :articles.length>=10
          ?70
          :55,

      articleCount:
        articles.length,

      requestCount:1,

      headlines:
        articles.slice(0,10),

      errors:[],

      messageCN:
        analysis.risk==="HIGH"
          ?"全球地缘政治新闻风险较高"
          :analysis.risk==="MEDIUM"
          ?"全球地缘政治风险需要关注"
          :"当前新闻监控未显示明显高风险",

      methodology:
        "Single GDELT request. News context does not independently create BUY or SELL signals."
    };

  }catch(error){

    if(error.status===429){

      return geoUnknown(

        "GDELT rate limited the request. Geopolitical risk is UNKNOWN.",

        "HTTP 429"
      );
    }

    if(
      error.code==="TIMEOUT" ||
      error.message==="TIMEOUT"
    ){

      return geoUnknown(

        "GDELT did not respond within 5.5 seconds. Geopolitical risk is UNKNOWN.",

        "TIMEOUT"
      );
    }

    return geoUnknown(

      "GDELT source unavailable. Geopolitical risk is UNKNOWN.",

      error.message
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
){

  let confidence=0;

  const marketOK=
    Boolean(
      market.ZEC &&
      market.BTC &&
      market.ETH
    );

  if(marketOK){
    confidence+=40;
  }

  if(macro?.ok){
    confidence+=25;
  }

  if(events?.ok){
    confidence+=20;
  }

  if(
    geo?.ok &&
    geo.risk!=="UNKNOWN"
  ){

    confidence+=
      Math.round(
        15*
        (geo.confidence||0)/
        100
      );
  }

  confidence=
    clamp(
      confidence,
      0,
      100
    );

  let status="OK";

  if(confidence<60){

    status=
      "DATA_INCOMPLETE";

  }else if(
    confidence<90
  ){

    status=
      "DEGRADED";
  }

  return {

    status,

    confidence,

    market:
      marketOK
        ?"OK"
        :"UNAVAILABLE",

    macro:
      macro?.status||
      "UNAVAILABLE",

    events:
      events?.status||
      "UNAVAILABLE",

    geopolitical:
      geo?.status||
      "UNAVAILABLE",

    geopoliticalRisk:
      geo?.risk||
      "UNKNOWN",

    messageCN:
      status==="OK"
        ?"数据质量良好"
        :status==="DEGRADED"
        ?"部分情报源不可用，决策置信度已自动降低"
        :"数据不足，只能进行谨慎观察",

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
){

  let score=0;
  const reasons=[];

  if(
    context.regime===
    "RISK_OFF"
  ){

    score+=2;

    reasons.push(
      "加密市场环境偏向风险规避"
    );
  }

  if(
    context.regime===
    "RISK_ON"
  ){
    score--;
  }

  if(
    macro?.regime===
    "RISK_OFF"
  ){

    score+=3;

    reasons.push(
      "宏观经济环境处于风险规避状态"
    );
  }

  if(
    macro?.regime===
    "RISK_ON"
  ){
    score--;
  }

  if(
    events?.risk===
    "HIGH"
  ){

    score+=3;

    reasons.push(
      "高影响经济事件临近"
    );

  }else if(
    events?.risk===
    "MEDIUM"
  ){

    score++;

    reasons.push(
      "近期存在需要关注的经济事件"
    );
  }

  if(
    geo?.risk===
    "HIGH"
  ){

    score+=2;

    reasons.push(
      "地缘政治监控风险较高"
    );

  }else if(
    geo?.risk===
    "MEDIUM"
  ){

    score++;

    reasons.push(
      "地缘政治风险需要关注"
    );

  }else if(
    geo?.risk===
    "UNKNOWN"
  ){

    reasons.push(
      "地缘政治风险未知，不采用低风险假设"
    );
  }

  score=
    clamp(
      score,
      0,
      10
    );

  let risk="LOW";
  let posture="NORMAL";

  if(score>=7){

    risk="HIGH";
    posture="DEFENSIVE";

  }else if(score>=4){

    risk="MEDIUM";
    posture="CAUTIOUS";
  }

  const reliability=
    qualityData.confidence<60
      ?"LOW"
      :qualityData.confidence<90
      ?"MEDIUM"
      :"HIGH";

  const signalPermission=
    qualityData.confidence<60
      ?"CAUTION_ONLY"
      :geo?.risk==="UNKNOWN"
      ?"REDUCED_CONFIDENCE"
      :"NORMAL";

  let postureCN="正常观察";

  if(posture==="CAUTIOUS"){
    postureCN="谨慎";
  }

  if(posture==="DEFENSIVE"){
    postureCN="防御";
  }

  return {

    risk,

    riskScore:
      score,

    posture,

    postureCN,

    decisionReliability:
      reliability,

    signalPermission,

    dataConfidence:
      qualityData.confidence,

    reasons,

    messageCN:
      risk==="HIGH"
        ?"综合风险较高，应优先控制风险并等待更清晰确认"
        :risk==="MEDIUM"
        ?"综合风险中等，建议保持谨慎并等待确认"
        :"综合风险暂时较低，但仍需结合市场确认"
  };
}

/* =========================================================
   ZEC DECISION CONTEXT V4.6
========================================================= */

function decisionContext(
  market,
  context,
  macro,
  events,
  geo,
  globalRisk
){

  const zec=market.ZEC;

  if(!zec){

    return {
      action:
        "DATA UNAVAILABLE",

      actionCN:
        "市场数据不足",

      trend:
        "UNKNOWN",

      setupScore:0,

      entryQuality:0,

      chaseRisk:
        "UNKNOWN",

      reasons:[
        "ZEC市场数据不可用"
      ]
    };
  }

  let bearish=0;
  let bullish=0;

  const reasons=[];

  if(
    zec.change24h!=null
  ){

    if(zec.change24h<=-4){

      bearish+=3;

      reasons.push(
        "ZEC 24小时下跌动能较强"
      );

    }else if(
      zec.change24h<0
    ){

      bearish++;

      reasons.push(
        "ZEC 24小时动能偏弱"
      );

    }else if(
      zec.change24h>=4
    ){

      bullish+=3;

      reasons.push(
        "ZEC 24小时上涨动能较强"
      );

    }else if(
      zec.change24h>0
    ){

      bullish++;
    }
  }

  if(
    context.relativeStrength===
    "WEAK"
  ){

    bearish+=2;

    reasons.push(
      "ZEC表现弱于BTC和ETH"
    );
  }

  if(
    context.relativeStrength===
    "STRONG"
  ){

    bullish+=2;

    reasons.push(
      "ZEC表现强于BTC和ETH"
    );
  }

  if(
    macro?.regime===
    "RISK_OFF"
  ){

    bearish+=2;

    reasons.push(
      "宏观环境偏向风险规避"
    );
  }

  if(
    macro?.regime===
    "RISK_ON"
  ){
    bullish++;
  }

  let trend="NEUTRAL";

  if(
    bearish>=bullish+2
  ){

    trend="BEARISH";

  }else if(
    bullish>=bearish+2
  ){

    trend="BULLISH";
  }

  const directionalStrength=
    Math.abs(
      bearish-bullish
    );

  let setupScore=
    clamp(
      35+
      directionalStrength*9,
      0,
      100
    );

  if(
    trend==="NEUTRAL"
  ){
    setupScore=
      Math.min(
        setupScore,
        45
      );
  }

  let chaseRisk="LOW";

  const absolute24h=
    Math.abs(
      zec.change24h||0
    );

  if(absolute24h>=7){

    chaseRisk="HIGH";

  }else if(
    absolute24h>=4
  ){

    chaseRisk="MEDIUM";
  }

  let entryQuality=70;

  if(chaseRisk==="MEDIUM"){
    entryQuality-=20;
  }

  if(chaseRisk==="HIGH"){
    entryQuality-=40;
  }

  if(
    globalRisk.risk===
    "HIGH"
  ){
    entryQuality-=20;
  }

  if(
    globalRisk.risk===
    "MEDIUM"
  ){
    entryQuality-=10;
  }

  if(
    geo?.risk===
    "UNKNOWN"
  ){
    entryQuality-=5;
  }

  if(
    events?.risk===
    "HIGH"
  ){
    entryQuality-=10;
  }

  entryQuality=
    clamp(
      entryQuality,
      0,
      100
    );

  let action=
    "WAIT FOR CONFIRMATION";

  let actionCN=
    "等待确认";

  /*
   V4.6 deliberately avoids
   forcing BUY/SELL from weak data.
  */

  if(
    trend==="BULLISH" &&
    setupScore>=70 &&
    entryQuality>=70 &&
    globalRisk.risk!=="HIGH" &&
    globalRisk.signalPermission==="NORMAL"
  ){

    action=
      "BULLISH SETUP";

    actionCN=
      "看涨条件正在形成";
  }

  if(
    trend==="BEARISH" &&
    setupScore>=70 &&
    entryQuality>=70 &&
    globalRisk.risk!=="HIGH" &&
    globalRisk.signalPermission==="NORMAL"
  ){

    action=
      "BEARISH SETUP";

    actionCN=
      "看跌条件正在形成";
  }

  if(
    chaseRisk==="HIGH"
  ){

    action=
      "WAIT FOR CONFIRMATION";

    actionCN=
      "避免追涨杀跌，等待确认";
  }

  return {

    action,
    actionCN,

    trend,

    setupScore:
      Math.round(setupScore),

    entryQuality:
      Math.round(entryQuality),

    chaseRisk,

    reasons
  };
}

/* =========================================================
   COMPLETE INTELLIGENCE
========================================================= */

async function intelligence(env){

  /*
   Market + macro + events + geo
   run independently.
  */

  const results=
    await Promise.allSettled([

      marketData(),

      macroData(env),

      eventData(env),

      geopoliticalData()
    ]);

  const marketResult=
    results[0].status===
    "fulfilled"

    ?results[0].value

    :{
      market:{
        ZEC:null,
        BTC:null,
        ETH:null
      },

      context:{
        regime:"UNKNOWN",
        score:0,
        relativeStrength:
          "UNKNOWN"
      }
    };

  const macro=
    results[1].status===
    "fulfilled"

    ?results[1].value

    :{
      ok:false,
      status:"DATA_UNAVAILABLE",
      risk:"UNKNOWN",
      regime:"UNKNOWN"
    };

  const events=
    results[2].status===
    "fulfilled"

    ?results[2].value

    :{
      ok:false,
      status:"DATA_UNAVAILABLE",
      risk:"UNKNOWN",
      score:null
    };

  const geo=
    results[3].status===
    "fulfilled"

    ?results[3].value

    :geoUnknown(
      "Geopolitical engine failed safely."
    );

  const dataQuality=
    quality(
      marketResult.market,
      macro,
      events,
      geo
    );

  const globalRisk=
    fusion(
      marketResult.context,
      macro,
      events,
      geo,
      dataQuality
    );

  const decision=
    decisionContext(
      marketResult.market,
      marketResult.context,
      macro,
      events,
      geo,
      globalRisk
    );

  return {

    ok:Boolean(
      marketResult.market.ZEC
    ),

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    mission:
      "V4.6 Chinese Intelligence Mission",

    language:
      "zh-CN",

    timestamp:
      new Date()
      .toISOString(),

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

function status(env){

  return {

    ok:true,

    service:
      "ZEC AI Intelligence",

    version:
      VERSION,

    mission:
      "V4.6 Chinese Intelligence Mission",

    status:
      "ONLINE",

    language:
      "zh-CN",

    architecture:
      "Cloudflare Worker Multi-Source Intelligence Gateway",

    modules:{

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
          ?"ACTIVE"
          :"NOT CONFIGURED",

      economicEventRadar:
        env.FRED_API_KEY
          ?"ACTIVE"
          :"NOT CONFIGURED",

      geopoliticalEngine:
        "ACTIVE · SINGLE REQUEST · FAST-FAIL",

      dataQualityEngine:
        "ACTIVE",

      globalRiskFusion:
        "ACTIVE",

      chineseIntelligence:
        "ACTIVE",

      decisionContext:
        "ACTIVE"
    },

    policies:{

      fred:
        "SEQUENTIAL",

      geopoliticalMaxRequests:
        1,

      geopoliticalTimeoutSeconds:
        5.5,

      geopoliticalFailure:
        "UNKNOWN",

      unavailableIsLow:
        false,

      forcedBuySell:
        false
    },

    fredSecretConfigured:
      Boolean(
        env.FRED_API_KEY
      ),

    messageCN:
      "ZEC AI Intelligence V4.6.0运行正常",

    timestamp:
      new Date()
      .toISOString(),

    disclaimerCN:
      "仅用于市场研究及模拟分析，不构成投资建议。"
  };
}

/* =========================================================
   ROUTER
========================================================= */

export default{

  async fetch(
    request,
    env
  ){

    if(
      request.method===
      "OPTIONS"
    ){

      return new Response(
        null,
        {
          status:204,
          headers:HEADERS
        }
      );
    }

    const url=
      new URL(
        request.url
      );

    try{

      if(
        url.pathname==="/" ||
        url.pathname==="/status"
      ){

        return reply(
          status(env)
        );
      }

      if(
        url.pathname===
        "/market"
      ){

        const result=
          await marketData();

        return reply({

          ok:true,

          version:
            VERSION,

          timestamp:
            new Date()
            .toISOString(),

          ...result
        });
      }

      if(
        url.pathname===
        "/macro"
      ){

        return reply(
          await macroData(env)
        );
      }

      if(
        url.pathname===
        "/events"
      ){

        return reply(
          await eventData(env)
        );
      }

      if(
        url.pathname===
        "/geopolitical"
      ){

        return reply(
          await geopoliticalData()
        );
      }

      if(
        url.pathname===
        "/intelligence"
      ){

        return reply(
          await intelligence(env)
        );
      }

      if(
        url.pathname===
        "/fred-test"
      ){

        if(
          !env.FRED_API_KEY
        ){

          return reply(
            {
              ok:false,
              version:VERSION,
              test:
                "FRED_SINGLE_SERIES",
              error:
                "FRED_API_KEY_NOT_CONFIGURED"
            },
            500
          );
        }

        const started=
          Date.now();

        try{

          const result=
            await fredSeries(
              "DGS10",
              env.FRED_API_KEY
            );

          return reply({

            ok:true,

            version:
              VERSION,

            test:
              "FRED_SINGLE_SERIES",

            elapsedMs:
              Date.now()-
              started,

            result
          });

        }catch(error){

          return reply(
            {

              ok:false,

              version:
                VERSION,

              test:
                "FRED_SINGLE_SERIES",

              elapsedMs:
                Date.now()-
                started,

              error:
                error.message
            },
            502
          );
        }
      }

      return reply(
        {

          ok:false,

          version:
            VERSION,

          error:
            "Route not found",

          messageCN:
            "找不到此接口",

          availableRoutes:[
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

    }catch(error){

      return reply(
        {

          ok:false,

          version:
            VERSION,

          timestamp:
            new Date()
            .toISOString(),

          error:
            error?.message||
            String(error),

          messageCN:
            "系统发生异常，但安全机制已经阻止错误数据被当作正常信号。"
        },
        500
      );
    }
  }
};
