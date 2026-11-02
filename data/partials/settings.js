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
  $("#ip-mode-hint").text(manual
    ? "Type the address yourself. It must be free and in your home network."
    : "The farm takes a free address .200–.249 in your network and keeps it.");
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

  const net = _esc(h.ssid || "home network");
  let html = "";
  if (h.state === "connected" && h.ip) {
    const url = "http://" + h.ip + "/";
    html = `Connected to <strong>${net}</strong>.<br>Farm at home: ` +
           `<a href="${url}" target="_blank" rel="noopener" class="font-weight-bold" id="home-link">${_esc(url)}</a>` +
           `<span class="text-muted d-block mt-1">Open it from a phone or PC on ${net}` +
           `${h.hostname ? " · name in the router: " + _esc(h.hostname) : ""}</span>`;
    if (h.kind === "dhcp") html += `<span class="d-block mt-1">The router's address is used: it may change.</span>`;
  } else if (h.state === "retry") {
    const min = h.retryIn ? Math.max(1, Math.round(h.retryIn / 60)) : 0;
    html = `Not connected to <strong>${net}</strong>.` + (min ? ` Next try in ${min} min.` : "");
  } else {
    html = `<span class="spinner-border spinner-border-sm mr-1" role="status"></span>` +
           `Connecting to <strong>${net}</strong>…`;
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
    ? `To be sure the address stays free, reserve ${ip} for ${h.hostname} in your router.` : "")
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

  /* IP settings: sent when changed (the controller checks them too) */
  if (ipTouched) {
    if (_ipModeManual()) {
      const v = id => $(id).val().trim();
      const ipRe = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ok = s => ipRe.test(s) && s.split(".").every(n => +n <= 255);
      const fields = [["#ip-addr", "Address"], ["#ip-mask", "Mask"], ["#ip-gw", "Gateway"]];
      for (const [id, name] of fields) {
        if (!ok(v(id))) { $("#ip-settings").collapse("show"); $(id).trigger("focus");
          return _settingsStatus(`${name}: four numbers, like ${$(id).attr("placeholder")}.`, "warning"); }
      }
      for (const [id, name] of [["#ip-dns1", "DNS 1"], ["#ip-dns2", "DNS 2"]]) {
        if (v(id) && !ok(v(id))) { $("#ip-settings").collapse("show"); $(id).trigger("focus");
          return _settingsStatus(`${name}: four numbers, or leave it empty.`, "warning"); }
      }
      payload.ip = { mode: "manual", ip: v("#ip-addr"), mask: v("#ip-mask"), gw: v("#ip-gw"),
                     dns1: v("#ip-dns1"), dns2: v("#ip-dns2") };
    } else {
      payload.ip = { mode: "auto" };
    }
  }

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
        "Saved! Device is restarting. Reconnect to the AP with the new credentials. " +
        "When the farm has joined your home network, its address there is shown on this page.",
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
