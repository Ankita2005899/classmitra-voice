# ClassMitra Studio

One page. Type your lesson or upload a file, click one button, and get:

1. **Slides** with a matching image on every slide: editable (move, resize, recolour, upload images or logos), downloadable as a real **PowerPoint (.pptx)** or as PNG images.
2. **A spoken explanation** in the voice of the character you choose (teacher, principal, scientist, farmer, cricketer, shopkeeper, storyteller).
3. **A teacher who explains it**: the text appears on a screen behind him and he follows it with a pointer stick while the mouth moves with the voice. Download the clip as WebM.

Input: text, or a file: PowerPoint (.pptx), Word (.docx), PDF (.pdf), images (.png .jpg .jpeg .webp), text (.txt .md), up to 15 MB.

## Run locally
```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then fill in the keys
python app.py
```
Open http://127.0.0.1:5000

Check your keys any time with `python check_keys.py`.

## Keys (.env)
- `GEMINI_API_KEY`: text, slides, and reading images / scanned PDFs (free at aistudio.google.com/apikey)
- `CF_ACCOUNT_ID` + `CF_API_TOKEN`: slide images (Cloudflare Workers AI, free allowance)
- Optional: `PEXELS_API_KEY`, `PIXABAY_API_KEY` for real stock photos

## Deploy on Render
Build: `pip install -r requirements.txt`  Start: `gunicorn app:app --timeout 120`. Add the keys as environment variables.
