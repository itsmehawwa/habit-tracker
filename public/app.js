const HABITS = [
  { id: "fajr", label: "Fajr on time" },
  { id: "morning", label: "Morning dua" },
  { id: "daily-quran", label: "Daily Qur'an" },
  { id: "evening", label: "Evening dua" },
];

const root = document.getElementById("app");
const now = new Date();

let view = "boot";
let directory = [];
let session = null;
let error = "";
let busy = false;
let viewedYear = now.getFullYear();
let viewedMonth = now.getMonth() + 1;
let selected = isoFromDate(now);

root.addEventListener("click", onClick);
root.addEventListener("submit", onSubmit);

async function boot() {
  try {
    session = await api("/api/me");
    view = "app";
  } catch {
    try {
      const status = await api("/api/status");
      directory = status.people || [];
      view = status.needsSetup ? "setup" : "login";
    } catch {
      view = "offline";
    }
  }
  render();
}

async function api(path, options = {}) {
  if (location.hostname.endsWith("github.io")) return localApi(path, options);
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function localApi(path, options) {
  const data = readLocal();
  const method = options.method || "GET";
  const body = options.body || {};
  const me = data.people.find((person) => person.id === localStorage.getItem(ME_KEY));

  if (method === "GET" && path === "/api/me") {
    if (!me) throw new Error("Sign in to continue.");
    return stateFor(data, me);
  }
  if (method === "GET" && path === "/api/status") {
    return { needsSetup: data.people.length < 2, people: publicPeople(data) };
  }
  if (method === "POST" && path === "/api/setup") {
    if (data.people.length) throw new Error("This log is already set up.");
    const names = [cleanName(body.people?.[0]?.name), cleanName(body.people?.[1]?.name)];
    if (!names[0] || !names[1]) throw new Error("Enter both names.");
    if (names[0].toLowerCase() === names[1].toLowerCase()) throw new Error("Use two different names.");
    data.people = names.map((name) => ({ id: newId(), name }));
    data.checks = {};
    writeLocal(data);
    localStorage.setItem(ME_KEY, data.people[0].id);
    return stateFor(data, data.people[0]);
  }
  if (method === "POST" && path === "/api/login") {
    const person = data.people.find((entry) => entry.id === body.personId);
    if (!person) throw new Error("Choose a name to continue.");
    localStorage.setItem(ME_KEY, person.id);
    return stateFor(data, person);
  }
  if (method === "POST" && path === "/api/logout") {
    localStorage.removeItem(ME_KEY);
    return { ok: true };
  }
  if (method === "PUT" && path === "/api/check") {
    if (!me) throw new Error("Sign in to continue.");
    const date = String(body.date || "");
    const habit = String(body.habit || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !HABITS.some((item) => item.id === habit) || date > isoFromDate(new Date())) {
      throw new Error("That day can’t be changed.");
    }
    const day = { ...(data.checks[date] || {}) };
    const mine = { ...(day[me.id] || {}) };
    if (body.done) mine[habit] = true;
    else delete mine[habit];
    if (Object.keys(mine).length) day[me.id] = mine;
    else delete day[me.id];
    if (Object.keys(day).length) data.checks[date] = day;
    else delete data.checks[date];
    writeLocal(data);
    return { checks: data.checks };
  }
  throw new Error("Not found.");
}

const LOCAL_KEY = "habit-tracker";
const ME_KEY = "habit-tracker-me";

function readLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_KEY) || "");
    if (!Array.isArray(data.people) || typeof data.checks !== "object" || !data.checks) throw new Error("bad");
    return data;
  } catch {
    return { people: [], checks: {} };
  }
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ people: data.people, checks: data.checks }));
}

function publicPeople(data) {
  return data.people.map((person) => ({ id: person.id, name: person.name }));
}

