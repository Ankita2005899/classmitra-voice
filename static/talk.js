const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d"), off = document.createElement("canvas"), octx = off.getContext("2d");
let img = null, base = { w: 0, h: 0 }, view = { x: 0, y: 0, w: 0, h: 0, sc: 1 }, marks = [], mouth = null;
let ac, an, buf, fbuf, dest, rec, chunks = [], sm = 0, hi = 0.5, peak = 0.05, playing = false;

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

/* ---------- upload + mark the mouth ---------- */
$("file").onchange = () => {
  const f = $("file").files[0]; if (!f) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    const s = Math.min(1, 1600 / im.width, 1600 / im.height);
    base = { w: im.width * s, h: im.height * s };
    marks = []; mouth = null; fullView(); $("stage").hidden = false;
    $("hintm").firstChild.textContent = HINT1;
    draw();
  };
  im.src = URL.createObjectURL(f);
};
cv.addEventListener("click", (e) => {
  if (!img || playing || marks.length >= 2) return;
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
$("zoom").onchange = () => { if (playing) return; faceView(); draw(0, 0, 0, !mouth); };

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
  sm = sm * 0.5 + a * 0.5; hi = hi * 0.8 + h * 0.2;
  draw(sm, sm, performance.now() / 1000, false);
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
  playing = false; draw(0, 0, 0, false);
  if (rec && rec.state !== "inactive") rec.stop();
});
$("replay").onclick = () => play();

$("go").addEventListener("click", async () => {
  const msg = $("msg"), text = $("text").value.trim();
  msg.className = "";
  if (!img) { msg.textContent = "Please upload a picture first."; msg.className = "err"; return; }
  if (!mouth) { msg.textContent = "Please click the two corners of the mouth on the picture."; msg.className = "err"; return; }
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
