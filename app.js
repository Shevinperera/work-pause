import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAhlILJWDXk7SNUXW30Yz_aOskYNXD2gYk",
  authDomain: "work-pause-2933d.firebaseapp.com",
  projectId: "work-pause-2933d",
  storageBucket: "work-pause-2933d.firebasestorage.app",
  messagingSenderId: "813238056485",
  appId: "1:813238056485:web:590ff1957003e4cbac71cc"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const THEME_KEY = 'workHoursTheme';
// All dates and times in the app (and in the Excel export) use this zone.
const TIMEZONE = 'Asia/Colombo';

let currentUser = null;
let currentProfile = null; // { name, role }
let currentViewMonth = new Date();
let todayData = null; // Reference to today's shift
let unsubscribeAdmin = null; // For live updates
let savingShift = false;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function updateThemeIcon(theme) {
  // Show the icon for the theme you would switch to.
  $('themeIcon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  $('themeToggleBtn').setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem(THEME_KEY, newTheme);
  updateThemeIcon(newTheme);
}

$('themeToggleBtn').addEventListener('click', toggleTheme);
updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'light');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const dateKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const longDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function getTodayString() {
  return dateKeyFmt.format(new Date()); // YYYY-MM-DD in Asia/Colombo
}

function formatTime(ms) {
  if (!ms) return '';
  return timeFmt.format(new Date(ms));
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}h ${m}m`;
}

function calculateBreakTotalMs(breaks) {
  if (!breaks) return 0;
  return breaks.reduce((total, b) => {
    if (b.end) return total + (b.end - b.start);
    return total + (Date.now() - b.start);
  }, 0);
}

function calculateWorkMs(data) {
  if (!data || !data.inTime) return 0;
  const end = data.outTime || Date.now();
  const totalDuration = end - data.inTime;
  const breakMs = calculateBreakTotalMs(data.breaks);
  return Math.max(0, totalDuration - breakMs);
}

/**
 * Totals for a shift that also handle incomplete records. Open breaks and a
 * missing clock-out are only counted "live" for today's open shift; on past
 * days (or after clock-out) they are reported as missing instead of growing
 * until now.  Returns { breakMs, workMs, breakMissing, outMissing } where the
 * ms values are null when they cannot be determined.
 */
function shiftTotals(data, isToday) {
  if (!data || !data.inTime) return { breakMs: 0, workMs: 0, breakMissing: false, outMissing: false };
  const live = isToday && !data.outTime;
  const breaks = (data.breaks || []).filter((b) => b && b.start);
  const breakMissing = !live && breaks.some((b) => !b.end);
  const outMissing = !live && !data.outTime;
  const breakMs = breakMissing ? null : calculateBreakTotalMs(breaks);
  const workMs = breakMissing || outMissing ? null : calculateWorkMs(data);
  return { breakMs, workMs, breakMissing, outMissing };
}

function shiftStatus(data) {
  if (!data || !data.inTime) return 'idle';
  if (data.outTime) return 'ended';
  if (data.breaks && data.breaks.some((b) => !b.end)) return 'break';
  return 'working';
}

const STATUS_TEXT = { idle: 'Not started', working: 'Working', break: 'On break', ended: 'Shift ended' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function icon(name, extra = '') {
  return `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function setBusy(btn, busy, busyLabel) {
  const label = btn.querySelector('.btn-label');
  if (busy) {
    btn.dataset.label = label.textContent;
    btn.dataset.icon = btn.querySelector('use')?.getAttribute('href') || '';
    btn.querySelector('use')?.setAttribute('href', '#i-loader');
    btn.querySelector('.icon')?.classList.add('spin');
    if (busyLabel) label.textContent = busyLabel;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
  } else {
    if (btn.dataset.label) label.textContent = btn.dataset.label;
    if (btn.dataset.icon) btn.querySelector('use')?.setAttribute('href', btn.dataset.icon);
    btn.querySelector('.icon')?.classList.remove('spin');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}

function showAlert(boxId, textId, message) {
  $(textId).textContent = message;
  $(boxId).classList.toggle('hidden', !message);
}

function stateRow(colspan, { kind = 'empty', title, text = '', action = '' }) {
  const ic = kind === 'error' ? 'circle-alert' : kind === 'loading' ? 'loader' : 'inbox';
  return `<tr><td colspan="${colspan}" class="state-cell">
    <div class="state state-${kind}">
      ${icon(ic, kind === 'loading' ? 'spin' : '')}
      <span class="state-title">${escapeHtml(title)}</span>
      ${text ? `<span>${escapeHtml(text)}</span>` : ''}
      ${action}
    </div></td></tr>`;
}

function skeletonRows(cols, rows = 4) {
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>' + Array.from({ length: cols }, (_, i) =>
      `<td class="${i ? 'num' : ''}"><span class="skeleton" style="width:${i ? 44 : 120 + (r % 3) * 30}px"></span></td>`).join('') + '</tr>';
  }
  return html;
}