function stateFor(data, person) {
  return {
    me: { id: person.id, name: person.name },
    people: publicPeople(data),
    checks: data.checks,
  };
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function render() {
  const scroll = window.scrollY;
  if (view === "setup") root.innerHTML = setupHtml();
  else if (view === "login") root.innerHTML = loginHtml();
  else if (view === "app") root.innerHTML = appHtml();
  else if (view === "offline") {
    root.innerHTML = `<main class="screen"><h1>Habit Tracker</h1><p class="lede">The log isn’t running on this computer.</p></main>`;
  }
  window.scrollTo(0, scroll);
}

function setupHtml() {
  return `<main class="screen">
    <header class="brand">
      <span class="mark" aria-hidden="true"></span>
      <p class="eyebrow">Private</p>
      <h1>Habit Tracker</h1>
      <p class="lede">A shared log for the two of you. Fajr on time, morning dua, daily Qur'an, and evening dua.</p>
    </header>
    <section class="card auth">
      <form id="setup">
        <div class="fields">
          <label>Your name <input id="name-a" name="name-a" maxlength="24" autocomplete="nickname" required /></label>
          <label>Partner’s name <input id="name-b" name="name-b" maxlength="24" autocomplete="off" required /></label>
        </div>
        <p class="hint">Tap a name to open the log. You’ll both see the same month.</p>
        <p class="error" id="form-error"${error ? "" : " hidden"}>${escapeHtml(error)}</p>
        <button class="primary" type="submit">Create our log</button>
      </form>
    </section>
  </main>`;
}

function loginHtml() {
  return `<main class="screen">
    <header class="brand">
      <span class="mark" aria-hidden="true"></span>
      <p class="eyebrow">Private</p>
      <h1>Habit Tracker</h1>
      <p class="lede">Who’s logging in today?</p>
    </header>
    <section class="card auth">
      <div class="login-card">
        <div class="people">
          ${directory
            .map(
              (person) => `<button type="button" class="person" data-action="enter" data-id="${escapeHtml(person.id)}">${escapeHtml(person.name)}</button>`
            )
            .join("")}
        </div>
        <p class="error" role="alert">${escapeHtml(error)}</p>
      </div>
    </section>
  </main>`;
}

function appHtml() {
  const me = session.me;
  const other = session.people.find((person) => person.id !== me.id);
  const monthName = new Date(viewedYear, viewedMonth - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const selectedDate = parseIso(selected);
  const selectedLabel = selectedDate.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const isToday = selected === isoFromDate(new Date());
  const mine = session.checks[selected]?.[me.id] || {};
  const doneCount = HABITS.filter((habit) => mine[habit.id]).length;
  const possible = daysSoFar(viewedYear, viewedMonth) * HABITS.length;
  const monthKey = `${viewedYear}-${String(viewedMonth).padStart(2, "0")}`;
  const canGoForward = monthKey < currentMonthKey();

  return `<main class="screen app-screen">
    <header class="top">
      <div>
        <p class="eyebrow">${escapeHtml(monthName)}</p>
        <h1>Habit Tracker</h1>
      </div>
      <div class="who">
        <strong>${escapeHtml(me.name)}</strong>
        <button type="button" class="text-btn" data-action="logout">Log out</button>
      </div>
    </header>
    <div class="layout">
      <section class="card today" aria-label="Daily habits">
        <div class="section-head">
          <h2>${isToday ? "Today" : escapeHtml(selectedLabel)}</h2>
          ${isToday ? "" : `<button type="button" class="text-btn" data-action="jump-today">Today</button>`}
        </div>
        <p class="day-note">${isToday ? escapeHtml(selectedLabel) : "Logging this day"}</p>
        <p class="score">${doneCount} of ${HABITS.length}</p>
        <div class="habits">
          ${HABITS.map((habit) => {
            const done = Boolean(mine[habit.id]);
            return `<button type="button" class="habit${done ? " is-done" : ""}" data-action="toggle" data-habit="${habit.id}" aria-pressed="${done}">
              <span>${habit.label}</span>
              <span class="check" aria-hidden="true">${done ? checkSvg() : ""}</span>
            </button>`;
          }).join("")}
        </div>
        <p class="partner-line">${partnerLine(other, selected)}</p>
        ${streakLine(me.id)}
        ${earlierHtml(me, other, monthKey)}
      </section>
      <section class="card month" aria-label="Month">
        <div class="month-head">
          <button type="button" class="nav-btn" data-action="prev-month" aria-label="Previous month">${chevron("left")}</button>
          <h2 class="month-label">${escapeHtml(monthName)}</h2>
          <button type="button" class="nav-btn" data-action="next-month" aria-label="Next month" ${canGoForward ? "" : "disabled"}>${chevron("right")}</button>
        </div>
        <p class="legend"><span><i class="you"></i>You</span><span><i class="them"></i>${escapeHtml(other?.name || "Partner")}</span></p>
        <div class="weekdays">${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="grid">${calendarCells(me.id, other?.id || "")}</div>
        <div class="totals">
          ${totalRow(me, monthKey, possible, false)}
          ${other ? totalRow(other, monthKey, possible, true) : ""}
          <p class="together">Together · ${togetherDays(monthKey)} full ${togetherDays(monthKey) === 1 ? "day" : "days"} this month</p>
        </div>
      </section>
    </div>
  </main>`;
}

function calendarCells(myId, otherId) {
  const first = new Date(viewedYear, viewedMonth - 1, 1);
  const count = new Date(viewedYear, viewedMonth, 0).getDate();
  const today = isoFromDate(new Date());
  let html = "";
  for (let i = 0; i < first.getDay(); i += 1) html += `<span class="blank"></span>`;
  for (let day = 1; day <= count; day += 1) {
    const iso = isoFromDate(new Date(viewedYear, viewedMonth - 1, day));
    const future = iso > today;
    const classes = [
      "day",
      iso === selected ? "is-selected" : "",
      iso === today ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    html += `<button type="button" class="${classes}" data-action="select-day" data-date="${iso}" ${future ? "disabled" : ""}>
      <span class="num">${day}</span>
      ${future ? "" : `<span class="pips">${pips(iso, myId, "is-you")}</span><span class="pips">${pips(iso, otherId, "is-them")}</span>`}
    </button>`;
  }
  return html;
}

function pips(iso, personId, doneClass) {
  const record = session.checks[iso]?.[personId] || {};
  return HABITS.map(
    (habit) => `<i class="pip${record[habit.id] ? ` ${doneClass}` : ""}"></i>`
  ).join("");
}

function totalRow(person, monthKey, possible, isPartner) {
  const count = countChecks(person.id, monthKey);
  const width = possible ? Math.min(100, Math.round((count / possible) * 100)) : 0;
  return `<div class="total">
    <p><span>${escapeHtml(person.name)}</span><span>${count}</span></p>
    <div class="bar${isPartner ? " them" : ""}"><span style="width:${width}%"></span></div>
  </div>`;
}

function partnerLine(other, iso) {
  if (!other) return "";
  const record = session.checks[iso]?.[other.id] || {};
  const done = HABITS.filter((habit) => record[habit.id]);
  if (!done.length) return `${escapeHtml(other.name)} hasn’t logged this day.`;
  if (done.length === HABITS.length) return `${escapeHtml(other.name)} · all ${habitCountWord()} done.`;
  return `${escapeHtml(other.name)} · ${done.map((habit) => habit.label).join(", ")}`;
}

function streakLine(personId) {
  const count = streak(personId);
  if (!count) return "";
  const todayDone = allDone(personId, new Date());
  const label = todayDone
    ? count === 1
      ? `All ${habitCountWord()} habits today.`
      : `All ${habitCountWord()} habits, ${count} days in a row.`
    : `All ${habitCountWord()} habits, ${count} ${count === 1 ? "day" : "days"} in a row before today.`;
  return `<p class="streak">${label}</p>`;
}

function habitCountWord() {
  return ["none", "one", "two", "three", "four", "five", "six", "seven"][HABITS.length] || String(HABITS.length);
}

function countChecks(personId, monthKey) {
  let count = 0;
  for (const [date, byPerson] of Object.entries(session.checks)) {
    if (!date.startsWith(monthKey)) continue;
    const record = byPerson[personId] || {};
    count += HABITS.filter((habit) => record[habit.id]).length;
  }
  return count;
}

function togetherDays(monthKey) {
  const ids = session.people.map((person) => person.id);
  let count = 0;
  for (const [date, byPerson] of Object.entries(session.checks)) {
    if (!date.startsWith(monthKey)) continue;
    const full = ids.every((id) => HABITS.every((habit) => byPerson[id]?.[habit.id]));
    if (full) count += 1;
  }
  return count;
}

function streak(personId) {
  const cursor = new Date();
  if (!allDone(personId, cursor)) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (allDone(personId, cursor)) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function allDone(personId, date) {
  const record = session.checks[isoFromDate(date)]?.[personId] || {};
  return HABITS.every((habit) => record[habit.id]);
}

function daysSoFar(year, month) {
  const today = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  if (today.getFullYear() === year && today.getMonth() + 1 === month) return today.getDate();
  if (new Date(year, month - 1, 1) > today) return 0;
  return daysInMonth;
}

function currentMonthKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

async function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "setup") return;
  event.preventDefault();
  error = "";
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    session = await api("/api/setup", {
      method: "POST",
      body: {
        people: [{ name: form["name-a"].value }, { name: form["name-b"].value }],
      },
    });
    view = "app";
    selected = isoFromDate(new Date());
    viewedYear = now.getFullYear();
    viewedMonth = now.getMonth() + 1;
    render();
  } catch (err) {
    error = err.message;
    const slot = document.getElementById("form-error");
    if (slot) {
      slot.hidden = false;
      slot.textContent = error;
    }
    button.disabled = false;
  }
}

async function onClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target || busy) return;
  const action = target.dataset.action;

  if (action === "enter") {
    enterAs(target.dataset.id);
    return;
  }

  if (action === "logout") {
    busy = true;
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      /* clearing the local screen is still the right result */
    }
    session = null;
    error = "";
    const status = await api("/api/status");
    directory = status.people || [];
    view = "login";
    busy = false;
    render();
    return;
  }

  if (action === "prev-month" || action === "next-month") {
    shiftMonth(action === "next-month" ? 1 : -1);
    render();
    return;
  }

  if (action === "jump-today") {
    const today = new Date();
    viewedYear = today.getFullYear();
    viewedMonth = today.getMonth() + 1;
    selected = isoFromDate(today);
    render();
    return;
  }

  if (action === "select-day") {
    selected = target.dataset.date;
    render();
    return;
  }

  if (action === "toggle") toggleHabit(target.dataset.habit);
}

