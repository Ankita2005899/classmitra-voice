(() => {
const $ = (id) => document.getElementById(id);
const cv = $("tcv"), ctx = cv.getContext("2d"), CW = 960, CH = 540, lim = (v, a, b) => Math.max(a, Math.min(b, v));
const BX = 360, BY = 40, BW = 580, BH = 326, SC = BW / 1280;            // the screen on the right, and its scale from a 1280x720 slide
const FS = 0.8, FX0 = 190 - 320 * FS, FY0 = 528 - 672 * FS;            // the teacher stands at the left (figure drawn in 640x720 units)
const UIF = "'Segoe UI','Nirmala UI',sans-serif", SKIN = "#f0c9a0", SKIN_D = "#b9835c", DARK = "#2b1d14";
const tau = new Audio();
let ac, an, buf, fbuf, dest, rec, chunks = [], sm = 0, gs = 0, hi = 0.5, peak = 0.05, audioOn = false, runId = 0, prog = () => 0;
const L = { state: "idle", lesson: null, i: 0, n: 0, parts: [], cum: [], total: 0, part: 0, frac: 0, canv: [], wps: [], score: 0, q: null, wrong: [], hover: -1, fb: null, revealed: false, opt: [], pick: null };

/* ================= helpers ================= */
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
function wrap(c, text, maxW) {
  const words = String(text).split(" "), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur); return lines;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= slides drawn onto the screen (same layout as the editor) ================= */
const imgs = new Map();
const loadImg = (src) => !src ? Promise.resolve(null) : (imgs.has(src) ? imgs.get(src) : (imgs.set(src, new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; })), imgs.get(src)));
async function renderSlide(sl, pal) {
  const W = 1280, H = 720, u = W / 100, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  if (sl.bg) x.fillStyle = sl.bg; else { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]); x.fillStyle = g; }
  x.fillRect(0, 0, W, H); x.fillStyle = pal[4]; x.fillRect(0, 0, u * 1.1, H);
  const wps = [];                                                         // pointer targets, in the same order as the lesson's points
  for (const e of sl.els) {
    const ex = (e.x * W) / 100, ey = (e.y * H) / 100, ew = (e.w * W) / 100, eh = (e.h * H) / 100;
    if (e.type === "text") {
      const fs = e.size * u, al = e.align === "center" ? "center" : e.align === "right" ? "right" : "left";
      x.font = `${e.bold ? 800 : 500} ${fs}px ${UIF}`; x.fillStyle = e.color; x.textBaseline = "top"; x.textAlign = al;
      const ax = al === "center" ? ex + ew / 2 : al === "right" ? ex + ew : ex, lh = fs * 1.45, boxes = []; let cy = ey;
      for (const para of String(e.text).split("\n")) {
        const lines = wrap(x, para, ew), top = cy; let mw = 0;
        for (const ln of lines) { x.fillText(ln, ax, cy); mw = Math.max(mw, x.measureText(ln).width); cy += lh; }
        if (para.trim()) boxes.push({ x: al === "center" ? ex + (ew - mw) / 2 : al === "right" ? ex + ew - mw : ex, y: top, w: mw, h: lines.length * lh });
      }
      if (e.role === "title" || e.role === "head") {
        if (boxes.length) { const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y)), x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h)); wps.push({ kind: "title", x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); }
      } else boxes.forEach((b) => wps.push(Object.assign({ kind: "point" }, b)));
    } else if (e.type === "img") {
      const im = await loadImg(e.src);
      x.save(); rr(x, ex, ey, ew, eh, u * 1.2); x.clip();
      if (im) { const s = e.fit === "contain" ? Math.min(ew / im.width, eh / im.height) : Math.max(ew / im.width, eh / im.height); x.drawImage(im, ex + (ew - im.width * s) / 2, ey + (eh - im.height * s) / 2, im.width * s, im.height * s); }
      else { x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(ex, ey, ew, eh); }
      x.restore(); x.strokeStyle = pal[5]; x.lineWidth = u * 0.5; rr(x, ex, ey, ew, eh, u * 1.2); x.stroke();
      wps.push({ kind: "image", x: ex, y: ey, w: ew, h: eh });
    }
  }
  return { canvas: c, wps };
}
async function buildSlides(data) {
  const cs = [], ws = [];
  for (const sl of data.slides) { const r = await renderSlide(sl, data.pal); cs.push(r.canvas); ws.push(r.wps); }
  L.canv = cs; L.wps = ws; L.n = cs.length;
}
async function refresh() {                                                 // keeps the screen showing the latest slides while no lesson is running
  if (L.state !== "idle" || !window.Studio) return;
  try { await buildSlides(window.Studio.lessonData()); } catch (_) {}
}

