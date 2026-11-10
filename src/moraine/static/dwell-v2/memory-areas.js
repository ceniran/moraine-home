(() => {
  const setDigits = (host, text) => {
    host.classList.remove('is-animating');
    host.replaceChildren(...[...String(text)].map((character, index, characters) => {
      const digit = document.createElement('span');
      digit.className = 't-digit';
      digit.textContent = character;
      if (index === characters.length - 2) digit.dataset.stagger = '1';
      else if (index === characters.length - 1) digit.dataset.stagger = '2';
      return digit;
    }));
    void host.offsetHeight;
    host.classList.add('is-animating');
  };

  const swapText = (element, next) => {
    const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')) || 150;
    element.classList.add('is-exit');
    window.setTimeout(() => {
      element.textContent = next;
      element.classList.remove('is-exit');
      element.classList.add('is-enter-start');
      void element.offsetHeight;
      element.classList.remove('is-enter-start');
    }, duration);
  };

  window.renderMoraineAreaStatistics = (activity) => {
    const card = document.querySelector('[data-area-statistics]');
    const chart = card?.querySelector('[data-area-chart]');
    const areas = activity?.areas || [];
    if (!card || !chart || !areas.length) return;
    const label = card.querySelector('[data-area-label]');
    const total = card.querySelector('[data-area-total]');
    const description = card.querySelector('[data-area-description]');
    const maximum = Math.max(1, ...areas.map(area => Number(area.total || 0)));
    const allTotal = areas.reduce((sum, area) => sum + Number(area.total || 0), 0);
    card.querySelector('[data-area-period]').textContent = `${Number(activity.month.slice(5))} 月入库`;
    setDigits(total, allTotal);
    description.textContent = `${areas.filter(area => Number(area.total || 0) > 0).length} 个分区有本月记录`;
    chart.replaceChildren(...areas.map((area) => {
      const value = Number(area.total || 0);
      const lineHeight = 14 + Math.round(value / maximum * 70);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'area-lollipop';
      button.style.setProperty('--line-height', `${lineHeight}px`);
      button.setAttribute('aria-label', `${area.label}分区，本月入库${value}条`);
      button.innerHTML = `<span class="area-lollipop-plot"><b class="area-lollipop-line"></b><em class="area-lollipop-dot"></em></span><strong>${area.label}</strong><small>${value} 条</small>`;
      button.addEventListener('click', () => {
        chart.querySelectorAll('.area-lollipop').forEach(item => item.classList.toggle('is-selected', item === button));
        swapText(label, area.label);
        setDigits(total, value);
        swapText(description, `本月 ${value} 条分区记录`);
      });
      return button;
    }));
  };
})();
