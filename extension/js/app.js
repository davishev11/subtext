// Subtext — panel UI. Talks to After Effects through jsx/host.jsx (ST.*) and to whisper through Engine.
(function () {
  'use strict';
  const cs = new CSInterface();
  const EXT = cs.getSystemPath(SystemPath.EXTENSION);
  const fs = window.cep_node.require('fs');
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('subtext.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('subtext.' + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem('subtext.' + k); } catch (e) {} },
  };

  // ---------- bridge to After Effects ----------
  function host(fn, ...args) {
    return new Promise((resolve, reject) => {
      cs.evalScript(`ST.${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`, (r) => {
        if (!r || r === 'EvalScript error.') return reject(new Error('After Effects did not respond (' + fn + ')'));
        let o;
        try { o = JSON.parse(r); } catch (e) { return reject(new Error(r)); }
        if (o && o.ok === false) return reject(new Error(o.error));
        resolve(o);
      });
    });
  }
  // (Re)loads the host script so a panel reload always talks to the matching version.
  function ensureHost() {
    return new Promise((res) => cs.evalScript(`$.evalFile(${JSON.stringify(EXT + '/jsx/host.jsx')})`, () => res()));
  }

  // ---------- state ----------
  const PRESETS = [
    { n: 'Yellow karaoke', fx: ['karaoke'], accent: '#ffd23f', box: '#0a0a0d', accBox: '#4c8dff', op: 90, style: { font: 'AvenirNext-Heavy', fillColor: [1, 1, 1], applyStroke: false, allCaps: false }, prev: 'k', ff: 'Avenir Next', fw: 800 },
    { n: 'Blue accent', fx: ['accent'], accent: '#ffd23f', box: '#0a0a0d', accBox: '#4c8dff', op: 100, style: { font: 'HelveticaNeue-Bold', fillColor: [1, 1, 1], applyStroke: false, allCaps: false }, prev: 'a', ff: 'Helvetica Neue', fw: 700 },
    { n: 'Box', fx: ['adaptive', 'karaoke'], accent: '#ffd23f', box: '#000000', accBox: '#4c8dff', op: 70, style: { font: 'HelveticaNeue-Bold', fillColor: [1, 1, 1], applyStroke: false, allCaps: false }, prev: 'ad', ff: 'Helvetica Neue', fw: 700 },
    { n: 'All caps', fx: ['karaoke'], accent: '#ffd23f', box: '#0a0a0d', accBox: '#4c8dff', op: 90, style: { font: 'Futura-Bold', fillColor: [1, 1, 1], applyStroke: true, strokeColor: [0, 0, 0], strokeWidth: 8, strokeOverFill: false, allCaps: true }, prev: 'k', ff: 'Futura', fw: 700, up: true },
    { n: 'Outline', fx: [], accent: '#ffd23f', box: '#0a0a0d', accBox: '#4c8dff', op: 90, style: { font: 'Arial-BoldMT', fillColor: [1, 1, 1], applyStroke: true, strokeColor: [0, 0, 0], strokeWidth: 10, strokeOverFill: false, allCaps: false }, prev: '', ff: 'Arial', fw: 700, stroke: true },
    { n: 'No effects', fx: [], accent: '#ffd23f', box: '#0a0a0d', accBox: '#4c8dff', op: 90, style: null, prev: '', ff: 'Helvetica Neue', fw: 700 },
  ];
  const S = {
    info: null, compKey: null, doc: null, layers: {}, undo: [], dirty: 0,
    sel: null, hover: null, shift: false, editing: null, tab: 'voice', t: -1, busy: false, fxSum: null,
    limits: LS.get('limits', JSON.parse(JSON.stringify(Lines.DEFAULT_LIMITS))),
    engine: 'local', key: LS.get('elevenKey', ''), keyOk: LS.get('elevenKeyOk', false),
    model: LS.get('model', 'turbo'), lang: LS.get('lang', 'auto'), exact: LS.get('exact', true), snap: LS.get('snap', true),
    progress: {}, cacheNextToProject: LS.get('cacheNextToProject', false),
  };
  const emptyDoc = () => ({ v: 1, uid: Lines.newId(), versions: [], vi: -1, style: null, styleName: null, fx: [], savedAt: 0 });
  const comp = () => (S.info && S.info.comp) || null;
  const ver = () => (S.doc && S.doc.vi >= 0 ? S.doc.versions[S.doc.vi] : null);
  // Format of the comp; N is the comp's own Max rows when set (0 = the ⚙ default for the format).
  const fmt = () => {
    if (!comp()) return { k: '—', name: '', L: 24, N: 2 };
    const f = Lines.formatFor(comp().w, comp().h, S.limits);
    if (S.doc && S.doc.maxRows) f.N = S.doc.maxRows;
    return f;
  };
  // How the open version is grouped: 'words' | 'fit' | 'sent' (older versions were built by Auto).
  const modeOf = (v) => (v && v.mode) || 'fit';
  const groupBy = (mode, words, f) => (mode === 'words' ? Lines.wordLines(words) : mode === 'sent' ? Lines.sentenceLines(words, f.L, f.N) : Lines.autoLines(words, f.L, f.N));
  const draftKey = () => 'draft:' + (S.info.project || 'unsaved') + ':' + comp().id;
  const startsMap = () => { const o = {}; (ver() ? ver().lines : []).forEach((l) => { o[l.id] = l.words.map((w) => w[0]); }); return o; };

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), err ? 5000 : 2600);
  }
  const fail = (e) => { console.error(e); toast(e.message || String(e), true); };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const tcs = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0'); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);
  const colorDist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const wideNote = (n) => (n ? `. ⚠️ ${n} are wider than the safe area — use a smaller font, a lower character limit in ⚙ or scale the precomp` : '');

  // ---------- persistence ----------
  function saveDraft() { if (comp()) LS.set(draftKey(), { doc: S.doc, savedAt: Date.now(), dirty: S.dirty, comp: comp().name }); }
  async function saveDoc() { S.doc.savedAt = Date.now(); await host('saveData', JSON.stringify(S.doc)); LS.set(draftKey(), { doc: S.doc, savedAt: S.doc.savedAt, dirty: S.dirty, comp: comp().name }); }

  async function loadComp() {
    const r = await host('read');
    let doc = null;
    try { doc = r.data ? JSON.parse(r.data) : null; } catch (e) { doc = null; }
    const draft = LS.get(draftKey(), null);
    if (doc && !doc.uid) doc.uid = Lines.newId(); // data saved by an older build: gets its uid on the next save
    const pick = Lines.pickDoc(doc, draft, comp().name);
    S.dirty = pick.fromDraft ? draft.dirty || 0 : 0;
    S.doc = pick.doc || emptyDoc();
    S.layers = r.layers || {};
    S.undo = []; S.sel = null; S.editing = null;
    if (r.ctrl) {
      if (r.ctrl.accent) $('#cAccent').value = hex(r.ctrl.accent);
      if (r.ctrl.box) $('#cBox').value = hex(r.ctrl.box);
      if (r.ctrl.accentBox) $('#cAccBox').value = hex(r.ctrl.accentBox);
      if (r.ctrl.opacity !== null) $('#cOp').value = r.ctrl.opacity;
    }
    // pick up text edits made directly in AE
    const v = ver();
    let picked = 0;
    if (v) v.lines = v.lines.map((l) => {
      const L = S.layers[l.id];
      if (!L) return l;
      const t = L.text.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
      if (t && t !== Lines.textOf(l)) { picked++; return Lines.setText(l, t); }
      return l;
    });
    if (picked) toast(`Picked up ${picked} edits made directly in AE`);
    renderAll();
  }

  // ---------- polling AE ----------
  const sig = (i) => JSON.stringify([i.comp && [i.comp.id, i.comp.name, i.comp.w, i.comp.h, i.comp.wa], i.selText, i.selCaptions]);
  async function poll() {
    if (S.busy) return;
    try {
      const info = await host('info');
      const prev = S.info;
      S.info = info;
      const c = info.comp;
      const key = c ? (info.project || 'unsaved') + ':' + c.id : null;
      if (key !== S.compKey) { S.compKey = key; if (c) await loadComp(); else { S.doc = null; renderAll(); } return; }
      if (c && prev && prev.comp && prev.comp.stamp !== c.stamp && !S.dirty && S.editing === null) await loadComp();
      else if (!prev || sig(prev) !== sig(info)) renderHeader();
      if (prev && prev.comp && c) S.playingFollow = Math.abs(c.time - prev.comp.time) > 0.05;
      if (S.tab === 'style') refreshFx();
      if (c && c.ctrlBroken && !S.busy) {
        // someone renamed or deleted a controller effect: put it back so the expressions work again
        const r = await host('repair').catch(() => null);
        if (r && r.fixed) toast(`Repaired the Subtext Controller (${r.fixed} effect${r.fixed > 1 ? 's' : ''}) — expression errors are gone`);
      }
      if (S.tab === 'style' && (!prev || prev.selText !== info.selText || prev.selCaptions !== info.selCaptions)) renderStyle();
    } catch (e) { /* AE busy — try again on the next tick */ }
  }
  async function pollTime() {
    if (S.busy || S.tab !== 'lines' || !comp() || S.editing !== null) return;
    try {
      const t = await host('time');
      if (typeof t === 'number' && Math.abs(t - S.t) > 0.001) { S.t = t; updatePlayhead(); }
    } catch (e) {}
  }

  // ---------- transcription ----------
  function step(i, state, text) {
    const el = $('#st' + i), mark = { ok: '✓', now: '◐', err: '✕', '': '○' }[state];
    el.className = state; el.textContent = mark + ' ' + text;
  }
  async function transcribe() {
    const c = comp();
    if (!c) return toast('Open the composition with the voice-over first', true);
    if (S.engine === 'local' && !Engine.modelReady(S.model)) { toast('Download a speech model in ⚙ first'); return switchTab('set'); }
    S.busy = true; $('#trBtn').disabled = true; $('#trProg').hidden = false; $('#trBar').style.width = '2%';
    step(1, 'now', 'Render work-area audio'); step(2, '', 'Recognition'); step(3, '', 'Lines for ' + fmt().k);
    let stage = 1;
    try {
      const t0 = Date.now();
      const dir = Engine.cacheDir(S.info.project, S.cacheNextToProject);
      const r = await host('renderAudio', dir);
      const a = Engine.prepareAudio(r.path, dir);
      try { fs.unlinkSync(r.path); } catch (e) {}
      step(1, 'ok', `Audio rendered · ${a.duration.toFixed(0)} s`); stage = 2;
      step(2, 'now', 'Recognition');
      const onProgress = (p, label) => { $('#trBar').style.width = Math.round(5 + p * 85) + '%'; step(2, 'now', `${label || 'Recognition'} · ${Math.round(p * 100)}%`); };
      const res = S.engine === 'local'
        ? await Engine.whisper({ extRoot: EXT, modelKey: S.model, wav: a.wav, lang: S.lang, exact: S.exact, silences: S.snap ? a.silences : null, offset: r.offset, onProgress })
        : await Engine.scribe({ key: S.key, wav: a.wav, lang: S.lang, offset: r.offset });
      try { fs.unlinkSync(a.wav); } catch (e) {}
      if (!res.words.length) throw new Error('No speech found. Check the work area and the audio.');
      step(2, 'ok', `${res.words.length} words recognised · ${res.lang}`); stage = 3;
      const f = fmt();
      const prev = ver(), wa0 = r.offset, wa1 = r.offset + a.duration, mode = modeOf(prev);
      let lines = groupBy(mode, res.words, f), note = '';
      if (prev && isPartial(c)) {
        // only the work area is replaced; everything outside keeps its lines (and layers)
        const keep = prev.lines.filter((l) => l.words[l.words.length - 1][1] <= wa0 + 0.05 || l.words[0][0] >= wa1 - 0.05);
        note = `Replaced ${tcs(wa0)}–${tcs(wa1)} · kept ${keep.length} lines`;
        lines = keep.concat(lines).sort((x, y) => x.words[0][0] - y.words[0][0]);
      }
      const now = new Date();
      S.doc.versions.push({ n: S.doc.versions.length + 1, at: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        src: S.engine === 'local' ? Engine.MODELS[S.model].name : 'ElevenLabs', lang: res.lang, words: res.words, lines, mode });
      S.doc.vi = S.doc.versions.length - 1;
      S.undo = []; S.dirty = 1; S.sel = null;
      step(3, 'ok', note || `${lines.length} lines for ${f.k} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      $('#trBar').style.width = '100%';
      await saveDoc();
      setTimeout(() => { $('#trProg').hidden = true; switchTab('lines'); toast(S.doc.versions.length > 1 ? `Version ${S.doc.vi + 1} is ready. Earlier versions are in the version list.` : 'Done! Check the lines, then press “Create layers in AE”.'); }, 500);
    } catch (e) {
      step(stage, 'err', e.message.split('\n')[0]);
      fail(e);
    } finally { S.busy = false; $('#trBtn').disabled = false; renderHeader(); }
  }

  // The work area covers only part of the comp (the rest of the captions stays as it is).
  function isPartial(c) { return c && (c.wa[0] > 0.05 || c.wa[0] + c.wa[1] < c.dur - 0.05); }

  async function applyToAE() {
    const v = ver(); if (!v) return;
    const f = fmt(), sp = Lines.spans(v.lines);
    const lines = v.lines.map((l, i) => ({ id: l.id, text: Lines.wrap(l.words, f.L, l.force2).join('\r'), s: sp[i][0], e: sp[i][1], words: l.words.map((w) => w[0]) }));
    S.busy = true; $('#applyBtn').disabled = true; $('#applyBtn').textContent = 'Updating layers…';
    try {
      S.doc.savedAt = Date.now();
      const r = await host('apply', { data: JSON.stringify(S.doc), lines, style: S.doc.style, fx: S.doc.fx || [], L: f.L });
      S.dirty = 0; LS.del(draftKey());
      const rr = await host('read'); S.layers = rr.layers || {};
      toast((r.created && !r.updated && !r.unchanged ? `Created ${r.created} text layers` : `Updated ${r.updated}, added ${r.created}, removed ${r.removed}, untouched ${r.unchanged}`) + wideNote(r.wide)
        + (r.tall ? `. ⚠️ ${r.tall} reach above the safe zone — lower Max rows or press Fit to safe zone` : ''), r.wide > 0 || r.tall > 0);
    } catch (e) { fail(e); }
    finally { S.busy = false; renderAll(); }
  }

  // ---------- editor ----------
  // Undo snapshots keep the lines, the grouping mode and Max rows together.
  const snap = () => JSON.stringify({ lines: ver().lines, mode: modeOf(ver()), rows: S.doc.maxRows || 0 });
  function restore(js) {
    const o = JSON.parse(js), v = ver();
    if (Array.isArray(o)) { v.lines = o; return; }
    v.lines = o.lines; v.mode = o.mode; S.doc.maxRows = o.rows || 0;
  }
  function pushUndo() { const v = ver(); if (!v) return; S.undo.push(snap()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; }
  function changed(msg) { S.dirty++; saveDraft(); renderLines(); if (msg) toast(msg); }
  function undo() {
    const v = ver(); if (!v || !S.undo.length) return toast('Nothing more to undo');
    S.redo = S.redo || []; S.redo.push(snap());
    restore(S.undo.pop()); S.dirty = Math.max(1, S.dirty - 1); S.sel = null; saveDraft(); renderHeader(); renderLines();
  }
  function redo() {
    const v = ver(); if (!v || !S.redo || !S.redo.length) return toast('Nothing to redo');
    S.undo.push(snap());
    restore(S.redo.pop()); S.dirty++; S.sel = null; saveDraft(); renderHeader(); renderLines();
  }
  // Selection and the shift-range preview change classes in place, so a double-click lands on the same row.
  function markSelection() {
    const rng = S.shift && S.hover !== null && S.sel !== null ? [Math.min(S.sel, S.hover), Math.max(S.sel, S.hover)] : null;
    $$('#list .ln').forEach((row) => {
      const i = +row.dataset.i;
      row.classList.toggle('sel', i === S.sel);
      row.classList.toggle('rng', !!rng && i >= rng[0] && i <= rng[1] && i !== S.sel);
    });
  }
  function selectRow(i, shift) {
    const v = ver(); if (!v) return;
    if (shift && S.sel !== null && S.sel !== i) {
      const a = Math.min(S.sel, i), b = Math.max(S.sel, i);
      pushUndo(); v.lines = Lines.mergeRange(v.lines, a, b); S.sel = a; S.hover = null;
      return changed(`Merged ${b - a + 1} lines into one`);
    }
    S.sel = i; markSelection();
    host('seek', v.lines[i].words[0][0] + 0.01).catch(() => {});
  }
  function splitSel() {
    const v = ver(); if (!v || S.sel === null) return toast('Select a line first');
    const next = Lines.splitLine(v.lines, S.sel); if (!next) return toast('Only one word here — nothing to split');
    pushUndo(); v.lines = next; changed();
  }
  function delSel() {
    const v = ver(); if (!v || S.sel === null) return;
    pushUndo(); v.lines.splice(S.sel, 1);
    if (S.sel >= v.lines.length) S.sel = v.lines.length - 1; if (S.sel < 0) S.sel = null;
    changed();
  }
  function editRow(i) {
    S.editing = i; renderLines();
    const ta = $('#list textarea'); if (!ta) return;
    ta.focus(); ta.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      const v = ver(), l = v.lines[i], nt = ta.value;
      S.editing = null;
      if (save && nt.replace(/\s+/g, ' ').trim() !== Lines.textOf(l)) { pushUndo(); v.lines[i] = Lines.setText(l, nt); changed(); }
      else renderLines();
      $('#list').focus();
    };
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
    ta.addEventListener('blur', () => finish(true));
  }

  // ---------- rendering ----------
  function switchTab(t) {
    S.tab = t;
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + t));
    renderAll();
    if (t === 'style') refreshFx();
  }
  function renderHeader() {
    const c = comp(), f = fmt();
    $('#compName').textContent = c ? c.name : 'Open a composition';
    $('#fmtTag').textContent = f.k; $('#fmtName').textContent = c ? f.name : '';
    $('#fmtLim').textContent = c ? `≤ ${f.L} chars · max ${f.N} ${f.N === 1 ? 'row' : 'rows'}` : '';
    const mode = modeOf(ver());
    $$('.grp.mode .ib').forEach((b) => b.classList.toggle('on', !!ver() && b.dataset.mode === mode));
    const mr = $('#maxRows');
    if (document.activeElement !== mr) mr.value = c ? String(f.N) : '';
    mr.disabled = !c;
    $('#rowsHint').textContent = !ver() ? '' : mode === 'words' ? 'Words ignores Max rows' : `≤ ${f.L} chars per row · limit in ⚙`;
    const vs = $('#verSel'), d = S.doc;
    const opts = d && d.versions.length ? d.versions.map((v, i) => `<option value="${i}">Version ${v.n} · ${esc(v.src)} · ${esc(v.at)}</option>`).join('') : '<option>No captions yet</option>';
    if (vs._opts !== opts) { vs.innerHTML = opts; vs._opts = opts; }
    if (d && d.versions.length && document.activeElement !== vs) vs.value = String(d.vi);
    vs.disabled = !(d && d.versions.length);
    $('#waRange').textContent = c ? `${tcs(c.wa[0])} – ${tcs(c.wa[0] + c.wa[1])}` : '—';
    const elOn = S.key.length > 10 && S.keyOk;
    $('#engEl').disabled = !elOn; $('#engEl').textContent = elOn ? 'ElevenLabs' : 'ElevenLabs 🔒';
    if (!elOn && S.engine !== 'local') S.engine = 'local';
    $('#engLocal').classList.toggle('on', S.engine === 'local'); $('#engEl').classList.toggle('on', S.engine !== 'local');
    const M = Engine.MODELS[S.model];
    $('#engHint').textContent = S.engine !== 'local' ? 'ElevenLabs Scribe: audio goes to the cloud; needs internet and your key.'
      : Engine.modelReady(S.model) ? `Whisper ${M.name} on this Mac, offline.` : `The ${M.name} model is not downloaded yet — open ⚙.`;
    $('#trNote').innerHTML = d && d.versions.length
      ? (isPartial(c) ? `Work area is a part of the comp: only <b>${tcs(c.wa[0])}–${tcs(c.wa[0] + c.wa[1])}</b> is replaced, the rest stays. ` : '') + `Creates <b>Version ${d.versions.length + 1}</b>; Version ${d.vi + 1} stays in the list.`
      : 'Takes seconds: a minute of voice-over ≈ 3–5 s.';
    $('#trBtn').disabled = S.busy || !c;
    $('#langSel').value = S.lang;
    $('#optExact').classList.toggle('on', S.exact); $('#optSnap').classList.toggle('on', S.snap);
  }

  function renderLines(keepScroll) {
    const list = $('#list'), v = ver(), c = comp();
    if (!c) { list.innerHTML = '<div class="empty"><b>No active composition</b>Open the comp with the voice-over in After Effects.</div>'; return renderSync(); }
    if (!v) { list.innerHTML = `<div class="empty"><b>“${esc(c.name)}” has no captions yet</b>Voice → Transcribe, or import an .srt via “SRT / VTT ▾”.</div>`; return renderSync(); }
    const f = fmt(), t = S.t, sp = Lines.spans(v.lines);
    const rng = S.shift && S.hover !== null && S.sel !== null ? [Math.min(S.sel, S.hover), Math.max(S.sel, S.hover)] : null;
    const scroll = list.scrollTop;
    list.innerHTML = v.lines.map((l, i) => {
      const now = t >= sp[i][0] && t < sp[i][1];
      let txt;
      if (S.editing === i) txt = `<textarea rows="2">${esc(Lines.textOf(l))}</textarea>`;
      else {
        let k = 0;
        txt = Lines.wrap(l.words, f.L, l.force2).map((row) => row.split(' ').map(() => `<span data-k="${k}">${esc(l.words[k++][2])}</span>`).join(' ')).join('\n');
      }
      const cls = ['ln', i === S.sel ? 'sel' : '', rng && i >= rng[0] && i <= rng[1] && i !== S.sel ? 'rng' : '', Lines.isOver(l, f.L, f.N) ? 'over' : '', now ? 'now' : ''].join(' ');
      return `<div class="${cls}" data-i="${i}"><span class="n">${i + 1}</span><div><div class="tc mono">${tcs(sp[i][0])} → ${tcs(sp[i][1]).slice(3)}</div><div class="t">${txt}</div></div><span class="c">${Lines.widest(l, f.L)}</span></div>`;
    }).join('');
    list.scrollTop = scroll;
    updatePlayhead();
    renderSync();
  }
  // Moves the yellow "now playing" marks without touching the DOM structure, so clicks are never lost.
  function updatePlayhead() {
    const v = ver(); if (!v || S.tab !== 'lines') return;
    const sp = Lines.spans(v.lines), t = S.t, list = $('#list');
    let nowRow = null;
    $$('#list .ln').forEach((row) => {
      const i = +row.dataset.i, l = v.lines[i]; if (!l) return;
      const now = t >= sp[i][0] && t < sp[i][1];
      row.classList.toggle('now', now);
      if (now) nowRow = row;
      row.querySelectorAll('[data-k]').forEach((el) => {
        const k = +el.dataset.k, w = l.words[k];
        el.classList.toggle('kw', now && t >= w[0] && (k === l.words.length - 1 || t < l.words[k + 1][0]));
      });
    });
    if (nowRow && S.playingFollow && (nowRow.offsetTop < list.scrollTop || nowRow.offsetTop > list.scrollTop + list.clientHeight - 50)) list.scrollTop = nowRow.offsetTop - 60;
  }
  function renderSync() {
    const v = ver(), el = $('#syncInfo'), btn = $('#applyBtn');
    if (!v) { el.className = 'sync off'; el.innerHTML = '<i></i>No lines'; btn.disabled = true; btn.textContent = 'Update in AE'; return; }
    btn.disabled = S.busy;
    const f = fmt(), over = v.lines.filter((l) => Lines.isOver(l, f.L, f.N)).length;
    const extra = `${v.lines.length} lines${over ? ` · <span style="color:var(--red)">${over} too long</span>` : ''}`;
    const inAE = Object.keys(S.layers).length > 0;
    if (!inAE) { el.className = 'sync'; el.innerHTML = `<i></i>Not in AE yet · ${extra}`; btn.textContent = `Create ${v.lines.length} layers in AE`; }
    else if (S.dirty) { el.className = 'sync'; el.innerHTML = `<i></i>Changes not in AE yet · ${extra}`; btn.textContent = 'Update in AE'; }
    else { el.className = 'sync ok'; el.innerHTML = `<i></i>In sync with AE · ${extra}`; btn.textContent = 'Update in AE'; }
  }

  async function refreshFx() {
    if (!comp()) return;
    try { S.fxSum = await host('fxSummary'); renderStyle(); } catch (e) {}
  }
  function renderStyle() {
    const d = S.doc, info = S.info, sum = S.fxSum, has = Object.keys(S.layers).length > 0;
    $('#refSrc').innerHTML = d && d.styleName ? `Style from: <b>${esc(d.styleName)}</b>` : 'Style: same as the first caption in the comp';
    const sel = info && info.selText;
    $('#takeRef').disabled = !sel;
    $('#takeRef').textContent = sel ? `⤓ Copy style from “${sel}”` : '⤓ Select a text layer in the comp';
    $('#scope').innerHTML = !has ? 'Create the layers first: Lines → “Create layers in AE”'
      : sum && sum.selected ? `◉ Effects apply to the <b>${sum.total}</b> captions selected in the comp` : `◉ Effects apply to all <b>${sum ? sum.total : Object.keys(S.layers).length}</b> captions in the comp`;
    $$('.fx[data-fx]').forEach((b) => {
      const n = sum && sum.on ? sum.on[b.dataset.fx] : 0, tot = sum ? sum.total : 0;
      b.disabled = !has;
      b.classList.toggle('on', tot > 0 && n === tot);
      b.querySelector('small').textContent = !tot ? '—' : n === tot ? 'on · click to remove' : n ? `on ${n} of ${tot}` : 'add';
    });
    ['#tSplit', '#tAlign', '#tRm', '#tFit'].forEach((s) => { $(s).disabled = !has; });
  }
  function renderPresets() {
    $('#pres').innerHTML = PRESETS.map((p, i) => {
      const words = ['Word', 'by', 'word', 'now'].map((w) => `<span>${p.up ? w.toUpperCase() : w}</span>`).join(' ');
      const st = `font-family:'${p.ff}';font-weight:${p.fw};${p.stroke ? 'text-shadow:0 0 2px #000,0 0 2px #000,0 0 2px #000;' : ''}`;
      return `<button class="pr" data-p="${i}"><div class="scr"><div class="cp ${p.prev}" style="${st}">${words}</div></div><div class="nmp">${p.n}</div></button>`;
    }).join('');
  }
  function renderSettings() {
    $('#models').innerHTML = Object.entries(Engine.MODELS).map(([k, m]) => {
      const ready = Engine.modelReady(k), prog = S.progress[k], dl = Engine.isDownloading(k);
      const part = Engine.partialBytes(k);
      const size = m.size > 2e9 ? (m.size / 1e9).toFixed(1) + ' GB' : Math.round(m.size / 1e6) + ' MB';
      let body;
      if (dl) body = `<div class="prog"><i style="width:${Math.round((prog || 0) * 100)}%"></i></div><span class="hint mono" style="margin:0">${Math.round((prog || 0) * m.size / 1e6)} / ${Math.round(m.size / 1e6)} MB · click to pause</span>`;
      else if (ready) body = `<span class="hint" style="margin:0">${m.note}</span>`;
      else body = `<span class="hint" style="margin:0">${part ? `${Math.round(part / m.size * 100)}% downloaded — click to resume` : 'Click to download'} · ${m.note}</span>`;
      return `<button class="card ${S.model === k ? 'on' : ''}" data-m="${k}"><div class="top"><b>${m.name}</b>${k === 'turbo' ? '<span class="tag y">recommended</span>' : ''}<span class="sz">${ready ? (S.model === k ? '✓ active' : '✓ ready') : size}</span></div>${body}</button>`;
    }).join('');
    $('#limTbl').innerHTML = Lines.FORMATS.map((f) => `<tr><td>${f.k} ${f.name}</td><td><input data-l="${f.k}" value="${S.limits[f.k][0]}"> · <input data-n="${f.k}" value="${S.limits[f.k][1]}" style="width:28px"></td></tr>`).join('');
    $('#keyOk').textContent = S.keyOk && S.key ? '✓' : '';
    if (document.activeElement !== $('#keyIn')) $('#keyIn').value = S.key;
    const bin = fs.existsSync(EXT + '/bin/whisper-cli');
    renderStorage();
    $('#about').textContent = `Subtext 1.1.0 · whisper ${bin ? 'built in' : 'NOT FOUND'} · data: ${Engine.HOME.replace(/^\/Users\/[^/]+/, '~')}`;
  }
  function renderAll() {
    renderHeader();
    if (S.tab === 'lines') renderLines();
    if (S.tab === 'style') renderStyle();
    if (S.tab === 'set') renderSettings();
  }

  // ---------- events: tabs & voice ----------
  $$('.tab').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
  $('#engLocal').onclick = () => { S.engine = 'local'; renderHeader(); };
  $('#engEl').onclick = () => { S.engine = 'eleven'; renderHeader(); };
  $('#langSel').onchange = (e) => { S.lang = e.target.value; LS.set('lang', S.lang); };
  $('#optExact').onclick = () => { S.exact = !S.exact; LS.set('exact', S.exact); renderHeader(); };
  $('#optSnap').onclick = () => { S.snap = !S.snap; LS.set('snap', S.snap); renderHeader(); };
  $('#trBtn').onclick = transcribe;
  $('#verSel').onchange = (e) => { S.doc.vi = +e.target.value; S.undo = []; S.dirty = 1; S.sel = null; saveDraft(); toast(`Opened Version ${S.doc.vi + 1}. Press “Update in AE” to put it into the comp.`); renderAll(); };

  // ---------- events: lines ----------
  // The three buttons are a mode: the active one stays highlighted, and changing Max rows re-runs it.
  function regroup(kind) {
    const v = ver(); if (!v) return;
    pushUndo(); const f = fmt(), words = v.lines.flatMap((l) => l.words);
    v.lines = groupBy(kind, words, f); v.mode = kind;
    S.sel = null;
    renderHeader();
    changed({ words: 'One word per caption', sent: 'One sentence per caption', fit: 'Auto captions for ' + f.k }[kind] + ` · ${v.lines.length} captions`);
  }
  // Max rows is per comp (stored in its Subtext data). Any whole number; the ⚙ default is stored as 0.
  function setMaxRows(raw) {
    const c = comp(); if (!c || !S.doc) return;
    const def = Lines.formatFor(c.w, c.h, S.limits).N, cur = fmt().N, n = Lines.clampRows(raw, cur);
    if (n === cur) return renderHeader();
    const v = ver();
    if (v) pushUndo();
    S.doc.maxRows = n === def ? 0 : n;
    if (v && modeOf(v) !== 'words') {
      v.lines = groupBy(modeOf(v), v.lines.flatMap((l) => l.words), fmt());
      S.sel = null;
      renderHeader();
      return changed(`Max rows ${n} · ${modeOf(v) === 'sent' ? 'Sentences' : 'Auto'} rebuilt ${v.lines.length} captions · ⌘Z to undo`);
    }
    S.dirty++; saveDraft(); renderHeader(); toast(`Max rows ${n} for this comp`);
  }
  $('#maxRows').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.target.value = String(fmt().N); e.target.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setMaxRows(fmt().N + (e.key === 'ArrowUp' ? 1 : -1)); }
  });
  $('#maxRows').addEventListener('change', (e) => setMaxRows(e.target.value));
  $('#modeWords').onclick = () => regroup('words');
  $('#modeFit').onclick = () => regroup('fit');
  $('#modeSent').onclick = () => regroup('sent');
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#splitBtn').onclick = splitSel;
  $('#applyBtn').onclick = applyToAE;
  $('#list').addEventListener('click', (e) => { const r = e.target.closest('.ln'); if (!r || S.editing !== null) return; selectRow(+r.dataset.i, e.shiftKey); $('#list').focus(); });
  $('#list').addEventListener('dblclick', (e) => { const r = e.target.closest('.ln'); if (r) { S.sel = +r.dataset.i; editRow(+r.dataset.i); } });
  $('#list').addEventListener('mousemove', (e) => {
    S.shift = e.shiftKey;
    const r = e.target.closest('.ln'), h = r ? +r.dataset.i : null;
    if (h !== S.hover) { S.hover = h; if (e.shiftKey && S.sel !== null) markSelection(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !S.shift) { S.shift = true; if (S.tab === 'lines') markSelection(); }
    if (e.target.matches('input,textarea,select') || S.tab !== 'lines') return;
    if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyZ' || e.keyCode === 90)) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (e.code === 'KeyB' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return splitSel(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return delSel(); }
    if (e.key === 'Enter' && S.sel !== null) { e.preventDefault(); return editRow(S.sel); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const v = ver(); if (!v) return; e.preventDefault();
      const n = S.sel === null ? 0 : Math.max(0, Math.min(v.lines.length - 1, S.sel + (e.key === 'ArrowDown' ? 1 : -1)));
      selectRow(n, false); const el = $(`.ln[data-i="${n}"]`); el && el.scrollIntoView({ block: 'nearest' });
    }
  });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') { S.shift = false; if (S.tab === 'lines') markSelection(); } });
  // Keep these keys in the panel instead of letting After Effects take them (macOS key codes).
  // Every modifier is spelled out: CEP matches the combination exactly.
  const KEYS = [];
  const key = (keyCode, mods) => KEYS.push(Object.assign({ keyCode, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, mods));
  [11, 51, 117, 36, 125, 126, 53].forEach((k) => { key(k); key(k, { shiftKey: true }); });
  // digits (top row + keypad) so typing Max rows does not trigger AE shortcuts
  [18, 19, 20, 21, 23, 22, 26, 28, 25, 29, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 76].forEach((k) => key(k));
  key(6, { metaKey: true }); key(6, { metaKey: true, shiftKey: true }); key(6, { ctrlKey: true }); key(6, { ctrlKey: true, shiftKey: true });
  const grabKeys = () => cs.registerKeyEventsInterest(JSON.stringify(KEYS));
  grabKeys();
  window.addEventListener('focus', grabKeys);
  // keys only reach the panel while it has focus
  $('#list').addEventListener('mouseenter', () => { if (S.editing === null && !document.activeElement.matches('input,textarea,select')) $('#list').focus({ preventScroll: true }); });

  // ---------- SRT / VTT ----------
  function closeMenu() { const m = $('#menu'); m && m.remove(); }
  document.addEventListener('click', closeMenu);
  $('#ioBtn').onclick = (e) => {
    e.stopPropagation(); closeMenu();
    const m = document.createElement('div'); m.className = 'menu'; m.id = 'menu';
    m.innerHTML = '<button data-io="imp">Import .srt / .vtt…</button><button data-io="srt">Export .srt</button><button data-io="vtt">Export .vtt</button>';
    const r = e.currentTarget.getBoundingClientRect();
    m.style.right = (window.innerWidth - r.right) + 'px'; m.style.top = (r.bottom + 4) + 'px';
    document.body.appendChild(m);
    m.onclick = (ev) => { const k = ev.target.dataset.io; closeMenu(); if (k === 'imp') importSubs(); else if (k) exportSubs(k); };
  };
  function exportSubs(kind) {
    const v = ver(); if (!v) return toast('Nothing to export');
    const name = (comp().name || 'subtitles').replace(/[\\/:*?"<>|]/g, '_') + '.' + kind;
    const r = window.cep.fs.showSaveDialogEx('Save captions', '', [kind], name);
    if (!r || r.err || !r.data) return;
    let p = r.data; if (!p.toLowerCase().endsWith('.' + kind)) p += '.' + kind;
    try { fs.writeFileSync(p, Lines.toSubtitles(v.lines, fmt().L, kind === 'vtt'), 'utf8'); toast('Saved ' + p.split('/').pop()); } catch (e) { fail(e); }
  }
  function importSubs() {
    if (!comp()) return toast('Open a composition first', true);
    const r = window.cep.fs.showOpenDialogEx(false, false, 'Import captions', '', ['srt', 'vtt']);
    if (!r || r.err || !r.data || !r.data.length) return;
    try {
      const lines = Lines.parseSubtitles(fs.readFileSync(r.data[0], 'utf8'));
      if (!lines.length) return toast('Could not read captions from this file', true);
      const now = new Date();
      S.doc.versions.push({ n: S.doc.versions.length + 1, at: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), src: 'SRT', lines });
      S.doc.vi = S.doc.versions.length - 1; S.dirty = 1; S.undo = [];
      saveDoc().catch(fail); switchTab('lines'); toast(`Imported ${lines.length} lines as Version ${S.doc.vi + 1}`);
    } catch (e) { fail(e); }
  }

  // ---------- events: style ----------
  async function busy(fn) {
    if (S.busy) return toast('Please wait, the previous action is still running…');
    S.busy = true; document.body.classList.add('busy');
    try { await fn(); } catch (e) { fail(e); } finally { S.busy = false; document.body.classList.remove('busy'); }
  }
  $('#takeRef').onclick = () => busy(async () => {
    const r = await host('takeStyle', startsMap());
    if (!r.selected) { S.doc.style = r.style; S.doc.styleName = r.from; }
    await saveDoc();
    // a karaoke colour equal to the text colour would be invisible
    const fill = r.style.fillColor ? hex(r.style.fillColor) : '#ffffff';
    if (colorDist(fill, $('#cAccent').value) < 0.25) {
      $('#cAccent').value = colorDist(fill, '#ffffff') < 0.25 ? '#ffd23f' : '#ffffff';
      await host('setCtrl', { accent: rgb($('#cAccent').value) });
    }
    toast(`Style of “${r.from}” applied to ${r.count} captions` + wideNote(r.wide)); renderStyle();
  });
  $$('.fx[data-fx]').forEach((b) => (b.onclick = () => busy(async () => {
    const kind = b.dataset.fx, sum = S.fxSum || { on: {}, total: 0 };
    const on = !(sum.total && sum.on[kind] === sum.total);
    const r = await host('setFx', kind, on, startsMap());
    if (!r.selected) {
      const fx = new Set(S.doc.fx || []);
      if (on) { fx.add(kind); if (kind === 'adaptive') fx.delete('textbox'); if (kind === 'textbox') fx.delete('adaptive'); } else fx.delete(kind);
      S.doc.fx = [...fx]; await saveDoc();
    }
    const names = { karaoke: 'Karaoke', accent: 'Accent box', adaptive: 'Adaptive box', textbox: 'Text box' };
    toast(`${names[kind]} ${on ? 'added to' : 'removed from'} ${r.count} ${r.selected ? 'selected ' : ''}layers`);
    S.busy = false; await refreshFx();
  })));
  let ctlTimer;
  const pushCtrl = () => { clearTimeout(ctlTimer); ctlTimer = setTimeout(() => host('setCtrl', { accent: rgb($('#cAccent').value), box: rgb($('#cBox').value), accentBox: rgb($('#cAccBox').value), opacity: +$('#cOp').value }).catch(fail), 150); };
  ['#cAccent', '#cAccBox', '#cBox', '#cOp'].forEach((s) => $(s).addEventListener('input', pushCtrl));
  $('#tSplit').onclick = () => busy(async () => { const r = await host('splitLines', startsMap()); syncTexts(r.texts); toast(`Split into 2 lines: ${Object.keys(r.texts).length}` + (r.already ? ` · ${r.already} already had 2 lines` : '')); });
  $('#tFit').onclick = () => busy(async () => { const r = await host('fit', startsMap(), fmt().L); toast(`Font set to ${r.size}px on ${r.count} captions — they fill the safe zone`); });
  $('#tAlign').onclick = () => busy(async () => { const r = await host('align'); toast(`Aligned ${r.count} layers — no gaps left`); });
  $('#rmChars').value = LS.get('rmChars', ';:()"[]«».,');
  $('#rmChars').oninput = (e) => LS.set('rmChars', e.target.value);
  $('#tRm').onclick = () => busy(async () => { const r = await host('removeChars', $('#rmChars').value, startsMap()); syncTexts(r.texts); toast(`Removed characters in ${r.count} layers`); });
  // texts changed in AE by a tool -> mirror them into the panel's lines
  function syncTexts(texts) {
    const v = ver(); if (!v || !texts) return;
    v.lines = v.lines.map((l) => {
      if (!(l.id in texts)) return l;
      const nl = Lines.setText(l, texts[l.id].replace(/\r/g, ' '));
      nl.force2 = texts[l.id].indexOf('\r') >= 0;
      return nl;
    });
    saveDoc().catch(() => {});
  }
  $('#pres').onclick = (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const p = PRESETS[+b.dataset.p];
    busy(async () => {
      if (!Object.keys(S.layers).length) {
        S.doc.fx = p.fx.slice(); if (p.style) { S.doc.style = p.style; S.doc.styleName = 'preset “' + p.n + '”'; }
        await saveDoc(); return toast(`Preset “${p.n}” saved: it applies when you create the layers`);
      }
      const st = startsMap();
      let wide = 0, sel = (S.fxSum && S.fxSum.selected) || false, count = 0;
      if (p.style) {
        const r = await host('setStyle', p.style, st, fmt().L);
        wide = r.wide; sel = r.selected; count = r.count;
        // a preset on a few selected captions does not become the comp's default look
        if (!sel) { S.doc.style = p.style; S.doc.styleName = 'preset “' + p.n + '”'; }
      }
      $('#cAccent').value = p.accent; $('#cBox').value = p.box; $('#cAccBox').value = p.accBox; $('#cOp').value = p.op;
      await host('setCtrl', { accent: rgb(p.accent), box: rgb(p.box), accentBox: rgb(p.accBox), opacity: p.op });
      for (const k of ['karaoke', 'accent', 'adaptive', 'textbox']) await host('setFx', k, p.fx.includes(k), st);
      if (!sel) S.doc.fx = p.fx.slice();
      await saveDoc();
      toast(`Preset “${p.n}” applied` + (sel ? ` to ${count || 'the'} selected captions` : '') + wideNote(wide), wide > 0);
      S.busy = false; await refreshFx();
    });
  };

  // ---------- events: settings ----------
  $('#models').onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const k = b.dataset.m, M = Engine.MODELS[k];
    if (Engine.modelReady(k)) { S.model = k; LS.set('model', k); toast(`Active model: ${M.name}`); return renderAll(); }
    if (Engine.isDownloading(k)) { Engine.cancelDownload(k); return; }
    S.model = k; LS.set('model', k);
    S.progress[k] = Engine.partialBytes(k) / M.size;
    Engine.download(k, (p) => {
      S.progress[k] = p;
      const card = $(`#models [data-m="${k}"]`);
      const bar = card && card.querySelector('.prog i'), txt = card && card.querySelector('.hint');
      if (bar && txt) { bar.style.width = Math.round(p * 100) + '%'; txt.textContent = `${Math.round(p * M.size / 1e6)} / ${Math.round(M.size / 1e6)} MB · click to pause`; }
      else if (S.tab === 'set') renderSettings();
    })
      .then(() => { toast(`${M.name} downloaded. Ready to transcribe.`); renderAll(); })
      .catch((err) => { if (err.message !== 'Cancelled') fail(err); else toast('Paused. Click again to resume.'); renderAll(); });
    renderSettings();
  };
  $('#limTbl').oninput = (e) => {
    const k = e.target.dataset.l || e.target.dataset.n, v = parseInt(e.target.value, 10);
    if (!k || !(v > 0)) return;
    S.limits[k][e.target.dataset.l ? 0 : 1] = v; LS.set('limits', S.limits); renderHeader();
  };
  let keyTimer;
  $('#keyIn').oninput = (e) => {
    S.key = e.target.value.trim(); S.keyOk = false; LS.set('elevenKey', S.key); LS.set('elevenKeyOk', false); renderSettings(); renderHeader();
    clearTimeout(keyTimer);
    if (S.key.length > 10) keyTimer = setTimeout(async () => {
      try { S.keyOk = await Engine.checkKey(S.key); } catch (err) { S.keyOk = false; }
      LS.set('elevenKeyOk', S.keyOk); toast(S.keyOk ? 'ElevenLabs key accepted' : 'ElevenLabs rejected this key', !S.keyOk);
      renderSettings(); renderHeader();
    }, 600);
  };

  // ---------- storage ----------
  const mb = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? Math.round(b / 1e6) + ' MB' : Math.round(b / 1e3) + ' KB');
  const cacheDirs = () => {
    const out = [Engine.DIRS.cache];
    if (S.info && S.info.project) out.push(Engine.cacheDir(S.info.project, true));
    return out;
  };
  function renderStorage() {
    const proj = S.info && S.info.project;
    $('#cacheApp').classList.toggle('on', !S.cacheNextToProject);
    $('#cacheProj').classList.toggle('on', S.cacheNextToProject);
    $('#szCache').textContent = mb(cacheDirs().reduce((n, d) => n + Engine.folderSize(d), 0));
    $('#szModels').textContent = mb(Engine.folderSize(Engine.DIRS.models));
    $('#nVers').textContent = S.doc ? String(S.doc.versions.length) : '—';
    $('#pruneVers').disabled = !(S.doc && S.doc.versions.length > 1);
    const where = S.cacheNextToProject
      ? (proj ? `“${Engine.PROJECT_CACHE}” next to ${proj.split('/').pop()}` : 'the app folder until the project is saved')
      : '~/Library/Application Support/Subtext/cache';
    $('#cacheHint').textContent = `Temp audio goes to ${where}. It is deleted right after each transcription; anything left over is cleared after a day.`;
  }
  $('#cacheApp').onclick = () => { S.cacheNextToProject = false; LS.set('cacheNextToProject', false); renderStorage(); };
  $('#cacheProj').onclick = () => { S.cacheNextToProject = true; LS.set('cacheNextToProject', true); renderStorage(); };
  $('#openCache').onclick = () => Engine.reveal(Engine.cacheDir(S.info && S.info.project, S.cacheNextToProject));
  $('#openModels').onclick = () => Engine.reveal(Engine.DIRS.models);
  $('#clearCache').onclick = () => { const r = Engine.clearCache(cacheDirs()); toast(`Cleared ${r.files} temp files · ${mb(r.bytes)}`); renderStorage(); };
  let pruneArmed = 0;
  $('#pruneVers').onclick = () => {
    const d = S.doc; if (!d || d.versions.length < 2) return;
    if (Date.now() - pruneArmed > 4000) { pruneArmed = Date.now(); return toast(`Delete ${d.versions.length - 1} old versions of this comp? Click again to confirm.`); }
    pruneArmed = 0;
    const keep = d.versions[d.vi];
    keep.n = 1; d.versions = [keep]; d.vi = 0; S.undo = []; S.redo = [];
    busy(async () => { await saveDoc(); toast('Old versions deleted — only the open one is kept'); renderAll(); });
  };

  // ---------- start ----------
  renderPresets();
  // leftovers from interrupted runs (temp audio older than a day)
  try { Engine.clearCache([Engine.DIRS.cache], 24 * 3600 * 1000); } catch (e) {}
  ensureHost().then(() => {
    poll();
    setInterval(poll, 800);
    setInterval(pollTime, 250);
    if (!Object.keys(Engine.MODELS).some(Engine.modelReady)) switchTab('set');
    else renderAll();
  });
})();
