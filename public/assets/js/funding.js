/* GTPM — funding tracker */
(async () => {
  const { $, esc, money, fmtDate, typeLabel, loader, empty, pagination } = UI;

  let sectors = [];
  try {
    const s = await API.sectors();
    sectors = s.data;
    const secSel = $('#f-sector');
    sectors.forEach((x) => secSel.insertAdjacentHTML('beforeend', `<option value="${esc(x.slug)}">${esc(x.name)}</option>`));
  } catch {}

  let page = 1;
  const PAGE_SIZE = 30;

  async function renderStats() {
    try {
      const s = await API.fundingStats();
      const d = s.data;
      $('#funding-hero').innerHTML = `
        <div class="fh-card"><div class="fh-val">${money(d.total_usd)}</div><div class="fh-label">Total tracked funding</div></div>
        <div class="fh-card"><div class="fh-val">${d.rounds}</div><div class="fh-label">Rounds tracked</div></div>
        ${d.by_sector.slice(0, 3).map((x) => `
          <div class="fh-card"><div class="fh-val" style="font-size:18px">${money(x.total_usd)}</div><div class="fh-label">${esc(x.sector)}</div></div>`).join('')}
        ${d.by_year.length ? `<div class="fh-card"><div class="fh-val" style="font-size:18px">${esc(d.by_year[d.by_year.length - 1].year)}</div><div class="fh-label">Latest year with rounds</div></div>` : ''}`;
    } catch (e) { /* stats optional */ }
  }

  async function render() {
    const tbl = $('#funding-table');
    tbl.innerHTML = `<tbody><tr><td colspan="6">${loader('Fetching rounds…')}</td></tr></tbody>`;
    try {
      const sector = $('#f-sector').value || undefined;
      const r = await API.funding({ page, page_size: PAGE_SIZE, sector });
      tbl.innerHTML = `
        <thead><tr><th>Organisation</th><th>Round</th><th>Amount</th><th>Date</th><th>Lead investor</th><th>Confidence</th></tr></thead>
        <tbody>
          ${r.data.length ? r.data.map((f) => `
            <tr>
              <td><a href="company.html?slug=${esc(f.organization.slug)}" style="font-weight:600">${esc(f.organization.name)}</a>
                <div class="small muted">${esc(typeLabel(f.organization.org_type))}</div></td>
              <td><span class="chip gold">${esc(f.round_type.replace(/_/g, ' '))}</span></td>
              <td class="num" style="font-weight:600">${money(f.amount_usd)}</td>
              <td class="mono small">${fmtDate(f.date)}</td>
              <td class="small">${f.lead_investor ? esc(f.lead_investor) : f.investors?.length ? esc(f.investors.slice(0, 2).map((i) => i.name).join(', ')) : '—'}</td>
              <td class="mono small">${Math.round((f.confidence ?? 0) * 100)}%</td>
            </tr>`).join('') : `<tr><td colspan="6" class="muted">No funding rounds tracked yet.</td></tr>`}
        </tbody>`;
      const pages = Math.max(1, Math.ceil(r.meta.total / r.meta.page_size));
      const pager = $('#pager');
      pager.innerHTML = '';
      if (pages > 1) pager.appendChild(pagination(page, pages, (p) => { page = p; render(); }));
    } catch (e) { tbl.innerHTML = ''; UI.errorBanner(e, tbl); }
  }

  $('#f-sector').addEventListener('change', () => { page = 1; render(); });

  await renderStats();
  render();
})();
