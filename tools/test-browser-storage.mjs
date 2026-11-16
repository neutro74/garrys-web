import assert from 'node:assert/strict';
import {launch} from './lib/browser.mjs';
import {spawn} from 'node:child_process';
import {crc32} from '../ports/gmod/compat/addons.mjs';
const server=spawn('node',['web/server.mjs','--port','8691'],{stdio:'ignore'});let b;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{await wait(1000);b=await launch();
for(const suffix of ['?write','']){await b.goto('http://127.0.0.1:8691/web/dev/storage-test.html'+suffix);let result;for(let n=0;n<100;n++){await wait(100);result=await b.eval('window.result');if(result&&!result.pending)break;}assert.deepEqual(result,{bytes:[17,42,99],stat:3,backup:[17,42,99]});}
// Validate real GMA bytes, cache them, then prove the next page sees the cached addon.
const payload=Buffer.from('print(42)'),name=Buffer.from('lua/autorun/storage-test.lua\0');
const header=Buffer.alloc(16);header.writeUInt32LE(1);header.writeBigUInt64LE(BigInt(payload.length),4);header.writeUInt32LE(crc32(payload),12);
const gma=Buffer.concat([Buffer.from('GMAD'),Buffer.from([3]),Buffer.alloc(16),Buffer.from('\0Storage Test\0{}\0Test\0'),Buffer.alloc(4),header.subarray(0,4),name,header.subarray(4),Buffer.alloc(4),payload,Buffer.alloc(4)]);
const invalid=await b.eval(`storage.request('import-addon',{name:'bad.gma',bytes:new Uint8Array([1,2,3]).buffer}).then(()=>false,()=>true)`);assert.equal(invalid,true);
assert.equal(await b.eval(`storage.request('import-addon',{name:'regression.gma',bytes:new Uint8Array(${JSON.stringify([...gma])}).buffer})`),'regression.gma');
await b.goto('http://127.0.0.1:8691/web/dev/storage-test.html');for(let n=0;n<100;n++){await wait(100);if(await b.eval('window.result&&!window.result.pending'))break;}
// On the next start an imported addon moves from the overlay into the addon library (OPFS 'garrys-wasm-library').
assert.deepEqual(await b.eval(`storage.request('list')`),[]);
assert.deepEqual(await b.eval(`storage.request('library-files').then(f=>f.map(x=>x.name))`),['regression.gma']);
await b.eval(`storage.request('library-remove',{name:'regression.gma'})`);assert.deepEqual(await b.eval(`storage.request('library-files')`),[]);
console.log('PASS addon validation, OPFS caching, move into the library on reload, removal');
console.log('PASS Chromium OPFS save write, reload persistence, worker RPC and binary backup');
}finally{if(b)await b.close();server.kill();}
