// Run: node tests/lines.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../extension/js/lines.js');

const sample = path.join(__dirname, '../research/out/static_test.json');
if (fs.existsSync(sample)) {
  const words = L.wordsFromWhisper(JSON.parse(fs.readFileSync(sample, 'utf8')));
  assert(words.length > 200, 'words parsed');
  for (let i = 1; i < words.length; i++) assert(words[i][0] >= words[i - 1][0], 'starts increase');
  assert(!words.some((w) => !/[a-z0-9]/i.test(w[2])), 'no punctuation-only words');
  const lines = L.autoLines(words, 24, 2);
  const over = lines.filter((l) => L.isOver(l, 24, 2));
  assert.strictEqual(over.length, 0, 'every line fits 24x2');
  assert.strictEqual(lines.flatMap((l) => l.words).length, words.length, 'no words lost');
  const orphans = lines.filter((l) => l.words.length === 1);
  console.log(`whisper: ${words.length} words -> ${lines.length} captions, ${orphans.length} single-word`);
  lines.slice(0, 12).forEach((l) => console.log('   ', L.wrap(l.words, 24, false).join(' / ')));
  const yt = L.autoLines(words, 42, 2);
  console.log(`16:9: ${yt.length} captions`);
}

// words / sentences modes
const W = [[0, .3, 'Hi,'], [.3, .6, 'Mom.'], [.6, .9, 'I'], [.9, 1.2, 'made'], [1.2, 1.5, 'tea,'], [1.5, 1.8, 'then'], [1.8, 2.1, 'coffee,'], [2.1, 2.4, 'and'], [2.4, 2.7, 'cake.'], [2.7, 3, 'Ok?']];
assert.strictEqual(L.wordLines(W).length, W.length);
// L=12: every clause fits one row (since Max rows, a row may never be wider than L)
const sl = L.sentenceLines(W, 12, 1);
assert.deepStrictEqual(sl.map(L.textOf), ['Hi, Mom.', 'I made tea,', 'then coffee,', 'and cake.', 'Ok?']);
const sl2 = L.sentenceLines(W, 24, 2);
assert.deepStrictEqual(sl2.map(L.textOf), ['Hi, Mom.', 'I made tea, then coffee, and cake.', 'Ok?']);

// ---------- Max rows (spec from Daria, 2026-11-15) ----------
// Max rows is any whole number, set per comp. Auto and Sentences never make a caption with more rows
// than Max rows (only a single word longer than a row may overflow); every row stays within L characters;
// no word is lost or reordered; Sentences never puts two sentences into one caption;
// Max rows 2 gives exactly the old Auto result.
{
  const rows = (l, Lc) => L.wrap(l.words, Lc, l.force2).length;
  const widestRow = (l, Lc) => Math.max(...L.wrap(l.words, Lc, l.force2).map((r) => r.length));
  const text = 'So here is the thing nobody tells you about starting a business in a new country with no friends and no money. ' +
    'You will fail, many times, and that is fine. Really? Yes. The first year I worked from a tiny kitchen, ' +
    'answered every email myself, cooked for clients, delivered orders by bike and still could not pay the rent on time ' +
    'because the bank kept losing my documents somewhere between two offices. Then everything changed.';
  const LW = text.split(' ').map((t, i) => [i * 0.3, i * 0.3 + 0.25, t]);
  const sid = new Map();
  L.sentencesOf(LW).forEach((s, i) => s.forEach((w) => sid.set(w[0], i)));
  let checked = 0;
  for (const [Lc, N] of [[18, 1], [18, 2], [18, 3], [18, 4], [18, 7], [18, 20], [36, 2], [36, 3]]) {
    for (const mode of ['fit', 'sent']) {
      const out = mode === 'fit' ? L.autoLines(LW, Lc, N) : L.sentenceLines(LW, Lc, N);
      assert.strictEqual(out.map(L.textOf).join(' '), text, `${mode} ${Lc}x${N}: a word was lost or moved`);
      out.forEach((l) => {
        assert(rows(l, Lc) <= N, `${mode} ${Lc}x${N}: "${L.textOf(l)}" has ${rows(l, Lc)} rows`);
        assert(widestRow(l, Lc) <= Lc, `${mode} ${Lc}x${N}: a row is wider than ${Lc} in "${L.textOf(l)}"`);
        if (mode === 'sent') assert.strictEqual(new Set(l.words.map((w) => sid.get(w[0]))).size, 1, `sentences ${Lc}x${N}: two sentences in "${L.textOf(l)}"`);
        checked++;
      });
    }
  }
  // more rows allowed -> fewer or equal captions
  const ac = [1, 2, 3, 4].map((N) => L.autoLines(LW, 18, N).length);
  assert(ac[0] >= ac[1] && ac[1] >= ac[2] && ac[2] >= ac[3], 'Auto caption count by rows: ' + ac);
  const sc = [1, 2, 3, 4].map((N) => L.sentenceLines(LW, 18, N).length);
  assert(sc[0] >= sc[1] && sc[1] >= sc[2] && sc[2] >= sc[3], 'Sentences caption count by rows: ' + sc);
  // 3 rows really uses 3 rows somewhere (the setting has an effect)
  assert(L.autoLines(LW, 18, 3).some((l) => rows(l, 18) === 3), 'Auto with Max rows 3 never used 3 rows');
  // plenty of rows -> one caption per sentence
  assert.strictEqual(L.sentenceLines(LW, 18, 20).length, L.sentencesOf(LW).length, 'Max rows 20: one caption per sentence');
  // Words ignores Max rows
  assert.strictEqual(L.wordLines(LW).length, LW.length);
  // a long sentence without commas still respects Max rows
  const noComma = 'this sentence has no commas at all and it goes on and on and on for quite a while yes.'.split(' ').map((t, i) => [i, i + 0.5, t]);
  L.sentenceLines(noComma, 18, 2).forEach((l) => assert(rows(l, 18) <= 2, 'no-comma sentence fits 2 rows: ' + L.textOf(l)));
  // a single word longer than a row is the only allowed overflow, and it is still one caption
  assert.strictEqual(L.autoLines([[0, 1, 'Supercalifragilisticexpialidocious']], 18, 2).length, 1);
  // bad input for Max rows falls back to a sane number
  assert.strictEqual(L.clampRows('abc', 2), 2); assert.strictEqual(L.clampRows('0', 2), 1); assert.strictEqual(L.clampRows(' 20 ', 2), 20); assert.strictEqual(L.clampRows('3.7', 2), 3);
  // regression: Max rows 2 = the result before this feature
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/auto_18x2.json'), 'utf8'));
  assert.deepStrictEqual(L.autoLines(LW, 18, 2).map(L.textOf), snap.auto, 'Auto at Max rows 2 changed vs the snapshot');
  const sentNow = L.sentenceLines(LW, 18, 2).map(L.textOf);
  snap.sentences.filter((t) => t.length <= 36).forEach((t) => assert(sentNow.includes(t), 'Sentences lost a caption that used to fit: ' + t));
  console.log(`max rows: ${checked} captions checked across 8 limits x 2 modes`);
}

