/* =========================================================
   attach-store.js — durable file-attachment persistence

   The form's <input type=file> elements only hold bytes for
   the session; the localStorage draft persists filenames only,
   so a reload used to show a "previously attached" note with no
   image. IndexedDB stores Blobs natively (no base64 bloat,
   hundreds of MB of headroom), and a File rebuilt from a stored
   Blob CAN be pushed back into an input via DataTransfer — so
   restored attachments become live again (real thumbnails,
   counted in the meter, embeddable in print).

   A thin wrapper over vendored idb-keyval. Keys are namespaced
   by the draft's refId (`<refId>::<inputKey>`) so a future
   multi-draft world can't collide; inputKey is a stable handle
   per file input ("photo:<shotId>", "imp:<uid>", "plot").
   Everything degrades gracefully: if IndexedDB is unavailable
   or a write throws (quota/private mode), callers fall back to
   today's filename-only behavior.
   ========================================================= */
import { get, set, del, keys, clear, createStore } from "./vendor/idb-keyval-6.2.2.js";

const store = createStore("fairway-canyon-arc", "attachments");

export function idbAvailable() {
  try { return typeof indexedDB !== "undefined" && indexedDB !== null; }
  catch (e) { return false; }
}

function fullKey(refId, inputKey) { return `${refId}::${inputKey}`; }

// Store the input's current FileList as an array of {name,type,blob} records
// (File is a Blob, so it structured-clones straight into IDB with its name/type).
// An empty FileList deletes the key so remove/replace can't leave a ghost blob.
export async function saveAttachment(refId, inputKey, files) {
  const arr = Array.from(files || []);
  if (!arr.length) return del(fullKey(refId, inputKey), store);
  const recs = arr.map(f => ({ name: f.name, type: f.type, blob: f }));
  return set(fullKey(refId, inputKey), recs, store);
}

// Rebuild the stored records into live File objects (name/type preserved), or []
// if nothing was stored. Reconstructing a File (rather than handing back the raw
// Blob) guarantees DataTransfer.items.add() gets a named File in every browser.
export async function loadAttachment(refId, inputKey) {
  const recs = await get(fullKey(refId, inputKey), store);
  if (!Array.isArray(recs) || !recs.length) return [];
  return recs.map(r => new File([r.blob], r.name || "file", { type: r.type || "" }));
}

export async function delAttachment(refId, inputKey) {
  return del(fullKey(refId, inputKey), store);
}

// Drop every attachment belonging to one draft (its refId prefix) — paired with
// deleteDraft() so clearing a draft also purges its file bytes (PII hygiene).
export async function clearAttachments(refId) {
  const prefix = refId + "::";
  const all = await keys(store);
  await Promise.all(
    all.filter(k => typeof k === "string" && k.startsWith(prefix))
       .map(k => del(k, store))
  );
}

// Purge the whole attachment store — used by the ?reset dev escape hatch, where no
// specific refId has been adopted yet.
export async function clearAllAttachments() {
  return clear(store);
}
