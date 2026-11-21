// Human-like test of the Subtext panel: real mouse clicks and key presses through the CEP debug
// port (localhost:8099, dev install only), checks of the result in After Effects after every step.
// Needs: AE open with research/out/subtext-test.aep (it has the voice-over), the Subtext panel open.
// Prints one JSON object { test, results: [{ n, ok, i }] } — scripts/test.sh turns it into the report.
// Usage: node tests/ui/flow.js [--skip-transcribe]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || 8099;
const COMP = 'AT ui 9x16';
const results = [];
const transients = [];
const check = (n, ok, info) => { results.push({ n, ok: !!ok, i: info === undefined ? '' : String(info) }); if (process.env.VERBOSE) console.error((ok ? 'PASS ' : 'FAIL ') + n + (info !== undefined ? '  · ' + info : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- After Effects ----------
function ae(snippet) {
  const f = path.join(os.tmpdir(), 'subtext_ui_' + process.pid + '.jsx');
  fs.writeFileSync(f, `var ROOT = ${JSON.stringify(ROOT)};\n` + fs.readFileSync(path.join(ROOT, 'tests/ae/_lib.jsx'), 'utf8') + '\n' + snippet);
  // AE may still be busy with the panel's own work, so wait up to 5 minutes for the answer
  const out = execFileSync(path.join(ROOT, 'research/ae_run.sh'), [f], { encoding: 'utf8', timeout: 330000, env: Object.assign({}, process.env, { AE_WAIT: '1500' }) }).trim();
  fs.unlinkSync(f);
  if (out.indexOf('ERROR:') === 0 || out.indexOf('(no result') === 0) throw new Error('AE: ' + out.slice(0, 200));
  if (out[0] === '{' || out[0] === '[') { let j; try { j = JSON.parse(out); } catch (e) { throw new Error('AE answer is not readable: ' + out.slice(0, 200)); } if (j && j.flashN) transients.push(String(j.flashError).split('\n')[0]); return j; }
  return out;
}
// Captions in the test comp: count, outside-safe list, distinct baselines, expression errors, ids with times.
const AE_STATE = `
var c = null; for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") c = app.project.item(i);
var caps = captions(c), bl = {}, nb = 0, ids = [], rows = 0, sizes = {}, ns = 0;
for (var j = 0; j < caps.length; j++) {
  var r = compRect(caps[j], mid(caps[j])), b = Math.round(r.by);
  if (!bl[b]) { bl[b] = 1; nb++; }
  var t = String(caps[j].property("ADBE Text Properties").property("ADBE Text Document").value.text);
  rows = Math.max(rows, t.split("\\r").length);
  var fz = fontSize(caps[j]); if (!sizes[fz]) { sizes[fz] = 1; ns++; }
  ids.push([caps[j].comment, Math.round(caps[j].inPoint * 1000), Math.round(caps[j].outPoint * 1000), t]);
}
var e = exprErrors(c);
// an error that is gone once AE evaluates again (move the time a frame and back) was only shown mid-update
var e2 = e; if (e.n) { var t0 = c.time; c.time = t0 + c.frameDuration; c.time = t0; e2 = exprErrors(c); }
enc({ n: caps.length, outside: inSafe(c, caps), baselines: nb, errors: e2.n, firstError: e2.first, flashN: e.n - e2.n, flashError: e.n > e2.n ? e.first : "", ids: ids, maxRows: rows, sizes: ns, boxes: boxLayers(c) });`;

// ---------- panel (Chrome DevTools Protocol) ----------
let ws, seq = 0;
async function connect() {
  const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const page = pages.find((p) => p.title === 'Subtext') || pages[0];
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
}
function send(method, params) {
  return new Promise((res) => {
    const my = ++seq;
    const h = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', h); res(d.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('panel: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function pointOf(sel) {
  return js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2];`);
}
async function click(sel, opt = {}) {
  const p = await pointOf(sel);
  if (!p) throw new Error('not on screen: ' + sel);
  const [x, y] = p, modifiers = opt.shift ? 8 : 0;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
  for (let n = 1; n <= (opt.double ? 2 : 1); n++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n, modifiers });
    await sleep(90);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n, modifiers });
    await sleep(110);
  }
  await sleep(opt.wait || 600);
}
const KEYS = { Enter: 13, Escape: 27, Backspace: 8, b: 66, z: 90, a: 65, ArrowDown: 40, ArrowUp: 38 };
async function key(k, mods = '') {
  const m = (mods.includes('meta') ? 4 : 0) + (mods.includes('shift') ? 8 : 0);
  const base = { modifiers: m, windowsVirtualKeyCode: KEYS[k], code: k.length === 1 ? 'Key' + k.toUpperCase() : k, key: k.length === 1 ? (mods.includes('shift') ? k.toUpperCase() : k) : k };
  if (k === 'a' && mods.includes('meta')) base.commands = ['selectAll'];
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k.length === 1 && !m) await send('Input.dispatchKeyEvent', { type: 'char', text: k, ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(450);
}
async function type(text) { await send('Input.insertText', { text }); await sleep(250); }
async function idle(limit = 240000) {
  const t0 = Date.now();
  await sleep(1200);
  while (Date.now() - t0 < limit) {
    const busy = await js(`return document.querySelector('#trBtn').disabled && !!document.querySelector('#trBtn').offsetParent || document.querySelector('#applyBtn').textContent.indexOf('Updating') >= 0 || document.body.classList.contains('busy')`);
    if (!busy) break;
    await sleep(700);
  }
  await sleep(900);
}
const panel = () => js(`
  const q = (s) => document.querySelector(s);
  return {
    comp: q('#compName').textContent,
    modes: [...document.querySelectorAll('.grp.mode .ib.on')].map((b) => b.dataset.mode),
    maxRows: q('#maxRows').value, lim: q('#fmtLim').textContent, hint: q('#rowsHint').textContent,
    rows: [...document.querySelectorAll('#list .ln .t')].map((t) => t.innerText.split('\\n').length),
    texts: [...document.querySelectorAll('#list .ln .t')].map((t) => t.innerText.replace(/\\n/g, ' ')),
    over: document.querySelectorAll('#list .ln.over').length,
    versions: q('#verSel').options.length, toast: q('#toast').textContent, editing: !!q('#list textarea'),
    sel: q('#list .ln.sel') ? +q('#list .ln.sel').dataset.i : null,
  };`);
async function tab(t) { await click(`.tab[data-tab="${t}"]`); }
async function setRows(n) {
  await click('#maxRows', { wait: 200 });
  await key('a', 'meta');
  await type(String(n));
  await key('Enter');
  await sleep(500);
}
async function step(name, fn) {
  try { await fn(); } catch (e) { check(name + ' — crashed', false, e.message.split('\n')[0]); }
}

(async () => {
  const skipTranscribe = process.argv.includes('--skip-transcribe');
  await connect();
  // fresh panel with the current code
  await js('location.reload(); return 1').catch(() => {});
  await sleep(4000);
  await connect();

  await step('setup', async () => {
    const r = ae(`
      var vo = null; for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof FootageItem && it.hasAudio && !it.hasVideo) vo = it; }
      var c = freshComp("${COMP}", 1080, 1920, 30);
      if (vo) { var a = c.layers.add(vo); a.startTime = 0; }
      c.workAreaStart = 0; c.workAreaDuration = 30;
      enc({ vo: vo ? vo.name : null, id: c.id, project: app.project.file ? app.project.file.fsName : "unsaved" })`);
    check('setup: test comp with the voice-over', r.vo, r.vo);
    // AE reuses comp ids after a project is reopened: plant a leftover draft of another comp under this id
    // (found by the 15 Nov run: the panel opened someone else's 243 lines and Max rows 2)
    const junk = { doc: { v: 1, uid: 'other-comp', versions: [{ n: 1, lines: [{ id: 'x', words: [[0, 1, 'Leftover']] }], mode: 'words' }], vi: 0, maxRows: 7, fx: [], savedAt: 1 }, savedAt: Date.now(), dirty: 1, comp: 'Another comp' };
    await js(`localStorage.setItem(${JSON.stringify('subtext.draft:' + r.project + ':' + r.id)}, ${JSON.stringify(JSON.stringify(junk))}); location.reload(); return 1`).catch(() => {});
    await sleep(4000);
    await connect();
    await sleep(1500);
    const p = await panel();
    check('panel follows the active comp', p.comp === COMP, p.comp);
    check('a leftover draft of another comp with the same id is ignored', p.rows.length === 0 && p.maxRows === '2', p.rows.length + ' lines · Max rows ' + p.maxRows);
  });

  // ----- transcribe -----
  await step('transcribe', async () => {
    await tab('voice');
    await click('#trBtn', { wait: 1000 });
    await idle();
    const p = await panel();
    check('Transcribe → lines appear', p.rows.length > 5, p.rows.length + ' lines');
    check('new transcription starts in Auto (highlighted)', p.modes.join() === 'fit', p.modes.join());
    check('Max rows shows the format default (2)', p.maxRows === '2', p.maxRows);
    check('Auto: no caption above 2 rows', Math.max(...p.rows) <= 2, Math.max(...p.rows));
  });

  // ----- grouping modes are a highlighted choice -----
  let autoCount = 0, wordCount = 0;
  await step('modes', async () => {
    await tab('lines');
    autoCount = (await panel()).rows.length;
    await click('#modeSent');
    let p = await panel();
    check('Sentences: only Sentences is highlighted', p.modes.join() === 'sent', p.modes.join());
    check('Sentences: no caption above 2 rows', Math.max(...p.rows) <= 2, Math.max(...p.rows));
    await click('#modeWords');
    p = await panel(); wordCount = p.rows.length;
    check('Words: only Words is highlighted', p.modes.join() === 'words', p.modes.join());
    check('Words: one word per caption', p.texts.every((t) => t.trim().split(' ').length === 1), p.rows.length + ' captions');
    check('Words: says that Max rows does not apply', /ignores/.test(p.hint), p.hint);
    await click('#modeFit');
    p = await panel();
    check('Auto: highlighted again and same result as before', p.modes.join() === 'fit' && p.rows.length === autoCount, p.rows.length + ' vs ' + autoCount);
  });

  // ----- Max rows -----
  await step('max rows', async () => {
    await setRows(3);
    let p = await panel();
    check('Max rows 3: field and header updated', p.maxRows === '3' && /max 3 rows/.test(p.lim), p.maxRows + ' · ' + p.lim);
    check('Max rows 3: Auto rebuilt with up to 3 rows', Math.max(...p.rows) === 3, 'max ' + Math.max(...p.rows));
    check('Max rows 3: fewer captions than with 2', p.rows.length < autoCount, p.rows.length + ' < ' + autoCount);
    check('Max rows 3: Auto stays highlighted', p.modes.join() === 'fit', p.modes.join());
    const n3 = p.rows.length;
    await click('#list', { wait: 300 });
    await key('z', 'meta');
    p = await panel();
    check('⌘Z undoes Max rows (back to 2 and the old captions)', p.maxRows === '2' && p.rows.length === autoCount, p.maxRows + ' · ' + p.rows.length);
    await key('z', 'meta+shift');
    p = await panel();
    check('⌘⇧Z redoes it', p.maxRows === '3' && p.rows.length === n3, p.maxRows + ' · ' + p.rows.length);
    await click('#modeSent');
    p = await panel();
    check('Sentences with Max rows 3: no caption above 3 rows', Math.max(...p.rows) <= 3, Math.max(...p.rows));
    await setRows(20);
    p = await panel();
    check('Max rows 20 is accepted (any number)', p.maxRows === '20', p.maxRows);
    check('Max rows 20: Sentences rebuilt, mode kept', p.modes.join() === 'sent' && Math.max(...p.rows) <= 20, p.modes.join() + ' · max ' + Math.max(...p.rows));
    await setRows('abc');
    p = await panel();
    check('typing letters keeps the previous number', p.maxRows === '20', p.maxRows);
    await setRows(3);
    await click('#modeFit');
    p = await panel();
    check('back to Auto · 3 rows', p.modes.join() === 'fit' && p.maxRows === '3', p.modes.join() + ' · ' + p.maxRows);
  });

  // ----- layers in AE -----
  let before = null;
  await step('create layers', async () => {
    const lines = (await panel()).rows.length;
    await click('#applyBtn', { wait: 1000 });
    await idle();
    const a = ae(AE_STATE);
    check('Create layers: one layer per line', a.n === lines, a.n + ' / ' + lines);
    check('Create layers: up to 3 rows in AE too', a.maxRows === 3, a.maxRows);
    check('every caption on one bottom baseline', a.baselines === 1, a.baselines);
    check('all captions inside the safe zone', a.outside.length === 0, a.outside.join('; '));
    check('no expression errors', a.errors === 0, a.firstError);
    check('one font size', a.sizes === 1, a.sizes);
    before = a;
  });

  // ----- editing in the list -----
  await step('editing', async () => {
    let p = await panel();
    const n0 = p.rows.length;
    await click('#list .ln[data-i="1"] .t', { double: true });
    p = await panel();
    check('double-click opens the editor', p.editing);
    await key('a', 'meta');
    await type('Edited by the test');
    await key('Enter');
    p = await panel();
    check('Enter saves the edited text', p.texts[1] === 'Edited by the test', p.texts[1]);
    await click('#list .ln[data-i="2"] .t');
    await click('#list .ln[data-i="3"] .t', { shift: true });
    p = await panel();
    check('⇧-click merges two captions', p.rows.length === n0 - 1, p.rows.length + ' vs ' + n0);
    await click('#list .ln[data-i="2"] .t');
    await key('b');
    p = await panel();
    check('B splits the selected caption', p.rows.length === n0, p.rows.length);
    await click('#list .ln[data-i="4"] .t');
    await key('Backspace');
    p = await panel();
    check('⌫ deletes the selected caption', p.rows.length === n0 - 1, p.rows.length);
    await key('z', 'meta');
    p = await panel();
    check('⌘Z brings it back', p.rows.length === n0, p.rows.length);
    await click('#applyBtn', { wait: 1000 });
    await idle();
    const a = ae(AE_STATE);
    check('Update: edited text is in AE', a.ids.some((x) => x[3].replace(/\r/g, ' ') === 'Edited by the test'), '');
    check('Update: layer count matches the list', a.n === p.rows.length, a.n + ' / ' + p.rows.length);
    check('Update: still inside the safe zone, no errors', a.outside.length === 0 && a.errors === 0, a.outside.join('; ') + ' ' + a.firstError);
    before = a;
  });

  // ----- style -----
  await step('style', async () => {
    await tab('style');
    for (const i of [0, 1, 2, 3, 4, 5]) {
      await click(`#pres .pr[data-p="${i}"]`, { wait: 800 });
      await idle();
      const a = ae(AE_STATE);
      check(`preset ${i + 1}: no errors, inside the safe zone`, a.errors === 0 && a.outside.length === 0, a.firstError + ' ' + a.outside.join('; '));
    }
    for (const fx of ['karaoke', 'accent', 'adaptive', 'textbox']) {
      await click(`.fx[data-fx="${fx}"]`, { wait: 800 });
      await idle();
      const a = ae(AE_STATE);
      check(`${fx} toggle: no expression errors`, a.errors === 0, a.firstError);
    }
    await click('#tFit', { wait: 800 });
    await idle();
    const a = ae(AE_STATE);
    check('Fit to safe zone: everything inside', a.outside.length === 0 && a.baselines === 1, a.outside.join('; ') + ' baselines ' + a.baselines);
    before = a;
  });

  // ----- partial re-transcription -----
  if (!skipTranscribe) await step('partial', async () => {
    ae(`var c = null; for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") c = app.project.item(i); c.workAreaStart = 10; c.workAreaDuration = 10; "ok"`);
    await sleep(1500);
    await tab('voice');
    await click('#trBtn', { wait: 1000 });
    await idle();
    let p = await panel();
    check('partial: new version, Max rows and Auto kept', p.versions === 2 && p.maxRows === '3' && p.modes.join() === 'fit', p.versions + ' · ' + p.maxRows + ' · ' + p.modes.join());
    await tab('lines');
    await click('#applyBtn', { wait: 1000 });
    await idle();
    const a = ae(AE_STATE);
    // outside 10–20 s: same layer, text and start; only the caption right before the range may end a bit
    // later or earlier (it stays on screen until the next caption starts, at most 0.6 s after its last word)
    const out = (x) => x[2] <= 10050 || x[1] >= 19950;
    const prevOne = before.ids.filter((x) => x[2] <= 10050).pop();
    const bad = before.ids.filter(out).filter((x) => {
      const y = a.ids.find((z) => z[0] === x[0]);
      if (!y || y[1] !== x[1] || y[3] !== x[3]) return true;
      return y[2] !== x[2] && !(x === prevOne && Math.abs(y[2] - x[2]) <= 600);
    });
    check('partial: captions outside 10–20 s untouched', before.ids.filter(out).length > 0 && !bad.length,
      bad.length ? bad.map((x) => x[3]).join('; ') : before.ids.filter(out).length + ' kept');
    check('partial: no errors, inside the safe zone', a.errors === 0 && a.outside.length === 0, a.firstError);
    ae(`var c = null; for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") c = app.project.item(i); c.workAreaStart = 0; c.workAreaDuration = 30; "ok"`);
  });

  // ----- save, close, reopen -----
  await step('reopen', async () => {
    const r = ae(`var f = app.project.file; app.project.save(); app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.open(f);
      var c = null; for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") c = app.project.item(i);
      c.openInViewer(); enc({ ok: !!c })`);
    check('project saved, closed and reopened', r.ok);
    await tab('lines');
    // the panel needs a moment to notice the reopened project and read the comp's data
    let p, t0 = Date.now();
    do { await sleep(700); p = await panel(); } while (Date.now() - t0 < 20000 && !(p.comp === COMP && p.rows.length && p.modes.length));
    check('reopen: Max rows 3 remembered for this comp', p.maxRows === '3', p.maxRows);
    check('reopen: Auto still highlighted', p.modes.join() === 'fit', p.modes.join());
    const a = ae(AE_STATE);
    check('reopen: captions intact, no expression errors', a.n === p.rows.length && a.errors === 0, a.n + ' / ' + p.rows.length + ' ' + a.firstError);
  });

  // ----- another comp keeps its own Max rows -----
  await step('per comp', async () => {
    ae(`var c = freshComp("AT ui other", 1080, 1920, 10); "ok"`);
    let p, t0 = Date.now();
    do { await sleep(700); p = await panel(); } while (Date.now() - t0 < 15000 && p.comp !== 'AT ui other');
    check('another comp starts with its own Max rows (2)', p.comp === 'AT ui other' && p.maxRows === '2', p.comp + ' · ' + p.maxRows);
    ae(`for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") app.project.item(i).openInViewer(); "ok"`);
    t0 = Date.now();
    do { await sleep(700); p = await panel(); } while (Date.now() - t0 < 15000 && !(p.comp === COMP && p.rows.length));
    check('back in the test comp: Max rows 3', p.maxRows === '3', p.maxRows);
  });

  // ----- B. a finished project: other layers, a partial work area, a preset on a selection, one caption moved -----
  const FIN = 'AT ui finished';
  const finState = (extra = '') => ae(`var c = null; for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${FIN}") c = app.project.item(i);
    var caps = captions(c), fonts = [], e = exprErrors(c);
    for (var j = 0; j < caps.length; j++) fonts.push(caps[j].property("ADBE Text Properties").property("ADBE Text Document").value.font);
    ${extra}
    enc({ n: caps.length, fonts: fonts, errors: e.n, firstError: e.first, outside: inSafe(c, caps), prints: foreignPrints(c) });`);
  let finPrints = null;
  const untouched = (label, a) => {
    const diff = Object.keys(finPrints).filter((k) => finPrints[k] !== a.prints[k]);
    check(label + ': other layers untouched', !diff.length, diff.join('; '));
    check(label + ': no expression errors', a.errors === 0, a.firstError);
  };
  const waitComp = async (name) => { let p, t0 = Date.now(); do { await sleep(700); p = await panel(); } while (Date.now() - t0 < 20000 && p.comp !== name); return p; };
  if (!skipTranscribe) await step('finished project', async () => {
    ae(`var vo = null; for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof FootageItem && it.hasAudio && !it.hasVideo) vo = it; }
      var c = freshComp("${FIN}", 1080, 1920, 30); c.layers.add(vo); buildFinished(c); c.workAreaStart = 10; c.workAreaDuration = 10; "ok"`);
    finPrints = finState().prints;
    let p = await waitComp(FIN);
    check('finished: the panel opens the comp with other layers', p.comp === FIN, p.comp);
    await tab('voice');
    await click('#trBtn', { wait: 1000 });
    await idle();
    await tab('lines');
    p = await panel();
    const span = await js(`return [...document.querySelectorAll('#list .ln .tc')].map((e) => e.textContent)`);
    check('finished: only the 10–20 s work area was transcribed', p.rows.length > 1 && span.every((t) => t >= '00:09' && t.slice(0, 5) <= '00:20'), span[0] + ' … ' + span[span.length - 1]);
    await click('#applyBtn', { wait: 1000 });
    await idle();
    let a = finState();
    check('finished: layers created', a.n === p.rows.length, a.n + ' / ' + p.rows.length);
    untouched('finished: create', a);
    // select two captions in AE, click a preset: only those two change
    ae(`var c = app.project.activeItem, caps = captions(c); caps[0].selected = true; caps[1].selected = true; "ok"`);
    await tab('style');
    await sleep(1200);
    await click('#pres .pr[data-p="3"]', { wait: 800 }); // All caps (Futura)
    await idle();
    a = finState('for (var s = 0; s < caps.length; s++) caps[s].selected = false;');
    check('finished: preset on 2 selected captions changes only them', a.fonts[0] === 'Futura-Bold' && a.fonts[1] === 'Futura-Bold' && a.fonts.slice(2).every((f) => f !== 'Futura-Bold'), a.fonts.join(', '));
    check('finished: the toast says it went to the selection', /selected/.test((await panel()).toast), (await panel()).toast);
    untouched('finished: preset on a selection', a);
    // move one caption up on its own (like dragging it), edit another one's text in the panel, Update
    ae(`var caps = captions(app.project.activeItem), P = caps[2].property("ADBE Transform Group").property("ADBE Position"), v = P.valueAtTime(0, true); P.setValue([v[0], v[1] - 150]); "ok"`);
    await tab('lines');
    await click('#list .ln[data-i="0"] .t', { double: true });
    await key('a', 'meta'); await type('Changed in the panel'); await key('Enter');
    await click('#applyBtn', { wait: 1000 });
    await idle();
    a = finState('var sh = caps[2].property("ADBE Transform Group").property("ADBE Position").valueAtTime(0, true)[1];');
    const off = ae(`var caps = captions(app.project.activeItem); caps[2].property("ADBE Transform Group").property("ADBE Position").valueAtTime(0, true)[1]`);
    check('finished: the caption moved on its own keeps its place after Update', Math.abs(+off + 150) < 0.5, off);
    untouched('finished: update', a);
  });

  // ----- C. edits made directly in AE -----
  if (!skipTranscribe) await step('edits in AE', async () => {
    // text typed into a layer in AE is picked up when the panel opens the comp again
    ae(`var caps = captions(app.project.activeItem), tp = caps[1].property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value; d.text = "Typed in AE"; tp.setValue(d); "ok"`);
    ae(`for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") app.project.item(i).openInViewer(); "ok"`);
    await waitComp(COMP);
    ae(`for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${FIN}") app.project.item(i).openInViewer(); "ok"`);
    let p = await waitComp(FIN);
    await sleep(1500); p = await panel();
    check('AE edit: text typed in a layer shows up in the panel', p.texts[1] === 'Typed in AE', p.texts[1]);
    // a caption layer deleted in AE comes back on Update
    const n0 = p.rows.length;
    ae(`captions(app.project.activeItem)[3].remove(); "ok"`);
    await click('#applyBtn', { wait: 1000 }); await idle();
    let a = finState();
    check('AE edit: a deleted caption layer is recreated on Update', a.n === n0, a.n + ' / ' + n0);
    // a caption duplicated in AE stays the user's layer
    ae(`var d = captions(app.project.activeItem)[2].duplicate(); d.name = "My copy"; "ok"`);
    await click('#list .ln[data-i="4"] .t', { double: true });
    await key('a', 'meta'); await type('After the copy'); await key('Enter');
    await click('#applyBtn', { wait: 1000 }); await idle();
    const cp = ae(`var c = app.project.activeItem, o = null; for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).name === "My copy") o = c.layer(i); enc({ there: !!o, comment: o ? o.comment : "", n: captions(c).length })`);
    check('AE edit: the duplicated caption is kept as the user\'s layer', cp.there && cp.comment.indexOf('subtext-copy:') === 0 && cp.n === n0, JSON.stringify(cp));
    // ⌘Z pressed in AE itself cannot be simulated: running Undo from a script makes AE show
    // "Undo group mismatch". It stays a check by hand (tests/README.md).
  });

  // ----- D. versions -----
  if (!skipTranscribe) await step('versions', async () => {
    ae(`for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${COMP}") app.project.item(i).openInViewer(); "ok"`);
    let p = await waitComp(COMP);
    const n2 = p.rows.length;
    await click('#verSel', { wait: 300 });
    await key('ArrowUp'); await key('Enter');
    await sleep(800);
    p = await panel();
    check('versions: switching to Version 1 shows its lines', p.rows.length !== n2 || p.texts.join() !== '', p.rows.length + ' lines (v2 had ' + n2 + ')');
    await click('#applyBtn', { wait: 1000 }); await idle();
    const a = ae(AE_STATE);
    check('versions: Update puts Version 1 into the comp', a.n === p.rows.length && a.errors === 0, a.n + ' / ' + p.rows.length);
  });

  check('no expression error shown even for a moment', !transients.length, transients.slice(0, 2).join(' | '));
  ws.close();
  console.log(JSON.stringify({ test: 'Panel, clicked like a person', results }));
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ test: 'Panel, clicked like a person', results: results.concat([{ n: 'test run', ok: false, i: e.message }]) })); process.exit(0); });
