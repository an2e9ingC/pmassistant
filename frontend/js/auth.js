/* ═══════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════ */
function isLoggedIn() {
  return !!localStorage.getItem('pma_token');
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('pma_user') || 'null');
  } catch(e) {
    return null;
  }
}

async function onLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('local-login-error');
  const btn = document.getElementById('login-btn');

  btn.disabled = true;
  btn.textContent = '登录中...';
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (json.code !== 0) {
      errorEl.textContent = json.detail || json.message || '登录失败';
      btn.disabled = false;
      btn.textContent = '登录';
      return;
    }
    API.token = json.data.access_token;
    localStorage.setItem('pma_token', json.data.access_token);
    localStorage.setItem('pma_user', JSON.stringify(json.data.user));
    window.location.href = '/';
  } catch(err) {
    errorEl.textContent = '网络错误，请检查服务器连接';
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

async function refreshCurrentUser() {
  try {
    var data = await API.get('/auth/me');
    if (data) {
      localStorage.setItem('pma_user', JSON.stringify(data));
    }
    return data;
  } catch (e) {
    console.error('Failed to refresh user:', e);
    return null;
  }
}

function logout() {
  localStorage.removeItem('pma_token');
  localStorage.removeItem('pma_user');
  window.location.href = '/login';
}

function switchAccount() {
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:420px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">切换到其他账号</span>' +
        '<button class="note-dialog-close" onclick="closePwDialog()">&times;</button></div>' +
      '<div style="padding:4px 0;font-size:13px;line-height:1.8">' +
        '<p style="margin-bottom:12px">如需使用<strong>其他 GitLab 账号</strong>登录，请：</p>' +
        '<ol style="margin-bottom:16px;padding-left:18px">' +
          '<li style="margin-bottom:6px">点击下方按钮打开 GitLab</li>' +
          '<li style="margin-bottom:6px">在 GitLab 页面点击<strong>右上角头像 → 退出</strong></li>' +
          '<li>重新打开PMA登陆页面「使用 GitLab 登录」重新登录</li>' +
        '</ol>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">' +
        '<button class="btn" onclick="closePwDialog()">取消</button>' +
        '<a href="http://192.168.0.128" target="_blank" class="btn" style="text-decoration:none;background:var(--warn);color:#fff" onclick="localStorage.clear();sessionStorage.clear();closePwDialog();window.location.href=\'/login\'">打开 GitLab 退出当前账号</a>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ── GitLab OAuth ── */

var _gitlabOAuthEnabled = false;

async function checkGitlabOAuthConfig() {
  var gitlabSection = document.getElementById('gitlab-login-section');
  var localSection = document.getElementById('local-login-section');
  if (!gitlabSection || !localSection) return;

  try {
    var res = await fetch('/api/auth/gitlab/config');
    var json = await res.json();
    if (json.code === 0 && json.data && json.data.enabled) {
      _gitlabOAuthEnabled = true;
      gitlabSection.style.display = '';
      localSection.style.display = 'none';
      // Focus handling for OAuth callback
      handleGitlabCallback();
      return;
    }
  } catch(e) {
    console.warn('Failed to check GitLab OAuth config:', e);
  }

  // OAuth not enabled — show local login form directly
  _gitlabOAuthEnabled = false;
  gitlabSection.style.display = 'none';
  localSection.style.display = '';
  var usernameEl = document.getElementById('login-username');
  if (usernameEl) { usernameEl.required = true; usernameEl.focus(); }
  var passwordEl = document.getElementById('login-password');
  if (passwordEl) passwordEl.required = true;
  // Check for error params from failed OAuth callback
  var urlParams = new URLSearchParams(window.location.search);
  var error = urlParams.get('error');
  if (error) {
    var errorEl = document.getElementById('local-login-error');
    if (error === 'gitlab_unreachable') {
      errorEl.textContent = 'GitLab 服务暂时不可用，请稍后重试';
    } else if (error === 'admin_must_use_local_login') {
      errorEl.textContent = '管理员请使用本地密码登录';
    } else if (error === 'invalid_state') {
      errorEl.textContent = '登录已过期，请重新发起';
    } else {
      errorEl.textContent = '登录失败，请重试';
    }
    // Clean URL
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, '/login');
    }
  }
}

