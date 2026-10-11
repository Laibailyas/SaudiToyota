# Saudi Toyota Championship site

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
