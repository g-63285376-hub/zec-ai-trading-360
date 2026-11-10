/*
 ZEC AI Intelligence Worker V4.5.2 Compact
 Fast-Fail Geopolitical Engine
 Research & simulation only.
*/
const VERSION="4.5.2";

const HEADERS={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Methods":"GET,OPTIONS",
 "Access-Control-Allow-Headers":"Content-Type",
 "Content-Type":"application/json;charset=UTF-8",
 "Cache-Control":"no-store"
};

const IDS={ZEC:"134",BTC:"90",ETH:"80"};

function reply(data,status=200){
 return new Response(JSON.stringify(data,null,2),{
  status,
  headers:HEADERS
 });
}

function num(v){
 const n=Number(v);
 return Number.isFinite(n)?n:null;
}

function clamp(v,min,max){
 return Math.max(min,Math.min(max,v));
}

async function getJSON(url,timeout=7000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);

 try{
  const r=await fetch(url,{
   signal:controller.signal,
   headers:{"User-Agent":"ZEC-AI-Intelligence/4.5.2"}
  });

  if(!r.ok){
   const e=new Error(`HTTP ${r.status}`);
   e.status=r.status;
   throw e;
  }

  return await r.json();
 }catch(e){
  if(e.name==="AbortError"){
   const t=new Error("TIMEOUT");
   t.code="TIMEOUT";
   throw t;
  }
  throw e;
 }finally{
  clearTimeout(timer);
 }
}

/* ================= MARKET ================= */

async function coinLore(symbol){
 const data=await getJSON(
  `https://api.coinlore.net/api/ticker/?id=${IDS[symbol]}`,
  6000
 );

 if(!Array.isArray(data)||!data[0]){
  throw new Error("CoinLore invalid response");
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
 let last="";

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
  }catch(e){
   last=e.message;
  }
 }

 throw new Error(last||"Binance unavailable");
}

async function asset(symbol){
 try{
  return await coinLore(symbol);
 }catch(e){
  const x=await binance(symbol);
  x.fallbackReason=e.message;
  return x;
 }
}

function marketContext(zec,btc,eth){
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
 if(score>=3) regime="RISK_ON";
 if(score<=-3) regime="RISK_OFF";

 let relativeStrength="NEUTRAL";

 if(
  zec?.change24h!=null &&
  btc?.change24h!=null &&
  eth?.change24h!=null
 ){
  const benchmark=(btc.change24h+eth.change24h)/2;
  const relative=zec.change24h-benchmark;

  if(relative>=2) relativeStrength="STRONG";
  if(relative<=-2) relativeStrength="WEAK";
 }

 return {regime,score,relativeStrength};
}

async function marketData(){
 const results=await Promise.allSettled([
  asset("ZEC"),
  asset("BTC"),
  asset("ETH")
 ]);

 const market={
  ZEC:results[0].status==="fulfilled"?results[0].value:null,
  BTC:results[1].status==="fulfilled"?results[1].value:null,
  ETH:results[2].status==="fulfilled"?results[2].value:null
 };

 return {
  market,
  context:marketContext(market.ZEC,market.BTC,market.ETH)
 };
}

/* ================= FRED MACRO ================= */

const FRED={
 DGS10:"US 10Y Treasury",
 DFF:"Fed Funds Rate",
 DTWEXBGS:"US Dollar Index Broad",
 VIXCLS:"VIX",
 CPIAUCSL:"US CPI",
 UNRATE:"US Unemployment"
};

async function fredSeries(id,key){
 const p=new URLSearchParams({
  series_id:id,
  api_key:key,
  file_type:"json",
  sort_order:"desc",
  limit:"5"
 });

 const d=await getJSON(
  `https://api.stlouisfed.org/fred/series/observations?${p}`,
  7000
 );

 const valid=(d.observations||[]).filter(
  x=>x.value!=="."&&Number.isFinite(Number(x.value))
 );

 if(!valid.length) throw new Error("No observations");

 const latest=valid[0];
 const previous=valid[1];

 return {
  seriesId:id,
  name:FRED[id],
  value:Number(latest.value),
  date:latest.date,
  previousValue:previous?Number(previous.value):null,
  change:previous?
   Number(latest.value)-Number(previous.value):
   null,
  source:"FRED"
 };
}

