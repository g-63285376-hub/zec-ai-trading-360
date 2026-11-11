/* ZEC AI Intelligence Worker V4.6.1 - Fast Intelligence Mission - Research & simulation only. */
const VERSION="4.6.1";
const HEADERS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json;charset=UTF-8","Cache-Control":"no-store"};
const IDS={ZEC:"134",BTC:"90",ETH:"80"};
const FRED={DGS10:"US 10Y Treasury",DFF:"Fed Funds Rate",DTWEXBGS:"US Dollar Index Broad",VIXCLS:"VIX",CPIAUCSL:"US CPI",UNRATE:"US Unemployment"};
const RELEASES=[
{id:10,name:"Consumer Price Index",nameCN:"消费者价格指数 CPI",impact:"HIGH"},
{id:50,name:"Employment Situation",nameCN:"美国就业报告",impact:"HIGH"},
{id:53,name:"Gross Domestic Product",nameCN:"美国国内生产总值 GDP",impact:"HIGH"},
{id:101,name:"Federal Reserve Release",nameCN:"美联储相关数据发布",impact:"HIGH"}
];
const GEO_QUERY='(war OR military OR missile OR sanctions OR embargo OR tariff OR "trade war" OR "Red Sea" OR "Strait of Hormuz" OR "Suez Canal" OR OPEC OR pipeline)';
const GEO_WORDS={WAR:["war","military","missile","invasion","airstrike","attack"],SANCTIONS:["sanction","embargo"],ENERGY:["oil","opec","pipeline","energy"],TRADE:["tariff","trade war","export control"],SHIPPING:["red sea","strait of hormuz","suez canal","shipping"]};
const GEO_WEIGHT={WAR:3,SANCTIONS:2,ENERGY:2,TRADE:2,SHIPPING:3};

function reply(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:HEADERS});}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function timeoutValue(ms,value){return new Promise(resolve=>setTimeout(()=>resolve(value),ms));}

async function getJSON(url,timeout=7000){
 const c=new AbortController();
 const t=setTimeout(()=>c.abort(),timeout);
 try{
  const r=await fetch(url,{signal:c.signal,headers:{Accept:"application/json","User-Agent":`ZEC-AI-Intelligence/${VERSION}`}});
  if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e;}
  return await r.json();
 }catch(e){
  if(e.name==="AbortError"){const x=new Error("TIMEOUT");x.code="TIMEOUT";throw x;}
  throw e;
 }finally{clearTimeout(t);}
}

async function coinLore(symbol){
 const d=await getJSON(`https://api.coinlore.net/api/ticker/?id=${IDS[symbol]}`,5000);
 if(!Array.isArray(d)||!d[0])throw new Error("CoinLore invalid response");
 const x=d[0];
 return{symbol,price:num(x.price_usd),change1h:num(x.percent_change_1h),change24h:num(x.percent_change_24h),change7d:num(x.percent_change_7d),volume24h:num(x.volume24),marketCap:num(x.market_cap_usd),source:"CoinLore"};
}

const BINANCE=["https://data-api.binance.vision","https://api.binance.com","https://api1.binance.com"];

async function binance(symbol){
 let last="";
 for(const h of BINANCE){
  try{
   const x=await getJSON(`${h}/api/v3/ticker/24hr?symbol=${symbol}USDT`,3000);
   return{symbol,price:num(x.lastPrice),change1h:null,change24h:num(x.priceChangePercent),change7d:null,volume24h:num(x.quoteVolume),marketCap:null,source:"Binance"};
  }catch(e){last=e.message;}
 }
 throw new Error(last||"Binance unavailable");
}

async function asset(s){
 try{return await coinLore(s);}
 catch(e){const x=await binance(s);x.fallbackReason=e.message;return x;}
}

function marketContext(z,b,e){
 let score=0;
 if(b?.change24h>0)score++;
 if(b?.change24h>=2)score++;
 if(b?.change24h<0)score--;
 if(b?.change24h<=-2)score--;
 if(e?.change24h>0)score++;
 if(e?.change24h>=2)score++;
 if(e?.change24h<0)score--;
 if(e?.change24h<=-2)score--;
 let regime=score>=3?"RISK_ON":score<=-3?"RISK_OFF":"NEUTRAL";
 let relativeStrength="NEUTRAL";
 if(z?.change24h!=null&&b?.change24h!=null&&e?.change24h!=null){
  const rel=z.change24h-(b.change24h+e.change24h)/2;
  if(rel>=2)relativeStrength="STRONG";
  if(rel<=-2)relativeStrength="WEAK";
 }
 return{regime,score,relativeStrength};
}

