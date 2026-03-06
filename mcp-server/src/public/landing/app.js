/**
 * MCP-Hub Landing Page - Real-time Activity
 *
 * Fetches and displays live system activity
 */

const API_BASE = window.location.origin;
const REFRESH_INTERVAL = 5000; // 5 seconds

// DOM Elements
const elements = {
  systemStatus: document.getElementById('system-status'),
  totalPlugins: document.getElementById('total-plugins'),
  totalJobs: document.getElementById('total-jobs'),
  uptime: document.getElementById('uptime'),
  queueCount: document.getElementById('queue-count'),
  jobsQueued: document.getElementById('jobs-queued'),
  jobsRunning: document.getElementById('jobs-running'),
  jobsCompleted: document.getElementById('jobs-completed'),
  jobsFailed: document.getElementById('jobs-failed'),
  recentJobs: document.getElementById('recent-jobs'),
  pluginsCount: document.getElementById('plugins-count'),
  pluginsList: document.getElementById('plugins-list'),
  eventsList: document.getElementById('events-list'),
  lastUpdated: document.getElementById('last-updated'),
};

// State
let lastJobsCount = 0;
let eventHistory = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Landing] Initializing...');
  refreshAll();
  setInterval(refreshAll, REFRESH_INTERVAL);
});

// Refresh all data
async function refreshAll() {
  try {
    await Promise.all([
      fetchHeroStats(),
      fetchJobStats(),
      fetchPluginActivity(),
      fetchRecentEvents(),
    ]);
    updateLastUpdated();
  } catch (error) {
    console.error('[Landing] Error refreshing:', error);
    elements.systemStatus.textContent = 'System Offline';
    elements.systemStatus.parentElement.querySelector('.status-dot').style.background = 'var(--accent-red)';
  }
}

// Update timestamp
function updateLastUpdated() {
  if (elements.lastUpdated) {
    elements.lastUpdated.textContent = new Date().toLocaleTimeString();
  }
}

