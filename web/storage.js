import {RPC_BYTES} from '../tools/lift/host/overlay-rpc.mjs';
import {libraryMeta,updateMeta,dropMeta,writeFile,checkGma,fileName,downloadWorkshop,hubJson,putVersion,getVersion,impact} from './library.js';
export async function openStorage({library=[]}={}){
 const worker=new Worker(new URL('./storage-worker.js', import.meta.url),{type:'module'}),buffer=new SharedArrayBuffer(RPC_BYTES),pending=new Map();let next=1;
 const ready=new Promise((resolve,reject)=>{worker.onmessage=({data:m})=>{if(m.type==='ready')resolve(m);else if(m.type==='fatal'){reject(Error(m.error));console.error('Storage:',m.error);}else {const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(m.error)):p.resolve(m.result);}};worker.onerror=e=>reject(Error(e.message));});
 worker.postMessage({type:'init',buffer,library});const info=await ready;
 return {buffer,worker,migrated:info.migrated??[],library:info.library??[],request(type,options={}){return new Promise((resolve,reject)=>{const id=next++;pending.set(id,{resolve,reject});worker.postMessage({type,id,...options});});}};
}
// A binary backup avoids base64's large memory expansion for saves and cached addons.
export function encodeBackup(entries){const enc=new TextEncoder(),parts=[enc.encode('GWB1')];for(const [p,bytes] of entries){const name=enc.encode(p),head=new Uint32Array([name.length,bytes===null?0xffffffff:bytes.length]);parts.push(head,name);if(bytes)parts.push(bytes);}return new Blob(parts,{type:'application/octet-stream'});}
export function decodeBackup(buffer){const b=new Uint8Array(buffer),dv=new DataView(buffer),dec=new TextDecoder('utf-8',{fatal:true});if(dec.decode(b.subarray(0,4))!=='GWB1')throw Error('Invalid backup');let p=4;const entries=[];while(p<b.length){if(p+8>b.length)throw Error('Truncated backup');const n=dv.getUint32(p,true),len=dv.getUint32(p+4,true);p+=8;if(!n||p+n>b.length)throw Error('Invalid backup path');const name=dec.decode(b.subarray(p,p+n));p+=n;if(len===0xffffffff)entries.push([name,null]);else{if(p+len>b.length)throw Error('Truncated backup');entries.push([name,b.slice(p,p+len)]);p+=len;}if(entries.length>100000)throw Error('Backup has too many files');}return entries;}