function showView(name) {
  for (const v of ['bootView', 'loginView', 'adminView', 'employeeView']) {
    $(v).classList.toggle('hidden', v !== name);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailEl = $('emailInput');
  const passEl = $('passwordInput');
  const email = emailEl.value.trim();
  const pass = passEl.value;
  emailEl.removeAttribute('aria-invalid');
  passEl.removeAttribute('aria-invalid');

  if (!email || !pass) {
    if (!email) emailEl.setAttribute('aria-invalid', 'true');
    if (!pass) passEl.setAttribute('aria-invalid', 'true');
    showAlert('loginError', 'loginErrorText', 'Enter your email and password.');
    (email ? passEl : emailEl).focus();
    return;
  }

  showAlert('loginError', 'loginErrorText', '');
  setBusy($('loginBtn'), true, 'Signing in…');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    passEl.value = '';
  } catch (err) {
    showAlert('loginError', 'loginErrorText', AUTH_ERRORS[err.code] || `Sign-in failed: ${err.message}`);
    passEl.select();
  } finally {
    setBusy($('loginBtn'), false);
  }
});

// Registration is disabled from the UI. Admin creates users in Firebase console.

document.querySelectorAll('.logout-btn').forEach((btn) => {
  btn.onclick = () => signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    try {
      let docSnap = await getDoc(doc(db, "users", user.uid));

      // Auto-create profile on first login if it doesn't exist
      if (!docSnap.exists()) {
        const empName = prompt("Welcome! Please enter your full name for your timecard:") || user.email.split('@')[0];
        await setDoc(doc(db, "users", user.uid), {
          name: empName,
          email: user.email,
          role: "employee", // Default to employee. Admin can manually elevate in Firestore.
          createdAt: Date.now() // Used by the export to mark days before someone joined.
        });
        docSnap = await getDoc(doc(db, "users", user.uid));
      }
      currentProfile = docSnap.data();
    } catch (err) {
      console.error('Profile load failed', err);
      showView('loginView');
      showAlert('loginError', 'loginErrorText', 'Signed in, but your profile could not be loaded. Check your connection and try again.');
      await signOut(auth).catch(() => {});
      return;
    }

    if (currentProfile.role === 'admin') {
      showView('adminView');
      $('adminNameDisplay').textContent = currentProfile.name;
      startAdminLiveDashboard();
    } else {
      showView('employeeView');
      $('empNameDisplay').textContent = currentProfile.name;
      if (unsubscribeAdmin) unsubscribeAdmin();
      loadEmployeeShift();
    }
  } else {
    currentUser = null;
    currentProfile = null;
    todayData = null;
    historyCache = {};
    if (unsubscribeAdmin) unsubscribeAdmin();
    unsubscribeAdmin = null;
    showView('loginView');
  }
});

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------
async function loadEmployeeShift() {
  if (!currentUser) return;
  const todayStr = getTodayString();
  const shiftId = `${currentUser.uid}_${todayStr}`;
  setActionButtonsLoading();
  try {
    const shiftSnap = await getDoc(doc(db, "shifts", shiftId));
    todayData = shiftSnap.exists()
      ? shiftSnap.data()
      : { inTime: null, outTime: null, breaks: [], uid: currentUser.uid, date: todayStr };
    showAlert('shiftError', 'shiftErrorText', '');
  } catch (err) {
    console.error('Error loading shift', err);
    todayData = null;
    showAlert('shiftError', 'shiftErrorText', "Couldn't load today's shift. Check your connection and reload the page.");
  }
  updateEmployeeUI();
  renderHistoryTable();
}

