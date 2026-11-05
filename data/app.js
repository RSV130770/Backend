/* ============================================================
   I18N  (first partial in app.js)
   - Texts live in /local.json: key -> {en, ru, et}.
   - t(key, params): the text in the current language. A missing
     translation falls back to English, a missing key to the key itself;
     both are reported once in the console. {name} placeholders are
     filled from params.
   - HTML: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title
     (tooltip), data-i18n-aria (aria-label). Put data-i18n only on
     elements without child elements: it replaces the whole text. An
     element keeps its built-in English text if the file is missing.
   - The choice is kept per farm, in the controller's RTC memory
     (GET/POST /api/lang). Never chosen yet: the phone's language if
     there is a translation, else English. The phone keeps a copy
     (localStorage) for when the controller cannot be reached.
   - onLanguageChange(fn): screens that build text in JS redraw it there.
   - #lang-flags (Settings) gets one flag button per language.
   ============================================================ */

const I18N_STORE = "premifarm.lang";
const I18N = { lang: "en", def: "en", langs: [], text: {}, loaded: false, farm: "" };
const i18nWarned = new Set();
const i18nHooks = [];

function i18nWarn(msg) {
  if (i18nWarned.has(msg)) return;
  i18nWarned.add(msg);
  console.warn("i18n: " + msg);
}

function t(key, params) {
  const e = I18N.text[key];
  let s;
  if (!e) {
    if (I18N.loaded) i18nWarn("missing key " + key);
    s = key;
  } else {
    s = e[I18N.lang];
    if (!s) {
      i18nWarn("no " + I18N.lang + " text for " + key);
      s = e[I18N.def] || e.en || key;
    }
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

function hasText(key) { return !!I18N.text[key]; }

// Names written by the controller in English (the built-in Default task:
// its name, stages, groups, messages) are shown in the chosen language.
// Any other name (typed by the user) is shown as it is.
let i18nNames = null;               // English text -> key, for tpl.* keys
function tName(s) {
  if (!s) return s || "";
  if (!i18nNames) {
    i18nNames = {};
    Object.keys(I18N.text).forEach(k => {
      if (k.startsWith("tpl.") && I18N.text[k].en) i18nNames[I18N.text[k].en] = k;
    });
  }
  const key = i18nNames[s];
  return key ? t(key) : s;
}

// Output name: translated while it is the controller's standard English
// name for that channel (out.<id>); a renamed output keeps its own name
function outLabel(cfg) {
  if (!cfg) return "";
  const e = I18N.text["out." + cfg.id];
  return e && e.en === cfg.label ? t("out." + cfg.id) : (cfg.label || "Ch" + cfg.id);
}

// Fill the data-i18n* attributes inside root (default: the whole page)
function applyI18n(root) {
  const scope = root || document;
  const fill = (attr, put) => scope.querySelectorAll("[" + attr + "]").forEach(el => {
    const key = el.getAttribute(attr);
    if (hasText(key)) put(el, t(key));
  });
  fill("data-i18n", (el, s) => { el.textContent = s; });
  fill("data-i18n-ph", (el, s) => { el.placeholder = s; });
  fill("data-i18n-title", (el, s) => { el.title = s; });
  fill("data-i18n-aria", (el, s) => { el.setAttribute("aria-label", s); });
}

function onLanguageChange(fn) { i18nHooks.push(fn); }

function setLanguage(code) {
  if (!I18N.langs.some(l => l.code === code)) return;
  I18N.lang = code;
  try { localStorage.setItem(I18N_STORE, code); } catch (e) { /* private mode */ }
  saveFarmLanguage(code);
  document.documentElement.lang = code;
  applyI18n();
  renderLangButtons();
  i18nHooks.forEach(fn => { try { fn(code); } catch (e) { console.error(e); } });
}

// The farm keeps the choice (RTC memory); only the session owner can
// change it. Not reachable (demo mode): the phone's copy is enough.
function saveFarmLanguage(code) {
  if (typeof OFFLINE_MODE !== "undefined" && OFFLINE_MODE) return;
  if (code === I18N.farm) return;
  fetch("/api/lang", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang: code })
  })
    .then(r => { if (r.ok) I18N.farm = code; else console.warn("i18n: language not saved on the farm (HTTP " + r.status + ")"); })
    .catch(() => console.warn("i18n: language not saved on the farm"));
}

function i18nPick() {
  const codes = I18N.langs.map(l => l.code);
  if (I18N.farm && codes.includes(I18N.farm)) return I18N.farm;   // the farm's choice
  let saved = null;
  try { saved = localStorage.getItem(I18N_STORE); } catch (e) { /* private mode */ }
  if (saved && codes.includes(saved)) return saved;
  const wanted = navigator.languages || [navigator.language || ""];
  for (const l of wanted) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (codes.includes(c)) return c;
  }
  return I18N.def;
}

/* ---------- flag buttons ---------- */
// Drawn here, not emoji: Windows shows emoji flags as two letters
const I18N_FLAGS = {
  en: '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<clipPath id="ukT"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath>' +
      '<path d="M0,0v30h60v-30z" fill="#012169"/>' +
      '<path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>' +
      '<path d="M0,0L60,30M60,0L0,30" clip-path="url(#ukT)" stroke="#C8102E" stroke-width="4"/>' +
      '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/>' +
      '<path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  ru: '<svg viewBox="0 0 9 6" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="9" height="2" fill="#fff"/><rect y="2" width="9" height="2" fill="#0039A6"/>' +
      '<rect y="4" width="9" height="2" fill="#D52B1E"/></svg>',
  et: '<svg viewBox="0 0 33 21" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="33" height="7" fill="#0072CE"/><rect y="7" width="33" height="7" fill="#000"/>' +
      '<rect y="14" width="33" height="7" fill="#fff"/></svg>'
};

function renderLangButtons() {
  const box = document.getElementById("lang-flags");
  if (!box || !I18N.langs.length) return;
  box.innerHTML = "";
  I18N.langs.forEach(l => {
    const b = document.createElement("button");
    b.type = "button";
    // Same look as the other buttons: btn + btn-small (raised, pressed when active)
    b.className = "btn btn-light btn-small lang-btn" + (l.code === I18N.lang ? " active" : "");
    b.setAttribute("aria-pressed", l.code === I18N.lang ? "true" : "false");
    b.dataset.lang = l.code;
    b.innerHTML = (I18N_FLAGS[l.code] || "") + "<span></span>";
    b.querySelector("span").textContent = l.name;       // the language's own name
    b.addEventListener("click", () => setLanguage(l.code));
    box.appendChild(b);
  });
  const card = box.closest(".card");
  if (card) card.style.display = "";                    // hidden until there are languages
}

/* ---------- loading ---------- */
// The app starts after this (system.js waits for I18N_READY); a missing or
// broken file leaves the built-in English texts in place.
const I18N_READY = new Promise(resolve => {
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    I18N.lang = i18nPick();
    document.documentElement.lang = I18N.lang;
    const go = () => { applyI18n(); renderLangButtons(); resolve(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
    else go();
  };
  const timer = setTimeout(() => { console.warn("i18n: /local.json timed out"); done(); }, 8000);
  // The farm's language ("" = never chosen); an old firmware without
  // /api/lang, or no controller at all, just leaves it empty
  const farmLang = fetch("/api/lang", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : {}))
    .then(d => { I18N.farm = (d && d.lang) || ""; })
    .catch(() => {});
  const texts = fetch("/local.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(d => {
      I18N.text = d.text || {};
      I18N.langs = d.languages || [];
      I18N.def = d.default || "en";
      I18N.loaded = true;
    })
    .catch(e => console.warn("i18n: /local.json not loaded (" + e.message + "), English only"));
  Promise.all([texts, farmLang]).then(() => { clearTimeout(timer); done(); });
});
//* ============================================================ 
// GLOBAL RESOURCE 
//==============================================================
// Shared configuration for all pages

let outputsConfig = [];
const debugOutputsConfig = [
  { id: 0, label: "Debug NO_RAMP", mode: "no_ramp", riseDefault: 0, fallDefault: 0, supportsDuty: true, supportsRamp: false, supportsSoftstart: false, icon: "/sun.svg", style: "background:#ccc", invert: false },
  { id: 1, label: "Debug SOFTSTART", mode: "softstart", riseDefault: 500, fallDefault: 0, supportsDuty: true, supportsRamp: false, supportsSoftstart: true, icon: "/sun.svg", style: "background:#ccc", invert: false },
  { id: 2, label: "Debug ANALOG_DIRECT", mode: "analog_direct", riseDefault: 0, fallDefault: 0, supportsDuty: true, supportsRamp: false, supportsSoftstart: false, icon: "/sun.svg", style: "background:#ccc", invert: false },
  { id: 3, label: "Debug ANALOG_RAMP", mode: "analog_ramp", riseDefault: 2000, fallDefault: 2000, supportsDuty: true, supportsRamp: true, supportsSoftstart: false, icon: "/sun.svg", style: "background:#ccc", invert: false }
];

/*GLOBAL SHARED STATE
   ============================================================ */
let OFFLINE_MODE = false;   // or false
let rtcOffset = 0;
let deviceState = {};          // full state from /state
let countdowns = {};           // local countdown cache
let offset = 0;                // server time offset
let serverTime = null;
let taskStatus = "not started";
let taskIndex = 1000;
let taskStartTime = null;
let taskContent = [];           // schedule list for selected task
let taskList = [];
let appReady = false;


let initialized = {
  dashboard: false,
  schedule: false,
  playground: false,
  settings: false
};

/* ============================================================
   COMMON INITIALIZATION (runs once on page load)
   ============================================================ */
function detectOfflineMode() {
  return new Promise(resolve => {
    $.getJSON("/api/ping")
      .done(() => resolve(false))   // backend is online
      .fail(() => resolve(true));   // backend is offline
  });
}


function initCommon() {
  console.log("Common init");

  // Initial RTC sync
  forceSyncTime();

  // Update UI clock every second (using rtcOffset)
  updateDateTime();
  setInterval(updateDateTime, 1000);

  // Re-sync RTC once per minute
  setInterval(syncTime, 60000);

  // Navigation is handled elsewhere (swipe + keys)
}

/* ============================================================
   TIME DISPLAY (system clock only)
   ============================================================ */
function forceSyncTime() {
  if (OFFLINE_MODE) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const HH = String(now.getHours()).padStart(2, "0");
  const MM = String(now.getMinutes()).padStart(2, "0");
  const DOW = now.getDay();

  const payload = {
    time: `${yyyy}-${mm}-${dd}T${HH}:${MM}-${DOW}`
  };

  console.log("Forcing RTC sync on startup");

  $.ajax({
    url: "/api/time",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    success: () => {
      console.log("RTC updated on device (forced startup sync)");
      // After setting, run normal sync to compute rtcOffset
      setTimeout(syncTime, 500);
    }
  });
}


// Polling the controller is pointless while the page is hidden (screen off,
// app or captive-portal window in the background) and after the user has
// left or lost the session. Without this a forgotten page keeps the ESP32
// busy with a request every second.
function pollingAllowed() {
  if (document.hidden) return false;
  if (typeof exitGuardLeaving !== 'undefined' && exitGuardLeaving) return false;
  return true;
}

function syncTime() {
  if (OFFLINE_MODE || !pollingAllowed()) return;

  $.getJSON("/api/state", s => {
    if (!s.rtc) return;

    // Expect full datetime from backend: "YYYY-MM-DDTHH:MM:SS"
    const deviceDate = new Date(s.rtc);

    if (isNaN(deviceDate.getTime())) {
      console.warn("RTC parse failed");
      return;
    }

    // Compute offset between browser clock and device RTC
    rtcOffset = Date.now() - deviceDate.getTime();
    console.log("RTC synced, offset =", rtcOffset);
  });
}

function updateDateTime() {
  const now = new Date(Date.now() - rtcOffset);

  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  document.getElementById("datetime").textContent =
    `${dd}.${mm}.${yyyy} ${hh}:${mi}:${ss}`;
}

/* ============================================================
   APP STARTUP
   ============================================================ */
// Texts (i18n.js) and the controller check run side by side
Promise.all([detectOfflineMode(), I18N_READY]).then(([isOffline]) => {
  if (isOffline) {
    console.warn("Backend unreachable → switching to OFFLINE_MODE");
    OFFLINE_MODE = true;
  }

  loadOutputsConfig().then(() => {
    initCommon();
    appReady = true;        // allow navigation only now
    showPage('dashboard');
  });
});




/* ============================================================
   UTILS
   ============================================================ */
function hhmmss(totalSeconds) {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}


function timeToSeconds(hhmm) {
  if (!hhmm || hhmm === '--:--') return 0;
  const parts = hhmm.split(':');   // HH:MM or HH:MM:SS
  return (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 +
         (parseInt(parts[2]) || 0);
}

function secondsToHHMM(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  return `${h}:${m}`;
}

// Duration with seconds (custom repeat: e.g. pump 10 s on)
function secondsToHHMMSS(sec) {
  return hhmmss(sec || 0);
}


// ============================================================
// TASK CONTROL API — single source of truth for all endpoints
// ============================================================

function taskApiRequest(url, onSuccess) {
  $.ajax({
    url: url,
    type: "POST",
    contentType: "application/json",
    data: "{}",
    success: resp => {
      if (onSuccess) onSuccess(resp);
    },
    error: (xhr) => {
      console.warn(url + " failed:", xhr.status, xhr.responseText);
    }
  });
}

function requestTaskStart() {
  function localISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +
           "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  const localStart = localISO();
  // A stage chosen on the stage tile: start the task there (once)
  const stageId = startAtStage;
  startAtStage = null;

  if (OFFLINE_MODE) {
    taskStatus = "running";
    taskStartTime = localStart;  // use browser time in offline mode
    taskIndex = Number($("#taskSelect").val()) || 1000;
    updateTaskUI(taskStatus);
    return;
  }

  const body = {
    id: Number($("#taskSelect").val()),
    startTime: localStart   // sent to sync device RTC
  };
  if (stageId !== null) body.stageId = stageId;

  $.ajax({
    url: "/preset/start",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(body),
    success: resp => {
      taskStatus = resp.status || "running";
      taskStartTime = resp.startTime || localStart;  // prefer device time, fallback to local
      taskIndex = Number($("#taskSelect").val());
      renderDashboard(resp);
      updateTaskUI(taskStatus);  // now shows "Running since <device time>"
      updateScheduleHeader();
      loadTaskContent(taskIndex);  // the task may have changed (task tile)
      fetchState(true);            // stage tile at once
    },
    error: xhr => console.warn("/preset/start failed:", xhr.status)
  });
}


// source "playground": the controller resumes this pause by itself when
// the session ends; without it the pause lasts until the user resumes.
function requestTaskPause(source) {
  if (OFFLINE_MODE) {
    taskStatus = "paused";
    updateTaskUI(taskStatus);
    return;
  }

  const url = source ? "/preset/pause?source=" + source : "/preset/pause";
  taskApiRequest(url, resp => {
    taskStatus = resp.status || "paused";
    taskStartTime = resp.startTime || resp.time || null;
    renderDashboard(resp);
    updateTaskUI(taskStatus);
  });
}

function requestTaskResume() {
  if (OFFLINE_MODE) {
    taskStatus = "running";
    updateTaskUI(taskStatus);
    return;
  }

  taskApiRequest("/preset/resume", resp => {
    taskStatus = resp.status || "running";
    taskStartTime = resp.startTime || resp.time || null;
    renderDashboard(resp);
    updateTaskUI(taskStatus);
  });
}

function requestTaskStop() {
  if (OFFLINE_MODE) {
    taskStatus = "stopped";
    taskStartTime = null;
    updateTaskUI(taskStatus);
    return;
  }

  taskApiRequest("/preset/stop", resp => {
    taskStatus = resp.status || "stopped";
    taskStartTime = null;
    renderDashboard(resp);
    updateTaskUI(taskStatus);
	updateScheduleHeader();
  });
}
/* ============================================================
   GLOBAL NAVIGATION MODEL
   ============================================================ */

const pageOrder = ["dashboard", "schedule", "playground", "settings"];
let current = 0;
let currentPage = "dashboard";
let startX = 0;
let startY = 0;
let swipeEnabled = true;
let servicePauseByPlayground = false; 
let sliderActive = false;

function disableSwipe() { swipeEnabled = false; }

// iPhone: the screen keyboard stays up (or comes back on the next tap) while
// a text field that is no longer on screen still has the focus: after a
// swipe to another screen, or after a dialog with a field was closed.
// Take the focus away from such a field when the screen or a dialog changes.
function dropTextFocus() {
  const el = document.activeElement;
  if (el && el !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur();
}
function enableSwipe() { swipeEnabled = true; }

/* ============================================================
   PAGE SWITCHING
   ============================================================ */
function showPage(name) {
  // After Leave / "Session ended" the page is dead: no screen may restart
  // its polling
  if (typeof exitGuardLeaving !== 'undefined' && exitGuardLeaving) return;
  if ($('.modal.show').length > 0) return;
  const index = pageOrder.indexOf(name);
  if (index === -1) return;

  dropTextFocus();                    // the old screen's field must not keep the keyboard

  // capture previous BEFORE updating
  const previous = currentPage;

  // Now update navigation state
  current = index;
  currentPage = name;


  // Lazy init
  if (!initialized[name]) {
    pages[name].init();
    initialized[name] = true;
  }

  // Run page-specific workflow every time page becomes active
  if (pages[name].run) {
    pages[name].run();
  }


  // Apply transform
  document.getElementById("container").style.transform =
    `translateX(-${index * 100}vw)`;
  updateDots(index);
//  updateFooterLabel();
  if (OFFLINE_MODE) return;
  // Scheduler pause/resume: entering Playground from the Dashboard side
  // pauses a running task; coming back to Dashboard or Schedule resumes it.
  // Settings is neutral: Playground <-> Settings changes nothing.
  const TASK_PAGES = ["dashboard", "schedule"];
  const wasTask = TASK_PAGES.includes(previous);
  const isTask  = TASK_PAGES.includes(name);
  if (wasTask && name === "playground") {
    if (taskStatus === "running") {
      servicePauseByPlayground = true;
      requestTaskPause("playground");
    }
  } else if (!wasTask && isTask) {
    if (servicePauseByPlayground && taskStatus === "paused") requestTaskResume();
    servicePauseByPlayground = false;
  }
}



/* ============================================================
   PAGE REGISTRY
   ============================================================ */
const pages = {
  dashboard: {
    init: initDashboard,
    run: runDashboardWorkflow
  },
  schedule: {
    init: initSchedule,
    run: runScheduleWorkflow
  },
  playground: {
    init: initPlayground,
    run: runPlaygroundWorkflow
  },
  settings: {
    init: initSettings,
    run: runSettingsWorkflow
  }
};


/* ============================================================
   DOTS + FOOTER LABEL
   ============================================================ */
function updateDots(index) {
  document.querySelectorAll('.dot').forEach((d, i) =>
    d.classList.toggle('active', i === index)
  );
}
//
//function updateFooterLabel() {
//  const label = document.getElementById("footer-page-label");
//  if (label) label.textContent =
//    currentPage.charAt(0).toUpperCase() + currentPage.slice(1);
//}

/* ============================================================
   DOM READY — ALL EVENT BINDINGS
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {

  // Any dialog closing: its fields must not keep the keyboard (iPhone)
  $(document).on('hide.bs.modal', '.modal', dropTextFocus);

  /* Modal swipe disable + lastMode reset on close */
  $('#batchModal').on('shown.bs.modal', disableSwipe);
  $('#batchModal').on('hidden.bs.modal', enableSwipe);
  $('#saveAsModal').on('shown.bs.modal', disableSwipe);
  $('#saveAsModal').on('hidden.bs.modal', enableSwipe);
  $('#editModal').on('shown.bs.modal', disableSwipe);
  $('#editModal').on('hidden.bs.modal', function() {
    enableSwipe();
    lastMode = null;  // reset only after modal fully closes
  });
  /* NAVBAR CLICK */
  document.querySelectorAll('.nav-page-link').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      if (!appReady) return;   // ← block early navigation
      showPage(el.dataset.page);
      $('#mainNav').collapse('hide');   // close the mobile menu after choosing a screen
    });
  });
  
  const idx = pageOrder.indexOf(currentPage);

  /* FOOTER BUTTONS */
  const prevBtn = document.getElementById('footer-prev');
  const nextBtn = document.getElementById('footer-next');

  /* SWIPE */
  document.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  });

  document.addEventListener('touchend', e => {
    if (sliderActive) return;
    if (!swipeEnabled) return;

    // A swipe may start on a button or link (the browser cancels the click
    // once the finger moves), but never on controls that are dragged
    // themselves: sliders, text fields (text selection) and dropdowns.
    if (e.target.closest('input, select, textarea, .play-slider')) {
      return;
    }
    if (!appReady) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;

    // Only mostly-horizontal movements count; vertical scrolling must not switch screens
    if (Math.abs(endX - startX) <= Math.abs(endY - startY)) return;

    if (endX < startX - 50 && current < pageOrder.length - 1) {
      showPage(pageOrder[current + 1]);
    } else if (endX > startX + 50 && current > 0) {
      showPage(pageOrder[current - 1]);
    }
  });
  /* KEYBOARD */
  document.addEventListener('keydown', e => {
    if (!swipeEnabled) return;
    if (!appReady) return;
    // Arrow keys move the cursor inside text fields - never switch screens then
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === "ArrowRight" && current < pageOrder.length - 1) {
      showPage(pageOrder[current + 1]);
    } else if (e.key === "ArrowLeft" && current > 0) {
      showPage(pageOrder[current - 1]);
    }
  });

});/* ============================================================
TASK SECTION
 ============================================================ */

