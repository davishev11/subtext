// Shared helpers for the After Effects test suite. Each test file is appended to this one and run
// through research/ae_run.sh; a test calls check(...) and ends with report().
$.evalFile(new File(ROOT + "/extension/jsx/host.jsx"));
var RESULTS = [], TNAME = "";
function check(name, cond, info) { RESULTS.push({ n: name, ok: !!cond, i: info === undefined ? "" : String(info) }); }
function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var r = eval("(" + ST[fn].apply(null, args) + ")");
    if (!r.ok) throw new Error(fn + ": " + r.error);
    return r;
}
function enc(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
    if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(enc(v[i])); return "[" + a.join(",") + "]"; }
    var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(enc(k) + ":" + enc(v[k])); return "{" + o.join(",") + "}";
}
function report() { return enc({ test: TNAME, results: RESULTS }); }

// A fresh comp inside the "Subtext autotest" folder (removed and rebuilt on every run).
function freshComp(name, w, h, dur) {
    var folder = null, i;
    for (i = app.project.numItems; i >= 1; i--) {
        var it = app.project.item(i);
        if (it instanceof FolderItem && it.name === "Subtext autotest") folder = it;
    }
    if (!folder) folder = app.project.items.addFolder("Subtext autotest");
    for (i = folder.numItems; i >= 1; i--) if (folder.item(i).name === name) folder.item(i).remove();
    var c = app.project.items.addComp(name, w, h, 1, dur || 20, 30);
    c.parentFolder = folder;
    c.layers.addSolid([0.12, 0.13, 0.16], "BG", w, h, 1, dur || 20);
    c.openInViewer();
    return c;
}
// Lines for ST.apply from caption texts; rows are separated with "/" ("one row / second row").
function mkLines(texts, gap) {
    var out = [], t = 0;
    for (var i = 0; i < texts.length; i++) {
        var rows = texts[i].split(" / "), words = texts[i].replace(/ \/ /g, " ").split(" "), st = [];
        for (var k = 0; k < words.length; k++) st.push(Math.round((t + k * 0.3) * 1000) / 1000);
        var e = t + words.length * 0.3;
        out.push({ id: "t" + i, text: rows.join("\r"), s: t, e: e, words: st });
        t = e + (gap || 0.2);
    }
    return out;
}
function safe(c) {
    var w = c.width, h = c.height, r = w / h;
    if (r < 0.7) return { x0: 0.05 * w, x1: 0.95 * w, top: 0.15 * h, bottom: 0.82 * h };
    if (r > 1.4) return { x0: 0.10 * w, x1: 0.90 * w, top: 0.10 * h, bottom: 0.90 * h };
    return { x0: 0.08 * w, x1: 0.92 * w, top: 0.10 * h, bottom: 0.90 * h };
}
// Comp-space rectangle of a layer's content at time t (handles anchor, position, scale).
function compRect(L, t) {
    var tr = L.property("ADBE Transform Group"), r = L.sourceRectAtTime(t, false);
    var p = tr.property("ADBE Position").valueAtTime(t, false), a = tr.property("ADBE Anchor Point").valueAtTime(t, false), s = tr.property("ADBE Scale").valueAtTime(t, false);
    var x0 = p[0] + (r.left - a[0]) * s[0] / 100, y0 = p[1] + (r.top - a[1]) * s[1] / 100;
    return { x0: x0, y0: y0, x1: x0 + r.width * s[0] / 100, y1: y0 + r.height * s[1] / 100, by: p[1] };
}
function captions(c) {
    var out = [];
    for (var i = 1; i <= c.numLayers; i++) { var L = c.layer(i); if (L instanceof TextLayer && (L.comment || "").indexOf("subtext:") === 0) out.push(L); }
    out.sort(function (a, b) { return a.inPoint - b.inPoint; });
    return out;
}
function boxLayers(c) { var n = 0; for (var i = 1; i <= c.numLayers; i++) if ((c.layer(i).comment || "").indexOf("subtext-box:") === 0) n++; return n; }
function exprErrors(c) {
    var n = 0, first = "";
    function walk(g, L) { for (var i = 1; i <= g.numProperties; i++) { var p = g.property(i); if (p.propertyType === PropertyType.PROPERTY) { if (p.canSetExpression && p.expressionEnabled && p.expressionError) { n++; if (!first) first = L.name + " › " + p.name + ": " + p.expressionError; } } else walk(p, L); } }
    for (var i = 1; i <= c.numLayers; i++) try { walk(c.layer(i), c.layer(i)); } catch (e) {}
    return { n: n, first: first };
}
function fontSize(L) { return L.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize; }
function mid(L) { return (L.inPoint + L.outPoint) / 2; }
function inSafe(c, list) {
    var sa = safe(c), bad = [];
    for (var i = 0; i < list.length; i++) {
        var r = compRect(list[i], mid(list[i]));
        if (r.x0 < sa.x0 - 1 || r.x1 > sa.x1 + 1 || r.y0 < sa.top - 1 || r.y1 > sa.bottom + 1) bad.push(list[i].name.substr(0, 22) + " [x " + Math.round(r.x0) + "–" + Math.round(r.x1) + ", y " + Math.round(r.y0) + "–" + Math.round(r.y1) + "]");
    }
    return bad;
}

