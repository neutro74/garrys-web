// Derma dialogs in place of the browser's own confirm(), prompt() and alert(): a small window in GMod's skin over a dimmed
// page, on top of everything. Enter picks the main button, Esc cancels. Works in the launcher, the in-game chat and the game's
// own menu pages (each document gets its own).
//   await dkConfirm(text, { title, ok, cancel, danger })            -> true | false
//   await dkPrompt(text, { title, value, placeholder, ok, password }) -> string | null
//   await dkAlert(text, { title, ok })
//   await dkChoose(text, { title, choices: [[id, label, main?], ...] }) -> id | null
import { dermaReady, icon } from './derma.js';

function modal({ title, message, iconName = 'information', input = null, buttons }) {
  dermaReady();
  return new Promise((resolve) => {
    const veil = document.createElement('div'); veil.className = 'dk dk-modal-veil';
    const win = document.createElement('div'); win.className = 'dk-window pop dk-modal'; win.setAttribute('role', 'dialog'); win.setAttribute('aria-modal', 'true');
    const head = document.createElement('div'); head.className = 'dk-title';
    const ic = new Image(); ic.className = 'si'; ic.alt = ''; ic.src = icon(iconName);
    const t = document.createElement('span'); t.textContent = title;
    const info = document.createElement('span'); info.className = 'dk-tinfo';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'dk-wbtn close'; x.setAttribute('aria-label', 'Close');
    head.append(ic, t, info, x);
    const body = document.createElement('form'); body.className = 'dk-panel dk-modal-body';
    const p = document.createElement('p'); p.className = 'dk-modal-text'; p.textContent = message; body.append(p);
    let field = null;
    if (input) {
      field = document.createElement('input'); field.type = input.password ? 'password' : 'text'; field.value = input.value ?? ''; field.placeholder = input.placeholder ?? '';
      field.spellcheck = false; field.autocomplete = input.password ? 'current-password' : 'off'; field.setAttribute('aria-label', message);
      body.append(field);
    }
    const row = document.createElement('div'); row.className = 'dk-modal-buttons';
    let main = null;
    for (const b of buttons) {
      const el = document.createElement('button'); el.type = b.main ? 'submit' : 'button'; el.className = 'dk-btn' + (b.main ? ' blue' : '') + (b.danger ? ' danger' : ''); el.textContent = b.label;
      if (!b.main) el.onclick = () => done(b.id);
      if (b.main) main = el;
      row.append(el);
    }
    body.append(row);
    win.append(head, body); veil.append(win);
    const back = document.activeElement;
    const done = (id) => { veil.remove(); document.removeEventListener('keydown', onKey, true); try { back?.focus?.({ preventScroll: true }); } catch { /* gone */ } resolve({ button: id, value: field?.value ?? null }); };
    body.onsubmit = (e) => { e.preventDefault(); done(buttons.find((b) => b.main)?.id ?? 'ok'); };
    x.onclick = () => done('cancel');
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) win.animate?.([{ translate: '-4px 0' }, { translate: '4px 0' }, { translate: '0 0' }], { duration: 160 }); });
    // Esc cancels; everything typed here stays here (the launcher's and the game's own keys are left alone).
    const onKey = (e) => {
      if (!veil.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); return; }
      if (e.key === 'Tab') {   // keep focus inside the dialog
        const f = [...win.querySelectorAll('input, button')]; const i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(veil);
    (field ?? main ?? row.querySelector('button'))?.focus();
    field?.select();
  });
}

export async function dkConfirm(message, { title = 'Are you sure?', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  const r = await modal({ title, message, iconName: danger ? 'error' : 'help', buttons: [{ id: 'ok', label: ok, main: true, danger }, { id: 'cancel', label: cancel }] });
  return r.button === 'ok';
}
export async function dkPrompt(message, { title = 'Garry\'s Web', value = '', placeholder = '', ok = 'OK', password = false } = {}) {
  const r = await modal({ title, message, iconName: password ? 'key' : 'pencil', input: { value, placeholder, password }, buttons: [{ id: 'ok', label: ok, main: true }, { id: 'cancel', label: 'Cancel' }] });
  return r.button === 'ok' ? r.value : null;
}
export async function dkAlert(message, { title = 'Garry\'s Web', ok = 'OK' } = {}) {
  await modal({ title, message, buttons: [{ id: 'ok', label: ok, main: true }] });
}
// A link or code to copy: shown selected, with Copy and Close.
export async function dkCopy(message, value, { title = 'Garry\'s Web' } = {}) {
  const p = modal({ title, message, iconName: 'link', input: { value }, buttons: [{ id: 'copy', label: 'Copy' }, { id: 'ok', label: 'Close', main: true }] });
  // Copy keeps the window open and says so; the field is read-only.
  queueMicrotask(() => {
    const win = [...document.querySelectorAll('.dk-modal')].pop(), field = win?.querySelector('input'), copy = win?.querySelector('.dk-modal-buttons button');
    if (!field) return;
    field.readOnly = true; field.select();
    copy.onclick = async () => { field.select(); try { await navigator.clipboard.writeText(value); } catch { document.execCommand?.('copy'); } copy.textContent = 'Copied'; };
  });
  await p;
}
export async function dkChoose(message, { title = 'Garry\'s Web', choices }) {
  const r = await modal({ title, message, iconName: 'help', buttons: [...choices.map(([id, label, main], i) => ({ id, label, main: main ?? i === 0 })), { id: 'cancel', label: 'Cancel' }] });
  return r.button === 'cancel' ? null : r.button;
}
