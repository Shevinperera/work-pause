import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

let currentUser = null;
let currentProfile = null; // { name, role }
let currentViewMonth = new Date();
let todayData = null; // Reference to today's shift
let unsubscribeAdmin = null; // For live updates

// Theme initialization
function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem(THEME_KEY, newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const iconSpan = document.getElementById('themeIcon');
  if (theme === 'light') {
    iconSpan.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  } else {
    iconSpan.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
  }
}

document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
initTheme();

// Helpers
function getTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function formatTime(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

// Auth Logic
document.getElementById('loginBtn').onclick = async () => {
  const email = document.getElementById('emailInput').value.trim();
  const pass = document.getElementById('passwordInput').value;
  try {
    document.getElementById('loginBtn').textContent = "Loading...";
    await signInWithEmailAndPassword(auth, email, pass);
    document.getElementById('loginBtn').textContent = "Sign In";
  } catch (err) {
    document.getElementById('loginBtn').textContent = "Sign In";
    alert("Login failed: " + err.message);
  }
};

// Registration is disabled from the UI. Admin creates users in Firebase console.

document.querySelectorAll('.logout-btn').forEach(btn => {
  btn.onclick = () => signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    let docSnap = await getDoc(doc(db, "users", user.uid));
    
    // Auto-create profile on first login if it doesn't exist
    if (!docSnap.exists()) {
      const empName = prompt("Welcome! Please enter your full name for your timecard:") || user.email.split('@')[0];
      await setDoc(doc(db, "users", user.uid), {
        name: empName,
        email: user.email,
        role: "employee" // Default to employee. Admin can manually elevate in Firestore.
      });
      docSnap = await getDoc(doc(db, "users", user.uid));
    }
    
    currentProfile = docSnap.data();
    document.getElementById('loginView').classList.add('hidden');
    if (currentProfile.role === 'admin') {
      document.getElementById('adminView').classList.remove('hidden');
      document.getElementById('employeeView').classList.add('hidden');
      document.getElementById('adminNameDisplay').textContent = currentProfile.name;
      startAdminLiveDashboard();
    } else {
      document.getElementById('employeeView').classList.remove('hidden');
      document.getElementById('adminView').classList.add('hidden');
      document.getElementById('empNameDisplay').textContent = currentProfile.name;
      document.getElementById('empNameDisplay').style.display = 'inline';
      if (unsubscribeAdmin) unsubscribeAdmin();
      loadEmployeeShift();
    }
  } else {
    currentUser = null;
    currentProfile = null;
    todayData = null;
    if (unsubscribeAdmin) unsubscribeAdmin();
    document.getElementById('adminView').classList.add('hidden');
    document.getElementById('employeeView').classList.add('hidden');
    document.getElementById('loginView').classList.remove('hidden');
  }
});

// Employee Logic
async function loadEmployeeShift() {
  if (!currentUser) return;
  const todayStr = getTodayString();
  const shiftId = `${currentUser.uid}_${todayStr}`;
  const shiftSnap = await getDoc(doc(db, "shifts", shiftId));
  
  if (shiftSnap.exists()) {
    todayData = shiftSnap.data();
  } else {
    todayData = { inTime: null, outTime: null, breaks: [], uid: currentUser.uid, date: todayStr };
  }
  updateEmployeeUI();
  renderHistoryTable();
}

async function saveShiftToFirestore() {
  if (!currentUser || !todayData) return;
  const todayStr = getTodayString();
  const shiftId = `${currentUser.uid}_${todayStr}`;
  try {
    await setDoc(doc(db, "shifts", shiftId), todayData);
    updateEmployeeUI();
  } catch (err) {
    console.error("Error saving shift", err);
  }
}