function setActionButtonsLoading() {
  ['punchInBtn', 'breakBtn', 'punchOutBtn'].forEach((id) => { $(id).disabled = true; });
}

async function saveShiftToFirestore() {
  if (!currentUser || !todayData) return;
  const todayStr = getTodayString();
  const shiftId = `${currentUser.uid}_${todayStr}`;
  savingShift = true;
  updateEmployeeUI();
  try {
    await setDoc(doc(db, "shifts", shiftId), todayData);
    historyCache[todayStr] = todayData;
    showAlert('shiftError', 'shiftErrorText', '');
  } catch (err) {
    console.error("Error saving shift", err);
    showAlert('shiftError', 'shiftErrorText', "Couldn't save that change. Your shift has been reloaded; please try again.");
    savingShift = false;
    await loadEmployeeShift();
    return;
  }
  savingShift = false;
  updateEmployeeUI();
  renderHistoryTableUI();
}

function updateEmployeeUI() {
  if (!currentUser || !currentProfile || currentProfile.role === 'admin') return;

  const punchInBtn = $('punchInBtn');
  const breakBtn = $('breakBtn');
  const punchOutBtn = $('punchOutBtn');
  const resetPunchOutBtn = $('resetPunchOutBtn');
  const statusDot = document.querySelector('#statusIndicator .status-dot');
  const statusText = $('statusText');

  if (!todayData) {
    setActionButtonsLoading();
    statusText.textContent = 'Unavailable';
    return;
  }

  const status = shiftStatus(todayData);
  statusDot.className = 'status-dot';
  resetPunchOutBtn.classList.add('hidden');
  breakBtn.querySelector('.btn-label').textContent = 'Start break';

  if (status === 'idle') {
    statusText.textContent = "Not clocked in";
    punchInBtn.disabled = false;
    breakBtn.disabled = true;
    punchOutBtn.disabled = true;
  } else if (status === 'ended') {
    statusText.textContent = "Shift ended";
    statusDot.classList.add('ended');
    punchInBtn.disabled = true;
    breakBtn.disabled = true;
    punchOutBtn.disabled = true;
    resetPunchOutBtn.classList.remove('hidden');
  } else if (status === 'break') {
    statusText.textContent = "On break";
    statusDot.classList.add('paused');
    punchInBtn.disabled = true;
    breakBtn.disabled = false;
    breakBtn.querySelector('.btn-label').textContent = 'End break';
    punchOutBtn.disabled = false;
  } else {
    statusText.textContent = "Working";
    statusDot.classList.add('active');
    punchInBtn.disabled = true;
    breakBtn.disabled = false;
    punchOutBtn.disabled = false;
  }

  if (savingShift) {
    [punchInBtn, breakBtn, punchOutBtn, resetPunchOutBtn].forEach((b) => { b.disabled = true; });
  } else {
    resetPunchOutBtn.disabled = false;
  }

  $('todayIn').textContent = todayData.inTime ? formatTime(todayData.inTime) : '–';
  $('todayWork').textContent = formatDuration(calculateWorkMs(todayData));
  $('todayBreak').textContent = formatDuration(calculateBreakTotalMs(todayData.breaks));
}

let historyCache = {};
async function renderHistoryTable() {
  if (!currentUser || !currentProfile || currentProfile.role === 'admin') return;

  $('monthLabel').textContent = currentViewMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const tbody = $('historyBody');
  tbody.innerHTML = skeletonRows(5, 5);

  try {
    // Fetch all user shifts
    const qShifts = query(collection(db, "shifts"), where("uid", "==", currentUser.uid));
    const snap = await getDocs(qShifts);
    const userHistory = {};
    snap.forEach((d) => {
      userHistory[d.data().date] = d.data();
    });
    historyCache = userHistory;
  } catch (err) {
    console.error('History load failed', err);
    tbody.innerHTML = stateRow(5, {
      kind: 'error',
      title: "Couldn't load your history",
      text: 'Check your connection and try again.',
      action: '<button type="button" class="btn btn-secondary" id="historyRetryBtn">Retry</button>',
    });
    $('historyRetryBtn').onclick = renderHistoryTable;
    return;
  }

  renderHistoryTableUI();
}

