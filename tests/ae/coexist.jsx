// Spec (Daria, 2026-11-15): in a finished project Subtext never touches anything that is not its own —
// client titles, precomps, shapes, adjustment / locked / shy / 3D / parented layers, or a caption the user
// duplicated (⌘D makes it the user's own layer). Captions with their own style keep it. 25 fps, 4:5,
// a work area that does not start at 0.
TNAME = "Finished project with other layers (AE)";
function fpsComp(name, w, h, fps) { var c = freshComp(name, w, h, 20); c.frameRate = fps; c.workAreaStart = 2; c.workAreaDuration = 12; return c; }
var c = fpsComp("AT finished 4x5", 1080, 1350, 25);
function txt(name, s, font, size, color) {
    var L = c.layers.addText(s), tp = L.property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value;
    d.font = font; d.fontSize = size; d.fillColor = color; tp.setValue(d); L.name = name; return L;
}
var title = txt("Client title", "SALE -50%", "Futura-Bold", 120, [1, 0.8, 0.2]);
var d0 = title.property("ADBE Text Properties").property("ADBE Text Document").value; d0.applyStroke = true; d0.strokeColor = [0, 0, 0]; d0.strokeWidth = 6; title.property("ADBE Text Properties").property("ADBE Text Document").setValue(d0);
title.property("ADBE Transform Group").property("ADBE Position").setValue([540, 200]);
var lt = app.project.items.addComp("AT lower third", 1080, 1350, 1, 20, 25); lt.parentFolder = c.parentFolder;
lt.layers.addText("Anna, designer"); lt.layers.addShape().name = "LT bar";
var ltL = c.layers.add(lt); ltL.name = "Lower third";
var sh = c.layers.addShape(); sh.name = "Logo shape";
sh.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Rect");
var adj = c.layers.addSolid([1, 1, 1], "Grade", 1080, 1350, 1, 20); adj.adjustmentLayer = true;
var lock = txt("Locked note", "do not move", "Arial-BoldMT", 40, [1, 1, 1]); lock.locked = true;
var shy = txt("Shy text", "hidden", "Arial-BoldMT", 40, [1, 1, 1]); shy.shy = true;
var t3 = txt("3D text", "depth", "Arial-BoldMT", 60, [1, 1, 1]); t3.threeDLayer = true;
var rig = c.layers.addNull(); rig.name = "Rig";
var kid = txt("Parented text", "on a rig", "Arial-BoldMT", 50, [1, 1, 1]); kid.parent = rig;
txt("Expression text", "x", "Arial-BoldMT", 50, [1, 1, 1]).property("ADBE Text Properties").property("ADBE Text Document").expression = '"t=" + Math.round(time)';

var texts = ["Welcome to the / spring sale", "Everything is / half price", "Only this / weekend", "Do not miss it", "See you there"];
var ls = mkLines(texts), st = startsOf(ls);
for (var i = 0; i < ls.length; i++) { ls[i].s += 2; ls[i].e += 2; for (var k = 0; k < ls[i].words.length; k++) ls[i].words[k] += 2; }
st = startsOf(ls);
var P0 = foreignPrints(c);
function same(label) {
    var diff = samePrints(P0, foreignPrints(c)), e = exprErrors(c), bad = inSafe(c, captions(c));
    check(label + ": other layers untouched", diff.length === 0, diff.slice(0, 4).join("; "));
    check(label + ": no expression errors", e.n === 0, e.first);
    check(label + ": captions inside the safe zone", bad.length === 0, bad.slice(0, 3).join("; "));
}
var r = call("apply", { data: "{}", lines: ls, style: null, fx: ["karaoke"], L: 20 });
check("build: 5 captions among the other layers", r.created === 5 && captions(c).length === 5, r.created);
same("build");

