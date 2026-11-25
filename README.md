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

## Slide editor (/screen)
Generate slides, then edit everything: drag to move, blue corner to resize, double-click text to edit,
upload images/logos, change colours (8 frames or your own 6), delete anything, download PNGs as ZIP.
Images: "Real photos" uses Pexels if PEXELS_API_KEY is set, otherwise AI-generated; 2D/3D/Cinematic are AI-generated.

## Free keys for slide images (put in .env)
- CF_ACCOUNT_ID + CF_API_TOKEN: Cloudflare Workers AI (FLUX image generation, free daily allowance) - best option.
- PEXELS_API_KEY: real photos (pexels.com/api).
Each slide gets its own scene prompt. Use "New image" or "Describe image" in the toolbar to fix any picture.
- PIXABAY_API_KEY: real stock photos (pixabay.com/api/docs). Photos are from Pixabay.

## Talking Image (/talk)
Upload a picture, click the two mouth corners, add text: the face moves its mouth and head with the voice. Free, runs in the browser. Download as WebM.

## Talking Teacher (/talk)
Default: built-in line character (circle face, moving mouth, arms with shoulder-elbow-wrist lines, hands, legs) that gestures while the voice speaks. Optional: your own picture (lips + head only). Free, runs in the browser; download as WebM.
