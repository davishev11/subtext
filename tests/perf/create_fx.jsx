// Create time for N captions per effect set.
var N = 20, out = {};
var texts = []; for (var i = 0; i < N; i++) texts.push("Caption number " + i + " / second row here");
var sets = [[], ["karaoke"], ["accent"], ["adaptive"], ["textbox"]];
for (var s = 0; s < sets.length; s++) {
  var ls = mkLines(texts), c = freshComp("AT perf " + s, 1080, 1920, Math.ceil(ls[ls.length - 1].e) + 2);
  var t = new Date().getTime();
  call("apply", { data: "{}", lines: ls, style: null, fx: sets[s], L: 18 });
  out[sets[s].join() || "none"] = new Date().getTime() - t;
}
enc(out);
