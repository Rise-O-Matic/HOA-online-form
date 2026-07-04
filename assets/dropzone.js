/* =========================================================
   Dropzone — drag-and-drop + clipboard-paste attachment
   behavior for the form's <input type=file> controls.
   A registered zone accepts files dropped onto it, or pasted
   while it's hovered / focused (or when it's the only zone in
   the viewport). Files land in the zone's real file input via
   DataTransfer, then bubbling `input` + `change` events drive
   the existing status/progress/autosave listeners — downstream
   code never knows the file didn't come from the picker.
   Leaf module: no imports, safe for both app.js and
   map-wizard.js to pull in.
   ========================================================= */

// Shared upload glyph for zones built from JS template strings
// (the static zones in index.html carry the same SVG inline).
export const DROPZONE_ICON =
  '<svg class="dropzone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4"/><path d="m7 8 5-4 5 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';

const zones = [];    // { el, input }
let hovered = null;  // zone under the pointer — the paste router's first choice

function dragHasFiles(dt) {
  return !!dt && Array.from(dt.types || []).includes("Files");
}

// Honor the input's accept attribute (e.g. "image/*,application/pdf")
// so a photo slot can't receive a dropped PDF.
function acceptsFile(input, file) {
  const accept = (input.getAttribute("accept") || "").trim();
  if (!accept) return true;
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return accept.split(",").some(raw => {
    const tok = raw.trim().toLowerCase();
    if (!tok) return false;
    if (tok.startsWith(".")) return name.endsWith(tok);
    if (tok.endsWith("/*")) return type.startsWith(tok.slice(0, -1));
    return type === tok;
  });
}

function flashReject(el) {
  el.classList.remove("is-rejected");
  void el.offsetWidth; // restart the shake even on back-to-back rejects
  el.classList.add("is-rejected");
  setTimeout(() => el.classList.remove("is-rejected"), 600);
}

// Put files into the input and fire the events the rest of the app
// already listens for. Single inputs take the first accepted file;
// `multiple` inputs append (a signed neighbor form arrives page by
// page — replacing the whole FileList on each drop would lose pages).
export function assignFiles(input, files, zoneEl) {
  const ok = Array.from(files).filter(f => acceptsFile(input, f));
  if (!ok.length) {
    if (zoneEl) flashReject(zoneEl);
    return false;
  }
  const dt = new DataTransfer();
  if (input.multiple) {
    const seen = new Set();
    [...(input.files || []), ...ok].forEach(f => {
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      if (!seen.has(key)) { seen.add(key); dt.items.add(f); }
    });
  } else {
    dt.items.add(ok[0]);
  }
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function registerDropzone(el, input) {
  if (!el || !input) return;
  const entry = { el, input };
  zones.push(entry);
  el.addEventListener("dragover", e => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    el.classList.add("is-dragover");
  });
  el.addEventListener("dragleave", e => {
    // Ignore leave events fired by crossing the zone's own children.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove("is-dragover");
  });
  el.addEventListener("drop", e => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("is-dragover");
    assignFiles(input, e.dataTransfer.files, el);
  });
  el.addEventListener("mouseenter", () => { hovered = entry; });
  el.addEventListener("mouseleave", () => { if (hovered === entry) hovered = null; });
}

function zoneVisible(entry) {
  if (!entry.el.offsetParent) return false; // hidden group/panel
  const r = entry.el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

// Paste routing: hovered zone → zone owning focus → the single zone
// in view. With several zones visible and none hovered/focused the
// paste is deliberately dropped — guessing would misfile the image.
document.addEventListener("paste", e => {
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
  if (!files.length) return;
  let target = (hovered && zoneVisible(hovered)) ? hovered : null;
  if (!target) target = zones.find(z => z.el.contains(document.activeElement)) || null;
  if (!target) {
    const vis = zones.filter(zoneVisible);
    if (vis.length === 1) target = vis[0];
  }
  if (!target) return;
  e.preventDefault();
  assignFiles(target.input, files, target.el);
});

// Whole-window drag cue: light every zone up the moment a file drag
// enters the page (dragenter/dragleave fire per element, so count).
let dragDepth = 0;
document.addEventListener("dragenter", e => {
  if (!dragHasFiles(e.dataTransfer)) return;
  dragDepth++;
  document.body.classList.add("is-file-drag");
});
document.addEventListener("dragleave", () => {
  if (dragDepth > 0) dragDepth--;
  if (!dragDepth) document.body.classList.remove("is-file-drag");
});
// Capture phase so the cue resets even when a zone's own drop handler
// stops propagation; the bubble-phase preventDefault only survives for
// drops *outside* any zone, stopping the browser navigating to the file.
document.addEventListener("drop", () => {
  dragDepth = 0;
  document.body.classList.remove("is-file-drag");
}, true);
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => e.preventDefault());
