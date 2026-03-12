/**
 * MCP-Hub Dashboard Application
 *
 * Real-time monitoring dashboard for MCP-Hub
 */

const API_BASE = window.location.origin;
const REFRESH_INTERVAL = 5000; // 5 seconds

let lastData = {};

// Auth: use same key as /ui and /admin (read scope)
function getAuthHeaders() {
  const key = localStorage.getItem('mcpHubApiKey') || '';
  return key ? { Authorization: 'Bearer ' + key } : {};
}

function dashboardFetch(url, options = {}) {
  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  return fetch(url, { ...options, headers });
}

function showAuthRequired(show) {
  const el = document.getElementById('auth-required-banner');
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Dashboard] Initializing...');
  const keyInput = document.getElementById('dashboard-api-key');
  const saveBtn = document.getElementById('dashboard-save-key');
  if (keyInput) keyInput.value = localStorage.getItem('mcpHubApiKey') || '';
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const key = (document.getElementById('dashboard-api-key')?.value || '').trim();
      localStorage.setItem('mcpHubApiKey', key);
      showAuthRequired(false);
      refreshAll();
    });
  }
  const tokenAlBtn = document.getElementById('dashboard-token-al');
  if (tokenAlBtn) {
    tokenAlBtn.addEventListener('click', async () => {
      tokenAlBtn.disabled = true;
      tokenAlBtn.textContent = 'İstek…';
      showAuthRequired(false);
      try {
        const res = await fetch(window.location.origin + '/ui/token', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const json = await res.json().catch(() => ({}));
        const data = json?.data || json;
        const token = data?.token ? String(data.token) : '';
        if (token) {
          localStorage.setItem('mcpHubApiKey', token);
          const keyInput = document.getElementById('dashboard-api-key');
          if (keyInput) keyInput.value = token;
          showAuthRequired(false);
          refreshAll();
          tokenAlBtn.textContent = 'Alındı';
          setTimeout(() => { tokenAlBtn.textContent = 'Token al'; }, 2000);
        } else {
          showAuthRequired(true);
        }
      } catch (e) {
        showAuthRequired(true);
      } finally {
        tokenAlBtn.disabled = false;
        if (tokenAlBtn.textContent === 'İstek…') tokenAlBtn.textContent = 'Token al';
      }
    });
  }
  refreshAll();
  setInterval(refreshAll, REFRESH_INTERVAL);
});

// Refresh all dashboard data
async function refreshAll() {
  try {
    await Promise.all([
      fetchHealth(),
      fetchMetrics(),
      fetchJobStats(),
      fetchErrors(),
    ]);
    updateConnectionStatus('connected');
  } catch (error) {
    console.error('[Dashboard] Error refreshing data:', error);
    updateConnectionStatus('error');
  }
  updateLastUpdated();
}

// Update connection status indicator
function updateConnectionStatus(status) {
  const indicator = document.getElementById('connection-status');
  indicator.className = 'status-indicator';
  const statusText = indicator.querySelector('.status-text');
  const statusDot = indicator.querySelector('.status-dot');

  switch (status) {
    case 'connected':
      indicator.classList.add('connected');
      statusText.textContent = 'Connected';
      statusDot.style.animation = 'none';
      break;
    case 'error':
      indicator.classList.add('error');
      statusText.textContent = 'Connection Error';
      statusDot.style.animation = 'none';
      break;
    default:
      indicator.classList.remove('connected', 'error');
      statusText.textContent = 'Connecting...';
      statusDot.style.animation = 'pulse 2s infinite';
  }
}

// Update last updated timestamp
function updateLastUpdated() {
  const element = document.getElementById('last-updated');
  const now = new Date();
  element.textContent = now.toLocaleTimeString();
}

// Fetch health data
async function fetchHealth() {
  try {
    const response = await dashboardFetch(`${API_BASE}/observability/health`);
    if (response.status === 401) {
      showAuthRequired(true);
      return;
    }
    showAuthRequired(false);
    if (!response.ok) throw new Error('Health endpoint failed');

    const data = await response.json();
    if (!data.ok) throw new Error(data.error?.message || 'Unknown error');

    updateHealthCard(data);
    updatePluginsGrid(data.plugins);
  } catch (error) {
    console.error('[Dashboard] Health fetch error:', error);
  }
}

