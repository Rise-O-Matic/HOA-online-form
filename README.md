# Fairway Canyon HOA — Architectural Review Committee Application

A front-end **mockup** of the Fairway Canyon HOA Architectural Review Committee (ARC)
application, rebuilt from the printed PDF as a clean, modern web form for **GitHub Pages**.

> ⚠️ This is a static, client-side mockup. **There is no backend** — nothing is sent to a
> server. The form saves a draft to your browser's `localStorage`, and "submitting"
> generates a printable application preview (Print → *Save as PDF*).

## What it does

- **Applicant information** with an in-browser signature pad
- **Required-submissions checklist** + photo-angle requirements + file picker (local only)
- **Interactive site/plot plan** — pick a material from the color key, then click/drag to
  paint the grid. The house is pre-placed in the center. Front Yard / Back Yard labeled.
- **Description of the proposed change** with a character counter
- **Adjacent property owners** — add/remove rows, each with its own signature pad
- **Owner acknowledgments** (all 8 terms from the PDF) + owner signature & date
- **2026 review-date table** and submission instructions for reference
- **Progress meter**, autosave draft, **Download data (JSON)**, and **Preview & Print**

## Files

```
index.html          # markup
assets/styles.css   # styles (refined civic / editorial theme)
assets/app.js        # signature pads, plot grid, validation, print, draft persistence
.nojekyll           # tell GitHub Pages to serve files as-is
```

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Publish on GitHub Pages

1. Create a repo and push these files (see below).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the **`main`** branch and the **`/ (root)`** folder, then **Save**.
5. Your form will be live at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

### First push

```bash
git init
git add .
git commit -m "Fairway Canyon HOA ARC application — web mockup"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## Notes

- Built with plain HTML/CSS/JS — no build step, no dependencies, no tracking.
- Fonts (Fraunces + Libre Franklin) load from Google Fonts.
- Unofficial mockup; not affiliated with FirstService Residential.
