import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from vercel.blob import AsyncBlobClient, BlobError

from server import CALENDAR_NAME, CALENDAR_LIMIT, clean_calendar, IMAGE_TYPES, PAGE_PATHS, PAGES, LIVE_NAME, RESULTS_LIMIT, RESULTS_NAME, ROOT, UPLOAD_LIMIT, clean_live, clean_results
import asyncio
from urllib.parse import quote

import registrations as reg

logger = logging.getLogger("dashboard")
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
COOKIE_NAME = "stc_admin"
SESSION_TTL = 12 * 60 * 60
REQUEST_LIMIT = 4 * 1024 * 1024
UPLOAD_NAME = re.compile(r"^[a-f0-9-]+\.(?:gif|jpg|png|webp)$")


class StorageUnavailableError(RuntimeError):
    pass


def json_response(data, status_code=200, *, headers=None):
    response = JSONResponse(data, status_code=status_code, headers=headers)
    response.headers["Cache-Control"] = "no-store"
    return response


def inject_editor_script(html: str, page_path: str) -> str:
    directory = page_path.rpartition("/")[0]
    base_href = f"/{directory}/" if directory else "/"
    base = f'<base href="{base_href}" data-dashboard-editor-base>'
    if re.search(r"<base\b", html, re.IGNORECASE):
        html = re.sub(r"<base\b[^>]*>", base, html, count=1, flags=re.IGNORECASE)
    else:
        html = re.sub(r"<head\b[^>]*>", lambda match: match.group(0) + base, html, count=1, flags=re.IGNORECASE)
    script = '<script src="/dashboard-editor.js?v=7" data-dashboard-editor></script>'
    if re.search(r"</body\s*>", html, re.IGNORECASE):
        return re.sub(r"</body\s*>", script + "</body>", html, count=1, flags=re.IGNORECASE)
    return html + script


def issue_session() -> str:
    secret = os.environ.get("DASHBOARD_SECRET", "")
    if len(secret) < 32:
        raise ValueError("Set DASHBOARD_SECRET to a random value of at least 32 characters.")
    expires = int(time.time()) + SESSION_TTL
    payload = f"{expires}.{secrets.token_urlsafe(24)}"
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def has_session(request: Request) -> bool:
    secret = os.environ.get("DASHBOARD_SECRET", "")
    parts = request.cookies.get(COOKIE_NAME, "").split(".", 2)
    if len(secret) < 32 or len(parts) != 3:
        return False
    expires, nonce, signature = parts
    if not expires.isdecimal() or not nonce or int(expires) < time.time():
        return False
    payload = f"{expires}.{nonce}"
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def session_required(request: Request):
    if has_session(request):
        return None
    return json_response({"error": "Please log in to edit site content."}, 401)


def blob_client():
    if not os.environ.get("BLOB_READ_WRITE_TOKEN"):
        raise StorageUnavailableError("Configure BLOB_READ_WRITE_TOKEN to enable persistent dashboard storage.")
    return AsyncBlobClient()


async def read_blob(pathname: str):
    result = await blob_client().get(pathname, access="private", use_cache=False)
    if result is None or result.status_code != 200 or result.stream is None:
        return None
    body = bytearray()
    async for chunk in result.stream:
        body.extend(chunk)
    return bytes(body)


async def read_page_override(pathname: str):
    if not os.environ.get("BLOB_READ_WRITE_TOKEN"):
        return None
    return await read_blob(pathname)


async def write_blob(pathname: str, body: bytes, content_type: str):
    await blob_client().put(
        pathname,
        body,
        access="private",
        content_type=content_type,
        add_random_suffix=False,
        overwrite=True,
        cache_control_max_age=60,
    )


REG_ENTRIES = "registrations/entries"
REG_FILES = "registrations/files"


async def read_registration_forms():
    content = await read_page_override(f"dashboard-content/{reg.FORMS_NAME}")
    return reg.parse_forms(content)


async def read_registration_races():
    content = await read_page_override(f"dashboard-content/{reg.RACES_NAME}")
    return reg.parse_races(content)


def site_url(request: Request) -> str:
    configured = os.environ.get("SITE_URL", "").strip()
    if configured:
        return configured
    return str(request.base_url).rstrip("/")