async function enterAs(personId) {
  busy = true;
  try {
    session = await api("/api/login", {
      method: "POST",
      body: { personId },
    });
    error = "";
    view = "app";
    selected = isoFromDate(new Date());
  } catch (err) {
    error = err.message;
  }
  busy = false;
  render();
}

async function toggleHabit(habit) {
  const today = isoFromDate(new Date());
  if (selected > today) return;
  const before = Boolean(session.checks[selected]?.[session.me.id]?.[habit]);
  setCheck(selected, session.me.id, habit, !before);
  render();
  busy = true;
  try {
    const data = await api("/api/check", {
      method: "PUT",
      body: { date: selected, habit, done: !before },
    });
    session.checks = data.checks;
  } catch (err) {
    setCheck(selected, session.me.id, habit, before);
    error = err.message;
  }
  busy = false;
  render();
}

function setCheck(date, personId, habit, done) {
  const checks = { ...session.checks };
  const day = { ...(checks[date] || {}) };
  const mine = { ...(day[personId] || {}) };
  if (done) mine[habit] = true;
  else delete mine[habit];
  if (Object.keys(mine).length) day[personId] = mine;
  else delete day[personId];
  if (Object.keys(day).length) checks[date] = day;
  else delete checks[date];
  session = { ...session, checks };
}

