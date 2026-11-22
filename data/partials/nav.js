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
  // All screens share one document scroll: a new screen starts at its top
  if (previous !== name) window.scrollTo(0, 0);
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

});

/* ============================================================
   TOUCH HINTS (Bootstrap tooltips, positioned by Popper.js)
   ============================================================
   Phones never show the browser's "title" hints: there is no mouse
   hover. A long press (0.5 s) on a button or icon with a title shows
   the same text as a Bootstrap tooltip; the press does not trigger the
   button then. A normal tap works as before. Desktop browsers keep
   their own title hints on hover.
   The tooltip is created when shown and removed when hidden, so it
   always has the current text (the language may change in between). */
const TIP_SELECTOR = 'button[title], .btn[title], .stage-pause[title], .tree-node-label[title], .tree-leaf-time[title]';
const TIP_DELAY = 500;          // ms of holding before the hint shows
const TIP_SHOW = 2000;          // ms the hint stays
let tipTimer = null, tipHideTimer = null, tipEl = null, tipText = '', tipSuppressClick = null;
let tipX = 0, tipY = 0;

function hideTip() {
  clearTimeout(tipHideTimer);
  if (!tipEl) return;
  const el = tipEl;
  tipEl = null;
  $(el).tooltip('dispose');
  el.setAttribute('title', tipText);       // Bootstrap emptied it
  el.removeAttribute('data-original-title');
}

function showTip(el) {
  hideTip();
  const text = el.getAttribute('title');
  if (!text || typeof $.fn.tooltip !== 'function') return;
  tipEl = el;
  tipText = text;
  $(el).tooltip({
    title: text,
    trigger: 'manual',
    placement: 'top',
    container: 'body',          // #container moves with a CSS transform
    boundary: 'viewport'
  }).tooltip('show');
  tipSuppressClick = el;         // the press was for the hint, not the button
  tipHideTimer = setTimeout(hideTip, TIP_SHOW);
}

document.addEventListener('touchstart', e => {
  clearTimeout(tipTimer);
  hideTip();
  if (e.touches.length !== 1) return;
  const el = e.target.closest(TIP_SELECTOR);
  if (!el || !el.getAttribute('title') || el.disabled) return;
  tipX = e.touches[0].clientX;
  tipY = e.touches[0].clientY;
  tipTimer = setTimeout(() => showTip(el), TIP_DELAY);
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!tipTimer || e.touches.length !== 1) return;
  // A finger that moves is scrolling or swiping, not holding
  if (Math.abs(e.touches[0].clientX - tipX) > 10 || Math.abs(e.touches[0].clientY - tipY) > 10) {
    clearTimeout(tipTimer);
    tipTimer = null;
  }
}, { passive: true });

document.addEventListener('touchend', () => { clearTimeout(tipTimer); tipTimer = null; }, { passive: true });
document.addEventListener('touchcancel', () => { clearTimeout(tipTimer); tipTimer = null; }, { passive: true });

// The click that follows a long press must not press the button
document.addEventListener('click', e => {
  if (!tipSuppressClick) return;
  const el = tipSuppressClick;
  tipSuppressClick = null;
  if (el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
}, true);

// No system menu (copy, share) on a long press over a hinted element
document.addEventListener('contextmenu', e => {
  if (e.target.closest(TIP_SELECTOR)) e.preventDefault();
});

// A screen change or a scroll ends the hint
window.addEventListener('scroll', hideTip, { passive: true });
window.addEventListener('resize', hideTip);
