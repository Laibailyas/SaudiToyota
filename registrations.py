"""Competitor registration forms and entries.

Shared by server.py (local / ordinary Python hosting) and api/index.py (Vercel).
- Form definitions: the defaults ship in registration-forms.json; the dashboard saves an
  edited copy (registration-forms.json in the content storage) which then replaces them.
- Entries: one JSON document per submission plus the uploaded documents, both private
  and only readable from the dashboard after logging in.
"""

import html
import json
import math
import os
import re
import secrets
import smtplib
import ssl
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_FORMS_PATH = ROOT / "registration-forms.json"
DEFAULT_RACES_PATH = ROOT / "registration-races.json"
FORMS_NAME = "registration-forms.json"
FORMS_LIMIT = 1024 * 1024
RACES_NAME = "registration-races.json"
RACES_LIMIT = 512 * 1024
ROLES = ("racer", "photographer")
ROLE_LABEL = {"racer": "Racer", "photographer": "Photographer"}
ROLE_LABEL_AR = {"racer": "متسابق", "photographer": "مصور"}
RIYADH = timezone(timedelta(hours=3))
# Fields that every championship form starts with; they are filled from the race the visitor chose.
RACE_FIELD_MAP = {"round": "name", "venue": "location", "event_dates": "date_label"}
NAME_KEYS = ("driver_full_name", "competitor_name", "full_name", "name", "sign_driver")
SUBMIT_LIMIT = 256 * 1024
FILE_LIMIT = 4 * 1024 * 1024

FIELD_TYPES = ("text", "textarea", "email", "tel", "number", "date", "select", "radio",
               "checkboxes", "checkbox", "file", "heading", "note")
INPUT_TYPES = tuple(t for t in FIELD_TYPES if t not in ("heading", "note"))
OPTION_TYPES = ("select", "radio", "checkboxes")
CONDITION_OPS = ("eq", "neq", "in", "lt", "gte", "filled", "empty")
ENTRY_STATUSES = ("new", "in_review", "accepted", "refused")
FILE_TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
FILE_MEDIA = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png"}
FILE_TOKEN = re.compile(r"^[a-f0-9]{32}\.(?:pdf|jpg|png)$")
ENTRY_ID = re.compile(r"^\d{8}-\d{6}-[a-f0-9]{6}$")
FORM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
FIELD_ID = re.compile(r"^[a-z][a-z0-9_]{0,59}$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
PHONE = re.compile(r"^\+?[0-9()\-\s.]{6,30}$")


# --------------------------------------------------------------------------- helpers
def text(value, limit, multiline=False):
    if value is None or isinstance(value, (dict, list, bool)):
        return ""
    value = str(value).replace("\r\n", "\n").replace("\r", "\n")
    if multiline:
        value = "\n".join(" ".join(line.split()) for line in value.split("\n")).strip()
    else:
        value = " ".join(value.split())
    return value[:limit]


def number(value):
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def load_default_forms():
    return json.loads(DEFAULT_FORMS_PATH.read_text(encoding="utf-8"))


def parse_forms(raw):
    """Parse a stored forms document; fall back to the defaults when missing or broken."""
    if raw:
        try:
            doc = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except (ValueError, UnicodeDecodeError):
            doc = None
        if isinstance(doc, dict) and isinstance(doc.get("forms"), list):
            # Forms saved before the photographer form existed: add it once.
            if not doc.get("photographer_seeded") and not any(form_role(f) == "photographer" for f in doc["forms"]):
                taken = {f.get("id") for f in doc["forms"]}
                doc["forms"] += [f for f in load_default_forms().get("forms", [])
                                 if form_role(f) == "photographer" and f.get("id") not in taken]
            return doc
    return load_default_forms()


def public_forms(doc):
    """Forms the website shows: published ones only."""
    return {"version": 1, "updated": doc.get("updated", 0),
            "forms": [form for form in doc.get("forms", []) if form.get("published", True)]}


def find_form(doc, form_id):
    return next((form for form in doc.get("forms", []) if form.get("id") == form_id), None)


def all_fields(form):
    for step in form.get("steps", []):
        for field in step.get("fields", []):
            yield step, field


# --------------------------------------------------------------------------- form definitions
def clean_condition(raw, field_ids):
    if not isinstance(raw, dict) or not raw.get("field"):
        return None
    ref = text(raw.get("field"), 60)
    op = raw.get("op") if raw.get("op") in CONDITION_OPS else "eq"
    if ref not in field_ids:
        raise ValueError(f"A condition refers to an unknown field: {ref}.")
    return {"field": ref, "op": op, "value": text(raw.get("value"), 200)}


def clean_field(raw, field_ids):
    if not isinstance(raw, dict):
        raise ValueError("Each field must be an object.")
    kind = raw.get("type") if raw.get("type") in FIELD_TYPES else "text"
    fid = text(raw.get("id"), 60)
    long_label = kind in ("note", "checkbox", "heading")
    field = {
        "id": fid,
        "type": kind,
        "label": text(raw.get("label"), 3000 if long_label else 300, multiline=long_label),
        "label_ar": text(raw.get("label_ar"), 3000 if long_label else 300, multiline=long_label),
    }
    if not field["label"]:
        raise ValueError(f"Field {fid} needs a label.")
    if kind in INPUT_TYPES:
        field["required"] = bool(raw.get("required"))
        field["width"] = "full" if raw.get("width") == "full" or kind in ("textarea", "file", "checkboxes", "checkbox") else "half"
        for key in ("help", "help_ar"):
            if raw.get(key):
                field[key] = text(raw.get(key), 500)
    if kind == "number":
        for key in ("min", "max"):
            value = number(raw.get(key))
            if value is not None:
                field[key] = int(value) if value.is_integer() else value
    if kind in OPTION_TYPES:
        options, seen = [], set()
        for option in raw.get("options") or []:
            if not isinstance(option, dict):
                continue
            label = text(option.get("label"), 300)
            value = text(option.get("value"), 80) or re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:80]
            if not label or not value or value in seen:
                continue
            seen.add(value)
            item = {"value": value, "label": label, "label_ar": text(option.get("label_ar"), 300)}
            price = number(option.get("price"))
            if price is not None and 0 <= price <= 1_000_000:
                item["price"] = int(price) if price.is_integer() else price
            multiplier = number(option.get("multiplier"))
            if multiplier is not None and 0 < multiplier <= 10 and multiplier != 1:
                item["multiplier"] = int(multiplier) if multiplier.is_integer() else multiplier
            options.append(item)
        if not options:
            raise ValueError(f"{field['label'][:60]} needs at least one option.")
        if len(options) > 100:
            raise ValueError(f"{field['label'][:60]} has too many options.")
        field["options"] = options
    condition = clean_condition(raw.get("show_if"), field_ids)
    if condition:
        if condition["field"] == fid:
            raise ValueError(f"{field['label'][:60]} cannot depend on itself.")
        field["show_if"] = condition
    return field