function historyRowCells(dateStr, data, isToday) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const t = shiftTotals(data, isToday);
  const missing = '<span class="cell-missing">Missing</span>';
  const status = shiftStatus(data);
  const out = data.outTime
    ? formatTime(data.outTime)
    : t.outMissing ? missing
      : `<span class="status-label is-${status}"><span class="status-dot"></span>${STATUS_TEXT[status]}</span>`;
  return `
    <td class="cell-primary cell-strong" data-label="Date">${escapeHtml(dateLabel)}${isToday ? ' <span class="cell-sub">Today</span>' : ''}</td>
    <td class="num" data-label="Clock in">${formatTime(data.inTime)}</td>
    <td class="num" data-label="Clock out">${out}</td>
    <td class="num" data-label="Break">${t.breakMs === null ? missing : formatDuration(t.breakMs)}</td>
    <td class="num cell-strong" data-label="Worked">${t.workMs === null ? missing : formatDuration(t.workMs)}</td>`;
}

function renderHistoryTableUI() {
  if (!currentUser || !currentProfile || currentProfile.role === 'admin') return;

  const y = currentViewMonth.getFullYear();
  const m = currentViewMonth.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = getTodayString();
  const tbody = $('historyBody');

  $('monthLabel').textContent = currentViewMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  let html = '';
  for (let d = daysInMonth; d >= 1; d--) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const data = historyCache[dateStr];
    if (data && data.inTime) {
      const isToday = dateStr === todayStr;
      html += `<tr class="data-row${isToday ? ' is-today' : ''}" ${isToday ? 'id="historyTodayRow"' : ''}>${historyRowCells(dateStr, data, isToday)}</tr>`;
    }
  }

  tbody.innerHTML = html || stateRow(5, { title: 'No entries this month', text: 'Days you clock in will appear here.' });
}

// Employee Actions
$('punchInBtn').onclick = () => {
  if (todayData && !todayData.inTime) {
    todayData.inTime = Date.now();
    todayData.breaks = [];
    saveShiftToFirestore();
  }
};

$('breakBtn').onclick = () => {
  if (todayData) {
    if (!todayData.breaks) todayData.breaks = [];
    const currentBreak = todayData.breaks.find((b) => !b.end);
    if (currentBreak) {
      currentBreak.end = Date.now();
    } else {
      todayData.breaks.push({ start: Date.now(), end: null });
    }
    saveShiftToFirestore();
  }
};

$('punchOutBtn').onclick = () => {
  if (todayData && todayData.inTime && !todayData.outTime) {
    const currentBreak = todayData.breaks && todayData.breaks.find((b) => !b.end);
    if (currentBreak) currentBreak.end = Date.now();
    todayData.outTime = Date.now();
    saveShiftToFirestore();
  }
};

$('resetPunchOutBtn').onclick = () => {
  if (todayData && todayData.outTime) {
    if (confirm("Undo your clock out? This will resume your shift.")) {
      todayData.outTime = null;
      saveShiftToFirestore();
    }
  }
};

$('prevMonth').onclick = () => {
  currentViewMonth.setDate(1);
  currentViewMonth.setMonth(currentViewMonth.getMonth() - 1);
  renderHistoryTableUI();
};
$('nextMonth').onclick = () => {
  currentViewMonth.setDate(1);
  currentViewMonth.setMonth(currentViewMonth.getMonth() + 1);
  renderHistoryTableUI();
};

$('exportBtn').onclick = () => {
  if (!currentUser || !currentProfile || currentProfile.role === 'admin') return;
  if (typeof XLSX === 'undefined') {
    showAlert('shiftError', 'shiftErrorText', 'The export library failed to load. Check your connection and reload the page.');
    return;
  }
  const y = currentViewMonth.getFullYear();
  const m = currentViewMonth.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = getTodayString();

  const exportData = [["Date", "Clock In", "Clock Out", "Break Time", "Work Hours", "Decimal Work Hours"]];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const data = historyCache[dateStr];

    if (data && data.inTime) {
      const isToday = dateStr === todayStr;
      const t = shiftTotals(data, isToday);
      const outStr = data.outTime ? formatTime(data.outTime) : (t.outMissing ? 'Missing' : 'Working');

      exportData.push([
        dateStr,
        formatTime(data.inTime),
        outStr,
        t.breakMs === null ? 'Missing' : formatDuration(t.breakMs),
        t.workMs === null ? 'Missing' : formatDuration(t.workMs),
        t.workMs === null ? '' : (t.workMs / 3600000).toFixed(2)
      ]);
    }
  }

  if (exportData.length === 1) {
    showAlert('shiftError', 'shiftErrorText', `Nothing to export for ${$('monthLabel').textContent}.`);
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(exportData);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Work Hours");
  XLSX.writeFile(wb, `WorkHours_${currentProfile.name}_${y}_${String(m + 1).padStart(2, '0')}.xlsx`);
};

