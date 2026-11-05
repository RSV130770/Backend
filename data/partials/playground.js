
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
