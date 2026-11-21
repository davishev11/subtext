// Spec (Daria, 2026-11-15): captions stay on one bottom line; extra rows grow upwards;
// 3–4 rows stay inside the safe zone; old comps switch to the bottom anchor without breaking.
TNAME = "Bottom anchor + Max rows (AE)";
var FMTS = [["AT rows 9x16", 1080, 1920, 18], ["AT rows 16x9", 1920, 1080, 36]];
for (var f = 0; f < FMTS.length; f++) {
    var tag = FMTS[f][0].replace("AT rows ", "") + ": ";
    var c = freshComp(FMTS[f][0], FMTS[f][1], FMTS[f][2], 20);
    var texts = ["Hello there", "This one has / two rows", "And this caption / has three rows / of text here", "Four rows now / one more row / and another one / the last row", "Yes"];
    var r = call("apply", { data: "{}", lines: mkLines(texts), style: null, fx: [], L: FMTS[f][3] });
    var caps = captions(c);
    check(tag + "5 captions created", r.created === 5 && caps.length === 5, r.created);
    var e = exprErrors(c);
    check(tag + "no expression errors", e.n === 0, e.first);
    var rc = [], sizes = {};
    for (var i = 0; i < caps.length; i++) { rc.push(compRect(caps[i], mid(caps[i]))); sizes[fontSize(caps[i])] = 1; }
    var fs = fontSize(caps[0]), nsz = 0; for (var k in sizes) nsz++;
    check(tag + "one font size for all", nsz === 1, fs);
    var byOk = true, botOk = true;
    for (i = 1; i < rc.length; i++) { if (Math.abs(rc[i].by - rc[0].by) > 0.5) byOk = false; if (Math.abs(rc[i].y1 - rc[1].y1) > fs * 0.35) botOk = false; }
    check(tag + "every caption sits on the same bottom baseline", byOk, rc[0].by);
    check(tag + "bottom edges line up (±descenders)", botOk, rc[0].y1 + " / " + rc[3].y1);
    check(tag + "more rows grow upwards (tops 4<3<2<1 rows)", rc[3].y0 < rc[2].y0 && rc[2].y0 < rc[1].y0 && rc[1].y0 < rc[0].y0,
        Math.round(rc[3].y0) + "<" + Math.round(rc[2].y0) + "<" + Math.round(rc[1].y0) + "<" + Math.round(rc[0].y0));
    var bad = inSafe(c, caps);
    check(tag + "all captions inside the safe zone", bad.length === 0, bad.join("; "));
    check(tag + "no 'too tall' warning", r.tall === 0, r.tall);

    // effects on every caption: boxes follow the new anchor without errors
    var st = {}; for (i = 0; i < caps.length; i++) { var ln = mkLines(texts)[i]; st[ln.id] = ln.words; }
    call("setFx", "karaoke", true, st); call("setFx", "adaptive", true, st); call("setFx", "accent", true, st);
    e = exprErrors(c);
    check(tag + "karaoke + adaptive + accent: no expression errors", e.n === 0, e.first);
    check(tag + "boxes created (adaptive + accent per caption)", boxLayers(c) === 10, boxLayers(c));
    call("setFx", "textbox", true, st);
    e = exprErrors(c);
    check(tag + "text box: no expression errors", e.n === 0, e.first);

    // Fit keeps everything inside with 4 rows
    call("fit", st, FMTS[f][3]);
    bad = inSafe(c, captions(c));
    check(tag + "after Fit: inside the safe zone", bad.length === 0, bad.join("; "));

    // a very tall caption (Max rows set high) is reported, and Fit brings it back inside
    var many = texts.concat(["r1 / r2 / r3 / r4 / r5 / r6 / r7 / r8 / r9 / r10 / r11 / r12"]);
    r = call("apply", { data: "{}", lines: mkLines(many), style: null, fx: [], L: FMTS[f][3] });
    check(tag + "12-row caption is reported as too tall", r.tall >= 1, r.tall);
    var st2 = {}, ml = mkLines(many); for (i = 0; i < ml.length; i++) st2[ml[i].id] = ml[i].words;
    call("fit", st2, FMTS[f][3]);
    bad = inSafe(c, captions(c));
    check(tag + "after Fit the 12-row caption fits too", bad.length === 0, bad.join("; "));
    e = exprErrors(c);
    check(tag + "no expression errors at the end", e.n === 0, e.first);
}

// Migration: a comp built by the previous version (anchor in the middle of the block)
var c2 = freshComp("AT migrate", 1080, 1920, 20);
var mt = ["Two rows here / and here", "Again two / rows of it", "One row", "Two more / rows"];
call("apply", { data: "{}", lines: mkLines(mt), style: null, fx: ["textbox"], L: 18 });
var cps = captions(c2), OLD = "var r = sourceRectAtTime(time, false);\n[r.left + r.width / 2, r.top + r.height / 2]";
for (var j = 0; j < cps.length; j++) cps[j].property("ADBE Transform Group").property("ADBE Anchor Point").expression = OLD;
var before = compRect(cps[0], mid(cps[0]));
var r2 = call("apply", { data: "{}", lines: mkLines(mt), style: null, fx: ["textbox"], L: 18 });
cps = captions(c2);
var after = compRect(cps[0], mid(cps[0])), olds = 0;
for (j = 0; j < cps.length; j++) if (cps[j].property("ADBE Transform Group").property("ADBE Anchor Point").expression === OLD) olds++;
check("migrate: old comp switched to the bottom anchor", r2.migrated === 4 && olds === 0, "migrated " + r2.migrated + ", left " + olds);
check("migrate: two-row captions stay exactly where they were", Math.abs(after.y0 - before.y0) < 1 && Math.abs(after.y1 - before.y1) < 1, Math.round(before.y0) + "→" + Math.round(after.y0));
check("migrate: nothing else was rebuilt", r2.unchanged === 4, r2.unchanged);
var e2 = exprErrors(c2);
check("migrate: no expression errors", e2.n === 0, e2.first);
report();