// ---------------------------------------------------------------------------
// Admin (realtime)
// ---------------------------------------------------------------------------
const adminState = { employees: {}, shifts: {}, ready: false, dateKey: null };

function renderAdminLoading() {
  $('adminTableBody').innerHTML = skeletonRows(6, 5);
  $('adminResultCount').textContent = '';
}

function renderAdminError(message) {
  $('adminTableBody').innerHTML = stateRow(6, {
    kind: 'error',
    title: "Couldn't load live attendance",
    text: message,
    action: '<button type="button" class="btn btn-secondary" id="adminRetryBtn">Retry</button>',
  });
  $('adminRetryBtn').onclick = startAdminLiveDashboard;
  $('adminResultCount').textContent = '';
}

async function startAdminLiveDashboard() {
  renderAdminLoading();
  if (unsubscribeAdmin) unsubscribeAdmin();
  unsubscribeAdmin = null;
  adminState.ready = false;

  try {
    const qUsers = query(collection(db, "users"), where("role", "==", "employee"));
    const userDocs = await getDocs(qUsers);
    adminState.employees = {};
    userDocs.forEach((d) => {
      adminState.employees[d.id] = d.data();
    });
  } catch (err) {
    console.error('Employee load failed', err);
    renderAdminError('Check your connection and try again.');
    return;
  }

  const todayStr = getTodayString();
  adminState.dateKey = todayStr;
  const qShifts = query(collection(db, "shifts"), where("date", "==", todayStr));

  unsubscribeAdmin = onSnapshot(qShifts, (snapshot) => {
    adminState.shifts = {};
    snapshot.forEach((d) => {
      adminState.shifts[d.data().uid] = d.data();
    });
    adminState.ready = true;
    renderAdminTable();
  }, (err) => {
    console.error('Live shift listener failed', err);
    renderAdminError('The live connection was interrupted.');
  });
}

