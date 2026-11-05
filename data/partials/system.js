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


