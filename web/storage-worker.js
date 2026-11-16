// Owns all writable file identities and persists closed/flushed files in this origin's OPFS.
import {createFs,seedOverlay,path} from '../tools/lift/host/webfs.mjs';
import {serveOverlayRpc} from '../tools/lift/host/overlay-rpc.mjs';
import {readGma,readGmaHeader,addonPath} from '../ports/gmod/compat/addons.mjs';
let volume,store,root,ctl;const dirty=new Map();
// Writes made here (not through the RPC) must still invalidate the guests' cached metadata (overlay-rpc.mjs ctl[3]).
const changed=()=>{if(ctl)Atomics.add(ctl,3,1);};
const SAVES='/overlay/garrysmod/saves';
const persistent=p=>p==='/overlay'||p.startsWith('/overlay/')||p==='/overlay.whiteouts'||p.startsWith('/overlay.whiteouts/');
async function parent(p,create=false){const parts=p.split('/').filter(Boolean),name=parts.pop();let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create});return {dir,name};}
async function load(dir,p=''){
 const entries=[];
 for await(const [name,h] of dir.entries()){
  const key=p+'/'+name;
  if(h.kind==='directory'){entries.push([key,null]);entries.push(...await load(h,key));}
  else entries.push([key,new Uint8Array(await(await h.getFile()).arrayBuffer())]);
 }
 return entries;
}
// Commits run one at a time: a caller must not return while an earlier commit is still writing its files.
let committing=Promise.resolve();
function commit(){const run=committing.then(writeDirty);committing=run.catch(()=>{});return run;}
async function writeDirty(){
 while(dirty.size){const batch=[...dirty];dirty.clear();
  for(let i=0;i<batch.length;i++){
   const [p,n]=batch[i];try{
    if(!persistent(p))continue;
    if(n===null){try{const {dir,name}=await parent(p);await dir.removeEntry(name,{recursive:true});}catch(e){if(e.name!=='NotFoundError')throw e;}}
    else {const {dir,name}=await parent(p,true);if(n.dir)await dir.getDirectoryHandle(name,{create:true});else {const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();try{await w.write(n.data.slice(0,n.size));await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}}
   }catch(e){for(const [key,node] of batch.slice(i))if(!dirty.has(key))dirty.set(key,node);throw e;}
  }
 }
}
function snapshot(n=store.root,p='',out=[]){for(const [name,c] of n.children??[]){const key=p+'/'+name;if(c.dir){if(persistent(key))out.push([key,null]);snapshot(c,key,out);}else if(persistent(key))out.push([key,c.data.slice(0,c.size)]);}return out;}
function safePath(p){if(typeof p!=='string'||!persistent(p)||p.split('/').some(c=>c==='..'||c==='.')||p.includes('\\')||p.includes('\0'))throw Error('Invalid backup path');return p;}
// ---- Addon library ----
// Addon files live in OPFS 'garrys-wasm-library' (never loaded into memory). The ones chosen for this launch (the page passes
// their names) appear read-only in garrysmod/addons/ and are read in place through sync access handles, so a 1 GB addon costs
// no RAM. Everything else in the overlay is unchanged.
const LIB='/overlay/garrysmod/addons',lib=new Map(),libFds=new Map();let libDir,nextLibFd=1<<24;
const libName=p=>{if(typeof p!=='string'||!p.startsWith(LIB+'/'))return null;const n=p.slice(LIB.length+1);return lib.has(n)?n:null;};
const roErr=p=>Object.assign(Error(`EROFS: read-only addon, ${p}`),{code:'EROFS'});
async function libOpen(name){if(lib.has(name))return;const fh=await libDir.getFileHandle(name);const handle=await fh.createSyncAccessHandle();lib.set(name,{handle,size:handle.getSize()});changed();}
function libClose(name){const e=lib.get(name);if(!e)return;try{e.handle.close();}catch{}lib.delete(name);for(const [fd,n] of libFds)if(n===name)libFds.delete(fd);changed();}
function served(fs){return {...Object.fromEntries(['existsSync','statSync','realpathSync','readdirSync','mkdirSync','openSync','closeSync','fstatSync','readSync','writeSync','ftruncateSync','fsyncSync','unlinkSync','rmSync'].map(k=>[k,fs[k].bind(fs)])),
 existsSync:p=>!!libName(p)||fs.existsSync(p),
 statSync:p=>{const n=libName(p);return n?{dir:false,size:lib.get(n).size,mtimeMs:0}:fs.statSync(p);},
 realpathSync:p=>libName(p)?p:fs.realpathSync(p),
 readdirSync:p=>{const base=fs.existsSync(p)?fs.readdirSync(p):[];return p===LIB?[...new Set([...base,...lib.keys()])]:base;},
 openSync:(p,flags)=>{const n=libName(p);if(!n)return fs.openSync(p,flags);if(flags!==undefined&&flags!=='r'&&flags!==0)throw roErr(p);const fd=nextLibFd++;libFds.set(fd,n);return fd;},
 closeSync:fd=>{if(libFds.delete(fd))return;return fs.closeSync(fd);},
 fstatSync:fd=>{const n=libFds.get(fd);return n?{dir:false,size:lib.get(n).size,mtimeMs:0}:fs.fstatSync(fd);},
 readSync:(fd,buffer,offset,length,position)=>{const n=libFds.get(fd);if(!n)return fs.readSync(fd,buffer,offset,length,position);
  const tmp=new Uint8Array(length),got=lib.get(n).handle.read(tmp,{at:position});buffer.set(tmp.subarray(0,got),offset);return got;},
 writeSync:(fd,...a)=>{if(libFds.has(fd))throw roErr('');return fs.writeSync(fd,...a);},
 unlinkSync:p=>{if(libName(p))throw roErr(p);return fs.unlinkSync(p);},
 rmSync:(p,o)=>{if(libName(p))throw roErr(p);return fs.rmSync(p,o);},
};}
// .gma files that older versions kept in the overlay (in memory) move into the library once; the page records them.
async function migrateAddons(){
 const moved=[];if(!volume.existsSync(LIB))return moved;
 for(const name of volume.readdirSync(LIB)){if(!name.endsWith('.gma')||!volume.statSync(LIB+'/'+name).size)continue;
  const bytes=volume.readFileSync(LIB+'/'+name),w=await(await libDir.getFileHandle(name,{create:true})).createWritable();await w.write(bytes);await w.close();
  volume.rmSync(LIB+'/'+name,{force:true});moved.push({name,size:bytes.length});}
 if(moved.length){changed();await commit();}
 return moved;
}
self.onmessage=async({data:m})=>{
 try {
  if(m.type==='init'){
   ctl=new Int32Array(m.buffer,0,16);root=await(await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm',{create:true});
   const mounted=createFs({index:{},reader:()=>0,onChange:(p,n)=>{if(persistent(p))dirty.set(p,n);}});volume=mounted.fs;store=mounted.overlay;
   seedOverlay(store,await load(root));
   libDir=await(await navigator.storage.getDirectory()).getDirectoryHandle('garrys-wasm-library',{create:true});
   const migrated=await migrateAddons().catch(e=>{console.warn('[storage] addon migration:',e.message);return [];});
   volume.mkdirSync(LIB,{recursive:true});
   for(const name of m.library??[])await libOpen(name).catch(e=>console.warn(`[storage] addon ${name}:`,e.message));
   postMessage({type:'ready',migrated,library:[...lib.keys()]});serveOverlayRpc(m.buffer,served(volume),commit).catch(e=>postMessage({type:'fatal',error:e.message}));return;
  }
  let result;
  if(m.type==='preferences')result={saved:volume.existsSync('/overlay/garrysmod/cfg/video.txt') || volume.existsSync('/overlay/garrysmod/cfg/config.cfg')};
  else if(m.type==='list')result=volume.existsSync('/overlay/garrysmod/addons')?volume.readdirSync('/overlay/garrysmod/addons'):[];
  else if(m.type==='read-file'){const p=String(m.path);if(!persistent(p))throw Error('Not a saved file');result=volume.existsSync(p)?volume.readFileSync(p):null;}
  else if(m.type==='library-add'){await libOpen(String(m.name));result=[...lib.keys()];}
  else if(m.type==='library-remove'){const name=String(m.name);if(name.includes('/'))throw Error('Invalid addon name');libClose(name);await libDir.removeEntry(name).catch(e=>{if(e.name!=='NotFoundError')throw e;});result=[...lib.keys()];}
  else if(m.type==='library-files'){result=[];for await(const [name,h] of libDir.entries())if(h.kind==='file')result.push({name,size:(await h.getFile()).size,active:lib.has(name)});}
  else if(m.type==='library-info'){const name=String(m.name);const e=lib.get(name);let bytes;
   if(e){const n=Math.min(e.size,1<<20);bytes=new Uint8Array(n);e.handle.read(bytes,{at:0});}else bytes=new Uint8Array(await(await(await libDir.getFileHandle(name)).getFile()).slice(0,1<<20).arrayBuffer());
   const g=readGmaHeader(bytes);let type='',description='';try{const d=JSON.parse(g.description);type=String(d.type??'').toLowerCase();description=String(d.description??'');}catch{description=g.description;}
   result={title:g.name,type,description};}
  else if(m.type==='list-addons'){
   // Installed .gma files with their titles (for the in-game Addons page).
   const dir='/overlay/garrysmod/addons';result=[];
   if(volume.existsSync(dir))for(const file of volume.readdirSync(dir)){if(!file.endsWith('.gma'))continue;const bytes=volume.readFileSync(dir+'/'+file);let title=file,type='',description='';try{const g=readGma(bytes,{strictArchiveCrc:false});title=g.name||file;try{const d=JSON.parse(g.description);type=String(d.type??'').toLowerCase();description=String(d.description??'');}catch{description=g.description;}}catch{}result.push({file,title,size:bytes.length,type,description});}
  }
  else if(m.type==='import-addon'){
   const name=addonPath(m.name);if(name.includes('/')||!name.endsWith('.gma'))throw Error('Choose a .gma addon');
   const bytes=new Uint8Array(m.bytes);readGma(bytes);volume.mkdirSync('/overlay/garrysmod/addons',{recursive:true});volume.writeFileSync('/overlay/garrysmod/addons/'+name,bytes);changed();await commit();result=name;
  }else if(m.type==='remove-addon'){
   const name=addonPath(m.name);if(name.includes('/'))throw Error('Invalid addon name');volume.rmSync('/overlay/garrysmod/addons/'+name,{recursive:true,force:true});changed();await commit();
  }else if(m.type==='export'){await commit();result=snapshot();}
  else if(m.type==='restore'){
   // Validate the entire archive before writing any part of it. Merge preserves unrelated saves.
   if(!Array.isArray(m.entries)||m.entries.length>100000)throw Error('Invalid backup');
   for(const [p,bytes] of m.entries){safePath(p);if(bytes!==null&&!(bytes instanceof Uint8Array))throw Error('Invalid backup data');}
   for(const [p,bytes] of m.entries){if(bytes===null)volume.mkdirSync(p,{recursive:true});else {volume.mkdirSync(path.dirname(p),{recursive:true});volume.writeFileSync(p,bytes);}}
   changed();await commit();result=m.entries.length;
  }else if(m.type==='saves-export'){await commit();result=snapshot().filter(([p])=>p===SAVES||p.startsWith(SAVES+'/'));}
  else if(m.type==='saves-import'){
   // Only files under garrysmod/saves; everything is validated before anything is written.
   if(!Array.isArray(m.entries)||m.entries.length>100000)throw Error('Invalid save archive');
   for(const [p,bytes] of m.entries){safePath(p);if(!(p===SAVES||p.startsWith(SAVES+'/')))throw Error('Archive contains files outside saves/');if(bytes!==null&&!(bytes instanceof Uint8Array))throw Error('Invalid save data');}
   for(const [p,bytes] of m.entries){if(bytes===null)volume.mkdirSync(p,{recursive:true});else {volume.mkdirSync(path.dirname(p),{recursive:true});volume.writeFileSync(p,bytes);}}
   changed();await commit();result=m.entries.filter(([p,b])=>b!==null&&p.endsWith('.gms')).length;
  }else throw Error('Unknown storage request');
  postMessage({id:m.id,result});
 }catch(e){postMessage({id:m.id,type:m.type==='init'?'fatal':undefined,error:e.message});}
};
