let MASTERS = {};
let FREIGHT_MASTERS = {};
let LAST_DOS = [];
let LAST_DOS_SORTED = []; // soonest-expiring-first, for the DO Register table + its filters
let LAST_DISPATCHES = [];
let LAST_YARD_LEDGER = []; // for Yard Out row-level Edit (Yard Out entries only — see startEditYardOut)
let QUICK_ADD_TARGET_INPUT = null; // <input> element to fill in once the quick-add modal saves
let CURRENT_QUEUE_ITEM = null; // freight queue row currently open in the Process Freight modal
let CURRENT_FREIGHT_ID = null; // FreightID currently open in the Freight Detail modal

// Mirrors the ROLES/DO_ROLES/FREIGHT_ROLES constants in Code.gs — used purely to decide what
// this device's session can see; the backend enforces the real permission check on every call.
const DO_ROLES = ['SuperAdmin', 'DODispatch'];
const FREIGHT_ROLES = ['SuperAdmin', 'Freight'];

// Maps the quick-add button's data-quick-add value to a friendly label for the modal title.
const QUICK_ADD_LABELS = { Mines: 'mine', Grades: 'grade', Customers: 'customer', Transporters: 'transporter', Yards: 'yard', OtherParties: 'other party' };

// ---------- REPORT LOADING ANIMATION (Reports tab only) ----------
// Small inline-SVG "truck driving mine -> destination" graphic, icon-only (no text labels —
// the mine/destination icons are self-explanatory). Used only for the Reports tab's loading
// state — see truckLoadingRow() in viewSelectedReport().
const ROUTE_SVG = `
  <svg viewBox="0 0 320 70" class="route-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <line x1="26" y1="52" x2="294" y2="52" class="route-road"></line>
    <g class="route-icon-mine" transform="translate(14,44)">
      <path d="M-11,10 L-4,-9 L1,1 L6,-11 L11,10 Z" class="mine-mountain"></path>
      <rect x="-3.5" y="3" width="7" height="7" class="mine-door"></rect>
    </g>
    <g class="route-icon-dest" transform="translate(306,44)">
      <rect x="4" y="-15" width="3" height="8" class="dest-chimney"></rect>
      <path d="M-11,-2 L0,-11 L11,-2 Z" class="dest-roof"></path>
      <rect x="-9" y="-2" width="18" height="12" class="dest-body"></rect>
      <rect x="-2.5" y="3" width="5" height="7" class="dest-door"></rect>
    </g>
    <g transform="translate(0,52)">
      <g class="route-truck">
        <image href="assets/dump-truck.svg" x="-22" y="-26" width="42" height="26" preserveAspectRatio="xMidYMax meet"></image>
      </g>
    </g>
  </svg>`;

function truckLoadingHtml(caption) {
  return `<div class="truck-loading">${ROUTE_SVG}<div class="truck-loading-caption">${escapeHtml(caption || 'Loading…')}</div></div>`;
}

/** A <tr><td colspan="N"> wrapping the loader, for dropping straight into a <tbody>. colspan
 * wider than the table's real column count is harmless — browsers just cap the effective span. */
function truckLoadingRow(colspan, caption) {
  return `<tr><td colspan="${colspan}">${truckLoadingHtml(caption)}</td></tr>`;
}

// ---------- INIT ----------
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm').addEventListener('submit', onLogin);
  document.getElementById('btnLogout').addEventListener('click', onLogout);

  if (Session.isLoggedIn()) {
    enterApp();
  } else {
    showLogin();
  }
});

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

/** Shows/hides every element carrying data-roles against the current session's role — covers
 * nav tab buttons and admin-only panels alike with one generic mechanism (replaces the old
 * single-purpose .admin-only class from the two separate apps). */
function applyRoleVisibility() {
  document.querySelectorAll('[data-roles]').forEach(el => {
    const allowed = el.dataset.roles.split(',').map(s => s.trim());
    el.classList.toggle('hidden', allowed.indexOf(Session.role) === -1);
  });
  // If the tab that's marked active got hidden for this role (e.g. Freight has no Dashboard),
  // switch to the first tab button this role can actually see.
  const activeBtn = document.querySelector('.tab-btn.active');
  if (!activeBtn || activeBtn.classList.contains('hidden')) {
    const firstVisible = document.querySelector('.tab-btn:not(.hidden)');
    if (firstVisible) firstVisible.click();
  }
}

function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('whoamiText').textContent = Session.username + ' (' + Session.role + ')';

  // setupTabs() must run BEFORE applyRoleVisibility() — the latter's fallback (switch off a tab
  // that's hidden for this role) works by clicking the first visible tab button, which only does
  // anything once setupTabs() has actually wired up a click handler on it. Calling it in the
  // other order left the Dashboard PANEL showing (its "active" class from the raw HTML) for a
  // role whose Dashboard NAV BUTTON was correctly hidden — the button vanished, the content didn't.
  setupTabs();
  applyRoleVisibility();

  // Must run BEFORE setupDateDefaults() — that call fills EVERY empty date input with today,
  // which would otherwise beat this to the From side of every range pair below (today, not the
  // 1st of the month) since both only act on empty inputs and whichever runs first wins.
  defaultDateRangesAll();
  setupDateDefaults();
  loadMasters();
  if (DO_ROLES.indexOf(Session.role) !== -1) loadDashboard();
  if (FREIGHT_ROLES.indexOf(Session.role) !== -1) loadFreightMasters();

  populateReportTypeOptions();
  setupProcessModal();
  setupDetailModal();

  document.getElementById('doForm').addEventListener('submit', onSaveDo);
  document.getElementById('doSoldSelect').addEventListener('change', updateSoldToPartyVisibility);
  document.getElementById('doFilterSource').addEventListener('change', renderDoTable);
  document.getElementById('doFilterMode').addEventListener('change', renderDoTable);
  document.getElementById('doFilterArea').addEventListener('change', renderDoTable);
  document.getElementById('doFilterStatus').addEventListener('change', renderDoTable);
  document.getElementById('doFilterDateFrom').addEventListener('change', renderDoTable);
  document.getElementById('doFilterDateTo').addEventListener('change', renderDoTable);
  document.getElementById('dashboardYardFrom').addEventListener('change', loadDashboardYardStock);
  document.getElementById('dashboardYardTo').addEventListener('change', loadDashboardYardStock);
  document.getElementById('dispatchFilterFrom').addEventListener('change', loadRecentDispatches);
  document.getElementById('dispatchFilterTo').addEventListener('change', loadRecentDispatches);
  document.getElementById('dispatchForm').addEventListener('submit', onSaveDispatch);
  document.getElementById('yardOutForm').addEventListener('submit', onSaveYardOut);
  document.getElementById('btnCancelYardOutEdit').addEventListener('click', cancelYardOutEdit);
  document.getElementById('btnResetYardOut').addEventListener('click', cancelYardOutEdit);
  document.getElementById('yardOutFilterFrom').addEventListener('change', loadYardLedger);
  document.getElementById('yardOutFilterTo').addEventListener('change', loadYardLedger);
  document.getElementById('dispatchSourceType').addEventListener('change', onDispatchSourceTypeChange);
  document.getElementById('basicPriceInput').addEventListener('input', updateRatePreview);
  document.getElementById('dispatchDoSelect').addEventListener('change', updateDispatchDoInfo);
  document.getElementById('dispatchQtyInput').addEventListener('input', updateMeter);
  document.getElementById('changePasswordForm').addEventListener('submit', onChangePassword);
  document.getElementById('addUserForm').addEventListener('submit', onAddUser);

  document.getElementById('reportTypeSelect').addEventListener('change', updateReportParamVisibility);
  document.getElementById('btnViewReport').addEventListener('click', viewSelectedReport);
  updateReportParamVisibility();

  document.getElementById('btnExportDoExcel').addEventListener('click', () => exportTableToExcel('doTable', 'DO_Register'));
  document.getElementById('btnExportDoPdf').addEventListener('click', () => exportTableToPdf('doTable', 'DO Register'));
  document.getElementById('btnExportReportExcel').addEventListener('click', () => exportTableToExcel('reportTable', 'Report'));
  document.getElementById('btnExportReportPdf').addEventListener('click', () => exportTableToPdf('reportTable', document.getElementById('reportResultTitle').textContent));

  document.getElementById('ledgerFilterDocNo').addEventListener('input', renderLedgerTable);
  document.getElementById('ledgerFilterTruckNo').addEventListener('input', renderLedgerTable);
  document.getElementById('ledgerFilterStatus').addEventListener('change', renderLedgerTable);
  document.getElementById('ledgerFilterEntity').addEventListener('change', renderLedgerTable);
  document.getElementById('ledgerFilterFrom').addEventListener('change', renderLedgerTable);
  document.getElementById('ledgerFilterTo').addEventListener('change', renderLedgerTable);
  document.getElementById('btnExportLedgerExcel').addEventListener('click', () => exportTableToExcel('ledgerTable', 'Freight_Ledger'));

  document.getElementById('btnCancelDoEdit').addEventListener('click', cancelDoEdit);
  document.getElementById('btnCancelDispatchEdit').addEventListener('click', cancelDispatchEdit);
  // Reset buttons reuse the "cancel edit" logic — it already does a full form reset
  // (clears fields, exits edit-mode if active, restores default button labels).
  document.getElementById('btnResetDo').addEventListener('click', cancelDoEdit);
  document.getElementById('btnResetDispatch').addEventListener('click', cancelDispatchEdit);

  setupQuickAdd();
  setupRowEditDelegation();
  setupMediaViewer();
}

function setupMediaViewer() {
  document.getElementById('btnMediaViewerClose').addEventListener('click', closeMediaViewer);
  document.getElementById('mediaViewerOverlay').addEventListener('click', e => {
    if (e.target.id === 'mediaViewerOverlay') closeMediaViewer();
  });
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const fd = new FormData(form);
    const res = await apiLogin(fd.get('username'), fd.get('password'));
    Session.save(res.token, res.username, res.role);
    form.reset();
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function onLogout() {
  Session.clear();
  location.reload();
}

function setupDateDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('input[type=date]').forEach(inp => { if (!inp.value) inp.value = today; });
}

/** Sets one From/To date-input pair to [1st of this month, today] if either is currently
 * empty — never overwrites a value already chosen. The app-wide default for every date-range
 * filter, per how the client wants every "scenario" to start (see defaultDateRangesAll). */
function defaultDateRange(fromId, toId) {
  const fromEl = document.getElementById(fromId), toEl = document.getElementById(toId);
  if (!fromEl && !toEl) return;
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = d => d.toISOString().slice(0, 10);
  if (fromEl && !fromEl.value) fromEl.value = iso(firstOfMonth);
  if (toEl && !toEl.value) toEl.value = iso(today);
}

/** Every From/To range filter in the app, plus the single "as of" date report — all default to
 * month-to-date. Called once at login; each pair is independently safe to call again later
 * (e.g. after a form reset) since it only ever fills an empty field. */
function defaultDateRangesAll() {
  [
    ['doFilterDateFrom', 'doFilterDateTo'],
    ['dispatchFilterFrom', 'dispatchFilterTo'],
    ['yardOutFilterFrom', 'yardOutFilterTo'],
    ['dashboardYardFrom', 'dashboardYardTo'],
    ['reportDispatchFrom', 'reportDispatchTo'],
    ['reportYardFrom', 'reportYardTo'],
    ['reportEntityFrom', 'reportEntityTo'],
    ['reportMasterFrom', 'reportMasterTo'],
    ['reportCombinedFrom', 'reportCombinedTo'],
    ['ledgerFilterFrom', 'ledgerFilterTo']
  ].forEach(([fromId, toId]) => defaultDateRange(fromId, toId));
  const asOf = document.getElementById('reportDoBalanceAsOfDate');
  if (asOf && !asOf.value) asOf.value = new Date().toISOString().slice(0, 10);
}

// ---------- TABS ----------
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'dashboard') loadDashboard();
      if (btn.dataset.tab === 'dispatch') loadDispatchTab();
      if (btn.dataset.tab === 'yardOut') loadYardOutTab();
      if (btn.dataset.tab === 'freightQueue') loadQueue();
      if (btn.dataset.tab === 'freightLedger') loadLedger();
      if (btn.dataset.tab === 'reports') loadReportDoSelect();
      if (btn.dataset.tab === 'account' && Session.role === 'SuperAdmin') { loadUsers(); loadAuditLog(); }
    });
  });
}