function renderAdminTable() {
  if (!adminState.ready) return;
  const tbody = $('adminTableBody');
  const search = $('adminSearch').value.trim().toLowerCase();
  const statusFilter = $('adminStatusFilter').value;

  const counts = { working: 0, break: 0, ended: 0, idle: 0 };
  const rows = Object.entries(adminState.employees)
    .map(([uid, user]) => {
      const data = adminState.shifts[uid] || { inTime: null, outTime: null, breaks: [] };
      const status = shiftStatus(data);
      counts[status]++;
      return { uid, user, data, status };
    })
    .sort((a, b) => (a.user.name || '').localeCompare(b.user.name || ''));

  const total = rows.length;
  $('totalEmpCount').textContent = total;
  $('activeEmpCount').textContent = counts.working;
  $('breakEmpCount').textContent = counts.break;
  $('endedEmpCount').textContent = counts.ended;
  $('idleEmpCount').textContent = counts.idle;

  if (total === 0) {
    tbody.innerHTML = stateRow(6, { title: 'No employees yet', text: 'Employees appear here after their first sign-in.' });
    $('adminResultCount').textContent = '';
    return;
  }

  const visible = rows.filter(({ user, status }) =>
    (statusFilter === 'all' || status === statusFilter)
    && (!search || `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(search)));

  $('adminResultCount').textContent = visible.length === total ? `${total} employees` : `${visible.length} of ${total}`;

  if (visible.length === 0) {
    tbody.innerHTML = stateRow(6, {
      title: 'No matching employees',
      text: 'Try a different name or status.',
      action: '<button type="button" class="btn-link" id="clearFiltersBtn">Clear filters</button>',
    });
    $('clearFiltersBtn').onclick = () => {
      $('adminSearch').value = '';
      $('adminStatusFilter').value = 'all';
      renderAdminTable();
      $('adminSearch').focus();
    };
    return;
  }

  tbody.innerHTML = visible.map(({ user, data, status }) => {
    const dash = '<span class="cell-muted">–</span>';
    const missing = '<span class="cell-missing">Missing</span>';
    const t = shiftTotals(data, true); // the dashboard only shows today's shifts
    return `<tr class="data-row">
      <td class="cell-primary" data-label="Employee">
        <div class="cell-strong">${escapeHtml(user.name || '(no name)')}</div>
        <div class="cell-sub">${escapeHtml(user.email || '')}</div>
      </td>
      <td data-label="Status"><span class="status-label is-${status}"><span class="status-dot"></span>${STATUS_TEXT[status]}</span></td>
      <td class="num" data-label="Clock in">${data.inTime ? formatTime(data.inTime) : dash}</td>
      <td class="num" data-label="Clock out">${data.outTime ? formatTime(data.outTime) : dash}</td>
      <td class="num" data-label="Break">${!data.inTime ? dash : t.breakMs === null ? missing : formatDuration(t.breakMs)}</td>
      <td class="num cell-strong" data-label="Worked today">${!data.inTime ? dash : t.workMs === null ? missing : formatDuration(t.workMs)}</td>
    </tr>`;
  }).join('');
}

$('adminSearch').addEventListener('input', renderAdminTable);
$('adminStatusFilter').addEventListener('change', renderAdminTable);

// Admin: server-side Excel export (the server re-checks the admin role).
function showExportStatus(kind, message) {
  const box = $('exportStatus');
  box.classList.toggle('alert-error', kind === 'error');
  box.classList.toggle('alert-success', kind === 'success');
  $('exportStatusIcon').setAttribute('href', kind === 'success' ? '#i-circle-check' : '#i-circle-alert');
  showAlert('exportStatus', 'exportStatusText', message);
}

$('adminExportBtn').addEventListener('click', async () => {
  const btn = $('adminExportBtn');
  if (!currentUser) return;
  showExportStatus('', '');
  setBusy(btn, true, 'Preparing…');
  try {
    const token = await currentUser.getIdToken();
    const res = await fetch('/api/export', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const type = res.headers.get('Content-Type') || '';
    if (!res.ok || !type.includes('spreadsheetml')) {
      let msg = '';
      if (type.includes('application/json')) msg = (await res.json().catch(() => ({}))).error || '';
      if (res.status === 403) msg = msg || 'Admin access required.';
      throw new Error(msg || `The export service responded with ${res.status}.`);
    }
    const blob = await res.blob();
    const filename = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'attendance.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showExportStatus('success', `Downloaded ${filename}`);
  } catch (err) {
    console.error('Export failed', err);
    const offline = err instanceof TypeError;
    showExportStatus('error', offline ? "Couldn't reach the export service. Check your connection and try again." : `Export failed: ${err.message}`);
  } finally {
    setBusy(btn, false);
  }
});

// ---------------------------------------------------------------------------
// Live clock & UI updater
// ---------------------------------------------------------------------------
let tick = 0;
function onTick() {
  const now = new Date();
  $('liveClock').textContent = clockFmt.format(now);
  const dateText = longDateFmt.format(now);
  document.querySelectorAll('.current-date').forEach((el) => { if (el.textContent !== dateText) el.textContent = dateText; });

  if (currentUser && currentProfile) {
    const todayStr = getTodayString();

    if (currentProfile.role !== 'admin') {
      if (todayData && todayData.date !== todayStr) {
        // Handle midnight rollover by reloading shift
        loadEmployeeShift();
      } else if (todayData && todayData.inTime && !todayData.outTime) {
        // Update live durations
        $('todayWork').textContent = formatDuration(calculateWorkMs(todayData));
        $('todayBreak').textContent = formatDuration(calculateBreakTotalMs(todayData.breaks));

        // Update today's history row in place if it's rendered
        const row = $('historyTodayRow');
        if (row && historyCache[todayStr] && !historyCache[todayStr].outTime) {
          row.innerHTML = historyRowCells(todayStr, historyCache[todayStr], true);
        }
      }
    } else if (adminState.ready) {
      if (adminState.dateKey !== todayStr) startAdminLiveDashboard(); // midnight rollover
      else if (tick % 30 === 0) renderAdminTable(); // refresh live durations
    }
  }
  tick++;
}
onTick();
setInterval(onTick, 1000);
