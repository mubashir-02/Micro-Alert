// ─── MicroAlert Admin Panel Controller ──────────────────────────────────────────

// ─── State ──────────────────────────────────────────────────────────────────────
let allAdminRisks = [];
let selectedIds = new Set();
let searchTimer = null;

// Chart instances
let typeChartInstance = null;
let severityChartInstance = null;
let timeChartInstance = null;

// ─── Chart.js Global Config ─────────────────────────────────────────────────────
Chart.defaults.color = '#94A3B8';
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.08)';
Chart.defaults.font.family = "'Inter', sans-serif";

// ─── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadRisks();
  loadDispatches();
});

// ─── Refresh Dashboard ──────────────────────────────────────────────────────────
function refreshDashboard() {
  loadStats();
  loadRisks();
  loadDispatches();
  showToast('Dashboard refreshed!', 'success');
}

// ─── Load Stats & Charts ────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/admin/api/stats');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const d = json.data;

    animateCounter('totalRisks', d.totalRisks);
    animateCounter('activeRisks', d.activeRisks);
    animateCounter('clearedRisks', d.clearedRisks);
    animateCounter('activeDispatches', d.activeDispatches || 0);
    document.getElementById('clearanceRate').textContent = d.clearanceRate + '%';

    renderTypeChart(d.typeCounts);
    renderSeverityChart(d.severityCounts);
    renderTimeChart(d.timeCounts);
  } catch (err) {
    console.error('Stats load failed:', err);
    showToast('Failed to load statistics', 'error');
  }
}

// ─── Animate Counter ────────────────────────────────────────────────────────────
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Render Type Chart (Bar) ────────────────────────────────────────────────────
function renderTypeChart(typeCounts) {
  const ctx = document.getElementById('typeChart').getContext('2d');
  if (typeChartInstance) typeChartInstance.destroy();

  const typeLabels = {
    sudden_brake: 'Sudden Brake', blind_turn: 'Blind Turn',
    habitual_violation: 'Violation', accident: 'Accident'
  };
  const types = ['sudden_brake', 'blind_turn', 'habitual_violation', 'accident'];
  const labels = types.map(t => typeLabels[t]);
  const activeData = [];
  const clearedData = [];

  types.forEach(t => {
    const found = typeCounts.find(tc => tc._id === t);
    const total = found ? found.count : 0;
    const cleared = found ? found.cleared : 0;
    activeData.push(total - cleared);
    clearedData.push(cleared);
  });

  typeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Active',
          data: activeData,
          backgroundColor: ['rgba(239,68,68,0.75)', 'rgba(249,115,22,0.75)', 'rgba(234,179,8,0.75)', 'rgba(220,38,38,0.75)'],
          borderRadius: 6, borderSkipped: false
        },
        {
          label: 'Cleared',
          data: clearedData,
          backgroundColor: 'rgba(16,185,129,0.65)',
          borderRadius: 6, borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 16, font: { size: 11, weight: '600' } }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' } } },
        y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.06)' }, ticks: { stepSize: 1, font: { size: 11 } } }
      }
    }
  });
}

// ─── Render Severity Chart (Doughnut) ───────────────────────────────────────────
function renderSeverityChart(severityCounts) {
  const ctx = document.getElementById('severityChart').getContext('2d');
  if (severityChartInstance) severityChartInstance.destroy();

  const levels = [1, 2, 3, 4, 5];
  const labels = ['1 – Minor', '2 – Low', '3 – Moderate', '4 – High', '5 – Critical'];
  const colors = [
    'rgba(16,185,129,0.85)', 'rgba(234,179,8,0.85)',
    'rgba(249,115,22,0.85)', 'rgba(239,68,68,0.85)', 'rgba(220,38,38,0.9)'
  ];

  const data = levels.map(l => {
    const found = severityCounts.find(s => s._id === l);
    return found ? found.count : 0;
  });

  severityChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#1E2A45', hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: {
          position: 'right',
          labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11, weight: '500' } }
        }
      }
    }
  });
}

