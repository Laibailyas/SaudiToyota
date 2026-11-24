# Saudi Toyota Championship site

## CMS registration fix — October 2026

This update retains the existing site design and routes. It repairs registration CMS initialization, adds starter race drafts and ships the existing official form templates.

**Included on a fresh deployment:** the six SAMF 2026 championship entry forms (Karting, Autocross, Time Attack, Drift, Hill Climb, Baja) and one Photographer form, all editable from **Dashboard → Registrations → Forms**. The exact supplied DOCX originals remain in `Original-SAMF-Entry-Forms.zip`. Also included are **19 starter championship race drafts** under **Registrations → Races**, initially **closed** to prevent inadvertently accepting registrations. The race editor can open an existing race or create a new race. E-Gaming was not seeded with a registration form because no E-Gaming entry template was supplied.

**To create/edit forms and fields:**

1. Log in to `/dashboard`, open **Registrations → Forms**.
2. Use **+ New form**, edit title, category and settings, and add/edit/remove/reorder steps and fields. You can duplicate or delete any form.
3. Click **Save & publish**. Reload to verify it persists. The public page only offers registrations for open races using a published/open form.
4. To open registration, switch to **Registrations → Races**, select a starter race or choose **+ Open registration for a race**, enter its name, category, venue and dates, tick **Registration open**, choose allowed applicant roles, then **Save & publish**.
5. Confirm the selected race appears at `/registration.html`. Use **Entries** to view and manage public submissions.

**Important for Vercel deployments:** the dashboard depends on persistent **private Vercel Blob** storage. Without it, an admin may be able to log in and read the bundled defaults but **Save & publish will not persist**. In Vercel, add a **Private Blob store** to this project, set its `BLOB_READ_WRITE_TOKEN` for Production, and set strong `ADMIN_PASSWORD` (12+ characters) and `DASHBOARD_SECRET` (32+ characters), then redeploy. Do not put actual credentials in GitHub or the ZIP. Confirm a form edit still exists after a browser refresh. SMTP credentials are separate and required for real notification emails; they are not required for saving submissions.

The bundled defaults are used only if no saved registration document exists; the CMS **does not overwrite forms or races already saved in persistent storage**. If an older deployment already has a saved empty race list, you can use **+ Open registration for a race** to add races; starter drafts do not replace intentionally saved data.

**QA completed against this code:** local backend API tests, mocked private-Blob Vercel API tests and headless browser CMS-click tests. Actual live production persistence, mail delivery and user-domain behavior still require checking after deployment with the real credentials and Blob store. See `REGISTRATION_FIX_QA.md` for details.

---

## Run the site and content dashboard

The dashboard needs the Python standard library and does not require installing packages. Start the site from the project folder in PowerShell:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "choose-a-unique-password-at-least-12-characters"
python server.py
```

Open `http://localhost:3000/dashboard` to sign in. The dashboard username defaults to `admin`; set `ADMIN_USERNAME` to change it. Use a unique password of at least 12 characters and do not publish it in source control.

Choose a page from the top bar. The editor sidebar stays open beside the preview; click a pencil on any text or image to select it. Edit text in the sidebar or choose a replacement image there, then click **Save changes** to publish. The server stores changed pages and uploaded images in `.dashboard-content/` and `.dashboard-uploads/`, and serves those changes to visitors instead of the original page files.

Keep both storage folders on persistent storage when deploying the server. Back them up to retain edits and uploads. For a public deployment, set `HOST=0.0.0.0`, serve the dashboard over HTTPS, use a strong private password, and configure the hosting firewall or reverse proxy to expose only the intended site. If HTTPS terminates at a reverse proxy, also set `DASHBOARD_HTTPS=1` so admin session cookies are marked secure.

## Deploy on Vercel

The project includes a FastAPI function for Vercel, while `server.py` remains available for local development and ordinary Python hosting. Vercel Blob stores published page overrides and uploaded images; the function serves those overrides when visitors open the corresponding HTML page.

1. Import the project into Vercel and create a **private Vercel Blob store** in the same Vercel project.
2. In **Project Settings → Environment Variables**, set:
   - `ADMIN_USERNAME`: the admin username (optional; defaults to `admin`).
   - `ADMIN_PASSWORD`: a strong password of at least 12 characters.
   - `DASHBOARD_SECRET`: a separate random secret of at least 32 characters.
   - `BLOB_READ_WRITE_TOKEN`: the token Vercel provides for the private Blob store.
3. Add the variables to the Production environment and redeploy. Open `/dashboard` on the deployed domain.

The Vercel function limits image uploads to 4 MB. Text and image changes persist in Blob across deployments. The `api/index.py` function includes the static site files it serves; Vercel serves the backend and website on the same domain.

The dashboard loads editor previews through an authenticated function endpoint, which injects the edit controls even when Vercel serves the public HTML pages as static files.

The backend can also run on another host that supports Python ASGI/FastAPI and outbound HTTPS, using the same Vercel Blob token for persistent storage. For ordinary hosting with a persistent local filesystem, the existing `python server.py` backend can continue to use `.dashboard-content/` and `.dashboard-uploads/` instead.

## Race Scores

