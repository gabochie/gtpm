/* GTPM — alerts feed + watchlist management */
(async () => {
  const { $, $$, esc, impBadge, timeAgo, loader, empty, pagination, errorBanner } = UI;
  const list = $('#alerts-list');
  const PAGE_SIZE = 20;

  const ENTITY_ICON = { organization: '◈', sector: '⌗', technology: '▣', person: '👤', market: '★' };
  const ENTITY_LABEL = { organization: 'Organisation', sector: 'Sector', technology: 'Technology', person: 'Person', market: 'Market' };

  let page = 1;
  let total = 0;
  const impSel = $('#f-imp');
  const unreadChk = $('#f-unread');
  const markReadBtn = $('#mark-read');

  async function load() {
    list.innerHTML = loader('Fetching alerts…');
    try {
      const r = await API.alerts({
        limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
        importance: impSel.value, unread: unreadChk.checked ? '1' : '',
      });
      const d = r.data;
      total = d.total;
      render(d.rows);
      renderPager();
      refreshBadge();
    } catch (e) { list.innerHTML = ''; errorBanner(e, list); }
  }

  function render(rows) {
    list.innerHTML = rows.length ? rows.map((a) => `
      <div class="signal-item ${a.is_read ? '' : 'alert-unread'}">
        <div class="sig-ico">${ENTITY_ICON[a.entity_type] ?? '◈'}</div>
        <div class="sig-body">
          <div class="sig-title">${a.entity_name ? `<span class="chip" style="margin-right:6px">${esc(a.entity_name)}</span>` : ''}${esc(a.title)}</div>
          ${a.body ? `<div class="sig-desc">${esc(a.body)}</div>` : ''}
          <div class="sig-meta">
            ${impBadge(a.importance)}
            <span class="mono small muted">${timeAgo(a.created_at)} · ${esc((a.alert_type || 'alert').replace(/_/g, ' '))} · ${esc(ENTITY_LABEL[a.entity_type] ?? a.entity_type)}</span>
            ${a.is_read ? '' : `<button class="chip mark-one" data-id="${esc(a.id)}">Mark read</button>`}
          </div>
        </div>
      </div>`).join('') : empty('No alerts yet. Follow an organisation, sector or technology to start tracking.');
    $$('.mark-one', list).forEach((b) => b.addEventListener('click', async () => {
      try {
        await API.markAlertsRead([b.dataset.id]);
        const item = b.closest('.signal-item');
        if (item) item.classList.remove('alert-unread');
        b.remove();
        refreshBadge();
      } catch (e) { errorBanner(e, list); }
    }));
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pager = $('#pager');
    pager.innerHTML = '';
    if (pages > 1) pager.appendChild(pagination(page, pages, (p) => { page = p; load(); }));
  }

  function refreshBadge() {
    if (typeof window.refreshAlertBadge === 'function') window.refreshAlertBadge();
  }

  /* watchlist: market quick-follow card + followed entities with unfollow */
  async function loadWatchlist() {
    const wl = $('#watchlist-root');
    wl.innerHTML = loader('Loading watchlist…');
    try {
      const rows = (await API.watchlists()).data;
      const marketOn = rows.some((w) => w.entity_type === 'market' && w.entity_id === 'GH');
      const cards = rows.filter((w) => !(w.entity_type === 'market' && w.entity_id === 'GH'));
      wl.innerHTML = `
        ${marketOn ? '' : `
        <div class="card" style="padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div>
            <div style="font-weight:600;font-size:13.5px">★ Follow the whole Ghana market</div>
            <div class="small muted">Get an alert for every major signal across the ecosystem.</div>
          </div>
          <button class="chip" id="follow-market">Follow</button>
        </div>`}
        <div class="card" style="padding:16px">
          <div class="sec-kicker" style="margin-bottom:4px">Following</div>
          ${cards.length ? cards.map((w) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--border);padding:10px 0">
            <div>
              <div style="font-weight:600;font-size:13.5px">${ENTITY_ICON[w.entity_type] ?? '·'} ${esc(w.entity_name ?? w.entity_id)}</div>
              <div class="small muted">${esc(ENTITY_LABEL[w.entity_type] ?? w.entity_type)}</div>
            </div>
            <button class="chip unfollow" data-type="${esc(w.entity_type)}" data-id="${esc(w.entity_id)}">✕ Unfollow</button>
          </div>`).join('') : '<p class="muted small" style="margin:6px 0">Not following anything yet.</p>'}
        </div>`;
      const mkt = $('#follow-market', wl);
      if (mkt) mkt.addEventListener('click', async () => {
        try { await API.follow('market', 'GH'); loadWatchlist(); }
        catch (e) { errorBanner(e, wl); }
      });
      $$('.unfollow', wl).forEach((b) => b.addEventListener('click', async () => {
        try {
          await API.unfollow(b.dataset.type, b.dataset.id);
          await Promise.all([loadWatchlist(), load()]);
        } catch (e) { errorBanner(e, wl); }
      }));
    } catch (e) { wl.innerHTML = ''; errorBanner(e, wl); }
  }

  impSel.addEventListener('change', () => { page = 1; load(); });
  unreadChk.addEventListener('change', () => { page = 1; load(); });
  markReadBtn.addEventListener('click', async () => {
    markReadBtn.disabled = true;
    try { await API.markAlertsRead(); await load(); }
    catch (e) { errorBanner(e, list); }
    markReadBtn.disabled = false;
  });

  load();
  loadWatchlist();
})();
