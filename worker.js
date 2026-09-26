// Worker Boussole (Cloudflare) : sert la page (fichiers statiques via le binding ASSETS)
// ET le relais de cours sur /api/cours (prix + historique + marche + recherche), cote serveur, sans cle.
const INTERVAL = { "1d":"5m","5d":"30m","1mo":"1d","6mo":"1d","ytd":"1d","1y":"1d","5y":"1wk","max":"1mo" };
const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"*", "Content-Type":"application/json" };
let MKT = { t:0, d:null };

async function chart(symbol, range){
  const interval = INTERVAL[range] || "1d";
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(u, { headers:{ "User-Agent":"Mozilla/5.0", "Accept":"application/json" } });
  if(!r.ok) throw new Error("yahoo "+r.status);
  const d = await r.json();
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if(!res) throw new Error("introuvable");
  const m = res.meta || {};
  const ts = res.timestamp || [];
  const cl = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const points = ts.map((t,i)=>({t,c:cl[i]})).filter(p=>p.c!=null);
  return { symbol:m.symbol, currency:m.currency,
    price:(m.regularMarketPrice!=null?m.regularMarketPrice:(points.length?points[points.length-1].c:null)),
    prevClose:(m.chartPreviousClose!=null?m.chartPreviousClose:(m.previousClose!=null?m.previousClose:null)),
    range, points };
}

const UA_FULL = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
let CRUMB = { t:0, cookie:"", crumb:"" };
async function yahooAuth(){
  if(CRUMB.crumb && Date.now()-CRUMB.t < 20*60*1000) return CRUMB;
  const c = await fetch("https://fc.yahoo.com/", { headers:{ "User-Agent":UA_FULL, "Accept":"text/html" } });
  let cookies = c.headers.getSetCookie ? c.headers.getSetCookie() : [c.headers.get("set-cookie")||""];
  const cookie = cookies.map(s=>String(s).split(";")[0]).filter(Boolean).join("; ");
  const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers:{ "User-Agent":UA_FULL, "Accept":"text/plain", "Cookie":cookie } });
  const crumb = (await cr.text()).trim();
  CRUMB = { t:Date.now(), cookie, crumb };
  return CRUMB;
}
async function stats(symbol){
  const a = await yahooAuth();
  const mods = "financialData,recommendationTrend,summaryDetail,defaultKeyStatistics,price";
  const u = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}&crumb=${encodeURIComponent(a.crumb)}`;
  const r = await fetch(u, { headers:{ "User-Agent":UA_FULL, "Accept":"application/json", "Cookie":a.cookie } });
  if(!r.ok) return { error:"quoteSummary "+r.status, crumbLen:(a.crumb||"").length };
  const d = await r.json();
  const res = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
  if(!res) return { error:"vide" };
  const num=x=> (x&&typeof x==="object"&&"raw" in x)? x.raw : (typeof x==="number"?x:null);
  const fd=res.financialData||{}, sd=res.summaryDetail||{}, ks=res.defaultKeyStatistics||{}, pr=res.price||{};
  const tr=(res.recommendationTrend&&res.recommendationTrend.trend&&res.recommendationTrend.trend[0])||{};
  return {
    symbol, currency: pr.currency||fd.financialCurrency||null,
    reco: fd.recommendationKey||null, recoMean: num(fd.recommendationMean), nAnalysts: num(fd.numberOfAnalystOpinions),
    target: num(fd.targetMeanPrice), targetHigh: num(fd.targetHighPrice), targetLow: num(fd.targetLowPrice), price: num(fd.currentPrice)||num(pr.regularMarketPrice),
    trend: { strongBuy:num(tr.strongBuy)||0, buy:num(tr.buy)||0, hold:num(tr.hold)||0, sell:num(tr.sell)||0, strongSell:num(tr.strongSell)||0 },
    pe: num(sd.trailingPE), marketCap: num(sd.marketCap)||num(pr.marketCap), divYield: num(sd.dividendYield), beta: num(sd.beta)||num(ks.beta),
    wk52High: num(sd.fiftyTwoWeekHigh), wk52Low: num(sd.fiftyTwoWeekLow)
  };
}
async function cours(url){
  const qp = Object.fromEntries(url.searchParams);
  const done = (o,s=200)=> new Response(JSON.stringify(o), { status:s, headers:CORS });
  try{
    if(qp.stats){ return done(await stats(qp.stats)); }
    if(qp.market){
      if(MKT.d && Date.now()-MKT.t < 45000) return done(MKT.d);
      const get=async u=>{ try{ const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"}}); return r.ok?await r.json():null; }catch(_){ return null; } };
      const getCnn=async()=>{ try{ const r=await fetch("https://production.dataviz.cnn.com/index/fearandgreed/graphdata",{headers:{"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36","Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9","Referer":"https://edition.cnn.com/markets/fear-and-greed"}}); return r.ok?await r.json():null; }catch(_){ return null; } };
      const [fng,prices,glob,trending,cnn,vixq]=await Promise.all([
        get("https://api.alternative.me/fng/?limit=1"),
        get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur&include_24hr_change=true"),
        get("https://api.coingecko.com/api/v3/global"),
        get("https://api.coingecko.com/api/v3/search/trending"),
        getCnn(),
        chart("^VIX","1d").catch(()=>null)
      ]);
      let stockFng=null; if(cnn&&cnn.fear_and_greed){ stockFng={score:cnn.fear_and_greed.score, rating:cnn.fear_and_greed.rating}; }
      let vix=(vixq&&vixq.price>0)?{price:vixq.price, prevClose:vixq.prevClose}:null;
      const data={fng,prices,global:glob,trending,stockFng,vix};
      MKT={t:Date.now(),d:data};
      return done(data);
    }
    if(qp.search){
      const q=String(qp.search).trim(); if(!q) return done({results:[]});
      const su=`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
      const rs=await fetch(su,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"}});
      if(!rs.ok) throw new Error("yahoo "+rs.status);
      const ds=await rs.json();
      const ok={EQUITY:1,ETF:1,CRYPTOCURRENCY:1,INDEX:1,MUTUALFUND:1,CURRENCY:1};
      const results=((ds&&ds.quotes)||[]).filter(x=>x&&x.symbol&&ok[x.quoteType]).slice(0,8).map(x=>({
        symbol:x.symbol, name:x.shortname||x.longname||x.symbol,
        exch:x.exchDisp||x.exchange||"", type:x.quoteType }));
      return done({results});
    }
    if(qp.symbols){
      const list=qp.symbols.split(",").map(s=>s.trim()).filter(Boolean).slice(0,30);
      const out={};
      for(const s of list){ try{ const q=await chart(s,"1d"); out[s]={price:q.price,currency:q.currency,prevClose:q.prevClose}; }catch(_){ out[s]=null; } }
      return done({ quotes: out });
    }
    if(!qp.symbol) return done({ error:"parametre symbol requis" }, 400);
    return done(await chart(qp.symbol, qp.range || "1d"));
  }catch(e){ return done({ error:String(e) }, 502); }
}

