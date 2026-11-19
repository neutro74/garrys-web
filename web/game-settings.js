// The game settings chosen on the launcher's Options tab, applied as console commands on every start (web/main.js).
// Graphics quality is always applied: the engine keeps part of its video settings (anisotropy, specular, shadow
// rendering...) only in the Windows registry, which the browser build does not keep, so without this every start after
// the first got the engine's defaults for the GPU, which are high. Volume, sensitivity and field of view are applied only
// when set here; otherwise the game's own (config.cfg) values stay.
//   gameSettings() -> { graphics, fps, showfps, volume?, sensitivity?, fov? }; setGameSettings(patch); settingsCommand()
const KEY = 'garrys-wasm.game-settings';

export const GRAPHICS = {
  low: { label: 'Low', note: 'Fastest. Blurrier textures, no shadows or reflections.', cvars: {
    mat_picmip: 2, r_rootlod: 2, mat_antialias: 0, mat_aaquality: 0, mat_forceaniso: 1, mat_trilinear: 0, mat_hdr_level: 0, mat_reducefillrate: 1,
    r_shadowrendertotexture: 0, r_shadows: 0, r_waterforceexpensive: 0, r_waterforcereflectentities: 0, mat_specular: 0, mat_bumpmap: 0,
    mat_motion_blur_enabled: 0, mat_colorcorrection: 0, r_3dsky: 0, r_drawdetailprops: 0, cl_detaildist: 0, cl_detailfade: 0 } },
  medium: { label: 'Medium', note: 'Sharper textures, blob shadows, shiny surfaces and the 3D sky.', cvars: {
    mat_picmip: 1, r_rootlod: 1, mat_antialias: 0, mat_aaquality: 0, mat_forceaniso: 2, mat_trilinear: 1, mat_hdr_level: 0, mat_reducefillrate: 0,
    r_shadowrendertotexture: 0, r_shadows: 1, r_waterforceexpensive: 0, r_waterforcereflectentities: 0, mat_specular: 1, mat_bumpmap: 1,
    mat_motion_blur_enabled: 0, mat_colorcorrection: 1, r_3dsky: 1, r_drawdetailprops: 1, cl_detaildist: 1200, cl_detailfade: 400 } },
  high: { label: 'High', note: 'Full textures, HDR, shadows and water reflections. Slow on most Chromebooks.', cvars: {
    mat_picmip: 0, r_rootlod: 0, mat_antialias: 0, mat_aaquality: 0, mat_forceaniso: 4, mat_trilinear: 1, mat_hdr_level: 2, mat_reducefillrate: 0,
    r_shadowrendertotexture: 1, r_shadows: 1, r_waterforceexpensive: 1, r_waterforcereflectentities: 0, mat_specular: 1, mat_bumpmap: 1,
    mat_motion_blur_enabled: 0, mat_colorcorrection: 1, r_3dsky: 1, r_drawdetailprops: 1, cl_detaildist: 1200, cl_detailfade: 400 } },
};
// The browser paces frames at 30 unless fps_max is given (web/launch-config.mjs); 60 and unlimited hand pacing to the engine.
export const FPS = { 30: { label: '30', cmd: '' }, 60: { label: '60', cmd: '+fps_max 60' }, max: { label: 'No limit', cmd: '+fps_max 300' } };
// The sliders: [min, max, step, the game's default].
export const SLIDERS = { volume: [0, 1, 0.05, 1], sensitivity: [0.5, 10, 0.5, 3], fov: [75, 100, 1, 75] };

export function gameSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* blocked or broken: defaults */ }
  const out = { graphics: GRAPHICS[s.graphics] ? s.graphics : 'low', fps: FPS[s.fps] ? s.fps : '30', showfps: !!s.showfps };
  for (const [k, [lo, hi]] of Object.entries(SLIDERS)) if (typeof s[k] === 'number' && s[k] >= lo && s[k] <= hi) out[k] = s[k];
  return out;
}
export function setGameSettings(patch) {
  const s = { ...gameSettings(), ...patch };
  for (const k of Object.keys(SLIDERS)) if (s[k] == null) delete s[k];
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked */ }
  return gameSettings();
}
export function settingsCommand(s = gameSettings()) {
  const parts = Object.entries(GRAPHICS[s.graphics].cvars).map(([k, v]) => `+${k} ${v}`);
  if (FPS[s.fps].cmd) parts.push(FPS[s.fps].cmd);
  parts.push(`+cl_showfps ${s.showfps ? 1 : 0}`);
  if (s.volume != null) parts.push(`+volume ${s.volume}`);
  if (s.sensitivity != null) parts.push(`+sensitivity ${s.sensitivity}`);
  if (s.fov != null) parts.push(`+fov_desired ${s.fov}`);
  return parts.join(' ');
}
