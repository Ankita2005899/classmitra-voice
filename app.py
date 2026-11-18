import os, uuid, time, glob, asyncio, json
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
        if e.code in (400, 401, 403):
            return jsonify(error="Invalid or missing GEMINI_API_KEY."), 500
        if e.code == 429:
            return jsonify(error="Free limit reached. Wait a minute and try again."), 429
        app.logger.exception(e)
        return jsonify(error="Gemini error. Please try again."), 500
    except Exception as e:
        app.logger.exception(e)
        return jsonify(error="Something went wrong. Please try again."), 500


def api_error_response(e):
    if e.code in (400, 401, 403):
        return jsonify(error="Invalid or missing GEMINI_API_KEY."), 500
    if e.code == 429:
        return jsonify(error="Free limit reached. Wait a minute and try again."), 429
    if e.code == 404:
        return jsonify(error="Model not available. Change GEMINI_MODEL in .env."), 500
    app.logger.exception(e)
    return jsonify(error="Gemini error. Please try again."), 500


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
        '"important_line" (string, one-sentence definition or core idea of the concept), '
        '"key_points" (list), "advantages" (list), "disadvantages" (list), '
        '"applications" (list), "example" (string). '
        "Every list item: max 14 words, starting with one fitting emoji. "
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
        important_line=str(d.get("important_line") or "").strip(),
        key_points=lst("key_points"), advantages=lst("advantages"),
        disadvantages=lst("disadvantages"), applications=lst("applications"),
        example=str(d.get("example") or "").strip(),
    )


if __name__ == "__main__":
    app.run(debug=True)