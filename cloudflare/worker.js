const CLIENT_ORIGIN = 'https://ermestre.github.io';
const MENU_URL = 'https://raw.githubusercontent.com/ermestre/pescheriamassimo/main/menu.json';
const HOURS = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','17:00','17:30','18:00','18:30','19:00'];
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function rome(now=new Date()){
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=k=>parts.find(p=>p.type===k).value;
 return {date:get('year')+'-'+get('month')+'-'+get('day'),time:get('hour')+':'+get('minute')};
}
function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function festaAperta(c,now){
 const current=rome(now);
 return c.id==='natale'&&c.attiva!==false&&c.periodo?.dal&&c.periodo?.al&&current.date>=c.periodo.dal&&current.date<=c.periodo.al;
}
function validDay(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;}
function festaScadenza(c){
 if(!c.scadenza_data&&!c.scadenza_ora)return null;
 if(!validDay(c.scadenza_data)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.scadenza_ora||''))fail('Scadenza della festività da verificare con la pescheria.',503);
 return {date:c.scadenza_data,time:c.scadenza_ora};
}
function pickupDays(menu,now){
 const today=rome(now).date;
 const days=Array.from({length:14},(_,i)=>addDays(today,i)).filter(d=>new Date(d+'T12:00:00Z').getUTCDay()!==1 && !(menu.ritiro?.chiusure||[]).includes(d));
 for(const c of menu.categorie||[])if(festaAperta(c,now)&&validDay(c.ritiro_data)&&c.ritiro_data>=today&&!(menu.ritiro?.chiusure||[]).includes(c.ritiro_data))days.push(c.ritiro_data);
 return [...new Set(days)].sort();
}
async function readMenu(){
 const r=await fetch(MENU_URL,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)fail('Menu momentaneamente non disponibile. Riprova.',503);
 const menu=await r.json();
 if(!Array.isArray(menu.categorie))fail('Menu non valido',503);
 // Finestre personalizzate richiedono una gestione esplicita: mai ignorarle.
 if(menu.ritiro?.finestre_ritiro?.length)fail('Configurazione degli orari da aggiornare. Contatta la pescheria.',503);
 return menu;
}
function deadline(rule,date){
 if(!rule)return null;
 const m=rule.trim().match(/^(\d{2}:\d{2}) del giorno (prima|stesso)$/i);
 if(!m)fail('Termine ordini da verificare con la pescheria.',503);
 return {date:addDays(date,m[2].toLowerCase()==='prima'?-1:0),time:m[1]};
}
function basicOrder(body){
 if(!body || typeof body!=='object' || Array.isArray(body))fail('Ordine non valido');
 if(body.website)fail('Ordine non valido');
 const string=(key,min,max)=>{if(typeof body[key]!=='string')fail('Compila '+key);const v=body[key].trim();if(v.length<min||v.length>max)fail('Controlla '+key);return v;};
 const id=string('id',36,36);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))fail('Codice ordine non valido');
 const name=string('customer_name',1,100),phone=string('customer_phone',6,30).replace(/\s/g,'');
 if(!/^\+?[0-9]{6,15}$/.test(phone))fail('Controlla il numero di cellulare');
 const date=string('pickup_date',10,10),time=string('pickup_time',5,5),notes=string('notes',0,2000);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))fail('Ritiro non valido');
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>40)fail('Carrello non valido');
 const seen=new Set();
 const items=body.items.map(i=>{
  if(!i || typeof i.id!=='string'||i.id.length>100 || seen.has(i.id) || typeof i.quantity!=='number'||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>100)fail('Quantità non valida');
  const preparation=i.preparation??'';if(typeof preparation!=='string'||preparation.length>60)fail('Preparazione non valida');
  seen.add(i.id);return {id:i.id,quantity:i.quantity,preparation};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 if(!Number.isSafeInteger(body.expected_total_cents)||body.expected_total_cents<0||body.expected_total_cents>1000000)fail('Totale non valido');
 return {id,customer_name:name,customer_phone:phone,pickup_date:date,pickup_time:time,notes,items,total_cents:body.expected_total_cents};
}
function sameOrder(row,order){
 return ['customer_name','customer_phone','pickup_date','pickup_time','notes','total_cents'].every(k=>row[k]===order[k]) && JSON.stringify(JSON.parse(row.items_json).map(i=>({id:i.id,quantity:i.quantity,preparation:i.preparation??''})).sort((a,b)=>a.id.localeCompare(b.id)))===JSON.stringify(order.items);
}
function priceOrder(order,menu,now=new Date()){
 const current=rome(now);
 if(menu.ritiro?.attivo===false)fail('Gli ordini online sono sospesi.');
 if(!pickupDays(menu,now).includes(order.pickup_date))fail('Giorno di ritiro non disponibile');
 if(order.pickup_date===current.date && order.pickup_time<=current.time)fail('Questo orario è già passato');
 let total=0,evening=false;
 const items=order.items.map(item=>{
  const category=menu.categorie.find(c=>c.voci.some(v=>v.id===item.id));
  const v=category?.voci.find(v=>v.id===item.id);
  if(!v || !v.disponibile || ['esaurito','terminato'].includes(v.stato))fail('Un prodotto non è più disponibile. Aggiorna il menu.',409);
  if(category.attiva===false)fail('Proposta non pubblicata',409);
  if(category.id==='natale'&&category.ritiro_data&&order.pickup_date!==category.ritiro_data)fail('I piatti della festività si ritirano il '+category.ritiro_data+'. Seleziona questa data.');
  const regularDays=pickupDays({...menu,categorie:[]},now);
  if(!regularDays.includes(order.pickup_date)&&category.id!=='natale')fail('Per questa data speciale puoi ordinare solo i piatti della festività.');
  if(category.periodo && (!category.periodo.dal || !category.periodo.al || current.date<category.periodo.dal || current.date>category.periodo.al))fail('Prodotto fuori periodo',409);
  const allowed=v.preparazioni||[];if(item.preparation && !allowed.includes(item.preparation))fail('Preparazione non disponibile per '+v.nome);
  if(allowed.length && !item.preparation)fail('Scegli la preparazione per '+v.nome);
  const step=v.unita==='kg'?.5:1;
  if(Math.abs(item.quantity/step-Math.round(item.quantity/step))>1e-8)fail('Quantità non valida per '+v.nome);
  if(typeof v.prezzo!=='number'||!Number.isFinite(v.prezzo)||v.prezzo<0)fail('Prezzo da verificare',503);
  const limit=(category.id==='natale'?festaScadenza(category):null)||deadline(v.ordini_entro||category.ordini_entro||menu.ritiro?.ordini_entro,order.pickup_date);
  if(limit && (current.date>limit.date || (current.date===limit.date && current.time>limit.time)))fail('Termine ordini superato per '+v.nome+'. Scegli un altro giorno.');
  evening ||= !!v.su_ordinazione;
  const unit_price_cents=Math.round(v.prezzo*100),line_total_cents=Math.round(unit_price_cents*item.quantity);
  total+=line_total_cents;
  return {...item,...(category.id==='natale'?{occasion:category.ricorrenza||category.nome}:{}),name:v.nome,unit:v.unita||'porzioni',unit_price_cents,line_total_cents};
 });
 const hours=evening?(menu.ritiro?.orari_sera||['18:30','19:00','19:30','20:00']):HOURS;
 if(!hours.includes(order.pickup_time))fail('Orario di ritiro non disponibile');
 if(total!==order.total_cents)fail('I prezzi sono cambiati. Aggiorna il menu e controlla il totale prima di inviare.',409);
 return {...order,items};
}
async function limitedBody(request,max=20000){
 if(!request.body)fail('Richiesta vuota');
 const reader=request.body.getReader();const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('Ordine troppo grande',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Richiesta non valida');}
}
async function rateLimit(request,env){
 const ip=request.headers.get('CF-Connecting-IP');if(!ip)fail('Connessione non verificabile',503);
 const bucket=Math.floor(Date.now()/600000);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.ADMIN_TOKEN+':'+ip+':'+bucket));
 const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 await env.db.prepare('CREATE TABLE IF NOT EXISTS order_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)').run();
 await env.db.prepare('DELETE FROM order_limits WHERE bucket < ?').bind(bucket-1).run();
 for(const [k,b,max] of [[key,bucket,10],['global:'+bucket,bucket,100]]){
  const row=await env.db.prepare('INSERT INTO order_limits (key,bucket,count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(k,b).first();
  if(row.count>max)fail('Troppi tentativi. Attendi qualche minuto o contatta la pescheria.',429);
 }
}
async function publicApi(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const cors=origin===CLIENT_ORIGIN?{'Access-Control-Allow-Origin':CLIENT_ORIGIN,'Vary':'Origin'}:{};
 const respond=(data,status=200)=>{const r=json(data,status);for(const [k,v] of Object.entries(cors))r.headers.set(k,v);return r;};
 if(origin && origin!==CLIENT_ORIGIN && origin!==url.origin)return respond({errore:'Origine non consentita'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
 try{
  if(!env.db || typeof env.ADMIN_TOKEN!=='string' || env.ADMIN_TOKEN.length<20)fail('Ordini online non ancora configurati',503);
  if(url.pathname==='/api/config' && request.method==='GET'){
   const menu=await readMenu();return respond({ok:true,menu,preparations_supported:true,festivities_supported:true,days:pickupDays(menu,new Date())});
  }
  if(url.pathname!=='/api/submit' || request.method!=='POST')return respond({errore:'Operazione non disponibile'},404);
  if(!origin)fail('Invia l’ordine dal sito della pescheria',403);
  if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))fail('Formato non valido',415);
  const order=basicOrder(await limitedBody(request));
  await rateLimit(request,env);
  const existing=await env.db.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
  if(existing){if(!sameOrder(existing,order))fail('Codice già usato per un altro ordine. Crea un nuovo ordine.',409);return respond({ok:true,id:existing.id,total_cents:existing.total_cents,already_received:true});}
  const priced=priceOrder(order,await readMenu());
  const result=await env.db.prepare('INSERT INTO orders (id,customer_name,customer_phone,pickup_date,pickup_time,notes,items_json,total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(priced.id,priced.customer_name,priced.customer_phone,priced.pickup_date,priced.pickup_time,priced.notes,JSON.stringify(priced.items),priced.total_cents).run();
  if(!result.meta.changes){const row=await env.db.prepare('SELECT * FROM orders WHERE id = ?').bind(priced.id).first();if(!row||!sameOrder(row,order))fail('Codice ordine già utilizzato',409);}
  return respond({ok:true,id:priced.id,total_cents:priced.total_cents},201);
 }catch(e){return respond({errore:e.status?e.message:'Servizio momentaneamente non disponibile. Riprova con lo stesso ordine.'},e.status||503);}
}

// Pescheria Massimo: pannello ordini protetto. Binding D1: db.
const HEADERS = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...HEADERS,"Content-Type":"application/json; charset=utf-8"}});}
async function authorized(request,env){
  if(typeof env.ADMIN_TOKEN!=="string" || env.ADMIN_TOKEN.length<20) return false;
  const token=request.headers.get("Authorization") || "";
  if(token.length>512) return false;
  const hash=async s=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  const a=await hash(token),b=await hash("Bearer "+env.ADMIN_TOKEN);
  let diff=0; for(let i=0;i<a.length;i++) diff|=a[i]^b[i];
  return diff===0;
}