async function loginWithGitlab() {
  var btn = document.getElementById('gitlab-login-btn');
  var errorEl = document.getElementById('login-error');
  if (btn) { btn.disabled = true; btn.textContent = '正在跳转...'; }
  if (errorEl) errorEl.textContent = '';

  try {
    var res = await fetch('/api/auth/gitlab/authorize');
    var json = await res.json();
    if (json.code !== 0 || !json.data || !json.data.authorize_url) {
      if (errorEl) errorEl.textContent = json.message || 'GitLab OAuth 未配置或不可用';
      if (btn) { btn.disabled = false; btn.textContent = '使用 GitLab 登录'; }
      return;
    }
    // Open OAuth flow in a centered popup instead of full-page redirect
    var w = 600, h = 700;
    var left = (screen.width - w) / 2, top = (screen.height - h) / 2;
    var popup = window.open(json.data.authorize_url, 'gitlab-oauth',
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    if (!popup || popup.closed) {
      // Popup blocked — fall back to full-page redirect
      window.location.href = json.data.authorize_url;
      return;
    }
    // Poll: if logged in → redirect; if popup closed without login → re-enable button
    var pollTimer = setInterval(function() {
      if (isLoggedIn()) {
        clearInterval(pollTimer);
        window.location.href = '/';
        return;
      }
      if (popup.closed) {
        clearInterval(pollTimer);
        if (btn) { btn.disabled = false; btn.textContent = '使用 GitLab 登录'; }
      }
    }, 500);
  } catch(e) {
    if (errorEl) errorEl.textContent = '无法连接 GitLab OAuth 服务';
    if (btn) { btn.disabled = false; btn.textContent = '使用 GitLab 登录'; }
  }
}

function handleGitlabCallback() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('gitlab_auth') === '1') {
    var token = params.get('token');
    if (token) {
      API.token = token;
      localStorage.setItem('pma_token', token);
      if (params.get('new_user') === '1') {
        sessionStorage.setItem('pma_new_user', '1');
      }
      // If opened as popup, redirect opener and close self
      if (window.opener && window.opener !== window) {
        try {
          window.opener.location.href = '/';
        } catch(e) {
          // Cross-origin — fall through to redirect self
          window.location.href = '/';
          return;
        }
        window.close();
        return;
      }
      // Full-page redirect fallback
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, '/login');
      }
      window.location.href = '/';
    }
  }
}

function toggleAdminLogin() {
  var gitlabSection = document.getElementById('gitlab-login-section');
  var localSection = document.getElementById('local-login-section');
  if (!gitlabSection || !localSection) return;

  // Toggle based on which section is currently visible
  if (gitlabSection.style.display !== 'none') {
    // Currently showing GitLab → switch to local login
    gitlabSection.style.display = 'none';
    localSection.style.display = '';
    var usernameEl = document.getElementById('login-username');
    if (usernameEl) { usernameEl.required = true; usernameEl.focus(); }
    var passwordEl = document.getElementById('login-password');
    if (passwordEl) passwordEl.required = true;
    var errorEl = document.getElementById('local-login-error');
    if (errorEl) errorEl.textContent = '';
  } else {
    // Currently showing local → switch back to GitLab login
    localSection.style.display = 'none';
    gitlabSection.style.display = '';
    var usernameEl = document.getElementById('login-username');
    if (usernameEl) usernameEl.required = false;
    var passwordEl = document.getElementById('login-password');
    if (passwordEl) passwordEl.required = false;
  }
}

// Auto-check OAuth config on page load
document.addEventListener('DOMContentLoaded', function() {
  checkGitlabOAuthConfig();
});
