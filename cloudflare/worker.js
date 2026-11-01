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
function pickupDays(menu,now){
 const today=rome(now).date;
 return Array.from({length:14},(_,i)=>addDays(today,i)).filter(d=>new Date(d+'T12:00:00Z').getUTCDay()!==1 && !(menu.ritiro?.chiusure||[]).includes(d));
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
  if(category.periodo && (!category.periodo.dal || !category.periodo.al || current.date<category.periodo.dal || current.date>category.periodo.al))fail('Prodotto fuori periodo',409);
  const allowed=v.preparazioni||[];if(item.preparation && !allowed.includes(item.preparation))fail('Preparazione non disponibile per '+v.nome);
  if(allowed.length && !item.preparation)fail('Scegli la preparazione per '+v.nome);
  const step=v.unita==='kg'?.5:1;
  if(Math.abs(item.quantity/step-Math.round(item.quantity/step))>1e-8)fail('Quantità non valida per '+v.nome);
  if(typeof v.prezzo!=='number'||!Number.isFinite(v.prezzo)||v.prezzo<0)fail('Prezzo da verificare',503);
  const limit=deadline(v.ordini_entro||category.ordini_entro||menu.ritiro?.ordini_entro,order.pickup_date);
  if(limit && (current.date>limit.date || (current.date===limit.date && current.time>limit.time)))fail('Termine ordini superato per '+v.nome+'. Scegli un altro giorno.');
  evening ||= !!v.su_ordinazione;
  const unit_price_cents=Math.round(v.prezzo*100),line_total_cents=Math.round(unit_price_cents*item.quantity);
  total+=line_total_cents;
  return {...item,name:v.nome,unit:v.unita||'porzioni',unit_price_cents,line_total_cents};
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
   const menu=await readMenu();return respond({ok:true,menu,preparations_supported:true,days:pickupDays(menu,new Date())});
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
   if(url.pathname==="/api/orders" && request.method==="GET"){
    const date=url.searchParams.get("date");
    if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+"T12:00:00Z")) || new Date(date+"T12:00:00Z").toISOString().slice(0,10)!==date)) return json({errore:"Data non valida"},400);
    const view=url.searchParams.get("view")||"all";
    if(!["all","open"].includes(view))return json({errore:"Vista non valida"},400);
    const conditions=[],params=[];
    if(date){conditions.push("pickup_date = ?");params.push(date);}
    if(view==="open")conditions.push("status IN ('new','confirmed','ready')");
    let statement=env.db.prepare("SELECT * FROM orders"+(conditions.length?" WHERE "+conditions.join(" AND "):"")+" ORDER BY pickup_date, pickup_time, created_at, id LIMIT 501");
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
     if(typeof body.paid!=="boolean")return json({errore:"Valore non valido"},400);
     query="UPDATE orders SET paid = ? WHERE id = ?";value=body.paid?1:0;
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
<form id="login"><label>Chiave di accesso<input id="key" type="password" autocomplete="current-password" required minlength="20"></label><label><input id="showKey" type="checkbox"> Mostra password</label><button>Accedi</button><p>La chiave resta in memoria fino alla chiusura o all’aggiornamento della pagina.</p></form>
<section id="panel" hidden><div class="bar"><label>Mostra <select id="view"><option value="open">Da gestire · tutte le date</option><option value="all">Tutti · anche ritirati e annullati</option></select></label><label>Data ritiro (facoltativa) <input id="day" type="date"></label><button id="clearDay">Tutte le date</button><button id="refresh">Aggiorna</button><button id="logout">Esci</button></div><p id="scope"></p><p id="totals"></p><div id="orders"></div></section>
<p id="msg" role="status" aria-live="polite"></p>
<script>
let token="",loadSeq=0;
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
 const response=await fetch(path,{...options,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},cache:"no-store"});
 const data=await response.json();
 if(!response.ok){if(response.status===401)exit();throw new Error(data.errore||"Operazione non riuscita");}
 return data;
}
function exit(){loadSeq++;token="";$("key").value="";$("orders").replaceChildren();$("totals").textContent="";$("panel").hidden=true;$("login").hidden=false;}
async function load(){
 const seq=++loadSeq;
 $("orders").replaceChildren();$("totals").textContent="";$("scope").textContent="";
 $("msg").textContent="Caricamento…";
 try{
 const query=new URLSearchParams({view:$("view").value});
 if($("day").value)query.set("date",$("day").value);
 const data=await api("/api/orders?"+query);
 if(seq!==loadSeq || !token)return;
 $("scope").textContent=($("view").value==="open"?"Ordini da gestire: nuovi, confermati e pronti":"Archivio: tutti gli stati")+($("day").value?" · Ritiro "+formatDate($("day").value):" · Tutte le date di ritiro");
 $("login").hidden=true;$("panel").hidden=false;$("orders").replaceChildren();
 const active=data.orders.filter(o=>o.status!=="cancelled");
 $("totals").textContent=active.length+" ordini · Incassato "+money(active.filter(o=>o.paid).reduce((s,o)=>s+o.total_cents,0))+" · Da incassare "+money(active.filter(o=>!o.paid).reduce((s,o)=>s+o.total_cents,0));
 for(const o of data.orders){
  const card=element("article","");
  card.append(element("h2",o.customer_name+" · "+money(o.total_cents)),element("small","Codice: "+o.id),element("p","Ritiro: "+formatDate(o.pickup_date)+" alle "+o.pickup_time),element("p","Cellulare: "+o.customer_phone));
  if(o.notes)card.append(element("p","Note: "+o.notes));
  const list=element("ul","");
  for(const item of o.items)list.append(element("li",(item.quantity??item.qta??"")+" "+(item.unit??item.unita??"")+" · "+(item.name??item.nome??item.id??"Prodotto")+(item.preparation?" · "+item.preparation:"")));
  card.append(list);
  const paid=element("input","");paid.type="checkbox";paid.checked=!!o.paid;
  const label=element("label","");label.append(paid,document.createTextNode(" Pagato"));card.append(label);
  const select=element("select","");select.setAttribute("aria-label","Stato ordine "+o.id);
  for(const [value,title] of Object.entries(states)){const option=element("option",title);option.value=value;select.append(option);}select.value=o.status;card.append(select);
  async function change(body){paid.disabled=select.disabled=true;try{await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify(body)});}catch(e){$("msg").textContent=e.message;paid.checked=!!o.paid;select.value=o.status;paid.disabled=select.disabled=false;return;}await load();}
  paid.onchange=()=>change({paid:paid.checked});select.onchange=()=>change({status:select.value});
  if(["new","confirmed"].includes(o.status)){
   const wa=element("button",o.status==="new"?"Conferma su WhatsApp":"Invia conferma su WhatsApp");wa.type="button";
   wa.onclick=async()=>{
    const url=confirmationUrl(o);
    if(!url){$("msg").textContent="Numero non valido: verifica il cellulare del cliente.";return;}
    const chat=window.open("about:blank","_blank");if(chat)chat.opener=null;
    wa.disabled=paid.disabled=select.disabled=true;
    try{
     await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify({status:"confirmed"})});
     o.status="confirmed";select.value="confirmed";wa.textContent="Invia di nuovo la conferma";
     const link=element("a","Apri il messaggio su WhatsApp");link.href=url;link.target="_blank";link.rel="noopener noreferrer";card.append(link);
     if(chat)chat.location.replace(url);
     $("msg").textContent="Ordine confermato nel pannello. Premi Invia su WhatsApp per avvisare il cliente. Se la chat non si apre, usa il link sotto l'ordine.";
    }catch(e){if(chat)chat.close();$("msg").textContent=e.message;}
    finally{wa.disabled=paid.disabled=select.disabled=false;}
   };
   card.append(wa,element("small","Il messaggio parte solo quando premi Invia in WhatsApp."));
  }
  $("orders").append(card);
 }
 $("msg").textContent=data.orders.length?"Aggiornato. Premi Aggiorna per cercare nuovi ordini.":($("view").value==="open"?"Nessun ordine da gestire":"Nessun ordine in archivio")+($("day").value?" per questa data.":".");
 }catch(e){if(seq===loadSeq)$("msg").textContent=e.message;}
}
$("login").onsubmit=e=>{e.preventDefault();token=$("key").value;$("key").value="";$("view").value="open";$("day").value="";load();};
$("refresh").onclick=load;$("day").onchange=load;$("view").onchange=load;$("clearDay").onclick=()=>{$("day").value="";load();};$("logout").onclick=()=>{exit();$("msg").textContent="Accesso chiuso";};
</script></html>`;
