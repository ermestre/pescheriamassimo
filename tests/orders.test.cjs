const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
function page(file) {
  const nodes=new Map(), storage=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,style:{},classList:{add(){},remove(){}},addEventListener(){}});return nodes.get(id)};
  const context=vm.createContext({console,Date,Map,JSON,Math,Number,String,Object,Array,crypto:require('node:crypto').webcrypto,
    document:{getElementById:node,querySelectorAll:()=>[]},navigator:{},window:{addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:()=>new Promise(()=>{})});
  const html=readFileSync(path.join(__dirname,'..',file),'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  return {run:s=>vm.runInContext(s,context),node};
}
const client=page('index.html');
client.run(`menu={categorie:[{voci:[{id:'orata',nome:'Orata',prezzo:20,unita:'kg',disponibile:true,stato:'esaurito'}]}]};`);
client.run(`aggiungiDaCarta('orata')`);
assert.equal(client.run('Object.keys(carrello).length'),0,'esaurito bloccato dalla scheda');
client.run(`menu.categorie[0].voci[0].stato='disponibile';cambia('orata',1)`);
client.node('nome').value='Mario';client.node('cellulare').value='3331234567';client.node('note').value='Pulire il pesce\nSenza testa';
client.node('giorno').value='Domenica';client.node('ora').value='12:00';
const message=client.run('testoOrdine()');
assert.equal(client.run('testoOrdine()'),message,'codice stabile prima dell invio');
const admin=page('somma.html');
admin.run(`menu={categorie:[{voci:[{id:'orata',nome:'Orata',prezzo:99,unita:'kg'}]}]}`);
admin.node('testo').value=message;admin.run('calcola()');
assert.ok(admin.node('risultato').innerHTML.includes('10,00 €'),'totale e prezzi conservati nonostante menu a 99');
const parsed=admin.run(`leggiOrdini(${JSON.stringify(message)})`)[0];
assert.equal(parsed.cellulare,'3331234567');assert.equal(parsed.note,'Pulire il pesce\nSenza testa');assert.equal(parsed.righe[0].importo,10);
const old='Ordine Pescheria da Massimo\nNome: Anna\nRitiro: Domenica\n- 1 x Orata (kg) = 1 kg\nTotale indicativo: 20,00 €';
admin.run(`let iniziali=leggiOrdini(${JSON.stringify(old)});ripristinaStati(iniziali,{},'');iniziali[0].stato={pagato:true,ritirato:true};salvaStato(${JSON.stringify(old)},iniziali);`);
admin.run(`let nuovi=leggiOrdini(${JSON.stringify(message+'\n'+old)});ripristinaStati(nuovi,caricaStato(),'');`);
assert.equal(admin.run('nuovi[1].stato.pagato'),true,'aggiunta e riordino mantengono pagamento');
assert.equal(admin.run('nuovi[1].stato.ritirato'),true);
admin.node('testo').value=old;admin.run('calcola()');
assert.ok(admin.node('risultato').innerHTML.includes('20,00 €'),'vecchio totale preservato');
assert.ok(admin.node('risultato').innerHTML.includes('stimati'),'stima legacy segnalata');
admin.run(`let migrati=leggiOrdini(${JSON.stringify(old)});ripristinaStati(migrati,{testo:${JSON.stringify(old)},stato:{0:{pagato:true}}},'')`);
assert.equal(admin.run('migrati[0].stato.pagato'),true,'migrazione vecchie spunte');
console.log('OK: esauriti, ordine completo, prezzi storici, stato stabile e migrazione.');
