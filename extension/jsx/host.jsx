// Subtext — After Effects side (ExtendScript, ES3).
// The panel calls ST.* through CSInterface.evalScript; every call returns a JSON string.

var ST = (function () {
    var CTRL = "Subtext Controller";
    var TAG = "subtext:";
    var BOX_TAG = "subtext-box:";
    var BOXES = { accent: "Accent box", adaptive: "Adaptive box", textbox: "Textbox" };

    // ---------- JSON (ExtendScript has no JSON object) ----------
    function q(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
    }
    function enc(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") return q(v);
        var i, out = [];
        if (v instanceof Array) {
            for (i = 0; i < v.length; i++) out.push(enc(v[i]));
            return "[" + out.join(",") + "]";
        }
        for (i in v) if (v.hasOwnProperty(i)) out.push(q(i) + ":" + enc(v[i]));
        return "{" + out.join(",") + "}";
    }
    function ok(o) { o = o || {}; o.ok = true; return enc(o); }
    function fail(msg) { return enc({ ok: false, error: String(msg) }); }

    function guard(name, fn) {
        return function () {
            var args = arguments;
            app.beginUndoGroup("Subtext: " + name);
            var c0 = comp(), was = {};
            DEPTH++;
            try {
                if (c0) { var s0 = c0.selectedLayers; for (var i = 0; i < s0.length; i++) was[s0[i].id] = true; claimCopies(c0); }
                return fn.apply(null, args);
            }
            catch (e) { return fail(e.toString() + (e.line ? " (line " + e.line + ")" : "") + " · " + String($.stack).replace(/\s+/g, " ").substr(0, 300)); }
            finally {
                // a call that arrives while another tool is still running (the panel polling) must not take
                // the helper layers away from it: they go when the outermost tool ends
                DEPTH--;
                if (DEPTH <= 0) { DEPTH = 0; dropRuler(); }
                // AE selects every layer a script adds; only what the user had selected stays selected
                try { if (c0) { var s1 = c0.selectedLayers; for (var j = 0; j < s1.length; j++) if (!was[s1[j].id]) s1[j].selected = false; } } catch (e2) {}
                app.endUndoGroup();
            }
        };
    }

    // ---------- lookup ----------
    function comp() {
        var c = app.project.activeItem;
        return (c && c instanceof CompItem) ? c : null;
    }
    function ctrlRef() { return 'thisComp.layer("' + CTRL + '")'; }
    function findCtrl(c) {
        for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).name === CTRL) return c.layer(i);
        return null;
    }
    function idOf(layer) {
        var cm = layer.comment || "";
        return cm.indexOf(TAG) === 0 ? cm.substr(TAG.length) : null;
    }
    function boxInfo(layer) {
        var cm = layer.comment || "";
        if (cm.indexOf(BOX_TAG) !== 0) return null;
        var p = cm.substr(BOX_TAG.length).split(":");
        return { kind: p[0], id: p.slice(1).join(":") };
    }
    // When the user duplicates a caption (⌘D) the copy carries the same tag. The oldest layer (lowest AE
    // layer id; a copy always gets a newer one) stays the caption, every copy is the user's own layer.
    function older(a, b) {
        if (typeof a.id === "number" && typeof b.id === "number") return a.id < b.id;
        return a.index > b.index; // ⌘D puts the copy above the original
    }
    function captionLayers(c) {
        var map = {}, list = [], copies = [];
        for (var i = 1; i <= c.numLayers; i++) {
            var L = c.layer(i), id = idOf(L);
            if (id === null || !(L instanceof TextLayer)) continue;
            if (map[id]) { if (older(L, map[id])) { copies.push(map[id]); map[id] = L; } else copies.push(L); }
            else map[id] = L;
        }
        for (var k in map) if (map.hasOwnProperty(k)) list.push(map[k]);
        list.sort(function (a, b) { return a.inPoint - b.inPoint || a.index - b.index; });
        return { map: map, list: list, copies: copies };
    }
    function boxesOf(c, id) {
        var out = {};
        for (var i = 1; i <= c.numLayers; i++) {
            var b = boxInfo(c.layer(i));
            if (b && b.id === id && (!out[b.kind] || older(c.layer(i), out[b.kind]))) out[b.kind] = c.layer(i);
        }
        return out;
    }
    // Marks copies of captions and boxes as the user's own layers (run by every tool that changes layers).
    function claimCopies(c) {
        var caps = captionLayers(c), i;
        for (i = 0; i < caps.copies.length; i++) caps.copies[i].comment = "subtext-copy:" + idOf(caps.copies[i]);
        var best = {}, all = [];
        for (i = 1; i <= c.numLayers; i++) {
            var L = c.layer(i), b = boxInfo(L);
            if (!b) continue;
            var key = b.kind + ":" + b.id;
            all.push([L, key]);
            if (!best[key] || older(L, best[key])) best[key] = L;
        }
        for (i = 0; i < all.length; i++) if (best[all[i][1]] !== all[i][0]) all[i][0].comment = "subtext-copy-box:" + all[i][1];
    }
    // Caption layers the tools act on: the selected ones, or every caption when nothing is selected.
    // The caption a selected layer stands for, or null. A ⌘D copy still carries the tag until the next tool
    // runs, but it is the user's own layer from the start: only the original caption (or its box) counts.
    function captionIdOf(c, L, caps) {
        var id = idOf(L);
        if (id !== null) return caps.map[id] && caps.map[id].id === L.id ? id : null;
        var b = boxInfo(L);
        if (!b) return null;
        var own = boxesOf(c, b.id)[b.kind];
        return own && own.id === L.id ? b.id : null;
    }
    function targets(c) {
        var sel = c.selectedLayers, seen = {}, out = [], i, id, caps = captionLayers(c);
        for (i = 0; i < sel.length; i++) {
            id = captionIdOf(c, sel[i], caps);
            if (id !== null && !seen[id]) { seen[id] = true; }
        }
        for (i = 0; i < caps.list.length; i++) if (seen[idOf(caps.list[i])]) out.push(caps.list[i]);
        return { list: out.length ? out : caps.list, selected: out.length > 0 };
    }

    // Ads hide the app buttons, so only the top and bottom bands count; captions stay centred.
    function safeArea(c) {
        var r = c.width / c.height, w = c.width, h = c.height;
        // y = baseline of a caption's bottom row (captions grow upwards from it)
        if (r < 0.7) return { x0: 0.05 * w, x1: 0.95 * w, top: 0.15 * h, bottom: 0.82 * h, y: 0.75 * h };
        if (r > 1.4) return { x0: 0.10 * w, x1: 0.90 * w, top: 0.10 * h, bottom: 0.90 * h, y: 0.85 * h };
        return { x0: 0.08 * w, x1: 0.92 * w, top: 0.10 * h, bottom: 0.90 * h, y: 0.85 * h };
    }

    // ---------- controller ----------
    function addFx(layer, matchName, name, value) {
        var e = layer.property("ADBE Effect Parade").addProperty(matchName);
        e.name = name;
        if (value !== undefined) e.property(1).setValue(value);
        return e;
    }
    // Effects the caption expressions read from the controller (padding and roundness are % of the font size).
    function ctrlSpec(c) {
        var sa = safeArea(c);
        return [["ADBE Color Control", "Accent Color", [1, 0.824, 0.247]],
            ["ADBE Color Control", "Box Color", [0.04, 0.04, 0.05]],
            ["ADBE Color Control", "Accent Box Color", [0.298, 0.553, 1]],
            ["ADBE Slider Control", "Box Opacity", 90],
            ["ADBE Slider Control", "Box Padding", 40],
            ["ADBE Slider Control", "Box Roundness", 30],
            ["ADBE Slider Control", "Karaoke Scale", 106],
            ["ADBE Checkbox Control", "Karaoke Fill Past Words", 0],
            ["ADBE Point Control", "Caption Position", [(sa.x0 + sa.x1) / 2, sa.y]]];
    }
    function ctrlMissing(c, L) {
        var spec = ctrlSpec(c), out = [], fx = L.property("ADBE Effect Parade");
        for (var i = 0; i < spec.length; i++) if (!fx.property(spec[i][1])) out.push(spec[i]);
        return out;
    }
    // Finds the controller, creating it, or adding back any effect someone deleted.
    function controller(c, create) {
        var L = findCtrl(c);
        if (!L && !create) return null;
        if (!L) {
            L = c.layers.addNull(c.duration);
            L.name = CTRL;
            L.guideLayer = true;
            L.label = 2;
            L.property("ADBE Transform Group").property("ADBE Opacity").setValue(0);
        }
        if (create) {
            var miss = ctrlMissing(c, L), fx = L.property("ADBE Effect Parade"), spec = ctrlSpec(c), names = {}, i, k;
            for (i = 0; i < spec.length; i++) names[spec[i][1]] = true;
            for (i = 0; i < miss.length; i++) {
                // an effect that lost its name (reset, duplicated…) gets the name back instead of a new copy
                var found = null;
                for (k = 1; k <= fx.numProperties && !found; k++)
                    if (fx.property(k).matchName === miss[i][0] && !names[fx.property(k).name]) found = fx.property(k);
                if (found) found.name = miss[i][1];
                else addFx(L, miss[i][0], miss[i][1], miss[i][2]);
            }
        }
        return L;
    }
    function fxVal(L, name) { var e = L.property("ADBE Effect Parade").property(name); return e ? e.property(1).value : null; }
    function setFx(L, name, v) { var e = L.property("ADBE Effect Parade").property(name); if (e) e.property(1).setValue(v); }

    // ---------- text style ----------
    var STYLE_KEYS = ["font", "fontSize", "fillColor", "applyFill", "applyStroke", "strokeColor", "strokeWidth", "strokeOverFill", "tracking", "allCaps", "fauxBold", "fauxItalic"];
    function readStyle(layer) {
        var d = layer.property("ADBE Text Properties").property("ADBE Text Document").value, s = {};
        for (var i = 0; i < STYLE_KEYS.length; i++) { try { s[STYLE_KEYS[i]] = d[STYLE_KEYS[i]]; } catch (e) {} }
        try { s.autoLeading = d.autoLeading; if (!d.autoLeading) s.leading = d.leading; } catch (e2) {}
        return s;
    }
    function defaultStyle(c) {
        return { font: "Arial-BoldMT", fontSize: Math.round(c.width * 0.075), fillColor: [1, 1, 1], applyFill: true, applyStroke: false, tracking: 0, allCaps: false, autoLeading: true };
    }
    function writeDoc(layer, text, style) {
        var tp = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var d = tp.value;
        if (style) {
            // a clean document in that look (no leftover per-letter styling), with this layer's own text and size;
            // presets change the look, not the size
            var own = d;
            d = lookDoc(layer.containingComp, style);
            d.text = own.text;
            d.fontSize = style.hasOwnProperty("fontSize") ? style.fontSize : own.fontSize;
        }
        if (text !== null) d.text = text;
        d.justification = ParagraphJustification.CENTER_JUSTIFY;
        tp.setValue(d);
    }
    function textOf(layer) { return String(layer.property("ADBE Text Properties").property("ADBE Text Document").value.text); }

    // ---------- caption layer ----------
    // The anchor sits on the baseline of the bottom row, centred: the bottom edge never moves,
    // and a caption with more rows grows upwards. (Baseline, not the box bottom, so letters
    // like g and y do not make captions jump.)
    var ANCHOR = "var r = sourceRectAtTime(time, false), st = text.sourceText.style;\n" +
        "var n = String(text.sourceText).split(/\\r|\\n|\\u0003/).length;\n" +
        "var lh = st.autoLeading ? st.fontSize * 1.2 : st.leading;\n" +
        "[r.left + r.width / 2, (n - 1) * lh]";
    var OLD_ANCHOR = "var r = sourceRectAtTime(time, false);\n[r.left + r.width / 2, r.top + r.height / 2]";
    // Position follows the controller plus the layer's own value (0,0 by default): dragging one caption
    // moves only that one, moving the controller moves all of them.
    function POS() { return ctrlRef() + '.effect("Caption Position")(1) + value'; }
    function OLD_POS() { return ctrlRef() + '.effect("Caption Position")(1)'; }
    var BOX_GROUP = "Box 3"; // boxes drawn in the caption's own coordinates ("Box", "Box 2" = older builds, redrawn on Update)
    function isOldAnchor(L) {
        var an = L.property("ADBE Transform Group").property("ADBE Anchor Point");
        return an.expressionEnabled && an.expression === OLD_ANCHOR;
    }
    // Comps built by older versions: bottom anchor and controller + own offset, without moving anything that
    // does not have to move. Returns the captions that changed (their accent/adaptive boxes need a redraw).
    function migrateLayout(c, list) {
        var out = [], ds = [], i;
        for (i = 0; i < list.length; i++) {
            var L = list[i], tr = L.property("ADBE Transform Group"), an = tr.property("ADBE Anchor Point"), pos = tr.property("ADBE Position");
            var oldA = an.expressionEnabled && an.expression === OLD_ANCHOR, oldP = pos.expressionEnabled && pos.expression === OLD_POS();
            if (!oldA && !oldP) continue;
            if (oldA) {
                var t = L.inPoint + 0.01, a0 = an.valueAtTime(t, false);
                an.expression = ANCHOR;
                var dy = (an.valueAtTime(t, false)[1] - a0[1]) * tr.property("ADBE Scale").value[1] / 100;
                if (pos.expressionEnabled && pos.expression.indexOf("Caption Position") >= 0) ds.push(dy);
                else if (!pos.numKeys) { var v = pos.value; v[1] += dy; pos.setValue(v); }
            }
            if (oldP && !pos.numKeys) { pos.expression = POS(); pos.setValue([0, 0]); }
            out.push(L);
        }
        if (ds.length) {
            // the most common caption height keeps its exact place; others now share its bottom line
            var cp = controller(c, true).property("ADBE Effect Parade").property("Caption Position").property(1), v2 = cp.value;
            ds.sort(function (x, y) { return x - y; });
            v2[1] += ds[Math.floor(ds.length / 2)];
            cp.setValue(v2);
        }
        return out;
    }
    // Boxes drawn by an older build (measured from an old anchor, or placed by an expression) need a redraw.
    function staleBoxes(c, L) {
        var b = boxesOf(c, idOf(L)), k;
        for (k in b) if (b.hasOwnProperty(k) && !b[k].property("ADBE Root Vectors Group").property(BOX_GROUP)) return true;
        return false;
    }
    // Moves one caption back inside the safe area (through its own offset) when it sticks out.
    function pullInside(c, L) {
        var sa = safeArea(c), tr = L.property("ADBE Transform Group"), pos = tr.property("ADBE Position");
        if (pos.numKeys) return false;
        var t = L.inPoint + 0.01, r = L.sourceRectAtTime(t, false), a = tr.property("ADBE Anchor Point").valueAtTime(t, false);
        var p = pos.valueAtTime(t, false), sc = tr.property("ADBE Scale").value, pad = L.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize * 0.3 * Math.abs(sc[1] / 100);
        var x0 = p[0] + (r.left - a[0]) * sc[0] / 100, x1 = x0 + r.width * sc[0] / 100, y0 = p[1] + (r.top - a[1]) * sc[1] / 100, y1 = y0 + r.height * sc[1] / 100;
        var dx = 0, dy = 0;
        if (x1 - x0 <= sa.x1 - sa.x0) { if (x0 < sa.x0) dx = sa.x0 - x0; else if (x1 > sa.x1) dx = sa.x1 - x1; }
        if (y0 < sa.top + pad) dy = sa.top + pad - y0; else if (y1 > sa.bottom - pad) dy = sa.bottom - pad - y1;
        if (!dx && !dy) return false;
        var v = pos.valueAtTime(0, true); v[0] += dx; v[1] += dy; pos.setValue(v);
        return true;
    }
    function inList(a, L) { for (var i = 0; i < a.length; i++) if (a[i] === L) return true; return false; }
    function hasOffset(L) {
        // the layer's own value (before the expression adds the controller)
        var pos = L.property("ADBE Transform Group").property("ADBE Position"), v = pos.valueAtTime(0, true);
        return pos.numKeys > 0 || Math.abs(v[0]) > 0.5 || Math.abs(v[1]) > 0.5;
    }
    function followsCtrl(L) {
        var pos = L.property("ADBE Transform Group").property("ADBE Position");
        return pos.expressionEnabled && pos.expression.indexOf("Caption Position") >= 0;
    }

    function setTimes(L, s, e) {
        if (s >= L.outPoint) { L.outPoint = e; L.inPoint = s; } else { L.inPoint = s; L.outPoint = e; }
    }
    function makeCaption(c, line, style) {
        var L = newText(c, line.text, style);
        L.comment = TAG + line.id;
        L.label = 11;
        var tr = L.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").expression = ANCHOR;
        tr.property("ADBE Position").expression = POS();
        tr.property("ADBE Position").setValue([0, 0]);
        return L;
    }

    // Karaoke: one text animator per layer, an Expression Selector based on words.
    function karaokeOn(L) {
        return !!L.property("ADBE Text Properties").property("ADBE Text Animators").property("Subtext Karaoke");
    }
    function removeKaraoke(L) {
        var a = L.property("ADBE Text Properties").property("ADBE Text Animators").property("Subtext Karaoke");
        if (a) a.remove();
    }
    function addKaraoke(L, starts) {
        removeKaraoke(L);
        var anims = L.property("ADBE Text Properties").property("ADBE Text Animators");
        anims.addProperty("ADBE Text Animator").name = "Subtext Karaoke";
        var path = function () { return L.property("ADBE Text Properties").property("ADBE Text Animators").property("Subtext Karaoke"); };
        path().property("ADBE Text Animator Properties").addProperty("ADBE Text Fill Color");
        path().property("ADBE Text Animator Properties").addProperty("ADBE Text Scale 3D");
        path().property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
        var a = path();
        a.property("ADBE Text Animator Properties").property("ADBE Text Fill Color").expression = ctrlRef() + '.effect("Accent Color")(1)';
        a.property("ADBE Text Animator Properties").property("ADBE Text Scale 3D").expression = "var s = " + ctrlRef() + '.effect("Karaoke Scale")(1);\n[s, s, s]';
        var sel = a.property("ADBE Text Selectors").property(1);
        sel.property("ADBE Text Range Type2").setValue(3); // based on words
        sel.property("ADBE Text Expressible Amount").expression = karaokeExpr(starts);
    }
    function karaokeExpr(starts) {
        return "var T = [" + starts.join(",") + "];\n" +
            "var past = " + ctrlRef() + '.effect("Karaoke Fill Past Words")(1) == 1;\n' +
            "var i = textIndex - 1;\n" +
            "var on = i < T.length && time >= T[i] && (past || i == T.length - 1 || time < T[i + 1]);\n" +
            "on ? 100 : 0";
    }

    // Measures where each word sits inside the (centered) caption so the accent box can follow it.
    // Adding a text layer is the slow call in AE (~0.3 s); duplicating one takes ~2 ms. Each operation makes one
    // clean seed text layer, new captions and the measuring layer are copies of it; both go at the end.
    // Applying a look (font lookup) is the other slow call (~1.5 s), so the seed takes the look once and every
    // caption with that look is a copy that only gets its own text.
    var SEED = null, LOOKS = {}, RULER = null, WIDTHS = {}, DEPTH = 0;
    function alive(L, c) { try { return L && L.containingComp === c; } catch (e) { return false; } }
    function seed(c) {
        // never drops the measuring layer: a measurement in progress may be using it
        if (alive(SEED, c)) return SEED;
        var L = c.layers.addText("x");
        L.name = "__subtext seed"; L.enabled = false;
        return (SEED = L);
    }
    // one hidden layer per look: a copy of the clean seed with the style set on it
    function lookLayer(c, style) {
        var key = style ? style.toSource() : "";
        if (alive(LOOKS[key], c)) return LOOKS[key];
        var L = seed(c).duplicate(), tp = L.property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value;
        L.name = "__subtext look"; L.enabled = false;
        if (style) for (var k in style) if (style.hasOwnProperty(k)) {
            if (k === "leading" && style.autoLeading) continue;
            try { d[k] = style[k]; } catch (e) {}
        }
        d.justification = ParagraphJustification.CENTER_JUSTIFY;
        tp.setValue(d);
        return (LOOKS[key] = L);
    }
    function lookDoc(c, style) { return lookLayer(c, style).property("ADBE Text Properties").property("ADBE Text Document").value; }
    function newText(c, text, style) {
        var L = lookLayer(c, style).duplicate();
        L.enabled = true;
        var tp = L.property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value;
        d.text = text; tp.setValue(d);
        return L;
    }
    function ruler(c) {
        if (alive(RULER, c)) return RULER;
        var L = seed(c).duplicate();
        L.name = "__subtext measure"; L.enabled = false;
        return (RULER = L);
    }
    function dropRuler() {
        try { if (RULER) RULER.remove(); } catch (e) {}
        for (var k in LOOKS) if (LOOKS.hasOwnProperty(k)) try { LOOKS[k].remove(); } catch (e3) {}
        try { if (SEED) SEED.remove(); } catch (e2) {}
        RULER = null; SEED = null; LOOKS = {}; WIDTHS = {};
    }
    // width(str) in caption L's look. Widths are kept per look for the whole operation, so a word that comes
    // back in another caption is not measured again.
    function widthIn(c, L) {
        var d = L.property("ADBE Text Properties").property("ADBE Text Document").value, t0 = L.inPoint, sig = [], k;
        var keys = ["font", "fontSize", "tracking", "allCaps", "smallCaps", "fauxBold", "fauxItalic", "horizontalScale", "applyStroke", "strokeWidth"];
        for (k = 0; k < keys.length; k++) { try { sig.push(String(d[keys[k]])); } catch (e) { sig.push("-"); } }
        sig = sig.join("|");
        var memo = WIDTHS[sig] || (WIDTHS[sig] = {});
        d.justification = ParagraphJustification.LEFT_JUSTIFY;
        return function (str) {
            if (!str) return 0;
            if (memo.hasOwnProperty(str)) return memo[str];
            var tmp = ruler(c), tp = tmp.property("ADBE Text Properties").property("ADBE Text Document");
            d.text = str; tp.setValue(d);
            return (memo[str] = tmp.sourceRectAtTime(t0, false).width);
        };
    }
    // The word's right edge is where the row prefix ending with it ends (exact, kerning and spaces included);
    // its width comes from the word on its own, which is cached for the whole operation.
    function measureWords(c, L, lineTexts) {
        var width = widthIn(c, L), whole = L.sourceRectAtTime(L.inPoint, false);
        var lineH = whole.height / lineTexts.length, geo = [];
        for (var j = 0; j < lineTexts.length; j++) {
            var raw = String(lineTexts[j]).split(" "), words = [], k;
            for (k = 0; k < raw.length; k++) if (raw[k]) words.push(raw[k]);
            var lw = width(words.join(" "));
            for (k = 0; k < words.length; k++) {
                var ww = width(words[k]), right = k === words.length - 1 ? lw : width(words.slice(0, k + 1).join(" "));
                var x = -lw / 2 + right - ww / 2;
                geo.push([Math.round((x + whole.left + whole.width / 2) * 10) / 10, Math.round((whole.top + (j + 0.5) * lineH) * 10) / 10, Math.round(ww), Math.round(lineH)]);
            }
        }
        return geo;
    }

    // Width of every line of a caption (for the adaptive contour box).
    function measureLines(c, L, lineTexts) {
        var width = widthIn(c, L), widths = [];
        for (var j = 0; j < lineTexts.length; j++) {
            var raw = String(lineTexts[j]).split(" "), words = [];
            for (var k = 0; k < raw.length; k++) if (raw[k]) words.push(raw[k]);
            widths.push(Math.round(width(words.join(" ")) || 0));
        }
        return widths;
    }

    // Box layers sit right under their caption, parented to it, so they follow any move or scale.
    //  accent   – a box behind the word being spoken
    //  adaptive – one shape that hugs each line (wide line over a narrow one = a "T" with soft inner corners)
    //  textbox  – one rectangle around the whole caption
    function addBox(c, L, kind, starts) {
        var id = idOf(L), old = boxesOf(c, id)[kind];
        if (old) old.remove();
        if (kind !== "accent") {
            var other = boxesOf(c, id)[kind === "adaptive" ? "textbox" : "adaptive"];
            if (other) other.remove();
        }
        var S = c.layers.addShape();
        S.name = L.name + " · " + BOXES[kind];
        S.comment = BOX_TAG + kind + ":" + id;
        S.label = 14;
        S.moveAfter(L);
        S.parent = L;
        setTimes(S, L.inPoint, L.outPoint);
        // the box sits at the origin of its caption's own coordinates and draws itself in them: no expression
        // on its position, so it never depends on the caption's anchor expression (and follows any move/scale)
        S.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        S.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
        S.property("ADBE Transform Group").property("ADBE Scale").setValue([100, 100]);
        var root = function () { return S.property("ADBE Root Vectors Group").property(BOX_GROUP).property("ADBE Vectors Group"); };
        S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").name = BOX_GROUP;
        root().addProperty(kind === "adaptive" ? "ADBE Vector Shape - Group" : "ADBE Vector Shape - Rect");
        if (kind === "adaptive") root().addProperty("ADBE Vector Filter - RC");
        root().addProperty("ADBE Vector Graphic - Fill");
        var C = ctrlRef();
        var size = "parent.text.sourceText.style.fontSize";
        var pad = "var p = " + C + '.effect("Box Padding")(1) / 100 * ' + size + ";\n";
        var round = C + '.effect("Box Roundness")(1) / 100 * ' + size;
        var opacity = C + '.effect("Box Opacity")(1)';
        var fill = root().property("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").expression = C + (kind === "accent" ? '.effect("Accent Box Color")(1)' : '.effect("Box Color")(1)');
        fill.property("ADBE Vector Fill Opacity").expression = kind === "accent" ? "var T0 = " + starts[0] + ";\ntime < T0 ? 0 : " + opacity : opacity;

        if (kind === "adaptive") {
            var lines = textOf(L).split("\r"), W = measureLines(c, L, lines);
            root().property("ADBE Vector Filter - RC").property("ADBE Vector RoundCorner Radius").expression = round;
            root().property("ADBE Vector Shape - Group").property("ADBE Vector Shape").expression =
                "var W = [" + W.join(",") + "], n = W.length;\n" +
                "var b = parent.sourceRectAtTime(time, false), H = b.height, lh = H / n;\n" +
                pad + "var r = " + round + ", pv = p * 0.55;\n" +
                "var w = [];\nfor (var i = 0; i < n; i++) w.push(W[i] + 2 * p);\n" +
                "// lines of almost the same width share one edge (no tiny steps)\n" +
                "for (var k = 0; k < 2; k++) for (var i = 1; i < n; i++) if (Math.abs(w[i] - w[i - 1]) < 2.2 * r) { var m = Math.max(w[i], w[i - 1]); w[i] = m; w[i - 1] = m; }\n" +
                "var top = -H / 2 - pv, bot = H / 2 + pv, pts = [[-w[0] / 2, top], [w[0] / 2, top]];\n" +
                "for (var i = 0; i < n; i++) { var y = i == n - 1 ? bot : -H / 2 + (i + 1) * lh; pts.push([w[i] / 2, y]); if (i < n - 1) pts.push([w[i + 1] / 2, y]); }\n" +
                "pts.push([-w[n - 1] / 2, bot]);\n" +
                "for (var i = n - 1; i > 0; i--) { var y = -H / 2 + i * lh; pts.push([-w[i] / 2, y]); pts.push([-w[i - 1] / 2, y]); }\n" +
                "var c0 = [b.left + b.width / 2, b.top + b.height / 2];\n" +
                "for (var i = 0; i < pts.length; i++) pts[i] = pts[i] + c0;\n" +
                "createPath(pts, [], [], true)";
        } else {
            var rect = root().property("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Roundness").expression = round;
            if (kind === "accent") {
                var geo = measureWords(c, L, textOf(L).split("\r"));
                var X = [], Y = [], Wd = [], Hd = [];
                for (var g = 0; g < geo.length; g++) { X.push(geo[g][0]); Y.push(geo[g][1]); Wd.push(geo[g][2]); Hd.push(geo[g][3]); }
                var find = "var T = [" + starts.join(",") + "];\nvar i = 0;\nfor (var k = 0; k < T.length; k++) if (time >= T[k]) i = k;\n";
                rect.property("ADBE Vector Rect Position").expression = find + "var X = [" + X.join(",") + "], Y = [" + Y.join(",") + "];\n[X[i], Y[i]]";
                rect.property("ADBE Vector Rect Size").expression = find + "var W = [" + Wd.join(",") + "], H = [" + Hd.join(",") + "];\n" + pad + "[W[i] + p, H[i] + p * 0.3]";
            } else {
                var rr = "var b = parent.sourceRectAtTime(time, false);\n" + pad;
                rect.property("ADBE Vector Rect Size").expression = rr + "[b.width + p * 2, b.height + p * 1.1]";
                rect.property("ADBE Vector Rect Position").expression = rr + "[b.left + b.width / 2, b.top + b.height / 2]";
            }
        }
        return S;
    }

    function fxList(c, L) { var st = fxState(c, L), out = []; for (var k in st) if (st[k]) out.push(k); return out; }
    function nearestCaption(list, t) {
        var best = null, bd = 1e9;
        for (var i = 0; i < list.length; i++) { var d = Math.abs(list[i].inPoint - t); if (d < bd) { bd = d; best = list[i]; } }
        return best;
    }

    function fxState(c, L) {
        var b = boxesOf(c, idOf(L));
        return { karaoke: karaokeOn(L), accent: !!b.accent, adaptive: !!b.adaptive, textbox: !!b.textbox };
    }

    // How many captions are wider than the safe area.
    // Largest distance of the captions' text above and below their anchor (times layer scale).
    function reach(list) {
        var out = { above: 0, below: 0 };
        for (var i = 0; i < list.length; i++) {
            try {
                var L = list[i], t = L.inPoint + 0.01, r = L.sourceRectAtTime(t, false);
                var ay = L.property("ADBE Transform Group").property("ADBE Anchor Point").valueAtTime(t, false)[1];
                var sc = Math.abs(L.property("ADBE Transform Group").property("ADBE Scale").value[1] / 100);
                out.above = Math.max(out.above, (ay - r.top) * sc);
                out.below = Math.max(out.below, (r.top + r.height - ay) * sc);
            } catch (e) {}
        }
        return out;
    }
    // Captions whose top goes above the safe zone (too many rows for the font size).
    function tallCount(c, list) {
        var sa = safeArea(c), n = 0;
        for (var i = 0; i < list.length; i++) {
            try {
                var L = list[i], t = L.inPoint + 0.01, r = L.sourceRectAtTime(t, false), tr = L.property("ADBE Transform Group");
                var ay = tr.property("ADBE Anchor Point").valueAtTime(t, false)[1], py = tr.property("ADBE Position").valueAtTime(t, false)[1];
                var sc = Math.abs(tr.property("ADBE Scale").value[1] / 100);
                if (py - (ay - r.top) * sc < sa.top - 2) n++;
            } catch (e) {}
        }
        return n;
    }
    function wideCount(c, list) {
        var sa = safeArea(c), limit = (sa.x1 - sa.x0) + 2, n = 0;
        for (var i = 0; i < list.length; i++) {
            var L = list[i];
            try {
                var r = L.sourceRectAtTime(L.inPoint + 0.01, false);
                var sc = L.property("ADBE Transform Group").property("ADBE Scale").value[0] / 100;
                if (r.width * Math.abs(sc) > limit) n++;
            } catch (e) {}
        }
        return n;
    }

    // Fits captions into the safe area.
    // Size: a row of Lchars characters fills 96% of the safe width (measured on the real text, so any font works),
    // capped so the widest and the tallest caption still fit. uniform = every caption gets that size (a preset on
    // all); otherwise every caption is scaled by the same factor, so a caption made bigger by hand stays bigger.
    // Place: the controller centres the captions that follow it and keeps them inside the top/bottom band;
    // a caption moved on its own keeps its offset unless it sticks out, then only that one is pulled in.
    function fitToSafe(c, list, Lchars, uniform) {
        if (!list.length) return 0;
        migrateLayout(c, list);
        var sa = safeArea(c), target = (sa.x1 - sa.x0) * 0.96, band = (sa.bottom - sa.top) * 0.9, i, r;
        var scaleOf = function (L) { var v = L.property("ADBE Transform Group").property("ADBE Scale").value; return [v[0] / 100, v[1] / 100]; };
        var fsOf = function (L) { return L.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize; };
        var sumW = 0, sumC = 0, perW = 0, perH = 0, maxW = 0, maxH = 0, count = {}, ref = 0, refN = 0;
        for (i = 0; i < list.length; i++) {
            try {
                var L = list[i], fs = fsOf(L);
                var sc = scaleOf(L), rows = textOf(L).split("\r"), maxRow = 0;
                for (var j = 0; j < rows.length; j++) maxRow = Math.max(maxRow, rows[j].length);
                r = L.sourceRectAtTime(L.inPoint + 0.01, false);
                var w = r.width * Math.abs(sc[0]) / fs, h = r.height * Math.abs(sc[1]) / fs;
                // average glyph width over captions with real rows (single letters like "I" would skew it)
                if (maxRow >= 4) { sumW += w; sumC += maxRow; }
                perW = Math.max(perW, w); perH = Math.max(perH, h);
                maxW = Math.max(maxW, w * fs); maxH = Math.max(maxH, h * fs);
                count[fs] = (count[fs] || 0) + 1;
                if (count[fs] > refN) { refN = count[fs]; ref = fs; }
            } catch (e) {}
        }
        if (!perW) return 0;
        var perChar = sumC ? sumW / sumC : 0;
        var size = Lchars && perChar ? target / (perChar * Lchars) : target / perW;
        if (uniform) {
            size = Math.max(12, Math.min(400, Math.round(Math.min(size, target / perW, band / perH))));
            for (i = 0; i < list.length; i++) {
                var tp = list[i].property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value;
                if (d.fontSize !== size) { d.fontSize = size; tp.setValue(d); }
            }
        } else {
            var k = Math.min(size / ref, target / maxW, band / maxH);
            for (i = 0; i < list.length; i++) {
                var tp2 = list[i].property("ADBE Text Properties").property("ADBE Text Document"), d2 = tp2.value;
                var ns = Math.max(12, Math.min(400, Math.round(d2.fontSize * k)));
                if (d2.fontSize !== ns) { d2.fontSize = ns; tp2.setValue(d2); }
            }
            size = Math.max(12, Math.round(ref * k));
        }
        for (i = 0; i < list.length; i++) {
            var an = list[i].property("ADBE Transform Group").property("ADBE Anchor Point");
            if (!an.expressionEnabled) an.expression = ANCHOR;
        }
        // the controller: centred, and the captions that follow it without an own offset stay inside the band
        var shared = [], own = [], manual = [];
        for (i = 0; i < list.length; i++) {
            if (!followsCtrl(list[i])) manual.push(list[i]);
            else if (hasOffset(list[i])) own.push(list[i]);
            else shared.push(list[i]);
        }
        var ext = reach(shared.length ? shared : list), pad = size * 0.3;
        var clampY = function (y) { return Math.max(sa.top + ext.above + pad, Math.min(sa.bottom - ext.below - pad, y)); };
        var cx = (sa.x0 + sa.x1) / 2;
        var cp = controller(c, true).property("ADBE Effect Parade").property("Caption Position").property(1);
        cp.setValue([cx, clampY(cp.value[1])]);
        // captions with their own offset or their own position: only pulled back when they stick out
        for (i = 0; i < own.length; i++) pullInside(c, own[i]);
        for (i = 0; i < manual.length; i++) {
            var pos = manual[i].property("ADBE Transform Group").property("ADBE Position");
            if (!pos.numKeys) { var v = pos.value; pos.setValue([cx, v[1]]); }
            pullInside(c, manual[i]);
        }
        return size;
    }
    // Accent boxes and adaptive contours store measured sizes, so they are redrawn after text changes.
    function rebuildAccents(c, list, starts) {
        for (var i = 0; i < list.length; i++) {
            var id = idOf(list[i]), b = boxesOf(c, id);
            if (b.accent && starts[id]) addBox(c, list[i], "accent", starts[id]);
            if (b.adaptive && starts[id]) addBox(c, list[i], "adaptive", starts[id]);
        }
    }

    // ---------- public API ----------
    var api = {};

    api.info = function () {
        try {
            var c = comp();
            if (!c) return ok({ comp: null });
            var ctrl = findCtrl(c), sel = c.selectedLayers, caps = 0, textSel = null, all = sel.length ? captionLayers(c) : null;
            for (var i = 0; i < sel.length; i++) {
                if (captionIdOf(c, sel[i], all) !== null) caps++;
                // any other text layer, a ⌘D copy of a caption included, can be the source for Copy style
                else if (sel[i] instanceof TextLayer && !textSel) textSel = sel[i].name;
            }
            return ok({ comp: { id: c.id, name: c.name, w: c.width, h: c.height, fps: c.frameRate, dur: c.duration, time: c.time,
                wa: [c.workAreaStart, c.workAreaDuration], hasCtrl: !!ctrl, ctrlBroken: !!ctrl && ctrlMissing(c, ctrl).length > 0,
                stamp: ctrl ? (ctrl.comment || "").length : 0 },
                selCaptions: caps, selText: textSel, project: app.project.file ? app.project.file.fsName : "" });
        } catch (e) { return fail(e); }
    };

    api.time = function () { var c = comp(); return c ? String(c.time) : "-1"; };

    // Everything the panel needs to restore its state for the active comp.
    api.read = function () {
        try {
            var c = comp(); if (!c) return fail("No active composition");
            var ctrl = findCtrl(c), caps = captionLayers(c), layers = {};
            for (var i = 0; i < caps.list.length; i++) {
                var L = caps.list[i];
                layers[idOf(L)] = { text: textOf(L), inP: L.inPoint, outP: L.outPoint, fx: fxState(c, L) };
            }
            var ctl = null;
            if (ctrl) ctl = { accent: fxVal(ctrl, "Accent Color"), box: fxVal(ctrl, "Box Color"), accentBox: fxVal(ctrl, "Accent Box Color"), opacity: fxVal(ctrl, "Box Opacity") };
            return ok({ data: ctrl ? (ctrl.comment || "") : "", layers: layers, ctrl: ctl });
        } catch (e) { return fail(e); }
    };

    api.saveData = guard("save", function (json) {
        var c = comp(); if (!c) return fail("No active composition");
        controller(c, true).comment = json;
        return ok();
    });

    // Creates or updates caption layers so they match the panel's lines.
    // p = { data: "<json for the controller>", lines: [{ id, text, s, e, words: [starts] }], style, fx: [names] }
    api.apply = guard("update captions", function (p) {
        var c = comp(); if (!c) return fail("No active composition");
        var ctrl = controller(c, true);
        ctrl.comment = p.data;
        var caps = captionLayers(c), keep = {}, created = 0, updated = 0, unchanged = 0, i, k;
        var style = p.style || null;
        if (!style && caps.list.length) style = readStyle(caps.list[0]);
        if (!style) style = defaultStyle(c);
        var made = [];
        for (i = 0; i < p.lines.length; i++) {
            var ln = p.lines[i], L = caps.map[ln.id], isNew = !L, fx;
            keep[ln.id] = true;
            var same = false;
            if (isNew) {
                // a new caption looks like its nearest neighbour in time (or the comp default)
                var near = nearestCaption(caps.list, ln.s);
                L = makeCaption(c, ln, near ? readStyle(near) : style);
                fx = near ? fxList(c, near) : (p.fx || []);
                created++;
            } else {
                fx = fxList(c, L);
                same = textOf(L) === ln.text && Math.abs(L.inPoint - ln.s) < 0.001 && Math.abs(L.outPoint - ln.e) < 0.001;
                if (!same && textOf(L) !== ln.text) writeDoc(L, ln.text, null);
                if (same) unchanged++; else updated++;
            }
            var nm = "SUB " + ("000" + (i + 1)).slice(-3) + " · " + ln.text.replace(/\r/g, " ").substr(0, 24);
            if (L.name !== nm) L.name = nm;
            if (!same) setTimes(L, ln.s, ln.e);
            made.push({ L: L, ln: ln, fx: fx, same: same });
        }
        // remove captions (and their boxes) that are no longer in the panel
        var removed = 0;
        for (var id in caps.map) if (caps.map.hasOwnProperty(id) && !keep[id]) {
            var bx = boxesOf(c, id);
            for (k in bx) if (bx.hasOwnProperty(k)) bx[k].remove();
            caps.map[id].remove(); removed++;
        }
        var mig = migrateLayout(c, captionLayers(c).list), migrated = mig.length;
        var fitted = 0;
        // the very first build fits the comp's safe area; later updates keep whatever size was chosen
        if (created && !updated && !unchanged && !(p.style && p.style.fontSize)) fitted = fitToSafe(c, captionLayers(c).list, p.L, true);
        // order: first caption on top, boxes right under their text, controller above all
        if (created || removed) for (i = made.length - 1; i >= 0; i--) made[i].L.moveToBeginning();
        for (i = 0; i < made.length; i++) {
            var m = made[i];
            if (m.same) {
                if (created || removed) { var bk = boxesOf(c, m.ln.id); for (k in bk) if (bk.hasOwnProperty(k)) bk[k].moveAfter(m.L); }
                // boxes drawn for an older layout are redrawn so they sit on the right word again
                if (staleBoxes(c, m.L) || inList(mig, m.L)) { var bs = boxesOf(c, m.ln.id); for (k in bs) if (bs.hasOwnProperty(k)) addBox(c, m.L, k, m.ln.words); }
                continue;
            }
            var hasK = false;
            for (k = 0; k < m.fx.length; k++) if (m.fx[k] === "karaoke") hasK = true;
            if (hasK) addKaraoke(m.L, m.ln.words); else removeKaraoke(m.L);
            var bx2 = boxesOf(c, m.ln.id);
            for (k in bx2) if (bx2.hasOwnProperty(k)) bx2[k].remove();
            for (k = 0; k < m.fx.length; k++) if (BOXES[m.fx[k]]) addBox(c, m.L, m.fx[k], m.ln.words);
        }
        ctrl.moveToBeginning();
        // AE leaves the last created layer selected; clear it so the style tools act on all captions
        var sl = c.selectedLayers;
        for (i = 0; i < sl.length; i++) sl[i].selected = false;
        var all = captionLayers(c).list;
        return ok({ created: created, updated: updated, unchanged: unchanged, removed: removed, fitted: fitted, migrated: migrated, wide: wideCount(c, all), tall: tallCount(c, all) });
    });

    // Copies font, size, colour and stroke from the selected (non-caption) text layer onto every caption.
    api.takeStyle = guard("take style", function (starts) {
        var c = comp(); if (!c) return fail("No active composition");
        var sel = c.selectedLayers, src = null;
        for (var i = 0; i < sel.length; i++) if (sel[i] instanceof TextLayer && idOf(sel[i]) === null) { src = sel[i]; break; }
        if (!src) return fail("Select the text layer to copy the style from");
        // the look of the source layer; captions keep their size (a title's size rarely suits captions — Fit decides)
        var style = readStyle(src), t = targets(c);
        delete style.fontSize;
        for (i = 0; i < t.list.length; i++) writeDoc(t.list[i], null, style);
        for (i = 0; i < t.list.length; i++) pullInside(c, t.list[i]);
        rebuildAccents(c, t.list, starts);
        return ok({ style: style, from: src.name, count: t.list.length, selected: t.selected, wide: wideCount(c, t.list) });
    });

    // Applies a preset text style to every caption (keeps the words).
    api.setStyle = guard("style", function (style, starts, Lchars) {
        var c = comp(); if (!c) return fail("No active composition");
        var t = targets(c), caps = captionLayers(c), i, size = 0;
        for (i = 0; i < t.list.length; i++) writeDoc(t.list[i], null, style);
        if (!t.selected) size = fitToSafe(c, caps.list, Lchars, true); // all: one look, one size
        else {
            // selected only: they take the size most other captions have, and stay inside the safe area
            var cnt = {}, best = 0, ref = 0;
            for (i = 0; i < caps.list.length; i++) {
                if (inList(t.list, caps.list[i])) continue;
                var f = caps.list[i].property("ADBE Text Properties").property("ADBE Text Document").value.fontSize;
                cnt[f] = (cnt[f] || 0) + 1; if (cnt[f] > best) { best = cnt[f]; ref = f; }
            }
            for (i = 0; i < t.list.length; i++) {
                var tp = t.list[i].property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value;
                if (ref && d.fontSize !== ref) { d.fontSize = ref; tp.setValue(d); }
                pullInside(c, t.list[i]);
            }
            size = ref;
        }
        rebuildAccents(c, t.list, starts);
        return ok({ count: t.list.length, selected: t.selected, size: size, wide: wideCount(c, t.list) });
    });

    api.fit = guard("fit to safe area", function (starts, Lchars) {
        var c = comp(); if (!c) return fail("No active composition");
        var caps = captionLayers(c), size = fitToSafe(c, caps.list, Lchars, false);
        rebuildAccents(c, caps.list, starts);
        return ok({ count: caps.list.length, size: size });
    });

    // Restores the controller's effects so the caption expressions work again.
    api.repair = guard("repair controller", function () {
        var c = comp(); if (!c) return fail("No active composition");
        var L = findCtrl(c); if (!L) return ok({ fixed: 0 });
        var n = ctrlMissing(c, L).length;
        controller(c, true);
        return ok({ fixed: n });
    });

    api.seek = function (t) { var c = comp(); if (c) c.time = t; return ok(); };

    // Turns one effect on or off for the selected captions (or all of them).
    // starts = { id: [word start times] } so karaoke and accent boxes know the timing.
    api.setFx = guard("effect", function (kind, on, starts) {
        var c = comp(); if (!c) return fail("No active composition");
        controller(c, true);
        var t = targets(c), n = 0;
        for (var i = 0; i < t.list.length; i++) {
            var L = t.list[i], id = idOf(L), st = starts[id];
            if (!st) continue;
            if (kind === "karaoke") { if (on) addKaraoke(L, st); else removeKaraoke(L); }
            else if (on) addBox(c, L, kind, st);
            else { var b = boxesOf(c, id)[kind]; if (b) b.remove(); }
            n++;
        }
        return ok({ count: n, selected: t.selected });
    });

    api.fxSummary = function () {
        try {
            var c = comp(); if (!c) return ok({ total: 0 });
            var t = targets(c), s = { karaoke: 0, accent: 0, adaptive: 0, textbox: 0 };
            for (var i = 0; i < t.list.length; i++) { var f = fxState(c, t.list[i]); for (var k in s) if (f[k]) s[k]++; }
            return ok({ total: t.list.length, selected: t.selected, on: s });
        } catch (e) { return fail(e); }
    };

    api.setCtrl = guard("controller", function (v) {
        var c = comp(); if (!c) return fail("No active composition");
        var L = controller(c, true);
        if (v.accent) setFx(L, "Accent Color", v.accent);
        if (v.box) setFx(L, "Box Color", v.box);
        if (v.accentBox) setFx(L, "Accent Box Color", v.accentBox);
        if (v.opacity !== undefined) setFx(L, "Box Opacity", v.opacity);
        return ok();
    });

    // Breaks each one-line target caption into two lines (the old "split" button).
    api.splitLines = guard("split line", function (starts) {
        var c = comp(); if (!c) return fail("No active composition");
        var t = targets(c), out = {}, already = 0;
        for (var i = 0; i < t.list.length; i++) {
            var L = t.list[i], txt = textOf(L), nt;
            if (txt.indexOf("\r") >= 0) { already++; continue; }
            {
                var w = txt.split(" "), best = -1, bc = 1e9;
                for (var k = 1; k < w.length; k++) {
                    var a = w.slice(0, k).join(" ").length, b = w.slice(k).join(" ").length, cost = Math.abs(a - b);
                    if (/[,;:.!?]$/.test(w[k - 1])) cost -= 6;
                    if (cost < bc) { bc = cost; best = k; }
                }
                if (best < 0) continue;
                nt = w.slice(0, best).join(" ") + "\r" + w.slice(best).join(" ");
            }
            writeDoc(L, nt, null);
            out[idOf(L)] = nt;
            rebuildAccents(c, [L], starts);
        }
        return ok({ texts: out, already: already });
    });

    // Closes the gaps between consecutive captions so nothing flickers.
    api.align = guard("align", function () {
        var c = comp(); if (!c) return fail("No active composition");
        var t = targets(c), n = 0;
        for (var i = 0; i < t.list.length - 1; i++) {
            var L = t.list[i], nx = t.list[i + 1].inPoint;
            if (nx > L.inPoint) {
                L.outPoint = nx;
                var b = boxesOf(c, idOf(L));
                for (var k in b) if (b.hasOwnProperty(k)) b[k].outPoint = nx;
                n++;
            }
        }
        return ok({ count: n });
    });

    api.removeChars = guard("remove characters", function (chars, starts) {
        var c = comp(); if (!c) return fail("No active composition");
        var t = targets(c), out = {}, n = 0, touched = [];
        for (var i = 0; i < t.list.length; i++) {
            var L = t.list[i], txt = textOf(L), nt = "";
            for (var k = 0; k < txt.length; k++) if (chars.indexOf(txt.charAt(k)) < 0) nt += txt.charAt(k);
            nt = nt.replace(/ {2,}/g, " ").replace(/ ?\r ?/g, "\r");
            if (nt !== txt) { writeDoc(L, nt, null); out[idOf(L)] = nt; n++; touched.push(L); }
        }
        if (starts) rebuildAccents(c, touched, starts);
        return ok({ texts: out, count: n });
    });

    // Renders the work area's audio to a WAV/AIFF file. Other queued render items are paused and restored.
    api.renderAudio = guard("render audio", function (folder) {
        var c = comp(); if (!c) return fail("No active composition");
        var rq = app.project.renderQueue;
        if (rq.rendering) return fail("The Render Queue is busy");
        var paused = [], i;
        for (i = 1; i <= rq.numItems; i++) if (rq.item(i).status === RQItemStatus.QUEUED) { rq.item(i).render = false; paused.push(i); }
        var item = rq.items.add(c), result;
        try {
            item.timeSpanStart = c.workAreaStart;
            item.timeSpanDuration = c.workAreaDuration;
            var om = item.outputModule(1), used = null;
            var names = om.templates;
            for (i = 0; i < names.length && !used; i++) if (/^AIFF/i.test(names[i]) || /WAV/i.test(names[i])) { om.applyTemplate(names[i]); used = names[i]; }
            if (!used) {
                om.setSettings({ "Format": "WAV", "Output Audio": "On" });
                used = "WAV settings";
            }
            var base = new File(folder + "/subtext_audio_" + c.id + "_" + new Date().getTime());
            om.file = base;
            var target = om.file.fsName;
            rq.render();
            var f = new File(target);
            if (!f.exists) {
                var cand = new Folder(folder).getFiles("subtext_audio_" + c.id + "_*");
                if (cand.length) f = cand[cand.length - 1];
            }
            if (!f.exists) throw new Error("AE did not write the audio file (" + used + ")");
            result = ok({ path: f.fsName, offset: c.workAreaStart, template: used });
        } finally {
            try { item.remove(); } catch (e) {}
            for (i = 0; i < paused.length; i++) try { rq.item(paused[i]).render = true; } catch (e2) {}
        }
        return result;
    });

    api.ANCHOR = ANCHOR;
    api.version = function () { return ok({ version: "1.1.0", ae: app.version }); };
    return api;
})();