function romeDay(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=t=>parts.find(p=>p.type===t).value;return get('year')+'-'+get('month')+'-'+get('day');
}
const PAYMENT_SCHEMA=`CREATE TABLE IF NOT EXISTS payment_events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, method TEXT NOT NULL, created_at TEXT NOT NULL, business_date TEXT NOT NULL)`;
async function paymentApi(request,env,url){
 if(url.pathname==='/api/payments'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>1000)return json({errore:'Richiesta troppo grande'},413);
  let b;try{b=JSON.parse(raw);}catch{return json({errore:'Dati non validi'},400);}
  if(!b||!isUuid(b.id)||typeof b.order_id!=='string'||!['payment','refund'].includes(b.kind))return json({errore:'Movimento non valido'},400);
  const prior=await env.db.prepare('SELECT * FROM payment_events WHERE id=?').bind(b.id).first();
  if(prior)return prior.order_id===b.order_id&&prior.kind===b.kind&&prior.method===b.method&&(b.kind==='refund'||prior.amount_cents===b.amount_cents)?json({ok:true}):json({errore:'Codice movimento già utilizzato'},409);
  const order=await env.db.prepare('SELECT * FROM orders WHERE id=?').bind(b.order_id).first();
  if(!order)return json({errore:'Ordine non trovato'},404);
  let amount=b.amount_cents,method=b.method;
  if(b.kind==='payment'){
   if(order.paid||order.status==='cancelled')return json({errore:'Ordine già pagato o annullato'},409);
   if(!Number.isSafeInteger(amount)||amount<1||amount>10000000||!['cash','card'].includes(method))return json({errore:'Inserisci un importo valido e contanti o carta'},400);
  }else{
   const balance=await env.db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM payment_events WHERE order_id=?').bind(b.order_id).first();
   if(!order.paid||balance.total<=0)return json({errore:'Pagamento precedente senza movimento registrato: rimborso non disponibile'},409);
   if(!['cash','card'].includes(method))return json({errore:'Scegli come viene restituito il denaro'},400);
   amount=-balance.total;
  }
  const now=new Date();const expected=b.kind==='payment'?0:1;
  const result=await env.db.batch([
   env.db.prepare('INSERT OR IGNORE INTO payment_events(id,order_id,kind,amount_cents,method,created_at,business_date) SELECT ?,id,?,?,?,?,? FROM orders WHERE id=? AND paid=?'+(b.kind==='payment'?" AND status != 'cancelled'":' AND (SELECT COALESCE(SUM(amount_cents),0) FROM payment_events WHERE order_id=orders.id)='+(-amount) )).bind(b.id,b.kind,amount,method,now.toISOString(),romeDay(now),b.order_id,expected),
   env.db.prepare('UPDATE orders SET paid=? WHERE id=? AND paid=? AND EXISTS(SELECT 1 FROM payment_events WHERE id=? AND order_id=orders.id AND kind=? AND method=? AND amount_cents=?)').bind(expected?0:1,b.order_id,expected,b.id,b.kind,method,amount)
  ]);
  const saved=await env.db.prepare('SELECT * FROM payment_events WHERE id=?').bind(b.id).first();
  if(!saved||saved.order_id!==b.order_id||saved.kind!==b.kind||saved.method!==method||saved.amount_cents!==amount)return json({errore:'Ordine modificato o codice movimento già usato: aggiorna e riprova'},409);
  return json({ok:true});
 }
 if(url.pathname==='/api/report'&&request.method==='GET'){
  const day=url.searchParams.get('date')||romeDay();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)return json({errore:'Data non valida'},400);
  const movements=await env.db.prepare('SELECT p.*,o.customer_name FROM payment_events p JOIN orders o ON o.id=p.order_id WHERE business_date=? ORDER BY created_at,id LIMIT 5001').bind(day).all();
  const orders=await env.db.prepare('SELECT * FROM orders WHERE pickup_date=? ORDER BY pickup_time,id LIMIT 5001').bind(day).all();
  if(movements.results.length>5000||orders.results.length>5000)return json({errore:'Troppi dati per il resoconto giornaliero'},409);
  const rows=orders.results,events=movements.results,active=rows.filter(o=>o.status!=='cancelled');
  const sum=arr=>arr.reduce((t,p)=>t+p.amount_cents,0);
  return json({date:day,orders:rows.map(o=>({...o,items:JSON.parse(o.items_json),items_json:undefined})),movements:events,summary:{orders:rows.length,collected:rows.filter(o=>o.status==='collected').length,cancelled:rows.filter(o=>o.status==='cancelled').length,expected_cents:active.reduce((t,o)=>t+o.total_cents,0),outstanding_cents:active.filter(o=>!o.paid).reduce((t,o)=>t+o.total_cents,0),receipts_cents:sum(events.filter(p=>p.kind==='payment')),refunds_cents:-sum(events.filter(p=>p.kind==='refund')),net_cents:sum(events),cash_cents:sum(events.filter(p=>p.method==='cash')),card_cents:sum(events.filter(p=>p.method==='card'))}});
 }
 return null;
}
function isUuid(s){return typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(["/api/config","/api/submit"].includes(url.pathname))return publicApi(request,env);
  if(request.method==="GET" && (url.pathname==="/" || url.pathname==="/admin")){
   return new Response(PAGE,{headers:{...HEADERS,"Content-Type":"text/html; charset=utf-8",
   "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}});
  }
  if(!url.pathname.startsWith("/api/")) return json({errore:"Pagina non trovata"},404);
  if(!await authorized(request,env)) return json({errore:"Chiave di accesso non valida"},401);
  if(!env.db) return json({errore:"Database non collegato"},503);
  try{
   await env.db.prepare(PAYMENT_SCHEMA).run();
   await env.db.prepare("CREATE INDEX IF NOT EXISTS payment_events_order ON payment_events(order_id)").run();
   await env.db.prepare("CREATE INDEX IF NOT EXISTS payment_events_day ON payment_events(business_date,created_at)").run();
   const paymentResponse=await paymentApi(request,env,url);if(paymentResponse)return paymentResponse;
   if(url.pathname==="/api/orders" && request.method==="GET"){
    const date=url.searchParams.get("date");
    if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+"T12:00:00Z")) || new Date(date+"T12:00:00Z").toISOString().slice(0,10)!==date)) return json({errore:"Data non valida"},400);
    const view=url.searchParams.get("view")||"all";
    if(!["all","open"].includes(view))return json({errore:"Vista non valida"},400);
    const conditions=[],params=[];
    if(date){conditions.push("pickup_date = ?");params.push(date);}
    if(view==="open")conditions.push("status IN ('new','confirmed','ready')");
    let statement=env.db.prepare("SELECT orders.*, (SELECT COALESCE(SUM(amount_cents),0) FROM payment_events WHERE order_id=orders.id) AS recorded_balance_cents FROM orders"+(conditions.length?" WHERE "+conditions.join(" AND "):"")+" ORDER BY pickup_date, pickup_time, created_at, id LIMIT 501");
    if(params.length)statement=statement.bind(...params);
    const result=await statement.all();
    if(result.results.length>500) return json({errore:"Ci sono più di 500 ordini. Seleziona una data di ritiro per restringere la vista."},409);
    return json({orders:result.results.map(row=>({...row,items:JSON.parse(row.items_json),items_json:undefined}))});
   }
   const match=url.pathname.match(/^\/api\/orders\/([a-zA-Z0-9-]{1,80})$/);
   if(match && request.method==="PATCH"){
    const raw=await request.text();
    if(raw.length>1000) return json({errore:"Richiesta troppo grande"},413);
    let body;try{body=JSON.parse(raw);}catch{return json({errore:"Richiesta non valida"},400);}
    if(!body || typeof body!=="object" || Array.isArray(body)) return json({errore:"Richiesta non valida"},400);
    const keys=Object.keys(body);
    if(keys.length!==1 || !["paid","status"].includes(keys[0]))return json({errore:"Modifica non valida"},400);
    let query,value;
    if(keys[0]==="paid"){
     return json({errore:"Usa Registra incasso o Registra rimborso per conservare i movimenti"},400);
    }else{
     if(!["new","confirmed","ready","collected","cancelled"].includes(body.status))return json({errore:"Stato non valido"},400);
     query="UPDATE orders SET status = ? WHERE id = ?";value=body.status;
    }
    const result=await env.db.prepare(query).bind(value,match[1]).run();
    return result.meta.changes?json({ok:true}):json({errore:"Ordine non trovato"},404);
   }
   return json({errore:"Operazione non disponibile"},404);
  }catch{return json({errore:"Impossibile leggere o aggiornare l’archivio. Riprova."},503);}
 }
};
const PAGE = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ordini · Pescheria Massimo</title>
<style>body{font:17px system-ui;margin:auto;padding:20px;max-width:850px;background:#f1f5f7;color:#17313b}input,button,select{font:inherit;padding:12px;border:1px solid #a9bbc1;border-radius:8px;margin:4px 0;max-width:100%;box-sizing:border-box}button{background:#075e71;color:white;cursor:pointer}button:disabled{opacity:.6}article{background:white;padding:18px;margin:16px 0;border-radius:12px}h1{font-size:26px}h2{font-size:21px}p{overflow-wrap:anywhere}#msg{white-space:pre-wrap}small{overflow-wrap:anywhere}.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}label{display:block;margin:10px 0}#key{width:100%}</style>
<h1>Ordini · Pescheria Massimo</h1>
<form id="login"><label>Chiave di accesso<input id="key" type="password" autocomplete="current-password" required minlength="20"></label><label><input id="showKey" type="checkbox"> Mostra password</label><label><input id="rememberAccess" type="checkbox"> Ricordami su questo dispositivo</label><button id="loginButton">Accedi</button><p>Se selezioni Ricordami, la chiave viene conservata in questo browser. Chi usa questo browser potrà aprire gli ordini. Esci cancella l'accesso salvato.</p></form>
<section id="panel" hidden><p id="sessionStatus"></p><div class="bar"><label>Mostra <select id="view"><option value="open">Da gestire · tutte le date</option><option value="all">Tutti · anche ritirati e annullati</option></select></label><label>Data ritiro (facoltativa) <input id="day" type="date"></label><button id="clearDay">Tutte le date</button><button id="refresh">Aggiorna</button><button id="logout">Esci</button></div><button id="enableAlerts" type="button">Attiva avvisi</button><p id="alertStatus">Avvisi disattivati. Lascia aperto questo pannello.</p><details><summary>Suono personalizzato</summary><label>Carica MP3 (massimo 5 MB)<input id="alertFile" type="file" accept=".mp3,audio/mpeg"></label><p id="soundName">Suono: doppio bip.</p><button id="resetSound" type="button">Ripristina doppio bip</button><p>Il file resta solo in questo browser. Vengono riprodotti al massimo i primi 10 secondi. Premi Attiva avvisi o Prova suono per ascoltarlo.</p></details><p id="newOrders" role="alert" hidden></p><p id="scope"></p><p id="totals"></p><details><summary>Resoconto giornaliero</summary><label>Giorno del resoconto <input id="reportDay" type="date"></label><button id="reportLoad">Mostra resoconto</button><button id="reportCsv" disabled>Scarica movimenti CSV</button><p id="reportMsg" role="status"></p><div id="reportOutput"></div><p>Incassi e rimborsi per data del pagamento, ora italiana. Ordini e prodotti per data di ritiro. I pagamenti segnati prima di questa funzione non hanno una data e non sono inclusi negli incassi giornalieri. Annullare un ordine non registra un rimborso. Registro interno degli ordini online: non sostituisce scontrini o contabilità.</p></details><div id="orders"></div></section>
<p id="msg" role="status" aria-live="polite"></p>
<script>
let token="",loadSeq=0,alertAudio=null,alertsEnabled=false,polling=false,mutations=0;
const seenOrders=new Set();let ordersBaseline=false;
const ACCESS_KEY="pm-admin-access-v1";let rememberWanted=false,accessSaved=false,authGeneration=0,loginBusy=false;
function removeSavedAccess(){try{localStorage.removeItem(ACCESS_KEY);return true;}catch(e){return false;}}
function saveAccess(){
 if(accessSaved)return;accessSaved=true;
 try{
  if(rememberWanted)localStorage.setItem(ACCESS_KEY,token);else localStorage.removeItem(ACCESS_KEY);
  $("sessionStatus").textContent=rememberWanted?"Accesso ricordato su questo browser. Esci cancella la chiave salvata.":"Accesso valido solo fino alla chiusura o all'aggiornamento della pagina.";
 }catch(e){$("sessionStatus").textContent="Il browser non consente di salvare o rimuovere l'accesso. Per rimuovere una chiave già salvata, cancella i dati di questo sito nelle impostazioni del browser.";}
}
function startLogin(key,remember){
 if(loginBusy)return;
 loginBusy=true;const generation=++authGeneration;$("loginButton").disabled=true;
 token=key;rememberWanted=remember;accessSaved=false;$("view").value="open";$("day").value="";
 return load().then(checkOrders).finally(()=>{if(generation===authGeneration||!token){loginBusy=false;$("loginButton").disabled=false;}});
}

const $=id=>document.getElementById(id);
$("showKey").onchange=()=>{$("key").type=$("showKey").checked?"text":"password";};
const money=n=>new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n/100);
const states={new:"Nuovo",confirmed:"Confermato",ready:"Pronto",collected:"Ritirato",cancelled:"Annullato"};
$("day").value="";
const formatDate=date=>new Date(date+"T12:00:00Z").toLocaleDateString("it-IT",{timeZone:"Europe/Rome",weekday:"long",day:"numeric",month:"long",year:"numeric"});
function confirmationUrl(o){
 let phone=String(o.customer_phone||"").replace(/[^0-9+]/g,"");
 if(phone.startsWith("+"))phone=phone.slice(1);else if(phone.startsWith("00"))phone=phone.slice(2);else if(/^3[0-9]{9}$/.test(phone))phone="39"+phone;else return null;
 if(!/^[1-9][0-9]{6,14}$/.test(phone))return null;
 const text="Ciao "+o.customer_name+", il tuo ordine presso Pescheria da Massimo è confermato. Ritiro: "+formatDate(o.pickup_date)+" alle "+o.pickup_time+". Codice ordine: "+o.id+". A presto!";
 return "https://wa.me/"+phone+"?text="+encodeURIComponent(text);
}
function element(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
async function api(path,options={}){
 const requestToken=token,generation=authGeneration;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(path,{...options,signal:controller.signal,headers:{"Authorization":"Bearer "+requestToken,"Content-Type":"application/json"},cache:"no-store"});
  let data;try{data=await response.json();}catch(e){if(controller.signal.aborted)throw e;throw new Error("Risposta non valida dal servizio. Riprova tra poco.");}
  if(!response.ok){
   const message=data.errore||"Operazione non riuscita";
   if(response.status===401&&generation===authGeneration){
    const choice=rememberWanted;exit();$("rememberAccess").checked=choice;
    $("msg").textContent=message+". La chiave non è stata salvata. Controlla il valore inserito e riprova.";
   }
   throw new Error(message);
  }
  return data;
 }catch(e){if(controller.signal.aborted)throw new Error("Il servizio non risponde entro 15 secondi. Riprova: nessun ordine è stato cancellato.");throw e;}
 finally{clearTimeout(timer);}
}
function exit(){authGeneration++;loginBusy=false;$("loginButton").disabled=false;const cleared=removeSavedAccess();rememberWanted=false;$("rememberAccess").checked=false;ordersBaseline=false;seenOrders.clear();$("newOrders").hidden=true;document.title="Ordini · Pescheria Massimo";$("reportOutput").replaceChildren();$("reportCsv").disabled=true;reportData=null;loadSeq++;token="";$("key").value="";$("orders").replaceChildren();$("totals").textContent="";$("panel").hidden=true;$("login").hidden=false;return cleared;}
async function load(){
 const seq=++loadSeq;
 $("orders").replaceChildren();$("totals").textContent="";$("scope").textContent="";
 $("msg").textContent="Caricamento…";
 try{
 const query=new URLSearchParams({view:$("view").value});
 if($("day").value)query.set("date",$("day").value);
 const data=await api("/api/orders?"+query);
 if(seq!==loadSeq || !token)return;
 saveAccess();$("key").value="";
 $("scope").textContent=($("view").value==="open"?"Ordini da gestire: nuovi, confermati e pronti":"Archivio: tutti gli stati")+($("day").value?" · Ritiro "+formatDate($("day").value):" · Tutte le date di ritiro");
 $("login").hidden=true;$("panel").hidden=false;$("orders").replaceChildren();
 const active=data.orders.filter(o=>o.status!=="cancelled");
 $("totals").textContent=active.length+" ordini · Da incassare (stima): "+money(active.filter(o=>!o.paid).reduce((s,o)=>s+o.total_cents,0))+" · Incassi effettivi nel resoconto giornaliero";
 for(const o of data.orders){
  const card=element("article","");
  card.append(element("h2",o.customer_name+" · "+money(o.total_cents)),element("small","Codice: "+o.id),element("p","Ritiro: "+formatDate(o.pickup_date)+" alle "+o.pickup_time),element("p","Cellulare: "+o.customer_phone));
  if(o.notes)card.append(element("p","Note: "+o.notes));
  const list=element("ul","");
  for(const item of o.items)list.append(element("li",(item.quantity??item.qta??"")+" "+(item.unit??item.unita??"")+" · "+(item.name??item.nome??item.id??"Prodotto")+(item.preparation?" · "+item.preparation:"")+(item.occasion?" · "+item.occasion:"")));
  card.append(list);
  const paid=element("input","");paid.type="checkbox";paid.checked=!!o.paid;
  paid.hidden=true;card.append(paid);
  card.append(element("p",o.paid?(o.recorded_balance_cents>0?"Pagato · Incasso registrato: "+money(o.recorded_balance_cents):"Pagato prima del registro · data e importo effettivo non disponibili"):"Da incassare · importo del menu indicativo"));
  const paymentForm=element("form","");
  const amount=element("input","");amount.type="number";amount.min="0.01";amount.max="100000";amount.step="0.01";amount.value=(o.total_cents/100).toFixed(2);amount.required=true;amount.setAttribute("aria-label","Importo effettivo in euro");
  const method=element("select","");method.setAttribute("aria-label","Metodo pagamento");for(const [value,text] of [["cash","Contanti"],["card","Carta"]]){const opt=element("option",text);opt.value=value;method.append(opt);}
  const payButton=element("button",o.paid?"Registra rimborso totale":"Registra incasso");
  if(!o.paid)paymentForm.append(element("label","Importo effettivo (€)"),amount);
  paymentForm.append(method,payButton);
  paymentForm.oninput=()=>{paymentForm.dataset.dirty="true";};
  let paymentId=null,paymentSignature="";
  paymentForm.onsubmit=async e=>{
   e.preventDefault();const kind=o.paid?"refund":"payment";
   if(kind==="refund"&&!confirm("Registrare la restituzione completa del denaro al cliente? Usa questa funzione solo quando il denaro viene restituito."))return;
   const body={order_id:o.id,kind,method:method.value,...(kind==="payment"?{amount_cents:Math.round(Number(amount.value)*100)}:{})};
   const signature=JSON.stringify(body);if(signature!==paymentSignature){paymentId=crypto.randomUUID();paymentSignature=signature;}
   payButton.disabled=true;mutations++;
   try{await api("/api/payments",{method:"POST",body:JSON.stringify({...body,id:paymentId})});await load();$("reportOutput").replaceChildren();$("reportCsv").disabled=true;reportData=null;$("reportMsg").textContent="Movimento salvato. Premi Mostra resoconto per aggiornare.";}catch(e){$("msg").textContent=e.message;payButton.disabled=false;}finally{mutations--;}
  };
  if((o.paid&&o.recorded_balance_cents>0)||(!o.paid&&o.status!=="cancelled"))card.append(paymentForm);
  const select=element("select","");select.setAttribute("aria-label","Stato ordine "+o.id);
  for(const [value,title] of Object.entries(states)){const option=element("option",title);option.value=value;select.append(option);}select.value=o.status;card.append(select);
  async function change(body){mutations++;paid.disabled=select.disabled=true;try{await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify(body)});}catch(e){$("msg").textContent=e.message;paid.checked=!!o.paid;select.value=o.status;paid.disabled=select.disabled=false;return;}finally{mutations--;}await load();}
  select.onchange=()=>change({status:select.value});
  if(["new","confirmed"].includes(o.status)){
   const wa=element("button",o.status==="new"?"Conferma su WhatsApp":"Invia conferma su WhatsApp");wa.type="button";
   wa.onclick=async()=>{
    const url=confirmationUrl(o);
    if(!url){$("msg").textContent="Numero non valido: verifica il cellulare del cliente.";return;}
    const chat=window.open("about:blank","_blank");if(chat)chat.opener=null;
    wa.disabled=paid.disabled=select.disabled=true;mutations++;
    try{
     await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify({status:"confirmed"})});
     o.status="confirmed";select.value="confirmed";wa.textContent="Invia di nuovo la conferma";
     const link=element("a","Apri il messaggio su WhatsApp");link.href=url;link.target="_blank";link.rel="noopener noreferrer";card.append(link);
     if(chat)chat.location.replace(url);
     $("msg").textContent="Ordine confermato nel pannello. Premi Invia su WhatsApp per avvisare il cliente. Se la chat non si apre, usa il link sotto l'ordine.";
    }catch(e){if(chat)chat.close();$("msg").textContent=e.message;}
    finally{mutations--;wa.disabled=paid.disabled=select.disabled=false;}
   };
   card.append(wa,element("small","Il messaggio parte solo quando premi Invia in WhatsApp."));
  }
  $("orders").append(card);
 }
 $("msg").textContent=data.orders.length?"Aggiornato. Premi Aggiorna per cercare nuovi ordini.":($("view").value==="open"?"Nessun ordine da gestire":"Nessun ordine in archivio")+($("day").value?" per questa data.":".");
 }catch(e){if(seq===loadSeq)$("msg").textContent=e.message;}
}


