// Spec (Daria, 2026-11-15): the accent box always sits on the word being spoken — after a fresh build,
// after an old comp is migrated, after moving the controller, after moving or scaling one caption,
// after Fit and after a preset.
TNAME = "Accent box follows the word (AE)";
var texts = ["Every morning at seven / the coffee shop opens", "Mia roasts her own / beans by the window,", "One row only", "And this caption / has three rows / of text here"];
var ls = mkLines(texts), st = startsOf(ls);
function step(label, c) {
    var r = accentCheck(c, st), e = exprErrors(c);
    check(label + ": accent box on the spoken word (" + r.n + " samples)", r.n >= 12 && r.bad.length === 0, r.bad.slice(0, 3).join("; "));
    check(label + ": no expression errors", e.n === 0, e.first);
    var pr = accentPrecision(c, st, 3);
    check(label + ": accent box centred on every word (±3 px, " + pr.n + " words)", pr.n > 20 && pr.bad.length === 0, pr.bad.length ? pr.bad.slice(0, 3).join("; ") : "worst " + pr.worst + " px");
}
var c = freshComp("AT accent 9x16", 1080, 1920, 20);
call("apply", { data: "{}", lines: ls, style: null, fx: ["karaoke", "accent"], L: 18 });
step("fresh build", c);

// the controller moved up
var cp = null; for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).name === "Subtext Controller") cp = c.layer(i).property("ADBE Effect Parade").property("Caption Position").property(1);
var v = cp.value; cp.setValue([v[0] - 40, v[1] - 300]);
step("controller moved", c);

// one caption moved on its own, another one scaled
var caps = captions(c);
var p0 = caps[1].property("ADBE Transform Group").property("ADBE Position"), pv0 = p0.valueAtTime(0, true); p0.setValue([pv0[0] + 30, pv0[1] - 200]);
caps[3].property("ADBE Transform Group").property("ADBE Scale").setValue([120, 120]);
step("one caption moved, one scaled", c);

call("fit", st, 18);
step("after Fit", c);
call("setStyle", { font: "Georgia-Bold", fillColor: [1, 1, 1] }, st, 18);
step("after a preset", c);

// a comp built by the previous version: centre anchor, position = controller only, accent measured from the centre
var c2 = freshComp("AT accent old", 1920, 1080, 20);
call("apply", { data: "{}", lines: ls, style: null, fx: ["accent"], L: 36 });
var OLD_A = "var r = sourceRectAtTime(time, false);\n[r.left + r.width / 2, r.top + r.height / 2]";
var OLD_P = 'thisComp.layer("Subtext Controller").effect("Caption Position")(1)';
var cc = captions(c2);
for (i = 0; i < cc.length; i++) {
    var tr = cc[i].property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").expression = OLD_A;
    tr.property("ADBE Position").expression = OLD_P;
    tr.property("ADBE Position").setValue([960, 540]);
}
// rebuild the boxes the way the old version measured them, and mark them as old
call("setFx", "accent", true, st);
for (i = 1; i <= c2.numLayers; i++) if ((c2.layer(i).comment || "").indexOf("subtext-box:") === 0) {
    var g = c2.layer(i).property("ADBE Root Vectors Group").property(1); g.name = "Box";
}
var r = call("apply", { data: "{}", lines: ls, style: null, fx: ["accent"], L: 36 });
check("old comp: migrated on Update", r.migrated === 4, r.migrated);
step("old comp after Update", c2);
cc = captions(c2);
var pe = 0; for (i = 0; i < cc.length; i++) { var pp = cc[i].property("ADBE Transform Group").property("ADBE Position"); if (pp.expression === OLD_P || Math.abs(pp.valueAtTime(0, true)[0]) > 0.5) pe++; }
check("old comp: position switched to controller + own offset", pe === 0, pe + " left");

// a comp migrated by the build before this fix (bottom anchor already, boxes still measured from the centre)
var c3 = freshComp("AT accent stale", 1080, 1920, 20);
call("apply", { data: "{}", lines: ls, style: null, fx: ["accent"], L: 18 });
cc = captions(c3);
for (i = 0; i < cc.length; i++) cc[i].property("ADBE Transform Group").property("ADBE Anchor Point").expression = OLD_A;
call("setFx", "accent", true, st);
for (i = 1; i <= c3.numLayers; i++) if ((c3.layer(i).comment || "").indexOf("subtext-box:") === 0) c3.layer(i).property("ADBE Root Vectors Group").property(1).name = "Box";
for (i = 0; i < cc.length; i++) cc[i].property("ADBE Transform Group").property("ADBE Anchor Point").expression = ST.ANCHOR;
r = call("apply", { data: "{}", lines: ls, style: null, fx: ["accent"], L: 18 });
step("stale boxes repaired on Update", c3);
report();
