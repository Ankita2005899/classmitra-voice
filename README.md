# ClassMitra Voice

Enter text, pick a tone (teacher, farmer, cricketer, shopkeeper, storyteller), get an audio explanation.
Flask + Gemini API (script) + edge-tts (audio).

Pages: `/` = text to audio, `/screen` = text to slide images (ZIP download).

## Run locally
```
python -m venv venv
venv\Scripts\activate        # Windows  (Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env       # then put your GEMINI_API_KEY inside
python app.py
```
Open http://127.0.0.1:5000

## Deploy on Render
Build: `pip install -r requirements.txt`  Start: `gunicorn app:app --timeout 120`
Add env var `GEMINI_API_KEY`.

Made by Ankita.
