import assert from 'node:assert/strict';
const {launchOptions}=await import('../web/launch-config.mjs');
const low=launchOptions({});assert.deepEqual(low.size,[960,540]);assert.match(low.command,/-w 960 -h 540 /);
const commands=low.command.split(' +');assert.ok(commands.includes('mat_picmip 2'));assert.ok(commands.includes('mat_antialias 0'));assert.ok(commands.includes('mat_hdr_level 0'));
const saved=launchOptions({saved:true});assert.doesNotMatch(saved.command,/-w \d+|-h \d+/,'saved resolution must not be overridden');assert.equal(saved.command.includes('+mat_picmip'),false,'saved user settings must take priority on later starts');
for(const cv of ['r_decals 0','r_dynamic 0']){assert.ok(saved.command.split(' +').includes(cv),'hidden performance cvars apply even with saved preferences: '+cv);}
const sized=launchOptions({saved:true,res:'640x360'});assert.deepEqual(sized.size,[640,360]);assert.match(sized.command,/-w 640 -h 360 /,'res overrides a saved resolution');assert.deepEqual(launchOptions({res:'bogus'}).size,[960,540]);
const fit=launchOptions({win:'1366x768',scale:'0.5'});assert.match(fit.command,/-w 1366 -h 768 /,'first run uses the window size');assert.match(fit.command,/\+mat_viewportscale 0\.5 \+mat_viewportupscale 1 /);
assert.match(launchOptions({saved:true,win:'1366x768',scale:'0.5'}).command,/-w 1366 -h 768 /,'the window size applies over a saved resolution');assert.doesNotMatch(low.command,/-console|viewportscale/);
const custom=launchOptions({cmdline:'+mat_picmip 0'});assert.ok(custom.command.endsWith('+mat_picmip 0'),'explicit launch commands take priority');
console.log('PASS lowest first-run defaults, saved preferences and explicit overrides');