async function marketData(){
 const r=await Promise.allSettled([asset("ZEC"),asset("BTC"),asset("ETH")]);
 const market={
  ZEC:r[0].status==="fulfilled"?r[0].value:null,
  BTC:r[1].status==="fulfilled"?r[1].value:null,
  ETH:r[2].status==="fulfilled"?r[2].value:null
 };
 return{market,context:marketContext(market.ZEC,market.BTC,market.ETH)};
}

async function fredSeries(id,key,timeout=7000){
 const p=new URLSearchParams({series_id:id,api_key:key,file_type:"json",sort_order:"desc",limit:"5"});
 const d=await getJSON(`https://api.stlouisfed.org/fred/series/observations?${p}`,timeout);
 const v=(d.observations||[]).filter(x=>x.value!=="."&&Number.isFinite(Number(x.value)));
 if(!v.length)throw new Error("No observations");
 return{
  seriesId:id,name:FRED[id],value:Number(v[0].value),date:v[0].date,
  previousValue:v[1]?Number(v[1].value):null,
  change:v[1]?Number(v[0].value)-Number(v[1].value):null,
  source:"FRED"
 };
}

function macroAnalysis(i){
 let score=0;const reasons=[];
 if(i.DTWEXBGS?.change>0){score++;reasons.push("美元指数走强，对加密资产形成压力");}
 if(i.DTWEXBGS?.change<0){score--;reasons.push("美元指数回落，对风险资产相对有利");}
 if(i.VIXCLS?.value>=30){score+=3;reasons.push("VIX高于30，市场压力显著升高");}
 else if(i.VIXCLS?.value>=20){score+=2;reasons.push("VIX高于20，市场风险偏好谨慎");}
 if(i.DGS10?.change>=0.08){score+=2;reasons.push("美国10年期国债收益率上升");}
 if(i.CPIAUCSL?.change>0){score++;reasons.push("最新CPI指数较前值上升");}
 return{
  regime:score>=3?"RISK_OFF":score<=-2?"RISK_ON":"NEUTRAL",
  risk:score>=3?"HIGH":score<=-2?"LOW":"MEDIUM",
  riskScore:score,reasons
 };
}

async function macroData(env,fast=false){
 if(!env.FRED_API_KEY)return{ok:false,status:"NOT_CONFIGURED",risk:"UNKNOWN",regime:"UNKNOWN",messageCN:"FRED API密钥尚未配置"};
 const indicators={},errors=[];
 for(const id of Object.keys(FRED)){
  try{indicators[id]=await fredSeries(id,env.FRED_API_KEY,fast?3500:10000);}
  catch(e){errors.push(`${id}: ${e.message}`);}
  if(!fast)await sleep(60);
 }
 const count=Object.keys(indicators).length;
 if(!count)return{ok:false,status:"DATA_UNAVAILABLE",risk:"UNKNOWN",regime:"UNKNOWN",indicators,successfulSeries:0,totalSeries:6,errors,messageCN:"FRED宏观数据暂时不可用"};
 return{
  ok:true,status:count===6?"OK":"DEGRADED",source:"FRED",
  requestMode:fast?"FAST_SEQUENTIAL":"SEQUENTIAL",
  successfulSeries:count,totalSeries:6,
  ...macroAnalysis(indicators),indicators,errors,
  messageCN:count===6?"宏观经济数据正常":"部分宏观数据暂时不可用"
 };
}

function today(){return new Date().toISOString().slice(0,10);}
function daysAway(d){return Math.round((Date.parse(`${d}T00:00:00Z`)-Date.parse(`${today()}T00:00:00Z`))/86400000);}

async function releaseDates(r,key,timeout=7000){
 const end=new Date(Date.now()+45*86400000).toISOString().slice(0,10);
 const p=new URLSearchParams({
  release_id:String(r.id),api_key:key,file_type:"json",
  realtime_start:today(),realtime_end:end,
  include_release_dates_with_no_data:"true",limit:"10"
 });
 const d=await getJSON(`https://api.stlouisfed.org/fred/release/dates?${p}`,timeout);
 return(d.release_dates||[]).map(x=>x.date).filter(x=>x>=today()).map(date=>({
  releaseId:r.id,name:r.name,nameCN:r.nameCN,impact:r.impact,date,
  daysAway:daysAway(date),source:"FRED"
 }));
}

