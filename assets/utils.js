/* Tiny shared DOM/string helpers used by every module. */
export const $  = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
// HTML-escape for user-entered strings interpolated into template markup.
export const esc = s => (s == null ? "" : String(s)).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

/* --- Modal focus management (Sprint 27) ---------------------------------
   One shared trap for the three dialogs (material library, review gate,
   builder tutorial). trapModalFocus(modal) remembers the element that had
   focus, moves focus onto the dialog panel (tabindex="-1" in the markup),
   and keeps Tab cycling inside the panel; releaseModalFocus(modal) removes
   the trap and hands focus back to the opener. Escape stays each modal's
   own concern (their existing document listeners close them, and closing
   funnels through releaseModalFocus) — the trap handles Tab only. Only one
   modal is ever open at a time in this app, so a single trap slot is enough. */
const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';
const modalOpener = new WeakMap();
let trappedModal = null;

// offsetParent is null anywhere under display:none (e.g. the [hidden]
// custom-material warning), which is exactly the "skip it" signal we need.
const modalFocusables = panel => $$(MODAL_FOCUSABLE, panel).filter(el => el.offsetParent !== null);

function onTrapKeydown(e) {
  if (e.key !== "Tab" || !trappedModal || trappedModal.hidden) return;
  const panel = $(".modal__panel", trappedModal) || trappedModal;
  const items = modalFocusables(panel);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const current = document.activeElement;
  const inside = panel.contains(current);
  if (e.shiftKey) {
    // Shift+Tab off the panel itself (the fresh-open state) wraps to the end too.
    if (!inside || current === first || current === panel) { e.preventDefault(); last.focus(); }
  } else if (!inside || current === last) {
    e.preventDefault();
    first.focus();
  }
}

export function trapModalFocus(modal) {
  if (!modal) return;
  modalOpener.set(modal, document.activeElement);
  if (!trappedModal) document.addEventListener("keydown", onTrapKeydown, true);
  trappedModal = modal;
  const panel = $(".modal__panel", modal) || modal;
  try { panel.focus({ preventScroll: true }); } catch (_) {}
}

export function releaseModalFocus(modal, fallback) {
  if (!modal) return;
  if (trappedModal === modal) {
    trappedModal = null;
    document.removeEventListener("keydown", onTrapKeydown, true);
  }
  const opener = modalOpener.get(modal);
  modalOpener.delete(modal);
  if (opener && opener !== document.body && typeof opener.focus === "function" && document.contains(opener)) {
    try { opener.focus({ preventScroll: true }); } catch (_) {}
  }
  // The opener restore can silently fail — the recorded element may have been
  // rebuilt out of the DOM (the material library's commit re-renders the chip
  // row), hidden (the auto-shown tutorial records a control of the wizard step
  // that just switched away), or plain <body>. Rather than dropping the keyboard
  // user at the top of the document, hand focus to the caller's fallback. "Lost"
  // includes focus still sitting inside the just-hidden modal: Chrome doesn't
  // reliably run its focus fixup synchronously, so activeElement can linger on a
  // display:none panel at this point.
  const ae = document.activeElement;
  if (fallback && (!ae || ae === document.body || modal.contains(ae))) {
    const el = typeof fallback === "string" ? $(fallback) : fallback;
    try { if (el) el.focus({ preventScroll: true }); } catch (_) {}
  }
}
