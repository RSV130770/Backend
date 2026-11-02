
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

