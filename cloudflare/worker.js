const CLIENT_ORIGIN = 'https://ermestre.github.io';
const MENU_URL = 'https://raw.githubusercontent.com/ermestre/pescheriamassimo/main/menu.json';
const HOURS = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','17:00','17:30','18:00','18:30','19:00'];
// Orari standard: quelli scelti nella gestione (ritiro.orari) oppure quelli predefiniti.
function standardHours(menu){const list=menu?.ritiro?.orari;return Array.isArray(list)&&list.length&&list.every(h=>/^([01]\d|2[0-3]):[0-5]\d$/.test(h))?list:HOURS;}
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
 const name=string('customer_name',1,100),phone=string('customer_phone',6,30).replace(/[\s.\-\/()]/g,'');
 if(!/^\+?[0-9]{6,15}$/.test(phone))fail('Controlla il numero di cellulare');
 // Serve un cellulare raggiungibile su WhatsApp: italiano di 10 cifre che inizia con 3, oppure estero con prefisso.
 {const it=phone.replace(/^(\+39|0039)/,'');if(!(/^(\+|00)/.test(phone)&&!/^(\+39|0039)/.test(phone))&&!/^3[0-9]{9}$/.test(it))fail(/^0/.test(it)?'Serve un numero di cellulare, non il fisso.':'Il cellulare deve avere 10 cifre e iniziare con 3. Controlla di averlo scritto tutto.');}
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
 const hours=evening?(menu.ritiro?.orari_sera||['18:30','19:00','19:30','20:00']):standardHours(menu);
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
 await env.db.prepare('DELETE FROM order_limits WHERE bucket < ?').bind(bucket-1).run();
 for(const [k,b,max] of [[key,bucket,10],['global:'+bucket,bucket,100]]){
  const row=await env.db.prepare('INSERT INTO order_limits (key,bucket,count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(k,b).first();
  if(row.count>max)fail('Troppi tentativi. Attendi qualche minuto o contatta la pescheria.',429);
 }
}

