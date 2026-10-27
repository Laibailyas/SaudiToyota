/* Dashboard → Registrations
   Entries: every submission, grouped by race (and by form), filter racers / photographers, search, status,
            organiser fields, documents, e-mail status, CSV export, delete.
   Races:   open registration for a specific race — name, location, category, dates, deadline — and choose
            whether racers, photographers or both can register. Also the e-mail notification settings.
   Forms:   add, edit, reorder, close or delete the registration forms, their steps and fields.
   Saved races and forms are served from /api/registration-races, so the website updates immediately. */
(() => {
  const root = document.getElementById("registrations-layout");
  const switcher = document.querySelector(".mode-switch");
  const modeButton = switcher?.querySelector('[data-mode="registrations"]');
  if (!root || !switcher || !modeButton) return;

  const TYPES = [
    ["text", "Text"], ["textarea", "Long text"], ["email", "E-mail"], ["tel", "Phone"], ["number", "Number"], ["date", "Date"],
    ["select", "Dropdown"], ["radio", "Single choice"], ["checkboxes", "Multiple choice"], ["checkbox", "Confirmation tick box"],
    ["file", "File upload"], ["heading", "Section heading"], ["note", "Information note"],
  ];
  const TYPE_LABEL = Object.fromEntries(TYPES);
  const OPS = [["eq", "is"], ["neq", "is not"], ["in", "is one of (comma separated)"], ["lt", "is less than"], ["gte", "is at least"], ["filled", "is filled in"], ["empty", "is empty"]];
  const STATUSES = [["new", "New"], ["in_review", "In review"], ["accepted", "Accepted"], ["refused", "Refused"]];
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  const OPTION_TYPES = ["select", "radio", "checkboxes"];
  const ROLES = [["racer", "Racer"], ["photographer", "Photographer"]];
  const ROLE_LABEL = Object.fromEntries(ROLES);
  const MAIL_LABEL = { sent: "Sent", failed: "Failed", not_configured: "E-mail not set up", no_address: "No address", off: "Turned off" };
  const NAME_KEYS = ["driver_full_name", "competitor_name", "full_name", "name", "sign_driver"];
  const MOBILE_KEYS = ["driver_mobile", "competitor_mobile", "guardian_mobile", "mobile"];
  const EMAIL_KEYS = ["driver_email", "competitor_email", "guardian_email", "email"];
  const CLASS_KEYS = ["category", "class", "group"];

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const slug = (v, sep = "-") => String(v || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, "g"), "");
  const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const money = (n) => n == null || n === "" ? "" : `${Number(n).toLocaleString("en-US")} SAR`;

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
    return data;
  }

  root.innerHTML = `
    <aside class="race-side reg-side">
      <span class="eyebrow">REGISTRATIONS</span>
      <div class="reg-sub" role="tablist">
        <button type="button" class="on" data-view="entries">Entries</button>
        <button type="button" data-view="races">Races</button>
        <button type="button" data-view="forms">Forms</button>
      </div>
      <div data-el="side"></div>
      <p class="scores-status" data-el="status" role="status"></p>
    </aside>
    <section class="race-editor reg-main" data-el="main"></section>
    <div class="reg-drawer" data-el="drawer" hidden></div>`;
  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const side = $("side"), main = $("main"), drawer = $("drawer"), statusEl = $("status");

  const state = {
    view: "entries", loaded: false, doc: null, saved: null, entries: [],
    formId: "all", raceId: "all", role: "", search: "", status: "", selected: new Set(),
    editForm: 0, openField: null, dirty: false,
    races: null, racesSaved: null, racesDirty: false, editRace: 0, mail: {},
  };

  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `scores-status ${kind}`;
  }
  function markDirty() {
    state.dirty = true;
    setStatus("Unsaved form changes – click Save & publish.", "dirty");
    const save = main.querySelector('[data-a="save-forms"]');
    if (save) save.disabled = false;
  }

  /* ------------------------------------------------------------------ data */
  async function load(force = false) {
    if (state.loaded && !force) return render();
    setStatus("Loading…");
    try {
      const [formsDoc, entries, racesDoc] = await Promise.all([api("/api/dashboard/registration-forms"), api("/api/dashboard/registrations"), api("/api/dashboard/registration-races")]);
      if (!state.dirty) { state.doc = clone(formsDoc); state.saved = clone(formsDoc); }
      state.mail = racesDoc.mail || {};
      delete racesDoc.mail;
      if (!state.racesDirty) { state.races = clone(racesDoc); state.racesSaved = clone(racesDoc); }
      state.entries = entries.entries || [];
      state.loaded = true;
      setStatus(state.dirty ? "Unsaved form changes – click Save & publish." : `${state.entries.length} entr${state.entries.length === 1 ? "y" : "ies"} loaded.`, state.dirty ? "dirty" : "");
    } catch (error) {
      setStatus(error.message, "error");
    }
    render();
  }
  const forms = () => state.doc?.forms || [];
  const formById = (id) => forms().find((f) => f.id === id);
  function fieldsOf(form) { return form ? form.steps.flatMap((s) => s.fields) : []; }
  function inputFields(form) { return fieldsOf(form).filter((f) => !["heading", "note"].includes(f.type)); }

  function pick(entry, keys) { for (const k of keys) if (entry.data?.[k]) return entry.data[k]; return ""; }
  function optionLabel(entry, fid, value) {
    const field = fieldsOf(formById(entry.form)).find((f) => f.id === fid);
    const list = Array.isArray(value) ? value : [value];
    if (field?.options) return list.map((v) => field.options.find((o) => o.value === v)?.label || v).join(", ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return list.join(", ");
  }
  function entryValue(entry, fid, type) {
    if (type === "file" || entry.files?.[fid]) return entry.files?.[fid]?.name || "";
    const v = entry.data?.[fid];
    if (v === true) return "Yes";
    if (v == null || v === "" || v === false) return "";
    return optionLabel(entry, fid, v);
  }
  const roleOf = (e) => e.role || (formById(e.form)?.role === "photographer" ? "photographer" : "racer");
  const raceKey = (e) => e.race?.id || "none";
  function filteredEntries() {
    const q = state.search.trim().toLowerCase();
    return state.entries.filter((e) => (state.formId === "all" || e.form === state.formId)
      && (state.raceId === "all" || raceKey(e) === state.raceId)
      && (!state.role || roleOf(e) === state.role)
      && (!state.status || e.status === state.status)
      && (!q || [e.ref, e.form_title, e.race?.name, e.race?.location, ...Object.values(e.data || {}).flat(), ...Object.values(e.files || {}).map((f) => f.name), e.admin?.competition_no, e.admin?.entry_no]
        .some((v) => String(v ?? "").toLowerCase().includes(q))));
  }
  const racesList = () => state.races?.races || [];
  const raceById = (id) => racesList().find((r) => r.id === id);
  const isRaceLive = (r) => r.open && (!r.deadline || new Date(`${r.deadline}:00+03:00`) > new Date());
  function raceDates(r) {
    if (!r?.date) return "";
    const f = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return r.date_end && r.date_end > r.date ? `${f(r.date)} – ${f(r.date_end)}` : f(r.date);
  }
  function raceTitle(id) {
    if (id === "none") return "Without a race (before races)";
    return raceById(id)?.name || state.entries.find((e) => e.race?.id === id)?.race?.name || id;
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    root.querySelectorAll(".reg-sub button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
    if (state.view === "entries") renderEntriesSide(), renderEntries();
    else if (state.view === "races") renderRacesSide(), renderRaceEditor();
    else renderFormsSide(), renderFormEditor();
  }

  function renderEntriesSide() {
    const count = (pred) => state.entries.filter(pred).length;
    const item = (attr, id, on, title, sub, color) => `<button type="button" class="race-item reg-item${on ? " on" : ""}" ${attr}="${esc(id)}">
      <strong><i class="reg-dot" style="background:${esc(color || "#df2635")}"></i>${esc(title)}</strong><span>${sub}</span></button>`;
    const newBadge = (pred) => { const n = count((e) => pred(e) && e.status === "new"); return n ? ` · <b class="reg-new">${n} new</b>` : ""; };
    const raceSub = (id) => {
      const inRace = (e) => raceKey(e) === id;
      const r = count((e) => inRace(e) && roleOf(e) === "racer"), ph = count((e) => inRace(e) && roleOf(e) === "photographer");
      return `${r} racer${r === 1 ? "" : "s"} · ${ph} photographer${ph === 1 ? "" : "s"}${newBadge(inRace)}`;
    };
    const formSub = (id) => { const n = count((e) => e.form === id); return `${n} entr${n === 1 ? "y" : "ies"}${newBadge((e) => e.form === id)}`; };
    const allOn = state.raceId === "all" && state.formId === "all";
    const current = racesList().map((r) => r.id);
    const pastIds = [...new Set(state.entries.map(raceKey))].filter((id) => !current.includes(id));
    const raceColor = (id) => formById(raceById(id)?.category || state.entries.find((e) => e.race?.id === id)?.race?.category)?.color;
    const raceItem = (id) => item("data-race", id, state.raceId === id, raceTitle(id),
      raceSub(id) + (raceById(id) ? (isRaceLive(raceById(id)) ? ' · <span class="reg-live">open</span>' : ' · <span class="draft">closed</span>') : ""), raceColor(id) || "#788694");
    const archived = [...new Set(state.entries.map((e) => e.form))].filter((id) => !formById(id));
    side.innerHTML = `<div class="race-items">${item("data-race", "all", allOn, "All registrations", `${state.entries.length} entries${newBadge(() => true)}`, "#788694")}
      <p class="reg-side-label">Races</p>
      ${current.length ? current.map(raceItem).join("") : '<p class="field-hint">No races yet. Open one under Races.</p>'}
      ${pastIds.length ? `<p class="reg-side-label">Deleted races / earlier entries</p>${pastIds.map(raceItem).join("")}` : ""}
      <p class="reg-side-label">By form</p>
      ${forms().map((f) => item("data-form", f.id, state.formId === f.id, f.title, formSub(f.id) + (f.role === "photographer" ? " · photographer" : "") + (f.open === false ? ' · <span class="draft">closed</span>' : ""), f.color)).join("")}
      ${archived.length ? `<p class="reg-side-label">Deleted forms</p>${archived.map((id) => item("data-form", id, state.formId === id, state.entries.find((e) => e.form === id)?.form_title || id, formSub(id), "#555")).join("")}` : ""}
    </div><button type="button" class="quiet" data-a="refresh">↻ Refresh entries</button>`;
  }

  function renderEntries() {
    const list = filteredEntries();
    const form = formById(state.formId);
    const race = state.raceId !== "all" ? raceById(state.raceId) : null;
    const scope = state.entries.filter((e) => (state.formId === "all" || e.form === state.formId) && (state.raceId === "all" || raceKey(e) === state.raceId));
    const title = state.raceId !== "all" ? raceTitle(state.raceId)
      : state.formId === "all" ? "All registrations" : (form?.title || state.entries.find((e) => e.form === state.formId)?.form_title || state.formId);
    const sub = race ? `${esc(formById(race.category)?.title || race.category)} · ${esc(race.location)}${race.date ? ` · ${esc(raceDates(race))}` : ""} · ` : "";
    const showRace = state.raceId === "all";
    state.selected.forEach((key) => { if (!list.some((e) => key === `${e.form}/${e.id}`)) state.selected.delete(key); });
    const mailCell = (e) => { const m = e.mail?.registrant; return m ? `<span class="reg-mail m-${esc(m)}" title="${esc(MAIL_LABEL[m] || m)}${e.mail?.to ? ` – ${esc(e.mail.to)}` : ""}">${m === "sent" ? "✓ Sent" : esc(MAIL_LABEL[m] || m)}</span>` : '<span class="na">—</span>'; };
    main.innerHTML = `
      <div class="race-form-head"><div><span class="eyebrow">ENTRIES</span><h2>${esc(title)}</h2>
        <p class="field-hint">${sub}${list.length} of ${scope.length} entries shown · ${scope.filter((e) => roleOf(e) === "racer").length} racers, ${scope.filter((e) => roleOf(e) === "photographer").length} photographers. Click an entry to open it.</p></div>
        <div class="race-actions">
          <button type="button" data-a="export"${list.length ? "" : " disabled"}>Export CSV (Excel)</button>
          <button type="button" class="danger" data-a="delete-selected"${state.selected.size ? "" : " disabled"}>Delete selected (${state.selected.size})</button>
        </div></div>
      <div class="reg-filters">
        <input class="field" type="search" data-a="search" placeholder="Search name, reference, mobile, e-mail, race…" value="${esc(state.search)}">
        <select class="field" data-a="role-filter"><option value="">Racers &amp; photographers</option>${ROLES.map(([v, l]) => `<option value="${v}"${state.role === v ? " selected" : ""}>${l}s only</option>`).join("")}</select>
        <select class="field" data-a="status-filter"><option value="">All statuses</option>${STATUSES.map(([v, l]) => `<option value="${v}"${state.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div class="table-shell"><table class="rows-table reg-table"><thead><tr>
        <th class="c-chk"><input type="checkbox" data-a="select-all" aria-label="Select all"${list.length && list.every((e) => state.selected.has(`${e.form}/${e.id}`)) ? " checked" : ""}></th>
        <th>Reference</th><th>Submitted</th>${showRace ? "<th>Race</th>" : ""}<th>Type</th><th>Name</th><th>Mobile</th><th>E-mail</th><th>Category / Class</th><th>Total</th><th>Confirmation</th><th>Status</th>
      </tr></thead><tbody>
      ${list.map((e) => {
        const key = `${e.form}/${e.id}`;
        const cls = CLASS_KEYS.map((k) => e.data?.[k] ? optionLabel(e, k, e.data[k]) : "").find(Boolean) || "";
        const role = roleOf(e);
        return `<tr data-open="${esc(key)}" class="reg-row">
          <td class="c-chk"><input type="checkbox" data-sel="${esc(key)}"${state.selected.has(key) ? " checked" : ""} aria-label="Select ${esc(e.ref)}"></td>
          <td><b>${esc(e.ref)}</b></td><td class="nowrap">${esc(fmtDate(e.created))}</td>
          ${showRace ? `<td>${esc(e.race?.name || "—")}</td>` : ""}
          <td><span class="reg-role r-${esc(role)}">${esc(ROLE_LABEL[role] || role)}</span></td>
          <td>${esc(pick(e, NAME_KEYS))}</td><td class="nowrap">${esc(pick(e, MOBILE_KEYS))}</td><td>${esc(pick(e, EMAIL_KEYS))}</td>
          <td>${esc(cls || (role === "racer" ? e.race?.category_title || "" : ""))}</td><td class="nowrap">${esc(money(e.total))}</td>
          <td class="nowrap">${mailCell(e)}</td>
          <td><span class="reg-pill s-${esc(e.status)}">${esc(STATUS_LABEL[e.status] || e.status)}</span></td></tr>`;
      }).join("")}
      </tbody></table>${list.length ? "" : `<p class="rows-empty">${state.entries.length ? "No entries match these filters." : "No registrations yet. Entries appear here as soon as racers or photographers register for an open race."}</p>`}</div>`;
  }

  /* ---------------------------------------------------------------- entry drawer */
  function openEntry(key) {
    const entry = state.entries.find((e) => `${e.form}/${e.id}` === key);
    if (!entry) return;
    const a = entry.admin || {};
    const fileUrl = (ref, inline) => `/api/dashboard/registrations/file?token=${encodeURIComponent(ref.token)}&name=${encodeURIComponent(ref.name)}${inline ? "&inline=1" : ""}`;
    const groups = (entry.snapshot || []).map((g) => `<div class="rv"><h4>${esc(g.step)}</h4><dl>${g.fields.map((f) => {
      const ref = entry.files?.[f.id];
      const value = ref ? `<a href="${esc(fileUrl(ref, true))}" target="_blank" rel="noopener">${esc(ref.name)}</a> · <a href="${esc(fileUrl(ref))}">Download</a>` : esc(entryValue(entry, f.id, f.type)) || '<span class="na">—</span>';
      return `<div${f.label.length > 60 || ref ? ' class="w"' : ""}><dt>${esc(f.label)}</dt><dd>${value}</dd></div>`;
    }).join("")}</dl></div>`).join("");
    drawer.innerHTML = `<div class="reg-panel" role="dialog" aria-modal="true" aria-label="Registration ${esc(entry.ref)}">
      <div class="reg-panel-head"><div><span class="eyebrow">${esc(ROLE_LABEL[roleOf(entry)] || "")} · ${esc(formById(entry.form)?.title || entry.form_title)}</span><h2>${esc(entry.ref)}</h2>
        <p class="field-hint">Submitted ${esc(fmtDate(entry.created))}${entry.lang === "ar" ? " · Arabic form" : ""}${entry.total != null ? ` · Total ${esc(money(entry.total))}` : ""}</p></div>
        <button type="button" class="quiet" data-a="close" aria-label="Close">✕</button></div>
      ${entry.race ? `<div class="reg-race-box"><div><span>Race</span><b>${esc(entry.race.name)}</b></div><div><span>Category</span><b>${esc(entry.race.category_title)}</b></div>
        <div><span>Location</span><b>${esc(entry.race.location)}</b></div><div><span>Date</span><b>${esc(entry.race.date_label || "—")}</b></div><div><span>Registered as</span><b>${esc(ROLE_LABEL[roleOf(entry)])}</b></div></div>` : ""}
      <div class="reg-mail-box"><div><b>E-mails</b>
        <span>Confirmation to registrant: <em class="m-${esc(entry.mail?.registrant || "none")}">${esc(MAIL_LABEL[entry.mail?.registrant] || "not sent")}</em>${entry.mail?.to ? ` (${esc(entry.mail.to)})` : ""}</span>
        <span>Notification to organisers: <em class="m-${esc(entry.mail?.admin || "none")}">${esc(MAIL_LABEL[entry.mail?.admin] || "not sent")}</em>${entry.mail?.admins?.length ? ` (${esc(entry.mail.admins.join(", "))})` : ""}</span>
        ${entry.mail?.error ? `<span class="reg-mail-err">${esc(entry.mail.error)}</span>` : ""}</div>
        ${entry.race ? `<button type="button" data-a="resend" data-key="${esc(key)}">Resend e-mails</button>` : ""}</div>
      <div class="reg-official">
        <h3>For official use only</h3>
        <div class="race-grid">
          <label>Status<select class="field" data-adm="status">${STATUSES.map(([v, l]) => `<option value="${v}"${entry.status === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Entry No.<input class="field" data-adm="entry_no" value="${esc(a.entry_no)}"></label>
          <label>Competition No. allocated<input class="field" data-adm="competition_no" value="${esc(a.competition_no)}"></label>
          <label>Category / Class confirmed<input class="field" data-adm="class_confirmed" value="${esc(a.class_confirmed)}"></label>
          <label>Received by<input class="field" data-adm="received_by" value="${esc(a.received_by)}"></label>
          <label class="check"><input type="checkbox" data-adm="fee_received"${a.fee_received ? " checked" : ""}> Fee received</label>
          <label class="span-2">Remarks<textarea class="field" rows="2" data-adm="remarks">${esc(a.remarks)}</textarea></label>
        </div>
        <div class="race-actions"><button type="button" class="primary" data-a="save-entry" data-key="${esc(key)}">Save</button>
          <button type="button" data-a="print-entry" data-key="${esc(key)}">Print</button>
          <button type="button" class="danger" data-a="delete-entry" data-key="${esc(key)}">Delete entry</button></div>
      </div>
      <div class="reg-detail">${groups || '<p class="rows-empty">No details stored.</p>'}</div></div>`;
    drawer.hidden = false;
    drawer.querySelector('[data-a="close"]').focus();
  }
  function closeEntry() { drawer.hidden = true; drawer.innerHTML = ""; }

  function printEntry(entry) {
    const rows = (entry.snapshot || []).map((g) => `<h3>${esc(g.step)}</h3><table>${g.fields.map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(entryValue(entry, f.id, f.type)) || "—"}</td></tr>`).join("")}</table>`).join("");
    const a = entry.admin || {};
    const w = window.open("", "_blank");
    if (!w) return setStatus("Allow pop-ups to print entries.", "error");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(entry.ref)}</title><style>body{font:13px/1.5 Arial,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0}h3{margin:22px 0 6px;font-size:14px;border-bottom:2px solid #c00;padding-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}th{width:40%;background:#f6f6f6;font-weight:600}</style>
      <h1>${esc(entry.form_title)} – ${esc(ROLE_LABEL[roleOf(entry)] || "Entry")} Form</h1>${entry.race ? `<p>Race <b>${esc(entry.race.name)}</b> · ${esc(entry.race.category_title)} · ${esc(entry.race.location)}${entry.race.date_label ? ` · ${esc(entry.race.date_label)}` : ""}</p>` : ""}<p>Reference <b>${esc(entry.ref)}</b> · Submitted ${esc(fmtDate(entry.created))} · Status ${esc(STATUS_LABEL[entry.status] || entry.status)}${entry.total != null ? ` · Total ${esc(money(entry.total))}` : ""}</p>
      ${rows}<h3>For official use only</h3><table><tr><th>Entry No.</th><td>${esc(a.entry_no)}</td></tr><tr><th>Competition No. allocated</th><td>${esc(a.competition_no)}</td></tr><tr><th>Category / Class confirmed</th><td>${esc(a.class_confirmed)}</td></tr><tr><th>Fee received</th><td>${a.fee_received ? "Yes" : "No"}</td></tr><tr><th>Received by</th><td>${esc(a.received_by)}</td></tr><tr><th>Remarks</th><td>${esc(a.remarks)}</td></tr></table>`);
    w.document.close();
    w.focus();
    w.print();
  }

  async function deleteEntries(keys) {
    if (!keys.length) return;
    if (!window.confirm(`Delete ${keys.length} entr${keys.length === 1 ? "y" : "ies"} and their uploaded documents? This cannot be undone.`)) return;
    setStatus("Deleting…");
    try {
      const items = keys.map((k) => { const [form, id] = k.split("/"); return { form, id }; });
      const result = await api("/api/dashboard/registrations/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      state.entries = state.entries.filter((e) => !keys.includes(`${e.form}/${e.id}`));
      keys.forEach((k) => state.selected.delete(k));
      closeEntry();
      setStatus(`${result.deleted} entr${result.deleted === 1 ? "y" : "ies"} deleted.`);
      render();
    } catch (error) { setStatus(error.message, "error"); }
  }

  function exportCsv() {
    const list = filteredEntries();
    const cols = new Map();
    const addFields = (fid, label, type) => { if (!cols.has(fid)) cols.set(fid, { label, type }); };
    const formIds = state.formId === "all" ? [...new Set(list.map((e) => e.form))] : [state.formId];
    formIds.forEach((id) => inputFields(formById(id)).forEach((f) => addFields(f.id, f.label, f.type)));
    list.forEach((e) => (e.snapshot || []).forEach((g) => g.fields.forEach((f) => addFields(f.id, f.label, f.type))));
    const head = ["Reference", "Race", "Race category", "Race location", "Race date", "Registered as", "Form", "Submitted", "Status", "Confirmation e-mail", "Total (SAR)", "Entry No.", "Competition No. allocated", "Category / Class confirmed", "Fee received", "Received by", "Remarks", ...[...cols.values()].map((c) => c.label)];
    const rows = list.map((e) => [e.ref, e.race?.name || "", e.race?.category_title || "", e.race?.location || "", e.race?.date_label || "", ROLE_LABEL[roleOf(e)] || "",
      formById(e.form)?.title || e.form_title, fmtDate(e.created), STATUS_LABEL[e.status] || e.status, MAIL_LABEL[e.mail?.registrant] || "", e.total ?? "",
      e.admin?.entry_no, e.admin?.competition_no, e.admin?.class_confirmed, e.admin?.fee_received ? "Yes" : "No", e.admin?.received_by, e.admin?.remarks,
      ...[...cols.entries()].map(([fid, c]) => entryValue(e, fid, c.type))]);
    const cell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const scopeName = [state.raceId !== "all" ? slug(raceTitle(state.raceId)) : "", state.formId !== "all" ? state.formId : "", state.role ? `${state.role}s` : ""].filter(Boolean).join("-") || "all";
    a.download = `registrations-${scopeName}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------------------------------------------------------------- races */
  function markRacesDirty() {
    state.racesDirty = true;
    setStatus("Unsaved race changes – click Save & publish.", "dirty");
    main.querySelectorAll('[data-a="save-races"],[data-a="discard-races"]').forEach((b) => { b.disabled = false; });
  }
  const racerForms = () => forms().filter((f) => f.role !== "photographer");
  const photographerForms = () => forms().filter((f) => f.role === "photographer");
  function raceState(r) {
    if (!r.open) return ["closed", "Closed – not shown on the website"];
    if (r.deadline && new Date(`${r.deadline}:00+03:00`) <= new Date()) return ["closed", "Deadline passed – registration closed"];
    return ["live", "Open – shown on the registration page"];
  }
  function renderRacesSide() {
    const list = racesList();
    side.innerHTML = `<div class="race-items">${list.map((r, i) => {
      const [kind, label] = raceState(r);
      const n = state.entries.filter((e) => e.race?.id === r.id).length;
      return `<button type="button" class="race-item${state.editRace === i ? " on" : ""}" data-edit-race="${i}">
        <strong><i class="reg-dot" style="background:${esc(formById(r.category)?.color || "#df2635")}"></i>${esc(r.name || "New race")}</strong>
        <span>${esc(formById(r.category)?.title || "No category")}${r.date ? ` · ${esc(raceDates(r))}` : ""}</span>
        <span><span class="${kind === "live" ? "reg-live" : "draft"}">${kind === "live" ? "open" : "closed"}</span> · ${n} entr${n === 1 ? "y" : "ies"}</span></button>`;
    }).join("") || '<p class="field-hint">No races yet.</p>'}</div>
      <button type="button" data-a="add-race">+ Open registration for a race</button>
      <a class="quiet-link" href="/registration.html" target="_blank" rel="noopener">Open registration page ↗</a>`;
  }
  function mailPanel() {
    const st = state.races?.settings || {};
    const m = state.mail || {};
    return `<div class="reg-mail-settings">
      <div class="results-head"><div><h3>E-mail notifications</h3>
        <p class="field-hint">${m.configured ? `E-mails are sent from <b>${esc(m.sender)}</b> via ${esc(m.host)}.` : `<b class="reg-warn">E-mail is not set up on the server yet.</b> Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM (see README). Registrations are still saved; e-mails start once it is set up.`}</p></div></div>
      <div class="race-grid">
        <label class="span-2">Organiser e-mails that receive every new registration (comma separated)<input class="field" data-rs="notify_emails" value="${esc(st.notify_emails)}" placeholder="registrations@example.com, team@example.com"></label>
        <label class="check"><input type="checkbox" data-rs="send_confirmation"${st.send_confirmation !== false ? " checked" : ""}> Send confirmation to the person who registers</label>
        <label class="check"><input type="checkbox" data-rs="send_admin"${st.send_admin !== false ? " checked" : ""}> Send notification to the organiser e-mails</label>
        <label class="span-2">Send a test e-mail to<input class="field" type="email" data-test-to placeholder="you@example.com"></label>
        <div class="check"><button type="button" data-a="test-email">Send test e-mail</button></div>
      </div></div>`;
  }
  function renderRaceEditor() {
    const r = racesList()[state.editRace];
    const actions = `<button type="button" data-a="discard-races"${state.racesDirty ? "" : " disabled"}>Discard changes</button>
      <button type="button" class="primary" data-a="save-races"${state.racesDirty ? "" : " disabled"}>Save &amp; publish</button>`;
    if (!r) {
      main.innerHTML = `<div class="race-form-head"><div><span class="eyebrow">RACES</span><h2>Race registration</h2>
        <p class="field-hint">Open registration for a race: enter the race name, location and category. Visitors then choose to register as a racer or a photographer.</p></div>
        <div class="race-actions">${actions}</div></div>
        <div class="race-empty"><div><h2>No races open yet</h2><p>The registration page shows “Registration is not open” until you open a race.</p><button type="button" class="primary" data-a="add-race">+ Open registration for a race</button></div></div>
        ${mailPanel()}`;
      return;
    }
    const [kind, label] = raceState(r);
    const n = state.entries.filter((e) => e.race?.id === r.id);
    const link = `${location.origin}/registration.html?race=${encodeURIComponent(r.id)}`;
    const opt = (list, value) => list.map((f) => `<option value="${esc(f.id)}"${value === f.id ? " selected" : ""}>${esc(f.title)}</option>`).join("");
    main.innerHTML = `
      <div class="race-form-head"><div><span class="eyebrow">RACE REGISTRATION</span><h2>${esc(r.name || "New race")}</h2>
        <p class="field-hint"><span class="${kind === "live" ? "reg-live" : "draft"}">${esc(label)}</span> · ${n.filter((e) => roleOf(e) === "racer").length} racers, ${n.filter((e) => roleOf(e) === "photographer").length} photographers registered.</p></div>
        <div class="race-actions">
          <button type="button" data-a="race-entries"${n.length ? "" : " disabled"}>View entries (${n.length})</button>
          <button type="button" data-a="dup-race">Duplicate</button>
          <button type="button" class="danger" data-a="del-race">Delete</button>
          ${actions}
        </div></div>
      <div class="race-grid">
        <label class="span-2">Race name (English)<input class="field" data-rk="name" value="${esc(r.name)}" maxlength="160" placeholder="e.g. Drift Championship – Round 2"></label>
        <label class="span-2">Race name (Arabic)<input class="field" dir="rtl" data-rk="name_ar" value="${esc(r.name_ar)}" maxlength="160"></label>
        <label class="span-2">Location (English)<input class="field" data-rk="location" value="${esc(r.location)}" maxlength="160" placeholder="e.g. Riyadh – Dirab Motor Park"></label>
        <label class="span-2">Location (Arabic)<input class="field" dir="rtl" data-rk="location_ar" value="${esc(r.location_ar)}" maxlength="160"></label>
        <label>Race category<select class="field" data-rk="category"><option value="">— Choose —</option>${opt(racerForms(), r.category)}</select></label>
        <label>Start date<input class="field" type="date" data-rk="date" value="${esc(r.date)}"></label>
        <label>End date (optional)<input class="field" type="date" data-rk="date_end" value="${esc(r.date_end)}"></label>
        <label>Registration deadline (KSA time, optional)<input class="field" type="datetime-local" data-rk="deadline" value="${esc(r.deadline)}"></label>
        <label class="check"><input type="checkbox" data-rk="open"${r.open ? " checked" : ""}> Registration open</label>
        <label class="check"><input type="checkbox" data-rk="racers"${r.racers !== false ? " checked" : ""}> Racers can register</label>
        <label class="check"><input type="checkbox" data-rk="photographers"${r.photographers !== false ? " checked" : ""}> Photographers can register</label>
        ${photographerForms().length > 1 ? `<label>Photographer form<select class="field" data-rk="photographer_form">${opt(photographerForms(), r.photographer_form)}</select></label>` : "<span></span>"}
        <label class="span-2">Notes shown on the registration page (English, one per line)<textarea class="field" rows="3" data-rk="notes">${esc(r.notes)}</textarea></label>
        <label class="span-2">Notes (Arabic, one per line)<textarea class="field" rows="3" dir="rtl" data-rk="notes_ar">${esc(r.notes_ar)}</textarea></label>
        <p class="field-hint hint">Racers fill in the <b>${esc(formById(r.category)?.title || "category")}</b> form (its Round / Venue / Event dates are filled in from this race); photographers fill in the <b>${esc(formById(r.photographer_form)?.title || photographerForms()[0]?.title || "photographer")}</b> form. Direct link: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>
      </div>
      ${mailPanel()}`;
  }
  function newRace() {
    const today = new Date().toISOString().slice(0, 10);
    return { id: `race-${Date.now().toString(36)}`, name: "", name_ar: "", location: "", location_ar: "", category: racerForms()[0]?.id || "",
      photographer_form: photographerForms()[0]?.id || "", date: today, date_end: "", deadline: "", open: true, racers: true, photographers: true, notes: "", notes_ar: "" };
  }
  function onRaceInput(el) {
    if (el.dataset.rs) {
      state.races.settings ||= {};
      state.races.settings[el.dataset.rs] = el.type === "checkbox" ? el.checked : el.value;
      return markRacesDirty();
    }
    const r = racesList()[state.editRace];
    if (!r || !el.dataset.rk) return;
    const k = el.dataset.rk;
    r[k] = el.type === "checkbox" ? el.checked : el.value;
    markRacesDirty();
    if (k === "name") { main.querySelector(".race-form-head h2").textContent = r.name || "New race"; renderRacesSide(); }
    if (["category", "date", "open", "deadline", "photographer_form"].includes(k)) render();
  }
  async function saveRaces() {
    const btn = main.querySelector('[data-a="save-races"]');
    if (btn) btn.disabled = true;
    setStatus("Saving and publishing…");
    try {
      const result = await api("/api/dashboard/registration-races", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ races: racesList(), settings: state.races.settings || {} }) });
      state.races = { version: 1, updated: result.updated, races: result.races, settings: result.settings };
      state.racesSaved = clone(state.races);
      state.racesDirty = false;
      state.editRace = Math.min(state.editRace, racesList().length - 1);
      setStatus("Saved and published. Open races now show on the registration page.");
      render();
    } catch (error) {
      if (btn) btn.disabled = false;
      setStatus(error.message, "error");
    }
  }
  function raceAction(action) {
    const list = racesList();
    const r = list[state.editRace];
    if (action === "add-race") {
      if (!racerForms().length) return setStatus("Add a racer form under Forms first.", "error");
      list.unshift(newRace()); state.editRace = 0;
    } else if (action === "dup-race" && r) {
      list.splice(state.editRace + 1, 0, { ...clone(r), id: `race-${Date.now().toString(36)}`, name: `${r.name} (copy)`, open: false }); state.editRace += 1;
    } else if (action === "del-race" && r) {
      const n = state.entries.filter((e) => e.race?.id === r.id).length;
      if (!window.confirm(`Delete "${r.name || "this race"}"?${n ? ` Its ${n} entries stay available under Entries.` : ""} The change goes live when you save.`)) return;
      list.splice(state.editRace, 1); state.editRace = Math.max(0, state.editRace - 1);
    } else return;
    markRacesDirty();
    render();
  }

  /* ---------------------------------------------------------------- forms side */
  function renderFormsSide() {
    side.innerHTML = `<div class="race-items">${forms().map((f, i) => `
      <div class="reg-form-item${state.editForm === i ? " on" : ""}">
        <button type="button" class="race-item" data-edit-form="${i}"><strong><i class="reg-dot" style="background:${esc(f.color)}"></i>${esc(f.title)}</strong>
          <span>${f.role === "photographer" ? "Photographer" : "Racer"} · ${f.steps.length} steps · ${inputFields(f).length} fields${f.open === false ? ' · <span class="draft">closed</span>' : ""}</span></button>
        <div class="row-acts"><button type="button" data-a="form-up" data-i="${i}" title="Move tab left" aria-label="Move up">↑</button><button type="button" data-a="form-down" data-i="${i}" title="Move tab right" aria-label="Move down">↓</button></div>
      </div>`).join("")}</div>
      <button type="button" data-a="add-form">+ New form</button>
      <a class="quiet-link" href="/registration.html" target="_blank" rel="noopener">Open registration page ↗</a>`;
  }

  const val = (v) => esc(v ?? "");
  function inp(label, key, value, extra = "") { return `<label>${label}<input class="field" data-fk="${key}" value="${val(value)}" ${extra}></label>`; }

  function renderFormEditor() {
    const form = forms()[state.editForm];
    if (!form) {
      main.innerHTML = `<div class="race-empty"><div><h2>No registration forms</h2><p>Create a form to show a registration tab on the website.</p><button type="button" class="primary" data-a="add-form">+ New form</button></div></div>`;
      return;
    }
    const allFields = fieldsOf(form);
    const entriesCount = state.entries.filter((e) => e.form === form.id).length;
    main.innerHTML = `
      <div class="race-form-head"><div><span class="eyebrow">FORM BUILDER</span><h2>${esc(form.title)}</h2>
        <p class="field-hint">Changes go live on the registration page when you click Save &amp; publish.${entriesCount ? ` This form has ${entriesCount} entries.` : ""} ${form.role === "photographer" ? "Used for photographers of every race." : `Used for racers of races in this category (${racesList().filter((r) => r.category === form.id).length} race(s)).`}</p></div>
        <div class="race-actions">
          <button type="button" data-a="dup-form">Duplicate</button>
          <button type="button" class="danger" data-a="del-form">Delete form</button>
          <button type="button" data-a="discard"${state.dirty ? "" : " disabled"}>Discard changes</button>
          <button type="button" class="primary" data-a="save-forms"${state.dirty ? "" : " disabled"}>Save &amp; publish</button>
        </div></div>
      <div class="race-grid">
        ${inp("Title / category name (English)", "title", form.title, 'maxlength="80"')}
        ${inp("Title / category name (Arabic)", "title_ar", form.title_ar, 'dir="rtl" maxlength="80"')}
        ${inp("Form id (used in the link ?form=)", "id", form.id, 'maxlength="40"')}
        ${inp("Reference prefix", "ref_prefix", form.ref_prefix, 'maxlength="6"')}
        <label class="span-2">Championship heading (English)<input class="field" data-fk="heading" value="${val(form.heading)}"></label>
        <label class="span-2">Championship heading (Arabic)<input class="field" dir="rtl" data-fk="heading_ar" value="${val(form.heading_ar)}"></label>
        <label class="span-2">Notes shown above the form (English, one per line)<textarea class="field" rows="3" data-fk="notes">${val(form.notes)}</textarea></label>
        <label class="span-2">Notes (Arabic, one per line)<textarea class="field" rows="3" dir="rtl" data-fk="notes_ar">${val(form.notes_ar)}</textarea></label>
        <label>Colour<input class="field reg-color" type="color" data-fk="color" value="${val(form.color)}"></label>
        <label>Form type<select class="field" data-fk="role"><option value="racer"${form.role !== "photographer" ? " selected" : ""}>Racer (race category)</option><option value="photographer"${form.role === "photographer" ? " selected" : ""}>Photographer</option></select></label>
        <label class="check"><input type="checkbox" data-fk="open"${form.open !== false ? " checked" : ""}> Accepting registrations</label>
        <span></span>
        <label class="span-2">Message when closed (English)<input class="field" data-fk="closed_message" value="${val(form.closed_message)}" placeholder="Registration for this championship is currently closed."></label>
        <label class="span-2">Message when closed (Arabic)<input class="field" dir="rtl" data-fk="closed_message_ar" value="${val(form.closed_message_ar)}" placeholder="التسجيل في هذه البطولة مغلق حالياً."></label>
      </div>
      <div class="results-head"><div><h3>Steps &amp; fields <span class="pill">${form.steps.length}</span></h3>
        <p class="field-hint">The last step always shows the review summary above its fields. Click a field to edit it.</p></div>
        <div class="results-tools"><button type="button" data-a="add-step">+ Add step</button></div></div>
      ${form.steps.map((s, si) => `
      <div class="reg-step" data-s="${si}">
        <div class="reg-step-head"><span class="reg-step-no">${si + 1}</span>
          <div class="reg-step-grid">
            <input class="field" data-sk="title" value="${val(s.title)}" placeholder="Step title (English)">
            <input class="field" dir="rtl" data-sk="title_ar" value="${val(s.title_ar)}" placeholder="Step title (Arabic)">
            <input class="field" data-sk="short" value="${val(s.short)}" placeholder="Short label (stepper)">
            <input class="field" dir="rtl" data-sk="short_ar" value="${val(s.short_ar)}" placeholder="Short label (Arabic)">
            <input class="field" data-sk="subtitle" value="${val(s.subtitle)}" placeholder="Subtitle (English)">
            <input class="field" dir="rtl" data-sk="subtitle_ar" value="${val(s.subtitle_ar)}" placeholder="Subtitle (Arabic)">
          </div>
          <div class="row-acts"><button type="button" data-a="step-up" title="Move step up">↑</button><button type="button" data-a="step-down" title="Move step down">↓</button><button type="button" class="del" data-a="step-del" title="Delete step">✕</button></div>
        </div>
        <div class="reg-fields">${s.fields.map((f, fi) => fieldRow(form, si, fi, f, allFields)).join("") || '<p class="rows-empty">No fields in this step yet.</p>'}</div>
        <div class="reg-add"><select class="field" data-add-type>${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><button type="button" data-a="add-field">+ Add field</button></div>
      </div>`).join("")}`;
  }

  function fieldRow(form, si, fi, f, allFields) {
    const key = `${si}:${fi}`;
    const open = state.openField === key;
    const cond = f.show_if ? `<span class="reg-tag">shown if ${esc(f.show_if.field)} ${esc((OPS.find((o) => o[0] === f.show_if.op) || OPS[0])[1])} ${esc(f.show_if.value || "")}</span>` : "";
    const head = `<div class="reg-field-row${open ? " open" : ""}" data-fi="${fi}">
      <button type="button" class="reg-field-main" data-a="toggle-field"><span class="reg-type">${esc(TYPE_LABEL[f.type] || f.type)}</span>
        <span class="reg-field-label">${esc(f.label.length > 110 ? f.label.slice(0, 110) + "…" : f.label)}</span>
        ${f.required ? '<span class="reg-tag req">required</span>' : ""}${cond}</button>
      <div class="row-acts"><button type="button" data-a="field-up" title="Move up">↑</button><button type="button" data-a="field-down" title="Move down">↓</button>
        <button type="button" data-a="field-dup" title="Duplicate">⧉</button><button type="button" class="del" data-a="field-del" title="Delete field">✕</button></div></div>`;
    if (!open) return head;
    const isInput = !["heading", "note"].includes(f.type);
    const others = allFields.filter((o) => o.id !== f.id && !["heading", "note", "file"].includes(o.type));
    const longText = ["note", "checkbox", "heading"].includes(f.type);
    return head + `<div class="reg-field-edit" data-fi="${fi}">
      <div class="race-grid">
        <label>Field type<select class="field" data-ff="type">${TYPES.map(([v, l]) => `<option value="${v}"${f.type === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Field id<input class="field" data-ff="id" value="${val(f.id)}" maxlength="60"></label>
        ${isInput ? `<label class="check"><input type="checkbox" data-ff="required"${f.required ? " checked" : ""}> Required</label>
        <label>Width<select class="field" data-ff="width"><option value="half"${f.width !== "full" ? " selected" : ""}>Half</option><option value="full"${f.width === "full" ? " selected" : ""}>Full</option></select></label>` : "<span></span><span></span>"}
        <label class="span-2">Label (English)${longText ? `<textarea class="field" rows="3" data-ff="label">${val(f.label)}</textarea>` : `<input class="field" data-ff="label" value="${val(f.label)}">`}</label>
        <label class="span-2">Label (Arabic)${longText ? `<textarea class="field" rows="3" dir="rtl" data-ff="label_ar">${val(f.label_ar)}</textarea>` : `<input class="field" dir="rtl" data-ff="label_ar" value="${val(f.label_ar)}">`}</label>
        ${isInput ? `<label class="span-2">Help text (English, optional)<input class="field" data-ff="help" value="${val(f.help)}"></label>
        <label class="span-2">Help text (Arabic, optional)<input class="field" dir="rtl" data-ff="help_ar" value="${val(f.help_ar)}"></label>` : ""}
        ${f.type === "number" ? `<label>Minimum<input class="field" type="number" data-ff="min" value="${val(f.min)}"></label><label>Maximum<input class="field" type="number" data-ff="max" value="${val(f.max)}"></label><span></span><span></span>` : ""}
        <label>Show this field<select class="field" data-cond="field"><option value="">Always</option>${others.map((o) => `<option value="${esc(o.id)}"${f.show_if?.field === o.id ? " selected" : ""}>Only if: ${esc(o.label.slice(0, 60))}</option>`).join("")}</select></label>
        <label>Condition<select class="field" data-cond="op"${f.show_if ? "" : " disabled"}>${OPS.map(([v, l]) => `<option value="${v}"${(f.show_if?.op || "eq") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="span-2">Value${condValueInput(f, others)}</label>
      </div>
      ${OPTION_TYPES.includes(f.type) ? optionsEditor(f) : ""}
    </div>`;
  }
  function condValueInput(f, others) {
    const ref = others.find((o) => o.id === f.show_if?.field);
    const disabled = !f.show_if || ["filled", "empty"].includes(f.show_if.op) ? " disabled" : "";
    if (ref?.options && ["eq", "neq"].includes(f.show_if?.op || "eq")) {
      return `<select class="field" data-cond="value"${disabled}>${ref.options.map((o) => `<option value="${esc(o.value)}"${f.show_if?.value === o.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
    }
    const hint = ref?.options ? ` placeholder="${esc(ref.options.map((o) => o.value).join(","))}"` : "";
    return `<input class="field" data-cond="value" value="${val(f.show_if?.value)}"${disabled}${hint}>`;
  }
  function optionsEditor(f) {
    return `<div class="reg-options"><div class="results-head"><div><h3>Options <span class="pill">${f.options?.length || 0}</span></h3>
      <p class="field-hint">Price (SAR) adds to the total shown before submitting. Multiplier changes the total (e.g. 2 = fee doubled).</p></div>
      <div class="results-tools"><button type="button" data-a="opt-add">+ Add option</button></div></div>
      <div class="table-shell"><table class="rows-table reg-opt-table"><thead><tr><th>Label (English)</th><th>Label (Arabic)</th><th class="c-sm">Value</th><th class="c-sm">Price</th><th class="c-sm">Multiplier</th><th></th></tr></thead><tbody>
      ${(f.options || []).map((o, oi) => `<tr data-oi="${oi}">
        <td><input data-ok="label" value="${val(o.label)}"></td><td><input dir="rtl" data-ok="label_ar" value="${val(o.label_ar)}"></td>
        <td><input data-ok="value" value="${val(o.value)}"></td><td><input type="number" min="0" data-ok="price" value="${val(o.price)}"></td>
        <td><input type="number" min="0" step="0.5" data-ok="multiplier" value="${val(o.multiplier)}"></td>
        <td><div class="row-acts"><button type="button" data-a="opt-up" title="Move up">↑</button><button type="button" data-a="opt-down" title="Move down">↓</button><button type="button" class="del" data-a="opt-del" title="Delete option">✕</button></div></td></tr>`).join("")}
      </tbody></table></div></div>`;
  }

  /* ---------------------------------------------------------------- form edits */
  function move(list, i, d) { const j = i + d; if (j < 0 || j >= list.length) return false; [list[i], list[j]] = [list[j], list[i]]; return true; }
  function uniqueId(base, taken, sep = "_") { let id = base || "field", n = 2; while (taken.has(id)) id = `${base}${sep}${n++}`; return id; }
  function newField(type, form) {
    const taken = new Set(fieldsOf(form).map((f) => f.id));
    const f = { id: uniqueId(type === "note" ? "note" : type === "heading" ? "heading" : "field", taken), type, label: TYPE_LABEL[type], label_ar: "", _auto: true };
    if (!["heading", "note"].includes(type)) Object.assign(f, { required: false, width: ["textarea", "file", "checkbox", "checkboxes"].includes(type) ? "full" : "half" });
    if (OPTION_TYPES.includes(type)) f.options = [{ value: "option_1", label: "Option 1", label_ar: "" }, { value: "option_2", label: "Option 2", label_ar: "" }];
    if (type === "checkbox") f.label = "I confirm …";
    return f;
  }
  function newForm() {
    const taken = new Set(forms().map((f) => f.id));
    return {
      id: uniqueId("new-form", taken, "-"), title: "New form", title_ar: "", role: "racer", color: "#E8202E", ref_prefix: "NEW",
      heading: "", heading_ar: "", notes: "", notes_ar: "", closed_message: "", closed_message_ar: "", published: true, open: true,
      steps: [
        { id: "details", title: "Your Details", title_ar: "بياناتك", short: "Details", short_ar: "البيانات", subtitle: "", subtitle_ar: "", fields: [
          { id: "full_name", type: "text", label: "Full name", label_ar: "الاسم الكامل", required: true, width: "full" },
          { id: "mobile", type: "tel", label: "Mobile", label_ar: "رقم الجوال", required: true, width: "half" },
          { id: "email", type: "email", label: "E-mail", label_ar: "البريد الإلكتروني", required: true, width: "half" }] },
        { id: "confirm", title: "Declarations", title_ar: "الإقرارات", short: "Confirm", short_ar: "التأكيد", subtitle: "Review your details and confirm to submit.", subtitle_ar: "راجع بياناتك ثم أكّد لإرسالها.", fields: [
          { id: "declare_true", type: "checkbox", label: "I confirm that all submitted information is correct.", label_ar: "أؤكد أن جميع المعلومات المقدمة صحيحة.", required: true, width: "full" }] },
      ],
    };
  }

  function currentForm() { return forms()[state.editForm]; }
  function fieldAt(el) {
    const form = currentForm();
    const si = Number(el.closest("[data-s]")?.dataset.s);
    const fi = Number(el.closest("[data-fi]")?.dataset.fi);
    return { form, si, fi, step: form?.steps[si], field: form?.steps[si]?.fields[fi] };
  }

  function onFormInput(el) {
    const form = currentForm();
    if (!form) return;
    if (el.dataset.fk) {
      const k = el.dataset.fk;
      if (k === "published" || k === "open") form[k] = el.checked;
      else if (k === "role") form.role = el.value === "photographer" ? "photographer" : "racer";
      else if (k === "id") form.id = slug(el.value).slice(0, 40);
      else if (k === "ref_prefix") form.ref_prefix = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      else form[k] = el.value;
      if (k === "title" || k === "published" || k === "open" || k === "color" || k === "role") renderFormsSide();
      if (k === "title") main.querySelector(".race-form-head h2").textContent = form.title;
      return markDirty();
    }
    if (el.dataset.sk) {
      const si = Number(el.closest("[data-s]").dataset.s);
      form.steps[si][el.dataset.sk] = el.value;
      return markDirty();
    }
    const { field, step, fi } = fieldAt(el);
    if (!field) return;
    if (el.dataset.ff) {
      const k = el.dataset.ff;
      if (k === "required") field.required = el.checked;
      else if (k === "id") {
        const old = field.id;
        delete field._auto;
        field.id = slug(el.value, "_").replace(/^[^a-z]+/, "").slice(0, 60);
        fieldsOf(form).forEach((o) => { if (o.show_if?.field === old) o.show_if.field = field.id; });
      } else if (k === "min" || k === "max") { if (el.value === "") delete field[k]; else field[k] = Number(el.value); }
      else if (k === "type") {
        const fresh = newField(el.value, form);
        field.type = el.value;
        if (OPTION_TYPES.includes(el.value) && !field.options) field.options = fresh.options;
        if (!OPTION_TYPES.includes(el.value)) delete field.options;
        if (["heading", "note"].includes(el.value)) { delete field.required; delete field.width; }
        else { field.required ??= false; field.width ??= fresh.width; }
        markDirty();
        return renderFormEditor();
      } else field[k] = el.value;
      if (k === "label") {
        const row = el.closest(".reg-step").querySelector(`.reg-field-row[data-fi="${fi}"] .reg-field-label`);
        if (row) row.textContent = field.label.slice(0, 110);
        if (field._auto && !["note", "heading"].includes(field.type)) {
          const base = slug(field.label, "_").replace(/^[^a-z]+/, "").slice(0, 40);
          if (base) {
            const taken = new Set(fieldsOf(form).filter((o) => o !== field).map((o) => o.id));
            const old = field.id;
            field.id = uniqueId(base, taken);
            fieldsOf(form).forEach((o) => { if (o.show_if?.field === old) o.show_if.field = field.id; });
            const idInput = el.closest(".reg-field-edit")?.querySelector('[data-ff="id"]');
            if (idInput) idInput.value = field.id;
          }
        }
      }
      return markDirty();
    }
    if (el.dataset.cond) {
      const k = el.dataset.cond;
      if (k === "field") {
        if (!el.value) delete field.show_if;
        else {
          const ref = fieldsOf(form).find((o) => o.id === el.value);
          field.show_if = { field: el.value, op: field.show_if?.op || "eq", value: ref?.options?.[0]?.value || "" };
        }
        markDirty();
        return renderFormEditor();
      }
      if (!field.show_if) return;
      field.show_if[k] = el.value;
      markDirty();
      if (k === "op") renderFormEditor();
      return;
    }
    if (el.dataset.ok) {
      const oi = Number(el.closest("[data-oi]").dataset.oi);
      const o = field.options[oi];
      const k = el.dataset.ok;
      if (k === "price" || k === "multiplier") { if (el.value === "") delete o[k]; else o[k] = Number(el.value); }
      else {
        o[k] = el.value;
        if (k === "label" && (!o.value || /^option_\d+$/.test(o.value))) {
          const taken = new Set(field.options.filter((x) => x !== o).map((x) => x.value));
          o.value = uniqueId(slug(el.value, "_").slice(0, 60) || "option", taken);
          const valueInput = el.closest("tr").querySelector('[data-ok="value"]');
          if (valueInput) valueInput.value = o.value;
        }
      }
      return markDirty();
    }
    void step;
  }

  async function saveForms() {
    const btn = main.querySelector('[data-a="save-forms"]');
    if (btn) btn.disabled = true;
    setStatus("Saving and publishing…");
    try {
      const result = await api("/api/dashboard/registration-forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forms: forms() }) });
      state.doc = { version: 1, updated: result.updated, forms: result.forms };
      state.saved = clone(state.doc);
      state.dirty = false;
      state.editForm = Math.min(state.editForm, forms().length - 1);
      setStatus("Saved and published. The registration page now shows these forms.");
      render();
    } catch (error) {
      if (btn) btn.disabled = false;
      setStatus(error.message, "error");
    }
  }

  function structural(action, el) {
    const form = currentForm();
    const list = forms();
    switch (action) {
      case "add-form": list.push(newForm()); state.editForm = list.length - 1; state.openField = null; break;
      case "dup-form": {
        const copy = clone(form);
        const taken = new Set(list.map((f) => f.id));
        copy.id = uniqueId(`${form.id}-copy`, taken, "-"); copy.title = `${form.title} (copy)`;
        list.splice(state.editForm + 1, 0, copy); state.editForm += 1; break;
      }
      case "del-form": {
        const n = state.entries.filter((e) => e.form === form.id).length;
        const used = racesList().filter((r) => r.category === form.id || r.photographer_form === form.id).length;
        if (!window.confirm(`Delete the "${form.title}" form?${n ? ` Its ${n} existing entries stay available under Entries → Deleted forms.` : ""}${used ? ` ${used} race(s) use this form and will stop accepting that registration type.` : ""} The change goes live when you save.`)) return;
        list.splice(state.editForm, 1); state.editForm = Math.max(0, state.editForm - 1); break;
      }
      case "form-up": case "form-down": {
        const i = Number(el.dataset.i);
        if (!move(list, i, action === "form-up" ? -1 : 1)) return;
        if (state.editForm === i) state.editForm += action === "form-up" ? -1 : 1;
        else if (state.editForm === i + (action === "form-up" ? -1 : 1)) state.editForm = i;
        break;
      }
      case "add-step": {
        const taken = new Set(form.steps.map((s) => s.id));
        form.steps.splice(Math.max(0, form.steps.length - 1), 0, { id: uniqueId("step", taken, "-"), title: "New step", title_ar: "", short: "", short_ar: "", subtitle: "", subtitle_ar: "", fields: [] });
        break;
      }
      case "step-up": case "step-down": case "step-del": {
        const si = Number(el.closest("[data-s]").dataset.s);
        if (action === "step-del") {
          if (form.steps.length === 1) return setStatus("A form needs at least one step.", "error");
          if (!window.confirm(`Delete step "${form.steps[si].title}" and its ${form.steps[si].fields.length} fields?`)) return;
          form.steps.splice(si, 1);
        } else if (!move(form.steps, si, action === "step-up" ? -1 : 1)) return;
        state.openField = null; break;
      }
      case "add-field": {
        const si = Number(el.closest("[data-s]").dataset.s);
        const type = el.closest(".reg-add").querySelector("[data-add-type]").value;
        form.steps[si].fields.push(newField(type, form));
        state.openField = `${si}:${form.steps[si].fields.length - 1}`; break;
      }
      case "toggle-field": {
        const { si, fi } = fieldAt(el);
        state.openField = state.openField === `${si}:${fi}` ? null : `${si}:${fi}`;
        return renderFormEditor();
      }
      case "field-up": case "field-down": case "field-del": case "field-dup": {
        const { step, si, fi, field } = fieldAt(el);
        if (action === "field-del") {
          const deps = fieldsOf(form).filter((o) => o.show_if?.field === field.id);
          if (!window.confirm(`Delete "${field.label.slice(0, 80)}"?${deps.length ? ` ${deps.length} field(s) that depend on it will always be shown.` : ""}`)) return;
          deps.forEach((o) => delete o.show_if);
          step.fields.splice(fi, 1); state.openField = null;
        } else if (action === "field-dup") {
          const copy = clone(field);
          copy.id = uniqueId(`${field.id}_copy`, new Set(fieldsOf(form).map((f) => f.id)));
          step.fields.splice(fi + 1, 0, copy); state.openField = `${si}:${fi + 1}`;
        } else {
          const d = action === "field-up" ? -1 : 1;
          if (!move(step.fields, fi, d)) {
            const target = form.steps[si + d];
            if (!target) return;
            step.fields.splice(fi, 1);
            if (d < 0) target.fields.push(field); else target.fields.unshift(field);
            state.openField = null;
          } else if (state.openField === `${si}:${fi}`) state.openField = `${si}:${fi + d}`;
        }
        break;
      }
      case "opt-add": {
        const { field } = fieldAt(el);
        const taken = new Set(field.options.map((o) => o.value));
        field.options.push({ value: uniqueId(`option_${field.options.length + 1}`, taken), label: `Option ${field.options.length + 1}`, label_ar: "" });
        break;
      }
      case "opt-up": case "opt-down": case "opt-del": {
        const { field } = fieldAt(el);
        const oi = Number(el.closest("[data-oi]").dataset.oi);
        if (action === "opt-del") { if (field.options.length === 1) return setStatus("A choice field needs at least one option.", "error"); field.options.splice(oi, 1); }
        else if (!move(field.options, oi, action === "opt-up" ? -1 : 1)) return;
        break;
      }
      default: return;
    }
    markDirty();
    render();
  }

  /* ---------------------------------------------------------------- events */
  root.addEventListener("click", async (event) => {
    const t = event.target;
    const sub = t.closest(".reg-sub [data-view]");
    if (sub) { state.view = sub.dataset.view; closeEntry(); return render(); }
    const formItem = t.closest("[data-form].reg-item");
    if (formItem) { state.formId = formItem.dataset.form; state.raceId = "all"; state.selected.clear(); return render(); }
    const raceItem = t.closest("[data-race].reg-item");
    if (raceItem) { state.raceId = raceItem.dataset.race; state.formId = "all"; state.selected.clear(); return render(); }
    const editRace = t.closest("[data-edit-race]");
    if (editRace) { state.editRace = Number(editRace.dataset.editRace); return render(); }
    const editItem = t.closest("[data-edit-form]");
    if (editItem) { state.editForm = Number(editItem.dataset.editForm); state.openField = null; return render(); }
    if (t.matches("[data-sel]")) {
      t.checked ? state.selected.add(t.dataset.sel) : state.selected.delete(t.dataset.sel);
      const del = main.querySelector('[data-a="delete-selected"]');
      del.disabled = !state.selected.size; del.textContent = `Delete selected (${state.selected.size})`;
      return;
    }
    if (t.matches('[data-a="select-all"]')) {
      filteredEntries().forEach((e) => (t.checked ? state.selected.add(`${e.form}/${e.id}`) : state.selected.delete(`${e.form}/${e.id}`)));
      return renderEntries();
    }
    const row = t.closest("[data-open]");
    if (row && !t.closest(".c-chk")) return openEntry(row.dataset.open);
    if (t === drawer) return closeEntry();
    const btn = t.closest("[data-a]");
    if (!btn) return;
    const a = btn.dataset.a;
    if (a === "refresh") return load(true);
    if (a === "export") return exportCsv();
    if (a === "delete-selected") return deleteEntries([...state.selected]);
    if (a === "close") return closeEntry();
    if (a === "delete-entry") return deleteEntries([btn.dataset.key]);
    if (a === "print-entry") return printEntry(state.entries.find((e) => `${e.form}/${e.id}` === btn.dataset.key));
    if (a === "save-entry") {
      const entry = state.entries.find((e) => `${e.form}/${e.id}` === btn.dataset.key);
      const admin = {};
      drawer.querySelectorAll("[data-adm]").forEach((el) => { if (el.dataset.adm !== "status") admin[el.dataset.adm] = el.type === "checkbox" ? el.checked : el.value; });
      const status = drawer.querySelector('[data-adm="status"]').value;
      btn.disabled = true;
      try {
        const result = await api("/api/dashboard/registrations/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form: entry.form, id: entry.id, status, admin }) });
        Object.assign(entry, result.entry);
        setStatus(`${entry.ref} saved.`);
        render();
        openEntry(btn.dataset.key);
      } catch (error) { setStatus(error.message, "error"); btn.disabled = false; }
      return;
    }
    if (a === "resend") {
      const entry = state.entries.find((e) => `${e.form}/${e.id}` === btn.dataset.key);
      btn.disabled = true; setStatus("Sending e-mails…");
      try {
        const result = await api("/api/dashboard/registrations/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form: entry.form, id: entry.id }) });
        Object.assign(entry, result.entry);
        const m = entry.mail || {};
        setStatus(`Confirmation: ${MAIL_LABEL[m.registrant] || m.registrant} · Organisers: ${MAIL_LABEL[m.admin] || m.admin}${m.error ? ` – ${m.error}` : ""}`, m.registrant === "failed" || m.admin === "failed" ? "error" : "");
        render(); openEntry(btn.dataset.key);
      } catch (error) { setStatus(error.message, "error"); btn.disabled = false; }
      return;
    }
    if (a === "save-races") return saveRaces();
    if (a === "discard-races") {
      if (!window.confirm("Discard all unsaved race changes?")) return;
      state.races = clone(state.racesSaved); state.racesDirty = false;
      state.editRace = Math.min(state.editRace, racesList().length - 1);
      setStatus("Changes discarded.");
      return render();
    }
    if (a === "race-entries") {
      const r = racesList()[state.editRace];
      state.view = "entries"; state.raceId = r.id; state.formId = "all"; state.role = ""; state.selected.clear();
      return render();
    }
    if (a === "test-email") {
      const to = main.querySelector("[data-test-to]")?.value.trim();
      btn.disabled = true; setStatus("Sending test e-mail…");
      try { await api("/api/dashboard/registrations/test-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) }); setStatus(`Test e-mail sent to ${to}.`); }
      catch (error) { setStatus(error.message, "error"); }
      btn.disabled = false;
      return;
    }
    if (["add-race", "dup-race", "del-race"].includes(a)) return raceAction(a);
    if (a === "save-forms") return saveForms();
    if (a === "discard") {
      if (!window.confirm("Discard all unsaved form changes?")) return;
      state.doc = clone(state.saved); state.dirty = false; state.openField = null;
      state.editForm = Math.min(state.editForm, forms().length - 1);
      setStatus("Changes discarded.");
      return render();
    }
    structural(a, btn);
  });
  root.addEventListener("input", (event) => {
    const t = event.target;
    if (t.matches('[data-a="search"]')) {
      state.search = t.value;
      const pos = t.selectionStart;
      renderEntries();
      const again = main.querySelector('[data-a="search"]');
      again.focus(); again.setSelectionRange(pos, pos);
      return;
    }
    if (state.view === "forms" && !t.matches("select,[type=checkbox],[type=color]")) onFormInput(t);
    if (state.view === "races" && t.matches("[data-rk],[data-rs]") && !t.matches("select,[type=checkbox],[type=date],[type=datetime-local]")) onRaceInput(t);
  });
  root.addEventListener("change", (event) => {
    const t = event.target;
    if (t.matches('[data-a="status-filter"]')) { state.status = t.value; return renderEntries(); }
    if (t.matches('[data-a="role-filter"]')) { state.role = t.value; return renderEntries(); }
    if (state.view === "forms" && t.matches("select,[type=checkbox],[type=color]")) onFormInput(t);
    if (state.view === "races" && t.matches("[data-rk],[data-rs]") && t.matches("select,[type=checkbox],[type=date],[type=datetime-local]")) onRaceInput(t);
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !drawer.hidden) closeEntry(); });

  /* ---------------------------------------------------------------- mode integration */
  switcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || button === modeButton || !(state.dirty || state.racesDirty) || root.hidden) return;
    if (!window.confirm("You have unsaved registration changes. Switch anyway? They stay here until you leave the dashboard.")) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);
  new MutationObserver(() => {
    const on = modeButton.classList.contains("on");
    if (on === !root.hidden) return;
    root.hidden = !on;
    if (on) load();
    else closeEntry();
  }).observe(modeButton, { attributes: true, attributeFilter: ["class"] });
  document.getElementById("logout")?.addEventListener("click", () => {
    state.loaded = false; state.entries = []; state.dirty = false; state.doc = null; state.racesDirty = false; state.races = null; closeEntry();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty && !state.racesDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