async function eventData(env,fast=false){
 if(!env.FRED_API_KEY)return{ok:false,status:"NOT_CONFIGURED",risk:"UNKNOWN",score:null,events:[],messageCN:"经济事件雷达未配置"};
 let events=[];const errors=[];
 for(const r of RELEASES){
  try{events.push(...await releaseDates(r,env.FRED_API_KEY,fast?3000:10000));}
  catch(e){errors.push(`${r.name}: ${e.message}`);}
  if(!fast)await sleep(60);
 }
 if(!events.length&&errors.length===RELEASES.length)
  return{ok:false,status:"DATA_UNAVAILABLE",risk:"UNKNOWN",score:null,events:[],errors,messageCN:"经济事件数据暂时不可用"};

 events.sort((a,b)=>a.date.localeCompare(b.date));
 const seen=new Set(),unique=[];
 for(const e of events){
  const k=`${e.releaseId}-${e.date}`;
  if(!seen.has(k)){seen.add(k);unique.push(e);}
 }
 const nextEvent=unique[0]||null;
 let risk="LOW",score=0;
 if(nextEvent){
  score=1;
  if(nextEvent.daysAway<=1){risk="HIGH";score=4;}
  else if(nextEvent.daysAway<=7){risk="MEDIUM";score=2;}
 }
 return{
  ok:true,status:errors.length?"DEGRADED":"OK",source:"FRED",
  requestMode:fast?"FAST_SEQUENTIAL":"SEQUENTIAL",
  horizonDays:45,risk,score,nextEvent,events:unique.slice(0,15),errors,
  messageCN:risk==="HIGH"?"近期存在高影响经济数据发布时间":risk==="MEDIUM"?"近期经济事件风险需要关注":"近期经济事件风险较低",
  noteCN:"日期仅用于事件监控，不代表市场一定产生特定方向反应。"
 };
}

function geoUnknown(reason,error=null,status="DATA_DEGRADED"){
 return{
  ok:false,status,dataAvailable:false,source:"GDELT",risk:"UNKNOWN",
  score:null,confidence:0,reason,reasons:[reason],groups:[],headlines:[],
  errors:error?[String(error)]:[],
  messageCN:"地缘政治数据源暂时不可用，因此风险保持未知，不会被错误判断为低风险。",
  methodology:"Unavailable geopolitical data is UNKNOWN, never LOW."
 };
}

function analyseGeo(a){
 const groups={};
 for(const k of Object.keys(GEO_WORDS))groups[k]={id:k,count:0,weight:GEO_WEIGHT[k]};
 for(const x of a){
  const t=String(x.title||"").toLowerCase();
  for(const[k,w]of Object.entries(GEO_WORDS))
   if(w.some(z=>t.includes(z)))groups[k].count++;
 }
 let score=0;const reasons=[];
 for(const g of Object.values(groups)){
  if(g.count>=10)score+=g.weight;
  else if(g.count>=5)score+=Math.max(1,g.weight-1);
  else if(g.count>=2)score++;
  if(g.count>=2)reasons.push(`${g.id}: ${g.count} monitored headlines`);
 }
 score=clamp(score,0,10);
 return{risk:score>=7?"HIGH":score>=3?"MEDIUM":"LOW",score,reasons,groups:Object.values(groups)};
}

