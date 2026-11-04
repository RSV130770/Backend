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
    taskStages = [newStage(1, 'Stage 1', 0, 0)];
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
  if (!d && !h) return 'open-ended';
  return (d ? d + ' d' : '') + (d && h ? ' ' : '') + (h ? h + ' h' : '');
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
        <span class="stage-pause d-none" title="Pauses at its end">⏸</span>
      </div>
      <div class="tree-actions">
        <button class="stage-add-btn" title="Add a group to this stage">+</button>
        <button class="tree-edit-btn" title="Edit stage">✏</button>
      </div>
    </div>
    <div class="stage-groups collapse show">
      <div class="stage-empty text-muted small">No groups yet. Tap + to add one.</div>
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
    $s.find('.stage-name').text(st.name || 'Stage');
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
      name: (st.name || '').trim() || 'Stage',
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
  if (open) hint = last ? 'Open-ended: it runs until Stop.'
                        : 'Only the last stage can be open-ended.';
  else if (last) hint = 'The last stage: when it ends, the task is finished.';
  $('#stage-len-hint').text(hint);
  $('#stage-end-group').toggle(!open);
  $('#stage-message').toggle($('#stage-end-pause').is(':checked'));

  const $all = stageNodes();
  const idx = stageModalNode ? $all.index(stageModalNode) : -1;
  $('#stage-move-group').toggle(!!stageModalNode && $all.length > 1);
  $('#stage-up').prop('disabled', idx <= 0);
  $('#stage-down').prop('disabled', idx < 0 || idx >= $all.length - 1);
  $('#stage-delete-btn').toggle(!!stageModalNode).prop('disabled', $all.length <= 1);
  $('#stage-title').text(stageModalNode ? `Stage ${idx + 1} of ${$all.length}` : 'New stage');
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
  $('#stage-delete-text').text(n
    ? `Delete ${st.name || 'this stage'} and its ${n} group${n > 1 ? 's' : ''}?`
    : `Delete ${st.name || 'this stage'}?`);
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

  if (!name) return fail('Enter a name for the stage.', $('#stage-name'));
  if (!days && !hours && !stageModalIsLast())
    return fail('Only the last stage can be open-ended: give it a length.');
  if (endPause && !message)
    return fail('Enter the message shown while the task waits.', $('#stage-message'));

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
  const isPause = ev.repeat === 'freeze';
  const isMsg = isMessageEvent(ev);
  const cfg = outputsConfig.find(c => c.id == ev.channelId);
  const label = isPause ? `⏸ ${ev.message || 'Pause'}`
              : isMsg ? (parseInt(ev.duty) > 0 ? `✉ ${ev.message || 'Message'}` : '✉ Message')
              : (cfg ? cfg.label : `Ch${ev.channelId}`);
  const dutyText = isPause ? 'WAIT' : isMsg ? (parseInt(ev.duty) > 0 ? 'SHOW' : 'HIDE') : leafDutyText(ev);
  const noEdit = isPause || isMsg;     // edited in the group dialog
  const enabled = ev.enabled !== false;

  const $leaf = $(`
  <div class="tree-leaf">
    <input type="checkbox" class="tree-check leaf-check" ${enabled ? 'checked' : ''}>
    <span class="tree-leaf-time${ev.repeat === 'custom' ? ' tree-leaf-cycle' : ''}" title="${ev.repeat === 'custom' ? 'on : off' : ''}">${leafTimeText(ev)}</span>
    <span class="tree-leaf-label">${escapeHtml(label)}</span>
    <span class="tree-leaf-duty">${dutyText}</span>
    <div class="tree-actions">
      <button class="tree-edit-btn${noEdit ? ' invisible' : ''}" title="Edit">✏</button>
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
      return cfg ? cfg.label : `Ch${ev.channelId}`;
    }).join(', ');

  // The user's name for the group if there is one, otherwise the channels;
  // a group that pauses the task is marked
  const pause = groupPause(events);
  const nodeLabel = (pause ? '⏸ ' : '') +
    (groupNameOf(events) || channelList || (pause ? (pause.message || 'Pause') : ''));

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
  const when = (repeat === 'custom') ? `${leafTimeText(first)} cycle` : nodeTime;
  const pauseEv = groupPause(events);
  const nodeInfo = `${when} · ${formatRepeat(repeat)} · ${channelList}` +
    (pauseEv ? ` · pause: ${pauseEv.message || ''}` : '');
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
      if (typeof v === 'boolean') $(`#batch-toggle-${ch}`).prop('checked', v).next('label').text(v ? 'On' : 'Off');
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
// Message tile settings, kept while the repeat type changes
let batchMsgText = '';
let batchMsgWait = false;

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

    if (isMessageCfg(cfg)) {
      // The text, shown on the Dashboard until OK. (To pause the task,
      // let its stage end with a pause: stage dialog.)
      $settings.append(`
        <div class="batch-channel-row batch-msg-row" data-channel="${cfg.id}">
          <div class="batch-channel-label">${escapeHtml(cfg.label)}</div>
          <div class="batch-msg-fields">
            <input type="text" class="form-control" id="batch-msg-text" maxlength="60"
                   placeholder="Text, e.g. Remove the lid" autocomplete="off"
                   value="${escapeHtml(batchMsgText)}">
          </div>
        </div>`);
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

  $list.find('#batch-msg-text').on('input', function () { batchMsgText = this.value; });

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
  const stages = collectStages();
  const openIdx = stages.findIndex(stageIsOpen);
  if (openIdx >= 0 && openIdx < stages.length - 1) {
    $('#schedule-error').removeClass('d-none').text(
      `${stages[openIdx].name} is open-ended, so it has to be the last stage. ` +
      'Give it a length or move it to the end.');
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
      preset: taskStages.length
        ? { id: index, name: name, stages: taskStages, schedule: taskContent }
        : { id: index, name: name, schedule: taskContent }
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
