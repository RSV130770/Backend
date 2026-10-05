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


function syncTime() {
  if (OFFLINE_MODE) return;

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
  const parts = hhmm.split(':');
  return (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60;
}

function secondsToHHMM(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  return `${h}:${m}`;
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
    url: "/task/start",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      index: Number($("#taskSelect").val()),
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
    error: xhr => console.warn("/task/start failed:", xhr.status)
  });
}

function requestTaskPause() {
  if (OFFLINE_MODE) {
    taskStatus = "paused";
    updateTaskUI(taskStatus);
    return;
  }

  taskApiRequest("/task/pause", resp => {
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

  taskApiRequest("/task/resume", resp => {
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

  taskApiRequest("/task/stop", resp => {
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
let swipeEnabled = true;
let sliderActive = false;

function disableSwipe() { swipeEnabled = false; }
function enableSwipe() { swipeEnabled = true; }

/* ============================================================
   PAGE SWITCHING
   ============================================================ */
function showPage(name) {
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
    });
  });
  
  const idx = pageOrder.indexOf(currentPage);

  /* FOOTER BUTTONS */
  const prevBtn = document.getElementById('footer-prev');
  const nextBtn = document.getElementById('footer-next');

  /* SWIPE */
  document.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  });

  document.addEventListener('touchend', e => {
    if (sliderActive) return;
    if (!swipeEnabled) return;

    // Prevent swipe from firing when tapping UI controls
    if (e.target.closest('button, a, input, select, textarea, .play-slider')) {
      return;
    }
    if (!appReady) return;
    const endX = e.changedTouches[0].clientX;

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
  $.getJSON(`/task/content?index=${index}`, data => {
    taskContent = data.schedule;
    renderSchedule(taskContent);
  });
}

//$("#taskSelect").on("change", () => {
//  taskIndex = Number($("#taskSelect").val());
//  loadTaskContent(taskIndex);
//});

$("#taskSelect").on("change", () => {
  const newIndex = Number($("#taskSelect").val());
  if (taskStatus === "running" || taskStatus === "paused") {
    $("#taskStatusLabel").text("Stopping current task...");
    requestTaskStop(() => {
      taskIndex = newIndex;
      loadTaskContent(taskIndex);
      updateScheduleHeader();  
    });
  } else {
    taskIndex = newIndex;
    loadTaskContent(taskIndex);
    updateScheduleHeader();
  }
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
  $.getJSON("/tasks", raw => {

    // Normalize backend → frontend
    const tasks = (raw.tasks || []).map(t => ({
      index: t.index,
      name: t.name
    }));
 
    taskList = tasks;
    const currentTask = tasks.find(t => t.name === raw.current?.name);

    // Use backend task index OR fallback to first task
    taskIndex = currentTask ? currentTask.index : tasks[0]?.index;



  // Status + start time
  taskStatus = raw.current?.status || "not started";
  taskStartTime = raw.current?.time || null;

      
    // Populate dropdown
    const select = $("#taskSelect");
    select.empty();
    tasks.forEach(t => {
      select.append(`<option value="${t.index}">${t.name}</option>`);
    });
    select.val(taskIndex);

    // Update UI
    updateTaskUI(taskStatus);
    loadTaskContent(taskIndex);
    initTaskControlUI();
	buildDashboard();
	fetchState();
    // Load schedule for selected task
  });
  console.log("Dashboard init");
}

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
function fetchState() {
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
  $.getJSON("/api/state")
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

function createTreeNode(events) {
  if (!events || events.length === 0) return;

  const groupId = events[0].groupId;
  const repeat = events[0].repeat;
  const collapseId = `tree-leaves-${groupId}`;

  // Build node header summary
  const { nodeLabel, nodeTime, nodeDuty } = buildNodeSummary(events);

  const allEnabled = events.every(ev => ev.enabled !== false);

  const $node = $(`
  <div class="tree-node" data-group-id="${groupId}">
    <div class="tree-node-header">
      <span class="tree-toggle">▶</span>
      <input type="checkbox" class="tree-check node-check"
             ${allEnabled ? 'checked' : ''}>
      <div class="tree-node-label">
        <span class="tree-node-time">${nodeTime}</span>
        <span class="text-muted mx-1">·</span>
        <span class="tree-node-channels">${nodeLabel}</span>
        <span class="text-muted mx-1">·</span>
        <span class="tree-node-repeat">${formatRepeat(repeat)}</span>
      </div>
      <div class="tree-actions">
        <button class="tree-edit-btn" title="Edit">✏</button>
      </div>
    </div>
    <div class="tree-leaves collapse" id="${collapseId}"></div>
  </div>
`);

  // Store events data
  $node.data('events', JSON.parse(JSON.stringify(events)));
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
    const $leaves = $(`#${collapseId}`);
    if ($leaves.hasClass('show')) {
      $leaves.collapse('hide');
      $toggle.text('▶');
    } else {
      $leaves.collapse('show');
      $toggle.text('▼');
    }
  });

  // Node checkbox — toggle all leaves
  $node.find('.node-check').on('change', function () {
    const checked = this.checked;
    $node.find('.leaf-check').prop('checked', checked);
    // Update stored events
    const evs = $node.data('events');
    evs.forEach(ev => ev.enabled = checked);
    $node.data('events', evs);
  });

  // Edit node → batch modal
  $node.find('.tree-edit-btn').on('click', e => {
    e.stopPropagation();
    openBatchModal($node);
  });

  $('#schedule-tree').append($node);
}

function createLeaf(ev, groupId) {
  const cfg = outputsConfig.find(c => c.id == ev.channelId);
  const label = cfg ? cfg.label : `Ch${ev.channelId}`;
  const duty = parseInt(ev.duty) || 0;
  const dutyText = duty === 0 ? 'OFF' : duty === 100 ? 'ON' : `${duty}%`;
  const enabled = ev.enabled !== false;

  const $node = $(`
  <div class="tree-node" data-group-id="${groupId}">
    <div class="tree-node-header">
      <span class="tree-toggle">▶</span>
      <input type="checkbox" class="tree-check node-check"
             ${allEnabled ? 'checked' : ''}>
      <div class="tree-node-label">
        <span class="tree-node-time">${nodeTime}</span>
        <span class="text-muted mx-1">·</span>
        <span class="tree-node-channels">${nodeLabel}</span>
        <span class="text-muted mx-1">·</span>
        <span class="tree-node-repeat">${formatRepeat(repeat)}</span>
      </div>
      <div class="tree-actions">
        <button class="tree-edit-btn" title="Edit">✏</button>
      </div>
    </div>
    <div class="tree-leaves collapse" id="${collapseId}"></div>
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

function updateNodeCheckbox(groupId) {
  const $node = $(`.tree-node[data-group-id="${groupId}"]`);
  const total = $node.find('.leaf-check').length;
  const checked = $node.find('.leaf-check:checked').length;
  $node.find('.node-check').prop({
    checked: checked === total,
    indeterminate: checked > 0 && checked < total
  });
}

function removeLeaf($leaf, groupId) {
  $leaf.remove();
  const $node = $(`.tree-node[data-group-id="${groupId}"]`);
  const remaining = $node.find('.tree-leaf').length;
  if (remaining === 0) {
    $node.remove();  // last leaf → remove whole node
  } else {
    refreshNodeSummary($node);
  }
}

function buildNodeSummary(events) {
  const seenNames = new Set();

  const nodeLabel = events
    .filter(ev => {
      if (seenNames.has(ev.channelId)) return false;
      seenNames.add(ev.channelId);
      return true;
    })
    .map(ev => {
      const cfg = outputsConfig.find(c => c.id == ev.channelId);
      return cfg ? cfg.label : `Ch${ev.channelId}`;
    }).join(', ');

  const repeat = events[0].repeat;
  const afterDays = events[0].afterDays || 0;
  const expireAfterDays = events[0].expireAfterDays || 0;

  let nodeTime = events[0].time || '--:--';
  if (repeat === 'daily') {
    const offEv = events.find(ev =>
      ev.channelId == events[0].channelId && ev.time !== nodeTime
    );
    if (offEv) nodeTime = `${nodeTime}→${offEv.time}`;
  }
  if (afterDays > 0) nodeTime += ` +${afterDays}d`;
  if (expireAfterDays > 0) nodeTime += ` /${expireAfterDays}d`;
  return { nodeLabel, nodeTime };
}

function refreshNodeSummary($node) {
  // Rebuild summary from current leaves
  const events = [];
  $node.find('.tree-leaf').each(function () {
    events.push($(this).data('event'));
  });
  if (events.length === 0) return;

  const { nodeLabel, nodeTime } = buildNodeSummary(events);
  $node.find('.tree-node-time').text(nodeTime);
  $node.find('.tree-node-channels').text(nodeLabel);
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
  $("#schedule-task-name").text(name);
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
  $.getJSON(`/task/content?index=${taskIndex}`, data => {
    currentTaskName = data.name;
    taskContent = Array.isArray(data.schedule) ? data.schedule : [];
    renderSchedule(taskContent);
  });
}

// ---------------------------------------------------------
// ADD NEW SCHEDULE ITEM
// ---------------------------------------------------------

// AFTER — entire new function:
function addNewScheduleItem() {
  openBatchModal(null, generateGroupId());
}


function createScheduleRow(data, openModal = false, groupId = 0) {

  const channel = Array.isArray(outputsConfig) ? outputsConfig.find(c => c.id == data.channelId) : null;
  const channelLabel = channel ? `${channel.id}: ${channel.label}` : `${data.channelId}: Output`;
  const effectiveGroupId = data.groupId || groupId || 0;
  const duty = parseInt(data.duty) || 0;
  const dutyText = duty === 0 ? 'OFF' : duty === 100 ? 'ON' : `${duty}%`;
  const collapseBtn = effectiveGroupId > 0
    ? `<button class="batch-collapse-btn mr-1" title="Collapse">⊟</button>`
    : '';

  const $row = $(`
    <tr>
      <td class="align-middle time s-t-time" data-time="${data.time}" data-after-days="${data.afterDays}">
        ${data.time}${data.afterDays > 0 ? ` (+${data.afterDays}d)` : ''}
      </td>
      <td class="align-middle channel s-t-cnl" data-id="${data.channelId}">
        ${channelLabel}
      </td>
      <td class="align-middle repeat s-t-how" data-repeat="${data.repeat}">
        ${formatRepeat(data.repeat)}
      </td>
      <td class="align-middle duty s-t-val"
          data-duty="${duty}"
          data-rise="${data.rise || 0}"
          data-fall="${data.fall || 0}"
          data-on="${data.on || 0}"
          data-off="${data.off || 0}"
          data-enabled="${data.enabled}">
        ${dutyText}
      </td>
      <td class="schedule-remove d-flex">
        <button class="row-edit-btn mr-1">✏</button>
        ${collapseBtn}
        <button class="remove-btn">×</button>
      </td>
    </tr>
  `);
  $row.data('groupId', effectiveGroupId);

  // Collapse button handler
  if (effectiveGroupId > 0) {
    $row.find('.batch-collapse-btn').on('click', e => {
      e.stopPropagation();
      collapseBatch(effectiveGroupId);
    });
  }

  // Edit button — existing modal
  $row.find('.row-edit-btn').on('click', e => {
    e.stopPropagation();
    openScheduleModal($row);
  });

  $row.find('.remove-btn').on('click', e => {
    e.stopPropagation();
    $row.remove();
  });

  $row.on('click', e => {
    if ($(e.target).closest('.remove-btn, .row-edit-btn, .batch-collapse-btn').length) return;
    openScheduleModal($row);
  });

  $('#schedule-list').append($row);

  if (openModal) $row.click();
}

// ---------------------------------------------------------
// OPEN MODAL
// ---------------------------------------------------------

let currentBatchRow = null;
let currentBatchGroupId = 0;

function openBatchModal($row, newGroupId) {
  currentBatchRow = $row || null;
  currentBatchGroupId = newGroupId || ($row ? $row.data('groupId') : generateGroupId());

  const isNew = !$row;
  const existingEvents = isNew ? [] : $row.data('events');
  const afterDays = existingEvents.length > 0 ? (existingEvents[0].afterDays || 0) : 0;
  const expireAfterDays = existingEvents.length > 0 ? (existingEvents[0].expireAfterDays || 0) : 0;
  $('#batch-after-days').val(afterDays);
  $('#batch-expire').val(expireAfterDays);
  // Determine repeat and times from existing events
  const repeat = existingEvents.length > 0 ? existingEvents[0].repeat : 'daily';
  const firstEvent = existingEvents[0];
  const timeOn = firstEvent ? firstEvent.time : '';
  const offEvent = existingEvents.find(ev =>
    ev.channelId == (firstEvent && firstEvent.channelId) && ev.time !== timeOn
  );
  const timeOff = offEvent ? offEvent.time : '';

  const onSec = existingEvents.length > 0 ? (existingEvents[0].on || 0) : 0;
  const offSec = existingEvents.length > 0 ? (existingEvents[0].off || 0) : 0;

  $('#batch-repeat').val(repeat);

  if (repeat === 'custom') {
    // Show durations as HH:MM
    $('#batch-time-on').val(secondsToHHMM(onSec));
    $('#batch-time-off').val(secondsToHHMM(offSec));
  } else if (repeat === 'daily') {
    $('#batch-time-on').val(timeOn);
    $('#batch-time-off').val(timeOff);
  } else {
    // once
    $('#batch-time-on').val(timeOn);
    $('#batch-time-off').val('');
  }

  updateBatchTimeFields(repeat);

  // Build channel list
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

function buildBatchChannelList(existingEvents, repeat) {
  const $list = $('#batch-channel-list');
  $list.empty();

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

    $list.append(`
      <div class="batch-channel-row">
        <div class="batch-channel-label">${cfg.label}</div>
        <div class="batch-channel-duty">${dutyInput}</div>
      </div>
    `);
  });

  // Toggle label sync
  $list.find('.batch-duty-toggle').on('change', function () {
    $(this).next('label').text(this.checked ? 'On' : 'Off');
  });
}

function saveBatchItem() {
  const repeat = $('#batch-repeat').val();
  const isDaily = repeat === 'daily';
  const isCustom = repeat === 'custom';

  // Time fields — meaning depends on repeat type
  const timeOn = $('#batch-time-on').val() || '--:--';
  const timeOff = $('#batch-time-off').val() || '--:--';

  // Custom: derive on/off seconds from HH:MM duration inputs
  const onTotal = isCustom ? timeToSeconds(timeOn) : 0;
  const offTotal = isCustom ? timeToSeconds(timeOff) : 0;

  // Preserve original event times for custom/once (time is not edited in batch)
  const existingEvents = currentBatchRow ? currentBatchRow.data('events') : [];

  // Build events array
  const events = [];

  outputsConfig.forEach(cfg => {
    // Read duty per channel mode
    const duty = (cfg.mode === 'no_ramp')
      ? ($(`#batch-toggle-${cfg.id}`).is(':checked') ? 100 : 0)
      : (parseInt($(`.batch-duty-input[data-channel="${cfg.id}"]`).val()) || 0);

    const base = {
      groupId: currentBatchGroupId,
      channelId: cfg.id,
      afterDays: parseInt($('#batch-after-days').val()) || 0,
      expireAfterDays: parseInt($('#batch-expire').val()) || 0,
      repeat: repeat,
      rise: cfg.riseDefault || 0,
      fall: cfg.fallDefault || 0,
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

  // Update or insert batch row at correct position
  const $list = $('#schedule-list');
  const $anchor = currentBatchRow ? currentBatchRow.prev() : null;

  if (currentBatchRow) currentBatchRow.remove();

  createBatchRow(events);

  // If editing existing — move new row to original position
  if ($anchor !== null) {
    const $built = $list.children('tr[data-type="batch"]').last().detach();
    if ($anchor.length) {
      $built.insertAfter($anchor);
    } else {
      $list.prepend($built);
    }
  }
  // If new batch — createBatchRow already appended to end, nothing to move
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

function openScheduleModal($row) {
  currentItem = $row;

  // Extract values from row
  const channelId = $row.find('.channel').data('id');
  const time = $row.find('.time').data('time');
  const afterDays = $row.find('.time').data('after-days');
  const repeatVal = String($row.find('.repeat').data('repeat') || "").toLowerCase();
  const duty = parseInt($row.find('.duty').data('duty')) || 0;
  const rise = parseInt($row.find('.duty').data('rise')) || 0;
  const fall = parseInt($row.find('.duty').data('fall')) || 0;
  const enabled = $row.find('.duty').data('enabled');
  const onTotal = parseInt($row.find('.duty').data('on')) || 0;
  const offTotal = parseInt($row.find('.duty').data('off')) || 0;

  // Populate fields BEFORE showing modal (safe — no collapse involved)

  // Channel — suppress change handler during programmatic set
  suppressChannelChange = true;
  $('#edit-channel').val(channelId);
  suppressChannelChange = false;

  // Duty
  $('#edit-duty').val(duty);
  if ($('#edit-duty-toggle').length) {
    $('#edit-duty-toggle').prop('checked', duty >= 50);
    $('#edit-duty-toggle-label').text(duty >= 50 ? 'On' : 'Off');
  }

  // Rise / Fall
  const r = convertFromMs(rise);
  $('#edit-rise').val(r.value);
  //  $('#edit-rise-unit').val(r.unit);

  const f = convertFromMs(fall);
  $('#edit-fall').val(f.value);
  //  $('#edit-fall-unit').val(f.unit);

  // Common fields
  $('#edit-time').val(time);
  $('#edit-after-days').val(afterDays);
  $('#edit-enabled').prop('checked', !!enabled);

  // Repeat + custom group
  parseRepeatFields(repeatVal);

  // Custom repeat fields
  $('#edit-on-min').val(Math.floor(onTotal / 60));
  $('#edit-on-sec').val(onTotal % 60);
  $('#edit-off-min').val(Math.floor(offTotal / 60));
  $('#edit-off-sec').val(offTotal % 60);

  // Defer ALL collapse calls until modal is fully visible and has real dimensions
  $('#editModal')
    .off('shown.bs.modal.scheduleInit')
    .one('shown.bs.modal.scheduleInit', function () {
      const cfg = Array.isArray(outputsConfig)
        ? outputsConfig.find(c => c.id == channelId)
        : null;
      const mode = cfg && cfg.mode;
      if (mode && mode !== lastMode) {
        updateFieldsForOutputMode(mode);
        lastMode = mode;
      }

      // Set unit selectors AFTER collapse is visible — prevents browser reset
      $('#edit-rise-unit').val(r.unit);
      $('#edit-fall-unit').val(f.unit);
    })

  $('#editModal').modal('show');
}

// ---------------------------------------------------------
// SAVE MODAL CHANGES
// ---------------------------------------------------------
function saveScheduleItem() {
  if (!currentItem) return;

  // COMMON fields
  const timeVal = $('#edit-time').val() || '--:--';
  const afterDays = parseInt($('#edit-after-days').val()) || 0;
  const enabled = $('#edit-enabled').is(':checked');

  // CHANNEL + MODE
  const channelId = parseInt($('#edit-channel').val());
  const cfg = Array.isArray(outputsConfig) ? outputsConfig.find(c => c.id == channelId) : null;
  const mode = cfg && cfg.mode;
  const oldTime = currentItem.find('.time').data('time');
  const oldRepeat = currentItem.find('.repeat').data('repeat');
  // OUTPUT-SPECIFIC
  let duty = parseInt($('#edit-duty').val()) || 0;
  if (mode === "no_ramp" && $('#edit-duty-toggle').length) {
    duty = $('#edit-duty-toggle').is(':checked') ? 100 : 0;
  } else if (mode === "no_ramp") {
    // fallback: interpret numeric as on/off
    duty = duty >= 50 ? 100 : 0;
  }

  const rise = $('#collapse-rise').hasClass('show')
    ? convertToMs($('#edit-rise').val(), $('#edit-rise-unit').val())
    : (parseInt(currentItem.find('.duty').data('rise')) || 0);

  const fall = $('#collapse-fall').hasClass('show')
    ? convertToMs($('#edit-fall').val(), $('#edit-fall-unit').val())
    : (parseInt(currentItem.find('.duty').data('fall')) || 0);


  // REPEAT
  const repeatVal = $('#edit-repeat').val();

  // EVENT-SPECIFIC (custom)
  let onTotal = 0;
  let offTotal = 0;
  if (repeatVal === "custom") {
    const onMin = parseInt($('#edit-on-min').val()) || 0;
    const onSec = parseInt($('#edit-on-sec').val()) || 0;
    const offMin = parseInt($('#edit-off-min').val()) || 0;
    const offSec = parseInt($('#edit-off-sec').val()) || 0;
    onTotal = onMin * 60 + onSec;
    offTotal = offMin * 60 + offSec;
  }

  // Update row DOM
  currentItem.find('.time')
    .data('time', timeVal)
    .data('after-days', afterDays)
    .text(timeVal + (afterDays > 0 ? ` (+${afterDays}d)` : ''));

  currentItem.find('.channel')
    .data('id', channelId)
    .text(`${channelId}: ${cfg ? cfg.label : 'Output'}`);

  currentItem.find('.repeat')
    .data('repeat', repeatVal)
    .text(formatRepeat(repeatVal));

  currentItem.find('.duty')
    .data('duty', duty)
    .data('rise', rise)
    .data('fall', fall)
    .data('on', onTotal)
    .data('off', offTotal)
    .data('enabled', enabled);

  const dutyText = duty === 0 ? 'OFF' : duty === 100 ? 'ON' : `${duty}%`;
  currentItem.find('.duty').text(dutyText);

  // If time changed and row is part of a group → remove from group
  if (timeVal !== oldTime && currentItem.data('groupId') > 0) {
    currentItem.data('groupId', 0);
    currentItem.attr('data-group-id', 0);
    // Hide collapse button
    currentItem.find('.batch-collapse-btn').hide();
  }
  // if event type changed

  if (repeatVal !== oldRepeat && currentItem.data('groupId') > 0) {
    currentItem.data('groupId', 0);
    currentItem.attr('data-group-id', 0);
    currentItem.find('.batch-collapse-btn').hide();
  }
  // Close modal
  $('#editModal').modal('hide');
}

// ---------------------------------------------------------
// APPLY SCHEDULE TO SERVER
// ---------------------------------------------------------
function applyScheduleToServer() {
  taskContent = [];

  $('#schedule-list tr').each(function () {
    const $item = $(this);
    const type = $item.data('type');

    if (type === 'batch') {
      // Expand batch into individual events
      const events = $item.data('events');
      events.forEach(ev => taskContent.push(ev));
    } else {
      // Individual event — existing logic
      const groupId = parseInt($item.data('groupId')) || 0;
      taskContent.push({
        time: $item.find('.time').data('time'),
        afterDays: $item.find('.time').data('after-days'),
        channelId: $item.find('.channel').data('id'),
        repeat: $item.find('.repeat').data('repeat'),
        duty: parseInt($item.find('.duty').data('duty')) || 0,
        rise: parseInt($item.find('.duty').data('rise')) || 0,
        fall: parseInt($item.find('.duty').data('fall')) || 0,
        on: $item.find('.duty').data('on') || 0,
        off: $item.find('.duty').data('off') || 0,
        enabled: $item.find('.duty').data('enabled'),
        groupId: groupId
      });
    }
  });

  showSaveAsDialog();
}

function showSaveAsDialog() {
  const isDefault = (taskIndex === 0);
  $('#new-task-name').val(isDefault ? '' : (currentTaskName || ''));
  $('#save-as-error').hide().text('');
  $('#save-as-hint').text(
    isDefault
      ? 'Enter a name to save this as a new task.'
      : 'Keep the same name to overwrite, or enter a new name to create a copy.'
  );

  $('#save-as-confirm').off('click').on('click', function () {
    const name = $('#new-task-name').val().trim();
    if (!name) {
      $('#save-as-error').text('Please enter a task name.').show();
      return;
    }
    $('#saveAsModal').modal('hide');
    const nameChanged = (name !== currentTaskName);
    const isDefaultTask = (taskIndex === 0);
    if (isDefaultTask || nameChanged) {
      sendScheduleToServer(0, name);
    } else {
      sendScheduleToServer(taskIndex, name);
    }
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
  // Force new task creation if saving default
  const effectiveIndex = (name === "Default") ? 0 : index;
  $.ajax({
    url: "/task/save",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      index: effectiveIndex,
      name: name,
      schedule: taskContent
    }),
    success: resp => {
      console.log("Task saved:", resp);

      // If backend assigned a new index, update frontend state
      if (resp.index && resp.index !== taskIndex) {
        taskIndex = resp.index;
        currentTaskName = resp.name;

        // Add to dropdown if not already there
        const exists = $(`#taskSelect option[value="${taskIndex}"]`).length > 0;
        if (!exists) {
          $('#taskSelect').append(
            `<option value="${taskIndex}">${resp.name}</option>`
          );
          // Add to taskList
          taskList.push({ index: taskIndex, name: resp.name });
        }

        $('#taskSelect').val(taskIndex);
        updateScheduleHeader();
        updateTaskUI(taskStatus);
      }
    },
    error: xhr => console.warn("/task/save failed:", xhr.status)
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
  <button class="play-btn play-on" data-id="${o.id}" data-action="on">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <polygon points="8,5 19,12 8,19"></polygon>
    </svg>
  </button>

  <button class="play-btn play-off" data-id="${o.id}" data-action="off">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <rect x="6" y="6" width="12" height="12"></rect>
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
     GET  /api/settings  → { ap_ssid, ap_auth, sta_ssid, sta_saved, sta_connected }
     POST /api/settings  → { ap_ssid?, ap_pass?, sta_ssid?, sta_pass? }
                        ← { status:"ok", restart:true }
     GET  /wifi/scan     → { networks:[{ssid,rssi,security}] }
     POST /wifi/disconnect → { status:"disconnected" }
   ============================================================ */

/* ── init (called once when page is first shown) ──────────────────────────── */
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

/* ── run (called every time page becomes active) ──────────────────────────── */
function runSettingsWorkflow() {
  _settingsStatus("", "");       // clear previous message
  loadSettingsData();
}

/* ── load current values from firmware ───────────────────────────────────── */
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
      /* passwords are never returned — leave blank */
      document.getElementById("sta-ssid").value = d.sta_ssid || "";
      _showStaSaved(!!d.sta_saved, !!d.sta_connected);
    })
    .fail(() => _settingsStatus("Could not load settings.", "danger"));
}

/* ── wifi scan ───────────────────────────────────────────────────────────── */
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

/* ── disconnect STA ──────────────────────────────────────────────────────── */
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

/* ── save & restart ──────────────────────────────────────────────────────── */
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

/* ── private helpers ─────────────────────────────────────────────────────── */
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

