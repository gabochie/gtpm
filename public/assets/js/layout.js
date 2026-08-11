/* GTPM — layout injection (header + footer) */
(() => {
  const NAV = [
    ['Power Map', 'map.html'],
    ['Companies', 'companies.html'],
    ['People', 'people.html'],
    ['Sectors', 'sectors.html'],
    ['Technologies', 'technologies.html'],
    ['Funding', 'funding.html'],
    ['Signals', 'signals.html'],
    ['Opportunities', 'opportunities.html'],
    ['Reports', 'reports.html'],
    ['Search', 'search.html'],
  ];

  function headerHTML() {
    const links = NAV.map(([label, href]) => `<li><a href="${href}">${label}<span class="nav-count"></span></a></li>`).join('');
    return `
    <header class="site-header">
      <div class="header-top">
        <a class="brand" href="index.html" style="color:inherit;text-decoration:none">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.2L21 9.2l-5 4.4 1.5 6.4L12 16.6 6.5 20l1.5-6.4-5-4.4 6.6-1L12 2z"/></svg>
          </span>
          <span>
            <span class="brand-name">GTPM<span>.</span></span>
            <span class="brand-tag">Ghana Technology &amp; Power Map</span>
          </span>
        </a>
        <div class="header-search search-ico">
          <input id="header-q" type="search" placeholder="Search companies, people, sectors…" aria-label="Search"/>
        </div>
        <button class="theme-toggle" data-theme-toggle aria-label="Toggle theme"></button>
      </div>
      <nav class="nav-bar" aria-label="Primary">
        <ul class="nav-list">${links}</ul>
      </nav>
    </header>`;
  }

  function footerHTML() {
    return `
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-grid">
          <div>
            <h5>GTPM — Ghana Technology &amp; Power Map</h5>
            <p class="small" style="color:var(--text-2);max-width:360px;line-height:1.6">
              Continuously updated intelligence on the organisations, founders, products, technologies,
              capital and market movements shaping Ghana's digital economy.
            </p>
            <div class="pill-row" style="margin-top:12px">
              <span class="chip green">★ Independent intelligence</span>
              <span class="chip">Provenance-backed</span>
              <span class="chip">Continuously monitored</span>
            </div>
          </div>
          <div>
            <h5>Intelligence</h5>
            <a href="companies.html">Company directory</a>
            <a href="sectors.html">Sector map</a>
            <a href="technologies.html">Technology radar</a>
            <a href="opportunities.html">Opportunity radar</a>
            <a href="reports.html">Reports &amp; briefs</a>
          </div>
          <div>
            <h5>Data</h5>
            <a href="funding.html">Funding tracker</a>
            <a href="signals.html">Signals feed</a>
            <a href="map.html">Power map</a>
            <a href="search.html">Global search</a>
          </div>
          <div>
            <h5>Platform</h5>
            <a href="https://gtpm.gabochie.com" rel="noopener">gtpm.gabochie.com</a>
            <a href="mailto:research@gabochie.com">Contact</a>
            <a href="#" onclick="return false" title="Command centre — Phase 3">Command centre</a>
            <a href="#" onclick="return false" title="Intelligence API — Phase 4">API</a>
          </div>
        </div>
        <p class="footer-note">
          GTPM distinguishes <em>verified facts</em> from <em>reported claims</em> from <em>AI hypotheses</em> on every
          data point. Sources are cited and confidence is scored. Nothing here should be treated as investment advice.
          Built for Ghana's technology ecosystem. ★
        </p>
      </div>
    </footer>`;
  }

  function mount() {
    const body = document.body;
    const headerHost = document.createElement('div');
    headerHost.id = 'site-header-host';
    headerHost.innerHTML = headerHTML();
    body.prepend(headerHost);
    const footerHost = document.createElement('div');
    footerHost.id = 'site-footer-host';
    footerHost.innerHTML = footerHTML();
    body.appendChild(footerHost);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