function shiftMonth(delta) {
  const next = new Date(viewedYear, viewedMonth - 1 + delta, 1);
  const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  if (key > currentMonthKey()) return;
  viewedYear = next.getFullYear();
  viewedMonth = next.getMonth() + 1;
  const today = new Date();
  if (viewedYear === today.getFullYear() && viewedMonth === today.getMonth() + 1) {
    selected = isoFromDate(today);
  } else {
    selected = isoFromDate(new Date(viewedYear, viewedMonth - 1, 1));
  }
}

function isoFromDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function chevron(direction) {
  const path = direction === "left" ? "M10 3.2 5.2 8 10 12.8" : "M6 3.2 10.8 8 6 12.8";
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function checkSvg() {
  return `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.2 8.3 6.3 11.2 12.8 4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function earlierHtml(me, other, monthKey) {
  const dates = Object.keys(session.checks)
    .filter((date) => date.startsWith(monthKey) && date !== selected)
    .sort()
    .reverse();
  if (!dates.length) return "";
  const rows = dates
    .map((date) => {
      const label = parseIso(date).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      return `<button type="button" class="earlier-day" data-action="select-day" data-date="${date}">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(entryLine(me, date))}</span>
        ${other ? `<span>${escapeHtml(entryLine(other, date))}</span>` : ""}
      </button>`;
    })
    .join("");
  return `<div class="earlier">
    <h3>Earlier</h3>
    <div class="earlier-list">${rows}</div>
  </div>`;
}

function entryLine(person, date) {
  const done = HABITS.filter((habit) => session.checks[date]?.[person.id]?.[habit.id]);
  if (!done.length) return `${person.name}: none`;
  if (done.length === HABITS.length) return `${person.name}: all ${habitCountWord()}`;
  return `${person.name}: ${done.map((habit) => habit.label).join(", ")}`;
}

boot();
