// Consumo D1 del pannello: schema creato una sola volta, controllo ogni 30 s leggero,
// ordini aperti letti tramite indice e numero di revisione che cambia a ogni modifica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('../',import.meta.url);
const code=fs.readFileSync(new URL('cloudflare/worker.js',root),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const menu=JSON.parse(fs.readFileSync(new URL('menu.json',root),'utf8'));
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),customer_name TEXT,customer_phone TEXT,pickup_date TEXT,pickup_time TEXT,notes TEXT,items_json TEXT,total_cents INTEGER,status TEXT DEFAULT 'new',paid INTEGER DEFAULT 0)`);
// 600 ordini già chiusi e 3 aperti: situazione tipica dopo qualche mese.
const ins=sqlite.prepare('INSERT INTO orders(id,customer_name,customer_phone,pickup_date,pickup_time,notes,items_json,total_cents,status) VALUES (?,?,?,?,?,?,?,?,?)');
for(let i=0;i<600;i++)ins.run('old-'+i,'C','3330000000','2026-10-01','10:00','','[]',1000,i%10?'collected':'cancelled');
for(let i=0;i<3;i++)ins.run('open-'+i,'C','3330000000','2026-12-20','10:00','','[]',1000,'new');
const statements=[];
const db={prepare(sql){statements.push(sql);const stmt=sqlite.prepare(sql);function binding(args=[]){return {bind(...v){return binding(v)},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}}}return binding()}};
db.batch=async list=>{sqlite.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
const env={db,ADMIN_TOKEN:'random-test-only-secret-123456789'};
globalThis.fetch=async()=>new Response(JSON.stringify(menu));
const auth={Authorization:'Bearer '+env.ADMIN_TOKEN};
const get=async path=>{const r=await worker.fetch(new Request('https://worker.test'+path,{headers:auth}),env);assert.equal(r.status,200,path);return r.json();};
const ddl=list=>list.filter(s=>/^\s*CREATE/i.test(s)).length;

// Prima richiesta dopo la distribuzione: crea tabelle, indici e trigger una volta.
let rev=(await get('/api/changes')).rev;
assert.ok(ddl(statements)>0,'la prima richiesta prepara il database');
// Richieste successive: nessuna istruzione CREATE, una sola lettura di controllo.
statements.length=0;
const again=(await get('/api/changes')).rev;
assert.equal(again,rev);
assert.equal(ddl(statements),0,'nessuna creazione ripetuta');
assert.equal(statements.length,2,'controllo schema + numero di revisione');

// Gli ordini aperti si leggono con l'indice, non scorrendo tutto l'archivio.
const plan=sqlite.prepare("EXPLAIN QUERY PLAN SELECT orders.* FROM orders WHERE status IN ('new','confirmed','ready') ORDER BY pickup_date, pickup_time, created_at, id").all().map(r=>r.detail).join(' | ');
assert.match(plan,/orders_status_pickup/,'indice usato: '+plan);
assert.doesNotMatch(plan,/SCAN orders(?! USING)/,'nessuna scansione completa: '+plan);
assert.equal((await get('/api/orders?view=open')).orders.length,3);

// La revisione cambia con stato, nuovi ordini e incassi: il pannello ricarica solo allora.
let r=await worker.fetch(new Request('https://worker.test/api/orders/open-0',{method:'PATCH',headers:auth,body:JSON.stringify({status:'confirmed'})}),env);assert.equal(r.status,200);
const afterStatus=(await get('/api/changes')).rev;assert.ok(afterStatus>rev,'cambio stato');
r=await worker.fetch(new Request('https://worker.test/api/payments',{method:'POST',headers:auth,body:JSON.stringify({id:crypto.randomUUID(),order_id:'open-1',kind:'payment',amount_cents:1000,method:'cash'})}),env);assert.equal(r.status,200);
const afterPayment=(await get('/api/changes')).rev;assert.ok(afterPayment>afterStatus,'incasso');
ins.run('open-new','C','3330000000','2026-12-20','10:00','','[]',1000,'new');
assert.ok((await get('/api/changes')).rev>afterPayment,'nuovo ordine');

// Il controllo ogni 30 s del pannello chiama prima /api/changes e ricarica la lista senza svuotarla.
const html=await (await worker.fetch(new Request('https://worker.test/'),env)).text();
assert.match(html,/api\("\/api\/changes"\)/);
assert.match(html,/load\(\{quiet:true\}\)/);
assert.match(html,/\$\("orders"\)\.replaceChildren\(\.\.\.cards\)/);
console.log('OK: schema creato una volta, controllo da 2 letture, ordini aperti via indice, revisione aggiornata da stato/incasso/nuovo ordine, lista non svuotata');
