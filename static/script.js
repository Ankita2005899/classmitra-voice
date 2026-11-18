let tone = "teacher";
const $ = (id) => document.getElementById(id);

$("tones").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  b.classList.add("active");
  tone = b.dataset.tone;
});

$("go").addEventListener("click", async () => {
  const text = $("text").value.trim();
  const msg = $("msg");
  msg.className = "";
  if (!text) { msg.textContent = "Please enter some text."; msg.className = "err"; return; }

  $("go").disabled = true;
  $("result").hidden = true;
  msg.textContent = "Generating… this takes a few seconds.";

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tone, language: $("lang").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    $("script").textContent = data.script;
    $("player").src = data.audio_url;
    $("result").hidden = false;
    $("player").play().catch(() => {});
    msg.textContent = "";
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "err";
  } finally {
    $("go").disabled = false;
  }
});