function loadTaskContent(index) {
  if (OFFLINE_MODE) {
    taskContent = debugTaskSchedule;
    renderSchedule(taskContent);
    return;
  }
  $.getJSON(`/preset/content?id=${index}`, data => {
    presetStages = Array.isArray(data.stages) ? data.stages : [];
    if (!isTaskActive()) { stageList = presetStages; renderStageTile(); }
    showPresetSchedule(data);
  });
}

//$("#taskSelect").on("change", () => {
//  taskIndex = Number($("#taskSelect").val());
//  loadTaskContent(taskIndex);
//});

// Picking a schedule in the box makes it the selected one on the controller
// (kept in its RTC memory), so it is shown again after a reboot.
// The box is hidden while a schedule runs, so nothing is running here.
$("#taskSelect").on("change", () => {
  taskIndex = Number($("#taskSelect").val());
  loadTaskContent(taskIndex);
  updateScheduleHeader();
  updateTaskUI(taskStatus);
  if (OFFLINE_MODE) return;
  $.ajax({
    url: "/preset/select",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ id: taskIndex })
  }).fail(xhr => console.warn("/preset/select failed:", xhr.status, xhr.responseText));
});

function initDashboard() {
  if (OFFLINE_MODE) {
    console.warn("OFFLINE MODE → using debug task list");

    const select = $("#taskSelect");
    select.empty();
    select.append(`<option value="1000">DebugTask</option>`);

    taskIndex = 1000;
    taskStatus = "not started";
    taskStartTime = null;

    updateTaskUI(taskStatus);

    taskContent = debugTaskSchedule;
    renderSchedule(taskContent);
    buildDashboard();
    fetchState();
    initTaskControlUI();
    return;
  }

  // ONLINE MODE
  // Output rows depend only on the channel configuration, so build them
  // right away: a failing or slow task list must not leave Outputs empty.
  buildDashboard();
  // Ask for the task list only after the first state answer: right after
  // connecting the controller is busy serving all files at once, and the
  // list is the request that needs the most memory
  // (forced: a captive-portal window often loads in the background, hidden)
  $.when(fetchState(true)).always(() => loadPresetList(1));
  console.log("Dashboard init");
}

// The controller can be busy right after a reboot (Wi-Fi start, phone
// loading all files at once), so a failed list request is retried a few
// times before giving up.
const PRESET_LIST_TRIES = 4;
let presetListLoading = false;

function loadPresetList(attempt) {
  presetListLoading = true;
  $("#taskSelectLabel").text(attempt > 1 ? t("dash.task_list_loading_try", { n: attempt }) : t("dash.task_list_loading"));
  $.ajax({ url: "/preset/list", dataType: "json", timeout: 8000 }).done(raw => {
    presetListLoading = false;

    // Normalize backend presets → frontend task list.
    // Preset 0 is the built-in template ("Default").
    const tasks = (raw.presets || []).map(p => ({
      index: p.id,
      name: p.name,
      builtIn: !!p.builtIn
    }));
    taskList = tasks;

    // Status + start time; "frozen" = waiting at a pause point
    taskStatus = raw.current?.status || "stopped";
    taskStartTime = raw.current?.startTime || null;
    pauseMessage = raw.current?.pauseMessage || "";

    // The controller's selected preset (running or not, kept in its RTC
    // memory); the template if that preset does not exist
    const selected = raw.current ? raw.current.presetId : 0;
    taskIndex = tasks.some(x => x.index === selected) ? selected : 0;

      
    // Populate dropdown
    const select = $("#taskSelect");
    select.empty();
    tasks.forEach(x => {
      select.append($('<option>').val(x.index).text(x.name));   // name as plain text
    });
    select.val(taskIndex);

    // Update UI
    updateTaskUI(taskStatus);
    updateScheduleHeader();
    loadTaskContent(taskIndex);
    initTaskControlUI();
  })
  .fail((xhr, textStatus) => {
    console.warn("Failed to load /preset/list:", xhr.status, textStatus);
    // Retry even while the page is hidden: a captive-portal window loads in
    // the background and must have its list when the user brings it up
    const left = typeof exitGuardLeaving !== 'undefined' && exitGuardLeaving;
    if (attempt < PRESET_LIST_TRIES && !left) {
      setTimeout(() => loadPresetList(attempt + 1), 1500 * attempt);
      return;
    }
    presetListLoading = false;
    // Show why, and let the user try again with a tap
    const why = xhr.status ? `error ${xhr.status}` : textStatus;
    $("#taskSelectLabel").empty()
      .append(document.createTextNode(t("dash.task_list_unavailable", { reason: why }) + " "))
      .append($('<a href="#" id="taskListRetry"></a>').text(t("common.retry")));
    $("#taskListRetry").one("click", e => { e.preventDefault(); loadPresetList(1); });
  });
}

// The page was hidden while loading and the list never arrived: try again as
// soon as the user brings the window to the front
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || OFFLINE_MODE) return;
  if (taskList.length === 0 && !presetListLoading) loadPresetList(1);
});

let dashboardTimer = null;

function runDashboardWorkflow() {
  // Clear any previous timer
  if (dashboardTimer) {
    clearInterval(dashboardTimer);
  }

  // Immediately update once
  fetchState();

  // Then update every 1 second while dashboard is active
  dashboardTimer = setInterval(() => {
    if (currentPage === "dashboard") {
      fetchState();
    } else {
      clearInterval(dashboardTimer);
      dashboardTimer = null;
    }
  }, 1000);
}


function initTaskControlUI() {
  $("#notice-ok").off().on("click", confirmNotice);
  initDashboardFolds();
  $("#pause-continue").off().on("click", () => {
    pauseMessage = "";
    requestTaskResume();          // the controller confirms the pause point
  });
  $("#taskStart").off().on("click", requestTaskStart);
  $("#taskPause").off().on("click", () =>
  taskStatus === "paused" ? requestTaskResume() : requestTaskPause());
  initTiles();
  $("#taskStop").off().on("click", requestTaskStop);
  updateTaskUI(taskStatus);
}

const PAUSE_ICON  = "M5 3h2v10H5V3zm4 0h2v10H9V3z";
const RESUME_ICON = "M4 3.3v9.4L12 8 4 3.3z";

function updateTaskUI(status) {
  // Task tile: the name; until the list arrives the label shows
  // "Loading..." or the retry link put there by loadPresetList()
  if (taskList.length) {
    const task = taskList.find(x => x.index === taskIndex);
    $("#taskSelectLabel").text(task ? tName(task.name) : t("common.unknown"));
  }
  const line = {
    running:  taskStartTime ? t("dash.status_running_since", { time: tileTime(taskStartTime) })
                            : t("dash.status_running"),
    paused:   t("dash.status_paused"),
    frozen:   t("dash.status_waiting"),
    finished: t("dash.status_finished")
  }[status] || t("dash.status_stopped");
  $("#taskStatusLabel").text(line);
  $("#taskTile").attr("data-status", status);

  // Stage-end banner
  $("#pause-banner").toggleClass("d-none", status !== "frozen");
  $("#pause-message").text(tName(pauseMessage || ""));
  updateMessagesCard();

  // Buttons. Pause becomes Resume while paused.
  const active = status === "running" || status === "paused" || status === "frozen";
  $("#taskStart").prop("disabled", active);
  $("#taskPause").prop("disabled", status !== "running" && status !== "paused")
    .attr("title", t(status === "paused" ? "dash.btn_resume" : "dash.btn_pause"))
    .find("path").attr("d", status === "paused" ? RESUME_ICON : PAUSE_ICON);
  $("#taskStop").prop("disabled", !active);

  renderStageTile();
}


// Build output cards dynamically based on merged outputsConfig
function buildDashboard() {
  const container = document.getElementById("outputs-dashboard");
  container.innerHTML = "";

  outputsConfig.forEach(o => {
    if (o.mode === "message" || o.mode === "sound") return;   // virtual: no card
    const invertStyle = o.invert ? "filter: invert(100%);" : "";

    container.insertAdjacentHTML("beforeend", `
      <div class="channel-row d-flex justify-content-between align-items-center mb-3" data-id="${o.id}">
        
        <div class="d-flex align-items-center">
          <div class="pic" style="${o.style || ''}">
            <img src="${o.icon || '/sun.svg'}" style="${invertStyle}" width="28" height="28">
          </div>
          <div><strong class="out-label"></strong></div>
        </div>

        <div class="text-right">
          <div class="value-big" id="out_${o.id}_value">--%</div>
          <div class="countdown"><span data-i18n="dash.next_label">${_escT("dash.next_label")}</span> <span id="out_${o.id}_count">--:--</span></div>
        </div>

      </div>
    `);
    // the name as plain text (it may come from the user)
    $(container).find(`.channel-row[data-id="${o.id}"] .out-label`).text(outLabel(o));
  });
}

// t() for HTML built in a template string
function _escT(key, params) {
  return String(t(key, params)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


// Update only outputs section from /api/state
function updateDashboardState(state) {
  if (!state || !state.outputs) {
    console.warn("State has no outputs");
    return;
  }

  state.outputs.forEach(o => {
    const cfg = outputsConfig.find(c => c.id === o.idx);
    if (!cfg) return;

    const duty = o.value;

    const valueEl = document.getElementById(`out_${o.idx}_value`);
    if (valueEl) valueEl.textContent = `${Math.round(duty)}%`;
    if (o.next > 0) o.next--;
    updateNextCountdown(o.idx, o.next);

  });
}




let deviceNow = 0;
let receivedAt = 0;

function syncDeviceTime(nowEpoch) {
    deviceNow = nowEpoch;
    receivedAt = Date.now() / 1000;
}

function updateNextCountdown(idx, remaining) {
    const el = document.getElementById(`out_${idx}_count`);
    if (!el) return;

    if (!remaining || remaining <= 0) {
        el.textContent = "--:--";
        return;
    }

    // Under 1 hour → mm:ss
    if (remaining < 3600) {
        const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
        const ss = String(remaining % 60).padStart(2, "0");
        el.textContent = `${mm}:${ss}`;
        return;
    }

    // Under 24 hours → hh:mm:ss
    if (remaining < 86400) {
        const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
        const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
        const ss = String(remaining % 60).padStart(2, "0");
        el.textContent = `${hh}:${mm}:${ss}`;
        return;
    }

    // 1 day or more → dd:hh:mm
    const dd = String(Math.floor(remaining / 86400)).padStart(2, "0");
    const hh = String(Math.floor((remaining % 86400) / 3600)).padStart(2, "0");
    const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
    el.textContent = `${dd}:${hh}:${mm}`;
}


// Fetch full state and fan out to RTC/inputs + outputs
// force: one request even while the page is hidden (first load)
// Message of the pause point the task waits at ("" when not waiting)
let pauseMessage = "";

// /api/state carries the task status: show or hide the pause banner when a
// pause point is reached (or was confirmed on another screen)
function followTaskStatus(s) {
  if (!s || !s.taskStatus) return;
  const msg = s.pauseMessage || "";
  if (s.taskStatus === "frozen") {
    if (taskStatus !== "frozen" || msg !== pauseMessage) {
      taskStatus = "frozen";
      pauseMessage = msg;
      updateTaskUI(taskStatus);
    }
  } else if (taskStatus === "frozen" && s.taskStatus === "running") {
    taskStatus = "running";
    pauseMessage = "";
    updateTaskUI(taskStatus);
  }
}

// Text of the Message output ("" when none). OK hides it on the controller.
let noticeText = "";
function showNotice(text) {
  noticeText = text || "";
  $("#notice-text").text(tName(noticeText));
  $("#notice-banner").toggleClass("d-none", !text);
  updateMessagesCard();
}

// Messages card: count in the header (seen when folded), "No messages",
// and open the card by itself when a message comes that was not there yet
let shownMessages = "";
function updateMessagesCard() {
  const texts = [];
  // the texts as the controller sends them, so a language change is no new message
  if (!$("#pause-banner").hasClass("d-none")) texts.push("P:" + pauseMessage);
  if (!$("#notice-banner").hasClass("d-none")) texts.push("N:" + noticeText);
  $("#msg-count").text(texts.length).toggleClass("d-none", texts.length === 0);
  $("#no-messages").toggleClass("d-none", texts.length > 0);
  const key = texts.join("\n");
  if (key && key !== shownMessages) $("#messages-body").collapse("show");
  shownMessages = key;
}

// Folded cards stay folded when the page is opened again (this phone only)
const FOLD_KEY = "dashFolded";
function initDashboardFolds() {
  let folded = [];
  try { folded = JSON.parse(localStorage.getItem(FOLD_KEY) || "[]"); } catch (e) { folded = []; }
  ["#messages-body", "#outputs-body"].forEach(id => {
    const $body = $(id);
    const $head = $(`[data-target="${id}"]`);
    if (folded.includes(id)) {
      $body.removeClass("show");
      $head.addClass("collapsed").attr("aria-expanded", "false");
    }
    $body.off(".fold").on("shown.bs.collapse.fold hidden.bs.collapse.fold", function (e) {
      if (e.target !== this) return;
      let list = [];
      try { list = JSON.parse(localStorage.getItem(FOLD_KEY) || "[]"); } catch (err) { list = []; }
      list = list.filter(x => x !== id);
      if (e.type === "hidden") list.push(id);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(list)); } catch (err) { /* private mode */ }
    });
  });
}

function confirmNotice() {
  showNotice("");
  if (OFFLINE_MODE) return;
  $.ajax({ url: "/api/notice/ok", type: "POST" })
    .fail(() => fetchState(true));      // still shown if OK did not arrive
}

function fetchState(force) {
  if (OFFLINE_MODE) {
    // Fake state for debugging
    const fake = {
      rtc: "12:34:56",
      w_temp: 22,
      a_temp: 24,
      a_hum: 60,
      Level: "OK",
      outputs: outputsConfig.map(o => ({
        idx: o.id,
        value: Math.floor(Math.random() * 100),
        next: 0,
        remaining: 0
      }))
    };
    renderDashboard(fake);
    updateDashboardState(fake);
    return;
  }

  // Online mode
  if (!force && !pollingAllowed()) return;
  return $.getJSON("/api/state")
    .done(s => {
      renderDashboard(s);
      updateDashboardState(s);
      followTaskStatus(s);
      updateStageState(s);
      showNotice(s.notice || "");
    })
    .fail(() => {
      console.warn("Failed to fetch /api/state");
    });

}


// Render RTC + sensors only
function renderDashboard(s) {
  $("#rtc").text(t("dash.time", { time: s.rtc || "--" }));

  $("#w_temp").text(s.w_temp ?? "--");
  $("#w_temp_bar").css("width", (s.w_temp ?? 0) + "%");

  $("#a_temp").text(s.a_temp ?? "--");
  $("#a_temp_bar").css("width", (s.a_temp ?? 0) + "%");

  $("#a_hum").text(s.a_hum ?? "--");
  $("#a_hum_bar").css("width", (s.a_hum ?? 0) + "%");

  $("#level").text(s.Level ?? "--");      // LOW / OK / HIGH / NOK as the controller sends them

  const levelWidth =
    s.Level === "LOW" ? "25%" :
      s.Level === "OK" ? "50%" :
        s.Level === "HIGH" ? "100%" : "0%";

  $("#level_bar").css("width", levelWidth);
}



