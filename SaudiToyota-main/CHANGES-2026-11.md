# Saudi Toyota Championship — client revision (20 Nov 2026)

Every point below comes from the client's change document (WEBSITE.docx) and the WhatsApp
follow-up. Each item lists what was asked and what was done.

---

## 1. Championship names (توحيد المسميات)

The site had several different Arabic spellings that did not match the official logos.
Everything is now unified with the logo artwork **and** with the official championship
site (saudi-championship.com).

| Was | Now | Where |
|---|---|---|
| كسر الزمن | **كسر الزمن** | nav, home card, calendar, hero, results, live, registration, footer |
| الأوتوكروس / أوتوكروس | **اوتوكروس** | everywhere (51 + 172 occurrences) |
| الطرق الوعرة (Off-Road) | **باها / Baja** | home card + its logo |
| الرياضات الإلكترونية | **الألعاب الإلكترونية** | championship name only |
| GAMES-E (Arabic hero) | **الألعاب الإلكترونية** | e-games hero |

Full championship titles now follow the official form — `بطولة السعودية تويوتا` + the
discipline, with no `لـ` prefix, exactly as the logos and the official site write them:

- بطولة السعودية تويوتا كارتنج
- بطولة السعودية تويوتا اوتوكروس
- بطولة السعودية تويوتا كسر الزمن
- بطولة السعودية تويوتا درفت
- بطولة السعودية تويوتا صعود الهضبة
- بطولة السعودية تويوتا باها
- بطولة السعودية تويوتا الألعاب الإلكترونية

**Not touched on purpose:** `الاتحاد السعودي للرياضات الإلكترونية` and
`الاتحاد الأردني للرياضات الإلكترونية` in the news article — those are the real names of
those federations. The 2025 news articles also keep `بطولة السعودية تويوتا للراليات`,
since that is published editorial copy about a past season.

## 2. Logos — all white, all correct

- Every logo on the site is now the **white version**, because the background is black.
- The white box behind the top-corner logo is gone.
- Each tournament page carries **its own championship logo** in the corner (Karting,
  Autocross, كسر الزمن, Drift, Hill Climb, Baja, E-Games) in both Arabic and English.
- Each home-page card carries its own championship logo instead of the generic lockup.
- The Arabic Baja logo said **راليات**; it now says **باها**, rebuilt from the artwork in
  your document onto the high-resolution lockup.
- The SAMF logo in the footer is replaced with the correct white version.
- All partner and organiser logos (Toyota, Jameel, Brandship, Lexonz, Ministry of Sport,
  SAMF, Abdullah S. Bakhashab) are now white.

Logos live in `assets/logos/` as real files instead of inline data, which also made the
pages much lighter.

## 3. Home page

- The hero title **بطولة السعودية تويوتا** is now fully white in both Arabic and English.
- The blue kart has been moved back in the Arabic hero so **السعودية تويوتا** reads in full.
- Clicking a championship name on the home page now opens that championship's page.
- The Off-Road card is now **Baja / باها** with the Baja logo.

## 4. Partners

- The Arabic headline is now **شركاء النجاح**.
- The glass cards are gone; the logos are now arranged in clean tiers separated by thin
  rules, in the arrangement of the reference you sent.
- Toyota now leads the official-partner tier.

## 5. Baja — three rounds, three pages

- Baja is **three rounds, not four**: the headline, the body copy, the round counter and
  the map markers (R1–R3) were all corrected.
- `tournaments/baja.html` is now a hub: hero, the three-round overview, then a chooser
  with one card per rally.
- Each rally is its own page with its own content:
  - `tournaments/baja-hail.html` — رالي حائل
  - `tournaments/baja-jeddah.html` — رالي جدة
  - `tournaments/baja-qassim.html` — رالي القصيم

## 6. Registration moved inside each championship

- The standalone **Competitor Registration** entry is gone from the nav and the footer.
- The full multi-step entry form is now embedded **inside each championship page**, filtered
  to that championship only: Karting, Autocross, كسر الزمن, Drift, Hill Climb, and each of
  the three Baja rallies.
- Photographer registration is unchanged and still reachable from the nav.

## 7. Gallery

- A **Photo Gallery** now sits beside the Video Gallery, with a switch between the two.
- 25 photographs, filterable by championship, with a full-screen lightbox and keyboard
  navigation.

## 8. News

- The page is **news only** — the "& Announcements" wording is gone from the heading, the
  nav, the footer and the article chips.

## 9. Content

- The Karting description is now the official text from
  `https://www.saudi-championship.com/karting`, in both Arabic and English.
- The word **اوتوكروس** in the Autocross hero now flashes **green** instead of red.
- The Arabic calendar now reads fully in Arabic, and the English calendar fully in English
  (Arabic used to leak into the English column).

---

## Still needed from you

1. **Hail and Qassim rally logos.** The Jeddah page has `images/jeddah-rally-2026.jpg`.
   The slot is built and styled identically on the Hail and Qassim pages — drop the two
   files in as `images/hail-rally-2026.jpg` and `images/qassim-rally-2026.jpg` and they
   appear immediately. Until then the slot stays hidden rather than showing a broken image.
2. **E-Games Arabic logo.** The Arabic E-Games logo has no discipline line under it (the
   English one says *E-Games*). Send the Arabic version and it goes straight in.

## Answers to your two questions

- **How are results entered on the results page?** Through the dashboard
  (`dashboard.html` → Race Scores for `results.html`, Live Scores for `live.html`). You can
  add, edit, duplicate, hide and delete races, edit the rows, **paste straight from Excel**,
  and import or export CSV. It saves to `/api/results` and `/api/live`, so the page updates
  without a redeploy.
- **Where does the Karting and Autocross information come from?** Both now match the
  official championship site: `saudi-championship.com/karting` and
  `saudi-championship.com/autocross-1`. The Karting text is yours, word for word.
