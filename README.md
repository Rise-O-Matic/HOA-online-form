# Fairway Canyon HOA — Architectural Review Committee Application

A static, client-side **mockup** of the Fairway Canyon HOA ARC application, rebuilt from
the printed PDF as a web form for GitHub Pages. **There is no backend** — drafts persist
to `localStorage`, "submitting" opens a printable preview or a pre-addressed `mailto:`,
and data can be exported as JSON.

Plain HTML/CSS/JS — no build step, no npm dependencies. Behavior is native ES modules
under `assets/` (entry `app.js`; pure geometry in `geometry.js` is unit-tested with
`node --test`). Maps come from MapLibre GL + Riverside County GIS; the plot-plan drawing
surface is Konva.js (both vendored as pinned builds in `assets/vendor/`).

- **Run locally:** `python -m http.server 8000`, then visit `http://localhost:8000`
  (a real http origin is required — ES modules, county GIS calls and map tiles don't work over `file://`).
- **Tests:** `node --test`
- **Deploy:** GitHub Pages serves the repo root from the **`master`** branch.
- **Docs:** `CLAUDE.md` covers architecture and gotchas; `ROADMAP.md` is the plan of record.

Unofficial mockup; not affiliated with FirstService Residential.
