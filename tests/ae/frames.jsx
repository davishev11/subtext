// Not a pass/fail test: saves frames of 1–4 row captions with every effect into the report folder,
// so a person can look at them. OUTDIR is set by scripts/test.sh.
TNAME = "Frames for the report";
var texts = ["Hello there", "This one has / two rows", "And this caption / has three rows / of text here", "Four rows now / one more row / and another one / the last row"];
var ls = mkLines(texts), shots = [];
var sets = [["karaoke", "adaptive", "accent"], ["textbox"]];
for (var s = 0; s < sets.length; s++) {
    var c = freshComp("AT frames " + s, 1080, 1920, 20);
    call("apply", { data: "{}", lines: ls, style: null, fx: sets[s], L: 18 });
    for (var i = 0; i < ls.length; i++) {
        var f = new File(OUTDIR + "/frame_" + sets[s].join("+") + "_" + (i + 1) + "rows.png");
        c.saveFrameToPng(ls[i].words[Math.min(1, ls[i].words.length - 1)] + 0.05, f);
        shots.push(f.name);
    }
    var e = exprErrors(c);
    check(sets[s].join(" + ") + ": frames saved, no expression errors", e.n === 0, e.first);
}
check("frames: " + shots.length + " pictures", shots.length === 8, shots.join(", "));
report();