// ─── Render Time Chart (Polar Area) ─────────────────────────────────────────────
function renderTimeChart(timeCounts) {
  const ctx = document.getElementById('timeChart').getContext('2d');
  if (timeChartInstance) timeChartInstance.destroy();

  const timeOrder = ['morning_rush', 'afternoon', 'evening_rush', 'night'];
  const timeLabels = { morning_rush: '🌅 Morning', afternoon: '☀️ Afternoon', evening_rush: '🌆 Evening', night: '🌙 Night' };
  const timeColors = ['rgba(245,158,11,0.7)', 'rgba(37,99,235,0.7)', 'rgba(239,68,68,0.7)', 'rgba(139,92,246,0.7)'];

  const labels = timeOrder.map(t => timeLabels[t]);
  const data = timeOrder.map(t => {
    const found = timeCounts.find(tc => tc._id === t);
    return found ? found.count : 0;
  });

  timeChartInstance = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{ data, backgroundColor: timeColors, borderWidth: 2, borderColor: '#1E2A45' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11, weight: '500' } }
        }
      },
      scales: { r: { grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { display: false, stepSize: 2 } } }
    }
  });
}

// ─── Load Dispatches ────────────────────────────────────────────────────────────
async function loadDispatches() {
  try {
    const res = await fetch('/admin/api/dispatches');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const grid = document.getElementById('dispatchGrid');
    if (json.data.length === 0) {
      grid.innerHTML = '<div class="empty-state">No emergency dispatches yet</div>';
      return;
    }

    const icons = { ambulance: '🚑', police: '👮', fire: '🚒', roadside: '🆘' };
    const labels = { ambulance: 'Ambulance', police: 'Police', fire: 'Fire Service', roadside: 'Roadside' };
    const statusFlow = ['pending', 'dispatched', 'en_route', 'arrived', 'resolved'];

    grid.innerHTML = json.data.slice(0, 12).map(d => {
      const nextStatus = statusFlow[Math.min(statusFlow.indexOf(d.status) + 1, statusFlow.length - 1)];
      const nextLabel = nextStatus.replace('_', ' ');

      return `
        <div class="dispatch-card">
          <div class="dispatch-card-header">
            <div class="dispatch-card-type">${icons[d.type] || '🚨'} ${labels[d.type] || d.type}</div>
            <span class="dispatch-card-status ${d.status}">${d.status.replace('_', ' ')}</span>
          </div>
          <div class="dispatch-card-body">
            <div>📍 <span>${parseFloat(d.lat).toFixed(4)}, ${parseFloat(d.lng).toFixed(4)}</span></div>
            <div>🕐 ${new Date(d.createdAt).toLocaleString()}</div>
            ${d.resolvedAt ? `<div>✅ Resolved: ${new Date(d.resolvedAt).toLocaleString()}</div>` : ''}
          </div>
          ${d.status !== 'resolved' && d.status !== 'cancelled' ? `
          <div class="dispatch-card-actions">
            <button onclick="updateDispatch('${d._id}', '${nextStatus}')">➡️ ${nextLabel}</button>
            <button onclick="updateDispatch('${d._id}', 'cancelled')">❌ Cancel</button>
          </div>` : ''}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Dispatches load failed:', err);
  }
}

async function updateDispatch(id, status) {
  try {
    const res = await fetch(`/admin/api/dispatches/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Dispatch updated to: ${status}`, 'success');
      loadDispatches();
      loadStats();
    }
  } catch (err) {
    showToast('Failed to update dispatch', 'error');
  }
}

// ─── Load Risks Table ───────────────────────────────────────────────────────────
async function loadRisks() {
  try {
    const type = document.getElementById('filterType').value;
    const severity = document.getElementById('filterSeverity').value;
    const status = document.getElementById('filterStatus').value;
    const search = document.getElementById('filterSearch').value.trim();

    const params = new URLSearchParams();
    if (type !== 'all') params.set('type', type);
    if (severity !== 'all') params.set('severity', severity);
    if (status !== 'all') params.set('status', status);
    if (search) params.set('search', search);

    const res = await fetch(`/admin/api/risks?${params.toString()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    allAdminRisks = json.data;
    selectedIds.clear();
    updateSelectedCount();
    renderTable();
  } catch (err) {
    console.error('Risks load failed:', err);
    showToast('Failed to load risks', 'error');
  }
}

function debounceSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadRisks(), 350);
}

// ─── Render Table ───────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('hazardTableBody');
  const emptyEl = document.getElementById('tableEmpty');

  if (allAdminRisks.length === 0) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  const typeLabels = {
    sudden_brake: '🛑 Sudden Brake', blind_turn: '🔄 Blind Turn',
    habitual_violation: '⚠️ Violation', accident: '💥 Accident'
  };

  tbody.innerHTML = allAdminRisks.map(r => {
    const isCleared = r.cleared === true || r.cleared === 1;
    const rowClass = isCleared ? 'row-cleared' : '';
    const riskId = r._id || r.id;
    const checked = selectedIds.has(riskId) ? 'checked' : '';

    return `
      <tr class="${rowClass}" id="row-${riskId}">
        <td class="td-check"><input type="checkbox" ${checked} onchange="toggleSelect('${riskId}', this.checked)"></td>
        <td style="text-align:center;"><div class="severity-badge s${r.severity}">${r.severity}</div></td>
        <td><span class="type-badge ${r.type}">${typeLabels[r.type] || r.type}</span></td>
        <td class="road-cell">
          <div class="road-name">${escapeHtml(r.roadName)}</div>
          ${r.landmark ? `<div class="road-landmark">📍 ${escapeHtml(r.landmark)}</div>` : ''}
        </td>
        <td class="desc-cell">${escapeHtml(r.description)}</td>
        <td>
          <span class="status-badge ${isCleared ? 'cleared' : 'active'}">
            ${isCleared ? '✅ Cleared' : '🔴 Active'}
          </span>
        </td>
        <td>
          <div class="action-buttons">
            ${isCleared
              ? `<button class="btn-undo" onclick="unclearRisk('${riskId}')">↩ Undo</button>`
              : `<button class="btn-clear" onclick="clearRisk('${riskId}')">✅ Clear</button>`
            }
            <button class="btn-delete" onclick="deleteRisk('${riskId}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Selection ──────────────────────────────────────────────────────────────────
function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelectedCount();
}

function toggleSelectAll() {
  const allCheckbox = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('#hazardTableBody input[type="checkbox"]');

  if (allCheckbox.checked) {
    allAdminRisks.forEach(r => { if (!r.cleared && r.cleared !== 1) selectedIds.add(r._id || r.id); });
  } else {
    selectedIds.clear();
  }

  checkboxes.forEach(cb => {
    const id = cb.closest('tr').id.replace('row-', '');
    const risk = allAdminRisks.find(r => (r._id || r.id) == id);
    if (risk && !risk.cleared && risk.cleared !== 1) cb.checked = allCheckbox.checked;
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  const countEl = document.getElementById('selectedCount');
  const btn = document.getElementById('clearSelectedBtn');
  if (countEl) countEl.textContent = selectedIds.size;
  if (btn) btn.disabled = selectedIds.size === 0;
}

// ─── CRUD Operations ────────────────────────────────────────────────────────────
async function clearRisk(id) {
  try {
    const res = await fetch(`/admin/api/risks/${id}/clear`, { method: 'PUT' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const row = document.getElementById(`row-${id}`);
    if (row) row.classList.add('row-clear-anim');

    showToast('Hazard cleared! ✅', 'success');
    setTimeout(() => { loadStats(); loadRisks(); }, 600);
  } catch (err) { showToast('Failed to clear: ' + err.message, 'error'); }
}

async function unclearRisk(id) {
  try {
    const res = await fetch(`/admin/api/risks/${id}/unclear`, { method: 'PUT' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    showToast('Hazard reactivated', 'success');
    loadStats(); loadRisks();
  } catch (err) { showToast('Failed to reactivate: ' + err.message, 'error'); }
}

async function clearSelected() {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds);
  try {
    const res = await fetch('/admin/api/risks/clear-bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    ids.forEach(id => { const row = document.getElementById(`row-${id}`); if (row) row.classList.add('row-clear-anim'); });
    showToast(`${json.modified} hazards cleared! ✅`, 'success');
    setTimeout(() => {
      selectedIds.clear(); updateSelectedCount();
      document.getElementById('selectAll').checked = false;
      loadStats(); loadRisks();
    }, 600);
  } catch (err) { showToast('Bulk clear failed: ' + err.message, 'error'); }
}

async function deleteRisk(id) {
  if (!confirm('Permanently delete this hazard?')) return;
  try {
    const res = await fetch(`/admin/api/risks/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    showToast('Hazard deleted', 'success');
    loadStats(); loadRisks();
  } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
}

// ─── Utility ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '✅' : '❌'} ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(12px)'; setTimeout(() => toast.remove(), 300); }, 3500);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
