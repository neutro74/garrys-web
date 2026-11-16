#!/usr/bin/env node
// Turn a package-web output into a StaticDelivr/GitHub release: code stays plain, everything else is split into
// 1 MiB sha256-addressed parts (parts/xx/<hash>.bin) listed in cdn-manifest.json, served by web/cdn-sw.js.
// usage: node tools/package-cdn.mjs --in dist/gmod-web --out dist/cdn-release [--have dist/cdn-clean/parts]
// --have: parts already published there are listed in the manifest but not written again (saves disk on big deltas).
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {isUserData} from './lib/user-data.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const CHUNK=1048576;
const MIME={wasm:'application/wasm',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',ico:'image/x-icon',ttf:'font/ttf',woff:'font/woff',woff2:'font/woff2',css:'text/css',js:'text/javascript',mjs:'text/javascript',html:'text/html',txt:'text/plain'};
const mime=f=>MIME[path.extname(f).slice(1).toLowerCase()]??'application/octet-stream';
// Plain (CDN-served) files: only the worker bootstrap. StaticDelivr rewrites relative imports in .js/.mjs files
// into root-absolute paths (breaking subpath hosting), so all other code goes through parts, byte-for-byte.
const plain=rel=>rel==='cdn-sw.js'||rel==='index.html'||rel==='README.txt';
function copy(a,b){fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);}
function walk(dir,base=''){let out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=base?base+'/'+e.name:e.name;if(e.isDirectory())out=out.concat(walk(path.join(dir,e.name),rel));else if(e.isFile())out.push(rel);}return out;}
export function packageCdn({input,out,have}){
 input=path.resolve(input);out=path.resolve(out);
 if(fs.existsSync(out))throw Error('Output already exists; choose a new output directory');
 if(!fs.existsSync(path.join(input,'game-index.json')))throw Error('Input is not a package-web output');
 fs.mkdirSync(out,{recursive:true});
 const files={};let partCount=0,partBytes=0,plainCount=0;const seen=new Set();
 const fd=Buffer.allocUnsafe(CHUNK);
 for(const rel of walk(input).sort()){
  let src=path.join(input,rel);
  if((rel.startsWith('game/')&&isUserData(rel.slice(5)))||rel.startsWith('asset/garrysmod/data/')||/^asset\/garrysmod\/(addons|cache|screenshots|saves|dupes|demos)\//.test(rel))continue; // per-user state is never published
  if(['web/index.html','index.html','web/cdn-isolation.js','cdn-sw.js'].includes(rel))continue; // regenerated below
  if(rel==='_headers'||rel==='nginx.conf.example')continue; // the CDN worker supplies isolation headers
  if(rel==='game-index.json'){ // the engine's directory index must not list per-user paths either
   const strip=(node,base)=>Object.fromEntries(Object.entries(node).filter(([k])=>!isUserData(base+k)).map(([k,v])=>[k,typeof v==='object'?strip(v,base+k+'/'):v]));
   src=path.join(out,'.game-index.tmp');fs.writeFileSync(src,JSON.stringify(strip(JSON.parse(fs.readFileSync(path.join(input,rel),'utf8')),'')));
  }
  if(plain(rel)){fs.mkdirSync(path.dirname(path.join(out,rel)),{recursive:true});fs.copyFileSync(src,path.join(out,rel));plainCount++;continue;}
  const size=fs.statSync(src).size,chunks=[],h=fs.openSync(src,'r');
  try{for(let pos=0;pos<size;pos+=CHUNK){const n=fs.readSync(h,fd,0,Math.min(CHUNK,size-pos),pos),part=fd.subarray(0,n),hash=crypto.createHash('sha256').update(part).digest('hex');chunks.push(hash);
   if(!seen.has(hash)){seen.add(hash);if(have&&fs.existsSync(path.join(have,hash.slice(0,2),hash+'.bin')))continue;const dst=path.join(out,'parts',hash.slice(0,2),hash+'.bin');fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,part);partCount++;partBytes+=n;}}}finally{fs.closeSync(h);}
  files[rel]={size,mime:mime(rel),chunks};
 }
 fs.rmSync(path.join(out,'.game-index.tmp'),{force:true});
 // Entry pages: the worker must be package-root scoped, so web/index.html registers it before booting main.js.
 copy(path.join(repo,'web/cdn-sw.js'),path.join(out,'cdn-sw.js'));copy(path.join(repo,'web/cdn-isolation.js'),path.join(out,'web/cdn-isolation.js'));
 const page=fs.readFileSync(path.join(repo,'web/index.html'),'utf8').replaceAll('"/web/brand/','"brand/').replace('<link rel="stylesheet" href="/web/launcher.css">','<link rel="stylesheet" href="launcher.css">').replace('<script type="module" src="/web/launcher.js"></script>',
  `<script type="module">import {ensureCdnIsolation} from './cdn-isolation.js';\nif(await ensureCdnIsolation()){const {MODULES}=await import('./modules.js');navigator.serviceWorker.controller?.postMessage({type:'prefetch',prefixes:['web/','tools/','runtime/','ports/',...MODULES.map(m=>'out/'+m+'-thread.'),'out/'],warm:true,workers:navigator.hardwareConcurrency<=2?3:8});await import('./launcher.js');}else document.getElementById('status').textContent='Cross-origin isolation is unavailable (service workers blocked?). A hard reload (Ctrl+Shift+R) bypasses it: reload normally or reopen the link.';</script>`);
 fs.writeFileSync(path.join(out,'web/index.html'),page);
 // Icons as plain files too: browsers fetch the tab icon outside the service worker, so it must exist on the CDN itself.
 for(const f of fs.readdirSync(path.join(repo,'web/brand')))if(/\.(ico|png)$/.test(f))copy(path.join(repo,'web/brand',f),path.join(out,'web/brand',f));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Garry\'s Web</title><link rel="icon" href="web/brand/favicon.ico"><meta http-equiv="refresh" content="0;url=web/index.html"><a href="web/index.html">Garry\'s Web</a>');
 // Chunks a boot-to-map run reads (tools/make-warm-list.mjs), by content hash and first-read order.
 const warmFile=path.join(repo,'tools/cdn-warm.json'),warm=[];
 if(fs.existsSync(warmFile))for(const [rel,c] of JSON.parse(fs.readFileSync(warmFile,'utf8')))if(files[rel]?.chunks[c])warm.push(files[rel].chunks[c]);
 fs.writeFileSync(path.join(out,'cdn-manifest.json'),JSON.stringify({version:1,chunkSize:CHUNK,binaryBase:'auto',files,warm}));
 return {out,plain:plainCount,files:Object.keys(files).length,parts:partCount,partMiB:Math.round(partBytes/1048576)};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const args=process.argv.slice(2),arg=(n,d)=>{const i=args.indexOf('--'+n);return i<0?d:args[i+1];};
 try{console.log(JSON.stringify(packageCdn({input:arg('in',path.join(repo,'dist/gmod-web')),out:arg('out',path.join(repo,'dist/cdn-release')),have:arg('have')})));}catch(e){console.error(e.message);process.exitCode=1;}
}
