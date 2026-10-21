import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
CONTENT_ROOT = ROOT / ".dashboard-content"
UPLOAD_ROOT = ROOT / ".dashboard-uploads"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3000"))
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SESSION_TTL = 12 * 60 * 60
BODY_LIMIT = 8 * 1024 * 1024
UPLOAD_LIMIT = 10 * 1024 * 1024
SESSIONS = {}
SESSIONS_LOCK = threading.Lock()

PAGES = [
    {"path": "index.html", "title": "Home"},
    {"path": "calendar.html", "title": "Calendar"},
    {"path": "registration.html", "title": "Registration"},
    {"path": "photographer.html", "title": "Photographer Registration"},
    {"path": "news.html", "title": "News"},
    {"path": "news-samf-awards-2025.html", "title": "SAMF Awards 2025"},
    {"path": "news-tabuk-round-cancelled.html", "title": "Tabuk Round Update"},
    {"path": "news-tabuk-rally-postponed.html", "title": "Tabuk Rally Postponed"},
    {"path": "Gallery/gallery.html", "title": "Gallery"},
    {"path": "tournaments/karting.html", "title": "Karting"},
    {"path": "tournaments/autocross.html", "title": "Autocross"},
    {"path": "tournaments/time-attack.html", "title": "Time Attack"},
    {"path": "tournaments/drift.html", "title": "Drift"},
    {"path": "tournaments/hill-climb.html", "title": "Hill Climb"},
    {"path": "tournaments/baja.html", "title": "Baja"},
    {"path": "tournaments/e-gaming.html", "title": "E-Gaming"},
]
PAGE_PATHS = {page["path"] for page in PAGES}
IMAGE_TYPES = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
UPLOAD_NAME = re.compile(r"^[a-f0-9-]+\.(?:gif|jpg|png|webp)$")
RESULTS_NAME = "race-results.json"
RESULTS_LIMIT = 2 * 1024 * 1024
RACE_FIELDS = ("id", "title", "category", "round", "location", "date", "status", "note")
RESULT_FIELDS = ("pos", "no", "driver", "nat", "car", "cls", "group", "time", "points")
RACE_STATUSES = ("final", "provisional", "upcoming")


def clean_text(value, limit):
    if value is None or isinstance(value, (dict, list)):
        return ""
    return " ".join(str(value).split())[:limit]


LIVE_NAME = "live-scores.json"
LIVE_RACE_FIELDS = ("id", "title", "category", "round", "location", "date", "status", "note", "url", "link_label")
LIVE_RESULT_FIELDS = ("pos", "no", "driver", "team", "nat", "car", "cls", "run1", "pen1", "run2", "pen2", "run3", "pen3", "link")
LIVE_STATUSES = ("live", "upcoming", "finished")


def clean_document(data, race_fields, row_fields, statuses):
    if not isinstance(data, dict) or not isinstance(data.get("races"), list):
        raise ValueError("Send the scores as a list of races.")
    if len(data["races"]) > 500:
        raise ValueError("A maximum of 500 races can be saved.")
    races, seen = [], set()
    for race in data["races"]:
        if not isinstance(race, dict):
            raise ValueError("Each race must be an object.")
        item = {key: clean_text(race.get(key), 600 if key in ("note", "url") else 160) for key in race_fields}
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", item["id"]) or item["id"] in seen:
            raise ValueError("Each race needs a unique id.")
        seen.add(item["id"])
        if not item["title"]:
            raise ValueError("Every race needs a title.")
        if item["date"] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", item["date"]):
            raise ValueError(f"Use the YYYY-MM-DD date format for {item['title']}.")
        if "url" in item and item["url"] and not re.fullmatch(r"https?://\S+", item["url"]):
            raise ValueError(f"The live link for {item['title']} must start with https://")
        if item["status"] not in statuses:
            item["status"] = statuses[0]
        item["published"] = race.get("published") is not False
        rows = race.get("rows") or []
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError(f"{item['title']} has too many result rows.")
        item["rows"] = [
            {key: clean_text(row.get(key), 600 if key == "link" else 160) for key in row_fields}
            for row in rows
            if isinstance(row, dict) and any(clean_text(row.get(key), 160) for key in row_fields)
        ]
        for row in item["rows"]:
            if row.get("link") and not re.fullmatch(r"https?://\S+", row["link"]):
                raise ValueError(f"Live links in {item['title']} must start with https://")
        races.append(item)
    return {"version": 1, "updated": int(time.time()), "races": races}


def clean_results(data):
    """Validate the Race Scores document sent by the dashboard."""
    return clean_document(data, RACE_FIELDS, RESULT_FIELDS, RACE_STATUSES)


def clean_live(data):
    """Validate the Live Scores document sent by the dashboard."""
    return clean_document(data, LIVE_RACE_FIELDS, LIVE_RESULT_FIELDS, LIVE_STATUSES)


