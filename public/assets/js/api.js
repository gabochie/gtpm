/* GTPM — API client */
const API = (() => {
  const DEVICE_KEY = 'gtpm_device_id';

  /* persistent anonymous device id — sent as x-user-id (Phase 4 auth replaces) */
  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Request failed (${res.status})`);
    }
    return res.json();
  }
  const get = (path) => request(path);
  const userHeaders = () => ({ 'x-user-id': deviceId() });
  const qs = (params = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  };
  return {
    get,
    stats: () => get('/stats'),
    companies: (params = {}) => get(`/companies${qs(params)}`),
    company: (slug) => get(`/companies/${slug}`).then((r) => r.data),
    companyTimeline: (slug) => get(`/companies/${slug}/timeline`),
    compare: (ids) => get(`/companies/compare?ids=${ids.join(',')}`),
    people: (params = {}) => get(`/people${qs(params)}`),
    sectors: () => get('/sectors'),
    sector: (slug) => get(`/sectors/${slug}`),
    technologies: () => get('/technologies'),
    technology: (slug) => get(`/technologies/${slug}`),
    funding: (params = {}) => get(`/funding${qs(params)}`),
    fundingStats: () => get('/funding/stats'),
    events: (params = {}) => get(`/events${qs(params)}`),
    signals: (params = {}) => get(`/signals${qs(params)}`),
    signalsSummary: () => get('/signals/summary'),
    opportunities: (params = {}) => get(`/opportunities${qs(params)}`),
    opportunity: (slug) => get(`/opportunities/${slug}`),
    relationships: (org) => get(`/relationships${org ? `?org=${org}` : ''}`),
    reports: () => get('/reports'),
    report: (slug) => get(`/reports/${slug}`),
    search: (q) => get(`/search?q=${encodeURIComponent(q)}`),
    brief: () => get('/intelligence/brief'),
    market: () => get('/intelligence/market'),
    map: (params = {}) => get(`/map${qs(params)}`),
    mapClusters: () => get('/map/clusters'),

    // ---- watchlists (device-scoped follows) ----
    watchlists: () => request('/watchlists', { headers: userHeaders() }),
    follow: (entityType, entityId) => request('/watchlists', {
      method: 'POST', headers: userHeaders(),
      body: { entity_type: entityType, entity_id: entityId },
    }),
    unfollow: (entityType, entityId) => request(`/watchlists/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, {
      method: 'DELETE', headers: userHeaders(),
    }),

    // ---- alerts ----
    alerts: (params = {}) => request(`/alerts${qs(params)}`, { headers: userHeaders() }),
    markAlertsRead: (ids) => request('/alerts/read', { method: 'POST', headers: userHeaders(), body: { ids } }),
    alertsUnreadCount: () => request('/alerts/unread-count', { headers: userHeaders() }),

    // ---- discovery pipeline (admin; x-api-key) ----
    discoverySources: () => get('/discovery/sources'),
    discoveryQueue: (params = {}) => get(`/discovery/queue${qs(params)}`),
    discoveryRun: (apiKey) => request('/discovery/run', { method: 'POST', headers: { 'x-api-key': apiKey } }),
    discoveryIngest: (item, apiKey) => request('/discovery/ingest', { method: 'POST', headers: { 'x-api-key': apiKey }, body: item }),
    discoveryResolve: (id, body, apiKey) => request(`/discovery/queue/${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'x-api-key': apiKey }, body,
    }),
  };
})();
