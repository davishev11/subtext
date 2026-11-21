// Subtext — caption line logic. Pure functions, shared by the panel and the Node tests.
// A line is { id, words: [[start, end, text], ...], force2?: bool }.
(function (root) {
  'use strict';

  const FORMATS = [
    { k: '9:16', name: 'Reels · TikTok · Shorts', r: 9 / 16 },
    { k: '4:5', name: 'Feed', r: 4 / 5 },
    { k: '1:1', name: 'Square', r: 1 },
    { k: '16:9', name: 'YouTube', r: 16 / 9 },
  ];
  const DEFAULT_LIMITS = { '9:16': [18, 2], '4:5': [20, 2], '1:1': [22, 2], '16:9': [36, 2] };
  const WEAK = new Set(('a an the to of in on at for with and or but my his her our your their this that is was so as by from ' +
    'і й та а але що як до на у в з із від для по за про це той').split(' '));

  let seq = 0;
  const newId = () => 'l' + Date.now().toString(36) + (seq++).toString(36);

  function formatFor(w, h, limits) {
    const r = w / h;
    const f = FORMATS.reduce((a, b) => (Math.abs(b.r - r) < Math.abs(a.r - r) ? b : a));
    const [L, N] = (limits || DEFAULT_LIMITS)[f.k] || DEFAULT_LIMITS[f.k];
    return { k: f.k, name: f.name, L, N };
  }

  const textOf = (line) => line.words.map((w) => w[2]).join(' ');
  const endsSentence = (t) => /[?!]["»”)]?$/.test(t) || /[^.]\.["»”)]?$/.test(t);
  const endsClause = (t) => /[,;:—–]["»”)]?$/.test(t);
  const isWeak = (t) => WEAK.has(t.toLowerCase().replace(/[^\p{L}']/gu, ''));

  // Splits a line's words into display rows of at most L characters: one row when it fits,
  // otherwise as few balanced rows as needed (2 for normal captions, more for a long sentence),
  // preferring breaks after punctuation and never ending a row on a short function word.
  function wrap(words, L, force2) {
    const t = words.map((w) => w[2]);
    const full = t.join(' ');
    if ((full.length <= L && !force2) || t.length < 2) return [full];
    const n = t.length, len = (i, j) => t.slice(i, j).join(' ').length;
    for (let k = Math.max(2, Math.ceil(full.length / L)); k <= n; k++) {
      const avg = full.length / k;
      // best[r][j]: cheapest way to put words 0..j-1 into r rows
      const best = [], prev = [];
      for (let r = 0; r <= k; r++) { best.push(new Array(n + 1).fill(Infinity)); prev.push(new Array(n + 1).fill(-1)); }
      best[0][0] = 0;
      for (let r = 1; r <= k; r++) {
        for (let j = r; j <= n; j++) {
          for (let i = r - 1; i < j; i++) {
            if (best[r - 1][i] === Infinity) continue;
            const l = len(i, j);
            let c = (l - avg) * (l - avg) / 4 + Math.max(0, l - L) * 200;
            if (j < n) {
              if (endsClause(t[j - 1]) || endsSentence(t[j - 1])) c -= 6;
              if (isWeak(t[j - 1])) c += 4;
            }
            if (best[r - 1][i] + c < best[r][j]) { best[r][j] = best[r - 1][i] + c; prev[r][j] = i; }
          }
        }
      }
      const rows = [];
      for (let r = k, j = n; r > 0; j = prev[r][j], r--) rows.unshift(t.slice(prev[r][j], j).join(' '));
      if (rows.every((x) => x.length <= L) || k === n) return rows;
    }
    return [full];
  }

  function widest(line, L) { return Math.max(...wrap(line.words, L, line.force2).map((s) => s.length)); }
  // Too long = a row that cannot be wrapped under L characters (a single huge word). More rows than N
  // is allowed: Sentences mode and manual merges choose that on purpose, and Fit keeps the height safe.
  function isOver(line, L) {
    return Math.max(...wrap(line.words, L, line.force2).map((s) => s.length)) > L;
  }

  // Max rows typed by the user: any whole number from 1 up; anything unreadable falls back to def.
  function clampRows(v, def) {
    const n = parseInt(String(v).trim(), 10);
    if (isNaN(n)) return def;
    return Math.max(1, Math.min(99, n));
  }
  // A caption fits when it wraps into at most N rows of at most L characters.
  function fits(ws, L, N) {
    const rows = wrap(ws, L, false);
    return rows.length <= N && Math.max(...rows.map((x) => x.length)) <= L;
  }

  // The cheapest split of one sentence into captions that fit N rows of L characters, preferring
  // breaks after punctuation and avoiding orphans and dangling short words. A chunk that does not
  // fit is never used (a single word always is, even when it is longer than a row).
  function chunkSentence(s, L, N) {
    const cap = L * N;
    const n = s.length, best = new Array(n + 1).fill(Infinity), prev = new Array(n + 1).fill(-1);
    best[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const chunk = s.slice(i, j);
        const len = chunk.map((w) => w[2]).join(' ').length;
        if (len > cap && j - i > 1) break;
        if (j - i > 1 && !fits(chunk, L, N)) continue;
        let c = 0;
        const fill = len / cap;
          c += (1 - fill) * (1 - fill) * 40;
          const last = chunk[chunk.length - 1][2];
          if (j < n) {
            if (endsClause(last)) c -= 8; else c += 14;
            if (isWeak(last)) c += 40;
          }
          if (chunk.length === 1 && n > 1) c += 60;
          if (best[i] + c < best[j]) { best[j] = best[i] + c; prev[j] = i; }
      }
    }
    const cuts = [];
    for (let j = n; j > 0; j = prev[j]) cuts.unshift(s.slice(prev[j], j));
    return cuts;
  }

  // Groups words into captions: sentence by sentence, each cut into chunks of at most N rows.
  function autoLines(words, L, N, pauseBreak = 0.6) {
    const out = [];
    for (const s of sentencesOf(words, pauseBreak)) {
      for (const ch of chunkSentence(s, L, N)) out.push({ id: newId(), words: ch.map((w) => w.slice()) });
    }
    return out;
  }

  // Splits words into sentences (sentence-ending punctuation or a pause longer than pauseBreak).
  function sentencesOf(words, pauseBreak = 0.6) {
    const out = [];
    let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const nx = words[i + 1];
      if (endsSentence(w[2]) || (nx && nx[0] - w[1] > pauseBreak)) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // One word per caption — the starting point for building lines by hand.
  function wordLines(words) {
    return words.map((w) => ({ id: newId(), words: [w.slice()] }));
  }

  // One caption per sentence. Two sentences never share a caption. A sentence that does not fit
  // N rows of L characters is cut after commas / colons into as few pieces as possible; a piece
  // that still does not fit (no comma in it) is cut at its most natural points like Auto does.
  function sentenceLines(words, L, N) {
    const out = [];
    const push = (ws) => out.push({ id: newId(), words: ws.map((w) => w.slice()) });
    for (const s of sentencesOf(words)) {
      if (fits(s, L, N)) { push(s); continue; }
      const pieces = [];
      let cur = [];
      s.forEach((w, i) => { cur.push(w); if (endsClause(w[2]) && i < s.length - 1) { pieces.push(cur); cur = []; } });
      if (cur.length) pieces.push(cur);
      let acc = [];
      const flush = () => {
        if (!acc.length) return;
        if (fits(acc, L, N) || acc.length === 1) push(acc); else chunkSentence(acc, L, N).forEach(push);
        acc = [];
      };
      for (const pc of pieces) {
        if (acc.length && !fits(acc.concat(pc), L, N)) flush();
        acc = acc.concat(pc);
      }
      flush();
    }
    return out;
  }

  function mergeRange(lines, a, b) {
    const merged = { id: lines[a].id, words: lines.slice(a, b + 1).flatMap((l) => l.words.map((w) => w.slice())) };
    return lines.slice(0, a).concat([merged], lines.slice(b + 1));
  }

  // Splits a line in two at the most natural point near the middle.
  function splitLine(lines, i) {
    const l = lines[i];
    if (!l || l.words.length < 2) return null;
    let best = null;
    for (let k = 1; k < l.words.length; k++) {
      const a = l.words.slice(0, k).map((w) => w[2]).join(' '), b = l.words.slice(k).map((w) => w[2]).join(' ');
      let c = Math.abs(a.length - b.length);
      if (endsClause(l.words[k - 1][2]) || endsSentence(l.words[k - 1][2])) c -= 12;
      if (isWeak(l.words[k - 1][2])) c += 10;
      if (!best || c < best.c) best = { c, k };
    }
    const first = { id: l.id, words: l.words.slice(0, best.k) };
    const second = { id: newId(), words: l.words.slice(best.k) };
    return lines.slice(0, i).concat([first, second], lines.slice(i + 1));
  }

  // Replaces a line's text; keeps word timings when the word count is unchanged.
  function setText(line, text) {
    const toks = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!toks.length) return line;
    if (toks.length === line.words.length) return { ...line, words: line.words.map((w, k) => [w[0], w[1], toks[k]]) };
    const s = line.words[0][0], e = line.words[line.words.length - 1][1], d = (e - s) / toks.length;
    return { ...line, words: toks.map((t, k) => [round(s + k * d), round(s + (k + 1) * d), t]) };
  }
  const round = (x) => Math.round(x * 1000) / 1000;

  // Start/end of each caption on the timeline: shown until the next one starts (max 0.6 s after its last word).
  function spans(lines, hold = 0.6) {
    return lines.map((l, i) => {
      const s = l.words[0][0], last = l.words[l.words.length - 1][1];
      const nx = lines[i + 1] ? lines[i + 1].words[0][0] : Infinity;
      return [s, Math.max(s + 0.1, Math.min(last + hold, nx))];
    });
  }

  // ---------- SRT / VTT ----------
  function stamp(t, vtt) {
    t = Math.max(0, t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000) % 1000;
    const p = (x, n = 2) => String(x).padStart(n, '0');
    return `${p(h)}:${p(m)}:${p(s)}${vtt ? '.' : ','}${p(ms, 3)}`;
  }
  function toSubtitles(lines, L, vtt) {
    const sp = spans(lines);
    const body = lines.map((l, i) =>
      `${vtt ? '' : i + 1 + '\n'}${stamp(sp[i][0], vtt)} --> ${stamp(sp[i][1], vtt)}\n${wrap(l.words, L, l.force2).join('\n')}\n`).join('\n');
    return (vtt ? 'WEBVTT\n\n' : '') + body;
  }
  function parseSubtitles(text) {
    const toS = (x) => { const m = x.replace(',', '.').split(':'); return m.length === 3 ? +m[0] * 3600 + +m[1] * 60 + +m[2] : +m[0] * 60 + +m[1]; };
    const re = /((?:\d+:)?\d\d:\d\d[,.]\d{3})\s*-->\s*((?:\d+:)?\d\d:\d\d[,.]\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
    const out = [];
    let m;
    text = text.replace(/\r\n?/g, '\n');
    while ((m = re.exec(text))) {
      const s = toS(m[1]), e = toS(m[2]);
      const toks = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      if (!toks.length) continue;
      const d = (e - s) / toks.length;
      out.push({ id: newId(), words: toks.map((t, k) => [round(s + k * d), round(s + (k + 1) * d), t]) });
    }
    return out;
  }

  // ---------- recogniser output -> words ----------
  // whisper.cpp --output-json-full with --dtw: tokens carry t_dtw (start, 10 ms units) and offsets (ms).
  function wordsFromWhisper(json, offset = 0) {
    const words = [];
    for (const seg of json.transcription || []) {
      for (const t of seg.tokens || []) {
        const tx = t.text || '';
        if (/^\[_/.test(tx) || /^\[.*\]$/.test(tx.trim())) continue;
        const start = t.t_dtw >= 0 ? t.t_dtw / 100 : t.offsets.from / 1000;
        const end = t.offsets.to / 1000;
        if (tx.startsWith(' ') || !words.length) words.push([start, end, tx.trim()]);
        else { const w = words[words.length - 1]; w[2] += tx; w[1] = Math.max(w[1], end); }
      }
    }
    const clean = words.filter((w) => w[2] && /[\p{L}\p{N}]/u.test(w[2]));
    // glue stray punctuation-only tokens to the previous word
    for (let i = 0; i < words.length; i++) {
      if (words[i][2] && !/[\p{L}\p{N}]/u.test(words[i][2])) {
        const prevW = clean.filter((w) => w[0] <= words[i][0]).pop();
        if (prevW) prevW[2] += words[i][2];
      }
    }
    // starts must increase; in continuous speech a word lasts until the next one starts
    // (pauses are cut back later by snapToSilence)
    for (let i = 0; i < clean.length; i++) {
      if (i && clean[i][0] < clean[i - 1][0]) clean[i][0] = clean[i - 1][0];
      const nx = clean[i + 1];
      if (nx) clean[i][1] = Math.min(Math.max(nx[0], clean[i][0] + 0.05), clean[i][0] + 2.5);
      else clean[i][1] = Math.max(clean[i][1], clean[i][0] + 0.4);
      clean[i][0] = round(clean[i][0] + offset); clean[i][1] = round(clean[i][1] + offset);
    }
    return clean;
  }

  function wordsFromScribe(json, offset = 0) {
    return (json.words || []).filter((w) => w.type === 'word' && w.text.trim())
      .map((w) => [round(w.start + offset), round(w.end + offset), w.text.trim()]);
  }

  // True when the same sentence repeats 3+ times in a row (a known whisper loop).
  function looksLooped(json) {
    const segs = (json.transcription || []).map((s) => s.text.trim().toLowerCase()).filter(Boolean);
    let run = 1;
    for (let i = 1; i < segs.length; i++) {
      run = segs[i] === segs[i - 1] || (segs[i].length > 20 && segs[i - 1].includes(segs[i])) ? run + 1 : 1;
      if (run >= 3) return true;
    }
    return false;
  }

  // Pulls word ends back to where a pause actually starts (whisper stretches words over silence).
  function snapToSilence(words, silences) {
    return words.map((w) => {
      const s = silences.find(([a, b]) => a > w[0] + 0.05 && a < w[1]);
      return s ? [w[0], round(Math.max(w[0] + 0.08, s[0] + 0.03)), w[2]] : w;
    });
  }

  // Which Subtext data a comp opens with: the one stored in AE, or the panel's unsaved draft. AE renumbers comp ids
  // when a project is reopened, so a draft keyed by id may belong to another comp: it counts only when it carries
  // the same uid as the stored data (or, with nothing stored yet, has no captions and the same comp name).
  function pickDoc(stored, draft, compName) {
    const d = draft && draft.doc;
    if (d && d.uid) {
      if (stored && stored.uid === d.uid && draft.savedAt > (stored.savedAt || 0)) return { doc: d, fromDraft: true };
      if (!stored && !(d.versions || []).length && draft.comp === compName) return { doc: d, fromDraft: true };
    }
    return { doc: stored || null, fromDraft: false };
  }

  const api = { FORMATS, DEFAULT_LIMITS, newId, clampRows, fits, pickDoc, formatFor, textOf, wrap, widest, isOver, autoLines, sentencesOf, wordLines, sentenceLines, mergeRange, splitLine,
    setText, spans, stamp, toSubtitles, parseSubtitles, wordsFromWhisper, wordsFromScribe, looksLooped, snapToSilence };
  // CEP pages with Node enabled also define `module`, so always publish on window too.
  if (typeof window !== 'undefined') window.Lines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
