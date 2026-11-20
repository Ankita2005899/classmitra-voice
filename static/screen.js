const $ = (id) => document.getElementById(id);
// colour frames: [bg1, bg2, title, text, accent, frame]
const PALS = [
  ["Navy & Gold", ["#1b2a49", "#0d1730", "#ffffff", "#dbe3f0", "#c8a24a", "#2a3d66"]],
  ["Slate & Teal", ["#2b3a4a", "#16212c", "#ffffff", "#d5dee8", "#1aa6a6", "#3a4d61"]],
  ["Corporate Blue", ["#1e40af", "#172554", "#ffffff", "#dbe7ff", "#93c5fd", "#2f55c4"]],
  ["Emerald", ["#14532d", "#0a2a18", "#ffffff", "#d8f0e1", "#f2c14e", "#1f7a50"]],
  ["Burgundy", ["#6b1f2e", "#3a0e19", "#ffffff", "#f3dde1", "#e8b86a", "#8f2f45"]],
  ["Clean White", ["#ffffff", "#eef2f7", "#14213d", "#334155", "#d97706", "#cbd5e1"]],
  ["Cream & Brown", ["#faf5ea", "#f1e7d3", "#2b2118", "#4a3b2c", "#b45309", "#d9c7a6"]],
  ["Charcoal & Amber", ["#2f3136", "#121316", "#ffffff", "#d1d5db", "#f0a43c", "#3b3e45"]],
];
const LABELS = ["Background 1", "Background 2", "Title", "Text", "Accent", "Frame"];
const ROLE = { title: 2, head: 4, body: 3, free: 3 };
let pal = PALS[0][1].slice(), deck = [], selS = null, selE = null, uid = 0, nodes = {}, fileFor = null;

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const allEls = () => deck.flatMap((s) => s.els);
const curEl = () => allEls().find((e) => e.id === selE);
const ro = new ResizeObserver((es) => es.forEach((e) => e.target.style.setProperty("--u", e.target.clientWidth / 100 + "px")));

/* ---------- colours ---------- */
function mark(i) { [...$("frames").children].forEach((b, j) => b.classList.toggle("active", j === i)); }
function syncPal() { pal.forEach((c, i) => ($("cp" + i).value = c)); }
LABELS.forEach((l, i) => {
  const w = el("label", "cl", l), inp = el("input");
  inp.type = "color"; inp.id = "cp" + i;
  inp.oninput = () => { pal[i] = inp.value; mark(-1); draw(); };
  w.append(inp); $("custom").append(w);
});
PALS.forEach(([name, c], i) => {
  const b = el("button", "frame"), sw = el("div", "sw");
  b.type = "button";
  c.forEach((col) => { const s = el("span"); s.style.background = col; sw.append(s); });
  b.append(sw, el("small", "", name));
  b.onclick = () => { pal = c.slice(); deck.forEach((s) => delete s.bg); syncPal(); mark(i); draw(); };
  $("frames").append(b);
});
syncPal(); mark(0);

$("text").value = sessionStorage.getItem("cm_text") || "";
$("lang").value = sessionStorage.getItem("cm_lang") || "english";

/* ---------- build deck from AI result ---------- */
function fitSize(txt, w, h, hindi, max = 3.2, min = 1.6, bold = false) {
  const cw = (hindi ? 0.58 : 0.5) + (bold ? 0.06 : 0);
  for (let s = max; s >= min; s -= 0.1) {
    const cpl = Math.max(4, w / (s * cw));
    let lines = 0;
    txt.split("\n").forEach((l) => (lines += Math.max(1, Math.ceil(l.length / cpl))));
    if (lines * s * 1.5 <= h * 0.92) return +s.toFixed(1);
  }
  return min;
}
const T = (role, x, y, w, h, text, size) => ({ id: ++uid, type: "text", role, x, y, w, h, text, size, bold: role === "title" || role === "head", align: "left" });
const P = (q, x, y, w, h, fit) => ({ id: ++uid, type: "img", x, y, w, h, q, src: null, fit: fit || "cover", state: q ? "load" : "empty" });

function build(d) {
  const withImg = $("imgstyle").value !== "none", hindi = $("lang").value === "hindi", I = d.images || {};
  const w = withImg ? 54 : 88, H = 56.25;
  deck = [];
  const title = d.title || "Your topic", line = d.important_line || "";
  const cover = [
    T("title", 6, 18, withImg ? 56 : 88, 34, title, fitSize(title, withImg ? 56 : 88, 0.34 * H, hindi, 6.4, 3.4, true)),
    T("body", 6, 56, withImg ? 56 : 88, 26, line, fitSize(line, withImg ? 56 : 88, 0.26 * H, hindi)),
  ];
  if (withImg) cover.push(P(I.cover || d.title, 64, 12, 30, 76));
  deck.push({ els: cover });
  const content = (head, txt, q) => {
    const els = [T("head", 6, 8, w, 12, head, 4.6), T("body", 6, 26, w, 64, txt, fitSize(txt, w, 0.64 * H, hindi))];
    if (withImg) els.push(P(q, 62, 16, 32, 68));
    deck.push({ els });
  };
  [["Key points", "key_points"], ["Advantages", "advantages"], ["Disadvantages", "disadvantages"], ["Applications", "applications"]]
    .forEach(([h, k]) => d[k].length && content(h, d[k].join("\n"), I[k]));
  if (d.example) content("Example", d.example, I.example);
  selS = deck[0]; selE = null;
}

