import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('../',import.meta.url);
const code=fs.readFileSync(new URL('cloudflare/worker.js',root),'utf8');
const {default:worker,priceOrder,basicOrder}=await import('data:text/javascript;base64,'+Buffer.from(code+'\nexport {priceOrder,basicOrder};').toString('base64'));
const menu=JSON.parse(fs.readFileSync(new URL('menu.json',root),'utf8'));
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),customer_name TEXT,customer_phone TEXT,pickup_date TEXT,pickup_time TEXT,notes TEXT,items_json TEXT,total_cents INTEGER,status TEXT DEFAULT 'new',paid INTEGER DEFAULT 0)`);
const db={prepare(sql){const stmt=sqlite.prepare(sql);function binding(args=[]){return {bind(...v){return binding(v)},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}}}return binding()}};
db.batch=async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
const env={db,ADMIN_TOKEN:'random-test-only-secret-123456789'};
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify(menu));
function request(path,body,extra={}){return new Request('https://worker.test'+path,{method:body?'POST':'GET',...extra,headers:{Origin:'https://ermestre.github.io','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...extra.headers},...(body?{body:JSON.stringify(body)}:{})});}
const now=new Date();const day=new Date(now.getTime()+3*86400000).toISOString().slice(0,10);
const config=await (await worker.fetch(request('/api/config'),env)).json();
const future=config.days.find(d=>d>day);
const input={id:crypto.randomUUID(),customer_name:'Prova <script>',customer_phone:'3331234567',pickup_date:future,pickup_time:'18:30',notes:'Pulire',items:[{id:'spigola',quantity:1,preparation:'Intero'}],expected_total_cents:2400,website:''};
let r=await worker.fetch(request('/api/submit',input),env);assert.equal(r.status,201);assert.equal((await r.json()).total_cents,2400);
r=await worker.fetch(request('/api/submit',input),env);assert.equal(r.status,200);assert.equal((await r.json()).already_received,true);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);
const changed={...input,customer_name:'Altra persona'};
assert.equal((await worker.fetch(request('/api/submit',changed),env)).status,409);
assert.equal((await worker.fetch(request('/api/submit',{...input,id:crypto.randomUUID(),expected_total_cents:1}),env)).status,409);
assert.equal((await worker.fetch(request('/api/submit',input,{headers:{Origin:'https://evil.test'}}),env)).status,403);
assert.equal((await worker.fetch(request('/api/orders?date='+future),env)).status,401);
const headers={Authorization:'Bearer '+env.ADMIN_TOKEN};
r=await worker.fetch(request('/api/orders?date='+future,null,{headers}),env);assert.equal(r.status,200);const saved=(await r.json()).orders[0];assert.equal(saved.items[0].unit_price_cents,2400);assert.equal(saved.items[0].preparation,'Intero');
assert.equal((await worker.fetch(request('/api/submit',{...input,items:[{...input.items[0],preparation:'Pulito'}]}),env)).status,409);
assert.equal((await worker.fetch(request('/api/submit',{...input,id:crypto.randomUUID(),items:[{...input.items[0],preparation:'Non autorizzato'}]}),env)).status,400);
menu.categorie[1].voci[0].prezzo=30;
r=await worker.fetch(request('/api/submit',input),env);assert.equal(r.status,200);assert.equal((await r.json()).total_cents,2400);
assert.equal((await worker.fetch(request('/api/submit',{...input,id:crypto.randomUUID()}),env)).status,409);
assert.throws(()=>basicOrder({...input,items:[{id:'spigola',quantity:0}]}));
assert.throws(()=>priceOrder(basicOrder({...input,items:[{id:'spigola',quantity:.25}]}),menu));
assert.throws(()=>priceOrder(basicOrder({...input,pickup_date:'2026-01-01'}),menu));
menu.categorie[1].voci[0].stato='esaurito';
assert.throws(()=>priceOrder(basicOrder(input),menu));
// Each enabled preparation reaches the central database exactly as selected.
menu.categorie[1].voci[0].stato='disponibile';menu.categorie[1].voci[0].prezzo=24;
sqlite.exec('DELETE FROM order_limits');
for(const preparation of ['Intero','Pulito','Sfilettato']){
 const body={...input,id:crypto.randomUUID(),items:[{id:'spigola',quantity:1,preparation}]};
 const response=await worker.fetch(request('/api/submit',body),env);assert.equal(response.status,201);
 const row=sqlite.prepare('SELECT items_json FROM orders WHERE id=?').get(body.id);assert.equal(JSON.parse(row.items_json)[0].preparation,preparation);
 sqlite.prepare('DELETE FROM orders WHERE id=?').run(body.id);
}

// Open inbox across dates, optional day filter and terminal-state archive.
const insert=sqlite.prepare("INSERT INTO orders(id,customer_name,customer_phone,pickup_date,pickup_time,notes,items_json,total_cents,status) VALUES (?, 'Inbox test', '3331234567', ?, '09:00', '', '[]', 100, ?)");
for(const [id,date,status] of [['earlier','2025-01-01','new'],['later','2028-01-01','confirmed'],['ready','2028-01-02','ready'],['collected','2028-01-01','collected'],['cancelled','2028-01-01','cancelled']])insert.run(id,date,status);
const inbox=async path=>{const result=await worker.fetch(request(path,null,{headers}),env);assert.equal(result.status,200);return (await result.json()).orders;};
const open=await inbox('/api/orders?view=open');assert.equal(open.length,4);assert.equal(open[0].id,'earlier');assert.equal(open.at(-1).id,'ready');
assert.equal((await inbox('/api/orders?view=all')).length,6);
assert.deepEqual((await inbox('/api/orders?view=open&date=2028-01-01')).map(o=>o.id),['later']);
assert.equal((await inbox('/api/orders?view=all&date=2028-01-01')).length,3);
assert.equal((await worker.fetch(request('/api/orders?date=2026-02-31',null,{headers}),env)).status,400);
assert.equal((await worker.fetch(request('/api/orders?view=invalid',null,{headers}),env)).status,400);
assert.equal((await worker.fetch(request('/api/orders?view=open'),env)).status,401);
assert.equal((await worker.fetch(request('/api/orders/later',{status:'collected'},{method:'PATCH',headers}),env)).status,200);
assert.equal((await inbox('/api/orders?view=open&date=2028-01-01')).length,0);
sqlite.exec("DELETE FROM orders WHERE id IN ('earlier','later','ready','collected','cancelled')");

// Atomic rate limit eventually refuses repeated attempts; no extra orders created.
let limited=false;for(let i=0;i<12;i++){r=await worker.fetch(request('/api/submit',input),env);if(r.status===429)limited=true;}assert.equal(limited,true);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);
const preflight=await worker.fetch(new Request('https://worker.test/api/submit',{method:'OPTIONS',headers:{Origin:'https://ermestre.github.io'}}),env);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://ermestre.github.io');
assert.equal((await worker.fetch(request('/api/config'),{db})).status,503);
new Function(code.match(/<script>([\s\S]*?)<\/script>/)[1]);

// Exercise the actual customer click handler through the Worker, including a lost response.
sqlite.exec('DELETE FROM order_limits');menu.categorie[1].voci[0].stato='disponibile';menu.categorie[1].voci[0].prezzo=24;
const nodes=new Map(),memory=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{},hidden:false,disabled:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn},classList:{add(){},remove(){}},replaceChildren(){},append(){}});return nodes.get(id);}
let lose=true;
const context=vm.createContext({console,Date,Intl,JSON,Math,Number,String,Object,Array,Map,crypto,AbortSignal,TextEncoder,document:{getElementById:node,querySelectorAll:()=>[]},navigator:{},sessionStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},fetch:async(url,opt)=>{
 if(url==='menu.json')return new Promise(()=>{});
 const req=new Request(url,{...opt,headers:{...opt?.headers,Origin:'https://ermestre.github.io','CF-Connecting-IP':'192.0.2.20'}});
 const result=await worker.fetch(req,env);
 if(url.endsWith('/api/submit')&&lose){lose=false;throw new TypeError('Lost response');}return result;
}});
const html=fs.readFileSync(new URL('index.html',root),'utf8');vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
vm.runInContext('menu='+JSON.stringify(menu)+';apiPronta=true;supportaPreparazioni=true;cambia("spigola",1)',context);
node('nome').value='Test UI';node('cellulare').value='3331234567';node('giorno').value=future;node('ora').value='18:30';
const before=sqlite.prepare('SELECT count(*) n FROM orders').get().n;
await node('inviaOrdine').listeners.click();assert.match(node('invioStato').textContent,/stesso codice/);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,before+1);
await node('inviaOrdine').listeners.click();assert.match(node('invioStato').textContent,/Ordine ricevuto/);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,before+1);
assert.equal(node('nuovoOrdine').hidden,false);

// Payment ledger: actual amounts, idempotency, refunds, legacy paid orders and Rome dates.
const pay=async body=>worker.fetch(request('/api/payments',body,{headers}),env);
const receipt={id:crypto.randomUUID(),order_id:input.id,kind:'payment',amount_cents:2350,method:'card'};
assert.equal((await pay(receipt)).status,200);
assert.equal((await pay(receipt)).status,200);
assert.equal(sqlite.prepare('SELECT count(*) n FROM payment_events').get().n,1);
assert.equal(sqlite.prepare('SELECT paid FROM orders WHERE id=?').get(input.id).paid,1);
assert.equal((await pay({...receipt,amount_cents:1})).status,409);
assert.equal((await pay({...receipt,id:crypto.randomUUID()})).status,409);
const actualPage=await (await worker.fetch(request('/'),env)).text();
const dashboard=actualPage.match(/<script>([\s\S]*?)<\/script>/)[1];new Function(dashboard);
const dayRome=sqlite.prepare('SELECT business_date FROM payment_events').get().business_date;
let report=await (await worker.fetch(request('/api/report?date='+dayRome,null,{headers}),env)).json();
assert.equal(report.summary.receipts_cents,2350);assert.equal(report.summary.card_cents,2350);assert.equal(report.summary.cash_cents,0);
assert.equal(report.movements.length,1);
assert.equal((await worker.fetch(request('/api/report?date=2026-02-31',null,{headers}),env)).status,400);
assert.equal((await worker.fetch(request('/api/report'),env)).status,401);
const refund={id:crypto.randomUUID(),order_id:input.id,kind:'refund',method:'cash'};
assert.equal((await pay(refund)).status,200);assert.equal((await pay(refund)).status,200);
assert.equal(sqlite.prepare('SELECT paid FROM orders WHERE id=?').get(input.id).paid,0);
report=await (await worker.fetch(request('/api/report?date='+dayRome,null,{headers}),env)).json();
assert.equal(report.summary.refunds_cents,2350);assert.equal(report.summary.net_cents,0);assert.equal(report.summary.cash_cents,-2350);
assert.equal((await pay({...refund,id:crypto.randomUUID()})).status,409);
assert.equal((await pay({...receipt,id:crypto.randomUUID(),amount_cents:0})).status,400);
assert.equal((await pay({...receipt,id:crypto.randomUUID(),method:'unknown'})).status,400);
sqlite.prepare('UPDATE orders SET paid=1 WHERE id=?').run(input.id);
assert.equal((await pay({...refund,id:crypto.randomUUID()})).status,409);
assert.equal((await worker.fetch(request('/api/orders/'+input.id,{paid:false},{method:'PATCH',headers}),env)).status,400);
const rome= new Function(code.slice(code.indexOf('function romeDay('),code.indexOf('const PAYMENT_SCHEMA'))+';return romeDay;')();
assert.equal(rome(new Date('2026-10-31T23:30:00Z')),'2026-11-01');
const cell=new Function(dashboard.slice(dashboard.indexOf('function csvCell('),dashboard.indexOf('$("reportCsv").onclick='))+';return csvCell;')();
assert.equal(cell('=SUM(1)'), '"\'=SUM(1)"');assert.equal(cell('A"B'),'"A""B"');
console.log('OK: incassi, importi effettivi, retry, rimborsi, storico, autorizzazione, fuso Roma, CSV e script HTML servito');

globalThis.fetch=oldFetch;sqlite.close();console.log('OK: SQLite reale in memoria; invio, duplicati, conflitti, prezzi storici, autorizzazione, origine, validazione, limiti e configurazione.');
