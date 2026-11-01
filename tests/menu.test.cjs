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
assert.equal(editor.run(`dati.categorie[${ci}].voci[${index}].preparazioni.join(',')`),'Pulito,Sfilettato,A filetti');
assert.match(editor.run(`voceHtml(${ci},${index},dati.categorie[${ci}].voci[${index}])`),/stato_prodotto/);
console.log('OK: prodotti separati, quantità, prezzi, preparazioni, esauriti e gestione.');

const customerSource=fs.readFileSync(path.join(root,'index.html'),'utf8');
const managementSource=fs.readFileSync(path.join(root,'gestione.html'),'utf8');
assert.ok(customerSource.includes('API_ORDINI') && customerSource.includes('/api/submit'),'Il checkout deve inviare all’archivio centrale');
assert.ok(managementSource.includes('notaMenu') && managementSource.includes('qr-menu.svg'),'Avviso e QR devono restare nella gestione');
for(const choice of ['Intero','Pulito','Sfilettato']){client.run('tutte().find(v=>v.id==="orata").stato="disponibile";scegliPreparazione("orata",'+JSON.stringify(choice)+')');assert.match(client.run('testoOrdine()'),new RegExp('Orata \\['+choice+'\\]'));}

// Supplier lot snapshots survive replacements and repeated saves do not duplicate them.
editor.run(`dati.categorie[${ci}].voci[${index}].lotto_fornitore='LOT-TEST-1';dati.categorie[${ci}].voci[${index}].zona_fao='Zona di test';registraArrivi();registraArrivi()`);
assert.equal(editor.run(`dati.categorie[${ci}].voci[${index}].archivio_arrivi.length`),1);
editor.run(`dati.categorie[${ci}].voci[${index}].lotto_fornitore='LOT-TEST-2';dati.categorie[${ci}].voci[${index}].zona_fao='Seconda zona di test';registraArrivi()`);
assert.equal(editor.run(`dati.categorie[${ci}].voci[${index}].archivio_arrivi[0].dati.zona_fao`),'Zona di test');
assert.equal(editor.run(`dati.categorie[${ci}].voci[${index}].archivio_arrivi.length`),2);
client.run(`Object.assign(tutte().find(v=>v.id==='orata'),{lotto_fornitore:'LOT-TEST-2',paese_origine:'Paese di test',zona_fao:'Zona di test',nome_scientifico:'Specie di test',consiglio:'Due pomodorini e aglio\\nPoi il consiglio di Massimo'});apriCarta('orata')`);
assert.match(client.node('cartaCorpo').innerHTML,/LOT-TEST-2/);assert.match(client.node('cartaCorpo').innerHTML,/Specie di test/);assert.match(client.node('cartaCorpo').innerHTML,/Due pomodorini e aglio/);
assert.match(client.node('cartaCorpo').innerHTML,/Scegli peso/);
client.run(`scegliPeso('orata',1);confermaCarta('orata')`);assert.equal(client.run('carrello.orata.qta'),1,'Conferma scheda non aggiunge una seconda quantità');
assert.match(client.run('testoOrdine()'),/Lotto Orata: LOT-TEST-2/);
for(const v of fish)assert.ok(v.preparazioni?.length,'Preparazione definita per '+v.nome);
console.log('OK: scheda da foto, consigli, lotto nelle note e archivio arrivi immutabile dalla UI.');
const beforeDelete=editor.run(`dati.categorie[${ci}].voci.length`);editor.run(`eliminaVoce(${ci},${index})`);assert.equal(editor.run(`dati.categorie[${ci}].voci.length`),beforeDelete,'I prodotti con storico lotti si nascondono senza eliminarli');

// Reusable festivities: drafts, settings, product editor and safe customer intro.
editor.run('dati='+JSON.stringify(menu));
const fi=menu.categorie.findIndex(c=>c.id==='natale');
editor.run(`dati.categorie[${fi}].attiva=true`);
assert.throws(()=>editor.run('validaFestivita()'),/Festività/);
editor.run(`Object.assign(dati.categorie[${fi}],{ricorrenza:'Pasqua',nome:'Menu di Pasqua',periodo:{dal:'2027-03-01',al:'2027-03-28'},ritiro_data:'2027-03-28',scadenza_data:'2027-03-26',scadenza_ora:'18:00'})`);
editor.run('validaFestivita()');
assert.match(editor.run(`festivitaHtml(dati.categorie[${fi}],${fi})`),/Aggiungi piatto per questa festa/);
editor.run(`aggiornaFesta(${fi},'scadenza_ora','99:99')`);assert.throws(()=>editor.run('validaFestivita()'),/chiusura/);
editor.run(`aggiornaFesta(${fi},'attiva',false)`);editor.run('validaFestivita()');
assert.equal(client.run('categoriaAttiva({attiva:false,periodo:{dal:"2000-01-01",al:"2099-12-31"}})'),false);
assert.equal(client.run('festaChiusa({scadenza_data:"2000-01-01",scadenza_ora:"18:00"})'),true);
assert.match(client.run('festaIntro({ricorrenza:"<script>",presentazione:"<img>",ritiro_data:"2026-12-24"})'),/&lt;script&gt;/);
console.log('OK: festività riutilizzabili, bozze, date e scadenze, editor piatti e testi protetti.');

// Holiday banner and products precede the ordinary menu. No edits to production menu data.
client.run('menu='+JSON.stringify(menu)+';supportaFestivita=true;');
client.run(`Object.assign(menu.categorie.find(c=>c.id==='natale'),{nome:'Menu di Natale',ricorrenza:'Natale',attiva:true,periodo:{dal:'2000-01-01',al:'2099-12-31'},ritiro_data:'2099-12-24',voci:[{id:'test-vongole',nome:'Vongole veraci',prezzo:18,unita:'kg',disponibile:true},{id:'test-baccala',nome:'Baccalà',prezzo:5,unita:'kg',disponibile:true}]});render()`);
assert.match(client.node('bannerFesta').innerHTML,/Menu di Natale/);assert.match(client.node('bannerFesta').innerHTML,/href="#menu-festivita"/);
const rendered=client.node('menu').innerHTML;assert.match(rendered,/Vongole veraci/);assert.match(rendered,/Baccalà/);assert.ok(rendered.indexOf('id="menu-festivita"')<rendered.indexOf('Spigola'));
client.run("menu.categorie.find(c=>c.id==='natale').attiva=false;render()");assert.equal(client.node('bannerFesta').innerHTML,'');assert.doesNotMatch(client.node('menu').innerHTML,/Vongole veraci/);
editor.run('messaggio("Modifiche salvate","ok")');assert.equal(editor.node('statoAlto').textContent,'Modifiche salvate');assert.equal(editor.node('statoBarra').textContent,'Modifiche salvate');assert.match(editor.node('statoAlto').className,/riscontro-alto/);
assert.match(editor.run('statoFestivita({attiva:false,voci:[]})'),/Bozza/);
assert.match(editor.run('statoFestivita({attiva:true,periodo:{dal:"2000-01-01",al:"2099-12-31"},voci:[{disponibile:true}]})'),/1 prodotti ordinabili/);
console.log('OK: banner festivo, piatti in cima al menu e salvataggio visibile in alto e nella barra fissa.');
