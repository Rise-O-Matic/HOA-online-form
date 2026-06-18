/* =========================================================
   Fairway Canyon HOA — ARC Application (front-end mockup)
   No backend. Drafts persist to localStorage.
   ========================================================= */
(function () {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const DRAFT_KEY = "fairwayCanyonArcDraft.v1";

  /* ------------------------------------------------------
     DATA: acknowledgments, palette, review dates
  ------------------------------------------------------ */
  const ACKS = [
    "Compliance with the Guidelines, Protective Covenants and ARC approval does <strong>not</strong> necessarily constitute compliance with building and zoning codes of Riverside County. A building permit may still be required.",
    "No exterior alteration shall commence until <strong>written ARC approval</strong> has been returned to the homeowner. Unapproved or out-of-scope work may require restoration to the former condition at the homeowner's expense, plus legal costs.",
    "I am responsible to provide all required details on attached sheets (plot, sketches, scale drawings, photos, illustrations, plans, contracts, etc.), with the location of the change indicated on a color-coded plot.",
    "For changes in <strong>paint color</strong>, I will attach a manufacturer's sample indicating the color/code and the proposed vendor's name.",
    "ARC members may enter the property at a reasonable, pre-arranged time to inspect the project site(s) during and upon completion of the work. Such entry does not constitute trespass.",
    "Any approval is contingent upon construction or alterations being completed in a <strong>workmanlike manner</strong>.",
    "Authority granted may be revoked automatically if the alteration has not commenced within <strong>180 days</strong> of the approval date and completed by the date specified by the ARC.",
    "If I disagree with the decision, I may appeal: a verbal request within 48 hours of receipt of the decision, followed by a written request within five (5) business days."
  ];

  const PALETTE = [
    { id: "turf",      label: "Turf",            color: "#7cb342" },
    { id: "grass",     label: "Grass",           color: "#a5d36a" },
    { id: "concrete",  label: "Concrete",        color: "#c2bdb2" },
    { id: "patio",     label: "Patio Cover",     color: "#d98a6a" },
    { id: "mulch",     label: "Mulch / Planter", color: "#b07a4e" },
    { id: "retaining", label: "Retaining Wall",  color: "#7a5c46" },
    { id: "shed",      label: "Shed",            color: "#e2473b" },
    { id: "tree",      label: "Tree",            color: "#2e6b35" },
    { id: "light",     label: "Yard Light",      color: "#f4c430" },
    { id: "camera",    label: "Camera",          color: "#6a4bb0" },
    { id: "erase",     label: "Erase",           color: null      }
  ];
  const PALETTE_MAP = Object.fromEntries(PALETTE.map(p => [p.id, p]));

  const DATES = [
    ["January 29", "January 20"], ["February 26", "February 17"],
    ["March 26", "March 17"], ["April 30", "April 21"],
    ["May 28", "May 19"], ["June 25", "June 16"],
    ["July 30", "July 21"], ["August 27", "August 18"],
    ["September 24", "September 15"],
    ["October 29 (tentative)", "October 20 (tentative)"],
    ["November 19 (tentative)", "November 10 (tentative)"],
    ["December 17 (tentative)", "December 8 (tentative)"]
  ];

  const GRID_COLS = 30;
  const GRID_ROWS = 18;
  // pre-placed house block (centered)
  const HOUSE = { c0: 12, c1: 17, r0: 7, r1: 10 };
  const isHouse = (c, r) => c >= HOUSE.c0 && c <= HOUSE.c1 && r >= HOUSE.r0 && r <= HOUSE.r1;

  /* ------------------------------------------------------
     SIGNATURE PAD
  ------------------------------------------------------ */
  class SignaturePad {
    constructor(wrap) {
      this.wrap = wrap;
      this.canvas = $("canvas", wrap);
      this.ctx = this.canvas.getContext("2d");
      this.drawing = false;
      this.hasInk = false;
      this.resize();
      this._bind();
      $(".sigpad__clear", wrap).addEventListener("click", () => this.clear());
      window.addEventListener("resize", () => this.resize(true));
    }
    resize(preserve) {
      const data = preserve && this.hasInk ? this.canvas.toDataURL() : null;
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, r.width * dpr);
      this.canvas.height = Math.max(1, r.height * dpr);
      this.ctx.scale(dpr, dpr);
      this.ctx.lineWidth = 2.2;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.strokeStyle = "#1a2740";
      if (data) {
        const img = new Image();
        img.onload = () => this.ctx.drawImage(img, 0, 0, r.width, r.height);
        img.src = data;
      }
    }
    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    }
    _bind() {
      const start = (e) => { e.preventDefault(); this.drawing = true; const { x, y } = this._pos(e); this.ctx.beginPath(); this.ctx.moveTo(x, y); };
      const move = (e) => { if (!this.drawing) return; e.preventDefault(); const { x, y } = this._pos(e); this.ctx.lineTo(x, y); this.ctx.stroke(); this._ink(); };
      const end = () => { this.drawing = false; };
      this.canvas.addEventListener("pointerdown", start);
      this.canvas.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    }
    _ink() { if (!this.hasInk) { this.hasInk = true; this.wrap.classList.add("has-ink"); this.wrap.classList.remove("invalid"); } }
    clear() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.hasInk = false;
      this.wrap.classList.remove("has-ink");
    }
    isEmpty() { return !this.hasInk; }
    toDataURL() { return this.hasInk ? this.canvas.toDataURL("image/png") : null; }
    fromDataURL(url) {
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        const r = this.canvas.getBoundingClientRect();
        this.ctx.drawImage(img, 0, 0, r.width, r.height);
        this._ink();
      };
      img.src = url;
    }
  }

  const sigPads = {};
  $$(".sigpad").forEach(w => { sigPads[w.dataset.sigpad] = new SignaturePad(w); });

  /* ------------------------------------------------------
     PLOT GRID
  ------------------------------------------------------ */
  const gridEl = $("#plot-grid");
  let activeTool = "turf";
  let painting = false;
  // model: cellState[r][c] = paletteId or null
  const cellState = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(null));

  function buildGrid() {
    gridEl.style.gridTemplateColumns = `repeat(${GRID_COLS}, 22px)`;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "plot__cell";
        cell.dataset.r = r; cell.dataset.c = c;
        if (isHouse(c, r)) {
          cell.classList.add("is-house");
          if (c === HOUSE.c0 && r === HOUSE.r0) {
            cell.style.position = "relative";
          }
        }
        frag.appendChild(cell);
      }
    }
    gridEl.appendChild(frag);
    // House label overlay
    const label = document.createElement("div");
    label.textContent = "HOUSE";
    Object.assign(label.style, {
      position: "absolute", color: "#fff", fontFamily: "var(--font-disp)",
      fontWeight: "600", letterSpacing: ".1em", fontSize: ".8rem",
      pointerEvents: "none",
      left: (HOUSE.c0 * 22) + "px", top: (HOUSE.r0 * 22) + "px",
      width: ((HOUSE.c1 - HOUSE.c0 + 1) * 22) + "px",
      height: ((HOUSE.r1 - HOUSE.r0 + 1) * 22) + "px",
      display: "grid", placeItems: "center"
    });
    gridEl.appendChild(label);
  }

  function paint(cell) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (isHouse(c, r)) return; // protect house
    if (activeTool === "erase") {
      cellState[r][c] = null;
      cell.style.background = "";
    } else {
      cellState[r][c] = activeTool;
      cell.style.background = PALETTE_MAP[activeTool].color;
    }
  }

  function buildPalette() {
    const pal = $("#palette");
    PALETTE.forEach(p => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tool = p.id;
      if (p.id === activeTool) b.classList.add("is-active");
      const sw = document.createElement("span");
      sw.className = "swatch" + (p.id === "erase" ? " swatch--erase" : "");
      if (p.color) sw.style.background = p.color;
      b.append(sw, document.createTextNode(p.label));
      b.addEventListener("click", () => {
        activeTool = p.id;
        $$("#palette button").forEach(x => x.classList.toggle("is-active", x === b));
      });
      pal.appendChild(b);
    });
  }

  function bindGrid() {
    gridEl.addEventListener("pointerdown", e => {
      const cell = e.target.closest(".plot__cell");
      if (!cell) return;
      painting = true; paint(cell);
      gridEl.setPointerCapture?.(e.pointerId);
    });
    gridEl.addEventListener("pointerover", e => {
      if (!painting) return;
      const cell = e.target.closest(".plot__cell");
      if (cell) paint(cell);
    });
    window.addEventListener("pointerup", () => { painting = false; });
    // prevent native drag of grid
    gridEl.addEventListener("dragstart", e => e.preventDefault());
  }

  function clearPlot() {
    for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) {
      if (isHouse(c, r)) continue;
      cellState[r][c] = null;
    }
    $$(".plot__cell", gridEl).forEach(cell => {
      if (!cell.classList.contains("is-house")) cell.style.background = "";
    });
  }

  function applyPlotState(state) {
    if (!Array.isArray(state)) return;
    for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) {
      const v = state?.[r]?.[c] || null;
      if (isHouse(c, r)) continue;
      cellState[r][c] = v;
      const cell = gridEl.querySelector(`.plot__cell[data-r="${r}"][data-c="${c}"]`);
      if (cell) cell.style.background = v ? PALETTE_MAP[v]?.color || "" : "";
    }
  }

  // Render the grid model to a PNG for the preview/print
  function renderPlotImage() {
    const cs = 18, w = GRID_COLS * cs, h = GRID_ROWS * cs;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) {
      const x = c * cs, y = r * cs;
      if (isHouse(c, r)) { ctx.fillStyle = "#1f4e6b"; ctx.fillRect(x, y, cs, cs); continue; }
      const v = cellState[r][c];
      if (v) { ctx.fillStyle = PALETTE_MAP[v].color; ctx.fillRect(x, y, cs, cs); }
    }
    // grid lines
    ctx.strokeStyle = "#e3ddd0"; ctx.lineWidth = 1;
    for (let c = 0; c <= GRID_COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, h); ctx.stroke(); }
    for (let r = 0; r <= GRID_ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cs); ctx.lineTo(w, r * cs); ctx.stroke(); }
    ctx.strokeStyle = "#888"; ctx.strokeRect(.5, .5, w - 1, h - 1);
    // house label
    ctx.fillStyle = "#fff"; ctx.font = "600 12px Georgia"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("HOUSE", ((HOUSE.c0 + HOUSE.c1 + 1) / 2) * cs, ((HOUSE.r0 + HOUSE.r1 + 1) / 2) * cs);
    return cv.toDataURL("image/png");
  }

  function plotUsed() {
    return cellState.some(row => row.some(v => v));
  }

  buildGrid();
  buildPalette();
  bindGrid();
  $("#plot-clear").addEventListener("click", clearPlot);
  $("#plot-house").addEventListener("click", () => {
    $$(".plot__cell.is-house", gridEl).forEach(c => { c.style.background = ""; });
  });

  /* ------------------------------------------------------
     NEIGHBORS
  ------------------------------------------------------ */
  const neighborList = $("#neighbor-list");
  let neighborCount = 0;

  function neighborTemplate(n) {
    const idx = n;
    return `
      <div class="neighbor" data-neighbor="${idx}">
        <button type="button" class="neighbor__remove" aria-label="Remove neighbor" title="Remove">&times;</button>
        <div class="neighbor__num">Adjacent owner ${idx}</div>
        <div class="grid-2">
          <div class="field">
            <label>Name</label>
            <input type="text" name="nb_name_${idx}" />
          </div>
          <div class="field">
            <label>Address</label>
            <input type="text" name="nb_addr_${idx}" />
          </div>
        </div>
        <div class="grid-2">
          <div class="field field--sig">
            <label>Signature</label>
            <div class="sigpad" data-sigpad="nb_sig_${idx}">
              <canvas></canvas>
              <span class="sigpad__hint">Sign here</span>
              <button type="button" class="sigpad__clear" aria-label="Clear signature">Clear</button>
            </div>
          </div>
          <div class="field">
            <label>Date</label>
            <input type="date" name="nb_date_${idx}" />
          </div>
        </div>
      </div>`;
  }

  function addNeighbor() {
    neighborCount++;
    const wrap = document.createElement("div");
    wrap.innerHTML = neighborTemplate(neighborCount).trim();
    const node = wrap.firstChild;
    neighborList.appendChild(node);
    const pad = $(".sigpad", node);
    sigPads[pad.dataset.sigpad] = new SignaturePad(pad);
    $(".neighbor__remove", node).addEventListener("click", () => {
      delete sigPads[pad.dataset.sigpad];
      node.remove();
    });
    return node;
  }
  $("#add-neighbor").addEventListener("click", () => addNeighbor());
  // start with two neighbor blocks
  addNeighbor(); addNeighbor();

  /* ------------------------------------------------------
     ACKNOWLEDGMENTS
  ------------------------------------------------------ */
  const acksEl = $("#acks");
  ACKS.forEach((text, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<label>
        <input type="checkbox" name="ack_${i + 1}" required />
        <span class="ack-text">${text}</span>
      </label>`;
    acksEl.appendChild(li);
  });

  /* ------------------------------------------------------
     REVIEW DATES TABLE
  ------------------------------------------------------ */
  const datesBody = $("#dates-body");
  DATES.forEach(([meeting, deadline]) => {
    const tr = document.createElement("tr");
    if (meeting.includes("tentative")) tr.className = "tentative";
    tr.innerHTML = `<td>${meeting}</td><td>${deadline}</td>`;
    datesBody.appendChild(tr);
  });

  /* ------------------------------------------------------
     SCROLL-SPY NAV  +  REVEAL
  ------------------------------------------------------ */
  const navLinks = $$(".sidenav nav a");
  const sections = navLinks.map(a => $(a.getAttribute("href"))).filter(Boolean);
  const spy = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        navLinks.forEach(a => a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id));
      }
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.forEach(s => spy.observe(s));

  const revealer = new IntersectionObserver((entries, obs) => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); obs.unobserve(en.target); } });
  }, { threshold: 0.08 });
  $$(".reveal").forEach(el => revealer.observe(el));

  /* ------------------------------------------------------
     CHAR COUNTER + FILE LIST
  ------------------------------------------------------ */
  const proposal = $("#proposal");
  const proposalCount = $("#proposal-count");
  proposal.addEventListener("input", () => { proposalCount.textContent = proposal.value.length; });

  const fileInput = $("#photos");
  const fileList = $("#filelist");
  fileInput.addEventListener("change", () => {
    fileList.innerHTML = "";
    if (!fileInput.files.length) { fileList.hidden = true; return; }
    fileList.hidden = false;
    Array.from(fileInput.files).forEach(f => {
      const li = document.createElement("li");
      li.textContent = `${f.name} (${Math.round(f.size / 1024)} KB)`;
      fileList.appendChild(li);
    });
  });

  /* ------------------------------------------------------
     PROGRESS METER
  ------------------------------------------------------ */
  const form = $("#arc-form");
  function updateProgress() {
    const required = $$("#arc-form [required]");
    let done = 0;
    required.forEach(el => {
      if (el.type === "checkbox") { if (el.checked) done++; }
      else if (el.value && el.value.trim()) done++;
    });
    // count the two main signatures as required-ish
    let total = required.length + 2;
    if (!sigPads.ownerInfoSignature.isEmpty()) done++;
    if (!sigPads.ownerAckSignature.isEmpty()) done++;
    const pct = Math.round((done / total) * 100);
    $("#progress-fill").style.width = pct + "%";
    $("#progress-text").textContent = pct + "% complete";
  }
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);
  // also refresh after signing
  ["pointerup"].forEach(ev => document.addEventListener(ev, () => setTimeout(updateProgress, 50)));

  /* ------------------------------------------------------
     COLLECT DATA
  ------------------------------------------------------ */
  function collect() {
    const data = {
      ownerName: $("#owner-name").value.trim(),
      propertyAddress: $("#property-address").value.trim(),
      ownerPhone: $("#owner-phone").value.trim(),
      ownerEmail: $("#owner-email").value.trim(),
      ownerInfoSignature: sigPads.ownerInfoSignature.toDataURL(),
      submissions: {},
      proposal: proposal.value.trim(),
      neighbors: [],
      acks: {},
      ackDate: $("#ack-date").value,
      ownerAckSignature: sigPads.ownerAckSignature.toDataURL(),
      plot: cellState,
      files: fileInput.files ? Array.from(fileInput.files).map(f => f.name) : []
    };
    $$("#submissions input[type=checkbox]").forEach(c => data.submissions[c.name] = c.checked);
    $$(".neighbor").forEach(node => {
      const idx = node.dataset.neighbor;
      data.neighbors.push({
        name: $(`[name=nb_name_${idx}]`, node)?.value.trim() || "",
        address: $(`[name=nb_addr_${idx}]`, node)?.value.trim() || "",
        date: $(`[name=nb_date_${idx}]`, node)?.value || "",
        signature: sigPads[`nb_sig_${idx}`]?.toDataURL() || null
      });
    });
    $$("#acks input[type=checkbox]").forEach(c => data.acks[c.name] = c.checked);
    return data;
  }

  /* ------------------------------------------------------
     DRAFT PERSISTENCE
  ------------------------------------------------------ */
  function saveDraft(silent) {
    const d = collect();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      if (!silent) status("Draft saved in this browser.", "ok");
    } catch (e) {
      if (!silent) status("Could not save draft (storage full or blocked).", "err");
    }
  }

  function restoreDraft() {
    let raw;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return; }
    if (!raw) return;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    $("#owner-name").value = d.ownerName || "";
    $("#property-address").value = d.propertyAddress || "";
    $("#owner-phone").value = d.ownerPhone || "";
    $("#owner-email").value = d.ownerEmail || "";
    proposal.value = d.proposal || ""; proposalCount.textContent = proposal.value.length;
    $("#ack-date").value = d.ackDate || "";
    if (d.submissions) Object.entries(d.submissions).forEach(([k, v]) => { const el = $(`#submissions [name="${k}"]`); if (el) el.checked = v; });
    if (d.acks) Object.entries(d.acks).forEach(([k, v]) => { const el = $(`#acks [name="${k}"]`); if (el) el.checked = v; });
    // neighbors
    if (Array.isArray(d.neighbors) && d.neighbors.length) {
      neighborList.innerHTML = ""; neighborCount = 0;
      Object.keys(sigPads).forEach(k => { if (k.startsWith("nb_sig_")) delete sigPads[k]; });
      d.neighbors.forEach(nb => {
        const node = addNeighbor();
        const idx = node.dataset.neighbor;
        $(`[name=nb_name_${idx}]`, node).value = nb.name || "";
        $(`[name=nb_addr_${idx}]`, node).value = nb.address || "";
        $(`[name=nb_date_${idx}]`, node).value = nb.date || "";
        if (nb.signature) sigPads[`nb_sig_${idx}`].fromDataURL(nb.signature);
      });
    }
    // signatures
    setTimeout(() => {
      if (d.ownerInfoSignature) sigPads.ownerInfoSignature.fromDataURL(d.ownerInfoSignature);
      if (d.ownerAckSignature) sigPads.ownerAckSignature.fromDataURL(d.ownerAckSignature);
    }, 60);
    applyPlotState(d.plot);
    setTimeout(updateProgress, 200);
    status("Draft restored from your last session.", "ok");
  }

  $("#save-draft").addEventListener("click", () => saveDraft(false));
  $("#clear-draft").addEventListener("click", () => {
    if (!confirm("Clear all fields and delete the saved draft?")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    location.reload();
  });
  // autosave
  let saveTimer;
  form.addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(true), 1200); });

  /* ------------------------------------------------------
     VALIDATION + STATUS
  ------------------------------------------------------ */
  const statusEl = $("#form-status");
  function status(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "form-status" + (kind ? " " + kind : "");
  }

  function validate() {
    let firstBad = null;
    $$("#arc-form [required]").forEach(el => {
      let bad = false;
      if (el.type === "checkbox") bad = !el.checked;
      else bad = !el.value || !el.value.trim();
      if (el.type === "email" && el.value) bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value);
      el.classList.toggle("invalid", bad);
      if (bad && !firstBad) firstBad = el;
    });
    // signatures
    [["ownerInfoSignature", "#applicant"], ["ownerAckSignature", "#acknowledgments"]].forEach(([k]) => {
      const empty = sigPads[k].isEmpty();
      sigPads[k].wrap.classList.toggle("invalid", empty);
      if (empty && !firstBad) firstBad = sigPads[k].wrap;
    });
    return firstBad;
  }

  /* ------------------------------------------------------
     PREVIEW + PRINT
  ------------------------------------------------------ */
  const modal = $("#preview-modal");
  const previewContent = $("#preview-content");

  const esc = s => (s == null ? "" : String(s)).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const yn = b => b ? '<span class="yes">✓ Included</span>' : '<span class="no">— not checked</span>';
  const sigImg = url => url ? `<img class="sig-img" src="${url}" alt="signature" />` : '<span class="no">— not signed</span>';

  const SUB_LABELS = {
    req_plot: "Plot design with modification marked",
    req_sketches: "Sketches, dimensions, photos & materials",
    req_key: "Color-coded plan / key",
    req_photos: "Full yard photos",
    req_neighbors: "Impacted neighbor signatures",
    req_fee: "Application fee"
  };

  function buildPreview(d) {
    const subs = Object.entries(SUB_LABELS).map(([k, label]) =>
      `<li>${esc(label)} — ${yn(d.submissions[k])}</li>`).join("");
    const acks = ACKS.map((_, i) => {
      const k = "ack_" + (i + 1);
      return `<li>Item ${i + 1} — ${yn(d.acks[k])}</li>`;
    }).join("");
    const neighbors = d.neighbors.map((nb, i) => `
      <div style="margin:.6rem 0; padding:.6rem .8rem; border:1px solid #e0d9cd; border-radius:8px;">
        <strong>Adjacent owner ${i + 1}</strong>
        <dl>
          <dt>Name</dt><dd>${esc(nb.name) || '<span class="no">—</span>'}</dd>
          <dt>Address</dt><dd>${esc(nb.address) || '<span class="no">—</span>'}</dd>
          <dt>Date</dt><dd>${esc(nb.date) || '<span class="no">—</span>'}</dd>
          <dt>Signature</dt><dd>${sigImg(nb.signature)}</dd>
        </dl>
      </div>`).join("") || '<p class="no">No neighbors added.</p>';

    return `
      <div class="doc">
        <h3>Applicant Information</h3>
        <dl>
          <dt>Homeowner(s)</dt><dd>${esc(d.ownerName) || '<span class="no">—</span>'}</dd>
          <dt>Property Address</dt><dd>${esc(d.propertyAddress) || '<span class="no">—</span>'}</dd>
          <dt>Phone</dt><dd>${esc(d.ownerPhone) || '<span class="no">—</span>'}</dd>
          <dt>E-Mail</dt><dd>${esc(d.ownerEmail) || '<span class="no">—</span>'}</dd>
          <dt>Signature</dt><dd>${sigImg(d.ownerInfoSignature)}</dd>
        </dl>

        <h3>Required Submissions</h3>
        <ul class="doc-list">${subs}</ul>
        ${d.files.length ? `<p><strong>Attached files:</strong> ${d.files.map(esc).join(", ")}</p>` : ""}

        <h3>Site / Plot Plan</h3>
        ${plotUsed() ? `<img class="plot-img" src="${renderPlotImage()}" alt="Site plan" />` : '<p class="no">No site plan drawn.</p>'}

        <h3>Description of Proposed Change</h3>
        <div class="doc-block">${esc(d.proposal) || "—"}</div>

        <h3>Adjacent Property Owners</h3>
        ${neighbors}

        <h3>Owner Acknowledgments</h3>
        <ul class="doc-list">${acks}</ul>
        <dl style="margin-top:.6rem">
          <dt>Owner Signature</dt><dd>${sigImg(d.ownerAckSignature)}</dd>
          <dt>Date</dt><dd>${esc(d.ackDate) || '<span class="no">—</span>'}</dd>
        </dl>
      </div>`;
  }

  function openModal() { modal.hidden = false; document.body.style.overflow = "hidden"; }
  function closeModal() { modal.hidden = true; document.body.style.overflow = ""; }
  $$("[data-close]", modal).forEach(el => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const bad = validate();
    if (bad) {
      status("Please complete the highlighted required fields and signatures.", "err");
      bad.scrollIntoView({ behavior: "smooth", block: "center" });
      if (bad.focus) bad.focus({ preventScroll: true });
      return;
    }
    status("");
    const d = collect();
    saveDraft(true);
    previewContent.innerHTML = buildPreview(d);
    openModal();
  });

  $("#do-print").addEventListener("click", () => {
    // Print just the preview document
    const html = previewContent.innerHTML;
    const w = window.open("", "_blank");
    if (!w) { window.print(); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Fairway Canyon HOA — ARC Application</title>
      <meta charset="utf-8">
      <style>
        @page { margin: 18mm; }
        body { font-family: Georgia, 'Times New Roman', serif; color: #1d1a17; line-height: 1.5; }
        h1 { font-size: 20px; border-bottom: 4px solid #a4111f; padding-bottom: 8px; }
        h1 small { display:block; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color:#a4111f; font-weight:normal; }
        h3 { color:#7d0d18; border-bottom: 2px solid #a4111f; padding-bottom: 3px; margin-top: 20px; font-size: 14px; }
        dl { display: grid; grid-template-columns: 180px 1fr; gap: 4px 12px; }
        dt { font-weight: bold; } dd { margin: 0; }
        .doc-block { white-space: pre-wrap; background:#f7f4ee; padding:10px; border:1px solid #ddd; border-radius:6px; }
        img.sig-img { height: 60px; border:1px solid #ccc; } img.plot-img { max-width: 100%; border:1px solid #aaa; }
        .doc-list { padding-left: 18px; } .yes { color: #2f5d4a; } .no { color: #999; }
        ul, dl { font-size: 13px; }
      </style></head><body>
      <h1><small>Fairway Canyon Homeowners Association</small>Architectural Review Committee Application</h1>
      ${html}
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  });

  /* ------------------------------------------------------
     DOWNLOAD JSON
  ------------------------------------------------------ */
  $("#download-json").addEventListener("click", () => {
    const d = collect();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = (d.ownerName || "arc-application").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.download = `${name || "arc-application"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    status("Application data downloaded as JSON.", "ok");
  });

  /* ------------------------------------------------------
     INIT
  ------------------------------------------------------ */
  restoreDraft();
  updateProgress();
})();
