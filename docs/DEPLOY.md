# Deploying Taller

Taller is a static PWA — any static host works. No build step, no server.

## GitHub Pages (recommended, free)

1. Create a **public** repo (e.g. `taller`) with "Add a README file" checked.
2. *Add file ▾ → Upload files* → open the unzipped folder, **select everything inside it** (Ctrl/Cmd+A) and drag it into the drop zone (dragging the items — not the parent folder — keeps `index.html` at the repo root and preserves subfolders). Commit.
3. *Settings → Pages → Build and deployment* → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.
4. Wait 2–10 minutes → your app is at `https://<user>.github.io/<repo>/`.

Everything uses relative paths, so subpath hosting works out of the box.

## After deploying

- Edit `js/config.js`: set `repoUrl` (and `aiEndpoint` if you deploy the optional AI worker — see `worker/ai-worker.js` for its own 15-minute instructions).
- Bump `VERSION` in `sw.js` whenever you change files, so installed clients pick up the update.

## Notes

- Serve over HTTPS (GitHub Pages does) — required for service worker + install.
- The OCR engine (`vendor/tesseract/`) is fetched on first OCR use and then cached offline by the service worker.

---

## v0.6 — what changed for you as the maintainer

Three things affect deployment:

1. **The OCR engine (~7.5 MB) is no longer precached.** It used to be fetched
   during service-worker install, which on a 2G link kept the app from becoming
   offline-capable for 20-40 minutes and could leave a technician with no
   offline app at all if they lost signal in the middle. It is now downloaded
   the first time someone actually runs OCR — which is what the UI always
   promised. First load is ~2.4 MB instead of ~10 MB.

2. **pdf.js is now in the atomic critical shell.** Reading a manual offline is
   the product, so it can no longer be a best-effort download that silently
   fails and then reports "this PDF may be damaged".

3. **The AI worker needs two settings.** `RATE_KV` is now REQUIRED (without it
   anyone with curl can spend your Anthropic credit), and `ALLOWED_ORIGINS`
   is strongly recommended so only your own site can call the endpoint. Both
   are in the deploy comment at the top of `worker/ai-worker.js`.

Bump `VERSION` in `sw.js` and `CONFIG.version` in `js/config.js` together on
every release — the second one is what field feedback reports are stamped with.