The public page is `results.html`. In the dashboard, switch the top bar from **Pages** to **Race Scores** to add, edit, duplicate, hide or delete races and their result rows. Each race has a title, category, round, location, date and status (Final, Provisional or Upcoming). Result rows can be typed in, pasted straight from Excel or Google Sheets, or imported from a CSV file (comma, semicolon or tab separated; headers such as `Pos`, `Car No.`, `Driver`, `Nat.`, `Car`, `Class`, `Group`, `Time`, `Points` are recognised). **Save & publish** stores everything in `.dashboard-content/race-results.json` locally, or in Vercel Blob when deployed, and the page reads it from `/api/results`. Until the first save, the page shows the default races embedded in `results.html`.

## Live Scores

The public page is `live.html`. In the dashboard, choose **Live Scores** in the top bar to add live races, set each race's **Live race link** (the button visitors click to open the live race) and button text, and enter timing per driver: run times (`1:05.483`), penalties (`+2.000`) and `DIS`/`DNF`. Best time, gap to first and gap to previous are calculated automatically; **Auto-rank by best time** fills the positions. Up to three runs are supported, and CSV import/export and pasting from Excel work the same as on Race Scores. Saving stores `live-scores.json` (local folder or Vercel Blob), served from `/api/live`; while a race is marked Live, the public page refreshes every 20 seconds.

## Registrations

The public page is `registration.html`. It shows one tab per championship entry form (Karting, Autocross, Time Attack, Drift, Hill Climb and Baja by default, converted from the SAMF 2026 entry forms). Each tab is the same multi-step form; documents are uploaded as soon as they are chosen (PDF, JPG or PNG, up to 4 MB each), the last step shows a review with the fee total, and submitting gives the competitor a reference number such as `STC-DR-1A2B3C`. Link straight to a tab with `registration.html?form=drift`. The page also works in Arabic (`?lang=ar`) using the Arabic labels saved with each form.

In the dashboard, choose **Registrations** in the top bar:

- **Entries** lists every submission, grouped by form in the sidebar (with the number of new entries). Search, filter by status, select and delete entries, or **Export CSV** (opens in Excel, one column per form field). Click an entry to see everything the competitor submitted, open or download their documents, print the entry, and fill in the *For official use only* fields: status (New, In review, Accepted, Refused), entry number, competition number allocated, class confirmed, fee received, received by and remarks.
- **Forms** is the form builder. Add, duplicate, reorder or delete forms (tabs); hide a tab or close registrations with a message; edit the notes shown above the tabs; add, move, duplicate or delete steps and fields; set each field's type, English and Arabic labels, help text, required flag, width, options (with optional price in SAR and fee multiplier) and an optional condition (for example *show only if Competitor is the driver is No*, or *Age is less than 18*). **Save & publish** updates the registration page immediately. Entries of a deleted form stay available under *Deleted forms*.

Storage: locally, the edited forms are saved to `.dashboard-content/registration-forms.json`, and entries and uploaded documents to `.dashboard-registrations/` (private, never served to visitors; back it up with the other storage folders). On Vercel they are stored in the private Blob store under `dashboard-content/registration-forms.json` and `registrations/`. Until the forms are first saved from the dashboard, the built-in `registration-forms.json` is used. Uploaded documents can only be opened from the dashboard after logging in.

## Race registration (racers & photographers)

Registration now opens **per race**. In the dashboard choose **Registrations → Races → + Open registration for a race** and enter the race name (English/Arabic), location, category (Karting, Autocross, Time Attack, Drift, Hill Climb or Baja), dates and an optional registration deadline (KSA time). Tick whether **Racers**, **Photographers** or both can register, keep **Registration open** ticked and click **Save & publish**.

`registration.html` then lists the open races. The visitor picks a race, chooses **Racer** or **Photographer**, and fills in the form:

- Racers get the championship form of the race category (Round / Venue / Event dates are filled in from the race automatically).
- Photographers get one shared **Photographer** form (same questions as `photographer.html`) — the race, category and location are saved with the entry, so one form serves every race.

Direct link to a race: `registration.html?race=<race id>` (shown in the race editor). A race closes automatically when its deadline passes.

**Entries** groups registrations by race (with racer / photographer counts) and by form; filter by type and status, open an entry to see the race details and e-mail status, and **Export CSV (Excel)** exports exactly the filtered list with Race, Category, Location, Date and Registered-as columns.

### E-mails

After each registration the site e-mails a confirmation (with the reference and a summary) to the e-mail address entered in the form, and a notification to the organiser addresses set under **Races → E-mail notifications**. Configure SMTP with environment variables (locally or in Vercel → Environment Variables):

| Variable | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` / `smtp.office365.com` |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (SSL) |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | the mailbox login (for Gmail an App Password) |
| `SMTP_FROM` | `registrations@yourdomain.com` |
| `SMTP_FROM_NAME` | `Saudi Toyota Championship` (optional) |
| `REGISTRATION_NOTIFY_EMAIL` | extra organiser addresses (optional) |
| `SITE_URL` | `https://yourdomain.com` (optional, used for the dashboard link) |

Use **Send test e-mail** in Races to check the setup. If e-mail is not configured or fails, the registration is still saved; the entry shows the e-mail status and has a **Resend e-mails** button.

Storage: races are saved to `.dashboard-content/registration-races.json` locally, or `dashboard-content/registration-races.json` in Vercel Blob.
