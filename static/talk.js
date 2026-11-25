const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d"), fcv = $("fcv"), fctx = fcv.getContext("2d");
const off = document.createElement("canvas"), octx = off.getContext("2d"), hc = document.createElement("canvas"), hctx = hc.getContext("2d");
const CW = 640, CH = 720, HR = 76, HPS = 3, lim = (v, a, b) => Math.max(a, Math.min(b, v));
let ac, an, buf, fbuf, dest, rec, chunks = [], sm = 0, gs = 0, hi = 0.5, peak = 0.05, playing = false;
let faceImg = null, fm = null, marks = [], pscale = 1, skin = "#f0c9a0", skinD = "#b9835c";
$("text").value = sessionStorage.getItem("cm_text") || "";
$("lang").value = sessionStorage.getItem("cm_lang") || "english";

/* ================= face: upload, mark the mouth, circle crop ================= */
const HINT = "Click the LEFT corner of the mouth, then the RIGHT corner. ";
function faceGeom() { const s = +$("fsize").value, up = +$("fup").value; return { x: fm.x, y: fm.y - (0.7 + up) * fm.w, r: 1.55 * fm.w * s }; }
function drawPreview() {
  if (!faceImg) return;
  fctx.clearRect(0, 0, fcv.width, fcv.height); fctx.drawImage(faceImg, 0, 0, fcv.width, fcv.height);
  fctx.strokeStyle = "#ff7a1a"; fctx.fillStyle = "#ff7a1a"; fctx.lineWidth = 2;
  if (fm) { const g = faceGeom(); fctx.beginPath(); fctx.arc(g.x * pscale, g.y * pscale, g.r * pscale, 0, Math.PI * 2); fctx.stroke(); }
  marks.forEach((m) => { fctx.beginPath(); fctx.arc(m.x * pscale, m.y * pscale, 4, 0, Math.PI * 2); fctx.fill(); });
}
function sampleSkin() {                                   // neck and hands take the skin colour of the picture
  try {
    const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d");
    const sy = lim(fm.y + fm.w * 0.9 - 2, 0, faceImg.height - 4), sx = lim(fm.x - 2, 0, faceImg.width - 4);
    x.drawImage(faceImg, sx, sy, 4, 4, 0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data; skin = `rgb(${d[0]},${d[1]},${d[2]})`; skinD = `rgb(${(d[0] * 0.78) | 0},${(d[1] * 0.78) | 0},${(d[2] * 0.78) | 0})`;
  } catch (_) {}
}
$("faceFile").onchange = () => {
  const f = $("faceFile").files[0]; if (!f) return;
  const im = new Image();
  im.onload = () => {
    faceImg = im; fm = null; marks = [];
    pscale = Math.min(1, 420 / im.width, 420 / im.height); fcv.width = im.width * pscale; fcv.height = im.height * pscale;
    $("fpanel").hidden = false; $("fhint").firstChild.textContent = HINT; drawPreview();
  };
  im.src = URL.createObjectURL(f);
};
fcv.addEventListener("click", (e) => {
  if (!faceImg || marks.length >= 2) return;
  const r = fcv.getBoundingClientRect();
  marks.push({ x: ((e.clientX - r.left) / r.width) * faceImg.width, y: ((e.clientY - r.top) / r.height) * faceImg.height });
  if (marks.length === 2) {
    const [a, b] = marks; fm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.max(8, Math.abs(b.x - a.x)) };
    sampleSkin(); $("fhint").firstChild.textContent = "Done. Adjust the circle with the sliders if needed. ";
  }
  drawPreview();
});
$("fredo").onclick = () => { marks = []; fm = null; skin = "#f0c9a0"; skinD = "#b9835c"; $("fhint").firstChild.textContent = HINT; drawPreview(); };
$("fremove").onclick = () => { faceImg = null; fm = null; marks = []; skin = "#f0c9a0"; skinD = "#b9835c"; $("fpanel").hidden = true; $("faceFile").value = ""; };
$("fsize").oninput = $("fup").oninput = drawPreview;

