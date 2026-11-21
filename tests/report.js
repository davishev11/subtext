// Turns the suites' JSON results into a Markdown test report (tests/reports/<run>/report.md).
// Usage: node tests/report.js <run dir> <mode> <commit> <suite json files...>
const fs = require('fs');
const path = require('path');
const [dir, mode, commit, ...files] = process.argv.slice(2);
const suites = files.map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { test: path.basename(f), results: [{ n: 'suite did not run', ok: false, i: fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, 300) : 'no output' }] }; } });
let pass = 0, fail = 0;
suites.forEach((s) => s.results.forEach((r) => (r.ok ? pass++ : fail++)));
const esc = (t) => String(t).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160);
const out = [];
out.push(`# Subtext test report — ${fail ? '❌ ' + fail + ' failed' : '✅ all passed'}`, '');
out.push(`- When: ${new Date().toLocaleString('en-GB')}`, `- Code: \`${commit}\``, `- Mode: ${mode}`, `- Checks: ${pass} passed, ${fail} failed`, '');
for (const s of suites) {
  const f = s.results.filter((r) => !r.ok).length;
  out.push(`## ${f ? '❌' : '✅'} ${s.test} — ${s.results.length - f}/${s.results.length}`, '', '| | Check | Detail |', '|---|---|---|');
  s.results.forEach((r) => out.push(`| ${r.ok ? '✅' : '❌'} | ${esc(r.n)} | ${esc(r.i)} |`));
  out.push('');
}
const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
if (pngs.length) {
  out.push('## Frames', '');
  pngs.forEach((p) => out.push(`<img src="${p}" width="180" title="${p}">`));
  out.push('');
}
fs.writeFileSync(path.join(dir, 'report.md'), out.join('\n'));
console.log(`${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed → ${path.join(dir, 'report.md')}`);
suites.forEach((s) => s.results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${s.test}: ${r.n}  · ${r.i}`)));
process.exit(fail ? 1 : 0);
