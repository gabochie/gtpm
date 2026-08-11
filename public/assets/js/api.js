/* GTPM — API client */
const API = (() => {
  async function get(path) {
    const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Request failed (${res.status})`);
    }
    return res.json();
  }
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
  };
})();
