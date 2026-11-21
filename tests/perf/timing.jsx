// Times the host calls the panel makes, on a comp with N captions (accent + adaptive on). Prints JSON.
var N = typeof N === "number" ? N : 40, out = {};
var texts = []; for (var i = 0; i < N; i++) texts.push("Caption number " + i + " / second row here");
var ls = mkLines(texts);
var c = freshComp("AT perf", 1080, 1920, Math.ceil(ls[ls.length - 1].e) + 2);
function tm(name, f) { var t = new Date().getTime(); f(); out[name] = new Date().getTime() - t; }
tm("create " + N, function () { call("apply", { data: "{}", lines: ls, style: null, fx: ["karaoke", "accent", "adaptive"], L: 18 }); });
tm("update, nothing changed", function () { call("apply", { data: "{}", lines: ls, style: null, fx: [], L: 18 }); });
ls[3].text = "Edited caption\rsecond row";
tm("update, one text edited", function () { call("apply", { data: "{}", lines: ls, style: null, fx: [], L: 18 }); });
tm("save data", function () { call("saveData", "{\"x\":1}"); });
tm("info (poll)", function () { ST.info(); });
tm("read", function () { ST.read(); });
tm("fit", function () { call("fit", startsOf(ls), 18); });
out.layers = c.numLayers;
enc(out);