// Fixed point quantities: 1000 units = 1 kg or 1 portion/piece.
const STOCK_SQL=[
 `CREATE TABLE IF NOT EXISTS inventory(product_id TEXT PRIMARY KEY,units INTEGER NOT NULL DEFAULT 0 CHECK(units>=0))`,
 `CREATE TABLE IF NOT EXISTS stock_moves(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,delta INTEGER NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS stock_reservations(order_id TEXT NOT NULL,product_id TEXT NOT NULL,units INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(order_id,product_id))`,
 `CREATE TRIGGER IF NOT EXISTS stock_move_apply AFTER INSERT ON stock_moves BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM inventory WHERE product_id=NEW.product_id AND units+NEW.delta>=0) THEN RAISE(ABORT,'STOCK_UNAVAILABLE') END;
 UPDATE inventory SET units=units+NEW.delta WHERE product_id=NEW.product_id; END`,
 `CREATE TRIGGER IF NOT EXISTS stock_reserve_apply AFTER INSERT ON stock_reservations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM inventory WHERE product_id=NEW.product_id AND units>=NEW.units) THEN RAISE(ABORT,'STOCK_UNAVAILABLE') END;
 UPDATE inventory SET units=units-NEW.units WHERE product_id=NEW.product_id; END`,
 `CREATE TRIGGER IF NOT EXISTS stock_reservation_change AFTER UPDATE OF active ON stock_reservations WHEN NEW.active!=OLD.active BEGIN
 SELECT CASE WHEN NEW.active=1 AND NOT EXISTS(SELECT 1 FROM inventory WHERE product_id=NEW.product_id AND units>=NEW.units) THEN RAISE(ABORT,'STOCK_UNAVAILABLE') END;
 UPDATE inventory SET units=units+CASE WHEN NEW.active=0 THEN NEW.units ELSE -NEW.units END WHERE product_id=NEW.product_id; END`,
 `CREATE TRIGGER IF NOT EXISTS stock_order_insert AFTER INSERT ON orders WHEN NEW.status!='cancelled' BEGIN
 INSERT INTO stock_reservations(order_id,product_id,units) SELECT NEW.id,json_extract(j.value,'$.id'),CAST(ROUND(json_extract(j.value,'$.quantity')*1000) AS INTEGER) FROM json_each(NEW.items_json) j JOIN inventory i ON i.product_id=json_extract(j.value,'$.id'); END`,
 `CREATE TRIGGER IF NOT EXISTS stock_order_status AFTER UPDATE OF status ON orders WHEN (NEW.status='cancelled')!=(OLD.status='cancelled') BEGIN
 UPDATE stock_reservations SET active=CASE WHEN NEW.status='cancelled' THEN 0 ELSE 1 END WHERE order_id=NEW.id; END`
];
// Schema: le istruzioni di creazione girano una sola volta per database, non a ogni richiesta.
// Aumentare SCHEMA_VERSION quando si aggiungono tabelle, indici o trigger.
const SCHEMA_VERSION=3;
function schemaSql(){return [
 'CREATE TABLE IF NOT EXISTS order_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)',
 ...STOCK_SQL,
 PAYMENT_SCHEMA,
 'CREATE INDEX IF NOT EXISTS payment_events_order ON payment_events(order_id)',
 'CREATE INDEX IF NOT EXISTS payment_events_day ON payment_events(business_date,created_at)',
 'CREATE INDEX IF NOT EXISTS orders_status_pickup ON orders(status,pickup_date,pickup_time)',
 'CREATE INDEX IF NOT EXISTS orders_pickup ON orders(pickup_date,pickup_time)',
 'CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL)',
 "INSERT OR IGNORE INTO app_meta(key,value) VALUES('rev',0)",
 "CREATE TRIGGER IF NOT EXISTS rev_order_insert AFTER INSERT ON orders BEGIN UPDATE app_meta SET value=value+1 WHERE key='rev'; END",
 "CREATE TRIGGER IF NOT EXISTS rev_order_update AFTER UPDATE ON orders BEGIN UPDATE app_meta SET value=value+1 WHERE key='rev'; END",
 "CREATE TRIGGER IF NOT EXISTS rev_payment_insert AFTER INSERT ON payment_events BEGIN UPDATE app_meta SET value=value+1 WHERE key='rev'; END",
 "CREATE TRIGGER IF NOT EXISTS rev_order_delete AFTER DELETE ON orders BEGIN UPDATE app_meta SET value=value+1 WHERE key='rev'; END"
];}
async function ensureSchema(db){
 try{const row=await db.prepare("SELECT value FROM app_meta WHERE key='schema'").first();if(row&&row.value>=SCHEMA_VERSION)return;}catch(e){}
 for(const sql of schemaSql())await db.prepare(sql).run();
 await db.prepare("INSERT INTO app_meta(key,value) VALUES('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(SCHEMA_VERSION).run();
}
function stockFailure(e){return String(e?.message||e).includes('STOCK_UNAVAILABLE');}
async function stockApi(request,env,url){
 if(!url.pathname.startsWith('/api/stock'))return null;
 if(url.pathname==='/api/stock'&&request.method==='GET'){
  const menu=await readMenu(),rows=(await env.db.prepare('SELECT * FROM inventory').all()).results;
  const reserved=(await env.db.prepare("SELECT product_id,SUM(units) units FROM stock_reservations r JOIN orders o ON o.id=r.order_id WHERE r.active=1 AND o.status IN ('new','confirmed','ready') GROUP BY product_id").all()).results;
  const map=new Map(rows.map(x=>[x.product_id,x.units]));
  const products=menu.categorie.flatMap(c=>c.voci.map(v=>({id:v.id,name:v.nome,unit:v.unita||'porzioni',managed:map.has(v.id),available:map.has(v.id)?map.get(v.id)/1000:null,reserved:(reserved.find(r=>r.product_id===v.id)?.units||0)/1000})));
  return json({products});
 }
 if(url.pathname==='/api/stock'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>2000)return json({errore:'Richiesta troppo grande'},413);
  let b;try{b=JSON.parse(raw);}catch{return json({errore:'Dati non validi'},400);}
  // Torna senza limite: tolte quantità e prenotazioni del prodotto, gli ordini restano intatti.
  if(b&&b.kind==='unlimited'&&typeof b.product_id==='string'&&b.product_id.length<=100){
   await env.db.batch([env.db.prepare('DELETE FROM stock_reservations WHERE product_id=?').bind(b.product_id),env.db.prepare('DELETE FROM inventory WHERE product_id=?').bind(b.product_id)]);
   return json({ok:true});
  }
  if(!b||!isUuid(b.id)||typeof b.product_id!=='string'||!Number.isSafeInteger(b.units)||b.units<(b.kind==='set'?0:1)||b.units>100000000||!['arrival','counter','set'].includes(b.kind))return json({errore:'Movimento di magazzino non valido'},400);
  const delta=b.kind==='counter'?-b.units:b.units;
  const prior=await env.db.prepare('SELECT * FROM stock_moves WHERE id=?').bind(b.id).first();
  if(prior)return prior.product_id===b.product_id&&prior.kind===b.kind&&(b.kind==='set'||prior.delta===delta)?json({ok:true}):json({errore:'Codice movimento già usato'},409);
  const menu=await readMenu(),v=menu.categorie.flatMap(c=>c.voci).find(v=>v.id===b.product_id);
  if(!v)return json({errore:'Prodotto non ancora nel menu pubblicato: salva il menu e riprova fra qualche minuto'},404);
  if(v.unita!=='kg'&&b.units%1000!==0)return json({errore:'Per questo prodotto inserisci un numero intero di pezzi o porzioni'},400);
  await env.db.batch([
   env.db.prepare('INSERT OR IGNORE INTO inventory(product_id,units) VALUES (?,0)').bind(b.product_id),
   b.kind==='set'
    // Quantità assoluta: la differenza si calcola nella stessa operazione, senza perdere ordini arrivati nel frattempo.
    ?env.db.prepare('INSERT OR IGNORE INTO stock_moves(id,product_id,delta,kind,created_at) SELECT ?,?,?-units,?,? FROM inventory WHERE product_id=?').bind(b.id,b.product_id,b.units,b.kind,new Date().toISOString(),b.product_id)
    :env.db.prepare('INSERT OR IGNORE INTO stock_moves(id,product_id,delta,kind,created_at) VALUES (?,?,?,?,?)').bind(b.id,b.product_id,delta,b.kind,new Date().toISOString())
  ]);
  const saved=await env.db.prepare('SELECT * FROM stock_moves WHERE id=?').bind(b.id).first();
  if(!saved||saved.product_id!==b.product_id||(b.kind!=='set'&&saved.delta!==delta)||saved.kind!==b.kind)return json({errore:'Movimento in conflitto'},409);
  return json({ok:true});
 }
 return json({errore:'Operazione magazzino non disponibile'},404);
}

