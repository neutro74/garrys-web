#!/usr/bin/env node
// Assembles the "Extended" edition's content tree from SteamCMD downloads (see packs/extended/dl.sh and ws.sh):
// the CS:S / HL2 / HL2:DM game folders, a few Workshop addons as .gma files, and a mount.cfg that mounts the folders.
// The tree is laid out as it appears under the install root (c:\gamebox), so it can be merged over the base index.
//   node tools/build-extended.mjs [--dl packs/extended/dl] [--out packs/extended/root] [--addons-only]
// --addons-only rebuilds just garrysmod/addons inside an existing tree (the game folders are left alone).
// Never reads the user's installed addons: only what SteamCMD downloaded anonymously into --dl.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGma } from '../ports/gmod/compat/addons.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const dl = path.resolve(arg('dl', path.join(repo, 'packs/extended/dl')));
const out = path.resolve(arg('out', path.join(repo, 'packs/extended/root')));
const addonsOnly = process.argv.includes('--addons-only');
if (addonsOnly ? !fs.existsSync(out) : fs.existsSync(out)) throw Error(addonsOnly ? `${out} does not exist; build it first` : `${out} exists; remove it first`);

// Dedicated-server leftovers (binaries, caches, downloads) are not game content.
const skip = (src) => {
  const b = path.basename(src).toLowerCase();
  if (['bin', 'download', 'custom', 'cfg', 'media', 'steamapps'].includes(b) && fs.statSync(src).isDirectory()) return false;
  return !(b.endsWith('.cache') || b === 'steam.inf');
};
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true, filter: skip, mode: fs.constants.COPYFILE_FICLONE });
const mounts = [];
if (!addonsOnly) {
copyDir(path.join(dl, 't232330/cstrike'), path.join(out, 'cstrike'));
copyDir(path.join(dl, 't232330/hl2'), path.join(out, 'hl2'));
// The dedicated-server depot ships these directory files without their data archives (textures, most sounds);
// a read into a missing archive would fail inside the engine, so they are left out.
for (const f of ['hl2_sound_misc_dir.vpk', 'hl2_sound_vo_english_dir.vpk', 'hl2_textures_dir.vpk']) fs.rmSync(path.join(out, 'hl2', f));
copyDir(path.join(dl, 't232370/hl2mp'), path.join(out, 'hl2mp'));
copyDir(path.join(dl, 't232290/dod'), path.join(out, 'dod'));
mounts.push('hl2', 'cstrike', 'hl2mp', 'dod');

// Optional: games the user has installed in their own Steam library (read-only; nothing in Steam is modified).
// A game folder counts only when every archive its *_dir.vpk names is present, so a half-installed game is skipped.
const steam = process.env.STEAM_COMMON ?? path.join(process.env.HOME, '.local/share/Steam/steamapps/common');
const own = path.join(dl, 'own');   // games installed with the user's own SteamCMD login (packs/extended/own.sh)
const complete = (dir) => {
  const dirs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('_dir.vpk')) : [];
  return dirs.length > 0 && dirs.every((f) => { const stem = f.slice(0, -8); return fs.readdirSync(dir).some((g) => g.startsWith(stem + '_') && /_\d{3}\.vpk$/.test(g)) || fs.statSync(path.join(dir, f)).size > 50 << 20; });
};
const LOCAL = [['hl2', 'hl2'], ['episodic', 'episodic'], ['ep2', 'ep2'], ['lostcoast', 'lostcoast'], ['portal', 'portal'], ['hl1', 'hl1']].map(([r, n]) => [path.join(own, r), n])
  .concat([['Half-Life 2/hl2', 'hl2'], ['Half-Life 2/episodic', 'episodic'], ['Half-Life 2/ep2', 'ep2'], ['Half-Life 2/lostcoast', 'lostcoast'], ['Portal/portal', 'portal'], ['Portal 2/portal2', 'portal2']].map(([r, n]) => [path.join(steam, r), n]));