// a caption with its own look
var caps = captions(c), tp2 = caps[2].property("ADBE Text Properties").property("ADBE Text Document"), dd = tp2.value;
dd.font = "Georgia-Bold"; dd.fillColor = [0.4, 0.8, 1]; tp2.setValue(dd);
// a caption duplicated by the user (⌘D)
var dup = caps[1].duplicate(); dup.name = "My copy";
// Daria 2026-11-21: the copy is her own layer but must be visible to the panel right away: selecting it shows
// it as a text layer (Copy style source), not as the original caption
for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
dup.selected = true;
var inf = eval("(" + ST.info() + ")"), fsum = eval("(" + ST.fxSummary() + ")");
check("copy selected right after ⌘D: shown as a text layer, not as a caption", inf.selCaptions === 0 && inf.selText === "My copy", inf.selCaptions + " · " + inf.selText);
check("copy selected: tools still act on all captions, not on the original", fsum.selected === false && fsum.total === 5, fsum.selected + " · " + fsum.total);
dup.selected = false;
ls[0].text = "Welcome to our\rspring sale"; st = startsOf(ls);
r = call("apply", { data: "{}", lines: ls, style: null, fx: ["karaoke"], L: 20 });
check("duplicate: the copy is not counted as a caption", captions(c).length === 5, captions(c).length);
check("duplicate: the copy is marked as the user's layer", (dup.comment || "").indexOf("subtext-copy:") === 0, dup.comment);
P0 = foreignPrints(c); // from here on the copy is one of the user's layers and must not change
check("own look kept through Update", tp2.value.font === "Georgia-Bold", tp2.value.font);
same("update");

var fx = ["karaoke", "accent", "adaptive", "textbox"];
for (i = 0; i < fx.length; i++) { call("setFx", fx[i], true, st); same(fx[i] + " on"); }
for (i = 0; i < fx.length; i++) call("setFx", fx[i], false, st);
same("all effects off");
check("own look kept through effects", captions(c)[2].property("ADBE Text Properties").property("ADBE Text Document").value.font === "Georgia-Bold");

// a foreign text layer selected: effects still go to the captions only
title.selected = true;
call("setFx", "accent", true, st);
title.selected = false;
same("effect with a client layer selected");
var boxes = 0; for (i = 1; i <= c.numLayers; i++) if ((c.layer(i).comment || "").indexOf("subtext-box:accent:") === 0) boxes++;
check("accent boxes only on the 5 captions (none on the copy)", boxes === 5, boxes);

call("fit", st, 20); same("Fit");
check("own look kept through Fit", captions(c)[2].property("ADBE Text Properties").property("ADBE Text Document").value.font === "Georgia-Bold");
call("splitLines", st); same("split");
call("align"); same("align");
call("removeChars", ",.!?", st); same("remove characters");

// copy the look of the client title: the title itself stays as it is
title.selected = true;
r = call("takeStyle", st);
title.selected = false;
same("copy style from the client title");
check("captions took the client font", captions(c)[0].property("ADBE Text Properties").property("ADBE Text Document").value.font === "Futura-Bold");

// regroup: fewer and different captions (new ids) — the old ones go, nothing else does
var ls2 = mkLines(["Welcome to our spring / sale everything is / half price", "Only this weekend do / not miss it see you there"]);
for (i = 0; i < ls2.length; i++) { ls2[i].id = "n" + i; ls2[i].s += 2; ls2[i].e += 2; for (k = 0; k < ls2[i].words.length; k++) ls2[i].words[k] += 2; }
r = call("apply", { data: "{}", lines: ls2, style: null, fx: ["karaoke"], L: 20 });
check("regroup: old captions removed, new created", r.removed === 5 && r.created === 2 && captions(c).length === 2, "removed " + r.removed + ", created " + r.created);
same("regroup");
check("regroup: the user's copy is still there", dup && dup.comment.indexOf("subtext-copy:") === 0);

// other sizes
var sizes = [["AT finished 1x1", 1080, 1080, 22], ["AT finished 9x16 24fps", 1080, 1920, 18]];
for (i = 0; i < sizes.length; i++) {
    c = fpsComp(sizes[i][0], sizes[i][1], sizes[i][2], i ? 23.976 : 30);
    title = c.layers.addText("Client"); title.name = "Client title";
    P0 = foreignPrints(c);
    call("apply", { data: "{}", lines: mkLines(texts), style: null, fx: ["adaptive", "karaoke"], L: sizes[i][3] });
    same(sizes[i][0].replace("AT finished ", ""));
}
report();
