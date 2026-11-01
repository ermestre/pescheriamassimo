import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../cloudflare/worker.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const html=await (await worker.fetch(new Request('https://test/'),{})).text();
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function(script);
const feature=script.slice(script.indexOf('let customBuffer='),script.indexOf('async function checkOrders('));
const records=new Map();let brokenDecode=false;const starts=[],sources=[];
function browser(){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',files:[],disabled:false});return nodes.get(id);};
 class AudioContext{
  currentTime=10;destination={};async resume(){}
  async decodeAudioData(){if(brokenDecode)throw Error('corrupt MP3');return {duration:12};}
  createBufferSource(){return {connect(){},disconnect(){},start(...args){sources.push(args);}};}
  createOscillator(){return {frequency:{},connect(){},disconnect(){},start(t){starts.push(t);},stop(){}};}
  createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){}}};}
 }
 const db={objectStoreNames:{contains:()=>true},close(){},transaction(){
  const tx={objectStore(){return {get:key=>operation(()=>records.get(key)),put:(v,k)=>operation(()=>records.set(k,v)),delete:k=>operation(()=>records.delete(k))};}};
  function operation(fn){const req={};queueMicrotask(()=>{req.result=fn();req.onsuccess?.();tx.oncomplete?.();});return req;}
  return tx;
 }};
 const indexedDB={open(){const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}};
 const context=vm.createContext({$,indexedDB,window:{AudioContext},ArrayBuffer,Number,Error,setTimeout,clearTimeout,console});
 vm.runInContext('let alertAudio=null,alertsEnabled=false;'+feature,context);
 return {context,$,ready:()=>vm.runInContext('savedSoundReady',context)};
}
let b=browser();await b.ready();await b.$('enableAlerts').onclick();await Promise.resolve();assert.deepEqual(starts,[10,10.35]);
b.$('alertFile').files=[{name:'not-an-audio.txt',size:10}];await b.$('alertFile').onchange();assert.match(b.$('soundName').textContent,/Scegli un file MP3/);assert.equal(records.size,0);
b.$('alertFile').files=[{name:'large.mp3',size:6*1024*1024}];await b.$('alertFile').onchange();assert.equal(records.size,0);
const audio={name:'campanello.mp3',size:10,arrayBuffer:async()=>new ArrayBuffer(10)};
b.$('alertFile').files=[audio];await b.$('alertFile').onchange();assert.equal(records.get('order').name,audio.name);assert.deepEqual(sources.at(-1),[0,0,10]);assert.match(b.$('soundName').textContent,/MP3 salvato/);
brokenDecode=true;b.$('alertFile').files=[{...audio,name:'rotto.mp3'}];await b.$('alertFile').onchange();assert.equal(records.get('order').name,audio.name);assert.match(b.$('soundName').textContent,/non caricato/);brokenDecode=false;
// A new page instance reads the saved bytes and reuses them after user activation.
b=browser();await b.ready();assert.match(b.$('soundName').textContent,/campanello/);await b.$('enableAlerts').onclick();await Promise.resolve();assert.deepEqual(sources.at(-1),[0,0,10]);
await b.$('resetSound').onclick();assert.equal(records.size,0);const count=starts.length;await b.$('enableAlerts').onclick();await Promise.resolve();assert.equal(starts.length,count+2);
console.log('OK: doppio bip, MP3 locale, limite dimensioni, errore decodifica, persistenza tra aperture, ripristino e durata massima');