const local = [];
for (const [rel, name] of LOCAL) {
  const src = rel;
  if (local.includes(name) || !complete(src)) continue;
  fs.rmSync(path.join(out, name), { recursive: true, force: true });   // a full install replaces the dedicated-server subset
  copyDir(src, path.join(out, name)); local.push(name);
  if (!mounts.includes(name)) mounts.push(name);
}
if (local.length) console.log('from the local Steam library:', local.join(', '));

}

// Workshop id -> file name in garrysmod/addons. Old items arrive LZMA-compressed as *_legacy.bin.
const ADDONS = {
  // Gamemodes (pick from the Start New Game screen; a gamemode's code only runs when chosen, so the multiplayer ones cost
  // singleplayer nothing). Stranded works alone, on its own island map; the rest are for peer-to-peer games.
  133364818: 'stranded', 169802523: 'gms_sand_islands',
  143190159: 'prop_hunt', 187073946: 'murder', 105462463: 'zombie_survival', 266512527: 'hide_and_seek',
  // NPC bases and packs
  131759821: 'vj_base', 1560118657: 'drgbase', 1947641829: 'vj_zombies', 597017711: 'zombie_invasion', 3541699236: 'drg_bon_rabbit',
  // Weapons
  128089118: 'm9k_assault_rifles', 128093075: 'm9k_small_arms', 128091208: 'm9k_heavy_weapons', 144982052: 'm9k_specialties',
  2840031720: 'tfa_base', 111412589: 'lightsabers',
  // Vehicles (simfphys ships drivable cars on top of its base)
  771487490: 'simfphys_base',
  // Building tools
  160250458: 'wiremod', 773402917: 'advdupe2', 104575630: 'ragdoll_mover', 264467687: 'improved_stacker', 457478322: 'precision_alignment',
  // Big maps
  105982362: 'gm_bigcity', 326332456: 'gm_fork',
};
const ws = path.join(dl, 'ws/steamapps/workshop/content/4000');
if (addonsOnly) fs.rmSync(path.join(out, 'garrysmod/addons'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'garrysmod/addons'), { recursive: true });
const manifest = [];
const magic = (b) => b.subarray(0, 4).toString('latin1') === 'GMAD';
for (const [id, name] of Object.entries(ADDONS)) {
  const dir = path.join(ws, id);
  const files = fs.readdirSync(dir).filter((f) => /\.(gma|bin)$/.test(f)).sort((a, b) => Number(b.endsWith('.gma')) - Number(a.endsWith('.gma')));
  const file = files[0];
  let bytes = fs.readFileSync(path.join(dir, file));
  if (!magic(bytes)) {
    // Workshop's legacy LZMA streams can carry a bad end marker; the payload before it is complete (verified by the GMA checks).
    try { bytes = execFileSync('xz', ['-dc', '--format=lzma'], { input: bytes, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] }); } catch (e) { bytes = e.stdout ?? Buffer.alloc(0); }
  }
  if (!magic(bytes)) throw Error(`${id}: not a GMA`);
  // Extracted as a legacy addon folder: the filesystem mounts garrysmod/addons/<name>/ at startup, so the addon's maps,
  // models and Lua exist from the first frame. (Loose .gma files are only mounted later, after the main menu.)
  const addon = readGma(bytes, { maxBytes: 1 << 30, strictArchiveCrc: false });
  for (const [rel, data] of addon.files) {
    const dst = path.join(out, 'garrysmod/addons', name, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, data);
  }
  // Zombie Invasion ships enabled and spawns zombies on every map's AI nodes (they rained from the sky in gm_construct). Default it off;
  // players can still turn it on with `zinv 1` or its tool menu.
  if (name === 'zombie_invasion') {
    const f = path.join(out, 'garrysmod/addons', name, 'lua/autorun/zinv_shared.lua');
    const t = fs.readFileSync(f, 'utf8');
    const t2 = t.replace(`CreateConVar("zinv", '1'`, `CreateConVar("zinv", '0'`);
    if (t === t2) throw Error('zombie_invasion: zinv default not found');
    fs.writeFileSync(f, t2);
  }
  fs.writeFileSync(path.join(out, 'garrysmod/addons', name, 'addon.json'), JSON.stringify({ title: addon.name, type: 'tool', tags: [] }));
  let meta = {}; try { meta = JSON.parse(addon.description); } catch { /* plain-text description */ }
  manifest.push({ name, id, title: addon.name, type: String(meta.type ?? '').toLowerCase(), tags: meta.tags ?? [], author: addon.author,
    size: [...addon.files.values()].reduce((a, d) => a + d.length, 0) });
}