async function publicApi(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const cors=origin===CLIENT_ORIGIN?{'Access-Control-Allow-Origin':CLIENT_ORIGIN,'Vary':'Origin'}:{};
 const respond=(data,status=200)=>{const r=json(data,status);for(const [k,v] of Object.entries(cors))r.headers.set(k,v);return r;};
 if(origin && origin!==CLIENT_ORIGIN && origin!==url.origin)return respond({errore:'Origine non consentita'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
 try{
  if(!env.db || typeof env.ADMIN_TOKEN!=='string' || env.ADMIN_TOKEN.length<20)fail('Ordini online non ancora configurati',503);
  await ensureSchema(env.db);
  if(url.pathname==='/api/config' && request.method==='GET'){
   const menu=await readMenu();const stock=(await env.db.prepare('SELECT * FROM inventory').all()).results;for(const c of menu.categorie)for(const v of c.voci){const row=stock.find(x=>x.product_id===v.id);if(row)v.stock_available=row.units/1000;}return respond({ok:true,menu,stock_supported:true,preparations_supported:true,festivities_supported:true,days:pickupDays(menu,new Date())});
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
 }catch(e){if(stockFailure(e))return respond({errore:'Quantità non più disponibile. Aggiorna il menu e riduci la quantità: nessun ordine è stato registrato.'},409);return respond({errore:e.status?e.message:'Servizio momentaneamente non disponibile. Riprova con lo stesso ordine.'},e.status||503);}
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

// La gestione del menu (GitHub Pages) può leggere e impostare le quantità: serve sempre la chiave del pannello.
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  const gestione=url.pathname==='/api/stock'&&request.headers.get('Origin')===CLIENT_ORIGIN;
  if(gestione&&request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':CLIENT_ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});
  const response=await handle(request,env,url);
  if(gestione){response.headers.set('Access-Control-Allow-Origin',CLIENT_ORIGIN);response.headers.set('Vary','Origin');}
  return response;
 }
};
async function handle(request,env,url){
 {
  if(["/api/config","/api/submit"].includes(url.pathname))return publicApi(request,env);
  if(request.method==="GET" && (url.pathname==="/" || url.pathname==="/admin")){
   return new Response(PAGE,{headers:{...HEADERS,"Content-Type":"text/html; charset=utf-8",
   "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https://ermestre.github.io; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}});
  }
  if(!url.pathname.startsWith("/api/")) return json({errore:"Pagina non trovata"},404);
  if(!await authorized(request,env)) return json({errore:"Chiave di accesso non valida"},401);
  if(!env.db) return json({errore:"Database non collegato"},503);
  try{
   await ensureSchema(env.db);
   // Azzeramento per le prove: solo con menu.modalita_prova attiva e la parola AZZERA.
   if(url.pathname==="/api/reset" && request.method==="POST"){
    const raw=await request.text();let b;try{b=JSON.parse(raw);}catch{return json({errore:"Richiesta non valida"},400);}
    if(b?.conferma!=="AZZERA")return json({errore:"Scrivi AZZERA per confermare"},400);
    const menu=await readMenu();
    if(menu.modalita_prova!==true)return json({errore:"Modalità prova spenta: gli ordini veri non si possono azzerare. Accendila dalla gestione se state ancora provando."},403);
    const counts=await env.db.prepare("SELECT (SELECT count(*) FROM orders) AS ordini").first();
    await env.db.batch(["DELETE FROM payment_events","DELETE FROM stock_reservations","DELETE FROM stock_moves","DELETE FROM inventory","DELETE FROM orders"].map(sql=>env.db.prepare(sql)));
    return json({ok:true,ordini:counts?.ordini||0});
   }
   if(url.pathname==="/api/changes" && request.method==="GET"){
    const row=await env.db.prepare("SELECT value FROM app_meta WHERE key='rev'").first();
    return json({rev:row?row.value:0});
   }
   const stockResponse=await stockApi(request,env,url);if(stockResponse)return stockResponse;
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
   // Eliminazione definitiva: solo ordini già annullati, insieme ai loro movimenti e prenotazioni.
   if(match && request.method==="DELETE"){
    const id=match[1];
    const order=await env.db.prepare("SELECT status FROM orders WHERE id=?").bind(id).first();
    if(!order)return json({errore:"Ordine non trovato. Premi Aggiorna."},404);
    if(order.status!=="cancelled")return json({errore:"Si possono eliminare solo gli ordini annullati. Prima imposta lo stato Annullato."},409);
    const onlyCancelled="EXISTS(SELECT 1 FROM orders WHERE id=? AND status='cancelled')";
    await env.db.batch([
     env.db.prepare("DELETE FROM payment_events WHERE order_id=? AND "+onlyCancelled).bind(id,id),
     env.db.prepare("DELETE FROM stock_reservations WHERE order_id=? AND "+onlyCancelled).bind(id,id),
     env.db.prepare("DELETE FROM orders WHERE id=? AND status='cancelled'").bind(id)
    ]);
    const still=await env.db.prepare("SELECT 1 FROM orders WHERE id=?").bind(id).first();
    return still?json({errore:"Ordine modificato nel frattempo: premi Aggiorna e riprova."},409):json({ok:true});
   }
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
  }catch(e){if(stockFailure(e))return json({errore:"Quantità insufficiente. Aggiorna le disponibilità: nessuna modifica è stata salvata."},409);return json({errore:"Impossibile leggere o aggiornare l’archivio. Riprova."},503);}
 }
}
const PAGE = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#1b2f4e">
<title>Ordini · Pescheria Massimo</title><link rel="icon" type="image/png" href="https://ermestre.github.io/pescheriamassimo/img/icona-64.png">
<style>
:root{--inchiostro:#1b2f4e;--ghiaccio:#e8eff2;--seppia:#efe4d3;--bordo:#c8d4d9;--tenue:#56677a;--nuovo:#e0a526;--nuovo-testo:#7d5400;--confermato:#2c6e9b;--pronto:#2f7d55;--ritirato:#66757d;--annullato:#b0412e;--wa:#1e8a4c;--serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif}
*{box-sizing:border-box}
body{margin:0;font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--ghiaccio);color:var(--inchiostro);padding-bottom:80px}
p{overflow-wrap:anywhere}
button,input,select{font:inherit;color:inherit}
button{border:0;border-radius:10px;padding:11px 18px;min-height:48px;background:var(--inchiostro);color:#fff;font-weight:600;cursor:pointer}
button.secondario{background:#fff;color:var(--inchiostro);border:1.5px solid var(--bordo)}
button:disabled{opacity:.55;cursor:default}
input,select{padding:10px 12px;min-height:48px;max-width:100%;border:1.5px solid var(--bordo);border-radius:10px;background:#fff}
input[type=checkbox]{width:22px;height:22px;min-height:0;margin:0;accent-color:var(--inchiostro)}
:focus-visible{outline:3px solid var(--nuovo);outline-offset:2px}
label{display:block}
.insegna{background:radial-gradient(120% 90% at 50% 0%,#2f5b86 0%,var(--inchiostro) 70%);padding:16px 0 10px}
.insegna img{display:block;width:132px;height:132px;margin:0 auto;border-radius:50%;box-shadow:0 0 0 3px var(--seppia),0 10px 24px rgba(0,0,0,.4)}
.nastro{background:var(--inchiostro);color:#fff}
.nastro div{max-width:960px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px}
.nastro h1{margin:0;font:600 23px var(--serif);letter-spacing:.01em}
.nastro p{margin:0;opacity:.85}
main{max-width:960px;margin:0 auto;padding:16px}
.accesso{max-width:460px;margin:20px auto;background:#fff;border:1px solid var(--bordo);border-radius:16px;padding:22px}
.accesso h2{margin:0 0 6px;font:600 22px var(--serif)}
.accesso label{margin:14px 0}
.accesso .spunta{display:flex;align-items:center;gap:10px}
#key{width:100%;margin-top:6px}
.accesso button{width:100%}
.accesso p{color:var(--tenue);font-size:15px;margin-bottom:0}
.comandi{background:#fff;border:1px solid var(--bordo);border-radius:14px;padding:14px;display:grid;gap:14px}
.avvisi{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.avvisi p{margin:0;flex:1 1 240px;color:var(--tenue);font-size:15px}
#enableAlerts{background:var(--nuovo);color:#2b1d00}
#enableAlerts::before{content:"\\1F514  "}
.filtri{display:flex;flex-wrap:wrap;gap:10px;align-items:end}
.filtri label{display:grid;gap:4px;font-size:14px;color:var(--tenue)}
#newOrders{margin:14px 0 0;padding:14px 16px;border-radius:12px;background:#fff4d9;border:2px solid var(--nuovo);color:#2b1d00;font-weight:700;animation:richiamo 1.1s ease-out 3}
@keyframes richiamo{from{box-shadow:0 0 0 0 rgba(224,165,38,.6)}to{box-shadow:0 0 0 16px rgba(224,165,38,0)}}
.riepilogo{margin:20px 0 0}
#scope{margin:0;font:600 21px var(--serif)}
#summary{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
#summary:empty{display:none}
.conta{padding:5px 12px;border-radius:999px;background:#fff;border:1.5px solid currentColor;font-size:15px;font-weight:600}
.conta.stato-new{color:var(--nuovo-testo)}.conta.stato-confirmed{color:var(--confermato)}.conta.stato-ready{color:var(--pronto)}.conta.stato-collected{color:var(--ritirato)}.conta.stato-cancelled{color:var(--annullato)}
#totals{margin:0;color:var(--tenue);font-size:15px}
.giorno{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:28px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--inchiostro);font:700 25px var(--serif)}
.giorno small{font:400 15px system-ui,sans-serif;color:var(--tenue)}
.giorno.passato{color:var(--annullato);border-color:var(--annullato)}
.ordine{--c:var(--bordo);background:#fff;border:1px solid var(--bordo);border-left:8px solid var(--c);border-radius:14px;padding:14px 16px;margin:12px 0}
.ordine.stato-new{--c:var(--nuovo);background:#fffaf0}
.ordine.stato-confirmed{--c:var(--confermato)}
.ordine.stato-ready{--c:var(--pronto)}
.ordine.stato-collected{--c:var(--ritirato)}
.ordine.stato-cancelled{--c:var(--annullato);background:#fbf6f5}
.testa{display:grid;grid-template-columns:auto 1fr auto;gap:12px 14px;align-items:center}
.cartellino{background:var(--seppia);border-radius:8px;padding:6px 10px;min-width:78px;text-align:center;transform:rotate(-2deg);box-shadow:1px 2px 0 rgba(27,47,78,.18)}
.cartellino b{display:block;font:700 26px/1.1 var(--serif)}
.cartellino span{font-size:13px;color:var(--tenue)}
.chi h3{margin:0;font:700 21px/1.2 var(--serif);overflow-wrap:anywhere}
.pill{display:inline-block;margin-top:4px;padding:2px 10px;border-radius:999px;background:var(--c);color:#fff;font-size:14px;font-weight:600}
.stato-new .pill{color:#2b1d00}
.codice-corto{display:inline-block;margin:4px 0 0 8px;padding:2px 8px;border-radius:6px;background:var(--ghiaccio);font-size:14px;font-weight:700;letter-spacing:.06em}
.importo{margin:0;font:700 22px var(--serif);white-space:nowrap}
.prodotti{list-style:none;margin:12px 0 0;padding:0;border-top:1px dashed var(--bordo)}
.prodotti li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:8px 0;border-bottom:1px dashed var(--bordo)}
.prodotti b{min-width:72px}
.tag{font-size:14px;padding:1px 8px;border-radius:6px;background:var(--ghiaccio)}
.note{white-space:pre-line;margin:10px 0 0;padding:8px 12px;border-radius:8px;background:#fff4d9}
.ritardo{margin:10px 0 0;color:var(--annullato);font-weight:600}
.azioni{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px}
.azioni .wa{background:var(--wa)}
.azioni .verso-ready{background:var(--pronto)}
.azioni .verso-collected{background:var(--inchiostro)}
.elimina-tutto{background:var(--annullato)}
#provaBox{border-color:var(--annullato)}
.azioni .elimina{background:#fff;color:var(--annullato);border:1.5px solid var(--annullato)}
.azioni .stato{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:15px;color:var(--tenue)}
.azioni small{flex-basis:100%;color:var(--tenue)}
.azioni a{color:var(--wa);font-weight:700}
.pagamento{margin-top:14px;padding:12px;border-radius:10px;background:var(--ghiaccio)}
.pagamento p{margin:0 0 8px}
.pagamento form{display:flex;flex-wrap:wrap;align-items:end;gap:8px}
.pagamento label{display:grid;gap:4px;font-size:14px;color:var(--tenue)}
.pagamento input{width:150px}
.piede{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 14px;margin-top:12px;font-size:14px;color:var(--tenue)}
.piede a{color:var(--inchiostro);font-size:17px;font-weight:700}
.vuoto{margin:20px 0;padding:32px 20px;border:2px dashed var(--bordo);border-radius:14px;background:#fff;text-align:center;color:var(--tenue)}
.strumenti{margin-top:44px;padding-top:6px;border-top:2px solid var(--bordo)}
.strumenti h2{margin:14px 0 6px;font:600 19px var(--serif);color:var(--tenue)}
details{background:#fff;border:1px solid var(--bordo);border-radius:12px;margin:10px 0;padding:0 14px}
details[open]{padding-bottom:14px}
summary{cursor:pointer;padding:14px 0;font-weight:600}
details p{color:var(--tenue);font-size:15px}
details button{margin:4px 6px 4px 0}
#stockProducts article{border-top:1px solid var(--bordo);padding:10px 0}
#stockProducts h3{margin:0;font:600 18px var(--serif)}
#stockProducts form{display:flex;flex-wrap:wrap;gap:8px}
#reportOutput h2,#reportOutput h3{font-family:var(--serif)}
#reportOutput p{color:var(--inchiostro)}
.uscita{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:16px}
.uscita p{margin:0;color:var(--tenue);font-size:15px}
#msg{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);margin:0;padding:12px 18px;border-radius:12px;background:var(--inchiostro);color:#fff;box-shadow:0 8px 24px rgba(27,47,78,.3);white-space:pre-wrap;cursor:pointer;z-index:5}
#msg:empty{display:none}
@media (max-width:560px){.testa{grid-template-columns:auto 1fr}.importo{grid-column:1/-1;text-align:right;margin-top:-6px}.azioni .stato{margin-left:0}.azioni button{flex:1 1 auto}}
@media (prefers-reduced-motion:reduce){#newOrders{animation:none}.cartellino{transform:none}}
</style>
<header class="insegna"><img src="https://ermestre.github.io/pescheriamassimo/img/logo-pescheria-1.webp" alt="Pescheria da Massimo" width="132" height="132"><div class="nastro"><div><h1>Banco ordini</h1><p id="oggiData"></p></div></div></header>
<main>
<form id="login" class="accesso"><h2>Accedi agli ordini</h2><label>Chiave di accesso<input id="key" type="password" autocomplete="current-password" required minlength="20"></label><label class="spunta"><input id="showKey" type="checkbox"> Mostra password</label><label class="spunta"><input id="rememberAccess" type="checkbox"> Ricordami su questo dispositivo</label><button id="loginButton">Accedi</button><p>Se selezioni Ricordami, la chiave viene conservata in questo browser. Chi usa questo browser potrà aprire gli ordini. Esci cancella l'accesso salvato.</p></form>
<section id="panel" hidden>
<div class="comandi"><div class="avvisi"><button id="enableAlerts" type="button">Attiva avvisi</button><p id="alertStatus">Avvisi disattivati. Lascia aperto questo pannello.</p></div><div class="filtri"><label>Mostra<select id="view"><option value="open">Da gestire · tutte le date</option><option value="all">Tutti · anche ritirati e annullati</option></select></label><label>Giorno di ritiro<input id="day" type="date"></label><button id="clearDay" class="secondario">Tutte le date</button><button id="refresh" class="secondario">Aggiorna</button></div></div>
<p id="newOrders" role="alert" hidden></p>
<div class="riepilogo"><p id="scope"></p><div id="summary"></div><p id="totals"></p></div>
<div id="orders"></div>
<section class="strumenti"><h2>Altri strumenti</h2>
<details><summary>Suono degli avvisi</summary><label>Carica MP3 (massimo 5 MB)<input id="alertFile" type="file" accept=".mp3,audio/mpeg"></label><p id="soundName">Suono: doppio bip.</p><button id="resetSound" type="button" class="secondario">Ripristina doppio bip</button><p>Il file resta solo in questo browser. Vengono riprodotti al massimo i primi 10 secondi. Premi Attiva avvisi o Prova suono per ascoltarlo.</p></details>
<details><summary>Disponibilità e vendite al banco</summary><button id="stockLoad" type="button">Aggiorna disponibilità</button><p id="stockMsg" role="status"></p><div id="stockProducts"></div><p>Consiglio: inserisci la quantità che vuoi riservare agli ordini online (es. 5 kg di spigola), così non serve scalare le vendite al banco. Togli il limite quando non serve più. Le quantità sono condivise da tutti i giorni di ritiro. Aggiungi solo il pesce libero da prenotazioni già esistenti. Gli ordini precedenti all’attivazione non vengono scalati. Ogni nuovo ordine prenota subito la quantità; Annullato la restituisce. Ritirato resta scalato. Registra le vendite al banco per mantenere corretto il residuo. I prodotti senza carico restano senza limite.</p></details>
<details><summary>Resoconto giornaliero</summary><label>Giorno del resoconto <input id="reportDay" type="date"></label><button id="reportLoad">Mostra resoconto</button><button id="reportCsv" class="secondario" disabled>Scarica movimenti CSV</button><p id="reportMsg" role="status"></p><div id="reportOutput"></div><p>Incassi e rimborsi per data del pagamento, ora italiana. Ordini e prodotti per data di ritiro. I pagamenti segnati prima di questa funzione non hanno una data e non sono inclusi negli incassi giornalieri. Annullare un ordine non registra un rimborso. Registro interno degli ordini online: non sostituisce scontrini o contabilità.</p></details>
<details id="provaBox" hidden><summary>Prove: azzera tutto</summary><p>Modalità prova accesa. Cancella <b>tutti</b> gli ordini, gli incassi e le quantità, per ricominciare da zero. Si usa solo durante le prove: quando partite sul serio, spegnete la modalità prova dalla gestione e questo tasto sparisce.</p><button id="resetAll" type="button" class="elimina-tutto">Azzera tutto</button><p id="resetMsg" role="status"></p></details>
<div class="uscita"><p id="sessionStatus"></p><button id="logout" class="secondario">Esci</button></div>
</section>
</section>
</main>
<p id="msg" role="status" aria-live="polite" title="Tocca per chiudere"></p>
<script>
let token="",loadSeq=0,alertAudio=null,alertsEnabled=false,polling=false,mutations=0;
const seenOrders=new Set();let ordersBaseline=false,lastRev=null;
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
 fetch("/api/config",{cache:"no-store"}).then(r=>r.json()).then(c=>{$("provaBox").hidden=c?.menu?.modalita_prova!==true;}).catch(()=>{});
 return load().then(checkOrders).finally(()=>{if(generation===authGeneration||!token){loginBusy=false;$("loginButton").disabled=false;}});
}

const $=id=>document.getElementById(id);
$("showKey").onchange=()=>{$("key").type=$("showKey").checked?"text":"password";};
const money=n=>new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n/100);
const states={new:"Nuovo",confirmed:"Confermato",ready:"Pronto",collected:"Ritirato",cancelled:"Annullato"};
$("day").value="";
$("oggiData").textContent=new Date().toLocaleDateString("it-IT",{timeZone:"Europe/Rome",weekday:"long",day:"numeric",month:"long",year:"numeric"});
$("msg").onclick=()=>{$("msg").textContent="";};
const formatDate=date=>new Date(date+"T12:00:00Z").toLocaleDateString("it-IT",{timeZone:"Europe/Rome",weekday:"long",day:"numeric",month:"long",year:"numeric"});
function confirmationUrl(o){
 let phone=String(o.customer_phone||"").replace(/[^0-9+]/g,"");
 if(phone.startsWith("+"))phone=phone.slice(1);else if(phone.startsWith("00"))phone=phone.slice(2);else if(/^3[0-9]{9}$/.test(phone))phone="39"+phone;else return null;
 if(!/^[1-9][0-9]{6,14}$/.test(phone))return null;
 const text="Ciao "+o.customer_name+", il tuo ordine presso Pescheria da Massimo è confermato. Ritiro: "+formatDate(o.pickup_date)+" alle "+o.pickup_time+". Codice ordine: "+shortCode(o.id)+". A presto!";
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
function exit(){$("stockProducts").replaceChildren();$("stockMsg").textContent="";authGeneration++;loginBusy=false;$("loginButton").disabled=false;const cleared=removeSavedAccess();rememberWanted=false;$("rememberAccess").checked=false;ordersBaseline=false;lastRev=null;seenOrders.clear();$("newOrders").hidden=true;document.title="Ordini · Pescheria Massimo";$("reportOutput").replaceChildren();$("reportCsv").disabled=true;reportData=null;loadSeq++;token="";$("key").value="";$("orders").replaceChildren();$("summary").replaceChildren();$("totals").textContent="";$("panel").hidden=true;$("login").hidden=false;return cleared;}
const shortCode=id=>String(id||"").replace(/-/g,"").slice(0,6).toUpperCase();
const romeToday=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Rome"});
const nextDay=d=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);};
const shortDate=d=>new Date(d+"T12:00:00Z").toLocaleDateString("it-IT",{timeZone:"Europe/Rome",weekday:"short",day:"numeric",month:"short"});
const countLabels={new:["nuovo","nuovi"],confirmed:["confermato","confermati"],ready:["pronto","pronti"],collected:["ritirato","ritirati"],cancelled:["annullato","annullati"]};
const nextStep={confirmed:["ready","Segna come pronto"],ready:["collected","Segna come ritirato"]};
const quantityText=item=>{const q=item.quantity??item.qta;let unit=item.unit??item.unita??"";if(q===1&&unit==="porzioni")unit="porzione";return (typeof q==="number"?q.toLocaleString("it-IT"):(q??""))+" "+unit;};
async function load(opts){
 const quiet=opts?.quiet===true;
 const seq=++loadSeq;
 if(!quiet){$("orders").replaceChildren();$("summary").replaceChildren();$("totals").textContent="";$("scope").textContent="";$("msg").textContent="Caricamento…";}
 try{
 const query=new URLSearchParams({view:$("view").value});
 if($("day").value)query.set("date",$("day").value);
 const data=await api("/api/orders?"+query);
 if(seq!==loadSeq || !token)return;
 saveAccess();$("key").value="";
 $("scope").textContent=($("view").value==="open"?"Ordini da gestire":"Tutti gli ordini, anche ritirati e annullati")+($("day").value?", ritiro "+formatDate($("day").value):"");
 $("login").hidden=true;$("panel").hidden=false;
 const active=data.orders.filter(o=>o.status!=="cancelled");
 $("totals").textContent="Da incassare (stima del menu): "+money(active.filter(o=>!o.paid).reduce((s,o)=>s+o.total_cents,0))+". Gli incassi effettivi sono nel resoconto giornaliero.";
 const counts={};for(const o of data.orders)counts[o.status]=(counts[o.status]||0)+1;
 const chips=[];
 for(const value of Object.keys(states))if(counts[value]){const chip=element("span",counts[value]+" "+countLabels[value][counts[value]===1?0:1]);chip.className="conta stato-"+value;chips.push(chip);}
 $("summary").replaceChildren(...chips);
 const today=romeToday(),tomorrow=nextDay(today),cards=[];let lastDay=null;
 for(const o of data.orders){
  if(o.pickup_date!==lastDay){
   lastDay=o.pickup_date;
   const heading=element("h2","");heading.className="giorno"+(o.pickup_date<today?" passato":"");
   heading.append(element("span",o.pickup_date===today?"Oggi":o.pickup_date===tomorrow?"Domani":shortDate(o.pickup_date)),element("small",formatDate(o.pickup_date)));
   cards.push(heading);
  }
  const open=["new","confirmed","ready"].includes(o.status);
  const card=element("article","");card.className="ordine stato-"+o.status;
  const tag=element("div","");tag.className="cartellino";tag.append(element("b",o.pickup_time),element("span",shortDate(o.pickup_date)));
  const who=element("div","");who.className="chi";const pill=element("span",states[o.status]||o.status);pill.className="pill";const short=element("span",shortCode(o.id));short.className="codice-corto";short.title="Codice che il cliente vede nella conferma";who.append(element("h3",o.customer_name),pill,short);
  const price=element("p",money(o.total_cents));price.className="importo";
  const head=element("div","");head.className="testa";head.append(tag,who,price);card.append(head);
  const list=element("ul","");list.className="prodotti";
  for(const item of o.items){
   const li=element("li","");li.append(element("b",quantityText(item)),element("span",item.name??item.nome??item.id??"Prodotto"));
   for(const extra of [item.preparation,item.occasion])if(extra){const t=element("span",extra);t.className="tag";li.append(t);}
   list.append(li);
  }
  card.append(list);
  if(o.notes){const note=element("p","Note: "+o.notes);note.className="note";card.append(note);}
  if(open&&o.pickup_date<today){const late=element("p","Ritiro già passato: segna Ritirato o Annullato.");late.className="ritardo";card.append(late);}
  const paid=element("input","");paid.type="checkbox";paid.checked=!!o.paid;
  paid.hidden=true;card.append(paid);
  const actions=element("div","");actions.className="azioni";
  const select=element("select","");select.setAttribute("aria-label","Stato ordine "+o.id);
  for(const [value,title] of Object.entries(states)){const option=element("option",title);option.value=value;select.append(option);}select.value=o.status;
  async function change(body){mutations++;paid.disabled=select.disabled=true;try{await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify(body)});}catch(e){$("msg").textContent=e.message;paid.checked=!!o.paid;select.value=o.status;paid.disabled=select.disabled=false;return;}finally{mutations--;}await load();}
  select.onchange=()=>change({status:select.value});
  if(["new","confirmed"].includes(o.status)){
   const wa=element("button",o.status==="new"?"Conferma su WhatsApp":"Invia conferma su WhatsApp");wa.type="button";wa.className=o.status==="new"?"wa":"secondario";
   wa.onclick=async()=>{
    const url=confirmationUrl(o);
    if(!url){$("msg").textContent="Numero non valido: verifica il cellulare del cliente.";return;}
    const chat=window.open("about:blank","_blank");if(chat)chat.opener=null;
    wa.disabled=paid.disabled=select.disabled=true;mutations++;
    try{
     await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify({status:"confirmed"})});
     const wasNew=o.status==="new";o.status="confirmed";select.value="confirmed";wa.textContent="Invia di nuovo la conferma";
     card.className="ordine stato-confirmed";pill.textContent=states.confirmed;wa.className="secondario";
     if(wasNew){const step=stepButton("confirmed");if(step)wa.after(step);}
     const link=element("a","Apri il messaggio su WhatsApp");link.href=url;link.target="_blank";link.rel="noopener noreferrer";actions.append(link);
     if(chat)chat.location.replace(url);
     $("msg").textContent="Ordine confermato nel pannello. Premi Invia su WhatsApp per avvisare il cliente. Se la chat non si apre, usa il link sotto l'ordine.";
    }catch(e){if(chat)chat.close();$("msg").textContent=e.message;}
    finally{mutations--;wa.disabled=paid.disabled=select.disabled=false;}
   };
   actions.append(wa);
  }
  const stepButton=current=>{if(!nextStep[current])return null;const [status,label]=nextStep[current];const step=element("button",label);step.type="button";step.className="verso-"+status;step.onclick=()=>{step.disabled=true;change({status});};return step;};
  {const step=stepButton(o.status);if(step)actions.append(step);}
  if(o.status==="cancelled"){
   const del=element("button","Elimina ordine");del.type="button";del.className="elimina";
   del.onclick=async()=>{
    if(!confirm("Eliminare per sempre l'ordine di "+o.customer_name+"? Spariscono anche i suoi incassi e rimborsi dal resoconto. Non si può tornare indietro."))return;
    del.disabled=true;mutations++;
    try{await api("/api/orders/"+encodeURIComponent(o.id),{method:"DELETE"});$("msg").textContent="Ordine di "+o.customer_name+" eliminato.";await load({quiet:true});}
    catch(e){$("msg").textContent=e.message;del.disabled=false;}finally{mutations--;}
   };
   actions.append(del);
  }
  const stateLabel=element("label","Stato");stateLabel.className="stato";stateLabel.append(select);actions.append(stateLabel);
  if(["new","confirmed"].includes(o.status))actions.append(element("small","Il messaggio parte solo quando premi Invia in WhatsApp."));
  card.append(actions);
  const payment=element("div","");payment.className="pagamento";
  payment.append(element("p",o.paid?(o.recorded_balance_cents>0?"Pagato. Incasso registrato: "+money(o.recorded_balance_cents):"Pagato prima del registro: data e importo effettivo non disponibili"):o.status==="cancelled"?"Annullato: nessun incasso da registrare.":"Da incassare. L'importo del menu è indicativo."));
  const paymentForm=element("form","");
  const amount=element("input","");amount.type="number";amount.min="0.01";amount.max="100000";amount.step="0.01";amount.value=(o.total_cents/100).toFixed(2);amount.required=true;amount.setAttribute("aria-label","Importo effettivo in euro");
  const method=element("select","");method.setAttribute("aria-label","Metodo pagamento");for(const [value,text] of [["cash","Contanti"],["card","Carta"]]){const opt=element("option",text);opt.value=value;method.append(opt);}
  const payButton=element("button",o.paid?"Registra rimborso totale":"Registra incasso");
  if(o.paid)payButton.className="secondario";
  if(!o.paid){const amountLabel=element("label","Importo effettivo (€)");amountLabel.append(amount);paymentForm.append(amountLabel);}
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
  if((o.paid&&o.recorded_balance_cents>0)||(!o.paid&&o.status!=="cancelled"))payment.append(paymentForm);
  card.append(payment);
  const foot=element("div","");foot.className="piede";
  const phone=element("a",o.customer_phone);phone.href="tel:"+String(o.customer_phone||"").replace(/[^0-9+]/g,"");phone.setAttribute("aria-label","Chiama "+o.customer_name);
  foot.append(phone,element("small","Codice: "+o.id));card.append(foot);
  cards.push(card);
 }
 if(!data.orders.length){const empty=element("p",($("view").value==="open"?"Nessun ordine da preparare":"Nessun ordine in archivio")+($("day").value?" per questo giorno.":".")+" Il pannello controlla da solo i nuovi ordini ogni 30 secondi.");empty.className="vuoto";cards.push(empty);}
 $("orders").replaceChildren(...cards);
 if(!quiet)$("msg").textContent="";
 }catch(e){if(seq===loadSeq)$("msg").textContent=e.message;}
}



$("stockLoad").onclick=async()=>{
 const generation=authGeneration;$("stockLoad").disabled=true;$("stockMsg").textContent="Caricamento disponibilità…";
 try{
  const data=await api('/api/stock');if(generation!==authGeneration||!token)return;
  $("stockProducts").replaceChildren();
  for(const p of data.products){
   const row=element('article','');row.append(element('h3',p.name),element('p',p.managed?'Disponibile da vendere: '+p.available+' '+p.unit+' · Prenotato da preparare: '+p.reserved+' '+p.unit:'Quantità senza limite: nessun carico registrato.'));
   const form=element('form',''),qty=element('input','');qty.type='number';qty.min=p.unit==='kg'?'0.001':'1';qty.step=p.unit==='kg'?'0.001':'1';qty.required=true;qty.setAttribute('aria-label','Quantità in '+p.unit);qty.placeholder='Quantità in '+p.unit;
   const kind=element('select','');for(const [value,label] of [['arrival','Aggiungi quantità disponibile'],['counter','Scala vendita al banco']]){const opt=element('option',label);opt.value=value;kind.append(opt);}
   const button=element('button','Registra movimento');form.append(qty,kind,button);let id='',signature='';
   form.onsubmit=async e=>{
    e.preventDefault();const units=Math.round(Number(qty.value)*1000);const next=p.id+':'+kind.value+':'+units;if(next!==signature){id=crypto.randomUUID();signature=next;}
    if(!confirm((kind.value==='arrival'?'Aggiungere ':'Scalare ')+qty.value+' '+p.unit+' per '+p.name+'?'))return;
    mutations++;button.disabled=true;
    try{await api('/api/stock',{method:'POST',body:JSON.stringify({id,product_id:p.id,units,kind:kind.value})});await $("stockLoad").onclick();}catch(e){$("stockMsg").textContent=e.message;button.disabled=false;}finally{mutations--;}
   };row.append(form);
   if(p.managed){const free=element('button','Togli il limite');free.type='button';free.className='secondario';free.onclick=async()=>{if(!confirm('Togliere il limite a '+p.name+'? Torna ordinabile senza quantità massima. Gli ordini già ricevuti restano.'))return;mutations++;free.disabled=true;try{await api('/api/stock',{method:'POST',body:JSON.stringify({product_id:p.id,kind:'unlimited'})});await $("stockLoad").onclick();}catch(e){$("stockMsg").textContent=e.message;free.disabled=false;}finally{mutations--;}};row.append(free);}
   $("stockProducts").append(row);
  }
  $("stockMsg").textContent="Disponibilità aggiornate. Le quantità già prenotate sono escluse dal disponibile.";
 }catch(e){$("stockMsg").textContent=e.message;}finally{$("stockLoad").disabled=false;}
};
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
  // Controllo leggero: legge un solo numero che cambia a ogni nuovo ordine, stato o incasso.
  const change=await api("/api/changes");
  if(token!==activeToken)return;
  if(lastRev!==null&&change.rev===lastRev)return;
  const result=await api("/api/orders?view=open");
  if(token!==activeToken)return;
  const fresh=newOrderIds(result.orders);
  if(fresh.length){
   const banner=$("newOrders");banner.hidden=false;
   banner.textContent=fresh.length+" nuovi ordini ricevuti: "+fresh.map(o=>o.customer_name).join(", ")+".";
   document.title="Nuovo ordine · Pescheria Massimo";soundAlert();
  }
  if(!mutations&&!["INPUT","SELECT"].includes(document.activeElement?.tagName)&&!document.querySelector('form[data-dirty="true"]')){await load({quiet:true});if(token===activeToken)lastRev=change.rev;}
 }catch(e){if(token===activeToken)$("alertStatus").textContent="Controllo automatico non riuscito. Riprovo tra 30 secondi. Puoi premere Aggiorna.";}
 finally{polling=false;}
}
setInterval(checkOrders,30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkOrders();});

$("resetAll").onclick=async()=>{
 const parola=prompt("Per cancellare TUTTI gli ordini, gli incassi e le quantità scrivi AZZERA");
 if(parola===null)return;if(parola.trim().toUpperCase()!=="AZZERA"){$("resetMsg").textContent="Niente cancellato: la parola non era AZZERA.";return;}
 $("resetAll").disabled=true;mutations++;
 try{const r=await api("/api/reset",{method:"POST",body:JSON.stringify({conferma:"AZZERA"})});seenOrders.clear();ordersBaseline=false;lastRev=null;$("newOrders").hidden=true;$("stockProducts").replaceChildren();$("reportOutput").replaceChildren();$("resetMsg").textContent="Fatto: "+r.ordini+" ordini cancellati. Si riparte da zero.";await load();}
 catch(e){$("resetMsg").textContent=e.message;}finally{mutations--;$("resetAll").disabled=false;}
};
$("login").onsubmit=e=>{e.preventDefault();startLogin($("key").value,$("rememberAccess").checked);};
$("refresh").onclick=load;$("day").onchange=load;$("view").onchange=load;$("clearDay").onclick=()=>{$("day").value="";load();};$("logout").onclick=()=>{const cleared=exit();$("msg").textContent=cleared?"Accesso chiuso e chiave salvata rimossa da questo browser.":"Accesso chiuso. Il browser non consente di cancellare la chiave salvata: cancella i dati di questo sito nelle impostazioni del browser.";};
try{
 const saved=localStorage.getItem(ACCESS_KEY);
 if(saved&&saved.length>=20&&saved.length<=500){$("rememberAccess").checked=true;startLogin(saved,true);}
 else if(saved)removeSavedAccess();
}catch(e){}
</script></html>`;
