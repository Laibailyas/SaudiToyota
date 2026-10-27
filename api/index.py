import csv
import io
import urllib.request
import urllib.error
import datetime
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
from vercel.blob import AsyncBlobClient, list_objects
from vercel.blob.errors import BlobError

from server import CALENDAR_NAME, CALENDAR_LIMIT, clean_calendar, IMAGE_TYPES, PAGE_PATHS, PAGES, LIVE_NAME, RESULTS_LIMIT, RESULTS_NAME, ROOT, UPLOAD_LIMIT, clean_live, clean_results

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



REG_RACES_PATH = ROOT / "registration-races.json"
REG_RACES_BLOB = "dashboard-content/registration-races.json"

def valid_races(document):
    if not isinstance(document,dict) or not isinstance(document.get("races"),list) or len(document["races"])>300:
        raise ValueError("Invalid race list")
    original=json.loads(REG_RACES_PATH.read_text(encoding="utf-8"))["races"]
    allowed={r["id"]:r for r in original}
    seen=set()
    for race in document["races"]:
        if not isinstance(race,dict) or race.get("id") not in allowed or race["id"] in seen:
            raise ValueError("Race IDs must match the existing calendar")
        seen.add(race["id"])
        for key in ("name","location","city","category","date"):
            if race.get(key)!=allowed[race["id"]][key]:raise ValueError("Existing race data cannot be modified here")
        if not isinstance(race.get("open"),bool):raise ValueError("Invalid registration state")
    if seen!=set(allowed):raise ValueError("Cannot remove a calendar race")
    return document

async def get_races():
    saved=await read_page_override(REG_RACES_BLOB)
    return valid_races(json.loads(saved)) if saved else valid_races(json.loads(REG_RACES_PATH.read_text(encoding="utf-8")))