function macroAnalysis(i){
 let score=0;
 const reasons=[];

 if(i.DTWEXBGS?.change>0){
  score++;
  reasons.push("US dollar strengthening: crypto headwind");
 }

 if(i.DTWEXBGS?.change<0){
  score--;
  reasons.push("US dollar easing: supportive for risk assets");
 }

 if(i.VIXCLS?.value>=30){
  score+=3;
  reasons.push("VIX above 30: elevated market stress");
 }else if(i.VIXCLS?.value>=20){
  score+=2;
  reasons.push("VIX above 20: risk appetite cautious");
 }

 if(i.DGS10?.change>=0.08){
  score+=2;
  reasons.push("US 10Y yield rising");
 }

 if(i.CPIAUCSL?.change>0){
  score++;
  reasons.push("Latest CPI index increased");
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

 return {regime,risk,riskScore:score,reasons};
}

async function macroData(env){
 if(!env.FRED_API_KEY){
  return {
   ok:false,
   status:"NOT_CONFIGURED",
   risk:"UNKNOWN",
   regime:"UNKNOWN"
  };
 }

 const entries=await Promise.allSettled(
  Object.keys(FRED).map(id=>fredSeries(id,env.FRED_API_KEY))
 );

 const indicators={};
 const errors=[];

 entries.forEach((r,index)=>{
  const id=Object.keys(FRED)[index];

  if(r.status==="fulfilled"){
   indicators[id]=r.value;
  }else{
   errors.push(`${id}: ${r.reason?.message||r.reason}`);
  }
 });

 const count=Object.keys(indicators).length;

 if(!count){
  return {
   ok:false,
   status:"DATA_UNAVAILABLE",
   risk:"UNKNOWN",
   regime:"UNKNOWN",
   indicators,
   errors
  };
 }

 return {
  ok:true,
  status:count===Object.keys(FRED).length?"OK":"DEGRADED",
  source:"FRED",
  ...macroAnalysis(indicators),
  indicators,
  errors
 };
}

/* ================= EVENTS ================= */

const RELEASES=[
 {id:10,name:"Consumer Price Index",impact:"HIGH"},
 {id:50,name:"Employment Situation",impact:"HIGH"},
 {id:53,name:"Gross Domestic Product",impact:"HIGH"},
 {id:101,name:"Federal Reserve Release",impact:"HIGH"}
];

function today(){
 return new Date().toISOString().slice(0,10);
}

function daysAway(date){
 return Math.round(
  (Date.parse(`${date}T00:00:00Z`)-
   Date.parse(`${today()}T00:00:00Z`))/86400000
 );
}

async function releaseDates(r,key){
 const end=new Date(Date.now()+45*86400000)
  .toISOString().slice(0,10);

 const p=new URLSearchParams({
  release_id:String(r.id),
  api_key:key,
  file_type:"json",
  realtime_start:today(),
  realtime_end:end,
  include_release_dates_with_no_data:"true",
  limit:"10"
 });

 const d=await getJSON(
  `https://api.stlouisfed.org/fred/release/dates?${p}`,
  7000
 );

 return (d.release_dates||[])
  .map(x=>x.date)
  .filter(x=>x>=today())
  .map(date=>({
   releaseId:r.id,
   name:r.name,
   impact:r.impact,
   date,
   daysAway:daysAway(date),
   source:"FRED"
  }));
}

async function eventData(env){
 if(!env.FRED_API_KEY){
  return {
   ok:false,
   status:"NOT_CONFIGURED",
   risk:"UNKNOWN",
   score:null,
   events:[]
  };
 }

 const results=await Promise.allSettled(
  RELEASES.map(r=>releaseDates(r,env.FRED_API_KEY))
 );

 let events=[];
 const errors=[];

 results.forEach((x,index)=>{
  if(x.status==="fulfilled"){
   events.push(...x.value);
  }else{
   errors.push(
    `${RELEASES[index].name}: ${x.reason?.message||x.reason}`
   );
  }
 });

 if(results.every(x=>x.status==="rejected")){
  return {
   ok:false,
   status:"DATA_UNAVAILABLE",
   risk:"UNKNOWN",
   score:null,
   events:[],
   errors
  };
 }

 events.sort((a,b)=>a.date.localeCompare(b.date));

 const unique=[];
 const seen=new Set();

 for(const e of events){
  const k=`${e.releaseId}-${e.date}`;
  if(!seen.has(k)){
   seen.add(k);
   unique.push(e);
  }
 }

 const nextEvent=unique[0]||null;

 let risk="LOW";
 let score=0;

 if(nextEvent){
  score=1;

  if(nextEvent.daysAway<=1){
   risk="HIGH";
   score=4;
  }else if(nextEvent.daysAway<=7){
   risk="MEDIUM";
   score=2;
  }
 }

 return {
  ok:true,
  status:errors.length?"DEGRADED":"OK",
  source:"FRED",
  horizonDays:45,
  risk,
  score,
  nextEvent,
  events:unique.slice(0,15),
  errors,
  note:"Date-level release monitoring only; exact announcement times and market surprises are not fabricated."
 };
}

/* ================= GEOPOLITICAL ================= */

const GEO_QUERY=
 "(war OR military OR missile OR sanctions OR embargo OR tariff OR \"trade war\" OR \"Red Sea\" OR \"Strait of Hormuz\" OR \"Suez Canal\" OR OPEC OR pipeline)";

const GEO_WORDS={
 WAR:["war","military","missile","invasion","airstrike","attack"],
 SANCTIONS:["sanction","embargo"],
 ENERGY:["oil","opec","pipeline","energy"],
 TRADE:["tariff","trade war","export control"],
 SHIPPING:["red sea","strait of hormuz","suez canal","shipping"]
};

const GEO_WEIGHT={
 WAR:3,
 SANCTIONS:2,
 ENERGY:2,
 TRADE:2,
 SHIPPING:3
};

function geoUnknown(reason,error=null){
 return {
  ok:false,
  status:"DATA_DEGRADED",
  dataAvailable:false,
  source:"GDELT",
  risk:"UNKNOWN",
  score:null,
  confidence:0,
  reason,
  reasons:[reason],
  groups:[],
  headlines:[],
  errors:error?[String(error)]:[],
  methodology:"Unavailable geopolitical data is UNKNOWN, never LOW."
 };
}

function analyseGeo(articles){
 const groups={};

 for(const key of Object.keys(GEO_WORDS)){
  groups[key]={id:key,count:0,weight:GEO_WEIGHT[key]};
 }

 for(const a of articles){
  const title=String(a.title||"").toLowerCase();

  for(const [key,words] of Object.entries(GEO_WORDS)){
   if(words.some(w=>title.includes(w))){
    groups[key].count++;
   }
  }
 }

 let score=0;
 const reasons=[];

 for(const g of Object.values(groups)){
  if(g.count>=10){
   score+=g.weight;
  }else if(g.count>=5){
   score+=Math.max(1,g.weight-1);
  }else if(g.count>=2){
   score++;
  }

  if(g.count>=2){
   reasons.push(`${g.id}: ${g.count} monitored headlines`);
  }
 }

 score=clamp(score,0,10);

 let risk="LOW";
 if(score>=7) risk="HIGH";
 else if(score>=3) risk="MEDIUM";

 return {
  risk,
  score,
  reasons,
  groups:Object.values(groups)
 };
}

async function geopoliticalData(){
 const p=new URLSearchParams({
  query:GEO_QUERY,
  mode:"ArtList",
  maxrecords:"30",
  format:"json",
  sort:"HybridRel",
  timespan:"24h"
 });

 try{
  const d=await getJSON(
   `https://api.gdeltproject.org/api/v2/doc/doc?${p}`,
   6000
  );

  if(!Array.isArray(d?.articles)){
   return geoUnknown("GDELT returned no usable dataset.");
  }

  const articles=d.articles
   .slice(0,30)
   .map(a=>({
    title:a.title||null,
    url:a.url||null,
    domain:a.domain||null,
    sourceCountry:a.sourcecountry||null,
    seenDate:a.seendate||null
   }))
   .filter(a=>a.title);

  if(!articles.length){
   return {
    ok:true,
    status:"LIMITED_DATA",
    dataAvailable:true,
    source:"GDELT",
    risk:"UNKNOWN",
    score:null,
    confidence:25,
    reasons:["No usable monitored headlines returned."],
    groups:[],
    headlines:[],
    errors:[]
   };
  }

  const analysis=analyseGeo(articles);

  return {
   ok:true,
   status:"OK",
   dataAvailable:true,
   source:"GDELT",
   ...analysis,
   confidence:articles.length>=20?85:articles.length>=10?70:55,
   articleCount:articles.length,
   requestCount:1,
   headlines:articles.slice(0,12),
   errors:[],
   methodology:"Single GDELT query; headlines provide context only and do not independently create BUY or SELL signals."
  };

 }catch(e){
  if(e.status===429){
   return geoUnknown(
    "GDELT rate limited the request. Geopolitical risk is UNKNOWN.",
    "HTTP 429"
   );
  }

  if(e.code==="TIMEOUT"||e.message==="TIMEOUT"){
   return geoUnknown(
    "GDELT did not respond within 6 seconds. Geopolitical risk is UNKNOWN.",
    "TIMEOUT"
   );
  }

  return geoUnknown(
   "GDELT source unavailable. Geopolitical risk is UNKNOWN.",
   e.message
  );
 }
}

/* ================= QUALITY + RISK ================= */

function quality(market,macro,events,geo){
 let confidence=0;

 const marketOK=Boolean(
  market.ZEC&&market.BTC&&market.ETH
 );

 if(marketOK) confidence+=40;
 if(macro?.ok) confidence+=25;
 if(events?.ok) confidence+=20;

 if(geo?.ok&&geo.risk!=="UNKNOWN"){
  confidence+=Math.round(15*(geo.confidence||0)/100);
 }

 confidence=clamp(confidence,0,100);

 return {
  status:
   confidence<60?"DATA_INCOMPLETE":
   confidence<90?"DEGRADED":
   "OK",
  confidence,
  market:marketOK?"OK":"UNAVAILABLE",
  macro:macro?.status||"UNAVAILABLE",
  events:events?.status||"UNAVAILABLE",
  geopolitical:geo?.status||"UNAVAILABLE",
  geopoliticalRisk:geo?.risk||"UNKNOWN",
  rule:"Unavailable intelligence is never treated as LOW risk."
 };
}

function fusion(context,macro,events,geo,q){
 let score=0;
 const reasons=[];

 if(context.regime==="RISK_OFF"){
  score+=2;
  reasons.push("Crypto market environment risk-off");
 }

 if(context.regime==="RISK_ON") score--;

 if(macro?.regime==="RISK_OFF"){
  score+=3;
  reasons.push("Macro environment risk-off");
 }

 if(macro?.regime==="RISK_ON") score--;

 if(events?.risk==="HIGH"){
  score+=3;
  reasons.push("High-impact economic event approaching");
 }else if(events?.risk==="MEDIUM"){
  score++;
 }

 if(geo?.risk==="HIGH"){
  score+=2;
  reasons.push("Elevated geopolitical monitoring risk");
 }else if(geo?.risk==="MEDIUM"){
  score++;
 }else if(geo?.risk==="UNKNOWN"){
  reasons.push("Geopolitical risk UNKNOWN; no LOW-risk assumption applied");
 }

 score=clamp(score,0,10);

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
  q.confidence<60?"LOW":
  q.confidence<90?"MEDIUM":
  "HIGH";

 const signalPermission=
  q.confidence<60?"CAUTION_ONLY":
  geo?.risk==="UNKNOWN"?"REDUCED_CONFIDENCE":
  "NORMAL";

 return {
  risk,
  riskScore:score,
  posture,
  decisionReliability:reliability,
  signalPermission,
  dataConfidence:q.confidence,
  reasons
 };
}

/* ================= INTELLIGENCE ================= */

async function intelligence(env){
 const [m,macroR,eventR,geoR]=await Promise.allSettled([
  marketData(),
  macroData(env),
  eventData(env),
  geopoliticalData()
 ]);

 const marketResult=
  m.status==="fulfilled"?
  m.value:
  {
   market:{ZEC:null,BTC:null,ETH:null},
   context:{regime:"UNKNOWN",score:0,relativeStrength:"UNKNOWN"}
  };

 const macro=
  macroR.status==="fulfilled"?
  macroR.value:
  {ok:false,status:"DATA_UNAVAILABLE",risk:"UNKNOWN",regime:"UNKNOWN"};

 const events=
  eventR.status==="fulfilled"?
  eventR.value:
  {ok:false,status:"DATA_UNAVAILABLE",risk:"UNKNOWN",score:null};

 const geo=
  geoR.status==="fulfilled"?
  geoR.value:
  geoUnknown("Geopolitical engine failed safely.");

 const q=quality(
  marketResult.market,
  macro,
  events,
  geo
 );

 const globalRisk=fusion(
  marketResult.context,
  macro,
  events,
  geo,
  q
 );

 return {
  ok:Boolean(marketResult.market.ZEC),
  service:"ZEC AI Intelligence",
  version:VERSION,
  timestamp:new Date().toISOString(),
  market:marketResult.market,
  marketContext:marketResult.context,
  macro,
  events,
  geopolitical:geo,
  dataQuality:q,
  globalRisk,
  disclaimer:"Market research and simulation only. Not investment advice."
 };
}

/* ================= STATUS ================= */

function status(env){
 return {
  ok:true,
  service:"ZEC AI Intelligence",
  version:VERSION,
  status:"ONLINE",
  architecture:"Cloudflare Worker Multi-Source Intelligence Gateway",
  reliabilityPatch:"FAST-FAIL V4.5.2 COMPACT",
  modules:{
   coinLoreMarket:"ACTIVE",
   binanceFallback:"ACTIVE",
   btcContext:"ACTIVE",
   ethContext:"ACTIVE",
   fredMacro:env.FRED_API_KEY?"ACTIVE":"NOT CONFIGURED",
   economicEventRadar:env.FRED_API_KEY?"ACTIVE":"NOT CONFIGURED",
   geopoliticalEngine:"ACTIVE · SINGLE REQUEST · FAST-FAIL",
   dataQualityEngine:"ACTIVE",
   globalRiskFusion:"ACTIVE"
  },
  geopoliticalPolicy:{
   maxRequests:1,
   timeoutSeconds:6,
   retry:false,
   failureResult:"UNKNOWN",
   unavailableIsLow:false
  },
  fredSecretConfigured:Boolean(env.FRED_API_KEY),
  timestamp:new Date().toISOString(),
  disclaimer:"Market research and simulation only. Not investment advice."
 };
}

/* ================= ROUTER ================= */

export default{
 async fetch(request,env){
  if(request.method==="OPTIONS"){
   return new Response(null,{status:204,headers:HEADERS});
  }

  const url=new URL(request.url);

  try{
   if(url.pathname==="/"||url.pathname==="/status"){
    return reply(status(env));
   }

   if(url.pathname==="/market"){
    const m=await marketData();
    return reply({
     ok:true,
     version:VERSION,
     timestamp:new Date().toISOString(),
     ...m
    });
   }

   if(url.pathname==="/macro"){
    return reply(await macroData(env));
   }

   if(url.pathname==="/events"){
    return reply(await eventData(env));
   }

   if(url.pathname==="/geopolitical"){
    return reply(await geopoliticalData());
   }

   if(url.pathname==="/intelligence"){
    return reply(await intelligence(env));
   }

   return reply({
    ok:false,
    version:VERSION,
    error:"Route not found",
    availableRoutes:[
     "/",
     "/status",
     "/market",
     "/macro",
     "/events",
     "/geopolitical",
     "/intelligence"
    ]
   },404);

  }catch(e){
   return reply({
    ok:false,
    version:VERSION,
    timestamp:new Date().toISOString(),
    error:e?.message||String(e)
   },500);
  }
 }
};