// Fetch hero stats
async function fetchHeroStats() {
  try {
    const [healthRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/observability/health`).catch(() => null),
      fetch(`${API_BASE}/jobs/stats`).catch(() => null),
    ]);

    // Update uptime
    if (healthRes && healthRes.ok) {
      const health = await healthRes.json();
      if (health.ok && health.uptime) {
        elements.uptime.textContent = formatUptimeShort(health.uptime.seconds);

        // Count plugins
        const plugins = health.plugins || [];
        elements.totalPlugins.textContent = plugins.length;
      }
    }

    // Update jobs count
    if (statsRes && statsRes.ok) {
      const stats = await statsRes.json();
      if (stats.stats) {
        const totalToday = (stats.stats.completed || 0) + (stats.stats.failed || 0);
        elements.totalJobs.textContent = totalToday.toLocaleString();
      }
    }
  } catch (error) {
    console.error('[Landing] Hero stats error:', error);
  }
}

// Fetch job queue stats
async function fetchJobStats() {
  try {
    const [statsRes, jobsRes] = await Promise.all([
      fetch(`${API_BASE}/jobs/stats`).catch(() => null),
      fetch(`${API_BASE}/jobs?limit=5`).catch(() => null),
    ]);

    let stats = { queued: 0, running: 0, completed: 0, failed: 0 };
    let jobs = [];

    if (statsRes && statsRes.ok) {
      const data = await statsRes.json();
      stats = data.stats || stats;
    }

    if (jobsRes && jobsRes.ok) {
      const data = await jobsRes.json();
      jobs = data.jobs || [];
    }

    // Update counts
    const total = stats.queued + stats.running;
    elements.queueCount.textContent = `${total} job${total !== 1 ? 's' : ''}`;
    elements.jobsQueued.textContent = stats.queued;
    elements.jobsRunning.textContent = stats.running;
    elements.jobsCompleted.textContent = stats.completed?.toLocaleString() || 0;
    elements.jobsFailed.textContent = stats.failed?.toLocaleString() || 0;

    // Track new jobs for events
    if (lastJobsCount > 0 && jobs.length > lastJobsCount) {
      const newJobs = jobs.slice(0, jobs.length - lastJobsCount);
      newJobs.forEach(job => {
        addEvent({
          type: 'job',
          description: `New ${job.type} job ${job.state}`,
          timestamp: job.createdAt,
        });
      });
    }
    lastJobsCount = jobs.length;

    // Update recent jobs list
    updateRecentJobs(jobs.slice(0, 5));
  } catch (error) {
    console.error('[Landing] Job stats error:', error);
  }
}

// Update recent jobs display
function updateRecentJobs(jobs) {
  if (!elements.recentJobs) return;

  if (jobs.length === 0) {
    elements.recentJobs.innerHTML = '<div class="empty">No recent jobs</div>';
    return;
  }

  elements.recentJobs.innerHTML = jobs.map(job => `
    <div class="job-item">
      <span class="job-id">${job.id.slice(0, 6)}</span>
      <span class="job-type">${job.type}</span>
      <span class="job-state ${job.state.toLowerCase()}">${job.state}</span>
      <div class="job-progress">
        <div class="job-progress-bar" style="width: ${job.progress || 0}%"></div>
      </div>
    </div>
  `).join('');
}

// Fetch plugin activity
async function fetchPluginActivity() {
  try {
    const response = await fetch(`${API_BASE}/observability/health`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.ok) return;

    const plugins = data.plugins || [];
    const stats = data.audit || {};

    elements.pluginsCount.textContent = `${plugins.length} plugin${plugins.length !== 1 ? 's' : ''}`;

    // Sort by most active
    const sortedPlugins = plugins
      .sort((a, b) => (b.calls || 0) - (a.calls || 0))
      .slice(0, 5);

    updatePluginsList(sortedPlugins);
  } catch (error) {
    console.error('[Landing] Plugin activity error:', error);
  }
}

// Update plugins list
function updatePluginsList(plugins) {
  if (!elements.pluginsList) return;

  if (plugins.length === 0) {
    elements.pluginsList.innerHTML = '<div class="empty">No plugins active</div>';
    return;
  }

  elements.pluginsList.innerHTML = plugins.map(plugin => {
    const icon = getPluginIcon(plugin.name);
    return `
      <div class="plugin-item">
        <div class="plugin-icon">${icon}</div>
        <div class="plugin-info">
          <div class="plugin-name">${plugin.name}</div>
          <div class="plugin-calls">${plugin.calls || 0} calls today</div>
        </div>
        <div class="plugin-status"></div>
      </div>
    `;
  }).join('');
}

// Get emoji icon for plugin
function getPluginIcon(name) {
  const icons = {
    'observability': '📊',
    'llm-router': '🤖',
    'n8n': '⚡',
    'github': '🐙',
    'jira': '📋',
    'database': '🗄️',
    'policy': '🛡️',
    'repo-intelligence': '🔍',
    'prompt-registry': '📝',
    'marketplace': '🏪',
  };

  for (const [key, icon] of Object.entries(icons)) {
    if (name.toLowerCase().includes(key)) return icon;
  }

  return '🔌';
}

// Fetch recent events (from audit logs)
async function fetchRecentEvents() {
  try {
    const response = await fetch(`${API_BASE}/audit/logs?limit=10`);
    if (!response.ok) return;

    const data = await response.json();
    const logs = data.logs || [];

    // Convert logs to events
    const events = logs
      .filter(log => log.status === 'success' || log.status === 'client_error')
      .slice(0, 5)
      .map(log => ({
        type: log.plugin || 'system',
        description: `${log.method || 'GET'} ${log.path || '/'}`,
        timestamp: log.timestamp,
        status: log.status,
      }));

    // Merge with event history and dedupe
    eventHistory = [...events, ...eventHistory]
      .filter((e, i, arr) => arr.findIndex(t => t.timestamp === e.timestamp) === i)
      .slice(0, 10);

    updateEventsList(eventHistory.slice(0, 5));
  } catch (error) {
    console.error('[Landing] Events error:', error);
  }
}

// Add event to history
function addEvent(event) {
  eventHistory.unshift(event);
  eventHistory = eventHistory.slice(0, 10);
  updateEventsList(eventHistory.slice(0, 5));
}

// Update events list
function updateEventsList(events) {
  if (!elements.eventsList) return;

  if (events.length === 0) {
    elements.eventsList.innerHTML = '<div class="empty">No recent events</div>';
    return;
  }

  elements.eventsList.innerHTML = events.map(event => `
    <div class="event-item">
      <span class="event-time">${formatTimeShort(event.timestamp)}</span>
      <div class="event-content">
        <div class="event-type">${event.type}</div>
        <div class="event-desc">${event.description}</div>
      </div>
    </div>
  `).join('');
}

// Format helpers
function formatUptimeShort(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimeShort(isoString) {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
