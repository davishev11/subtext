// Subtext — Node side: audio conversion, local whisper, model downloads, ElevenLabs Scribe.
// Runs inside the CEP panel (cep_node.require) and in plain Node for tests.
(function (root) {
  'use strict';
  const req = (typeof window !== 'undefined' && window.cep_node) ? window.cep_node.require : require;
  const fs = req('fs');
  const path = req('path');
  const os = req('os');
  const crypto = req('crypto');
  const { spawn } = req('child_process');
  const proc = (typeof window !== 'undefined' && window.cep_node) ? window.cep_node.process : process;
  const Buf = (typeof window !== 'undefined' && window.cep_node) ? window.cep_node.Buffer : Buffer;
  const Lines = (typeof window !== 'undefined' && window.Lines) ? window.Lines : req(path.join(__dirname, 'lines.js'));

  const HOME = proc.env.SUBTEXT_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'Subtext');
  const DIRS = { models: path.join(HOME, 'models'), cache: path.join(HOME, 'cache') };
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

  const MODELS = {
    small: { name: 'Small', file: 'ggml-small.bin', size: 487601967, sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5', dtw: 'small', note: 'Fastest, a few more mistakes' },
    turbo: { name: 'Turbo', file: 'ggml-large-v3-turbo.bin', size: 1624555275, sha1: '4af2b29d7ec73d781377bfd1758ca957a807e941', dtw: 'large.v3.turbo', note: 'Recommended: fast and accurate' },
    large: { name: 'Large-v3', file: 'ggml-large-v3.bin', size: 3095033483, sha1: 'ad82bf6a9043ceed055076d0fd39f5f186ff8062', dtw: 'large.v3', note: 'Most accurate, 2–3× slower' },
  };
  const MODEL_URL = (f) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}`;

  // A short punctuated example nudges whisper (turbo) into writing sentences with punctuation.
  const PROMPTS = {
    en: "Hi, Mom. Wait... really? Yes! I said: it's fine, thanks.",
    uk: 'Привіт, мамо. Зачекай... справді? Так! Я сказала: все гаразд, дякую.',
    ru: 'Привет, мама. Подожди... правда? Да! Я сказала: всё хорошо, спасибо.',
    de: 'Hallo, Mama. Warte... wirklich? Ja! Ich sagte: alles gut, danke.',
    es: 'Hola, mamá. Espera... ¿de verdad? ¡Sí! Dije: está bien, gracias.',
    fr: "Salut, maman. Attends... vraiment ? Oui ! J'ai dit : ça va, merci.",
    pl: 'Cześć, mamo. Czekaj... naprawdę? Tak! Powiedziałam: wszystko dobrze, dzięki.',
    it: 'Ciao, mamma. Aspetta... davvero? Sì! Ho detto: va bene, grazie.',
    pt: 'Oi, mãe. Espera... sério? Sim! Eu disse: está tudo bem, obrigada.',
  };

  function modelPath(key) { return path.join(DIRS.models, MODELS[key].file); }
  function modelReady(key) {
    try { return fs.statSync(modelPath(key)).size === MODELS[key].size; } catch (e) { return false; }
  }
  function partialBytes(key) { try { return fs.statSync(modelPath(key) + '.part').size; } catch (e) { return 0; } }

  // ---------- audio ----------
  // Reads a WAV (PCM 16/24/32, float 32) or AIFF/AIFC (big-endian PCM) file into mono Float32.
  function decode(buf) {
    const id = buf.toString('ascii', 0, 4), form = buf.toString('ascii', 8, 12);
    let ch = 0, rate = 0, bits = 0, float = false, data = null, be = false;
    if (id === 'RIFF' && form === 'WAVE') {
      for (let p = 12; p + 8 <= buf.length;) {
        const ck = buf.toString('ascii', p, p + 4), sz = buf.readUInt32LE(p + 4);
        if (ck === 'fmt ') { const fmt = buf.readUInt16LE(p + 8); ch = buf.readUInt16LE(p + 10); rate = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); float = fmt === 3 || (fmt === 0xfffe && buf.readUInt16LE(p + 32) === 3); }
        if (ck === 'data') data = buf.subarray(p + 8, p + 8 + Math.min(sz, buf.length - p - 8));
        p += 8 + sz + (sz & 1);
      }
    } else if (id === 'FORM' && (form === 'AIFF' || form === 'AIFC')) {
      be = true;
      for (let p = 12; p + 8 <= buf.length;) {
        const ck = buf.toString('ascii', p, p + 4), sz = buf.readUInt32BE(p + 4);
        if (ck === 'COMM') {
          ch = buf.readUInt16BE(p + 8); bits = buf.readUInt16BE(p + 14);
          const e = buf.readUInt16BE(p + 16) & 0x7fff, hi = buf.readUInt32BE(p + 18);
          rate = Math.round(hi * Math.pow(2, e - 16383 - 31));
          if (form === 'AIFC') { const ct = buf.toString('ascii', p + 26, p + 30); float = ct === 'fl32' || ct === 'FL32'; if (ct === 'sowt') be = false; }
        }
        if (ck === 'SSND') { const off = buf.readUInt32BE(p + 8); data = buf.subarray(p + 16 + off, p + 8 + sz); }
        p += 8 + sz + (sz & 1);
      }
    } else throw new Error('Unknown audio format from After Effects');
    if (!data || !ch || !rate) throw new Error('Empty or damaged audio file');
    const bps = bits / 8, frames = Math.floor(data.length / (bps * ch)), out = new Float32Array(frames);
    const read = (o) => {
      if (float) return be ? data.readFloatBE(o) : data.readFloatLE(o);
      if (bits === 16) return (be ? data.readInt16BE(o) : data.readInt16LE(o)) / 32768;
      if (bits === 24) return (be ? data.readIntBE(o, 3) : data.readIntLE(o, 3)) / 8388608;
      if (bits === 32) return (be ? data.readInt32BE(o) : data.readInt32LE(o)) / 2147483648;
      if (bits === 8) return (data.readUInt8(o) - 128) / 128;
      throw new Error('Unsupported bit depth ' + bits);
    };
    for (let f = 0; f < frames; f++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += read((f * ch + c) * bps);
      out[f] = s / ch;
    }
    return { samples: out, rate };
  }

  // Box-filtered resample to 16 kHz, the rate whisper expects.
  function to16k({ samples, rate }) {
    if (rate === 16000) return samples;
    const ratio = rate / 16000, n = Math.floor(samples.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.min(samples.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
      let s = 0;
      for (let k = a; k < b; k++) s += samples[k];
      out[i] = s / (b - a);
    }
    return out;
  }

  function writeWav16(file, s) {
    const b = Buf.alloc(44 + s.length * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
    b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(s.length * 2, 40);
    for (let i = 0; i < s.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2);
    fs.writeFileSync(file, b);
  }

  // Quiet stretches (>= minDur s) relative to the voice level, as [start, end] in seconds.
  function silences(s, minDur = 0.25) {
    const win = 320, rms = [];
    for (let i = 0; i + win <= s.length; i += win) {
      let e = 0;
      for (let k = i; k < i + win; k++) e += s[k] * s[k];
      rms.push(Math.sqrt(e / win));
    }
    const sorted = rms.slice().sort((a, b) => a - b);
    const loud = sorted[Math.floor(sorted.length * 0.9)] || 0;
    const thr = Math.max(loud * 0.06, 0.003);
    const out = [];
    let st = -1;
    rms.forEach((v, i) => {
      if (v < thr) { if (st < 0) st = i; }
      else if (st >= 0) { if ((i - st) * 0.02 >= minDur) out.push([st * 0.02, i * 0.02]); st = -1; }
    });
    if (st >= 0 && (rms.length - st) * 0.02 >= minDur) out.push([st * 0.02, rms.length * 0.02]);
    return out;
  }

  // ---------- temporary files ----------
  // Temp audio goes either to the app folder or to "Subtext cache" next to the saved .aep.
  const PROJECT_CACHE = 'Subtext cache';
  function cacheDir(projectFile, nextToProject) {
    const dir = nextToProject && projectFile ? path.join(path.dirname(projectFile), PROJECT_CACHE) : DIRS.cache;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  function folderSize(dir) {
    let n = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f), st = fs.statSync(p);
        n += st.isDirectory() ? folderSize(p) : st.size;
      }
    } catch (e) {}
    return n;
  }
  // Deletes Subtext's own temp files (never models, never anything else). olderThanMs = 0 clears all.
  function clearCache(dirs, olderThanMs = 0) {
    let n = 0, bytes = 0;
    const now = Date.now();
    for (const dir of dirs) {
      let list = [];
      try { list = fs.readdirSync(dir); } catch (e) { continue; }
      for (const f of list) {
        if (!/^subtext_/.test(f)) continue;
        const p = path.join(dir, f);
        try {
          const st = fs.statSync(p);
          if (olderThanMs && now - st.mtimeMs < olderThanMs) continue;
          fs.unlinkSync(p); n++; bytes += st.size;
        } catch (e) {}
      }
      // remove an emptied project cache folder
      if (path.basename(dir) === PROJECT_CACHE) try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch (e) {}
    }
    for (const f of ['panel.log.old']) try { const p = path.join(HOME, f); bytes += fs.statSync(p).size; fs.unlinkSync(p); } catch (e) {}
    return { files: n, bytes };
  }
  function reveal(dir) { try { fs.mkdirSync(dir, { recursive: true }); spawn('open', [dir], { stdio: 'ignore' }); } catch (e) {} }

  function prepareAudio(srcFile, dir) {
    const pcm = to16k(decode(fs.readFileSync(srcFile)));
    if (!pcm.length) throw new Error('There is no audio in the work area');
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak < 0.001) throw new Error('The work-area audio is silent or muted');
    const wav = path.join(dir || DIRS.cache, 'subtext_16k_' + Date.now() + '.wav');
    writeWav16(wav, pcm);
    return { wav, duration: pcm.length / 16000, silences: silences(pcm) };
  }

  // ---------- whisper ----------
  // A plugin installed from a downloaded DMG carries macOS's quarantine flag, and Gatekeeper then blocks (hangs)
  // the unsigned whisper-cli. A copy written by the panel itself has no such flag, so the panel runs its own
  // copy from ~/Library/Application Support/Subtext/bin, refreshed whenever the plugin's binary changes.
  function whisperBin(extRoot) {
    const src = path.join(extRoot, 'bin', 'whisper-cli');
    if (!fs.existsSync(src)) return src;
    const dest = path.join(HOME, 'bin', 'whisper-cli');
    try {
      const a = fs.statSync(src), b = fs.existsSync(dest) ? fs.statSync(dest) : null;
      if (!b || b.size !== a.size || b.mtimeMs < a.mtimeMs) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + '.tmp';
        fs.writeFileSync(tmp, fs.readFileSync(src));
        fs.chmodSync(tmp, 0o755);
        fs.renameSync(tmp, dest);
      }
      return dest;
    } catch (e) { return src; }
  }

  function run(bin, args, onLine) {
    return new Promise((resolve, reject) => {
      const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...proc.env, GGML_METAL_PATH_RESOURCES: path.dirname(bin) } });
      let err = '', buf = '';
      const feed = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine && onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
      p.stdout.on('data', feed);
      p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); feed(d); });
      p.on('error', reject);
      // CEP's Node does not always emit 'close' for child pipes, so finish on 'exit' after the pipes drain.
      let done = false;
      const end = (code) => {
        if (done) return; done = true;
        if (buf) { onLine && onLine(buf); buf = ''; }
        code === 0 ? resolve(err) : reject(new Error('whisper failed with code ' + code + ':\n' + err.split('\n').slice(-6).join('\n')));
      };
      p.on('exit', (code) => setTimeout(() => end(code), 150));
      p.on('close', end);
      run.current = p;
    });
  }
  function cancel() { if (run.current) try { run.current.kill(); } catch (e) {} }

  async function detectLanguage(bin, model, wav) {
    let lang = null;
    await run(bin, ['-m', model, '-f', wav, '-dl', '-l', 'auto', '-np'], (l) => {
      const m = l.match(/auto-detected language:\s*([a-z]{2,3})/); if (m) lang = m[1];
    }).catch(() => {});
    return lang;
  }

  // Transcribes a 16 kHz WAV locally. Returns { words, lang }. onProgress(0..1, label).
  async function whisper({ extRoot, modelKey, wav, lang, exact, silences: sil, offset, onProgress }) {
    const bin = whisperBin(extRoot), model = modelPath(modelKey), M = MODELS[modelKey];
    if (!fs.existsSync(bin)) throw new Error('whisper-cli is missing from the plugin. Please reinstall Subtext.');
    if (!modelReady(modelKey)) throw new Error('The ' + M.name + ' model is not downloaded yet (⚙)');
    try { fs.chmodSync(bin, 0o755); } catch (e) {}
    if (!lang || lang === 'auto') { onProgress && onProgress(0.02, 'Detecting language'); lang = (await detectLanguage(bin, model, wav)) || 'auto'; }
    const out = path.join(path.dirname(wav), 'subtext_' + Date.now());
    const args = ['-m', model, '-f', wav, '-l', lang, '-ojf', '-of', out, '-pp', '-np'];
    // Large-v3 punctuates on its own and loops when prompted; the others need the prompt.
    if (PROMPTS[lang] && modelKey !== 'large') args.push('--prompt', PROMPTS[lang]);
    if (exact) args.push('-nfa', '--dtw', M.dtw);
    const progress = (l) => { const m = l.match(/progress\s*=\s*(\d+)%/); if (m && onProgress) onProgress(0.05 + 0.9 * (+m[1] / 100), 'Recognition'); };
    await run(bin, args, progress);
    let json = JSON.parse(fs.readFileSync(out + '.json', 'utf8'));
    if (Lines.looksLooped(json)) {
      onProgress && onProgress(0.5, 'The model looped — retrying without context');
      await run(bin, args.concat(['-mc', '0']), progress);
      json = JSON.parse(fs.readFileSync(out + '.json', 'utf8'));
    }
    try { fs.unlinkSync(out + '.json'); } catch (e) {}
    let words = Lines.wordsFromWhisper(json, 0);
    if (sil && sil.length) words = Lines.snapToSilence(words, sil);
    if (offset) words = words.map((w) => [w[0] + offset, w[1] + offset, w[2]]);
    return { words, lang: json.result && json.result.language || lang };
  }

  // ---------- ElevenLabs Scribe ----------
  async function scribe({ key, wav, lang, offset }) {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'false');
    if (lang && lang !== 'auto') form.append('language_code', lang);
    form.append('file', new Blob([new Uint8Array(fs.readFileSync(wav))], { type: 'audio/wav' }), 'audio.wav');
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
    const txt = await r.text();
    if (!r.ok) throw new Error('ElevenLabs ' + r.status + ': ' + txt.slice(0, 300));
    const json = JSON.parse(txt);
    return { words: Lines.wordsFromScribe(json, offset || 0), lang: json.language_code || lang };
  }

  async function checkKey(key) {
    const r = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
    return r.ok;
  }

  // ---------- model download (resumable, verified) ----------
  // Uses the browser's fetch: inside After Effects, Node's own https requests can hang.
  const downloads = {};
  function sha1File(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha1'), fd = fs.openSync(file, 'r'), chunk = Buf.alloc(8 * 1024 * 1024);
      const step = () => {
        try {
          for (let k = 0; k < 8; k++) {
            const n = fs.readSync(fd, chunk, 0, chunk.length, null);
            if (!n) { fs.closeSync(fd); return resolve(h.digest('hex')); }
            h.update(chunk.subarray(0, n));
          }
          setTimeout(step, 0);
        } catch (e) { try { fs.closeSync(fd); } catch (e2) {} reject(e); }
      };
      step();
    });
  }
  function download(key, onProgress) {
    if (downloads[key]) return downloads[key].promise;
    const M = MODELS[key], dest = modelPath(key), part = dest + '.part';
    const state = { ctrl: new AbortController() };
    state.promise = (async () => {
      const have = partialBytes(key);
      let r;
      try {
        r = await fetch(MODEL_URL(M.file), { headers: have ? { Range: 'bytes=' + have + '-' } : {}, signal: state.ctrl.signal });
      } catch (e) { throw new Error(state.ctrl.signal.aborted ? 'Cancelled' : 'Cannot reach the model server'); }
      let got = 0;
      if (r.status !== 416) {
        if (r.status !== 200 && r.status !== 206) throw new Error('The model server answered ' + r.status);
        const resumed = r.status === 206;
        got = resumed ? have : 0;
        const fd = fs.openSync(part, resumed ? 'a' : 'w');
        const reader = r.body.getReader();
        let last = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            fs.writeSync(fd, Buf.from(value.buffer, value.byteOffset, value.byteLength));
            got += value.byteLength;
            const now = Date.now();
            if (now - last > 250) { last = now; onProgress && onProgress(got / M.size, got); }
          }
        } catch (e) {
          throw new Error(state.ctrl.signal.aborted ? 'Cancelled' : 'The download was interrupted — click again to resume');
        } finally { fs.closeSync(fd); }
      } else got = have;
      if (got < M.size) throw new Error('The download was interrupted — click again to resume');
      onProgress && onProgress(1, M.size, 'Verifying file');
      if ((await sha1File(part)) !== M.sha1) { fs.unlinkSync(part); throw new Error('The model file is damaged — please download it again'); }
      fs.renameSync(part, dest);
      return dest;
    })().finally(() => { delete downloads[key]; });
    downloads[key] = state;
    return state.promise;
  }
  function cancelDownload(key) { const d = downloads[key]; if (d) d.ctrl.abort(); }

  const api = { HOME, DIRS, MODELS, PROMPTS, PROJECT_CACHE, cacheDir, folderSize, clearCache, reveal, modelPath, modelReady, partialBytes, decode, to16k, writeWav16, silences, prepareAudio,
    whisper, whisperBin, cancel, scribe, checkKey, download, cancelDownload, isDownloading: (k) => !!downloads[k] };
  // CEP pages with Node enabled also define `module`, so always publish on window too.
  if (typeof window !== 'undefined') window.Engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
