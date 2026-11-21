var out = {}, c = freshComp("AT perf raw", 1080, 1920, 60), Ls = [];
function tm(n, f) { var t = new Date().getTime(); f(); out[n] = new Date().getTime() - t; }
tm("addText x20", function () { for (var i = 0; i < 20; i++) Ls.push(c.layers.addText("Caption " + i + "\rsecond row")); });
tm("setValue doc x20", function () { for (var i = 0; i < 20; i++) { var tp = Ls[i].property("ADBE Text Properties").property("ADBE Text Document"), d = tp.value; d.fontSize = 80; tp.setValue(d); } });
tm("anchor expr x20", function () { for (var i = 0; i < 20; i++) Ls[i].property("ADBE Transform Group").property("ADBE Anchor Point").expression = ST.ANCHOR; });
tm("sourceRect x20", function () { for (var i = 0; i < 20; i++) Ls[i].sourceRectAtTime(1, false); });
tm("comment x20", function () { for (var i = 0; i < 20; i++) Ls[i].comment = "x" + i; });
tm("read comments x400", function () { for (var k = 0; k < 20; k++) for (var i = 0; i < 20; i++) Ls[i].comment; });
tm("moveToBeginning x20", function () { for (var i = 0; i < 20; i++) Ls[i].moveToBeginning(); });
out.items = app.project.numItems;
enc(out);