// ---------- accent box follows the spoken word ----------
// Comp-space centre of a layer's content at time t (through a temporary null with a toComp expression,
// so parenting, offsets and scale all count).
function compCentre(c, layer, t) {
    var n = c.layers.addNull(); n.name = "__probe";
    var pc = n.property("ADBE Effect Parade").addProperty("ADBE Point Control");
    pc.property(1).expression = "var s = thisComp.layer(" + layer.index + ");\nvar r = s.sourceRectAtTime(time, false);\ns.toComp([r.left + r.width / 2, r.top + r.height / 2])";
    var v = pc.property(1).valueAtTime(t, false), src = n.source;
    n.remove();
    try { if (src && !src.usedIn.length) src.remove(); } catch (e) {} // a null leaves its solid in the project
    return v;
}
function accentOf(c, L) {
    var id = L.comment.substr(8);
    for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).comment === "subtext-box:accent:" + id) return c.layer(i);
    return null;
}
// For every caption with an accent box: at its 1st, middle and last word the box centre sits on that word's
// row (±30% of a row) and inside the caption's width. starts = { id: [word start times] }.
function accentCheck(c, starts) {
    var caps = captions(c), bad = [], n = 0;
    for (var i = 0; i < caps.length; i++) {
        var L = caps[i], box = accentOf(c, L), st = starts[L.comment.substr(8)];
        if (!box || !st) continue;
        var rows = String(L.property("ADBE Text Properties").property("ADBE Text Document").value.text).split("\r");
        var rowOf = [], k, j;
        for (j = 0; j < rows.length; j++) { var ws = rows[j].split(" "); for (k = 0; k < ws.length; k++) if (ws[k]) rowOf.push(j); }
        var picks = [0, Math.floor(st.length / 2), st.length - 1];
        for (k = 0; k < picks.length; k++) {
            var w = picks[k], t = st[w] + 0.03;
            if (t >= L.outPoint) t = L.outPoint - 0.03;
            var r = compRect(L, t), rowH = (r.y1 - r.y0) / rows.length, want = r.y0 + (rowOf[w] + 0.5) * rowH;
            var p = compCentre(c, box, t);
            n++;
            if (Math.abs(p[1] - want) > rowH * 0.3 || p[0] < r.x0 - 2 || p[0] > r.x1 + 2)
                bad.push(L.name.substr(0, 20) + " word " + (w + 1) + ": box y " + Math.round(p[1]) + " want " + Math.round(want));
        }
    }
    return { n: n, bad: bad };
}
// Where a word's centre really is, in comp space, measured independently of Subtext: the word's left edge is
// the row width minus the suffix that starts with it, its right edge the prefix that ends with it.
function wordCentre(c, L, row, k, t) {
    var rows = String(L.property("ADBE Text Properties").property("ADBE Text Document").value.text).split("\r");
    var words = rows[row].split(" "), whole = L.sourceRectAtTime(t, false), lineH = whole.height / rows.length;
    var tmp = c.layers.addText("x"), tp = tmp.property("ADBE Text Properties").property("ADBE Text Document");
    var d = L.property("ADBE Text Properties").property("ADBE Text Document").value;
    d.justification = ParagraphJustification.LEFT_JUSTIFY;
    function w(s) { d.text = s; tp.setValue(d); return tmp.sourceRectAtTime(t, false).width; }
    var rowW = w(rows[row]), right = w(words.slice(0, k + 1).join(" ")), left = rowW - w(words.slice(k).join(" "));
    tmp.remove();
    var x = whole.left + whole.width / 2 - rowW / 2 + (left + right) / 2, y = whole.top + (row + 0.5) * lineH;
    var n = c.layers.addNull(), pc = n.property("ADBE Effect Parade").addProperty("ADBE Point Control");
    pc.property(1).expression = "thisComp.layer(" + L.index + ").toComp([" + x + "," + y + "])";
    var v = pc.property(1).valueAtTime(t, false), src = n.source;
    n.remove(); try { if (src && !src.usedIn.length) src.remove(); } catch (e) {}
    return { x: v[0], y: v[1], w: right - left };
}
// Accent box centred on its word horizontally (Daria 2026-11-21: "the box drifts off the word").
function accentPrecision(c, starts, tol) {
    var caps = captions(c), bad = [], n = 0, worst = 0;
    for (var i = 0; i < caps.length; i++) {
        var L = caps[i], box = accentOf(c, L), st = starts[L.comment.substr(8)];
        if (!box || !st) continue;
        var rows = String(L.property("ADBE Text Properties").property("ADBE Text Document").value.text).split("\r"), idx = 0;
        for (var r = 0; r < rows.length; r++) {
            var ws = rows[r].split(" ");
            for (var k = 0; k < ws.length; k++, idx++) {
                var t = st[idx] + 0.03; if (t >= L.outPoint) t = L.outPoint - 0.03;
                var want = wordCentre(c, L, r, k, t), got = compCentre(c, box, t), dx = Math.abs(got[0] - want.x);
                n++; worst = Math.max(worst, dx);
                if (dx > tol) bad.push(L.name.substr(0, 18) + " '" + ws[k] + "': off by " + Math.round(dx) + " px");
            }
        }
    }
    return { n: n, bad: bad, worst: Math.round(worst * 10) / 10 };
}
function startsOf(lines) { var o = {}; for (var i = 0; i < lines.length; i++) o[lines[i].id] = lines[i].words; return o; }