// Update health overview card
function updateHealthCard(data) {
  const uptimeEl = document.getElementById('uptime');
  const memoryEl = document.getElementById('memory-usage');

  if (data.uptime) {
    uptimeEl.textContent = data.uptime.human || formatUptime(data.uptime.seconds);
  }

  if (data.memory) {
    memoryEl.textContent = `Heap: ${data.memory.heapUsedMb}MB / RSS: ${data.memory.rssMb}MB`;
  }
}

// Update plugins grid
function updatePluginsGrid(plugins) {
  const grid = document.getElementById('plugins-grid');

  if (!plugins || plugins.length === 0) {
    grid.innerHTML = '<div class="empty">No plugins loaded</div>';
    return;
  }

  grid.innerHTML = plugins.map(plugin => {
    let statusClass = 'healthy';
    if (plugin.errors > 0 && plugin.errors > plugin.calls * 0.1) {
      statusClass = 'error';
    } else if (plugin.errors > 0) {
      statusClass = 'warning';
    }

    return `
      <div class="plugin-card ${statusClass}">
        <div class="plugin-name">
          ${plugin.name}
          <span class="plugin-version">${plugin.version}</span>
        </div>
        <div class="plugin-stats">
          <span>${plugin.calls} calls</span>
          ${plugin.errors > 0 ? `<span style="color: var(--accent-red)">${plugin.errors} errors</span>` : ''}
        </div>
        <div class="plugin-status">${plugin.status}</div>
      </div>
    `;
  }).join('');
}

// Fetch metrics data
async function fetchMetrics() {
  try {
    const response = await dashboardFetch(`${API_BASE}/observability/metrics`);
    if (response.status === 401) return;
    if (!response.ok) throw new Error('Metrics endpoint failed');

    const text = await response.text();
    const metrics = parsePrometheusMetrics(text);

    updateMetricsCards(metrics);
  } catch (error) {
    console.error('[Dashboard] Metrics fetch error:', error);
  }
}

// Parse Prometheus text format
function parsePrometheusMetrics(text) {
  const metrics = {};
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;

    // Parse metric line: name{labels} value
    const match = line.match(/^([^{]+)(?:{([^}]+)})?\s+(.+)$/);
    if (match) {
      const [, name, labels, value] = match;
      const numValue = parseFloat(value);

      if (!metrics[name]) {
        metrics[name] = [];
      }

      metrics[name].push({
        labels: labels || '',
        value: numValue,
      });
    }
  }

  return metrics;
}

// Update metrics cards
function updateMetricsCards(metrics) {
  const totalRequests = getMetricValue(metrics, 'mcp_hub_requests_total');
  const totalErrors = getMetricValue(metrics, 'mcp_hub_errors_total');

  // Update requests card
  const requestsEl = document.getElementById('total-requests');
  const requestTrendEl = document.getElementById('request-trend');

  if (totalRequests !== null) {
    requestsEl.textContent = totalRequests.toLocaleString();

    if (lastData.totalRequests !== undefined) {
      const diff = totalRequests - lastData.totalRequests;
      const diffPerMin = Math.round(diff * (60 / (REFRESH_INTERVAL / 1000)));
      requestTrendEl.textContent = diff >= 0 ? `+${diffPerMin}/min` : `${diffPerMin}/min`;
      requestTrendEl.className = diff >= 0 ? 'trend positive' : 'trend negative';
    } else {
      requestTrendEl.textContent = 'Waiting for trend...';
    }

    lastData.totalRequests = totalRequests;
  }

  // Update error rate card
  const errorRateEl = document.getElementById('error-rate');
  const errorTrendEl = document.getElementById('error-trend');

  if (totalRequests !== null && totalErrors !== null) {
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : '0.00';
    errorRateEl.textContent = `${errorRate}%`;

    if (lastData.totalErrors !== undefined) {
      const diff = totalErrors - lastData.totalErrors;
      errorTrendEl.textContent = diff === 0 ? 'No change' : diff > 0 ? `+${diff} new` : `${diff}`;
      errorTrendEl.className = diff > 0 ? 'trend negative' : 'trend positive';
    } else {
      errorTrendEl.textContent = 'Waiting for trend...';
    }

    lastData.totalErrors = totalErrors;
  }

  // Update active jobs card
  const activeJobsEl = document.getElementById('active-jobs');
  const jobsBreakdownEl = document.getElementById('jobs-breakdown');

  const queued = getMetricValue(metrics, 'mcp_hub_jobs_queued') || 0;
  const running = getMetricValue(metrics, 'mcp_hub_jobs_running') || 0;

  activeJobsEl.textContent = (queued + running).toString();
  jobsBreakdownEl.textContent = `${queued} queued, ${running} running`;
}

