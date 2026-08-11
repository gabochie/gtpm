/* GTPM — companies directory */
(async () => {
  const { $, esc, typeLabel, typeClass, verifBadge, loader, empty, pagination } = UI;
  const root = $('#companies-root');

  const TYPES = ['startup','scaleup','corporation','bank','telecom','university','research','government','accelerator','incubator','venture_fund','ngo','community','media','regulator','infrastructure'];

  // populate type filter
  const typeSel = $('#f-type');
  TYPES.forEach((t) => typeSel.insertAdjacentHTML('beforeend', `<option value="${t}">${typeLabel(t)}</option>`));

  let sectors = [];
  try {
    const s = await API.sectors();
    sectors = s.data;
    const secSel = $('#f-sector');
    sectors.forEach((x) => secSel.insertAdjacentHTML('beforeend', `<option value="${esc(x.slug)}">${esc(x.name)} (${x.org_count})</option>`));
  } catch {}

  let page = 1;
  const state = () => ({
    page, page_size: 24,
    type: typeSel.value || undefined,
    sector: $('#f-sector').value || undefined,
    q: $('#f-q').value.trim() || undefined,
    sort: 'name',
  });

  async function render() {
    root.innerHTML = loader('Compiling the directory…');
    try {
      const r = await API.companies(state());
      const rows = r.data;
      root.innerHTML = rows.length ? `
        <div class="grid grid-3">
          ${rows.map((o) => `
            <a class="card org-card" href="company.html?slug=${esc(o.slug)}" style="color:inherit;text-decoration:none">
              <div class="org-head">
                <div class="org-name">${esc(o.name)}</div>
                <span class="org-type">${esc(typeLabel(o.org_type))}</span>
              </div>
              <p class="org-desc">${esc((o.description ?? '').slice(0, 160))}${(o.description ?? '').length > 160 ? '…' : ''}</p>
              <div class="org-foot">
                ${(o.sectors ?? []).slice(0, 3).map((sx) => `<span class="chip">${esc(sx.name)}</span>`).join('')}
                ${o.hq_city ? `<span class="mono small muted">📍 ${esc(o.hq_city)}</span>` : ''}
                ${o.founded_year ? `<span class="mono small muted">est. ${o.founded_year}</span>` : ''}
                ${o.confidence ? `<span class="conf" style="margin-left:auto"><span class="bar"><i style="width:${Math.round(o.confidence * 100)}%"></i></span></span>` : ''}
              </div>
            </a>`).join('')}
        </div>` : empty('No organisations match these filters.');
      const pages = Math.max(1, Math.ceil(r.meta.total / r.meta.page_size));
      const pager = $('#pager');
      pager.innerHTML = '';
      if (pages > 1) pager.appendChild(pagination(page, pages, (p) => { page = p; render(); }));
    } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
  }

  $('#f-type').addEventListener('change', () => { page = 1; render(); });
  $('#f-sector').addEventListener('change', () => { page = 1; render(); });
  $('#f-q').addEventListener('input', debounce(() => { page = 1; render(); }, 350));
  $('#f-reset').addEventListener('click', () => {
    typeSel.value = ''; $('#f-sector').value = ''; $('#f-q').value = ''; page = 1; render();
  });

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  render();
})();
