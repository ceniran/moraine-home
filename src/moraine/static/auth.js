(() => {
  const prefix = window.location.pathname.startsWith('/moraine-beta/') ? '/moraine-beta' : '';
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    let url = typeof input === 'string' ? input : input.url;
    const isMoraineApi = url.startsWith('/moraine-beta/api/') || (!prefix && url.startsWith('/api/'));
    const token = sessionStorage.getItem('moraine_api_token');
    if (!prefix && url.startsWith('/moraine-beta/api/')) url = url.replace('/moraine-beta', '');
    if (!isMoraineApi || !token) return nativeFetch(typeof input === 'string' ? url : new Request(url, input), options);
    const headers = new Headers(options.headers || (typeof input === 'string' ? undefined : input.headers));
    headers.set('Authorization', `Bearer ${token}`);
    return nativeFetch(typeof input === 'string' ? url : new Request(url, input), { ...options, headers });
  };
  async function begin() {
    const shield = document.querySelector('[data-connection-shield]');
    const form = document.querySelector('[data-connection-form]');
    const message = document.querySelector('[data-connection-message]');
    try {
      const response = await nativeFetch(`${prefix}/api/health`, { cache: 'no-store' });
      if (!response.ok) throw new Error('health');
      const health = await response.json();
      shield.hidden = !health.auth_required || Boolean(sessionStorage.getItem('moraine_api_token'));
    } catch (_) {
      shield.hidden = false;
      message.textContent = '暂时无法连接 Moraine 后端，请确认服务已经启动后再刷新。';
      form.hidden = true;
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('[data-connection-form]');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector('input');
      const message = document.querySelector('[data-connection-message]');
      sessionStorage.setItem('moraine_api_token', input.value.trim());
      try {
        const response = await window.fetch(`${prefix}/api/overview`, { cache: 'no-store' });
        if (!response.ok) throw new Error('unauthorized');
        location.reload();
      } catch (_) {
        sessionStorage.removeItem('moraine_api_token');
        message.textContent = '令牌没有通过验证，请重新复制完整内容。';
        input.select();
      }
    });
    begin();
  });
})();
