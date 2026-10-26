/* Score managers for the dashboard: Race Scores (/results.html) and Live Scores (/live.html).
   Both add, edit, duplicate, hide and delete races, edit result rows, paste from Excel,
   and import or export CSV. Each saves to its own API endpoint. */
(() => {
  const COUNTRIES = {
    "saudi arabia": "SA", saudi: "SA", ksa: "SA", sau: "SA", "united arab emirates": "AE", uae: "AE", are: "AE",
    qatar: "QA", qat: "QA", kuwait: "KW", kwt: "KW", kuw: "KW", bahrain: "BH", bhr: "BH", brn: "BH", oman: "OM", omn: "OM",
    jordan: "JO", jor: "JO", egypt: "EG", egy: "EG", lebanon: "LB", lbn: "LB", syria: "SY", syr: "SY", iraq: "IQ", irq: "IQ",
    yemen: "YE", yem: "YE", morocco: "MA", mar: "MA", tunisia: "TN", algeria: "DZ", sudan: "SD", pakistan: "PK", pak: "PK",
    india: "IN", ind: "IN", serbia: "RS", srb: "RS", "united kingdom": "GB", uk: "GB", gbr: "GB", "great britain": "GB",
    "united states": "US", usa: "US", france: "FR", fra: "FR", germany: "DE", ger: "DE", deu: "DE", italy: "IT", ita: "IT",
    spain: "ES", esp: "ES", netherlands: "NL", ned: "NL", belgium: "BE", portugal: "PT", poland: "PL", russia: "RU", turkey: "TR",
    "türkiye": "TR", tur: "TR", japan: "JP", jpn: "JP", australia: "AU", aus: "AU", "south africa": "ZA", rsa: "ZA",
  };
  const CATEGORIES = ["Karting", "Autocross", "Time Attack", "Drift", "Hill Climb", "Baja", "Local Rally", "E-Games"];
  const NAT_CODES = [["SA", "Saudi Arabia"], ["AE", "United Arab Emirates"], ["QA", "Qatar"], ["KW", "Kuwait"], ["BH", "Bahrain"], ["OM", "Oman"], ["JO", "Jordan"], ["EG", "Egypt"], ["LB", "Lebanon"], ["GB", "United Kingdom"], ["US", "United States"]];

  /* Live timing maths (same rules as live.html). */
  const Timing = {
    parse(v) {
      v = String(v || "").trim();
      if (!v || v === "-") return null;
      if (/^(DIS|DSQ|DQ|DNF|DNS|NT)$/i.test(v)) return { dis: v.toUpperCase() };
      const m = v.replace(",", ".").match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      return m ? { t: (m[1] ? Number(m[1]) * 60 : 0) + parseFloat(m[2]) } : null;
    },
    pen(v) {
      const m = String(v || "").trim().replace(",", ".").match(/^\+?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      return m ? (m[1] ? Number(m[1]) * 60 : 0) + parseFloat(m[2]) : 0;
    },
    fmt(s) {
      if (s == null || !Number.isFinite(s)) return "";
      const m = Math.floor(s / 60);
      let r = (s - m * 60).toFixed(3);
      if (m && r.length < 6) r = `0${r}`;
      return m ? `${m}:${r}` : r;
    },
    best(row) {
      let best = null;
      [1, 2, 3].forEach((n) => {
        const p = Timing.parse(row[`run${n}`]);
        if (p && p.t != null) {
          const total = p.t + Timing.pen(row[`pen${n}`]);
          if (best == null || total < best) best = total;
        }
      });
      return best;
    },
  };

  const CONFIGS = {
    scores: {
      eyebrow: "RACE SCORES",
      intro: "Add, edit or remove races and their results. Changes go live when you save.",
      load: "/api/results",
      save: "/api/dashboard/results",
      page: "/results.html",
      statuses: [["final", "Final"], ["provisional", "Provisional"], ["upcoming", "Upcoming"]],
      raceFields: [
        { k: "title", label: "Race title", span: 2, placeholder: "Time Attack | Round 1" },
        { k: "category", label: "Category", list: true, placeholder: "Time Attack" },
        { k: "round", label: "Round", placeholder: "Round 1" },
        { k: "location", label: "Location", placeholder: "Riyadh" },
        { k: "date", label: "Race date", type: "date" },
        { k: "status", label: "Status", type: "status" },
        { k: "published", label: "Show on website", type: "check" },
        { k: "note", label: "Note (optional)", type: "textarea", span: 2, placeholder: "Short note shown above the results" },
      ],
      columns: [
        ["pos", "Pos", "c-pos"], ["no", "Car No.", "c-no"], ["driver", "Driver"], ["nat", "Nat.", "c-nat"], ["car", "Car"],
        ["cls", "Class", "c-sm"], ["group", "Group", "c-sm"], ["time", "Time", "c-sm"], ["points", "Points", "c-sm"],
      ],
      aliases: {
        time: ["time", "best time", "lap time", "total time", "result"],
        points: ["points", "pts", "score", "scores"],
        group: ["group", "grp"],
      },
      template: "1,7,Driver Name,SA,Toyota Supra,G3,,1:12.345,25",
      emptyRows: "No results yet. Add rows, paste from Excel, or drop a CSV file here.",
      saved: "Saved and published to the Race Scores page.",
    },
    live: {
      eyebrow: "LIVE SCORES",
      intro: "Add live races, update timing during the event and set the link visitors open with the live race button.",
      load: "/api/live",
      save: "/api/dashboard/live",
      page: "/live.html",
      statuses: [["live", "Live"], ["upcoming", "Upcoming"], ["finished", "Finished"]],
      raceFields: [
        { k: "title", label: "Race title", span: 2, placeholder: "Autocross | Jeddah Round" },
        { k: "category", label: "Category", list: true, placeholder: "Autocross" },
        { k: "round", label: "Round", placeholder: "Round 1" },
        { k: "url", label: "Live race link (button)", span: 2, type: "url", placeholder: "https://www.youtube.com/live/..." },
        { k: "link_label", label: "Button text", placeholder: "Watch live" },
        { k: "location", label: "Location", placeholder: "Jeddah" },
        { k: "date", label: "Race date", type: "date" },
        { k: "status", label: "Status", type: "status" },
        { k: "published", label: "Show on website", type: "check" },
        { k: "note", label: "Note (optional)", type: "textarea", span: 2, placeholder: "Short note shown above the timing" },
      ],
      columns: [
        ["pos", "Pos", "c-pos"], ["no", "Car No.", "c-no"], ["driver", "Driver"], ["team", "Team", "c-sm"], ["nat", "Nat.", "c-nat"],
        ["car", "Car"], ["cls", "Class", "c-sm"], ["run1", "Run 1", "c-sm"], ["pen1", "Pen. 1", "c-sm"], ["run2", "Run 2", "c-sm"],
        ["pen2", "Pen. 2", "c-sm"], ["run3", "Run 3", "c-sm"], ["pen3", "Pen. 3", "c-sm"], ["link", "Live link"],
      ],
      aliases: {
        team: ["team", "team name"],
        run1: ["run 1", "run1", "r1", "1st run", "first run"], pen1: ["pen 1", "pen. 1", "pen1", "penalty 1", "penalty1"],
        run2: ["run 2", "run2", "r2", "2nd run", "second run"], pen2: ["pen 2", "pen. 2", "pen2", "penalty 2", "penalty2"],
        run3: ["run 3", "run3", "r3", "3rd run", "third run"], pen3: ["pen 3", "pen. 3", "pen3", "penalty 3", "penalty3"],
        link: ["link", "live link", "url", "stream", "watch live"],
      },
      template: "1,4,Driver Name,Team Name,JO,Mitsubishi Evolution,P1,1:05.483,,1:04.170,+2.000,,",
      emptyRows: "No timing yet. Add rows, paste from Excel, or drop a CSV file here.",
      saved: "Saved. The Live Scores page refreshes for visitors within 20 seconds.",
      computed: true,
      requireUrl: true,
    },
  };
  const BASE_ALIASES = {
    pos: ["#", "pos", "pos.", "position", "rank", "p", "place"],
    no: ["car no", "car no.", "car number", "car #", "no", "no.", "number", "num", "race no"],
    driver: ["driver", "driver name", "name", "competitor", "racer", "team / driver", "team driver"],
    nat: ["nat", "nat.", "nationality", "country", "flag"],
    car: ["car", "vehicle", "car model", "model", "make"],
    cls: ["class", "cls", "category", "division", "group / class", "group class"],
  };

  const managers = {};
  const switcher = document.querySelector(".mode-switch");
  const editorLayout = document.querySelector(".editor-layout");

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function slug(text) {
    return String(text || "race").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "race";
  }

  function toCountry(value) {
    const raw = String(value || "").trim();
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
    return COUNTRIES[raw.toLowerCase()] || raw;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === "") quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
  }

  function detectDelimiter(text) {
    const line = text.split(/\r?\n/, 1)[0];
    return ["\t", ";", ","].sort((a, b) => line.split(b).length - line.split(a).length)[0];
  }

  function formatDate(value) {
    if (!value) return "No date";
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function createManager(mode, cfg, root) {
    const FIELDS = cfg.columns.map((c) => c[0]);
    const LABELS = cfg.columns.map((c) => c[1]);
    const ALIASES = { ...BASE_ALIASES, ...cfg.aliases };
    const statusLabels = Object.fromEntries(cfg.statuses);
    let doc = null, currentId = "", dirtyFlag = false, loading = null;

    root.innerHTML = `
      <aside class="race-side" aria-label="Races">
        <div class="sidebar-heading"><span class="eyebrow">${cfg.eyebrow}</span><h1>Races</h1><p>${cfg.intro}</p></div>
        <button data-el="add" class="primary" type="button">+ New race</button>
        <input data-el="filter" class="field" type="search" placeholder="Search races" aria-label="Search races">
        <div data-el="items" class="race-items" role="listbox" aria-label="Races"></div>
        <div class="sidebar-footer">
          <span data-el="status" class="scores-status" role="status">Loading...</span>
          <button data-el="save" class="primary" type="button" disabled>Save &amp; publish</button>
          <a class="quiet-link" data-el="view" href="${cfg.page}" target="_blank" rel="noopener">View live page</a>
        </div>
      </aside>
      <section class="race-editor" aria-label="Race details">
        <div data-el="empty" class="race-empty"><h2>No race selected</h2><p>Choose a race on the left or create a new one.</p></div>
        <div data-el="form" class="race-form" hidden>
          <header class="race-form-head">
            <div><span class="eyebrow">EDIT RACE</span><h2 data-el="title">Race</h2></div>
            <div class="race-actions"><button data-el="dup" type="button">Duplicate</button><button data-el="del" class="danger" type="button">Delete race</button></div>
          </header>
          <div class="race-grid">${cfg.raceFields.map((f) => {
            const span = f.span ? ` class="span-${f.span}"` : "";
            if (f.type === "check") return `<label class="check"><input type="checkbox" data-f="${f.k}"> ${f.label}</label>`;
            if (f.type === "status") return `<label>${f.label}<select class="field" data-f="status">${cfg.statuses.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>`;
            if (f.type === "textarea") return `<label${span}>${f.label}<textarea class="field" data-f="${f.k}" rows="2" placeholder="${esc(f.placeholder || "")}"></textarea></label>`;
            return `<label${span}>${f.label}<input class="field" data-f="${f.k}" type="${f.type || "text"}"${f.list ? ` list="${mode}-cats"` : ""} placeholder="${esc(f.placeholder || "")}"></label>`;
          }).join("")}</div>
          <datalist id="${mode}-cats">${CATEGORIES.map((c) => `<option value="${c}">`).join("")}</datalist>
          <datalist id="${mode}-nat">${NAT_CODES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</datalist>
          <div class="results-head">
            <div><h3>${cfg.computed ? "Timing" : "Results"} <span data-el="count" class="pill">0</span></h3>
            <p class="field-hint">${cfg.computed ? "Enter run times like 1:05.483, penalties like +2.000, or DIS / DNF. Best time and gaps are calculated automatically. Live link (optional) sets each row\u2019s Watch live button; empty rows use the race link." : "Tip: copy rows from Excel and paste into any cell to fill many rows at once."}</p></div>
            <div class="results-tools">
              <button data-el="row-add" type="button">+ Add row</button>
              <label class="file-btn">Import CSV<input data-el="csv" type="file" accept=".csv,text/csv,.txt"></label>
              <button data-el="export" type="button">Export CSV</button>
              <button data-el="template" type="button">CSV template</button>
              ${cfg.computed ? '<button data-el="rank" type="button">Auto-rank by best time</button>' : ""}
              <button data-el="sort" type="button">Sort by position</button>
              <button data-el="clear" class="danger" type="button">Clear rows</button>
            </div>
          </div>
          <div data-el="drop" class="table-shell">
            <table class="rows-table"${cfg.computed ? ' style="min-width:1600px"' : ""}><thead><tr>${LABELS.map((l) => `<th>${l}</th>`).join("")}${cfg.computed ? "<th>Best</th>" : ""}<th aria-label="Row actions"></th></tr></thead><tbody data-el="body"></tbody></table>
            <div data-el="rows-empty" class="rows-empty">${cfg.emptyRows}</div>
          </div>
        </div>
      </section>`;

    const el = (name) => root.querySelector(`[data-el="${name}"]`);
    const items = el("items"), filterInput = el("filter"), statusEl = el("status"), saveBtn = el("save");
    const form = el("form"), empty = el("empty"), body = el("body"), rowsEmpty = el("rows-empty"), drop = el("drop");

    function setStatus(message, kind = "") { statusEl.textContent = message; statusEl.className = `scores-status ${kind}`; }
    function markDirty() { dirtyFlag = true; saveBtn.disabled = false; setStatus("Unsaved changes. Save to publish.", "dirty"); }
    function current() { return doc?.races.find((race) => race.id === currentId) || null; }
    function blankRow() { return Object.fromEntries(FIELDS.map((k) => [k, ""])); }
    function uniqueId(base) {
      const ids = new Set(doc.races.map((r) => r.id));
      let id = slug(base);
      while (ids.has(id)) id = `${slug(base).slice(0, 54)}-${Math.random().toString(36).slice(2, 6)}`;
      return id;
    }
    function sortRaces() { doc.races.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title)); }

    async function load() {
      if (doc) return;
      if (loading) return loading;
      loading = (async () => {
        setStatus("Loading...");
        try {
          const response = await fetch(cfg.load, { cache: "no-store", credentials: "same-origin" });
          if (response.status === 200) doc = await response.json();
          if (!doc) {
            const page = await (await fetch(cfg.page, { cache: "no-store" })).text();
            const match = page.match(/<script type="application\/json" id="race-data">([\s\S]*?)<\/script>/);
            doc = match ? JSON.parse(match[1]) : { races: [] };
          }
        } catch (error) {
          doc = { races: [] };
          setStatus("Could not load saved data. Starting with an empty list.", "error");
        }
        if (!Array.isArray(doc.races)) doc.races = [];
        doc.races.forEach((race) => { race.rows = Array.isArray(race.rows) ? race.rows : []; });
        sortRaces();
        currentId = doc.races[0]?.id || "";
        renderList();
        renderForm();
        if (!statusEl.classList.contains("error")) setStatus(doc.races.length ? "All changes saved." : "No races yet. Create the first one.");
      })();
      return loading;
    }

    function renderList() {
      const query = filterInput.value.trim().toLowerCase();
      const visible = doc.races.filter((r) => !query || `${r.title} ${r.category} ${r.location} ${r.date}`.toLowerCase().includes(query));
      items.innerHTML = visible.map((r) => `<button type="button" class="race-item${r.id === currentId ? " on" : ""}" data-id="${esc(r.id)}" role="option" aria-selected="${r.id === currentId}"><strong>${esc(r.title || "Untitled race")}</strong><span><i class="dot ${esc(r.status)}"></i>${esc(statusLabels[r.status] || "")} · ${formatDate(r.date)} · ${r.rows.length} rows${r.published === false ? ' <b class="draft">Hidden</b>' : ""}</span></button>`).join("")
        || `<p class="field-hint">${doc.races.length ? "No races match your search." : "No races yet."}</p>`;
    }

    function renderForm() {
      const race = current();
      form.hidden = !race;
      empty.hidden = Boolean(race);
      if (!race) return;
      el("title").textContent = race.title || "Untitled race";
      form.querySelectorAll("[data-f]").forEach((input) => {
        const key = input.dataset.f;
        if (input.type === "checkbox") input.checked = race.published !== false;
        else input.value = race[key] || (key === "status" ? cfg.statuses[0][0] : "");
      });
      renderRows();
    }

    function calcCell(row) {
      const best = Timing.best(row);
      return best == null ? (FIELDS.some((k) => /^run/.test(k) && /^(DIS|DSQ|DQ|DNF|DNS)$/i.test(row[k] || "")) ? "DIS" : "") : Timing.fmt(best);
    }

    function renderRows() {
      const race = current();
      body.innerHTML = race.rows.map((row, index) => `<tr data-index="${index}">${cfg.columns.map(([key, label, cls], col) => `<td${cls ? ` class="${cls}"` : ""}><input data-k="${key}" data-col="${col}" value="${esc(row[key] || "")}" aria-label="${label} row ${index + 1}"${key === "nat" ? ` list="${mode}-nat" maxlength="40"` : ""}></td>`).join("")}${cfg.computed ? `<td class="calc">${calcCell(row)}</td>` : ""}<td><div class="row-acts"><button type="button" data-a="up" title="Move up" aria-label="Move up">↑</button><button type="button" data-a="down" title="Move down" aria-label="Move down">↓</button><button type="button" data-a="del" class="del" title="Delete row" aria-label="Delete row">✕</button></div></td></tr>`).join("");
      el("count").textContent = race.rows.length;
      rowsEmpty.hidden = race.rows.length > 0;
    }

    function setRows(rows, message) {
      current().rows = rows;
      renderRows();
      renderList();
      markDirty();
      if (message) setStatus(message, "dirty");
    }

    /* race list + form */
    items.addEventListener("click", (event) => {
      const button = event.target.closest(".race-item");
      if (!button) return;
      currentId = button.dataset.id;
      renderList();
      renderForm();
    });
    filterInput.addEventListener("input", renderList);

    form.querySelectorAll("[data-f]").forEach((input) => {
      const handler = () => {
        const race = current();
        if (!race) return;
        const key = input.dataset.f;
        race[key] = input.type === "checkbox" ? input.checked : input.value;
        if (key === "title") el("title").textContent = input.value || "Untitled race";
        markDirty();
        if (["title", "date", "status", "published"].includes(key)) renderList();
      };
      input.addEventListener(input.tagName === "SELECT" || input.type === "checkbox" || input.type === "date" ? "change" : "input", handler);
    });

    el("add").addEventListener("click", async () => {
      await load();
      const today = new Date().toISOString().slice(0, 10);
      const race = { id: uniqueId(`new-race-${today}`), title: "New race", category: "", round: "", location: "", date: today, status: cfg.statuses[0][0], note: "", published: true, rows: [] };
      if (cfg.requireUrl) { race.url = ""; race.link_label = ""; }
      doc.races.unshift(race);
      currentId = race.id;
      filterInput.value = "";
      renderList();
      renderForm();
      markDirty();
      form.querySelector('[data-f="title"]').select();
    });

    el("dup").addEventListener("click", () => {
      const race = current();
      if (!race) return;
      const copy = JSON.parse(JSON.stringify(race));
      copy.title = `${race.title} (copy)`;
      copy.id = uniqueId(copy.title);
      doc.races.splice(doc.races.indexOf(race) + 1, 0, copy);
      currentId = copy.id;
      renderList();
      renderForm();
      markDirty();
    });

    el("del").addEventListener("click", () => {
      const race = current();
      if (!race || !window.confirm(`Delete "${race.title}" and all of its rows? This is published when you save.`)) return;
      const index = doc.races.indexOf(race);
      doc.races.splice(index, 1);
      currentId = (doc.races[index] || doc.races[index - 1] || {}).id || "";
      renderList();
      renderForm();
      markDirty();
    });

    /* rows */
    body.addEventListener("input", (event) => {
      const input = event.target.closest("input[data-k]");
      const race = current();
      if (!input || !race) return;
      const tr = input.closest("tr");
      const row = race.rows[Number(tr.dataset.index)];
      row[input.dataset.k] = input.value;
      if (cfg.computed) tr.querySelector(".calc").textContent = calcCell(row);
      markDirty();
    });

    body.addEventListener("change", (event) => {
      const input = event.target.closest('input[data-k="nat"]');
      if (!input) return;
      const code = toCountry(input.value);
      if (code !== input.value) { input.value = code; current().rows[Number(input.closest("tr").dataset.index)].nat = code; }
    });

    body.addEventListener("click", (event) => {
      const button = event.target.closest("[data-a]");
      const race = current();
      if (!button || !race) return;
      const index = Number(button.closest("tr").dataset.index);
      const action = button.dataset.a;
      if (action === "del") race.rows.splice(index, 1);
      if (action === "up" && index > 0) [race.rows[index - 1], race.rows[index]] = [race.rows[index], race.rows[index - 1]];
      if (action === "down" && index < race.rows.length - 1) [race.rows[index + 1], race.rows[index]] = [race.rows[index], race.rows[index + 1]];
      renderRows();
      renderList();
      markDirty();
    });

    body.addEventListener("paste", (event) => {
      const input = event.target.closest("input[data-k]");
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!input || !/[\t\n]/.test(text.trim())) return;
      event.preventDefault();
      const race = current();
      const grid = parseDelimited(text, "\t");
      const startRow = Number(input.closest("tr").dataset.index);
      const startCol = Number(input.dataset.col);
      grid.forEach((cells, r) => {
        const target = race.rows[startRow + r] || (race.rows[startRow + r] = blankRow());
        cells.forEach((value, c) => {
          const key = FIELDS[startCol + c];
          if (key) target[key] = key === "nat" ? toCountry(value) : value.trim();
        });
      });
      setRows(race.rows, `Pasted ${grid.length} row${grid.length === 1 ? "" : "s"}. Save to publish.`);
    });

    el("row-add").addEventListener("click", () => {
      const race = current();
      if (!race) return;
      const row = blankRow();
      const positions = race.rows.map((item) => parseInt(item.pos, 10)).filter(Number.isFinite);
      row.pos = String((positions.length ? Math.max(...positions) : 0) + 1);
      race.rows.push(row);
      setRows(race.rows);
      body.lastElementChild?.querySelector('input[data-k="no"]')?.focus();
    });

    el("sort").addEventListener("click", () => {
      const race = current();
      if (!race) return;
      const key = (row) => { const n = parseInt(row.pos, 10); return Number.isFinite(n) ? n : 9999; };
      setRows(race.rows.slice().sort((a, b) => key(a) - key(b)));
    });

    el("rank")?.addEventListener("click", () => {
      const race = current();
      if (!race) return;
      const ranked = race.rows.map((row, i) => ({ row, best: Timing.best(row), i }))
        .sort((a, b) => (a.best == null) - (b.best == null) || (a.best ?? 0) - (b.best ?? 0) || a.i - b.i);
      let p = 0;
      ranked.forEach((item) => { item.row.pos = item.best == null ? "" : String(++p); });
      setRows(ranked.map((item) => item.row), "Positions updated from best times. Save to publish.");
    });

    el("clear").addEventListener("click", () => {
      const race = current();
      if (!race || !race.rows.length || !window.confirm(`Remove all ${race.rows.length} rows from this race?`)) return;
      setRows([]);
    });

    /* CSV */
    function csvToRows(text) {
      const grid = parseDelimited(text, detectDelimiter(text));
      if (!grid.length) throw new Error("The CSV file is empty.");
      const header = grid[0].map((value) => value.trim().toLowerCase().replace(/\s+/g, " "));
      const used = new Set();
      const map = header.map((name) => {
        const key = FIELDS.find((k) => !used.has(k) && (ALIASES[k] || [k]).some((alias) => alias === name || alias === name.replace(/\.$/, "")));
        if (key) used.add(key);
        return key;
      });
      const hasHeader = map.filter(Boolean).length >= 2;
      const columns = hasHeader ? map : FIELDS;
      return grid.slice(hasHeader ? 1 : 0).map((cells) => {
        const row = blankRow();
        cells.forEach((value, index) => {
          const key = columns[index];
          if (key) row[key] = key === "nat" ? toCountry(value) : value.trim();
        });
        return row;
      }).filter((row) => FIELDS.some((k) => row[k]));
    }

    function importCsv(file) {
      const race = current();
      if (!file || !race) return;
      if (file.size > 2 * 1024 * 1024) { setStatus("CSV must be 2 MB or smaller.", "error"); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = csvToRows(String(reader.result));
          if (!rows.length) throw new Error("No rows were found in the CSV.");
          const replace = !race.rows.length || window.confirm(`Import ${rows.length} rows.\n\nOK = replace the ${race.rows.length} existing rows\nCancel = add them after the existing rows`);
          setRows(replace ? rows : race.rows.concat(rows), `Imported ${rows.length} rows from ${file.name}. Save to publish.`);
        } catch (error) {
          setStatus(error.message, "error");
        }
      };
      reader.onerror = () => setStatus("Could not read the CSV file.", "error");
      reader.readAsText(file);
    }

    el("csv").addEventListener("change", (event) => { importCsv(event.target.files?.[0]); event.target.value = ""; });
    ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      drop.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("drag")));
    drop.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      importCsv(event.dataTransfer.files[0]);
    });

    const csvCell = (value) => { const t = String(value ?? ""); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    function download(name, text) {
      const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    el("export").addEventListener("click", () => {
      const race = current();
      if (!race) return;
      download(`${slug(race.title)}.csv`, [LABELS.join(",")].concat(race.rows.map((row) => FIELDS.map((k) => csvCell(row[k])).join(","))).join("\r\n"));
    });
    el("template").addEventListener("click", () => download(`${mode}-template.csv`, `${LABELS.join(",")}\r\n${cfg.template}\r\n`));

    /* save */
    saveBtn.addEventListener("click", async () => {
      if (!doc) return;
      const badLink = (u) => u && !/^https?:\/\/\S+$/i.test(String(u).trim());
      const problem = doc.races.find((r) => !r.title.trim()) || (cfg.requireUrl && doc.races.find((r) => badLink(r.url) || r.rows.some((row) => badLink(row.link))));
      if (problem) {
        currentId = problem.id; renderList(); renderForm();
        setStatus(problem.title.trim() ? "The live race link must start with https://" : "Every race needs a title before saving.", "error");
        return;
      }
      saveBtn.disabled = true;
      setStatus("Saving and publishing...");
      try {
        const payload = { version: 1, races: doc.races.map((r) => ({ ...r, title: r.title.trim(), url: r.url ? r.url.trim() : r.url, rows: r.rows.filter((row) => FIELDS.some((k) => String(row[k] || "").trim())) })) };
        if (!cfg.requireUrl) payload.races.forEach((r) => { delete r.url; });
        await manager.persist(payload);
        doc.races = payload.races;
        sortRaces();
        dirtyFlag = false;
        renderList();
        renderForm();
        setStatus(cfg.saved);
      } catch (error) {
        saveBtn.disabled = false;
        setStatus(error.message, "error");
      }
    });

    const manager = {
      root,
      load,
      isDirty: () => dirtyFlag,
      reset() { doc = null; loading = null; dirtyFlag = false; saveBtn.disabled = true; },
      async persist(payload) {
        const response = await fetch(cfg.save, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
        if (!response.ok) throw new Error(data?.error || `Save failed (${response.status}).`);
      },
    };
    return manager;
  }

  document.querySelectorAll("[data-manager]").forEach((root) => {
    const mode = root.dataset.manager;
    if (CONFIGS[mode]) managers[mode] = createManager(mode, CONFIGS[mode], root);
  });
  window.STC_SCORE_MANAGERS = managers;
  if (!switcher) return;

  let activeMode = "pages";
  async function setMode(mode) {
    if (mode === activeMode) return;
    const leaving = managers[activeMode];
    if (activeMode === "pages" && typeof dirty !== "undefined" && dirty && !window.confirm("You have unsaved page edits. Switch anyway? They stay in the preview until you reload it.")) return;
    if (leaving?.isDirty() && !window.confirm("You have unsaved score changes. Switch anyway? They stay here until you leave the dashboard.")) return;
    activeMode = mode;
    switcher.querySelectorAll("button").forEach((button) => {
      const on = button.dataset.mode === mode;
      button.classList.toggle("on", on);
      button.setAttribute("aria-selected", String(on));
    });
    if (editorLayout) editorLayout.hidden = mode !== "pages";
    const calendarPanel=document.getElementById("calendar-layout"); if(calendarPanel)calendarPanel.hidden=mode!=="calendar";
    Object.entries(managers).forEach(([key, m]) => { m.root.hidden = key !== mode; });
    document.body.classList.toggle("scores-mode", mode !== "pages");
    if (managers[mode]) await managers[mode].load();
  }
  window.STC_SET_MODE = setMode;
  const calendarFile=document.getElementById('calendar-import-file');
  const calendarStatus=document.getElementById('calendar-import-status');
  function parseCalendarCSV(source){
    source=source.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"'){quoted=true;}else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
    if(quoted)throw Error('Unclosed quote in CSV.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
    if(!rows.length)throw Error('The CSV is empty.');
    const columns=rows.shift().map(v=>v.trim().toLowerCase());const required=['no','event','date','type','city','location'];
    if(required.some(k=>!columns.includes(k)))throw Error('CSV needs columns: No, Event, Date, Type, City, Location.');
    const existing=window.__STC_CALENDAR_DEFAULT||[];
    const types={'autocross':'Autocross','baja':'Baja','drift':'Drift','e-games':'E-Games','e-gaming':'E-Games','hill climb':'Hill Climb','karting':'Karting','local rally':'Local Rally','time attack':'Time Attack'};
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    function dateIso(v,no){const raw=v.trim();if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
      const match=raw.match(/^(\d{1,2})\s*[- ]\s*(\d{1,2})?\s*([A-Za-z]{3,9})(?:\s*[- ]\s*(\d{2,4}))?/);
      if(!match)throw Error('Could not parse date: '+raw);
      const mon=months[match[3].slice(0,3).toLowerCase()];if(!mon)throw Error('Invalid month: '+raw);
      const year=match[4]?Number(match[4]):2026;const yyyy=year<100?2000+year:year;
      return [yyyy,String(mon).padStart(2,'0'),String(match[1]).padStart(2,'0')].join('-');
    }
    return rows.map((values,index)=>{const pick=k=>(values[columns.indexOf(k)]||'').trim();const number=Number(pick('no'));if(!Number.isInteger(number)||number<1)throw Error('Invalid No at row '+(index+2));
      const type=types[pick('type').toLowerCase()];if(!type)throw Error('Invalid Type at row '+(index+2));
      const event=pick('event'),dateLabel=pick('date'),city=pick('city'),location=pick('location');if(!event||!dateLabel||!city||!location)throw Error('Missing field at row '+(index+2));
      return {no:number,ev:event,date:dateIso(dateLabel,number),dateLabel,type,city,location};
    });
  }
  document.getElementById('calendar-import-action')?.addEventListener('click',async()=>{
    const file=calendarFile.files?.[0];if(!file){calendarStatus.textContent='Choose a CSV file first.';return;}
    if(file.size>512*1024){calendarStatus.textContent='CSV must be under 512 KB.';return;}
    try{const events=parseCalendarCSV(await file.text());if(!window.confirm('Publish '+events.length+' calendar events? This replaces the current calendar event list.'))return;
      const response=await fetch('/api/dashboard/calendar',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})});const data=await response.json();if(!response.ok)throw Error(data.error||'Import failed');
      calendarStatus.textContent=events.length+' events imported and published successfully.';calendarFile.value='';
    }catch(error){calendarStatus.textContent=error.message;}
  });

  switcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button) setMode(button.dataset.mode);
  });

  document.getElementById("logout")?.addEventListener("click", (event) => {
    if (Object.values(managers).some((m) => m.isDirty()) && !window.confirm("Log out and discard unsaved score changes?")) {
      event.stopImmediatePropagation();
      return;
    }
    Object.values(managers).forEach((m) => m.reset());
    activeMode = "";
    setMode("pages");
  }, true);

  window.addEventListener("beforeunload", (event) => {
    if (!Object.values(managers).some((m) => m.isDirty())) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
