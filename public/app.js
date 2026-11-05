const HABITS = [
  { id: "fajr", label: "Fajr on time" },
  { id: "morning", label: "Morning dua" },
  { id: "quran", label: "Quran" },
  { id: "evening", label: "Evening dua" },
];

const root = document.getElementById("app");
const now = new Date();

let view = "boot";
let directory = [];
let session = null;
let loginPersonId = "";
let pin = "";
let error = "";
let busy = false;
let viewedYear = now.getFullYear();
let viewedMonth = now.getMonth() + 1;
let selected = isoFromDate(now);

root.addEventListener("click", onClick);
root.addEventListener("submit", onSubmit);
boot();

async function boot() {
  try {
    session = await api("/api/me");
    view = "app";
  } catch {
    try {
      const status = await api("/api/status");
      directory = status.people || [];
      loginPersonId = directory[0]?.id || "";
      view = status.needsSetup ? "setup" : "login";
    } catch {
      view = "offline";
    }
  }
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function render() {
  const scroll = window.scrollY;
  if (view === "setup") root.innerHTML = setupHtml();
  else if (view === "login") root.innerHTML = loginHtml();
  else if (view === "app") root.innerHTML = appHtml();
  else if (view === "offline") {
    root.innerHTML = `<main class="screen"><h1>Our Habits</h1><p class="lede">The log isn’t running on this computer.</p></main>`;
  }
  window.scrollTo(0, scroll);
}

function setupHtml() {
  return `<main class="screen">
    <header class="brand">
      <span class="mark" aria-hidden="true"></span>
      <p class="eyebrow">Private</p>
      <h1>Our Habits</h1>
      <p class="lede">A shared log for the two of you. Fajr on time, morning dua, Quran, and evening dua.</p>
    </header>
    <section class="card auth">
      <form id="setup">
        <div class="fields">
          <label>Your name <input id="name-a" name="name-a" maxlength="24" autocomplete="nickname" required /></label>
          <label>Your PIN <input id="pin-a" name="pin-a" inputmode="numeric" autocomplete="new-password" maxlength="4" pattern="[0-9]{4}" required /></label>
          <label>Partner’s name <input id="name-b" name="name-b" maxlength="24" autocomplete="off" required /></label>
          <label>Partner’s PIN <input id="pin-b" name="pin-b" inputmode="numeric" autocomplete="new-password" maxlength="4" pattern="[0-9]{4}" required /></label>
        </div>
        <p class="hint">Each of you signs in with your own 4-digit PIN. You’ll be able to see each other’s days.</p>
        <p class="error" id="form-error"${error ? "" : " hidden"}>${escapeHtml(error)}</p>
        <button class="primary" type="submit">Create our log</button>
      </form>
    </section>
  </main>`;
}

function loginHtml() {
  const dots = [0, 1, 2, 3]
    .map((index) => `<span class="dot${index < pin.length ? " is-filled" : ""}"></span>`)
    .join("");
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  return `<main class="screen">
    <header class="brand">
      <span class="mark" aria-hidden="true"></span>
      <p class="eyebrow">Private</p>
      <h1>Our Habits</h1>
      <p class="lede">Who’s logging in today?</p>
    </header>
    <section class="card auth">
      <div class="login-card">
        <div class="people">
          ${directory
            .map(
              (person) => `<button type="button" class="person${person.id === loginPersonId ? " is-selected" : ""}" data-action="pick-person" data-id="${escapeHtml(person.id)}">${escapeHtml(person.name)}</button>`
            )
            .join("")}
        </div>
        <p class="pin-label">PIN</p>
        <div class="dots" aria-hidden="true">${dots}</div>
        <div class="keypad">
          ${keys
            .map((key) => {
              if (!key) return `<span></span>`;
              if (key === "back") {
                return `<button type="button" class="key" data-action="backspace" aria-label="Delete">⌫</button>`;
              }
              return `<button type="button" class="key" data-action="key" data-key="${key}">${key}</button>`;
            })
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
        <h1>Our Habits</h1>
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
  if (done.length === HABITS.length) return `${escapeHtml(other.name)} · all four done.`;
  return `${escapeHtml(other.name)} · ${done.map((habit) => habit.label).join(", ")}`;
}

function streakLine(personId) {
  const count = streak(personId);
  if (!count) return "";
  const todayDone = allDone(personId, new Date());
  const label = todayDone
    ? count === 1
      ? "All four habits today."
      : `All four habits, ${count} days in a row.`
    : `All four habits, ${count} ${count === 1 ? "day" : "days"} in a row before today.`;
  return `<p class="streak">${label}</p>`;
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
        people: [
          { name: form["name-a"].value, pin: form["pin-a"].value },
          { name: form["name-b"].value, pin: form["pin-b"].value },
        ],
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

  if (action === "pick-person") {
    loginPersonId = target.dataset.id;
    pin = "";
    error = "";
    render();
    return;
  }

  if (action === "key") {
    if (pin.length >= 4) return;
    pin += target.dataset.key;
    error = "";
    render();
    if (pin.length === 4) submitPin();
    return;
  }

  if (action === "backspace") {
    pin = pin.slice(0, -1);
    error = "";
    render();
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
    pin = "";
    error = "";
    const status = await api("/api/status");
    directory = status.people || [];
    loginPersonId = directory[0]?.id || "";
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

async function submitPin() {
  busy = true;
  const entered = pin;
  try {
    session = await api("/api/login", {
      method: "POST",
      body: { personId: loginPersonId, pin: entered },
    });
    pin = "";
    error = "";
    view = "app";
    selected = isoFromDate(new Date());
  } catch (err) {
    pin = "";
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