function loadOutputsConfig() {
  return new Promise((resolve, reject) => {

    // Offline mode → use debug config
    if (OFFLINE_MODE) {
      outputsConfig = [...debugOutputsConfig];
      resolve();
      return;
    }
    $.getJSON("/api/outputs")
      .done(data => {
        const raw = data.outputs || [];
        outputsConfig = raw.map(o => ({
          ...o,
          // Normalize backend → frontend
          riseDefault: o.riseDefault ?? o.rampDefault ?? 0,
          fallDefault: o.fallDefault ?? o.rampDefault ?? 0
        }));
        resolve();
      })
      // Backend must return: { outputs: [ { id, label, rampDefault, invert, icon, style } ] }
      .fail(err => {
        console.error("Failed to load /api/outputs", err);
        reject(err);
      });
  });
}
/* ============================================================
   DASHBOARD TILES: current task and current stage
   ============================================================ */
let stageState = null;    // /api/state "stage" while a task is active
let stageList = [];       // stages shown in the stage picker
let presetStages = [];    // stages of the selected task (/preset/content)
let startAtStage = null;  // stage id for the next /preset/start

function isTaskActive() {
  return taskStatus === "running" || taskStatus === "paused" || taskStatus === "frozen";
}

// "2026-11-01 14:37" -> "01.11 14:37"
function tileTime(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || "");
  return m ? `${m[3]}.${m[2]} ${m[4]}:${m[5]}` : (s || "");
}

// Stage length as "7 d", "21 d 12 h" or "open-ended"
function stageLengthText(st) {
  const d = Number(st.days) || 0, h = Number(st.hours) || 0;
  if (!d && !h) return t("dash.open_ended");
  return (d ? d + " " + t("unit.d") : "") + (d && h ? " " : "") + (h ? h + " " + t("unit.h") : "");
}

// Called with every /api/state answer
function updateStageState(s) {
  if (s.taskStatus === "finished" && taskStatus !== "finished") {
    taskStatus = "finished";
    updateTaskUI(taskStatus);
  }
  const active = ["running", "paused", "frozen"].includes(s.taskStatus);
  stageState = active && s.stage ? s.stage : null;
  stageList = active ? (Array.isArray(s.stages) ? s.stages : []) : presetStages;
  renderStageTile();
}

function renderStageTile() {
  const st = stageState;
  let label = t("dash.stage"), name = t("dash.stage_single"), days = "", pct = 0;

  if (st) {
    label = t("dash.stage_n_of", { n: st.index + 1, count: st.count });
    name = tName(st.name || "");
    const day = Math.floor((st.elapsedMin || 0) / 1440) + 1;
    const total = st.lengthMin ? Math.ceil(st.lengthMin / 1440) : 0;
    days = total ? t("dash.day_of", { day: day, total: total }) : t("dash.day", { day: day });
    pct = st.lengthMin ? Math.min(100, 100 * st.elapsedMin / st.lengthMin) : 0;
  } else if (taskStatus === "finished" && stageList.length) {
    label = t("dash.stage_n_of", { n: stageList.length, count: stageList.length });
    name = tName(stageList[stageList.length - 1].name);
    days = t("dash.stage_done");
    pct = 100;
  } else if (stageList.length) {
    label = t("dash.stages_count", { count: stageList.length });
    name = tName(stageList[0].name);
    days = t("dash.starts_with_this");
  }

  $("#stageTileLabel").text(label);
  $("#stageTileName").text(name);
  $("#stageTileDays").text(days);
  $("#stageTileBar").css("width", pct + "%");
  $("#stageTile").toggleClass("disabled", stageList.length === 0);
}

/* ---------- picker dialog ---------- */
let pickAction = null;

// items: [{ id, label, sub, current }]; onPick(item) runs on a tap
function openPicker(title, items, onPick) {
  $("#pick-title").text(title);
  const $list = $("#pick-list").empty().removeClass("d-none");
  items.forEach(it => {
    const $b = $('<button type="button" class="list-group-item list-group-item-action"></button>');
    $b.append($('<div></div>').text(it.label));
    if (it.sub) $b.append($('<div class="small text-muted"></div>').text(it.sub));
    if (it.current) $b.addClass("current");
    $b.on("click", () => onPick(it));
    $list.append($b);
  });
  $("#pick-confirm").addClass("d-none");
  $("#pickModal").modal("show");
}

// Second step in the same dialog: a question with Back / Yes
function askPicker(question, okText, action) {
  $("#pick-question").text(question);
  $("#pick-ok").text(okText);
  pickAction = action;
  $("#pick-list").addClass("d-none");
  $("#pick-confirm").removeClass("d-none");
}

function closePicker() {
  $("#pickModal").modal("hide");
}

/* ---------- task tile ---------- */
function openTaskPicker() {
  if (!taskList.length) return;
  const items = taskList.map(x => ({
    id: x.index,
    label: tName(x.name),
    current: x.index === taskIndex
  }));
  openPicker(t("pick.task_title"), items, it => {
    if (it.id === taskIndex) { closePicker(); return; }
    if (!isTaskActive()) {
      // Nothing runs: just select it (the box handler tells the controller)
      closePicker();
      $("#taskSelect").val(it.id).trigger("change");
      return;
    }
    const curTask = taskList.find(x => x.index === taskIndex);
    const cur = curTask ? tName(curTask.name) : t("pick.the_task");
    askPicker(t("pick.stop_and_start", { current: cur, next: it.label }), t("pick.btn_start"), () => {
      $("#taskSelect").val(it.id);
      requestTaskStart();
    });
  });
}

/* ---------- stage tile ---------- */
function openStagePicker() {
  if (!stageList.length) return;
  const curId = stageState ? stageState.id : null;
  const items = stageList.map((st, i) => ({
    id: st.id,
    label: `${i + 1}. ${tName(st.name)}`,
    sub: (st.days !== undefined || st.hours !== undefined) ? stageLengthText(st) : "",
    current: st.id === curId,
    name: tName(st.name)
  }));
  openPicker(t("pick.stage_title"), items, it => {
    if (it.id === curId) { closePicker(); return; }
    if (isTaskActive()) {
      askPicker(t("pick.switch_to", { stage: it.name }), t("pick.btn_switch"), () => requestSetStage(it.id));
      return;
    }
    const curTask = taskList.find(x => x.index === taskIndex);
    const task = curTask ? tName(curTask.name) : t("pick.the_task");
    askPicker(t("pick.start_at", { task: task, stage: it.name }), t("pick.btn_start"), () => {
      startAtStage = it.id;
      requestTaskStart();
    });
  });
}

function requestSetStage(stageId) {
  if (OFFLINE_MODE) return;
  $.ajax({
    url: "/preset/stage",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ stageId: stageId })
  })
    .done(() => fetchState(true))
    .fail(xhr => console.warn("/preset/stage failed:", xhr.status, xhr.responseText));
}

// Bound once from initTaskControlUI()
function initTiles() {
  const open = (sel, fn) => {
    $(sel).off(".tile")
      .on("click.tile", e => {
        // the "Retry" link of a failed task list stays a link
        if ($(e.target).closest("a").length) return;
        if (!$(sel).hasClass("disabled")) fn();
      })
      .on("keydown.tile", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $(sel).trigger("click"); }
      });
  };
  open("#taskTile", openTaskPicker);
  open("#stageTile", openStagePicker);

  $("#pick-cancel").off().on("click", () => {
    pickAction = null;
    $("#pick-confirm").addClass("d-none");
    $("#pick-list").removeClass("d-none");
  });
  $("#pick-ok").off().on("click", () => {
    const action = pickAction;
    pickAction = null;
    closePicker();
    if (action) action();
  });
  renderStageTile();
}

// Language changed: redraw what the Dashboard built in JS
onLanguageChange(() => {
  if (!initialized.dashboard) return;
  if (!presetListLoading && taskList.length) updateTaskUI(taskStatus);
  renderStageTile();
  $("#outputs-dashboard .channel-row").each(function () {
    const cfg = outputsConfig.find(c => String(c.id) === String($(this).data("id")));
    $(this).find(".out-label").text(outLabel(cfg));
  });
  showNotice(noticeText);
  if ($("#pickModal").hasClass("show")) closePicker();   // its texts were built for the old language
});
let currentTaskName = null;
let lastMode = null;
let suppressChannelChange = false;
let currentItem = null;
let nextGroupId = 1;
// ---------------------------------------------------------
// TREE RENDERING
// ---------------------------------------------------------

function renderSchedule(list) {
  syncGroupIdCounter(list);

  // Old pause points are not used any more: a stage end pauses instead
  list = list.filter(ev => ev.repeat !== 'freeze');

  // A task without stages is one open-ended stage
  if (!Array.isArray(taskStages) || taskStages.length === 0)
    taskStages = [newStage(1, t('sch.stage_default_name', { n: 1 }), 0, 0)];
  const known = new Set(taskStages.map(st => Number(st.id)));
  const firstStage = Number(taskStages[0].id);

  const groups = {};
  const ordered = [];

  list.forEach(item => {
    if (!known.has(Number(item.stageId))) item.stageId = firstStage;
    if (item.groupId && item.groupId > 0) {
      if (!groups[item.groupId]) {
        groups[item.groupId] = [];
        ordered.push({ type: 'batch', groupId: item.groupId });
      }
      groups[item.groupId].push(item);
    } else {
      // Wrap standalone events as single-leaf batches
      const gid = generateGroupId();
      item.groupId = gid;
      groups[gid] = [item];
      ordered.push({ type: 'batch', groupId: gid });
    }
  });

  const $tree = $('#schedule-tree');
  $tree.empty();
  $('#schedule-error').addClass('d-none');
  taskStages.forEach(st => $tree.append(buildStageNode(st)));

  ordered.forEach(entry => {
    const evs = groups[entry.groupId];
    createTreeNode(evs, evs[0].stageId);
  });
  refreshStageHeaders();
}

// Collect current events of a node from its leaves (leaves are the single source of truth)
function getNodeEvents($node) {
  const events = [];
  $node.find('.tree-leaf').each(function () {
    events.push($(this).data('event'));
  });
  return events;
}

// Build a tree node (batch) with its leaves; returns the jQuery element, does not insert it
function buildTreeNode(events) {
  if (!events || events.length === 0) return null;

  const groupId = events[0].groupId;
  const repeat = groupRepeat(events);
  const collapseId = `tree-leaves-${groupId}`;

  const { nodeLabel, nodeDays, nodeInfo } = buildNodeSummary(events);
  const allEnabled = events.every(ev => ev.enabled !== false);

  const $node = $(`
  <div class="tree-node" data-group-id="${groupId}">
    <div class="tree-node-header">
      <span class="tree-toggle">▶</span>
      <input type="checkbox" class="tree-check node-check"
             ${allEnabled ? 'checked' : ''}>
      <div class="tree-node-label" title="${escapeHtml(nodeInfo)}">
        <span class="tree-node-days${nodeDays ? '' : ' d-none'}">${nodeDays}</span>
        <span class="tree-node-channels">${escapeHtml(nodeLabel)}</span>
      </div>
      <div class="tree-actions">
        <button class="tree-edit-btn" title="${escapeHtml(t('common.edit'))}" data-i18n-title="common.edit">✏</button>
      </div>
    </div>
    <div class="tree-leaves collapse" id="${collapseId}"></div>
  </div>
`);

  $node.data('groupId', groupId);

  // Populate leaves
  const $leaves = $node.find('.tree-leaves');
  events.forEach(ev => {
    $leaves.append(createLeaf(ev, groupId));
  });

  // Toggle expand/collapse
  $node.find('.tree-node-header').on('click', function (e) {
    if ($(e.target).closest('.tree-edit-btn, .node-check').length) return;
    const $toggle = $node.find('.tree-toggle');
    if ($leaves.hasClass('show')) {
      ensureCollapseHidden($leaves);
      $toggle.text('▶');
    } else {
      ensureCollapseShown($leaves);
      $toggle.text('▼');
    }
  });

  // Node checkbox — toggle all leaves
  $node.find('.node-check').on('change', function () {
    const checked = this.checked;
    $node.find('.tree-leaf').each(function () {
      const $leaf = $(this);
      $leaf.find('.leaf-check').prop('checked', checked);
      const ev = $leaf.data('event');
      ev.enabled = checked;
      $leaf.data('event', ev);
    });
  });

  // Edit node → batch modal
  $node.find('.tree-edit-btn').first().on('click', e => {
    e.stopPropagation();
    openBatchModal($node);
  });

  updateNodeCheckboxFor($node);
  return $node;
}

// A group node in its stage (the first stage if the stage is unknown)
function createTreeNode(events, stageId) {
  const $node = buildTreeNode(events);
  if (!$node) return $node;
  let $stage = stageNodeById(stageId);
  if (!$stage.length) $stage = stageNodes().first();
  $stage.find('.stage-groups').append($node);
  return $node;
}

// ---------------------------------------------------------
// STAGES
// ---------------------------------------------------------
// The tree has one node per stage, in run order; each stage node holds its
// groups. The stage of a group is the stage node it sits in (stageId of its
// events is set from it on Apply). A stage: { id, name, days, hours,
// endPause, message }; length 0 d 0 h = open-ended (last stage only).

function newStage(id, name, days, hours) {
  return { id: id, name: name, days: days, hours: hours, endPause: false, message: '' };
}

function stageLengthText(st) {
  const d = Number(st.days) || 0, h = Number(st.hours) || 0;
  if (!d && !h) return t('dash.open_ended');
  return (d ? d + ' ' + t('unit.d') : '') + (d && h ? ' ' : '') + (h ? h + ' ' + t('unit.h') : '');
}

function stageIsOpen(st) {
  return !(Number(st.days) || 0) && !(Number(st.hours) || 0);
}

function stageNodes() {
  return $('#schedule-tree .stage-node');
}

function stageNodeById(id) {
  return stageNodes().filter(function () { return $(this).data('stage').id === Number(id); }).first();
}

function nextStageId() {
  let max = 0;
  stageNodes().each(function () { max = Math.max(max, $(this).data('stage').id); });
  return max + 1;
}

function buildStageNode(st) {
  const $s = $(`
  <div class="stage-node">
    <div class="stage-header">
      <span class="tree-toggle">▼</span>
      <div class="stage-label">
        <span class="stage-num"></span><span class="stage-name"></span>
        <span class="stage-len"></span>
        <span class="stage-pause d-none" title="${escapeHtml(t('sch.pauses_at_end'))}" data-i18n-title="sch.pauses_at_end">⏸</span>
      </div>
      <div class="tree-actions">
        <button class="stage-add-btn" title="${escapeHtml(t('sch.add_group_tip'))}" data-i18n-title="sch.add_group_tip">+</button>
        <button class="tree-edit-btn" title="${escapeHtml(t('sch.edit_stage'))}" data-i18n-title="sch.edit_stage">✏</button>
      </div>
    </div>
    <div class="stage-groups collapse show">
      <div class="stage-empty text-muted small" data-i18n="sch.no_groups">${escapeHtml(t('sch.no_groups'))}</div>
    </div>
  </div>`);
  $s.data('stage', Object.assign({}, st, { id: Number(st.id) }));

  const $groups = $s.find('.stage-groups');
  $s.find('.stage-header').on('click', function (e) {
    if ($(e.target).closest('.tree-actions').length) return;
    const $toggle = $s.find('.stage-header .tree-toggle');
    if ($groups.hasClass('show')) {
      ensureCollapseHidden($groups);
      $toggle.text('▶');
    } else {
      ensureCollapseShown($groups);
      $toggle.text('▼');
    }
  });
  $s.find('.stage-add-btn').on('click', e => {
    e.stopPropagation();
    ensureCollapseShown($groups);
    $s.find('.stage-header .tree-toggle').text('▼');
    openBatchModal(null, generateGroupId(), $s.data('stage').id);
  });
  $s.find('.stage-header .tree-edit-btn').on('click', e => {
    e.stopPropagation();
    openStageModal($s);
  });
  return $s;
}

// Numbers, names, lengths, pause marks and "no groups" hints of all stages
function refreshStageHeaders() {
  stageNodes().each(function (i) {
    const $s = $(this);
    const st = $s.data('stage');
    $s.attr('data-stage-id', st.id);
    $s.find('.stage-num').text(`${i + 1}. `);
    $s.find('.stage-name').text(tName(st.name) || t('dash.stage'));
    $s.find('.stage-len').text(stageLengthText(st));
    $s.find('.stage-pause').toggleClass('d-none', !(st.endPause && !stageIsOpen(st)));
    $s.find('.stage-empty').toggle($s.find('.tree-node').length === 0);
  });
}

// Stages in tree order, as saved in the preset
function collectStages() {
  return stageNodes().map(function () {
    const st = $(this).data('stage');
    return {
      id: st.id,
      name: (st.name || '').trim() || t('dash.stage'),
      days: Number(st.days) || 0,
      hours: Number(st.hours) || 0,
      endPause: !!st.endPause && !stageIsOpen(st),
      message: st.endPause ? (st.message || '') : ''
    };
  }).get();
}

// "Add stage": a new stage at the end; when the last stage is open-ended
// (it runs until Stop) the new one goes before it
function addStage() {
  $('#schedule-error').addClass('d-none');
  openStageModal(null);
}

let stageModalNode = null;       // stage node being edited, null = new stage

function stageModalIsLast() {
  if (!stageModalNode) {
    const $last = stageNodes().last();
    return !$last.length || !stageIsOpen($last.data('stage'));
  }
  return stageModalNode.is(stageNodes().last());
}

function updateStageModalHints() {
  const d = parseInt($('#stage-days').val()) || 0;
  const h = parseInt($('#stage-hours').val()) || 0;
  const open = !d && !h;
  const last = stageModalIsLast();
  let hint = '';
  if (open) hint = t(last ? 'stage.hint_open' : 'stage.hint_only_last_open');
  else if (last) hint = t('stage.hint_last');
  $('#stage-len-hint').text(hint);
  $('#stage-end-group').toggle(!open);
  $('#stage-message').toggle($('#stage-end-pause').is(':checked'));

  const $all = stageNodes();
  const idx = stageModalNode ? $all.index(stageModalNode) : -1;
  $('#stage-move-group').toggle(!!stageModalNode && $all.length > 1);
  $('#stage-up').prop('disabled', idx <= 0);
  $('#stage-down').prop('disabled', idx < 0 || idx >= $all.length - 1);
  $('#stage-delete-btn').toggle(!!stageModalNode).prop('disabled', $all.length <= 1);
  $('#stage-title').text(stageModalNode ? t('stage.title_n_of', { n: idx + 1, count: $all.length }) : t('stage.title_new'));
}

