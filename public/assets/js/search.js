/* GTPM — global search */
(async () => {
  const { $, esc, loader, empty } = UI;
  const input = $('#search-input');
  const results = $('#results');
  const suggest = $('#suggest');

  const SUGGESTIONS = ['mobile money', 'fintech', 'payments', 'healthtech', 'agritech', 'Accra', 'Esoko', 'bank', 'university', 'venture capital'];
  suggest.innerHTML = SUGGESTIONS.map((s) => `<span class="chip" data-q="${esc(s)}">${esc(s)}</span>`).join('');
  suggest.querySelectorAll('[data-q]').forEach((c) => c.addEventListener('click', () => {
    input.value = c.dataset.q;
    run(c.dataset.q);
  }));

  const TYPE_ICON = { organization: '▣', person: '◉', product: '◇', technology: '◆', sector: '◈' };

  async function run(q) {
    if (!q.trim()) { results.innerHTML = ''; return; }
    results.innerHTML = loader(`Searching for “${esc(q)}”…`);
    try {
      const r = await API.search(q);
      const data = r.data;
      history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
      results.innerHTML = data.length ? `
        <div class="sec-head" style="margin-top:8px">
          <div><span class="sec-kicker">Results</span><h2>${data.length} hit${data.length === 1 ? '' : 's'} for “${esc(q)}”</h2></div>
        </div>
        ${data.map((x) => `
          <div class="result-item">
            <span class="r-type">${TYPE_ICON[x.entity_type] ?? ''} ${esc(x.entity_type)}</span>
            <div style="min-width:0">
              <a class="r-name" href="${x.entity_type === 'organization' ? `company.html?slug=${esc(x.entity_id)}` : x.entity_type === 'sector' ? `sectors.html?slug=${esc(x.entity_id)}` : x.entity_type === 'technology' ? `technologies.html?slug=${esc(x.entity_id)}` : x.entity_type === 'product' ? `company.html?slug=${esc(x.organization_slug ?? '')}` : '#'}">${esc(x.name)}</a>
              <div class="r-snippet">${esc((x.body ?? '').slice(0, 200))}</div>
            </div>
          </div>`).join('')}` : empty(`Nothing found for “${esc(q)}”. Try a sector, city or company name.`);
    } catch (e) { results.innerHTML = ''; UI.errorBanner(e, results); }
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(input.value); });

  const initial = new URLSearchParams(location.search).get('q');
  if (initial) { input.value = initial; run(initial); }
})();