// Requests from GMod's own menu pages (web/menu-extras.js, injected by html-panels.js): addon install/removal and
// save import/export, so these live in the game's UI rather than over it.
const DISABLED='garrys-wasm.disabled-addons';
const disabledAddons=()=>{try{const v=JSON.parse(localStorage.getItem(DISABLED)??'[]');return Array.isArray(v)?v:[];}catch{return [];}};
// session: { version (a custom game version or null), active (Set of library names mounted in this launch) }.
export function menuHost(storage,p2p,{edition='base',startedOff='',lobby=null,session={version:null,active:new Set()}}={}){
 const wsProgress=new Map();
 // A newly installed addon joins this launch's set: the version's list, or the plain edition's "my addons".
 const addToSession=(name,info)=>{session.active.add(name);if(session.version){const v=getVersion(session.version.id)??session.version;if(!v.addons.some(a=>a.name===name))v.addons.push({name,id:info.id,title:info.title,size:info.size});session.version=putVersion(v);}else updateMeta(name,{global:true});};
 const removeFromSession=(name)=>{session.active.delete(name);if(session.version){const v=getVersion(session.version.id)??session.version;v.addons=v.addons.filter(a=>a.name!==name);session.version=putVersion(v);}else updateMeta(name,{global:false});};
 const disabledList=()=>session.version?(getVersion(session.version.id)?.disabled??[]):disabledAddons();
 const setDisabled=(list)=>{if(session.version){const v=getVersion(session.version.id)??session.version;v.disabled=list;session.version=putVersion(v);}else localStorage.setItem(DISABLED,JSON.stringify(list));};
 const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
 return async(op,args)=>{
  switch(op){
   case 'addons':{const meta=libraryMeta(),out=[];
    for(const name of session.active){let m=meta[name]??{};
     if(!m.title||m.type===undefined){try{const i=await storage.request('library-info',{name});m=updateMeta(name,{title:m.title||i.title,type:i.type,description:i.description});}catch{}}
     out.push({file:name,title:m.title||name,size:m.size??0,type:m.type??'',description:m.description??'',wsid:m.id??null,impact:impact(m.size??0)});}
    return out;}
   case 'install-addon':{const file=args.file;if(!(file instanceof Blob))throw Error('No file');await checkGma(file);
    const name=fileName(file.name||'addon');const size=await writeFile(name,file);updateMeta(name,{title:String(file.name||name).replace(/\.gma$/i,''),size,added:Date.now()});
    await storage.request('library-add',{name});addToSession(name,{title:file.name,size});return name;}
   case 'remove-addon':{const name=String(args.name);removeFromSession(name);await storage.request('library-remove',{name});dropMeta(name);return true;}
   // Bundled addons (Extended): their list and pictures from the edition tree, and an on/off switch applied at next start.
   case 'bundled-addons':{if(edition!=='extended')return {edition,addons:[]};const base=new URL('../game/ext/',import.meta.url);
    const r=await fetch(new URL('wasm-addons.json',base));if(!r.ok)return {edition,addons:[]};const off=new Set(disabledList());
    return {edition,startedOff,addons:(await r.json()).map(a=>({...a,enabled:!off.has(a.name),preview:a.preview?new URL(a.preview,base).href:null}))};}
   // Restart into the same edition and graphics preset (launcher.js reads this once and skips its menu).
   case 'workshop-browse':{const q=new URLSearchParams();for(const k of ['sort','tag','q','page'])if(args[k])q.set(k,String(args[k]));return hubJson('ws/browse?'+q);}
   case 'workshop-details':return (await hubJson('ws/details?ids='+encodeURIComponent([].concat(args.ids).join(',')))).items;
   case 'workshop-install':{const id=String(args.id);const set=p=>wsProgress.set(id,{...wsProgress.get(id),...p});
    try{set({phase:'preparing',loaded:0,total:0});const name=await downloadWorkshop(id,{title:args.title,onProgress:set});set({phase:'installing'});
     await storage.request('library-add',{name});const m=libraryMeta()[name];addToSession(name,{id,title:m.title,size:m.size});set({phase:'done'});return name;}
    catch(e){set({phase:'error',error:e.message});throw e;}}
   case 'workshop-progress':return wsProgress.get(String(args.id))??null;
   case 'impact':return impact(+args.size||0,{count:+args.count||1});
   case 'restart':try{sessionStorage.setItem('garrys-wasm.resume',JSON.stringify(globalThis.__launch??{edition,version:session.version?.id}));}catch{}setTimeout(()=>location.reload(),100);return true;
   case 'set-addon-enabled':{const name=String(args.name);if(!/^[a-z0-9_.-]+$/i.test(name))throw Error('Invalid addon name');
    const off=new Set(disabledList());if(args.enabled)off.delete(name);else off.add(name);try{setDisabled([...off]);}catch{throw Error('This browser blocked saving the setting');}return [...off];}
   case 'export-saves':{const entries=await storage.request('saves-export'),count=entries.filter(([p,b])=>b&&p.endsWith('.gms')).length;
    if(!count)throw Error('There are no saves to export');download(encodeBackup(entries),'gmod-saves.gwb');return count;}
   case 'import-saves':{if(!(args.bytes instanceof ArrayBuffer))throw Error('No file');if(args.bytes.byteLength>512*1024*1024)throw Error('Archive exceeds 512 MB');
    return storage.request('saves-import',{entries:decodeBackup(args.bytes)});}
   case 'p2p-status':return p2p?p2p.status():{disabled:true};
   case 'p2p-invite':if(!p2p)throw Error('Peer-to-peer play is not enabled');return p2p.createInvite();
   case 'p2p-finish':if(!p2p)throw Error('Peer-to-peer play is not enabled');await p2p.finishInvite(args.code);return p2p.status();
   case 'p2p-accept':if(!p2p)throw Error('Peer-to-peer play is not enabled');return p2p.acceptInvite(args.code);
   // Hub lobbies (web/lobby.js): list, host and join peer-to-peer games without copying codes.
   // Real servers (hub/servers.mjs), for the server browser in menu-extras.js.
   case 'server-list':return hubJson('servers');
   case 'server-info':return hubJson('servers/info?addr='+encodeURIComponent(String(args.addr)));
   case 'server-players':return hubJson('servers/players?addr='+encodeURIComponent(String(args.addr)));
   case 'lobby-status':if(!lobby?.available)return {disabled:true};lobby.connect();return lobby.status();
   case 'lobby-host':if(!lobby)throw Error('Peer-to-peer play is not enabled');return lobby.host(args);
   case 'lobby-unhost':if(!lobby)throw Error('Peer-to-peer play is not enabled');return lobby.unhost();
   case 'lobby-join':if(!lobby)throw Error('Peer-to-peer play is not enabled');return lobby.join(String(args.id));
   case 'lobby-linked':return !!lobby?.linked();
   case 'p2p-leave':lobby?.leave();if(!p2p)throw Error('Peer-to-peer play is not enabled');p2p.leave();return p2p.status();
   default:throw Error(`Unknown request ${op}`);
  }
 };
}