function openStageModal($stage) {
  stageModalNode = $stage || null;
  const st = $stage ? $stage.data('stage') : newStage(0, '', 7, 0);
  $('#stage-name').val(st.name || '').removeClass('is-invalid');
  $('#stage-days').val(Number(st.days) || 0);
  $('#stage-hours').val(Number(st.hours) || 0);
  $(st.endPause ? '#stage-end-pause' : '#stage-end-next').prop('checked', true);
  $('#stage-message').val(st.message || '').removeClass('is-invalid');
  $('#stage-error').hide().text('');
  $('#stage-delete-confirm').addClass('d-none');

  $('#stage-days, #stage-hours').off('input.stage').on('input.stage', updateStageModalHints);
  // A corrected field clears the error shown for it
  $('#stage-name, #stage-message, #stage-days, #stage-hours').off('input.stagefix')
    .on('input.stagefix', function () { $(this).removeClass('is-invalid'); $('#stage-error').hide(); });
  $('input[name="stage-end"]').off('change.stage').on('change.stage', updateStageModalHints);
  $('#stage-up').off('click').on('click', () => moveStage(-1));
  $('#stage-down').off('click').on('click', () => moveStage(1));
  $('#stage-delete-btn').off('click').on('click', askDeleteStage);
  $('#stage-delete-cancel').off('click').on('click', () => $('#stage-delete-confirm').addClass('d-none'));
  $('#stage-delete-ok').off('click').on('click', deleteStage);
  $('#stage-save-btn').off('click').on('click', saveStage);

  updateStageModalHints();
  $('#stageModal').modal({ backdrop: 'static', keyboard: false });
  $('#stageModal').modal('show');
}

// Moves the stage at once (the tree shows the new order behind the dialog)
function moveStage(dir) {
  if (!stageModalNode) return;
  if (dir < 0) {
    const $prev = stageModalNode.prev('.stage-node');
    if ($prev.length) stageModalNode.insertBefore($prev);
  } else {
    const $next = stageModalNode.next('.stage-node');
    if ($next.length) stageModalNode.insertAfter($next);
  }
  refreshStageHeaders();
  updateStageModalHints();
}

function askDeleteStage() {
  if (!stageModalNode || stageNodes().length <= 1) return;
  const st = stageModalNode.data('stage');
  const n = stageModalNode.find('.tree-node').length;
  const name = tName(st.name) || t('dash.stage');
  $('#stage-delete-text').text(n ? t('stage.delete_with_groups', { name: name, count: n })
                                 : t('stage.delete', { name: name }));
  $('#stage-delete-confirm').removeClass('d-none');
}

function deleteStage() {
  if (!stageModalNode) return;
  stageModalNode.remove();
  stageModalNode = null;
  $('#stageModal').modal('hide');
  refreshStageHeaders();
}

function saveStage() {
  const name = $('#stage-name').val().trim();
  const days = Math.max(0, Math.min(365, parseInt($('#stage-days').val()) || 0));
  const hours = Math.max(0, Math.min(23, parseInt($('#stage-hours').val()) || 0));
  const endPause = $('#stage-end-pause').is(':checked') && (days || hours);
  const message = $('#stage-message').val().trim();
  const fail = (msg, $field) => {
    $('#stage-error').text(msg).show();
    if ($field) $field.addClass('is-invalid').trigger('focus');
  };
  $('#stage-name, #stage-message').removeClass('is-invalid');

  if (!name) return fail(t('stage.err_name'), $('#stage-name'));
  if (!days && !hours && !stageModalIsLast())
    return fail(t('stage.err_open_last'));
  if (endPause && !message)
    return fail(t('stage.err_message'), $('#stage-message'));

  const values = { name, days, hours, endPause: !!endPause, message: endPause ? message : '' };
  if (stageModalNode) {
    stageModalNode.data('stage', Object.assign({}, stageModalNode.data('stage'), values));
  } else {
    const $s = buildStageNode(Object.assign(newStage(nextStageId(), name, days, hours), values));
    const $last = stageNodes().last();
    if ($last.length && stageIsOpen($last.data('stage'))) $s.insertBefore($last);
    else $('#schedule-tree').append($s);
  }
  $('#stageModal').modal('hide');
  refreshStageHeaders();
}

function leafDutyText(ev) {
  const duty = parseInt(ev.duty) || 0;
  return duty === 0 ? t('sch.duty_off') : duty === 100 ? t('sch.duty_on') : `${duty}%`;
}

// Short duration: 10s, 5m, 1h, 1h30m, 1m30s
function shortDuration(sec) {
  sec = parseInt(sec) || 0;
  if (sec === 0) return '0s';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}h` : '') + (m ? `${m}m` : '') + (s ? `${s}s` : '');
}

// Time column of a leaf: clock time, or "on:off" for a custom cycle, which
// starts with the preset and so has no meaningful clock time
function leafTimeText(ev) {
  if (ev.repeat === 'custom') {
    const offset = customOffsetSec(ev);
    return `${shortDuration(ev.on)}:${shortDuration(ev.off)}` +
           (offset > 0 ? ` +${shortDuration(offset)}` : '');
  }
  return ev.time || '--:--';
}

// A custom event starts its on/off cycle this long after the task starts.
// Stored in the event's "time" as HH:MM: the firmware adds it to the start
// (CustomEvent::computeActivation). "--:--" or empty means no offset.
function customOffsetSec(ev) {
  const tm = ev.time;
  if (!tm || tm === '--:--') return 0;
  return timeToSeconds(tm);
}

// Label and level text of a leaf (also redrawn on a language change)
function leafTexts(ev) {
  const isPause = ev.repeat === 'freeze';
  const isMsg = isMessageEvent(ev);
  const isSnd = isSoundEvent(ev);
  const cfg = outputsConfig.find(c => c.id == ev.channelId);
  const on = parseInt(ev.duty) > 0;
  const label = isPause ? `⏸ ${tName(ev.message) || t('sch.leaf_pause')}`
              : isMsg ? (on ? `✉ ${tName(ev.message) || t('sch.leaf_message')}` : `✉ ${t('sch.leaf_message')}`)
              : isSnd ? (on ? `♪ ${ev.sound || t('sch.leaf_sound')}` : `♪ ${t('sch.leaf_sound')}`)
              : (cfg ? outLabel(cfg) : `Ch${ev.channelId}`);
  const duty = isPause ? t('sch.duty_wait') : isMsg ? t(on ? 'sch.duty_show' : 'sch.duty_hide') : leafDutyText(ev);
  return { label: label, duty: duty };
}

function createLeaf(ev, groupId) {
  const isPause = ev.repeat === 'freeze';
  const isMsg = isMessageEvent(ev);
  const isSnd = isSoundEvent(ev);
  const { label, duty: dutyText } = leafTexts(ev);
  const noEdit = isPause || isMsg || isSnd;     // edited in the group dialog
  const enabled = ev.enabled !== false;

  const $leaf = $(`
  <div class="tree-leaf">
    <input type="checkbox" class="tree-check leaf-check" ${enabled ? 'checked' : ''}>
    <span class="tree-leaf-time${ev.repeat === 'custom' ? ' tree-leaf-cycle' : ''}" title="${ev.repeat === 'custom' ? 'on : off' : ''}">${leafTimeText(ev)}</span>
    <span class="tree-leaf-label">${escapeHtml(label)}</span>
    <span class="tree-leaf-duty">${dutyText}</span>
    <div class="tree-actions">
      <button class="tree-edit-btn${noEdit ? ' invisible' : ''}" title="${escapeHtml(t('common.edit'))}" data-i18n-title="common.edit">✏</button>
      <button class="tree-remove-btn" title="${escapeHtml(t('common.remove'))}" data-i18n-title="common.remove">×</button>
    </div>
  </div>
`);

  // Store event data on leaf
  $leaf.data('event', JSON.parse(JSON.stringify(ev)));

  // Leaf checkbox
  $leaf.find('.leaf-check').on('change', function () {
    const evData = $leaf.data('event');
    evData.enabled = this.checked;
    $leaf.data('event', evData);
    // Update node checkbox state
    updateNodeCheckbox(groupId);
  });

  // Edit leaf → individual event modal
  $leaf.find('.tree-edit-btn').on('click', e => {
    e.stopPropagation();
    openLeafModal($leaf, groupId);
  });

  // Remove leaf
  $leaf.find('.tree-remove-btn').on('click', e => {
    e.stopPropagation();
    removeLeaf($leaf, groupId);
  });

  return $leaf;
}

function updateNodeCheckboxFor($node) {
  const total = $node.find('.leaf-check').length;
  const checked = $node.find('.leaf-check:checked').length;
  $node.find('.node-check').prop({
    checked: total > 0 && checked === total,
    indeterminate: checked > 0 && checked < total
  });
}

function updateNodeCheckbox(groupId) {
  updateNodeCheckboxFor($(`.tree-node[data-group-id="${groupId}"]`));
}

function removeLeaf($leaf, groupId) {
  $leaf.remove();
  const $node = $(`.tree-node[data-group-id="${groupId}"]`);
  const remaining = $node.find('.tree-leaf').length;
  if (remaining === 0) {
    $node.remove();  // last leaf → remove whole node
  } else {
    refreshNodeSummary($node);
    updateNodeCheckboxFor($node);
  }
}

// Repeat type of a group: of its channel events (a pause point is "freeze")
function groupRepeat(events) {
  const ev = events.find(e => e.repeat !== 'freeze');
  return ev ? ev.repeat : 'once';
}

// The pause point of a group, if it has one
function groupPause(events) {
  return events.find(e => e.repeat === 'freeze') || null;
}

// The virtual Message output (mode "message"): its id, or null
function isMessageCfg(cfg) { return !!cfg && cfg.mode === 'message'; }
function messageChannelId() {
  const cfg = Array.isArray(outputsConfig) ? outputsConfig.find(isMessageCfg) : null;
  return cfg ? Number(cfg.id) : null;
}
// The virtual Sound output (mode "sound"): plays a file at the On time,
// its duty is the volume
function isSoundCfg(cfg) { return !!cfg && cfg.mode === 'sound'; }
function soundChannelId() {
  const cfg = Array.isArray(outputsConfig) ? outputsConfig.find(isSoundCfg) : null;
  return cfg ? cfg.id : null;
}
function isSoundEvent(ev) {
  return ev.repeat !== 'freeze' && soundChannelId() !== null && Number(ev.channelId) === soundChannelId();
}
function isMessageEvent(ev) {
  return ev.repeat !== 'freeze' && messageChannelId() !== null && Number(ev.channelId) === messageChannelId();
}

// Text for user input placed into HTML
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Group name entered by the user (stored as "groupName" in each event of the
// group); empty when the group has none
function groupNameOf(events) {
  const ev = events.find(e => e.groupName && String(e.groupName).trim());
  return ev ? String(ev.groupName).trim() : '';
}

function buildNodeSummary(events) {
  const seenNames = new Set();

  const channelList = events
    .filter(ev => ev.repeat !== 'freeze')
    .filter(ev => {
      if (seenNames.has(ev.channelId)) return false;
      seenNames.add(ev.channelId);
      return true;
    })
    .map(ev => {
      const cfg = outputsConfig.find(c => c.id == ev.channelId);
      return cfg ? outLabel(cfg) : `Ch${ev.channelId}`;
    }).join(', ');

  // The user's name for the group if there is one, otherwise the channels;
  // a group that pauses the task is marked
  const pause = groupPause(events);
  const nodeLabel = (pause ? '⏸ ' : '') +
    (tName(groupNameOf(events)) || channelList || (pause ? (tName(pause.message) || t('sch.leaf_pause')) : ''));

  const first = events.find(e => e.repeat !== 'freeze') || events[0];
  const repeat = groupRepeat(events);
  const afterDays = first.afterDays || 0;
  const expireAfterDays = first.expireAfterDays || 0;

  let nodeTime = first.time || '--:--';
  if (repeat === 'daily') {
    const offEv =
      events.find(ev => ev.channelId == first.channelId && ev.time !== nodeTime) ||
      events.find(ev => ev.time !== nodeTime);
    if (offEv) nodeTime = `${nodeTime}→${offEv.time}`;
  }
  // Shown in the group line: delay "+2d" and duration "10d", only if set
  const days = [];
  if (afterDays > 0) days.push(`+${afterDays}d`);
  if (expireAfterDays > 0) days.push(`${expireAfterDays}d`);
  const nodeDays = days.join(' : ');

  // Everything else goes into the tooltip; the leaves show the details
  const when = (repeat === 'custom') ? t('sch.cycle', { time: leafTimeText(first) }) : nodeTime;
  const pauseEv = groupPause(events);
  const nodeInfo = `${when} · ${formatRepeat(repeat)} · ${channelList}` +
    (pauseEv ? ' · ' + t('sch.pause_info', { message: tName(pauseEv.message) || '' }) : '');
  return { nodeLabel, nodeTime, nodeDays, nodeInfo, channelList };
}

function refreshNodeSummary($node) {
  // Rebuild summary from current leaves
  const events = [];
  $node.find('.tree-leaf').each(function () {
    events.push($(this).data('event'));
  });
  if (events.length === 0) return;

  const { nodeLabel, nodeDays, nodeInfo } = buildNodeSummary(events);
  $node.find('.tree-node-days').text(nodeDays).toggleClass('d-none', !nodeDays);
  $node.find('.tree-node-channels').text(nodeLabel);
  $node.find('.tree-node-label').attr('title', nodeInfo);
}

function generateGroupId() {
  return nextGroupId++;
}

function syncGroupIdCounter(events) {
  let max = 0;
  events.forEach(ev => {
    if (ev.groupId && ev.groupId > max) max = ev.groupId;
  });
  nextGroupId = max + 1;
}

const debugTaskSchedule = [
  {
    time: "12:00",
    afterDays: 0,
    channelId: 0,
    repeat: "daily",
    duty: 50,
    rise: 0,
    fall: 0,
    enabled: true
  }
];
// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function convertToMs(value, unit) {
  value = parseFloat(value) || 0;
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60000;
    default: return value;
  }
}

function convertFromMs(ms) {
  if (ms >= 60000 && ms % 60000 === 0)
    return { value: ms / 60000, unit: "m" };
  if (ms >= 1000 && ms % 1000 === 0)
    return { value: ms / 1000, unit: "s" };
  return { value: ms, unit: "ms" };
}

function updateScheduleHeader() {
  const task = taskList.find(x => x.index === taskIndex);
  const name = task ? tName(task.name) : "--";
  $("#schedule-task-name").text(taskIndex === 0 ? name + " " + t("sch.template_mark") : name);
  // The template cannot be deleted
  $("#delete-btn").prop("disabled", !task || taskIndex === 0);
}

// ---------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------
function initSchedule() {
  console.log("Schedule init");
  buildScheduleChannelDropdown();
  bindScheduleUI();
  loadScheduleFromTask();
  updateScheduleHeader();
}


function runScheduleWorkflow() {
  // No periodic updates needed
}

// ---------------------------------------------------------
// BUILD CHANNEL DROPDOWN
// ---------------------------------------------------------
function buildScheduleChannelDropdown() {
  const sel = $('#edit-channel');
  sel.empty();

  if (!Array.isArray(outputsConfig)) {
    // fallback if outputsConfig not ready
    console.warn("outputsConfig missing, using debug fallback");
    outputsConfig = outputsConfig || [];
  }

  outputsConfig.forEach(opt => {
    sel.append($('<option>').val(opt.id).text(`${opt.id}: ${outLabel(opt)}`));
  });
}

// --- Collapse coordination helpers (Bootstrap 4.3.1) ---
// Use per-element promise queue so hide/show requests are never lost.

// Show collapse only if not already shown
function ensureCollapseShown(selector) {
  const $el = $(selector);
  if (!$el.hasClass('show')) {
    $el.addClass('show').css('height', '');  // instant, no animation
  }
}

function ensureCollapseHidden(selector) {
  const $el = $(selector);
  if ($el.hasClass('show')) {
    $el.removeClass('show').css('height', '');  // instant, no animation
  }
}
// ---------------------------------------------------------
// FIELD VISIBILITY BASED ON OUTPUT MODE
// ---------------------------------------------------------

function updateFieldsForOutputMode(mode) {
  // We no longer toggle the parent #collapse-duty itself.
  // Only inner groups (#edit-duty-numeric-group, #edit-duty-toggle-group)
  // and the rise/fall collapses are shown/hidden.

  ensureCollapseHidden('#collapse-rise');
  ensureCollapseHidden('#collapse-fall');
  switch (mode) {
    case "no_ramp":
      // show toggle, hide numeric
      ensureCollapseHidden('#edit-duty-numeric-group');
      // hide toggle, show numeric	
      ensureCollapseShown('#edit-duty-toggle-group');
      $('#edit-duty-toggle-label').text(t($('#edit-duty-toggle').is(':checked') ? 'common.on' : 'common.off'));
      break;

    case "softstart":
      // numeric + rise
      ensureCollapseHidden('#edit-duty-toggle-group');
      ensureCollapseShown('#edit-duty-numeric-group');
      ensureCollapseShown('#collapse-rise');
      break;

    case "analog_direct":
      // numeric only
      ensureCollapseHidden('#edit-duty-toggle-group');
      ensureCollapseShown('#edit-duty-numeric-group');
      break;

    case "analog_ramp":
      // numeric + rise + fall
      ensureCollapseHidden('#edit-duty-toggle-group');
      ensureCollapseShown('#edit-duty-numeric-group');
      ensureCollapseShown('#collapse-rise');
      ensureCollapseShown('#collapse-fall');
      break;

    default:
      // unknown mode: keep both inner groups hidden
      break;
  }
}


// ---------------------------------------------------------
// APPLY DEFAULTS BASED ON MODE
// ---------------------------------------------------------

function applyDefaultParamsForMode(mode, channelId) {
  const cfg = outputsConfig.find(c => c.id == channelId);
  if (!cfg) return;

  // Only apply defaults if fields are EMPTY (new item)
  const dutyEmpty = $('#edit-duty').val() === "" || $('#edit-duty').val() == null;
  const riseEmpty = $('#edit-rise').val() === "" || $('#edit-rise').val() == null;
  const fallEmpty = $('#edit-fall').val() === "" || $('#edit-fall').val() == null;

  // Duty default
  if (dutyEmpty) {
    $('#edit-duty').val(0);
    $('#edit-duty-toggle').prop('checked', false);
    $('#edit-duty-toggle-label').text(t('common.off'));

  }

  // Rise/Fall defaults only if empty AND mode supports them
  if (mode === "softstart") {
    if (riseEmpty) $('#edit-rise').val(cfg.riseDefault || 0);
    if (fallEmpty) $('#edit-fall').val(0);
  }

  if (mode === "analog_direct") {
    if (riseEmpty) $('#edit-rise').val(0);
    if (fallEmpty) $('#edit-fall').val(0);
  }

  if (mode === "analog_ramp") {
    if (riseEmpty) $('#edit-rise').val(cfg.riseDefault || 2000);
    if (fallEmpty) $('#edit-fall').val(cfg.fallDefault || 2000);
  }

  // no_ramp has no rise/fall
}


// ---------------------------------------------------------
// BIND UI EVENTS
// ---------------------------------------------------------

function bindScheduleUI() {
  // Repeat selector
  $('#edit-repeat').on('change', updateRepeatVisibility);

  // Channel change: show/hide fields and apply defaults
  $('#edit-channel').on('change', function () {
    if (suppressChannelChange) return;

    const channelId = $(this).val();
    const cfg = Array.isArray(outputsConfig) ? outputsConfig.find(c => c.id == channelId) : null;
    const mode = cfg && cfg.mode;

    if (mode && mode !== lastMode) {
      updateFieldsForOutputMode(mode);
      applyDefaultParamsForMode(mode, channelId);
      lastMode = mode;
    }
  });

  // Duty toggle label sync (if toggle exists)
  $('#edit-duty-toggle').on('change', function () {
    $('#edit-duty-toggle-label').text(t(this.checked ? 'common.on' : 'common.off'));
  });

  // Buttons
  $('#save-edit').on('click', saveScheduleItem);
  $('#add-btn').on('click', addStage);
  $('#apply-btn').on('click', applyScheduleToServer);
  $('#cancel-btn').on('click', loadScheduleFromTask);
  $('#delete-btn').on('click', showDeleteDialog);
  $('#delete-confirm').on('click', deleteCurrentTask);
}

// ---------------------------------------------------------
// LOAD SCHEDULE FROM BACKEND TASK
// ---------------------------------------------------------
function loadScheduleFromTask() {
  // OFFLINE MODE
  if (typeof OFFLINE_MODE !== 'undefined' && OFFLINE_MODE) {
    const saved = localStorage.getItem("debugSchedule");
    if (saved) {
      taskContent = JSON.parse(saved);
    } else {
      taskContent = [];
    }
    taskStages = [];
    renderSchedule(taskContent);
    return;
  }

  // ONLINE MODE
  $.getJSON(`/preset/content?id=${taskIndex}`, showPresetSchedule);
}

// Show a preset from /preset/content in the tree.
// Plant presets (described by growth "phases") can be started from the
// dashboard but cannot be edited here.
// Stages of the loaded task, in run order (rebuilt from the tree on Apply)
let taskStages = [];

function showPresetSchedule(data) {
  currentTaskName = data.name;
  taskContent = Array.isArray(data.schedule) ? data.schedule : [];
  taskStages = Array.isArray(data.stages) ? data.stages : [];
  renderSchedule(taskContent);
  if (!Array.isArray(data.schedule) && Array.isArray(data.phases)) {
    $('#schedule-tree').html('<p class="text-muted m-2" data-i18n="sch.plant_preset"></p>');
    $('#schedule-tree p').text(t('sch.plant_preset'));
  }
}

// ---------------------------------------------------------
// ADD NEW SCHEDULE ITEM
// ---------------------------------------------------------

// AFTER — entire new function:
function addNewScheduleItem() {
  const $first = stageNodes().first();
  openBatchModal(null, generateGroupId(), $first.length ? $first.data('stage').id : 1);
}


// ---------------------------------------------------------
// OPEN MODAL
// ---------------------------------------------------------

let currentBatchRow = null;
let currentBatchGroupId = 0;
let currentLeafGroupId = 0;
let currentBatchStageId = 0;     // stage the edited / new group belongs to
let editModalMode = null;

function openBatchModal($row, newGroupId, stageId) {
  currentBatchRow = $row || null;
  currentBatchGroupId = newGroupId || ($row ? $row.data('groupId') : generateGroupId());
  const $stage = $row ? $row.closest('.stage-node') : stageNodeById(stageId);
  currentBatchStageId = $stage.length ? $stage.data('stage').id : Number(stageId) || 1;

  const isNew = !$row;
  const allEvents = isNew ? [] : getNodeEvents($row);
  $('#batch-name').val(groupNameOf(allEvents));
  // Message tile: its text, and "wait" when the group is a pause point
  const pauseEv = groupPause(allEvents);
  const msgEv = allEvents.find(ev => isMessageEvent(ev) && parseInt(ev.duty) > 0);
  batchMsgText = pauseEv ? (pauseEv.message || '') : (msgEv ? (msgEv.message || '') : '');
  batchMsgWait = !!pauseEv;
  const sndEv = allEvents.find(ev => isSoundEvent(ev) && parseInt(ev.duty) > 0);
  batchSoundFile = sndEv ? (sndEv.sound || '') : '';
  // Channel events (without the pause point) drive the rest of the dialog
  const existingEvents = allEvents.filter(ev => ev.repeat !== 'freeze');
  if (existingEvents.length === 0 && pauseEv) existingEvents.push(Object.assign({}, pauseEv, { repeat: 'once' }));
  const afterDays = existingEvents.length > 0 ? (existingEvents[0].afterDays || 0) : 0;
  const expireAfterDays = existingEvents.length > 0 ? (existingEvents[0].expireAfterDays || 0) : 0;
  $('#batch-after-days').val(afterDays);
  $('#batch-expire').val(expireAfterDays);
  // Determine repeat and times from existing events
  const repeat = existingEvents.length > 0 ? existingEvents[0].repeat : 'daily';
  const firstEvent = existingEvents[0];
  const timeOn = firstEvent ? firstEvent.time : '';
  // Prefer the same channel's second event; fall back to any event with another time
  const offEvent =
    existingEvents.find(ev =>
      ev.channelId == (firstEvent && firstEvent.channelId) && ev.time !== timeOn) ||
    existingEvents.find(ev => ev.time !== timeOn);
  const timeOff = offEvent ? offEvent.time : '';

  const onSec = existingEvents.length > 0 ? (existingEvents[0].on || 0) : 0;
  const offSec = existingEvents.length > 0 ? (existingEvents[0].off || 0) : 0;

  $('#batch-repeat').val(repeat);

  if (repeat === 'custom') {
    // Show durations as HH:MM:SS (seconds matter for short pump runs)
    updateBatchTimeFields(repeat);
    $('#batch-time-on').val(secondsToHHMMSS(onSec));
    $('#batch-time-off').val(secondsToHHMMSS(offSec));
  } else if (repeat === 'daily') {
    $('#batch-time-on').val(timeOn);
    $('#batch-time-off').val(timeOff);
  } else {
    // once
    $('#batch-time-on').val(timeOn);
    $('#batch-time-off').val('');
  }

  $('#batch-time-on, #batch-time-off').removeClass('is-invalid');
  updateBatchTimeFields(repeat);

  // Build channel list: the group's channels start in "In this group"
  batchMembers = new Set(allEvents.filter(ev => ev.repeat !== 'freeze').map(ev => Number(ev.channelId)));
  if (pauseEv && messageChannelId() !== null) batchMembers.add(messageChannelId());
  buildBatchChannelList(existingEvents, repeat);

  // Bind repeat change
  $('#batch-repeat').off('change').on('change', function () {
    const newRepeat = $(this).val();
    // Keep the levels already set for the channels in the group
    const levels = {};
    $('.batch-duty-input').each(function () { levels[$(this).data('channel')] = $(this).val(); });
    $('.batch-duty-toggle').each(function () { levels[$(this).data('channel')] = this.checked; });
    $('#batch-time-on').val('');
    $('#batch-time-off').val('');
    updateBatchTimeFields(newRepeat);
    buildBatchChannelList(existingEvents, newRepeat);
    Object.keys(levels).forEach(ch => {
      const v = levels[ch];
      if (typeof v === 'boolean') $(`#batch-toggle-${ch}`).prop('checked', v).next('label').text(t(v ? 'common.on' : 'common.off'));
      else $(`.batch-duty-input[data-channel="${ch}"]`).val(v);
    });
  });

  // Bind save
  $('#batch-save-btn').off('click').on('click', saveBatchItem);

  $('#batchModal').modal({ backdrop: 'static', keyboard: false });
  $('#batchModal').modal('show');
}

