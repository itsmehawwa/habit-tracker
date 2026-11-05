#!/usr/bin/env python3
"""Private habit log for two people. Run: python3 server.py"""

import datetime
import hashlib
import hmac
import json
import os
import secrets
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "habits.json"
PORT = int(os.environ.get("PORT", "3000"))
HABITS = ("fajr", "morning", "quran", "evening")
SESSION_SECONDS = 60 * 60 * 24 * 60
LOCK = threading.Lock()
ATTEMPTS = {}


class RequestDone(Exception):
    """The response was already sent."""

FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/favicon.svg": "favicon.svg",
}
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def load():
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if not isinstance(data.get("people"), list) or not isinstance(data.get("checks"), dict):
        raise RuntimeError("Habit log file is unreadable.")
    data.setdefault("sessions", {})
    return data


def save(data):
    DATA_DIR.mkdir(exist_ok=True)
    tmp = DATA_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, DATA_FILE)


def public_people(data):
    return [{"id": person["id"], "name": person["name"]} for person in data["people"]]


def hash_pin(pin, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        pin.encode("utf-8"),
        salt.encode("utf-8"),
        200_000,
        dklen=32,
    )
    return salt, digest.hex()


def pin_matches(pin, salt, hashed):
    _, actual = hash_pin(pin, salt)
    return hmac.compare_digest(actual, hashed)


def today_iso():
    return datetime.date.today().isoformat()


def is_real_date(iso):
    try:
        year, month, day = (int(part) for part in iso.split("-"))
        parsed = datetime.date(year, month, day)
    except (TypeError, ValueError):
        return False
    return parsed.isoformat() == iso and parsed <= datetime.date.today() + datetime.timedelta(days=1)


def clean_name(value):
    return " ".join(str(value or "").split())[:24]


def current_user(data, token):
    if not token:
        return None
    session = data.get("sessions", {}).get(token)
    if not session or session.get("expires", 0) <= now_ms():
        return None
    return next((person for person in data["people"] if person["id"] == session["personId"]), None)


def state_for(data, person):
    return {
        "me": {"id": person["id"], "name": person["name"]},
        "people": public_people(data),
        "checks": data["checks"],
    }


def now_ms():
    return int(datetime.datetime.now().timestamp() * 1000)


def too_many(person_id):
    row = ATTEMPTS.get(person_id)
    if not row:
        return False
    if now_ms() > row["reset"]:
        ATTEMPTS.pop(person_id, None)
        return False
    return row["count"] >= 8


def mark_failure(person_id):
    row = ATTEMPTS.get(person_id) or {"count": 0, "reset": now_ms() + 60_000}
    if now_ms() > row["reset"]:
        row = {"count": 0, "reset": now_ms() + 60_000}
    row["count"] += 1
    if row["count"] >= 8:
        row["reset"] = now_ms() + 60_000
    ATTEMPTS[person_id] = row


def cookie(token, clear=False):
    value = "" if clear else token
    max_age = "0" if clear else str(SESSION_SECONDS)
    return f"oh_session={value}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}"


def read_cookie(header):
    for part in (header or "").split(";"):
        key, _, value = part.strip().partition("=")
        if key == "oh_session":
            return value
    return ""


