/* Tiny shared DOM/string helpers used by every module. */
export const $  = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
// HTML-escape for user-entered strings interpolated into template markup.
export const esc = s => (s == null ? "" : String(s)).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
