/* GTPM — reports & briefs (list + detail) */
(async () => {
  const { $, esc, loader, empty, money, fmtDate } = UI;
  const root = $('#reports-root');
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');

  const TYPE_LABEL = { sector: 'Sector report', market: 'Market overview', daily_brief: 'Daily brief', company: 'Company dossier', opportunity: 'Opportunity memo' };

  if (slug) {
    root.innerHTML = loader('Compiling the report…');
    try {
      const r = await API.report(slug);
      const d = r.data;
      document.title = `${d.title} — GTPM`;
      const content = d.content || {};
      const sections = content.sections || [];
      root.innerHTML = `
        <div class="sec-head" style="margin-top:0">
          <div>
            <span class="sec-kicker">${esc(TYPE_LABEL[d.report_type] ?? d.report_type)}</span>
            <h1 style="font-size:32px">${esc(d.title)}</h1>
            <div class="mono small muted" style="margin-top:6px">Generated ${d.generated_at ? new Date(d.generated_at).toISOString().slice(0, 10) : '—'} · ${esc(d.status)}</div>
          </div>
          <a class="sec-link" href="reports.html">← All reports</a>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="sec-kicker" style="margin-bottom:8px">Executive summary</div>
          <p style="color:var(--text);line-height:1.75;font-size:14.5px;font-family:var(--font-display);font-size:17px">${esc(content.executive_summary ?? 'No summary.')}</p>
        </div>
        ${(content.stats && content.stats.length) ? `
        <div class="funding-hero" style="margin-top:20px">
          ${content.stats.map((s) => `<div class="fh-card"><div class="fh-val" style="font-size:18px">${esc(s.value)}</div><div class="fh-label">${esc(s.label)}</div></div>`).join('')}
        </div>` : ''}
        ${sections.length ? `
        <section style="margin-top:32px">
          <div class="sec-head"><div><span class="sec-kicker">Structure</span><h2>Sections</h2></div></div>
          <div class="grid grid-2">
            ${sections.map((s) => `<div class="card tight"><div style="font-weight:600;font-size:14px">${esc(s.title)}</div><p class="card-sub" style="margin-top:6px">${esc(s.summary ?? '')}</p></div>`).join('')}
          </div>
        </section>` : ''}
        ${content.players?.length ? `
        <section style="margin-top:32px">
          <div class="sec-head"><div><span class="sec-kicker">Key players</span><h2>Organisations named</h2></div></div>
          <div class="pill-row">${content.players.map((p) => `<a class="chip" href="company.html?slug=${esc(p.slug ?? '')}">${esc(p.name)}</a>`).join('')}</div>
        </section>` : ''}
        ${content.recommendations?.length ? `
        <section style="margin-top:32px">
          <div class="sec-head"><div><span class="sec-kicker">Direction</span><h2>Recommendations</h2></div></div>
          <div class="card">
            <ol style="margin:0;padding-left:20px;display:grid;gap:10px">${content.recommendations.map((r) => `<li style="font-size:13.5px;color:var(--text-2)">${esc(r)}</li>`).join('')}</ol>
          </div>
        </section>` : ''}`;
    } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
    return;
  }

  root.innerHTML = loader('Gathering reports…');
  try {
    const r = await API.reports();
    const reps = r.data;
    root.innerHTML = reps.length ? `
      <div class="grid grid-3">
        ${reps.map((d) => `
          <a class="card org-card" href="reports.html?slug=${esc(d.slug)}" style="color:inherit;text-decoration:none">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="chip ${d.report_type === 'daily_brief' ? 'gold' : d.report_type === 'market' ? 'green' : 'blue'}">${esc(TYPE_LABEL[d.report_type] ?? d.report_type)}</span>
              <span class="mono small muted">${d.generated_at ? new Date(d.generated_at).toISOString().slice(0, 10) : '—'}</span>
            </div>
            <div class="opp-title" style="font-size:17px;margin-top:10px">${esc(d.title)}</div>
            <p class="opp-problem" style="margin-top:6px">Sector intelligence built from the live database.</p>
          </a>`).join('')}
      </div>` : empty('No published reports yet.');
  } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
})();