/* ================= arms: never folded, elbow always well outside the body ================= */
const ARM1 = 105, ARM2 = 100, REST_R = [466, 477], REST_L = [174, 477];
const GEST = [   // relaxed hand positions (x, y, hold seconds) while the teacher talks without pointing
  { R: [[520, 372, 1.5]] },
  { R: [[505, 385, 0.9], [535, 355, 0.9]], L: [[135, 385, 0.9], [105, 355, 0.9]] },
  { R: [[548, 335, 1.3]], L: [[92, 335, 1.3]] },
  { R: [[515, 360, 0.6], [525, 335, 0.6], [515, 360, 0.6]] },
];
const arms = { rx: REST_R[0], ry: REST_R[1], lx: REST_L[0], ly: REST_L[1] }, seq = { g: null, wi: 0, until: 0, gap: 0 };
let lastT = 0, lastG = -1, yaw = 0;
function updateArms(t, speaking, mv, read) {
  const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
  let tr = REST_R, tl = REST_L;
  if (read) { tr = [read.x, read.y]; seq.g = { look: !!read.look, pseudo: 1 }; }
  else if (speaking) {
    if (seq.g && seq.g.pseudo) seq.g = null;
    if (!seq.g) {
      if (t >= seq.gap) { const pool = GEST.map((_, i) => i).filter((i) => i !== lastG); lastG = pool[Math.floor(Math.random() * pool.length)]; seq.g = GEST[lastG]; seq.wi = 0; seq.until = t + seq.g.R[0][2]; }
    } else if (t > seq.until) {
      seq.wi++;
      if (seq.wi >= seq.g.R.length) { seq.g = null; seq.gap = t + 0.5 + Math.random() * 0.8; } else seq.until = t + seq.g.R[seq.wi][2];
    }
    if (seq.g) { tr = seq.g.R[seq.wi]; if (seq.g.L) tl = seq.g.L[seq.wi]; }
  } else seq.g = null;
  const mix = (a, r) => [r[0] + (a[0] - r[0]) * mv, r[1] + (a[1] - r[1]) * mv], R = mix(tr, REST_R), Lh = mix(tl, REST_L), k = 1 - Math.exp(-dt * (read ? 6 : 4));
  arms.rx += (R[0] - arms.rx) * k; arms.ry += (R[1] - arms.ry) * k; arms.lx += (Lh[0] - arms.lx) * k; arms.ly += (Lh[1] - arms.ly) * k;
  yaw += ((seq.g && seq.g.look ? 1 : 0) - yaw) * (1 - Math.exp(-dt * 3));      // head turns to the screen, then back to the class
}
function arm(side, sx, sy, tx, ty, o, device) {
  const dx = side * (tx - sx), dy = ty - sy;                                   // mirrored: "outward" is +x for both arms
  const bend = (d) => Math.acos(lim((ARM1 * ARM1 + d * d - ARM2 * ARM2) / (2 * ARM1 * d), -1, 1));
  let a = lim(Math.atan2(dy, dx), -0.2, 1.5), d = lim(Math.hypot(dx, dy), 150, 200);
  for (let n = 0; n < 80 && Math.cos(a + bend(d)) * ARM1 < 20; n++) { if (d < 199) d += 3; else a -= 0.03; }   // the elbow always stays 20+ px OUT from the shoulder: it never tucks in
  const ea = a + bend(d);                                                      // and always hangs BELOW the line shoulder -> hand, like a real arm
  const ex = sx + side * Math.cos(ea) * ARM1, ey = sy + Math.sin(ea) * ARM1, wx = sx + side * Math.cos(a) * d, wy = sy + Math.sin(a) * d;
  const fl = Math.hypot(wx - ex, wy - ey) || 1, ux = (wx - ex) / fl, uy = (wy - ey) / fl;
  ctx.lineWidth = 44; ctx.strokeStyle = o.top2 || "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  ctx.lineWidth = 38; ctx.strokeStyle = o.top; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
  if (o.cuff) { ctx.strokeStyle = o.cuff; ctx.lineWidth = 31; ctx.beginPath(); ctx.moveTo(wx - ux * 12, wy - uy * 12); ctx.lineTo(wx, wy); ctx.stroke(); }
  const hx = wx + ux * 14, hy = wy + uy * 14;
  if (device) { ctx.strokeStyle = "#1d1d22"; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(hx - ux * 8, hy - uy * 8); ctx.lineTo(hx + ux * 32, hy + uy * 32); ctx.stroke(); }   // laser pointer in the hand
  ctx.fillStyle = SKIN; ctx.strokeStyle = SKIN_D; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  return { x: hx + ux * 32, y: hy + uy * 32 };                                 // where the laser comes out
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

function wpIndex() {                                                            // which pointer target belongs to the sentence being spoken
  const W = (L.wps[L.i] || []).length, P = L.parts.length;
  return !W ? -1 : P === W ? L.part : Math.round((L.part * (W - 1)) / Math.max(P - 1, 1));
}
function drawFigure(open, amp, t) {
  const mv = +$("tmove").value, o = OUTFIT[$("tone").value] || OUT_DEFAULT, g = lim(gs * 2.2, 0, 1), br = Math.sin(t * 1.6) * 2;
  const sway = Math.sin(t * 0.8) * 2 * (0.3 + g) * mv, ox = FX0 + sway * FS;
  let read = null, target = null, board = null;                                 // teaching: the arm aims at the target, a laser dot touches the text
  if (L.state === "teaching") {
    const wi = wpIndex(), w = wi >= 0 ? L.wps[L.i][wi] : null;
    if (w) {
      board = w;
      const tx = BX + (w.x + w.w * (w.kind === "image" ? 0.5 : L.frac)) * SC, ty = BY + (w.y + w.h * (w.kind === "image" ? 0.5 : 0.7)) * SC;
      const lx = (tx - ox) / FS, ly = (ty - FY0) / FS, dx = lx - 378, dy = ly - 298, dl = Math.hypot(dx, dy) || 1;
      read = { x: 378 + (dx / dl) * 190, y: 298 + (dy / dl) * 190, look: 1 }; if (w.kind !== "image") target = { x: tx, y: ty };
    }
  }
  updateArms(t, audioOn && !read, mv, read);
  ctx.save(); ctx.translate(ox, FY0); ctx.scale(FS, FS); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const side of [-1, 1]) {                                                 // trousers + shoes
    const hx = 320 + side * 25, kx = hx + side * 8, ax = kx + side * 3;
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 46; ctx.beginPath(); ctx.moveTo(hx, 496); ctx.lineTo(kx, 585); ctx.lineTo(ax, 662); ctx.stroke();
    ctx.strokeStyle = o.pants; ctx.lineWidth = 41; ctx.beginPath(); ctx.moveTo(hx, 496); ctx.lineTo(kx, 585); ctx.lineTo(ax, 662); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, 530); ctx.lineTo(ax, 650); ctx.stroke();
    ctx.strokeStyle = o.shoes; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(ax - side * 4, 664); ctx.lineTo(ax + side * 34, 664); ctx.stroke();
  }
  if (o.suit) {
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
  const em = arm(1, 378, 298 + br, arms.rx, arms.ry, o, !!target); arm(-1, 262, 298 + br, arms.lx, arms.ly, o, false);
  ctx.save(); ctx.translate(320, 262); ctx.rotate((Math.sin(t * 1.1) * 0.03 * (0.4 + g) + (amp - 0.3) * 0.02 + yaw * 0.05) * mv); ctx.translate(-320, -262 + amp * 2 * mv);
  ctx.strokeStyle = SKIN; ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(320, 246); ctx.lineTo(320, 296); ctx.stroke();
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
  if (target) {                                                                 // laser beam + red dot on the text
    const ex = ox + em.x * FS, ey = FY0 + em.y * FS;
    ctx.save(); ctx.strokeStyle = "rgba(255,50,50,.55)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(target.x, target.y); ctx.stroke();
    const gr = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, 13); gr.addColorStop(0, "rgba(255,60,60,1)"); gr.addColorStop(1, "rgba(255,60,60,0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(target.x, target.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  return board;
}

/* ================= the screen: slide, question card, results ================= */
function drawQuiz() {
  const q = L.q; ctx.fillStyle = "rgba(8,14,34,.88)"; ctx.fillRect(BX, BY, BW, BH);
  const cx = BX + 14, cy = BY + 10, cw = BW - 28; ctx.fillStyle = "#ffffff"; rr(ctx, cx, cy, cw, BH - 20, 12); ctx.fill();
  ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "#6a7388"; ctx.font = `600 13px ${UIF}`; ctx.fillText(`QUESTION ${L.i + 1} OF ${L.n}`, cx + 14, cy + 10);
  ctx.fillStyle = "#14213d"; ctx.font = `700 18px ${UIF}`; const ql = wrap(ctx, q.question, cw - 28).slice(0, 3); ql.forEach((ln, k) => ctx.fillText(ln, cx + 14, cy + 30 + k * 24));
  const oy = cy + 30 + ql.length * 24 + 8, oh = 36, gap = 7; L.opt = [];
  q.options.forEach((txt, k) => {
    const y = oy + k * (oh + gap), wrong = L.wrong.includes(k), right = L.revealed && k === q.answer, hov = L.state === "answering" && L.hover === k && !wrong;
    ctx.fillStyle = right ? "#d4f3dc" : wrong ? "#fbdcdc" : hov ? "#e6eeff" : "#f3f5fa"; rr(ctx, cx + 14, y, cw - 28, oh, 9); ctx.fill();
    ctx.strokeStyle = right ? "#2e9d4f" : wrong ? "#d34c4c" : hov ? "#4a76e8" : "#d5dbe8"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = right ? "#2e9d4f" : wrong ? "#d34c4c" : "#2b3a67"; ctx.beginPath(); ctx.arc(cx + 36, y + oh / 2, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `700 13px ${UIF}`; ctx.textAlign = "center"; ctx.fillText("ABCD"[k], cx + 36, y + oh / 2 - 8); ctx.textAlign = "left";
    ctx.fillStyle = "#14213d"; ctx.font = `500 16px ${UIF}`; let tt = txt; while (ctx.measureText(tt).width > cw - 90 && tt.length > 4) tt = tt.slice(0, -2); ctx.fillText(tt === txt ? tt : tt + "…", cx + 56, y + oh / 2 - 9);
    L.opt[k] = { x: cx + 14, y, w: cw - 28, h: oh };
  });
}
function drawResult() {
  ctx.fillStyle = "#f7f3ea"; ctx.fillRect(BX, BY, BW, BH); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#2b3a67"; ctx.font = `800 30px ${UIF}`; ctx.fillText("Lesson complete! 🎉", BX + BW / 2, BY + BH / 2 - 40);
  ctx.fillStyle = "#14213d"; ctx.font = `600 19px ${UIF}`; ctx.fillText(`You answered ${L.score} of ${L.n} questions correctly`, BX + BW / 2, BY + BH / 2 + 2); ctx.fillText("on the first try.", BX + BW / 2, BY + BH / 2 + 28);
  ctx.fillStyle = "#6a7388"; ctx.font = `500 16px ${UIF}`; ctx.fillText("Press “Restart lesson” to learn it again.", BX + BW / 2, BY + BH / 2 + 66); ctx.textAlign = "left";
}
function caption(text, big) {
  const x = BX, y = BY + BH + 16, w = BW, h = CH - y - 12; ctx.fillStyle = "rgba(255,255,255,.07)"; rr(ctx, x, y, w, h, 10); ctx.fill();
  ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.font = `${big ? 600 : 500} 17px ${UIF}`; ctx.fillStyle = "#e8edf8";
  wrap(ctx, text, w - 28).slice(0, 5).forEach((ln, k) => ctx.fillText(ln, x + 14, y + 12 + k * 24));
  if (L.n && L.state !== "idle") { ctx.font = `600 12px ${UIF}`; ctx.fillStyle = "#c8a24a"; ctx.textAlign = "right"; ctx.fillText(`Slide ${Math.min(L.i + 1, L.n)} of ${L.n}`, x + w - 12, y + h - 22); ctx.textAlign = "left"; }
}
function drawScene(open, amp, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#1b2a49"); bg.addColorStop(1, "#0d1730"); ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = "rgba(245,237,230,.2)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(30, 528); ctx.lineTo(930, 528); ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.rect(BX, BY, BW, BH); ctx.clip();            // the screen
  const sl = L.canv[Math.min(L.i, L.canv.length - 1)];
  if (sl) ctx.drawImage(sl, BX, BY, BW, BH); else { ctx.fillStyle = "#f7f3ea"; ctx.fillRect(BX, BY, BW, BH); }
  const wi = L.state === "teaching" ? wpIndex() : -1, w = wi >= 0 && L.wps[L.i] ? L.wps[L.i][wi] : null;
  if (w && w.kind !== "image") { const hx = BX + (w.x - 10) * SC, hy = BY + (w.y - 5) * SC, hw = (w.w + 20) * SC, hh = (w.h + 10) * SC; ctx.fillStyle = "rgba(255,225,110,.16)"; rr(ctx, hx, hy, hw, hh, 5); ctx.fill(); ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 2; ctx.stroke(); }
  if (["asking", "answering", "feedback"].includes(L.state) && L.q) drawQuiz();
  if (L.state === "done") drawResult();
  ctx.restore(); ctx.strokeStyle = "#c8a24a"; ctx.lineWidth = 6; ctx.strokeRect(BX - 3, BY - 3, BW + 6, BH + 6);
  drawFigure(open, amp, t);
  let cap = "Press “Start lesson”. The teacher will teach your slides, one by one, and ask a question after each slide.";
  if (L.state === "loading") cap = "Preparing the lesson…";
  else if (L.state === "teaching") cap = L.parts[L.part] || "";
  else if (L.state === "asking") cap = "Listen to the question…";
  else if (L.state === "answering") cap = (L.fb ? L.fb.text : "Click the correct answer to go on to the next slide.");
  else if (L.state === "feedback") cap = L.fb ? L.fb.text : "";
  else if (L.state === "done") cap = "Well done! You finished all the slides.";
  caption(cap, L.state === "teaching");
}

/* ================= voice -> mouth, lesson flow, recording ================= */
function setupAudio() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaElementSource(tau);
  an = ac.createAnalyser(); an.fftSize = 1024; buf = new Uint8Array(an.fftSize); fbuf = new Uint8Array(an.frequencyBinCount);
  dest = ac.createMediaStreamDestination(); src.connect(an); an.connect(ac.destination); an.connect(dest);
}
function analyse() {
  an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; }
  an.getByteFrequencyData(fbuf); let num = 0, den = 0; for (let i = 2; i < 100; i++) { num += i * fbuf[i]; den += fbuf[i]; }
  return { rms: Math.sqrt(s / buf.length), h: den ? lim((num / den - 8) / 22, 0, 1) : 0.5 };
}
function updateReading() {
  if (!L.total) return; const tg = prog() * L.total; let k = 0; while (k < L.cum.length - 1 && L.cum[k] <= tg) k++;
  const pv = k ? L.cum[k - 1] : 0; L.part = k; L.frac = lim((tg - pv) / ((L.cum[k] - pv) || 1), 0, 1);
}
function frame() {
  const t = performance.now() / 1000; let open = 0;
  if (audioOn && an) { const { rms, h } = analyse(); peak = Math.max(peak * 0.996, rms, 0.04); const a = rms < 0.015 ? 0 : lim((rms / peak - 0.15) * 1.5, 0, 1); sm += (a - sm) * (a > sm ? 0.55 : 0.3); hi += (h - hi) * 0.2; gs = gs * 0.94 + sm * 0.06; open = sm; }
  else { sm *= 0.7; gs *= 0.95; }
  if (L.state === "teaching") updateReading();
  drawScene(open, open, t); requestAnimationFrame(frame);
}
function speak(url, text) {                                                    // plays the voice (or, if the voice failed, a silent timer so the lesson still goes on)
  return new Promise(async (res) => {
    if (url) {
      try {
        setupAudio(); await ac.resume(); tau.src = url; prog = () => (tau.duration ? lim(tau.currentTime / tau.duration, 0, 0.9999) : 0);
        tau.onended = () => { audioOn = false; res(); }; tau.onerror = () => { audioOn = false; res(); }; audioOn = true; sm = 0; peak = 0.05; await tau.play(); return;
      } catch (_) { audioOn = false; }
    }
    const dur = Math.max(2500, text.length * 65), t0 = performance.now(); prog = () => lim((performance.now() - t0) / dur, 0, 0.9999); setTimeout(res, dur);
  });
}
const ttsCache = new Map();
function tts(text) {
  text = String(text || "").trim(); if (!text) return Promise.resolve(null);
  const key = $("tone").value + "|" + $("lang").value + "|" + text;
  if (!ttsCache.has(key)) ttsCache.set(key, fetch("/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, tone: $("tone").value, language: $("lang").value }) })
    .then((r) => r.json()).then((d) => d.audio_url || null).catch(() => null));
  return ttsCache.get(key);
}
function startRec() {
  $("tdl").hidden = true; if (!window.MediaRecorder || !cv.captureStream || !dest) return;
  const ms = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]); chunks = [];
  rec = new MediaRecorder(ms, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm" });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => { $("tdl").href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" })); $("tdl").hidden = false; };
  rec.start();
}
async function teachSlide(i, my) {
  L.i = i; L.state = "teaching"; L.q = null; L.fb = null; L.wrong = []; L.revealed = false;
  const s = L.lesson.slides[i] || { parts: [] }; L.parts = s.parts || []; let t = 0; L.cum = L.parts.map((p) => (t += p.length + 1)); L.total = t; L.part = 0; L.frac = 0;
  const narr = L.parts.join(" "), nextS = L.lesson.slides[i + 1], urlP = tts(narr);        // this slide's voice first, then get the next voices ready
  tts(s.question); if (nextS) tts((nextS.parts || []).join(" "));
  const url = await urlP; if (my !== runId) return false;
  await speak(url, narr); return my === runId;
}
async function askQuestion(i, my) {
  const s = L.lesson.slides[i]; L.q = { question: s.question, options: s.options, answer: s.answer, hint: s.hint }; L.state = "asking"; L.fb = null; L.wrong = []; L.revealed = false;
  const url = await tts(s.question); if (my !== runId) return false; await speak(url, s.question); if (my !== runId) return false;
  L.state = "answering"; let tries = 0;
  for (;;) {
    const k = await new Promise((r) => (L.pick = r)); if (my !== runId) return false;
    if (k === L.q.answer) { if (!tries) L.score++; L.revealed = true; L.state = "feedback"; L.fb = { ok: true, text: tries ? "Correct! Let us go on." : "Correct! Well done! 🎉" }; await sleep(1700); return my === runId; }
    tries++; L.wrong.push(k);
    if (tries >= 3) { L.revealed = true; L.fb = { ok: false, text: "The correct answer is highlighted in green. Click it to continue." }; }
    else L.fb = { ok: false, text: tries >= 2 && L.q.hint ? "Not quite. Hint: " + L.q.hint : "Not quite, try again." };
  }
}
async function start() {
  const my = ++runId; tau.pause(); audioOn = false; L.pick = null; const msg = $("tmsg"); msg.className = "";
  if (!window.Studio) return; const data = window.Studio.lessonData();
  if (!data.slides.length) { msg.textContent = "Generate the slides first."; msg.className = "err"; return; }
  $("tplay").disabled = true; L.state = "loading"; msg.textContent = "Preparing the lesson… (about 15 seconds)";
  try {
    await buildSlides(data); L.lesson = await window.Studio.fetchLesson(); if (my !== runId) return;
    L.score = 0; L.n = data.slides.length; setupAudio(); await ac.resume(); startRec(); msg.textContent = ""; $("tplay").textContent = "↺ Restart lesson";
    for (let i = 0; i < L.n; i++) { if (!(await teachSlide(i, my))) return; if (!(await askQuestion(i, my))) return; }
    L.state = "done"; if (rec && rec.state !== "inactive") rec.stop();
  } catch (e) { L.state = "idle"; msg.textContent = e.message || "Could not start the lesson."; msg.className = "err"; }
  finally { if (my === runId) $("tplay").disabled = false; }
}
const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) * CW) / r.width, y: ((e.clientY - r.top) * CH) / r.height }; };
const hit = (p) => L.opt.findIndex((r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
cv.addEventListener("mousemove", (e) => { L.hover = L.state === "answering" ? hit(pt(e)) : -1; cv.style.cursor = L.hover >= 0 ? "pointer" : "default"; });
cv.addEventListener("click", (e) => { if (L.state !== "answering") return; const k = hit(pt(e)); if (k >= 0 && !L.wrong.includes(k) && L.pick) { const f = L.pick; L.pick = null; f(k); } });
document.addEventListener("keydown", (e) => { if (L.state === "answering" && "1234".includes(e.key) && L.pick && !e.target.matches("input,textarea,select")) { const k = +e.key - 1; if (!L.wrong.includes(k) && k < L.q.options.length) { const f = L.pick; L.pick = null; f(k); } } });
$("tplay").onclick = () => start();

window.Teacher = { refresh };
requestAnimationFrame(frame);
})();
