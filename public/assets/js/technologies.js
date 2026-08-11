/* GTPM — technology radar */
(async () => {
  const { $, esc, loader, empty } = UI;
  const root = $('#radar-full');
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');

  if (slug) {
    const main = $('.wrap');
    main.innerHTML = loader('Loading technology intelligence…');
    try {
      const t = await API.technology(slug);
      const d = t.data;
      document.title = `${d.name} — GTPM`;
      main.innerHTML = `
        <div class="sec-head" style="margin-top:0">
          <div>
            <span class="sec-kicker">Technology intelligence</span>
            <h1 style="font-size:34px">${esc(d.name)}</h1>
            <p class="hero-sub" style="font-size:14px;margin-top:8px">${esc(d.description ?? '')}</p>
          </div>
          <a class="sec-link" href="technologies.html">← Full radar</a>
        </div>
        <div class="funding-hero">
          <div class="fh-card"><div class="fh-val">${esc(d.radar_ring)}</div><div class="fh-label">Radar ring</div></div>
          <div class="fh-card"><div class="fh-val">${esc(d.lifecycle)}</div><div class="fh-label">Lifecycle</div></div>
          <div class="fh-card"><div class="fh-val">${d.org_count}</div><div class="fh-label">Organisations adopting</div></div>
          <div class="fh-card"><div class="fh-val">${d.trend_score != null ? Math.round(d.trend_score * 100) + '%' : '—'}</div><div class="fh-label">Trend score</div></div>
        </div>
        <section style="margin-top:32px">
          <div class="sec-head"><div><span class="sec-kicker">Adopters</span><h2>Who is using ${esc(d.name)}</h2></div></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Organisation</th><th>Type</th><th>Adoption</th><th>Sector</th></tr></thead>
            <tbody>
              ${d.organizations?.length ? d.organizations.map((o) => `
                <tr>
                  <td><a href="company.html?slug=${esc(o.slug)}" style="font-weight:600">${esc(o.name)}</a></td>
                  <td class="mono small">${esc((o.org_type ?? '').replace(/_/g, ' '))}</td>
                  <td class="mono small">${esc(o.adoption_level ?? '—')}</td>
                  <td class="small muted">${esc((o.sectors ?? []).slice(0, 2).join(', '))}</td>
                </tr>`).join('') : `<tr><td colspan="4" class="muted">No adopters mapped yet.</td></tr>`}
            </tbody>
          </table></div>
        </section>`;
    } catch (e) { main.innerHTML = ''; UI.errorBanner(e, main); }
    return;
  }

  root.innerHTML = loader('Reading the radar…');
  try {
    const t = await API.technologies();
    const rings = ['EXPERIMENTAL', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'DECLINING'];
    const ringBlurb = {
      EXPERIMENTAL: 'Early experiments, unproven locally.',
      EMERGING: 'First production uses appearing in Ghana.',
      ACCELERATING: 'Rapid adoption; strategic gap forming.',
      MAINSTREAM: 'Established; table stakes, not differentiation.',
      DECLINING: 'Adoption falling or being displaced.',
    };
    root.innerHTML = rings.map((r) => {
      const items = t.data.filter((x) => x.radar_ring === r).sort((a, b) => b.org_count - a.org_count);
      return `
      <div class="radar-ring ${r}">
        <h4>${r}</h4>
        <p class="small muted" style="margin-bottom:8px">${ringBlurb[r]}</p>
        <ul class="tech-list">
          ${items.map((x) => `
            <li>
              <a href="technologies.html?slug=${esc(x.slug)}" title="${esc(x.description ?? '')}">${esc(x.name)}</a>
              <span class="t-count">${x.org_count} orgs</span>
            </li>`).join('') || '<li class="muted">—</li>'}
        </ul>
      </div>`;
    }).join('');

    // full table
    const tbl = $('#tech-table');
    tbl.innerHTML = `
      <thead><tr><th>Technology</th><th>Ring</th><th>Lifecycle</th><th>Organisations</th><th>Trend</th></tr></thead>
      <tbody>${t.data.sort((a, b) => b.org_count - a.org_count).map((x) => `
        <tr>
          <td><a href="technologies.html?slug=${esc(x.slug)}" style="font-weight:600">${esc(x.name)}</a>
            ${x.description ? `<div class="small muted">${esc(x.description)}</div>` : ''}</td>
          <td class="mono small">${esc(x.radar_ring)}</td>
          <td class="mono small">${esc(x.lifecycle)}</td>
          <td class="mono">${x.org_count}</td>
          <td class="mono small">${x.trend_score != null ? Math.round(x.trend_score * 100) + '%' : '—'}</td>
        </tr>`).join('')}</tbody>`;
  } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
})();
