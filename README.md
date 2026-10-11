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
