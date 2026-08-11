/* GTPM — homepage */
(async () => {
  const { $, $$, esc, money, typeLabel, typeClass, impBadge, timeAgo, loader, empty } = UI;

  const mount = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };

  // ---- hero meta ----
  mount('#hero-updated', '▲ Updated ' + new Date().toISOString().slice(0, 10));

  // ---- stats ----
  try {
    const s = await API.stats();
    const d = s.data;
    mount('#hero-orgs', `${d.orgs} organisations tracked · ${d.cities} cities · funding ${money(d.funding_total_usd)}`);
    mount('#stats-row', `
      <div class="stat-card"><div class="stat-value">${d.orgs}<small> +</small></div><div class="stat-label">Organisations</div></div>
      <div class="stat-card"><div class="stat-value">${d.sectors}</div><div class="stat-label">Sectors mapped</div></div>
      <div class="stat-card"><div class="stat-value">${d.technologies}</div><div class="stat-label">Technologies</div></div>
      <div class="stat-card"><div class="stat-value">${money(d.funding_total_usd)}</div><div class="stat-label">Tracked funding · ${d.funding_rounds} rounds</div></div>
      <div class="stat-card"><div class="stat-value">${d.signals}</div><div class="stat-label">Signals captured</div></div>
      <div class="stat-card"><div class="stat-value">${d.opportunities}</div><div class="stat-label">Open opportunities</div></div>
    `);
  } catch (e) { UI.errorBanner(e); }

  // ---- sectors ----
  try {
    const s = await API.sectors();
    const top = s.data.filter((x) => x.org_count > 0).slice(0, 8);
    mount('#sector-grid', top.length ? top.map((x) => `
      <a class="card org-card" href="sectors.html?slug=${esc(x.slug)}" style="color:inherit;text-decoration:none">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-family:var(--font-display);font-size:16px;font-weight:600">${esc(x.name)}</span>
          <span class="chip">${x.org_count}</span>
        </div>
        <p class="org-card org-desc" style="font-size:12px;color:var(--text-3)">${esc(x.description ?? '')}</p>
      </a>`).join('') : empty('No sectors yet'));
  } catch (e) { UI.errorBanner(e); }

  // ---- map ----
  try {
    const m = await API.map();
    const data = m.data;
    if (window.L) {
      const map = L.map('home-map', { zoomControl: false, attributionControl: false }).setView([7.8, -1.3], 6.6);
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      const gh = await fetch('assets/data/ghana.geo.json').then((r) => r.json());
      L.geoJSON(gh, { style: { color: 'var(--border-2)', weight: 1.4, fillColor: 'var(--panel)', fillOpacity: 0.6 } }).addTo(map);
      const max = Math.max(...data.map((x) => x.org_count), 1);
      data.forEach((x) => {
        const isHub = x.hub_count > 0;
        const r = 6 + 16 * (x.org_count / max);
        const color = isHub ? 'var(--gold)' : 'var(--green)';
        const popup = `<div style="font-size:12px"><strong>${esc(x.city)}</strong><br/>${x.org_count} organisations${x.hub_count ? ` · ${x.hub_count} hubs/universities` : ''}<br/><span style="color:var(--text-3)">${x.orgs.slice(0, 5).map((o) => esc(o.name)).join(', ')}${x.orgs.length > 5 ? '…' : ''}</span></div>`;
        L.circleMarker([x.lat, x.lng], { radius: r, color: 'var(--bg)', weight: 1.5, fillColor: color, fillOpacity: 0.85 })
          .bindPopup(popup).addTo(map);
      });
    } else {
      mount('#home-map', empty('Map library failed to load'));
    }
  } catch (e) { UI.errorBanner(e); }

  // ---- signals ----
  try {
    const s = await API.signals({ page_size: 5 });
    mount('#signals-feed', s.data.length ? s.data.map((x) => `
      <div class="signal-item">
        <div class="sig-ico">${x.signal_type === 'funding' ? '💰' : x.signal_type === 'regulatory' ? '⚖' : x.signal_type === 'expansion' ? '↗' : '◈'}</div>
        <div class="sig-body">
          <div class="sig-title">${x.organization ? `<a href="company.html?slug=${esc(x.organization.slug)}">${esc(x.organization.name)}</a> — ` : ''}${esc(x.title)}</div>
          ${x.description ? `<div class="sig-desc">${esc(x.description)}</div>` : ''}
          ${x.strategic_interpretation ? `<div class="sig-why">${esc(x.strategic_interpretation)}</div>` : ''}
          <div class="sig-meta">${impBadge(x.importance)}<span class="mono small muted">${timeAgo(x.date)}</span></div>
        </div>
      </div>`).join('') : empty('No signals yet'));
  } catch (e) { UI.errorBanner(e); }

  // ---- top orgs ----
  try {
    const s = await API.companies({ sort: 'founded', page_size: 9 });
    mount('#org-grid', s.data.length ? s.data.map((o) => `
      <a class="card org-card" href="company.html?slug=${esc(o.slug)}" style="color:inherit;text-decoration:none">
        <div class="org-head">
          <div class="org-name">${esc(o.name)}</div>
          <span class="org-type">${esc(typeLabel(o.org_type))}</span>
        </div>
        <p class="org-desc">${esc((o.description ?? '').slice(0, 150))}${(o.description ?? '').length > 150 ? '…' : ''}</p>
        <div class="org-foot">
          ${(o.sectors ?? []).slice(0, 3).map((sx) => `<span class="chip">${esc(sx.name)}</span>`).join('')}
          ${o.founded_year ? `<span class="mono small muted">est. ${o.founded_year}</span>` : ''}
          ${o.hq_city ? `<span class="mono small muted">${esc(o.hq_city)}</span>` : ''}
        </div>
      </a>`).join('') : empty('No companies yet'));
  } catch (e) { UI.errorBanner(e); }

  // ---- opportunities ----
  try {
    const s = await API.opportunities({ page_size: 3 });
    mount('#opp-grid', s.data.length ? s.data.map((o) => `
      <a class="card opp-card" href="opportunities.html?slug=${esc(o.slug)}" style="color:inherit;text-decoration:none">
        <span class="opp-class ${esc(o.classification)}">${esc(o.classification)}</span>
        <div class="opp-title">${esc(o.title)}</div>
        <p class="opp-problem">${esc((o.problem ?? '').slice(0, 140))}${(o.problem ?? '').length > 140 ? '…' : ''}</p>
        <div class="opp-score">
          <span class="mono small muted">attractiveness</span>
          <span class="meter"><i style="width:${Math.round(o.attractiveness * 100)}%"></i></span>
          <span class="mono small muted">${Math.round(o.attractiveness * 100)}</span>
        </div>
      </a>`).join('') : empty('No opportunities yet'));
  } catch (e) { UI.errorBanner(e); }

  // ---- radar mini ----
  try {
    const t = await API.technologies();
    const rings = ['EXPERIMENTAL', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'DECLINING'];
    const order = { EXPERIMENTAL: 0, EMERGING: 1, ACCELERATING: 2, MAINSTREAM: 3, DECLINING: 4 };
    const grouped = rings.map((r) => ({ ring: r, items: t.data.filter((x) => x.radar_ring === r).sort((a, b) => b.org_count - a.org_count).slice(0, 6) }))
      .filter((g) => g.items.length);
    mount('#radar-mini', grouped.map((g) => `
      <div class="radar-ring ${g.ring}">
        <h4>${g.ring}</h4>
        <ul class="tech-list">
          ${g.items.map((x) => `<li><a href="technologies.html?slug=${esc(x.slug)}">${esc(x.name)}</a><span class="t-count">${x.org_count} orgs</span></li>`).join('')}
        </ul>
      </div>`).join('') || empty());
  } catch (e) { UI.errorBanner(e); }
})();