async def blob_items(prefix: str):
    items = []
    iterator = await blob_client().iter_objects(prefix=prefix)
    async for item in iterator:
        items.append(item)
    return items


async def blob_file_exists(token: str) -> bool:
    if not reg.FILE_TOKEN.fullmatch(token):
        return False
    return any(item.pathname == f"{REG_FILES}/{token}" for item in await blob_items(f"{REG_FILES}/{token}"))


async def read_entry(form_id: str, entry_id: str):
    if not reg.FORM_ID.fullmatch(form_id) or not reg.ENTRY_ID.fullmatch(entry_id):
        return None
    content = await read_blob(f"{REG_ENTRIES}/{form_id}/{entry_id}.json")
    return json.loads(content.decode("utf-8")) if content else None


async def write_entry(entry):
    await write_blob(f"{REG_ENTRIES}/{entry['form']}/{entry['id']}.json",
                     json.dumps(entry, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")


async def registration_request(request: Request, route: str):
    """Competitor registration routes (public upload/submit and dashboard management)."""
    if request.method == "GET" and route == "registration-forms":
        try:
            document = await read_registration_forms()
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not read registration forms.")
            document = reg.load_default_forms()
        return json_response(reg.public_forms(document))

    if request.method == "GET" and route == "registration-races":
        try:
            forms_doc, races_doc = await read_registration_forms(), await read_registration_races()
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not read registration races.")
            forms_doc, races_doc = reg.load_default_forms(), reg.empty_races()
        return json_response(reg.public_races(races_doc, forms_doc))

    if request.method == "POST" and route == "registrations/upload":
        form_id = request.query_params.get("form", "")
        field_id = request.query_params.get("field", "")
        try:
            if not reg.upload_allowed(await read_registration_forms(), form_id, field_id):
                return json_response({"error": "This upload is not available."}, 400)
            body = await request.body()
            extension = reg.check_upload(request.headers.get("content-type", ""), body)
            token = reg.new_file_token(extension)
            await write_blob(f"{REG_FILES}/{token}", body, reg.FILE_MEDIA[extension])
        except OverflowError as error:
            return json_response({"error": str(error)}, 413)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not store a registration document.")
            return json_response({"error": "The file could not be saved. Please try again."}, 503)
        return json_response({"token": token, "size": len(body)})

    if request.method == "POST" and route == "registrations/submit":
        body = await request.body()
        if len(body) > reg.SUBMIT_LIMIT:
            return json_response({"error": "The registration is too large."}, 413)
        try:
            payload = json.loads(body.decode("utf-8"))
            document = await read_registration_forms()
            tokens = {}
            for ref in (payload.get("files") or {}).values() if isinstance(payload, dict) and isinstance(payload.get("files"), dict) else []:
                token = str(ref.get("token", "")) if isinstance(ref, dict) else ""
                if reg.FILE_TOKEN.fullmatch(token):
                    tokens[token] = await blob_file_exists(token)
            races_doc = await read_registration_races()
            form, entry = reg.clean_submission(document, payload, lambda token: tokens.get(token, False), races_doc)
            await write_entry(entry)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return json_response({"error": "Invalid registration."}, 400)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not save a registration.")
            return json_response({"error": "The registration could not be saved. Please try again."}, 503)
        try:
            entry["mail"] = await asyncio.to_thread(reg.notify, entry, form, races_doc, site_url(request))
            await write_entry(entry)
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not store the e-mail status of a registration.")
        return json_response({"ok": True, "ref": entry["ref"],
                              "emailed": entry.get("mail", {}).get("to", "") if entry.get("mail", {}).get("registrant") == "sent" else ""})

    denied = session_required(request)
    if denied:
        return denied

    try:
        if request.method == "GET" and route == "dashboard/registration-forms":
            return json_response(await read_registration_forms())

        if request.method == "POST" and route == "dashboard/registration-forms":
            body = await request.body()
            if len(body) > reg.FORMS_LIMIT:
                return json_response({"error": "The forms are too large to save."}, 413)
            try:
                document = reg.clean_forms(json.loads(body.decode("utf-8")))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return json_response({"error": "Invalid forms request."}, 400)
            except ValueError as error:
                return json_response({"error": str(error)}, 400)
            await write_blob(f"dashboard-content/{reg.FORMS_NAME}", json.dumps(document, ensure_ascii=False).encode("utf-8"),
                             "application/json; charset=utf-8")
            return json_response({"ok": True, "updated": document["updated"], "forms": document["forms"]})

        if request.method == "GET" and route == "dashboard/registration-races":
            return json_response({**(await read_registration_races()), "mail": reg.mail_status()})

        if request.method == "POST" and route == "dashboard/registration-races":
            body = await request.body()
            if len(body) > reg.RACES_LIMIT:
                return json_response({"error": "The races are too large to save."}, 413)
            try:
                document = reg.clean_races(json.loads(body.decode("utf-8")), await read_registration_forms())
            except (json.JSONDecodeError, UnicodeDecodeError):
                return json_response({"error": "Invalid races request."}, 400)
            except ValueError as error:
                return json_response({"error": str(error)}, 400)
            await write_blob(f"dashboard-content/{reg.RACES_NAME}", json.dumps(document, ensure_ascii=False).encode("utf-8"),
                             "application/json; charset=utf-8")
            return json_response({"ok": True, **document})

        if request.method == "POST" and route == "dashboard/registrations/test-email":
            try:
                data = await request.json()
                messages = reg.test_message(data.get("to") if isinstance(data, dict) else "")
            except (json.JSONDecodeError, UnicodeDecodeError):
                return json_response({"error": "Invalid request."}, 400)
            except ValueError as error:
                return json_response({"error": str(error)}, 400)
            result = await asyncio.to_thread(reg.send_messages, messages)
            if result.get("test") == "not_configured":
                return json_response({"error": "E-mail is not set up on the server (SMTP_HOST …)."}, 400)
            if result.get("test") != "sent":
                return json_response({"error": f"The test e-mail could not be sent: {result.get('error', 'unknown error')}"}, 400)
            return json_response({"ok": True})

        if request.method == "POST" and route == "dashboard/registrations/resend":
            try:
                data = await request.json()
            except (json.JSONDecodeError, UnicodeDecodeError):
                return json_response({"error": "Invalid request."}, 400)
            entry = await read_entry(str(data.get("form", "")), str(data.get("id", ""))) if isinstance(data, dict) else None
            if not entry:
                return json_response({"error": "Entry not found."}, 404)
            form = reg.find_form(await read_registration_forms(), entry["form"])
            entry["mail"] = await asyncio.to_thread(reg.notify, entry, form, await read_registration_races(), site_url(request))
            await write_entry(entry)
            return json_response({"ok": True, "entry": entry})

        if request.method == "GET" and route == "dashboard/registrations":
            items = [item for item in await blob_items(f"{REG_ENTRIES}/") if item.pathname.endswith(".json")]
            entries = []
            for start in range(0, len(items), 20):
                batch = await asyncio.gather(*(read_blob(item.pathname) for item in items[start:start + 20]))
                for content in batch:
                    try:
                        if content:
                            entries.append(json.loads(content.decode("utf-8")))
                    except (ValueError, UnicodeDecodeError):
                        continue
            entries.sort(key=lambda e: e.get("created", 0), reverse=True)
            return json_response({"entries": entries})

        if request.method == "GET" and route == "dashboard/registrations/file":
            token = request.query_params.get("token", "")
            content = await read_blob(f"{REG_FILES}/{token}") if reg.FILE_TOKEN.fullmatch(token) else None
            if content is None:
                return json_response({"error": "File not found."}, 404)
            name = reg.download_name(request.query_params.get("name", ""), token)
            disposition = "inline" if request.query_params.get("inline") == "1" else "attachment"
            return Response(content, media_type=reg.FILE_MEDIA[Path(token).suffix], headers={
                "Cache-Control": "no-store", "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}"})

        if request.method == "POST" and route == "dashboard/registrations/update":
            try:
                data = await request.json()
            except (json.JSONDecodeError, UnicodeDecodeError):
                return json_response({"error": "Invalid update."}, 400)
            entry = await read_entry(str(data.get("form", "")), str(data.get("id", ""))) if isinstance(data, dict) else None
            if not entry:
                return json_response({"error": "Entry not found."}, 404)
            try:
                reg.apply_entry_update(entry, data)
            except ValueError as error:
                return json_response({"error": str(error)}, 400)
            await write_entry(entry)
            return json_response({"ok": True, "entry": entry})

        if request.method == "POST" and route == "dashboard/registrations/delete":
            try:
                data = await request.json()
            except (json.JSONDecodeError, UnicodeDecodeError):
                return json_response({"error": "Invalid request."}, 400)
            items = data.get("items") if isinstance(data, dict) and isinstance(data.get("items"), list) else []
            deleted = 0
            for item in items[:500]:
                if not isinstance(item, dict):
                    continue
                entry = await read_entry(str(item.get("form", "")), str(item.get("id", "")))
                if not entry:
                    continue
                paths = {f"{REG_ENTRIES}/{entry['form']}/{entry['id']}.json"}
                paths.update(f"{REG_FILES}/{ref.get('token')}" for ref in (entry.get("files") or {}).values()
                             if reg.FILE_TOKEN.fullmatch(str(ref.get("token", ""))))
                urls = []
                for path in paths:
                    urls += [blob.url for blob in await blob_items(path) if blob.pathname == path]
                if urls:
                    await blob_client().delete(urls)
                deleted += 1
            return json_response({"ok": True, "deleted": deleted})
    except (BlobError, StorageUnavailableError):
        logger.exception("Registration storage request failed.")
        return json_response({"error": "Persistent storage is temporarily unavailable."}, 503)

    return json_response({"error": "Not found."}, 404)


async def api_request(request: Request, route: str):
    route = route.strip("/")
    if route in ("registration-forms", "dashboard/registration-forms", "registration-races", "dashboard/registration-races") \
            or route.startswith(("registrations/", "dashboard/registrations")):
        return await registration_request(request, route)
    if request.method == "GET" and route == "dashboard/session":
        return json_response({"authenticated": has_session(request)})

    if request.method == "GET" and route == "calendar":
        try:
            content = await read_page_override(f"dashboard-content/{CALENDAR_NAME}")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not read calendar data.")
            return json_response({"error":"Calendar is temporarily unavailable."},503)
        if content is None:
            return Response(status_code=204,headers={"Cache-Control":"no-store"})
        return Response(content,media_type="application/json; charset=utf-8",headers={"Cache-Control":"no-store"})

    if request.method == "POST" and route == "dashboard/calendar":
        denied = session_required(request)
        if denied: return denied
        body = await request.body()
        if len(body)>CALENDAR_LIMIT: return json_response({"error":"CSV is too large."},413)
        try: document=clean_calendar(json.loads(body.decode("utf-8")))
        except (ValueError,UnicodeDecodeError,json.JSONDecodeError) as error: return json_response({"error":str(error)},400)
        try:
            await write_blob(f"dashboard-content/{CALENDAR_NAME}",json.dumps(document,ensure_ascii=False).encode("utf-8"),"application/json; charset=utf-8")
        except (BlobError,StorageUnavailableError):
            logger.exception("Could not persist calendar import.")
            return json_response({"error":"Could not persist the CSV import."},503)
        return json_response({"ok":True,"updated":document["updated"]})

    if request.method == "GET" and route in ("results", "live"):
        try:
            content = await read_page_override(f"dashboard-content/{RESULTS_NAME if route == 'results' else LIVE_NAME}")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not read race scores.")
            return json_response({"error": "Race scores are temporarily unavailable."}, 503)
        if content is None:
            return Response(status_code=204, headers={"Cache-Control": "no-store"})
        return Response(content, media_type="application/json; charset=utf-8", headers={"Cache-Control": "no-store"})

    if request.method == "POST" and route in ("dashboard/results", "dashboard/live"):
        is_live = route == "dashboard/live"
        denied = session_required(request)
        if denied:
            return denied
        body = await request.body()
        if len(body) > RESULTS_LIMIT:
            return json_response({"error": "Race scores are too large to save."}, 413)
        try:
            document = (clean_live if is_live else clean_results)(json.loads(body.decode("utf-8")))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return json_response({"error": "Invalid race scores request."}, 400)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        try:
            await write_blob(
                f"dashboard-content/{LIVE_NAME if is_live else RESULTS_NAME}",
                json.dumps(document, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not save race scores.")
            return json_response({"error": "Persistent storage could not save the race scores."}, 503)
        return json_response({"ok": True, "updated": document["updated"]})

    if request.method == "GET" and route == "dashboard/pages":
        denied = session_required(request)
        return denied or json_response({"pages": PAGES})

    if request.method == "GET" and route == "dashboard/preview":
        denied = session_required(request)
        if denied:
            return denied
        page_path = request.query_params.get("path", "")
        if page_path not in PAGE_PATHS:
            return json_response({"error": "Choose a valid page."}, 400)
        file_path = ROOT / page_path
        try:
            if not file_path.is_file():
                return json_response({"error": "Page not found."}, 404)
            content = await read_page_override(f"dashboard-content/{page_path}")
            html = content.decode("utf-8-sig") if content is not None else file_path.read_text(encoding="utf-8-sig")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not load saved page content for editor preview.")
            return Response("Page content is temporarily unavailable.", status_code=503)
        except OSError:
            logger.exception("Could not read source page for editor preview.")
            return Response("Page content is temporarily unavailable.", status_code=503)
        return HTMLResponse(inject_editor_script(html, page_path), headers={"Cache-Control": "no-store"})

    if request.method == "POST" and route == "dashboard/login":
        try:
            credentials = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return json_response({"error": "Invalid login request."}, 400)
        if not isinstance(credentials, dict):
            return json_response({"error": "Invalid login request."}, 400)
        username = credentials.get("username")
        password = credentials.get("password")
        configured_password = os.environ.get("ADMIN_PASSWORD", "")
        configured_username = os.environ.get("ADMIN_USERNAME", "admin")
        if not configured_password or len(os.environ.get("DASHBOARD_SECRET", "")) < 32:
            return json_response(
                {"error": "Configure ADMIN_PASSWORD and a 32-character DASHBOARD_SECRET."},
                503,
            )
        if not isinstance(username, str) or not isinstance(password, str):
            return json_response({"error": "Incorrect username or password."}, 401)
        if not hmac.compare_digest(username.encode(), configured_username.encode()) or not hmac.compare_digest(
            password.encode(), configured_password.encode()
        ):
            return json_response({"error": "Incorrect username or password."}, 401)
        try:
            token = issue_session()
        except ValueError as error:
            return json_response({"error": str(error)}, 503)
        response = json_response({"ok": True})
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_TTL,
            httponly=True,
            samesite="strict",
            secure=request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https",
            path="/",
        )
        return response

    if request.method == "POST" and route == "dashboard/logout":
        response = json_response({"ok": True})
        response.delete_cookie(COOKIE_NAME, httponly=True, samesite="strict", path="/")
        return response

    if request.method == "GET" and route == "dashboard/content":
        denied = session_required(request)
        if denied:
            return denied
        page_path = request.query_params.get("path", "")
        if page_path not in PAGE_PATHS:
            return json_response({"error": "Choose a valid page."}, 400)
        try:
            content = await read_blob(f"dashboard-content/{page_path}")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not read saved page content.")
            return json_response({"error": "Saved page content is temporarily unavailable."}, 503)
        return Response(
            content or b"",
            status_code=200 if content is not None else 204,
            media_type="text/html; charset=utf-8" if content is not None else None,
            headers={"Cache-Control": "no-store"},
        )

    if request.method == "POST" and route == "dashboard/save":
        denied = session_required(request)
        if denied:
            return denied
        try:
            data = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return json_response({"error": "Invalid save request."}, 400)
        if not isinstance(data, dict) or data.get("path") not in PAGE_PATHS or not isinstance(data.get("html"), str):
            return json_response({"error": "Choose a valid page and provide its HTML."}, 400)
        html = data["html"]
        if len(html.encode("utf-8")) > REQUEST_LIMIT:
            return json_response({"error": "Page content is too large to save."}, 413)
        try:
            await write_blob(f"dashboard-content/{data['path']}", html.encode("utf-8"), "text/html; charset=utf-8")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not save dashboard page content.")
            return json_response({"error": "Persistent storage could not save the page."}, 503)
        return json_response({"ok": True})

    if request.method == "POST" and route == "dashboard/upload":
        denied = session_required(request)
        if denied:
            return denied
        content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        extension = IMAGE_TYPES.get(content_type)
        if not extension:
            return json_response({"error": "Use a PNG, JPEG, WebP, or GIF image."}, 415)
        image = await request.body()
        if not image:
            return json_response({"error": "The selected image is empty."}, 400)
        if len(image) > min(UPLOAD_LIMIT, REQUEST_LIMIT):
            return json_response({"error": "Image must be 4 MB or smaller."}, 413)
        signatures = {
            ".gif": lambda value: value.startswith((b"GIF87a", b"GIF89a")),
            ".jpg": lambda value: value.startswith(b"\xff\xd8\xff"),
            ".png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
            ".webp": lambda value: len(value) >= 12 and value.startswith(b"RIFF") and value[8:12] == b"WEBP",
        }
        if not signatures[extension](image):
            return json_response({"error": "The selected file does not match its image type."}, 415)
        filename = f"{uuid.uuid4()}{extension}"
        try:
            await write_blob(f"dashboard-uploads/{filename}", image, content_type)
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not upload dashboard image.")
            return json_response({"error": "Persistent storage could not save the image."}, 503)
        return json_response({"url": f"/dashboard-assets/{filename}"})

    return json_response({"error": "Not found."}, 404)


async def serve_site_path(request: Request, path: str):
    path = path or "index.html"
    if path == "dashboard":
        path = "dashboard.html"
    normalized = Path(path.replace("\\", "/"))
    if normalized.is_absolute() or ".." in normalized.parts or any(part.startswith(".") for part in normalized.parts):
        return Response("Not found.", status_code=404)
    relative_path = normalized.as_posix()

    if relative_path == "dashboard.html":
        return FileResponse(ROOT / relative_path, headers={"Cache-Control": "no-store"})

    if request.method == "GET" and relative_path in PAGE_PATHS:
        editor_mode = request.query_params.get("editor") == "1"
        file_path = ROOT / relative_path
        if not file_path.is_file():
            return Response("Page not found.", status_code=404)
        if editor_mode:
            denied = session_required(request)
            if denied:
                return denied
            try:
                content = await read_page_override(f"dashboard-content/{relative_path}")
                html = (
                    content.decode("utf-8-sig")
                    if content is not None
                    else file_path.read_text(encoding="utf-8-sig")
                )
                html = inject_editor_script(html, relative_path)
            except (BlobError, StorageUnavailableError):
                logger.exception("Could not load saved page content for editor preview.")
                return Response("Page content is temporarily unavailable.", status_code=503)
            except OSError:
                logger.exception("Could not read source page for editor preview.")
                return Response("Page content is temporarily unavailable.", status_code=503)
            return HTMLResponse(html, headers={"Cache-Control": "no-store"})
        try:
            content = await read_page_override(f"dashboard-content/{relative_path}")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not load saved page content.")
            return Response("Page content is temporarily unavailable.", status_code=503)
        if content is not None:
            return HTMLResponse(content.decode("utf-8-sig"), headers={"Cache-Control": "no-store"})

    try:
        file_path = (ROOT / relative_path).resolve()
        file_path.relative_to(ROOT)
    except (OSError, ValueError):
        return Response("Not found.", status_code=404)
    if not file_path.is_file():
        return Response("Not found.", status_code=404)
    return FileResponse(file_path)


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def handle_vercel_request(request: Request, path: str = ""):
    route = request.query_params.get("route")
    if route is not None:
        return await api_request(request, route)
    if path.startswith("api/"):
        return await api_request(request, path.removeprefix("api/"))
    if path == "api":
        return await api_request(request, "")

    asset = request.query_params.get("asset")
    if asset is not None:
        filename = Path(asset).name
        if not UPLOAD_NAME.fullmatch(filename):
            return Response("Not found.", status_code=404)
        try:
            content = await read_blob(f"dashboard-uploads/{filename}")
        except (BlobError, StorageUnavailableError):
            logger.exception("Could not read uploaded dashboard image.")
            return Response("Image is temporarily unavailable.", status_code=503)
        if content is None:
            return Response("Not found.", status_code=404)
        extension = Path(filename).suffix
        media_type = next((kind for kind, suffix in IMAGE_TYPES.items() if suffix == extension), "application/octet-stream")
        return Response(content, media_type=media_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    return await serve_site_path(request, request.query_params.get("path", path))