// merge / split / edit
let lines = [{ id: 'a', words: [[0, 1, 'Hello'], [1, 2, 'there,']] }, { id: 'b', words: [[2, 3, 'my'], [3, 4, 'friend.']] }];
lines = L.mergeRange(lines, 0, 1);
assert.strictEqual(lines.length, 1);
assert.strictEqual(L.textOf(lines[0]), 'Hello there, my friend.');
lines = L.splitLine(lines, 0);
assert.deepStrictEqual(lines.map(L.textOf), ['Hello there,', 'my friend.']);
const ed = L.setText(lines[0], 'Hi there,');
assert.deepStrictEqual(ed.words.map((w) => w[0]), [0, 1]);
const ed2 = L.setText(lines[0], 'Hi');
assert.strictEqual(ed2.words.length, 1);

// srt round trip
const srt = L.toSubtitles(lines, 24, false);
const back = L.parseSubtitles(srt);
assert.deepStrictEqual(back.map(L.textOf), lines.map(L.textOf));
assert(L.toSubtitles(lines, 24, true).startsWith('WEBVTT'));
assert.strictEqual(L.stamp(3723.5, false), '01:02:03,500');

// formats
assert.strictEqual(L.formatFor(1080, 1920).k, '9:16');
assert.strictEqual(L.formatFor(1920, 1080).k, '16:9');
assert.strictEqual(L.formatFor(1080, 1350).k, '4:5');

// loops + silence
assert(L.looksLooped({ transcription: [{ text: 'a b c d e f g h i j k l' }, { text: 'a b c d e f g h i j k l' }, { text: 'a b c d e f g h i j k l' }] }));
assert.deepStrictEqual(L.snapToSilence([[1, 2, 'x']], [[1.5, 1.9]]), [[1, 1.53, 'x']]);

// drafts: AE renumbers comp ids when a project is reopened, so a draft saved under the same id can belong
// to another comp. A draft is used only when it belongs to the same Subtext data (same uid) and is newer.
{
  const stored = { uid: 'a', savedAt: 100, maxRows: 3, versions: [{ lines: [1] }] };
  const mine = { doc: { uid: 'a', savedAt: 100, maxRows: 4, versions: [] }, savedAt: 200, comp: 'C' };
  const other = { doc: { uid: 'b', savedAt: 50, maxRows: 0, versions: [{ lines: [1, 2] }] }, savedAt: 900, comp: 'C' };
  const old = { doc: { savedAt: 50, maxRows: 0, versions: [{ lines: [1, 2] }] }, savedAt: 900, comp: 'C' };
  assert.strictEqual(L.pickDoc(stored, mine, 'C').doc.maxRows, 4, 'own newer draft wins');
  assert.strictEqual(L.pickDoc(stored, { ...mine, savedAt: 50 }, 'C').doc.maxRows, 3, 'older draft loses');
  assert.strictEqual(L.pickDoc(stored, other, 'C').doc.maxRows, 3, 'draft of another comp is ignored');
  assert.strictEqual(L.pickDoc(stored, old, 'C').doc.maxRows, 3, 'draft without uid is ignored');
  assert.strictEqual(L.pickDoc(null, other, 'C').doc, null, 'no data: a draft with captions from another comp is ignored');
  const pre = { doc: { uid: 'n', savedAt: 0, maxRows: 5, versions: [] }, savedAt: 10, comp: 'C' };
  assert.strictEqual(L.pickDoc(null, pre, 'C').doc.maxRows, 5, 'Max rows typed before the first transcription survives');
  assert.strictEqual(L.pickDoc(null, pre, 'D').doc, null, 'but not in a comp with another name');
  assert.strictEqual(L.pickDoc(null, null, 'C').doc, null);
  assert(L.pickDoc(stored, mine, 'C').fromDraft && !L.pickDoc(stored, other, 'C').fromDraft);
}
console.log('lines.test.js: all passed');
