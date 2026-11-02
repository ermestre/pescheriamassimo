// Gestione semplificata: elenco compatto, aggiunta da catalogo, dati obbligatori mancanti, orari di apertura.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..'),menu=JSON.parse(fs.readFileSync(path.join(root,'menu.json'),'utf8'));
function load(file){const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},focus(){}});return nodes.get(id)};const context=vm.createContext({Date,Intl,Map,Set,JSON,Math,Number,String,Object,Array,setTimeout,crypto:require('node:crypto').webcrypto,document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null},window:{addEventListener(){}},localStorage:{getItem(){return null}},fetch:()=>new Promise(()=>{}),location:{hostname:'ermestre.github.io',pathname:'/pescheriamassimo/gestione.html'}});vm.runInContext(fs.readFileSync(path.join(root,file),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);return {run:s=>vm.runInContext(s,context),node};}

const g=load('gestione.html');
g.run('dati='+JSON.stringify(menu));
const ci=menu.categorie.findIndex(c=>c.id==='pesce-fresco');
// Riga compatta: prezzo, In vendita, Esaurito e Modifica; nessun campo della scheda nell'elenco.
const riga=g.run(`rigaVoce(${ci},0,dati.categorie[${ci}].voci[0])`);
assert.match(riga,/In vendita/);assert.match(riga,/Esaurito/);assert.match(riga,/aggiornaPrezzo/);assert.doesNotMatch(riga,/stato_prodotto/);
// Dati obbligatori: pesce senza zona, metodo, attrezzo, stato risulta da completare; completo con tutti i campi.
assert.deepEqual([...g.run(`mancanti(${ci},{nome:'X',nome_scientifico:'Sparus aurata',allergeni:'Pesce'})`)],['metodo di produzione','zona di cattura','fresco o decongelato']);
assert.deepEqual([...g.run(`mancanti(${ci},{nome:'X',nome_scientifico:'Sparus aurata',metodo:'Pescato',zona_fao:'FAO 37.2.1 Mar Adriatico (Mediterraneo centrale)',attrezzo:'Ami e palangari',stato_prodotto:'Fresco',allergeni:'Pesce'})`)],[]);
assert.deepEqual([...g.run(`mancanti(${ci},{nome:'X',nome_scientifico:'Sparus aurata',metodo:'Allevato',zona_fao:'Grecia',stato_prodotto:'Fresco',allergeni:'Pesce'})`)],[],'allevato: niente attrezzo');
// Aggiunta dal catalogo: nome scientifico e allergene compilati, parte non in vendita.
const prima=g.run(`dati.categorie[${ci}].voci.length`);
g.run(`apriNuovo(${ci});scegliNuovaSpecie(CATALOGO.findIndex(s=>s.nome==='Polpo'))`);
g.node('nuovoPrezzoLibero').value='18';
g.run('creaProdotto()');
const nuovo=g.run(`dati.categorie[${ci}].voci.at(-1)`);
assert.equal(g.run(`dati.categorie[${ci}].voci.length`),prima+1);
assert.equal(nuovo.nome,'Polpo');assert.equal(nuovo.nome_scientifico,'Octopus vulgaris');assert.equal(nuovo.allergeni,'Molluschi');assert.equal(nuovo.prezzo,18);assert.equal(nuovo.unita,'kg');assert.equal(nuovo.disponibile,false);
// Orari di apertura: si creano solo su richiesta, lunedì chiuso di partenza.
assert.match(g.run('aperturaHtml()'),/non sono ancora impostati/);
g.run('orariApertura();aggiornaApertura(1,0,0,"08:00");aggiornaApertura(1,0,1,"13:00");copiaApertura()');
assert.equal(g.run('dati.orari_apertura[0].chiuso'),true);assert.equal(g.run('dati.orari_apertura[6].fasce[0][1]'),'13:00');

// Menu clienti: giorni con gli stessi orari raggruppati.
const c=load('index.html');
const orari=JSON.parse(g.run('JSON.stringify(dati.orari_apertura)'));orari[6].fasce=[['08:00','12:30'],['','']];
const html=c.run('orariAperturaHtml('+JSON.stringify(orari)+')');
assert.match(html,/Lun<\/span><span>chiuso/);assert.match(html,/Mar–Sab<\/span><span>8:00–13:00/);assert.match(html,/Dom<\/span><span>8:00–12:30/);
assert.equal(c.run('orariAperturaHtml(undefined)'),'');
console.log('OK: elenco compatto, dati obbligatori, aggiunta dal catalogo, orari di apertura in gestione e nel menu clienti');
