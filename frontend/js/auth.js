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
  const errorEl = document.getElementById('login-error');
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