function updateEmployeeUI() {
  if (!currentUser || currentProfile.role !== 'employee') return;

  const isPunchedIn = !!todayData.inTime;
  const isPunchedOut = !!todayData.outTime;
  const isOnBreak = todayData.breaks && todayData.breaks.some(b => !b.end);

  const punchInBtn = document.getElementById('punchInBtn');
  const breakBtn = document.getElementById('breakBtn');
  const punchOutBtn = document.getElementById('punchOutBtn');
  const resetPunchOutBtn = document.getElementById('resetPunchOutBtn');
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('statusText');
  const todayStats = document.getElementById('todayStats');

  statusDot.className = 'status-dot';
  resetPunchOutBtn.style.display = 'none';

  if (!isPunchedIn) {
    statusText.textContent = "Ready to start";
    punchInBtn.disabled = false;
    breakBtn.disabled = true;
    punchOutBtn.disabled = true;
    breakBtn.textContent = "Break";
    todayStats.style.display = 'none';
  } else if (isPunchedOut) {
    statusText.textContent = "Shift ended";
    statusDot.classList.add('ended');
    punchInBtn.disabled = true;
    breakBtn.disabled = true;
    punchOutBtn.disabled = true;
    breakBtn.textContent = "Break";
    todayStats.style.display = 'flex';
    resetPunchOutBtn.style.display = 'flex';
  } else if (isOnBreak) {
    statusText.textContent = "On Break";
    statusDot.classList.add('paused');
    punchInBtn.disabled = true;
    breakBtn.disabled = false;
    breakBtn.textContent = "Break Over";
    punchOutBtn.disabled = false;
    todayStats.style.display = 'flex';
  } else {
    statusText.textContent = "Currently Working";
    statusDot.classList.add('active');
    punchInBtn.disabled = true;
    breakBtn.disabled = false;
    breakBtn.textContent = "Break";
    punchOutBtn.disabled = false;
    todayStats.style.display = 'flex';
  }

  if (isPunchedIn) {
    document.getElementById('todayWork').textContent = formatDuration(calculateWorkMs(todayData));
    document.getElementById('todayBreak').textContent = formatDuration(calculateBreakTotalMs(todayData.breaks));
  }
}

