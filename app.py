import os, io, re, uuid, time, glob, asyncio, json, base64, threading, urllib.request, urllib.parse, urllib.error
from flask import Flask, render_template, request, jsonify, send_file
from dotenv import load_dotenv
from google import genai
from google.genai import types, errors
import edge_tts

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024

AUDIO_DIR = os.path.join(app.static_folder, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
MAX_CHARS = 8000

# tone -> (persona instruction, english voice, hindi voice)
TONES = {
    "teacher": (
        "a warm, patient school teacher. Explain step by step, give one simple example, end with a one-line recap.",
        "en-IN-NeerjaNeural", "hi-IN-SwaraNeural"),
    "principal": (
        "a respectful school principal addressing the students: calm, confident and encouraging. Explain clearly, then close with one motivating line.",
        "en-IN-PrabhatNeural", "hi-IN-MadhurNeural"),
    "scientist": (
        "an enthusiastic scientist. Explain using evidence, a simple experiment or observation, and curiosity.",
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
        config=types.GenerateContentConfig(system_instruction=system, max_output_tokens=2048),
    )
    return (resp.text or "").strip()


async def make_audio(script, voice, path):
    await edge_tts.Communicate(script, voice).save(path)


def gtts_fallback(script, lang, path):
    """Backup voice (Google Translate TTS, no key) when the Microsoft voice service refuses us."""
    from gtts import gTTS
    gTTS(script, lang="hi" if lang == "hindi" else "en", tld="co.in").save(path)


def make_audio_retry(script, voice, path, lang="english"):
    last = None
    for _ in range(2):
        try:
            asyncio.run(make_audio(script, voice, path))
            if os.path.exists(path) and os.path.getsize(path) > 500:
                return
            last = RuntimeError("the voice service returned an empty file")
        except Exception as e:
            last = e
        time.sleep(1)
    app.logger.warning("edge-tts failed (%s); using the backup voice", last)
    try:
        gtts_fallback(script, lang, path)
        if os.path.exists(path) and os.path.getsize(path) > 500:
            return
    except Exception as e:
        raise RuntimeError("Microsoft voice: %s | backup voice: %s" % (str(last)[:90], str(e)[:90]))
    raise last


@app.route("/")
def index():
    return render_template("studio.html", tones=list(TONES.keys()))


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
        script = text if data.get("raw") else make_script(text, tone, lang)
        script = re.sub(r"[*_#`>~|]+", " ", script).strip()
        if not script:                      # the AI returned nothing: speak the user's own text instead
            script = text
        voice = TONES[tone][1] if lang == "english" else TONES[tone][2]
        cleanup_old_audio()
        name = f"{uuid.uuid4().hex}.mp3"
        make_audio_retry(script, voice, os.path.join(AUDIO_DIR, name), lang)
        return jsonify(script=script, audio_url=f"/static/audio/{name}")
    except errors.APIError as e:
        return api_error_response(e)
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Voice/AI problem (%s): %s" % (type(e).__name__, str(e)[:160])), 500


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




def clean_for_tts(text):
    return re.sub(r"[*_#`>~|]+", " ", str(text)).strip()


@app.route("/tts", methods=["POST"])
def tts():
    """One short piece of speech (a slide's narration or a question) in the chosen character's voice."""
    data = request.get_json(silent=True) or {}
    text = clean_for_tts((data.get("text") or ""))[:1500]
    tone, lang = data.get("tone", "teacher"), data.get("language", "english")
    if not text:
        return jsonify(error="Nothing to say."), 400
    if tone not in TONES or lang not in LANGS:
        tone, lang = "teacher", "english"
    try:
        voice = TONES[tone][1] if lang == "english" else TONES[tone][2]
        cleanup_old_audio()
        name = f"{uuid.uuid4().hex}.mp3"
        make_audio_retry(text, voice, os.path.join(AUDIO_DIR, name), lang)
        return jsonify(audio_url=f"/static/audio/{name}")
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Voice problem (%s): %s" % (type(e).__name__, str(e)[:160])), 500


@app.route("/lesson", methods=["POST"])
def lesson():
    """For every slide: what the teacher says about each point (in order) + one multiple-choice question."""
    import random
    data = request.get_json(silent=True) or {}
    points = data.get("points") or []
    tone, lang = data.get("tone", "teacher"), data.get("language", "english")
    if not points or not isinstance(points, list):
        return jsonify(error="There are no slides to teach."), 400
    if tone not in TONES or lang not in LANGS:
        tone, lang = "teacher", "english"
    outline = [{"slide": i + 1, "points": [{"n": j + 1, "type": p.get("kind", "point"), "text": str(p.get("text", ""))[:300]}
                                           for j, p in enumerate(sl)]} for i, sl in enumerate(points[:20])]
    system = (
        "You are " + TONES[tone][0] + " You are teaching a slide show to students, speaking in " + LANGS[lang] + ". "
        "The user sends a JSON list of slides; each slide has numbered points (type title, point or image). "
        'Return ONLY JSON: {"slides":[{"parts":[...],"question":"...","options":["...","...","...","..."],"answer":0,"hint":"..."}]}. '
        "Rules: exactly one entry per input slide, in order. parts = exactly one string per point of that slide, in the same order; "
        "each part is 1-2 spoken sentences (max 35 words) explaining THAT point in your own voice; for an image point say what the picture shows; "
        "the very first part of the first slide may greet the class. No markdown, no emojis, no stage directions. "
        "question = ONE multiple-choice question about what was taught on that slide only, answerable from what you said. "
        "options = exactly 4 short options (max 8 words each), only one correct. answer = index 0-3 of the correct option. "
        "hint = one short sentence that helps without giving the answer away."
    )
    try:
        resp = client.models.generate_content(
            model=MODEL, contents=json.dumps(outline, ensure_ascii=False),
            config=types.GenerateContentConfig(system_instruction=system, max_output_tokens=8192, response_mime_type="application/json"))
        raw = (resp.text or "").strip().removeprefix("```json").removesuffix("```").strip()
        d = json.loads(raw)
    except errors.APIError as e:
        return api_error_response(e)
    except (json.JSONDecodeError, ValueError):
        return jsonify(error="Could not read the lesson from the AI. Please try again."), 500
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Lesson problem (%s): %s" % (type(e).__name__, str(e)[:140])), 500
    out = []
    items = d.get("slides") if isinstance(d, dict) else d
    for i, sl in enumerate(outline):
        it = (items[i] if isinstance(items, list) and i < len(items) else {}) or {}
        parts = [clean_for_tts(p) for p in (it.get("parts") or []) if str(p).strip()]
        opts = [str(o).strip()[:90] for o in (it.get("options") or []) if str(o).strip()][:4]
        try:
            ans = int(it.get("answer", 0))
        except (TypeError, ValueError):
            ans = 0
        if len(opts) < 2 or not (0 <= ans < len(opts)):
            opts, ans = ["True", "False"], 0
            question = "Was this slide about: " + (sl["points"][0]["text"] if sl["points"] else "this topic") + "?"
        else:
            question = str(it.get("question") or "").strip()[:260] or "Which answer is correct?"
        order = list(range(len(opts))); random.shuffle(order)               # the right answer is not always in the same place
        out.append({"parts": parts, "question": question, "options": [opts[k] for k in order],
                    "answer": order.index(ans), "hint": str(it.get("hint") or "").strip()[:200]})
    return jsonify(slides=out)


ALLOWED_EXT = {".pptx", ".docx", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md"}
IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def text_from_pptx(raw):
    from pptx import Presentation
    prs, out = Presentation(io.BytesIO(raw)), []
    for i, sl in enumerate(prs.slides, 1):
        parts = []
        for sh in sl.shapes:
            if sh.has_text_frame and sh.text_frame.text.strip():
                parts.append(sh.text_frame.text.strip())
            if getattr(sh, "has_table", False) and sh.has_table:
                for row in sh.table.rows:
                    parts.append(" | ".join(c.text.strip() for c in row.cells if c.text.strip()))
        if sl.has_notes_slide and sl.notes_slide.notes_text_frame.text.strip():
            parts.append(sl.notes_slide.notes_text_frame.text.strip())
        if parts:
            out.append("Slide %d:\n%s" % (i, "\n".join(parts)))
    return "\n\n".join(out)


def text_from_docx(raw):
    import docx
    d, out = docx.Document(io.BytesIO(raw)), []
    out += [p.text.strip() for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for row in t.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                out.append(" | ".join(cells))
    return "\n".join(out)


def text_from_pdf(raw):
    from pypdf import PdfReader
    rd = PdfReader(io.BytesIO(raw))
    return "\n".join((p.extract_text() or "") for p in rd.pages[:40]).strip()


def gemini_read(raw, mime):
    """Images and scanned PDFs: let Gemini read the text and describe the content."""
    resp = client.models.generate_content(
        model=MODEL,
        contents=[types.Part.from_bytes(data=raw, mime_type=mime),
                  "Extract all readable text from this file, in reading order. If it is a diagram, chart or photo, "
                  "describe what it shows in a few clear sentences so it can be taught as a lesson. Plain text only."],
        config=types.GenerateContentConfig(max_output_tokens=4096),
    )
    return (resp.text or "").strip()


@app.route("/extract", methods=["POST"])
def extract():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="No file received."), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify(error="This file type is not supported. Allowed: PowerPoint (.pptx), Word (.docx), PDF (.pdf), "
                             "images (.png .jpg .jpeg .webp), text (.txt .md). Old .ppt / .doc files: save them as .pptx / .docx first."), 400
    raw = f.read()
    if len(raw) > 15 * 1024 * 1024:
        return jsonify(error="The file is larger than 15 MB."), 400
    try:
        if ext == ".pptx":
            text = text_from_pptx(raw)
        elif ext == ".docx":
            text = text_from_docx(raw)
        elif ext == ".pdf":
            text = text_from_pdf(raw)
            if len(text) < 40:
                text = gemini_read(raw, "application/pdf")
        elif ext in IMG_MIME:
            text = gemini_read(raw, IMG_MIME[ext])
        else:
            text = raw.decode("utf-8", "ignore")
    except errors.APIError as e:
        return api_error_response(e)
    except ImportError as e:
        return jsonify(error="A library is missing (%s). Run: pip install -r requirements.txt" % e.name), 500
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Could not read this file (%s: %s)." % (type(e).__name__, str(e)[:120])), 500
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return jsonify(error="No readable text was found in this file."), 400
    return jsonify(text=text[:MAX_CHARS], name=f.filename, truncated=len(text) > MAX_CHARS)


@app.route("/pptx", methods=["POST"])
def pptx_export():
    """Build a real PowerPoint file from the slides as they are in the editor."""
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
        from pptx.dml.color import RGBColor
        from pptx.enum.text import PP_ALIGN
        from pptx.enum.shapes import MSO_SHAPE
        from PIL import Image
    except ImportError as e:
        return jsonify(error="A library is missing (%s). Run: pip install -r requirements.txt" % e.name), 500
    data = request.get_json(silent=True) or {}
    slides = data.get("slides") or []
    pal = data.get("pal") or ["#1b2a49", "#0d1730", "#ffffff", "#dbe3f0", "#c8a24a", "#2a3d66"]
    if not slides:
        return jsonify(error="There are no slides to export."), 400
    WI, HI = 13.333, 7.5
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(WI), Inches(HI)

    def rgb(h):
        h = str(h or "#000000").lstrip("#")
        return RGBColor.from_string((h + "000000")[:6].upper())

    for n, s in enumerate(slides, 1):
        sl = prs.slides.add_slide(prs.slide_layouts[6])
        fill = sl.background.fill
        if s.get("bg"):
            fill.solid(); fill.fore_color.rgb = rgb(s["bg"])
        else:
            fill.gradient(); fill.gradient_angle = 315
            st = fill.gradient_stops
            st[0].color.rgb, st[0].position = rgb(pal[0]), 0
            st[1].color.rgb, st[1].position = rgb(pal[1]), 1
        bar = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.14), prs.slide_height)
        bar.fill.solid(); bar.fill.fore_color.rgb = rgb(pal[4]); bar.line.fill.background()
        for e in s.get("els", []):
            x, y, w, h = [float(e.get(k, 0) or 0) for k in ("x", "y", "w", "h")]
            L, T, W, H = Inches(WI * x / 100), Inches(HI * y / 100), Inches(WI * w / 100), Inches(HI * h / 100)
            if e.get("type") == "text":
                tb = sl.shapes.add_textbox(L, T, W, H)
                tf = tb.text_frame; tf.word_wrap = True
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                for i, line in enumerate(str(e.get("text", "")).split("\n")):
                    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                    p.alignment = {"center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}.get(e.get("align"), PP_ALIGN.LEFT)
                    p.space_after = Pt(6)
                    r = p.add_run(); r.text = line
                    r.font.size = Pt(max(8, float(e.get("size", 3) or 3) * 9.6))
                    r.font.bold = bool(e.get("bold")); r.font.color.rgb = rgb(e.get("color")); r.font.name = "Segoe UI"
            elif e.get("type") == "img" and e.get("src"):
                try:
                    im = Image.open(io.BytesIO(base64.b64decode(e["src"].split(",", 1)[1])))
                    im = im.convert("RGBA" if e.get("fit") == "contain" else "RGB")
                    bw, bh = W / 914400 * 150, H / 914400 * 150          # target pixels at 150 dpi
                    if e.get("fit") == "contain":
                        im.thumbnail((int(bw), int(bh)))
                        pw, ph = im.size
                        L2, T2 = L + int((W - Inches(pw / 150)) / 2), T + int((H - Inches(ph / 150)) / 2)
                        W2, H2 = Inches(pw / 150), Inches(ph / 150)
                    else:                                                  # cover: crop to the box shape
                        ar, iw, ih = bw / bh, im.width, im.height
                        if iw / ih > ar:
                            nw = int(ih * ar); im = im.crop(((iw - nw) // 2, 0, (iw - nw) // 2 + nw, ih))
                        else:
                            nh = int(iw / ar); im = im.crop((0, (ih - nh) // 2, iw, (ih - nh) // 2 + nh))
                        L2, T2, W2, H2 = L, T, W, H
                    buf = io.BytesIO(); im.save(buf, "PNG" if im.mode == "RGBA" else "JPEG", **({} if im.mode == "RGBA" else {"quality": 92})); buf.seek(0)
                    pic = sl.shapes.add_picture(buf, L2, T2, W2, H2)
                    pic.line.color.rgb = rgb(pal[5]); pic.line.width = Pt(3)
                except Exception as ex:
                    app.logger.warning("pptx image skipped: %s", ex)
        ft = sl.shapes.add_textbox(Inches(WI - 3.3), Inches(HI - 0.5), Inches(3), Inches(0.3))
        fr = ft.text_frame.paragraphs[0]; fr.alignment = PP_ALIGN.RIGHT
        bgc = str(s.get("bg") or "").lstrip("#")
        light = len(bgc) == 6 and (0.299 * int(bgc[0:2], 16) + 0.587 * int(bgc[2:4], 16) + 0.114 * int(bgc[4:6], 16)) > 150
        r = fr.add_run(); r.text = "ClassMitra  %d/%d" % (n, len(slides)); r.font.size = Pt(10); r.font.color.rgb = rgb("#555555" if light else pal[3])
    if data.get("script"):
        prs.slides[0].notes_slide.notes_text_frame.text = str(data["script"])[:4000]
    bio = io.BytesIO(); prs.save(bio); bio.seek(0)
    return send_file(bio, as_attachment=True, download_name="classmitra-slides.pptx",
                     mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation")


_img_cache = {}
STYLES = {
    "photo": "realistic professional photo, natural light",
    "2d": "flat 2D vector illustration, clean shapes, soft professional colors",
    "3d": "3D render, smooth clay style, soft studio lighting",
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
    p = (request.args.get("p") or "").strip()[:600]
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
