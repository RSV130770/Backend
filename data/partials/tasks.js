/* ============================================================
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

    // Status + start time; "frozen" = waiting at a pause point
    taskStatus = raw.current?.status || "stopped";
    taskStartTime = raw.current?.startTime || null;
    pauseMessage = raw.current?.pauseMessage || "";

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
    const task = taskList.find(t => t.index === taskIndex);
    $("#taskSelectLabel").text(task ? task.name : "Unknown");
  }
  const since = taskStartTime ? " since " + tileTime(taskStartTime) : "";
  const line = {
    running:  "Running" + since,
    paused:   "Paused",
    frozen:   "Waiting",
    finished: "Finished"
  }[status] || "Stopped";
  $("#taskStatusLabel").text(line);
  $("#taskTile").attr("data-status", status);

  // Stage-end banner
  $("#pause-banner").toggleClass("d-none", status !== "frozen");
  $("#pause-message").text(pauseMessage || "");
  updateMessagesCard();

  // Buttons. Pause becomes Resume while paused.
  const active = status === "running" || status === "paused" || status === "frozen";
  $("#taskStart").prop("disabled", active);
  $("#taskPause").prop("disabled", status !== "running" && status !== "paused")
    .attr("title", status === "paused" ? "Resume" : "Pause")
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
function showNotice(text) {
  $("#notice-text").text(text);
  $("#notice-banner").toggleClass("d-none", !text);
  updateMessagesCard();
}

// Messages card: count in the header (seen when folded), "No messages",
// and open the card by itself when a message comes that was not there yet
let shownMessages = "";
function updateMessagesCard() {
  const texts = [];
  if (!$("#pause-banner").hasClass("d-none")) texts.push("P:" + $("#pause-message").text());
  if (!$("#notice-banner").hasClass("d-none")) texts.push("N:" + $("#notice-text").text());
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
  if (!d && !h) return "open-ended";
  return (d ? d + " d" : "") + (d && h ? " " : "") + (h ? h + " h" : "");
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
  let label = "Stage", name = "Single stage", days = "", pct = 0;

  if (st) {
    label = `Stage ${st.index + 1}/${st.count}`;
    name = st.name || "";
    const day = Math.floor((st.elapsedMin || 0) / 1440) + 1;
    const total = st.lengthMin ? Math.ceil(st.lengthMin / 1440) : 0;
    days = total ? `day ${day} of ${total}` : `day ${day}`;
    pct = st.lengthMin ? Math.min(100, 100 * st.elapsedMin / st.lengthMin) : 0;
  } else if (taskStatus === "finished" && stageList.length) {
    label = `Stage ${stageList.length}/${stageList.length}`;
    name = stageList[stageList.length - 1].name;
    days = "done";
    pct = 100;
  } else if (stageList.length) {
    label = `Stages: ${stageList.length}`;
    name = stageList[0].name;
    days = "starts with this one";
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
  const items = taskList.map(t => ({
    id: t.index,
    label: t.name,
    current: t.index === taskIndex
  }));
  openPicker("Task", items, it => {
    if (it.id === taskIndex) { closePicker(); return; }
    if (!isTaskActive()) {
      // Nothing runs: just select it (the box handler tells the controller)
      closePicker();
      $("#taskSelect").val(it.id).trigger("change");
      return;
    }
    const cur = (taskList.find(t => t.index === taskIndex) || {}).name || "the task";
    askPicker(`Stop ${cur} and start ${it.label} now?`, "Start", () => {
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
    label: `${i + 1}. ${st.name}`,
    sub: (st.days !== undefined || st.hours !== undefined) ? stageLengthText(st) : "",
    current: st.id === curId,
    name: st.name
  }));
  openPicker("Stage", items, it => {
    if (it.id === curId) { closePicker(); return; }
    if (isTaskActive()) {
      askPicker(`Switch to ${it.name} now?`, "Switch", () => requestSetStage(it.id));
      return;
    }
    const task = (taskList.find(t => t.index === taskIndex) || {}).name || "the task";
    askPicker(`Start ${task} at ${it.name} now?`, "Start", () => {
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
