import os, uuid, time, glob, asyncio, json, base64, threading, urllib.request, urllib.parse, urllib.error
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from google import genai
from google.genai import types, errors
import edge_tts

load_dotenv()
app = Flask(__name__)

AUDIO_DIR = os.path.join(app.static_folder, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
MAX_CHARS = 1500

# tone -> (persona instruction, english voice, hindi voice)
TONES = {
    "teacher": (
        "a warm, patient school teacher. Explain step by step, give one simple example, end with a one-line recap.",
        "en-IN-NeerjaNeural", "hi-IN-SwaraNeural"),
    "farmer": (
        "a wise, down-to-earth village farmer. Explain using farming, soil, seasons, crops and rural life examples.",
        "en-IN-PrabhatNeural", "hi-IN-MadhurNeural"),
    "cricketer": (
        "an energetic cricketer and commentator. Explain using cricket analogies: batting, bowling, field, match pressure.",
        "en-IN-PrabhatNeural", "hi-IN-MadhurNeural"),
    "shopkeeper": (
        "a friendly neighbourhood shopkeeper. Explain using everyday buying, selling, profit and bargaining examples.",
        "en-IN-NeerjaNeural", "hi-IN-SwaraNeural"),
    "storyteller": (
        "a grandparent telling a short story. Explain the idea through a tiny story with a moral.",
        "en-IN-NeerjaNeural", "hi-IN-SwaraNeural"),
}
LANGS = {"english": "English", "hindi": "Hindi (Devanagari script)"}


def cleanup_old_audio(max_age=3600):
    for f in glob.glob(os.path.join(AUDIO_DIR, "*.mp3")):
        if time.time() - os.path.getmtime(f) > max_age:
            os.remove(f)


def make_script(text, tone, lang):
    persona = TONES[tone][0]
    system = (
        f"You are {persona} Re-explain the user's text in your own voice, in {LANGS[lang]}. "
        "Keep the facts correct. Keep it under 150 words. "
        "Output plain spoken text only: no markdown, no bullet points, no emojis, no stage directions."
    )
    resp = client.models.generate_content(
        model=MODEL, contents=text,
        config=types.GenerateContentConfig(system_instruction=system, max_output_tokens=700),
    )
    return (resp.text or "").strip()


async def make_audio(script, voice, path):
    await edge_tts.Communicate(script, voice).save(path)


@app.route("/")
def index():
    return render_template("index.html", tones=list(TONES.keys()))


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    tone = data.get("tone", "teacher")
    lang = data.get("language", "english")

    if not text:
        return jsonify(error="Please enter some text."), 400
    if len(text) > MAX_CHARS:
        return jsonify(error=f"Text is too long. Keep it under {MAX_CHARS} characters."), 400
    if tone not in TONES or lang not in LANGS:
        return jsonify(error="Invalid tone or language."), 400

    try:
        script = make_script(text, tone, lang)
        voice = TONES[tone][1] if lang == "english" else TONES[tone][2]
        cleanup_old_audio()
        name = f"{uuid.uuid4().hex}.mp3"
        asyncio.run(make_audio(script, voice, os.path.join(AUDIO_DIR, name)))
        return jsonify(script=script, audio_url=f"/static/audio/{name}")
    except errors.APIError as e:
        return api_error_response(e)
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Something went wrong. Please try again."), 500


def api_error_response(e):
    msg = str(getattr(e, "message", "") or e)
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if key:
        msg = msg.replace(key, "***")
    app.logger.warning("Gemini API error %s: %s", getattr(e, "code", "?"), msg)
    if e.code == 429:
        return jsonify(error="Free limit reached. Wait a minute and try again."), 429
    if e.code == 404:
        return jsonify(error="Model not available. Change GEMINI_MODEL in .env."), 500
    return jsonify(error="Gemini says (%s): %s" % (e.code, msg[:220])), 500


IMG_KEYS = ("cover", "key_points", "advantages", "disadvantages", "applications", "example")


def _img_item(v):
    if isinstance(v, str):
        v = {"query": v}
    v = v if isinstance(v, dict) else {}
    return {"query": str(v.get("query") or "").strip()[:60], "prompt": str(v.get("prompt") or "").strip()[:300],
            "emoji": str(v.get("emoji") or "").strip()[:8]}


@app.route("/screen")
def screen():
    return render_template("screen.html")


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    lang = data.get("language", "english")
    if not text:
        return jsonify(error="Please enter some text."), 400
    if len(text) > MAX_CHARS:
        return jsonify(error=f"Text is too long. Keep it under {MAX_CHARS} characters."), 400
    if lang not in LANGS:
        lang = "english"

    system = (
        "Analyse the user's text for a student slide deck. Write in " + LANGS[lang] + ". "
        "Return ONLY JSON with these keys: "
        '"title" (string, max 8 words), '
        '"context" (string, 2-5 English words naming the subject field, e.g. \"Java programming language\"), '
        '"important_line" (string, one-sentence definition or core idea of the concept), '
        '"key_points" (list), "advantages" (list), "disadvantages" (list), '
        '"applications" (list), "example" (string). '
        "Every list item: max 14 words, starting with one fitting emoji. "
        "Also add \"images\": an object with keys cover, key_points, advantages, disadvantages, applications, example. "
        "Each value is an object {\"query\": ..., \"prompt\": ..., \"emoji\": ...}. "
        "query = 2-4 English words for ONE concrete thing to photograph for that slide. "
        "prompt = ONE English sentence (max 35 words) describing a clear, simple, colourful visual scene that shows THAT slide's main idea and its first two points: "
        "name the concrete objects, setting and action. For abstract or technical topics show a friendly everyday scene (people, devices, screens, tools), never an abstract concept. "
        "Every query and prompt must LITERALLY show the subject of that slide in its own field. NEVER use metaphors, symbols or puns "
        "(no hourglass for 'slow', no coffee for 'Java'): for technology show developers, laptops, code editors, servers, network cables; "
        "for science show the real equipment, organ or process; for business show offices, shops, documents. "
        "No text, letters, numbers or logos in the picture. "
        "emoji = ONE emoji that best represents that slide. "
        "Max 5 items per list. If the text does not support a section, use an empty list or empty string. "
        "Do not invent facts that are not supported by the text or common knowledge."
    )
    try:
        resp = client.models.generate_content(
            model=MODEL, contents=text,
            config=types.GenerateContentConfig(
                system_instruction=system, max_output_tokens=1500,
                response_mime_type="application/json"),
        )
        raw = (resp.text or "").strip().removeprefix("```json").removesuffix("```").strip()
        d = json.loads(raw)
    except errors.APIError as e:
        return api_error_response(e)
    except (json.JSONDecodeError, ValueError):
        return jsonify(error="Could not read the AI result. Please try again."), 500
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Something went wrong. Please try again."), 500

    def lst(k):
        v = d.get(k) or []
        return [str(x).strip() for x in v if str(x).strip()][:5] if isinstance(v, list) else []

    return jsonify(
        title=str(d.get("title") or "").strip(),
        context=str(d.get("context") or "").strip()[:60],
        important_line=str(d.get("important_line") or "").strip(),
        key_points=lst("key_points"), advantages=lst("advantages"),
        disadvantages=lst("disadvantages"), applications=lst("applications"),
        example=str(d.get("example") or "").strip(),
        images={k: _img_item((d.get("images") or {}).get(k)) for k in IMG_KEYS},
    )


_img_cache = {}
STYLES = {
    "photo": "realistic professional photo, natural light",
    "2d": "flat 2D vector illustration, clean shapes, soft professional colors, plain background",
    "3d": "3D render, smooth clay style, soft studio lighting, plain background",
    "cinematic": "cinematic 4K render, dramatic lighting, depth of field",
}


def _get(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=dict({"User-Agent": "ClassMitra/1.0 (student project; github.com/Ankita2005899)"}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "image/jpeg").split(";")[0]


def _data_uri(raw, ctype):
    if not ctype.startswith("image/") or len(raw) < 1000:
        raise ValueError("not an image")
    return "data:%s;base64,%s" % (ctype, base64.b64encode(raw).decode())


_poll_lock, _poll_last = threading.Lock(), 0.0


def _pollinations(prompt):
    """Generated image. Anonymous use allows ~1 image / 15 s, so calls are spaced out and retried."""
    global _poll_last
    qs = urllib.parse.quote(prompt)
    pkey = os.getenv("POLLINATIONS_API_KEY", "").strip()
    if pkey and not pkey.startswith("paste_"):
        return _data_uri(*_get("https://gen.pollinations.ai/image/%s?width=800&height=800&key=%s" % (qs, pkey), timeout=60))
    raise RuntimeError("skipped (anonymous service adds a watermark); use Cloudflare")
    url = "https://image.pollinations.ai/prompt/%s?width=800&height=800&nologo=true" % qs
    with _poll_lock:
        for _ in range(3):
            wait = 16 - (time.time() - _poll_last)
            if wait > 0:
                time.sleep(wait)
            _poll_last = time.time()
            try:
                return _data_uri(*_get(url, timeout=60))
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504):
                    raise
        raise RuntimeError("image service busy")


def _commons(q):
    """Last-resort real photo from Wikimedia Commons (no key)."""
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "generator": "search", "gsrsearch": "filetype:bitmap " + q, "gsrnamespace": 6,
        "gsrlimit": 5, "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": 800, "format": "json"})
    pages = json.loads(_get(url, timeout=10)[0]).get("query", {}).get("pages", {})
    for p in sorted(pages.values(), key=lambda x: x.get("index", 99)):
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") in ("image/jpeg", "image/png") and ii.get("thumburl"):
            try:
                return _data_uri(*_get(ii["thumburl"], timeout=15))
            except Exception:
                continue
    return None