let reportData=null;
const todayParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
$("reportDay").value=['year','month','day'].map(t=>todayParts.find(p=>p.type===t).value).join('-');
$("reportDay").onchange=()=>{reportData=null;$("reportCsv").disabled=true;$("reportOutput").replaceChildren();};
$("reportLoad").onclick=async()=>{
 $("reportLoad").disabled=true;$("reportCsv").disabled=true;$("reportMsg").textContent="Caricamento resoconto…";const key=token;
 try{
  const data=await api('/api/report?date='+encodeURIComponent($("reportDay").value));if(token!==key||data.date!==$("reportDay").value)return;
  reportData=data;const out=$("reportOutput");out.replaceChildren();const t=data.summary;
  out.append(element('h2','Resoconto '+formatDate(data.date)),element('p',t.orders+' ordini · '+t.collected+' ritirati · '+t.cancelled+' annullati'),element('p','Totale indicativo ordini: '+money(t.expected_cents)+' · Ancora da incassare: '+money(t.outstanding_cents)),element('p','Incassi del giorno: '+money(t.receipts_cents)+' · Rimborsi: '+money(t.refunds_cents)+' · Netto: '+money(t.net_cents)),element('p','Netto contanti: '+money(t.cash_cents)+' · Netto carta: '+money(t.card_cents)));
  out.append(element('h3','Prodotti previsti per il ritiro (esclusi annullati)'));
  const products=new Map();for(const o of data.orders.filter(o=>o.status!=='cancelled'))for(const item of o.items){const name=item.name??item.nome??item.id;const unit=item.unit??item.unita??'';const key=JSON.stringify([name,unit,item.preparation||'']);const entry=products.get(key)||{name,unit,prep:item.preparation||'',quantity:0};entry.quantity+=Number(item.quantity??item.qta??0);products.set(key,entry);}
  for(const p of products.values())out.append(element('p',p.name+' · '+Number(p.quantity.toFixed(3))+' '+p.unit+(p.prep?' · '+p.prep:'')));
  out.append(element('h3','Movimenti registrati nel giorno'));
  for(const p of data.movements)out.append(element('p',new Date(p.created_at).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome'})+' · '+p.customer_name+' · '+(p.kind==='refund'?'Rimborso':'Incasso')+' · '+money(p.amount_cents)+' · '+(p.method==='cash'?'Contanti':'Carta')));
  $("reportMsg").textContent=data.movements.length?'Resoconto aggiornato.':'Nessun movimento registrato in questa data.';$("reportCsv").disabled=false;
 }catch(e){$("reportMsg").textContent=e.message;}finally{$("reportLoad").disabled=false;}
};
function csvCell(value){let text=String(value??'');if(/^\\s*[=+@-]|^[\\t\\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
$("reportCsv").onclick=()=>{
 if(!reportData)return;
 const rows=[['Data italiana','Ora italiana','Codice movimento','Codice ordine','Cliente','Tipo','Metodo','Importo EUR']];
 for(const p of reportData.movements)rows.push([p.business_date,new Date(p.created_at).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome'}),p.id,p.order_id,p.customer_name,p.kind==='refund'?'Rimborso':'Incasso',p.method==='cash'?'Contanti':'Carta',(p.amount_cents/100).toFixed(2).replace('.',',')]);
 const blob=new Blob(['\\uFEFF'+rows.map(row=>row.map((v,i)=>i===7&&/^-?[0-9]+,[0-9]{2}$/.test(String(v))?'"'+v+'"':csvCell(v)).join(';')).join('\\r\\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=element('a','');link.href=url;link.download='movimenti-'+reportData.date+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

function newOrderIds(orders){
 const fresh=orders.filter(o=>!seenOrders.has(o.id));
 for(const o of orders)seenOrders.add(o.id);
 if(!ordersBaseline){ordersBaseline=true;return [];}
 return fresh;
}

let customBuffer=null,savedSound=null;
function alertStore(action,value){
 return new Promise((resolve,reject)=>{
  let db,settled=false;
  const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(db)db.close();err?reject(err):resolve(result);};
  const timer=setTimeout(()=>finish(new Error("Archivio audio non disponibile")),5000);
  let open;try{open=indexedDB.open("pm-order-alerts",1);}catch(e){finish(e);return;}
  open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains("sounds"))open.result.createObjectStore("sounds");};
  open.onerror=()=>finish(open.error);open.onblocked=()=>finish(new Error("Archivio audio bloccato"));
  open.onsuccess=()=>{
   db=open.result;if(settled){db.close();return;}
   try{
    const tx=db.transaction("sounds",action==="get"?"readonly":"readwrite"),store=tx.objectStore("sounds");
    const req=action==="get"?store.get("order"):action==="put"?store.put(value,"order"):store.delete("order");
    let result;req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>finish(null,result);tx.onerror=()=>finish(tx.error||new Error("Errore archivio audio"));tx.onabort=()=>finish(tx.error||new Error("Archivio audio annullato"));
   }catch(e){finish(e);}
  };
 });
}
const savedSoundReady=alertStore("get").then(value=>{
 if(value&&value.bytes instanceof ArrayBuffer&&value.bytes.byteLength<=5*1024*1024){savedSound=value;$("soundName").textContent="MP3 salvato: "+value.name;}
}).catch(()=>{$("soundName").textContent="Doppio bip. Salvataggio audio non disponibile in questo browser.";});
async function enableAudio(){
 const Audio=window.AudioContext||window.webkitAudioContext;
 if(!Audio)throw new Error("Suono non disponibile");
 if(!alertAudio)alertAudio=new Audio();
 await alertAudio.resume();
}
$("alertFile").onchange=async()=>{
 const file=$("alertFile").files[0];if(!file)return;
 if(!/\\.mp3$/i.test(file.name)||file.size<1||file.size>5*1024*1024){$("soundName").textContent="Scegli un file MP3 valido, massimo 5 MB.";$("alertFile").value="";return;}
 $("alertFile").disabled=$("resetSound").disabled=true;
 try{
  await enableAudio();await savedSoundReady;
  const bytes=await file.arrayBuffer(),decoded=await alertAudio.decodeAudioData(bytes.slice(0));
  if(!Number.isFinite(decoded.duration)||decoded.duration<=0)throw new Error("Audio vuoto");
  const record={name:file.name,bytes};let persisted=true;
  try{await alertStore("put",record);}catch(e){persisted=false;}
  savedSound=record;customBuffer=decoded;alertsEnabled=true;
  $("soundName").textContent=(persisted?"MP3 salvato: ":"MP3 attivo solo per questa apertura: ")+file.name;
  $("enableAlerts").textContent="Prova suono";
  $("alertStatus").textContent="Avvisi attivi con MP3. Lascia il pannello aperto; controllo ogni 30 secondi.";
  soundAlert();
 }catch(e){$("soundName").textContent="MP3 non caricato. Il suono precedente resta disponibile. Prova un altro file.";}
 finally{$("alertFile").disabled=$("resetSound").disabled=false;$("alertFile").value="";}
};
$("resetSound").onclick=async()=>{
 $("alertFile").disabled=$("resetSound").disabled=true;
 try{
  await savedSoundReady;
  await alertStore("delete");savedSound=null;customBuffer=null;
  $("soundName").textContent="Suono: doppio bip.";
  $("alertStatus").textContent="Doppio bip selezionato. Premi Attiva avvisi o Prova suono.";
 }catch(e){$("soundName").textContent="Impossibile rimuovere il file salvato. Riprova.";}
 finally{$("alertFile").disabled=$("resetSound").disabled=false;}
};

function soundAlert(){
 if(!alertsEnabled||!alertAudio)return;
 try{
  alertAudio.resume().then(()=>{
   if(customBuffer){
    const source=alertAudio.createBufferSource();source.buffer=customBuffer;source.connect(alertAudio.destination);
    source.start(0,0,Math.min(customBuffer.duration,10));source.onended=()=>source.disconnect();return;
   }
   const start=alertAudio.currentTime;
   for(const offset of [0,0.35]){
    const oscillator=alertAudio.createOscillator(),gain=alertAudio.createGain();
    oscillator.connect(gain);gain.connect(alertAudio.destination);
    oscillator.frequency.value=880;
    gain.gain.setValueAtTime(0,start+offset);
    gain.gain.linearRampToValueAtTime(0.15,start+offset+0.01);
    gain.gain.setValueAtTime(0.15,start+offset+0.18);
    gain.gain.linearRampToValueAtTime(0,start+offset+0.2);
    oscillator.start(start+offset);oscillator.stop(start+offset+0.21);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
   }
  }).catch(()=>{});
 }catch(e){}
}
$("enableAlerts").onclick=async()=>{
 try{
  await enableAudio();await savedSoundReady;
  if(savedSound&&!customBuffer){
   try{customBuffer=await alertAudio.decodeAudioData(savedSound.bytes.slice(0));}
   catch(e){savedSound=null;$("soundName").textContent="MP3 salvato non leggibile. Uso il doppio bip: carica di nuovo il file.";}
  }
  alertsEnabled=true;soundAlert();
  $("alertStatus").textContent=(customBuffer?"MP3 attivo. ":"Doppio bip attivo. ")+"Controllo ogni 30 secondi con pannello aperto. PC in sospensione o schede inattive possono ritardare gli avvisi.";
  $("enableAlerts").textContent="Prova suono";
 }catch(e){$("alertStatus").textContent="Suono non attivato. Gli avvisi visivi restano disponibili.";}
};
async function checkOrders(){
 if(!token||polling||mutations)return;
 polling=true;const activeToken=token;
 try{
  const result=await api("/api/orders?view=open");
  if(token!==activeToken)return;
  const fresh=newOrderIds(result.orders);
  if(fresh.length){
   const banner=$("newOrders");banner.hidden=false;
   banner.textContent=fresh.length+" nuovi ordini ricevuti: "+fresh.map(o=>o.customer_name).join(", ")+".";
   document.title="Nuovo ordine · Pescheria Massimo";soundAlert();
  }
  if(!mutations&&!["INPUT","SELECT"].includes(document.activeElement?.tagName)&&!document.querySelector('form[data-dirty="true"]'))await load();
 }catch(e){if(token===activeToken)$("alertStatus").textContent="Controllo automatico non riuscito. Riprovo tra 30 secondi. Puoi premere Aggiorna.";}
 finally{polling=false;}
}
setInterval(checkOrders,30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkOrders();});

$("login").onsubmit=e=>{e.preventDefault();startLogin($("key").value,$("rememberAccess").checked);};
$("refresh").onclick=load;$("day").onchange=load;$("view").onchange=load;$("clearDay").onclick=()=>{$("day").value="";load();};$("logout").onclick=()=>{const cleared=exit();$("msg").textContent=cleared?"Accesso chiuso e chiave salvata rimossa da questo browser.":"Accesso chiuso. Il browser non consente di cancellare la chiave salvata: cancella i dati di questo sito nelle impostazioni del browser.";};
try{
 const saved=localStorage.getItem(ACCESS_KEY);
 if(saved&&saved.length>=20&&saved.length<=500){$("rememberAccess").checked=true;startLogin(saved,true);}
 else if(saved)removeSavedAccess();
}catch(e){}
</script></html>`;