def clean_forms(doc):
    """Validate the forms document saved from the dashboard form builder."""
    if not isinstance(doc, dict) or not isinstance(doc.get("forms"), list):
        raise ValueError("Send the registration forms as a list.")
    if len(doc["forms"]) > 40:
        raise ValueError("A maximum of 40 forms can be saved.")
    forms, form_ids = [], set()
    for raw in doc["forms"]:
        if not isinstance(raw, dict):
            raise ValueError("Each form must be an object.")
        fid = text(raw.get("id"), 40)
        if not FORM_ID.fullmatch(fid) or fid in form_ids:
            raise ValueError(f"Each form needs a unique id (lowercase letters, numbers and dashes): {fid or 'empty'}.")
        form_ids.add(fid)
        title = text(raw.get("title"), 80)
        if not title:
            raise ValueError("Every form needs a tab title.")
        color = raw.get("color") if isinstance(raw.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", raw.get("color")) else "#E8202E"
        prefix = re.sub(r"[^A-Z0-9]", "", str(raw.get("ref_prefix") or "").upper())[:6] or re.sub(r"[^A-Z0-9]", "", fid.upper())[:3] or "REG"
        form = {
            "id": fid, "title": title, "title_ar": text(raw.get("title_ar"), 80),
            "role": "photographer" if raw.get("role") == "photographer" else "racer",
            "color": color, "ref_prefix": prefix,
            "heading": text(raw.get("heading"), 200), "heading_ar": text(raw.get("heading_ar"), 200),
            "notes": text(raw.get("notes"), 3000, multiline=True), "notes_ar": text(raw.get("notes_ar"), 3000, multiline=True),
            "closed_message": text(raw.get("closed_message"), 500), "closed_message_ar": text(raw.get("closed_message_ar"), 500),
            "published": raw.get("published") is not False,
            "open": raw.get("open") is not False,
            # Shown on the public registration page as a championship entry even when no race is open.
            "listed": raw.get("listed") is not False,
            "steps": [],
        }
        steps = raw.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= 20:
            raise ValueError(f"{title} needs 1–20 steps.")
        field_ids = set()
        for step in steps:
            for field in (step.get("fields") or []) if isinstance(step, dict) else []:
                fid_ = text(field.get("id") if isinstance(field, dict) else "", 60)
                if not FIELD_ID.fullmatch(fid_):
                    raise ValueError(f"{title}: field ids must start with a letter and use lowercase letters, numbers and _ ({fid_ or 'empty'}).")
                if fid_ in field_ids:
                    raise ValueError(f"{title}: the field id {fid_} is used twice.")
                field_ids.add(fid_)
        step_ids, total_fields = set(), 0
        for index, step in enumerate(steps, 1):
            if not isinstance(step, dict):
                raise ValueError("Each step must be an object.")
            sid = text(step.get("id"), 40) or f"step-{index}"
            if not FORM_ID.fullmatch(sid) or sid in step_ids:
                sid = f"step-{index}-{secrets.token_hex(2)}"
            step_ids.add(sid)
            stitle = text(step.get("title"), 120)
            if not stitle:
                raise ValueError(f"{title}: step {index} needs a title.")
            fields = step.get("fields") or []
            if not isinstance(fields, list) or len(fields) > 200:
                raise ValueError(f"{title}: step {stitle} has too many fields.")
            total_fields += len(fields)
            form["steps"].append({
                "id": sid, "title": stitle, "title_ar": text(step.get("title_ar"), 120),
                "short": text(step.get("short"), 40), "short_ar": text(step.get("short_ar"), 40),
                "subtitle": text(step.get("subtitle"), 300), "subtitle_ar": text(step.get("subtitle_ar"), 300),
                "fields": [clean_field(field, field_ids) for field in fields],
            })
        if total_fields > 400:
            raise ValueError(f"{title} has too many fields.")
        forms.append(form)
    return {"version": 1, "updated": int(time.time()), "photographer_seeded": True, "forms": forms}


# --------------------------------------------------------------------------- races
# The organiser opens registration per race (dashboard → Registrations → Races). A race has a
# name, location and category (one of the championship forms). Visitors choose the race, then
# register either as a racer (the category's form) or as a photographer (the photographer form).
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEADLINE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
RACE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MONTHS_AR = ("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر")


def form_role(form):
    return "photographer" if (form or {}).get("role") == "photographer" else "racer"


def empty_races():
    return {"version": 1, "updated": 0, "races": [],
            "settings": {"notify_emails": "", "send_confirmation": True, "send_admin": True}}


def parse_races(raw):
    if raw:
        try:
            doc = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
            if isinstance(doc, dict) and isinstance(doc.get("races"), list):
                settings = empty_races()["settings"]
                settings.update(doc.get("settings") if isinstance(doc.get("settings"), dict) else {})
                doc["settings"] = settings
                return doc
        except (ValueError, UnicodeDecodeError):
            pass
    # Seed the existing race calendar as CLOSED drafts for first-time installs.
    # An existing saved document, including an empty one, always takes precedence.
    try:
        default_doc = json.loads(DEFAULT_RACES_PATH.read_text(encoding="utf-8"))
        if isinstance(default_doc, dict) and isinstance(default_doc.get("races"), list):
            settings = empty_races()["settings"]
            settings.update(default_doc.get("settings") if isinstance(default_doc.get("settings"), dict) else {})
            default_doc["settings"] = settings
            return default_doc
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    return empty_races()


def split_emails(value):
    return [part for part in re.split(r"[\s,;]+", str(value or "")) if part]


def clean_emails(value):
    emails = split_emails(text(value, 1000))
    bad = [e for e in emails if not EMAIL.fullmatch(e)]
    if bad:
        raise ValueError(f"Check this e-mail address: {bad[0]}")
    if len(emails) > 10:
        raise ValueError("Up to 10 notification e-mail addresses can be saved.")
    return ", ".join(dict.fromkeys(emails))


def date_label(race, ar=False):
    """'12 Nov 2026' or '12–14 Nov 2026' (also across months/years)."""
    def parts(value):
        try:
            d = date.fromisoformat(value)
        except (TypeError, ValueError):
            return None
        return d
    start, end = parts(race.get("date")), parts(race.get("date_end"))
    if not start:
        return ""
    months = MONTHS_AR if ar else MONTHS
    one = lambda d: f"{d.day} {months[d.month - 1]} {d.year}"
    if not end or end <= start:
        return one(start)
    if (start.year, start.month) == (end.year, end.month):
        return f"{start.day}–{end.day} {months[start.month - 1]} {start.year}"
    if start.year == end.year:
        return f"{start.day} {months[start.month - 1]} – {end.day} {months[end.month - 1]} {start.year}"
    return f"{one(start)} – {one(end)}"


def deadline_at(race):
    value = race.get("deadline") or ""
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M").replace(tzinfo=RIYADH) if value else None
    except ValueError:
        return None


def deadline_label(race, ar=False):
    when = deadline_at(race)
    if not when:
        return ""
    months = MONTHS_AR if ar else MONTHS
    return f"{when.day} {months[when.month - 1]} {when.year} — {when.strftime('%H:%M')}"


def race_is_open(race, now=None):
    if not race.get("open"):
        return False
    when = deadline_at(race)
    return not when or (now or datetime.now(timezone.utc)) < when


def clean_races(doc, forms_doc):
    """Validate the races document saved from the dashboard."""
    if not isinstance(doc, dict) or not isinstance(doc.get("races"), list):
        raise ValueError("Send the races as a list.")
    if len(doc["races"]) > 300:
        raise ValueError("A maximum of 300 races can be saved.")
    forms = {f.get("id"): f for f in forms_doc.get("forms", [])}
    photographer_forms = [fid for fid, f in forms.items() if form_role(f) == "photographer"]
    races, seen = [], set()
    for raw in doc["races"]:
        if not isinstance(raw, dict):
            raise ValueError("Each race must be an object.")
        rid = text(raw.get("id"), 60)
        if not RACE_ID.fullmatch(rid) or rid in seen:
            raise ValueError(f"Each race needs a unique id (lowercase letters, numbers and dashes): {rid or 'empty'}.")
        seen.add(rid)
        name = text(raw.get("name"), 160)
        if not name:
            raise ValueError("Every race needs a race name.")
        location = text(raw.get("location"), 160)
        if not location:
            raise ValueError(f"{name}: enter the race location.")
        category = text(raw.get("category"), 40)
        if category not in forms or form_role(forms[category]) != "racer":
            raise ValueError(f"{name}: choose the race category.")
        race = {
            "id": rid, "name": name, "name_ar": text(raw.get("name_ar"), 160),
            "location": location, "location_ar": text(raw.get("location_ar"), 160),
            "category": category,
            "photographer_form": "",
            "date": "", "date_end": "", "deadline": "",
            "open": raw.get("open") is True,
            "racers": raw.get("racers") is not False,
            "photographers": raw.get("photographers") is not False,
            "notes": text(raw.get("notes"), 1500, multiline=True), "notes_ar": text(raw.get("notes_ar"), 1500, multiline=True),
            "created": int(number(raw.get("created")) or time.time()),
        }
        for key in ("date", "date_end"):
            value = text(raw.get(key), 10)
            if value:
                try:
                    date.fromisoformat(value)
                except ValueError:
                    raise ValueError(f"{name}: use a valid date.") from None
                race[key] = value
        if race["date_end"] and not race["date"]:
            race["date"], race["date_end"] = race["date_end"], ""
        deadline = text(raw.get("deadline"), 16)
        if deadline:
            if not DEADLINE.fullmatch(deadline) or not deadline_at({"deadline": deadline}):
                raise ValueError(f"{name}: use a valid registration deadline.")
            race["deadline"] = deadline
        wanted = text(raw.get("photographer_form"), 40)
        if wanted in photographer_forms:
            race["photographer_form"] = wanted
        elif photographer_forms:
            race["photographer_form"] = photographer_forms[0]
        if race["photographers"] and not race["photographer_form"]:
            raise ValueError(f"{name}: there is no photographer form. Add one under Forms, or untick Photographers.")
        if not race["racers"] and not race["photographers"]:
            raise ValueError(f"{name}: allow racers, photographers or both.")
        races.append(race)
    settings = doc.get("settings") if isinstance(doc.get("settings"), dict) else {}
    return {
        "version": 1, "updated": int(time.time()), "races": races,
        "settings": {
            "notify_emails": clean_emails(settings.get("notify_emails")),
            "send_confirmation": settings.get("send_confirmation") is not False,
            "send_admin": settings.get("send_admin") is not False,
        },
    }


# Arabic for the race names / locations of the seeded calendar, used when the organiser left the Arabic empty,
# so the Arabic page never shows English race text.
AR_WORDS = [
    ("QUALIFYING RACE", "سباق التأهيل"), ("TIME ATTACK", "تحدي الوقت"), ("HILL CLIMB", "صعود الهضبة"),
    ("AUTOCROSS", "الأوتوكروس"), ("KARTING", "الكارتينج"), ("DRIFT", "الدريفت"), ("BAJA", "الباها"),
    ("ROUND", "الجولة"), ("FINAL", "النهائي"), ("RALLY", "رالي"), ("AL-AHSA", "الأحساء"), ("JEDDAH", "جدة"),
    ("QASSIM", "القصيم"), ("HAIL", "حائل"), ("RIYADH", "الرياض"), ("TABUK", "تبوك"), ("DAMMAM", "الدمام"),
]
AR_LOCATIONS = {
    "al sahfa - muhammadiyah": "الصحفة - المحمدية", "almeghawat": "المغواط",
    "formula 1 parking, king abdulaziz road": "مواقف الفورمولا 1، طريق الملك عبدالعزيز",
    "fun xtreme circiut": "حلبة فن إكستريم", "fun xtreme circuit": "حلبة فن إكستريم",
    "jcc karting circuit": "حلبة جدة للكارتينج (JCC)", "jeddah cournich circuit": "حلبة كورنيش جدة",
    "jeddah corniche circuit": "حلبة كورنيش جدة", "mahara": "مهارة",
    "prince abdullah bin jalawi stadium parking": "مواقف ملعب الأمير عبدالله بن جلوي", "qassim": "القصيم",
    "tbc": "يُحدد لاحقاً",
}


def arabic_race_name(name):
    """Best-effort Arabic for names like 'DRIFT – JEDDAH ROUND 3'. Returns '' when a word is unknown."""
    rest = str(name or "").upper()
    for en, ar in AR_WORDS:
        rest = re.sub(r"(?<![A-Z])" + re.escape(en) + r"(?![A-Z])", "\x00" + ar + "\x00", rest)
    if re.search(r"[A-Z]", rest):
        return ""
    out = re.sub(r"\s+", " ", rest.replace("\x00", " ")).strip()
    out = re.sub(r"([\u0600-\u06FF-]+) رالي", r"رالي \1", out)  # 'HAIL RALLY' -> 'رالي حائل'
    return re.sub(r"([\u0600-\u06FF-]+) الجولة (\d+)", r"الجولة \2 – \1", out)  # 'JEDDAH ROUND 3' -> 'الجولة 3 – جدة'


def arabic_location(location):
    return AR_LOCATIONS.get(re.sub(r"\s+", " ", str(location or "")).strip().lower(), "")


def race_snapshot(race, forms_doc):
    category = find_form(forms_doc, race.get("category")) or {}
    return {
        "id": race["id"], "name": race["name"], "name_ar": race.get("name_ar") or arabic_race_name(race["name"]),
        "location": race["location"], "location_ar": race.get("location_ar") or arabic_location(race["location"]),
        "category": race["category"], "category_title": category.get("title") or race["category"],
        "category_title_ar": category.get("title_ar", ""),
        "date": race.get("date", ""), "date_end": race.get("date_end", ""), "date_label": date_label(race),
    }


CHAMPIONSHIP_PREFIX = "championship-"
REG_PAGE = "registration.html"
_REG_START, _REG_END = '<div class="notes" id="reg-notes"', '<footer class="foot">'


def fresh_registration_page(saved_html, current_html):
    """A copy of registration.html saved from the page editor keeps the organiser's text edits, but its
    registration block (notes, race cards, form and the form script) is always taken from the current file,
    so an old saved copy can never hide the forms or run an outdated script."""
    a, b = saved_html.find(_REG_START), saved_html.find(_REG_END)
    c, d = current_html.find(_REG_START), current_html.find(_REG_END)
    if min(a, b, c, d) < 0 or b < a or d < c:
        return saved_html
    return saved_html[:a] + current_html[c:d] + saved_html[b:]


def championship_races(races_doc, forms_doc):
    """A standing entry for every published, open, listed racer form (the SAMF 2026 entry forms) whose
    category has no race open right now, so the forms are on the registration page even before races open.
    The registrant fills in the round / venue / date fields of the form themselves."""
    open_categories = {r.get("category") for r in races_doc.get("races", []) if race_is_open(r)}
    photographers = [f for f in forms_doc.get("forms", []) if form_role(f) == "photographer"
                     and f.get("published", True) and f.get("open", True)]
    out = []
    for form in forms_doc.get("forms", []):
        if (form_role(form) != "racer" or not form.get("published", True) or not form.get("open", True)
                or form.get("listed") is False or form.get("id") in open_categories):
            continue
        out.append({
            "id": CHAMPIONSHIP_PREFIX + form["id"], "general": True,
            "name": form.get("heading") or form["title"], "name_ar": form.get("heading_ar") or form.get("title_ar", ""),
            "location": "", "location_ar": "", "category": form["id"],
            "photographer_form": photographers[0]["id"] if photographers else "",
            "date": "", "date_end": "", "deadline": "", "open": True,
            "racers": True, "photographers": bool(photographers), "notes": "", "notes_ar": "",
        })
    return out


def find_race(races_doc, forms_doc, race_id):
    """A saved race, or the standing championship entry of a form (see championship_races)."""
    for race in races_doc.get("races", []):
        if race.get("id") == race_id:
            return race
    return next((r for r in championship_races(races_doc, forms_doc) if r["id"] == race_id), None)


def public_races(races_doc, forms_doc):
    """What the registration page needs: races that are open now (plus the standing championship
    entries of published forms with no open race) and the forms they use."""
    forms = {f.get("id"): f for f in forms_doc.get("forms", [])}
    races, needed = [], []
    for race in races_doc.get("races", []) + championship_races(races_doc, forms_doc):
        if not race_is_open(race):
            continue
        roles, used = [], {}
        category = forms.get(race.get("category"))
        if race.get("racers") and category and category.get("open", True) and category.get("published", True):
            roles.append("racer")
            used["racer"] = category["id"]
        photographer = forms.get(race.get("photographer_form"))
        if race.get("photographers") and photographer and photographer.get("open", True) and photographer.get("published", True):
            roles.append("photographer")
            used["photographer"] = photographer["id"]
        if not roles:
            continue
        needed += [fid for fid in used.values() if fid not in needed]
        item = race_snapshot(race, forms_doc)
        item.update({
            "color": (category or {}).get("color", "#E8202E"), "roles": roles, "forms": used,
            "date_label_ar": date_label(race, ar=True),
            "deadline": race.get("deadline", ""), "deadline_label": deadline_label(race),
            "deadline_label_ar": deadline_label(race, ar=True),
            "notes": race.get("notes", ""), "notes_ar": race.get("notes_ar", ""),
            "general": bool(race.get("general")),
        })
        races.append(item)
    order = {f.get("id"): i for i, f in enumerate(forms_doc.get("forms", []))}
    races.sort(key=lambda r: (r["general"], r.get("date") or "9999", order.get(r["category"], 99), r["name"]))
    return {"version": 1, "races": races, "forms": [forms[fid] for fid in needed]}


# --------------------------------------------------------------------------- submissions
def is_empty(value):
    return value in (None, "", False) or value == []


def visibility(form, values):
    """Return {field_id: visible} following show_if conditions (a hidden controller counts as empty)."""
    fields = {field["id"]: field for _, field in all_fields(form)}
    memo = {}

    def visible(fid, depth=0):
        if fid in memo:
            return memo[fid]
        field = fields.get(fid)
        cond = field.get("show_if") if field else None
        if not cond or depth > 20:
            memo[fid] = True
            return True
        ref = cond.get("field")
        current = values.get(ref) if ref in fields and visible(ref, depth + 1) else None
        op, expected = cond.get("op", "eq"), str(cond.get("value", ""))
        items = current if isinstance(current, list) else ([] if is_empty(current) else [str(current)])
        if op == "eq":
            result = expected in [str(i) for i in items]
        elif op == "neq":
            result = expected not in [str(i) for i in items]
        elif op == "in":
            allowed = {part.strip() for part in expected.split(",") if part.strip()}
            result = any(str(i) in allowed for i in items)
        elif op in ("lt", "gte"):
            left, right = number(current), number(expected)
            result = left is not None and right is not None and (left < right if op == "lt" else left >= right)
        elif op == "filled":
            result = not is_empty(current)
        else:  # empty
            result = is_empty(current)
        memo[fid] = result
        return result

    return {fid: visible(fid) for fid in fields}


def compute_total(form, values, shown):
    total, multiplier, priced = 0.0, 1.0, False
    for _, field in all_fields(form):
        if field["type"] not in OPTION_TYPES or not shown.get(field["id"]):
            continue
        chosen = values.get(field["id"])
        chosen = chosen if isinstance(chosen, list) else [chosen]
        for option in field.get("options", []):
            if option["value"] in chosen:
                if "price" in option:
                    total += option["price"]
                    priced = True
                if "multiplier" in option:
                    multiplier *= option["multiplier"]
    if not priced:
        return None
    total *= multiplier
    return int(total) if float(total).is_integer() else round(total, 2)


def clean_submission(doc, payload, file_exists, races_doc=None):
    """Validate a public submission for a race (as racer or photographer). Returns (form, entry) or raises ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("Invalid registration.")
    races_doc = races_doc or empty_races()
    ar = payload.get("lang") == "ar"
    msg = lambda en, a: a if ar else en
    race = find_race(races_doc, doc, payload.get("race"))
    if not race:
        raise ValueError(msg("Please choose the race you are registering for.", "يرجى اختيار السباق الذي تريد التسجيل فيه."))
    if not race_is_open(race):
        raise ValueError(msg("Registration for this race is closed.", "التسجيل في هذا السباق مغلق."))
    role = payload.get("role")
    if role not in ROLES or not race.get(f"{role}s"):
        raise ValueError(msg("This registration type is not available for this race.", "نوع التسجيل هذا غير متاح لهذا السباق."))
    form = find_form(doc, race.get("category") if role == "racer" else race.get("photographer_form"))
    if not form or form["id"] != payload.get("form"):
        raise ValueError(msg("This registration form is not available. Please refresh the page.",
                             "نموذج التسجيل هذا غير متاح. يرجى تحديث الصفحة."))
    if not form.get("open", True) or not form.get("published", True):
        raise ValueError(msg("Registration for this championship is closed.", "التسجيل في هذه البطولة مغلق حالياً."))
    raw_values = dict(payload.get("values")) if isinstance(payload.get("values"), dict) else {}
    snapshot_race = race_snapshot(race, doc)
    if race.get("general"):
        # Championship entry: the registrant typed the round / venue / dates; keep them on the entry's race.
        snapshot_race["general"] = True
        for fid, key in RACE_FIELD_MAP.items():
            typed = text(raw_values.get(fid), 160)
            if typed and key != "name":
                snapshot_race[key] = typed
        if text(raw_values.get("round"), 160):
            snapshot_race["round"] = text(raw_values.get("round"), 160)
    else:
        for fid, key in RACE_FIELD_MAP.items():
            raw_values[fid] = snapshot_race.get(key, "")
    raw_files = payload.get("files") if isinstance(payload.get("files"), dict) else {}
    values = {}
    for _, field in all_fields(form):
        fid, kind = field["id"], field["type"]
        if kind in ("heading", "note", "file"):
            continue
        value = raw_values.get(fid)
        if kind == "checkboxes":
            allowed = {o["value"] for o in field.get("options", [])}
            values[fid] = [v for v in (value if isinstance(value, list) else []) if isinstance(v, str) and v in allowed]
        elif kind == "checkbox":
            values[fid] = value is True or value == "true" or value == "on"
        else:
            values[fid] = text(value, 3000 if kind == "textarea" else 300, multiline=kind == "textarea")
    shown = visibility(form, values)
    errors, data, files, snapshot = [], {}, {}, []
    for step, field in all_fields(form):
        fid, kind = field["id"], field["type"]
        if kind in ("heading", "note") or not shown.get(fid):
            continue
        label = ((ar and field.get("label_ar")) or field["label"])[:120]
        if kind == "file":
            ref = raw_files.get(fid)
            if isinstance(ref, dict) and FILE_TOKEN.fullmatch(str(ref.get("token", ""))):
                if not file_exists(ref["token"]):
                    errors.append(f"{label}: " + msg("the uploaded file was not found, please upload it again.", "لم يتم العثور على الملف المرفوع، يرجى رفعه مرة أخرى."))
                    continue
                name = re.sub(r"[\\/\x00-\x1f]", "_", text(ref.get("name"), 160)) or ref["token"]
                files[fid] = {"token": ref["token"], "name": name, "size": int(number(ref.get("size")) or 0)}
            elif field.get("required"):
                errors.append(f"{label}: " + msg("please upload a file.", "يرجى رفع ملف."))
            continue
        value = values.get(fid)
        if is_empty(value):
            if field.get("required"):
                errors.append(f"{label}: " + msg("this field is required.", "هذا الحقل مطلوب."))
            continue
        if kind == "email" and not EMAIL.fullmatch(value):
            errors.append(f"{label}: " + msg("enter a valid e-mail address.", "يرجى إدخال بريد إلكتروني صحيح."))
        elif kind == "tel" and not PHONE.fullmatch(value):
            errors.append(f"{label}: " + msg("enter a valid phone number.", "يرجى إدخال رقم جوال صحيح."))
        elif kind == "number":
            parsed = number(value)
            if parsed is None or ("min" in field and parsed < field["min"]) or ("max" in field and parsed > field["max"]):
                errors.append(f"{label}: " + msg("please check this value.", "يرجى التحقق من هذه القيمة."))
        elif kind == "date":
            try:
                date.fromisoformat(value)
            except ValueError:
                errors.append(f"{label}: " + msg("enter a valid date.", "يرجى إدخال تاريخ صحيح."))
        elif kind in ("select", "radio") and value not in {o["value"] for o in field.get("options", [])}:
            errors.append(f"{label}: " + msg("please select an option.", "يرجى اختيار أحد الخيارات."))
        data[fid] = value
    if errors:
        raise ValueError(" ".join(errors[:6]))
    for step in form.get("steps", []):
        items = [{"id": f["id"], "type": f["type"], "label": f["label"]}
                 for f in step.get("fields", []) if f["type"] not in ("heading", "note") and shown.get(f["id"])]
        if items:
            snapshot.append({"step": step["title"], "fields": items})
    now = time.time()
    suffix = secrets.token_hex(3)
    entry = {
        "id": time.strftime("%Y%m%d-%H%M%S", time.gmtime(now)) + "-" + suffix,
        "ref": f"STC-{form.get('ref_prefix') or 'REG'}-{suffix.upper()}",
        "form": form["id"],
        "form_title": form["title"],
        "role": role,
        "race": snapshot_race,
        "created": int(now),
        "updated": int(now),
        "lang": "ar" if payload.get("lang") == "ar" else "en",
        "data": data,
        "files": files,
        "total": compute_total(form, values, shown),
        "snapshot": snapshot,
        "status": "new",
        "admin": {},
    }
    return form, entry


def apply_entry_update(entry, payload):
    """Apply the organiser fields ("For official use only") from the dashboard."""
    if not isinstance(payload, dict):
        raise ValueError("Invalid update.")
    if payload.get("status") in ENTRY_STATUSES:
        entry["status"] = payload["status"]
    admin = payload.get("admin") if isinstance(payload.get("admin"), dict) else {}
    current = entry.get("admin") or {}
    for key in ("entry_no", "competition_no", "class_confirmed", "received_by"):
        if key in admin:
            current[key] = text(admin.get(key), 160)
    if "remarks" in admin:
        current["remarks"] = text(admin.get("remarks"), 3000, multiline=True)
    if "fee_received" in admin:
        current["fee_received"] = bool(admin.get("fee_received"))
    entry["admin"] = current
    entry["updated"] = int(time.time())
    return entry


def check_upload(content_type, body):
    """Validate an uploaded document; return its file extension."""
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    extension = FILE_TYPES.get(kind)
    if not extension:
        raise ValueError("Unsupported file type. Please upload a PDF, JPG, JPEG or PNG.")
    if not body:
        raise ValueError("The selected file is empty.")
    if len(body) > FILE_LIMIT:
        raise OverflowError("File is larger than 4 MB.")
    signatures = {
        ".pdf": body.startswith(b"%PDF"),
        ".jpg": body.startswith(b"\xff\xd8\xff"),
        ".png": body.startswith(b"\x89PNG\r\n\x1a\n"),
    }
    if not signatures[extension]:
        raise ValueError("The selected file does not match its type.")
    return extension


def new_file_token(extension):
    return uuid.uuid4().hex + extension


def upload_allowed(doc, form_id, field_id):
    form = find_form(doc, form_id)
    if not form or not form.get("open", True) or not form.get("published", True):
        return False
    return any(field["id"] == field_id and field["type"] == "file" for _, field in all_fields(form))


def download_name(name, token):
    extension = Path(token).suffix
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", name or "document").strip(" .") or "document"
    if not base.lower().endswith(extension):
        base += extension
    return base[:150]


# --------------------------------------------------------------------------- e-mails
# SMTP settings come from environment variables (never stored in the site files):
#   SMTP_HOST, SMTP_PORT (587), SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM, SMTP_FROM_NAME,
#   SMTP_SECURITY (starttls | ssl | none), REGISTRATION_NOTIFY_EMAIL (extra admin recipients).
MAIL_TIMEOUT = 15


def mail_config():
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        return None
    try:
        port = int(os.environ.get("SMTP_PORT") or 587)
    except ValueError:
        port = 587
    security = (os.environ.get("SMTP_SECURITY") or ("ssl" if port == 465 else "starttls")).strip().lower()
    user = (os.environ.get("SMTP_USERNAME") or os.environ.get("SMTP_USER") or "").strip()
    sender = (os.environ.get("SMTP_FROM") or user).strip()
    return {
        "host": host, "port": port, "security": security, "user": user,
        "password": os.environ.get("SMTP_PASSWORD", ""), "sender": sender,
        "sender_name": os.environ.get("SMTP_FROM_NAME", "Saudi Toyota Championship").strip(),
    }


def mail_status():
    cfg = mail_config()
    if not cfg:
        return {"configured": False}
    return {"configured": bool(cfg["sender"]), "sender": cfg["sender"], "host": cfg["host"]}


def admin_recipients(settings):
    emails = split_emails((settings or {}).get("notify_emails")) + split_emails(os.environ.get("REGISTRATION_NOTIFY_EMAIL"))
    return [e for e in dict.fromkeys(emails) if EMAIL.fullmatch(e)]


def entry_name(entry):
    for key in NAME_KEYS:
        if entry.get("data", {}).get(key):
            return str(entry["data"][key])
    return ""


def registrant_email(form, entry):
    data = entry.get("data", {})
    for _, field in all_fields(form or {}):
        if field["type"] == "email" and EMAIL.fullmatch(str(data.get(field["id"]) or "")):
            return data[field["id"]]
    return ""


def entry_rows(entry, form, ar=False):
    """[(step title, [(label, value), ...]), ...] using option labels; files show their name."""
    fields = {f["id"]: f for _, f in all_fields(form or {})}
    steps = {s.get("title"): s for s in (form or {}).get("steps", [])}
    pick = lambda obj, key: (obj.get(f"{key}_ar") or obj.get(key, "")) if ar else obj.get(key, "")
    out = []
    for group in entry.get("snapshot", []):
        rows = []
        for item in group.get("fields", []):
            fid, field = item["id"], fields.get(item["id"], {})
            if fid in (entry.get("files") or {}):
                value = entry["files"][fid].get("name", "")
            else:
                value = entry.get("data", {}).get(fid)
                if isinstance(value, bool):
                    value = ("نعم" if ar else "Yes") if value else ""
                elif field.get("options"):
                    chosen = value if isinstance(value, list) else [value]
                    value = ", ".join(pick(o, "label") or o["value"] for o in field["options"] if o["value"] in chosen)
                elif isinstance(value, list):
                    value = ", ".join(map(str, value))
            if value not in (None, ""):
                rows.append((pick(field, "label") if field else item.get("label", fid), str(value)))
        if rows:
            step = steps.get(group.get("step"), {})
            out.append((pick(step, "title") or group.get("step", ""), rows))
    return out


def _mail_html(title, intro, facts, groups, footer, rtl=False):
    e = html.escape
    direction = 'dir="rtl"' if rtl else 'dir="ltr"'
    align = "right" if rtl else "left"
    fact_rows = "".join(
        f'<tr><td style="padding:7px 12px;color:#666;width:38%;border-bottom:1px solid #eee;text-align:{align}">{e(k)}</td>'
        f'<td style="padding:7px 12px;font-weight:600;border-bottom:1px solid #eee;text-align:{align}">{e(v)}</td></tr>' for k, v in facts if v)
    sections = ""
    for title_, rows in groups:
        sections += (f'<h3 style="margin:22px 0 8px;font-size:15px;color:#c8102e;text-align:{align}">{e(title_)}</h3>'
                     '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">'
                     + "".join(f'<tr><td style="padding:6px 10px;color:#666;width:40%;border:1px solid #eee;vertical-align:top;text-align:{align}">{e(k)}</td>'
                               f'<td style="padding:6px 10px;border:1px solid #eee;vertical-align:top;text-align:{align};white-space:pre-wrap">{e(v)}</td></tr>' for k, v in rows)
                     + "</table>")
    paragraphs = "".join(f'<p style="margin:0 0 12px;line-height:1.6;text-align:{align}">{e(p)}</p>' for p in intro)
    return (f'<!doctype html><html {direction}><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111">'
            '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">'
            '<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#fff;border-radius:10px;overflow:hidden">'
            '<tr><td style="background:#0b0b0b;padding:20px 28px;border-bottom:4px solid #e8202e;color:#fff;font-size:13px;letter-spacing:2px;font-weight:700">SAUDI TOYOTA CHAMPIONSHIP</td></tr>'
            f'<tr><td {direction} style="padding:26px 28px"><h2 style="margin:0 0 16px;font-size:21px;text-align:{align}">{e(title)}</h2>{paragraphs}'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;margin:6px 0 4px;background:#fafafa;border:1px solid #eee">{fact_rows}</table>'
            f'{sections}<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;text-align:{align}">{e(footer)}</p></td></tr></table></td></tr></table></body></html>')


def _mail_text(title, intro, facts, groups, footer):
    lines = [title, "", *intro, ""] + [f"{k}: {v}" for k, v in facts if v]
    for title_, rows in groups:
        lines += ["", title_.upper()] + [f"- {k}: {v}" for k, v in rows]
    return "\n".join(lines + ["", footer])


def build_messages(entry, form, settings, base_url=""):
    """The confirmation for the person who registered and the notification for the organisers."""
    settings = settings or {}
    race = entry.get("race") or {}
    role = entry.get("role") or form_role(form)
    name = entry_name(entry)
    to = registrant_email(form, entry)
    admins = admin_recipients(settings)
    messages = []
    if settings.get("send_confirmation", True) and to:
        ar = entry.get("lang") == "ar"
        if ar:
            title = "تم استلام تسجيلك"
            intro = [f"مرحباً {name}،" if name else "مرحباً،",
                     f"شكراً لتسجيلك {'كمصور' if role == 'photographer' else 'كمتسابق'} في {race.get('name_ar') or race.get('name', '')}. "
                     "تم استلام طلبك وسيقوم فريق التنظيم بمراجعته والتواصل معك عند الحاجة.",
                     "يرجى الاحتفاظ بالرقم المرجعي أدناه."]
            facts = [("الرقم المرجعي", entry["ref"]), ("السباق", race.get("name_ar") or race.get("name")),
                     ("الفئة", race.get("category_title_ar") or race.get("category_title")),
                     ("الموقع", race.get("location_ar") or race.get("location")),
                     ("التاريخ", date_label(race, ar=True)), ("نوع التسجيل", ROLE_LABEL_AR.get(role, role))]
            footer = "هذه رسالة تلقائية من بطولة السعودية تويوتا. لا حاجة للرد عليها."
            subject = f"تم استلام تسجيلك – {race.get('name_ar') or race.get('name', '')} ({entry['ref']})"
        else:
            title = "Registration received"
            intro = [f"Dear {name}," if name else "Hello,",
                     f"Thank you for registering as a {ROLE_LABEL.get(role, role).lower()} for {race.get('name', '')}. "
                     "We have received your registration; the organising team will review it and contact you if anything else is needed.",
                     "Please keep the reference number below."]
            facts = [("Reference", entry["ref"]), ("Race", race.get("name")), ("Category", race.get("category_title")),
                     ("Location", race.get("location")), ("Date", race.get("date_label")), ("Registered as", ROLE_LABEL.get(role, role))]
            footer = "This is an automatic message from the Saudi Toyota Championship."
            subject = f"Registration received – {race.get('name', '')} ({entry['ref']})"
        groups = entry_rows(entry, form, ar=ar)
        messages.append({"kind": "registrant", "to": [to], "subject": subject, "reply_to": admins[:1],
                         "text": _mail_text(title, intro, facts, groups, footer),
                         "html": _mail_html(title, intro, facts, groups, footer, rtl=ar)})
    if settings.get("send_admin", True) and admins:
        link = f"{base_url.rstrip('/')}/dashboard" if base_url else ""
        title = f"New {ROLE_LABEL.get(role, role).lower()} registration"
        intro = [f"{name or 'A new registrant'} registered as a {ROLE_LABEL.get(role, role).lower()} for {race.get('name', '')}."]
        if link:
            intro.append(f"Open the dashboard → Registrations to review it: {link}")
        facts = [("Reference", entry["ref"]), ("Registered as", ROLE_LABEL.get(role, role)), ("Race", race.get("name")),
                 ("Category", race.get("category_title")), ("Location", race.get("location")), ("Date", race.get("date_label")),
                 ("Name", name), ("E-mail", to), ("Total", f"{entry['total']} SAR" if entry.get("total") is not None else ""),
                 ("Submitted", datetime.fromtimestamp(entry.get("created", time.time()), RIYADH).strftime("%d %b %Y %H:%M") + " (KSA)")]
        groups = entry_rows(entry, form)
        messages.append({"kind": "admin", "to": admins,
                         "subject": f"New {ROLE_LABEL.get(role, role).lower()} registration – {race.get('name', '')} – {name or entry['ref']} ({entry['ref']})",
                         "reply_to": [to] if to else [],
                         "text": _mail_text(title, intro, facts, groups, "Saudi Toyota Championship – registration notification"),
                         "html": _mail_html(title, intro, facts, groups, "Saudi Toyota Championship – registration notification")})
    return messages, {"registrant": to, "admins": admins}


def send_messages(messages):
    """Send over one SMTP connection. Returns {kind: 'sent' | 'failed' | 'not_configured'} and 'error'."""
    result = {}
    if not messages:
        return result
    cfg = mail_config()
    if not cfg or not cfg["sender"]:
        return {m["kind"]: "not_configured" for m in messages}
    try:
        context = ssl.create_default_context()
        if cfg["security"] == "ssl":
            client = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=MAIL_TIMEOUT, context=context)
        else:
            client = smtplib.SMTP(cfg["host"], cfg["port"], timeout=MAIL_TIMEOUT)
        with client:
            if cfg["security"] == "starttls":
                client.starttls(context=context)
            if cfg["user"] and cfg["password"]:
                client.login(cfg["user"], cfg["password"])
            for message in messages:
                try:
                    mail = EmailMessage()
                    mail["Subject"] = message["subject"]
                    mail["From"] = formataddr((cfg["sender_name"], cfg["sender"]))
                    mail["To"] = ", ".join(message["to"])
                    if message.get("reply_to"):
                        mail["Reply-To"] = ", ".join(message["reply_to"])
                    mail["Message-ID"] = make_msgid(domain=cfg["sender"].rpartition("@")[2] or None)
                    mail.set_content(message["text"])
                    mail.add_alternative(message["html"], subtype="html")
                    client.send_message(mail)
                    result[message["kind"]] = "sent"
                except (smtplib.SMTPException, OSError, ValueError) as error:
                    result[message["kind"]] = "failed"
                    result["error"] = str(error)[:300]
    except (smtplib.SMTPException, OSError, ValueError) as error:
        for message in messages:
            result.setdefault(message["kind"], "failed")
        result["error"] = str(error)[:300]
    return result


def notify(entry, form, races_doc, base_url=""):
    """Send the registration e-mails and return the status to keep on the entry."""
    settings = (races_doc or {}).get("settings") or {}
    messages, addresses = build_messages(entry, form, settings, base_url)
    result = send_messages(messages)
    status = {"at": int(time.time()), "to": addresses["registrant"], "admins": addresses["admins"]}
    status["registrant"] = result.get("registrant") or ("off" if settings.get("send_confirmation") is False else "no_address")
    status["admin"] = result.get("admin") or ("off" if settings.get("send_admin") is False else "no_address")
    if result.get("error"):
        status["error"] = result["error"]
    return status


def test_message(to):
    if not EMAIL.fullmatch(str(to or "")):
        raise ValueError("Enter a valid e-mail address for the test.")
    title = "Test e-mail"
    intro = ["Registration e-mails from the Saudi Toyota Championship website are working."]
    return [{"kind": "test", "to": [to], "subject": "Saudi Toyota Championship – test e-mail", "reply_to": [],
             "text": _mail_text(title, intro, [], [], "Sent from the dashboard."),
             "html": _mail_html(title, intro, [], [], "Sent from the dashboard.")}]


# --------------------------------------------------------------------------- local storage (server.py)
class LocalRegistrationStore:
    """Entries and documents on the local disk, outside any folder the site serves."""

    def __init__(self, content_root, data_root):
        self.content_root = Path(content_root)
        self.entries_root = Path(data_root) / "entries"
        self.files_root = Path(data_root) / "files"

    @staticmethod
    def _write(path, body):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_bytes(body)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def read_forms(self):
        path = self.content_root / FORMS_NAME
        return parse_forms(path.read_bytes() if path.is_file() else None)

    def write_forms(self, doc):
        self._write(self.content_root / FORMS_NAME, json.dumps(doc, ensure_ascii=False).encode("utf-8"))

    def read_races(self):
        path = self.content_root / RACES_NAME
        return parse_races(path.read_bytes() if path.is_file() else None)

    def write_races(self, doc):
        self._write(self.content_root / RACES_NAME, json.dumps(doc, ensure_ascii=False).encode("utf-8"))

    def save_file(self, token, body):
        self._write(self.files_root / token, body)

    def file_exists(self, token):
        return bool(FILE_TOKEN.fullmatch(token)) and (self.files_root / token).is_file()

    def read_file(self, token):
        path = self.files_root / token
        return path.read_bytes() if FILE_TOKEN.fullmatch(token) and path.is_file() else None

    def _entry_path(self, form_id, entry_id):
        if not FORM_ID.fullmatch(str(form_id)) or not ENTRY_ID.fullmatch(str(entry_id)):
            raise ValueError("Invalid entry.")
        return self.entries_root / form_id / f"{entry_id}.json"

    def save_entry(self, entry):
        self._write(self._entry_path(entry["form"], entry["id"]), json.dumps(entry, ensure_ascii=False).encode("utf-8"))

    def get_entry(self, form_id, entry_id):
        path = self._entry_path(form_id, entry_id)
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    def list_entries(self):
        entries = []
        if self.entries_root.is_dir():
            for path in self.entries_root.glob("*/*.json"):
                try:
                    entries.append(json.loads(path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    continue
        return sorted(entries, key=lambda e: e.get("created", 0), reverse=True)

    def delete_entry(self, form_id, entry_id):
        path = self._entry_path(form_id, entry_id)
        if not path.is_file():
            return False
        entry = json.loads(path.read_text(encoding="utf-8"))
        for ref in (entry.get("files") or {}).values():
            token = str(ref.get("token", ""))
            if FILE_TOKEN.fullmatch(token):
                (self.files_root / token).unlink(missing_ok=True)
        path.unlink(missing_ok=True)
        return True
