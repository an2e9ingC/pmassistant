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

    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(json.message || 'Request failed');
    }
    return json.data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};
