// Run: node tests/engine.test.js   (needs extension/bin/whisper-cli and the turbo model)
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
// Spec (Daria 2026-11-21, a DMG for everyone): a plugin copied from a downloaded DMG keeps macOS's quarantine
// flag and Gatekeeper blocks the unsigned whisper-cli (it hangs). The panel runs its own clean copy.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subtext-q-'));
  process.env.SUBTEXT_HOME = path.join(tmp, 'home');
  const ext = path.join(tmp, 'ext'); fs.mkdirSync(path.join(ext, 'bin'), { recursive: true });
  const src = path.join(ext, 'bin', 'whisper-cli');
  fs.copyFileSync(path.join(__dirname, '../extension/bin/whisper-cli'), src);
  execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;6b01c24e;Safari;', src]);
  delete require.cache[require.resolve('../extension/js/engine.js')];
  const E0 = require('../extension/js/engine.js');
  const bin = E0.whisperBin(ext);
  assert.notStrictEqual(bin, src, 'runs a copy, not the quarantined file');
  assert(!execFileSync('xattr', [bin]).toString().includes('quarantine'), 'the copy has no quarantine flag');
  assert(fs.readFileSync(bin).equals(fs.readFileSync(src)), 'same bytes');
  assert(execFileSync('perl', ['-e', 'alarm 15; exec @ARGV', bin, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] }) !== null, 'the copy runs');
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.SUBTEXT_HOME;
  delete require.cache[require.resolve('../extension/js/engine.js')];
  console.log('quarantine: the panel runs a clean copy of whisper-cli');
}
const E = require('../extension/js/engine.js');
const L = require('../extension/js/lines.js');
(async () => {
  for (const f of ['ae_like.aif', 'ae_like.wav']) {
    const t0 = Date.now();
    const a = E.prepareAudio(path.join(__dirname, '../research/out', f));
    assert(Math.abs(a.duration - 83.3) < 0.2, 'duration ' + a.duration);
    console.log(`${f}: ${a.duration.toFixed(1)} s, ${a.silences.length} pauses, ${Date.now() - t0} ms`);
    if (f.endsWith('.wav')) continue;
    let last = 0;
    const r = await E.whisper({ extRoot: path.join(__dirname, '../extension'), modelKey: 'turbo', wav: a.wav, lang: 'auto', exact: true,
      silences: a.silences, offset: 10, onProgress: (p, s) => { if (p - last > 0.3) { last = p; console.log('  ', Math.round(p * 100) + '%', s); } } });
    console.log(`   lang=${r.lang} words=${r.words.length} first=${JSON.stringify(r.words[0])} in ${(Date.now() - t0) / 1000}s`);
    assert(r.lang === 'en' && r.words.length > 230 && r.words[0][0] >= 10);
    const lines = L.autoLines(r.words, 24, 2);
    console.log('  ', lines.slice(0, 4).map((l) => L.wrap(l.words, 24).join(' / ')).join(' | '));
  }
  console.log('engine.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
