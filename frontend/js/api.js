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
  del(path) { return this.request('DELETE', path); },
};
