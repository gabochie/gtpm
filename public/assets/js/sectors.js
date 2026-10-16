/* GTPM — sectors page (grid + sector detail) */
(async () => {
  const { $, esc, typeLabel, loader, empty, money } = UI;
  const root = $('#sectors-root');
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');

  if (slug) {
    root.innerHTML = loader('Loading sector intelligence…');
    try {
      const s = await API.sector(slug);
      document.title = `${s.data.name} — GTPM`;
      const orgs = s.data.organizations;
      const techs = s.data.technologies;
      root.innerHTML = `
        <div class="sec-head" style="margin-top:0">
          <div>
            <span class="sec-kicker">Sector intelligence</span>
            <h1 style="font-size:34px">${esc(s.data.name)}</h1>
            <p class="hero-sub" style="font-size:14px;margin-top:8px">${esc(s.data.description ?? '')}</p>
          </div>
          <div style="display:flex;align-items:center;gap:14px">
            <span id="follow-slot"></span>
            <a class="sec-link" href="sectors.html">← All sectors</a>
          </div>
        </div>
        <div class="funding-hero">
          <div class="fh-card"><div class="fh-val">${orgs.length}</div><div class="fh-label">Organisations mapped</div></div>
          <div class="fh-card"><div class="fh-val">${money(s.data.funding?.total_usd ?? 0)}</div><div class="fh-label">Tracked funding · ${s.data.funding?.rounds ?? 0} rounds</div></div>
          <div class="fh-card"><div class="fh-val">${techs.length}</div><div class="fh-label">Technologies in use</div></div>
          <div class="fh-card"><div class="fh-val">${s.data.opportunities?.length ?? 0}</div><div class="fh-label">Open opportunities</div></div>
        </div>
        ${s.data.opportunities?.length ? `
        <section>
          <div class="sec-head"><div><span class="sec-kicker">Opportunity Radar</span><h2>Open opportunities in this sector</h2></div></div>
          <div class="grid grid-2">${s.data.opportunities.map((o) => `
            <a class="card opp-card" href="opportunities.html?slug=${esc(o.slug)}" style="color:inherit;text-decoration:none">
              <span class="opp-class ${esc(o.classification)}">${esc(o.classification)}</span>
              <div class="opp-title">${esc(o.title)}</div>
              <p class="opp-problem">${esc((o.problem ?? '').slice(0, 160))}</p>
            </a>`).join('')}</div>
        </section>` : ''}
        <section style="margin-top:36px">
          <div class="sec-head"><div><span class="sec-kicker">Competitors</span><h2>Organisations in ${esc(s.data.name)}</h2></div></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Organisation</th><th>Type</th><th>Founded</th><th>HQ</th><th>Confidence</th></tr></thead>
            <tbody>
              ${orgs.length ? orgs.map((o) => `
                <tr>
                  <td><a href="company.html?slug=${esc(o.slug)}" style="font-weight:600">${esc(o.name)}</a>
                    ${o.description ? `<div class="small muted" style="max-width:420px">${esc((o.description ?? '').slice(0, 110))}${(o.description ?? '').length > 110 ? '…' : ''}</div>` : ''}</td>
                  <td class="mono small">${esc(typeLabel(o.org_type))}</td>
                  <td class="mono">${o.founded_year ?? '—'}</td>
                  <td class="mono small">${esc(o.hq_city ?? '—')}</td>
                  <td class="mono small">${o.confidence != null ? `${Math.round(o.confidence * 100)}%` : '—'}</td>
                </tr>`).join('') : `<tr><td colspan="5" class="muted">No organisations mapped yet.</td></tr>`}
            </tbody>
          </table></div>
        </section>
        ${techs.length ? `
        <section style="margin-top:36px">
          <div class="sec-head"><div><span class="sec-kicker">Technology</span><h2>Technologies used here</h2></div></div>
          <div class="pill-row">${techs.map((t) => `<a class="chip ${t.radar_ring === 'ACCELERATING' ? 'gold' : t.radar_ring === 'MAINSTREAM' ? 'green' : ''}" href="technologies.html?slug=${esc(t.slug)}">${esc(t.name)} · ${t.org_count} orgs</a>`).join('')}</div>
        </section>` : ''}`;
      const followSlot = $('#follow-slot');
      if (followSlot) followSlot.replaceWith(UI.followButton('sector', s.data.id, s.data.name));
    } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
    return;
  }

  // grid view
  root.innerHTML = loader('Loading sector map…');
  try {
    const s = await API.sectors();
    const active = s.data.filter((x) => x.org_count > 0);
    const emptySectors = s.data.filter((x) => !x.org_count);
    root.innerHTML = `
      <div class="grid grid-3">
        ${active.map((x) => `
          <a class="card org-card" href="sectors.html?slug=${esc(x.slug)}" style="color:inherit;text-decoration:none">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-family:var(--font-display);font-size:17px;font-weight:600">${esc(x.name)}</span>
              <span class="chip green">${x.org_count}</span>
            </div>
            <p class="org-desc" style="font-size:12px;color:var(--text-3)">${esc(x.description ?? '')}</p>
          </a>`).join('')}
      </div>
      ${emptySectors.length ? `
      <div class="sec-head" style="margin-top:40px"><div><span class="sec-kicker">Unclaimed ground</span><h2>Sectors with no mapped organisations</h2></div></div>
      <div class="pill-row">${emptySectors.map((x) => `<a class="chip" href="sectors.html?slug=${esc(x.slug)}">${esc(x.name)}</a>`).join('')}</div>` : ''}`;
  } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
})();
