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
const env={db,ADMIN_TOKEN:'random-test-only-secret-123456789'};
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify(menu));
function request(path,body,extra={}){return new Request('https://worker.test'+path,{method:body?'POST':'GET',...extra,headers:{Origin:'https://ermestre.github.io','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...extra.headers},...(body?{body:JSON.stringify(body)}:{})});}
const now=new Date();const day=new Date(now.getTime()+3*86400000).toISOString().slice(0,10);
const config=await (await worker.fetch(request('/api/config'),env)).json();
const future=config.days.find(d=>d>day);
const input={id:crypto.randomUUID(),customer_name:'Prova <script>',customer_phone:'3331234567',pickup_date:future,pickup_time:'18:30',notes:'Pulire',items:[{id:'spigola-orata',quantity:1}],expected_total_cents:2400,website:''};
let r=await worker.fetch(request('/api/submit',input),env);assert.equal(r.status,201);assert.equal((await r.json()).total_cents,2400);
r=await worker.fetch(request('/api/submit',input),env);assert.equal(r.status,200);assert.equal((await r.json()).already_received,true);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,1);
const changed={...input,customer_name:'Altra persona'};
assert.equal((await worker.fetch(request('/api/submit',changed),env)).status,409);
assert.equal((await worker.fetch(request('/api/submit',{...input,id:crypto.randomUUID(),expected_total_cents:1}),env)).status,409);
assert.equal((await worker.fetch(request('/api/submit',input,{headers:{Origin:'https://evil.test'}}),env)).status,403);
assert.equal((await worker.fetch(request('/api/orders?date='+future),env)).status,401);
const headers={Authorization:'Bearer '+env.ADMIN_TOKEN};
r=await worker.fetch(request('/api/orders?date='+future,null,{headers}),env);assert.equal(r.status,200);const saved=(await r.json()).orders[0];assert.equal(saved.items[0].unit_price_cents,2400);
menu.categorie[1].voci[0].prezzo=30;
r=await worker.fetch(request('/api/submit',input),env);assert.equal(r.status,200);assert.equal((await r.json()).total_cents,2400);
assert.equal((await worker.fetch(request('/api/submit',{...input,id:crypto.randomUUID()}),env)).status,409);
assert.throws(()=>basicOrder({...input,items:[{id:'spigola-orata',quantity:0}]}));
assert.throws(()=>priceOrder(basicOrder({...input,items:[{id:'spigola-orata',quantity:.25}]}),menu));
assert.throws(()=>priceOrder(basicOrder({...input,pickup_date:'2026-01-01'}),menu));
menu.categorie[1].voci[0].stato='esaurito';
assert.throws(()=>priceOrder(basicOrder(input),menu));
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
vm.runInContext('menu='+JSON.stringify(menu)+';apiPronta=true;cambia("spigola-orata",1)',context);
node('nome').value='Test UI';node('cellulare').value='3331234567';node('giorno').value=future;node('ora').value='18:30';
const before=sqlite.prepare('SELECT count(*) n FROM orders').get().n;
await node('inviaOrdine').listeners.click();assert.match(node('invioStato').textContent,/stesso codice/);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,before+1);
await node('inviaOrdine').listeners.click();assert.match(node('invioStato').textContent,/Ordine ricevuto/);
assert.equal(sqlite.prepare('SELECT count(*) n FROM orders').get().n,before+1);
assert.equal(node('nuovoOrdine').hidden,false);
globalThis.fetch=oldFetch;sqlite.close();console.log('OK: SQLite reale in memoria; invio, duplicati, conflitti, prezzi storici, autorizzazione, origine, validazione, limiti e configurazione.');