function updateBatchTimeFields(repeat) {
  // Durations need seconds; clock times do not
  $('#batch-time-on, #batch-time-off').attr('step', repeat === 'custom' ? 1 : 60);
  if (repeat === 'daily') {
    $('#batch-time-on-label').text(t('batch.time_on'));
    $('#batch-time-on-group').show();
    $('#batch-time-off-group').show();
    $('#batch-time-off-label').text(t('batch.time_off'));
  } else if (repeat === 'custom') {
    $('#batch-time-on-label').text(t('batch.on_duration'));
    $('#batch-time-on-group').show();
    $('#batch-time-off-group').show();
    $('#batch-time-off-label').text(t('batch.off_duration'));
  } else {
    // once
    $('#batch-time-on-label').text(t('common.time'));
    $('#batch-time-on-group').show();
    $('#batch-time-off-group').hide();
  }
}

// Channels of the group being edited (ids). Set when the dialog opens and
// kept when the repeat type changes; tiles move channels in and out.
let batchMembers = new Set();
// Message tile settings, kept while the repeat type changes
let batchMsgText = '';
let batchMsgWait = false;
// Sound tile: the chosen file, kept while the repeat type changes
let batchSoundFile = '';

function buildBatchChannelList(existingEvents, repeat) {
  const $list = $('#batch-channel-list');
  $list.empty();

  // Two areas of channel tiles, then the settings of the chosen channels
  $list.append(`
    <div class="ch-zone ch-zone-in" data-zone="in">
      <div class="ch-zone-title">${escapeHtml(t('batch.in_group'))}</div>
      <div class="ch-tiles"></div>
      <div class="ch-zone-empty">${escapeHtml(t('batch.drag_hint'))}</div>
    </div>
    <div class="ch-zone ch-zone-out" data-zone="out">
      <div class="ch-zone-title">${escapeHtml(t('batch.available'))}</div>
      <div class="ch-tiles"></div>
    </div>
    <div id="batch-channel-error" class="text-danger small mb-2" style="display:none;">${escapeHtml(t('batch.err_no_channel'))}</div>
    <div class="ch-settings"></div>`);

  const $settings = $list.find('.ch-settings');

  outputsConfig.forEach(cfg => {
    // Find existing event for this channel
    const existing = existingEvents.find(ev =>
      ev.channelId == cfg.id && (repeat !== 'daily' || parseInt(ev.duty) > 0)
    );
    // Fallback to first match if all duties are 0
    const fallback = existingEvents.find(ev => ev.channelId == cfg.id);
    const duty = existing
      ? (parseInt(existing.duty) || 0)
      : (fallback ? parseInt(fallback.duty) || 0 : 0);

    const isNoRamp = cfg.mode === 'no_ramp';

    if (isMessageCfg(cfg)) {
      // The text, shown on the Dashboard until OK. (To pause the task,
      // let its stage end with a pause: stage dialog.)
      $settings.append(`
        <div class="batch-channel-row batch-msg-row" data-channel="${cfg.id}">
          <div class="batch-channel-label">${escapeHtml(outLabel(cfg))}</div>
          <div class="batch-msg-fields">
            <input type="text" class="form-control" id="batch-msg-text" maxlength="60"
                   placeholder="${escapeHtml(t('batch.message_ph'))}" autocomplete="off"
                   value="${escapeHtml(batchMsgText)}">
          </div>
        </div>`);
      return;
    }

    if (isSoundCfg(cfg)) {
      // The file and its volume; it plays once at the On time (daily: every
      // day, custom: every cycle)
      $settings.append(`
        <div class="batch-channel-row batch-msg-row batch-sound-row" data-channel="${cfg.id}">
          <div class="batch-channel-label">${escapeHtml(outLabel(cfg))}</div>
          <div class="batch-msg-fields d-flex align-items-center">
            <select class="form-control mr-2" id="batch-sound-file"></select>
            <input type="number" class="form-control batch-duty-input" title="${escapeHtml(t('batch.volume_tip'))}"
                   data-channel="${cfg.id}" value="${duty || 50}" min="1" max="100" style="width:80px;">
            <span class="ml-1">%</span>
          </div>
        </div>`);
      fillSoundSelect($settings.find('#batch-sound-file'), batchSoundFile);
      return;
    }

    let dutyInput = '';
    if (isNoRamp) {
      const checked = duty >= 50 ? 'checked' : '';
      dutyInput = `
        <div class="custom-control custom-switch">
          <input type="checkbox" class="custom-control-input batch-duty-toggle"
                 id="batch-toggle-${cfg.id}" data-channel="${cfg.id}" ${checked}>
          <label class="custom-control-label" for="batch-toggle-${cfg.id}">
            ${escapeHtml(t(duty >= 50 ? 'common.on' : 'common.off'))}
          </label>
        </div>`;
    } else {
      dutyInput = `
        <input type="number" class="form-control batch-duty-input"
               data-channel="${cfg.id}"
               value="${duty}" min="0" max="100" style="width:80px;">`;
    }

    $settings.append(`
      <div class="batch-channel-row" data-channel="${cfg.id}">
        <div class="batch-channel-label">${escapeHtml(outLabel(cfg))}</div>
        <div class="batch-channel-duty">${dutyInput}</div>
      </div>
    `);
  });

  $list.find('#batch-msg-text').on('input', function () { batchMsgText = this.value; });
  $list.find('#batch-sound-file').on('change', function () {
    batchSoundFile = this.value;
    $(this).removeClass('is-invalid');
  });

  // Toggle label sync
  $list.find('.batch-duty-toggle').on('change', function () {
    $(this).next('label').text(t(this.checked ? 'common.on' : 'common.off'));
  });

  renderChannelTiles();
  bindChannelTileDrag($list);
}

// Put every channel tile into its area (in output order) and show the
// settings rows of the channels in the group only
function renderChannelTiles() {
  const $list = $('#batch-channel-list');
  const $in = $list.find('.ch-zone-in .ch-tiles').empty();
  const $out = $list.find('.ch-zone-out .ch-tiles').empty();

  outputsConfig.forEach(cfg => {
    const invert = cfg.invert ? 'filter: invert(100%);' : '';
    const $tile = $(`
      <div class="ch-tile" data-channel="${cfg.id}" role="button" tabindex="0">
        <div class="pic" style="${cfg.style || ''}">
          <img src="${cfg.icon || '/sun.svg'}" style="${invert}" width="24" height="24" alt="">
        </div>
        <span class="ch-tile-label">${escapeHtml(outLabel(cfg))}</span>
      </div>`);
    (batchMembers.has(Number(cfg.id)) ? $in : $out).append($tile);
    $list.find(`.batch-channel-row[data-channel="${cfg.id}"]`)
      .toggle(batchMembers.has(Number(cfg.id)));
  });

  $list.find('.ch-zone-in .ch-zone-empty').toggle(batchMembers.size === 0);
  if (batchMembers.size > 0) $('#batch-channel-error').hide();
}

// Move a channel into or out of the group
function setChannelMember(id, inGroup) {
  id = Number(id);
  if (inGroup === batchMembers.has(id)) return;
  if (inGroup) {
    batchMembers.add(id);
    // A channel just added starts switched on, not at 0 %
    const $num = $(`.batch-duty-input[data-channel="${id}"]`);
    if ($num.length && !(parseInt($num.val()) > 0)) $num.val(id === soundChannelId() ? 50 : 100);
    const $tog = $(`#batch-toggle-${id}`);
    if ($tog.length && !$tog.is(':checked')) $tog.prop('checked', true).trigger('change');
  } else {
    batchMembers.delete(id);
  }
  renderChannelTiles();
}

// Tiles: tap moves a tile to the other area; drag drops it on an area.
// Pointer events cover touch and mouse; a tile does not scroll the dialog
// (touch-action: none in the CSS), the areas around it do.
function bindChannelTileDrag($list) {
  let drag = null;   // { id, startX, startY, ghost, moved }

  const zoneAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const $zone = el ? $(el).closest('.ch-zone') : $();
    return $zone.length ? $zone.data('zone') : null;
  };

  $list.off('.chdrag');
  $list.on('pointerdown.chdrag', '.ch-tile', function (e) {
    if (e.button !== undefined && e.button > 0) return;
    drag = { id: $(this).data('channel'), startX: e.clientX, startY: e.clientY,
             ghost: null, tile: this, moved: false };
    try { this.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
  });

  $list.on('pointermove.chdrag', '.ch-tile', function (e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;   // still a tap
    if (!drag.moved) {
      drag.moved = true;
      const r = drag.tile.getBoundingClientRect();
      drag.ghost = $(drag.tile).clone().addClass('ch-tile-ghost')
        .css({ width: r.width, left: r.left, top: r.top }).appendTo('body');
      drag.offX = drag.startX - r.left;
      drag.offY = drag.startY - r.top;
      $(drag.tile).addClass('ch-tile-dragging');
    }
    drag.ghost.css({ left: e.clientX - drag.offX, top: e.clientY - drag.offY });
    const zone = zoneAt(e.clientX, e.clientY);
    $list.find('.ch-zone').each(function () {
      $(this).toggleClass('ch-zone-hover', $(this).data('zone') === zone);
    });
  });

  const finish = e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    $list.find('.ch-zone').removeClass('ch-zone-hover');
    $(d.tile).removeClass('ch-tile-dragging');
    if (d.ghost) d.ghost.remove();
    if (!d.moved) {
      setChannelMember(d.id, !batchMembers.has(Number(d.id)));   // tap
      return;
    }
    const zone = e && e.type === 'pointerup' ? zoneAt(e.clientX, e.clientY) : null;
    if (zone === 'in') setChannelMember(d.id, true);
    if (zone === 'out') setChannelMember(d.id, false);
  };
  $list.on('pointerup.chdrag', '.ch-tile', finish);
  $list.on('pointercancel.chdrag', '.ch-tile', () => {
    if (drag && drag.ghost) drag.ghost.remove();
    if (drag) $(drag.tile).removeClass('ch-tile-dragging');
    $list.find('.ch-zone').removeClass('ch-zone-hover');
    drag = null;
  });

  // Keyboard: Enter / Space toggles like a tap
  $list.on('keydown.chdrag', '.ch-tile', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setChannelMember($(this).data('channel'), !batchMembers.has(Number($(this).data('channel'))));
    }
  });
}