class DashboardHandler(SimpleHTTPRequestHandler):
    server_version = "SaudiToyotaSite"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length header.") from error
        if size < 0 or size > limit:
            raise OverflowError("Request body is too large.")
        body = self.rfile.read(size)
        if len(body) != size:
            raise ValueError("The request body ended unexpectedly.")
        return body

    def read_json(self, limit=BODY_LIMIT):
        return json.loads(self.read_body(limit).decode("utf-8"))

    def active_session(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get("stc_admin")
        token = morsel.value if morsel else ""
        with SESSIONS_LOCK:
            expires_at = SESSIONS.get(token)
            if not expires_at:
                return ""
            if expires_at < time.time():
                SESSIONS.pop(token, None)
                return ""
            SESSIONS[token] = time.time() + SESSION_TTL
            return token

    def require_session(self):
        if self.active_session():
            return True
        self.send_json(401, {"error": "Please log in to edit site content."})
        return False

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            if parsed.path == "/api/dashboard/session":
                self.send_json(200, {"authenticated": bool(self.active_session())})
            elif parsed.path == "/api/dashboard/pages":
                if not self.require_session():
                    return
                self.send_json(200, {"pages": PAGES})
            elif parsed.path == "/api/dashboard/preview":
                if not self.require_session():
                    return
                query = dict(part.split("=", 1) if "=" in part else (part, "") for part in parsed.query.split("&") if part)
                relative_path = unquote(query.get("path", ""))
                if relative_path not in PAGE_PATHS:
                    self.send_json(400, {"error": "Choose a valid page."})
                    return
                selected_path = CONTENT_ROOT.joinpath(*relative_path.split("/"))
                if not selected_path.is_file():
                    selected_path = ROOT.joinpath(*relative_path.split("/"))
                try:
                    html = selected_path.read_text(encoding="utf-8-sig")
                except OSError:
                    self.send_error(404, "Page not found.")
                    return
                directory = relative_path.rpartition("/")[0]
                base_href = f"/{directory}/" if directory else "/"
                base = f'<base href="{base_href}" data-dashboard-editor-base>'
                if re.search(r"<base\b", html, re.IGNORECASE):
                    html = re.sub(r"<base\b[^>]*>", base, html, count=1, flags=re.IGNORECASE)
                else:
                    html = re.sub(
                        r"<head\b[^>]*>",
                        lambda match: match.group(0) + base,
                        html,
                        count=1,
                        flags=re.IGNORECASE,
                    )
                script = '<script src="/dashboard-editor.js?v=7" data-dashboard-editor></script>'
                if re.search(r"</body\s*>", html, re.IGNORECASE):
                    html = re.sub(r"</body\s*>", script + "</body>", html, count=1, flags=re.IGNORECASE)
                else:
                    html += script
                body = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            elif parsed.path in ("/api/results", "/api/live"):
                results_path = CONTENT_ROOT / (RESULTS_NAME if parsed.path == "/api/results" else LIVE_NAME)
                if not results_path.is_file():
                    self.send_response(204)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                body = results_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_json(404, {"error": "Not found."})
            return

        if parsed.path == "/dashboard":
            self.path = "/dashboard.html"
            return super().do_GET()

        if parsed.path.startswith("/dashboard-assets/"):
            name = Path(unquote(parsed.path)).name
            if not UPLOAD_NAME.fullmatch(name):
                self.send_error(404, "Not found.")
                return
            self.path = f"/.dashboard-uploads/{name}"
            return super().do_GET()

        if parsed.path.startswith("/."):
            self.send_error(404, "Not found.")
            return

        relative_path = unquote(parsed.path).lstrip("/").replace("\\", "/")
        if relative_path in PAGE_PATHS:
            override_path = CONTENT_ROOT.joinpath(*relative_path.split("/"))
            if override_path.is_file():
                self.path = "/" + relative_path
                if parsed.query:
                    self.path += "?" + parsed.query

        query = dict(part.split("=", 1) if "=" in part else (part, "") for part in parsed.query.split("&") if part)
        if query.get("editor") == "1" and relative_path in PAGE_PATHS:
            if not self.require_session():
                return
            selected_path = CONTENT_ROOT.joinpath(*relative_path.split("/"))
            if not selected_path.is_file():
                selected_path = ROOT.joinpath(*relative_path.split("/"))
            try:
                html = selected_path.read_text(encoding="utf-8-sig")
            except OSError:
                self.send_error(404, "Page not found.")
                return
            script = '<script src="/dashboard-editor.js?v=7" data-dashboard-editor></script>'
            if re.search(r"</body\s*>", html, re.IGNORECASE):
                html = re.sub(r"</body\s*>", script + "</body>", html, count=1, flags=re.IGNORECASE)
            else:
                html += script
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlsplit(self.path)
        try:
            if parsed.path == "/api/dashboard/login":
                self.handle_login()
            elif parsed.path == "/api/dashboard/logout":
                token = self.active_session()
                with SESSIONS_LOCK:
                    SESSIONS.pop(token, None)
                self.send_response(200)
                self.send_header("Set-Cookie", "stc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            elif parsed.path == "/api/dashboard/save":
                self.handle_save()
            elif parsed.path == "/api/dashboard/upload":
                self.handle_upload()
            elif parsed.path == "/api/dashboard/results":
                self.handle_results()
            elif parsed.path == "/api/dashboard/live":
                self.handle_results(LIVE_NAME, clean_live)
            else:
                self.send_json(404, {"error": "Not found."})
        except OverflowError as error:
            self.send_json(413, {"error": str(error)})
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self.send_json(400, {"error": str(error) or "Invalid request."})
        except OSError:
            self.log_error("Dashboard file operation failed.")
            self.send_json(500, {"error": "The server could not save that change."})

    def handle_login(self):
        try:
            credentials = self.read_json(limit=16 * 1024)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self.send_json(400, {"error": str(error) or "Invalid login request."})
            return
        if not isinstance(credentials, dict):
            self.send_json(400, {"error": "Invalid login request."})
            return
        username = credentials.get("username")
        password = credentials.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            self.send_json(401, {"error": "Incorrect username or password."})
            return
        username_matches = hmac.compare_digest(username.encode("utf-8"), ADMIN_USERNAME.encode("utf-8"))
        password_matches = hmac.compare_digest(password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8"))
        if not username_matches or not password_matches:
            self.send_json(401, {"error": "Incorrect username or password."})
            return

        token = secrets.token_urlsafe(32)
        with SESSIONS_LOCK:
            SESSIONS[token] = time.time() + SESSION_TTL
        secure = "; Secure" if os.environ.get("DASHBOARD_HTTPS") == "1" else ""
        self.send_response(200)
        self.send_header(
            "Set-Cookie",
            f"stc_admin={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}{secure}",
        )
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", "11")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def handle_save(self):
        if not self.require_session():
            return
        data = self.read_json()
        if not isinstance(data, dict) or data.get("path") not in PAGE_PATHS or not isinstance(data.get("html"), str):
            self.send_json(400, {"error": "Choose a valid page and provide its HTML."})
            return

        relative_path = data["path"]
        file_path = CONTENT_ROOT.joinpath(*relative_path.split("/"))
        file_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = file_path.with_name(f"{file_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary_path.write_text(data["html"], encoding="utf-8")
            os.replace(temporary_path, file_path)
        finally:
            temporary_path.unlink(missing_ok=True)
        self.send_json(200, {"ok": True})

    def handle_results(self, name=RESULTS_NAME, cleaner=clean_results):
        if not self.require_session():
            return
        document = cleaner(self.read_json(limit=RESULTS_LIMIT))
        CONTENT_ROOT.mkdir(parents=True, exist_ok=True)
        file_path = CONTENT_ROOT / name
        temporary_path = file_path.with_name(f"{file_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary_path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary_path, file_path)
        finally:
            temporary_path.unlink(missing_ok=True)
        self.send_json(200, {"ok": True, "updated": document["updated"]})

    def handle_upload(self):
        if not self.require_session():
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        extension = IMAGE_TYPES.get(content_type)
        if not extension:
            self.send_json(415, {"error": "Use a PNG, JPEG, WebP, or GIF image."})
            return
        image = self.read_body(UPLOAD_LIMIT)
        if not image:
            self.send_json(400, {"error": "The selected image is empty."})
            return
        signatures = {
            ".gif": lambda value: value.startswith((b"GIF87a", b"GIF89a")),
            ".jpg": lambda value: value.startswith(b"\xff\xd8\xff"),
            ".png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
            ".webp": lambda value: len(value) >= 12 and value.startswith(b"RIFF") and value[8:12] == b"WEBP",
        }
        if not signatures[extension](image):
            self.send_json(415, {"error": "The selected file does not match its image type."})
            return
        UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
        file_name = f"{uuid.uuid4()}{extension}"
        with (UPLOAD_ROOT / file_name).open("xb") as image_file:
            image_file.write(image)
        self.send_json(200, {"url": f"/dashboard-assets/{file_name}"})

    def translate_path(self, request_path):
        parsed = urlsplit(request_path)
        decoded = unquote(parsed.path).replace("\\", "/")
        if decoded.startswith("/.dashboard-uploads/"):
            name = Path(decoded).name
            if UPLOAD_NAME.fullmatch(name):
                return str(UPLOAD_ROOT / name)
            return str(ROOT / "__not_found__")

        relative_path = decoded.lstrip("/")
        normalized = Path(relative_path)
        if normalized.is_absolute() or ".." in normalized.parts or any(part.startswith(".") for part in normalized.parts):
            return str(ROOT / "__not_found__")
        relative_name = normalized.as_posix()
        if relative_name in PAGE_PATHS:
            override_path = CONTENT_ROOT.joinpath(*relative_name.split("/"))
            if override_path.is_file():
                return str(override_path)
        return super().translate_path(request_path)


def main():
    if len(ADMIN_PASSWORD) < 12:
        raise SystemExit("Set ADMIN_PASSWORD to a value at least 12 characters long before starting the dashboard server.")
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Saudi Toyota site running at http://{HOST}:{PORT}")
    print(f"Admin username: {ADMIN_USERNAME}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping the server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
