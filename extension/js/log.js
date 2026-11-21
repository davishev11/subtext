// Subtext — writes panel errors to ~/Library/Application Support/Subtext/panel.log (loaded first).
(function () {
  'use strict';
  let fs = null, file = null;
  try {
    fs = window.cep_node.require('fs');
    const dir = window.cep_node.require('os').homedir() + '/Library/Application Support/Subtext';
    fs.mkdirSync(dir, { recursive: true });
    file = dir + '/panel.log';
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
  } catch (e) { /* no Node: logging stays in the console only */ }
  function write(level, args) {
    const line = new Date().toISOString() + ' ' + level + ' ' + [...args].map((a) => (a && a.stack) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
    if (fs && file) try { fs.appendFileSync(file, line); } catch (e) {}
  }
  const orig = { error: console.error, warn: console.warn, log: console.log };
  console.error = (...a) => { write('ERROR', a); orig.error.apply(console, a); };
  console.warn = (...a) => { write('WARN', a); orig.warn.apply(console, a); };
  window.slog = (...a) => { write('INFO', a); orig.log.apply(console, a); };
  window.addEventListener('error', (e) => write('ERROR', [e.message, (e.filename || '').split('/').pop() + ':' + e.lineno]));
  window.addEventListener('unhandledrejection', (e) => write('ERROR', ['unhandled', e.reason]));
  write('INFO', ['panel start', navigator.userAgent.match(/Chrome\/[\d.]+/) || '']);
})();