function saveBatchItem() {
  const repeat = $('#batch-repeat').val();
  const isDaily = repeat === 'daily';
  const isCustom = repeat === 'custom';

  // Required time fields: both for daily/custom, only the first for once
  const $on = $('#batch-time-on');
  const $off = $('#batch-time-off');
  const onMissing = !$on.val();
  const offMissing = (isDaily || isCustom) && !$off.val();
  $on.toggleClass('is-invalid', onMissing);
  $off.toggleClass('is-invalid', offMissing);
  if (onMissing || offMissing) return;

  // Message tile: shown with OK, or (once groups) a pause point with Continue
  const msgId = messageChannelId();
  const withMessage = msgId !== null && batchMembers.has(msgId);
  const msgText = withMessage ? ($('#batch-msg-text').val() || '').trim() : '';
  const withPause = false;      // pauses are stage ends now
  const pauseMessage = msgText;

  // A group needs at least one channel
  if (batchMembers.size === 0) {
    $('#batch-channel-error').show();
    return;
  }

  // Sound tile: a file and a volume of 1..100 %
  const sndId = soundChannelId();
  if (sndId !== null && batchMembers.has(sndId)) {
    const $file = $('#batch-sound-file');
    const $vol = $(`.batch-duty-input[data-channel="${sndId}"]`);
    const vol = parseInt($vol.val());
    $file.toggleClass('is-invalid', !$file.val());
    $vol.toggleClass('is-invalid', !(vol >= 1 && vol <= 100));
    if (!$file.val() || !(vol >= 1 && vol <= 100)) return;
    batchSoundFile = $file.val();
  }

  // Time fields — meaning depends on repeat type
  const timeOn = $on.val();
  const timeOff = $off.val() || '--:--';

  // Custom: derive on/off seconds from HH:MM:SS duration inputs
  const onTotal = isCustom ? timeToSeconds(timeOn) : 0;
  const offTotal = isCustom ? timeToSeconds(timeOff) : 0;

  // Preserve original event times for custom/once (time is not edited in batch)
  const existingEvents = currentBatchRow ? getNodeEvents(currentBatchRow) : [];

  // Build events array
  const events = [];
  // The group's stage: the stage node it sits in (or was added to)
  const groupStage = currentBatchStageId;

  outputsConfig.forEach(cfg => {
    // Read duty per channel mode
    const duty = (cfg.mode === 'no_ramp')
      ? ($(`#batch-toggle-${cfg.id}`).is(':checked') ? 100 : 0)
      : (parseInt($(`.batch-duty-input[data-channel="${cfg.id}"]`).val()) || 0);

    // Only channels placed in "In this group" belong to the group. Without
    // this, every batch would add events for ALL outputs and e.g. a light
    // group would switch the pump off at its start time.
    const prev = existingEvents.find(ev => ev.channelId == cfg.id);
    if (!batchMembers.has(Number(cfg.id))) return;
    if (isMessageCfg(cfg) && withPause) return;   // the freeze event below

    const base = {
      stageId: groupStage,
      groupId: currentBatchGroupId,
      channelId: cfg.id,
      afterDays: parseInt($('#batch-after-days').val()) || 0,
      expireAfterDays: parseInt($('#batch-expire').val()) || 0,
      repeat: repeat,
      groupName: $('#batch-name').val().trim(),
      // keep ramps already set for this channel (e.g. 2 min from the template)
      rise: prev ? (prev.rise || 0) : (cfg.riseDefault || 0),
      fall: prev ? (prev.fall || 0) : (cfg.fallDefault || 0),
      enabled: true
    };

    if (isSoundCfg(cfg)) {
      // Plays at the group's On time; daily also gets an Off event at the
      // Off time, so each day starts a new switch-on
      const snd = { ...base, rise: 0, fall: 0, sound: batchSoundFile };
      if (isDaily) {
        events.push({ ...snd, time: timeOn, duty, on: 0, off: 0 });
        events.push({ ...base, rise: 0, fall: 0, time: timeOff, duty: 0, on: 0, off: 0 });
      } else if (isCustom) {
        const orig = existingEvents.find(ev => ev.channelId == cfg.id);
        events.push({ ...snd, time: orig ? orig.time : '--:--', duty, on: onTotal, off: offTotal });
      } else {
        events.push({ ...snd, time: timeOn, duty, on: 0, off: 0 });
      }
      return;
    }

    if (isMessageCfg(cfg)) {
      // Shown from the group's On time (until OK or its Off time)
      const msg = { ...base, rise: 0, fall: 0, message: msgText };
      if (isDaily) {
        events.push({ ...msg, time: timeOn, duty: 100, on: 0, off: 0 });
        events.push({ ...base, rise: 0, fall: 0, time: timeOff, duty: 0, on: 0, off: 0 });
      } else if (isCustom) {
        const orig = existingEvents.find(ev => ev.channelId == cfg.id);
        events.push({ ...msg, time: orig ? orig.time : '--:--', duty: 100, on: onTotal, off: offTotal });
      } else {
        events.push({ ...msg, time: timeOn, duty: 100, on: 0, off: 0 });
      }
      return;
    }

    if (isDaily) {
      // ON event
      events.push({ ...base, time: timeOn, duty: duty, on: 0, off: 0 });
      // OFF event — duty always 0
      events.push({ ...base, time: timeOff, duty: 0, on: 0, off: 0 });

    } else if (isCustom) {
      // Preserve original start time — only on/off seconds are batch-edited
      const orig = existingEvents.find(ev => ev.channelId == cfg.id);
      const preservedTime = orig ? orig.time : '--:--';
      events.push({ ...base, time: preservedTime, duty, on: onTotal, off: offTotal });

    } else {
      // once — single time shared
      events.push({ ...base, time: timeOn, duty, on: 0, off: 0 });
    }
  });

  // The pause point: a "freeze" event at the group's time (after its channels)
  if (withPause) {
    events.push({
      groupId: currentBatchGroupId,
      groupName: $('#batch-name').val().trim(),
      channelId: msgId,             // ignored by the controller
      time: timeOn,
      afterDays: parseInt($('#batch-after-days').val()) || 0,
      expireAfterDays: 0,
      repeat: 'freeze',
      message: pauseMessage,
      duty: 0, rise: 0, fall: 0, on: 0, off: 0,
      enabled: true
    });
  }

  $('#batchModal').modal('hide');

  // Replace the edited node in place, or append a new one
  const $newNode = buildTreeNode(events);
  if (currentBatchRow) {
    const wasOpen = currentBatchRow.find('.tree-leaves').hasClass('show');
    currentBatchRow.replaceWith($newNode);
    if (wasOpen) {
      ensureCollapseShown($newNode.find('.tree-leaves'));
      $newNode.find('.tree-toggle').text('▼');
    }
  } else {
    let $stage = stageNodeById(currentBatchStageId);
    if (!$stage.length) $stage = stageNodes().first();
    $stage.find('.stage-groups').append($newNode);
  }
  currentBatchRow = null;
  refreshStageHeaders();
}

function openLeafModal($leaf, groupId) {
  currentItem = $leaf;
  currentLeafGroupId = groupId;
  editModalMode = 'leaf';

  const ev = $leaf.data('event');
  const cfg = outputsConfig.find(c => c.id == ev.channelId);
  const duty = parseInt(ev.duty) || 0;

  // Set channel (read-only in leaf mode)
  suppressChannelChange = true;
  $('#edit-channel').val(ev.channelId);
  suppressChannelChange = false;

  // Duty
  $('#edit-duty').val(duty);
  if ($('#edit-duty-toggle').length) {
    $('#edit-duty-toggle').prop('checked', duty >= 50);
    $('#edit-duty-toggle-label').text(t(duty >= 50 ? 'common.on' : 'common.off'));
  }

  // Rise/Fall — preserve existing values silently
  const r = convertFromMs(ev.rise || 0);
  $('#edit-rise').val(r.value);
  const f = convertFromMs(ev.fall || 0);
  $('#edit-fall').val(f.value);

  // Hide fields not relevant to leaf editing
  $('#edit-channel').closest('.form-group').hide();
  $('#edit-time').closest('.form-group').hide();
  $('#after-days-group').hide();

  // Custom cycle: its own start offset, so channels of one group need not
  // all switch on at the same moment
  const isCustom = (ev.repeat === 'custom');
  $('#edit-offset-group').toggle(isCustom);
  if (isCustom) {
    const off = customOffsetSec(ev);
    $('#edit-offset-h').val(Math.floor(off / 3600));
    $('#edit-offset-m').val(Math.floor((off % 3600) / 60));
  }
  $('#edit-repeat').closest('.form-group').hide();
  $('#custom-repeat-group').hide();
  $('#edit-enabled').closest('.form-group').hide();

  // Show channel name in modal title instead
  const label = cfg ? outLabel(cfg) : `Ch${ev.channelId}`;
  $('#editModal .modal-title').text(t('item.title_named', { name: label }));

  $('#editModal')
    .off('shown.bs.modal.scheduleInit')
    .one('shown.bs.modal.scheduleInit', function () {
      const mode = cfg && cfg.mode;
      if (mode) {
        updateFieldsForOutputMode(mode);
        lastMode = mode;
      }
      $('#edit-rise-unit').val(r.unit);
      $('#edit-fall-unit').val(f.unit);
    });

  $('#editModal').modal('show');
}

// ---------------------------------------------------------
// SAVE MODAL CHANGES
// ---------------------------------------------------------
function saveScheduleItem() {
  if (!currentItem) return;

  const ev = currentItem.data('event');
  const cfg = Array.isArray(outputsConfig) ? outputsConfig.find(c => c.id == ev.channelId) : null;
  const mode = cfg && cfg.mode;

  // Duty
  let duty = parseInt($('#edit-duty').val()) || 0;
  if (mode === "no_ramp") {
    duty = $('#edit-duty-toggle').is(':checked') ? 100 : 0;
  }
  duty = Math.max(0, Math.min(100, duty));

  // Rise / fall — only when the field is shown for this output mode
  if ($('#collapse-rise').hasClass('show')) {
    ev.rise = convertToMs($('#edit-rise').val(), $('#edit-rise-unit').val());
  }
  if ($('#collapse-fall').hasClass('show')) {
    ev.fall = convertToMs($('#edit-fall').val(), $('#edit-fall-unit').val());
  }
  ev.duty = duty;

  // Custom cycle: start offset, stored as HH:MM in "time"
  if (ev.repeat === 'custom') {
    const h = Math.max(0, Math.min(23, parseInt($('#edit-offset-h').val()) || 0));
    const m = Math.max(0, Math.min(59, parseInt($('#edit-offset-m').val()) || 0));
    ev.time = (h || m) ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : '--:--';
  }

  currentItem.data('event', ev);
  currentItem.find('.tree-leaf-duty').text(leafDutyText(ev));
  currentItem.find('.tree-leaf-time').text(leafTimeText(ev));
  refreshNodeSummary(currentItem.closest('.tree-node'));

  currentItem = null;
  $('#editModal').modal('hide');
}

// ---------------------------------------------------------
// APPLY SCHEDULE TO SERVER
// ---------------------------------------------------------
function applyScheduleToServer() {
  const stages = collectStages();
  const openIdx = stages.findIndex(stageIsOpen);
  if (openIdx >= 0 && openIdx < stages.length - 1) {
    $('#schedule-error').removeClass('d-none').text(
      t('sch.err_open_not_last', { name: tName(stages[openIdx].name) }));
    return;
  }
  $('#schedule-error').addClass('d-none');

  taskStages = stages;
  taskContent = [];
  stageNodes().each(function () {
    const stageId = $(this).data('stage').id;
    $(this).find('.tree-node').each(function () {
      getNodeEvents($(this)).forEach(ev => {
        ev.stageId = stageId;
        taskContent.push(ev);
      });
    });
  });

  showSaveAsDialog();
}

// Save dialog
//   Save        - overwrites the current task; a changed name renames it
//   Save as new - always creates a new task with the name in the field
// The template (task 0) can only be saved as new.
function showSaveAsDialog() {
  const isDefault = (taskIndex === 0);
  $('#new-task-name').val(isDefault ? '' : (currentTaskName || ''));
  $('#save-as-error').hide().text('');
  $('#save-as-hint').text(
    isDefault
      ? t('save.hint_template')
      : t('save.hint_task')
  );
  $('#save-as-confirm').toggle(!isDefault);
  $('#save-as-new').toggleClass('btn-primary', isDefault).toggleClass('btn-outline-primary', !isDefault);

  // Returns the trimmed name, or null after showing why it cannot be used.
  // keepId: the task being overwritten may keep its own name.
  const checkName = keepId => {
    const name = $('#new-task-name').val().trim();
    let error = '';
    if (!name) {
      error = t('save.err_name');
    } else if (name.toLowerCase() === 'default') {
      error = t('save.err_default');
    } else if (taskList.some(x => x.index !== keepId && x.index !== 0 &&
                                  String(x.name).toLowerCase() === name.toLowerCase())) {
      error = t('save.err_exists', { name: name });
    }
    if (error) {
      $('#save-as-error').text(error).show();
      return null;
    }
    return name;
  };

  $('#save-as-confirm').off('click').on('click', function () {
    const name = checkName(taskIndex);
    if (name === null) return;
    $('#saveAsModal').modal('hide');
    sendScheduleToServer(taskIndex, name);      // overwrite (and rename)
  });

  $('#save-as-new').off('click').on('click', function () {
    const name = checkName(-1);                 // must differ from every task
    if (name === null) return;
    $('#saveAsModal').modal('hide');
    sendScheduleToServer(0, name);              // 0: controller picks a new id
  });

  // Pass backdrop and keyboard options explicitly — more reliable than data attributes
  $('#saveAsModal').modal({
    backdrop: 'static',
    keyboard: false
  });
  $('#saveAsModal').modal('show');
}

function sendScheduleToServer(index, name) {
  if (typeof OFFLINE_MODE !== 'undefined' && OFFLINE_MODE) {
    localStorage.setItem("debugSchedule", JSON.stringify(taskContent));
    console.log("Saved locally (offline mode)");
    return;
  }
  // id 0 asks the controller for a new preset number
  $.ajax({
    url: "/preset/save",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      preset: taskStages.length
        ? { id: index, name: name, stages: taskStages, schedule: taskContent }
        : { id: index, name: name, schedule: taskContent }
    }),
    success: resp => {
      console.log("Preset saved:", resp);
      currentTaskName = resp.name || name;

      // Same task saved again, possibly under a new name: rename it everywhere
      if (resp.id && resp.id === taskIndex) {
        const task = taskList.find(x => x.index === taskIndex);
        if (task) task.name = currentTaskName;
        $(`#taskSelect option[value="${taskIndex}"]`).text(currentTaskName);
        updateScheduleHeader();
        updateTaskUI(taskStatus);
      }

      // If backend assigned a new id, update frontend state
      if (resp.id && resp.id !== taskIndex) {
        taskIndex = resp.id;

        // Add to dropdown if not already there
        const exists = $(`#taskSelect option[value="${taskIndex}"]`).length > 0;
        if (!exists) {
          $('#taskSelect').append($('<option>').val(taskIndex).text(currentTaskName));
          // Add to taskList
          taskList.push({ index: taskIndex, name: currentTaskName });
        }

        $('#taskSelect').val(taskIndex);
        updateScheduleHeader();
        updateTaskUI(taskStatus);

        // A new schedule becomes the selected one (unless another one runs)
        if (taskStatus !== 'running' && taskStatus !== 'paused') {
          $.ajax({ url: "/preset/select", type: "POST", contentType: "application/json",
                   data: JSON.stringify({ id: taskIndex }) });
        }
      }
    },
    error: xhr => {
      console.warn("/preset/save failed:", xhr.status, xhr.responseText);
      alert(t("save.failed", { error: (xhr.responseJSON && xhr.responseJSON.error) || xhr.status }));
    }
  });
}

// ---------------------------------------------------------
// DELETE PRESET
// ---------------------------------------------------------
function showDeleteDialog() {
  if (taskIndex === 0) return;   // the template cannot be deleted
  const running = (taskStatus === 'running' || taskStatus === 'paused');
  $('#delete-text').text(t('del.will_be_deleted', { name: tName(currentTaskName || '') }));
  $('#delete-running-hint').toggle(running);
  $('#deleteModal').modal({ backdrop: 'static', keyboard: false });
  $('#deleteModal').modal('show');
}

function deleteCurrentTask() {
  const id = taskIndex;
  $('#deleteModal').modal('hide');
  $.ajax({
    url: "/preset/delete",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ id: id }),
    success: () => {
      // Forget the preset and show the next one (the template if none left)
      taskList = taskList.filter(x => x.index !== id);
      $(`#taskSelect option[value="${id}"]`).remove();
      if (!taskList.some(x => x.index === 0)) {
        taskList.unshift({ index: 0, name: 'Default', builtIn: true });
        $('#taskSelect').prepend('<option value="0">Default</option>');
      }
      if (taskStatus === 'running' || taskStatus === 'paused') {
        // The controller stopped it
        taskStatus = 'stopped';
        taskStartTime = null;
      }
      // The controller selects the template when the selected one is deleted
      taskIndex = 0;
      $('#taskSelect').val(taskIndex);
      updateTaskUI(taskStatus);
      updateScheduleHeader();
      loadScheduleFromTask();
    },
    error: xhr => {
      console.warn("/preset/delete failed:", xhr.status, xhr.responseText);
      alert(t("del.failed", { error: (xhr.responseJSON && xhr.responseJSON.error) || xhr.status }));
    }
  });
}

// ---------------------------------------------------------
// REPEAT LOGIC
// ---------------------------------------------------------
function updateRepeatVisibility() {
  const val = $('#edit-repeat').val();
  $('#custom-repeat-group').collapse(val === 'custom' ? 'show' : 'hide');
}

function formatRepeat(repeatVal) {
  const val = String(repeatVal || "").toLowerCase();
  if (val.startsWith("on:") && val.includes("/off:")) {
    return "custom";
  }
  return repeatVal;
}

function parseRepeatFields(repeatVal) {
  $('#edit-on-min, #edit-on-sec, #edit-off-min, #edit-off-sec').val(0);

  if (repeatVal && repeatVal.startsWith('on:')) {
    const [on, off] = repeatVal.replace('on:', '').split('/off:');
    $('#edit-on-min').val(on.slice(0, 2));
    $('#edit-on-sec').val(on.slice(3, 5));
    $('#edit-off-min').val(off.slice(0, 2));
    $('#edit-off-sec').val(off.slice(3, 5));
    $('#edit-repeat').val('custom');
  } else {
    $('#edit-repeat').val(repeatVal || 'daily');
  }

  updateRepeatVisibility();
}

function buildRepeatString() {
  const val = $('#edit-repeat').val();
  if (val === 'custom') return 'custom';
  return val || 'daily';
}

