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
detectOfflineMode().then(isOffline => {
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

  if (OFFLINE_MODE) {
    taskStatus = "running";
    taskStartTime = localStart;  // use browser time in offline mode
    taskIndex = Number($("#taskSelect").val()) || 1000;
    updateTaskUI(taskStatus);
    return;
  }

  $.ajax({
    url: "/preset/start",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      id: Number($("#taskSelect").val()),
      startTime: localStart   // sent to sync device RTC
    }),
    success: resp => {
      taskStatus = resp.status || "running";
      taskStartTime = resp.startTime || localStart;  // prefer device time, fallback to local
      taskIndex = Number($("#taskSelect").val());
      renderDashboard(resp);
      updateTaskUI(taskStatus);  // now shows "Running since: <device time>"
	  updateScheduleHeader();
    },
    error: xhr => console.warn("/preset/start failed:", xhr.status)
  });
}

function requestTaskPause() {
  if (OFFLINE_MODE) {
    taskStatus = "paused";
    updateTaskUI(taskStatus);
    return;
  }

  taskApiRequest("/preset/pause", resp => {
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
let sliderActive = false;

function disableSwipe() { swipeEnabled = false; }
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
  // Scheduler pause/resume logic
  if (previous !== "playground" && name === "playground") {
  if (taskStatus === "running") requestTaskPause();
  }
  else if (previous === "playground" && name !== "playground") {
  if (taskStatus === "paused") requestTaskResume();
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
  $("#taskSelectLabel").text(attempt > 1 ? `Loading task list (try ${attempt})...` : "Loading task list...");
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

    // Status + start time ("frozen" is shown like "paused")
    const status = raw.current?.status || "stopped";
    taskStatus = (status === "frozen") ? "paused" : status;
    taskStartTime = raw.current?.startTime || null;

    // The controller's selected preset (running or not, kept in its RTC
    // memory); the template if that preset does not exist
    const selected = raw.current ? raw.current.presetId : 0;
    taskIndex = tasks.some(t => t.index === selected) ? selected : 0;

      
    // Populate dropdown
    const select = $("#taskSelect");
    select.empty();
    tasks.forEach(t => {
      select.append($('<option>').val(t.index).text(t.name));   // name as plain text
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
    $("#taskSelectLabel")
      .html(`Task list unavailable (${why}). <a href="#" id="taskListRetry">Retry</a>`);
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
  $("#taskStart").off().on("click", requestTaskStart);
  $("#taskPause").off().on("click", requestTaskPause);
  $("#taskStop").off().on("click", requestTaskStop);
  updateTaskUI(taskStatus);
}

function updateTaskUI(status) {

  const task = taskList.find(t => t.index === taskIndex);
  const name = task ? task.name : "Unknown";

  // Always show task name
  $("#taskSelectLabel").text("Task: " + name);

  // NEW: status line
  if (status === "running") {
    $("#taskStatusLabel").text("Running since: " + taskStartTime);
  }
  else if (status === "paused") {
    $("#taskStatusLabel").text("Paused at: " + taskStartTime);
  }
  else {
    $("#taskStatusLabel").text(""); // hide when not running/paused
  }

  // Existing logic...
  if (status === "not started" || status === "stopped") {

    $("#taskSelect").removeClass("d-none").prop("disabled", false);

    $("#taskSelectLabel").removeClass("d-none");

    $("#taskStart").prop("disabled", false);
    $("#taskPause").prop("disabled", true);
    $("#taskStop").prop("disabled", true);

    return;
  }

  if (status === "running" || status === "paused") {

    $("#taskSelect").addClass("d-none");

    if (status === "running") {
      $("#taskStart").prop("disabled", true);
      $("#taskPause").prop("disabled", false);
      $("#taskStop").prop("disabled", false);
    }

    if (status === "paused") {
      $("#taskStart").prop("disabled", false);
      $("#taskPause").prop("disabled", true);
      $("#taskStop").prop("disabled", false);
    }
  }
}


// Build output cards dynamically based on merged outputsConfig
function buildDashboard() {
  const container = document.getElementById("outputs-dashboard");
  container.innerHTML = "";

  outputsConfig.forEach(o => {
    const invertStyle = o.invert ? "filter: invert(100%);" : "";

    container.insertAdjacentHTML("beforeend", `
      <div class="channel-row d-flex justify-content-between align-items-center mb-3" data-id="${o.id}">
        
        <div class="d-flex align-items-center">
          <div class="pic" style="${o.style || ''}">
            <img src="${o.icon || '/sun.svg'}" style="${invertStyle}" width="28" height="28">
          </div>
          <div><strong>${o.label}</strong></div>
        </div>

        <div class="text-right">
          <div class="value-big" id="out_${o.id}_value">--%</div>
          <div class="countdown">Next: <span id="out_${o.id}_count">--:--</span></div>
        </div>

      </div>
    `);
  });
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
    })
    .fail(() => {
      console.warn("Failed to fetch /api/state");
    });

}


// Render RTC + sensors only
function renderDashboard(s) {
  $("#rtc").text("Time: " + (s.rtc || "--"));

  $("#w_temp").text(s.w_temp ?? "--");
  $("#w_temp_bar").css("width", (s.w_temp ?? 0) + "%");

  $("#a_temp").text(s.a_temp ?? "--");
  $("#a_temp_bar").css("width", (s.a_temp ?? 0) + "%");

  $("#a_hum").text(s.a_hum ?? "--");
  $("#a_hum_bar").css("width", (s.a_hum ?? 0) + "%");

  $("#level").text(s.Level ?? "--");

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

  const groups = {};
  const ordered = [];

  list.forEach(item => {
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

  ordered.forEach(entry => {
    createTreeNode(groups[entry.groupId]);
  });
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
  const repeat = events[0].repeat;
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
        <button class="tree-edit-btn" title="Edit">✏</button>
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

function createTreeNode(events) {
  const $node = buildTreeNode(events);
  if ($node) $('#schedule-tree').append($node);
  return $node;
}

function leafDutyText(ev) {
  const duty = parseInt(ev.duty) || 0;
  return duty === 0 ? 'OFF' : duty === 100 ? 'ON' : `${duty}%`;
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
  const t = ev.time;
  if (!t || t === '--:--') return 0;
  return timeToSeconds(t);
}

function createLeaf(ev, groupId) {
  const cfg = outputsConfig.find(c => c.id == ev.channelId);
  const label = cfg ? cfg.label : `Ch${ev.channelId}`;
  const enabled = ev.enabled !== false;

  const $leaf = $(`
  <div class="tree-leaf">
    <input type="checkbox" class="tree-check leaf-check" ${enabled ? 'checked' : ''}>
    <span class="tree-leaf-time${ev.repeat === 'custom' ? ' tree-leaf-cycle' : ''}" title="${ev.repeat === 'custom' ? 'on : off' : ''}">${leafTimeText(ev)}</span>
    <span class="tree-leaf-label">${label}</span>
    <span class="tree-leaf-duty">${leafDutyText(ev)}</span>
    <div class="tree-actions">
      <button class="tree-edit-btn" title="Edit">✏</button>
      <button class="tree-remove-btn" title="Remove">×</button>
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
    .filter(ev => {
      if (seenNames.has(ev.channelId)) return false;
      seenNames.add(ev.channelId);
      return true;
    })
    .map(ev => {
      const cfg = outputsConfig.find(c => c.id == ev.channelId);
      return cfg ? cfg.label : `Ch${ev.channelId}`;
    }).join(', ');

  // The user's name for the group if there is one, otherwise the channels
  const nodeLabel = groupNameOf(events) || channelList;

  const repeat = events[0].repeat;
  const afterDays = events[0].afterDays || 0;
  const expireAfterDays = events[0].expireAfterDays || 0;

  let nodeTime = events[0].time || '--:--';
  if (repeat === 'daily') {
    const offEv =
      events.find(ev => ev.channelId == events[0].channelId && ev.time !== nodeTime) ||
      events.find(ev => ev.time !== nodeTime);
    if (offEv) nodeTime = `${nodeTime}→${offEv.time}`;
  }
  // Shown in the group line: delay "+2d" and duration "10d", only if set
  const days = [];
  if (afterDays > 0) days.push(`+${afterDays}d`);
  if (expireAfterDays > 0) days.push(`${expireAfterDays}d`);
  const nodeDays = days.join(' : ');

  // Everything else goes into the tooltip; the leaves show the details
  const when = (repeat === 'custom') ? `${leafTimeText(events[0])} cycle` : nodeTime;
  const nodeInfo = `${when} · ${formatRepeat(repeat)} · ${channelList}`;
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
  const task = taskList.find(t => t.index === taskIndex);
  const name = task ? task.name : "--";
  $("#schedule-task-name").text(taskIndex === 0 ? name + " (template)" : name);
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
    sel.append(`<option value="${opt.id}">${opt.id}: ${opt.label}</option>`);
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
      $('#edit-duty-toggle-label').text($('#edit-duty-toggle').is(':checked') ? 'On' : 'Off');
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
    $('#edit-duty-toggle-label').text('Off');

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
    $('#edit-duty-toggle-label').text(this.checked ? 'On' : 'Off');
  });

  // Buttons
  $('#save-edit').on('click', saveScheduleItem);
  $('#add-btn').on('click', addNewScheduleItem);
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
    renderSchedule(taskContent);
    return;
  }

  // ONLINE MODE
  $.getJSON(`/preset/content?id=${taskIndex}`, showPresetSchedule);
}

// Show a preset from /preset/content in the tree.
// Plant presets (described by growth "phases") can be started from the
// dashboard but cannot be edited here.
function showPresetSchedule(data) {
  currentTaskName = data.name;
  taskContent = Array.isArray(data.schedule) ? data.schedule : [];
  renderSchedule(taskContent);
  if (!Array.isArray(data.schedule) && Array.isArray(data.phases)) {
    $('#schedule-tree').html(
      '<p class="text-muted m-2">This is a plant preset made of growth phases. ' +
      'It can be started from the Dashboard but not edited here.</p>');
  }
}

// ---------------------------------------------------------
// ADD NEW SCHEDULE ITEM
// ---------------------------------------------------------

// AFTER — entire new function:
function addNewScheduleItem() {
  openBatchModal(null, generateGroupId());
}


// ---------------------------------------------------------
// OPEN MODAL
// ---------------------------------------------------------

let currentBatchRow = null;
let currentBatchGroupId = 0;
let currentLeafGroupId = 0;
let editModalMode = null;

function openBatchModal($row, newGroupId) {
  currentBatchRow = $row || null;
  currentBatchGroupId = newGroupId || ($row ? $row.data('groupId') : generateGroupId());

  const isNew = !$row;
  const existingEvents = isNew ? [] : getNodeEvents($row);
  $('#batch-name').val(groupNameOf(existingEvents));
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
  batchMembers = new Set(existingEvents.map(ev => Number(ev.channelId)));
  buildBatchChannelList(existingEvents, repeat);

  // Bind repeat change
  $('#batch-repeat').off('change').on('change', function () {
    const newRepeat = $(this).val();
    $('#batch-time-on').val('');
    $('#batch-time-off').val('');
    updateBatchTimeFields(newRepeat);
    buildBatchChannelList(existingEvents, newRepeat);
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
    $('#batch-time-on-label').text('Time On');
    $('#batch-time-on-group').show();
    $('#batch-time-off-group').show();
    $('#batch-time-off-label').text('Time Off');
  } else if (repeat === 'custom') {
    $('#batch-time-on-label').text('On Duration');
    $('#batch-time-on-group').show();
    $('#batch-time-off-group').show();
    $('#batch-time-off-label').text('Off Duration');
  } else {
    // once
    $('#batch-time-on-label').text('Time');
    $('#batch-time-on-group').show();
    $('#batch-time-off-group').hide();
  }
}

// Channels of the group being edited (ids). Set when the dialog opens and
// kept when the repeat type changes; tiles move channels in and out.
let batchMembers = new Set();

function buildBatchChannelList(existingEvents, repeat) {
  const $list = $('#batch-channel-list');
  $list.empty();

  // Two areas of channel tiles, then the settings of the chosen channels
  $list.append(`
    <div class="ch-zone ch-zone-in" data-zone="in">
      <div class="ch-zone-title">In this group</div>
      <div class="ch-tiles"></div>
      <div class="ch-zone-empty">Drag channels here or tap them</div>
    </div>
    <div class="ch-zone ch-zone-out" data-zone="out">
      <div class="ch-zone-title">Available</div>
      <div class="ch-tiles"></div>
    </div>
    <div id="batch-channel-error" class="text-danger small mb-2" style="display:none;">
      Add at least one channel to the group.
    </div>
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

    let dutyInput = '';
    if (isNoRamp) {
      const checked = duty >= 50 ? 'checked' : '';
      dutyInput = `
        <div class="custom-control custom-switch">
          <input type="checkbox" class="custom-control-input batch-duty-toggle"
                 id="batch-toggle-${cfg.id}" data-channel="${cfg.id}" ${checked}>
          <label class="custom-control-label" for="batch-toggle-${cfg.id}">
            ${duty >= 50 ? 'On' : 'Off'}
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
        <div class="batch-channel-label">${escapeHtml(cfg.label)}</div>
        <div class="batch-channel-duty">${dutyInput}</div>
      </div>
    `);
  });

  // Toggle label sync
  $list.find('.batch-duty-toggle').on('change', function () {
    $(this).next('label').text(this.checked ? 'On' : 'Off');
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
        <span class="ch-tile-label">${escapeHtml(cfg.label)}</span>
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
    if ($num.length && !(parseInt($num.val()) > 0)) $num.val(100);
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

  // A group needs at least one channel
  if (batchMembers.size === 0) {
    $('#batch-channel-error').show();
    return;
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

    const base = {
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
    $('#schedule-tree').append($newNode);
  }
  currentBatchRow = null;
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
    $('#edit-duty-toggle-label').text(duty >= 50 ? 'On' : 'Off');
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
  const label = cfg ? cfg.label : `Ch${ev.channelId}`;
  $('#editModal .modal-title').text(`Edit: ${label}`);

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
  taskContent = [];

  $('#schedule-tree .tree-node').each(function () {
    getNodeEvents($(this)).forEach(ev => taskContent.push(ev));
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
      ? 'The template stays as it is. Enter a name for the new task.'
      : 'Save keeps this task (a new name renames it). Save as new creates a copy.'
  );
  $('#save-as-confirm').toggle(!isDefault);
  $('#save-as-new').toggleClass('btn-primary', isDefault).toggleClass('btn-outline-primary', !isDefault);

  // Returns the trimmed name, or null after showing why it cannot be used.
  // keepId: the task being overwritten may keep its own name.
  const checkName = keepId => {
    const name = $('#new-task-name').val().trim();
    let error = '';
    if (!name) {
      error = 'Please enter a task name.';
    } else if (name.toLowerCase() === 'default') {
      error = '"Default" is the name of the template. Please choose another name.';
    } else if (taskList.some(t => t.index !== keepId && t.index !== 0 &&
                                  String(t.name).toLowerCase() === name.toLowerCase())) {
      error = `A task named "${name}" already exists. Please choose another name.`;
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
      preset: { id: index, name: name, schedule: taskContent }
    }),
    success: resp => {
      console.log("Preset saved:", resp);
      currentTaskName = resp.name || name;

      // Same task saved again, possibly under a new name: rename it everywhere
      if (resp.id && resp.id === taskIndex) {
        const task = taskList.find(t => t.index === taskIndex);
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
      alert("Saving failed: " + ((xhr.responseJSON && xhr.responseJSON.error) || xhr.status));
    }
  });
}

// ---------------------------------------------------------
// DELETE PRESET
// ---------------------------------------------------------
function showDeleteDialog() {
  if (taskIndex === 0) return;   // the template cannot be deleted
  const running = (taskStatus === 'running' || taskStatus === 'paused');
  $('#delete-task-name').text(currentTaskName || '');
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
      taskList = taskList.filter(t => t.index !== id);
      $(`#taskSelect option[value="${id}"]`).remove();
      if (!taskList.some(t => t.index === 0)) {
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
      alert("Deleting failed: " + ((xhr.responseJSON && xhr.responseJSON.error) || xhr.status));
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
          <strong>${o.label}</strong>
          </div>

<div class="play-controls d-flex">
  <!-- same look as the Dashboard start/stop buttons -->
  <button class="btn btn-success btn-small play-btn play-on" data-id="${o.id}" data-action="on">
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 3.3v9.4L12 8 4 3.3z" />
    </svg>
  </button>

  <button class="btn btn-danger btn-small play-btn play-off" data-id="${o.id}" data-action="off">
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
                  <label>Rise Time (ms)</label>
                  <input type="number" class="form-control rise-input"
                         data-id="${o.id}" value="${o.riseDefault || 0}">
                </div>

                <div class="form-group">
                  <label>Fall Time (ms)</label>
                  <input type="number" class="form-control fall-input"
                         data-id="${o.id}" value="${o.fallDefault || 0}">
                </div>

                <div class="form-group">
                  <label>On Time (sec)</label>
                  <input type="number" class="form-control ontime-input"
                         data-id="${o.id}" value="0">
                </div>

                <div class="form-group">
                  <label>Off Time (sec)</label>
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


function bindPlaygroundEvents() {

// Collapse on label click
$(".play-header, .play-label").on("click", function (e) {
  if ($(e.target).closest(".play-control").length) return;
  if ($(e.target).closest(".play-slider").length) return;
if ($(e.target).closest(".play-btn").length) return;

  const target = $(this).data("target");
  if (target) $(target).collapse("toggle");
});

// ON / OFF buttons
$(".play-btn").on("click", function () {
  const id = $(this).data("id");
  const action = $(this).data("action");

  // Remove highlight from both buttons
  $(`.play-btn[data-id=${id}]`).removeClass("play-active");

  let duty = 0;

  if (action === "on") {
    const slider = $(`.play-slider[data-id=${id}]`);

    // ✔ If slider exists → use its value
    // ✔ If slider is hidden → send 100
    duty = slider.length ? parseInt(slider.val()) : 100;

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
$(".play-slider").on("input", function () {
  const id = $(this).data("id");
  const sliderVal = parseInt($(this).val()) || 0;

  // Send 0–100 directly
  const duty = sliderVal;

  // Cancel ramping highlight
  $(`.play-btn[data-id=${id}]`).each(function () {
    const t = $(this).data("timer");
    if (t) clearTimeout(t);
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
  $.ajax({
    url: "/playground/control",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({ id, duty, source }),
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
    })
    .fail(() => _settingsStatus("Could not load settings.", "danger"));
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
        list.innerHTML = '<span class="list-group-item text-muted">No networks found</span>';
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
    .fail(() => _settingsStatus("Scan failed.", "danger"))
    .always(() => {
      btn.disabled = false;
      btn.textContent = "Scan";
    });
}

/* disconnect STA */
function staDisconnect() {
  if (!confirm("Disconnect from home network?")) return;

  $.ajax({ url: "/wifi/disconnect", type: "POST",
           contentType: "application/json", data: "{}" })
    .done(() => {
      document.getElementById("sta-ssid").value = "";
      document.getElementById("sta-pass").value = "";
      _showStaSaved(false, false);
      _settingsStatus("Disconnected. Reconnect to the AP to continue.", "info");
    })
    .fail(() => _settingsStatus("Disconnect failed.", "danger"));
}

/* save & restart */
function saveSettings() {
  const apSsid  = document.getElementById("ap-ssid").value.trim();
  const apPass  = document.getElementById("ap-pass").value;
  const staSsid = document.getElementById("sta-ssid").value.trim();
  const staPass = document.getElementById("sta-pass").value;

  /* basic validation */
  if (apSsid.length < 1) {
    return _settingsStatus("AP network name cannot be empty.", "warning");
  }
  if (apPass.length > 0 && apPass.length < 8) {
    return _settingsStatus("AP password must be at least 8 characters.", "warning");
  }

  const payload = {};
  if (apSsid) payload.ap_ssid = apSsid;
  if (apPass) payload.ap_pass = apPass;
  if (staSsid) payload.sta_ssid = staSsid;
  if (staPass) payload.sta_pass = staPass;

  const btn = document.getElementById("settings-save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  _settingsStatus("", "");

  if (OFFLINE_MODE) {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Save & Restart";
      _settingsStatus("Offline mode — settings not sent.", "warning");
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
      _settingsStatus(
        "Saved! Device is restarting. Reconnect to the AP with the new credentials.",
        "success"
      );
      btn.textContent = "Restarting…";
    } else {
      _settingsStatus("Saved.", "success");
      btn.disabled = false;
      btn.textContent = "Save & Restart";
    }
  })
  .fail(xhr => {
    const msg = (xhr.responseJSON && xhr.responseJSON.error) || "Save failed.";
    _settingsStatus(msg, "danger");
    btn.disabled = false;
    btn.textContent = "Save & Restart";
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

function _showStaSaved(saved, connected) {
  const badge = document.getElementById("sta-saved-badge");
  const disconnRow = document.getElementById("sta-disconnect-row");
  if (saved) {
    badge.style.removeProperty("display");
    badge.textContent = connected ? "Connected" : "Saved";
    badge.className = connected ? "badge badge-success" : "badge badge-secondary";
    disconnRow.style.display = "";
  } else {
    badge.style.setProperty("display", "none", "important");
    disconnRow.style.display = "none";
  }
}

function _settingsStatus(msg, type) {
  const el = document.getElementById("settings-status");
  if (!msg) { el.style.display = "none"; return; }
  el.className = "alert alert-" + type;
  el.textContent = msg;
  el.style.display = "";
}

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
     page (a heartbeat is sent only after recent taps or key presses), so an
     idle user still times out after 5 minutes.
   - Detects that the session was lost (timed out, taken by another user)
     and stops the page instead of letting it send commands.
   - Checks immediately when the page becomes visible again, because a
     sleeping phone pauses all timers.
   Depends on: OFFLINE_MODE, appReady, currentPage (app.js),
               exitGuardLeaving (exitguard.js).
   ============================================================ */

const SESSION_CHECK_MS  = 15000;  // how often the page checks its session
const USER_ACTIVE_MS    = 60000;  // taps within this window count as activity

let sessionLost = false;
let lastUserActionMs = Date.now();

['pointerdown', 'keydown'].forEach(type =>
  document.addEventListener(type, () => { lastUserActionMs = Date.now(); }, true));

function showSessionLost() {
  if (sessionLost || OFFLINE_MODE) return;
  sessionLost = true;
  appReady = false;                  // block navigation and commands
  currentPage = 'lost';              // stops the dashboard polling loop
  exitGuardLeaving = true;           // no "leave site?" prompts from now on
  $('.modal.show').modal('hide');
  $('body').append(
    '<div class="exit-done">' +
    '<h5>Session ended</h5>' +
    '<p>Your control session has ended after a period of inactivity. ' +
    'Another user may be controlling the farm now.</p>' +
    '<a class="btn btn-primary" href="/">Reconnect</a>' +
    '</div>');
}

// The controller says this page no longer owns the session. If nobody else
// took it (the controller freed it because this page went quiet, e.g. the
// phone slept), quietly reload: loading the panel claims it again.
// Only when another phone holds it, show "Session ended".
let sessionRecheck = false;
function sessionGone() {
  if (sessionLost || sessionRecheck || OFFLINE_MODE) return;
  sessionRecheck = true;
  $.ajax({ url: '/api/session', dataType: 'json', timeout: 5000 })
    .done(d => {
      if (d && !d.busy) {
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
// when the owner page is silent for 90 s (window closed without Leave), and
// this check is what tells it a background page is still there.
function checkSession() {
  if (sessionLost || OFFLINE_MODE || !appReady) return;

  const active = Date.now() - lastUserActionMs < USER_ACTIVE_MS;
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
  EXIT_GUARD_ARM_EVENTS.forEach(t =>
    document.addEventListener(t, armExitGuard, { capture: true, passive: true }));
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
    $('body').append(
      '<div class="exit-done">' +
      '<h5>Session closed</h5>' +
      '<p>You can close this window now.</p>' +
      '<a class="btn btn-primary" href="/">Open control panel again</a>' +
      '</div>');
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