// The in-game Addons page (web/menu-extras.js) lists the bundled addons from wasm-addons.json, with each Workshop item's
// preview picture (downloaded once here, 256 px, from Steam's public API) beside it. Missing pictures are fine.
fs.rmSync(path.join(out, 'wasm-addons'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'wasm-addons'), { recursive: true });
try {
  const body = new URLSearchParams({ itemcount: String(manifest.length) });
  manifest.forEach((a, i) => body.set(`publishedfileids[${i}]`, a.id));
  const r = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', body });
  const details = (await r.json()).response.publishedfiledetails;
  for (const d of details) {
    const a = manifest.find((m) => m.id === d.publishedfileid);
    if (!a || !d.preview_url) continue;
    a.description = String(d.description ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
    try {
      const img = await fetch(d.preview_url + (d.preview_url.includes('?') ? '&' : '?') + 'imw=256&imh=256&ima=fit&impolicy=Letterbox');
      if (!img.ok) continue;
      let bytes = Buffer.from(await img.arrayBuffer()), ext = /png/.test(img.headers.get('content-type')) ? 'png' : 'jpg';
      // Animated GIF previews (megabytes each) become the first frame as a small JPEG.
      if (bytes.subarray(0, 3).toString('latin1') === 'GIF') {
        const tmp = path.join(out, 'wasm-addons', `${a.name}.gif`);
        try { fs.writeFileSync(tmp, bytes); bytes = execFileSync('magick', [`${tmp}[0]`, '-resize', '256x256', '-quality', '85', 'jpg:-'], { maxBuffer: 64 << 20 }); ext = 'jpg'; } catch { continue; } finally { fs.rmSync(tmp, { force: true }); }
      }
      fs.writeFileSync(path.join(out, 'wasm-addons', `${a.name}.${ext}`), bytes);
      a.preview = `wasm-addons/${a.name}.${ext}`;
    } catch { /* no picture */ }
  }
} catch (e) { console.log('addon previews skipped:', e.message); }
fs.writeFileSync(path.join(out, 'wasm-addons.json'), JSON.stringify(manifest, null, 1));

if (!addonsOnly) {
fs.mkdirSync(path.join(out, 'garrysmod/cfg'), { recursive: true });
fs.writeFileSync(path.join(out, 'garrysmod/cfg/mount.cfg'), `// Extended edition: Source content mounted from the bundled game folders.
"mountcfg"
{
${mounts.map((m) => `\t"${m}"\t\t"c:\\gamebox\\${m}"`).join('\n')}
}
`);

// GMod only mounts a game whose depot is switched on here (the Games menu edits this file), on top of the Steam app checks.
const depots = [...new Set([...mounts, 'ep1', 'tf'])];
fs.writeFileSync(path.join(out, 'garrysmod/cfg/mountdepots.txt'), `"gamedepotsystem"\n{\n${depots.map((d) => `\t"${d}"\t\t"1"`).join('\n')}\n}\n`);

}

const index = (dir) => Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() || e.isDirectory())
  .map((e) => [e.name, e.isDirectory() ? index(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size]));
const tree = index(out);
const sum = (n) => Object.values(n).reduce((a, v) => a + (typeof v === 'number' ? v : sum(v)), 0);
console.log(JSON.stringify({ out, files: JSON.stringify(tree).split(':').length, MiB: Math.round(sum(tree) / 1048576) }));
