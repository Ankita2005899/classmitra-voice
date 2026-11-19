const $ = (id) => document.getElementById(id);
let theme = "sunset";

$("text").value = sessionStorage.getItem("cm_text") || "";
$("lang").value = sessionStorage.getItem("cm_lang") || "english";

const ro = new ResizeObserver((entries) => {
  entries.forEach((e) => e.target.style.setProperty("--u", e.target.clientWidth / 100 + "px"));
});

$("themes").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  document.querySelectorAll("#themes .chip").forEach((c) => c.classList.remove("active"));
  b.classList.add("active");
  theme = b.dataset.theme;
  document.querySelectorAll(".slide").forEach((s) => {
    s.classList.remove(...THEMES);
    s.classList.add(theme);
  });
});

const THEMES = ["sunset", "ocean", "forest", "royal", "night"];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
function splitEmoji(t) {
  const m = t.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*([\s\S]*)$/u);
  return m ? [m[1], m[2]] : ["•", t];
}

function makeSlide(kind, build, n, total) {
  const s = el("div", "slide " + theme + (kind === "cover" ? " cover" : ""));
  const inner = el("div", "inner");
  build(inner);
  s.append(inner, el("div", "foot", "ClassMitra  " + n + "/" + total));
  return s;
}

function art(emoji, img) {
  const a = el("div", "art");
  if (img) a.style.backgroundImage = "url(" + img + ")";
  else a.append(el("div", "c1"), el("div", "c2"), el("div", "big", emoji));
  return a;
}

function head(inner, kicker, title) {
  inner.append(el("div", "kicker", kicker), el("h2", "", title));
}

function cardsSlide(kicker, heading, items, topic) {
  return (inner) => {
    head(inner, topic, heading);
    const body = el("div", "body");
    const box = el("div", "cards" + (items.length === 1 ? " one" : ""));
    items.forEach((t) => {
      const [e, rest] = splitEmoji(t);
      const c = el("div", "card");
      c.append(el("div", "ico", e), el("div", "t", rest));
      box.appendChild(c);
    });
    body.appendChild(box);
    inner.appendChild(body);
  };
}

function panel(cls, title, items) {
  const p = el("div", "panel " + cls);
  p.appendChild(el("h3", "", title));
  items.forEach((t) => {
    const [e, rest] = splitEmoji(t);
    const r = el("div", "row");
    r.append(el("span", "e", e), el("span", "", rest));
    p.appendChild(r);
  });
  return p;
}

function render(d, imgs) {
  const topic = d.title || "Your topic";
  const parts = [];
  const mainEmoji = d.key_points.length ? splitEmoji(d.key_points[0])[0] : "📘";

  parts.push(["cover", (inner) => {
    const txt = el("div", "txt");
    txt.append(el("span", "badge", "CLASSMITRA"), el("h1", "", topic));
    if (d.important_line) txt.appendChild(el("p", "", d.important_line));
    txt.appendChild(el("div", "rule"));
    inner.append(txt, art(mainEmoji === "•" ? "📘" : mainEmoji, imgs.cover));
  }]);
  if (d.key_points.length) parts.push(["x", cardsSlide("", "Key points", d.key_points, topic)]);
  if (d.advantages.length || d.disadvantages.length) {
    const both = d.advantages.length && d.disadvantages.length;
    parts.push(["x", (inner) => {
      head(inner, topic, both ? "Advantages & disadvantages" : d.advantages.length ? "Advantages" : "Disadvantages");
      const body = el("div", "body");
      const box = el("div", "split" + (both ? "" : " single"));
      if (d.advantages.length) box.appendChild(panel("pro", "👍 Advantages", d.advantages));
      if (d.disadvantages.length) box.appendChild(panel("con", "⚠️ Limitations", d.disadvantages));
      body.appendChild(box);
      inner.appendChild(body);
    }]);
  }
  if (d.applications.length) parts.push(["x", cardsSlide("", "Applications", d.applications, topic)]);
  if (d.example) parts.push(["x", (inner) => {
    head(inner, topic, "Example");
    const wrap = el("div", "exwrap");
    const [e, rest] = splitEmoji(d.example);
    wrap.append(art(e === "•" ? "💡" : e, imgs.example), el("div", "quote", rest));
    inner.appendChild(wrap);
  }]);

  const box = $("slides");
  box.innerHTML = "";
  parts.forEach(([kind, b], i) => {
    const sl = makeSlide(kind, b, i + 1, parts.length);
    box.appendChild(sl);
    ro.observe(sl);
  });
  $("dl").hidden = false;
}

async function getImage(q) {
  if (!q) return null;
  try {
    const r = await fetch("/image?q=" + encodeURIComponent(q));
    return (await r.json()).url || null;
  } catch (e) {
    return null;
  }
}

$("go").addEventListener("click", async () => {
  const text = $("text").value.trim();
  const msg = $("msg");
  msg.className = "";
  if (!text) { msg.textContent = "Please enter some text."; msg.className = "err"; return; }
  $("go").disabled = true;
  $("dl").hidden = true;
  msg.textContent = "Generating slides… this takes a few seconds.";
  try {
    const res = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: $("lang").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    msg.textContent = "Adding pictures…";
    const [cover, example] = await Promise.all([getImage(data.image_query), getImage(data.example_image_query)]);
    render(data, { cover, example });
    msg.textContent = "";
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "err";
  } finally {
    $("go").disabled = false;
  }
});

$("dl").addEventListener("click", async () => {
  const btn = $("dl");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing images…";
  try {
    const zip = new JSZip();
    const folder = zip.folder("classmitra-slides");
    const slides = [...document.querySelectorAll("#slides .slide")];
    for (let i = 0; i < slides.length; i++) {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:720px";
      const c = slides[i].cloneNode(true);
      c.style.width = "1280px";
      c.style.height = "720px";
      c.style.setProperty("--u", "12.8px");
      host.appendChild(c);
      document.body.appendChild(host);
      const canvas = await html2canvas(c, { scale: 1, useCORS: true, backgroundColor: null });
      host.remove();
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      folder.file("slide-" + (i + 1) + ".png", blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    a.download = "classmitra-slides.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    $("msg").textContent = "Download failed. Check your internet and try again.";
    $("msg").className = "err";
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});
