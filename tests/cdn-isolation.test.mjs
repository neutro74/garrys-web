import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = () => readFile(new URL('../web/cdn-isolation.js',import.meta.url),'utf8');
const KEY='garrys-wasm.cdn-isolation:/release/';
async function run({isolated=false, supported=true, lastAttempt=null, storageFailure=false, registerFailure=false, href='https://example.test/release/web/index.html'}={}) {
 const values=new Map(lastAttempt!==null?[[KEY,String(lastAttempt)]]:[]);const registrations=[];const reloads=[];const replaced=[];
 const location={href,replace:url=>reloads.push(url),reload:()=>reloads.push(location.href)};
 const context=vm.createContext({URL,console,Date,globalThis:undefined,crossOriginIsolated:isolated,navigator:supported?{serviceWorker:{register:async(...args)=>{registrations.push(args);if(registerFailure)throw Error('blocked');return {};},ready:Promise.resolve()}}:{},location,
  history:{state:null,replaceState:(s,t,url)=>{replaced.push(url);location.href=url;}},
  sessionStorage:{getItem:key=>{if(storageFailure)throw Error('blocked');return values.get(key)??null;},setItem:(key,v)=>{if(storageFailure)throw Error('blocked');values.set(key,v);},removeItem:key=>values.delete(key)}});
 vm.runInContext('globalThis = this',context);
 vm.runInContext((await source()).replace('export async function','async function').replaceAll('import.meta.url',JSON.stringify('https://example.test/release/web/cdn-isolation.js')),context);
 const promise=vm.runInContext('ensureCdnIsolation()',context);
 await new Promise(resolve=>setImmediate(resolve));
 return {promise,context,registrations,reloads,replaced,values};
}
test('already isolated starts immediately; unsupported and failed registration fail without reload',async()=>{const isolated=await run({isolated:true});assert.equal(await isolated.promise,true);assert.equal(isolated.registrations.length,0);for(const options of [{supported:false},{registerFailure:true}]){const f=await run(options);assert.equal(await f.promise,false);assert.equal(f.reloads.length,0);}});
test('worker registers package-root scope and reloads once, keeping the address clean',async()=>{const f=await run();assert.equal(f.registrations.length,1);assert.equal(f.registrations[0][0],'https://example.test/release/cdn-sw.js');assert.equal(f.registrations[0][1].scope,'https://example.test/release/');assert.equal(f.reloads.length,1);assert.doesNotMatch(f.reloads[0],/__gmod_cdn_isolation/);const recent=await run({lastAttempt:Date.now()-2000});assert.equal(await recent.promise,false);assert.equal(recent.reloads.length,0);const old=await run({lastAttempt:Date.now()-60000});assert.equal(old.reloads.length,1);});
test('a marker from an older release is removed from the address',async()=>{const f=await run({isolated:true,href:'https://example.test/release/web/index.html?a=1&__gmod_cdn_isolation=1'});assert.equal(await f.promise,true);assert.deepEqual(f.replaced,['https://example.test/release/web/index.html?a=1']);});
test('without session storage the address marker guards the single reload',async()=>{const f=await run({storageFailure:true});assert.equal(f.reloads.length,1);assert.match(f.reloads[0],/__gmod_cdn_isolation=1/);vm.runInContext(`location.href=${JSON.stringify(f.reloads[0])}`,f.context);assert.equal(await vm.runInContext('ensureCdnIsolation()',f.context),false);assert.equal(f.reloads.length,1);assert.doesNotMatch(vm.runInContext('location.href',f.context),/__gmod_cdn_isolation/);});
