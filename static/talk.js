const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d"), off = document.createElement("canvas"), octx = off.getContext("2d");
let img = null, base = { w: 0, h: 0 }, view = { x: 0, y: 0, w: 0, h: 0, sc: 1 }, marks = [], mouth = null;
let ac, an, buf, fbuf, dest, rec, chunks = [], sm = 0, gs = 0, hi = 0.5, peak = 0.05, playing = false, mode = "char";

$("text").value = sessionStorage.getItem("cm_text") || "";
$("lang").value = sessionStorage.getItem("cm_lang") || "english";
const HINT1 = "2. Click the LEFT corner of the mouth, then the RIGHT corner. ";

/* ---------- view: whole picture, or zoomed on the face ---------- */
function fullView() { view = { x: 0, y: 0, w: base.w, h: base.h, sc: 1 }; cv.width = Math.round(base.w); cv.height = Math.round(base.h); }
function faceView() {
  if (!mouth || !$("zoom").checked) return fullView();
  let vw = Math.min(base.w, mouth.w * 5.5), vh = Math.min(base.h, vw * 1.2);
  vw = Math.min(vw, vh / 1.2);
  const vx = Math.max(0, Math.min(base.w - vw, mouth.x - vw / 2)), vy = Math.max(0, Math.min(base.h - vh, mouth.y - vh * 0.6));
  view = { x: vx, y: vy, w: vw, h: vh, sc: 640 / vw };
  cv.width = 640; cv.height = Math.round(vh * view.sc);
}

