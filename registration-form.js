/* Race registration.
   The organiser opens registration per race (dashboard → Registrations → Races). This page lists the
   open races from /api/registration-races; the visitor picks a race, chooses to register as a racer
   (the race category's championship form) or as a photographer (the photographer form), and fills in
   the multi-step form. Documents upload as they are chosen; the entry goes to /api/registrations/submit,
   which also e-mails a confirmation to the registrant and a notification to the organisers. */
(function () {
  "use strict";
  var tabsEl = document.getElementById("reg-tabs");
  var host = document.getElementById("reg-app");
  var notesEl = document.getElementById("reg-notes");
  if (!tabsEl || !host) return;

  var AR = false;
  var MAX = 4 * 1024 * 1024;
  var OK_EXT = /\.(pdf|jpe?g|png)$/i;
  var MEDIA = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
  var CHECK = '<svg viewBox="0 0 14 11" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="13"><path d="M1.5 5.5l3.8 3.8L12.5 1.5"/></svg>';
  var ARROW_R = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var ARROW_L = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';

  var S = {
    en: {
      loading: "Loading registration forms…", loadFail: "Registration forms could not be loaded. Please refresh the page.",
      none: "Registration is not open at the moment.", entryForm: "Entry Form",
      step: "Step {i} / {n}", stepOf: "Step {i} of {n}", next: "Continue", back: "Back", submit: "Submit Registration",
      submitting: "Submitting…", required: "This field is required.", email: "Enter a valid e-mail address.",
      tel: "Enter a valid phone number.", check: "Please check this value.", date: "Enter a valid date.",
      choose: "Please choose an option.", radio: "Please select an option.", multi: "Please select at least one option.",
      confirm: "Please confirm to continue.", upload: "Please upload a file.",
      fileType: "Unsupported file type. Please upload a PDF, JPG, JPEG or PNG.", fileSize: "File is larger than 4 MB.",
      uploading: "Uploading…", uploadFail: "The file could not be uploaded. Please try again.",
      waitUploads: "Please wait until your files finish uploading.", chooseFile: "Choose file", noFile: "No file chosen",
      accept: "Acceptable files ( pdf ⋅ jpg ⋅ jpeg ⋅ png )", maxSize: "Maximum file size 4 MB",
      placeholder: "—Please choose an option—", edit: "Edit", total: "Total", sar: "SAR",
      fix: "Please correct the highlighted fields.", decl: "Please accept the declarations to continue.",
      receivedA: "Registration ", receivedB: "received", thanks: "Thank you. Your registration details have been submitted.",
      reference: "Reference", home: "Back to homepage", another: "Submit another registration",
      closed: "Registration for this championship is currently closed.", closedBadge: "Closed",
      submitFail: "Your registration could not be submitted. Please try again.",
      yes: "Yes", no: "No",
      noRaces: "Registration is not open at the moment. Registration opens for each race once it is announced — please check back soon.",
      chooseRace: "Choose the race you want to register for", raceReg: "Race Registration", registerAs: "Register as",
      racer: "Racer", racerSub: "Driver / competitor entry for this race", photographer: "Photographer", photographerSub: "Media and photography access for this race",
      category: "Category", location: "Location", date: "Date", deadline: "Registration closes", ksa: "KSA time",
      pickRole: "Choose how you want to register to open the form.", emailed: "A confirmation e-mail has been sent to {e}.",
      notes: "Notes :",
      champReg: "Championship Registration", season: "2026 Season", seasonSub: "Enter the round and venue in the form",
    },
    ar: {
      loading: "جارٍ تحميل نماذج التسجيل…", loadFail: "تعذر تحميل نماذج التسجيل. يرجى تحديث الصفحة.",
      none: "التسجيل غير متاح حالياً.", entryForm: "نموذج التسجيل",
      step: "الخطوة {i} / {n}", stepOf: "الخطوة {i} من {n}", next: "متابعة", back: "رجوع", submit: "إرسال التسجيل",
      submitting: "جارٍ الإرسال…", required: "هذا الحقل مطلوب.", email: "يرجى إدخال بريد إلكتروني صحيح.",
      tel: "يرجى إدخال رقم جوال صحيح.", check: "يرجى التحقق من هذه القيمة.", date: "يرجى إدخال تاريخ صحيح.",
      choose: "يرجى اختيار أحد الخيارات.", radio: "يرجى اختيار أحد الخيارات.", multi: "يرجى اختيار خيار واحد على الأقل.",
      confirm: "يرجى التأكيد للمتابعة.", upload: "يرجى رفع ملف.",
      fileType: "نوع الملف غير مدعوم. يرجى رفع ملف PDF أو JPG أو JPEG أو PNG.", fileSize: "حجم الملف أكبر من 4 ميجابايت.",
      uploading: "جارٍ الرفع…", uploadFail: "تعذر رفع الملف. يرجى المحاولة مرة أخرى.",
      waitUploads: "يرجى الانتظار حتى يكتمل رفع الملفات.", chooseFile: "اختر ملفاً", noFile: "لم يتم اختيار ملف",
      accept: "الملفات المقبولة ( pdf ⋅ jpg ⋅ jpeg ⋅ png )", maxSize: "الحد الأقصى لحجم الملف 4 ميجابايت",
      placeholder: "—يرجى اختيار أحد الخيارات—", edit: "تعديل", total: "الإجمالي", sar: "ريال",
      fix: "يرجى تصحيح الحقول المحددة.", decl: "يرجى الموافقة على الإقرارات للمتابعة.",
      receivedA: "تم استلام ", receivedB: "طلبك", thanks: "شكراً لك. تم إرسال بيانات تسجيلك.",
      reference: "الرقم المرجعي", home: "العودة إلى الصفحة الرئيسية", another: "إرسال تسجيل آخر",
      closed: "التسجيل في هذه البطولة مغلق حالياً.", closedBadge: "مغلق",
      submitFail: "تعذر إرسال تسجيلك. يرجى المحاولة مرة أخرى.",
      yes: "نعم", no: "لا",
      noRaces: "التسجيل غير متاح حالياً. يُفتح التسجيل لكل سباق عند الإعلان عنه — يرجى العودة لاحقاً.",
      chooseRace: "اختر السباق الذي تريد التسجيل فيه", raceReg: "التسجيل في السباق", registerAs: "التسجيل كـ",
      racer: "متسابق", racerSub: "تسجيل السائق / المتسابق في هذا السباق", photographer: "مصور", photographerSub: "تصريح الإعلام والتصوير لهذا السباق",
      category: "الفئة", location: "الموقع", date: "التاريخ", deadline: "يُغلق التسجيل", ksa: "بتوقيت السعودية",
      pickRole: "اختر نوع التسجيل لفتح النموذج.", emailed: "تم إرسال رسالة تأكيد إلى {e}.",
      notes: "ملاحظات :",
      champReg: "التسجيل في البطولة", season: "موسم 2026", seasonSub: "أدخل الجولة والموقع في النموذج",
    },
  };
  function t(key, vars) {
    var s = (AR ? S.ar : S.en)[key] || S.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }
  function L(obj, key) { return (AR && obj[key + "_ar"]) ? obj[key + "_ar"] : (obj[key] || ""); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v; /* static markup only (icons) */
      else el.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function money(n) {
    var s = Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return AR ? s + " " + t("sar") : s + " " + t("sar");
  }
  function scrollToEl(el, off) { scrollTo({ top: el.getBoundingClientRect().top + scrollY - (off || 110), behavior: "smooth" }); }

  var forms = [], races = [], views = {}, active = null, activeRole = null;
  var RACE_FIELDS = { round: "name", venue: "location", event_dates: "date_label" };
  var ICON_RACER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/><path d="M9 4v8M13 4v8M5 8h12"/></svg>';
  var ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  /* ------------------------------------------------------------------ conditions */
  function isEmpty(v) { return v == null || v === "" || v === false || (Array.isArray(v) && !v.length); }
  function num(v) { if (v === "" || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }
  function visibility(form, values) {
    var byId = {}, memo = {};
    form.steps.forEach(function (s) { s.fields.forEach(function (f) { byId[f.id] = f; }); });
    function vis(id, depth) {
      if (id in memo) return memo[id];
      var f = byId[id], c = f && f.show_if;
      if (!c || depth > 20) return (memo[id] = true);
      var cur = (c.field in byId && vis(c.field, (depth || 0) + 1)) ? values[c.field] : null;
      var items = Array.isArray(cur) ? cur.map(String) : (isEmpty(cur) ? [] : [String(cur)]);
      var exp = String(c.value == null ? "" : c.value), r;
      switch (c.op) {
        case "neq": r = items.indexOf(exp) < 0; break;
        case "in": var allowed = exp.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          r = items.some(function (i) { return allowed.indexOf(i) >= 0; }); break;
        case "lt": case "gte": var a = num(cur), b = num(exp);
          r = a != null && b != null && (c.op === "lt" ? a < b : a >= b); break;
        case "filled": r = !isEmpty(cur); break;
        case "empty": r = isEmpty(cur); break;
        default: r = items.indexOf(exp) >= 0;
      }
      return (memo[id] = r);
    }
    var out = {};
    Object.keys(byId).forEach(function (id) { out[id] = vis(id, 0); });
    return out;
  }

  /* ------------------------------------------------------------------ fields */
  function label(f) {
    var lb = h("span", { class: "lb" }, [L(f, "label")]);
    if (f.required) lb.appendChild(h("i", { text: " *" }));
    return lb;
  }
  function help(f) { var x = L(f, "help"); return x ? h("small", { class: "help", text: x }) : null; }

  function fieldEl(view, f) {
    var name = f.id, box, ctl;
    var wide = f.width === "full" ? " full" : "";
    switch (f.type) {
      case "heading":
        return h("div", { class: "f full fh", "data-id": name }, [h("h3", null, [h("i", { class: "tri" }), L(f, "label")])]);
      case "note":
        return h("div", { class: "f full fnote", "data-id": name }, L(f, "label").split("\n").map(function (p) { return h("p", { text: p }); }));
      case "textarea":
        ctl = h("textarea", { name: name, rows: "4", required: f.required });
        return h("label", { class: "f full", "data-id": name }, [label(f), ctl, help(f)]);
      case "select":
        ctl = h("select", { name: name, required: f.required }, [h("option", { value: "", text: t("placeholder") })].concat(
          f.options.map(function (o) { return h("option", { value: o.value, text: L(o, "label") }); })));
        return h("label", { class: "f" + wide, "data-id": name }, [label(f), ctl, help(f)]);
      case "radio": {
        var cards = f.options.length > 3 || f.options.some(function (o) { return o.price != null || L(o, "label").length > 24; });
        var wrap = h("div", { class: cards ? "opts" + (f.options.length > 4 ? " many" : "") : "seg" });
        f.options.forEach(function (o, i) {
          var inp = h("input", { type: "radio", name: name, value: o.value, required: f.required && i === 0 });
          var span = cards ? h("span", null, [h("b", { text: L(o, "label") }), o.price != null ? h("em", { text: money(o.price) }) : null])
            : h("span", { text: L(o, "label") });
          wrap.appendChild(h("label", null, [inp, span]));
        });
        return h("div", { class: "f" + (cards ? " full" : wide), "data-id": name }, [label(f), wrap, help(f)]);
      }
      case "checkboxes": {
        var list = h("div", { class: "chks" });
        f.options.forEach(function (o) { list.appendChild(h("label", null, [h("input", { type: "checkbox", name: name, value: o.value }), h("span", { text: L(o, "label") })])); });
        return h("div", { class: "f full multi", "data-id": name }, [label(f), list, help(f)]);
      }
      case "checkbox": {
        var one = h("div", { class: "chks" }, [h("label", null, [h("input", { type: "checkbox", name: name, required: f.required }), h("span", { text: L(f, "label") })])]);
        return h("div", { class: "f full single", "data-id": name }, [one, help(f)]);
      }
      case "file": {
        ctl = h("input", { type: "file", name: name, accept: ".pdf,.jpg,.jpeg,.png" });
        var drop = h("label", { class: "drop" }, [ctl, h("span", { class: "btn", text: t("chooseFile") }), h("span", { class: "fn", text: t("noFile") })]);
        var hint = h("ul", { class: "hint" }, [h("li", { text: t("accept") }), h("li", { text: t("maxSize") })]);
        return h("div", { class: "f full up", "data-id": name }, [label(f), drop, hint, help(f), h("em", { class: "err" })]);
      }
      default: {
        var type = { email: "email", tel: "tel", number: "number", date: "date" }[f.type] || "text";
        ctl = h("input", { type: type, name: name, required: f.required, min: f.min, max: f.max, step: type === "number" ? "any" : null,
          autocomplete: type === "email" ? "email" : (type === "tel" ? "tel" : "off"), dir: type === "text" ? "auto" : null });
        return h("label", { class: "f" + wide, "data-id": name }, [label(f), ctl, help(f)]);
      }
    }
  }

  /* ------------------------------------------------------------------ one form view */
  function buildView(form, race, role) {
    var N = form.steps.length;
    var v = { form: form, race: race, role: role, cur: 0, maxv: 0, files: {}, uploads: 0, root: h("div", { class: "rv-form", "data-form": form.id }) };
    var fieldMap = {};
    form.steps.forEach(function (s) { s.fields.forEach(function (f) { fieldMap[f.id] = f; }); });
    v.fieldMap = fieldMap;

    var head = h("div", { class: "fhead" }, [h("span", { class: "eb", text: t("entryForm") }), h("strong", { text: L(form, "heading") || L(form, "title") })]);
    v.root.appendChild(head);

    if (form.open === false) {
      v.root.appendChild(h("div", { class: "closed" }, [h("i", { class: "tri" }), h("p", { text: L(form, "closed_message") || t("closed") })]));
      return v;
    }

    var stepper = h("div", { class: "stepper", style: "grid-template-columns:repeat(" + N + ",1fr)" });
    var fill = h("i");
    stepper.appendChild(h("div", { class: "trk", style: "left:" + (50 / N) + "%;right:" + (50 / N) + "%" }, [fill]));
    var sts = form.steps.map(function (s, i) {
      var b = h("button", { type: "button", class: "st", "data-i": String(i) }, [
        h("span", { class: "dot", html: "<b>" + (i + 1) + "</b>" + CHECK }), h("span", { class: "tx", text: L(s, "short") || L(s, "title") })]);
      stepper.appendChild(b);
      return b;
    });
    var f = h("form", { novalidate: true, autocomplete: "on" });
    var steps = form.steps.map(function (s, i) {
      var fs = h("fieldset", { class: "step", "data-i": String(i) }, [h("div", { class: "sh" }, [
        h("span", { class: "eb", text: t("step", { i: String(i + 1).padStart(2, "0"), n: String(N).padStart(2, "0") }) }),
        h("h2", { text: L(s, "title") }), L(s, "subtitle") ? h("p", { text: L(s, "subtitle") }) : null])]);
      if (i === N - 1) fs.appendChild(h("div", { class: "rev" }));
      var grid = h("div", { class: "fg" });
      s.fields.forEach(function (fd) { grid.appendChild(fieldEl(v, fd)); });
      fs.appendChild(grid);
      f.appendChild(fs);
      return fs;
    });
    var smsg = h("p", { class: "stmsg", role: "alert" });
    var bk = h("button", { type: "button", class: "bk", html: ARROW_L + "<span></span>" });
    var nx = h("button", { type: "button", class: "nx", html: "<span></span>" + ARROW_R });
    bk.lastChild.textContent = t("back");
    var cnt = h("span", { class: "cnt" });
    f.appendChild(smsg);
    f.appendChild(h("div", { class: "nav" }, [bk, cnt, nx]));
    var ok = h("div", { class: "ok" }, [
      h("div", { class: "tick", html: '<svg viewBox="0 0 52 52" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 27l8 8 16-17"/></svg>' }),
      h("h2", null, [t("receivedA"), h("span", { text: t("receivedB") })]), h("p", { text: t("thanks") }),
      h("div", { class: "ref" }, [t("reference") + " ", h("b")]), h("p", { class: "mailed", hidden: true }),
      h("div", { class: "okbtns" }, [h("a", { class: "nx", href: "index.html" }, [h("span", { text: t("home") })]),
        h("button", { type: "button", class: "bk show again", text: t("another") })])]);
    v.root.appendChild(stepper);
    v.root.appendChild(f);
    v.root.appendChild(ok);
    Object.assign(v, { N: N, stepper: stepper, fill: fill, sts: sts, f: f, steps: steps, smsg: smsg, bk: bk, nx: nx, cnt: cnt, ok: ok });

    /* values -------------------------------------------------------- */
    v.values = function () {
      var out = {};
      Object.keys(fieldMap).forEach(function (id) {
        var fd = fieldMap[id];
        if (fd.type === "heading" || fd.type === "note") return;
        if (fd.type === "file") { out[id] = v.files[id] ? v.files[id].name : ""; return; }
        var els = f.elements[id];
        if (!els) return;
        if (fd.type === "checkboxes") out[id] = [].filter.call(f.querySelectorAll('input[name="' + id + '"]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
        else if (fd.type === "checkbox") out[id] = !!f.querySelector('input[name="' + id + '"]').checked;
        else if (fd.type === "radio") { var r = f.querySelector('input[name="' + id + '"]:checked'); out[id] = r ? r.value : ""; }
        else out[id] = String(els.value || "").trim();
      });
      return out;
    };
    v.refresh = function () {
      var shown = visibility(form, v.values());
      [].forEach.call(f.querySelectorAll("[data-id]"), function (box) {
        var on = shown[box.getAttribute("data-id")] !== false;
        box.hidden = !on;
        if (!on) err(box, "");
      });
      v.shown = shown;
      return shown;
    };

    function err(box, msg) {
      var e = box.querySelector(".err");
      if (!e && msg) { e = h("em", { class: "err" }); box.appendChild(e); }
      if (e) e.textContent = msg;
      box.classList.toggle("bad", !!msg);
    }
    function validateBox(box) {
      var id = box.getAttribute("data-id"), fd = fieldMap[id];
      if (!fd || box.hidden || fd.type === "heading" || fd.type === "note") return "";
      var val = v.values()[id];
      if (fd.type === "file") {
        if (box.classList.contains("busy")) return t("waitUploads");
        if (box.dataset.fail) return box.dataset.fail;
        return fd.required && !v.files[id] ? t("upload") : "";
      }
      if (isEmpty(val)) {
        if (!fd.required) return "";
        return { select: t("choose"), radio: t("radio"), checkboxes: t("multi"), checkbox: t("confirm") }[fd.type] || t("required");
      }
      if (fd.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) return t("email");
      if (fd.type === "tel" && !/^\+?[0-9()\-\s.]{6,30}$/.test(val)) return t("tel");
      if (fd.type === "number") { var n = num(val); if (n == null || (fd.min != null && n < fd.min) || (fd.max != null && n > fd.max)) return t("check"); }
      if (fd.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return t("date");
      return "";
    }
    function check(i) {
      v.refresh();
      var first = null, okAll = true, declBad = false;
      v.smsg.textContent = "";
      [].forEach.call(steps[i].querySelectorAll("[data-id]"), function (box) {
        var m = validateBox(box);
        if (box.classList.contains("single")) box.querySelector(".chks label").classList.toggle("bad", !!m);
        err(box, box.classList.contains("single") ? "" : m);
        if (m) { okAll = false; first = first || box; if (box.classList.contains("single")) declBad = true; }
      });
      if (!okAll) {
        v.smsg.textContent = declBad && first.classList.contains("single") ? t("decl") : t("fix");
        scrollToEl(first, 160);
        var inp = first.querySelector("input:not([type=file]):not([type=radio]):not([type=checkbox]),select,textarea");
        if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, 350);
        var card = document.getElementById("card");
        card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      }
      return okAll;
    }
    function review() {
      var rv = steps[N - 1].querySelector(".rev");
      rv.textContent = "";
      var vals = v.values(), shown = v.refresh();
      for (var si = 0; si < N - 1; si++) {
        var dl = h("dl");
        form.steps[si].fields.forEach(function (fd) {
          if (fd.type === "heading" || fd.type === "note" || !shown[fd.id]) return;
          var val = vals[fd.id], txt = "";
          if (fd.type === "file") txt = v.files[fd.id] ? v.files[fd.id].name : "";
          else if (fd.type === "checkbox") txt = val ? "✓" : "";
          else if (fd.options) {
            var picked = Array.isArray(val) ? val : [val];
            txt = fd.options.filter(function (o) { return picked.indexOf(o.value) >= 0; }).map(function (o) { return L(o, "label") + (o.price != null ? " — " + money(o.price) : ""); }).join(", ");
          } else txt = val;
          var wide = fd.width === "full" || fd.type === "file" || fd.type === "checkbox";
          dl.appendChild(h("div", { class: wide ? "w" : null }, [h("dt", { text: L(fd, "label") }), h("dd", { class: txt ? null : "na", text: txt || "—" })]));
        });
        if (!dl.children.length) continue;
        var hd = h("h4", null, [h("span", { text: L(form.steps[si], "title") }), h("button", { type: "button", "data-go": String(si), text: t("edit") })]);
        rv.appendChild(h("div", { class: "rv" }, [hd, dl]));
      }
      var total = computeTotal(form, vals, shown);
      if (total != null) rv.appendChild(h("div", { class: "tot" }, [h("span", { text: t("total") }), h("b", { text: money(total) })]));
    }
    function show(i, dir) {
      v.cur = i; v.maxv = Math.max(v.maxv, i); v.smsg.textContent = "";
      steps.forEach(function (st, k) { st.classList.toggle("on", k === i); st.classList.remove("r", "l"); if (k === i && dir) st.classList.add(dir); });
      sts.forEach(function (b, k) { b.classList.toggle("on", k === i); b.classList.toggle("done", k < i || (k <= v.maxv && k !== i)); b.disabled = k > v.maxv; });
      fill.style.width = (N > 1 ? i / (N - 1) * 100 : 100) + "%";
      cnt.textContent = t("stepOf", { i: i + 1, n: N });
      bk.classList.toggle("show", i > 0);
      nx.firstChild.textContent = i === N - 1 ? t("submit") : t("next");
      if (i === N - 1) review();
      if (dir) scrollToEl(document.getElementById("card"));
    }
    function next() {
      if (v.sending) return;
      if (!check(v.cur)) return;
      v.maxv = Math.max(v.maxv, v.cur + 1);
      if (v.cur < N - 1) show(v.cur + 1, "r"); else submit();
    }
    function submit() {
      for (var i = 0; i < N; i++) if (!check(i)) { show(i, "l"); return; }
      v.sending = true; nx.disabled = true; nx.firstChild.textContent = t("submitting");
      var vals = v.values(), shown = v.refresh(), payload = { race: race.id, role: role, form: form.id, lang: AR ? "ar" : "en", values: {}, files: {} };
      Object.keys(vals).forEach(function (id) {
        if (!shown[id]) return;
        if (fieldMap[id].type === "file") { if (v.files[id]) payload.files[id] = v.files[id]; }
        else payload.values[id] = vals[id];
      });
      fetch("/api/registrations/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || t("submitFail")); return d; }); })
        .then(function (d) {
          ok.querySelector(".ref b").textContent = d.ref || "";
          var mailed = ok.querySelector(".mailed");
          mailed.textContent = d.emailed ? t("emailed", { e: d.emailed }) : "";
          mailed.hidden = !d.emailed;
          f.style.display = "none"; stepper.style.display = "none"; ok.classList.add("show");
          scrollToEl(document.getElementById("card"));
        })
        .catch(function (e) { v.smsg.textContent = (e && e.message && e.message !== "Failed to fetch") ? e.message : t("submitFail"); })
        .then(function () { v.sending = false; nx.disabled = false; nx.firstChild.textContent = v.cur === N - 1 ? t("submit") : t("next"); });
    }
    function upload(input) {
      var box = input.closest(".up"), id = box.getAttribute("data-id"), file = input.files[0];
      var fn = box.querySelector(".fn"), drop = box.querySelector(".drop");
      delete box.dataset.fail; delete v.files[id];
      drop.classList.toggle("has", !!file);
      fn.textContent = file ? file.name : t("noFile");
      if (!file) { err(box, ""); v.refresh(); return; }
      var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1];
      ext = ext ? ext.toLowerCase() : "";
      if (!OK_EXT.test(file.name)) { box.dataset.fail = t("fileType"); err(box, box.dataset.fail); input.value = ""; return; }
      if (file.size > MAX) { box.dataset.fail = t("fileSize"); err(box, box.dataset.fail); input.value = ""; return; }
      err(box, ""); box.classList.add("busy"); fn.textContent = file.name + " — " + t("uploading");
      var seq = (box._seq || 0) + 1; box._seq = seq;
      fetch("/api/registrations/upload?form=" + encodeURIComponent(form.id) + "&field=" + encodeURIComponent(id),
        { method: "POST", headers: { "Content-Type": MEDIA[ext] || file.type }, body: file })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.token) throw new Error(d.error || t("uploadFail")); return d; }); })
        .then(function (d) { if (box._seq !== seq) return; v.files[id] = { token: d.token, name: file.name, size: d.size }; fn.textContent = "✓ " + file.name; })
        .catch(function (e) { if (box._seq !== seq) return; box.dataset.fail = (e && e.message && e.message !== "Failed to fetch") ? e.message : t("uploadFail"); err(box, box.dataset.fail); fn.textContent = file.name; drop.classList.remove("has"); input.value = ""; })
        .then(function () { if (box._seq !== seq) return; box.classList.remove("busy"); v.refresh(); });
    }

    nx.addEventListener("click", next);
    bk.addEventListener("click", function () { if (v.cur > 0) show(v.cur - 1, "l"); });
    f.addEventListener("submit", function (e) { e.preventDefault(); next(); });
    sts.forEach(function (b) { b.addEventListener("click", function () { var i = +b.dataset.i; if (i !== v.cur && i <= v.maxv) show(i, i > v.cur ? "r" : "l"); }); });
    f.addEventListener("click", function (e) { var g = e.target.closest("[data-go]"); if (g) show(+g.dataset.go, "l"); });
    f.addEventListener("input", function (e) { var b = e.target.closest("[data-id]"); if (b && b.classList.contains("bad") && e.target.type !== "file") err(b, ""); v.refresh(); });
    f.addEventListener("change", function (e) {
      var c = e.target, b = c.closest("[data-id]");
      if (c.type === "file") { upload(c); return; }
      if (b && b.classList.contains("bad")) err(b, "");
      var l = c.closest(".single .chks label"); if (l) l.classList.toggle("bad", !c.checked);
      v.refresh();
    });
    function lockRaceFields() {
      if (race.general) return; /* championship entry: the registrant types the round / venue / dates */
      Object.keys(RACE_FIELDS).forEach(function (id) {
        var input = f.querySelector('input[name="' + id + '"]');
        if (!input) return;
        input.value = L(race, RACE_FIELDS[id]);
        input.readOnly = true;
        input.closest("[data-id]").classList.add("locked");
      });
    }
    lockRaceFields();
    ok.querySelector(".again").addEventListener("click", function () {
      f.reset(); lockRaceFields(); v.files = {}; v.maxv = 0;
      [].forEach.call(f.querySelectorAll(".drop"), function (d) { d.classList.remove("has"); d.querySelector(".fn").textContent = t("noFile"); });
      [].forEach.call(f.querySelectorAll(".bad"), function (b) { b.classList.remove("bad"); });
      ok.classList.remove("show"); f.style.display = ""; stepper.style.display = "";
      v.refresh(); show(0, null); scrollToEl(document.getElementById("card"));
    });
    v.refresh();
    show(0, null);
    return v;
  }

  function computeTotal(form, values, shown) {
    var total = 0, mult = 1, priced = false;
    form.steps.forEach(function (s) {
      s.fields.forEach(function (f) {
        if (!f.options || !shown[f.id]) return;
        var picked = Array.isArray(values[f.id]) ? values[f.id] : [values[f.id]];
        f.options.forEach(function (o) {
          if (picked.indexOf(o.value) < 0) return;
          if (o.price != null) { total += Number(o.price); priced = true; }
          if (o.multiplier != null) mult *= Number(o.multiplier);
        });
      });
    });
    return priced ? Math.round(total * mult * 100) / 100 : null;
  }

  /* ------------------------------------------------------------------ races */
  function formById(id) { return forms.filter(function (x) { return x.id === id; })[0]; }
  function raceById(id) { return races.filter(function (x) { return x.id === id; })[0]; }
  function setNotes(race, form) {
    if (!notesEl) return;
    var ul = notesEl.querySelector("ul"), head = notesEl.querySelector("h3");
    if (head) { head.textContent = ""; head.appendChild(h("i", { class: "tri" })); head.appendChild(document.createTextNode(t("notes"))); }
    var lines = race ? (L(race, "notes") || "").split("\n") : [];
    if (form) lines = lines.concat((L(form, "notes") || "").split("\n"));
    lines = lines.filter(function (x) { return x.trim(); });
    if (race && L(race, "deadline_label")) lines.push(t("deadline") + ": " + L(race, "deadline_label") + " (" + t("ksa") + ")");
    notesEl.hidden = !lines.length;
    ul.textContent = "";
    lines.forEach(function (line) { ul.appendChild(h("li", { text: line })); });
  }
  function meta(race) {
    if (race.general) return [L(race, "category_title"), t("season"), t("seasonSub")].join(" · ");
    return [L(race, "category_title"), L(race, "location"), L(race, "date_label")].filter(Boolean).join(" · ");
  }
  function renderRaces() {
    tabsEl.textContent = "";
    tabsEl.classList.remove("races");
    tabsEl.setAttribute("aria-label", t("chooseRace"));
    /* Simple championship tabs: just the name (Karting, Autocross, Time Attack, Drift, Hill Climb, Baja). */
    races.forEach(function (race) {
      var b = h("button", { type: "button", role: "tab", class: "rtab", "data-race": race.id, "aria-selected": "false", style: "--tc:" + (race.color || "#e8202e") }, [
        h("span", { class: "rtab-dot" }), L(race, "category_title")]);
      b.addEventListener("click", function () { selectRace(race.id, null); });
      tabsEl.appendChild(b);
    });
    tabsEl.hidden = false;
  }
  function roleCard(race, role) {
    var b = h("button", { type: "button", class: "role", "data-role": role, "aria-pressed": "false" }, [
      h("span", { class: "role-ic", html: role === "photographer" ? ICON_CAMERA : ICON_RACER }),
      h("span", { class: "role-tx" }, [h("b", { text: t(role) }), h("small", { text: t(role + "Sub") })])]);
    b.addEventListener("click", function () { selectRole(role, true); });
    return b;
  }
  function selectRace(id, role) {
    var race = raceById(id) || races[0];
    if (!race) return;
    active = race.id; activeRole = null;
    [].forEach.call(tabsEl.children, function (b) {
      var on = b.getAttribute("data-race") === race.id;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
    });
    Object.keys(views).forEach(function (k) { views[k].root.hidden = true; });
    var old = host.querySelector(".racehead"); if (old) old.remove();
    if (!race.general) { /* a race the organiser opened: show its name, venue and dates above the form */
      var head = h("div", { class: "racehead" }, [
        h("div", { class: "fhead" }, [h("span", { class: "eb", text: t("raceReg") }), h("strong", { text: L(race, "name") }),
          h("span", { class: "rmeta", text: meta(race) })])]);
      host.insertBefore(head, host.firstChild);
    }
    document.getElementById("card").style.setProperty("--fc", race.color || "#e8202e");
    setNotes(race, null);
    var want = role && race.roles.indexOf(role) >= 0 ? role : (race.roles.length === 1 ? race.roles[0] : null);
    if (want) selectRole(want, false); else updateUrl();
  }
  function selectRole(role, scroll) {
    var race = raceById(active);
    if (!race || race.roles.indexOf(role) < 0) return;
    var form = formById(race.forms[role]);
    if (!form) return;
    activeRole = role;
    [].forEach.call(host.querySelectorAll(".role"), function (b) {
      var on = b.getAttribute("data-role") === role;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    });
    var hint = host.querySelector(".rolehint"); if (hint) hint.hidden = true;
    var key = race.id + "/" + role;
    if (!views[key]) { views[key] = buildView(form, race, role); host.appendChild(views[key].root); }
    Object.keys(views).forEach(function (k) { views[k].root.hidden = k !== key; });
    document.getElementById("card").style.setProperty("--fc", role === "racer" ? (form.color || race.color || "#e8202e") : "#e8202e");
    setNotes(race, form);
    updateUrl();
    if (scroll) scrollToEl(views[key].root, 120);
  }
  function updateUrl() {
    try {
      var u = new URL(location.href);
      u.searchParams.delete("form");
      if (active) u.searchParams.set("race", active); else u.searchParams.delete("race");
      if (activeRole) u.searchParams.set("role", activeRole); else u.searchParams.delete("role");
      history.replaceState(null, "", u.href);
    } catch (e) {}
  }
  function initial() {
    var q = {};
    try { var p = new URLSearchParams(location.search); q = { race: p.get("race"), role: p.get("role"), form: p.get("form") }; } catch (e) {}
    if (q.race && raceById(q.race)) return { race: q.race, role: q.role };
    if (q.form) { /* old links such as ?form=drift or ?form=photographer */
      var byForm = races.filter(function (r) { return r.forms.racer === q.form || r.forms.photographer === q.form; })[0];
      if (byForm) return { race: byForm.id, role: byForm.forms.racer === q.form ? "racer" : "photographer" };
    }
    return { race: races[0] && races[0].id, role: q.role };
  }
  /* Built-in copy of the SAMF 2026 entry forms (registration-data.js). Used when the API cannot be reached
     (page opened as a file, static hosting, backend not deployed yet). Whenever the backend answers, its data
     is used as-is, so adding, editing, hiding or deleting a form in the dashboard always shows on the page. */
  function fallback() {
    var d = window.STC_REG_FALLBACK;
    return d && d.races && d.races.length ? JSON.parse(JSON.stringify(d)) : null;
  }
  function load() {
    if (location.protocol === "file:") return Promise.resolve(fallback());
    return fetch("/api/registration-races", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      /* The backend answered: show exactly what the dashboard has published, even when that is nothing. */
      .catch(function (e) { var f = fallback(); if (f) return f; throw e; });
  }
  function start() {
    AR = document.documentElement.getAttribute("lang") === "ar";
    host.textContent = ""; tabsEl.textContent = ""; /* clear any saved snapshot */
    host.appendChild(h("p", { class: "loadmsg", text: t("loading") }));
    load().then(function (doc) {
      forms = (doc && doc.forms) || [];
      races = ((doc && doc.races) || []).filter(function (r) {
        /* This page is for racers only; photographers register on photographer.html. */
        r.roles = (r.roles || []).filter(function (role) { var f = formById(r.forms && r.forms[role]); return role === "racer" && f && f.steps && f.steps.length; });
        return r.roles.length;
      });
      host.textContent = "";
      if (!races.length) {
        tabsEl.hidden = true;
        host.appendChild(h("div", { class: "closed" }, [h("i", { class: "tri" }), h("p", { text: t("noRaces") })]));
        if (notesEl) notesEl.hidden = true;
        return;
      }
      renderRaces();
      var first = initial();
      selectRace(first.race, first.role);
    }).catch(function () { host.textContent = ""; host.appendChild(h("p", { class: "loadmsg", text: t("loadFail") })); if (notesEl) notesEl.hidden = true; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