// ---------- foreign layers stay untouched ----------
function fingerprint(L, t) {
    var parts = [L.name, L.comment, L.enabled, L.locked, L.shy, L.threeDLayer, L.parent ? L.parent.name : "", Math.round(L.inPoint * 1000), Math.round(L.outPoint * 1000)];
    var was = L.locked; L.locked = false;
    var tr = L.property("ADBE Transform Group");
    for (var i = 1; i <= tr.numProperties; i++) {
        var p = tr.property(i);
        try { parts.push(p.matchName + "=" + String(p.valueAtTime(t, true)) + (p.expressionEnabled ? "|" + p.expression : "")); } catch (e) {}
    }
    if (L instanceof TextLayer) {
        var d = L.property("ADBE Text Properties").property("ADBE Text Document").value;
        parts.push(d.text, d.font, d.fontSize, String(d.fillColor), d.applyStroke ? String(d.strokeColor) + d.strokeWidth : "");
        parts.push("anim=" + L.property("ADBE Text Properties").property("ADBE Text Animators").numProperties);
    }
    parts.push("fx=" + L.property("ADBE Effect Parade").numProperties);
    L.locked = was;
    return parts.join("¦");
}
function foreignPrints(c) {
    var o = {}, order = [];
    for (var i = 1; i <= c.numLayers; i++) {
        var L = c.layer(i), cm = L.comment || "";
        if (cm.indexOf("subtext") === 0 || L.name === "Subtext Controller" || L.name === "__probe") continue;
        o[L.name] = fingerprint(L, 1);
        order.push(L.name);
        if (L.source instanceof CompItem) for (var j = 1; j <= L.source.numLayers; j++) o[L.name + "/" + L.source.layer(j).name] = fingerprint(L.source.layer(j), 1);
    }
    o.__order = order.join(",");
    return o;
}
function samePrints(a, b) {
    var diff = [];
    for (var k in a) if (a.hasOwnProperty(k) && a[k] !== b[k]) diff.push(k + (k === "__order" ? ": " + a[k] + " → " + b[k] : ""));
    for (k in b) if (b.hasOwnProperty(k) && !a.hasOwnProperty(k)) diff.push("new " + k);
    return diff;
}

// ---------- cleanup ----------
function cleanup() {
    for (var i = app.project.numItems; i >= 1; i--) {
        var it = app.project.item(i);
        if (it instanceof FolderItem && it.name === "Subtext autotest") it.remove();
    }
    // nulls made by the tests leave solids behind ("Null 12"…); unused ones go too (test project only)
    for (i = app.project.numItems; i >= 1; i--) {
        var s = app.project.item(i);
        if (s instanceof FootageItem && s.mainSource instanceof SolidSource && /^Null \d+$/.test(s.name) && !s.usedIn.length) s.remove();
    }
    return "cleaned";
}

// A "finished project" look: client title, lower-third precomp, logo shape, locked note, a text on a rig.
function buildFinished(c) {
    function txt(name, s, font, size) {
        var L = c.layers.addText(s), tp = L.property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value;
        d.font = font; d.fontSize = size; d.fillColor = [1, 0.8, 0.2]; tp.setValue(d); L.name = name; return L;
    }
    txt("Client title", "SALE -50%", "Futura-Bold", 110).property("ADBE Transform Group").property("ADBE Position").setValue([c.width / 2, c.height * 0.12]);
    var lt = app.project.items.addComp(c.name + " lower third", c.width, c.height, 1, c.duration, c.frameRate);
    lt.parentFolder = c.parentFolder; lt.layers.addText("Anna, designer");
    c.layers.add(lt).name = "Lower third";
    c.layers.addShape().name = "Logo shape";
    var lock = txt("Locked note", "do not move", "Arial-BoldMT", 40); lock.locked = true;
    var rig = c.layers.addNull(); rig.name = "Rig";
    txt("Parented text", "on a rig", "Arial-BoldMT", 50).parent = rig;
}