/* mouth taken from the picture: opening between the lips + the real lower lip / chin moved down */
function mouthOpen(g, open, M, map, ps) {
  const { x, y, w } = M, mh = Math.min(w * 0.3 * open * +$("strength").value, w * 0.42);
  if (mh < 0.4) return;
  const rx = w * (0.34 + 0.08 * hi), jw = w * 1.5, jh = w * 0.62, top = y - w * 0.02;
  g.save(); g.beginPath(); g.ellipse(x, y + mh * 0.5, rx, Math.max(0.3, mh * 0.5), 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#3a0f16"; g.fillRect(x - rx, y - 1, rx * 2, mh + 2);
  if (mh > w * 0.1) { g.fillStyle = "rgba(250,250,250,.92)"; g.fillRect(x - rx * 0.8, y - 1, rx * 1.6, mh * 0.32 + 1); }      // upper teeth
  g.fillStyle = "#b04a58"; g.beginPath(); g.ellipse(x, y + mh * 0.98, rx * 0.6, mh * 0.34, 0, 0, Math.PI * 2); g.fill();      // tongue
  g.restore();
  const pw = Math.max(8, Math.round(jw * ps)), ph = Math.max(8, Math.round(jh * ps));
  off.width = pw; off.height = ph;
  octx.globalCompositeOperation = "source-over";
  octx.drawImage(faceImg, map.sx(x - jw / 2), map.sy(top), jw * map.ks, jh * map.ks, 0, 0, pw, ph);
  octx.globalCompositeOperation = "destination-in";
  octx.save(); octx.translate(pw / 2, ph / 2); octx.scale(1, ph / pw);
  const gr = octx.createRadialGradient(0, 0, pw * 0.3, 0, 0, pw * 0.5); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  octx.fillStyle = gr; octx.fillRect(-pw / 2, -pw / 2, pw, pw); octx.restore();
  g.drawImage(off, x - jw / 2, top + mh * 0.85, jw, jh);
}
function drawHead(open, yw) {
  const g = faceGeom(), sc = HR / g.r, S = 2 * HR * HPS;
  if (hc.width !== S) { hc.width = S; hc.height = S; }
  hctx.setTransform(1, 0, 0, 1, 0, 0); hctx.clearRect(0, 0, S, S); hctx.setTransform(HPS, 0, 0, HPS, 0, 0);
  hctx.fillStyle = skin; hctx.fillRect(0, 0, 2 * HR, 2 * HR);
  hctx.drawImage(faceImg, g.x - g.r, g.y - g.r, 2 * g.r, 2 * g.r, 0, 0, 2 * HR, 2 * HR);
  if (open > 0.03) mouthOpen(hctx, open, { x: HR + (fm.x - g.x) * sc, y: HR + (fm.y - g.y) * sc, w: fm.w * sc },
    { sx: (dx) => g.x + (dx - HR) / sc, sy: (dy) => g.y + (dy - HR) / sc, ks: 1 / sc }, HPS);
  hctx.setTransform(1, 0, 0, 1, 0, 0); hctx.globalCompositeOperation = "destination-in";     // soft round edge
  const gr = hctx.createRadialGradient(S / 2, S / 2, S * 0.43, S / 2, S / 2, S / 2); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  hctx.fillStyle = gr; hctx.fillRect(0, 0, S, S); hctx.globalCompositeOperation = "source-over";
  ctx.save(); ctx.translate(320 + yw * 9, 204); ctx.scale(1 - 0.07 * yw, 1); ctx.drawImage(hc, -HR, -HR, 2 * HR, 2 * HR); ctx.restore();
}

/* ================= arms: gestures with real arm geometry (2-bone IK) ================= */
const ARM1 = 105, ARM2 = 100, REST_R = [402, 446], REST_L = [238, 446];
const GEST = [   // hand targets (x, y, hold seconds). board:1 = points at the screen
  { look: 1, point: 1, board: 1, R: [[430, 332, 0.7], [490, 328, 0.7], [552, 322, 1]] },                     // left -> right along the screen: "this, and this, and that"
  { look: 1, point: 1, board: 1, R: [[470, 232, 0.9], [472, 272, 0.9], [474, 312, 0.9], [476, 352, 0.9]] },  // down the list
  { look: 1, point: 1, board: 1, R: [[556, 246, 0.7], [498, 244, 0.7], [440, 242, 1]] },                     // right -> left along the top
  { R: [[458, 364, 1.5]] },                                                                                   // open hand "here"
  { R: [[440, 374, 0.9], [478, 350, 0.9]], L: [[200, 374, 0.9], [162, 350, 0.9]] },                           // both hands explaining
  { R: [[505, 342, 1.3]], L: [[140, 342, 1.3]] },                                                             // arms wide: "all of this"
  { R: [[436, 318, 0.6], [446, 296, 0.6], [436, 318, 0.6]] },                                                 // small emphasis
];
const arms = { rx: REST_R[0], ry: REST_R[1], lx: REST_L[0], ly: REST_L[1] }, seq = { g: null, wi: 0, until: 0, gap: 0 };
let lastT = 0, lastG = -1, yaw = 0;
function updateArms(t, speaking, board, mv) {
  const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
  let tr = REST_R, tl = REST_L;
  if (speaking) {
    if (!seq.g) {
      if (t >= seq.gap) {
        const pool = GEST.map((_, i) => i).filter((i) => i !== lastG && (board || !GEST[i].board));
        lastG = pool[Math.floor(Math.random() * pool.length)]; seq.g = GEST[lastG]; seq.wi = 0; seq.until = t + seq.g.R[0][2];
      }
    } else if (t > seq.until) {
      seq.wi++;
      if (seq.wi >= seq.g.R.length) { seq.g = null; seq.gap = t + 0.5 + Math.random() * 0.8; }
      else seq.until = t + seq.g.R[seq.wi][2];
    }
    if (seq.g) { tr = seq.g.R[seq.wi]; if (seq.g.L) tl = seq.g.L[seq.wi]; }
  } else seq.g = null;
  const tx = (a, r) => r[0] + (a[0] - r[0]) * mv, ty = (a, r) => r[1] + (a[1] - r[1]) * mv, k = 1 - Math.exp(-dt * 5.5);
  arms.rx += (tx(tr, REST_R) - arms.rx) * k; arms.ry += (ty(tr, REST_R) - arms.ry) * k;
  arms.lx += (tx(tl, REST_L) - arms.lx) * k; arms.ly += (ty(tl, REST_L) - arms.ly) * k;
  yaw += ((seq.g && seq.g.look ? 1 : 0) - yaw) * (1 - Math.exp(-dt * 3));      // head turns to the screen, then back to us
}
function arm(side, sx, sy, tx, ty, o, point) {
  let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy);
  d = lim(d, 45, ARM1 + ARM2 - 2); const a = Math.atan2(dy, dx);
  const b = Math.acos(lim((ARM1 * ARM1 + d * d - ARM2 * ARM2) / (2 * ARM1 * d), -1, 1)), ea = a + side * b;
  const ex = sx + Math.cos(ea) * ARM1, ey = sy + Math.sin(ea) * ARM1, wx = sx + Math.cos(a) * d, wy = sy + Math.sin(a) * d;
  const fl = Math.hypot(wx - ex, wy - ey) || 1, ux = (wx - ex) / fl, uy = (wy - ey) / fl;
  ctx.lineWidth = 25; ctx.strokeStyle = o.top; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  if (o.cuff) { ctx.strokeStyle = o.cuff; ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(wx - ux * 11, wy - uy * 11); ctx.lineTo(wx, wy); ctx.stroke(); }
  if (point) { ctx.strokeStyle = skin; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(wx + ux * 8, wy + uy * 8); ctx.lineTo(wx + ux * 30, wy + uy * 30); ctx.stroke(); }   // pointing finger
  ctx.fillStyle = skin; ctx.strokeStyle = skinD; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(wx + ux * 12, wy + uy * 12, 11.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

/* ================= the teacher ================= */
const OUTFIT = {
  teacher:   { suit: 1, top: "#2f3f7a", top2: "#222e5c", under: "#f6f6f6", tie: "#b3262e", pants: "#2b2f3a", shoes: "#16110d", hair: "#2e211b", cuff: "#f6f6f6" },
  farmer:    { top: "#4d8a4a", pants: "#cdbf94", shoes: "#6b4423", hair: "#2e211b" },
  cricketer: { top: "#2d6bd6", pants: "#f0f0f0", shoes: "#ffffff", hair: "#2e211b", cuff: "#ffffff" },
};
const OUT_DEFAULT = { suit: 1, top: "#34343f", top2: "#25252e", under: "#f6f6f6", tie: "#1f6f8b", pants: "#26262e", shoes: "#16110d", hair: "#2e211b", cuff: "#f6f6f6" };
const DARK = "#2b1d14", LINES_Y = [215, 255, 295, 335, 375];
const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); } };
function drawBoard(hy, on) {
  ctx.fillStyle = "#f7f3ea"; ctx.strokeStyle = "#c8a24a"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.rect(255, 110, 360, 310); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#2b3a67"; ctx.fillRect(262, 117, 346, 34); ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(374, 129, 130, 10);
  let hl = -1; if (on) { let d = 1e9; LINES_Y.forEach((y, i) => { if (Math.abs(y - hy) < d) { d = Math.abs(y - hy); hl = i; } }); }
  LINES_Y.forEach((y, i) => {
    if (i === hl) { ctx.fillStyle = "rgba(255,196,50,.6)"; ctx.fillRect(358, y - 14, 242, 28); }
    ctx.fillStyle = "#8b95a5"; ctx.fillRect(368, y - 5, [200, 160, 215, 130, 180][i], 10);
  });
}
function drawChar(open, amp, t) {
  const mv = +$("move").value, tone = $("tone").value, o = OUTFIT[tone] || OUT_DEFAULT, board = $("board").checked, g = lim(gs * 2.2, 0, 1);
  updateArms(t, gs > 0.1, board, mv);
  const shift = (board ? -40 : 0) + Math.sin(t * 0.8) * 2 * (0.3 + g) * mv, br = Math.sin(t * 1.6) * 2, hasFace = faceImg && fm;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#1b2a49"); bg.addColorStop(1, "#0d1730");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH); ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (board) drawBoard(arms.ry, !!(seq.g && seq.g.point));
  ctx.strokeStyle = "rgba(245,237,230,.22)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(60, 672); ctx.lineTo(600, 672); ctx.stroke();
  ctx.save(); ctx.translate(shift, 0);
  for (const side of [-1, 1]) {                                               // trousers + shoes
    const hx = 320 + side * 22, kx = hx + side * 9, ax = kx + side * 4;
    ctx.strokeStyle = o.pants; ctx.lineWidth = 28; ctx.beginPath(); ctx.moveTo(hx, 496); ctx.lineTo(kx, 585); ctx.lineTo(ax, 662); ctx.stroke();
    ctx.strokeStyle = o.shoes; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(ax, 666); ctx.lineTo(ax + side * 28, 666); ctx.stroke();
  }
  if (o.suit) {                                                               // coat, lapels, shirt, tie, buttons, pocket square
    ctx.fillStyle = o.top; ctx.beginPath(); ctx.moveTo(264, 290 + br); ctx.quadraticCurveTo(250, 292 + br, 252, 306);
    ctx.lineTo(258, 524); ctx.lineTo(382, 524); ctx.lineTo(388, 306); ctx.quadraticCurveTo(390, 292 + br, 376, 290 + br); ctx.closePath(); ctx.fill();
    poly([[298, 288 + br], [342, 288 + br], [320, 356]], o.under);
    poly([[314, 306], [326, 306], [332, 424], [320, 440], [308, 424]], o.tie); poly([[313, 298], [327, 298], [324, 312], [316, 312]], o.tie);
    poly([[286, 292 + br], [302, 289 + br], [322, 358], [296, 386]], o.top2, "rgba(0,0,0,.35)"); poly([[354, 292 + br], [338, 289 + br], [318, 358], [344, 386]], o.top2, "rgba(0,0,0,.35)");
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(320, 392); ctx.lineTo(320, 524); ctx.stroke();
    ctx.fillStyle = "#0f0f14"; for (const by of [452, 488]) { ctx.beginPath(); ctx.arc(329, by, 4.5, 0, Math.PI * 2); ctx.fill(); }
    poly([[350, 346], [366, 344], [366, 353], [350, 355]], "#ffffff");
  } else {
    poly([[254, 296 + br], [386, 296 + br], [376, 500], [264, 500]], o.top);
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(320, 296 + br, 20, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  const pointing = !!(seq.g && seq.g.point);
  arm(1, 378, 298 + br, arms.rx, arms.ry, o, pointing); arm(-1, 262, 298 + br, arms.lx, arms.ly, o, false);
  ctx.save(); ctx.translate(320, 262); ctx.rotate((Math.sin(t * 1.1) * 0.03 * (0.4 + g) + (amp - 0.3) * 0.02 + yaw * 0.05) * mv); ctx.translate(-320, -262 + amp * 2 * mv);
  ctx.strokeStyle = skin; ctx.lineWidth = hasFace ? 30 : 16; ctx.beginPath(); ctx.moveTo(320, hasFace ? 250 : 246); ctx.lineTo(320, 292); ctx.stroke();   // neck
  if (hasFace) drawHead(open, yaw);
  else {
    ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.fillStyle = skin; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = o.hair; ctx.beginPath(); ctx.ellipse(320, 138, 78, 38, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = skinD; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.stroke();
    const blink = t % 4.1 < 0.13, yx = yaw * 8; ctx.fillStyle = DARK; ctx.strokeStyle = DARK; ctx.lineWidth = 5;
    for (const ex of [298, 342]) {
      if (blink) { ctx.beginPath(); ctx.moveTo(ex - 7 + yx, 184); ctx.lineTo(ex + 7 + yx, 184); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(ex + yx, 184, 5.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(ex - 10 + yx, 169); ctx.lineTo(ex + 10 + yx, 167); ctx.stroke();
    }
    ctx.strokeStyle = skinD; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(320 + yx, 192); ctx.lineTo(316 + yx, 207); ctx.lineTo(324 + yx, 208); ctx.stroke();
    ctx.strokeStyle = DARK; ctx.lineWidth = 5; const rx = 14 + 12 * hi, ry = Math.min(3 + 22 * open * +$("strength").value, 28);
    if (open < 0.07) { ctx.beginPath(); ctx.moveTo(302 + yx, 225); ctx.quadraticCurveTo(320 + yx, 237, 338 + yx, 225); ctx.stroke(); }
    else { ctx.beginPath(); ctx.ellipse(320 + yx, 227 + ry * 0.3, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = "#7a1f2b"; ctx.fill(); ctx.stroke(); }
    ctx.lineWidth = 4;
    if (tone === "teacher") { ctx.strokeStyle = "#222"; for (const ex of [298, 342]) { ctx.beginPath(); ctx.arc(ex + yx, 184, 17, 0, Math.PI * 2); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(315 + yx, 182); ctx.lineTo(325 + yx, 182); ctx.moveTo(281 + yx, 182); ctx.lineTo(262 + yx, 178); ctx.moveTo(359 + yx, 182); ctx.lineTo(378 + yx, 178); ctx.stroke(); }
    else if (tone === "farmer") { ctx.strokeStyle = "#e0b050"; ctx.fillStyle = "#e9c36a"; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(320, 140, 96, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(262, 138); ctx.quadraticCurveTo(320, 52, 378, 138); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (tone === "cricketer") { ctx.strokeStyle = "#1f4fa0"; ctx.fillStyle = "#4aa3ff"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(258, 150); ctx.bezierCurveTo(258, 80, 382, 80, 382, 150); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(320, 152, 72, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore(); ctx.restore();
}
function idle() { if (!playing) { gs *= 0.95; drawChar(0, 0, performance.now() / 1000); } requestAnimationFrame(idle); }

/* ================= audio -> mouth, recording, generate ================= */
function setupAudio() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaElementSource($("au"));
  an = ac.createAnalyser(); an.fftSize = 1024; buf = new Uint8Array(an.fftSize); fbuf = new Uint8Array(an.frequencyBinCount);
  dest = ac.createMediaStreamDestination(); src.connect(an); an.connect(ac.destination); an.connect(dest);
}
function analyse() {
  an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; }
  an.getByteFrequencyData(fbuf); let num = 0, den = 0; for (let i = 2; i < 100; i++) { num += i * fbuf[i]; den += fbuf[i]; }
  return { rms: Math.sqrt(s / buf.length), h: den ? lim((num / den - 8) / 22, 0, 1) : 0.5 };
}
function loop() {
  if (!playing) return;
  const { rms, h } = analyse(); peak = Math.max(peak * 0.996, rms, 0.04);
  const a = rms < 0.015 ? 0 : lim((rms / peak - 0.15) * 1.5, 0, 1);              // silence = closed mouth
  sm += (a - sm) * (a > sm ? 0.55 : 0.3); hi += (h - hi) * 0.2; gs = gs * 0.94 + sm * 0.06;   // quick open, slower close: no flutter
  drawChar(sm, sm, performance.now() / 1000); requestAnimationFrame(loop);
}
function startRec() {
  $("dl").hidden = true; if (!window.MediaRecorder || !cv.captureStream) return;
  const ms = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]); chunks = [];
  rec = new MediaRecorder(ms, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm" });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => { $("dl").href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" })); $("dl").hidden = false; };
  rec.start();
}
async function play() { setupAudio(); await ac.resume(); $("au").currentTime = 0; playing = true; sm = 0; peak = 0.05; startRec(); await $("au").play(); loop(); }
$("au").addEventListener("ended", () => { playing = false; if (rec && rec.state !== "inactive") rec.stop(); });
$("replay").onclick = () => play();
$("go").addEventListener("click", async () => {
  const msg = $("msg"), text = $("text").value.trim(); msg.className = "";
  if (faceImg && !fm) { msg.textContent = "Please click the two corners of the mouth on your picture (or remove the picture)."; msg.className = "err"; return; }
  if (!text) { msg.textContent = "Please enter some text."; msg.className = "err"; return; }
  $("go").disabled = true; msg.textContent = "Making the voice… this takes a few seconds.";
  try {
    const res = await fetch("/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tone: $("tone").value, language: $("lang").value, raw: $("raw").checked }) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error || "Request failed");
    $("script").textContent = d.script; $("au").src = d.audio_url; $("au").hidden = false; $("replay").hidden = false; msg.textContent = "";
    await new Promise((r) => { $("au").onloadeddata = r; $("au").load(); }); await play();
  } catch (err) { msg.textContent = err.message; msg.className = "err"; }
  finally { $("go").disabled = false; }
});
idle();