let historyCache = {};
async function renderHistoryTable() {
  if (!currentUser || currentProfile.role !== 'employee') return;

  document.getElementById('monthLabel').textContent = currentViewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  const y = currentViewMonth.getFullYear();
  const m = currentViewMonth.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = getTodayString();
  
  const tbody = document.getElementById('historyBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Loading data from cloud...</td></tr>';
  
  // Fetch all user shifts
  const qShifts = query(collection(db, "shifts"), where("uid", "==", currentUser.uid));
  const snap = await getDocs(qShifts);
  const userHistory = {};
  snap.forEach(d => {
    userHistory[d.data().date] = d.data();
  });
  historyCache = userHistory;

  tbody.innerHTML = '';
  let hasData = false;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const data = userHistory[dateStr];
    
    if (data && data.inTime) {
      hasData = true;
      const tr = document.createElement('tr');
      const isToday = dateStr === todayStr;
      const workMs = isToday && !data.outTime ? calculateWorkMs(data) : (data.outTime ? calculateWorkMs(data) : 0);
      const breakMs = calculateBreakTotalMs(data.breaks);
      
      tr.innerHTML = `
        <td>${new Date(y, m, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
        <td>${formatTime(data.inTime)}</td>
        <td>${formatTime(data.outTime) || (isToday ? '<span style="color:var(--success)">Working...</span>' : '-')}</td>
        <td>${formatDuration(breakMs)}</td>
        <td>${formatDuration(workMs)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  if (!hasData) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No entries for this month</td></tr>`;
  }
}

// Employee Actions
document.getElementById('punchInBtn').onclick = () => {
  if (todayData && !todayData.inTime) {
    todayData.inTime = Date.now();
    todayData.breaks = [];
    saveShiftToFirestore();
  }
};

document.getElementById('breakBtn').onclick = () => {
  if (todayData) {
    if (!todayData.breaks) todayData.breaks = [];
    const currentBreak = todayData.breaks.find(b => !b.end);
    if (currentBreak) {
      currentBreak.end = Date.now();
    } else {
      todayData.breaks.push({ start: Date.now(), end: null });
    }
    saveShiftToFirestore();
  }
};

document.getElementById('punchOutBtn').onclick = () => {
  if (todayData && todayData.inTime && !todayData.outTime) {
    const currentBreak = todayData.breaks && todayData.breaks.find(b => !b.end);
    if (currentBreak) currentBreak.end = Date.now();
    todayData.outTime = Date.now();
    saveShiftToFirestore();
  }
};

document.getElementById('resetPunchOutBtn').onclick = () => {
  if (todayData && todayData.outTime) {
    if (confirm("Are you sure you want to undo your punch out? This will resume your shift.")) {
      todayData.outTime = null;
      saveShiftToFirestore();
    }
  }
};

document.getElementById('prevMonth').onclick = () => {
  currentViewMonth.setMonth(currentViewMonth.getMonth() - 1);
  renderHistoryTable();
};
document.getElementById('nextMonth').onclick = () => {
  currentViewMonth.setMonth(currentViewMonth.getMonth() + 1);
  renderHistoryTable();
};

document.getElementById('exportBtn').onclick = () => {
  if (!currentUser || currentProfile.role !== 'employee') return;
  const y = currentViewMonth.getFullYear();
  const m = currentViewMonth.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = getTodayString();
  
  const exportData = [["Date", "Punch In", "Punch Out", "Break Time", "Work Hours", "Decimal Work Hours"]];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const data = historyCache[dateStr];
    
    if (data && data.inTime) {
      const dateLabel = new Date(y, m, d).toLocaleDateString('en-US');
      const inStr = formatTime(data.inTime);
      const outStr = formatTime(data.outTime) || (dateStr === todayStr && !data.outTime ? 'Working...' : '-');
      const breakMs = calculateBreakTotalMs(data.breaks);
      const workMs = (dateStr === todayStr && !data.outTime) ? calculateWorkMs(data) : (data.outTime ? calculateWorkMs(data) : 0);
      
      exportData.push([
        dateLabel, 
        inStr, 
        outStr, 
        formatDuration(breakMs), 
        formatDuration(workMs), 
        (workMs / 3600000).toFixed(2)
      ]);
    }
  }

  if (exportData.length === 1) {
    alert("No data to export for " + document.getElementById('monthLabel').textContent);
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(exportData);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Work Hours");
  XLSX.writeFile(wb, `WorkHours_${currentProfile.name}_${y}_${String(m+1).padStart(2,'0')}.xlsx`);
};

// Admin Logic (Realtime sync)
async function startAdminLiveDashboard() {
  const tbody = document.getElementById('adminTableBody');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">Connecting to Live Data...</td></tr>';
  
  const qUsers = query(collection(db, "users"), where("role", "==", "employee"));
  const userDocs = await getDocs(qUsers);
  const employeeMap = {};
  userDocs.forEach(d => {
    employeeMap[d.id] = d.data();
  });
  
  document.getElementById('totalEmpCount').textContent = Object.keys(employeeMap).length;

  const todayStr = getTodayString();
  const qShifts = query(collection(db, "shifts"), where("date", "==", todayStr));
  
  if (unsubscribeAdmin) unsubscribeAdmin();
  
  unsubscribeAdmin = onSnapshot(qShifts, (snapshot) => {
    const todayShifts = {};
    snapshot.forEach(d => {
      todayShifts[d.data().uid] = d.data();
    });
    
    tbody.innerHTML = '';
    let activeEmp = 0;
    
    for (const uid in employeeMap) {
      const user = employeeMap[uid];
      const data = todayShifts[uid] || { inTime: null, outTime: null, breaks: [] };
      
      let statusStr = "Not Started";
      let badgeClass = "badge-idle";
      
      const isPunchedIn = !!data.inTime;
      const isPunchedOut = !!data.outTime;
      const isOnBreak = data.breaks && data.breaks.some(b => !b.end);

      if (isPunchedOut) {
        statusStr = "Shift Ended";
        badgeClass = "badge-ended";
      } else if (isOnBreak) {
        statusStr = "On Break";
        badgeClass = "badge-paused";
      } else if (isPunchedIn) {
        statusStr = "Working";
        badgeClass = "badge-active";
        activeEmp++;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div style="font-weight: 600;">${user.name}</div><div style="font-size: 0.8rem; color: var(--text-muted);">${user.email}</div></td>
        <td><span class="badge ${badgeClass}">${statusStr}</span></td>
        <td>${formatTime(data.inTime)}</td>
        <td>${formatDuration(calculateWorkMs(data))}</td>
      `;
      tbody.appendChild(tr);
    }
    
    document.getElementById('activeEmpCount').textContent = activeEmp;
    if (Object.keys(employeeMap).length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">No employees registered yet.</td></tr>';
    }
  });
}

// Live Clock & UI Updater
setInterval(() => {
  const now = new Date();
  document.querySelectorAll('.live-clock').forEach(el => el.textContent = now.toLocaleTimeString());
  document.querySelectorAll('.current-date').forEach(el => el.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));

  if (currentUser && currentProfile) {
    const todayStr = getTodayString();
    
    if (currentProfile.role === 'employee') {
      if (todayData && todayData.date !== todayStr) {
        // Handle midnight rollover by reloading shift
        loadEmployeeShift();
      } else if (todayData && todayData.inTime && !todayData.outTime) {
        // Update live durations
        document.getElementById('todayWork').textContent = formatDuration(calculateWorkMs(todayData));
        document.getElementById('todayBreak').textContent = formatDuration(calculateBreakTotalMs(todayData.breaks));
        
        // Update history table live row if it's currently rendered
        if (historyCache[todayStr] && !historyCache[todayStr].outTime) {
             const tbody = document.getElementById('historyBody');
             // Simplest way is just triggering a quick refresh of the DOM part or full re-render
             // For performance on small apps, full re-render is okay, but we'll leave it as is 
             // since they can see the main big live timer.
        }
      }
    } else if (currentProfile.role === 'admin') {
      // The onSnapshot listener handles live updates automatically for admin.
      // But we still need to recalculate the duration strings every second.
      // Easiest is to trigger a snapshot refresh or re-calculate DOM elements.
      // We'll leave it as is for simplicity, relying on the snapshot to give the baseline.
    }
  }
}, 1000);