// Language changed: redraw the tree's texts in place, so edits that are not
// saved yet stay as they are
onLanguageChange(() => {
  if (!initialized.schedule) return;
  updateScheduleHeader();
  refreshStageHeaders();
  $('#schedule-tree .tree-leaf').each(function () {
    const ev = $(this).data('event');
    if (!ev) return;
    const tx = leafTexts(ev);
    $(this).find('.tree-leaf-label').text(tx.label);
    $(this).find('.tree-leaf-duty').text(tx.duty);
  });
  $('#schedule-tree .tree-node').each(function () { refreshNodeSummary($(this)); });
  buildScheduleChannelDropdown();
  $('#schedule-error').addClass('d-none');      // shown again on the next Apply
});

  function initPlayground() {
  console.log("Playground init");
  buildPlayground();
//if (OFFLINE_MODE) return;
//  $.post("/task/pause");   // NEW
}

function runPlaygroundWorkflow() {
  // No periodic updates needed
}


function buildPlayground() {
  const container = $("#playground-container");
  container.empty();

  outputsConfig.forEach(o => {
    if (o.mode === "message") return;   // virtual output, nothing to drive
    if (o.mode === "sound") { container.append(buildSoundCard(o)); return; }

    const hasParams = o.mode !== "no_ramp"; // Debug NO_RAMP has no collapse
    const invertStyle = o.invert ? "filter: invert(100%);" : "";
    const card = $(`
      <div class="card mb-3">

        <!-- HEADER: label + ON/OFF -->
        <div class="card-header d-flex justify-content-between align-items-center play-header"
             data-target="#adv-${o.id}" >

          <div class="d-flex align-items-center play-label" data-target="#adv-${o.id}">
          <div class="pic" style="${o.style}">
          <img src="${o.icon}" style="${invertStyle}" width="28" height="28">
          </div>
          <strong class="out-label" data-out-id="${o.id}">${_escT0(outLabel(o))}</strong>
          </div>

<div class="play-controls d-flex">
  <!-- same look as the Dashboard start/stop buttons -->
  <button class="btn btn-success btn-small play-btn play-on" data-id="${o.id}" data-action="on"
          title="${_escT0(t('dash.btn_start'))}" data-i18n-title="dash.btn_start">
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 3.3v9.4L12 8 4 3.3z" />
    </svg>
  </button>

  <button class="btn btn-danger btn-small play-btn play-off" data-id="${o.id}" data-action="off"
          title="${_escT0(t('dash.btn_stop'))}" data-i18n-title="dash.btn_stop">
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="4" width="8" height="8" />
    </svg>
  </button>
</div>

        </div>

        <!-- SLIDER ROW (only for analog modes) -->
        ${
          (o.mode === "analog_direct" || o.mode === "analog_ramp")
          ? `
            <div class="card-body pt-2 pb-2">
              <input type="range" min="0" max="100" value="0"
                     class="play-slider form-range" data-id="${o.id}">
            </div>
          `
          : ""
        }

        <!-- COLLAPSED PARAMS (not for NO_RAMP) -->
        ${
          hasParams
          ? `
            <div class="collapse" id="adv-${o.id}">
              <div class="card-body">

                <div class="form-group">
                  <label data-i18n="pg.rise_ms">${_escT0(t('pg.rise_ms'))}</label>
                  <input type="number" class="form-control rise-input"
                         data-id="${o.id}" value="${o.riseDefault || 0}">
                </div>

                <div class="form-group">
                  <label data-i18n="pg.fall_ms">${_escT0(t('pg.fall_ms'))}</label>
                  <input type="number" class="form-control fall-input"
                         data-id="${o.id}" value="${o.fallDefault || 0}">
                </div>

                <div class="form-group">
                  <label data-i18n="pg.on_sec">${_escT0(t('pg.on_sec'))}</label>
                  <input type="number" class="form-control ontime-input"
                         data-id="${o.id}" value="0">
                </div>

                <div class="form-group">
                  <label data-i18n="pg.off_sec">${_escT0(t('pg.off_sec'))}</label>
                  <input type="number" class="form-control offtime-input"
                         data-id="${o.id}" value="0">
                </div>

              </div>
            </div>
          `
          : ""
        }

      </div>
    `);

    container.append(card);
  });

  bindPlaygroundEvents();
}


// Large Playground sliders (app.css): the filled part of the track follows
// the value through the --val CSS variable
function paintSlider(el) {
  const min = Number(el.min) || 0, max = Number(el.max) || 100;
  const pct = ((Number(el.value) - min) * 100) / (max - min || 1);
  el.style.setProperty("--val", pct + "%");
}

function bindPlaygroundEvents() {

$(".play-slider").on("input", function () { paintSlider(this); })
  .each(function () { paintSlider(this); });

// Sound card: volume label, Play
$(".play-sound-volume").on("input", function () {
  $(`#play-sound-vol-${$(this).data("id")}`).text(this.value + " %");
});
$(".play-sound-btn").on("click", function () {
  const id = $(this).data("id");
  const file = $(`#play-sound-file-${id}`).val();
  const volume = parseInt($(`.play-sound-volume[data-id=${id}]`).val()) || 50;
  playSoundNow(id, file, volume);
});

// Collapse on label click
$(".play-header, .play-label").on("click", function (e) {
  if ($(e.target).closest(".play-control").length) return;
  if ($(e.target).closest(".play-slider").length) return;
if ($(e.target).closest(".play-btn").length) return;

  const target = $(this).data("target");
  if (target) $(target).collapse("toggle");
});

// ON / OFF buttons (the Sound card has its own Play button)
$(".play-btn").not(".play-sound-btn").on("click", function () {
  const id = $(this).data("id");
  const action = $(this).data("action");

  // Remove highlight from both buttons
  $(`.play-btn[data-id=${id}]`).removeClass("play-active");

  let duty = 0;

  if (action === "on") {
    const slider = $(`.play-slider[data-id=${id}]`);

    // ✔ If slider exists → ramp to its value (setpoint)
    // ✔ No slider, or the setpoint is 0 → ramp to 100
    duty = slider.length ? (parseInt(slider.val()) || 0) : 100;
    if (duty === 0) {
      duty = 100;
      if (slider.length) { slider.val(100); paintSlider(slider[0]); }
    }

    sendPlaygroundCommand(id, duty, "on_button");
    simulateRampingIndicator(id, "up");
  }

  if (action === "off") {
    duty = 0;
    sendPlaygroundCommand(id, duty, "off_button");
    simulateRampingIndicator(id, "down");
  }
});



// Slider → direct analog control, cancels ramping
$(".play-slider").not(".play-sound-volume").on("input", function () {
  const id = $(this).data("id");
  const sliderVal = parseInt($(this).val()) || 0;

  // Send 0–100 directly
  const duty = sliderVal;

  // Cancel ramping highlight
  $(`.play-btn[data-id=${id}]`).each(function () {
    const timer = $(this).data("timer");
    if (timer) clearTimeout(timer);
    $(this).removeClass("play-active");
  });

  sendPlaygroundCommand(id, duty, "slider");
});





// Advanced params
$(".rise-input, .fall-input, .ontime-input, .offtime-input").on("change", function () {
  const id = $(this).data("id");
  const rise = parseInt($(`.rise-input[data-id=${id}]`).val()) || 0;
  const fall = parseInt($(`.fall-input[data-id=${id}]`).val()) || 0;
  const ontime = parseInt($(`.ontime-input[data-id=${id}]`).val()) || 0;
  const offtime = parseInt($(`.offtime-input[data-id=${id}]`).val()) || 0;

  sendPlaygroundParams(id, rise, fall, ontime, offtime);
});
}



function simulateRampingIndicator(id, direction) {
  const slider = $(`.play-slider[data-id=${id}]`);
  const sliderVal = slider.length ? parseInt(slider.val()) : 0;

  const rise = parseInt($(`.rise-input[data-id=${id}]`).val()) || 0;
  const fall = parseInt($(`.fall-input[data-id=${id}]`).val()) || 0;

  let delta = 0;
  let duration = 0;

  if (direction === "up") {
    delta = 100 - sliderVal;
    duration = rise * (delta / 100);
  } else {
    delta = sliderVal;
    duration = fall * (delta / 100);
  }

  // Minimum visible time
  duration = Math.max(duration, 150);

  const btn = direction === "up"
    ? $(`.play-btn.play-on[data-id=${id}]`)
    : $(`.play-btn.play-off[data-id=${id}]`);

  btn.addClass("play-active");

  // Clear any previous timer
  if (btn.data("timer")) clearTimeout(btn.data("timer"));

  const timer = setTimeout(() => {
    btn.removeClass("play-active");
  }, duration);

  btn.data("timer", timer);
}




function sendPlaygroundCommand(id, duty, source="slider") {
	 if (OFFLINE_MODE) return;
  const body = { id, duty, source };
  // Start/Stop ramp with the rise/fall times shown on the card; the
  // controller would otherwise use what it last got from these fields
  if (source !== "slider") {
    const $rise = $(`.rise-input[data-id=${id}]`);
    const $fall = $(`.fall-input[data-id=${id}]`);
    if ($rise.length) body.rise = parseInt($rise.val()) || 0;
    if ($fall.length) body.fall = parseInt($fall.val()) || 0;
  }
  $.ajax({
    url: "/playground/control",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(body),
    success: () => console.log("Playground control OK", id, duty)
  });
}


function sendPlaygroundParams(id, rise, fall, ontime, offtime) {
	 if (OFFLINE_MODE) return;
  $.ajax({
    url: "/playground/params",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ id, rise, fall, on:ontime, off:offtime }),
    success: () => console.log("Playground params OK", id)
  });
}



/* ============================================================
   SOUND OUTPUT
   ============================================================ */
// Sound files on the controller (GET /api/sounds), loaded once and shared
// with the schedule editor. done(list) gets the names, e.g. "stage.wav".
let soundFiles = null;
function loadSoundFiles(done) {
  if (soundFiles) { done(soundFiles); return; }
  if (OFFLINE_MODE) { soundFiles = ["stage.wav", "warning.wav"]; done(soundFiles); return; }
  $.ajax({ url: "/api/sounds", dataType: "json", timeout: 5000 })
    .done(d => { soundFiles = (d.sounds || []).slice().sort(); done(soundFiles); })
    .fail(() => done([]));     // not cached: the next dialog asks again
}

// Fill a <select> with the sound files; a file named by an event but no
// longer on the controller stays selectable, marked "missing"
function fillSoundSelect($sel, selected) {
  $sel.empty().append($('<option value="">').text(t("common.loading")));
  loadSoundFiles(list => {
    const names = list.slice();
    if (selected && !names.includes(selected)) names.unshift(selected);
    $sel.empty();
    if (!names.length) $sel.append($('<option value="">').text(t("pg.no_wav")));
    else if (!selected) $sel.append($('<option value="">').text(t("pg.choose_sound")));
    names.forEach(n => {
      const missing = !list.includes(n) ? " " + t("pg.missing") : "";
      $sel.append($("<option>").val(n).text(n + missing));
    });
    $sel.val(selected || "");
  });
}

function buildSoundCard(o) {
  const invertStyle = o.invert ? "filter: invert(100%);" : "";
  const $card = $(`
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <div class="d-flex align-items-center">
          <div class="pic" style="${o.style}">
            <img src="${o.icon}" style="${invertStyle}" width="28" height="28">
          </div>
          <strong class="out-label" data-out-id="${o.id}">${_escT0(outLabel(o))}</strong>
        </div>
        <div class="play-controls d-flex">
          <button class="btn btn-success btn-small play-btn play-sound-btn" data-id="${o.id}" title="${_escT0(t('pg.play'))}" data-i18n-title="pg.play">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 3.3v9.4L12 8 4 3.3z" />
            </svg>
          </button>
        </div>
      </div>
      <div class="card-body pt-2 pb-2">
        <select class="form-control mb-2" id="play-sound-file-${o.id}"></select>
        <div class="d-flex align-items-center">
          <input type="range" min="1" max="100" value="50"
                 class="play-slider play-sound-volume form-range flex-grow-1" data-id="${o.id}">
          <span class="ml-2 text-nowrap" id="play-sound-vol-${o.id}">50 %</span>
        </div>
        <div class="text-danger small mt-1 d-none" id="play-sound-err-${o.id}"></div>
      </div>
    </div>`);
  fillSoundSelect($card.find("select"), "");
  return $card;
}

function playSoundNow(id, file, volume) {
  const $err = $(`#play-sound-err-${id}`).addClass("d-none");
  if (!file) { $err.text(t("pg.err_choose")).removeClass("d-none"); return; }
  const $btn = $(`.play-sound-btn[data-id=${id}]`).addClass("play-active");
  setTimeout(() => $btn.removeClass("play-active"), 600);
  if (OFFLINE_MODE) return;
  $.ajax({
    url: "/playground/sound",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ file, volume }),
    error: () => $err.text(t("pg.err_play", { file: file })).removeClass("d-none")
  });
}

