(() => {
  'use strict';

  const betaPrefix = window.location.pathname.startsWith('/moraine-beta/') ? '/moraine-beta' : '';
  const betaApi = `${betaPrefix}/api/dwell-v2`;
  const previousFetch = window.fetch.bind(window);
  const privateRoutes = new Set([
    '/api/diary',
    '/api/memory-preview/development-lines',
  ]);

  const mapReleaseUrl = (value) => {
    if (typeof value !== 'string') return value;
    if (value.startsWith('/api/memory-preview/')) {
      return `${betaApi}/${value.slice('/api/memory-preview/'.length)}`;
    }
    if (value === '/api/memory-preview') return betaApi;
    if (value.startsWith('/api/cairn/profile')) return `${betaPrefix}/api/profile${value.slice('/api/cairn/profile'.length)}`;
    return value;
  };

  window.fetch = (input, options = {}) => {
    const originalUrl = typeof input === 'string' ? input : input.url;
    if (privateRoutes.has(originalUrl.split('?')[0])) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'private_route_disabled' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
    }
    if (typeof input === 'string') {
      const mappedOptions = originalUrl.startsWith('/api/cairn/profile') && String(options.method || 'GET').toUpperCase() === 'PUT'
        ? { ...options, method: 'POST' }
        : options;
      return previousFetch(mapReleaseUrl(input), mappedOptions);
    }
    const mapped = mapReleaseUrl(input.url);
    return previousFetch(mapped === input.url ? input : new Request(mapped, input), options);
  };

  const remove = (selector) => document.querySelectorAll(selector).forEach((node) => node.remove());
  const disable = (selector) => document.querySelectorAll(selector).forEach((node) => {
    node.dataset.releaseDisabled = '';
    node.setAttribute('aria-hidden', 'true');
  });

  // This file is the release boundary: shared memory UI stays; Cairn's private rooms do not.
  remove('.memory-garden-entry');
  remove('[data-view="study"], #study');
  remove('[aria-labelledby="profileRoutingCleanupTitle"], [aria-labelledby="jevSettingsTitle"]');
  disable('.backend-revision-overlay');

  document.querySelectorAll('.sidebar-signature').forEach((node) => {
    node.textContent = 'Cairn × Xiaoran · Moraine';
  });
  document.querySelectorAll('.privacy-mark').forEach((node) => {
    if (node.textContent.trim() === '私密') node.textContent = '本地实例';
  });
  document.querySelectorAll('[data-signature="xiaoran"] strong').forEach((node) => {
    node.lastChild.textContent = '用户';
  });
  document.querySelectorAll('[data-signature="cairn"] strong').forEach((node) => {
    node.lastChild.textContent = '小机';
  });
  document.querySelectorAll('a[href^="/api/memory-preview/"]').forEach((link) => {
    link.href = mapReleaseUrl(link.getAttribute('href'));
  });

  const overview = document.querySelector('#overview .overview-header');
  if (overview) {
    const note = document.createElement('p');
    note.className = 'release-note';
    note.textContent = '当前为 Moraine 内测发行界面；数据仍保存在你的原内测实例中，旧版界面也继续保留。';
    overview.insertAdjacentElement('afterend', note);
  }

  window.MoraineRelease = Object.freeze({
    channel: 'beta',
    source: 'dwell-shared-ui',
    privateRooms: false,
    backendRevisionQueue: false,
    apiBase: betaApi,
  });
})();
