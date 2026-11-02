// Il sito clienti propone solo giorni e orari che il servizio ordini accetta davvero.
// Confronto diretto: per ogni prodotto e diversi momenti della settimana, ciò che il sito
// offre coincide con ciò che priceOrder del Worker accetta.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const code=fs.readFileSync(new URL('cloudflare/worker.js',root),'utf8');
const {priceOrder,pickupDays}=await import('data:text/javascript;base64,'+Buffer.from(code+'\nexport {priceOrder,pickupDays};').toString('base64'));
const menuFile=JSON.parse(fs.readFileSync(new URL('menu.json',root),'utf8'));
const script=fs.readFileSync(new URL('index.html',root),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

function client(now,menu){
 const RealDate=Date;
 class FixedDate extends RealDate{constructor(...a){super(...(a.length?a:[now.getTime()]));}static now(){return now.getTime();}}
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{},hidden:false,disabled:false,classList:{add(){},remove(){}},addEventListener(){}});return nodes.get(id);};
 const ctx=vm.createContext({Date:FixedDate,Intl,JSON,Math,Number,String,Object,Array,Set,Map,crypto,setTimeout,clearTimeout,console,document:{getElementById:node,querySelectorAll:()=>[]},fetch:()=>new Promise(()=>{}),alert(){}});
 vm.runInContext(script,ctx);
 vm.runInContext('menu='+JSON.stringify(menu)+';apiPronta=true;supportaPreparazioni=true;supportaFestivita=true;giorniServizio='+JSON.stringify(pickupDays(menu,now)),ctx);
 return {run:c=>vm.runInContext(c,ctx),node};
}
function serverAccepts(menu,now,v,day,time){
 const qty=v.unita==='kg'?.5:1,prep=(v.preparazioni||[])[0]||'';
 const order={id:'x',customer_name:'a',customer_phone:'3330000000',pickup_date:day,pickup_time:time,notes:'',items:[{id:v.id,quantity:qty,preparation:prep}],total_cents:Math.round(Math.round(v.prezzo*100)*qty)};
 try{priceOrder(order,menu,now);return true;}catch(e){return false;}
}
const HOURS=['09:00','09:30','10:00','10:30','11:00','11:30','12:00','17:00','17:30','18:00','18:30','19:00','19:30','20:00'];

// Menu di prova: una festa con ritiro e scadenza nel futuro, oltre ai prodotti reali.
const menu=structuredClone(menuFile);
const festa=menu.categorie.find(c=>c.id==='natale');
Object.assign(festa,{attiva:true,periodo:{dal:'2026-11-01',al:'2026-11-20'},ritiro_data:'2026-11-21',scadenza_data:'2026-11-19',scadenza_ora:'18:00'});
for(const v of festa.voci)if(v.prezzo>0)v.disponibile=true;

const moments=['2026-11-03T09:00:00Z','2026-11-03T16:59:00Z','2026-11-03T17:01:00Z','2026-11-03T19:00:00Z','2026-11-07T22:30:00Z','2026-11-19T16:30:00Z','2026-11-19T17:30:00Z'];
let checked=0;
for(const iso of moments){
 const now=new Date(iso),c=client(now,menu);
 const products=menu.categorie.flatMap(cat=>cat.voci).filter(v=>v.disponibile&&v.prezzo>0&&!['esaurito','terminato'].includes(v.stato));
 for(const v of products){
  const offered=c.run(`giorniPer([tutte().find(v=>v.id===${JSON.stringify(v.id)})])`);
  for(const day of pickupDays(menu,now)){
   const hours=offered.includes(day)?c.run(`orariPer([tutte().find(v=>v.id===${JSON.stringify(v.id)})],${JSON.stringify(day)})`):[];
   for(const time of HOURS){
    const server=serverAccepts(menu,now,v,day,time);
    assert.equal(hours.includes(time),server,`${iso} ${v.id} ${day} ${time}: sito ${hours.includes(time)} server ${server}`);
    checked++;
   }
  }
  // Prodotto senza nessun giorno valido: il sito lo segna come non ordinabile.
  assert.equal(c.run(`nonOrdinabile(tutte().find(v=>v.id===${JSON.stringify(v.id)}))`),offered.length===0,`${iso} ${v.id} ordinabile`);
 }
}

// Martedì 3 novembre alle 10: l'orata non si ritira oggi (termine ieri alle 18), il primo giorno è domani.
let c=client(new Date('2026-11-03T09:00:00Z'),menuFile);
assert.equal(c.run('giorniPer([tutte().find(v=>v.id==="orata")])[0]'),'2026-11-04');
// Alle 20 anche domani è chiuso: primo giorno giovedì 5.
c=client(new Date('2026-11-03T19:00:00Z'),menuFile);
assert.equal(c.run('giorniPer([tutte().find(v=>v.id==="orata")])[0]'),'2026-11-05');
// La frittura di pesce si ordina in giornata fino alle 16, con orari serali.
c=client(new Date('2026-11-03T09:00:00Z'),menuFile);
assert.equal(c.run('giorniPer([tutte().find(v=>v.id==="frittura-di-pesce")])[0]'),'2026-11-03');
assert.deepEqual([...c.run('orariPer([tutte().find(v=>v.id==="frittura-di-pesce")],"2026-11-03")')],['18:30','19:00','19:30','20:00']);
// La festa di prova del menu reale (ritiro 2 novembre, termine 1 novembre alle 18) risulta chiusa.
c=client(new Date('2026-11-02T12:00:00Z'),menuFile);
assert.equal(c.run('motivoNonOrdinabile(tutte().find(v=>v.id==="festa-ylov"))'),'chiuso');
// Festa con ritiro oltre i 14 giorni normali e pesce normale insieme: nessun giorno comune,
// il secondo prodotto non entra nel carrello.
c=client(new Date('2026-11-03T09:00:00Z'),menu);
c.run('cambia("festa-ylov",1);cambia("orata",1)');
assert.equal(c.run('Object.keys(carrello).join()'),'festa-ylov');
assert.match(c.node('messaggio').textContent,/si ritirano solo/);
assert.equal(c.node('giorno').value,'2026-11-21');
// Con l'orata nel carrello il giorno proposto passa al primo valido e lo dice.
c=client(new Date('2026-11-03T09:00:00Z'),menuFile);
c.node('giorno').value='2026-11-03';c.run('cambia("orata",1)');
assert.equal(c.node('giorno').value,'2026-11-04');
assert.equal(c.node('notaRitiro').hidden,false);
// Orari di ritiro scelti nella gestione: sito e servizio usano gli stessi.
const conOrari=structuredClone(menuFile);conOrari.ritiro.orari=['08:00','12:30','19:30'];
c=client(new Date('2026-11-03T09:00:00Z'),conOrari);
assert.deepEqual([...c.run('orariPer([tutte().find(v=>v.id==="orata")],"2026-11-05")')],['08:00','12:30','19:30']);
for(const t of HOURS.concat(['08:00','12:30']))assert.equal(['08:00','12:30','19:30'].includes(t),serverAccepts(conOrari,new Date('2026-11-03T09:00:00Z'),conOrari.categorie[1].voci.find(v=>v.id==='orata'),'2026-11-05',t),'orario '+t);
console.log(`OK: giorni e orari del sito uguali a quelli accettati dal servizio (${checked} combinazioni), festa chiusa, carrello incompatibile bloccato, giorno aggiornato con avviso`);
