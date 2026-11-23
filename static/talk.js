const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d"), off = document.createElement("canvas"), octx = off.getContext("2d");
let img = null, marks = [], mouth = null, ac, an, buf, dest, rec, chunks = [], sm = 0, playing = false;

$("text").value = sessionStorage.getItem("cm_text") || "";
$("lang").value = sessionStorage.getItem("cm_lang") || "english";

/* ---------- drawing ---------- */
function mouthOpen(open) {
  const { x, y, w } = mouth, k = img.width / cv.width;
  const mh = w * 0.32 * open * +$("strength").value, jw = w * 1.5, jh = w * 0.62, top = y - w * 0.02;
  ctx.save(); ctx.fillStyle = "#2a0d12";
  ctx.beginPath(); ctx.ellipse(x, y + mh * 0.4, w * 0.38, Math.max(1, mh * 0.6), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.85)";           // hint of teeth
  ctx.beginPath(); ctx.ellipse(x, y + mh * 0.08, w * 0.3, Math.max(0.5, mh * 0.12), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  off.width = jw; off.height = jh;                   // soft-edged patch of the lower lip / chin, moved down
  octx.globalCompositeOperation = "source-over";
  octx.drawImage(img, (x - jw / 2) * k, top * k, jw * k, jh * k, 0, 0, jw, jh);
  octx.globalCompositeOperation = "destination-in";
  octx.save(); octx.translate(jw / 2, jh / 2); octx.scale(1, jh / jw);
  const g = octx.createRadialGradient(0, 0, jw * 0.3, 0, 0, jw * 0.5);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  octx.fillStyle = g; octx.fillRect(-jw / 2, -jw / 2, jw, jw); octx.restore();
  ctx.drawImage(off, x - jw / 2, top + mh * 0.75);
}

function draw(open = 0, amp = 0, t = 0, showMarks = true) {
  if (!img) return;
  const mv = +$("move").value;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.translate(cv.width / 2, cv.height);
  ctx.rotate(Math.sin(t * 1.4) * 0.012 * mv + (amp - 0.3) * 0.006 * mv);
  ctx.translate(-cv.width / 2, -cv.height + amp * cv.height * 0.007 * mv);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  if (mouth && open > 0.03) mouthOpen(open);
  ctx.restore();
  if (showMarks) {
    ctx.fillStyle = "#ff7a1a";
    marks.forEach((m) => { ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fill(); });
  }
}

/* ---------- upload + mark the mouth ---------- */
$("file").onchange = () => {
  const f = $("file").files[0]; if (!f) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    const s = Math.min(1, 720 / im.width, 720 / im.height);
    cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
    marks = []; mouth = null; $("stage").hidden = false;
    $("hintm").firstChild.textContent = "2. Click the LEFT corner of the mouth, then the RIGHT corner. ";
    draw();
  };
  im.src = URL.createObjectURL(f);
};
cv.addEventListener("click", (e) => {
  if (!img || playing || marks.length >= 2) return;
  const r = cv.getBoundingClientRect();
  marks.push({ x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height });
  if (marks.length === 2) {
    const [a, b] = marks;
    mouth = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.max(12, Math.abs(b.x - a.x)) };
    $("hintm").firstChild.textContent = "Mouth marked. Now add your text and click Make it talk. ";
  }
  draw();
});
$("remark").onclick = () => { if (playing) return; marks = []; mouth = null; $("hintm").firstChild.textContent = "2. Click the LEFT corner of the mouth, then the RIGHT corner. "; draw(); };

/* ---------- audio level -> animation ---------- */
function setupAudio() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaElementSource($("au"));
  an = ac.createAnalyser(); an.fftSize = 1024; buf = new Uint8Array(an.fftSize);
  dest = ac.createMediaStreamDestination();
  src.connect(an); an.connect(ac.destination); an.connect(dest);
}
function level() {
  an.getByteTimeDomainData(buf);
  let s = 0; for (const v of buf) { const d = (v - 128) / 128; s += d * d; }
  return Math.min(1, Math.max(0, (Math.sqrt(s / buf.length) - 0.02) * 6));
}
function loop() {
  if (!playing) return;
  sm = sm * 0.55 + level() * 0.45;
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
  au.currentTime = 0; playing = true; sm = 0; startRec();
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