class NoKeys(Exception):
    pass


VARIANTS = ["", ", different camera angle", ", close-up view", ", wide view", ", different composition"]


def _cloudflare(prompt):
    """Free FLUX image generation (Cloudflare Workers AI). Sends only prompt + steps (the inputs the live API accepts)."""
    acct, tok = os.getenv("CF_ACCOUNT_ID", "").strip(), os.getenv("CF_API_TOKEN", "").strip()
    if not acct or not tok or acct.startswith("paste_") or tok.startswith("paste_"):
        raise NoKeys("no CF_ACCOUNT_ID / CF_API_TOKEN in .env")
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts/%s/ai/run/@cf/black-forest-labs/flux-1-schnell" % acct,
        data=json.dumps({"prompt": prompt[:1500], "steps": 4}).encode(),
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s %s" % (e.code, e.read().decode("utf-8", "ignore")[:200]))
    b64 = (data.get("result") or {}).get("image")
    if not b64:
        raise RuntimeError("no image in reply: %s" % str(data)[:200])
    return "data:image/jpeg;base64," + b64


@app.route("/image")
def image():
    """Slide picture. Photo: Pexels -> Pixabay -> generated. Other styles: generated. Generated = Cloudflare -> Pollinations."""
    q = (request.args.get("q") or "").strip()[:80]
    p = (request.args.get("p") or "").strip()[:300]
    style = request.args.get("style", "photo")
    n = max(0, min(int(request.args.get("n", "0") or 0), 20))
    if style not in STYLES:
        style = "photo"
    if not (q or p):
        return jsonify(url=None, why="empty prompt")
    ck = (q, p, style, n)
    if ck in _img_cache:
        return jsonify(url=_img_cache[ck])
    uri, why = None, []
    key = os.getenv("PEXELS_API_KEY", "").strip()
    if style == "photo":
        if not key or key.startswith("paste_"):
            why.append("pexels: no key")
        else:
            try:
                raw, _ = _get("https://api.pexels.com/v1/search?per_page=1&page=%d&orientation=landscape&query=%s"
                              % (n + 1, urllib.parse.quote(q or p)), {"Authorization": key}, 8)
                photos = json.loads(raw).get("photos") or []
                if photos:
                    uri = _data_uri(*_get(photos[0]["src"]["large"], timeout=10))
                else:
                    why.append("pexels: no photo found")
            except Exception as e:
                why.append("pexels: %s" % e)
    pkey = os.getenv("PIXABAY_API_KEY", "").strip()
    if style == "photo" and not uri:
        if not pkey or pkey.startswith("paste_"):
            why.append("pixabay: no key")
        else:
            try:
                raw, _ = _get("https://pixabay.com/api/?key=%s&image_type=photo&orientation=horizontal&safesearch=true&per_page=3&page=%d&q=%s"
                              % (pkey, n + 1, urllib.parse.quote(q or p)), timeout=10)
                hits = json.loads(raw).get("hits") or []
                if hits:
                    uri = _data_uri(*_get(hits[0].get("largeImageURL") or hits[0]["webformatURL"], timeout=15))
                else:
                    why.append("pixabay: no photo found")
            except Exception as e:
                why.append("pixabay: %s" % str(e).replace(pkey, "***"))
    scene = "%s, %s, no text, no letters, no watermark" % (p or q, STYLES[style])
    cf_ready = True
    if not uri:
        for attempt in range(2):
            try:
                uri = _cloudflare(scene + VARIANTS[(n + attempt) % len(VARIANTS)])
                break
            except NoKeys as e:  # keys missing
                why.append("cloudflare: %s" % e)
                cf_ready = False
                break
            except Exception as e:
                why.append("cloudflare: %s" % e)
                time.sleep(2)
    if not uri and not cf_ready:  # Pollinations adds a watermark and is slow, so it is only a fallback
        try:
            uri = _pollinations(scene)
        except Exception as e:
            why.append("pollinations: %s" % e)
    if uri:
        _img_cache[ck] = uri
    else:
        app.logger.warning("image failed for %r: %s", q or p, "; ".join(why))
    return jsonify(url=uri, why="; ".join(why)[:300])


if __name__ == "__main__":
    app.run(debug=True)