/* ---------- drawing ---------- */
function fillImg(e, n) {
  n.style.borderColor = pal[5]; n.style.color = pal[3];
  if (e.src) { n.style.backgroundImage = `url("${e.src}")`; n.style.backgroundSize = e.fit; n.classList.remove("ph"); }
  else { n.style.backgroundImage = "none"; n.classList.add("ph"); n.dataset.t = e.state === "load" ? "Finding image…" : "Click to add image"; }
}

function mkNode(e, r, s) {
  const n = el("div", "el " + e.type);
  const place = () => (n.style.cssText += `;left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%`);
  nodes[e.id] = n;
  if (e.type === "text") {
    n.style.fontSize = `calc(var(--u)*${e.size})`;
    n.style.color = e.custom ? e.color : pal[ROLE[e.role]];
    n.style.fontWeight = e.bold ? 800 : 500; n.style.textAlign = e.align;
    n.textContent = e.text;
    n.ondblclick = () => { n.contentEditable = "true"; n.focus(); };
    n.onblur = () => (n.contentEditable = "false");
    n.oninput = () => (e.text = n.innerText.replace(/\n$/, ""));
  } else {
    fillImg(e, n);
    n.onclick = () => { if (!n._moved && !e.src && e.state !== "load") pick(e); };
  }
  const rz = el("div", "rz"); n.append(rz);
  n.addEventListener("pointerdown", (ev) => {
    if (n.isContentEditable) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    selE = e.id; selS = s; paint();
    const rect = r.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, o = { x: e.x, y: e.y, w: e.w, h: e.h }, rs = ev.target === rz;
    n._moved = false; ev.preventDefault();
    try { n.setPointerCapture(ev.pointerId); } catch (_) {}
    const mv = (m) => {
      const dx = ((m.clientX - sx) / rect.width) * 100, dy = ((m.clientY - sy) / rect.height) * 100;
      if (Math.abs(dx) + Math.abs(dy) > 0.4) n._moved = true;
      if (rs) { e.w = Math.max(5, Math.min(100 - e.x, o.w + dx)); e.h = Math.max(4, Math.min(100 - e.y, o.h + dy)); }
      else { e.x = Math.max(0, Math.min(100 - e.w, o.x + dx)); e.y = Math.max(0, Math.min(100 - e.h, o.y + dy)); }
      place();
    };
    const up = () => { n.removeEventListener("pointermove", mv); n.removeEventListener("pointerup", up); };
    n.addEventListener("pointermove", mv); n.addEventListener("pointerup", up);
  });
  place();
  return n;
}

function draw() {
  const box = $("slides"); box.innerHTML = ""; nodes = {};
  if (!deck.includes(selS)) selS = deck[0];
  deck.forEach((s, i) => {
    const r = el("div", "slide"), bar = el("div", "bar"), foot = el("div", "foot", `ClassMitra  ${i + 1}/${deck.length}`);
    r.style.background = s.bg || `linear-gradient(135deg,${pal[0]},${pal[1]})`;
    bar.style.background = pal[4]; foot.style.color = pal[3];
    r.append(bar);
    s.els.forEach((e) => r.append(mkNode(e, r, s)));
    r.append(foot);
    r.addEventListener("pointerdown", (ev) => { selS = s; if (ev.target === r || ev.target === bar || ev.target === foot) selE = null; paint(); });
    box.append(r); ro.observe(r);
  });
  paint();
}

function paint() {
  document.querySelectorAll(".slide").forEach((r, i) => r.classList.toggle("cur", deck[i] === selS));
  Object.entries(nodes).forEach(([id, n]) => n.classList.toggle("sel", +id === selE));
  const e = curEl();
  $("bar").dataset.k = e ? e.type : "none";
  if (e && e.type === "text") $("tc").value = e.custom ? e.color : pal[ROLE[e.role]];
  $("bgc").value = (selS && selS.bg) || pal[0];
}

