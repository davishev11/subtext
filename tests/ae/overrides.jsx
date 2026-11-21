// Spec (Daria, 2026-11-15): one caption can be moved or scaled on its own; the controller still moves all
// of them; Update and Fit keep those personal changes (Fit only pulls a caption back if it leaves the safe zone);
// a caption with its own font/colour/size keeps it, Fit keeps its size ratio; a preset on a selection only
// restyles the selected captions.
TNAME = "Per-caption changes (AE)";
var texts = ["First caption / two rows", "Second one here", "Third caption / also two rows", "Fourth and last"];
var ls = mkLines(texts), st = startsOf(ls);
var c = freshComp("AT overrides", 1080, 1920, 20);
call("apply", { data: "{}", lines: ls, style: null, fx: ["accent", "adaptive"], L: 18 });
var caps = captions(c);
var ctrl = null; for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).name === "Subtext Controller") ctrl = c.layer(i);
var cp = ctrl.property("ADBE Effect Parade").property("Caption Position").property(1);
function pos(L) { return L.property("ADBE Transform Group").property("ADBE Position").valueAtTime(mid(L), false); }
function td(L) { return L.property("ADBE Text Properties").property("ADBE Text Document"); }

// one caption moved up by 200 px: only that one moves
var P = caps[1].property("ADBE Transform Group").property("ADBE Position");
var others0 = pos(caps[0]), mine0 = pos(caps[1]);
var pv = P.valueAtTime(0, true); P.setValue([pv[0], pv[1] - 200]); // like dragging it in the viewer
check("moving one caption moves only that one", Math.abs(pos(caps[1])[1] - (mine0[1] - 200)) < 0.5 && Math.abs(pos(caps[0])[1] - others0[1]) < 0.5, pos(caps[1])[1]);
// the controller still moves everything, the moved caption keeps its shift
var v = cp.value; cp.setValue([v[0], v[1] - 100]);
check("the controller moves all captions", Math.abs(pos(caps[0])[1] - (others0[1] - 100)) < 0.5, pos(caps[0])[1]);
check("…and the moved one keeps its own shift", Math.abs(pos(caps[1])[1] - pos(caps[0])[1] + 200) < 0.5, pos(caps[1])[1] - pos(caps[0])[1]);
// one caption scaled, one with its own font, colour and bigger size
caps[3].property("ADBE Transform Group").property("ADBE Scale").setValue([120, 120]);
var d = td(caps[2]).value, base = d.fontSize; d.font = "Georgia-Bold"; d.fillColor = [1, 0.3, 0.3]; d.fontSize = Math.round(base * 1.3); td(caps[2]).setValue(d);

// Update with an edited text of another caption keeps all of that
ls[0].text = "First caption\redited"; ls[0].words = ls[0].words.slice(0, 4);
st = startsOf(ls);
var r = call("apply", { data: "{}", lines: ls, style: null, fx: ["accent", "adaptive"], L: 18 });
caps = captions(c);
check("Update: edited caption updated, others untouched", r.updated === 1 && r.unchanged === 3, "updated " + r.updated + ", unchanged " + r.unchanged);
check("Update: the moved caption keeps its shift", Math.abs(pos(caps[1])[1] - pos(caps[0])[1] + 200) < 0.5, pos(caps[1])[1] - pos(caps[0])[1]);
check("Update: the scaled caption keeps 120%", caps[3].property("ADBE Transform Group").property("ADBE Scale").value[0] === 120);
check("Update: own font and colour kept", td(caps[2]).value.font === "Georgia-Bold" && Math.abs(td(caps[2]).value.fillColor[1] - 0.3) < 0.01, td(caps[2]).value.font);

// Fit: one shared factor, so the bigger caption stays bigger; personal shifts stay when inside the zone
var ratio0 = td(caps[2]).value.fontSize / td(caps[0]).value.fontSize;
var shift0 = pos(caps[1])[1] - pos(caps[0])[1];
call("fit", st, 18);
caps = captions(c);
var ratio1 = td(caps[2]).value.fontSize / td(caps[0]).value.fontSize;
check("Fit keeps the size ratio of the bigger caption", Math.abs(ratio1 - ratio0) < 0.03, ratio0.toFixed(2) + " → " + ratio1.toFixed(2));
check("Fit keeps the moved caption's shift (still inside)", Math.abs(pos(caps[1])[1] - pos(caps[0])[1] - shift0) < 1, shift0 + " → " + (pos(caps[1])[1] - pos(caps[0])[1]));
check("Fit keeps the 120% scale", caps[3].property("ADBE Transform Group").property("ADBE Scale").value[0] === 120);
var bad = inSafe(c, caps);
check("after Fit everything is inside the safe zone", bad.length === 0, bad.join("; "));
// a caption pushed far out is pulled back in by Fit, the others stay where they were
P = caps[1].property("ADBE Transform Group").property("ADBE Position");
pv = P.valueAtTime(0, true); P.setValue([pv[0], pv[1] - 1200]);
var y0 = pos(caps[0])[1];
call("fit", st, 18);
caps = captions(c);
bad = inSafe(c, caps);
check("Fit pulls a caption that left the safe zone back in", bad.length === 0, bad.join("; "));
check("…without moving the others", Math.abs(pos(caps[0])[1] - y0) < 1, y0 + " → " + pos(caps[0])[1]);
var ac = accentCheck(c, st);
check("boxes stay on their captions", ac.bad.length === 0 && ac.n > 0, ac.bad.slice(0, 2).join("; "));

// preset on a selection: only the selected captions change
caps[0].selected = true; caps[1].selected = true;
var f2 = td(caps[2]).value.font, f3 = td(caps[3]).value.font, s0 = td(caps[0]).value.fontSize;
r = call("setStyle", { font: "Futura-Bold", fillColor: [1, 1, 1], allCaps: true }, st, 18);
caps = captions(c);
for (i = 0; i < caps.length; i++) caps[i].selected = false;
check("preset on 2 selected captions restyles only them", td(caps[0]).value.font === "Futura-Bold" && td(caps[1]).value.font === "Futura-Bold" && td(caps[2]).value.font === f2 && td(caps[3]).value.font === f3, td(caps[2]).value.font + " / " + td(caps[3]).value.font);
// preset on all: one look, one size
r = call("setStyle", { font: "HelveticaNeue-Bold", fillColor: [1, 1, 1], allCaps: false }, st, 18);
caps = captions(c);
var sizes = {}, ns = 0; for (i = 0; i < caps.length; i++) if (!sizes[td(caps[i]).value.fontSize]) { sizes[td(caps[i]).value.fontSize] = 1; ns++; }
check("preset on all: one font and one size", ns === 1 && td(caps[2]).value.font === "HelveticaNeue-Bold", ns + " sizes");
var e = exprErrors(c);
check("no expression errors", e.n === 0, e.first);
report();
