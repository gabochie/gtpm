/* GTPM — signals feed (client-side importance filter + pagination) */
(async () => {
  const { $, esc, impBadge, timeAgo, loader, empty, pagination } = UI;
  const list = $('#signals-list');
  const PAGE_SIZE = 15;

  const ICONS = { funding: '💰', regulatory: '⚖', expansion: '↗', hiring: '👥', product: '🛠', tech_adoption: '◈', partnership: '🤝', market_position: '◎' };

  let all = [];
  let page = 1;
  const impSel = $('#f-imp');

  async function fetchAll() {
    list.innerHTML = loader('Scanning for signals…');
    try {
      const r = await API.signals({ page_size: 200 });
      all = r.data;
      render();
    } catch (e) { list.innerHTML = ''; UI.errorBanner(e, list); }
  }

  function filtered() {
    const imp = impSel.value;
    return imp ? all.filter((x) => x.importance === imp) : all;
  }

  function render() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    list.innerHTML = slice.length ? slice.map((x) => `
      <div class="signal-item">
        <div class="sig-ico">${ICONS[x.signal_type] ?? '◈'}</div>
        <div class="sig-body">
          <div class="sig-title">${x.organization ? `<a href="company.html?slug=${esc(x.organization.slug)}">${esc(x.organization.name)}</a> — ` : ''}${esc(x.title)}</div>
          ${x.description ? `<div class="sig-desc">${esc(x.description)}</div>` : ''}
          ${x.strategic_interpretation ? `<div class="sig-why">${esc(x.strategic_interpretation)}</div>` : ''}
          <div class="sig-meta">
            ${impBadge(x.importance)}
            <span class="mono small muted">${timeAgo(x.date)} · ${esc(x.signal_type.replace(/_/g, ' '))}</span>
          </div>
        </div>
      </div>`).join('') : empty('No signals match this filter.');
    const pager = $('#pager');
    pager.innerHTML = '';
    if (pages > 1) pager.appendChild(pagination(page, pages, (p) => { page = p; render(); }));
  }

  impSel.addEventListener('change', () => { page = 1; render(); });
  fetchAll();
})();
