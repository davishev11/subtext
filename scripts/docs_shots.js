// Screenshots of the Subtext panel for the README, made by clicking through it like a person.
// Needs: After Effects with research/out/subtext-demo.aep open (comp "Coffee 9x16" with a voice-over),
// the dev build of the panel (CEP debug port 8099) and the turbo model.  Usage: node scripts/docs_shots.js
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '../docs/img');
const PORT = process.env.PORT || 8099;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
async function connect() {
  const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
  ws = new WebSocket((pages.find((p) => p.title === 'Subtext') || pages[0]).webSocketDebuggerUrl);
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
async function click(sel, wait = 700) {
  const p = await js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2];`);
  if (!p) throw new Error('not on screen: ' + sel);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await sleep(90);
  }
  await sleep(wait);
}
async function idle(limit = 300000) {
  const t0 = Date.now();
  await sleep(1500);
  while (Date.now() - t0 < limit) {
    if (!(await js(`return document.querySelector('#trBtn').disabled || document.body.classList.contains('busy') || document.querySelector('#applyBtn').textContent.indexOf('Updating') >= 0`))) break;
    await sleep(800);
  }
  await sleep(1200);
}
async function shot(name) {
  // nothing private on the pictures: no API key, no local paths
  await js(`const k = document.querySelector('#keyIn'); if (k) { k.dataset.keep = k.value; k.value = ''; }
    document.querySelectorAll('#about, #cacheHint').forEach((e) => { e.dataset.keep = e.innerHTML; e.innerHTML = e.innerHTML.replace(/\\/Users\\/[^/<\\s]+/g, '~'); });
    document.querySelector('#toast').style.opacity = 0; return 1`);
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  await js(`const k = document.querySelector('#keyIn'); if (k && k.dataset.keep !== undefined) k.value = k.dataset.keep;
    document.querySelectorAll('#about, #cacheHint').forEach((e) => { if (e.dataset.keep !== undefined) e.innerHTML = e.dataset.keep; });
    document.querySelector('#toast').style.opacity = ''; return 1`);
  console.log('✓ ' + name);
}
const tab = (t) => click(`.tab[data-tab="${t}"]`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await connect();
  await js('location.reload(); return 1').catch(() => {});
  await sleep(4000);
  await connect();
  await sleep(2500);
  const comp = await js(`return document.querySelector('#compName').textContent`);
  if (comp !== 'Coffee 9x16') throw new Error('open the comp "Coffee 9x16" in After Effects first (panel shows: ' + comp + ')');

  const only = process.argv[2]; // "style" = only the Style shots, on captions that already exist
  if (only !== 'style') {
    await tab('voice'); await shot('1-voice');
    await click('#trBtn', 1500); await idle();
    await tab('lines'); await shot('2-lines-auto');
    await click('#modeSent'); await shot('3-lines-sentences');
    await click('#modeFit');
    await click('#applyBtn', 1500); await idle();
  }
  await tab('style');
  await click('#pres .pr[data-p="1"]', 1500); await idle(); // "Blue accent": font, colours and the accent box
  const k = await js(`return document.querySelector('.fx[data-fx="karaoke"] small').textContent`);
  if (!/on ·/.test(k)) { await click('.fx[data-fx="karaoke"]', 1500); await idle(); }
  await js(`document.querySelector('.fx[data-fx="karaoke"]').closest('.sec, section, div').scrollIntoView({ block: 'start' }); return 1`);
  await js(`document.querySelector('#takeRef').scrollIntoView({ block: 'start' }); return 1`);
  await sleep(500); await shot('4-style');
  await js(`document.querySelector('#pres').scrollIntoView({ block: 'end' }); return 1`);
  await sleep(500); await shot('6-presets');
  if (only !== 'style') { await tab('set'); await shot('5-settings'); }
  await tab('lines');
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