// ---------- TOAST ----------
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast-msg' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- MASTERS ----------
async function loadMasters() {
  try {
    const m = await apiGet('getMasters');
    MASTERS = m;
    fillSelect('doSource', m.Sources);
    fillDatalist('areasList', m.Areas);
    fillDatalist('minesList', m.Mines);
    fillDatalist('gradesList', m.Grades);
    fillDatalist('transportersList', m.Transporters);
    fillDatalist('customersList', (m.Customers || []).concat(m.Yards || []));
    fillDatalist('customersList2', m.Customers);
    fillDatalist('yardsList', m.Yards);
    fillDatalist('otherPartiesList', m.OtherParties);
    fillDatalist('reportCustomerList', m.Customers);
    fillSelect('yardOutMaterial', m.Materials);
  } catch (err) { onError(err); }
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (values || []).map(v => `<option>${escapeHtml(v)}</option>`).join('');
}
function fillDatalist(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (values || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** Formats a quantity/currency value with Indian-style thousands separators (lakh/crore
 * grouping, e.g. 4563631 -> "45,63,631") for display only — never use on a value that's about
 * to be re-parsed as a number (form inputs, data-* attributes used in JS math, etc). Blank/null
 * passes through unchanged since several report columns intentionally leave cells empty. */
function fmtNum(n) {
  if (n === '' || n === null || n === undefined) return '';
  const num = Number(n);
  if (isNaN(num)) return escapeHtml(n);
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// ---------- EXPORT (Excel / PDF) ----------
function cloneTableWithoutActionButtons(tableId) {
  const table = document.getElementById(tableId);
  const clone = table.cloneNode(true);
  clone.querySelectorAll('button').forEach(btn => btn.closest('td, th').remove());
  clone.querySelectorAll('thead th').forEach(th => { if (!th.textContent.trim()) th.remove(); });
  return clone;
}

function exportTableToExcel(tableId, filename) {
  const clone = cloneTableWithoutActionButtons(tableId);
  if (!clone.querySelector('tr')) { toast('Nothing to export yet — view a report first.', 'error'); return; }
  const html = `
    <html><head><meta charset="utf-8"></head>
    <body>${clone.outerHTML}</body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.xls';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportTableToPdf(tableId, title) {
  const clone = cloneTableWithoutActionButtons(tableId);
  if (!clone.querySelector('tr')) { toast('Nothing to export yet — view a report first.', 'error'); return; }
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; }
      h1 { font-size: 16px; margin-bottom: 12px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
    </style></head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      ${clone.outerHTML}
      <script>window.onload = () => { window.print(); };<\/script>
    </body></html>`);
  win.document.close();
}

// ---------- DASHBOARD ----------
async function loadDashboard() {
  try {
    const data = await apiGet('getDashboard');
    renderDashboard(data);
  } catch (err) { onError(err); }
}

function renderDashboard(data) {
  LAST_DOS = data.dos;
  const s = data.summary;
  document.getElementById('summaryCards').innerHTML = `
    <div class="card active"><div class="num">${s.activeCount}</div><div class="label">Active DOs</div></div>
    <div class="card expiring"><div class="num">${s.expiringSoonCount}</div><div class="label">Expiring Soon</div></div>
    <div class="card expired"><div class="num">${s.expiredCount}</div><div class="label">Expired (unfulfilled)</div></div>
    <div class="card"><div class="num">${s.completedCount}</div><div class="label">Completed</div></div>
    <div class="card"><div class="num">${s.soldCount || 0}</div><div class="label">Sold</div></div>
    <div class="card"><div class="num">${fmtNum(s.totalBalanceQty)}</div><div class="label">Total Balance Qty (MT)</div></div>
    <div class="card"><div class="num">${s.todayTripCount}</div><div class="label">Today's Trips (${fmtNum(s.todayQty)} MT)</div></div>
  `;

  // Freight snapshot — only meaningful (and only visible, see data-roles="SuperAdmin" on the
  // container) for a Super Admin, so a DO Dispatch login never sees freight numbers here.
  const f = data.freight || {};
  document.getElementById('summaryCardsFreight').innerHTML = `
    <div class="card"><div class="num">${f.queueWaitingCount || 0}</div><div class="label">Freight — Waiting in Queue</div></div>
    <div class="card"><div class="num">${f.pendingCount || 0}</div><div class="label">Freight — Pending</div></div>
    <div class="card"><div class="num">${f.partiallyPaidCount || 0}</div><div class="label">Freight — Partially Paid</div></div>
    <div class="card"><div class="num">${f.fullyPaidCount || 0}</div><div class="label">Freight — Fully Paid</div></div>
    <div class="card expired"><div class="num">₹${fmtNum(f.totalOutstanding || 0)}</div><div class="label">Freight — Total Outstanding</div></div>
  `;

  // DO Register lists soonest-expiring first — data.dos already arrives in that order from
  // getDOList() (DaysLeft ascending, nulls/finished DOs last), so this is just making the
  // intent explicit rather than silently relying on the backend's ordering.
  LAST_DOS_SORTED = [...data.dos].sort((a, b) => (a.DaysLeft == null ? 999999 : a.DaysLeft) - (b.DaysLeft == null ? 999999 : b.DaysLeft));
  populateDoFilterOptions();
  renderDoTable();

  // The Dashboard's "Yard Stock" table is date-ranged (Opening/In/Out/Closing for the picked
  // period), not the live cumulative total — that's what the "Yard In vs Out" chart above
  // already shows, driven by data.yardStock. Two different questions, two different views.
  loadDashboardYardStock();

  renderStatusChart(data.dos);
  renderMineChart(data.dos);
  renderTripsChart(data.trend || []);
  renderTrendChart(data.trend || []);
  renderYardChart(data.yardStock || []);
  renderYardMaterialChart(data.yardMaterialOut || []);
}

/** Dashboard "Yard Stock" table — Opening/In/Out/Closing balance per yard for the picked date
 * range (reuses the same backend call as the Reports tab's "Yard Stock" report). */
async function loadDashboardYardStock() {
  const from = document.getElementById('dashboardYardFrom').value;
  const to = document.getElementById('dashboardYardTo').value;
  if (!from || !to) return;
  try {
    const data = await apiGet('getYardStockByDateRange', { dateFrom: from, dateTo: to });
    document.querySelector('#yardTable tbody').innerHTML = data.summary.map(y => `
      <tr><td>${escapeHtml(y.yard)}</td><td>${fmtNum(y.opening)}</td><td>${fmtNum(y.rangeIn)}</td><td>${fmtNum(y.rangeOut)}</td><td>${fmtNum(y.closing)}</td></tr>
    `).join('') || '<tr><td colspan="5">No yard movements in this range</td></tr>';
  } catch (err) { onError(err); }
}

function populateDoFilterOptions() {
  const sourceSel = document.getElementById('doFilterSource');
  const areaSel = document.getElementById('doFilterArea');
  const sources = [...new Set(LAST_DOS_SORTED.map(d => d.Source).filter(Boolean))].sort();
  const areas = [...new Set(LAST_DOS_SORTED.map(d => d.Area).filter(Boolean))].sort();
  const keepValue = (sel, opts) => {
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>' + opts.map(o => `<option${o === current ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
  };
  keepValue(sourceSel, sources);
  keepValue(areaSel, areas);
}

/** Applies the Source/Mode/Area/DO-Date filters (if any) and re-renders the DO Register table
 * body, sorted soonest-expiring first (LAST_DOS_SORTED is already in that order — see
 * renderDashboard — so this never re-sorts). */
function renderDoTable() {
  const source = document.getElementById('doFilterSource').value;
  const mode = document.getElementById('doFilterMode').value;
  const area = document.getElementById('doFilterArea').value;
  const status = document.getElementById('doFilterStatus').value;
  const dateFrom = document.getElementById('doFilterDateFrom').value ? new Date(document.getElementById('doFilterDateFrom').value) : null;
  const dateTo = document.getElementById('doFilterDateTo').value ? new Date(document.getElementById('doFilterDateTo').value) : null;

  // "Active" also covers "Expiring Soon" — a DO nearing its valid-up-to date is still active,
  // just flagged as urgent. "Expiring Soon" stays selectable on its own for isolating just those.
  const matchesStatus = d => {
    if (!status) return true;
    if (status === 'Active') return d.ComputedStatus === 'Active' || d.ComputedStatus === 'Expiring Soon';
    return d.ComputedStatus === status;
  };
  const matchesDate = d => {
    if (!dateFrom && !dateTo) return true;
    if (!d.DO_Date) return false;
    const doDate = new Date(d.DO_Date);
    if (dateFrom && doDate < dateFrom) return false;
    if (dateTo && doDate > dateTo) return false;
    return true;
  };

  const rows = LAST_DOS_SORTED.filter(d =>
    (!source || d.Source === source) &&
    (!mode || d.Mode === mode) &&
    (!area || d.Area === area) &&
    matchesStatus(d) && matchesDate(d)
  );

  const tbody = document.querySelector('#doTable tbody');
  tbody.innerHTML = rows.map(d => `
    <tr>
      <td class="cell-strong">${escapeHtml(d.DO_No)}</td>
      <td>${escapeHtml(d.Source)}</td>
      <td>${escapeHtml(d.Mode)}</td>
      <td>${escapeHtml(d.Area)}</td>
      <td><span class="status-pill status-${d.ComputedStatus.replace(/\s/g,'-')}">${d.ComputedStatus}</span></td>
      <td class="cell-strong">${escapeHtml(d.Mine)}</td>
      <td>${escapeHtml(d.Grade)}</td>
      <td class="cell-strong">${fmtNum(d.BookQty)}</td>
      <td>${fmtNum(d.Lifted)}</td>
      <td class="cell-strong">${fmtNum(d.Balance)}</td>
      <td>${fmtNum(d.Bid)}</td>
      <td>${fmtNum(d.BasicPrice)}</td>
      <td>${fmtNum(d.GST18Rate)}</td>
      <td>${fmtNum(d.IncPF50)}</td>
      <td>${fmtNum(d.NetRate)}</td>
      <td>${d.ValidUpTo_fmt}</td>
      <td>${d.DaysLeft != null ? d.DaysLeft : ''}</td>
      <td>${escapeHtml(d.SoldToParty)}</td>
      <td>${escapeHtml(d.TransportName)}</td>
      <td>${Session.role === 'SuperAdmin' ? `<button class="btn-row-edit" data-edit-do="${escapeHtml(d.DO_No)}">Edit</button>
        <button class="btn-row-edit" data-delete-do="${escapeHtml(d.DO_No)}">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="20">No DOs match this filter</td></tr>';
}

// ============================================================================
// CHARTS — hand-rolled SVG, no external chart library. Palette and mark specs
// follow the dataviz skill: status colors for DO state, one sequential hue for
// magnitude, a 2-color categorical pair for yard in/out, legends + direct
// labels always present (never color-alone), shared hover tooltip.
// ============================================================================

const VIZ = {
  good: getCss('--viz-good'), warning: getCss('--viz-warning'), critical: getCss('--viz-critical'),
  neutral: getCss('--viz-neutral'), violet: getCss('--viz-violet'),
  seqBlue500: getCss('--viz-seq-blue-500'), seqBlue400: getCss('--viz-seq-blue-400'), seqBlue100: getCss('--viz-seq-blue-100'),
  catBlue: getCss('--viz-cat-blue'), catOrange: getCss('--viz-cat-orange'),
  grid: getCss('--viz-grid'), baseline: getCss('--viz-baseline'), muted: getCss('--viz-text-muted')
};

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888';
}

function svgEl(tag, attrs) {
  const s = Object.entries(attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<${tag} ${s}></${tag}>`;
}

// ---- shared tooltip ----
function showTooltip(evt, text) {
  const tip = document.getElementById('vizTooltip');
  tip.textContent = text;
  tip.style.left = evt.pageX + 'px';
  tip.style.top = (evt.pageY - 10) + 'px';
  tip.classList.add('show');
}
function moveTooltip(evt) {
  const tip = document.getElementById('vizTooltip');
  tip.style.left = evt.pageX + 'px';
  tip.style.top = (evt.pageY - 10) + 'px';
}
function hideTooltip() {
  document.getElementById('vizTooltip').classList.remove('show');
}
function wireTooltips(container) {
  container.querySelectorAll('[data-tt]').forEach(el => {
    el.addEventListener('mouseenter', e => showTooltip(e, el.dataset.tt));
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', hideTooltip);
  });
}

// ---------- 1. DO Status donut ----------
function renderStatusChart(dos) {
  const el = document.getElementById('statusChart');
  const buckets = [
    { key: 'Active', label: 'Active', color: VIZ.good },
    { key: 'Expiring Soon', label: 'Expiring Soon', color: VIZ.warning },
    { key: 'Expired', label: 'Expired', color: VIZ.critical },
    { key: 'Completed', label: 'Completed', color: VIZ.neutral },
    { key: 'Sold', label: 'Sold', color: VIZ.violet }
  ].map(b => ({ ...b, count: dos.filter(d => d.ComputedStatus === b.key).length }));

  const total = dos.length;
  if (!total) { el.innerHTML = '<div class="chart-empty">No DOs yet — add one to see the breakdown.</div>'; return; }

  const R = 60, CX = 80, CY = 80, STROKE = 26;
  const circumference = 2 * Math.PI * R;
  let offsetAcc = 0;
  const GAP = 2; // surface gap between segments

  const segs = buckets.filter(b => b.count > 0).map(b => {
    const frac = b.count / total;
    const len = Math.max(frac * circumference - GAP, 0);
    const seg = svgEl('circle', {
      cx: CX, cy: CY, r: R, fill: 'none', stroke: b.color, 'stroke-width': STROKE,
      'stroke-dasharray': `${len} ${circumference - len}`,
      'stroke-dashoffset': -offsetAcc,
      transform: `rotate(-90 ${CX} ${CY})`,
      class: 'viz-donut-seg',
      'data-tt': `${b.label}: ${b.count} DO${b.count === 1 ? '' : 's'} (${Math.round(frac * 100)}%)`
    });
    offsetAcc += frac * circumference;
    return seg;
  }).join('');

  const svg = `
    <svg viewBox="0 0 160 160" style="max-width:220px;margin:0 auto;display:block;">
      ${segs}
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" font-size="24" font-weight="700" fill="var(--viz-text-primary)">${total}</text>
      <text x="${CX}" y="${CY + 16}" text-anchor="middle" font-size="11" fill="var(--viz-text-muted)">Total DOs</text>
    </svg>
    <div class="viz-legend">
      ${buckets.map(b => `
        <div class="viz-legend-item">
          <span class="viz-legend-dot" style="background:${b.color}"></span>
          ${b.label}: <b>${b.count}</b>
        </div>
      `).join('')}
    </div>
  `;
  el.innerHTML = svg;
  wireTooltips(el);
}

// ---------- 2. Outstanding balance by mine (sequential, horizontal bars) ----------
function renderMineChart(dos) {
  const el = document.getElementById('mineChart');
  const byMine = {};
  dos.forEach(d => {
    if (d.ComputedStatus === 'Completed' || d.ComputedStatus === 'Sold') return;
    if (!d.Mine) return;
    byMine[d.Mine] = (byMine[d.Mine] || 0) + (Number(d.Balance) || 0);
  });
  const rows = Object.entries(byMine)
    .map(([mine, qty]) => ({ mine, qty: Math.round(qty * 100) / 100 }))
    .filter(r => r.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);

  if (!rows.length) { el.innerHTML = '<div class="chart-empty">No outstanding balance to show.</div>'; return; }

  const max = Math.max(...rows.map(r => r.qty));
  const W = 460, LABEL_W = 110, BAR_H = 20, GAP_Y = 10, RIGHT_PAD = 60;
  const trackW = W - LABEL_W - RIGHT_PAD;
  const H = rows.length * (BAR_H + GAP_Y);

  const bars = rows.map((r, i) => {
    const y = i * (BAR_H + GAP_Y);
    const w = Math.max((r.qty / max) * trackW, 2);
    return `
      <text x="${LABEL_W - 8}" y="${y + BAR_H / 2 + 4}" text-anchor="end" font-size="12">${escapeHtml(r.mine)}</text>
      <rect x="${LABEL_W}" y="${y}" width="${trackW}" height="${BAR_H}" rx="4" fill="var(--viz-grid)"></rect>
      <rect class="chart-bar-mark" data-tt="${escapeHtml(r.mine)}: ${fmtNum(r.qty)} MT outstanding"
            x="${LABEL_W}" y="${y}" width="${w}" height="${BAR_H}" rx="4" fill="${VIZ.seqBlue500}"></rect>
      <text x="${LABEL_W + w + 8}" y="${y + BAR_H / 2 + 4}" font-size="12" fill="var(--viz-text-primary)" font-weight="600">${fmtNum(r.qty)}</text>
    `;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px">${bars}</svg>`;
  wireTooltips(el);
}

// ---------- 3. Dispatch trend (line + area, single sequential hue) ----------
// ---------- 3a. Trips per day (bar, sits above the tonnage chart, same x-axis/width) ----------
// Deliberately a SEPARATE chart with its own y-axis rather than a second axis on the tonnage
// chart below — a dual-axis chart lets you rescale one series to manufacture a false visual
// correlation. Same dates, same width, stacked, so trends still read together at a glance.
function renderTripsChart(trend) {
  const el = document.getElementById('tripsChart');
  if (!trend.length || trend.every(t => (t.tripCount || 0) === 0)) {
    el.innerHTML = '<div class="chart-empty" style="padding:8px 0;">No trips in the last 14 days.</div>';
    return;
  }

  const W = 460, H = 70, PAD_L = 36, PAD_R = 12, PAD_T = 6, PAD_B = 6;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const maxVal = Math.max(...trend.map(t => t.tripCount || 0), 1);
  const niceMax = Math.ceil(maxVal / 2) * 2 || 2;

  const xStep = plotW / (trend.length - 1 || 1);
  const barW = Math.min(18, xStep * 0.6);

  const bars = trend.map((t, i) => {
    const cx = PAD_L + i * xStep;
    const h = ((t.tripCount || 0) / niceMax) * plotH;
    const y = PAD_T + plotH - h;
    return `<rect class="chart-bar-mark" data-tt="${t.date}: ${t.tripCount || 0} trip${t.tripCount === 1 ? '' : 's'}"
                  x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}"
                  rx="3" fill="${VIZ.seqBlue500}"></rect>`;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <text x="${PAD_L - 8}" y="${PAD_T + 8}" text-anchor="end" font-size="10" fill="var(--viz-text-muted)">${niceMax}</text>
      <text x="${PAD_L - 8}" y="${PAD_T + plotH}" text-anchor="end" font-size="10" fill="var(--viz-text-muted)">0</text>
      ${bars}
    </svg>
  `;
  wireTooltips(el);
}

function renderTrendChart(trend) {
  const el = document.getElementById('trendChart');
  if (!trend.length || trend.every(t => t.qty === 0)) {
    el.innerHTML = '<div class="chart-empty">No dispatches recorded in the last 14 days.</div>';
    return;
  }

  const W = 460, H = 180, PAD_L = 36, PAD_B = 24, PAD_T = 14, PAD_R = 12;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const maxVal = Math.max(...trend.map(t => t.qty), 1);
  const niceMax = Math.ceil(maxVal / 10) * 10 || 10;

  const xStep = plotW / (trend.length - 1 || 1);
  const pts = trend.map((t, i) => {
    const x = PAD_L + i * xStep;
    const y = PAD_T + plotH - (t.qty / niceMax) * plotH;
    return { x, y, t };
  });

  const linePath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const areaPath = linePath + ` L${pts[pts.length - 1].x.toFixed(1)} ${PAD_T + plotH} L${pts[0].x.toFixed(1)} ${PAD_T + plotH} Z`;

  const gridlines = [0, 0.5, 1].map(f => {
    const y = PAD_T + plotH - f * plotH;
    return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--viz-grid)" stroke-width="1"></line>
            <text x="${PAD_L - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--viz-text-muted)">${Math.round(f * niceMax)}</text>`;
  }).join('');

  // sparse x labels: first, middle, last only, to avoid collisions
  const labelIdxs = new Set([0, Math.floor((trend.length - 1) / 2), trend.length - 1]);
  const xLabels = pts.map((p, i) => labelIdxs.has(i)
    ? `<text x="${p.x}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--viz-text-muted)">${p.t.date.slice(0, 5)}</text>`
    : '').join('');

  const dots = pts.map(p => `
    <circle class="viz-dot" data-tt="${p.t.date}: ${fmtNum(p.t.qty)} MT" cx="${p.x}" cy="${p.y}" r="4"
            fill="${VIZ.seqBlue500}" stroke="var(--viz-surface)" stroke-width="2"></circle>
  `).join('');

  const last = pts[pts.length - 1];

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      ${gridlines}
      <path d="${areaPath}" fill="${VIZ.seqBlue100}" opacity="0.5"></path>
      <path d="${linePath}" fill="none" stroke="${VIZ.seqBlue500}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
      ${dots}
      <text x="${last.x}" y="${last.y - 10}" text-anchor="end" font-size="12" font-weight="700" fill="var(--viz-text-primary)">${last.t.qty}</text>
      ${xLabels}
    </svg>
  `;
  wireTooltips(el);
}

// ---------- 4. Yard In vs Out (categorical, 2 series) ----------
function renderYardChart(yardStock, targetId) {
  const el = document.getElementById(targetId || 'yardChart');
  if (!yardStock.length) { el.innerHTML = '<div class="chart-empty">No yard movements recorded yet.</div>'; return; }

  const W = 460, LABEL_W = 80, BAR_H = 18, ROW_GAP = 56, RIGHT_PAD = 55;
  const trackW = W - LABEL_W - RIGHT_PAD;
  const max = Math.max(...yardStock.flatMap(y => [y.in, y.out]), 1);
  const H = yardStock.length * ROW_GAP + 10;

  const rows = yardStock.map((y, i) => {
    const y0 = i * ROW_GAP;
    const wIn = Math.max((y.in / max) * trackW, 1);
    const wOut = Math.max((y.out / max) * trackW, 1);
    const netUp = y.balance >= 0;
    return `
      <text x="0" y="${y0 + 12}" font-size="12" font-weight="600" fill="var(--viz-text-primary)">${escapeHtml(y.yard)}</text>
      <text x="${W}" y="${y0 + 12}" text-anchor="end" font-size="11" font-weight="600" fill="${netUp ? VIZ.good : VIZ.critical}">Balance: ${fmtNum(y.balance)} MT</text>

      <rect class="chart-bar-mark" data-tt="In: ${fmtNum(y.in)} MT" x="${LABEL_W}" y="${y0 + 16}" width="${wIn}" height="${BAR_H}" rx="5" fill="url(#yardInGrad)"></rect>
      <text x="${LABEL_W + wIn + 6}" y="${y0 + 16 + BAR_H / 2 + 4}" font-size="11" fill="var(--viz-text-secondary)">${fmtNum(y.in)}</text>

      <rect class="chart-bar-mark" data-tt="Out: ${fmtNum(y.out)} MT" x="${LABEL_W}" y="${y0 + 16 + BAR_H + 6}" width="${wOut}" height="${BAR_H}" rx="5" fill="url(#yardOutGrad)"></rect>
      <text x="${LABEL_W + wOut + 6}" y="${y0 + 16 + BAR_H + 6 + BAR_H / 2 + 4}" font-size="11" fill="var(--viz-text-secondary)">${fmtNum(y.out)}</text>
    `;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="height:${H}px">
      <defs>
        <linearGradient id="yardInGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${VIZ.catBlue}" stop-opacity="0.65"></stop>
          <stop offset="100%" stop-color="${VIZ.catBlue}"></stop>
        </linearGradient>
        <linearGradient id="yardOutGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${VIZ.catOrange}" stop-opacity="0.65"></stop>
          <stop offset="100%" stop-color="${VIZ.catOrange}"></stop>
        </linearGradient>
      </defs>
      ${rows}
    </svg>
    <div class="viz-legend">
      <div class="viz-legend-item"><span class="viz-legend-dot" style="background:${VIZ.catBlue}"></span>In (from mine)</div>
      <div class="viz-legend-item"><span class="viz-legend-dot" style="background:${VIZ.catOrange}"></span>Out (to customer)</div>
    </div>
  `;
  wireTooltips(el);
}

// ---------- Yard Out material split (Coal / Chura / Stone) ----------
function renderYardMaterialChart(materialOut) {
  const el = document.getElementById('yardMaterialChart');
  const total = Math.round(materialOut.reduce((s, m) => s + (Number(m.qty) || 0), 0) * 100) / 100;
  if (!total) { el.innerHTML = '<div class="chart-empty">No yard-out movements recorded yet.</div>'; return; }

  const palette = { Coal: VIZ.catBlue, Chura: VIZ.catOrange, Stone: VIZ.violet };
  const buckets = materialOut
    .filter(m => m.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .map(m => ({ label: m.material, qty: m.qty, color: palette[m.material] || VIZ.neutral }));

  const R = 60, CX = 80, CY = 80, STROKE = 26;
  const circumference = 2 * Math.PI * R;
  let offsetAcc = 0;
  const GAP = 2;

  const segs = buckets.map(b => {
    const frac = b.qty / total;
    const len = Math.max(frac * circumference - GAP, 0);
    const seg = svgEl('circle', {
      cx: CX, cy: CY, r: R, fill: 'none', stroke: b.color, 'stroke-width': STROKE,
      'stroke-dasharray': `${len} ${circumference - len}`,
      'stroke-dashoffset': -offsetAcc,
      transform: `rotate(-90 ${CX} ${CY})`,
      class: 'viz-donut-seg',
      'data-tt': `${b.label}: ${fmtNum(b.qty)} MT (${Math.round(frac * 100)}%)`
    });
    offsetAcc += frac * circumference;
    return seg;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 160 160" style="max-width:220px;margin:0 auto;display:block;">
      ${segs}
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" font-size="20" font-weight="700" fill="var(--viz-text-primary)">${fmtNum(total)}</text>
      <text x="${CX}" y="${CY + 16}" text-anchor="middle" font-size="11" fill="var(--viz-text-muted)">Total MT Out</text>
    </svg>
    <div class="viz-legend">
      ${buckets.map(b => `
        <div class="viz-legend-item">
          <span class="viz-legend-dot" style="background:${b.color}"></span>
          ${escapeHtml(b.label)}: <b>${fmtNum(b.qty)} MT</b>
        </div>
      `).join('')}
    </div>
  `;
  wireTooltips(el);
}

// ---------- ADD DO ----------
function updateRatePreview() {
  const basic = parseFloat(document.getElementById('basicPriceInput').value) || 0;
  const gst = basic * 1.18;
  const incPf = gst + 50;
  const net = gst * 1.02 + 20;
  document.getElementById('ratePreview').innerHTML =
    `Preview (using default settings — adjust in the Settings sheet if your GST/TCS/charges differ):<br>
     GST18 Rate: <b>${gst.toFixed(2)}</b> &nbsp;|&nbsp; Inc PF 50: <b>${incPf.toFixed(2)}</b> &nbsp;|&nbsp; Net Rate: <b>${net.toFixed(2)}</b>`;
}

async function onSaveDo(e) {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const editingDoNo = payload.editingDoNo;
  delete payload.editingDoNo;

  try {
    if (editingDoNo) {
      await apiPost('updateDO', payload);
      toast('DO ' + payload.DO_No + ' updated.', 'success');
      cancelDoEdit();
    } else {
      const res = await apiPost('addDO', payload);
      toast('DO ' + res.doNo + ' saved.', 'success');
      form.reset();
      setupDateDefaults();
    }
    document.getElementById('ratePreview').textContent = 'Enter Basic Price to preview GST18 / IncPF50 / Net Rate →';
    loadDashboard();
  } catch (err) { onError(err); }
}

/** Loads an existing DO into the Add DO form so a mistake can be corrected in place. */
function startEditDo(doNo) {
  if (Session.role !== 'SuperAdmin') { toast('Only a Super Admin can edit a DO.', 'error'); return; }
  const d = LAST_DOS.find(x => String(x.DO_No) === String(doNo));
  if (!d) return;
  const form = document.getElementById('doForm');
  form.editingDoNo.value = doNo;
  form.Source.value = d.Source || '';
  form.Mode.value = d.Mode || 'Road';
  form.GST_State.value = d.GST_State || '';
  form.DO_No.value = d.DO_No || '';
  form.DO_Date.value = toDateInputValue(d.DO_Date);
  form.Area.value = d.Area || '';
  form.Mine.value = d.Mine || '';
  form.TraderPurchased.value = d.TraderPurchased || '';
  form.Grade.value = d.Grade || '';
  form.BookQty.value = d.BookQty || '';
  form.Bid.value = d.Bid || '';
  form.BasicPrice.value = d.BasicPrice || '';
  form.ValidUpTo.value = toDateInputValue(d.ValidUpTo);
  form.TransportName.value = d.TransportName || '';
  form.Sold.value = d.Sold || 'No';
  form.SoldToParty.value = d.SoldToParty || '';
  form.RefundExpected.value = d.RefundExpected || '';
  form.RefundReceived.value = d.RefundReceived || '';
  form.EMDForfeiture.value = d.EMDForfeiture || '';
  form.Notes.value = d.Notes || '';
  updateRatePreview();
  updateSoldToPartyVisibility();

  document.getElementById('doEditLabel').textContent = d.DO_No + ' (' + d.Mine + ')';
  document.getElementById('doEditBanner').classList.add('show');
  document.getElementById('doSubmitBtn').textContent = 'Update DO';

  switchToTab('addDo');
}

function cancelDoEdit() {
  const form = document.getElementById('doForm');
  form.reset();
  form.editingDoNo.value = '';
  document.getElementById('doEditBanner').classList.remove('show');
  document.getElementById('doSubmitBtn').textContent = 'Save DO';
  document.getElementById('ratePreview').textContent = 'Enter Basic Price to preview GST18 / IncPF50 / Net Rate →';
  updateSoldToPartyVisibility();
}

/** "Sold to Party" only makes sense once a DO is actually marked Sold. */
function updateSoldToPartyVisibility() {
  const isSold = document.getElementById('doSoldSelect').value === 'Yes';
  document.getElementById('soldToPartyLabel').classList.toggle('hidden', !isSold);
}

/** Converts an ISO datetime (as returned by Apps Script's JSON) to yyyy-mm-dd for a date input. */
function toDateInputValue(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

function switchToTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabName));
}

// ---------- DISPATCH ENTRY ----------
async function loadDispatchTab() {
  try {
    const dos = await apiGet('getActiveDOsForEntry');
    const sel = document.getElementById('dispatchDoSelect');
    sel.innerHTML = '<option value="">-- select DO --</option>' + dos.map(d =>
      `<option value="${escapeHtml(d.DO_No)}" data-balance="${d.Balance}" data-daysleft="${d.DaysLeft}" data-mine="${escapeHtml(d.Mine)}"
               data-bookqty="${d.BookQty}" data-lifted="${d.Lifted}" data-status="${escapeHtml(d.ComputedStatus)}">
        ${escapeHtml(d.DO_No)} | ${escapeHtml(d.Mine)} | Bal: ${fmtNum(d.Balance)} MT |
        ${d.ComputedStatus === 'Expired' ? 'EXPIRED — late entry' : d.DaysLeft + 'd left'}
      </option>`).join('');
    initChoices(sel);
  } catch (err) { onError(err); }
  loadRecentDispatches();
}

function updateDispatchDoInfo() {
  const sel = document.getElementById('dispatchDoSelect');
  const opt = sel.selectedOptions[0];
  const info = document.getElementById('dispatchDoInfo');
  if (!opt || !opt.value) {
    info.textContent = '';
    document.getElementById('dispatchMeterCard').classList.add('hidden');
    return;
  }
  info.innerHTML = `Balance: <b>${fmtNum(opt.dataset.balance)} MT</b> &nbsp;|&nbsp; Days left: <b>${opt.dataset.daysleft}</b> &nbsp;|&nbsp; Mine: <b>${escapeHtml(opt.dataset.mine)}</b>`;
  document.getElementById('dispatchMeterCard').classList.remove('hidden');
  updateMeter();
}

/** Visual progress bar: how much of this DO's book qty is already lifted, and what this entry would add. */
function updateMeter() {
  const sel = document.getElementById('dispatchDoSelect');
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) return;

  const bookQty = parseFloat(opt.dataset.bookqty) || 0;
  const lifted = parseFloat(opt.dataset.lifted) || 0;
  const enteredQty = parseFloat(document.getElementById('dispatchQtyInput').value) || 0;
  const afterLifted = lifted + enteredQty;
  const pctBefore = bookQty ? Math.min((lifted / bookQty) * 100, 100) : 0;
  const pctAfter = bookQty ? Math.min((afterLifted / bookQty) * 100, 100) : 0;
  const over = afterLifted > bookQty + 0.01;

  const fill = document.getElementById('meterFill');
  fill.style.width = pctAfter.toFixed(1) + '%';
  fill.className = 'meter-fill' + (over ? ' over' : (pctAfter >= 90 ? ' warn' : ''));

  document.getElementById('meterText').textContent = `${fmtNum(lifted)} / ${fmtNum(bookQty)} MT (${pctBefore.toFixed(0)}%)`;
  document.getElementById('meterAfterText').textContent = enteredQty
    ? (over ? `⚠ Exceeds book qty by ${fmtNum((afterLifted - bookQty).toFixed(2))} MT` : `After this entry: ${fmtNum(afterLifted.toFixed(2))} MT (${pctAfter.toFixed(0)}%)`)
    : '';
  document.getElementById('meterDaysLeft').textContent = opt.dataset.daysleft + ' day(s) left';
}

async function onSaveDispatch(e) {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const editingTripId = payload.editingTripId;
  delete payload.editingTripId;

  const isOtherParty = payload.SourceType === 'OtherParty';
  const sel = document.getElementById('dispatchDoSelect');
  const selOpt = isOtherParty ? null : sel.selectedOptions[0];
  payload.Mine = selOpt ? selOpt.dataset.mine : '';

  if (isOtherParty && !String(payload.SourceParty || '').trim()) {
    toast('Enter a Source Party name, or switch Source back to Mine.', 'error');
    return;
  }
  if (!isOtherParty && !payload.DO_No) {
    toast('Pick a DO, or switch Source to "Other Party / Trader / Import".', 'error');
    return;
  }

  if (selOpt && selOpt.dataset.status === 'Expired' && !editingTripId) {
    if (!confirm('This DO expired on its Valid Up To date. Log this as a late entry anyway?')) return;
  }
  if (selOpt && parseFloat(payload.Qty) > parseFloat(selOpt.dataset.balance || 0) && !editingTripId) {
    if (!confirm('Qty exceeds remaining DO balance. Save anyway?')) return;
  }

  try {
    let tripId;
    if (editingTripId) {
      await apiPost('updateDispatch', Object.assign({ Trip_ID: editingTripId }, payload));
      toast('Dispatch ' + editingTripId + ' updated.', 'success');
      tripId = editingTripId;
      cancelDispatchEdit();
    } else {
      const res = await apiPost('addDispatch', payload);
      toast('Dispatch ' + res.tripId + ' saved.', 'success');
      tripId = res.tripId;
      form.reset();
      setupDateDefaults();
      onDispatchSourceTypeChange();
    }

    const photoFile = document.getElementById('truckPhotoInput').files[0];
    if (photoFile) await uploadPhotoFor('Dispatch', tripId, 'Truck', photoFile, 'truckPhotoInput');

    loadDispatchTab();
    loadDashboard();
  } catch (err) { onError(err); }
}

/** Dispatches within the picked From/To range (defaults to month-to-date — see
 * defaultDateRangesAll). Every match renders, not capped to a fixed count, since the date
 * range itself is what keeps the table a sane size. */
async function loadRecentDispatches() {
  const dateFrom = document.getElementById('dispatchFilterFrom').value;
  const dateTo = document.getElementById('dispatchFilterTo').value;
  try {
    const rows = await apiGet('getDispatchLog', { dateFrom: dateFrom, dateTo: dateTo });
    LAST_DISPATCHES = rows;
    const tbody = document.querySelector('#recentDispatchTable tbody');
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${r.Date_fmt}</td><td>${escapeHtml(r.DO_No)}</td><td>${escapeHtml(r.TruckNo)}</td>
        <td>${fmtNum(r.Qty)}</td><td>${escapeHtml(r.DestType)}</td><td>${escapeHtml(r.Customer)}</td><td>${fmtNum(r.Amount)}</td>
        <td><button class="btn-row-edit" data-edit-dispatch="${r.Trip_ID}">Edit</button></td>
        <td><button class="btn-row-photo" data-view-media="Dispatch" data-media-id="${r.Trip_ID}">Photos</button></td>
        <td>${Session.role === 'SuperAdmin' ? `<button class="btn-row-edit" data-delete-dispatch="${r.Trip_ID}">Delete</button>` : ''}</td>
      </tr>
    `).join('') || '<tr><td colspan="10">No dispatches in this date range</td></tr>';
  } catch (err) { onError(err); }
}

/** Loads an existing dispatch trip into the Dispatch Entry form so a mistake can be corrected in place. */
function startEditDispatch(tripId) {
  const r = LAST_DISPATCHES.find(x => x.Trip_ID === tripId);
  if (!r) return;
  const form = document.getElementById('dispatchForm');
  form.editingTripId.value = tripId;
  const isOtherParty = r.SourceType === 'OtherParty';
  form.SourceType.value = isOtherParty ? 'OtherParty' : 'Mine';
  onDispatchSourceTypeChange();
  if (isOtherParty) {
    form.SourceParty.value = r.SourceParty || '';
  } else {
    selectDoInDropdown(r.DO_No || '');
  }
  form.Date.value = toDateInputValue(r.Date);
  form.ChallanNo.value = r.ChallanNo || '';
  form.DocumentNo.value = r.DocumentNo || '';
  form.TruckNo.value = r.TruckNo || '';
  form.Qty.value = r.Qty || '';
  form.DestType.value = r.DestType || 'Customer';
  form.Customer.value = r.Customer || '';
  form.SaleRate.value = r.SaleRate || '';
  form.Remarks.value = r.Remarks || '';

  document.getElementById('dispatchMeterCard').classList.add('hidden'); // DO dropdown only lists active DOs; the edited trip's DO may not be in it
  document.getElementById('dispatchEditLabel').textContent = tripId + ' (' + r.TruckNo + ')';
  document.getElementById('dispatchEditBanner').classList.add('show');
  document.getElementById('dispatchSubmitBtn').textContent = 'Update Dispatch';

  switchToTab('dispatch');
}

function cancelDispatchEdit() {
  const form = document.getElementById('dispatchForm');
  form.reset();
  form.editingTripId.value = '';
  setupDateDefaults();
  onDispatchSourceTypeChange();
  document.getElementById('dispatchEditBanner').classList.remove('show');
  document.getElementById('dispatchSubmitBtn').textContent = 'Save Dispatch';
  document.getElementById('dispatchDoInfo').textContent = '';
  document.getElementById('dispatchMeterCard').classList.add('hidden');
}

// ---------- DISPATCH SOURCE TYPE (Mine/DO vs Other Party — replaces the old standalone Yard In form) ----------
/** Toggles the DO dropdown vs the free-text Source Party field. "Other Party" + Destination
 * "Yard" is what used to be the separate Yard In Entry form; now it's one path through here. */
function onDispatchSourceTypeChange() {
  const isOther = document.getElementById('dispatchSourceType').value === 'OtherParty';
  document.getElementById('dispatchMineFields').classList.toggle('hidden', isOther);
  document.getElementById('dispatchOtherPartyField').classList.toggle('hidden', !isOther);
  if (isOther) {
    document.getElementById('dispatchDoSelect').value = '';
    document.getElementById('dispatchDoInfo').textContent = '';
    document.getElementById('dispatchMeterCard').classList.add('hidden');
  }
}

// ---------- YARD OUT ----------
async function onSaveYardOut(e) {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const editingEntryId = payload.editingEntryId;
  delete payload.editingEntryId;
  try {
    if (editingEntryId) {
      await apiPost('updateYardOut', Object.assign({ entryId: editingEntryId }, payload));
      toast('Yard-out entry ' + editingEntryId + ' updated.', 'success');
      cancelYardOutEdit();
    } else {
      await apiPost('addYardOut', payload);
      toast('Yard-out entry saved.', 'success');
      form.reset();
      setupDateDefaults();
    }
    loadYardLedger();
    loadDashboard();
  } catch (err) { onError(err); }
}

/** Loads an existing Yard Out entry into the form so a mistake can be corrected in place. */
function startEditYardOut(entryId) {
  const r = LAST_YARD_LEDGER.find(x => x.Entry_ID === entryId);
  if (!r) return;
  const form = document.getElementById('yardOutForm');
  form.editingEntryId.value = entryId;
  form.Date.value = toDateInputValue(r.Date);
  form.Yard.value = r.Yard || '';
  form.TruckNo.value = r.TruckNo || '';
  form.Qty.value = r.Qty || '';
  form.Material.value = r.Material || '';
  form.Customer.value = r.Party || '';
  form.ChallanNo.value = r.ChallanNo || '';
  form.DocumentNo.value = r.DocumentNo || '';
  form.FreightApplicable.value = r.FreightApplicable || 'No';
  form.Remarks.value = r.Remarks || '';

  document.getElementById('yardOutEditLabel').textContent = entryId + ' (' + r.TruckNo + ')';
  document.getElementById('yardOutEditBanner').classList.add('show');
  document.getElementById('yardOutSubmitBtn').textContent = 'Update Yard Out';
}

function cancelYardOutEdit() {
  const form = document.getElementById('yardOutForm');
  form.reset();
  form.editingEntryId.value = '';
  setupDateDefaults();
  document.getElementById('yardOutEditBanner').classList.remove('show');
  document.getElementById('yardOutSubmitBtn').textContent = 'Save Yard Out';
}

async function loadYardOutTab() {
  loadYardLedger();
  try {
    const stock = await apiGet('getYardStock');
    // Fetched separately from getYardStock (not Promise.all'd together): this action only
    // exists after Code.gs is redeployed with it, and a missing-action error here must not
    // take down the stat cards above, which work fine against an older deployment.
    let materialOut = [];
    try {
      materialOut = await apiGet('getYardMaterialOutBreakdown');
    } catch (materialErr) {
      // Silently degrade — the donut just won't render until Code.gs is redeployed.
    }
    renderYardStockCards(stock, materialOut, 'yardOutChart');
  } catch (err) { onError(err); }
}

/** Compact per-yard stat card (In / Out / Balance + a slim composition bar), with a small
 * Coal/Chura/Stone donut alongside it — used for the "Current Yard Stock" snapshot.
 * Deliberately not the wide comparison bar chart used on the Dashboard: with only 1-2 yards,
 * that chart stretches to fill the page width and leaves most of it empty. Stat tiles read
 * cleanly at any width, including a single yard. The material donut is a global (all-yards)
 * total — rendered once alongside the list rather than repeated per card, since the backend
 * doesn't split Yard Out material by individual yard. */
function renderYardStockCards(yardStock, materialOut, targetId) {
  const el = document.getElementById(targetId);
  if (!yardStock.length) { el.innerHTML = '<div class="chart-empty">No yard movements recorded yet.</div>'; return; }

  const cards = yardStock.map(y => {
    const total = Math.max(y.in, 1);
    const balancePct = Math.max(Math.min((y.balance / total) * 100, 100), 0);
    const outPct = 100 - balancePct;
    return `
      <div class="yard-stock-card">
        <div class="yard-stock-name">${escapeHtml(y.yard)}</div>
        <div class="yard-stock-stats">
          <div class="yard-stat">
            <div class="yard-stat-num" style="color:${VIZ.catBlue}">${fmtNum(y.in)}</div>
            <div class="yard-stat-label">In (MT)</div>
          </div>
          <div class="yard-stat">
            <div class="yard-stat-num" style="color:${VIZ.catOrange}">${fmtNum(y.out)}</div>
            <div class="yard-stat-label">Out (MT)</div>
          </div>
          <div class="yard-stat">
            <div class="yard-stat-num">${fmtNum(y.balance)}</div>
            <div class="yard-stat-label">Balance (MT)</div>
          </div>
        </div>
        <div class="meter-track" data-tt="Still in yard: ${fmtNum(y.balance)} MT (${Math.round(balancePct)}%) — Dispatched out: ${fmtNum(y.out)} MT (${Math.round(outPct)}%)">
          <div class="meter-fill" style="width:${balancePct}%;background:${VIZ.catBlue}"></div>
        </div>
        <div class="meter-footer"><span>Still in yard</span><span>Dispatched out</span></div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="yard-stock-row">
      <div class="yard-stock-list">${cards}</div>
      ${miniMaterialDonutHtml(materialOut || [])}
    </div>
  `;
  wireTooltips(el);
}

/** Small Coal/Chura/Stone donut for the Yard Out snapshot — same palette/logic as the
 * Dashboard's full-size "Yard Out by Material" chart, just sized down and without the big
 * center total (there isn't room for it at this scale). */
function miniMaterialDonutHtml(materialOut) {
  const total = Math.round(materialOut.reduce((s, m) => s + (Number(m.qty) || 0), 0) * 100) / 100;
  if (!total) return '<div class="yard-stock-material"><div class="yard-stock-material-title">Yard Out by Material</div><div class="chart-empty">No yard-out movements yet.</div></div>';

  const palette = { Coal: VIZ.catBlue, Chura: VIZ.catOrange, Stone: VIZ.violet };
  const buckets = materialOut
    .filter(m => m.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .map(m => ({ label: m.material, qty: m.qty, color: palette[m.material] || VIZ.neutral }));

  const R = 34, CX = 40, CY = 40, STROKE = 15;
  const circumference = 2 * Math.PI * R;
  let offsetAcc = 0;
  const GAP = 2;

  const segs = buckets.map(b => {
    const frac = b.qty / total;
    const len = Math.max(frac * circumference - GAP, 0);
    const seg = svgEl('circle', {
      cx: CX, cy: CY, r: R, fill: 'none', stroke: b.color, 'stroke-width': STROKE,
      'stroke-dasharray': `${len} ${circumference - len}`,
      'stroke-dashoffset': -offsetAcc,
      transform: `rotate(-90 ${CX} ${CY})`,
      class: 'viz-donut-seg',
      'data-tt': `${b.label}: ${fmtNum(b.qty)} MT (${Math.round(frac * 100)}%)`
    });
    offsetAcc += frac * circumference;
    return seg;
  }).join('');

  return `
    <div class="yard-stock-material">
      <div class="yard-stock-material-title">Yard Out by Material</div>
      <svg viewBox="0 0 80 80" style="width:110px;height:110px;display:block;">${segs}</svg>
      <div class="viz-legend small">
        ${buckets.map(b => `
          <div class="viz-legend-item"><span class="viz-legend-dot" style="background:${b.color}"></span>${escapeHtml(b.label)}: <b>${fmtNum(b.qty)}</b></div>
        `).join('')}
      </div>
    </div>
  `;
}

/** Yard Ledger within the picked From/To range (defaults to month-to-date). Edit/Delete only
 * ever show on Type=OUT rows — a Type=IN row is always tied to its originating dispatch trip
 * (see updateYardOut/deleteYardEntry), so it's corrected/removed from Dispatch Entry instead. */
async function loadYardLedger() {
  const dateFrom = document.getElementById('yardOutFilterFrom').value;
  const dateTo = document.getElementById('yardOutFilterTo').value;
  try {
    const rows = await apiGet('getYardLedger', { dateFrom: dateFrom, dateTo: dateTo });
    LAST_YARD_LEDGER = rows;
    const tbody = document.querySelector('#yardLedgerTable tbody');
    tbody.innerHTML = rows.map(r => `
      <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.Type)}</td><td>${escapeHtml(r.Yard)}</td>
      <td>${escapeHtml(r.Party)}</td><td>${escapeHtml(r.PartyType)}</td><td>${escapeHtml(r.TruckNo)}</td><td>${fmtNum(r.Qty)}</td>
      <td>${r.Type === 'OUT' ? `<button class="btn-row-edit" data-edit-yardout="${r.Entry_ID}">Edit</button>` : ''}</td>
      <td>${r.Type === 'OUT' && Session.role === 'SuperAdmin' ? `<button class="btn-row-edit" data-delete-yardout="${r.Entry_ID}">Delete</button>` : ''}</td></tr>
    `).join('') || '<tr><td colspan="9">No entries in this date range</td></tr>';
  } catch (err) { onError(err); }
}

// ---------- FREIGHT ----------
async function loadFreightMasters() {
  try {
    FREIGHT_MASTERS = await apiGet('getFreightMasters');
    fillDatalist('transportersList', FREIGHT_MASTERS.Transporters);
    fillSelect('processEntity', FREIGHT_MASTERS.Entities);
    fillSelect('additionReasonSelect', FREIGHT_MASTERS.AdditionReasons);
    fillSelect('deductionReasonSelect', FREIGHT_MASTERS.DeductionReasons);
    fillSelect('paymentReasonSelect', FREIGHT_MASTERS.PaymentReasons);
    fillSelect('reportEntity', FREIGHT_MASTERS.Entities);
  } catch (err) { onError(err); }
}

async function loadQueue() {
  try {
    const rows = await apiGet('getFreightQueue');
    document.querySelector('#queueTable tbody').innerHTML = rows.map(r => `
      <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.Description)}</td><td>${escapeHtml(r.MineYard)}</td>
      <td>${escapeHtml(r.Party)}</td><td>${escapeHtml(r.TruckNo)}</td><td>${fmtNum(r.Qty)}</td>
      <td><button type="button" data-process='${JSON.stringify(r)}'>Process</button></td></tr>
    `).join('') || '<tr><td colspan="8">No trips waiting — nothing flagged Freight Applicable = Yes yet.</td></tr>';

    document.querySelectorAll('[data-process]').forEach(btn => {
      btn.addEventListener('click', () => openProcessModal(JSON.parse(btn.dataset.process)));
    });
  } catch (err) { onError(err); }
}

function setupProcessModal() {
  document.getElementById('btnCancelProcess').addEventListener('click', closeProcessModal);
  document.getElementById('btnAddStandaloneFreight').addEventListener('click', openStandaloneFreightModal);
  document.getElementById('processOverlay').addEventListener('click', e => {
    if (e.target.id === 'processOverlay') closeProcessModal();
  });
  document.getElementById('processForm').addEventListener('submit', onSaveProcess);
  ['FreightRate', 'Toll', 'Hamali', 'WaitingCharges', 'Misc', 'ManualQty'].forEach(name => {
    document.querySelector(`#processForm [name="${name}"]`).addEventListener('input', updateGrossPreview);
  });
}

function openProcessModal(item) {
  CURRENT_QUEUE_ITEM = item;
  document.getElementById('processForm').reset();
  document.getElementById('processManualFields').classList.add('hidden');
  // Pre-fill from the trip's DO (TransportName) when known — still editable, since the actual
  // truck on a given trip can differ from what's registered against the DO.
  document.querySelector('#processForm [name="Transporter"]').value = item.Transporter || '';
  document.getElementById('processTripLabel').textContent =
    item.Description + ' — Truck ' + item.TruckNo + ', ' + fmtNum(item.Qty) + ' MT, ' + item.Date_fmt +
    (item.DocumentNo ? ' — Doc# ' + item.DocumentNo : '');
  updateGrossPreview();
  document.getElementById('processOverlay').classList.remove('hidden');
}

/** Freight paid for a movement that never came through Dispatch/Yard (or was never flagged) —
 * no LinkedType/LinkedID, so Document No. becomes the only anchor back to the physical trip. */
function openStandaloneFreightModal() {
  CURRENT_QUEUE_ITEM = null;
  document.getElementById('processForm').reset();
  document.getElementById('processManualFields').classList.remove('hidden');
  document.getElementById('processTripLabel').textContent = 'Standalone entry — no linked Dispatch/Yard trip';
  setupDateDefaults();
  updateGrossPreview();
  document.getElementById('processOverlay').classList.remove('hidden');
}

function closeProcessModal() {
  document.getElementById('processOverlay').classList.add('hidden');
  document.getElementById('processManualFields').classList.add('hidden');
  CURRENT_QUEUE_ITEM = null;
}

function updateGrossPreview() {
  const form = document.getElementById('processForm');
  const fd = new FormData(form);
  const qty = CURRENT_QUEUE_ITEM ? (Number(CURRENT_QUEUE_ITEM.Qty) || 0) : (Number(fd.get('ManualQty')) || 0);
  const rate = Number(fd.get('FreightRate')) || 0;
  const freightAmount = Math.round(qty * rate * 100) / 100;
  const extras = ['Toll', 'Hamali', 'WaitingCharges', 'Misc'].reduce((s, k) => s + (Number(fd.get(k)) || 0), 0);
  const gross = Math.round((freightAmount + extras) * 100) / 100;
  document.getElementById('processGrossPreview').innerHTML =
    `<div class="do-info">Freight Amount: ₹${fmtNum(freightAmount)} &nbsp; | &nbsp; <strong>Gross Payable: ₹${fmtNum(gross)}</strong></div>`;
}

async function onSaveProcess(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target).entries());
  let payload;
  if (CURRENT_QUEUE_ITEM) {
    payload = Object.assign({}, fd, {
      LinkedType: CURRENT_QUEUE_ITEM.LinkedType, LinkedID: CURRENT_QUEUE_ITEM.LinkedID,
      DocumentNo: CURRENT_QUEUE_ITEM.DocumentNo || '',
      Date: CURRENT_QUEUE_ITEM.Date_fmt.split('.').reverse().join('-'),
      MineYard: CURRENT_QUEUE_ITEM.MineYard, Party: CURRENT_QUEUE_ITEM.Party,
      TruckNo: CURRENT_QUEUE_ITEM.TruckNo, Qty: CURRENT_QUEUE_ITEM.Qty
    });
  } else {
    if (!fd.ManualDocumentNo || !fd.ManualDocumentNo.trim()) {
      toast('Document No. is required for a standalone freight record.', 'error');
      return;
    }
    payload = Object.assign({}, fd, {
      DocumentNo: fd.ManualDocumentNo, Date: fd.ManualDate, TruckNo: fd.ManualTruckNo,
      Qty: fd.ManualQty, MineYard: fd.ManualMineYard, Party: fd.ManualParty
    });
  }
  try {
    const res = await apiPost('createFreightRecord', payload);
    toast('Freight record ' + res.freightId + ' created.', 'success');
    closeProcessModal();
    loadQueue();
    loadLedger();
  } catch (err) { onError(err); }
}

let LAST_LEDGER_ROWS = []; // for the Freight Ledger table's Status/Entity/date-range filters

async function loadLedger() {
  try {
    LAST_LEDGER_ROWS = await apiGet('getFreightLedgerList');
    renderLedgerTable();
  } catch (err) { onError(err); }
}

function renderLedgerTable() {
  const docNo = document.getElementById('ledgerFilterDocNo').value.trim().toLowerCase();
  const truckNo = document.getElementById('ledgerFilterTruckNo').value.trim().toLowerCase();
  const status = document.getElementById('ledgerFilterStatus').value;
  const entity = document.getElementById('ledgerFilterEntity').value;
  const from = document.getElementById('ledgerFilterFrom').value ? new Date(document.getElementById('ledgerFilterFrom').value) : null;
  const to = document.getElementById('ledgerFilterTo').value ? new Date(document.getElementById('ledgerFilterTo').value) : null;

  const rows = LAST_LEDGER_ROWS.filter(r => {
    if (docNo && !String(r.DocumentNo || '').toLowerCase().includes(docNo)) return false;
    if (truckNo && !String(r.TruckNo || '').toLowerCase().includes(truckNo)) return false;
    if (status && r.Status !== status) return false;
    if (entity && r.Entity !== entity) return false;
    if (from || to) {
      const d = r.Date ? new Date(r.Date) : null;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    return true;
  });

  document.querySelector('#ledgerTable tbody').innerHTML = rows.map(r => `
    <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.Entity)}</td><td>${escapeHtml(r.PayeeName)}</td>
    <td>${escapeHtml(r.Transporter)}</td><td>${escapeHtml(r.TruckNo)}</td><td>${fmtNum(r.NetPayable)}</td><td>${fmtNum(r.TotalPaid)}</td><td>${fmtNum(r.Balance)}</td>
    <td>${escapeHtml(r.Status)}</td>
    <td><button type="button" data-open-detail="${escapeHtml(r.FreightID)}">Details</button></td>
    <td>${Session.role === 'SuperAdmin' ? `<button class="btn-row-edit" data-delete-freight="${escapeHtml(r.FreightID)}">Delete</button>` : ''}</td></tr>
  `).join('') || '<tr><td colspan="12">No freight records match these filters.</td></tr>';

  document.querySelectorAll('[data-open-detail]').forEach(btn => {
    btn.addEventListener('click', () => openDetailModal(btn.dataset.openDetail));
  });
}

function setupDetailModal() {
  document.getElementById('btnCloseDetail').addEventListener('click', closeDetailModal);
  document.getElementById('detailOverlay').addEventListener('click', e => {
    if (e.target.id === 'detailOverlay') closeDetailModal();
  });
  document.getElementById('addAdditionForm').addEventListener('submit', onAddAddition);
  document.getElementById('addDeductionForm').addEventListener('submit', onAddDeduction);
  document.getElementById('addPaymentForm').addEventListener('submit', onAddPayment);
}

async function openDetailModal(freightId) {
  CURRENT_FREIGHT_ID = freightId;
  await refreshDetail();
  document.getElementById('detailOverlay').classList.remove('hidden');
}

function closeDetailModal() {
  document.getElementById('detailOverlay').classList.add('hidden');
  CURRENT_FREIGHT_ID = null;
  loadLedger();
}

async function refreshDetail() {
  if (!CURRENT_FREIGHT_ID) return;
  try {
    const data = await apiGet('getFreightRecord', { freightId: CURRENT_FREIGHT_ID });
    const l = data.ledger;
    document.getElementById('detailTitle').textContent = l.FreightID + ' — ' + l.PayeeName + ' (' + l.Entity + ')';
    document.getElementById('detailSummary').innerHTML = `
      <div class="do-info">
        Doc# ${escapeHtml(l.DocumentNo)} — Truck ${escapeHtml(l.TruckNo)} — ${fmtNum(l.Qty)} MT — ${l.Date_fmt}<br>
        Freight Amount: ₹${fmtNum(l.FreightAmount)} &nbsp; Total Additions: ₹${fmtNum(l.TotalAdditions)} &nbsp; <strong>Gross Payable: ₹${fmtNum(l.GrossPayable)}</strong><br>
        Total Deductions: ₹${fmtNum(l.TotalDeductions)} &nbsp; <strong>Net Payable: ₹${fmtNum(l.NetPayable)}</strong><br>
        Total Paid: ₹${fmtNum(l.TotalPaid)} &nbsp; <strong>Balance: ₹${fmtNum(l.Balance)}</strong> &nbsp; Status: <strong>${escapeHtml(l.Status)}</strong>
      </div>`;
    document.querySelector('#additionsTable tbody').innerHTML = data.additions.map(a => `
      <tr><td>${escapeHtml(a.Reason)}</td><td>${fmtNum(a.Amount)}</td><td>${escapeHtml(a.Remarks)}</td></tr>
    `).join('') || '<tr><td colspan="3">No additions yet.</td></tr>';
    document.querySelector('#deductionsTable tbody').innerHTML = data.deductions.map(d => `
      <tr><td>${escapeHtml(d.Reason)}</td><td>${fmtNum(d.Amount)}</td><td>${escapeHtml(d.Remarks)}</td></tr>
    `).join('') || '<tr><td colspan="3">No deductions yet.</td></tr>';
    document.querySelector('#paymentsTable tbody').innerHTML = data.payments.map(p => `
      <tr><td>${escapeHtml(p.Reason)}</td><td>${fmtNum(p.Amount)}</td><td>${p.Date_fmt}</td><td>${escapeHtml(p.Mode)}</td><td>${escapeHtml(p.RefNo)}</td><td>${escapeHtml(p.Remarks)}</td></tr>
    `).join('') || '<tr><td colspan="6">No payments yet.</td></tr>';
  } catch (err) { onError(err); }
}

async function onAddAddition(e) {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  payload.freightId = CURRENT_FREIGHT_ID;
  try {
    await apiPost('addAddition', payload);
    e.target.reset();
    toast('Addition added.', 'success');
    refreshDetail();
  } catch (err) { onError(err); }
}

async function onAddDeduction(e) {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  payload.freightId = CURRENT_FREIGHT_ID;
  try {
    await apiPost('addDeduction', payload);
    e.target.reset();
    toast('Deduction added.', 'success');
    refreshDetail();
  } catch (err) { onError(err); }
}

async function onAddPayment(e) {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  payload.freightId = CURRENT_FREIGHT_ID;
  try {
    await apiPost('addPayment', payload);
    e.target.reset();
    toast('Payment added.', 'success');
    refreshDetail();
  } catch (err) { onError(err); }
}

// ---------- REPORTS ----------
async function loadReportDoSelect() {
  if (DO_ROLES.indexOf(Session.role) === -1) return; // this role has no DO-wise Statement option to fill
  try {
    const dos = await apiGet('getDOList');
    const sel = document.getElementById('reportDoSelect');
    sel.innerHTML = dos.map(d => `<option value="${escapeHtml(d.DO_No)}">${escapeHtml(d.DO_No)} | ${escapeHtml(d.Mine)}</option>`).join('');
    initChoices(sel);
  } catch (err) { onError(err); }
}

// ---------- REPORT PICKER (single dropdown, params shown per report type) ----------
// `roles` decides which of these show up in #reportTypeSelect for the current session — see
// populateReportTypeOptions(). The backend enforces the same restriction independently.
const REPORT_META = {
  doStatement: { label: 'DO-wise Statement — every trip against one DO', fn: viewDoStatement, roles: DO_ROLES },
  dispatchRange: { label: 'Dispatch Report — every truck movement in a date range', fn: viewDispatchRangeReport, roles: DO_ROLES },
  expired: { label: 'Expired DO Register — unfulfilled balance / EMD tracking', fn: viewExpiredReport, roles: DO_ROLES },
  customerWise: { label: 'Customer-wise Statement — every trip billed to one customer', fn: viewCustomerWiseReport, roles: DO_ROLES },
  truckWise: { label: 'Truck-wise Summary — trips & qty per truck', fn: viewTruckWiseReport, roles: DO_ROLES },
  mineWise: { label: 'Mine-wise Statement — every DO tied to one mine', fn: viewMineWiseReport, roles: DO_ROLES },
  emdForfeiture: { label: 'EMD Forfeiture — forfeitable qty on expired DOs', fn: viewEmdForfeitureReport, roles: DO_ROLES },
  yardStockRange: { label: 'Yard Stock — opening/closing in a date range', fn: viewYardStockRangeReport, roles: DO_ROLES },
  doBalanceAsOf: { label: 'DO Balance — as of a chosen date (not live)', fn: viewDOBalanceAsOfReport, roles: DO_ROLES },
  entityLedger: { label: 'Freight — Entity Ledger (TRL / TL)', fn: viewEntityLedgerReport, roles: FREIGHT_ROLES },
  outstanding: { label: 'Freight — Outstanding Balances', fn: viewOutstandingReport, roles: FREIGHT_ROLES },
  masterFreight: { label: 'Freight — Master Report (every record, every column)', fn: viewMasterFreightReport, roles: FREIGHT_ROLES },
  combined: { label: 'Combined — Master Report, every column, by Document No.', fn: viewCombinedReport, roles: ['SuperAdmin'] }
};

/** Rebuilds #reportTypeSelect with only the report types this session's role is allowed to run —
 * the dropdown used to be a static list of DO-only reports; it's now driven by REPORT_META so
 * both modules' reports (and the SuperAdmin-only combined view) share the one picker. */
function populateReportTypeOptions() {
  const sel = document.getElementById('reportTypeSelect');
  sel.innerHTML = Object.entries(REPORT_META)
    .filter(([, meta]) => meta.roles.indexOf(Session.role) !== -1)
    .map(([key, meta]) => `<option value="${key}">${escapeHtml(meta.label)}</option>`).join('');
  updateReportParamVisibility();
}

function updateReportParamVisibility() {
  const selected = document.getElementById('reportTypeSelect').value;
  document.querySelectorAll('#reportParams [data-param]').forEach(el => {
    el.classList.toggle('hidden', el.dataset.param !== selected);
  });
}

async function viewSelectedReport() {
  const selected = document.getElementById('reportTypeSelect').value;
  const meta = REPORT_META[selected];
  if (!meta) return;
  document.getElementById('reportResultTitle').textContent = 'Currently viewing: ' + meta.label;
  document.getElementById('reportResultExtra').innerHTML = '';
  document.getElementById('reportTableHead').innerHTML = '';
  document.getElementById('reportTableBody').innerHTML = truckLoadingRow(20, 'Fetching your report…');
  await meta.fn();
}

async function viewDoStatement() {
  const doNo = document.getElementById('reportDoSelect').value;
  if (!doNo) return;
  try {
    const data = await apiGet('getDOWiseStatement', { doNo: doNo });

    // Split what's already lifted by where it went — direct customer sale vs. yard-bound —
    // so the balance question ("where has the material gone?") is answered at a glance
    // instead of making the user manually tally the Dest column row by row.
    const toCustomer = round2ish(data.trips.filter(t => t.DestType !== 'Yard').reduce((s, t) => s + (Number(t.Qty) || 0), 0));
    const toYard = round2ish(data.trips.filter(t => t.DestType === 'Yard').reduce((s, t) => s + (Number(t.Qty) || 0), 0));
    document.getElementById('reportResultExtra').innerHTML = `
      <div class="chart-card">
        <div class="chart-title">Where has this DO's material gone?</div>
        <div class="chart-sub">Book Qty ${fmtNum(data.do.BookQty)} MT — ${fmtNum(toCustomer)} MT direct to customers, ${fmtNum(toYard)} MT to yard, ${fmtNum(data.do.Balance)} MT still unlifted.
          ${toYard > 0 ? ' Note: once at the yard, coal is no longer traceable back to this specific DO — later yard-out sales aren\'t linked here.' : ''}</div>
      </div>`;

    document.getElementById('reportTableHead').innerHTML =
      `<tr><th colspan="11">DO ${escapeHtml(data.do.DO_No)} — ${escapeHtml(data.do.Mine)} — Balance: ${fmtNum(data.do.Balance)} MT — Status: ${data.do.ComputedStatus}</th></tr>
       <tr><th>DO No.</th><th>Challan No.</th><th>Source</th><th>Mine/Yard</th><th>Date</th><th>Document No.</th><th>Truck</th><th>Qty</th><th>Customer</th><th>Dest</th><th>Amount</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = data.trips.map(t => `
      <tr><td>${escapeHtml(t.DO_No)}</td><td>${escapeHtml(t.ChallanNo)}</td>
      <td>${escapeHtml(data.do.Source)}</td><td>${escapeHtml(data.do.Mine)}</td><td>${t.Date_fmt}</td><td>${escapeHtml(t.DocumentNo)}</td><td>${escapeHtml(t.TruckNo)}</td>
      <td>${fmtNum(t.Qty)}</td><td>${escapeHtml(t.Customer)}</td><td>${escapeHtml(t.DestType)}</td><td>${fmtNum(t.Amount)}</td></tr>
    `).join('') || '<tr><td colspan="11">No dispatches yet against this DO</td></tr>';
  } catch (err) { onError(err); }
}

/** Every truck movement in a date range — mine->customer, mine->yard, yard->customer, and
 * other-party->yard all show up here in one Origin/Destination timeline, not just DO-linked
 * dispatch trips. */
async function viewDispatchRangeReport() {
  const dateFrom = document.getElementById('reportDispatchFrom').value;
  const dateTo = document.getElementById('reportDispatchTo').value;
  const typeFilter = document.getElementById('reportDispatchMovementType').value;
  if (!dateFrom || !dateTo) { toast('Pick both a from and to date.', 'error'); return; }
  try {
    let rows = await apiGet('getDispatchReportByDateRange', { dateFrom: dateFrom, dateTo: dateTo });
    if (typeFilter) rows = rows.filter(r => r.MovementType === typeFilter);

    const totals = {};
    rows.forEach(r => { totals[r.MovementType] = (totals[r.MovementType] || 0) + (Number(r.Qty) || 0); });
    document.getElementById('reportResultExtra').innerHTML = `
      <div class="chart-card">
        <div class="chart-title">Movement totals for this period</div>
        <div class="chart-sub">${Object.entries(totals).map(([k, v]) => `${escapeHtml(k)}: <b>${fmtNum(round2ish(v))} MT</b>`).join(' &nbsp;|&nbsp; ') || 'No movements found'}</div>
      </div>`;

    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>DO No.</th><th>Challan No.</th><th>Source</th><th>Mine/Yard</th><th>Date</th><th>Document No.</th><th>Truck</th><th>Qty</th><th>Customer</th><th>Rate</th><th>Amount</th><th>Movement Type</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${escapeHtml(r.DO_No)}</td><td>${escapeHtml(r.ChallanNo)}</td>
      <td>${escapeHtml(r.Source)}</td><td>${escapeHtml(r.Mine)}</td><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.TruckNo)}</td>
      <td>${fmtNum(r.Qty)}</td><td>${escapeHtml(r.Customer)}</td><td>${fmtNum(r.SaleRate)}</td><td>${fmtNum(r.Amount)}</td><td>${escapeHtml(r.MovementType)}</td></tr>
    `).join('') || '<tr><td colspan="12">No movements in this date range</td></tr>';
  } catch (err) { onError(err); }
}

async function viewMineWiseReport() {
  const mine = document.getElementById('reportMineInput').value.trim();
  if (!mine) { toast('Enter or pick a mine first.', 'error'); return; }
  try {
    const data = await apiGet('getMineWiseStatement', { mine: mine });
    document.getElementById('reportResultExtra').innerHTML = '';
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th colspan="8">${escapeHtml(data.mine)} — ${data.doCount} DO(s) — Booked: ${fmtNum(data.totalBooked)} MT | Lifted: ${fmtNum(data.totalLifted)} MT | Balance: ${fmtNum(data.totalBalance)} MT</th></tr>
       <tr><th>DO No.</th><th>Area</th><th>Grade</th><th>Book Qty</th><th>Lifted</th><th>Balance</th><th>Valid Up To</th><th>Status</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = data.dos.map(d => `
      <tr><td>${escapeHtml(d.DO_No)}</td><td>${escapeHtml(d.Area)}</td><td>${escapeHtml(d.Grade)}</td>
      <td>${fmtNum(d.BookQty)}</td><td>${fmtNum(d.Lifted)}</td><td>${fmtNum(d.Balance)}</td><td>${d.ValidUpTo_fmt}</td><td>${escapeHtml(d.ComputedStatus)}</td></tr>
    `).join('') || '<tr><td colspan="8">No DOs found for this mine</td></tr>';
  } catch (err) { onError(err); }
}

async function viewEmdForfeitureReport() {
  try {
    document.getElementById('reportResultExtra').innerHTML = '';
    const rows = await apiGet('getEMDForfeitureReport');
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>DO No.</th><th>Mine</th><th>Valid Up To</th><th>Book Qty</th><th>Leftover Qty</th><th>Tolerance (10%)</th><th>Forfeitable Qty</th><th>Forfeiture Amount (₹)</th><th>EMD Forfeiture</th><th>Refund Expected</th><th>Refund Received</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${escapeHtml(r.DO_No)}</td><td>${escapeHtml(r.Mine)}</td><td>${r.ValidUpTo_fmt}</td>
      <td>${fmtNum(r.BookQty)}</td><td>${fmtNum(r.LeftoverQty)}</td><td>${fmtNum(r.ToleranceQty)}</td><td>${fmtNum(r.ForfeitableQty)}</td><td>${fmtNum(r.ForfeitureAmount)}</td>
      <td>${escapeHtml(r.EMDForfeiture)}</td><td>${escapeHtml(r.RefundExpected)}</td><td>${escapeHtml(r.RefundReceived)}</td></tr>
    `).join('') || '<tr><td colspan="11">No expired DOs with a forfeitable balance</td></tr>';
  } catch (err) { onError(err); }
}

async function viewYardStockRangeReport() {
  const dateFrom = document.getElementById('reportYardFrom').value;
  const dateTo = document.getElementById('reportYardTo').value;
  if (!dateFrom || !dateTo) { toast('Pick both a from and to date.', 'error'); return; }
  try {
    const data = await apiGet('getYardStockByDateRange', { dateFrom: dateFrom, dateTo: dateTo });
    document.getElementById('reportResultExtra').innerHTML = `
      <div class="chart-card">
        <div class="chart-title">Yard Summary</div>
        <table class="mini-table">
          <thead><tr><th>Yard</th><th>Opening Stock</th><th>IN (period)</th><th>OUT (period)</th><th>Closing Stock</th></tr></thead>
          <tbody>${data.summary.map(r => `
            <tr><td>${escapeHtml(r.yard)}</td><td>${fmtNum(r.opening)}</td><td>${fmtNum(r.rangeIn)}</td><td>${fmtNum(r.rangeOut)}</td><td>${fmtNum(r.closing)}</td></tr>
          `).join('') || '<tr><td colspan="5">No yard activity found</td></tr>'}</tbody>
        </table>
      </div>`;
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>Source</th><th>Mine/Yard</th><th>Date</th><th>Document No.</th><th>Challan No.</th><th>Truck</th><th>Qty</th><th>Party</th><th>Movement</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = data.movements.map(r => `
      <tr><td>${escapeHtml(r.Source)}</td><td>${escapeHtml(r.Mine)}</td><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td>
      <td>${escapeHtml(r.ChallanNo)}</td><td>${escapeHtml(r.TruckNo)}</td><td>${fmtNum(r.Qty)}</td><td>${escapeHtml(r.Customer)}</td>
      <td>${r.Type === 'IN' ? 'Yard In' : 'Yard Out'}</td></tr>
    `).join('') || '<tr><td colspan="9">No truck movements in this date range</td></tr>';
  } catch (err) { onError(err); }
}

/** Every DO's balance as it stood on a chosen date, not "as of right now" — only counts
 * dispatch trips dated on or before that date. Status shown is still today's (Active/Expired
 * etc. isn't re-derived for the past) since this report is about the quantity, not history. */
async function viewDOBalanceAsOfReport() {
  const asOfDate = document.getElementById('reportDoBalanceAsOfDate').value;
  if (!asOfDate) { toast('Pick a date.', 'error'); return; }
  try {
    const rows = await apiGet('getDOBalanceAsOfDate', { asOfDate: asOfDate });
    const totalBooked = round2ish(rows.reduce((s, r) => s + (Number(r.BookQty) || 0), 0));
    const totalLifted = round2ish(rows.reduce((s, r) => s + (Number(r.Lifted) || 0), 0));
    const totalBalance = round2ish(rows.reduce((s, r) => s + (Number(r.Balance) || 0), 0));
    document.getElementById('reportResultExtra').innerHTML =
      `<div class="do-info">As of ${escapeHtml(asOfDate.split('-').reverse().join('.'))} — Booked: ${fmtNum(totalBooked)} MT &nbsp; Lifted: ${fmtNum(totalLifted)} MT &nbsp; <strong>Balance: ${fmtNum(totalBalance)} MT</strong></div>`;
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>DO No.</th><th>Source</th><th>Mine</th><th>Grade</th><th>Area</th><th>Book Qty</th><th>Lifted (as of date)</th><th>Balance (as of date)</th><th>Valid Up To</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${escapeHtml(r.DO_No)}</td><td>${escapeHtml(r.Source)}</td><td>${escapeHtml(r.Mine)}</td><td>${escapeHtml(r.Grade)}</td><td>${escapeHtml(r.Area)}</td>
      <td>${fmtNum(r.BookQty)}</td><td>${fmtNum(r.Lifted)}</td><td>${fmtNum(r.Balance)}</td><td>${r.ValidUpTo_fmt}</td></tr>
    `).join('') || '<tr><td colspan="9">No DOs found.</td></tr>';
  } catch (err) { onError(err); }
}

/** Every truck movement in a date range regardless of type — mine->customer, mine->yard,
 * yard->customer, or other-party->yard — merged into one Origin/Destination timeline. */
async function viewExpiredReport() {
  try {
    const rows = await apiGet('getExpiredDOsReport');
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>DO No.</th><th>Mine</th><th>Grade</th><th>Book Qty</th><th>Balance</th><th>Valid Up To</th><th>EMD Forfeiture</th><th>Refund Expected</th><th>Refund Received</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${escapeHtml(r.DO_No)}</td><td>${escapeHtml(r.Mine)}</td><td>${escapeHtml(r.Grade)}</td>
      <td>${fmtNum(r.BookQty)}</td><td>${fmtNum(r.Balance)}</td><td>${r.ValidUpTo_fmt}</td>
      <td>${escapeHtml(r.EMDForfeiture)}</td><td>${escapeHtml(r.RefundExpected)}</td><td>${escapeHtml(r.RefundReceived)}</td></tr>
    `).join('') || '<tr><td colspan="9">No expired DOs with pending balance</td></tr>';
  } catch (err) { onError(err); }
}

async function viewCustomerWiseReport() {
  const customer = document.getElementById('reportCustomerInput').value.trim();
  if (!customer) { toast('Enter or pick a customer first.', 'error'); return; }
  try {
    const data = await apiGet('getCustomerWiseStatement', { customer: customer });
    document.getElementById('reportResultExtra').innerHTML = '<div class="chart-card"><div class="chart-title">Dispatch Trend</div><div class="chart-sub">Quantity lifted per day (MT)</div><div id="customerTrendChart"></div></div>';
    renderCustomerTrendChart(data.trips);
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th colspan="9">${escapeHtml(data.customer)} — ${data.tripCount} trip(s) — Total: ${fmtNum(data.totalQty)} MT / ₹${fmtNum(data.totalAmount)}</th></tr>
       <tr><th>DO No.</th><th>Challan No.</th><th>Source</th><th>Mine/Yard</th><th>Date</th><th>Document No.</th><th>Truck</th><th>Qty</th><th>Amount</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = data.trips.map(t => `
      <tr><td>${escapeHtml(t.DO_No)}</td><td>${escapeHtml(t.ChallanNo)}</td>
      <td>${escapeHtml(t.Source)}</td><td>${escapeHtml(t.Mine)}</td><td>${t.Date_fmt}</td><td>${escapeHtml(t.DocumentNo)}</td><td>${escapeHtml(t.TruckNo)}</td>
      <td>${fmtNum(t.Qty)}</td><td>${fmtNum(t.Amount)}</td></tr>
    `).join('') || '<tr><td colspan="9">No trips found for this customer</td></tr>';
  } catch (err) { onError(err); }
}

/** Groups a customer's trips by date and draws a simple bar chart — gives a quick read
 * on lifting cadence (steady drip vs. bursty) without leaving the report view. */
function renderCustomerTrendChart(trips) {
  const el = document.getElementById('customerTrendChart');
  if (!trips.length) { el.innerHTML = '<div class="chart-empty">No trips to chart yet.</div>'; return; }

  const byDate = {};
  trips.forEach(t => { byDate[t.Date_fmt] = (byDate[t.Date_fmt] || 0) + (Number(t.Qty) || 0); });
  const points = Object.entries(byDate)
    .map(([date, qty]) => ({ date, qty: round2ish(qty) }))
    .sort((a, b) => new Date(a.date.split('.').reverse().join('-')) - new Date(b.date.split('.').reverse().join('-')));

  const W = 460, PAD_L = 36, PAD_R = 12, PAD_T = 10, PAD_B = 28, H = 160;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = Math.max(...points.map(p => p.qty), 1);
  const bw = Math.min(28, plotW / points.length - 6);

  const bars = points.map((p, i) => {
    const x = PAD_L + (i + 0.5) * (plotW / points.length) - bw / 2;
    const h = (p.qty / max) * plotH;
    const y = PAD_T + (plotH - h);
    return `
      <rect class="chart-bar-mark" data-tt="${escapeHtml(p.date)}: ${fmtNum(p.qty)} MT" x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${VIZ.catBlue}"></rect>
      <text x="${x + bw / 2}" y="${H - PAD_B + 14}" text-anchor="middle" font-size="9" fill="var(--viz-text-muted)">${escapeHtml(p.date.slice(0, 5))}</text>
    `;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px">${bars}</svg>`;
  wireTooltips(el);
}

function round2ish(n) { return Math.round(n * 100) / 100; }

async function viewTruckWiseReport() {
  try {
    const rows = await apiGet('getTruckWiseSummary');
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>Truck No.</th><th>Trips</th><th>Total Qty (MT)</th><th>Customers Served</th><th>DOs Touched</th><th>Last Trip</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${escapeHtml(r.TruckNo)}</td><td>${r.TripCount}</td><td>${fmtNum(r.TotalQty)}</td>
      <td>${r.CustomerCount}</td><td>${r.DOCount}</td><td>${r.LastTrip_fmt}</td></tr>
    `).join('') || '<tr><td colspan="6">No dispatch trips recorded yet</td></tr>';
  } catch (err) { onError(err); }
}

// ---------- FREIGHT REPORTS ----------
async function viewEntityLedgerReport() {
  const entity = document.getElementById('reportEntity').value;
  const dateFrom = document.getElementById('reportEntityFrom').value;
  const dateTo = document.getElementById('reportEntityTo').value;
  if (!entity) { toast('Pick an entity (TRL or TL).', 'error'); return; }
  try {
    const data = await apiGet('getEntityLedgerReport', { entity: entity, dateFrom: dateFrom, dateTo: dateTo });
    document.getElementById('reportResultExtra').innerHTML =
      `<div class="do-info">Gross: ₹${fmtNum(data.totalGross)} &nbsp; Net: ₹${fmtNum(data.totalNet)} &nbsp; Paid: ₹${fmtNum(data.totalPaid)} &nbsp; <strong>Outstanding: ₹${fmtNum(data.totalBalance)}</strong></div>`;
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>Date</th><th>Document No.</th><th>Customer</th><th>Payee</th><th>Truck</th><th>Transporter</th><th>Net Payable</th><th>Paid</th><th>Balance</th><th>Status</th><th>POD</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = data.rows.map(r => `
      <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.Party)}</td><td>${escapeHtml(r.PayeeName)}</td><td>${escapeHtml(r.TruckNo)}</td>
      <td>${escapeHtml(r.Transporter)}</td><td>${fmtNum(r.NetPayable)}</td><td>${fmtNum(r.TotalPaid)}</td><td>${fmtNum(r.Balance)}</td>
      <td>${escapeHtml(r.Status)}</td><td>${escapeHtml(r.PODReceived)}</td></tr>
    `).join('') || '<tr><td colspan="11">No records for this entity/date range.</td></tr>';
  } catch (err) { onError(err); }
}

/** The freight team's master view: every column of every Freight_Ledger record, one row each —
 * Date, Document No., Entity, Customer, Transporter, Payee, Truck, Weight, Freight, Additions
 * (everything piled on top of the base freight amount), Deductions, Net Payable, Paid, Balance,
 * POD. Date range is optional — leave blank to see every record ever processed. */
async function viewMasterFreightReport() {
  const dateFrom = document.getElementById('reportMasterFrom').value;
  const dateTo = document.getElementById('reportMasterTo').value;
  try {
    const rows = await apiGet('getMasterFreightReport', { dateFrom: dateFrom, dateTo: dateTo });
    const totalFreight = round2ish(rows.reduce((s, r) => s + (Number(r.FreightAmount) || 0), 0));
    const totalAdditions = round2ish(rows.reduce((s, r) => s + (Number(r.Additions) || 0), 0));
    const totalDeductions = round2ish(rows.reduce((s, r) => s + (Number(r.TotalDeductions) || 0), 0));
    const totalNet = round2ish(rows.reduce((s, r) => s + (Number(r.NetPayable) || 0), 0));
    const totalPaid = round2ish(rows.reduce((s, r) => s + (Number(r.TotalPaid) || 0), 0));
    const totalBalance = round2ish(rows.reduce((s, r) => s + (Number(r.Balance) || 0), 0));
    document.getElementById('reportResultExtra').innerHTML = `
      <div class="do-info">${rows.length} record(s) — Freight: ₹${fmtNum(totalFreight)} &nbsp; Additions: ₹${fmtNum(totalAdditions)} &nbsp;
      Deductions: ₹${fmtNum(totalDeductions)} &nbsp; Net Payable: ₹${fmtNum(totalNet)} &nbsp; Paid: ₹${fmtNum(totalPaid)} &nbsp;
      <strong>Outstanding: ₹${fmtNum(totalBalance)}</strong></div>`;
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>Date</th><th>Document No.</th><th>Entity</th><th>Customer</th><th>Transporter</th><th>Payee</th><th>Truck No.</th>
       <th>Weight</th><th>Freight</th><th>Additions</th><th>Deductions</th><th>Net Payable</th><th>Paid</th><th>Balance</th><th>POD</th><th>Status</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.Entity)}</td><td>${escapeHtml(r.Customer)}</td>
      <td>${escapeHtml(r.Transporter)}</td><td>${escapeHtml(r.PayeeName)}</td><td>${escapeHtml(r.TruckNo)}</td>
      <td>${fmtNum(r.Qty)}</td><td>${fmtNum(r.FreightAmount)}</td><td>${fmtNum(r.Additions)}</td><td>${fmtNum(r.TotalDeductions)}</td>
      <td>${fmtNum(r.NetPayable)}</td><td>${fmtNum(r.TotalPaid)}</td><td>${fmtNum(r.Balance)}</td>
      <td>${escapeHtml(r.PODReceived)}</td><td>${escapeHtml(r.Status)}</td></tr>
    `).join('') || '<tr><td colspan="16">No freight records yet.</td></tr>';
  } catch (err) { onError(err); }
}

async function viewOutstandingReport() {
  try {
    const rows = await apiGet('getOutstandingBalanceReport');
    document.getElementById('reportResultExtra').innerHTML = '';
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>Date</th><th>Document No.</th><th>Entity</th><th>Payee</th><th>Truck</th><th>Net Payable</th><th>Paid</th><th>Balance</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.Entity)}</td><td>${escapeHtml(r.PayeeName)}</td>
      <td>${escapeHtml(r.TruckNo)}</td><td>${fmtNum(r.NetPayable)}</td><td>${fmtNum(r.TotalPaid)}</td><td>${fmtNum(r.Balance)}</td></tr>
    `).join('') || '<tr><td colspan="8">Nothing outstanding.</td></tr>';
  } catch (err) { onError(err); }
}

/** SuperAdmin-only: one row per dispatch/yard movement with its Document No. and — if flagged
 * Freight Applicable — the freight side's processing status/balance, side by side. */
/** SuperAdmin-only master report: every DO/dispatch column next to every freight column, one
 * row per movement (plus any standalone freight record with no linked trip), joined by
 * Document No. — the single place to pull literally everything about a movement. */
async function viewCombinedReport() {
  const dateFrom = document.getElementById('reportCombinedFrom').value;
  const dateTo = document.getElementById('reportCombinedTo').value;
  if (!dateFrom || !dateTo) { toast('Pick both a from and to date.', 'error'); return; }
  try {
    const rows = await apiGet('getCombinedDispatchFreightReport', { dateFrom: dateFrom, dateTo: dateTo });
    document.getElementById('reportResultExtra').innerHTML = `<div class="do-info">${rows.length} movement(s) in this date range.</div>`;
    document.getElementById('reportTableHead').innerHTML =
      `<tr><th>Date</th><th>Document No.</th><th>Challan No.</th><th>DO No.</th><th>Source</th><th>Mine</th><th>Grade</th>
       <th>Truck No.</th><th>Movement Type</th><th>Customer</th><th>Weight</th><th>Sale Rate</th><th>Sale Amount</th>
       <th>Freight Applicable</th><th>Entity</th><th>Transporter</th><th>Payee</th><th>Freight Rate</th><th>Freight Amount</th>
       <th>Additions</th><th>Deductions</th><th>Net Payable</th><th>Paid</th><th>Balance</th><th>POD</th><th>Freight Status</th></tr>`;
    document.getElementById('reportTableBody').innerHTML = rows.map(r => `
      <tr><td>${r.Date_fmt}</td><td>${escapeHtml(r.DocumentNo)}</td><td>${escapeHtml(r.ChallanNo)}</td><td>${escapeHtml(r.DO_No)}</td>
      <td>${escapeHtml(r.Source)}</td><td>${escapeHtml(r.Mine)}</td><td>${escapeHtml(r.Grade)}</td>
      <td>${escapeHtml(r.TruckNo)}</td><td>${escapeHtml(r.MovementType)}</td><td>${escapeHtml(r.Customer)}</td>
      <td>${fmtNum(r.Qty)}</td><td>${fmtNum(r.SaleRate)}</td><td>${fmtNum(r.Amount)}</td>
      <td>${escapeHtml(r.FreightApplicable)}</td><td>${escapeHtml(r.Entity)}</td><td>${escapeHtml(r.Transporter)}</td><td>${escapeHtml(r.PayeeName)}</td>
      <td>${fmtNum(r.FreightRate)}</td><td>${fmtNum(r.FreightAmount)}</td><td>${fmtNum(r.Additions)}</td><td>${fmtNum(r.TotalDeductions)}</td>
      <td>${fmtNum(r.NetPayable)}</td><td>${fmtNum(r.TotalPaid)}</td><td>${fmtNum(r.Balance)}</td>
      <td>${escapeHtml(r.PODReceived)}</td><td>${escapeHtml(r.FreightStatus)}</td></tr>
    `).join('') || '<tr><td colspan="26">No movements in this date range</td></tr>';
  } catch (err) { onError(err); }
}

// ---------- ACCOUNT / ADMIN ----------
async function onChangePassword(e) {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    await apiPost('changePassword', payload);
    toast('Password updated.', 'success');
    form.reset();
  } catch (err) { onError(err); }
}

async function onAddUser(e) {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    await apiPost('addUser', payload);
    toast('User "' + payload.username + '" added.', 'success');
    form.reset();
    loadUsers();
  } catch (err) { onError(err); }
}

async function loadUsers() {
  try {
    const users = await apiGet('listUsers');
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = users.map(u => `
      <tr><td>${escapeHtml(u.Username)}</td><td>${escapeHtml(u.Role)}</td><td>${u.CreatedAt_fmt}</td></tr>
    `).join('') || '<tr><td colspan="3">No users yet — add one above</td></tr>';
  } catch (err) { onError(err); }
}

async function loadAuditLog() {
  try {
    const rows = await apiGet('getAuditLog', { limit: 200 });
    const tbody = document.querySelector('#auditLogTable tbody');
    tbody.innerHTML = rows.map(r => `
      <tr><td>${r.Timestamp_fmt}</td><td>${escapeHtml(r.Username)}</td><td>${escapeHtml(r.Action)}</td>
      <td>${escapeHtml(r.RecordType)}</td><td>${escapeHtml(r.RecordID)}</td><td>${escapeHtml(r.Details)}</td></tr>
    `).join('') || '<tr><td colspan="6">No changes logged yet</td></tr>';
  } catch (err) { onError(err); }
}

// ---------- SEARCHABLE SELECT (Choices.js) ----------
/** (Re)initializes Choices.js on a <select> whose options were just rebuilt. Falls back to a
 * plain native select if Choices.js failed to load (e.g. no internet on first paint). */
function initChoices(el) {
  if (!window.Choices) return;
  if (el._choices) { el._choices.destroy(); }
  el._choices = new Choices(el, {
    searchEnabled: true,
    shouldSort: false,
    itemSelectText: '',
    removeItemButton: false,
    placeholder: true
  });
}

/** The dispatch DO dropdown only lists Active/Expiring Soon DOs. When editing an older trip whose
 * DO has since expired or completed, inject a stand-in option so editing doesn't silently reassign
 * the trip to whatever DO happens to be first in the list. */
function ensureDoOptionExists(doNo) {
  if (!doNo) return;
  const sel = document.getElementById('dispatchDoSelect');
  if (Array.from(sel.options).some(o => o.value === doNo)) return;
  const d = LAST_DOS.find(x => String(x.DO_No) === String(doNo));
  const label = (d ? `${d.DO_No} | ${d.Mine}` : doNo) + ' — (not active; editing existing entry)';
  if (sel._choices) {
    sel._choices.setChoices([{ value: doNo, label: label }], 'value', 'label', false);
  } else {
    const opt = document.createElement('option');
    opt.value = doNo;
    opt.textContent = label;
    sel.appendChild(opt);
  }
}

function selectDoInDropdown(doNo) {
  ensureDoOptionExists(doNo);
  const sel = document.getElementById('dispatchDoSelect');
  sel.value = doNo;
  if (sel._choices && typeof sel._choices.setChoiceByValue === 'function') {
    sel._choices.setChoiceByValue(doNo);
  }
}

// ---------- QUICK-ADD MASTERS (mine/grade/customer/transporter) ----------
function setupQuickAdd() {
  document.querySelectorAll('[data-quick-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const listName = btn.dataset.quickAdd;
      QUICK_ADD_TARGET_INPUT = btn.closest('.field-with-add').querySelector('input');
      document.getElementById('quickAddTitle').textContent = 'Add new ' + (QUICK_ADD_LABELS[listName] || listName.toLowerCase());
      const input = document.getElementById('quickAddInput');
      input.value = '';
      document.getElementById('quickAddForm').dataset.listName = listName;
      document.getElementById('quickAddOverlay').classList.remove('hidden');
      input.focus();
    });
  });

  document.getElementById('btnQuickAddCancel').addEventListener('click', closeQuickAdd);
  document.getElementById('quickAddOverlay').addEventListener('click', e => {
    if (e.target.id === 'quickAddOverlay') closeQuickAdd();
  });
  document.getElementById('quickAddForm').addEventListener('submit', onQuickAddSubmit);
}

function closeQuickAdd() {
  document.getElementById('quickAddOverlay').classList.add('hidden');
  QUICK_ADD_TARGET_INPUT = null;
}

async function onQuickAddSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const listName = form.dataset.listName;
  const value = document.getElementById('quickAddInput').value.trim();
  if (!value) return;

  try {
    await apiPost('addMasterValue', { listName: listName, value: value });
    await loadMasters();
    if (QUICK_ADD_TARGET_INPUT) QUICK_ADD_TARGET_INPUT.value = value;
    toast('"' + value + '" added.', 'success');
    closeQuickAdd();
  } catch (err) { onError(err); }
}

// ---------- ROW-LEVEL EDIT (event delegation, works across table re-renders) ----------
function setupRowEditDelegation() {
  document.addEventListener('click', e => {
    const doBtn = e.target.closest('[data-edit-do]');
    if (doBtn) { startEditDo(doBtn.dataset.editDo); return; }
    const dispatchBtn = e.target.closest('[data-edit-dispatch]');
    if (dispatchBtn) { startEditDispatch(dispatchBtn.dataset.editDispatch); return; }
    const mediaBtn = e.target.closest('[data-view-media]');
    if (mediaBtn) { openMediaViewer(mediaBtn.dataset.viewMedia, mediaBtn.dataset.mediaId); return; }
    const delDoBtn = e.target.closest('[data-delete-do]');
    if (delDoBtn) { onDeleteDO(delDoBtn.dataset.deleteDo); return; }
    const delDispatchBtn = e.target.closest('[data-delete-dispatch]');
    if (delDispatchBtn) { onDeleteDispatch(delDispatchBtn.dataset.deleteDispatch); return; }
    const delFreightBtn = e.target.closest('[data-delete-freight]');
    if (delFreightBtn) { onDeleteFreight(delFreightBtn.dataset.deleteFreight); return; }
    const yardOutBtn = e.target.closest('[data-edit-yardout]');
    if (yardOutBtn) { startEditYardOut(yardOutBtn.dataset.editYardout); return; }
    const delYardOutBtn = e.target.closest('[data-delete-yardout]');
    if (delYardOutBtn) { onDeleteYardOut(delYardOutBtn.dataset.deleteYardout); return; }
  });
}

async function onDeleteYardOut(entryId) {
  if (!confirm('Permanently delete yard-out entry ' + entryId + '? This cannot be undone.')) return;
  try {
    await apiPost('deleteYardEntry', { entryId: entryId });
    toast('Yard-out entry ' + entryId + ' deleted.', 'success');
    loadYardLedger();
    loadDashboard();
  } catch (err) { onError(err); }
}

/** SuperAdmin-only deletes — for cleaning up a genuine duplicate entry. The backend refuses (and
 * these just surface its error) if something depends on the record, so this never silently
 * orphans data; confirm() is the only "are you sure" — no undo once it's gone. */
async function onDeleteDO(doNo) {
  if (!confirm('Permanently delete DO ' + doNo + '? This cannot be undone.')) return;
  try {
    await apiPost('deleteDO', { doNo: doNo });
    toast('DO ' + doNo + ' deleted.', 'success');
    loadDashboard();
  } catch (err) { onError(err); }
}

async function onDeleteDispatch(tripId) {
  if (!confirm('Permanently delete dispatch ' + tripId + '? This cannot be undone.')) return;
  try {
    await apiPost('deleteDispatch', { tripId: tripId });
    toast('Dispatch ' + tripId + ' deleted.', 'success');
    loadDispatchTab();
    loadDashboard();
  } catch (err) { onError(err); }
}

async function onDeleteFreight(freightId) {
  if (!confirm('Permanently delete freight record ' + freightId + ' — including all its deductions, additions, and payments? This cannot be undone.')) return;
  try {
    await apiPost('deleteFreightRecord', { freightId: freightId });
    toast('Freight record ' + freightId + ' deleted.', 'success');
    loadQueue();
    loadLedger();
  } catch (err) { onError(err); }
}

// ============================================================================
// MEDIA — truck / mine photo attachments, stored in Google Drive via the
// uploadMedia backend action. Images are resized/compressed client-side first
// so the base64 JSON payload stays small (a few hundred KB, not a raw 4000px photo).
// ============================================================================

/** Resizes an image file to at most maxDim on its longest side and re-encodes as JPEG,
 * returning the parts needed for the uploadMedia API call. */
function resizeImageFile(file, maxDim, quality) {
  maxDim = maxDim || 1280;
  quality = quality || 0.72;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      img.onerror = () => reject(new Error('Could not decode the selected image.'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg',
          fileName: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoFor(linkedType, linkedId, category, file, inputId) {
  try {
    const resized = await resizeImageFile(file);
    await apiPost('uploadMedia', Object.assign({ linkedType: linkedType, linkedId: linkedId, category: category }, resized));
    toast(category + ' photo attached to ' + linkedId + '.', 'success');
  } catch (err) {
    onError(err);
  } finally {
    const input = document.getElementById(inputId);
    if (input) input.value = '';
  }
}

async function openMediaViewer(linkedType, linkedId) {
  const overlay = document.getElementById('mediaViewerOverlay');
  const grid = document.getElementById('mediaViewerGrid');
  document.getElementById('mediaViewerTitle').textContent = 'Photos — ' + linkedId;
  grid.innerHTML = '<div class="media-viewer-empty">Loading…</div>';
  overlay.classList.remove('hidden');
  try {
    const media = await apiGet('getMedia', { linkedType: linkedType, linkedId: linkedId });
    grid.innerHTML = media.length ? media.map(m => `
      <a href="${escapeHtml(m.FileURL)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(driveThumbnailUrl(m.FileURL))}" alt="${escapeHtml(m.Category)}">
        <div class="media-caption">${escapeHtml(m.Category)} — ${m.UploadedAt_fmt}</div>
      </a>
    `).join('') : '<div class="media-viewer-empty">No photos attached yet.</div>';
  } catch (err) {
    grid.innerHTML = '<div class="media-viewer-empty">Could not load photos.</div>';
    onError(err);
  }
}

function closeMediaViewer() {
  document.getElementById('mediaViewerOverlay').classList.add('hidden');
}

/** Converts a standard Drive "share" URL into a directly embeddable thumbnail URL. */
function driveThumbnailUrl(shareUrl) {
  const match = String(shareUrl || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return shareUrl;
  return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w400';
}

// ---------- ERROR ----------
function onError(err) {
  console.error(err);
  const msg = err.message || String(err);
  toast(msg, 'error');
  if (/log in again|not logged in/i.test(msg)) {
    Session.clear();
    setTimeout(() => location.reload(), 1200);
  }
}