// Text for HTML built in template strings
function _escT0(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Language changed: output names, sound lists and error lines of the cards
onLanguageChange(() => {
  if (!initialized.playground) return;
  $("#playground-container .out-label").each(function () {
    const cfg = outputsConfig.find(c => String(c.id) === String($(this).data("out-id")));
    $(this).text(outLabel(cfg));
  });
  $("#playground-container select[id^='play-sound-file-']").each(function () {
    fillSoundSelect($(this), $(this).val());
  });
  $("#playground-container [id^='play-sound-err-']").addClass("d-none");
});
/* ============================================================
   SETTINGS PAGE
   Endpoints used:
     GET  /api/settings  -> { ap_ssid, ap_auth, sta_ssid, sta_saved, sta_connected }
     POST /api/settings  -> { ap_ssid?, ap_pass?, sta_ssid?, sta_pass? }
                        <- { status:"ok", restart:true }
     GET  /wifi/scan     -> { networks:[{ssid,rssi,security}] }
     POST /wifi/disconnect -> { status:"disconnected" }
   ============================================================ */

/* init (called once when page is first shown) */
function initSettings() {
  /* password eye toggles */
  document.getElementById("ap-pass-toggle").addEventListener("click", () =>
    _togglePass("ap-pass", "ap-pass-toggle"));
  document.getElementById("sta-pass-toggle").addEventListener("click", () =>
    _togglePass("sta-pass", "sta-pass-toggle"));

  /* scan button */
  document.getElementById("wifi-scan-btn").addEventListener("click", runWifiScan);

  /* disconnect button */
  document.getElementById("sta-disconnect-btn").addEventListener("click", staDisconnect);

  /* save button */
  document.getElementById("settings-save-btn").addEventListener("click", saveSettings);

  /* IP settings: automatic / manual */
  $("input[name=ip-mode]").on("change", () => { ipTouched = true; _applyIpMode(); });
  $(".ip-field").on("input", () => { ipTouched = true; });
}

/* Home network status, also followed while the farm is connecting */
let homeInfo = null;        // "home" object from the controller
let ipTouched = false;      // the user changed the IP settings
let homeTimer = null;

function _ipModeManual() { return $("#ip-mode-manual").is(":checked"); }

function _applyIpMode() {
  const manual = _ipModeManual();
  $(".ip-field").prop("disabled", !manual);
  $("#ip-mode-hint").text(t(manual ? "set.ip_manual_hint" : "set.ip_auto_hint"));
  if (manual && homeInfo) {
    // start from the saved manual values, else from what is in use now
    const m = homeInfo.manual || {};
    const put = (id, a, b) => { if (!$(id).val()) $(id).val(a || b || ""); };
    put("#ip-addr", m.ip, homeInfo.ip);
    put("#ip-mask", m.mask, homeInfo.mask);
    put("#ip-gw", m.gw, homeInfo.gw);
    put("#ip-dns1", m.dns1, homeInfo.dns1);
    put("#ip-dns2", m.dns2, homeInfo.dns2 !== "0.0.0.0" ? homeInfo.dns2 : "");
  }
}

function _showHome(h) {
  homeInfo = h || null;
  const box = $("#home-status");
  if (h && h.apIp) {
    $("#ap-address").text(h.apIp);
    $("#ap-moved-note").toggle(!!h.apMoved);
    $("#ap-address-line").show();
  }
  if (!h || h.state === "off") { box.hide(); _followHome(false); return; }

  // Texts are escaped first; the network name goes in as bold HTML
  const net = `<strong>${_esc(h.ssid || t("set.home_network"))}</strong>`;
  const th = (key, p) => {
    // t() with HTML values: escape the text, then put the values in
    let s = _esc(t(key));
    Object.keys(p || {}).forEach(k => { s = s.split("{" + k + "}").join(p[k]); });
    return s;
  };
  let html = "";
  if (h.state === "connected" && h.ip) {
    const url = "http://" + h.ip + "/";
    html = th("set.st_connected", { ssid: net }) + "<br>" + th("set.st_farm_at_home") + " " +
           `<a href="${url}" target="_blank" rel="noopener" class="font-weight-bold" id="home-link">${_esc(url)}</a>` +
           `<span class="text-muted d-block mt-1">` + th("set.st_open_from", { ssid: _esc(h.ssid || t("set.home_network")) }) +
           (h.hostname ? " · " + th("set.st_router_name", { name: _esc(h.hostname) }) : "") + `</span>`;
    if (h.kind === "dhcp") html += `<span class="d-block mt-1">` + th("set.st_router_address") + `</span>`;
  } else if (h.state === "retry") {
    const min = h.retryIn ? Math.max(1, Math.round(h.retryIn / 60)) : 0;
    html = th("set.st_not_connected", { ssid: net }) + (min ? " " + th("set.st_next_try", { min: min }) : "");
  } else {
    html = `<span class="spinner-border spinner-border-sm mr-1" role="status"></span>` +
           th("set.st_connecting", { ssid: net });
  }
  if (h.note) html += `<span class="d-block mt-1 text-warning-dark">${_esc(h.note)}</span>`;
  box.html(html).show();

  // IP settings reflect the controller unless the user is editing them
  if (!ipTouched) {
    const manual = h.mode === "manual";
    $("#ip-mode-manual").prop("checked", manual);
    $("#ip-mode-auto").prop("checked", !manual);
    const src = manual ? (h.manual || {}) : h;
    $("#ip-addr").val(src.ip || "");
    $("#ip-mask").val(src.mask || "");
    $("#ip-gw").val(src.gw || "");
    $("#ip-dns1").val(src.dns1 || "");
    $("#ip-dns2").val(src.dns2 && src.dns2 !== "0.0.0.0" ? src.dns2 : "");
    _applyIpMode();
  }
  const ip = h.ip || "";
  $("#ip-reserve-hint").text(ip && h.hostname
    ? t("set.st_reserve", { ip: ip, name: h.hostname }) : "")
    .toggle(!!(ip && h.hostname));

  _followHome(["connecting", "checking", "switching"].includes(h.state));
}

// Ask again every 3 s while the farm is joining the network
function _followHome(on) {
  if (!on) { clearTimeout(homeTimer); homeTimer = null; return; }
  if (homeTimer) return;
  homeTimer = setTimeout(() => {
    homeTimer = null;
    if (!$("#settings").is(":visible")) return;
    $.getJSON("/wifi/status").done(d => _showHome(d.home)).fail(() => _followHome(true));
  }, 3000);
}

/* run (called every time page becomes active) */
function runSettingsWorkflow() {
  _settingsStatus("", "");       // clear previous message
  loadSettingsData();
}

/* load current values from firmware */
function loadSettingsData() {
  if (OFFLINE_MODE) {
    /* fill demo values so UI is usable offline */
    document.getElementById("ap-ssid").value  = "MiniFarm-DEMO";
    document.getElementById("sta-ssid").value = "";
    _showStaSaved(false, false);
    return;
  }

  $.getJSON("/api/settings")
    .done(d => {
      document.getElementById("ap-ssid").value = d.ap_ssid || "";
      /* passwords are never returned - leave blank */
      document.getElementById("sta-ssid").value = d.sta_ssid || "";
      _showStaSaved(!!d.sta_saved, !!d.sta_connected);
      ipTouched = false;
      _showHome(d.home);
    })
    .fail(() => _settingsStatus("set.load_failed", "danger"));
}

/* wifi scan */
function runWifiScan() {
  const btn = document.getElementById("wifi-scan-btn");
  btn.disabled = true;
  btn.textContent = "…";
  document.getElementById("wifi-scan-results").style.display = "none";

  $.getJSON("/wifi/scan")
    .done(d => {
      const list = document.getElementById("wifi-scan-list");
      list.innerHTML = "";

      const nets = (d.networks || []).sort((a, b) => b.rssi - a.rssi);
      if (!nets.length) {
        list.innerHTML = '<span class="list-group-item text-muted">' + _esc(t("set.no_networks")) + '</span>';
      } else {
        nets.forEach(n => {
          const item = document.createElement("a");
          item.href = "#";
          item.className = "list-group-item list-group-item-action d-flex justify-content-between";
          const bars = _rssiBars(n.rssi);
          const lock = n.security !== "none" ? " 🔒" : "";
          item.innerHTML =
            `<span>${_esc(n.ssid)}${lock}</span>` +
            `<span class="text-muted small">${bars} ${n.rssi} dBm</span>`;
          item.addEventListener("click", e => {
            e.preventDefault();
            document.getElementById("sta-ssid").value = n.ssid;
            document.getElementById("wifi-scan-results").style.display = "none";
            document.getElementById("sta-pass").focus();
          });
          list.appendChild(item);
        });
      }
      document.getElementById("wifi-scan-results").style.display = "";
    })
    .fail(() => _settingsStatus("set.scan_failed", "danger"))
    .always(() => {
      btn.disabled = false;
      btn.textContent = t("set.scan");
    });
}

/* disconnect STA */
function staDisconnect() {
  if (!confirm(t("set.disconnect_q"))) return;

  $.ajax({ url: "/wifi/disconnect", type: "POST",
           contentType: "application/json", data: "{}" })
    .done(() => {
      document.getElementById("sta-ssid").value = "";
      document.getElementById("sta-pass").value = "";
      _showStaSaved(false, false);
      _settingsStatus("set.disconnected", "info");
    })
    .fail(() => _settingsStatus("set.disconnect_failed", "danger"));
}

/* save & restart */
function saveSettings() {
  const apSsid  = document.getElementById("ap-ssid").value.trim();
  const apPass  = document.getElementById("ap-pass").value;
  const staSsid = document.getElementById("sta-ssid").value.trim();
  const staPass = document.getElementById("sta-pass").value;

  /* basic validation */
  if (apSsid.length < 1) {
    return _settingsStatus("set.err_ap_name", "warning");
  }
  if (apPass.length > 0 && apPass.length < 8) {
    return _settingsStatus("set.err_ap_pass", "warning");
  }

  const payload = {};
  if (apSsid) payload.ap_ssid = apSsid;
  if (apPass) payload.ap_pass = apPass;
  if (staSsid) payload.sta_ssid = staSsid;
  if (staPass) payload.sta_pass = staPass;

  /* IP settings: sent when changed (the controller checks them too) */
  if (ipTouched) {
    if (_ipModeManual()) {
      const v = id => $(id).val().trim();
      const ipRe = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ok = s => ipRe.test(s) && s.split(".").every(n => +n <= 255);
      const fields = [["#ip-addr", "set.address"], ["#ip-mask", "set.mask"], ["#ip-gw", "set.gateway"]];
      for (const [id, key] of fields) {
        if (!ok(v(id))) { $("#ip-settings").collapse("show"); $(id).trigger("focus");
          return _settingsStatus("set.err_ip", "warning", { field: t(key), example: $(id).attr("placeholder") }); }
      }
      for (const [id, key] of [["#ip-dns1", "set.dns1"], ["#ip-dns2", "set.dns2"]]) {
        if (v(id) && !ok(v(id))) { $("#ip-settings").collapse("show"); $(id).trigger("focus");
          return _settingsStatus("set.err_ip_optional", "warning", { field: t(key) }); }
      }
      payload.ip = { mode: "manual", ip: v("#ip-addr"), mask: v("#ip-mask"), gw: v("#ip-gw"),
                     dns1: v("#ip-dns1"), dns2: v("#ip-dns2") };
    } else {
      payload.ip = { mode: "auto" };
    }
  }

  const btn = document.getElementById("settings-save-btn");
  btn.disabled = true;
  btn.textContent = t("set.saving");
  _settingsStatus("", "");

  if (OFFLINE_MODE) {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = t("set.save_restart");
      _settingsStatus("set.offline_not_sent", "warning");
    }, 600);
    return;
  }

  $.ajax({
    url: "/api/settings",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload)
  })
  .done(resp => {
    if (resp && resp.restart) {
      _settingsStatus("set.saved_restart", "success");
      btn.textContent = t("set.restarting");
    } else {
      _settingsStatus("set.saved", "success");
      btn.disabled = false;
      btn.textContent = t("set.save_restart");
    }
  })
  .fail(xhr => {
    // The controller's own error text is shown as it comes
    const err = xhr.responseJSON && xhr.responseJSON.error;
    if (err) _settingsStatusText(err, "danger"); else _settingsStatus("set.save_failed", "danger");
    btn.disabled = false;
    btn.textContent = t("set.save_restart");
  });
}

/* private helpers */
function _togglePass(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (inp.type === "password") {
    inp.type = "text";
    btn.textContent = "🙈";
  } else {
    inp.type = "password";
    btn.textContent = "👁";
  }
}

let staBadge = { saved: false, connected: false };   // redrawn on language change

function _showStaSaved(saved, connected) {
  staBadge = { saved: saved, connected: connected };
  const badge = document.getElementById("sta-saved-badge");
  const disconnRow = document.getElementById("sta-disconnect-row");
  if (saved) {
    badge.style.removeProperty("display");
    badge.textContent = t(connected ? "set.badge_connected" : "set.badge_saved");
    badge.className = connected ? "badge badge-success" : "badge badge-secondary";
    disconnRow.style.display = "";
  } else {
    badge.style.setProperty("display", "none", "important");
    disconnRow.style.display = "none";
  }
}

// Status line: a text key (+ placeholder values), redrawn on language
// change; "" hides it
let settingsStatus = null;
function _settingsStatus(key, type, params) {
  settingsStatus = key ? { key: key, type: type, params: params } : null;
  _showSettingsStatus(key ? t(key, params) : "", type);
}
// A text that is not in local.json (an error from the controller)
function _settingsStatusText(msg, type) {
  settingsStatus = null;
  _showSettingsStatus(msg, type);
}
function _showSettingsStatus(msg, type) {
  const el = document.getElementById("settings-status");
  if (!msg) { el.style.display = "none"; return; }
  el.className = "alert alert-" + type;
  el.textContent = msg;
  el.style.display = "";
}

// Language changed: redraw what this screen built in JS
onLanguageChange(() => {
  if (!initialized.settings) return;
  _applyIpMode();
  if (homeInfo) _showHome(homeInfo);
  _showStaSaved(staBadge.saved, staBadge.connected);
  if (settingsStatus) _showSettingsStatus(t(settingsStatus.key, settingsStatus.params), settingsStatus.type);
});

function _rssiBars(rssi) {
  if (rssi >= -55) return "▂▄▆█";
  if (rssi >= -65) return "▂▄▆_";
  if (rssi >= -75) return "▂▄__";
  return "▂___";
}

function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
/* ============================================================
FOOTER SECTION
 ============================================================ */


document.getElementById("footer-prev").addEventListener("click", e => {
  e.preventDefault();
  e.stopImmediatePropagation();   // ← FIX
  const idx = pageOrder.indexOf(currentPage);
  if (idx > 0) showPage(pageOrder[idx - 1]);
});

document.getElementById("footer-next").addEventListener("click", e => {
  e.preventDefault();
  e.stopImmediatePropagation();   // ← FIX
  const idx = pageOrder.indexOf(currentPage);
  if (idx < pageOrder.length - 1) showPage(pageOrder[idx + 1]);
});

/* ============================================================
   SESSION WATCH
   - Keeps the control session alive while the user is actually using the
     page (a heartbeat is sent only if there was a tap or key press since
     the last check), so an idle user times out after about 1 minute.
     A Playground pause then ends on the controller.
   - Detects that the session was lost (timed out, taken by another user)
     and stops the page instead of letting it send commands.
   - Checks immediately when the page becomes visible again, because a
     sleeping phone pauses all timers.
   Depends on: OFFLINE_MODE, appReady, currentPage (app.js),
               exitGuardLeaving (exitguard.js).
   ============================================================ */

const SESSION_CHECK_MS  = 15000;  // how often the page checks its session

let sessionLost = false;
let userActedSinceCheck = false;  // a tap or key press since the last check

['pointerdown', 'keydown'].forEach(type =>
  document.addEventListener(type, () => { userActedSinceCheck = true; }, true));

function showSessionLost() {
  if (sessionLost || OFFLINE_MODE) return;
  sessionLost = true;
  appReady = false;                  // block navigation and commands
  currentPage = 'lost';              // stops the dashboard polling loop
  exitGuardLeaving = true;           // no "leave site?" prompts from now on
  $('.modal.show').modal('hide');
  const $box = $('<div class="exit-done"><h5></h5><p></p><a class="btn btn-primary" href="/"></a></div>');
  $box.find('h5').text(t('sess.ended'));
  $box.find('p').text(t('sess.ended_text'));
  $box.find('a').text(t('sess.reconnect'));
  $('body').append($box);
}

// The controller says this page no longer owns the session. If it ended by
// the idle timeout, or another phone holds it now, show "Session ended".
// If nobody took it (the controller freed it because this page went quiet,
// e.g. the phone slept), quietly reload: loading the panel claims it again.
let sessionRecheck = false;
function sessionGone() {
  if (sessionLost || sessionRecheck || OFFLINE_MODE) return;
  sessionRecheck = true;
  $.ajax({ url: '/api/session', dataType: 'json', timeout: 5000 })
    .done(d => {
      if (d && !d.busy && !d.expired) {
        exitGuardLeaving = true;       // no "leave site?" prompt for this reload
        location.reload();
      } else {
        showSessionLost();
      }
    })
    .fail(showSessionLost)
    .always(() => { sessionRecheck = false; });
}

// Any request rejected by the controller as "not your session"
$(document).ajaxError((event, xhr, settings) => {
  if (xhr.status === 403 && settings.url !== '/api/session') sessionGone();
});

// Session check. An active user sends a heartbeat (POST keeps the session
// alive), an idle user only asks (GET does not extend the session).
// It also runs while the page is hidden: the controller frees the session
// when the owner page is silent for 35 s (window closed without Leave), and
// this check is what tells it a background page is still there.
function checkSession() {
  if (sessionLost || OFFLINE_MODE || !appReady) return;

  const active = userActedSinceCheck;
  userActedSinceCheck = false;
  const request = active
    ? $.ajax({ url: '/api/ping', type: 'POST', dataType: 'json', timeout: 5000 })
    : $.ajax({ url: '/api/session', dataType: 'json', timeout: 5000 });

  request.done(d => {
    if (d && d.owner === false) sessionGone();
  });
  // Network errors (phone still reconnecting to Wi-Fi) are ignored:
  // the next check or a rejected command will tell.
}

setInterval(checkSession, SESSION_CHECK_MS);

// A sleeping phone pauses all timers. Check at once when the page comes back
// (screen unlocked, tab switched back, restored from history, Wi-Fi back),
// instead of showing stale data until the next scheduled check.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkSession();
});
window.addEventListener('pageshow', checkSession);
window.addEventListener('online', checkSession);
/* ============================================================
   EXIT GUARD
   Keeps a back gesture / back button inside the app:
     - closes an open dialog first,
     - otherwise steps back one screen (Settings -> Playground -> ...),
     - on Dashboard asks for confirmation before leaving.
   Also blocks pull-to-refresh and reload/close without confirmation
   (browsers show their own wording for the latter).
   Depends on: showPage, current, currentPage, pageOrder, appReady (app.js).
   ============================================================ */

// How the guard works
// The app adds one extra history entry (same URL) above its own entry. Back
// then only removes that entry and fires 'popstate', which the app turns into
// "close dialog / previous screen / ask before leaving".
//
// Chrome skips history entries a page adds without a fresh user gesture, and
// it wants a new gesture for every entry. So the entry is added only during a
// tap, swipe or key press, one per gesture. After Back has used it, the next
// touch adds it again.

let exitGuardArmed = false;   // a guard entry is above the app's own entry
let exitGuardLeaving = false; // user confirmed leaving: stop intercepting

// The page is being touched/typed in right now (Chrome: transient activation)
function userIsInteracting() {
  return navigator.userActivation ? navigator.userActivation.isActive : true;
}

// Number of guard entries at and below the current one (0 or 1)
function guardDepth() {
  const st = history.state;
  return (st && st.spaGuard) ? 1 : 0;
}

function armExitGuard() {
  if (exitGuardArmed || exitGuardLeaving || !userIsInteracting()) return;
  history.pushState({ spaGuard: true }, '');
  exitGuardArmed = true;
}

// Every finished tap, swipe or key press re-arms the guard if Back used it.
// These events fire after the gesture ends, so this never interferes with
// focusing a text field or opening the on-screen keyboard.
const EXIT_GUARD_ARM_EVENTS = ['click', 'keyup', 'touchend', 'pointerup'];

function armExitGuardOnInteraction() {
  EXIT_GUARD_ARM_EVENTS.forEach(type =>
    document.addEventListener(type, armExitGuard, { capture: true, passive: true }));
}

window.addEventListener('popstate', () => {
  if (exitGuardLeaving) return;
  exitGuardArmed = guardDepth() > 0;   // Back has just used the guard entry

  // 1. An open dialog: Back closes it
  const $openModal = $('.modal.show');
  if ($openModal.length) {
    $openModal.modal('hide');          // on the exit dialog this means "Stay"
    return;
  }

  // 2. Not on the first screen: Back goes one screen back
  if (appReady && current > 0) {
    showPage(pageOrder[current - 1]);
    return;
  }

  // 3. On Dashboard: ask before leaving
  showExitDialog();
});

function showExitDialog() {
  $('#exitModal').modal({ backdrop: 'static', keyboard: true });
  $('#exitModal').modal('show');
}

function leaveApp() {
  exitGuardLeaving = true;
  appReady = false;             // block navigation
  currentPage = 'exit';         // stops the dashboard polling loop
  $('#exitModal').modal('hide');

  // Release the control session FIRST and wait for the controller's answer.
  // A request fired while the page is already navigating away can be dropped,
  // and then the next visit sees "busy" until the 5-minute timeout.
  if (OFFLINE_MODE) {
    finishLeaving();
    return;
  }
  $.ajax({ url: '/api/release', type: 'POST', timeout: 2000 })
    .always(finishLeaving);
}

function finishLeaving() {
  // Leave to the previous site if there is one; a captive-portal window or a
  // directly opened tab has nowhere to go back to, so show a final message.
  // Skip all guard entries and the app's own entry in one step.
  history.go(-(guardDepth() + 1));
  setTimeout(() => {
    const $box = $('<div class="exit-done"><h5></h5><p></p><a class="btn btn-primary" href="/"></a></div>');
    $box.find('h5').text(t('exit.closed'));
    $box.find('p').text(t('exit.closed_text'));
    $box.find('a').text(t('exit.open_again'));
    $('body').append($box);
  }, 400);
}

// The page is going away without the Leave button (Back before any tap,
// the captive-portal window closed, the tab closed). Release the control
// session anyway, or the next visit shows "busy" until the 5-minute timeout.
// sendBeacon is the one request browsers still deliver while unloading.
window.addEventListener('pagehide', () => {
  if (exitGuardLeaving || OFFLINE_MODE || !navigator.sendBeacon) return;
  navigator.sendBeacon('/api/release');
});

// Pull-to-refresh: some browsers (e.g. Mi Browser) ignore the CSS rule
// "overscroll-behavior: none" and reload the page when it is pulled down at
// the top. Cancel exactly that gesture: a mostly downward drag while the page
// (and any scroll box under the finger) is already at its top.
let ptrStartX = 0, ptrStartY = 0;
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  ptrStartX = e.touches[0].clientX;
  ptrStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (e.touches.length !== 1 || !e.cancelable) return;
  const dx = e.touches[0].clientX - ptrStartX;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) return;   // up, or sideways swipe
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  // A scroll box under the finger that can still scroll up handles the drag
  for (let el = e.target; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return;
  }
  const page = document.scrollingElement || document.documentElement;
  if (page.scrollTop <= 0) e.preventDefault();
}, { passive: false });

// Reload, closing the tab or typing another address
window.addEventListener('beforeunload', e => {
  if (exitGuardLeaving || !appReady) return;
  e.preventDefault();
  e.returnValue = '';                  // required by Chrome to show the prompt
});

document.addEventListener('DOMContentLoaded', () => {
  armExitGuardOnInteraction();

  $('#exit-stay-btn').on('click', () => {
    $('#exitModal').modal('hide');
  });
  $('#exit-leave-btn').on('click', leaveApp);

  // Whenever the exit dialog closes without leaving, put the guard back
  $('#exitModal').on('hidden.bs.modal', () => {
    if (!exitGuardLeaving) armExitGuard();
  });
  $('#exitModal').on('shown.bs.modal', disableSwipe);
  $('#exitModal').on('hidden.bs.modal', enableSwipe);
});
