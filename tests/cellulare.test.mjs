// Il servizio ordini rifiuta cellulari incompleti o fissi, anche da una pagina vecchia rimasta in memoria.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../cloudflare/worker.js',import.meta.url),'utf8');
const {basicOrder}=await import('data:text/javascript;base64,'+Buffer.from(code+'\nexport {basicOrder};').toString('base64'));
const base={id:crypto.randomUUID().replace(/^(.{14})./,'$14'),customer_name:'Prova',pickup_date:'2026-11-05',pickup_time:'10:00',notes:'',items:[{id:'orata',quantity:1}],expected_total_cents:2400};
const prova=phone=>{try{return basicOrder({...base,customer_phone:phone}).customer_phone;}catch(e){return 'ERRORE: '+e.message;}};
assert.match(prova('366661887'),/10 cifre/);
assert.match(prova('0612345678'),/fisso/);
assert.equal(prova('366 661 8887'),'3666618887');
assert.equal(prova('+39 366-661.8887'),'+393666618887');
assert.equal(prova('00393666618887'),'00393666618887');
assert.equal(prova('+4915112345678'),'+4915112345678');
console.log('OK: cellulari italiani di 10 cifre, prefissi, esteri; rifiutati incompleti e fissi');