async function geopoliticalData(timeout=5500){
 const p=new URLSearchParams({
  query:GEO_QUERY,mode:"ArtList",maxrecords:"25",
  format:"json",sort:"DateDesc",timespan:"24h"
 });
 try{
  const d=await getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?${p}`,timeout);
  if(!Array.isArray(d?.articles))return geoUnknown("GDELT returned no usable dataset.");

  const a=d.articles.slice(0,25).map(x=>({
   title:x.title||null,url:x.url||null,domain:x.domain||null,
   sourceCountry:x.sourcecountry||null,seenDate:x.seendate||null
  })).filter(x=>x.title);

  if(!a.length)return{
   ok:true,status:"LIMITED_DATA",dataAvailable:true,source:"GDELT",
   risk:"UNKNOWN",score:null,confidence:25,
   reasons:["No usable monitored headlines returned."],
   groups:[],headlines:[],errors:[],
   messageCN:"新闻样本不足，地缘政治风险保持未知。"
  };

  const z=analyseGeo(a);
  return{
   ok:true,status:"OK",dataAvailable:true,source:"GDELT",...z,
   confidence:a.length>=20?85:a.length>=10?70:55,
   articleCount:a.length,requestCount:1,
   headlines:a.slice(0,10),errors:[],
   messageCN:z.risk==="HIGH"?"全球地缘政治新闻风险较高":z.risk==="MEDIUM"?"全球地缘政治风险需要关注":"当前新闻监控未显示明显高风险",
   methodology:"Single GDELT request. News context does not independently create BUY or SELL signals."
  };
 }catch(e){
  if(e.status===429)return geoUnknown("GDELT rate limited the request. Geopolitical risk is UNKNOWN.","HTTP 429");
  if(e.code==="TIMEOUT"||e.message==="TIMEOUT")
   return geoUnknown(`GDELT did not respond within ${(timeout/1000).toFixed(1)} seconds. Geopolitical risk is UNKNOWN.`,"TIMEOUT");
  return geoUnknown("GDELT source unavailable. Geopolitical risk is UNKNOWN.",e.message);
 }
}

function quality(m,macro,events,geo){
 let confidence=0;
 const marketOK=Boolean(m.ZEC&&m.BTC&&m.ETH);
 if(marketOK)confidence+=40;
 if(macro?.ok)confidence+=25;
 if(events?.ok)confidence+=20;
 if(geo?.ok&&geo.risk!=="UNKNOWN")
  confidence+=Math.round(15*(geo.confidence||0)/100);

 confidence=clamp(confidence,0,100);
 const status=confidence<60?"DATA_INCOMPLETE":confidence<90?"DEGRADED":"OK";

 return{
  status,confidence,
  market:marketOK?"OK":"UNAVAILABLE",
  macro:macro?.status||"UNAVAILABLE",
  events:events?.status||"UNAVAILABLE",
  geopolitical:geo?.status||"UNAVAILABLE",
  geopoliticalRisk:geo?.risk||"UNKNOWN",
  messageCN:status==="OK"?"数据质量良好":status==="DEGRADED"?"部分情报源不可用，决策置信度已自动降低":"数据不足，只能进行谨慎观察",
  rule:"Unavailable intelligence is never treated as LOW risk."
 };
}

function fusion(c,m,e,g,q){
 let score=0;const reasons=[];
 if(c.regime==="RISK_OFF"){score+=2;reasons.push("加密市场环境偏向风险规避");}
 if(c.regime==="RISK_ON")score--;
 if(m?.regime==="RISK_OFF"){score+=3;reasons.push("宏观经济环境处于风险规避状态");}
 if(m?.regime==="RISK_ON")score--;

 if(e?.risk==="HIGH"){score+=3;reasons.push("高影响经济事件临近");}
 else if(e?.risk==="MEDIUM"){score++;reasons.push("近期存在需要关注的经济事件");}

 if(g?.risk==="HIGH"){score+=2;reasons.push("地缘政治监控风险较高");}
 else if(g?.risk==="MEDIUM"){score++;reasons.push("地缘政治风险需要关注");}
 else if(g?.risk==="UNKNOWN")reasons.push("地缘政治风险未知，不采用低风险假设");

 score=clamp(score,0,10);
 const risk=score>=7?"HIGH":score>=4?"MEDIUM":"LOW";
 const posture=score>=7?"DEFENSIVE":score>=4?"CAUTIOUS":"NORMAL";
 const reliability=q.confidence<60?"LOW":q.confidence<90?"MEDIUM":"HIGH";
 const signalPermission=q.confidence<60?"CAUTION_ONLY":g?.risk==="UNKNOWN"?"REDUCED_CONFIDENCE":"NORMAL";

 return{
  risk,riskScore:score,posture,
  postureCN:posture==="DEFENSIVE"?"防御":posture==="CAUTIOUS"?"谨慎":"正常观察",
  decisionReliability:reliability,signalPermission,
  dataConfidence:q.confidence,reasons,
  messageCN:risk==="HIGH"?"综合风险较高，应优先控制风险并等待更清晰确认":risk==="MEDIUM"?"综合风险中等，建议保持谨慎并等待确认":"综合风险暂时较低，但仍需结合市场确认"
 };
}

function decisionContext(m,c,macro,events,geo,gr){
 const z=m.ZEC;
 if(!z)return{
  action:"DATA UNAVAILABLE",actionCN:"市场数据不足",trend:"UNKNOWN",
  setupScore:0,entryQuality:0,chaseRisk:"UNKNOWN",
  reasons:["ZEC市场数据不可用"]
 };

 let bear=0,bull=0;const reasons=[];
 if(z.change24h!=null){
  if(z.change24h<=-4){bear+=3;reasons.push("ZEC 24小时下跌动能较强");}
  else if(z.change24h<0){bear++;reasons.push("ZEC 24小时动能偏弱");}
  else if(z.change24h>=4){bull+=3;reasons.push("ZEC 24小时上涨动能较强");}
  else if(z.change24h>0)bull++;
 }

 if(c.relativeStrength==="WEAK"){bear+=2;reasons.push("ZEC表现弱于BTC和ETH");}
 if(c.relativeStrength==="STRONG"){bull+=2;reasons.push("ZEC表现强于BTC和ETH");}
 if(macro?.regime==="RISK_OFF"){bear+=2;reasons.push("宏观环境偏向风险规避");}
 if(macro?.regime==="RISK_ON")bull++;

 const trend=bear>=bull+2?"BEARISH":bull>=bear+2?"BULLISH":"NEUTRAL";
 let setup=clamp(35+Math.abs(bear-bull)*9,0,100);
 if(trend==="NEUTRAL")setup=Math.min(setup,45);

 const a=Math.abs(z.change24h||0);
 const chase=a>=7?"HIGH":a>=4?"MEDIUM":"LOW";

 let entry=70;
 if(chase==="MEDIUM")entry-=20;
 if(chase==="HIGH")entry-=40;
 if(gr.risk==="HIGH")entry-=20;
 if(gr.risk==="MEDIUM")entry-=10;
 if(geo?.risk==="UNKNOWN")entry-=5;
 if(events?.risk==="HIGH")entry-=10;
 entry=clamp(entry,0,100);

 let action="WAIT FOR CONFIRMATION",actionCN="等待确认";

 if(trend==="BULLISH"&&setup>=70&&entry>=70&&gr.risk!=="HIGH"&&gr.signalPermission==="NORMAL"){
  action="BULLISH SETUP";actionCN="看涨条件正在形成";
 }

 if(trend==="BEARISH"&&setup>=70&&entry>=70&&gr.risk!=="HIGH"&&gr.signalPermission==="NORMAL"){
  action="BEARISH SETUP";actionCN="看跌条件正在形成";
 }

 if(chase==="HIGH"){
  action="WAIT FOR CONFIRMATION";
  actionCN="避免追涨杀跌，等待确认";
 }

 return{
  action,actionCN,trend,
  setupScore:Math.round(setup),
  entryQuality:Math.round(entry),
  chaseRisk:chase,reasons
 };
}

const marketFallback={
 market:{ZEC:null,BTC:null,ETH:null},
 context:{regime:"UNKNOWN",score:0,relativeStrength:"UNKNOWN"}
};

const macroFallback={
 ok:false,status:"TIME_BUDGET_EXCEEDED",
 risk:"UNKNOWN",regime:"UNKNOWN",
 messageCN:"综合分析时间预算内未完成宏观数据读取，风险保持未知。"
};

const eventsFallback={
 ok:false,status:"TIME_BUDGET_EXCEEDED",
 risk:"UNKNOWN",score:null,events:[],
 messageCN:"综合分析时间预算内未完成事件数据读取，风险保持未知。"
};

async function intelligence(env){
 const started=Date.now();

 const tasks=[
  Promise.race([
   marketData(),
   timeoutValue(7000,marketFallback)
  ]),
  Promise.race([
   macroData(env,true),
   timeoutValue(9000,macroFallback)
  ]),
  Promise.race([
   eventData(env,true),
   timeoutValue(9000,eventsFallback)
  ]),
  Promise.race([
   geopoliticalData(1800),
   timeoutValue(2200,geoUnknown(
    "Geopolitical source exceeded the V4.6.1 intelligence time budget. Risk remains UNKNOWN.",
    "TIME_BUDGET_EXCEEDED",
    "TIME_BUDGET_EXCEEDED"
   ))
  ])
 ];

 const [mr,macro,events,geo]=await Promise.all(tasks);

 const q=quality(mr.market,macro,events,geo);
 const gr=fusion(mr.context,macro,events,geo,q);
 const decision=decisionContext(mr.market,mr.context,macro,events,geo,gr);

 return{
  ok:Boolean(mr.market.ZEC),
  service:"ZEC AI Intelligence",
  version:VERSION,
  mission:"V4.6.1 Fast Intelligence Mission",
  language:"zh-CN",
  timestamp:new Date().toISOString(),
  elapsedMs:Date.now()-started,
  intelligenceTimeBudgetSeconds:10,
  market:mr.market,
  marketContext:mr.context,
  decision,macro,events,
  geopolitical:geo,
  dataQuality:q,
  globalRisk:gr,
  disclaimerCN:"仅用于市场研究及模拟分析，不构成投资建议。",
  disclaimer:"Market research and simulation only. Not investment advice."
 };
}

function status(env){
 return{
  ok:true,
  service:"ZEC AI Intelligence",
  version:VERSION,
  mission:"V4.6.1 Fast Intelligence Mission",
  status:"ONLINE",
  language:"zh-CN",
  architecture:"Cloudflare Worker Multi-Source Intelligence Gateway",

  modules:{
   coinLoreMarket:"ACTIVE",
   binanceFallback:"ACTIVE",
   btcContext:"ACTIVE",
   ethContext:"ACTIVE",
   fredMacro:env.FRED_API_KEY?"ACTIVE":"NOT CONFIGURED",
   economicEventRadar:env.FRED_API_KEY?"ACTIVE":"NOT CONFIGURED",
   geopoliticalEngine:"ACTIVE · 1 REQUEST · 1.8s INTELLIGENCE FAST-FAIL",
   dataQualityEngine:"ACTIVE",
   globalRiskFusion:"ACTIVE",
   chineseIntelligence:"ACTIVE",
   decisionContext:"ACTIVE",
   intelligenceDeadline:"ACTIVE"
  },

  policies:{
   fredStandalone:"SEQUENTIAL",
   intelligenceMacro:"FAST_SEQUENTIAL · 9s BUDGET",
   intelligenceEvents:"FAST_SEQUENTIAL · 9s BUDGET",
   geopoliticalMaxRequests:1,
   geopoliticalStandaloneTimeoutSeconds:5.5,
   geopoliticalIntelligenceTimeoutSeconds:1.8,
   unavailableRisk:"UNKNOWN",
   unavailableIsLow:false,
   forcedBuySell:false
  },

  fredSecretConfigured:Boolean(env.FRED_API_KEY),
  messageCN:"ZEC AI Intelligence V4.6.1运行正常",
  timestamp:new Date().toISOString(),
  disclaimerCN:"仅用于市场研究及模拟分析，不构成投资建议。"
 };
}

export default{
 async fetch(request,env){

  if(request.method==="OPTIONS")
   return new Response(null,{status:204,headers:HEADERS});

  const u=new URL(request.url);

  try{

   if(u.pathname==="/"||u.pathname==="/status")
    return reply(status(env));

   if(u.pathname==="/market"){
    const r=await marketData();
    return reply({
     ok:true,version:VERSION,
     timestamp:new Date().toISOString(),
     ...r
    });
   }

   if(u.pathname==="/macro")
    return reply(await macroData(env));

   if(u.pathname==="/events")
    return reply(await eventData(env));

   if(u.pathname==="/geopolitical")
    return reply(await geopoliticalData(5500));

   if(u.pathname==="/intelligence")
    return reply(await intelligence(env));

   if(u.pathname==="/fred-test"){
    if(!env.FRED_API_KEY)
     return reply({
      ok:false,version:VERSION,
      test:"FRED_SINGLE_SERIES",
      error:"FRED_API_KEY_NOT_CONFIGURED"
     },500);

    const s=Date.now();

    try{
     return reply({
      ok:true,version:VERSION,
      test:"FRED_SINGLE_SERIES",
      elapsedMs:Date.now()-s,
      result:await fredSeries("DGS10",env.FRED_API_KEY)
     });
    }catch(e){
     return reply({
      ok:false,version:VERSION,
      test:"FRED_SINGLE_SERIES",
      elapsedMs:Date.now()-s,
      error:e.message
     },502);
    }
   }

   return reply({
    ok:false,
    version:VERSION,
    error:"Route not found",
    messageCN:"找不到此接口",
    availableRoutes:[
     "/","/status","/market","/macro",
     "/events","/geopolitical",
     "/intelligence","/fred-test"
    ]
   },404);

  }catch(e){

   return reply({
    ok:false,
    version:VERSION,
    timestamp:new Date().toISOString(),
    error:e?.message||String(e),
    messageCN:"系统发生异常，但安全机制已经阻止错误数据被当作正常信号。"
   },500);
  }
 }
};
