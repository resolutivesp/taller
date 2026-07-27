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
