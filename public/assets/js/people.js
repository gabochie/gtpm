/* GTPM — people directory */
(async () => {
  const { $, esc, loader, empty, pagination, verifBadge } = UI;
  const tbl = $('#people-table');
  let page = 1;
  const PAGE_SIZE = 40;

  async function render() {
    tbl.innerHTML = `<tbody><tr><td colspan="5">${loader('Compiling people…')}</td></tr></tbody>`;
    try {
      const r = await API.people({ page, page_size: PAGE_SIZE });
      tbl.innerHTML = `
        <thead><tr><th>Name</th><th>Role</th><th>Organisations</th><th>Title</th><th>Status</th></tr></thead>
        <tbody>
          ${r.data.length ? r.data.map((p) => `
            <tr>
              <td style="font-weight:600">${esc(p.name)}
                ${p.organizations.some((o) => o.role === 'founder') ? ' <span class="chip gold" style="font-size:9.5px">founder</span>' : ''}
              </td>
              <td class="mono small">${esc((p.role ?? '').replace(/_/g, ' '))}</td>
              <td>
                ${p.organizations.map((o) => o.slug ? `<a href="company.html?slug=${esc(o.slug)}">${esc(o.name)}</a>` : esc(o.name)).join(', ') || '<span class="muted">—</span>'}
              </td>
              <td class="small muted">${esc(p.title ?? '—')}</td>
              <td>${verifBadge(p.verification_status)}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="muted">No people tracked yet.</td></tr>`}
        </tbody>`;
      const pages = Math.max(1, Math.ceil(r.meta.total / r.meta.page_size));
      const pager = $('#pager');
      pager.innerHTML = '';
      if (pages > 1) pager.appendChild(pagination(page, pages, (p) => { page = p; render(); }));
    } catch (e) { tbl.innerHTML = ''; UI.errorBanner(e, tbl); }
  }

  render();
})();