def lan_addresses():
    addresses = []
    try:
        import socket

        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            address = info[4][0]
            if not address.startswith("127."):
                addresses.append(address)
    except OSError:
        return []
    return list(dict.fromkeys(addresses))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        path = urlparse(self.path).path
        if path in FILES:
            self.serve_file(FILES[path])
            return
        if path == "/api/status":
            data = load()
            self.send_json(200, {"needsSetup": data is None, "people": public_people(data) if data else []})
            return
        if path == "/api/me":
            data = load()
            person = current_user(data, read_cookie(self.headers.get("Cookie"))) if data else None
            if not person:
                self.send_json(401, {"error": "Sign in to continue."})
                return
            self.send_json(200, state_for(data, person))
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        try:
            path = urlparse(self.path).path
            if path == "/api/setup":
                self.setup_log()
                return
            if path == "/api/login":
                self.login()
                return
            if path == "/api/logout":
                self.logout()
                return
            self.send_json(404, {"error": "Not found."})
        except RequestDone:
            return

    def do_PUT(self):
        if urlparse(self.path).path != "/api/check":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            body = self.read_body()
        except RequestDone:
            return
        token = read_cookie(self.headers.get("Cookie"))
        with LOCK:
            data = load()
            person = current_user(data, token) if data else None
            if not person:
                self.send_json(401, {"error": "Sign in to continue."})
                return
            date = str(body.get("date") or "")
            habit = str(body.get("habit") or "")
            if not is_real_date(date) or habit not in HABITS or date > today_iso():
                self.send_json(400, {"error": "That day can’t be changed."})
                return
            day = dict(data["checks"].get(date) or {})
            mine = dict(day.get(person["id"]) or {})
            if body.get("done"):
                mine[habit] = True
            else:
                mine.pop(habit, None)
            if mine:
                day[person["id"]] = mine
            else:
                day.pop(person["id"], None)
            if day:
                data["checks"][date] = day
            else:
                data["checks"].pop(date, None)
            save(data)
            self.send_json(200, {"checks": data["checks"]})

    def setup_log(self):
        body = self.read_body()
        with LOCK:
            if load():
                self.send_json(409, {"error": "This log is already set up."})
                return
            raw_people = body.get("people") if isinstance(body.get("people"), list) else [{}, {}]
            first = raw_people[0] if raw_people else {}
            second = raw_people[1] if len(raw_people) > 1 else {}
            names = [clean_name(first.get("name")), clean_name(second.get("name"))]
            pins = [str(first.get("pin") or ""), str(second.get("pin") or "")]
            if not names[0] or not names[1]:
                self.send_json(400, {"error": "Enter both names."})
                return
            if names[0].lower() == names[1].lower():
                self.send_json(400, {"error": "Use two different names."})
                return
            if any(len(pin) != 4 or not pin.isdigit() for pin in pins):
                self.send_json(400, {"error": "Each PIN must be 4 digits."})
                return
            people = []
            for name, pin in zip(names, pins):
                salt, hashed = hash_pin(pin)
                people.append(
                    {
                        "id": secrets.token_hex(8),
                        "name": name,
                        "salt": salt,
                        "pinHash": hashed,
                    }
                )
            data = {"people": people, "checks": {}, "sessions": {}}
            token = secrets.token_hex(32)
            data["sessions"][token] = {"personId": people[0]["id"], "expires": now_ms() + SESSION_SECONDS * 1000}
            save(data)
            self.send_json(201, state_for(data, people[0]), {"Set-Cookie": cookie(token)})

    def login(self):
        body = self.read_body()
        person_id = str(body.get("personId") or "")
        pin = str(body.get("pin") or "")
        if too_many(person_id):
            self.send_json(429, {"error": "Too many tries. Wait a minute, then try again."})
            return
        with LOCK:
            data = load()
            person = next((entry for entry in (data or {}).get("people", []) if entry["id"] == person_id), None)
            if not person or not pin_matches(pin, person["salt"], person["pinHash"]):
                mark_failure(person_id)
                self.send_json(401, {"error": "That PIN doesn’t match."})
                return
            ATTEMPTS.pop(person_id, None)
            now = now_ms()
            data["sessions"] = {
                token: session
                for token, session in data.get("sessions", {}).items()
                if session.get("expires", 0) > now
            }
            token = secrets.token_hex(32)
            data["sessions"][token] = {"personId": person["id"], "expires": now + SESSION_SECONDS * 1000}
            save(data)
            self.send_json(200, state_for(data, person), {"Set-Cookie": cookie(token)})

    def logout(self):
        token = read_cookie(self.headers.get("Cookie"))
        with LOCK:
            data = load()
            if data and token in data.get("sessions", {}):
                data["sessions"].pop(token, None)
                save(data)
        self.send_json(200, {"ok": True}, {"Set-Cookie": cookie("", True)})

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 100_000:
            self.send_json(413, {"error": "Request is too large."})
            raise RequestDone
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Request could not be read."})
            raise RequestDone

    def serve_file(self, name):
        file = PUBLIC / name
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(file.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, payload, extra=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    try:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    except OSError as error:
        if getattr(error, "errno", None) == 48:
            print(f"Port {PORT} is already in use. Quit the other Our Habits window, or run PORT=3001 python3 server.py.")
            sys.exit(1)
        raise
    print(f"Our Habits is running.\n  http://localhost:{PORT}")
    for address in lan_addresses():
        print(f"  http://{address}:{PORT}")
    print("Keep this window open. Closing it turns the log off.")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(0.4, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
