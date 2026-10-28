# Saudi Toyota Championship — Registration CMS fix & QA

**Updated:** 28 October 2026

## Included / changed

- Kept the original site design, pages, animations and navigation.
- Supplied SAMF 2026 DOCX originals (6 files) verified identical to `Original-SAMF-Entry-Forms.zip`. Their editable CMS equivalents are stored in `registration-forms.json`.
- Included six preloaded championship entry forms plus a photographer form. Admin can create, duplicate, edit, publish/unpublish, close/reopen and delete forms; steps and fields can be added, edited, reordered, made conditional or removed.
- Loaded 19 scheduled race drafts from the existing championship calendar, linked to their appropriate form categories, with registration **closed by default**. Admin can edit/delete races or create new ones and choose racer/photographer registration. Only approved, open races show publicly.
- Improved CMS registration initialization: failure of the Entries API no longer stops the Forms and Races editor rendering. A storage error is surfaced instead of breaking the whole module.
- Fixed the generated race ID in browser contexts without `crypto.randomUUID`.
- Fixed the Vercel function bundle to include `registration-races.json` for new deployments.
- Public registration and file upload block unpublished/closed forms server-side.

## Tests run

1. **Python local HTTP API:** admin authentication; loading 7 forms and 19 draft races; create/edit/delete form and custom fields; publish/reload; open/close races; check public race listing; valid/invalid submission; entry edit, export-related listing and delete. **Passed.**
2. **Vercel FastAPI + mocked private Blob:** admin login; default seed; persist and reload form/race changes; publish public races; submit/list/update/delete registration entries. **Passed against mock storage.**
3. **Headless Chromium (Playwright):** click CMS Registrations tab; create new form; add textarea field; save/publish; create/open race via dashboard button; save/publish; checked browser JS errors. **Passed (no JS page errors in tested flow).**
4. `python -m py_compile registrations.py server.py api/index.py`, `node --check dashboard-registrations.js` and `node --check registration-form.js`: **Passed.**

## Production deployment checklist

- Redeploy the updated project to Vercel and verify the dashboard URL `/dashboard`.
- In the Vercel project's Storage tab, connect a **private Vercel Blob** store (not a public one); ensure `BLOB_READ_WRITE_TOKEN` is available in Production.
- Set `ADMIN_PASSWORD` (12+ characters) and `DASHBOARD_SECRET` (32+ characters); optionally `ADMIN_USERNAME`. Redeploy after changes.
- In CMS → Registrations → Forms, edit a harmless field and save; refresh the dashboard to confirm the edit persisted.
- In CMS → Registrations → Races, choose a race, open registration and save. Visit `/registration.html` in a separate private/incognito window to confirm it appears.
- Test an actual submission and check Entries. Optional: configure SMTP and click **Send test e-mail** to verify delivery.
- If live save errors remain, inspect Vercel logs and check `BLOB_READ_WRITE_TOKEN` is tied to the correct project/store and Production environment.

**Scope note:** This package is ready for deployment, but the actual external Vercel project and SMTP account were not modified or accessed in this environment. Simulated API tests cannot certify live persistence or email deliverability.