def registration_email(to, subject, body):
    api_key=os.environ.get("RESEND_API_KEY")
    sender=os.environ.get("REGISTRATION_FROM_EMAIL")
    if not api_key or not sender:return False,"Email provider not configured"
    payload=json.dumps({"from":sender,"to":[to],"subject":subject,"text":body}).encode()
    request=urllib.request.Request("https://api.resend.com/emails",data=payload,headers={"Authorization":"Bearer "+api_key,"Content-Type":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(request,timeout=8) as response:
            return response.status in (200,201),"accepted by provider" if response.status in (200,201) else "provider rejected message"
    except (urllib.error.URLError,TimeoutError) as exc:
        logger.warning("Registration email provider failure: %s",type(exc).__name__)
        return False,"provider request failed"

REG_FORMS_PATH = ROOT / "registration-forms.json"
REG_FORMS_BLOB = "dashboard-content/registration-forms.json"
REG_ENTRIES_BLOB = "dashboard-content/registration-entries.json"
REG_TYPES = {"text", "email", "tel", "date", "number", "textarea", "select", "checkbox"}

def validate_form_document(data):
    if not isinstance(data, dict) or not isinstance(data.get("forms"), list) or len(data["forms"]) > 30:
        raise ValueError("Invalid forms data (30 maximum).")
    ids=set()
    for form in data["forms"]:
        if not isinstance(form,dict) or not re.fullmatch(r"[a-z0-9-]{1,55}",str(form.get("id",""))) or form["id"] in ids:
            raise ValueError("Each form needs a unique valid ID.")
        ids.add(form["id"])
        if not isinstance(form.get("title"),str) or not 1 <= len(form["title"]) <= 120:
            raise ValueError("Invalid form title.")
        if not isinstance(form.get("fields"),list) or not 1 <= len(form["fields"]) <= 120:
            raise ValueError("Each form needs between 1 and 120 fields.")
        field_ids=set()
        for field in form["fields"]:
            if not isinstance(field,dict) or not re.fullmatch(r"[a-z0-9_]{1,60}",str(field.get("id",""))) or field["id"] in field_ids:
                raise ValueError("Duplicate or invalid field ID.")
            field_ids.add(field["id"])
            if field.get("type") not in REG_TYPES or not isinstance(field.get("label"),str) or not 1 <= len(field["label"]) <= 220:
                raise ValueError("Invalid field label/type.")
            if field["type"] == "select" and (not isinstance(field.get("options"),list) or len(field["options"]) > 60 or any(not isinstance(o,str) or len(o)>120 for o in field["options"])):
                raise ValueError("Invalid field options.")
    return {"forms":data["forms"]}

async def get_reg_forms():
    content = await read_page_override(REG_FORMS_BLOB)
    return validate_form_document(json.loads(content)) if content else validate_form_document(json.loads(REG_FORMS_PATH.read_text(encoding="utf-8")))

async def get_reg_entries():
    content=await read_page_override(REG_ENTRIES_BLOB)
    return json.loads(content) if content else {"entries":[]}

async def api_request(request: Request, route: str):
    route = route.strip("/")
    if request.method == "GET" and route == "registration/races":
        try:return json_response(await get_races())
        except (BlobError,StorageUnavailableError,ValueError):return json_response({"error":"Race registrations unavailable"},503)
    if route == "dashboard/registration-races":
        denied=session_required(request)
        if denied:return denied
        if request.method == "GET":
            try:return json_response(await get_races())
            except (BlobError,StorageUnavailableError,ValueError):return json_response({"error":"Race settings unavailable"},503)
        if request.method == "PUT":
            try:
                body=await request.body()
                if len(body)>100000:return json_response({"error":"Payload too large"},413)
                document=valid_races(json.loads(body))
                await write_blob(REG_RACES_BLOB,json.dumps(document).encode(),"application/json")
                return json_response({"ok":True})
            except (ValueError,TypeError,KeyError):return json_response({"error":"Invalid race settings"},400)
            except (BlobError,StorageUnavailableError):return json_response({"error":"Could not save race settings"},503)
    if route == "dashboard/registration-export" and request.method == "GET":
        denied=session_required(request)
        if denied:return denied
        try:
            import asyncio
            blobs=await asyncio.to_thread(list_objects,prefix="registration-entries/",limit=1000)
            output=io.StringIO();writer=csv.writer(output)
            writer.writerow(["Reference","Submitted UTC","Race","Location","Category","Registration type","Form","Field","Value"])
            for blob in blobs.blobs:
                if not blob.pathname.endswith(".json"):continue
                raw=await read_blob(blob.pathname)
                if not raw:continue
                entry=json.loads(raw)
                for value in entry.get("values",{}).values():
                    cell=str(value.get("value",""))
                    if cell.startswith(("=","+","-","@")):cell="'"+cell
                    writer.writerow([entry.get("id"),datetime.datetime.fromtimestamp(entry.get("created",0),datetime.timezone.utc).isoformat(),entry.get("race_name",""),entry.get("race_location",""),entry.get("race_category",""),entry.get("registration_type",""),entry.get("form_title",""),value.get("label",""),cell])
            return Response(output.getvalue(),media_type="text/csv; charset=utf-8",headers={"Content-Disposition":"attachment; filename=registration-entries.csv","Cache-Control":"no-store"})
        except (BlobError,StorageUnavailableError):return json_response({"error":"Export unavailable"},503)
    if request.method == "GET" and route == "registration/forms":
        try:
            document=await get_reg_forms()
            return json_response({"forms":[f for f in document["forms"] if f.get("active",True)]})
        except (BlobError,StorageUnavailableError,ValueError):
            return json_response({"error":"Registration forms could not be loaded."},503)

    if request.method == "POST" and route == "registration/submit":
        body=await request.body()
        if len(body)>200000: return json_response({"error":"Submission exceeds size limit."},413)
        try:
            payload=json.loads(body)
            document=await get_reg_forms()
            form=next((x for x in document["forms"] if x["id"]==payload.get("form_id") and x.get("active",True)),None)
            if form is None: return json_response({"error":"This registration form is unavailable."},404)
            races=await get_races()
            race=next((r for r in races["races"] if r["id"]==payload.get("race_id")),None)
            registration_type=payload.get("registration_type")
            if race is None or not race["open"]:return json_response({"error":"Registration for this race is closed."},403)
            if registration_type not in ("racer","photographer"):return json_response({"error":"Select a registration type"},400)
            if (form["id"]=="photographer")!=(registration_type=="photographer"):
                return json_response({"error":"The selected form does not match the registration type"},400)
            # Match competitor form to the selected race category.
            if registration_type=="racer" and re.sub(r"[^a-z0-9]","",form["title"].lower()) != re.sub(r"[^a-z0-9]","",race["category"].lower()):
                return json_response({"error":"This form does not match the race category"},400)
            email=payload.get("contact_email","")
            if not isinstance(email,str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email) or len(email)>250:
                return json_response({"error":"A valid confirmation email is required."},400)
            values=payload.get("values")
            if not isinstance(values,dict): return json_response({"error":"Invalid submission."},400)
            clean={}
            for field in form["fields"]:
                value=values.get(field["id"],"")
                if field["type"]=="checkbox": value=bool(value)
                elif not isinstance(value,str) or len(value)>3000: return json_response({"error":"Invalid field value."},400)
                if field.get("required") and (not value or (isinstance(value,str) and not value.strip())):
                    return json_response({"error":"Required field missing: "+field["label"]},400)
                if field["type"]=="email" and value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",value):
                    return json_response({"error":"Invalid email address."},400)
                if field["type"]=="select" and value and value not in field.get("options",[]):
                    return json_response({"error":"Invalid selection."},400)
                clean[field["id"]]={"label":field["label"],"value":value}
            # Client-generated idempotency token avoids duplicate persistence on retries.
            token=payload.get("submission_token","")
            if not isinstance(token,str) or not re.fullmatch(r"[a-f0-9-]{36}",token):return json_response({"error":"Invalid submission token"},400)
            ref="STC-"+hashlib.sha256(token.encode()).hexdigest()[:12].upper()
            try:
                existing=await read_blob("registration-entries/"+ref+".json")
                if existing:return json_response({"ok":True,"reference":ref,"duplicate":True,"email_status":"See original submission"})
            except (BlobError,StorageUnavailableError):
                logger.exception("Could not check submission idempotency")
                return json_response({"error":"Could not verify the submission. Retry safely."},503)
            entry={"id":ref,"form_id":form["id"],"form_title":form["title"],"created":int(time.time()),"values":clean,"race_id":race["id"],"race_name":race["name"],"race_location":race["location"],"race_category":race["category"],"registration_type":registration_type,"contact_email":email}
            # Each entry stored as separate immutable blob: concurrent registrations cannot overwrite one another.
            await write_blob("registration-entries/"+ref+".json",json.dumps(entry,ensure_ascii=False).encode(),"application/json")
            summary="\n".join(f"{v['label']}: {v['value']}" for v in clean.values())
            text_body=f"Reference: {ref}\nRace: {race['name']}\nLocation: {race['location']}\nCategory: {race['category']}\nRegistration type: {registration_type}\n\n{summary}"
            from starlette.concurrency import run_in_threadpool
            applicant_sent,_=await run_in_threadpool(registration_email,email,"Saudi Toyota Championship registration received",text_body)
            admin_address=os.environ.get("REGISTRATION_ADMIN_EMAIL","")
            admin_sent=False
            if admin_address:admin_sent,_=await run_in_threadpool(registration_email,admin_address,"New Saudi Toyota Championship registration",text_body)
            return json_response({"ok":True,"reference":ref,"email_status":{"registrant":"provider_accepted" if applicant_sent else "not_sent","admin":"provider_accepted" if admin_sent else "not_sent"}})
        except (BlobError,StorageUnavailableError):
            logger.exception("Registration failed")
            return json_response({"error":"Registration could not be saved. Try again."},503)
        except (ValueError,TypeError,KeyError,UnicodeDecodeError):
            return json_response({"error":"Invalid registration request."},400)

    if route in ("dashboard/registration-forms","dashboard/registration-entries"):
        denied=session_required(request)
        if denied:return denied
        if route == "dashboard/registration-forms":
            if request.method=="GET":
                try:return json_response(await get_reg_forms())
                except (BlobError,StorageUnavailableError):return json_response({"error":"Cannot load forms."},503)
            if request.method=="PUT":
                body=await request.body()
                if len(body)>500000:return json_response({"error":"Forms document is too large."},413)
                try:
                    document=validate_form_document(json.loads(body))
                    await write_blob(REG_FORMS_BLOB,json.dumps(document,ensure_ascii=False).encode(),"application/json")
                    return json_response({"ok":True})
                except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:return json_response({"error":str(exc)},400)
                except (BlobError,StorageUnavailableError):return json_response({"error":"Cannot save forms."},503)
        if route == "dashboard/registration-entries" and request.method=="GET":
            try:
                import asyncio
                blob_client()  # Require configured private storage before listing.
                result=await asyncio.to_thread(list_objects,prefix="registration-entries/",limit=250)
                entries=[]
                for blob in result.blobs:
                    if not blob.pathname.endswith(".json"):continue
                    content=await read_blob(blob.pathname)
                    if content: entries.append(json.loads(content))
                entries.sort(key=lambda x:x.get("created",0),reverse=True)
                return json_response({"entries":entries,"has_more":bool(getattr(result,"has_more",False))})
            except (BlobError,StorageUnavailableError,AttributeError):
                logger.exception("Could not list registrations")
                return json_response({"error":"Unable to load submissions."},503)

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