/* ---------- drawing ---------- */
function mouthOpen(open) {
  const { x, y, w } = mouth, k = img.width / base.w, st = +$("strength").value;
  const mh = w * 0.34 * open * st * (1 - 0.25 * hi), rx = w * (0.3 + 0.14 * hi), jw = w * 1.5, jh = w * 0.62, top = y - w * 0.02;
  ctx.save(); ctx.fillStyle = "#2a0d12";
  ctx.beginPath(); ctx.ellipse(x, y + mh * 0.4, rx, Math.max(0.5, mh * 0.6), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.85)";           // hint of teeth
  ctx.beginPath(); ctx.ellipse(x, y + mh * 0.08, rx * 0.8, Math.max(0.3, mh * 0.12), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const pw = Math.max(8, Math.round(jw * view.sc)), ph = Math.max(8, Math.round(jh * view.sc));
  off.width = pw; off.height = ph;                   // sharp, soft-edged patch of lower lip / chin, moved down
  octx.globalCompositeOperation = "source-over";
  octx.drawImage(img, (x - jw / 2) * k, top * k, jw * k, jh * k, 0, 0, pw, ph);
  octx.globalCompositeOperation = "destination-in";
  octx.save(); octx.translate(pw / 2, ph / 2); octx.scale(1, ph / pw);
  const g = octx.createRadialGradient(0, 0, pw * 0.3, 0, 0, pw * 0.5);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  octx.fillStyle = g; octx.fillRect(-pw / 2, -pw / 2, pw, pw); octx.restore();
  ctx.drawImage(off, x - jw / 2, top + mh * 0.75, jw, jh);
}

function draw(open = 0, amp = 0, t = 0, showMarks = true) {
  if (!img) return;
  const mv = +$("move").value, px = view.x + view.w / 2, py = view.y + view.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.scale(view.sc, view.sc); ctx.translate(-view.x, -view.y);
  ctx.translate(px, py); ctx.rotate(Math.sin(t * 1.4) * 0.012 * mv + (amp - 0.3) * 0.006 * mv);
  ctx.translate(-px, -py + amp * view.h * 0.007 * mv);
  ctx.drawImage(img, 0, 0, base.w, base.h);
  if (mouth && open > 0.03) mouthOpen(open);
  ctx.restore();
  if (showMarks) {
    ctx.fillStyle = "#ff7a1a";
    marks.forEach((m) => { ctx.beginPath(); ctx.arc((m.x - view.x) * view.sc, (m.y - view.y) * view.sc, Math.max(4, cv.width / 110), 0, Math.PI * 2); ctx.fill(); });
  }
}


/* ---------- built-in line character ---------- */
const LINE = "#f5ede6", ORANGE = "#ff7a1a", lim = (v, a, b) => Math.max(a, Math.min(b, v));
const SKIN = "#f0c9a0", SKIN_D = "#b9835c", DARK = "#2b1d14";
const OUTFIT = {   // suit = coat + lapels + shirt + tie; otherwise a plain shirt
  teacher:   { suit: true, top: "#2f3f7a", top2: "#222e5c", under: "#f6f6f6", tie: "#b3262e", pants: "#2b2f3a", shoes: "#16110d", hair: "#2e211b", cuff: "#f6f6f6" },
  farmer:    { top: "#4d8a4a", pants: "#cdbf94", shoes: "#6b4423", hair: "#2e211b" },
  cricketer: { top: "#2d6bd6", pants: "#f0f0f0", shoes: "#ffffff", hair: "#2e211b", cuff: "#ffffff" },
};
const OUT_DEFAULT = { suit: true, top: "#34343f", top2: "#25252e", under: "#f6f6f6", tie: "#1f6f8b", pants: "#26262e", shoes: "#16110d", hair: "#2e211b", cuff: "#f6f6f6" };

/* teacher gestures: smooth poses (shoulder angle s, elbow bend b) chosen in turn while speaking, like explaining to a screen */
const REST = { rS: 16, rB: 8, lS: 14, lB: 8 };
const GEST = [
  { rS: 52, rB: 58, lS: 14, lB: 8 },                   // open palm "present"
  { rS: 92, rB: 4, lS: 14, lB: 8, point: 1 },          // arm out, pointing at the screen (middle)
  { rS: 108, rB: 4, lS: 14, lB: 8, point: 1 },         // pointing a little higher
  { rS: 122, rB: 4, lS: 14, lB: 8, point: 1 },         // pointing at the top
  { rS: 76, rB: 6, lS: 14, lB: 8, point: 1 },          // pointing lower
  { rS: 48, rB: 62, lS: 36, lB: 66 },                  // both hands: explaining
  { rS: 22, rB: 168, lS: 14, lB: 8 },                  // hand to chest: "I / my"
  { rS: 30, rB: 112, lS: 34, lB: 66 },                 // counting / listing a point
  { rS: 60, rB: 30, lS: 44, lB: 30 },                  // arms wide: "all of this"
];
const pose = Object.assign({}, REST);
let curG = null, gUntil = 0, lastT = 0, lastN = -1;
function updatePose(t, speaking) {
  const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
  if (speaking) {
    if (!curG || t > gUntil) {
      let n; do { n = Math.floor(Math.random() * GEST.length); } while (n === lastN);
      lastN = n; curG = GEST[n]; gUntil = t + 2 + Math.random() * 1.8;
    }
  } else curG = null;
  const tg = curG || REST, k = 1 - Math.exp(-dt * 3.5), wob = speaking ? Math.sin(t * 1.7) * 3 : 0;
  pose.rS += (tg.rS + wob - pose.rS) * k; pose.rB += (tg.rB - pose.rB) * k;
  pose.lS += (tg.lS - wob - pose.lS) * k; pose.lB += (tg.lB - pose.lB) * k;
}
function wrist(side, sx, sy, s, b, ul, fl) {
  const a1 = (s * Math.PI) / 180, a2 = ((s + b) * Math.PI) / 180;
  const ex = sx + Math.sin(a1) * side * ul, ey = sy + Math.cos(a1) * ul;
  return { ex, ey, wx: ex + Math.sin(a2) * side * fl, wy: ey + Math.cos(a2) * fl, a2 };
}
function limb(side, sx, sy, s, bend, ul, fl, o) {          // sleeve = two thick lines: shoulder->elbow, elbow->wrist, then the hand
  const p = wrist(side, sx, sy, s, bend, ul, fl);
  ctx.lineWidth = 25; ctx.strokeStyle = o.top;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(p.ex, p.ey); ctx.lineTo(p.wx, p.wy); ctx.stroke();
  if (o.cuff) { ctx.strokeStyle = o.cuff; ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(p.wx - Math.sin(p.a2) * side * 11, p.wy - Math.cos(p.a2) * 11); ctx.lineTo(p.wx, p.wy); ctx.stroke(); }
  ctx.fillStyle = SKIN; ctx.strokeStyle = SKIN_D; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(p.wx + Math.sin(p.a2) * side * 12, p.wy + Math.cos(p.a2) * 12, 11.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); } };
