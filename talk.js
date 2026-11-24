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
const OUTFIT = {   // top = jacket/shirt, under = shirt, tie, pants, shoes, hair
  teacher:   { top: "#3a4a8c", under: "#f4f4f4", tie: "#c0392b", pants: "#2d3142", shoes: "#6b4423", hair: "#2e211b", cuff: "#f4f4f4" },
  farmer:    { top: "#4d8a4a", under: null, tie: null, pants: "#cdbf94", shoes: "#6b4423", hair: "#2e211b", cuff: null },
  cricketer: { top: "#2d6bd6", under: null, tie: null, pants: "#f0f0f0", shoes: "#ffffff", hair: "#2e211b", cuff: "#ffffff" },
};
const OUT_DEFAULT = { top: "#8a5ab0", under: "#f4f4f4", tie: null, pants: "#3a3f50", shoes: "#4a3a30", hair: "#2e211b", cuff: null };

function limb(side, sx, sy, s, bend, ul, fl, o) {          // sleeve = two thick lines: shoulder->elbow, elbow->wrist, then the hand
  const a1 = (s * Math.PI) / 180, a2 = ((s + bend) * Math.PI) / 180;
  const ex = sx + Math.sin(a1) * side * ul, ey = sy + Math.cos(a1) * ul;
  const wx = ex + Math.sin(a2) * side * fl, wy = ey + Math.cos(a2) * fl;
  ctx.lineWidth = 24; ctx.strokeStyle = o.top;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  if (o.cuff) { ctx.strokeStyle = o.cuff; ctx.lineWidth = 19; ctx.beginPath(); ctx.moveTo(wx - Math.sin(a2) * side * 11, wy - Math.cos(a2) * 11); ctx.lineTo(wx, wy); ctx.stroke(); }
  ctx.fillStyle = SKIN; ctx.strokeStyle = SKIN_D; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(wx + Math.sin(a2) * side * 12, wy + Math.cos(a2) * 12, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
function drawChar(open, amp, t) {
  const g = lim(gs * 2.2, 0, 1), mv = +$("move").value, tone = $("tone").value, st = +$("strength").value / 1.5, o = OUTFIT[tone] || OUT_DEFAULT;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#1b2a49"); bg.addColorStop(1, "#0d1730");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(245,237,230,.22)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(110, 672); ctx.lineTo(530, 672); ctx.stroke();
  const sway = Math.sin(t * 0.8) * 4 * (0.3 + g) * mv, br = Math.sin(t * 1.6) * 2;
  ctx.save(); ctx.translate(sway, 0);
  for (const side of [-1, 1]) {                           // trousers: hip->knee, knee->ankle; shoes
    const hx = 320 + side * 22, kx = hx + side * 10, ky = 580, ax = kx + side * 4, ay = 662;
    ctx.strokeStyle = o.pants; ctx.lineWidth = 27;
    ctx.beginPath(); ctx.moveTo(hx, 472); ctx.lineTo(kx, ky); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.strokeStyle = o.shoes; ctx.lineWidth = 15;
    ctx.beginPath(); ctx.moveTo(ax, 666); ctx.lineTo(ax + side * 26, 666); ctx.stroke();
  }
  ctx.fillStyle = o.top;                                   // jacket / shirt body
  ctx.beginPath(); ctx.moveTo(254, 292 + br); ctx.lineTo(386, 292 + br); ctx.lineTo(374, 484); ctx.lineTo(266, 484); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(266, 474, 108, 10);   // belt line
  if (o.under) {                                           // collar V + tie
    ctx.fillStyle = o.under; ctx.beginPath(); ctx.moveTo(298, 290 + br); ctx.lineTo(342, 290 + br); ctx.lineTo(320, 340); ctx.closePath(); ctx.fill();
    if (o.tie) { ctx.fillStyle = o.tie; ctx.beginPath(); ctx.moveTo(313, 322); ctx.lineTo(327, 322); ctx.lineTo(333, 408); ctx.lineTo(320, 424); ctx.lineTo(307, 408); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(298, 290 + br); ctx.lineTo(320, 340); ctx.lineTo(342, 290 + br); ctx.stroke();
  } else { ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(320, 290 + br, 20, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  const rb = lim(12 + 80 * g * (0.6 + 0.4 * Math.sin(t * 3.1 + 1)) * mv + 35 * amp * mv, 0, 165 - (18 + 30 * g));
  limb(1, 378, 296 + br, 18 + (30 * g + 10 * Math.sin(t * 2.7) * g) * mv, rb, 88, 82, o);                       // right arm (main gestures)
  const lb = 8 + 50 * g * (0.5 + 0.5 * Math.sin(t * 1.7 + 2.5)) * mv;
  limb(-1, 262, 296 + br, 14 + (16 * g + 6 * Math.sin(t * 2.1 + 2) * g) * mv, lb, 88, 82, o);                    // left arm
  ctx.save();                                              // head: tilts and nods with the voice
  ctx.translate(320, 262); ctx.rotate((Math.sin(t * 1.1) * 0.05 * (0.4 + g) + (amp - 0.3) * 0.03) * mv); ctx.translate(-320, -262 + amp * 3 * mv);
  ctx.strokeStyle = SKIN; ctx.lineWidth = 15;
  ctx.beginPath(); ctx.moveTo(320, 246); ctx.lineTo(320, 284); ctx.stroke();        // neck
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
  mode = m; $("photoBox").hidden = m !== "photo"; $("zoomRow").hidden = m !== "photo";
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
