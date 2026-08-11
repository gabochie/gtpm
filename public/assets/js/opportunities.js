/* GTPM — opportunity radar (grid + detail) */
(async () => {
  const { $, esc, money, loader, empty, typeLabel } = UI;
  const root = $('#opps-root');
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');

  const CLASS_HINT = {
    BUILD_NOW: 'High attractiveness, viable with current tech. Serious look.',
    EARLY_BET: 'Real signal; needs validation or timing.',
    WATCH: 'Emerging; monitor the wedge.',
    WHITE_SPACE: 'Unclaimed territory; weak demand evidence.',
    AVOID: 'Crowded or structurally unattractive.',
    INFRASTRUCTURE: 'Serving the ecosystem as a layer.',
  };

  if (slug) {
    root.innerHTML = loader('Loading opportunity…');
    try {
      const o = await API.opportunity(slug);
      const d = o.data;
      document.title = `${d.title} — GTPM`;
      root.innerHTML = `
        <div class="sec-head" style="margin-top:0">
          <div>
            <span class="sec-kicker">Opportunity hypothesis</span>
            <h1 style="font-size:32px">${esc(d.title)}</h1>
            <div class="ph-chips" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <span class="opp-class ${esc(d.classification)}">${esc(d.classification)}</span>
              ${d.sector ? `<a class="chip" href="sectors.html?slug=${esc(d.sector.slug)}">${esc(d.sector.name)}</a>` : ''}
              <span class="badge-verif ai_hypothesis">AI hypothesis</span>
            </div>
          </div>
          <a class="sec-link" href="opportunities.html">← Opportunity radar</a>
        </div>

        <div class="funding-hero">
          <div class="fh-card"><div class="fh-val">${Math.round(d.attractiveness * 100)}</div><div class="fh-label">Attractiveness /100</div></div>
          <div class="fh-card"><div class="fh-val">${Math.round(d.confidence * 100)}%</div><div class="fh-label">Hypothesis confidence</div></div>
          <div class="fh-card"><div class="fh-val">${esc(CLASS_HINT[d.classification] ?? '')}</div><div class="fh-label">Classification read</div></div>
        </div>

        <div class="two-col-detail" style="margin-top:20px">
          <div class="flow" style="display:grid;gap:16px">
            ${d.problem ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Problem</div><p style="color:var(--text-2)">${esc(d.problem)}</p></div>` : ''}
            ${d.why_now ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Why now</div><p style="color:var(--text-2)">${esc(d.why_now)}</p></div>` : ''}
            ${d.business_model ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Business model</div><p style="color:var(--text-2)">${esc(d.business_model)}</p></div>` : ''}
            ${d.market ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Market</div><p style="color:var(--text-2)">${esc(d.market)}</p></div>` : ''}
          </div>
          <div class="flow" style="display:grid;gap:16px">
            ${d.potential_customers ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Potential customers</div><p style="color:var(--text-2);font-size:13px">${esc(d.potential_customers)}</p></div>` : ''}
            ${d.existing_alternatives?.length ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Existing alternatives</div><div class="pill-row">${d.existing_alternatives.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div></div>` : ''}
            ${d.current_competitors?.length ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Current competitors</div><div class="pill-row">${d.current_competitors.map((a) => `<span class="chip red">${esc(a)}</span>`).join('')}</div></div>` : ''}
            ${d.technology_required?.length ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Technology required</div><div class="pill-row">${d.technology_required.map((a) => `<span class="chip cyan">${esc(a)}</span>`).join('')}</div></div>` : ''}
            ${d.barriers?.length ? `<div class="card"><div class="sec-kicker" style="margin-bottom:6px">Barriers</div><div class="pill-row">${d.barriers.map((a) => `<span class="chip gold">${esc(a)}</span>`).join('')}</div></div>` : ''}
            <div class="card">
              <div class="sec-kicker" style="margin-bottom:6px">Evidence</div>
              ${d.evidence?.length ? d.evidence.map((e) => `<div class="small muted" style="padding:4px 0;border-top:1px solid var(--border)">${esc(typeof e === 'string' ? e : (e.title || e.url || ''))}</div>`).join('') : '<p class="small muted">No evidence attached yet — this is a hypothesis awaiting research.</p>'}
            </div>
          </div>
        </div>`;
    } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
    return;
  }

  // grid view
  root.innerHTML = loader('Scanning the market…');
  try {
    const r = await API.opportunities({ page_size: 100 });
    const opps = r.data;
    const byClass = {};
    opps.forEach((o) => { (byClass[o.classification] = byClass[o.classification] || []).push(o); });
    const order = ['BUILD_NOW', 'EARLY_BET', 'WATCH', 'WHITE_SPACE', 'INFRASTRUCTURE', 'AVOID'];
    root.innerHTML = order.filter((k) => byClass[k]?.length).map((k) => `
      <section style="margin-bottom:36px">
        <div class="sec-head" style="margin-bottom:14px">
          <div>
            <span class="sec-kicker" style="color:${k === 'BUILD_NOW' ? 'var(--green)' : k === 'EARLY_BET' ? 'var(--cyan)' : k === 'WATCH' ? 'var(--gold)' : 'var(--text-3)'}">${k}</span>
            <h2 style="font-size:20px">${esc(CLASS_HINT[k])}</h2>
          </div>
          <span class="mono small muted">${byClass[k].length} opportunities</span>
        </div>
        <div class="grid grid-3">
          ${byClass[k].map((o) => `
            <a class="card opp-card" href="opportunities.html?slug=${esc(o.slug)}" style="color:inherit;text-decoration:none">
              <div style="display:flex;justify-content:space-between;gap:8px">
                <span class="opp-class ${esc(o.classification)}" style="font-size:8.5px">${esc(o.classification)}</span>
                <span class="mono small muted">${Math.round(o.attractiveness * 100)}</span>
              </div>
              <div class="opp-title">${esc(o.title)}</div>
              <p class="opp-problem">${esc((o.problem ?? '').slice(0, 130))}${(o.problem ?? '').length > 130 ? '…' : ''}</p>
              <div class="opp-score">
                <span class="mono small muted">attractiveness</span>
                <span class="meter"><i style="width:${Math.round(o.attractiveness * 100)}%"></i></span>
              </div>
            </a>`).join('')}
        </div>
      </section>`).join('') || empty('No opportunities generated yet.');
  } catch (e) { root.innerHTML = ''; UI.errorBanner(e, root); }
})();