/* ---------- editing tools ---------- */
function pick(e) { fileFor = e || null; $("file").click(); }
$("file").onchange = () => {
  const f = $("file").files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    if (fileFor) { fileFor.src = rd.result; fileFor.state = "ok"; }
    else if (selS) { const e = P("", 34, 24, 30, 50, "contain"); e.src = rd.result; e.state = "ok"; selS.els.push(e); selE = e.id; }
    draw();
  };
  rd.readAsDataURL(f); $("file").value = "";
};
$("addI").onclick = () => pick(null);
$("rep").onclick = () => { const e = curEl(); if (e) pick(e); };
$("fit").onclick = () => { const e = curEl(); if (e) { e.fit = e.fit === "cover" ? "contain" : "cover"; draw(); } };
$("addT").onclick = () => { if (!selS) return; const e = T("free", 30, 40, 40, 12, "Double-click to edit", 3); selS.els.push(e); selE = e.id; draw(); };
$("addS").onclick = () => {
  const i = deck.indexOf(selS) + 1;
  deck.splice(i, 0, { els: [T("head", 6, 8, 88, 12, "New slide", 4.6), T("body", 6, 26, 88, 64, "Double-click to edit this text", 2.8)] });
  selS = deck[i]; selE = null; draw();
};
$("delS").onclick = () => {
  if (deck.length < 2) return;
  const i = deck.indexOf(selS); deck.splice(i, 1); selS = deck[Math.min(i, deck.length - 1)]; selE = null; draw();
};
const delSel = () => { if (!selS) return; selS.els = selS.els.filter((e) => e.id !== selE); selE = null; draw(); };
$("del").onclick = delSel;
document.addEventListener("keydown", (ev) => {
  const t = ev.target;
  if (ev.key === "Delete" && selE && !t.isContentEditable && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") delSel();
});
const sz = (d) => { const e = curEl(); if (e) { e.size = Math.max(1, Math.min(12, +(e.size + d).toFixed(1))); draw(); } };
$("szU").onclick = () => sz(0.3); $("szD").onclick = () => sz(-0.3);
$("bold").onclick = () => { const e = curEl(); if (e) { e.bold = !e.bold; draw(); } };
$("aln").onclick = () => { const e = curEl(); if (e) { e.align = { left: "center", center: "right", right: "left" }[e.align]; draw(); } };
$("tc").oninput = () => { const e = curEl(); if (e) { e.color = $("tc").value; e.custom = true; draw(); } };
$("bgc").oninput = () => { if (selS) { selS.bg = $("bgc").value; draw(); } };

/* ---------- generate ---------- */
async function getImgs() {
  const st = $("imgstyle").value; if (st === "none") return;
  for (const e of allEls().filter((x) => x.type === "img" && x.q)) {
    try {
      const d = await (await fetch(`/image?style=${st}&q=${encodeURIComponent(e.q)}`)).json();
      if (d.url) { e.src = d.url; e.state = "ok"; } else e.state = "empty";
    } catch (_) { e.state = "empty"; }
    if (nodes[e.id]) fillImg(e, nodes[e.id]);
  }
}

$("go").addEventListener("click", async () => {
  const text = $("text").value.trim(), msg = $("msg");
  msg.className = "";
  if (!text) { msg.textContent = "Please enter some text."; msg.className = "err"; return; }
  $("go").disabled = true; msg.textContent = "Generating slides… this takes a few seconds.";
  try {
    const res = await fetch("/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: $("lang").value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    build(data); draw();
    $("bar").hidden = false; $("hint").hidden = false;
    msg.textContent = $("imgstyle").value === "none" ? "" : "Slides ready. Adding images one by one…";
    await getImgs();
    msg.textContent = "";
  } catch (err) { msg.textContent = err.message; msg.className = "err"; }
  finally { $("go").disabled = false; }
});

/* ---------- download ---------- */
$("dl").addEventListener("click", async () => {
  const btn = $("dl"), old = btn.textContent; btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const zip = new JSZip(), folder = zip.folder("classmitra-slides"), roots = [...document.querySelectorAll("#slides .slide")];
    for (let i = 0; i < roots.length; i++) {
      const host = el("div"); host.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:720px";
      const c = roots[i].cloneNode(true);
      c.classList.remove("cur");
      c.querySelectorAll(".rz,.ph").forEach((x) => x.remove());
      c.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      c.querySelectorAll("[contenteditable]").forEach((x) => x.removeAttribute("contenteditable"));
      c.style.cssText += ";width:1280px;height:720px;--u:12.8px;box-shadow:none;border-radius:0";
      host.append(c); document.body.append(host);
      const canvas = await html2canvas(c, { scale: 1, useCORS: true, backgroundColor: null });
      host.remove();
      folder.file(`slide-${i + 1}.png`, await new Promise((r) => canvas.toBlob(r, "image/png")));
    }
    const a = el("a"); a.href = URL.createObjectURL(await zip.generateAsync({ type: "blob" })); a.download = "classmitra-slides.zip"; a.click();
  } catch (e) { $("msg").textContent = "Download failed. Check your internet and try again."; $("msg").className = "err"; }
  finally { btn.disabled = false; btn.textContent = old; }
});
