/* GTPM — power map */
(async () => {
  const { $, esc, loader, empty, typeLabel } = UI;

  // populate sector filter
  try {
    const s = await API.sectors();
    const secSel = $('#f-sector');
    s.data.filter((x) => x.org_count > 0).forEach((x) => secSel.insertAdjacentHTML('beforeend', `<option value="${esc(x.slug)}">${esc(x.name)} (${x.org_count})</option>`));
  } catch {}

  let map = null;
  let layer = null;

  async function render() {
    const el = $('#power-map');
    if (!window.L) { el.innerHTML = '<div class="empty">Map library failed to load. Check connection.</div>'; return; }
    if (!map) {
      map = L.map('power-map', { zoomControl: false }).setView([7.85, -1.25], 6.8);
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      const gh = await fetch('assets/data/ghana.geo.json').then((r) => r.json());
      L.geoJSON(gh, { style: { color: 'var(--border-2)', weight: 1.2, fillColor: 'var(--panel)', fillOpacity: 0.55 } }).addTo(map);
    }

    const sector = $('#f-sector').value || undefined;
    const type = $('#f-type').value || undefined;
    try {
      const m = await API.map({ sector, type });
      const data = m.data;
      if (layer) map.removeLayer(layer);
      layer = L.layerGroup().addTo(map);

      const max = Math.max(...data.map((x) => x.org_count), 1);
      data.forEach((x) => {
        const isHub = x.hub_count > 0;
        const critical = x.orgs.some((o) => /MTN|Vodafone|Telecel|AirtelTigo|GCB|Ecobank|Absa|Stanbic/i.test(o.name));
        const r = 7 + 15 * (x.org_count / max);
        const color = critical ? 'var(--red)' : isHub ? 'var(--gold)' : 'var(--green)';
        const popup = `
          <div style="font-size:12px;max-width:260px">
            <strong style="font-size:13px">${esc(x.city)}</strong>
            <div style="color:var(--text-2);margin:4px 0">${x.org_count} organisations${x.hub_count ? ` · ${x.hub_count} hubs/universities` : ''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${x.orgs.slice(0, 8).map((o) => `<a href="company.html?slug=${esc(o.slug)}" style="font-size:11px">${esc(o.name)}</a>`).join(' · ')}
              ${x.orgs.length > 8 ? `<span class="muted">+${x.orgs.length - 8} more</span>` : ''}
            </div>
          </div>`;
        L.circleMarker([x.lat, x.lng], { radius: r, color: 'var(--bg)', weight: 1.5, fillColor: color, fillOpacity: 0.85 })
          .bindPopup(popup).addTo(layer);
      });

      // cluster table
      const clusters = await API.mapClusters();
      const tbl = $('#cluster-table');
      const byCity = {};
      clusters.data.forEach((c) => { (byCity[c.city] = byCity[c.city] || []).push(c); });
      tbl.innerHTML = `
        <thead><tr><th>City</th><th>Top sectors</th><th>Total orgs</th></tr></thead>
        <tbody>
          ${Object.entries(byCity).sort((a, b) => b[1].reduce((s, c) => s + c.count, 0) - a[1].reduce((s, c) => s + c.count, 0)).map(([city, rows]) => `
            <tr>
              <td style="font-weight:600">${esc(city)}</td>
              <td>${rows.slice(0, 4).map((r) => `<span class="chip">${esc(r.sector)} · ${r.count}</span>`).join(' ')}</td>
              <td class="mono">${rows.reduce((s, c) => s + c.count, 0)}</td>
            </tr>`).join('') || `<tr><td colspan="3" class="muted">No cluster data yet.</td></tr>`}
        </tbody>`;
    } catch (e) { UI.errorBanner(e); }
  }

  $('#f-sector').addEventListener('change', render);
  $('#f-type').addEventListener('change', render);
  render();
})();
