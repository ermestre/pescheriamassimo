// Eliminazione dal pannello: solo ordini annullati, con i loro movimenti e prenotazioni.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('../',import.meta.url);
const code=fs.readFileSync(new URL('cloudflare/worker.js',root),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const menu=JSON.parse(fs.readFileSync(new URL('menu.json',root),'utf8'));
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),customer_name TEXT,customer_phone TEXT,pickup_date TEXT,pickup_time TEXT,notes TEXT,items_json TEXT,total_cents INTEGER,status TEXT DEFAULT 'new',paid INTEGER DEFAULT 0)`);
const db={prepare(sql){const stmt=sqlite.prepare(sql);function b(a=[]){return {bind(...v){return b(v)},async first(){return stmt.get(...a)||null},async all(){return {results:stmt.all(...a)}},async run(){const r=stmt.run(...a);return {meta:{changes:Number(r.changes)}}}}}return b()}};
db.batch=async l=>{sqlite.exec('BEGIN');try{const o=[];for(const s of l)o.push(await s.run());sqlite.exec('COMMIT');return o;}catch(e){sqlite.exec('ROLLBACK');throw e;}};
const env={db,ADMIN_TOKEN:'random-test-only-secret-123456789'};
globalThis.fetch=async()=>new Response(JSON.stringify(menu));
const auth={Authorization:'Bearer '+env.ADMIN_TOKEN};
const call=(path,method='GET',body)=>worker.fetch(new Request('https://worker.test'+path,{method,headers:auth,...(body?{body:JSON.stringify(body)}:{})}),env);
await call('/api/changes');
const add=(id,status)=>sqlite.prepare("INSERT INTO orders(id,customer_name,customer_phone,pickup_date,pickup_time,notes,items_json,total_cents,status) VALUES (?,?,?,?,?,?,?,?,?)").run(id,'Prova','3330000000','2026-11-03','10:00','',JSON.stringify([{id:'orata',quantity:1}]),2400,status);
add('a','new');add('b','new');

// Un ordine aperto non si elimina.
let r=await call('/api/orders/a','DELETE');assert.equal(r.status,409);assert.ok(sqlite.prepare("SELECT 1 FROM orders WHERE id='a'").get());
// Incasso registrato, poi annullato, poi eliminato: spariscono ordine e movimenti.
assert.equal((await call('/api/payments','POST',{id:crypto.randomUUID(),order_id:'b',kind:'payment',amount_cents:2400,method:'cash'})).status,200);
assert.equal((await call('/api/orders/b','PATCH',{status:'cancelled'})).status,200);
const before=(await (await call('/api/changes')).json()).rev;
r=await call('/api/orders/b','DELETE');assert.equal(r.status,200);
assert.equal(sqlite.prepare("SELECT count(*) n FROM orders WHERE id='b'").get().n,0);
assert.equal(sqlite.prepare("SELECT count(*) n FROM payment_events WHERE order_id='b'").get().n,0);
assert.ok((await (await call('/api/changes')).json()).rev>before,'il pannello si accorge della cancellazione');
// Ripetere la cancellazione: ordine non trovato, nessun danno.
assert.equal((await call('/api/orders/b','DELETE')).status,404);
// Senza chiave: rifiutato.
assert.equal((await worker.fetch(new Request('https://worker.test/api/orders/a',{method:'DELETE'}),env)).status,401);
assert.ok(sqlite.prepare("SELECT 1 FROM orders WHERE id='a'").get());
// Il pannello mostra il pulsante solo per gli annullati.
const html=await (await worker.fetch(new Request('https://worker.test/'),env)).text();
assert.match(html,/if\(o\.status==="cancelled"\)\{\s*const del=element\("button","Elimina ordine"\)/);
console.log('OK: eliminazione solo per ordini annullati, movimenti rimossi, revisione aggiornata, chiave obbligatoria');
