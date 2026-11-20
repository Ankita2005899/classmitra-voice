"""Run:  python check_keys.py   - tests your .env keys and prints the exact problem."""
import os, json, urllib.request, urllib.error
from dotenv import load_dotenv

load_dotenv()
G = os.getenv("GEMINI_API_KEY", "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
ACCT = os.getenv("CF_ACCOUNT_ID", "").strip()
TOK = os.getenv("CF_API_TOKEN", "").strip()


def show(name, ok, msg=""):
    print(("OK    " if ok else "FAIL  ") + name + ((" - " + msg) if msg else ""))


print("Key lengths (Gemini key is normally 39 characters):", len(G), "| CF account id (32):", len(ACCT), "\n")

try:
    from google import genai
    r = genai.Client(api_key=G).models.generate_content(model=MODEL, contents="Reply with the word OK")
    show("Gemini text (%s)" % MODEL, True, (r.text or "").strip()[:30])
except Exception as e:
    show("Gemini text (%s)" % MODEL, False, str(e).replace(G, "***")[:500])

try:
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts/%s/ai/run/@cf/black-forest-labs/flux-1-schnell" % ACCT,
        data=json.dumps({"prompt": "a red apple on a table", "steps": 4}).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        ok = bool(json.loads(resp.read())["result"]["image"])
    show("Cloudflare image", ok)
except urllib.error.HTTPError as e:
    show("Cloudflare image", False, "HTTP %s %s" % (e.code, e.read().decode()[:300]))
except Exception as e:
    show("Cloudflare image", False, str(e)[:300])
