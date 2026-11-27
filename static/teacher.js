(() => {
const $ = (id) => document.getElementById(id);
const cv = $("tcv"), ctx = cv.getContext("2d"), CW = 640, CH = 720, lim = (v, a, b) => Math.max(a, Math.min(b, v));
let ac, an, buf, fbuf, dest, rec, chunks = [], sm = 0, gs = 0, hi = 0.5, peak = 0.05, playing = false, ready = false;
const SKIN = "#f0c9a0", SKIN_D = "#b9835c", DARK = "#2b1d14";

/* ================= the screen behind the teacher, with the spoken text ================= */
const bd = { lines: [], cum: [], total: 0 };
let rd = { on: false, idx: 0, frac: 0 };
const LY = [200, 236, 272, 308, 344, 380], TX = 345, TW = 195, FONT = "15px 'Segoe UI','Nirmala UI',sans-serif";
function setBoard(txt) {
  ctx.font = FONT; const words = String(txt).replace(/\s+/g, " ").trim().split(" "), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > TW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  let s = 0; bd.lines = lines; bd.cum = lines.map((l) => (s += l.length + 1)); bd.total = s;
}
function drawBoard() {
  ctx.fillStyle = "#f7f3ea"; ctx.strokeStyle = "#c8a24a"; ctx.lineWidth = 7; ctx.beginPath(); ctx.rect(290, 110, 270, 310); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#2b3a67"; ctx.fillRect(297, 117, 256, 34); ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(345, 129, 110, 10);
  if (!bd.lines.length) { ctx.fillStyle = "#8b95a5"; LY.forEach((y, i) => ctx.fillRect(TX, y - 5, [180, 140, 190, 110, 160, 130][i], 10)); return; }
  const first = rd.on ? Math.floor(rd.idx / 6) * 6 : 0; ctx.font = FONT; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  for (let k = 0; k < 6; k++) {
    const i = first + k; if (i >= bd.lines.length) break; const y = LY[k], cur = rd.on && i === rd.idx;
    if (cur) { ctx.fillStyle = "rgba(255,196,50,.45)"; ctx.fillRect(TX - 8, y - 16, TW + 16, 32); ctx.fillStyle = "rgba(235,160,0,.95)"; ctx.fillRect(TX - 8, y + 12, (ctx.measureText(bd.lines[i]).width + 16) * rd.frac, 4); }
    ctx.fillStyle = rd.on && i < rd.idx ? "#7a8394" : "#1f2a44"; ctx.fillText(bd.lines[i], TX, y);
  }
}

/* ================= arms: never folded, elbow always outside the body ================= */
const ARM1 = 105, ARM2 = 100, REST_R = [396, 492], REST_L = [244, 492];
const GEST = [   // relaxed hand positions (x, y, hold seconds) used when the teacher is not following the screen text
  { R: [[520, 372, 1.5]] },                                                                   // open hand "here"
  { R: [[505, 385, 0.9], [535, 355, 0.9]], L: [[135, 385, 0.9], [105, 355, 0.9]] },           // both hands explaining
  { R: [[548, 335, 1.3]], L: [[92, 335, 1.3]] },                                              // arms wide
  { R: [[515, 360, 0.6], [525, 335, 0.6], [515, 360, 0.6]] },                                 // small emphasis
];
const arms = { rx: REST_R[0], ry: REST_R[1], lx: REST_L[0], ly: REST_L[1] }, seq = { g: null, wi: 0, until: 0, gap: 0 };
let lastT = 0, lastG = -1, yaw = 0;
function updateArms(t, speaking, mv, read) {
  const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
  let tr = REST_R, tl = REST_L;
  if (read) { tr = [read.x, read.y]; if (read.l) tl = read.l; seq.g = { look: !!read.stick, pseudo: 1 }; }
  else if (speaking) {
    if (seq.g && seq.g.pseudo) seq.g = null;
    if (!seq.g) {
      if (t >= seq.gap) {
        const pool = GEST.map((_, i) => i).filter((i) => i !== lastG);
        lastG = pool[Math.floor(Math.random() * pool.length)]; seq.g = GEST[lastG]; seq.wi = 0; seq.until = t + seq.g.R[0][2];
      }
    } else if (t > seq.until) {
      seq.wi++;
      if (seq.wi >= seq.g.R.length) { seq.g = null; seq.gap = t + 0.5 + Math.random() * 0.8; }
      else seq.until = t + seq.g.R[seq.wi][2];
    }
    if (seq.g) { tr = seq.g.R[seq.wi]; if (seq.g.L) tl = seq.g.L[seq.wi]; }
  } else seq.g = null;
  const mix = (a, r) => [r[0] + (a[0] - r[0]) * mv, r[1] + (a[1] - r[1]) * mv], R = mix(tr, REST_R), L = mix(tl, REST_L), k = 1 - Math.exp(-dt * (read ? 6 : 4));
  arms.rx += (R[0] - arms.rx) * k; arms.ry += (R[1] - arms.ry) * k; arms.lx += (L[0] - arms.lx) * k; arms.ly += (L[1] - arms.ly) * k;
  yaw += ((seq.g && seq.g.look ? 1 : 0) - yaw) * (1 - Math.exp(-dt * 3));      // head turns to the screen, then back to us
}
function arm(side, sx, sy, tx, ty, o, stick) {
  const dx = side * (tx - sx), dy = ty - sy;                                   // mirrored: "outward" is +x for both arms
  const a = lim(Math.atan2(dy, dx), -0.2, 1.5);
  const bend = (d) => Math.acos(lim((ARM1 * ARM1 + d * d - ARM2 * ARM2) / (2 * ARM1 * d), -1, 1));
  let d = lim(Math.hypot(dx, dy), 150, 200);                                   // the arm is never shorter than 150: it cannot fold in on itself
  while (d < 199 && Math.cos(a + bend(d)) * ARM1 < -18) d += 3;                 // and the elbow never tucks far inside the body
  const ea = a + bend(d);                                                      // the elbow always hangs BELOW the line shoulder -> hand (like a real arm)
  const ex = sx + side * Math.cos(ea) * ARM1, ey = sy + Math.sin(ea) * ARM1, wx = sx + side * Math.cos(a) * d, wy = sy + Math.sin(a) * d;
  const fl = Math.hypot(wx - ex, wy - ey) || 1, ux = (wx - ex) / fl, uy = (wy - ey) / fl;
  ctx.lineWidth = 44; ctx.strokeStyle = o.top2 || "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  ctx.lineWidth = 38; ctx.strokeStyle = o.top; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  if (o.cuff) { ctx.strokeStyle = o.cuff; ctx.lineWidth = 31; ctx.beginPath(); ctx.moveTo(wx - ux * 12, wy - uy * 12); ctx.lineTo(wx, wy); ctx.stroke(); }
  const hx = wx + ux * 14, hy = wy + uy * 14;
  if (stick) {                                                                 // pointer stick: its tip touches the line being read
    const sdx = stick.x - hx, sdy = stick.y - hy, sl = Math.hypot(sdx, sdy) || 1, len = Math.min(sl + 4, 400), px = sdx / sl, py = sdy / sl;
    ctx.strokeStyle = "#b9854a"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(hx - px * 22, hy - py * 22); ctx.lineTo(hx + px * len, hy + py * len); ctx.stroke();
    ctx.fillStyle = "#d33"; ctx.beginPath(); ctx.arc(hx + px * len, hy + py * len, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = SKIN; ctx.strokeStyle = SKIN_D; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

/* ================= the character ================= */
const SUIT = { suit: 1, top: "#2f3f7a", top2: "#222e5c", under: "#f6f6f6", tie: "#b3262e", pants: "#2b2f3a", shoes: "#16110d", hair: "#2e211b", cuff: "#f6f6f6", glasses: 1 };
const OUTFIT = {
  teacher: SUIT,
  principal: Object.assign({}, SUIT, { top: "#2b2d3a", top2: "#1d1f2a", tie: "#b8932f", pants: "#23252e", hair: "#9a9a9a" }),
  scientist: Object.assign({}, SUIT, { top: "#f3f3f3", top2: "#d9dde3", under: "#3b6ea5", tie: null, pants: "#3a3f4d", hair: "#4a3526" }),
  farmer: { top: "#4d8a4a", pants: "#cdbf94", shoes: "#6b4423", hair: "#2e211b", hat: "straw" },
  cricketer: { top: "#2d6bd6", pants: "#f0f0f0", shoes: "#ffffff", hair: "#2e211b", cuff: "#ffffff", hat: "cap" },
};
const OUT_DEFAULT = { suit: 1, top: "#34343f", top2: "#25252e", under: "#f6f6f6", tie: "#1f6f8b", pants: "#26262e", shoes: "#16110d", hair: "#2e211b", cuff: "#f6f6f6" };
const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); } };

function drawChar(open, amp, t) {
  const mv = +$("tmove").value, tone = $("tone").value, o = OUTFIT[tone] || OUT_DEFAULT, board = $("tboard").checked, g = lim(gs * 2.2, 0, 1);
  let read = null;                                          // reading: the hand stays relaxed, the stick tip follows the text left to right
  if (board && rd.on && bd.lines.length) {
    const first = Math.floor(rd.idx / 6) * 6, k = rd.idx - first; ctx.font = FONT;
    const Tx = TX + 70 + rd.frac * ctx.measureText(bd.lines[rd.idx]).width, Ty = LY[k] + 12;
    const ang = 0.65 + ((Ty - 212) / 180) * 0.3, dist = 160 + ((Tx - 415) / 195) * 35;
    read = rd.idx % 4 === 3 ? { x: 520, y: 372, l: [120, 372] } : { x: 378 + Math.cos(ang) * dist, y: 298 + Math.sin(ang) * dist, stick: { x: Tx, y: Ty } };
  }
  updateArms(t, gs > 0.1, mv, read);
  const shift = (board ? -70 : 0) + Math.sin(t * 0.8) * 2 * (0.3 + g) * mv, br = Math.sin(t * 1.6) * 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#1b2a49"); bg.addColorStop(1, "#0d1730");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH); ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (board) drawBoard();
  ctx.strokeStyle = "rgba(245,237,230,.22)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(60, 672); ctx.lineTo(600, 672); ctx.stroke();
  ctx.save(); ctx.translate(shift, 0);
  for (const side of [-1, 1]) {                                               // trousers + shoes
    const hx = 320 + side * 25, kx = hx + side * 8, ax = kx + side * 3;
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 46; ctx.beginPath(); ctx.moveTo(hx, 496); ctx.lineTo(kx, 585); ctx.lineTo(ax, 662); ctx.stroke();
    ctx.strokeStyle = o.pants; ctx.lineWidth = 41; ctx.beginPath(); ctx.moveTo(hx, 496); ctx.lineTo(kx, 585); ctx.lineTo(ax, 662); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, 530); ctx.lineTo(ax, 650); ctx.stroke();
    ctx.strokeStyle = o.shoes; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(ax - side * 4, 664); ctx.lineTo(ax + side * 34, 664); ctx.stroke();
  }
  if (o.suit) {                                                               // coat, lapels, shirt, tie, buttons, pocket square
    ctx.fillStyle = o.top; ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(256, 288 + br); ctx.quadraticCurveTo(234, 290 + br, 237, 316);
    ctx.lineTo(243, 534); ctx.lineTo(397, 534); ctx.lineTo(403, 316); ctx.quadraticCurveTo(406, 290 + br, 384, 288 + br); ctx.closePath(); ctx.fill(); ctx.stroke();
    for (const sx of [262, 378]) { ctx.beginPath(); ctx.arc(sx, 304 + br, 26, 0, Math.PI * 2); ctx.fillStyle = o.top; ctx.fill(); }
    poly([[294, 288 + br], [346, 288 + br], [320, 360]], o.under);
    if (o.tie) { poly([[312, 308], [328, 308], [337, 430], [320, 448], [303, 430]], o.tie); poly([[311, 298], [329, 298], [325, 314], [315, 314]], o.tie); }
    poly([[270, 292 + br], [298, 288 + br], [324, 364], [288, 398]], o.top2, "rgba(0,0,0,.35)"); poly([[370, 292 + br], [342, 288 + br], [316, 364], [352, 398]], o.top2, "rgba(0,0,0,.35)");
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(320, 404); ctx.lineTo(320, 534); ctx.stroke();
    ctx.fillStyle = "#0f0f14"; for (const by of [462, 500]) { ctx.beginPath(); ctx.arc(332, by, 5.5, 0, Math.PI * 2); ctx.fill(); }
    poly([[352, 350], [376, 347], [376, 358], [352, 361]], "#ffffff");
  } else {
    poly([[238, 296 + br], [402, 296 + br], [394, 520], [246, 520]], o.top, "rgba(0,0,0,.35)");
    for (const sx of [262, 378]) { ctx.beginPath(); ctx.arc(sx, 306 + br, 26, 0, Math.PI * 2); ctx.fillStyle = o.top; ctx.fill(); }
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(320, 296 + br, 20, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  arm(1, 378, 298 + br, arms.rx, arms.ry, o, read && read.stick); arm(-1, 262, 298 + br, arms.lx, arms.ly, o, null);
  ctx.save(); ctx.translate(320, 262); ctx.rotate((Math.sin(t * 1.1) * 0.03 * (0.4 + g) + (amp - 0.3) * 0.02 + yaw * 0.05) * mv); ctx.translate(-320, -262 + amp * 2 * mv);
  ctx.strokeStyle = SKIN; ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(320, 246); ctx.lineTo(320, 296); ctx.stroke();   // neck
  ctx.save(); ctx.translate(320, 262); ctx.scale(1.14, 1.14); ctx.translate(-320, -262);
  ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.fillStyle = SKIN; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = o.hair; ctx.beginPath(); ctx.ellipse(320, 138, 78, 38, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.strokeStyle = SKIN_D; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(320, 190, 62, 0, Math.PI * 2); ctx.stroke();
  const blink = t % 4.1 < 0.13, yx = yaw * 8; ctx.fillStyle = DARK; ctx.strokeStyle = DARK; ctx.lineWidth = 5;
  for (const ex of [298, 342]) {
    if (blink) { ctx.beginPath(); ctx.moveTo(ex - 7 + yx, 184); ctx.lineTo(ex + 7 + yx, 184); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(ex + yx, 184, 5.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(ex - 10 + yx, 169 - amp * 5); ctx.lineTo(ex + 10 + yx, 167 - amp * 5); ctx.stroke();
  }
  ctx.strokeStyle = SKIN_D; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(320 + yx, 192); ctx.lineTo(316 + yx, 207); ctx.lineTo(324 + yx, 208); ctx.stroke();
  ctx.strokeStyle = DARK; ctx.lineWidth = 5; const rx = 14 + 12 * hi, ry = Math.min(3 + 22 * open * +$("tstrength").value, 28);
  if (open < 0.07) { ctx.beginPath(); ctx.moveTo(302 + yx, 225); ctx.quadraticCurveTo(320 + yx, 237, 338 + yx, 225); ctx.stroke(); }
  else { ctx.beginPath(); ctx.ellipse(320 + yx, 227 + ry * 0.3, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = "#7a1f2b"; ctx.fill(); ctx.stroke(); }
  ctx.lineWidth = 4;
  if (o.glasses) { ctx.strokeStyle = "#222"; for (const ex of [298, 342]) { ctx.beginPath(); ctx.arc(ex + yx, 184, 17, 0, Math.PI * 2); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(315 + yx, 182); ctx.lineTo(325 + yx, 182); ctx.moveTo(281 + yx, 182); ctx.lineTo(262 + yx, 178); ctx.moveTo(359 + yx, 182); ctx.lineTo(378 + yx, 178); ctx.stroke(); }
  if (o.hat === "straw") { ctx.strokeStyle = "#e0b050"; ctx.fillStyle = "#e9c36a"; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(320, 140, 96, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(262, 138); ctx.quadraticCurveTo(320, 52, 378, 138); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  if (o.hat === "cap") { ctx.strokeStyle = "#1f4fa0"; ctx.fillStyle = "#4aa3ff"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(258, 150); ctx.bezierCurveTo(258, 80, 382, 80, 382, 150); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(320, 152, 72, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore(); ctx.restore(); ctx.restore();
}
function idle() { if (!playing) { gs *= 0.95; drawChar(0, 0, performance.now() / 1000); } requestAnimationFrame(idle); }

/* ================= voice -> mouth, reading position, recording ================= */
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
  const a = rms < 0.015 ? 0 : lim((rms / peak - 0.15) * 1.5, 0, 1);
  sm += (a - sm) * (a > sm ? 0.55 : 0.3); hi += (h - hi) * 0.2; gs = gs * 0.94 + sm * 0.06;
  const au = $("au"), p = au.duration ? lim(au.currentTime / au.duration, 0, 0.9999) : 0;
  if (bd.total) { const tg = p * bd.total; let i = 0; while (i < bd.lines.length - 1 && bd.cum[i] <= tg) i++; const pv = i ? bd.cum[i - 1] : 0; rd = { on: true, idx: i, frac: lim((tg - pv) / (bd.cum[i] - pv), 0, 1) }; }
  drawChar(sm, sm, performance.now() / 1000); requestAnimationFrame(loop);
}
function startRec() {
  $("tdl").hidden = true; if (!window.MediaRecorder || !cv.captureStream) return;
  const ms = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]); chunks = [];
  rec = new MediaRecorder(ms, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm" });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => { $("tdl").href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" })); $("tdl").hidden = false; };
  rec.start();
}
async function play() {
  if (!ready) { $("tmsg").textContent = "Generate first: the teacher needs the spoken explanation."; return; }
  $("tmsg").textContent = ""; setupAudio(); await ac.resume(); $("au").currentTime = 0; playing = true; sm = 0; peak = 0.05; startRec(); await $("au").play(); loop();
}
$("au").addEventListener("ended", () => { playing = false; rd.on = false; if (rec && rec.state !== "inactive") rec.stop(); });
$("au").addEventListener("play", () => { if (!playing && ready) play(); });      // pressing play on the audio player also starts the teacher
$("tplay").onclick = () => play();

window.Teacher = {
  prepare(script, url) {
    setBoard(script); rd = { on: false, idx: 0, frac: 0 }; playing = false;
    $("au").src = url; $("au").load(); ready = true; $("tdl").hidden = true; $("tmsg").textContent = "Ready. Press “Play teacher”.";
  },
};
idle();
})();
