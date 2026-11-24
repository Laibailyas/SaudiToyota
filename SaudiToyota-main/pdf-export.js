/* Saudi Toyota Championship — branded PDF export (real, selectable text).
   Draws A4 landscape pages in the site's look (dark background, red accents,
   bold uppercase Inter) with jsPDF and downloads them. Text in the PDF can be
   selected, copied and searched.

   window.STCPdf.export({
     filename: "saudi-toyota-calendar.pdf",
     eyebrow:  "Event Calendar",
     title:    "Events",
     meta:     ["23 events", "Type: All"],          // chips under the header (first one is red)
     columns:  [{ label: "No", width: "6%", number: true }, { label: "Event", width: "1fr", big: true }, ...],
     rows:     [{ cells: ["01", "BAJA | HAIL RALLY", ...], done: true }],
     layout:   "table" | "cards",                    // cards = one block per row, for wide data
     button:   element                               // optional: disabled while working
   });
*/
(function () {
  "use strict";
  var JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  var FONT_URLS = {
    "Inter-SemiBold.ttf": "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter@0.4.2/600SemiBold/Inter_600SemiBold.ttf",
    "Inter-ExtraBold.ttf": "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter@0.4.2/800ExtraBold/Inter_800ExtraBold.ttf",
    "NotoSansArabic-Bold.ttf": "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-arabic@0.4.3/700Bold/NotoSansArabic_700Bold.ttf",
  };
  var AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  var W = 842, H = 595, M = 34, BOTTOM = H - 46;
  var C = { bg: [8, 7, 8], white: [255, 255, 255], dim: [196, 196, 196], grey: [140, 140, 140], line: [38, 36, 37], head: [60, 58, 59], zebra: [13, 12, 13], red: [232, 32, 46], chip: [26, 26, 26], card: [17, 16, 17] };
  var libPromise = null, fontCache = {};

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load the PDF library. Check your internet connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  function ensureLib() {
    if (window.jspdf) return Promise.resolve();
    if (!libPromise) libPromise = loadScript(JSPDF_URL).catch(function (e) { libPromise = null; throw e; });
    return libPromise;
  }
  function fetchFont(name) {
    if (!fontCache[name]) fontCache[name] = fetch(FONT_URLS[name]).then(function (r) {
      if (!r.ok) throw new Error("font"); return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf), bin = "", step = 0x8000;
      for (var i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      return btoa(bin);
    }).catch(function () { delete fontCache[name]; return null; });
    return fontCache[name];
  }

  function tr(s) { try { return window.STC_I18N && window.STC_I18N.tr ? window.STC_I18N.tr(s) : s; } catch (e) { return s; } }
  function str(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }

  /* ---------- drawing helpers bound to one document ---------- */
  function Painter(doc, fonts) {
    var latin = fonts.inter ? "Inter" : "helvetica";
    function font(text, weight) {
      if (fonts.arabic && AR.test(text)) doc.setFont("NotoAr", "bold");
      else doc.setFont(latin, weight === "bold" ? "bold" : "normal");
    }
    function color(c) { doc.setTextColor(c[0], c[1], c[2]); }
    return {
      text: function (t, x, y, o) {
        o = o || {}; t = o.upper ? t.toUpperCase() : t;
        font(t, o.weight); doc.setFontSize(o.size || 9); color(o.color || C.white);
        doc.text(t, x, y, { align: o.align || "left", charSpace: o.space || 0, baseline: "alphabetic" });
        return doc.getTextWidth(t) + (o.space || 0) * t.length;
      },
      wrap: function (t, w, o) {
        o = o || {}; t = o.upper ? t.toUpperCase() : t;
        font(t, o.weight); doc.setFontSize(o.size || 9);
        return t ? doc.splitTextToSize(t, w) : [""];
      },
      width: function (t, o) { o = o || {}; font(t, o.weight); doc.setFontSize(o.size || 9); return doc.getTextWidth(o.upper ? t.toUpperCase() : t); },
      fill: function (c) { doc.setFillColor(c[0], c[1], c[2]); },
      stroke: function (c, w) { doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(w || 0.6); },
    };
  }

  function exportPdf(opts) {
    opts = opts || {};
    var btn = opts.button, label = btn ? btn.textContent : "";
    var busy = showBusy(tr("Preparing PDF…"));
    if (btn) { btn.disabled = true; btn.textContent = tr("Preparing PDF…"); }
    function cleanup() { busy.remove(); if (btn) { btn.disabled = false; btn.textContent = label; } }

    var allText = [opts.title, opts.eyebrow].concat(opts.meta || [], (opts.columns || []).map(function (c) { return c.label; }))
      .concat((opts.rows || []).map(function (r) { return [r.title, r.tag].concat(r.cells || r).join(" "); })).join(" ");
    var needArabic = AR.test(allText);

    return ensureLib().then(function () {
      return Promise.all([fetchFont("Inter-SemiBold.ttf"), fetchFont("Inter-ExtraBold.ttf"), needArabic ? fetchFont("NotoSansArabic-Bold.ttf") : null]);
    }).then(function (f) {
      var doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
      var fonts = { inter: !!(f[0] && f[1]), arabic: !!f[2] };
      if (fonts.inter) {
        doc.addFileToVFS("Inter-SemiBold.ttf", f[0]); doc.addFont("Inter-SemiBold.ttf", "Inter", "normal");
        doc.addFileToVFS("Inter-ExtraBold.ttf", f[1]); doc.addFont("Inter-ExtraBold.ttf", "Inter", "bold");
      }
      if (fonts.arabic) { doc.addFileToVFS("NotoSansArabic-Bold.ttf", f[2]); doc.addFont("NotoSansArabic-Bold.ttf", "NotoAr", "bold"); }
      render(doc, Painter(doc, fonts), opts);
      doc.setProperties({ title: str(opts.title || "Export") + " — Saudi Toyota Championship", creator: "Saudi Toyota Championship" });
      doc.save(opts.filename || "export.pdf");
    }).then(cleanup, function (err) { cleanup(); showError(err); throw err; });
  }

  function render(doc, P, opts) {
    var cols = opts.columns || [], rows = opts.rows || [], TW = W - 2 * M, y;

    function page(first) {
      if (!first) doc.addPage("a4", "landscape");
      P.fill(C.bg); doc.rect(0, 0, W, H, "F");
      P.fill(C.red); doc.rect(0, 0, W, 2.5, "F");                     // thin brand accent on top
      // brand
      P.text("SAUDI", M, M + 6, { size: 6.5, color: C.dim, space: 1.8 });
      P.text("TOYOTA", M, M + 25, { size: 21, weight: "bold" });
      P.text("CHAMPIONSHIP", M, M + 35, { size: 6.5, weight: "bold", color: C.red, space: 1.8 });
      // title
      P.text(str(opts.title), W - M, M + 24, { size: 26, weight: "bold", upper: true, align: "right" });
      var stamp = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      P.text(str(opts.eyebrow || "Saudi Toyota Championship") + "  ·  " + stamp, W - M, M + 37, { size: 6.5, color: C.grey, upper: true, align: "right", space: 0.9 });
      P.stroke(C.head, 0.6); doc.line(M, M + 47, W - M, M + 47);
      y = M + 56;
      // chips (first page only)
      if (first) {
        var x = M;
        (opts.meta || []).filter(Boolean).forEach(function (m, i) {
          m = str(m);
          var w = P.width(m, { size: 7.5, weight: "bold" }) + 16;
          if (x + w > W - M) { x = M; y += 21; }
          if (i === 0) { P.fill(C.red); doc.roundedRect(x, y, w, 16, 3, 3, "F"); }
          else { P.fill(C.chip); P.stroke(C.head, 0.6); doc.roundedRect(x, y, w, 16, 3, 3, "FD"); }
          P.text(m, x + 8, y + 10.8, { size: 7.5, weight: "bold", color: i === 0 ? C.white : [228, 228, 228] });
          x += w + 6;
        });
        if ((opts.meta || []).length) y += 26;
      }
      if (opts.layout !== "cards") tableHead();
    }

    /* ---- table ---- */
    var widths = (function () {
      var fixed = 0, fr = 0, spec = cols.map(function (c) {
        var w = String(c.width || "1fr"), pct = /^([\d.]+)%$/.exec(w), f = /([\d.]+)fr/.exec(w);
        if (pct) { var v = TW * parseFloat(pct[1]) / 100; fixed += v; return { px: v }; }
        var n = f ? parseFloat(f[1]) : 1; fr += n; return { fr: n };
      });
      var rest = Math.max(TW - fixed, 0);
      return spec.map(function (s) { return s.px != null ? s.px : rest * s.fr / (fr || 1); });
    })();
    function tableHead() {
      var x = M;
      cols.forEach(function (c, i) { P.text(str(c.label), x + 6, y + 10, { size: 6.5, color: C.grey, upper: true, space: 1.1 }); x += widths[i]; });
      y += 17; P.stroke(C.head, 0.6); doc.line(M, y, W - M, y);
    }
    function cellStyle(c) {
      if (c.number || c.big) return { size: 12.5, weight: "bold", upper: true, lh: 14.5 };
      return { size: 8, weight: c.plain ? "normal" : "bold", upper: !c.plain, color: c.dim ? C.dim : C.white, lh: 10 };
    }
    function tableRow(row, idx) {
      var cells = row.cells || row, laid = cols.map(function (c, i) {
        var st = cellStyle(c), lines = P.wrap(str(cells[i]), widths[i] - 12, st);
        return { st: st, lines: lines, h: lines.length * st.lh };
      });
      var h = Math.max.apply(null, laid.map(function (l) { return l.h; })) + 14;
      if (y + h > BOTTOM) { page(false); }
      if (idx % 2) { P.fill(C.zebra); doc.rect(M, y, TW, h, "F"); }
      var x = M;
      laid.forEach(function (l, i) {
        var ty = y + (h - l.h) / 2 + l.st.size * 0.82;
        l.lines.forEach(function (ln, k) {
          var w = P.text(ln, x + 6, ty + k * l.st.lh, { size: l.st.size, weight: l.st.weight, color: l.st.color });
          if (cols[i].number && row.done && k === 0) {               // red strike like the website
            var mid = ty - l.st.size * 0.38;
            P.stroke(C.red, 1.3); doc.line(x + 4, mid + 4, x + 8 + w, mid - 4);
          }
        });
        x += widths[i];
      });
      y += h; P.stroke(C.line, 0.5); doc.line(M, y, W - M, y);
    }

    /* ---- cards ---- */
    function card(row) {
      var cells = row.cells || row, per = 4, gap = 14, inner = TW - 28, colW = (inner - gap * (per - 1)) / per;
      var pairs = cols.map(function (c, i) { return [str(c.label), str(cells[i])]; }).filter(function (p) { return p[1]; });
      var grid = [];
      for (var i = 0; i < pairs.length; i += per) {
        var line = pairs.slice(i, i + per).map(function (p) { return { label: p[0], lines: P.wrap(p[1], colW, { size: 8, weight: "normal" }) }; });
        grid.push({ items: line, h: 9 + Math.max.apply(null, line.map(function (it) { return it.lines.length; })) * 10 + 6 });
      }
      var h = 30 + grid.reduce(function (s, g) { return s + g.h; }, 0) + 4;
      if (y + h > BOTTOM && y > M + 70) page(false);
      P.fill(C.card); P.stroke(C.head, 0.6); doc.roundedRect(M, y, TW, h, 4, 4, "FD");
      P.fill(C.red); doc.rect(M, y + 0.5, 2.6, h - 1, "F");
      var tx = M + 14;
      if (row.tag) tx += P.text(str(row.tag), tx, y + 19, { size: 10.5, weight: "bold", color: C.red, upper: true }) + 8;
      P.text(str(row.title), tx, y + 19, { size: 10.5, weight: "bold", upper: true });
      var gy = y + 30;
      grid.forEach(function (g) {
        g.items.forEach(function (it, k) {
          var gx = M + 14 + k * (colW + gap);
          P.text(it.label, gx, gy + 6, { size: 5.8, color: C.grey, upper: true, space: 0.8 });
          it.lines.forEach(function (ln, j) { P.text(ln, gx, gy + 16 + j * 10, { size: 8, weight: "normal" }); });
        });
        gy += g.h;
      });
      y += h + 8;
    }

    page(true);
    if (!rows.length) P.text(str(opts.empty || "No records to export."), M + 6, y + 30, { size: 11, color: C.grey });
    rows.forEach(function (r, i) { if (opts.layout === "cards") card(r); else tableRow(r, i); });

    // footers (now that the page count is known)
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      P.stroke([92, 22, 28], 0.6); doc.line(M, H - 30, W - M, H - 30);
      P.fill(C.red); doc.rect(M, H - 21.5, 4.5, 4.5, "F");
      P.text("SAUDI TOYOTA CHAMPIONSHIP", M + 10, H - 17.4, { size: 6.5, color: C.grey, space: 1.1 });
      P.text("PAGE " + p + " / " + n, W - M, H - 17.4, { size: 6.5, color: C.grey, space: 1.1, align: "right" });
    }
  }

  /* ---------- UI feedback ---------- */
  function injectCss() {
    if (document.getElementById("stcpdf-css")) return;
    var st = document.createElement("style");
    st.id = "stcpdf-css";
    st.textContent = ".stcpdf-busy{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(7,7,7,.78);color:#fff;font:700 14px Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}" +
      ".stcpdf-busy:before{content:'';width:18px;height:18px;margin-right:12px;border:2px solid rgba(255,255,255,.25);border-top-color:#e8202e;border-radius:50%;animation:stcpdfspin .8s linear infinite}" +
      ".stcpdf-err{cursor:pointer;background:rgba(7,7,7,.9);text-transform:none;letter-spacing:0;padding:24px;text-align:center}.stcpdf-err:before{display:none}" +
      "@keyframes stcpdfspin{to{transform:rotate(360deg)}}";
    document.head.appendChild(st);
  }
  function showBusy(text) {
    injectCss();
    var d = document.createElement("div");
    d.className = "stcpdf-busy"; d.textContent = text;
    document.body.appendChild(d);
    return d;
  }
  function showError(err) {
    var t = showBusy((err && err.message) || "PDF export failed.");
    t.classList.add("stcpdf-err");
    t.addEventListener("click", function () { t.remove(); });
    setTimeout(function () { t.remove(); }, 5000);
  }

  window.STCPdf = { export: exportPdf };
})();
