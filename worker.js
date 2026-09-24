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

async function cours(url){
  const qp = Object.fromEntries(url.searchParams);
  const done = (o,s=200)=> new Response(JSON.stringify(o), { status:s, headers:CORS });
  try{
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

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if(url.pathname === "/api/cours"){
      if(request.method === "OPTIONS") return new Response("ok", { headers: CORS });
      return cours(url);
    }
    return env.ASSETS.fetch(request);
  }
};
