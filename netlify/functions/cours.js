// Relais de cours Boussole (fonction Netlify, cote serveur, sans cle).
// Va chercher prix + historique via Yahoo Finance et les renvoie a l'appli.
// Appel : /.netlify/functions/cours?symbol=MC.PA&range=1y
//         /.netlify/functions/cours?symbols=MC.PA,NVDA,BTC-EUR   (prix seuls, plusieurs d'un coup)
const INTERVAL = { "1d":"5m","5d":"30m","1mo":"1d","6mo":"1d","ytd":"1d","1y":"1d","5y":"1wk","max":"1mo" };
const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"*", "Content-Type":"application/json" };

async function chart(symbol, range){
  const interval = INTERVAL[range] || "1d";
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(u, { headers: { "User-Agent":"Mozilla/5.0", "Accept":"application/json" } });
  if(!r.ok) throw new Error("yahoo "+r.status);
  const d = await r.json();
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if(!res) throw new Error("introuvable");
  const m = res.meta || {};
  const ts = res.timestamp || [];
  const cl = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const points = ts.map((t,i)=>({t,c:cl[i]})).filter(p=>p.c!=null);
  return { symbol:m.symbol, currency:m.currency,
    price: (m.regularMarketPrice!=null ? m.regularMarketPrice : (points.length?points[points.length-1].c:null)),
    prevClose: (m.chartPreviousClose!=null ? m.chartPreviousClose : (m.previousClose!=null?m.previousClose:null)),
    range, points };
}

exports.handler = async (event) => {
  const qp = (event && event.queryStringParameters) || {};
  const done = (o, s=200) => ({ statusCode:s, headers:CORS, body:JSON.stringify(o) });
  try{
    if(qp.symbols){
      const list = qp.symbols.split(",").map(s=>s.trim()).filter(Boolean).slice(0,30);
      const out = {};
      for(const s of list){ try{ const q=await chart(s,"1d"); out[s]={price:q.price,currency:q.currency,prevClose:q.prevClose}; }catch(_){ out[s]=null; } }
      return done({ quotes: out });
    }
    if(!qp.symbol) return done({ error:"parametre symbol requis" }, 400);
    return done(await chart(qp.symbol, qp.range || "1d"));
  }catch(e){ return done({ error:String(e) }, 502); }
};
