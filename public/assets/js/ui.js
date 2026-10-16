/* GTPM — shared UI helpers */
const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* escape HTML */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* theme */
  const THEME_KEY = 'gtpm-theme';
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.dataset.theme = saved;
    $$('[data-theme-toggle]').forEach((btn) => { btn.textContent = saved === 'dark' ? '☀' : '☾'; });
  }
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = cur;
    localStorage.setItem(THEME_KEY, cur);
    $$('[data-theme-toggle]').forEach((btn) => { btn.textContent = cur === 'dark' ? '☀' : '☾'; });
  }

  /* nav active state + counts */
  function initNav() {
    const path = location.pathname.split('/').pop() || 'index.html';
    $$('.nav-list a').forEach((a) => {
      const href = a.getAttribute('href');
      if (href === path) a.classList.add('active');
    });
    API.stats().then((r) => {
      const m = r.data;
      const map = { 'companies.html': m.orgs, 'sectors.html': m.sectors, 'technologies.html': m.technologies, 'funding.html': m.funding_rounds, 'signals.html': m.signals, 'opportunities.html': m.opportunities, 'people.html': m.people };
      $$('.nav-list a').forEach((a) => {
        const href = a.getAttribute('href');
        if (map[href] != null) {
          const span = a.querySelector('.nav-count');
          if (span) span.textContent = map[href].toLocaleString();
        }
      });
    }).catch(() => {});
  }

  /* header search → search page */
  function initSearchBox() {
    const input = $('#header-q');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        location.href = `/search.html?q=${encodeURIComponent(input.value.trim())}`;
      }
    });
  }

  /* money formatting */
  const money = (usd, compact = true) => {
    if (usd == null) return '—';
    if (compact) {
      if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd % 1e6 === 0 ? 0 : 1)}M`;
      if (usd >= 1e3) return `$${(usd / 1e3).toFixed(usd % 1e3 === 0 ? 0 : 1)}K`;
    }
    return `$${Number(usd).toLocaleString()}`;
  };

  /* date helpers */
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m] = iso.split('-');
    if (!m) return y;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  };
  const timeAgo = (iso) => {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'today';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  /* type label prettifier */
  const typeLabel = (t) => (t || '').replace(/_/g, ' ');
  const typeClass = (t) => ({
    startup: 'green', scaleup: 'green', corporation: 'blue', bank: 'blue', telecom: 'blue',
    university: 'purple', research: 'purple', government: 'gold', accelerator: 'cyan',
    incubator: 'cyan', venture_fund: 'gold', ngo: 'gold', community: 'purple', media: 'cyan',
    regulator: 'red', infrastructure: 'blue',
  }[t] || '');

  /* importance badge */
  const impBadge = (imp) => `<span class="badge-imp ${esc(imp)}">${esc(imp)}</span>`;

  /* verification badge */
  const verifBadge = (v) => `<span class="badge-verif ${esc(v)}">${esc(v || 'reported')}</span>`;

  /* confidence bar */
  const conf = (c) => `
    <span class="conf" title="Confidence ${Math.round((c ?? 0) * 100)}%">
      <span class="bar"><i style="width:${Math.round((c ?? 0) * 100)}%"></i></span>
      ${Math.round((c ?? 0) * 100)}%
    </span>`;

  /* sparkline (simple SVG) */
  function sparkline(values, w = 90, h = 26) {
    if (!values || values.length < 2) return '<svg class="spark" width="0"></svg>';
    const max = Math.max(...values), min = Math.min(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / range) * (h - 8)}`);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
      <polyline points="${pts.join(' ')}" stroke="var(--green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /* skeleton loader */
  const loader = (label = 'Loading intelligence…') => `<div class="loading"><div class="spin"></div>${esc(label)}</div>`;
  const empty = (msg = 'No data yet.') => `<div class="empty">${esc(msg)}</div>`;

  /* error banner */
  function errorBanner(err, root) {
    const el = root || document.body;
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = `⚠ ${err.message || 'Something went wrong'}`;
    el.prepend(banner);
  }

  /* pagination */
  function pagination(page, totalPages, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'pagination';
    const prev = document.createElement('button');
    prev.textContent = '← Prev'; prev.disabled = page <= 1;
    prev.onclick = () => onChange(page - 1);
    const next = document.createElement('button');
    next.textContent = 'Next →'; next.disabled = page >= totalPages;
    next.onclick = () => onChange(page + 1);
    const info = document.createElement('span');
    info.className = 'mono muted small'; info.style.cssText = 'align-self:center';
    info.textContent = `Page ${page} of ${totalPages}`;
    wrap.append(prev, info, next);
    return wrap;
  }

  /* watchlist follow toggle button */
  function followButton(type, id, name) {
    const btn = document.createElement('button');
    btn.className = 'chip follow-btn';
    btn.type = 'button';
    let following = false;

    API.watchlists().then((r) => {
      following = (r.data || []).some((w) => w.entity_type === type && w.entity_id === id);
      paint();
    }).catch(() => {});

    function paint() {
      btn.textContent = following ? '★ Following' : '☆ Follow';
      btn.classList.toggle('green', following);
      btn.title = `${following ? 'Unfollow' : 'Follow'} ${name} to ${following ? 'stop' : 'get'} alerts`;
    }

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        if (following) await API.unfollow(type, id);
        else await API.follow(type, id);
        following = !following;
        paint();
        if (typeof window.refreshAlertBadge === 'function') window.refreshAlertBadge();
      } catch (e) { errorBanner(e, btn); }
      btn.disabled = false;
    });

    paint();
    return btn;
  }

  return { $, $$, esc, initTheme, toggleTheme, initNav, initSearchBox, money, fmtDate, timeAgo, typeLabel, typeClass, impBadge, verifBadge, conf, sparkline, loader, empty, errorBanner, pagination, followButton };
})();

document.addEventListener('DOMContentLoaded', () => {
  UI.initTheme();
  UI.initNav();
  UI.initSearchBox();
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', UI.toggleTheme));
});
