/* ═══════════════════════════════════════════════════
   API CLIENT
═══════════════════════════════════════════════════ */
const API = {
  token: localStorage.getItem('pma_token'),

  async request(method, path, body) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = 'Bearer ' + this.token;
    }

    const opts = { method, headers };
    if (body) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch('/api' + path, opts);

    if (res.status === 401) {
      localStorage.removeItem('pma_token');
      localStorage.removeItem('pma_user');
      window.location.href = '/login';
      return;
    }

    // 403: throw with detail message so callers can handle properly
    if (res.status === 403) {
      var _403json;
      try { _403json = await res.json(); } catch(e) { _403json = null; }
      throw new Error((_403json && (_403json.detail || _403json.message)) || '权限不足 (HTTP 403)');
    }

    var json;
    try {
      json = await res.json();
    } catch (parseErr) {
      var text = await res.text().catch(function() { return ''; });
      throw new Error('服务器返回异常 (HTTP ' + res.status + '): ' + (text || '').substring(0, 200));
    }
    if (json.code !== 0) {
      throw new Error(json.message || json.detail || 'Request failed (code=' + json.code + ')');
    }
    return json.data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path, body) { return this.request('DELETE', path, body); },
};

// ── Global display-name cache (username → display_name) ──
var _displayNameCache = {};
var _displayNameLoaded = false;

function getDisplayName(username) {
  if (!username) return '';
  return _displayNameCache[username] || username;
}

function loadDisplayNameCache() {
  if (_displayNameLoaded) return Promise.resolve(_displayNameCache);
  // Use public user list — available to all authenticated users
  return API.get('/users/options').then(function(users) {
    if (!users) { _displayNameLoaded = true; return _displayNameCache; }
    (users || []).forEach(function(u) {
      if (u.name && u.name !== u.code) {
        _displayNameCache[u.code] = u.name;
      }
    });
    _displayNameLoaded = true;
    return _displayNameCache;
  }).catch(function() {
    _displayNameLoaded = true;
    return _displayNameCache;
  });
}

// Auto-load on first use
setTimeout(function() {
  var token = localStorage.getItem('pma_token');
  if (token) loadDisplayNameCache();
}, 500);

// ── Server status poller (shutdown notice + restart detection) ──
var _serverStartTime = null;

(function pollServerStatus() {
  fetch('/api/server-status')
    .then(function(res) { return res.json(); })
    .then(function(json) {
      // Restart detection
      if (json.server_start_time) {
        if (_serverStartTime === null) {
          _serverStartTime = json.server_start_time;
        } else if (_serverStartTime !== json.server_start_time) {
          localStorage.removeItem('pma_token');
          localStorage.removeItem('pma_user');
          window.location.href = '/login';
          return;
        }
      }

      // Shutdown banner
      var banner = document.getElementById('shutdown-banner');
      if (banner) {
        if (json.status === 'shutting-down' && json.notice) {
          document.getElementById('shutdown-banner-msg').textContent = json.notice.message;
          banner.style.display = 'block';
        } else {
          banner.style.display = 'none';
        }
      }
    })
    .catch(function() {
      // Server is down
      var banner = document.getElementById('shutdown-banner');
      if (banner) {
        document.getElementById('shutdown-banner-msg').textContent = '服务器已离线，请等待恢复后刷新页面。';
        banner.style.display = 'block';
      }
    })
    .finally(function() {
      setTimeout(pollServerStatus, 2000);
    });
})();