const LINES_Y = [215, 255, 295, 335, 375];
function drawBoard(hy, pointing) {                       // the "screen" behind the teacher
  ctx.fillStyle = "#f7f3ea"; ctx.strokeStyle = "#c8a24a"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(335, 120, 280, 300, 12) : ctx.rect(335, 120, 280, 300); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#2b3a67"; ctx.fillRect(342, 127, 266, 34);
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(356, 139, 120, 10);
  let hi2 = -1;
  if (pointing) { let d = 1e9; LINES_Y.forEach((y, i) => { if (Math.abs(y - hy) < d) { d = Math.abs(y - hy); hi2 = i; } }); }
  LINES_Y.forEach((y, i) => {
    if (i === hi2) { ctx.fillStyle = "rgba(255,196,50,.6)"; ctx.fillRect(348, y - 14, 252, 28); }
    ctx.fillStyle = "#8b95a5"; ctx.fillRect(360, y - 5, [200, 160, 220, 130, 180][i], 10);
  });
}
function drawChar(open, amp, t) {
  const g = lim(gs * 2.2, 0, 1), mv = +$("move").value, tone = $("tone").value, st = +$("strength").value / 1.5, o = OUTFIT[tone] || OUT_DEFAULT;
  const board = $("board").checked, off = board ? -90 : 0;
  updatePose(t, gs > 0.1);
  const rS = REST.rS + (pose.rS - REST.rS) * mv, rB = REST.rB + (pose.rB - REST.rB) * mv, lS = REST.lS + (pose.lS - REST.lS) * mv, lB = REST.lB + (pose.lB - REST.lB) * mv;
  const sway = Math.sin(t * 0.8) * 3 * (0.3 + g) * mv + off, br = Math.sin(t * 1.6) * 2;
  const RSX = 378 + sway, RSY = 298 + br, w = wrist(1, RSX, RSY, rS, rB, 88, 82);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#1b2a49"); bg.addColorStop(1, "#0d1730");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (board) drawBoard(w.wy, !!(curG && curG.point));
  ctx.strokeStyle = "rgba(245,237,230,.22)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(60, 672); ctx.lineTo(600, 672); ctx.stroke();
  ctx.save(); ctx.translate(sway, 0);
  for (const side of [-1, 1]) {                           // trousers: hip->knee, knee->ankle; shoes
    const hx = 320 + side * 22, kx = hx + side * 9, ky = 585, ax = kx + side * 4, ay = 662;
    ctx.strokeStyle = o.pants; ctx.lineWidth = 28;
    ctx.beginPath(); ctx.moveTo(hx, 496); ctx.lineTo(kx, ky); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.strokeStyle = o.shoes; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(ax, 666); ctx.lineTo(ax + side * 28, 666); ctx.stroke();
  }
  if (o.suit) {                                            // coat, lapels, shirt V, tie, buttons, pocket square
    ctx.fillStyle = o.top; ctx.beginPath(); ctx.moveTo(264, 290 + br); ctx.quadraticCurveTo(250, 292 + br, 252, 306);
    ctx.lineTo(258, 524); ctx.lineTo(382, 524); ctx.lineTo(388, 306); ctx.quadraticCurveTo(390, 292 + br, 376, 290 + br); ctx.closePath(); ctx.fill();
    poly([[298, 288 + br], [342, 288 + br], [320, 356]], o.under);
    poly([[308, 306], [332, 306], [320, 360]], "rgba(0,0,0,.08)");
    poly([[314, 306], [326, 306], [332, 424], [320, 440], [308, 424]], o.tie);                  // tie
    poly([[313, 298], [327, 298], [324, 312], [316, 312]], o.tie);                              // knot
    poly([[286, 292 + br], [302, 289 + br], [322, 358], [296, 386]], o.top2, "rgba(0,0,0,.35)"); // lapels
    poly([[354, 292 + br], [338, 289 + br], [318, 358], [344, 386]], o.top2, "rgba(0,0,0,.35)");
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(320, 392); ctx.lineTo(320, 524); ctx.stroke();
    ctx.fillStyle = "#0f0f14"; for (const by of [452, 488]) { ctx.beginPath(); ctx.arc(329, by, 4.5, 0, Math.PI * 2); ctx.fill(); }
    poly([[350, 346], [366, 344], [366, 353], [350, 355]], "#ffffff");                          // pocket square
  } else {
    ctx.fillStyle = o.top; poly([[254, 296 + br], [386, 296 + br], [376, 500], [264, 500]], o.top);
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(320, 296 + br, 20, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  limb(1, 378, 298 + br, rS, rB, 88, 82, o);       // right arm: gestures / pointing
  limb(-1, 262, 298 + br, lS, lB, 88, 82, o);                 // left arm
  ctx.save();                                              // head: tilts and nods with the voice
  ctx.translate(320, 262); ctx.rotate((Math.sin(t * 1.1) * 0.04 * (0.4 + g) + (amp - 0.3) * 0.03) * mv); ctx.translate(-320, -262 + amp * 3 * mv);
  ctx.strokeStyle = SKIN; ctx.lineWidth = 16;
  ctx.beginPath(); ctx.moveTo(320, 246); ctx.lineTo(320, 288); ctx.stroke();        // neck
  ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.fillStyle = SKIN; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.clip();   // hair
  ctx.fillStyle = o.hair; ctx.beginPath(); ctx.ellipse(320, 138, 78, 38, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.strokeStyle = SKIN_D; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.stroke();
  const blink = t % 4.1 < 0.13;
  ctx.fillStyle = DARK; ctx.strokeStyle = DARK; ctx.lineWidth = 5;
  for (const ex of [298, 342]) {
    if (blink) { ctx.beginPath(); ctx.moveTo(ex - 7, 184); ctx.lineTo(ex + 7, 184); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(ex, 184, 5.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(ex - 10, 169 - amp * 5); ctx.lineTo(ex + 10, 167 - amp * 5); ctx.stroke();   // brows lift on emphasis
  }
  ctx.strokeStyle = SKIN_D; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(320, 192); ctx.lineTo(316, 207); ctx.lineTo(324, 208); ctx.stroke();   // nose
  ctx.strokeStyle = DARK; ctx.lineWidth = 5;                                          // mouth
  const rx = 14 + 12 * hi, ry = 3 + 25 * open * st;
  if (open < 0.07) { ctx.beginPath(); ctx.moveTo(302, 225); ctx.quadraticCurveTo(320, 237, 338, 225); ctx.stroke(); }
  else { ctx.beginPath(); ctx.ellipse(320, 227 + Math.min(ry, 28) * 0.3, rx, Math.min(ry, 30), 0, 0, Math.PI * 2); ctx.fillStyle = "#7a1f2b"; ctx.fill(); ctx.stroke(); }
  ctx.lineWidth = 4;                                                                  // look by speaking style
  if (tone === "teacher") {
    ctx.strokeStyle = "#222";
    for (const ex of [298, 342]) { ctx.beginPath(); ctx.arc(ex, 184, 17, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(315, 182); ctx.lineTo(325, 182); ctx.moveTo(281, 182); ctx.lineTo(262, 178); ctx.moveTo(359, 182); ctx.lineTo(378, 178); ctx.stroke();
  } else if (tone === "farmer") {
    ctx.strokeStyle = "#e0b050"; ctx.fillStyle = "#e9c36a"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(320, 140, 96, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(262, 138); ctx.quadraticCurveTo(320, 52, 378, 138); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#8a5a2b"; ctx.beginPath(); ctx.moveTo(266, 124); ctx.lineTo(374, 124); ctx.stroke();
  } else if (tone === "cricketer") {
    ctx.strokeStyle = "#1f4fa0"; ctx.fillStyle = "#4aa3ff"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(258, 150); ctx.bezierCurveTo(258, 80, 382, 80, 382, 150); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(320, 152, 72, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore(); ctx.restore();
}
function blank() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#1e1916"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#a89c92"; ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Upload a picture above", cv.width / 2, cv.height / 2);
}
const CW = 640, CH = 720;
function paint(open, amp, t, marksOn) { if (mode === "char") drawChar(open, amp, t); else if (img) draw(open, amp, t, marksOn); else blank(); }
function setMode(m) {
  mode = m; $("photoBox").hidden = m !== "photo"; $("zoomRow").hidden = m !== "photo"; $("boardRow").hidden = m !== "char";
  if (m === "char") { cv.width = CW; cv.height = CH; }
  else if (img) { faceView(); }
  else { cv.width = CW; cv.height = 480; }
  paint(0, 0, 0, !mouth);
}
document.querySelectorAll('input[name="mode"]').forEach((r) => (r.onchange = () => !playing && r.checked && setMode(r.value)));
function idle() { if (!playing) { gs *= 0.95; if (mode === "char") drawChar(0, 0, performance.now() / 1000); } requestAnimationFrame(idle); }

/* ---------- upload + mark the mouth ---------- */
$("file").onchange = () => {
  const f = $("file").files[0]; if (!f) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    const s = Math.min(1, 1600 / im.width, 1600 / im.height);
    base = { w: im.width * s, h: im.height * s };
    marks = []; mouth = null; fullView(); $("hintm").hidden = false;
    $("hintm").firstChild.textContent = HINT1;
    draw();
  };
  im.src = URL.createObjectURL(f);
};
cv.addEventListener("click", (e) => {
  if (mode !== "photo" || !img || playing || marks.length >= 2) return;
  const r = cv.getBoundingClientRect();
  marks.push({ x: ((e.clientX - r.left) / r.width) * base.w, y: ((e.clientY - r.top) / r.height) * base.h });
  if (marks.length === 2) {
    const [a, b] = marks;
    mouth = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.max(8, Math.abs(b.x - a.x)) };
    $("hintm").firstChild.textContent = "Mouth marked. Now add your text and click Make it talk. ";
    faceView();
  }
  draw();
});
$("remark").onclick = () => { if (playing) return; marks = []; mouth = null; fullView(); $("hintm").firstChild.textContent = HINT1; draw(); };
$("zoom").onchange = () => { if (playing || mode !== "photo") return; faceView(); draw(0, 0, 0, !mouth); };

/* ---------- audio -> animation ---------- */
function setupAudio() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaElementSource($("au"));
  an = ac.createAnalyser(); an.fftSize = 1024; buf = new Uint8Array(an.fftSize); fbuf = new Uint8Array(an.frequencyBinCount);
  dest = ac.createMediaStreamDestination();
  src.connect(an); an.connect(ac.destination); an.connect(dest);
}
function analyse() {
  an.getByteTimeDomainData(buf);
  let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; }
  an.getByteFrequencyData(fbuf);
  let num = 0, den = 0; for (let i = 2; i < 100; i++) { num += i * fbuf[i]; den += fbuf[i]; }
  return { rms: Math.sqrt(s / buf.length), h: den ? Math.min(1, Math.max(0, (num / den - 8) / 22)) : 0.5 };
}
function loop() {
  if (!playing) return;
  const { rms, h } = analyse();
  peak = Math.max(peak * 0.996, rms, 0.04);                      // adapts to how loud the voice is
  const a = Math.min(1, Math.max(0, (rms / peak - 0.1) * 1.5));
  sm = sm * 0.5 + a * 0.5; hi = hi * 0.8 + h * 0.2; gs = gs * 0.94 + sm * 0.06;
  paint(sm, sm, performance.now() / 1000, false);
  requestAnimationFrame(loop);
}

/* ---------- recording (video download) ---------- */
function startRec() {
  $("dl").hidden = true;
  if (!window.MediaRecorder || !cv.captureStream) return;
  const ms = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  chunks = [];
  const mt = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  rec = new MediaRecorder(ms, { mimeType: mt });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => { $("dl").href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" })); $("dl").hidden = false; };
  rec.start();
}

async function play() {
  const au = $("au");
  setupAudio(); await ac.resume();
  au.currentTime = 0; playing = true; sm = 0; peak = 0.05; startRec();
  await au.play(); loop();
}
$("au").addEventListener("ended", () => {
  playing = false; paint(0, 0, 0, false);
  if (rec && rec.state !== "inactive") rec.stop();
});
$("replay").onclick = () => play();

$("go").addEventListener("click", async () => {
  const msg = $("msg"), text = $("text").value.trim();
  msg.className = "";
  if (mode === "photo" && !img) { msg.textContent = "Please upload a picture first."; msg.className = "err"; return; }
  if (mode === "photo" && !mouth) { msg.textContent = "Please click the two corners of the mouth on the picture."; msg.className = "err"; return; }
  if (!text) { msg.textContent = "Please enter some text."; msg.className = "err"; return; }
  $("go").disabled = true; msg.textContent = "Making the voice… this takes a few seconds.";
  try {
    const res = await fetch("/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tone: $("tone").value, language: $("lang").value, raw: $("raw").checked }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Request failed");
    $("script").textContent = d.script;
    $("au").src = d.audio_url; $("au").hidden = false; $("replay").hidden = false;
    msg.textContent = "";
    await new Promise((r) => { $("au").onloadeddata = r; $("au").load(); });
    await play();
  } catch (err) { msg.textContent = err.message; msg.className = "err"; }
  finally { $("go").disabled = false; }
});
setMode("char"); idle();
