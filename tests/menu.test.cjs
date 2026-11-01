const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..'),menu=JSON.parse(fs.readFileSync(path.join(root,'menu.json'),'utf8'));
const fish=menu.categorie.find(c=>c.id==='pesce-fresco').voci;
assert.equal(new Set(menu.categorie.flatMap(c=>c.voci.map(v=>v.id))).size,menu.categorie.flatMap(c=>c.voci).length);
for(const id of ['spigola','orata','rombo','sogliola']){assert.ok(fish.find(v=>v.id===id));assert.equal(fish.find(v=>v.id===id).metodo,'');}
assert.ok(!fish.some(v=>['spigola-orata','rombo-sogliola'].includes(v.id)));
function load(file,extras={}){const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){}});return nodes.get(id)};const context=vm.createContext({Date,Intl,Map,Set,JSON,Math,Number,String,Object,Array,crypto:require('node:crypto').webcrypto,document:{getElementById:node,querySelectorAll:()=>[]},window:{addEventListener(){}},localStorage:{getItem(){return null}},fetch:()=>new Promise(()=>{}),location:{hostname:'ermestre.github.io',pathname:'/pescheriamassimo/gestione.html'},...extras});vm.runInContext(fs.readFileSync(path.join(root,file),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);return {run:s=>vm.runInContext(s,context),node};}
const client=load('index.html');client.run('menu='+JSON.stringify(menu));
assert.equal(client.run('quantita(tutte().find(v=>v.id==="orata"),.5)'),'500 g');
assert.equal(client.run('quantita(tutte().find(v=>v.id==="orata"),1.5)'),'1,5 kg');
client.run('scegliPeso("orata",1.5)');assert.equal(client.run('totale()'),36);
client.run('tutte().find(v=>v.id==="orata").preparazioni.push("Pulito");scegliPreparazione("orata","Pulito");cambia("orata",1)');
assert.equal(client.run('carrello.orata.preparazione'),'Pulito');assert.equal(client.run('carrello.orata.qta'),2);
assert.match(client.run('testoOrdine()'),/Orata \[Pulito\]/);
client.run('tutte().find(v=>v.id==="orata").stato="esaurito";scegliPeso("orata",1);scegliPreparazione("orata","Intero")');
assert.equal(client.run('carrello.orata.qta'),2);assert.equal(client.run('carrello.orata.preparazione'),'Pulito');
assert.match(client.run('cardHtml(tutte().find(v=>v.id==="orata"))'),/ESAURITO/);
assert.match(client.run('scelteVoce({id:"x",prezzo:1,disponibile:true,consiglio:"<script>alert(1)</script>"},0)'),/&lt;script&gt;/);
const editor=load('gestione.html');editor.run('dati='+JSON.stringify(menu));
const index=fish.findIndex(v=>v.id==='orata'),ci=menu.categorie.findIndex(c=>c.id==='pesce-fresco');
editor.run(`aggiornaPreparazioni(${ci},${index},'Pulito',true);aggiornaPreparazioni(${ci},${index},'A filetti',true);aggiornaPreparazioni(${ci},${index},'Intero',false)`);
assert.equal(editor.run(`dati.categorie[${ci}].voci[${index}].preparazioni.join(',')`),'Pulito,A filetti');
assert.match(editor.run(`voceHtml(${ci},${index},dati.categorie[${ci}].voci[${index}])`),/stato_prodotto/);
console.log('OK: prodotti separati, quantità, prezzi, preparazioni, esauriti e gestione.');
