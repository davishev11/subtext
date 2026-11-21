// Spec (Daria, 2026-11-15: "it inserts text slower than before"): Create and Fit stay quick.
// Measured on this Mac: 20 captions in ~3 s (was ~30 s before the seed copy), Fit on 40 with boxes ~14 s (was ~64 s).
// Limits are about 2.5x those numbers, so a slow day passes and a return of the old slowness does not.
TNAME = "Speed (AE)";
function ms(f) { var t = new Date().getTime(); f(); return new Date().getTime() - t; }
function caps(n) { var t = []; for (var i = 0; i < n; i++) t.push("Caption number " + i + " / second row here"); return mkLines(t); }
var a = caps(20), c1 = freshComp("AT speed plain", 1080, 1920, Math.ceil(a[a.length - 1].e) + 2);
var t1 = ms(function () { call("apply", { data: "{}", lines: a, style: null, fx: [], L: 18 }); });
check("Create 20 captions: under 8 s", t1 < 8000, (t1 / 1000).toFixed(1) + " s");
var b = caps(40), c2 = freshComp("AT speed boxes", 1080, 1920, Math.ceil(b[b.length - 1].e) + 2);
var t2 = ms(function () { call("apply", { data: "{}", lines: b, style: null, fx: ["karaoke", "accent", "adaptive"], L: 18 }); });
check("Create 40 captions with karaoke, accent and adaptive boxes: under 40 s", t2 < 40000, (t2 / 1000).toFixed(1) + " s");
var t3 = ms(function () { call("apply", { data: "{}", lines: b, style: null, fx: [], L: 18 }); });
check("Update with nothing changed: under 2 s", t3 < 2000, (t3 / 1000).toFixed(1) + " s");
var t4 = ms(function () { call("fit", startsOf(b), 18); });
check("Fit on 40 captions with boxes: under 35 s", t4 < 35000, (t4 / 1000).toFixed(1) + " s");
var t5 = ms(function () { call("saveData", "{}"); });
check("Saving the panel data: under 0.5 s", t5 < 500, t5 + " ms");
var left = 0; for (var i = 1; i <= c2.numLayers; i++) if (/^__subtext/.test(c2.layer(i).name)) left++;
check("no helper layers left in the comp", left === 0, left);
check("no expression errors", exprErrors(c2).n === 0, exprErrors(c2).first);
var ac = accentCheck(c2, startsOf(b));
check("accent boxes on the spoken word after Fit", ac.n > 0 && !ac.bad.length, ac.bad.length ? ac.bad[0] : ac.n + " checked");

// Copy style and presets (Daria 2026-11-21: "it copies, but very slowly"): ~2 s per caption went into
// resetting the letters' styling; a clean styled copy of the seed does the same in ~0.1 s.
function td(L) { return L.property("ADBE Text Properties").property("ADBE Text Document"); }
c1.openInViewer();
var caps1 = captions(c1), size1 = td(caps1[0]).value.fontSize;
var src = c1.layers.addText("CLIENT TITLE"), sd = td(src).value; sd.font = "Georgia-Bold"; sd.fontSize = 140; sd.fillColor = [1, 0.8, 0.2]; td(src).setValue(sd);
for (var i = 1; i <= c1.numLayers; i++) c1.layer(i).selected = false;
src.selected = true;
var t6 = ms(function () { call("takeStyle", startsOf(a)); });
src.selected = false;
caps1 = captions(c1);
var looks = 0, sizes = 0; for (i = 0; i < caps1.length; i++) { var dv = td(caps1[i]).value; if (dv.font === "Georgia-Bold" && Math.abs(dv.fillColor[0] - 1) < 0.01 && Math.abs(dv.fillColor[1] - 0.8) < 0.01) looks++; if (dv.fontSize === size1) sizes++; }
check("Copy style onto 20 captions: under 6 s", t6 < 6000, (t6 / 1000).toFixed(1) + " s");
check("Copy style: every caption got the font and colour, kept its size", looks === caps1.length && sizes === caps1.length, looks + " / " + sizes + " of " + caps1.length);
var t7 = ms(function () { call("setStyle", { font: "HelveticaNeue-Bold", fillColor: [1, 1, 1], applyStroke: false }, startsOf(a), 18); });
check("Preset on 20 captions: under 8 s", t7 < 8000, (t7 / 1000).toFixed(1) + " s");
caps1 = captions(c1); looks = 0; for (i = 0; i < caps1.length; i++) if (td(caps1[i]).value.font === "HelveticaNeue-Bold") looks++;
check("Preset: every caption got the look", looks === caps1.length, looks + " of " + caps1.length);
left = 0; for (i = 1; i <= c1.numLayers; i++) if (/^__subtext/.test(c1.layer(i).name)) left++;
check("no helper layers left after Copy style and presets", left === 0, left);
report();
