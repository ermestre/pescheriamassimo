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
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) return json({errore:"Data non valida"},400);
    const result=await env.db.prepare("SELECT * FROM orders WHERE pickup_date = ? ORDER BY pickup_time, created_at LIMIT 501").bind(date).all();
    if(result.results.length>500) return json({errore:"Troppi ordini per questa vista. Occorre aggiungere la paginazione."},409);
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
<style>body{font:17px system-ui;margin:auto;padding:20px;max-width:850px;background:#f1f5f7;color:#17313b}input,button,select{font:inherit;padding:12px;border:1px solid #a9bbc1;border-radius:8px;margin:4px 0;max-width:100%;box-sizing:border-box}button{background:#075e71;color:white;cursor:pointer}button:disabled{opacity:.6}article{background:white;padding:18px;margin:16px 0;border-radius:12px}h1{font-size:26px}h2{font-size:21px}p{overflow-wrap:anywhere}#msg{white-space:pre-wrap}small{overflow-wrap:anywhere}.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}label{display:block;margin:10px 0}input[type=password]{width:100%}</style>
<h1>Ordini · Pescheria Massimo</h1>
<form id="login"><label>Chiave di accesso<input id="key" type="password" autocomplete="current-password" required></label><button>Accedi</button><p>La chiave resta in memoria fino alla chiusura o all’aggiornamento della pagina.</p></form>
<section id="panel" hidden><div class="bar"><label>Data ritiro <input id="day" type="date"></label><button id="refresh">Aggiorna</button><button id="logout">Esci</button></div><p id="totals"></p><div id="orders"></div></section>
<p id="msg" role="status" aria-live="polite"></p>
<script>
let token="";
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n/100);
const states={new:"Nuovo",confirmed:"Confermato",ready:"Pronto",collected:"Ritirato",cancelled:"Annullato"};
$("day").value=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Rome"}).format(new Date());
function element(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
async function api(path,options={}){
 const response=await fetch(path,{...options,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},cache:"no-store"});
 const data=await response.json();
 if(!response.ok){if(response.status===401)exit();throw new Error(data.errore||"Operazione non riuscita");}
 return data;
}
function exit(){token="";$("key").value="";$("orders").replaceChildren();$("totals").textContent="";$("panel").hidden=true;$("login").hidden=false;}
async function load(){
 $("msg").textContent="Caricamento…";
 try{
 const data=await api("/api/orders?date="+encodeURIComponent($("day").value));
 $("login").hidden=true;$("panel").hidden=false;$("orders").replaceChildren();
 const active=data.orders.filter(o=>o.status!=="cancelled");
 $("totals").textContent=active.length+" ordini · Incassato "+money(active.filter(o=>o.paid).reduce((s,o)=>s+o.total_cents,0))+" · Da incassare "+money(active.filter(o=>!o.paid).reduce((s,o)=>s+o.total_cents,0));
 for(const o of data.orders){
  const card=element("article","");
  card.append(element("h2",o.customer_name+" · "+money(o.total_cents)),element("small","Codice: "+o.id),element("p","Ritiro: "+o.pickup_date+" alle "+o.pickup_time),element("p","Cellulare: "+o.customer_phone));
  if(o.notes)card.append(element("p","Note: "+o.notes));
  const list=element("ul","");
  for(const item of o.items)list.append(element("li",(item.quantity??item.qta??"")+" "+(item.unit??item.unita??"")+" · "+(item.name??item.nome??item.id??"Prodotto")));
  card.append(list);
  const paid=element("input","");paid.type="checkbox";paid.checked=!!o.paid;
  const label=element("label","");label.append(paid,document.createTextNode(" Pagato"));card.append(label);
  const select=element("select","");select.setAttribute("aria-label","Stato ordine "+o.id);
  for(const [value,title] of Object.entries(states)){const option=element("option",title);option.value=value;select.append(option);}select.value=o.status;card.append(select);
  async function change(body){paid.disabled=select.disabled=true;try{await api("/api/orders/"+encodeURIComponent(o.id),{method:"PATCH",body:JSON.stringify(body)});}catch(e){$("msg").textContent=e.message;paid.checked=!!o.paid;select.value=o.status;paid.disabled=select.disabled=false;return;}await load();}
  paid.onchange=()=>change({paid:paid.checked});select.onchange=()=>change({status:select.value});
  $("orders").append(card);
 }
 $("msg").textContent=data.orders.length?"Aggiornato. Premi Aggiorna per cercare nuovi ordini.":"Nessun ordine per questa data. Il sito clienti deve ancora essere collegato.";
 }catch(e){$("msg").textContent=e.message;}
}
$("login").onsubmit=e=>{e.preventDefault();token=$("key").value;$("key").value="";load();};
$("refresh").onclick=load;$("day").onchange=load;$("logout").onclick=()=>{exit();$("msg").textContent="Accesso chiuso";};
</script></html>`;