// Get single metric value
function getMetricValue(metrics, name) {
  const metric = metrics[name];
  if (!metric || metric.length === 0) return null;

  // Sum all values for this metric
  return metric.reduce((sum, m) => sum + m.value, 0);
}

// Fetch job stats
async function fetchJobStats() {
  try {
    const [statsResponse, jobsResponse] = await Promise.all([
      dashboardFetch(`${API_BASE}/jobs/stats`).catch(() => null),
      dashboardFetch(`${API_BASE}/jobs?limit=10`).catch(() => null),
    ]);

    let stats = { queued: 0, running: 0, completed: 0, failed: 0 };
    let recentJobs = [];

    if (statsResponse && statsResponse.ok) {
      const statsData = await statsResponse.json();
      if (statsData.stats) {
        stats = statsData.stats;
      }
    }

    if (jobsResponse && jobsResponse.ok) {
      const jobsData = await jobsResponse.json();
      recentJobs = jobsData.jobs || [];
    }

    updateJobStats(stats);
    updateRecentJobs(recentJobs);
  } catch (error) {
    console.error('[Dashboard] Job stats fetch error:', error);
  }
}

// Update job stats display
function updateJobStats(stats) {
  document.getElementById('jobs-queued').textContent = stats.queued || 0;
  document.getElementById('jobs-running').textContent = stats.running || 0;
  document.getElementById('jobs-completed').textContent = stats.completed || 0;
  document.getElementById('jobs-failed').textContent = stats.failed || 0;
}

// Update recent jobs list
function updateRecentJobs(jobs) {
  const container = document.getElementById('recent-jobs');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<div class="empty">No recent jobs</div>';
    return;
  }

  container.innerHTML = jobs.map(job => {
    const stateClass = job.state.toLowerCase();
    const timeAgo = formatTimeAgo(new Date(job.createdAt));

    return `
      <div class="job-item">
        <span class="job-id">${job.id.slice(0, 8)}</span>
        <span class="job-type">${job.type}</span>
        <span class="job-state ${stateClass}">${job.state}</span>
        <div class="job-progress">
          <div class="job-progress-bar" style="width: ${job.progress || 0}%"></div>
        </div>
        <span class="job-time">${timeAgo}</span>
      </div>
    `;
  }).join('');
}

// Fetch errors
async function fetchErrors() {
  try {
    const response = await dashboardFetch(`${API_BASE}/observability/errors?limit=10`);
    if (response.status === 401) return;
    if (!response.ok) throw new Error('Errors endpoint failed');

    const data = await response.json();
    if (!data.ok) throw new Error(data.error?.message || 'Unknown error');

    updateErrorsList(data.errors || []);
  } catch (error) {
    console.error('[Dashboard] Errors fetch error:', error);
  }
}

// Update errors list
function updateErrorsList(errors) {
  const container = document.getElementById('errors-list');

  if (!errors || errors.length === 0) {
    container.innerHTML = '<div class="empty">No recent errors</div>';
    return;
  }

  container.innerHTML = errors.map(error => {
    const timeAgo = formatTimeAgo(new Date(error.timestamp || error.createdAt));
    const pluginName = error.plugin || 'system';

    return `
      <div class="error-item">
        <div class="error-header">
          <span class="error-code">${error.status || 'ERROR'}</span>
          <span class="error-plugin">${pluginName}</span>
        </div>
        <div class="error-message">${escapeHtml(error.message || error.error || 'Unknown error')}</div>
        <div class="error-time">${timeAgo}</div>
      </div>
    `;
  }).join('');
}

// Refresh errors (manual button)
async function refreshErrors() {
  const button = document.querySelector('.errors-controls button');
  button.disabled = true;
  button.textContent = 'Refreshing...';

  await fetchErrors();

  button.disabled = false;
  button.textContent = 'Refresh';
}

// Helper: Format uptime
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// Helper: Format time ago
function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose refresh function globally for button
window.refreshErrors = refreshErrors;