// ===== Notifications push (rappels d'achat), envoyees chaque matin =====
// Cle publique VAPID (identique a celle de l'appli, publique par nature).
const VAPID_PUBLIC = "BPcPxhJ5Khfano9D33CrjKez4rGnMG-xLQHt6wwJnFN2p4Lx0wj3lXpcdnGhzP67Sh4UbTIRN-UdbVt4pavlmQs";
function _b64url(bytes){ let s=""; const b=new Uint8Array(bytes); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function _b64urlToBytes(str){ let s=String(str).replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; const bin=atob(s); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
function _concat(...a){ let len=a.reduce((s,x)=>s+x.length,0); const o=new Uint8Array(len); let off=0; for(const x of a){ o.set(x,off); off+=x.length; } return o; }
async function _hmac(keyBytes, data){ const k=await crypto.subtle.importKey("raw", keyBytes, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, data)); }
async function _encryptPayload(plaintext, uaPubRaw, authSecret){
  const enc=new TextEncoder();
  const asKeys=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"}, true, ["deriveBits"]);
  const asPubRaw=new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaPubKey=await crypto.subtle.importKey("raw", uaPubRaw, {name:"ECDH",namedCurve:"P-256"}, false, []);
  const ecdh=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH", public: uaPubKey}, asKeys.privateKey, 256));
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const keyInfo=_concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPubRaw, asPubRaw);
  const prkKey=await _hmac(authSecret, ecdh);
  const ikm=(await _hmac(prkKey, _concat(keyInfo, new Uint8Array([1])))).slice(0,32);
  const prk=await _hmac(salt, ikm);
  const cek=(await _hmac(prk, _concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0,1])))).slice(0,16);
  const nonce=(await _hmac(prk, _concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0,1])))).slice(0,12);
  const cekKey=await crypto.subtle.importKey("raw", cek, {name:"AES-GCM"}, false, ["encrypt"]);
  const rec=_concat(enc.encode(plaintext), new Uint8Array([2]));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM", iv:nonce, tagLength:128}, cekKey, rec));
  return _concat(salt, new Uint8Array([0,0,0x10,0]), new Uint8Array([asPubRaw.length]), asPubRaw, ct);
}
async function _vapidHeader(endpoint, vapidPrivJWK, subject){
  const aud=new URL(endpoint).origin;
  const j=o=>_b64url(new TextEncoder().encode(JSON.stringify(o)));
  const now=Math.floor(Date.now()/1000);
  const signingInput=j({typ:"JWT",alg:"ES256"})+"."+j({aud, exp: now+43200, sub: subject});
  const key=await crypto.subtle.importKey("jwk", vapidPrivJWK, {name:"ECDSA",namedCurve:"P-256"}, false, ["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"}, key, new TextEncoder().encode(signingInput)));
  return "vapid t="+signingInput+"."+_b64url(sig)+", k="+VAPID_PUBLIC;
}
async function _sendPush(sub, payloadStr, vapidPrivJWK, subject){
  const body=await _encryptPayload(payloadStr, _b64urlToBytes(sub.keys.p256dh), _b64urlToBytes(sub.keys.auth));
  const auth=await _vapidHeader(sub.endpoint, vapidPrivJWK, subject);
  const res=await fetch(sub.endpoint, { method:"POST", headers:{ "Authorization":auth, "Content-Encoding":"aes128gcm", "Content-Type":"application/octet-stream", "TTL":"86400", "Urgency":"normal" }, body });
  return res.status;
}
async function runDailyReminders(env){
  const SUPA=env.SUPABASE_URL || "https://smmaxgjxsisoxqlpoopi.supabase.co";
  const KEY=env.SUPABASE_SERVICE_KEY;
  const VAPID_PRIV=env.VAPID_PRIVATE ? JSON.parse(env.VAPID_PRIVATE) : null;
  const SUBJECT=env.VAPID_SUBJECT || "mailto:boussole@boussole.app";
  if(!KEY || !VAPID_PRIV) return;
  const now=new Date(), Y=now.getUTCFullYear(), M=now.getUTCMonth(), D=now.getUTCDate();
  const remN=r=> r.everyN==null?1:+r.everyN;
  const remAnchor=r=>{ if(r.date){ const p=String(r.date).split("-").map(Number); return {y:p[0],m:(p[1]||1)-1,d:Math.min(28,Math.max(1,p[2]||1))}; } return {y:1970,m:0,d:Math.min(28,Math.max(1,+r.day||1))}; };
  const occDay=(r,y,m)=>{ const a=remAnchor(r),N=remN(r); if(N===0) return (a.y===y&&a.m===m)?a.d:0; const diff=(y-a.y)*12+(m-a.m); if(diff<0||diff%N!==0) return 0; return a.d; };
  const periodKey=(r,y,m)=> remN(r)===0?"once":(y+"-"+String(m+1).padStart(2,"0"));
  let rows=[];
  try{ const r=await fetch(SUPA+"/rest/v1/portfolios?select=user_id,data", {headers:{apikey:KEY, Authorization:"Bearer "+KEY}}); if(r.ok) rows=await r.json(); else return; }catch(_){ return; }
  for(const row of rows){
    const data=row&&row.data; if(!data) continue;
    const sub=data.pushSub; if(!sub||!sub.endpoint||!sub.keys) continue;
    const rems=Array.isArray(data.reminders)?data.reminders:[];
    const due=rems.filter(r=> occDay(r,Y,M)===D && !(r.lastDone && r.lastDone===periodKey(r,Y,M)));
    if(!due.length) continue;
    const noms=due.map(r=> r.asset+" ("+(Math.round((+r.amount||0)*100)/100)+(r.cur==="USD"?" $":" EUR")+")").join(", ");
    const body=due.length===1 ? ("Aujourd'hui : acheter "+noms) : ("Aujourd'hui : "+due.length+" achats prevus - "+noms);
    const payload=JSON.stringify({title:"Boussole - rappel d'achat", body, url:"/"});
    try{ await _sendPush(sub, payload, VAPID_PRIV, SUBJECT); }catch(_){}
  }
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if(url.pathname === "/api/cours"){
      if(request.method === "OPTIONS") return new Response("ok", { headers: CORS });
      return cours(url);
    }
    // Declencheur manuel de test (protege par un jeton) : /api/push-test?k=<VAPID_SUBJECT ou secret>
    if(url.pathname === "/api/push-now" && url.searchParams.get("k") && env.PUSH_TEST_KEY && url.searchParams.get("k")===env.PUSH_TEST_KEY){
      await runDailyReminders(env);
      return new Response(JSON.stringify({ran:true}), {headers:CORS});
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx){
    ctx.waitUntil(runDailyReminders(env));
  }
};
