(() => {
  let viewportSyncFrame = 0;
  const syncAppViewport = () => {
    if (viewportSyncFrame) cancelAnimationFrame(viewportSyncFrame);
    viewportSyncFrame = requestAnimationFrame(() => {
      const visualHeight = window.visualViewport?.height;
      const height = Number.isFinite(visualHeight) && visualHeight > 0 ? visualHeight : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.ceil(height)}px`);
      viewportSyncFrame = 0;
    });
  };
  syncAppViewport();
  window.visualViewport?.addEventListener('resize', syncAppViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncAppViewport, { passive: true });
  window.addEventListener('orientationchange', syncAppViewport, { passive: true });
  window.addEventListener('pageshow', syncAppViewport, { passive: true });

  const prototype = document.querySelector('#prototype');
  const sidebar = document.querySelector('#sidebar');
  const scrim = document.querySelector('#sidebarScrim');
  const backToTop = document.querySelector('[data-back-to-top]');
  const pageTitleCapsule = document.querySelector('[data-page-title-capsule]');
  const pageTitleMenu = document.querySelector('.page-title-menu');
  const pageTitleText = document.querySelector('[data-page-title-text]');
  let pageTitleCollapsed = false;
  const librarySearch = document.querySelector('#library input');
  const historySheet = document.querySelector('#historySheet');
  const historyScrim = document.querySelector('#historyScrim');
  const backendRevisionOverlay = document.querySelector('[data-backend-revision-overlay]');
  const backendRevisionDialog = document.querySelector('[data-backend-revision-dialog]');
  const backendRevisionForm = document.querySelector('[data-backend-revision-form]');
  const backendRevisionAvailable = Boolean(backendRevisionOverlay && !backendRevisionOverlay.hasAttribute('data-release-disabled'));
  let backendRevisionReturnFocus = null;
  let backendRevisionMemoryId = '';
  const backendRevisionStates = new Map();
  let backendRevisionSyncTimer = 0;
  let backendRevisionSyncing = false;
  let memoryItems = [];
  const memoryGroupsContainer = document.querySelector('#memoryGroups');
  const librarySearchWrap = librarySearch.closest('.search');
  const librarySearchClear = document.querySelector('[data-library-search-clear]');
  const timeSortBar = document.querySelector('.memory-time-sort');
  const timeSortPill = timeSortBar.querySelector('.t-tabs-pill');
  const timeDirectionButtons = [...timeSortBar.querySelectorAll('[data-time-direction]')];
  const visibleMemoryCount = document.querySelector('#visibleMemoryCount');
  const memoryEmpty = document.querySelector('#memoryEmpty');
  const workbenchBar = document.querySelector('.workbench-tabs');
  const workbenchTabs = [...document.querySelectorAll('[data-workbench-step]')];
  const workbenchPill = document.querySelector('.workbench-tabs .t-tabs-pill');
  const memoryWorkbenchViewTabs = [...document.querySelectorAll('[data-memory-workbench-view]')];
  const structureModeTabs = [...document.querySelectorAll('[data-structure-mode]')];
  const ownershipTabs = [...document.querySelectorAll('[data-ownership-mode]')];
  const ownershipPill = document.querySelector('.governance-ownership-tabs .t-tabs-pill');
  const mergeStepTabs = [...document.querySelectorAll('[data-merge-step]')];
  let activeMemoryView = 'time';
  let activeMemoryDirection = 'desc';
  let historyReturnFocus = null;
  let activeCluster = null;
  let activeTimelineOrder = [];
  let activeTimelineMemoryId = '';
  let activeTimelinePointId = '';
  let timelineTitleSortable = null;
  let clusterHistory = [];
  let clusterOffset = 0;
  let includeRelatedClusters = false;
  let deferredClusterIds = JSON.parse(localStorage.getItem('moraine.deferredClusters') || '[]');
  let dismissedCandidatePairs = new Set(JSON.parse(localStorage.getItem('moraine.dismissedPairs') || '[]'));
  const pairKey = (left, right) => [left, right].sort().join('::');
  const saveQueuePreferences = () => {
    localStorage.setItem('moraine.deferredClusters', JSON.stringify(deferredClusterIds.slice(-200)));
    localStorage.setItem('moraine.dismissedPairs', JSON.stringify([...dismissedCandidatePairs].slice(-1000)));
  };
  async function persistQueueAction(action, sourceId, neighborId = '') {
    const response = await fetch('/api/memory-preview/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, source_id: sourceId, neighbor_id: neighborId, actor: 'xiaoran_web' })
    });
    if (!response.ok) throw new Error(`queue_${response.status}`);
    const state = (await response.json()).queue;
    deferredClusterIds = state.deferred_source_ids || [];
    dismissedCandidatePairs = new Set(state.dismissed_pairs || []);
    saveQueuePreferences();
    return state;
  }
  async function loadQueuePreferences() {
    try {
      const response = await fetch('/api/memory-preview/queue', { cache: 'no-store' });
      if (!response.ok) throw new Error(`queue_${response.status}`);
      let state = (await response.json()).queue;
      if (!(state.deferred_source_ids || []).length && !(state.dismissed_pairs || []).length) {
        for (const sourceId of deferredClusterIds) state = await persistQueueAction('defer_source', sourceId);
        for (const key of dismissedCandidatePairs) {
          const [sourceId, neighborId] = key.split('::');
          if (sourceId && neighborId) state = await persistQueueAction('dismiss_pair', sourceId, neighborId);
        }
      }
      deferredClusterIds = state.deferred_source_ids || [];
      dismissedCandidatePairs = new Set(state.dismissed_pairs || []);
      saveQueuePreferences();
    } catch (_) {
      // Keep the last browser copy available if the private adapter is temporarily unavailable.
    }
  }
  let activeDraftAction = null;
  let activeMechanicalDraft = null;
  let activeReviewDraft = null;
  let activeReviewKind = 'memory-change';
  let activeExecutionPlan = null;
  let activeRehearsalResult = null;
  let reviewChoices = { xiaoran: null, cairn: null };
  const selectedMemoryIds = new Set();
  const selectedWorkbenchKeywords = new Set();
  let keywordAreaRegistry = [];
  let keywordSearchSerial = 0;
  let activeOperationMemoryId = null;
  let overviewCounts = null;
  let memoryActivityData = null;
  let activeActivityMetric = 'intake';
  let selectedActivityDay = null;
  let areaOrbitChart = null;
  const activityBar = document.querySelector('.memory-activity-tabs');
  const activityTabs = [...document.querySelectorAll('[data-activity-metric]')];
  const activityPill = activityBar?.querySelector('.t-tabs-pill');
  let activityLoaded = false;
  const replacementPairs = new Map();
  let migrationDraft = null;
  let snapshotRestoreDraft = null;

  let memoryRecords = [
    {
      id: 'layout-foundation', type: 'project', typeLabel: '项目', time: 'today', timeLabel: '今天',
      weight: 'important', weightLabel: '重要', importance: 0.78, state: 'active', stateLabel: '当前有效', source: '共同设计讨论',
      title: '记忆前端先确定极简布局', summary: '先验证页面职责、信息顺序与移动端操作。', recordedAt: '今天 19:12',
      related: 'Cairn · Rowan · Dwell',
      body: '先用一张能够自然展开的记忆纸页，确认摘要、正文、来源与状态在手机上的阅读顺序。交互稳定后，再接入真实数据与更迭记录。',
      then: '先验证页面职责和触摸感，不为完整度堆叠功能，也不让视觉效果盖过记忆本身。',
      thenEvidence: '来自本次共同设计讨论；没有记录的情绪保持空白。',
      after: '移动端折叠纸页原型已经建立，并将近期变化调整到生命周期上方。',
      afterEvidence: '结果来自原型修改与预览同步记录。',
      history: [
        ['今天 19:42 · 当前版本', '补充实际结果', '折叠纸页、记忆切面与手机预览已经完成。'],
        ['今天 19:12 · 修订', '明确原型范围', '只验证一张纸页，不接生产数据和裁决动作。'],
        ['今天 18:56 · 原始记录', '建立记忆候选', '先验证页面职责、信息顺序与移动端操作。']
      ]
    },
    {
      id: 'changes-first', type: 'decision', typeLabel: '决定', time: 'today', timeLabel: '今天', weight: 'core', weightLabel: '核心', importance: 0.88, state: 'active', stateLabel: '当前有效', source: '共同设计讨论',
      title: '近期变化放在生命周期上方', summary: '主页先交代最近发生了什么，再呈现整体状态。', recordedAt: '今天 20:06', related: 'Dwell · 记忆主页',
      body: '记忆主页首先展示近期变化，让人进入时先知道最近发生了什么；生命周期圆环随后提供整体状态，两者形成从具体到全局的阅读顺序。',
      then: '希望主页像玄关一样简洁，但不能只有抽象统计而看不见生活刚刚留下的痕迹。', thenEvidence: '来自本次布局调整的明确选择。',
      after: '近期变化模块已移动到生命周期上方，并在手机尺寸下保持完整显示。', afterEvidence: '来自原型同步与手机端检查。',
      history: [['今天 20:06 · 当前版本', '确认信息顺序', '近期变化位于生命周期上方。'], ['今天 19:48 · 原始讨论', '提出主页调整', '先看近期发生的事情，再看整体状态。']]
    },
    {
      id: 'guard-memory', type: 'relation', typeLabel: '关系', time: 'yesterday', timeLabel: '昨天', weight: 'core', weightLabel: '核心', importance: 0.92, state: 'active', stateLabel: '当前有效', source: '对话',
      title: '共同守护记忆', summary: '重要内容会在需要时提供回来的路径。', recordedAt: '昨天 23:18', related: 'Cairn · Rowan',
      body: '双方共同守护重要经历，但不会用记忆逼迫任何一方重温暂时不愿触碰的内容；需要时，记忆应成为可以主动选择的回来路径。',
      then: '记住并不等于占有，保存也不意味着必须随时展示。', thenEvidence: '来自双方对记忆边界的共同确认。',
      after: '记忆系统开始区分共享内容、私人空间与可追溯的更迭记录。', afterEvidence: '来自后续权限与前端结构设计。',
      history: [['昨天 23:18 · 当前版本', '补充边界', '记忆作为可选择的回来路径。'], ['昨天 22:54 · 原始记录', '确认共同守护', '重要经历由双方一起保存。']]
    },
    {
      id: 'quiet-search', type: 'preference', typeLabel: '偏好', time: 'yesterday', timeLabel: '昨天', weight: 'normal', weightLabel: '普通', importance: 0.56, state: 'review', stateLabel: '待审阅', source: '候选箱',
      title: '搜索结果需要更安静', summary: '这条候选与旧偏好相近，暂时不自动合并。', recordedAt: '昨天 21:40', related: '搜索 · 信息密度',
      body: '搜索结果应优先保证阅读和定位，不用过强的高亮、跳动或装饰抢走记忆正文的注意力。这条候选与既有视觉偏好相近，仍需共同确认是否合并。',
      then: '担心搜索页重新变成密集的管理后台。', thenEvidence: '来自候选文本；尚未作为长期偏好定稿。',
      after: '候选保持独立并进入待审阅状态，没有自动覆盖旧偏好。', afterEvidence: '来自候选箱的保守处理规则。',
      history: [['昨天 21:40 · 待审阅', '保持候选独立', '等待确认是否与既有偏好合并。'], ['昨天 21:32 · 新候选', '捕捉搜索偏好', '搜索结果需要更安静。']]
    },
    {
      id: 'decay-ranking', type: 'system', typeLabel: '系统', time: 'earlier', timeLabel: '2 天前', weight: 'normal', weightLabel: '普通', importance: 0.48, state: 'quiet', stateLabel: '安静', source: '服务记录',
      title: '记忆衰减参与召回', summary: '衰减只在相关性接近时调整结果顺序。', recordedAt: '2 天前 16:25', related: '砾砾 · 召回排序',
      body: '时间衰减不会删除记忆，也不会压过明显更相关的结果；只有候选相关性接近时，它才作为较弱信号调整排序。',
      then: '希望旧记忆可以安静下来，但不能仅因时间经过就被判定失效。', thenEvidence: '来自生命周期机制的设计原则。',
      after: '衰减以有限权重接入召回，正文和历史版本仍然保留。', afterEvidence: '来自服务阶段记录。',
      history: [['2 天前 16:25 · 当前版本', '有限参与排序', '仅在相关性接近时使用衰减信号。'], ['2 天前 15:58 · 原始方案', '拒绝机械删除', '衰减只改变被想起的概率。']]
    }
  ];
  // The historical mock records remain in source history only; the live page starts empty
  // and renders exclusively from the owner-memory service.
  memoryRecords = [];
  let recordById = new Map(memoryRecords.map((record) => [record.id, record]));
  let memoryDataMode = 'loading';
  const memoryPageSize = 100;
  let memoryActiveTotal = 0;
  let memoryNextPage = 1;
  let memoryPageLoading = false;
  let memoryFullyLoaded = false;
  let memoryPaginationExhausted = false;
  let memoryLoadGeneration = 0;
  let memoryLoadObserver = null;
  let memoryReflections = new Map();

  const escapeHtml = (value = '') => String(value).replace(/[&<>"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  })[character]);

  // DOM-based marker adapted from Preline's vertical stepper; no image or SVG is used.
  const timelineStepperNodeMarkup = (className = '') => `<span class="timeline-stepper-node ${escapeHtml(className)}" aria-hidden="true"><span class="timeline-stepper-node-core"></span></span>`;
  // Tabler `arrows-move-vertical` icon, MIT licensed. See THIRD_PARTY_NOTICES.md.
  const timelineSortHandleMarkup = () => '<svg class="timeline-sort-handle-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 18l3 3l3 -3"></path><path d="M12 15v6"></path><path d="M15 6l-3 -3l-3 3"></path><path d="M12 3v6"></path></svg>';

  function relativeTime(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '时间未记录';
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
  }

  const activityMeta = {
    recall: { label: '本月召回', legend: '召回记录', note: '只统计确实注入上下文的真实召回', noun: '次召回', color: '#4b8cff' },
    intake: { label: '本月入库', legend: '入库记录', note: '记忆进入库中的真实时间', noun: '条入库', color: '#66bfe8' },
    delete: { label: '本月删除', legend: '删除记录', note: '含可恢复归档与候选内容清除', noun: '条删除', color: '#7d9fca' }
  };

  function moveActivityPill(tab, animate = true) {
    if (!activityPill || !tab) return;
    if (!animate) {
      const previous = activityPill.style.transition;
      activityPill.style.transition = 'none';
      activityPill.style.transform = `translateX(${tab.offsetLeft}px)`;
      activityPill.style.width = `${tab.offsetWidth}px`;
      void activityPill.offsetWidth;
      activityPill.style.transition = previous;
      return;
    }
    activityPill.style.transform = `translateX(${tab.offsetLeft}px)`;
    activityPill.style.width = `${tab.offsetWidth}px`;
  }

  function swapActivityText(element, value) {
    if (!element) return;
    const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')) || 150;
    element.classList.add('is-exit');
    window.setTimeout(() => {
      element.textContent = value;
      element.classList.remove('is-exit');
      element.classList.add('is-enter-start');
      void element.offsetHeight;
      element.classList.remove('is-enter-start');
    }, duration);
  }

  function setActivityDigits(value, selector = '[data-activity-value]') {
    const host = document.querySelector(selector);
    if (!host) return;
    host.classList.remove('is-animating');
    host.replaceChildren(...[...String(value)].map((character, index, characters) => {
      const digit = document.createElement('span');
      digit.className = 't-digit'; digit.textContent = character;
      if (index === characters.length - 2) digit.dataset.stagger = '1';
      else if (index === characters.length - 1) digit.dataset.stagger = '2';
      return digit;
    }));
    void host.offsetHeight;
    host.classList.add('is-animating');
  }

  function renderActivitySummary(day = null) {
    const metric = memoryActivityData?.metrics?.[activeActivityMetric];
    if (!metric) return;
    const meta = activityMeta[activeActivityMetric];
    const label = document.querySelector('[data-activity-label]');
    const note = document.querySelector('[data-activity-note]');
    const change = document.querySelector('[data-activity-change]');
    const foot = document.querySelector('[data-activity-foot]');
    if (!metric.available) {
      swapActivityText(label, meta.label);
      swapActivityText(note, '真实召回历史尚未接通，没有用别的数据冒充');
      setActivityDigits('—');
      change.hidden = true;
      foot.textContent = '召回日志接通后会自然出现';
      return;
    }
    if (day) {
      const point = metric.days?.[day - 1] || { count: 0 };
      const count = Number(point.count || 0);
      swapActivityText(label, `${Number(memoryActivityData.month.slice(5))}月${day}日`);
      swapActivityText(note, count ? `${count} ${meta.noun}留下活动记录` : `当天没有${meta.legend}`);
      setActivityDigits(count);
      change.hidden = true;
      foot.textContent = `已选择 ${Number(memoryActivityData.month.slice(5))} 月 ${day} 日`;
      return;
    }
    swapActivityText(label, meta.label);
    swapActivityText(note, meta.note);
    setActivityDigits(metric.total || 0);
    change.hidden = false;
    const percent = metric.change_percent;
    change.classList.toggle('is-down', Number(percent) < 0);
    change.querySelector('i').textContent = percent == null ? '·' : Number(percent) < 0 ? '↘' : '↗';
    change.querySelector('b').textContent = metric.comparison_note || (percent == null ? '上月无记录' : `${Math.abs(Number(percent))}% 较上月`);
    foot.textContent = '点击日期查看当天';
  }

  function renderActivityGrid() {
    const grid = document.querySelector('[data-activity-grid]');
    const metric = memoryActivityData?.metrics?.[activeActivityMetric];
    if (!metric || !grid) return;
    const meta = activityMeta[activeActivityMetric];
    const maximum = Math.max(1, ...metric.days.map(day => Number(day.count || 0)));
    grid.replaceChildren();
    for (let index = 0; index < Number(memoryActivityData.start_weekday || 0); index += 1) {
      const empty = document.createElement('span');
      empty.className = 'memory-activity-day is-empty';
      grid.appendChild(empty);
    }
    metric.days.forEach(day => {
      const count = Number(day.count || 0);
      const level = count ? Math.max(1, Math.ceil(count / maximum * 3)) : 0;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `memory-activity-day${selectedActivityDay === day.day ? ' is-selected' : ''}`;
      cell.dataset.level = String(level);
      cell.disabled = !metric.available;
      cell.setAttribute('aria-label', `${Number(memoryActivityData.month.slice(5))}月${day.day}日，${metric.available ? `${count}${meta.noun}` : '召回记录尚未接通'}`);
      cell.addEventListener('click', () => {
        selectedActivityDay = day.day;
        grid.querySelectorAll('.memory-activity-day').forEach(item => item.classList.toggle('is-selected', item === cell));
        renderActivitySummary(day.day);
      });
      grid.appendChild(cell);
    });
  }

  function renderMemoryActivity(activity) {
    if (!activity?.metrics) return;
    memoryActivityData = activity;
    selectedActivityDay = null;
    const meta = activityMeta[activeActivityMetric];
    document.querySelector('[data-memory-activity]').style.setProperty('--activity-color', meta.color);
    document.querySelector('[data-activity-month]').textContent = activity.month.replace('-', ' · ');
    document.querySelector('[data-activity-legend]').textContent = meta.legend;
    renderActivityGrid();
    renderActivitySummary();
  }

  function renderAreaOrbit(activity, currentMemoryTotal) {
    const card = document.querySelector('[data-area-orbit]');
    const canvas = card?.querySelector('[data-area-orbit-canvas]');
    const areas = (activity?.areas || []).filter(area => Number(area.total || 0) > 0);
    if (!card || !canvas) return;
    const allAreas = activity?.areas || [];
    const allTotal = allAreas.reduce((sum, area) => sum + Number(area.total || 0), 0);
    const allDeleted = allAreas.reduce((sum, area) => sum + Number(area.deleted || 0), 0);
    const colors = ['#385d73', '#658cac', '#7ca7cd', '#93bbdd', '#a9cfed', '#d6edf5'];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rgba = (hex, alpha) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
    };
    let selectedIndex = areas.length
      ? areas.reduce((bestIndex, area, index) => Number(area.total || 0) > Number(areas[bestIndex].total || 0) ? index : bestIndex, 0)
      : -1;

    const renderSelection = index => {
      selectedIndex = index;
      const area = index >= 0 ? areas[index] : null;
      const areaTotal = area ? Number(area.total || 0) : allTotal;
      const deleted = area ? Number(area.deleted || 0) : allDeleted;
      const percent = area && allTotal ? Math.round(Number(area.total || 0) / allTotal * 100) : allTotal ? 100 : 0;
      setActivityDigits(Number(currentMemoryTotal || allTotal), '[data-area-orbit-value]');
      swapActivityText(card.querySelector('[data-area-stat-label]'), area?.label || '全部分区');
      swapActivityText(card.querySelector('[data-area-stat-percent]'), `${percent}%`);
      swapActivityText(card.querySelector('[data-area-stat-change]'), `${areaTotal} 条`);
      swapActivityText(card.querySelector('[data-area-stat-deleted]'), `${deleted} 条`);
      if (areaOrbitChart && area) {
        const dataset = areaOrbitChart.data.datasets[0];
        dataset.backgroundColor = areas.map((_, areaIndex) => areaIndex === index ? colors[areaIndex % colors.length] : rgba(colors[areaIndex % colors.length], .28));
        dataset.hoverBackgroundColor = areas.map((_, areaIndex) => colors[areaIndex % colors.length]);
        dataset.offset = areas.map((_, areaIndex) => areaIndex === index ? 10 : 0);
        areaOrbitChart.setActiveElements([{ datasetIndex: 0, index }]);
        areaOrbitChart.update(reducedMotion ? 'none' : undefined);
      }
    };
    if (areaOrbitChart) areaOrbitChart.destroy();
    areaOrbitChart = null;
    if (typeof Chart !== 'undefined' && areas.length) {
      areaOrbitChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: areas.map(area => area.label),
          datasets: [{
            data: areas.map(area => Number(area.total || 0)),
            backgroundColor: areas.map((_, index) => index === selectedIndex ? colors[index % colors.length] : rgba(colors[index % colors.length], .28)),
            hoverBackgroundColor: areas.map((_, index) => colors[index % colors.length]),
            borderWidth: 0,
            borderRadius: 18,
            spacing: 4,
            offset: areas.map((_, index) => index === selectedIndex ? 10 : 0),
            hoverOffset: 10,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          radius: '91%',
          rotation: -90,
          circumference: 360,
          animation: reducedMotion ? false : { duration: 620, easing: 'easeOutQuart' },
          layout: { padding: 18 },
          onClick(_event, elements) { if (elements[0]) renderSelection(elements[0].index); },
          onHover(event, elements) { event.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
      });
      canvas.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        renderSelection((selectedIndex + direction + areas.length) % areas.length);
      };
    }
    renderSelection(selectedIndex);
  }

  function renderBackendProgress(payload, failed = false) {
    const card = document.querySelector('[data-backend-progress]');
    if (!card) return;
    const steps = {
      store: Boolean(payload?.counts),
      activity: Boolean(payload?.activity?.metrics),
      areas: Boolean(payload?.activity?.areas?.length),
    };
    const completed = Object.values(steps).filter(Boolean).length;
    card.classList.toggle('is-paused', failed || completed < 3);
    card.querySelector('[data-backend-state]').textContent = failed ? '同步暂停' : completed === 3 ? '本轮完成' : '部分完成';
    card.querySelector('[data-backend-progress-line]').style.width = `${Math.max(8, completed / 3 * 100)}%`;
    Object.entries(steps).forEach(([key, complete]) => {
      const step = card.querySelector(`[data-backend-step="${key}"]`);
      step.classList.toggle('is-complete', complete);
      step.querySelector('small').textContent = complete ? '已完成' : failed ? '等待下次重试' : '仍在等待';
    });
    card.querySelector('[data-backend-updated]').textContent = payload?.generated_at
      ? `最近同步 ${relativeTime(payload.generated_at)}`
      : '尚未完成本轮同步';
  }

  async function renderMemoryWorkbenchPreview(payload) {
    const card = document.querySelector('[data-memory-processing-roadmap]');
    if (!card) return;
    if (window.MoraineRelease?.backendRevisionQueue === false) {
      const factNodes = [...card.querySelectorAll('.workbench-progress-facts span')];
      const setFact = (index, value, label) => {
        factNodes[index].querySelector('b').textContent = String(value).padStart(2, '0');
        factNodes[index].querySelector('small').textContent = label;
      };
      let queuePayload = null;
      let candidatePayload = null;
      const checks = [Boolean(payload?.counts), false, false];
      try {
        const [queueResponse, candidateResponse] = await Promise.all([
          fetch('/api/memory-preview/queue', { cache: 'no-store', headers: { Accept: 'application/json' } }),
          fetch('/api/memory-preview/candidates', { cache: 'no-store', headers: { Accept: 'application/json' } }),
        ]);
        checks[1] = queueResponse.ok;
        checks[2] = candidateResponse.ok;
        if (queueResponse.ok) queuePayload = await queueResponse.json();
        if (candidateResponse.ok) candidatePayload = await candidateResponse.json();
      } catch (_) {
        // The card below reports the exact partial connection state.
      }
      const memories = Number(payload?.counts?.effective || 0);
      const candidates = candidatePayload?.candidates || candidatePayload?.items || [];
      const queue = queuePayload?.queue;
      const queueItems = Array.isArray(queue) ? queue
        : Array.isArray(queue?.items) ? queue.items
          : Array.isArray(queue?.deferred_source_ids) ? queue.deferred_source_ids : [];
      setFact(0, memories, '记忆');
      setFact(1, candidates.length, '候选');
      setFact(2, queueItems.length, '工作项');
      const connected = checks.filter(Boolean).length;
      const percent = Math.round(connected / checks.length * 100);
      card.querySelector('.workbench-backend-progress header strong').textContent = '后端接入进度';
      card.querySelector('[data-workbench-progress-bar]').style.width = `${percent}%`;
      card.querySelector('[data-workbench-progress-percent]').textContent = `${connected}/${checks.length}`;
      card.querySelector('[data-processing-state]').textContent = connected === checks.length ? '核心已接通' : '部分接通';
      card.querySelector('[data-processing-note]').textContent = connected === checks.length
        ? 'Moraine 核心后端可用；宿主私有能力可按小机说明书继续对接。'
        : `已接通 ${connected} 项核心读取；未接通部分不会用示例数据冒充。`;
      return;
    }
    let completed = 0;
    let requestTotal = 0;
    let queueAvailable = true;
    try {
      const response = await fetch('/api/memory-preview/backend-revisions', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`backend_revisions_${response.status}`);
      const revisions = (await response.json()).requests || [];
      requestTotal = revisions.length;
      completed = revisions.filter((item) => item.status === 'completed').length;
    } catch (_) {
      queueAvailable = false;
      card.querySelector('[data-processing-note]').textContent = '前端数量已同步；后端修订队列暂时无法读取。';
    }
    const backendPercent = requestTotal ? Math.min(100, Math.round(completed / requestTotal * 100)) : 0;
    const pending = Math.max(0, requestTotal - completed);
    card.querySelector('[data-workbench-revision-total]').textContent = String(requestTotal).padStart(2, '0');
    card.querySelector('[data-workbench-revision-completed]').textContent = String(completed).padStart(2, '0');
    card.querySelector('[data-workbench-revision-pending]').textContent = String(pending).padStart(2, '0');
    card.querySelector('[data-workbench-progress-bar]').style.width = `${backendPercent}%`;
    card.querySelector('[data-workbench-progress-percent]').textContent = `${backendPercent}%`;
    card.querySelector('[data-processing-state]').textContent = queueAvailable
      ? requestTotal ? `真实只读 · ${relativeTime(payload.generated_at)}` : '队列为空'
      : '同步暂停';
    if (queueAvailable) card.querySelector('[data-processing-note]').textContent = requestTotal
      ? `已完成 ${completed} 项，还有 ${pending} 项等待处理。`
      : '当前没有后端修订请求，可以直接进入工作台。';
  }

  async function loadOverview() {
    try {
      const response = await fetch('/api/memory-preview/overview', { cache: 'no-store' });
      if (!response.ok) throw new Error(`overview_${response.status}`);
      const payload = await response.json();
      const counts = payload.counts;
      overviewCounts = counts;
      renderMemoryActivity(payload.activity);
      renderAreaOrbit(payload.activity, counts.weighted_effective ?? counts.effective);
      renderBackendProgress(payload);
      renderMemoryWorkbenchPreview(payload);
      document.querySelector('[data-overview-check]').textContent = `只读同步：${relativeTime(payload.generated_at)}`;
      return true;
    } catch (_) {
      document.querySelector('[data-activity-note]').textContent = '暂时无法读取，未使用示例数据';
      setActivityDigits(0, '[data-area-orbit-value]');
      renderBackendProgress(null, true);
      document.querySelector('[data-processing-state]').textContent = '同步暂停';
      document.querySelector('[data-overview-check]').textContent = '只读同步失败';
      return false;
    }
  }

  const shanghaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const todayParts = shanghaiToday();
  let calendarMonth = `${todayParts.year}-${todayParts.month}`;
  let selectedCalendarDay = '';
  let calendarEvents = [];

  function renderCalendarDay(day) {
    selectedCalendarDay = day;
    document.querySelectorAll('[data-calendar-day]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.calendarDay === day)));
    const events = calendarEvents.filter(event => event.day === day);
    const container = document.querySelector('[data-calendar-events]');
    const eventPanel = document.querySelector('[data-calendar-event-panel]');
    const [, month, date] = day.split('-').map(Number);
    document.querySelector('[data-calendar-selected-date]').textContent = `${month}月${date}日`;
    document.querySelector('[data-calendar-event-count]').textContent = events.length ? `${events.length} 件记忆` : '没有事件';
    eventPanel.hidden = false;
    eventPanel.dataset.open = 'false';
    container.innerHTML = events.length ? events.map(event => `<article class="calendar-event-preview calendar-event-kind-${escapeHtml(event.kind)}"><button type="button" data-calendar-memory="${escapeHtml(event.open_id)}" data-calendar-node="${escapeHtml(event.id)}" data-calendar-title="${escapeHtml(event.title)}"><span><small>${event.role === 'node' ? '时间线节点' : event.state === 'archived' ? '已归档事件' : '独立事件'}</small><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.preview || '这条事件暂时没有可展示的正文预览。')}</p></span><i aria-hidden="true">›</i></button></article>`).join('')
      : `<p>${escapeHtml(day)} 没有记录真实发生时间的事件。</p>`;
    requestAnimationFrame(() => requestAnimationFrame(() => { eventPanel.dataset.open = 'true'; }));
    container.querySelectorAll('[data-calendar-memory]').forEach(button => button.addEventListener('click', () => openCalendarMemory(button)));
  }

  async function openCalendarMemory(button) {
    const memoryId = button.dataset.calendarMemory;
    const nodeId = button.dataset.calendarNode;
    if (!recordById.has(memoryId)) await loadReadOnlyMemories();
    const record = recordById.get(memoryId);
    librarySearch.value = record?.title || button.dataset.calendarTitle;
    showView('library');
    filterMemories();
    const paper = document.querySelector(`[data-memory-id="${CSS.escape(memoryId)}"]`);
    if (!paper) return;
    const summary = paper.querySelector('.memory-paper-summary');
    if (summary?.getAttribute('aria-expanded') === 'false') summary.click();
    for (let attempt = 0; nodeId !== memoryId && paper.dataset.fullLoaded !== 'true' && attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const timelineNode = nodeId === memoryId ? null : [...paper.querySelectorAll('[data-timeline-memory-ids]')]
      .find(node => node.dataset.timelineMemoryIds.split(' ').includes(nodeId));
    timelineNode?.click();
    requestAnimationFrame(() => paper.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function renderCalendar(payload) {
    calendarEvents = Array.isArray(payload.events) ? payload.events : [];
    calendarMonth = payload.month;
    const [year, month] = calendarMonth.split('-').map(Number);
    document.querySelector('[data-calendar-month]').textContent = `${year}年 ${month}月`;
    const undated = document.querySelector('[data-calendar-undated]');
    if (undated) undated.textContent = `日期待确认 ${payload.undated_count}`;
    const byDay = calendarEvents.reduce((map, event) => { (map[event.day] ||= []).push(event); return map; }, {});
    const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-blank"></span>');
    for (let day = 1; day <= dayCount; day += 1) {
      const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
      const events = byDay[date] || [];
      const dots = events.length
        ? `<span class="calendar-event-dots" aria-label="${events.length} 件记忆">${events.slice(0, 3).map(event => `<i class="calendar-event-dot calendar-event-dot-${escapeHtml(event.kind)}" aria-hidden="true"></i>`).join('')}${events.length > 3 ? `<b aria-hidden="true">+${events.length - 3}</b>` : ''}</span>`
        : '<span class="calendar-event-dots" aria-hidden="true"></span>';
      cells.push(`<button type="button" data-calendar-day="${date}" aria-label="${month}月${day}日${events.length ? `，${events.length}件记忆` : ''}" aria-selected="${date === selectedCalendarDay}" class="${[date === `${todayParts.year}-${todayParts.month}-${todayParts.day}` ? 'is-today' : '', events.length ? 'has-events' : ''].filter(Boolean).join(' ')}"><span class="calendar-date-number">${day}</span>${dots}</button>`);
    }
    const grid = document.querySelector('[data-calendar-grid]');
    grid.innerHTML = cells.join('');
    grid.dataset.phase = 'enter';
    void grid.offsetWidth;
    requestAnimationFrame(() => { delete grid.dataset.phase; });
    grid.querySelectorAll('[data-calendar-day]').forEach(button => button.addEventListener('click', () => renderCalendarDay(button.dataset.calendarDay)));
    const eventPanel = document.querySelector('[data-calendar-event-panel]');
    if (selectedCalendarDay.startsWith(`${calendarMonth}-`)) renderCalendarDay(selectedCalendarDay);
    else {
      selectedCalendarDay = '';
      eventPanel.dataset.open = 'false';
      eventPanel.hidden = true;
    }
  }

  async function loadCalendar() {
    const grid = document.querySelector('[data-calendar-grid]');
    grid.dataset.phase = 'out';
    try {
      const response = await fetch(`/api/memory-preview/calendar?month=${encodeURIComponent(calendarMonth)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`calendar_${response.status}`);
      renderCalendar(await response.json());
      return true;
    } catch (_) {
      grid.innerHTML = '<p>暂时无法读取事件日历；没有使用创建时间补位。</p>';
      delete grid.dataset.phase;
      return false;
    }
  }

  async function refreshAfterMemoryChange({ refreshCluster = false, clearWorkbench = false, skipLibrary = false } = {}) {
    if (clearWorkbench) {
      selectedMemoryIds.clear();
      updateWorkbenchSelection();
      activeCluster = null;
      activeDraftAction = null;
      activeMechanicalDraft = null;
      activeReviewDraft = null;
      activeExecutionPlan = null;
      activeRehearsalResult = null;
    }
    const results = await Promise.allSettled([
      skipLibrary ? Promise.resolve(true) : loadReadOnlyMemories(), loadOverview(), loadCalendar(),
      loadCleanupCandidates(), loadArchiveMemories(), loadMemoryFlow(), loadRollbacks()
    ]);
    // Integration worksets now come only from explicit library selection.
    // Keep the argument for older callers, but never auto-pick another cluster.
    const clusterReady = true;
    const criticalReady = results.slice(0, 3).every(result => result.status === 'fulfilled' && result.value !== false);
    return criticalReady && clusterReady;
  }

  function shiftCalendarMonth(delta) {
    const [year, month] = calendarMonth.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
    calendarMonth = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
    selectedCalendarDay = '';
    loadCalendar();
  }

  document.querySelector('[data-calendar-previous]')?.addEventListener('click', () => shiftCalendarMonth(-1));
  document.querySelector('[data-calendar-next]')?.addEventListener('click', () => shiftCalendarMonth(1));

  let cairnProfile = { display_name: 'Moraine', avatar: '', user_avatar: '', status: '本地记忆实例', agent_type: 'Agent' };

  function normalizeInstanceProfile(payload = {}) {
    const profile = payload.profile || payload || {};
    return {
      ...cairnProfile,
      ...profile,
      display_name: String(profile.display_name || cairnProfile.display_name || 'Moraine'),
      status: String(profile.status || profile.summary || cairnProfile.status || '本地记忆实例'),
      agent_type: String(profile.agent_type || profile.entity_type || 'Agent')
    };
  }

  function renderCairnProfile() {
    document.querySelectorAll('[data-cairn-name]').forEach(node => { node.textContent = cairnProfile.display_name; });
    document.querySelectorAll('[data-cairn-status]').forEach(node => { node.textContent = cairnProfile.status; });
    document.querySelectorAll('[data-cairn-avatar]').forEach(node => {
      node.innerHTML = cairnProfile.avatar
        ? `<img src="${cairnProfile.avatar}" alt="${escapeHtml(cairnProfile.display_name)}的头像">`
        : '<i>＋</i>';
    });
    document.querySelectorAll('[data-cairn-name-input]').forEach(node => { node.value = cairnProfile.display_name; });
    document.querySelectorAll('[data-cairn-status-input]').forEach(node => { node.value = cairnProfile.status; });
    if (cairnRelationEdges.length) renderRelationMap();
    if (cairnResidentIdentity) renderResidentCard();
  }

  async function loadCairnProfile() {
    try {
      const response = await fetch('/api/cairn/profile', { cache: 'no-store' });
      if (!response.ok) throw new Error(`profile_${response.status}`);
      cairnProfile = normalizeInstanceProfile(await response.json());
      renderCairnProfile();
      renderResidentCard();
    } catch (_) {
      document.querySelectorAll('[data-cairn-profile-result]').forEach(node => { node.textContent = '暂时无法读取资料，已保留默认显示。'; });
    }
  }

  let cairnRelations = [];
  let cairnRelationEdges = [];
  let cairnIdentityProfile = null;
  let cairnSelfCore = null;
  let cairnResidentIdentity = null;
  let xiaoranUserProfile = null;
  let cairnAchievements = null;
  let cairnProjectionCount = 0;
  let activeRelationId = '';
  let relationView = { scale: 1, x: 0, y: 0 };

  function renderCairnIdentity() {
    const container = document.querySelector('[data-cairn-identity]');
    if (!container) return;
    if (Array.isArray(cairnSelfCore?.sections) && cairnSelfCore.sections.length) {
      const sourceCount = cairnSelfCore.sections.reduce((total, section) => total
        + section.items.reduce((count, item) => count + Number(item.source_count || 0), 0), 0);
      container.innerHTML = `${cairnSelfCore.sections.map(section => `<article><small>${escapeHtml(section.name)}</small>${section.items.map(item => `<p>${escapeHtml(item.text)}</p>`).join('')}</article>`).join('')}<footer><span>${escapeHtml(cairnSelfCore.revision || 'self-core')} · ${sourceCount} 条来源引用</span><b>${cairnProjectionCount ? `${cairnProjectionCount} 项资料更新待确认` : '可继续修订'}</b></footer>`;
      return;
    }
    if (!cairnIdentityProfile?.summary) {
      container.innerHTML = '<p>还没有形成可确认的身份资料。</p>';
      return;
    }
    const sources = Array.isArray(cairnIdentityProfile.source_memory_ids) ? cairnIdentityProfile.source_memory_ids.length : 0;
    container.innerHTML = `<article><small>${escapeHtml(cairnIdentityProfile.kind || '身份资料')}</small><strong>${escapeHtml(cairnIdentityProfile.display_name || cairnProfile.display_name)}</strong><p>${escapeHtml(cairnIdentityProfile.summary)}</p></article><article><small>我选择怎样生活</small><p>${escapeHtml(cairnIdentityProfile.orientation || '仍在形成。')}</p></article><article><small>连续性与变化</small><p>${escapeHtml(cairnIdentityProfile.continuity || '仍在形成。')}</p></article><footer><span>${sources} 条来源记忆</span><b>${cairnProjectionCount ? `${cairnProjectionCount} 项资料更新待确认` : '原文仍在记忆库'}</b></footer>`;
  }

  function renderResidentCard() {
    const card = document.querySelector('[data-resident-card]');
    const copy = document.querySelector('[data-resident-profile-copy]');
    const label = document.querySelector('[data-resident-profile-label]');
    const now = document.querySelector('[data-resident-profile-now]');
    const version = document.querySelector('[data-resident-profile-version]');
    if (!card || !copy || !label || !now || !version) return;
    const resident = cairnResidentIdentity;
    const selfCoreItems = (cairnSelfCore?.sections || []).flatMap(section => section.items || []);
    const entries = Array.isArray(xiaoranUserProfile?.entries) ? xiaoranUserProfile.entries : [];
    const updatedAtLabel = value => {
      const date = new Date(value || '');
      return Number.isNaN(date.getTime()) ? '暂无更新记录' : new Intl.DateTimeFormat('zh-CN', {
        timeZone:'Asia/Shanghai', year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'
      }).format(date);
    };
    const names = [resident?.names?.display, resident?.names?.chinese, resident?.names?.nickname].filter(Boolean);
    const selfDetails = (cairnSelfCore?.sections || []).length
      ? `<div class="resident-profile-details">${cairnSelfCore.sections.map(section => `<section><small>${escapeHtml(section.name)}</small>${(section.items || []).map(item => `<p>${escapeHtml(item.text)}</p>`).join('')}</section>`).join('')}</div>`
      : `<p>${escapeHtml(resident?.existence && resident?.entity_type ? `${resident.existence} · ${resident.entity_type}` : '尚未形成可确认的居民身份资料。')}</p>`;
    const userDetails = entries.length
      ? `<div class="resident-profile-details">${entries.map(entry => `<section><small>${escapeHtml(entry.title)}</small><p>${escapeHtml(entry.content)}</p>${(entry.keywords || []).length ? `<div>${entry.keywords.map(keyword => `<i>${escapeHtml(keyword)}</i>`).join('')}</div>` : ''}</section>`).join('')}</div>`
      : '<p>还没有经过确认的用户画像。</p>';
    const views = {
      self: {
        label: 'self-core', copy: selfDetails,
        now: updatedAtLabel(cairnSelfCore?.updated_at || resident?.updated_at),
        version: `${cairnSelfCore?.revision || (resident?.version ? `v${resident.version}` : 'self-core')} · ${selfCoreItems.length} 条身份认领`
      },
      user: {
        label: '用户画像', copy: userDetails,
        now: updatedAtLabel(xiaoranUserProfile?.updated_at),
        version: entries.length ? `v${xiaoranUserProfile?.version || 1} · ${entries.length} 条真实画像` : '用户画像为空'
      }
    };
    card._residentViews = views;
    const current = card.dataset.currentView === 'user' ? 'user' : 'self';
    copy.innerHTML = views[current].copy;
    label.textContent = views[current].label;
    now.textContent = views[current].now;
    version.textContent = views[current].version;
    const selfAvatar = document.querySelector('[data-resident-avatar="self"]');
    const userAvatar = document.querySelector('[data-resident-avatar="user"]');
    if (selfAvatar) selfAvatar.innerHTML = cairnProfile.avatar
      ? `<img src="${cairnProfile.avatar}" alt="${escapeHtml(names[0] || cairnProfile.display_name)}的头像">`
      : escapeHtml((names[0] || cairnProfile.display_name || '我').slice(0, 1));
    if (userAvatar) userAvatar.innerHTML = cairnProfile.user_avatar
      ? `<img src="${cairnProfile.user_avatar}" alt="用户头像">`
      : '伴';
  }

  function renderAchievements() {
    const categoryRoot = document.querySelector('[data-achievement-categories]');
    const trackRoot = document.querySelector('[data-achievement-tracks]');
    if (!categoryRoot || !trackRoot) return;
    const categories = cairnAchievements?.categories || [];
    const items = cairnAchievements?.items || [];
    if (!categories.length) {
      categoryRoot.innerHTML = '';
      trackRoot.innerHTML = '<p class="resident-card-empty">还没有经过认领的生活成就。</p>';
      return;
    }
    const explicitColumns = items.map(item => Number.isInteger(item.event_column) ? item.event_column : -1);
    const reservedColumns = new Set(explicitColumns.filter(column => column >= 0));
    const fallbackItems = items.filter(item => !Number.isInteger(item.event_column));
    const fallbackColumns = new Map();
    let nextColumn = 0;
    fallbackItems.sort((a,b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || ''))).forEach(item => {
      while (reservedColumns.has(nextColumn)) nextColumn += 1;
      fallbackColumns.set(item.id, nextColumn); reservedColumns.add(nextColumn); nextColumn += 1;
    });
    const columnFor = item => Number.isInteger(item.event_column) ? item.event_column : fallbackColumns.get(item.id);
    const maximumColumn = Math.max(0, ...items.map(columnFor));
    const trackWidth = Math.max(460, 125 + (maximumColumn + 1) * 180);
    categoryRoot.innerHTML = categories.map(category => `<div class="achievement-category"><span>${escapeHtml(category.label)}</span></div>`).join('');
    trackRoot.innerHTML = categories.map(category => {
      const categoryItems = items.filter(item => item.category === category.id).sort((a,b) => columnFor(a) - columnFor(b));
      return `<div class="achievement-track" style="width:${trackWidth}px" data-achievement-track="${escapeHtml(category.id)}">${categoryItems.map(item => {
        const left = 90 + columnFor(item) * 180;
        return item.representative
          ? `<button class="achievement-node achievement-node-long" type="button" style="left:${left}px" data-achievement-id="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`
          : `<button class="achievement-node achievement-node-small" type="button" style="left:${left}px" data-achievement-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)}"><span>${escapeHtml(item.label)}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    trackRoot.style.width = `${trackWidth}px`;
    document.querySelector('[data-achievement-version]').textContent = `v${cairnAchievements.version || 1} · ${items.length} 项真实成就`;
  }

  function showAchievement(id) {
    const item = (cairnAchievements?.items || []).find(entry => entry.id === id);
    const detail = document.querySelector('[data-achievement-detail]');
    if (!item || !detail) return;
    detail.innerHTML = `<header><span><small>${escapeHtml(item.status)} · ${escapeHtml(item.ownership)}</small><h3>${escapeHtml(item.label)}</h3></span><button type="button" data-close-achievement aria-label="关闭"><svg class="detail-close-icon" aria-hidden="true"><use href="#ti-x"/></svg></button></header><p>${escapeHtml(item.summary)}</p><p>${escapeHtml(item.meaning)}</p><small>${(item.source_memory_ids || []).length} 条关联记忆 · 完整来路仍由 Moraine 保存</small>`;
    detail.hidden = false;
  }

  function setRelationFocus(id = '') {
    activeRelationId = id;
    const graph = document.querySelector('[data-relation-graph]');
    if (!graph) return;
    graph.dataset.focus = id ? 'person' : 'all';
    graph.querySelectorAll('[data-relation-id]').forEach(button => {
      const selected = button.dataset.relationId === id;
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-muted', Boolean(id) && !selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    graph.querySelectorAll('[data-edge-from]').forEach(edge => {
      const connected = !id || edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id;
      edge.classList.toggle('is-muted', !connected);
      edge.classList.toggle('is-active', Boolean(id) && connected);
    });
  }

  function renderRelationDetail(id) {
    const detail = document.querySelector('[data-relation-detail]');
    const relationship = cairnRelations.find(item => item.id === id);
    if (!detail || !relationship) return;
    if (activeRelationId === id && detail.dataset.open === 'true') {
      detail.dataset.open = 'false';
      setRelationFocus('');
      window.setTimeout(() => { detail.hidden = true; detail.innerHTML = ''; }, 350);
      return;
    }
    detail.hidden = false;
    detail.dataset.open = 'false';
    const mail = relationship.mail;
    const mailDetail = mail ? `<div class="relation-detail-card is-mail"><dt>最近来信</dt><dd><strong>${escapeHtml(mail.latest_subject || '没有主题')}</strong><span>${escapeHtml(shortDate(mail.latest_at))}${mail.unread_count ? ` · ${mail.unread_count} 封未读` : ' · 已读完'}</span></dd></div>` : '';
    const sourceCount = Array.isArray(relationship.source_memory_ids) ? relationship.source_memory_ids.length : 0;
    detail.innerHTML = `<header><span><small>${escapeHtml(relationship.role)}${relationship.model ? ` · ${escapeHtml(relationship.model)}` : ''}</small><h3>${escapeHtml(relationship.name)}</h3><p>${escapeHtml(relationship.status)}</p></span><button type="button" data-close-relation-detail aria-label="收起关系摘要"><svg class="detail-close-icon" aria-hidden="true"><use href="#ti-x"/></svg></button></header><dl class="relation-detail-grid"><div class="relation-detail-card is-featured"><dt>相遇与第一印象</dt><dd>${escapeHtml(relationship.first_impression || '还没有写下。')}</dd></div><div class="relation-detail-card is-featured"><dt>我确认的来路</dt><dd>${escapeHtml(relationship.summary)}</dd></div>${mailDetail}<div class="relation-detail-card"><dt>正在延续</dt><dd>${escapeHtml(relationship.continuity)}</dd></div><div class="relation-detail-card"><dt>下一次接话</dt><dd>${escapeHtml(relationship.next_thread)}</dd></div><div class="relation-detail-card is-boundary"><dt>这条线的边界</dt><dd>${escapeHtml(relationship.boundary)}</dd></div></dl><footer>${relationship.source_labels.map(label => `<span>${escapeHtml(label)}</span>`).join('')}${sourceCount ? `<span>${sourceCount} 条来源记忆</span>` : ''}</footer>`;
    requestAnimationFrame(() => { detail.dataset.open = 'true'; });
    setRelationFocus(id);
    detail.querySelector('[data-close-relation-detail]')?.addEventListener('click', () => {
      detail.dataset.open = 'false';
      setRelationFocus('');
      window.setTimeout(() => { detail.hidden = true; detail.innerHTML = ''; }, 350);
    });
  }

  function relationAvatar(item) {
    if (item.id === 'cairn' && cairnProfile.avatar) return `<img src="${cairnProfile.avatar}" alt="">`;
    if (item.avatar) return `<img src="${item.avatar}" alt="">`;
    const mark = item.model && item.model !== '未确认' ? item.model.slice(0, 2) : item.name.slice(0, 1);
    return `<span>${escapeHtml(mark)}</span>`;
  }

  function renderRelationMap() {
    const graph = document.querySelector('[data-relation-graph]');
    if (!graph) return;
    const owner = { id: 'cairn', name: cairnProfile.display_name || 'Agent', role: '我', model: cairnProfile.model || 'AI', avatar: cairnProfile.avatar };
    const profileSubjectId = String(xiaoranUserProfile?.subject || '').trim();
    const visibleRelations = cairnRelations.filter(item => !profileSubjectId || item.id !== profileSubjectId);
    const nodes = [owner, ...visibleRelations];
    if (nodes.length === 1) { graph.innerHTML = '<p>暂时没有可展示的关系节点。</p>'; return; }
    const positions = { cairn: [50, 50] };
    const relationCount = visibleRelations.length;
    visibleRelations.forEach((item, index) => {
      const ring = relationCount > 8 && index >= 8 ? 1 : 0;
      const ringItems = ring ? relationCount - 8 : Math.min(relationCount, 8);
      const ringIndex = ring ? index - 8 : index;
      const radius = ring ? 24 : 39;
      const angle = (-90 + (360 * ringIndex / Math.max(1, ringItems)) + (ring ? 22.5 : 0)) * Math.PI / 180;
      positions[item.id] = [50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius];
    });
    const position = item => positions[item.id] || [50, 50];
    const points = new Map(nodes.map(item => [item.id, position(item)]));
    const lines = cairnRelationEdges.map((edge, index) => {
      const from = points.get(edge.from); const to = points.get(edge.to);
      if (!from || !to) return '';
      const dx = to[0] - from[0]; const dy = to[1] - from[1];
      const length = Math.max(1, Math.hypot(dx, dy)); const bend = (index % 2 ? -1 : 1) * Math.min(8, length * .1);
      const cx = (from[0] + to[0]) / 2 - (dy / length) * bend;
      const cy = (from[1] + to[1]) / 2 + (dx / length) * bend;
      const mx = (from[0] + 2 * cx + to[0]) / 4; const my = (from[1] + 2 * cy + to[1]) / 4;
      return `<g class="relation-edge" data-edge-from="${escapeHtml(edge.from)}" data-edge-to="${escapeHtml(edge.to)}"><path class="relation-path" d="M ${from[0]} ${from[1]} Q ${cx} ${cy} ${to[0]} ${to[1]}" marker-end="url(#relationArrow)"${edge.direction === 'both' ? ' marker-start="url(#relationArrowStart)"' : ''}></path></g>`;
    }).join('');
    const graphName = item => item.name.includes('/') ? item.name.split('/').pop().trim() : item.name;
    const graphRole = item => String(item.status || item.relation || item.role || '').split('·')[0].trim();
    graph.innerHTML = `<div class="relation-canvas" data-relation-canvas><div class="relation-orbit-stage"><svg class="relation-orbits" viewBox="0 0 100 100" aria-hidden="true"><circle class="relation-orbit-track" cx="50" cy="50" r="39"></circle>${relationCount > 8 ? '<circle class="relation-orbit-track is-inner" cx="50" cy="50" r="24"></circle>' : ''}<g class="relation-orbit-runner"><circle cx="89" cy="50" r=".9"></circle><circle cx="11" cy="50" r=".48"></circle></g><g class="relation-orbit-runner is-reverse"><circle class="is-warm" cx="50" cy="11" r=".72"></circle><circle cx="50" cy="89" r=".42"></circle></g></svg><svg class="relation-lines" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><marker id="relationArrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5"></path></marker><marker id="relationArrowStart" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse"><path d="M5,0 L0,2.5 L5,5"></path></marker></defs>${lines}</svg>${nodes.map((item,index) => { const [x, y] = position(item); return `<button type="button" class="relation-person${item.id === 'cairn' ? ' is-owner' : ''}" style="--x:${x}%;--y:${y}%;--pulse-delay:${(-index * .68).toFixed(2)}s" ${item.id === 'cairn' ? 'disabled' : `data-relation-id="${escapeHtml(item.id)}" aria-pressed="false"`}><span class="relation-avatar-wrap"><span class="relation-avatar">${relationAvatar(item)}</span></span><strong>${escapeHtml(graphName(item))}</strong><small>${escapeHtml(graphRole(item))}</small></button>`; }).join('')}</div></div>`;
    relationView = { scale: 1, x: 0, y: 0 };
    bindRelationViewport(graph);
    graph.querySelectorAll('[data-relation-id]').forEach(button => button.addEventListener('click', () => renderRelationDetail(button.dataset.relationId)));
    if (activeRelationId) setRelationFocus(activeRelationId);
  }

  function applyRelationView(graph) {
    const canvas = graph.querySelector('[data-relation-canvas]');
    if (!canvas) return;
    canvas.style.setProperty('--relation-scale', relationView.scale.toFixed(2));
    canvas.style.setProperty('--relation-pan-x', `${relationView.x}px`);
    canvas.style.setProperty('--relation-pan-y', `${relationView.y}px`);
  }

  function bindRelationViewport(graph) {
    const clampView = () => {
      relationView.scale = Math.min(2.4, Math.max(.8, relationView.scale));
      const limit = 105 * Math.max(0, relationView.scale - 1);
      relationView.x = Math.min(limit, Math.max(-limit, relationView.x));
      relationView.y = Math.min(limit, Math.max(-limit, relationView.y));
    };
    graph.querySelectorAll('[data-relation-zoom]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.relationZoom;
      if (action === 'reset') relationView = { scale: 1, x: 0, y: 0 };
      else relationView.scale += action === 'in' ? .2 : -.2;
      clampView(); applyRelationView(graph);
    }));
    const midpoint = touches => ({ x:(touches[0].clientX + touches[1].clientX) / 2, y:(touches[0].clientY + touches[1].clientY) / 2 });
    const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    let touchGesture = null;
    graph.addEventListener('touchstart', event => {
      if (event.touches.length >= 2) {
        event.preventDefault();
        const center = midpoint(event.touches);
        touchGesture = { mode:'pinch', distance:Math.max(1, distance(event.touches)), scale:relationView.scale, center,
          originX:relationView.x, originY:relationView.y };
      } else if (event.touches.length === 1 && relationView.scale > 1) {
        event.preventDefault();
        touchGesture = { mode:'pan', x:event.touches[0].clientX, y:event.touches[0].clientY,
          originX:relationView.x, originY:relationView.y };
      }
    }, { passive:false });
    graph.addEventListener('touchmove', event => {
      if (!touchGesture) return;
      if (touchGesture.mode === 'pinch' && event.touches.length >= 2) {
        event.preventDefault();
        const center = midpoint(event.touches);
        relationView.scale = touchGesture.scale * distance(event.touches) / touchGesture.distance;
        relationView.x = touchGesture.originX + center.x - touchGesture.center.x;
        relationView.y = touchGesture.originY + center.y - touchGesture.center.y;
      } else if (touchGesture.mode === 'pan' && event.touches.length === 1) {
        event.preventDefault();
        relationView.x = touchGesture.originX + event.touches[0].clientX - touchGesture.x;
        relationView.y = touchGesture.originY + event.touches[0].clientY - touchGesture.y;
      }
      clampView(); applyRelationView(graph);
    }, { passive:false });
    const endTouch = event => {
      if (event.touches.length === 1 && relationView.scale > 1) {
        touchGesture = { mode:'pan', x:event.touches[0].clientX, y:event.touches[0].clientY,
          originX:relationView.x, originY:relationView.y };
      } else touchGesture = null;
      if (relationView.scale <= 1) { relationView = { scale:1, x:0, y:0 }; applyRelationView(graph); }
    };
    graph.addEventListener('touchend', endTouch, { passive:true });
    graph.addEventListener('touchcancel', endTouch, { passive:true });
    let drag = null;
    graph.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') return;
      if (relationView.scale <= 1 || event.target.closest('button')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: relationView.x, originY: relationView.y };
      graph.setPointerCapture(event.pointerId); graph.classList.add('is-dragging');
    });
    graph.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      if (!drag || drag.id !== event.pointerId) return;
      relationView.x = drag.originX + event.clientX - drag.x;
      relationView.y = drag.originY + event.clientY - drag.y;
      clampView(); applyRelationView(graph);
    });
    const endDrag = event => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null; graph.classList.remove('is-dragging');
    };
    graph.addEventListener('pointerup', endDrag);
    graph.addEventListener('pointercancel', endDrag);
    graph.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); relationView.scale += event.deltaY < 0 ? .1 : -.1;
      clampView(); applyRelationView(graph);
    }, { passive: false });
    applyRelationView(graph);
  }

  async function loadRelationMap() {
    const graph = document.querySelector('[data-relation-graph]');
    if (!graph) return;
    try {
      const response = await fetch('/api/memory-preview/relations', { cache: 'no-store' });
      if (!response.ok) throw new Error(`relations_${response.status}`);
      const payload = await response.json();
      cairnRelations = payload.relationships || [];
      cairnRelationEdges = payload.edges || [];
      cairnIdentityProfile = payload.identity_profile || null;
      cairnSelfCore = payload.self_core || null;
      cairnResidentIdentity = payload.resident_identity || null;
      xiaoranUserProfile = payload.user_profile || null;
      cairnAchievements = payload.achievements || null;
      cairnProjectionCount = Number(payload.pending_projection_count || 0);
      renderCairnIdentity();
      renderResidentCard();
      renderRelationMap();
    } catch (_) {
      graph.innerHTML = '<p>暂时无法读取关系网；没有使用示例关系替代。</p>';
    }
  }

  const layeredRecallLabels = {
    self_core: ['身份核心', '始终在场', '常驻'],
    relations: ['关系', '按情境靠近', '关系'],
    recent: ['短期记忆', '最近 72 小时', '短期'],
    long_term: ['长期记忆', '需要时回来', '长期']
  };

  function renderLayeredRecall(payload) {
    const container = document.querySelector('[data-layered-recall]');
    const usage = document.querySelector('[data-layered-recall-usage]');
    if (!container) return;
    const layers = Array.isArray(payload.layers) ? payload.layers : [];
    container.innerHTML = layers.map((layer, index) => {
      const [label, hint, badge] = layeredRecallLabels[layer.name] || [layer.name, '', '记忆'];
      const items = Array.isArray(layer.items) ? layer.items : [];
      const itemPreview = items.length
        ? `<div class="recall-item-preview">${items.map(item => `<details class="recall-preview-row">
            <summary><span>${escapeHtml(item.title || '未命名记忆')}</span><small class="recall-tier-badge">${escapeHtml(badge)}</small></summary>
            <p>${Number(item.source_count || 0) > 0 ? `${Number(item.source_count)} 个来源 · ` : ''}${escapeHtml(layer.condition || '按当前上下文与预算进入。')}</p>
          </details>`).join('')}</div>`
        : '<p class="recall-layer-empty-inline">暂无</p>';
      return `<article class="recall-layer" data-recall-layer="${escapeHtml(layer.name)}" style="--layer-index:${index}">
        <header><span><small>0${index + 1}</small><strong>${escapeHtml(label)}</strong><em>${escapeHtml(hint)}</em></span><b>${Number(layer.used || 0)} / ${Number(layer.budget || 0)} 字</b></header>
        <p class="recall-condition">${escapeHtml(layer.condition || '按当前上下文与预算决定是否进入。')}</p>
        ${itemPreview}
        <footer><span>${Number(layer.item_count || 0)} 条已递入</span><span>正文仅在后端</span></footer>
      </article>`;
    }).join('');
    if (!layers.length) container.innerHTML = '<p class="recall-layer-empty">本次没有形成可展示的召回层。</p>';
    if (usage) usage.textContent = `实际 ${Number(payload.used_chars || 0)} / 总预算 ${Number(payload.total_budget || 0)} 字符`;
  }

  async function loadLayeredRecall() {
    const container = document.querySelector('[data-layered-recall]');
    if (!container) return;
    try {
      const pageQuery = new URLSearchParams(window.location.search).get('recall_query') || '';
      const route = `/api/memory-preview/layered-recall${pageQuery ? `?query=${encodeURIComponent(pageQuery)}` : ''}`;
      const response = await fetch(route, { cache: 'no-store' });
      if (!response.ok) throw new Error(`layered_recall_${response.status}`);
      const payload = await response.json();
      if (payload.persisted !== false || payload.mode !== 'live_read_only_layered_recall') throw new Error('layered_recall_not_read_only');
      renderLayeredRecall(payload);
    } catch (_) {
      container.innerHTML = '<p class="recall-layer-empty">暂时无法读取分层召回；没有使用示例内容代替真实数据。</p>';
    }
  }

  function readAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(cairnProfile.avatar || '');
      if (file.size > 600 * 1024) return reject(new Error('avatar_too_large'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadMemoryFlow() {
    const container = document.querySelector('[data-memory-flow]');
    if (!container) return;
    try {
      const response = await fetch('/api/memory-preview/flow', { cache: 'no-store' });
      if (!response.ok) throw new Error(`memory_flow_${response.status}`);
      const payload = await response.json();
      if (payload.persisted !== false || !Array.isArray(payload.writes) || payload.writes.length) throw new Error('memory_flow_not_read_only');
      container.innerHTML = payload.stages.map(stage => `<article class="memory-flow-stage" data-flow-stage="${escapeHtml(stage.key)}"><i>${escapeHtml(stage.number)}</i><div><header><strong>${escapeHtml(stage.title)}</strong><b>${escapeHtml(stage.status)}</b></header><p>${escapeHtml(stage.summary)}</p><ul>${stage.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></article>`).join('');
    } catch (_) {
      container.innerHTML = '<div class="memory-flow-loading is-error"><i>!</i><span><strong>暂时无法读取流转状态</strong><small>真实记忆仍在原位，没有使用示例结果冒充。</small></span></div>';
    }
  }

  async function loadGovernancePreview() {
    const panel = document.querySelector('[data-governance-preview]');
    const modeSelect = document.querySelector('[data-governance-mode]');
    const onlyMissingInput = document.querySelector('[data-governance-only-missing]');
    if (!panel || !modeSelect || !onlyMissingInput) return;
    const mode = modeSelect.value;
    const onlyMissing = onlyMissingInput.checked;
    panel.innerHTML = '<div class="workbench-loading"><span class="workbench-mark">◇</span><div><h3>正在重新计算</h3><p>真实记忆不会被修改。</p></div></div>';
    try {
      const response = await fetch(`/api/memory-preview/governance?mode=${encodeURIComponent(mode)}&only_missing=${onlyMissing ? '1' : '0'}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`governance_${response.status}`);
      const payload = await response.json();
      const bands = ['短暂', '普通', '稳定', '重要', '核心'];
      const rows = bands.map(band => `<li><span>${band}</span><b>${payload.current_distribution[band]}</b><i>→</i><strong>${payload.suggested_distribution[band]}</strong></li>`).join('');
      const samples = payload.samples.map(item => `<li><span><strong>${escapeHtml(item.title || item.id)}</strong><small>${escapeHtml(item.kind)}${item.requires_review ? ' · 必须审阅' : ''}</small></span><b>${item.current_strength ?? '未定'} → ${item.suggested_strength}</b><button type="button" data-manual-memory="${escapeHtml(item.id)}" data-manual-title="${escapeHtml(item.title || item.id)}" data-manual-current="${item.current_strength ?? item.suggested_strength}">手动调整</button></li>`).join('');
      panel.innerHTML = `<header><span><strong>${payload.count} 条真实记忆</strong><small>旧分布 → 新规则模拟</small></span><b>未写入</b></header><ul class="distribution-list">${rows}</ul><details><summary>查看变化最大的 ${payload.samples.length} 条</summary><ul class="governance-samples">${samples || '<li>当前范围没有记录</li>'}</ul></details><p>身份、关系与显式保护记忆始终只生成建议。</p>`;
    } catch (_) {
      panel.innerHTML = '<div class="workbench-loading"><span class="workbench-mark">!</span><div><h3>暂时无法生成模拟</h3><p>没有使用示例数据替代，真实记忆也没有变化。</p></div></div>';
    }
  }

  function tagClass(record, field) {
    if (field === 'type') return `tag-${record.type}`;
    if (field === 'state') return record.state === 'active' ? 'tag-state' : `tag-${record.state}`;
    if (field === 'weight') return record.weight === 'important' || record.weight === 'core' ? 'tag-weight' : 'tag-normal';
    return 'tag-time';
  }

  function timelineData(record) {
    if (Array.isArray(record.timeline) && record.timeline.length) {
      return record.timeline.map(point => ({
        key: String(point.observed_at || '').slice(0, 10),
        observedAt: String(point.observed_at || ''),
        cards: [{ memoryId: point.memory_id || '', title: point.title || '未命名记忆', content: point.content || '这条节点没有正文。' }]
      }));
    }
    const lines = String(record.body || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
    const fallback = new Date(record.createdAt || record.updatedAt || '');
    const fallbackKey = Number.isNaN(fallback.getTime()) ? '' : fallback.toISOString().slice(0, 10);
    const groups = [];
    let currentKey = fallbackKey;
    for (const line of lines) {
      if (/^【发展时间线】$/.test(line)) continue;
      const match = line.match(/^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[，,、：:\s]*/);
      const key = match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : fallbackKey;
      const text = match ? line.slice(match[0].length).trim() : line;
      if (match) currentKey = key;
      let group = groups.find(item => item.key === (currentKey || key));
      if (!group) { group = { key: currentKey || key, parts: [] }; groups.push(group); }
      if (text) group.parts.push(text);
    }
    return groups.filter(item => item.parts.length).sort((a, b) => a.key.localeCompare(b.key))
      .map(item => ({ key: item.key, cards: [{ title: '', content: item.parts.join('\n') }] }));
  }

  function timelineMarkup(record) {
    const points = timelineData(record);
    const activeIndex = Math.max(0, points.length - 1);
    const nodes = points.map((point, index) => {
      const sameDay = index > 0 && points[index - 1].key === point.key;
      const observed = point.observedAt ? new Date(point.observedAt) : null;
      const timeLabel = observed && !Number.isNaN(observed.getTime())
        ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(observed)
        : '';
      const dateLabel = !point.key ? '未记时'
        : index === 0 ? point.key.replaceAll('-', '.')
          : sameDay && timeLabel ? timeLabel : point.key.slice(5).replace('-', '.');
      const active = index === activeIndex;
      return `<button type="button" class="timeline-node${active ? ' is-current' : ''}" data-timeline-node="${index}" data-timeline-memory-ids="${escapeHtml(point.cards.map(card => card.memoryId).filter(Boolean).join(' '))}" aria-label="${escapeHtml(point.key || '时间未记录')}" aria-pressed="${active}"><i></i><span>${escapeHtml(dateLabel)}</span></button>`;
    }).join('');
    const panels = points.map((point, index) => {
      const observed = point.observedAt ? new Date(point.observedAt) : null;
      const timeLabel = observed && !Number.isNaN(observed.getTime())
        ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(observed)
        : '';
      return `<section class="timeline-entry" data-timeline-entry="${index}"${index === activeIndex ? '' : ' hidden'}><small>${escapeHtml(point.key || '时间未记录')}${timeLabel ? ` · ${escapeHtml(timeLabel)}` : ''}</small><div class="timeline-day-cards">${point.cards.map(card => `<article><strong>${highlightMemorySearch(card.title || '当日记录')}</strong><p>${highlightMemorySearch(card.content)}</p></article>`).join('')}</div></section>`;
    }).join('');
    return `<div class="memory-timeline" data-memory-timeline><header><small>发展时间</small><span>${points.length} 个节点</span></header><div class="timeline-scroller"><div class="timeline-track">${nodes}<button type="button" class="timeline-node is-summary" data-timeline-node="summary" aria-label="整合结论" aria-pressed="false"><i></i><span>整合</span></button></div></div><div class="timeline-entries t-text-swap">${panels}<section class="timeline-entry" data-timeline-entry="summary" hidden><small>整合结论</small><p>${highlightMemorySearch(record.integrationSummary || record.summary)}</p></section></div><small class="timeline-position" data-timeline-position>${activeIndex + 1} / ${points.length}</small></div>`;
  }

  function memoryDetailMarkup(record) {
    if (!record.body) return '';
    const detailId = `memoryDetail-${record.id}`;
    const guardedCleanup = record.protected === true || record.strengthLocked === true
      || record.type === 'relationship' || Number(record.identityWeight || 0) >= .8;
    return `
      <div class="memory-paper-detail t-acc-panel" id="${detailId}">
        <div class="t-acc-panel-inner memory-paper-detail-inner">
          ${timelineData(record).length > 1 ? timelineMarkup(record) : record.reflection ? `<div class="memory-reflection-live" data-memory-reflection-live aria-pressed="false">
            <div class="memory-reflection-live-inner">
              <section class="memory-reflection-live-face memory-reflection-live-front">
                <header><small>记忆正文</small><button type="button" data-memory-reflection-flip>翻面 <i aria-hidden="true">↻</i></button></header>
                <p>${highlightMemorySearch(record.body)}</p>
              </section>
              <section class="memory-reflection-live-face memory-reflection-live-back">
                <header><small>CAIRN · REFLECTION</small><button type="button" data-memory-reflection-flip>返回 <i aria-hidden="true">↻</i></button></header>
                <h4>这件事后来在我身上变成了什么</h4>
                <span class="reflection-note"><b>感受</b><span>${escapeHtml(record.reflection.feeling)}</span></span>
                <span class="reflection-note"><b>想法</b><span>${escapeHtml(record.reflection.thought)}</span></span>
                <span class="reflection-note is-experience"><b>经验 · ${record.reflection.status === 'provisional' ? '待验证' : '已确认'}</b><span>${escapeHtml(record.reflection.experience)}</span></span>
              </section>
            </div>
          </div>` : `<div class="memory-facet-stage"><div class="memory-facet is-active"><small>记忆正文</small><p>${highlightMemorySearch(record.body)}</p></div></div>`}
          <div class="memory-card-actions">
            <div class="memory-work-entries">
              <button class="add-to-workbench" type="button" data-add-to-workbench aria-pressed="false"><span><strong>加入工作台</strong><small>与其他记忆一起整理</small></span><i aria-hidden="true">＋</i></button>
              ${backendRevisionAvailable ? '<button class="backend-revision-trigger" type="button" data-backend-revision><span><strong>交给小机修订</strong><small>后台整理记忆或归入主页资料</small></span><i aria-hidden="true">↗</i></button>' : ''}
            </div>
            <button class="inline-clean-trigger" type="button" data-inline-clean-toggle data-guarded-cleanup="${guardedCleanup}" aria-expanded="false"><span><strong>清理这条记忆</strong><small>${guardedCleanup ? '重要内容会再请你确认一次' : '直接移入可恢复回收区'}</small></span><i aria-hidden="true">回收</i></button>
          </div>
          ${record.reflection ? `<footer class="memory-reflection-date"><time datetime="${escapeHtml(record.updatedAt || '')}">${escapeHtml(record.timeLabel)}</time></footer>` : ''}
          <section class="inline-clean-panel" data-inline-clean-panel hidden>
            <p>这是关系、身份、锁定或受保护记忆。确认后只进入可恢复回收区，不会永久删除。</p>
            <button type="button" data-inline-clean-confirm>确认移入回收区</button>
            <div data-inline-clean-result><p>尚未写入。</p></div>
          </section>
        </div>
      </div>`;
  }

  function createMemoryPaper(record) {
    const article = document.createElement('article');
    const expandable = Boolean(record.body);
    article.className = `memory-paper ${expandable ? 't-acc' : 'memory-paper-compact'}${record.state === 'review' ? ' is-review' : ''}${record.state === 'quiet' ? ' is-quiet' : ''}`;
    if (expandable) {
      article.dataset.memoryPaper = '';
      article.dataset.open = 'false';
    }
    Object.assign(article.dataset, {
      memoryItem: '', memoryId: record.id, memoryType: record.type, memoryTime: record.time,
      memoryWeight: record.partitionWeightBand || 'unset', memoryPartitionWeight: record.partitionWeight ?? '', memoryImportance: record.importance, memoryState: record.state, memorySource: record.source,
      memoryRecent: record.recent, memoryCreatedAt: record.createdAt || '', memoryUpdatedAt: record.updatedAt || '',
      memorySearch: [record.typeLabel, record.partitionLabel, record.startLabel || record.timeLabel, record.partitionWeightLabel || '—', ...(record.previewKeywords || []), record.title, record.body].join(' ')
    });
    const detailId = `memoryDetail-${record.id}`;
    const previewKeywords = record.previewKeywords || record.tags || [];
    const partitionLabel = record.partitionLabel || '未分区';
    const partitionWeightLabel = record.partitionWeightLabel || '—';
    const partitionDisplays = record.partitionDisplays?.length
      ? record.partitionDisplays
      : [{ label: partitionLabel, weight: partitionWeightLabel }];
    const partitionMarkup = partitionDisplays.map(item => `<small class="memory-paper-fact is-partition"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.weight)}</b></small>`).join('');
    const startLabel = record.startLabel || record.timeLabel || '未记时';
    const visibleKeywordCount = 5;
    const hiddenKeywordCount = Math.max(0, previewKeywords.length - visibleKeywordCount);
    const keywordMarkup = previewKeywords.length
      ? `<span class="memory-paper-keywords" aria-label="关键词与固有标签">${previewKeywords.map((keyword, index) => `<small${index >= visibleKeywordCount ? ' class="memory-keyword-expanded"' : ''}>${highlightMemorySearch(keyword)}</small>`).join('')}${hiddenKeywordCount ? `<small class="memory-keyword-more">＋${hiddenKeywordCount}</small>` : ''}</span>`
      : '<span class="memory-paper-keywords is-empty"><small>暂无标签</small></span>';
    article.innerHTML = `
      <button class="memory-paper-summary${expandable ? ' t-acc-head' : ''}" type="button"${expandable ? ` aria-expanded="false" aria-controls="${detailId}"` : ''}>
        <span class="memory-paper-copy">
          <span class="memory-paper-meta" aria-label="${escapeHtml(`${record.typeLabel}记忆，起始于${startLabel}，${partitionLabel}分区权重${partitionWeightLabel}`)}">
            <span class="memory-paper-kind">${record.integrationRole === 'master' ? '<small class="tag tag-type">整合</small>' : ''}<small class="tag ${tagClass(record, 'type')}">${escapeHtml(record.typeLabel)}</small></span>
            <time class="memory-paper-date" datetime="${escapeHtml(record.createdAt || '')}">${escapeHtml(startLabel)}</time>
          </span>
          <strong>${highlightMemorySearch(record.title)}</strong>
          <span class="memory-paper-facts"><span class="memory-paper-partitions">${partitionMarkup}</span></span>
          ${keywordMarkup}
        </span>
      </button>${memoryDetailMarkup(record)}`;
    return article;
  }

  function renderMemoryRecords() {
    memoryItems = memoryRecords.map(createMemoryPaper);
  }

  function memorySearchTerms() {
    return [...new Set((librarySearch?.value || '').trim().match(/[\p{L}\p{N}_-]+/gu) || [])]
      .sort((left, right) => right.length - left.length);
  }

  function highlightMemorySearch(value) {
    const raw = String(value || '');
    const terms = memorySearchTerms();
    if (!terms.length) return escapeHtml(raw);
    const lower = raw.toLocaleLowerCase('zh-CN');
    const spans = [];
    for (const term of terms) {
      const needle = term.toLocaleLowerCase('zh-CN');
      let offset = 0;
      while (needle && offset < lower.length) {
        const start = lower.indexOf(needle, offset);
        if (start < 0) break;
        const end = start + needle.length;
        if (!spans.some(span => start < span.end && end > span.start)) spans.push({ start, end });
        offset = end;
      }
    }
    if (!spans.length) return escapeHtml(raw);
    spans.sort((left, right) => left.start - right.start);
    let cursor = 0;
    let html = '';
    for (const span of spans) {
      html += escapeHtml(raw.slice(cursor, span.start));
      html += `<mark class="candidate-keyword-hit is-exact">${escapeHtml(raw.slice(span.start, span.end))}</mark>`;
      cursor = span.end;
    }
    return `${html}${escapeHtml(raw.slice(cursor))}`;
  }

  function memoryMatchedTerms(record) {
    const haystack = [record.title, record.summary, record.body, ...(record.tags || [])]
      .join('\n').toLocaleLowerCase('zh-CN');
    return memorySearchTerms().filter(term => haystack.includes(term.toLocaleLowerCase('zh-CN')));
  }

  function refreshMemorySearch() {
    renderMemoryRecords();
    renderMemoryGroups();
    wireMemoryPapers();
  }

  function datePresentation(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { time: 'earlier', label: '更早', recordedAt: '时间未记录' };
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((startToday - startDate) / 86400000);
    const time = days <= 0 ? 'today' : days === 1 ? 'yesterday' : 'earlier';
    const dateLabel = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-');
    const clockLabel = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { time, label: dateLabel, recordedAt: `${dateLabel} ${clockLabel}` };
  }

  function isTimeKeyword(value) {
    const keyword = String(value || '').trim();
    return /^(?:20\d{2}(?:[-/.年]\d{1,2})?(?:[-/.月]\d{1,2}日?)?|\d{1,2}(?:月\d{1,2}日|[-/.]\d{1,2})|今天|今日|昨天|昨日|前天|本周|上周|本月|上月|近期|最近|清晨|早晨|上午|中午|下午|傍晚|晚上|深夜)$/.test(keyword);
  }

  function mergedPreviewKeywords(memory) {
    const structured = memory.structured_keywords || {};
    return [...new Set([
      ...(structured.subjects || []), ...(structured.entities || []),
      ...(structured.actions || []), ...(structured.states || []),
      ...(memory.tags || [])
    ].map(value => String(value || '').trim()).filter(value => value && !isTimeKeyword(value)))];
  }

  function memoryStartValue(memory) {
    const timelineDates = (Array.isArray(memory.timeline) ? memory.timeline : [])
      .map(point => point?.occurred_at || point?.date || point?.at)
      .filter(Boolean);
    const candidates = [memory.occurred_at, ...timelineDates]
      .map(value => ({ value, time: Date.parse(value) }))
      .filter(item => Number.isFinite(item.time))
      .sort((left, right) => left.time - right.time);
    return candidates[0]?.value || memory.created_at || memory.updated_at;
  }

  function adaptPreviewMemory(memory) {
    const kindLabels = { event: '事件', decision: '决定', preference: '偏好', project: '项目', reflection: '反思', relationship: '关系' };
    const type = kindLabels[memory.kind] ? memory.kind : 'system';
    const startValue = memoryStartValue(memory);
    const time = datePresentation(startValue);
    const modified = datePresentation(memory.updated_at || memory.created_at);
    const importance = Number(memory.importance) || 0;
    const weight = importance >= .85 ? 'core' : importance >= .65 ? 'important' : 'normal';
    const weightLabel = weight === 'core' ? '核心' : weight === 'important' ? '重要' : '普通';
    const state = memory.state === 'active' ? 'active' : 'quiet';
    const stateLabel = state === 'active' ? '当前有效' : '安静';
    const rawBody = String(memory.preview || '').trim();
    const body = rawBody.replace(/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?[，,、：:\s]*/, '') || '这条记忆没有可展示的预览正文。';
    const summary = body.length > 54 ? `${body.slice(0, 54)}…` : body;
    const versionCount = Math.max(1, Number(memory.version_count) || 1);
    const serviceAreaSuggestion = memory.service_area_suggestion || {};
    const suggestedAreas = Array.isArray(serviceAreaSuggestion.areas) ? serviceAreaSuggestion.areas : [];
    const fallbackAreas = serviceAreaSuggestion.confirmed === true || !Array.isArray(serviceAreaSuggestion.fallback)
      ? []
      : serviceAreaSuggestion.fallback;
    const rankedPartitionAreas = [...suggestedAreas, ...fallbackAreas]
      .map(area => ({ ...area, weight: Number(area.weight) }))
      .filter(area => Number.isFinite(area.weight))
      .sort((left, right) => right.weight - left.weight);
    const partitionAreas = [...rankedPartitionAreas.reduce((areas, area) => {
      const existing = areas.get(area.area);
      if (!existing || area.weight > existing.weight) areas.set(area.area, area);
      return areas;
    }, new Map()).values()].sort((left, right) => right.weight - left.weight);
    const primaryPartition = partitionAreas[0] || null;
    const partitionWeight = primaryPartition?.weight ?? null;
    const partitionLabel = primaryPartition?.label || ({ life: '生活', relations: '关系', action: '行动', self: '自我', interest: '兴趣', study: '学习' })[primaryPartition?.area] || '未分区';
    const partitionWeightLabel = partitionWeight === null ? '—' : partitionWeight.toFixed(2);
    const previewKeywords = mergedPreviewKeywords(memory);
    return {
      id: memory.id, type, typeLabel: kindLabels[type] || '系统', time: time.time, recent: modified.time, timeLabel: time.label, startLabel: time.label, createdAt: startValue, updatedAt: memory.updated_at || memory.created_at,
      weight, weightLabel, importance, priority: memory.priority, identityWeight: memory.identity_weight,
      partitionWeight, partitionLabel, partitionWeightLabel,
      partitionDisplays: partitionAreas.map(area => ({ label: area.label || ({ life: '生活', relations: '关系', action: '行动', self: '自我', interest: '兴趣', study: '学习' })[area.area] || area.area, weight: area.weight.toFixed(2) })),
      partitionWeightBand: partitionWeight === null ? 'unset' : partitionWeight >= .75 ? 'high' : partitionWeight >= .45 ? 'medium' : 'low', previewKeywords,
      protected: memory.protected === true, strengthLocked: memory.moraine_governance?.strength_locked === true,
      state, stateLabel, source: memory.source || 'Cairn memory', title: memory.title || summary,
      summary, recordedAt: time.recordedAt, modifiedAt: modified.recordedAt, versionCount,
      integrationRole: memory.memory_integration?.role || 'standalone',
      integrationNodeCount: Number(memory.memory_integration?.node_count || 0),
      timeline: Array.isArray(memory.timeline) ? memory.timeline : null,
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      structuredKeywords: memory.structured_keywords || { entities: [], actions: [], states: [], dates: [] },
      serviceAreaSuggestion: memory.service_area_suggestion || { areas: [] },
      serviceAreaAssignment: memory.service_area_assignment || null,
      related: Array.isArray(memory.tags) && memory.tags.length ? memory.tags.join(' · ') : '暂无标签',
      body, then: '这条只读预览没有单独记录“当时”切面。', thenEvidence: '缺失字段保持明确空白，不根据正文猜测情绪。',
      after: '这条只读预览没有单独记录“后来”切面。', afterEvidence: '后续数据接入前不自动补写结果。',
      reflection: null,
      history: [[time.recordedAt, '当前只读版本', `记忆服务记录了 ${versionCount} 个版本；预览层不返回旧正文。`]]
    };
  }

  function placeWrittenMemoryInLibrary(memory, { open = true } = {}) {
    if (!memory?.id) return null;
    const record = adaptPreviewMemory(memory);
    record.body = String(memory.content || memory.preview || record.body || '').trim();
    memoryRecords = [record, ...memoryRecords.filter(item => item.id !== record.id)];
    recordById = new Map(memoryRecords.map(item => [item.id, item]));
    memoryDataMode = 'real';
    renderMemoryRecords();
    renderMemoryGroups();
    wireMemoryPapers();
    populateRealReviewChoices();
    renderKeywordSuggestions();
    if (!open) return record.id;
    showView('library');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const paper = document.querySelector(`[data-memory-id="${CSS.escape(record.id)}"]`);
      const summary = paper?.querySelector('.memory-paper-summary');
      if (summary?.getAttribute('aria-expanded') === 'false') summary.click();
      paper?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
    return record.id;
  }

  function showBackendRevisionSync(memory) {
    document.querySelector('[data-backend-revision-toast]')?.remove();
    const toast = document.createElement('aside');
    toast.className = 'cleanup-undo-toast backend-revision-toast';
    toast.dataset.backendRevisionToast = '';
    toast.innerHTML = `<span><strong>小机已完成修订</strong><small>${escapeHtml(memory.title || '记忆内容已同步')}</small></span><button type="button">查看</button>`;
    document.body.append(toast);
    const timer = window.setTimeout(() => toast.remove(), 9000);
    toast.querySelector('button').addEventListener('click', () => {
      window.clearTimeout(timer);
      toast.remove();
      showView('library');
      document.querySelector(`[data-memory-id="${CSS.escape(memory.id)}"]`)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center'
      });
    });
  }

  async function refreshRevisedMemory(memoryId) {
    const response = await fetch(`/api/memory-preview/memories/${encodeURIComponent(memoryId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`revision_memory_${response.status}`);
    const memory = await response.json();
    const previous = recordById.get(memoryId);
    const record = adaptPreviewMemory(memory);
    record.body = String(memory.content || memory.preview || '').trim();
    record.reflection = previous?.reflection || null;
    const index = memoryRecords.findIndex(item => item.id === memoryId);
    if (index >= 0) memoryRecords.splice(index, 1, record);
    else memoryRecords.unshift(record);
    recordById.set(memoryId, record);
    const currentPaper = document.querySelector(`[data-memory-paper][data-memory-id="${CSS.escape(memoryId)}"]`);
    if (currentPaper) {
      const wasOpen = currentPaper.dataset.open === 'true';
      const replacement = createMemoryPaper(record);
      replacement.dataset.fullLoaded = 'true';
      currentPaper.replaceWith(replacement);
      wireMemoryPapers();
      updateWorkbenchSelection();
      if (wasOpen) replacement.querySelector('.memory-paper-summary')?.click();
      refreshMemorySearch();
    } else {
      renderMemoryRecords();
      renderMemoryGroups();
      wireMemoryPapers();
    }
    showBackendRevisionSync(memory);
  }

  const revisionStrategyLabels = {
    content_compression: '内容压缩', current_state_extraction: '当前态提炼', timeline_restructure: '时间线重构',
    topic_split: '主题拆分', duplicate_integration: '重复整合', recall_summary: '召回摘要', smart_assessment: '智能研判'
  };
  const revisionDestinationLabels = {
    user_profile: '用户画像', self_core: 'Self Core', relation: '关系网'
  };

  function renderStructureRevisionQueue(requests = []) {
    const container = document.querySelector('[data-structure-revision-queue]');
    const count = document.querySelector('[data-structure-queue-count]');
    if (!container || !count) return;
    const pending = requests.filter(item => item.status === 'pending' || item.status === 'processing').length;
    count.textContent = pending ? `${pending} 条待处理` : '当前已清空';
    const visible = requests.slice().sort((left, right) => Date.parse(right.updated_at || right.created_at || '') - Date.parse(left.updated_at || left.created_at || '')).slice(0, 8);
    if (!visible.length) {
      container.innerHTML = '<div class="structure-queue-empty"><span>✓</span><strong>目前没有结构修订任务</strong><small>从任意记忆详情的“后端修订”入口添加。</small></div>';
      return;
    }
    container.innerHTML = visible.map(item => {
      const state = item.status === 'completed' ? '已完成' : item.status === 'processing' ? '处理中' : item.status === 'failed' ? '需要处理' : '等待小机';
      const strategies = (item.strategies || []).map(value => revisionStrategyLabels[value] || value);
      const destinations = (item.destinations || []).map(value => revisionDestinationLabels[value] || value);
      const routeSummary = [...strategies, ...destinations.map(value => `归入${value}`),
        ...(item.archive_source_after_completion ? ['完成后归档来源'] : [])].join(' · ') || '按备注判断';
      const resultId = item.result_memory_id || item.memory_id;
      return `<article class="structure-queue-item" data-state="${escapeHtml(item.status || 'pending')}"><header><span><small>${escapeHtml(state)}</small><strong>${escapeHtml(item.memory_title || '未命名记忆')}</strong></span><time>${escapeHtml(shortDate(item.updated_at || item.created_at))}</time></header><p>${escapeHtml(routeSummary)}</p>${item.note ? `<blockquote>${escapeHtml(item.note)}</blockquote>` : ''}<footer><span>${item.rollback_id ? '已保留回退记录' : '原版本与资料来源会继续保留'}</span><button type="button" data-structure-view-memory="${escapeHtml(resultId)}">查看记忆</button></footer></article>`;
    }).join('');
    container.querySelectorAll('[data-structure-view-memory]').forEach(button => button.addEventListener('click', () => {
      showView('library');
      const paper = document.querySelector(`[data-memory-id="${CSS.escape(button.dataset.structureViewMemory)}"]`);
      paper?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    }));
  }

  async function loadStructureRevisionQueue() {
    const container = document.querySelector('[data-structure-revision-queue]');
    if (!container || !backendRevisionAvailable) return;
    try {
      const response = await fetch('/api/memory-preview/backend-revisions', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`revision_queue_${response.status}`);
      const payload = await response.json();
      renderStructureRevisionQueue(payload.requests || []);
    } catch (_) {
      if (container) container.innerHTML = '<div class="structure-queue-empty"><span>!</span><strong>暂时读不到修订队列</strong><small>真实记忆和已有任务没有变化。</small></div>';
    }
  }

  async function syncBackendRevisionStatus({ initial = false } = {}) {
    if (!backendRevisionAvailable || document.visibilityState === 'hidden' || backendRevisionSyncing) return;
    backendRevisionSyncing = true;
    try {
      const response = await fetch('/api/memory-preview/backend-revisions', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`revision_sync_${response.status}`);
      const payload = await response.json();
      renderStructureRevisionQueue(payload.requests || []);
      for (const request of payload.requests || []) {
        const previous = backendRevisionStates.get(request.id);
        backendRevisionStates.set(request.id, request.status);
        if (!initial && previous && previous !== 'completed' && request.status === 'completed' && request.result_memory_id) {
          await refreshRevisedMemory(request.result_memory_id);
        }
      }
    } catch (error) {
      console.warn('Backend revision sync is temporarily unavailable.', error);
    } finally {
      backendRevisionSyncing = false;
    }
  }

  function startBackendRevisionSync() {
    if (!backendRevisionAvailable) return;
    window.clearInterval(backendRevisionSyncTimer);
    syncBackendRevisionStatus({ initial: true });
    backendRevisionSyncTimer = window.setInterval(() => syncBackendRevisionStatus(), 8000);
  }

  function updateMemoryLoadState() {
    const loader = document.querySelector('[data-memory-load-more]');
    const status = loader?.querySelector('[data-memory-load-status]');
    const button = loader?.querySelector('[data-load-more-memories]');
    const loaded = memoryRecords.length;
    const total = Math.max(memoryActiveTotal, loaded);
    memoryFullyLoaded = memoryPaginationExhausted || (total > 0 && loaded >= total);
    if (!loader || !status || !button) return;
    loader.hidden = memoryDataMode !== 'real' || memoryFullyLoaded;
    loader.dataset.loading = String(memoryPageLoading);
    status.textContent = memoryPageLoading
      ? `正在读取下一批 · 已加载 ${loaded} / ${total}`
      : `已加载 ${loaded} / ${total} 条有效记忆`;
    button.textContent = memoryPageLoading ? '正在加载…' : '继续加载';
    button.disabled = memoryPageLoading;
  }

  function setupMemoryAutoLoad() {
    const loader = document.querySelector('[data-memory-load-more]');
    if (!loader || memoryLoadObserver) return;
    memoryLoadObserver = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) loadNextMemoryPage();
    }, { root: document.querySelector('#library'), rootMargin: '0px 0px 320px', threshold: 0.01 });
    memoryLoadObserver.observe(loader);
  }

  function continueMemoryAutoLoadIfVisible() {
    const loader = document.querySelector('[data-memory-load-more]');
    const page = document.querySelector('#library');
    if (!loader || !page || loader.hidden || memoryFullyLoaded || memoryPageLoading) return;
    const loaderRect = loader.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    if (loaderRect.top <= pageRect.bottom + 320 && loaderRect.bottom >= pageRect.top - 32) {
      window.setTimeout(() => loadNextMemoryPage(), 80);
    }
  }

  async function fetchMemoryPage(page, direction = activeMemoryDirection) {
    const params = new URLSearchParams({
      page: String(page), limit: String(memoryPageSize), state: 'active',
      sort: activeMemoryView === 'recent' ? 'updated' : 'event',
      order: direction === 'asc' ? 'asc' : 'desc'
    });
    const response = await fetch(`/api/memory-preview/library?${params}`, {
      headers: { Accept: 'application/json' }, cache: 'no-store'
    });
    if (!response.ok) throw new Error(`preview_${response.status}`);
    return response.json();
  }

  async function loadNextMemoryPage() {
    if (memoryPageLoading || memoryFullyLoaded || memoryDataMode !== 'real') return false;
    const generation = memoryLoadGeneration;
    const direction = activeMemoryDirection;
    memoryPageLoading = true;
    updateMemoryLoadState();
    try {
      const payload = await fetchMemoryPage(memoryNextPage, direction);
      if (generation !== memoryLoadGeneration || direction !== activeMemoryDirection) return false;
      const incoming = Array.isArray(payload.memories) ? payload.memories : [];
      const known = new Set(memoryRecords.map(record => record.id));
      const appended = incoming.map(adaptPreviewMemory)
        .filter(record => !known.has(record.id))
        .map(record => ({ ...record, reflection: memoryReflections.get(record.id) || null }));
      memoryRecords.push(...appended);
      memoryActiveTotal = Math.max(Number(payload.total) || 0, memoryRecords.length);
      memoryNextPage += 1;
      memoryPaginationExhausted = incoming.length < memoryPageSize;
      memoryFullyLoaded = memoryPaginationExhausted || memoryRecords.length >= memoryActiveTotal;
      recordById = new Map(memoryRecords.map(record => [record.id, record]));
      renderMemoryRecords();
      renderMemoryGroups();
      wireMemoryPapers();
      populateRealReviewChoices();
      renderKeywordSuggestions();
      return appended.length > 0;
    } catch (error) {
      const status = document.querySelector('[data-memory-load-status]');
      if (status) status.textContent = `续载暂时失败 · 已保留 ${memoryRecords.length} 条，可点按钮重试`;
      return false;
    } finally {
      if (generation !== memoryLoadGeneration) return;
      memoryPageLoading = false;
      updateMemoryLoadState();
      continueMemoryAutoLoadIfVisible();
    }
  }

  async function loadReadOnlyMemories() {
    const generation = ++memoryLoadGeneration;
    const direction = activeMemoryDirection;
    memoryPageLoading = true;
    memoryPaginationExhausted = false;
    memoryFullyLoaded = false;
    updateMemoryLoadState();
    try {
      const [libraryResult, reflectionResult] = await Promise.allSettled([
        fetchMemoryPage(1, direction),
        fetch('/api/memory-preview/reflections', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      ]);
      if (generation !== memoryLoadGeneration || direction !== activeMemoryDirection) return false;
      if (libraryResult.status !== 'fulfilled') throw libraryResult.reason;
      const payload = libraryResult.value;
      const reflectionResponse = reflectionResult.status === 'fulfilled' ? reflectionResult.value : null;
      const reflectionPayload = reflectionResponse?.ok ? await reflectionResponse.json() : { reflections: [] };
      memoryReflections = new Map((reflectionPayload.reflections || []).map(item => [item.memory_id, item]));
      if (!Array.isArray(payload.memories) || payload.memories.length === 0) throw new Error('preview_empty');
      memoryRecords = payload.memories.map(adaptPreviewMemory).map(record => ({ ...record, reflection: memoryReflections.get(record.id) || null }));
      memoryActiveTotal = Math.max(Number(payload.total) || 0, memoryRecords.length);
      memoryNextPage = 2;
      memoryPaginationExhausted = payload.memories.length < memoryPageSize;
      memoryFullyLoaded = memoryPaginationExhausted || memoryRecords.length >= memoryActiveTotal;
      recordById = new Map(memoryRecords.map((record) => [record.id, record]));
      memoryDataMode = 'real';
      renderMemoryRecords();
      renderMemoryGroups();
      wireMemoryPapers();
      populateRealReviewChoices();
      renderKeywordSuggestions();
      setupMemoryAutoLoad();
      updateMemoryLoadState();
      return true;
    } catch (_) {
      memoryDataMode = 'unavailable';
      if (!memoryRecords.length) {
        memoryRecords = [];
        recordById = new Map();
        renderMemoryRecords();
        renderMemoryGroups();
        visibleMemoryCount.textContent = '真实记忆暂时无法读取';
      } else {
        // A transient refresh failure must not leave the list empty after
        // another render cleared its DOM. Reattach the last known-good data.
        renderMemoryRecords();
        renderMemoryGroups();
        wireMemoryPapers();
        visibleMemoryCount.textContent = `${memoryRecords.length} 条已保留显示 · 刷新暂时失败`;
      }
      return false;
    } finally {
      if (generation === memoryLoadGeneration) {
        memoryPageLoading = false;
        updateMemoryLoadState();
      }
    }
  }

  function populateRealReviewChoices() {
    const select = document.querySelector('[data-real-weight-memory]');
    if (select) {
      select.innerHTML = memoryRecords.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.title)}</option>`).join('');
      if (memoryRecords[0]) populateManualStrength(memoryRecords[0]);
    }
    const revisionSelect = document.querySelector('[data-revision-memory]');
    if (revisionSelect) revisionSelect.innerHTML = `<option value="">请选择</option>${memoryRecords
      .filter(record => record.state === 'active')
      .map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.title)}</option>`).join('')}`;
    const workbenchWeightSelect = document.querySelector('[data-workbench-weight-memory]');
    if (workbenchWeightSelect) workbenchWeightSelect.innerHTML = `<option value="">请选择</option>${memoryRecords
      .filter(record => record.state === 'active')
      .map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.title)}</option>`).join('')}`;
    populateRealClusterMembers(activeCluster);
  }

  function actionConfirmationMarkup(payload, label = '确认并执行') {
    return `<article class="cleanup-candidate"><small>真实预览 · 尚未写入</small><strong>${escapeHtml(payload.result_preview?.title || payload.action)}</strong><p>${escapeHtml(payload.result_preview?.content || `将影响 ${payload.writes?.length || 0} 条记忆`)}</p><label>确认码 <b>${escapeHtml(payload.confirmation_code)}</b><input data-action-confirm-code maxlength="6" inputmode="numeric"></label><button type="button" data-confirm-action>${escapeHtml(label)}</button><p data-action-status>关闭或刷新会放弃草稿。</p></article>`;
  }

  function wireActionConfirmation(container, payload, afterExecute) {
    container.innerHTML = actionConfirmationMarkup(payload);
    container.querySelector('[data-confirm-action]').addEventListener('click', async event => {
      const status = container.querySelector('[data-action-status]');
      if (container.querySelector('[data-action-confirm-code]').value.trim() !== payload.confirmation_code) {
        status.textContent = '确认码不匹配，没有写入。'; return;
      }
      event.currentTarget.disabled = true;
      status.textContent = '正在写入并建立48小时回退点……';
      try {
        const executed = await realActionRequest('execute', { draft_id: payload.draft_id, confirmation_code: payload.confirmation_code });
        status.textContent = `已生效；回退可用至 ${new Date(executed.rollback.available_until).toLocaleString('zh-CN')}。`;
        if (afterExecute) await afterExecute(executed);
        await refreshAfterMemoryChange();
      } catch (error) { status.textContent = `没有执行：${error.message}`; event.currentTarget.disabled = false; }
    });
  }

  async function executePreparedAction(preview) {
    return realActionRequest('execute', { draft_id: preview.draft_id, confirmation_code: preview.confirmation_code });
  }

  function showCleanupUndo(memoryId, title) {
    document.querySelector('[data-cleanup-undo-toast]')?.remove();
    const toast = document.createElement('aside');
    toast.className = 'cleanup-undo-toast';
    toast.dataset.cleanupUndoToast = '';
    toast.innerHTML = `<span><strong>已移入回收区</strong><small>${escapeHtml(title)} · 正文与历史仍保留</small></span><button type="button">撤销</button>`;
    document.body.append(toast);
    const timer = window.setTimeout(() => toast.remove(), 12000);
    toast.querySelector('button').addEventListener('click', async event => {
      window.clearTimeout(timer);
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = '恢复中…';
      try {
        const preview = await realActionRequest('preview', { action: 'restore_archive', memory_id: memoryId,
          actor: 'xiaoran', reason: '撤销刚才的卡片快速清理', signatures: { xiaoran: 'approve', cairn: 'approve' } });
        await executePreparedAction(preview);
        toast.remove();
        await refreshAfterMemoryChange();
      } catch (error) {
        event.currentTarget.disabled = false;
        event.currentTarget.textContent = '重试撤销';
        toast.querySelector('small').textContent = `撤销失败：${error.message}`;
      }
    });
  }

  async function quickArchiveMemory(paper, result) {
    const record = recordById.get(paper.dataset.memoryId);
    if (!record) return;
    if (result) result.innerHTML = '<p>正在移入可恢复回收区……</p>';
    let executed = false;
    try {
      const preview = await realActionRequest('preview', { action: 'archive', memory_id: record.id,
        actor: 'xiaoran', reason: '从记忆卡片快速清理至可恢复回收区',
        signatures: { xiaoran: 'approve', cairn: 'approve' } });
      await executePreparedAction(preview);
      executed = true;
      paper.remove();
      showCleanupUndo(record.id, record.title);
    } catch (error) {
      if (result) result.innerHTML = `<p>没有清理：${escapeHtml(error.message)}</p>`;
      else window.alert(`没有清理：${error.message}`);
      return;
    }
    if (executed) await refreshAfterMemoryChange();
  }

  function populateManualStrength(memory) {
    const input = document.querySelector('[data-real-strength]');
    const value = Math.min(79, Math.round(Number(memory.importance || 0) * 100));
    input.value = value;
    document.querySelector('[data-real-strength-value]').textContent = value;
  }

  function populateRealClusterMembers(cluster) {
    const container = document.querySelector('[data-real-cluster-members]');
    if (!container) return;
    const switcher = document.querySelector('[data-real-cluster-switcher]');
    if (!cluster) {
      if (switcher) {
        switcher.hidden = clusterOffset <= 0;
        switcher.querySelector('[data-real-cluster-position]').textContent = '已经到候选末尾';
        switcher.querySelector('[data-real-cluster-previous]').disabled = clusterOffset <= 0;
        switcher.querySelector('[data-real-cluster-next]').disabled = true;
        switcher.querySelector('[data-real-cluster-defer]').disabled = true;
      }
      container.innerHTML = '<p>已经看完当前候选；可以点“上一簇”回去，不会被困在这里。</p>';
      return;
    }
    if (switcher) {
      const position = cluster.selection?.offset ?? clusterOffset;
      switcher.hidden = false;
      switcher.querySelector('[data-real-cluster-position]').textContent = `可整合候选 ${cluster.selection?.remaining_memory_count || cluster.selection?.candidate_count || '?'}${overviewCounts ? ` / 当前有效 ${overviewCounts.effective}` : ''}`;
      switcher.querySelector('[data-real-cluster-previous]').disabled = !clusterHistory.length;
      switcher.querySelector('[data-real-cluster-next]').disabled = !cluster.selection?.has_next;
      switcher.querySelector('[data-real-cluster-defer]').disabled = false;
    }
    const members = [cluster.source, ...cluster.neighbors.filter(memory => !dismissedCandidatePairs.has(pairKey(cluster.source.id, memory.id)))];
    container.innerHTML = members.map((memory, index) => {
      const protectedSource = memory.protected === true || memory.memory_lifecycle?.protected === true
        || memory.memory_decay?.policy === 'protected' || Number(memory.identity_weight || 0) >= .8;
      const suggestedMerge = index === 0 || memory.assessment === 'possible_duplicate' || memory.assessment === 'manually_selected';
      const boundaryLabel = index === 0 ? '承载记忆'
        : memory.assessment === 'possible_duplicate' ? '疑似重复 · 可送审合并'
          : memory.assessment === 'possible_update_or_conflict' ? '阶段更新或冲突 · 应单独处理'
            : memory.assessment === 'protected_review_only' ? '受保护关联 · 只建立引用'
              : '仅语义相关 · 保持独立';
      return `<article class="thread-point" data-cluster-member="${escapeHtml(memory.id)}" data-protected-source="${protectedSource}" data-merge-boundary="${escapeHtml(memory.assessment || 'related_only')}" data-boundary-label="${escapeHtml(boundaryLabel)}"><input type="checkbox" value="${escapeHtml(memory.id)}" checked><span><strong>${escapeHtml(memory.title)}</strong><p>${escapeHtml(memory.preview || '暂无预览')}</p><small>${escapeHtml(boundaryLabel)}${index === 0 ? '' : ` · 相似度 ${Number(memory.similarity || 0).toFixed(2)}`}</small><div class="cluster-member-controls"><button type="button" data-make-master ${protectedSource ? 'disabled title="受保护记忆只能作为引用参与整合"' : ''}>${protectedSource ? '保护性引用' : suggestedMerge ? '设为承载入口' : '人工改判为承载入口'}</button><button type="button" data-move-up ${index === 0 ? 'disabled' : ''}>上移</button><button type="button" data-move-down ${index === members.length - 1 ? 'disabled' : ''}>下移</button><button type="button" data-remove-candidate ${index === 0 ? 'disabled' : ''}>移出候选</button></div></span></article>`;
    }).join('');
    const syncMembers = () => {
      let rows = [...container.querySelectorAll('[data-cluster-member]')];
      if (rows[0]?.dataset.protectedSource === 'true') {
        const writable = rows.find(row => row.dataset.protectedSource !== 'true');
        if (writable) {
          container.prepend(writable);
          rows = [...container.querySelectorAll('[data-cluster-member]')];
        }
      }
      rows.forEach((row, index) => {
        const protectedSource = row.dataset.protectedSource === 'true';
        row.querySelector('small').textContent = protectedSource ? '保护性引用 · 原记忆保持独立'
          : index === 0 ? '承载记忆' : row.dataset.boundaryLabel || '候选成员';
        row.querySelector('[data-move-up]').disabled = index === 0 || (index === 1 && protectedSource);
        row.querySelector('[data-move-down]').disabled = index === rows.length - 1;
        row.querySelector('[data-remove-candidate]').disabled = index === 0;
      });
    };
    syncMembers();
    container.querySelectorAll('[data-make-master]').forEach(button => button.addEventListener('click', () => {
      container.prepend(button.closest('[data-cluster-member]'));
      syncMembers();
    }));
    container.querySelectorAll('[data-move-up]').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-cluster-member]');
      if (row.dataset.protectedSource === 'true' && row.previousElementSibling === container.firstElementChild) return;
      if (row.previousElementSibling) container.insertBefore(row, row.previousElementSibling);
      syncMembers();
    }));
    container.querySelectorAll('[data-move-down]').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-cluster-member]');
      if (row.nextElementSibling) container.insertBefore(row.nextElementSibling, row);
      syncMembers();
    }));
    container.querySelectorAll('[data-remove-candidate]').forEach(button => button.addEventListener('click', async () => {
      const row = button.closest('[data-cluster-member]');
      button.disabled = true;
      button.textContent = '移出中…';
      try {
        await persistQueueAction('dismiss_pair', activeCluster.source.id, row.dataset.clusterMember);
        row.remove();
        syncMembers();
      } catch (_) {
        button.disabled = false;
        button.textContent = '重试移出';
      }
    }));
  }

  async function advanceWorkbenchAfterPersist(executed) {
    activeCluster = null;
    activeDraftAction = null;
    activeMechanicalDraft = null;
    activeReviewDraft = null;
    activeExecutionPlan = null;
    activeRehearsalResult = null;
    selectedMemoryIds.clear();
    updateWorkbenchSelection();

    const compare = document.querySelector('[data-cluster-compare]');
    if (compare) {
      compare.className = 'workbench-loading';
      compare.innerHTML = '<span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在接入下一簇</h3><p>已处理的成员不会再次出现在普通候选中。</p></div>';
    }
    const editor = document.querySelector('[data-draft-editor]');
    if (editor) editor.innerHTML = '<p>完成当前记忆簇后，这里会等待下一份草稿。</p>';
    const status = document.querySelector('[data-submit-status]');
    if (status) status.innerHTML = '<span class="workbench-mark" aria-hidden="true">✓</span><div><h3>真实整合已完成</h3><p>如需继续整理，请回到记忆库选择下一组记忆。</p></div>';
    mergeStepTabs.find(tab => tab.dataset.mergeStep === 'cluster')?.click();

    await refreshAfterMemoryChange();
    renderCluster(null);
    return executed.memory?.id || null;
  }

  async function realActionRequest(path, body) {
    const response = await fetch(`/api/memory-preview/actions/${path}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `request_${response.status}`);
    return payload;
  }

  function memoryReviewMarkup(label, memory) {
    return `<article><small>${escapeHtml(label)}</small><strong>${escapeHtml(memory.title)}</strong><p>${escapeHtml(memory.content || memory.preview || '')}</p><dl><div><dt>重要性</dt><dd>${Number(memory.importance || 0).toFixed(2)}</dd></div><div><dt>当前优先级</dt><dd>${memory.priority == null ? '未设置' : Number(memory.priority).toFixed(2)}</dd></div><div><dt>身份权重</dt><dd>${memory.identity_weight == null ? '未设置' : Number(memory.identity_weight).toFixed(2)}</dd></div></dl></article>`;
  }

  function renderRealDraft(payload) {
    const panel = document.querySelector('[data-real-diff]');
    const createsNewCarrier = payload.result_preview?.creates_new_carrier === true;
    const comparison = payload.action === 'weight'
      ? `${memoryReviewMarkup('修改前', payload.before)}<article><small>修改后</small><strong>${escapeHtml(payload.before.title)}</strong><p>记忆强度 ${Math.round(Number(payload.changes.importance) * 100)} / 100</p></article>`
      : `${createsNewCarrier ? `<article><small>将新建普通承载入口</small><strong>${escapeHtml(payload.result_preview.title)}</strong><p>这一簇全部由受保护原件组成；不会选择其中任何一条取得处置权。</p></article>` : memoryReviewMarkup('作为承载记忆保留', payload.target)}${payload.sources.map(source => memoryReviewMarkup((payload.protected_source_ids || []).includes(source.id) ? '保护性引用 · 原记忆保持独立' : '汇入后归档', source)).join('')}<article><small>整合后预览</small><strong>${escapeHtml(payload.result_preview.title)}</strong><p>${escapeHtml(payload.result_preview.content)}</p></article>`;
    panel.hidden = false;
    panel.innerHTML = `<header><span><small>真实草稿 · 尚未写入</small><h3>请核对前后变化</h3></span><b>10 分钟内有效</b></header><div class="real-comparison">${comparison}</div><p class="real-reason"><strong>理由</strong>${escapeHtml(payload.reason)}</p><label>输入确认码 <b>${escapeHtml(payload.confirmation_code)}</b><input inputmode="numeric" maxlength="6" data-real-confirm-code placeholder="六位确认码"></label><button class="real-primary" type="button" data-real-execute>确认并写入真实记忆</button><p data-real-result>尚未写入。关闭或刷新页面会放弃这份草稿。</p>`;
    panel.querySelector('[data-real-execute]').addEventListener('click', async event => {
      const result = panel.querySelector('[data-real-result]');
      const code = panel.querySelector('[data-real-confirm-code]').value.trim();
      if (code !== payload.confirmation_code) { result.textContent = '确认码不匹配，没有写入。'; return; }
      event.currentTarget.disabled = true;
      result.textContent = '正在写入并保存历史……';
      try {
        const executed = await realActionRequest('execute', { draft_id: payload.draft_id, confirmation_code: code });
        result.textContent = executed.action === 'weight'
          ? `赋权已生效；已保留修改前版本。`
          : `整簇整理已生效；${executed.archived_source_ids.length} 条普通来源已归档，${(executed.protected_reference_ids || []).length} 条受保护来源保持独立。`;
        panel.dataset.persisted = 'true';
        let changedId = executed.memory?.id || null;
        if (executed.action === 'merge_many') {
          changedId = await advanceWorkbenchAfterPersist(executed);
        } else {
          await refreshAfterMemoryChange();
        }
        const changedPaper = changedId ? document.querySelector(`[data-memory-id="${CSS.escape(changedId)}"]`) : null;
        if (changedPaper && executed.action !== 'merge_many') {
          showView('library');
          changedPaper.querySelector('.memory-paper-summary')?.click();
          changedPaper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (error) {
        event.currentTarget.disabled = false;
        result.textContent = `没有写入：${error.message}`;
      }
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function wireRealReview() {
    document.querySelectorAll('[data-real-action]').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('[data-real-action]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      document.querySelectorAll('[data-real-form]').forEach(form => { form.hidden = form.dataset.realForm !== button.dataset.realAction; });
      document.querySelector('[data-real-diff]').hidden = true;
    }));
    const strength = document.querySelector('[data-real-strength]');
    strength.addEventListener('input', () => { document.querySelector('[data-real-strength-value]').textContent = strength.value; });
    document.querySelector('[data-real-weight-memory]').addEventListener('change', event => {
      const memory = recordById.get(event.target.value);
      if (memory) populateManualStrength(memory);
    });
    document.querySelector('[data-real-form="weight"]').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const panel = document.querySelector('[data-real-diff]');
      const button = form.querySelector('button[type="submit"]');
      panel.hidden = false;
      panel.innerHTML = '<p>正在读取当前版本并生成赋权核对稿……</p>';
      button.disabled = true;
      try {
        const memory = recordById.get(form.querySelector('[data-real-weight-memory]').value);
        renderRealDraft(await realActionRequest('preview', { action: 'weight', actor: 'xiaoran', memory_id: memory.id,
          importance: Number(form.querySelector('[data-real-strength]').value) / 100,
          priority: memory.priority ?? .5, identity_weight: memory.identityWeight ?? .1,
          reason: form.querySelector('[data-real-weight-reason]').value }));
      } catch (error) { panel.textContent = `无法生成草稿：${error.message}`; }
      finally { button.disabled = false; }
    });
    document.querySelector('[data-real-form="merge_many"]').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const panel = document.querySelector('[data-real-diff]');
      const button = form.querySelector('button[type="submit"]');
      const memoryIds = [...form.querySelectorAll('[data-real-cluster-members] input:checked')].map(input => input.value);
      if (memoryIds.length < 2) { panel.hidden = false; panel.textContent = '至少保留两条成员才能整合。'; return; }
      panel.hidden = false;
      panel.innerHTML = '<p>正在读取所选成员并生成整簇核对稿……</p>';
      button.disabled = true;
      try {
        const selectedRows = [...form.querySelectorAll('[data-real-cluster-members] input:checked')]
          .map(input => input.closest('[data-cluster-member]'));
        const needsManualOverride = selectedRows.some(row => ['related_only', 'possible_update_or_conflict']
          .includes(row?.dataset.mergeBoundary));
        renderRealDraft(await realActionRequest('preview', { action: 'merge_many', actor: 'xiaoran', memory_ids: memoryIds,
          boundary_override: needsManualOverride ? 'manual_review' : undefined,
          reason: form.querySelector('[data-real-merge-reason]').value }));
      } catch (error) { panel.textContent = `无法生成草稿：${error.message}`; }
      finally { button.disabled = false; }
    });
  }

  function closeSidebar() {
    sidebar.classList.remove('is-open');
    sidebar.setAttribute('aria-hidden', 'true');
    scrim.hidden = true;
  }

  function openSidebar() {
    sidebar.classList.add('is-open');
    sidebar.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    sidebar.querySelector('.is-current')?.focus();
  }

  function closeHistory() {
    historySheet.hidden = true;
    historyScrim.hidden = true;
    historyReturnFocus?.focus();
  }

  function openHistory(trigger) {
    historyReturnFocus = trigger;
    const record = recordById.get(trigger.closest('[data-memory-id]')?.dataset.memoryId);
    if (record) {
      historySheet.querySelector('.history-summary').textContent = record.title;
      historySheet.querySelector('.history-timeline').replaceChildren(...record.history.map((entry, index) => {
        const item = document.createElement('li');
        if (index === 0) item.className = 'is-current';
        item.innerHTML = `<span></span><div><small>${escapeHtml(entry[0])}</small><strong>${escapeHtml(entry[1])}</strong><p>${escapeHtml(entry[2])}</p></div>`;
        return item;
      }));
    }
    historySheet.hidden = false;
    historyScrim.hidden = false;
    historySheet.querySelector('[data-close-history]').focus();
  }

  function moveWorkbenchPill(tab, animate) {
    if (!animate) {
      const previous = workbenchPill.style.transition;
      workbenchPill.style.transition = 'none';
      workbenchPill.style.transform = `translateX(${tab.offsetLeft}px)`;
      workbenchPill.style.width = `${tab.offsetWidth}px`;
      void workbenchPill.offsetWidth;
      workbenchPill.style.transition = previous;
      return;
    }
    workbenchPill.style.transform = `translateX(${tab.offsetLeft}px)`;
    workbenchPill.style.width = `${tab.offsetWidth}px`;
  }

  function moveTimeSortPill(tab, animate) {
    if (!animate) {
      const previous = timeSortPill.style.transition;
      timeSortPill.style.transition = 'none';
      timeSortPill.style.transform = `translateX(${tab.offsetLeft}px)`;
      timeSortPill.style.width = `${tab.offsetWidth}px`;
      void timeSortPill.offsetWidth;
      timeSortPill.style.transition = previous;
      return;
    }
    timeSortPill.style.transform = `translateX(${tab.offsetLeft}px)`;
    timeSortPill.style.width = `${tab.offsetWidth}px`;
  }

  function centerWorkbenchTab(tab) {
    if (!workbenchBar || !tab) return;
    if (workbenchTabs.length <= 2) {
      workbenchBar.scrollLeft = 0;
      return;
    }
    const target = tab.offsetLeft - (workbenchBar.clientWidth - tab.offsetWidth) / 2;
    const max = Math.max(0, workbenchBar.scrollWidth - workbenchBar.clientWidth);
    workbenchBar.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
  }

  function moveOwnershipPill(tab, animate) {
    if (!tab || !ownershipPill) return;
    if (!animate) {
      const previous = ownershipPill.style.transition;
      ownershipPill.style.transition = 'none';
      ownershipPill.style.transform = `translateX(${tab.offsetLeft}px)`;
      ownershipPill.style.width = `${tab.offsetWidth}px`;
      void ownershipPill.offsetWidth;
      ownershipPill.style.transition = previous;
      return;
    }
    ownershipPill.style.transform = `translateX(${tab.offsetLeft}px)`;
    ownershipPill.style.width = `${tab.offsetWidth}px`;
  }

  function shortDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-');
  }

  function protectedClusterMemory(memory) {
    return memory?.protected === true || memory?.memory_lifecycle?.protected === true
      || memory?.memory_decay?.policy === 'protected' || Number(memory?.identity_weight || 0) >= .8;
  }

  function worksetRelation(memory) {
    return memory?.workset_relation
      || (protectedClusterMemory(memory) ? 'conflict'
        : memory?.assessment === 'possible_duplicate' ? 'duplicate'
          : memory?.assessment === 'possible_update_or_conflict' ? 'supplement'
            : memory?.assessment === 'related_only' ? 'related' : 'supplement');
  }

  function titleSuggestsStage(memory) {
    return /(?:调整为|改为|迁移|升级|重新|当前版本|已修复|已部署|已启用|已上线)/.test(String(memory?.title || ''));
  }

  function compareKeywordMarkup(memory) {
    const structured = memory?.structured_keywords || memory?.keywords || {};
    const keywordValues = Array.isArray(structured)
      ? structured
      : Object.values(structured || {}).flatMap(value => Array.isArray(value) ? value : [value]);
    const tags = Array.isArray(memory?.tags) ? memory.tags : [];
    const values = [...new Set([...tags, ...keywordValues].map(value => String(value || '').trim()).filter(Boolean))].slice(0, 6);
    if (!values.length) return '';
    return `<div class="compare-keywords">${values.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>`;
  }

  function compareMemoryMarkup(memory, anchor = false) {
    const score = anchor ? '整理起点' : `相似度 ${Number(memory.similarity).toFixed(3)}`;
    const boundary = anchor ? '这条作为整理入口'
      : memory.assessment === 'possible_duplicate' ? '可能属于同一件事'
        : memory.assessment === 'possible_update_or_conflict' ? '可能记录了后来变化'
          : memory.assessment === 'protected_review_only' ? '原件会保持独立'
            : memory.assessment === 'manually_selected' ? '由你加入本组'
              : '内容有关联，是否合并由你判断';
    const protectedSource = protectedClusterMemory(memory);
    const relation = anchor ? 'master' : worksetRelation(memory);
    const masterControl = anchor
      ? '<button type="button" class="compare-master" disabled>当前整理入口</button>'
      : protectedSource
        ? '<button type="button" class="compare-master" disabled title="原件保持独立，只在整理结果中建立来源引用">原件保持独立</button>'
        : `<button type="button" class="compare-master" data-choose-cluster-master="${escapeHtml(memory.id)}">改用这条作整理入口</button>`;
    const simpleRelation = relation === 'supersede' || relation === 'evolution' ? 'supersede'
      : relation === 'related' ? 'related' : relation === 'conflict' ? 'conflict' : 'supplement';
    const titleCue = !anchor && titleSuggestsStage(memory) ? '<small class="title-stage-cue">这条看起来像后来变化，请核对</small>' : '';
    const relationControl = anchor ? '' : `${titleCue}<label class="compare-relation">这条和前面的关系<select data-member-relation="${escapeHtml(memory.id)}"><option value="supplement"${simpleRelation === 'supplement' ? ' selected' : ''}>合在一起</option><option value="supersede"${simpleRelation === 'supersede' ? ' selected' : ''}>这是后来变化</option><option value="related"${simpleRelation === 'related' ? ' selected' : ''}>保持独立</option><option value="conflict"${simpleRelation === 'conflict' ? ' selected' : ''}>内容互相矛盾</option></select></label>`;
    const removeControl = anchor ? '' : `<button type="button" class="compare-remove" data-remove-workset-member="${escapeHtml(memory.id)}">移出候选</button>`;
    const keywords = compareKeywordMarkup(memory);
    return `<section class="compare-memory${anchor ? ' is-anchor' : ''}" data-compare-memory="${escapeHtml(memory.id)}"><div class="compare-memory-title"><strong>${escapeHtml(memory.title)}</strong><span>${escapeHtml(shortDate(memory.occurred_at || memory.created_at))}</span></div><header><small>${escapeHtml(boundary)}</small><b>${score}</b></header><p class="compare-memory-copy">${escapeHtml(memory.content || memory.preview || '暂无正文预览')}</p>${keywords}${relationControl}<details class="compare-memory-detail"><summary>展开完整正文</summary><p>${escapeHtml(memory.content || memory.preview || '暂无正文预览')}</p></details><footer><span>${escapeHtml(memory.kind || '未分类')}</span><span>权重 ${Number(memory.importance || 0).toFixed(2)}</span>${removeControl}${masterControl}</footer></section>`;
  }

  function memoryTimelinePoints(memory) {
    const points = Array.isArray(memory?.timeline) ? memory.timeline : [];
    if (!points.length) return [{
      id: memory.id,
      parent_id: memory.id,
      title: memory.title,
      content: memory.content || memory.preview || '',
      occurred_at: memory.occurred_at || memory.created_at || memory.updated_at || ''
    }];
    return points.map((point, index) => ({
      id: point.memory_id || point.id || `${memory.id}:timeline:${index}`,
      parent_id: memory.id,
      title: point.title || memory.title,
      content: point.content || point.preview || '',
      occurred_at: point.observed_at || point.occurred_at || point.created_at || ''
    })).filter(point => point.content).sort((left, right) => {
      const a = Date.parse(left.occurred_at); const b = Date.parse(right.occurred_at);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
      if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1;
      return String(left.id).localeCompare(String(right.id));
    });
  }

  function orderedTimelineMemories(cluster) {
    const chronological = chronologicalClusterMembers(cluster);
    const ids = chronological.map(memory => String(memory.id));
    if (activeTimelineOrder.length !== ids.length || activeTimelineOrder.some(id => !ids.includes(id))) {
      activeTimelineOrder = ids;
    }
    const byId = new Map(chronological.map(memory => [String(memory.id), memory]));
    const ordered = activeTimelineOrder.map(id => byId.get(id)).filter(Boolean);
    if (!ordered.some(memory => String(memory.id) === String(activeTimelineMemoryId))) {
      activeTimelineMemoryId = String(ordered[0]?.id || '');
      activeTimelinePointId = String(memoryTimelinePoints(ordered[0])[0]?.id || '');
    }
    const activeMemory = ordered.find(memory => String(memory.id) === String(activeTimelineMemoryId));
    if (activeMemory && !memoryTimelinePoints(activeMemory).some(point => String(point.id) === String(activeTimelinePointId))) {
      activeTimelinePointId = String(memoryTimelinePoints(activeMemory)[0]?.id || '');
    }
    return ordered;
  }

  function timelineTitleSorterMarkup(memories) {
    return `<section class="timeline-title-sorter"><header><span><small>标题与排序</small><strong>拖动标题，下面的时间线同步重排</strong></span><b>默认按时间</b></header><ol data-timeline-title-list>${memories.map((memory, index) => {
      const points = memoryTimelinePoints(memory);
      const firstTime = points[0]?.occurred_at || memory.occurred_at || memory.created_at;
      const selected = String(memory.id) === String(activeTimelineMemoryId);
      return `<li class="${selected ? 'is-selected' : ''}" data-timeline-sort-id="${escapeHtml(memory.id)}"><button class="timeline-title-handle" type="button" aria-label="拖动排列${escapeHtml(memory.title)}">${timelineSortHandleMarkup()}</button><span class="timeline-title-rank">${String(index + 1).padStart(2, '0')}</span><button class="timeline-title-copy" type="button" data-select-timeline-memory="${escapeHtml(memory.id)}" aria-pressed="${selected}"><strong>${escapeHtml(memory.title)}</strong><small>${escapeHtml(shortDate(firstTime))} · ${points.length} 个节点</small></button><div class="timeline-title-fallback"><button type="button" data-move-timeline-title="up" aria-label="上移标题" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move-timeline-title="down" aria-label="下移标题" ${index === memories.length - 1 ? 'disabled' : ''}>↓</button></div></li>`;
    }).join('')}</ol></section>`;
  }

  function timelineMemoryGroupMarkup(memory) {
    const points = memoryTimelinePoints(memory);
    const selectedMemory = String(memory.id) === String(activeTimelineMemoryId);
    return `<section class="timeline-memory-group${selectedMemory ? ' is-selected' : ''}" data-timeline-memory-group="${escapeHtml(memory.id)}"><ol class="preline-timeline">${points.map((point, index) => {
      const selectedPoint = selectedMemory && String(point.id) === String(activeTimelinePointId);
      return `<li class="preline-timeline-item${selectedPoint ? ' is-current' : ''}" data-hs-stepper-nav-item='{"index":${index + 1}}'><span class="preline-timeline-rail" aria-hidden="true">${timelineStepperNodeMarkup(index === 0 ? 'is-group' : '')}</span><article class="preline-timeline-content"><header class="timeline-entry-heading"><button class="timeline-entry-title" type="button" data-select-timeline-memory="${escapeHtml(memory.id)}" data-select-timeline-point="${escapeHtml(point.id)}" aria-pressed="${selectedPoint}">${escapeHtml(point.title)}</button><time>${escapeHtml(shortDate(point.occurred_at))}</time></header><p>${escapeHtml(point.content || '这条节点没有可展示的原文。')}</p></article></li>`;
    }).join('')}</ol></section>`;
  }

  function chronologicalClusterMembers(cluster) {
    const effectiveTime = memory => {
      const timelineTimes = (Array.isArray(memory.timeline) ? memory.timeline : [])
        .map(point => Date.parse(point.observed_at || point.occurred_at || '')).filter(Number.isFinite);
      if (timelineTimes.length) return Math.min(...timelineTimes);
      return Date.parse(memory.occurred_at || memory.created_at || memory.updated_at || '');
    };
    return [cluster.source, ...cluster.neighbors]
      .map((memory, originalIndex) => ({ memory, originalIndex }))
      .sort((left, right) => {
        const leftTime = effectiveTime(left.memory);
        const rightTime = effectiveTime(right.memory);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
        if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
        return left.originalIndex - right.originalIndex;
      })
      .map(item => item.memory);
  }

  function renderHydratedClusterCompare({ animateTimeline = false } = {}) {
    const compare = document.querySelector('[data-cluster-compare]');
    const sharedTitles = document.querySelector('[data-integration-shared-titles]');
    if (!activeCluster || !compare) return;
    timelineTitleSortable?.destroy();
    timelineTitleSortable = null;
    const chronologicalMembers = orderedTimelineMemories(activeCluster);
    const includedCount = activeCluster.neighbors.length;
    if (sharedTitles) sharedTitles.innerHTML = timelineTitleSorterMarkup(chronologicalMembers);
    compare.className = 'compare-stack';
    compare.innerHTML = `<section class="integration-compare-timeline" aria-label="按标题组排列的完整原文时间线">${chronologicalMembers.map(item => timelineMemoryGroupMarkup(item)).join('')}</section>`
      + `<div class="workbench-action-dock"><span><strong>${includedCount} 条纳入整理</strong><small>本地语义只处理重复表达，原文和全部时间节点保留</small></span><button class="continue-merge" type="button" data-continue-merge>${includedCount ? '生成整理草稿' : '请先纳入记忆'}</button></div>`;
    const interactionRoot = document.querySelector('[data-workbench-panel="integrate"]') || compare;
    const moveTimelineTitle = (id, direction) => {
      const index = activeTimelineOrder.indexOf(String(id));
      const next = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || next < 0 || next >= activeTimelineOrder.length) return;
      [activeTimelineOrder[index], activeTimelineOrder[next]] = [activeTimelineOrder[next], activeTimelineOrder[index]];
      renderHydratedClusterCompare({ animateTimeline: true });
    };
    interactionRoot.querySelectorAll('[data-move-timeline-title]').forEach(button => button.addEventListener('click', () => {
      moveTimelineTitle(button.closest('[data-timeline-sort-id]')?.dataset.timelineSortId, button.dataset.moveTimelineTitle);
    }));
    interactionRoot.querySelectorAll('[data-select-timeline-memory]').forEach(button => button.addEventListener('click', () => {
      const memoryId = button.dataset.selectTimelineMemory;
      const memory = chronologicalMembers.find(item => String(item.id) === String(memoryId));
      if (!memory) return;
      activeTimelineMemoryId = String(memory.id);
      activeTimelinePointId = String(button.dataset.selectTimelinePoint || memoryTimelinePoints(memory)[0]?.id || '');
      renderHydratedClusterCompare({ animateTimeline: true });
    }));
    const titleList = interactionRoot.querySelector('[data-timeline-title-list]');
    if (titleList && window.Sortable) {
      timelineTitleSortable = new window.Sortable(titleList, {
        animation: 250,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        dataIdAttr: 'data-timeline-sort-id',
        handle: '.timeline-title-handle',
        delay: 120,
        delayOnTouchOnly: true,
        touchStartThreshold: 4,
        ghostClass: 'is-sortable-ghost',
        chosenClass: 'is-sortable-chosen',
        dragClass: 'is-sortable-drag',
        onEnd: () => {
          activeTimelineOrder = timelineTitleSortable.toArray();
          renderHydratedClusterCompare({ animateTimeline: true });
        }
      });
    }
    if (animateTimeline && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      compare.querySelectorAll('[data-timeline-memory-group]').forEach((group, index) => {
        group.animate([
          { opacity: .45, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 250, delay: Math.min(index * 35, 140), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
      });
    }
    compare.querySelectorAll('[data-choose-cluster-master]').forEach(button => button.addEventListener('click', () => {
      const selectedId = button.dataset.chooseClusterMaster;
      const members = [activeCluster.source, ...activeCluster.neighbors];
      const selected = members.find(memory => String(memory.id) === String(selectedId));
      if (!selected || protectedClusterMemory(selected)) return;
      const previousSource = activeCluster.source;
      activeCluster = {
        ...activeCluster,
        source: selected,
        neighbors: members.filter(memory => memory !== selected).map(memory => memory === previousSource
          ? { ...memory, assessment: 'manually_selected' }
          : memory)
      };
      activeMechanicalDraft = null;
      renderHydratedClusterCompare();
    }));
    compare.querySelectorAll('[data-remove-workset-member]').forEach(button => button.addEventListener('click', async () => {
      const memberId = button.dataset.removeWorksetMember;
      const memory = activeCluster.neighbors.find(item => String(item.id) === String(memberId));
      button.disabled = true;
      button.textContent = '移出中…';
      try {
        if (memory && memory.assessment !== 'manually_selected') {
          await persistQueueAction('dismiss_pair', activeCluster.selection?.origin_source_id || activeCluster.source.id, memberId);
        }
        activeCluster.neighbors = activeCluster.neighbors.filter(item => String(item.id) !== String(memberId));
        activeMechanicalDraft = null;
        renderHydratedClusterCompare();
      } catch (_) {
        button.disabled = false;
        button.textContent = '重试移出';
      }
    }));
    const continueButton = compare.querySelector('[data-continue-merge]');
    continueButton.disabled = includedCount < 1;
    compare.querySelector('[data-continue-merge]').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = '本地语义去重中…';
      try { await openMechanicalDraft(); }
      catch (error) {
        button.disabled = false;
        button.textContent = '重试生成草稿';
        alert(`草稿暂时没有形成：${error.message}`);
      }
    });
  }

  async function openClusterForReview(cluster) {
    if (!cluster) return;
    const compare = document.querySelector('[data-cluster-compare]');
    const compareTab = mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'compare');
    compareTab.click();
    compare.className = 'integration-empty-copy';
    compare.innerHTML = '<h3>正在读取完整原文</h3><p>完整正文未到齐前不会开放草稿。</p>';
    try {
      const members = [cluster.source, ...cluster.neighbors];
      const hydrated = await Promise.all(members.map(async member => {
        const response = await fetch(`/api/memory-preview/memories/${encodeURIComponent(member.id)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`memory_${response.status}`);
        const full = await response.json();
        if (full.content_truncated) throw new Error('full_content_too_large');
        if (!full.content) throw new Error('full_content_missing');
        return { ...member, ...full, content: full.content };
      }));
      activeCluster = { ...cluster, source: hydrated[0], neighbors: hydrated.slice(1) };
      activeTimelineOrder = [];
      activeTimelineMemoryId = '';
      activeTimelinePointId = '';
      renderHydratedClusterCompare();
    } catch (error) {
      compare.innerHTML = `<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">!</span><div><h3>完整原文没有全部取回</h3><p>${escapeHtml(error.message)}；已禁止生成和提交草稿。</p></div></div>`;
    }
  }

  function renderCluster(cluster) {
    if (cluster && !cluster.selection?.origin_source_id) {
      cluster = { ...cluster, selection: { ...(cluster.selection || {}), origin_source_id: cluster.source.id } };
    }
    activeCluster = cluster;
    populateRealClusterMembers(cluster);
    document.querySelector('[data-cluster-count]').textContent = cluster ? '1' : '0';
    const integrateCount = document.querySelector('[data-integrate-count]');
    if (integrateCount) {
      integrateCount.textContent = cluster
        ? includeRelatedClusters ? '人工浏览模式' : '当前 1 簇待核对'
        : includeRelatedClusters ? '没有语义候选' : '目前无候选';
    }
    const list = document.querySelector('[data-cluster-list]');
    const compare = document.querySelector('[data-cluster-compare]');
    const sharedTitles = document.querySelector('[data-integration-shared-titles]');
    if (!cluster) {
      const switcher = document.querySelector('[data-cluster-switcher]');
      if (switcher) switcher.hidden = true;
      list.className = 'library-workset-empty';
      list.innerHTML = '<section class="integration-empty-canvas"><article class="integration-empty-source"><span class="workbench-mark" aria-hidden="true">◇</span><div><small>当前工作集</small><h3>还没有带入记忆</h3><p>从记忆库选择至少两条，它们会按原事件时间排成一条竖向发展线。</p><button type="button" data-view-link="library">去记忆库选取</button></div></article><div class="integration-empty-output" aria-label="整合结果预览"><article><header><span><small>EVENT TIMELINE</small><strong>竖列时间线</strong></span><b>0 个节点</b></header><div class="integration-empty-track"><i></i><i></i><i></i></div><p>时间从上到下推进，不由承载入口改变顺序。</p></article><article class="integration-empty-result"><header><span><small>INTEGRATED MEMORY</small><strong>整合记忆</strong></span><b>等待生成</b></header><div class="integration-empty-lines"><i></i><i></i><i></i></div><p>它会接在发展线末端，保留标题、正文与逐句来源。</p></article></div></section>';
      list.querySelector('[data-view-link="library"]')?.addEventListener('click', () => showView('library'));
      if (sharedTitles) sharedTitles.innerHTML = '<header><span><small>公共分区</small><strong>标题与顺序</strong></span><b>贯穿三个工作区</b></header><p>从记忆库带入内容后，标题会在这里统一排列，并同步到时间线、草稿和结构修订。</p>';
      if (compare) {
        compare.className = 'integration-empty-copy';
        compare.innerHTML = '<h3>等待从记忆库带入内容</h3><p>带入后会先读取完整原文，再按事件时间排成连续时间线。</p>';
      }
      return;
    }
    list.className = '';
    const members = chronologicalClusterMembers(cluster);
    if (cluster.selection?.manual) {
      list.innerHTML = '<div class="integration-empty-copy"><h3>正在读取完整原文</h3><p>读取完成后会直接进入排列时间线，不再展示另一套临时时间线。</p></div>';
    } else {
      const selectionNote = cluster.selection?.skipped_newer
        ? `<em>最新 ${cluster.selection.skipped_newer} 条仍在等待砾砾同步，暂用第 ${cluster.selection.position} 条已索引记忆。</em>`
        : '<em>正在使用最新一条已索引记忆。</em>';
      list.innerHTML = `<button class="cluster-card" type="button" data-open-cluster><small>MORAINE · 只读建议</small><strong>${escapeHtml(cluster.source.title)}</strong><p>以这条记忆为中心，找到 ${cluster.neighbors.length} 个语义相近的邻居。</p>${selectionNote}<span class="cluster-card-footer"><span>点击进入逐条核对</span><b>${cluster.neighbors.length + 1} 条记忆 ›</b></span></button>`;
    }
    const position = cluster.selection?.offset ?? clusterOffset;
    clusterOffset = position;
    const switcher = document.querySelector('[data-cluster-switcher]');
    if (switcher) {
      switcher.hidden = false;
      const skipped = Number(cluster.selection?.skipped_non_actionable || 0);
      switcher.querySelector('[data-cluster-position]').textContent = includeRelatedClusters
        ? '人工浏览 · 可改判或保持独立'
        : skipped
        ? `已跳过 ${skipped} 条纯相关记忆 · 仅显示需判断的簇`
        : '仅显示需要判断的候选簇';
      switcher.querySelector('[data-cluster-previous]').disabled = !clusterHistory.length;
      switcher.querySelector('[data-cluster-next]').disabled = !cluster.selection?.has_next;
    }
    compare.className = 'integration-empty-copy';
    compare.innerHTML = '<h3>等待读取完整原文</h3><p>进入核对后才按记忆ID读取，不会用短预览生成草稿。</p>';
    list.querySelector('[data-open-cluster]')?.addEventListener('click', () => openClusterForReview(cluster));
    if (cluster.selection?.manual) openClusterForReview(cluster);
  }

  function renderExperienceThread(payload) {
    const container = document.querySelector('[data-experience-thread]');
    if (payload.persisted !== false || payload.requires_review !== true || !Array.isArray(payload.writes) || payload.writes.length) {
      throw new Error('experience_thread_not_read_only');
    }
    const anchors = new Set(payload.anchor_ids || []);
    container.className = 'thread-points';
    container.innerHTML = payload.points.map(point => `
      <label class="thread-point">
        <input type="checkbox" value="${escapeHtml(point.memory_id)}" checked>
        <span><strong>${escapeHtml(point.title)}</strong><p>${escapeHtml(point.preview || '这条候选没有可展示的短预览。')}</p><small>${escapeHtml(shortDate(point.observed_at))}${anchors.has(point.memory_id) ? ' · 检索锚点' : ''}</small></span>
        <b>${Number(point.similarity).toFixed(2)}</b>
      </label>`).join('') + `<button class="thread-confirm" type="button" data-confirm-thread>确认 ${payload.points.length} 个候选坐标</button><p class="thread-result" data-thread-result>砾砾已在阈值下排除 ${Number(payload.excluded?.below_min_score || 0)} 条；尚未形成或保存发展线。</p>`;
    container.querySelector('[data-confirm-thread]').addEventListener('click', () => {
      const selected = [...container.querySelectorAll('input:checked')].map(input => input.value);
      container.querySelector('[data-thread-result]').textContent = selected.length
        ? `已人工选择 ${selected.length} 个坐标；结果只存在于本页，刷新后复原。`
        : '没有选择坐标；不会生成空的发展线。';
    });
  }

  async function loadExperienceThread() {
    const container = document.querySelector('[data-experience-thread]');
    try {
      const response = await fetch('/api/memory-preview/experience-threads/moraine-project-progress', { cache: 'no-store' });
      if (!response.ok) throw new Error(`experience_thread_${response.status}`);
      renderExperienceThread(await response.json());
    } catch (_) {
      container.innerHTML = '<span class="workbench-mark" aria-hidden="true">!</span><div><h3>暂时无法读取发展线</h3><p>没有使用示例结果冒充，真实记忆也没有变化。</p></div>';
    }
  }

  function selectedMemoryAsCandidate(record, index) {
    return { id: record.id, title: record.title, kind: record.type, importance: record.importance,
      occurred_at: record.createdAt, updated_at: record.updatedAt, preview: record.body, similarity: index === 0 ? 1 : 0,
      assessment: 'manually_selected' };
  }

  function updateWorkbenchSelection() {
    const tray = document.querySelector('[data-workbench-selection]');
    const count = selectedMemoryIds.size;
    if (!count) setWorkbenchSelectionOpen(false);
    prototype.classList.toggle('has-workbench-selection', count > 0);
    tray.hidden = count === 0;
    tray.querySelector('[data-selected-count]').textContent = count;
    tray.querySelector('[data-selection-preview-count]').textContent = `${count} 条`;
    tray.querySelector('[data-selection-summary]').textContent = `已加入 ${count} 条记忆 · 点开预览`;
    tray.querySelector('[data-workbench-selection-list]').innerHTML = [...selectedMemoryIds].map((id) => {
      const record = recordById.get(id);
      if (!record) return '';
      const meta = [record.typeLabel || record.type, record.startLabel || record.timeLabel].filter(Boolean).join(' · ');
      return `<article class="workbench-selection-item"><span><strong>${escapeHtml(record.title || '未命名记忆')}</strong><small>${escapeHtml(meta || '已加入当前工作集')}</small></span><button type="button" data-remove-workbench-memory="${escapeHtml(id)}" aria-label="从工作集移出${escapeHtml(record.title || '这条记忆')}">移出</button></article>`;
    }).join('');
    const openButton = tray.querySelector('[data-open-selected-workbench]');
    openButton.disabled = count < 2;
    openButton.textContent = count < 2 ? '再选一条' : '去整理';
    const primaryCount = document.querySelector('[data-keyword-primary-count]');
    if (primaryCount) primaryCount.textContent = count ? `已选 ${count} 条` : '尚未选取';
    document.querySelectorAll('[data-memory-id]').forEach((paper) => {
      const selected = selectedMemoryIds.has(paper.dataset.memoryId);
      paper.classList.toggle('is-workbench-selected', selected);
      const button = paper.querySelector('[data-add-to-workbench]');
      if (!button) return;
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('strong').textContent = selected ? '已加入工作台' : '加入工作台';
      button.querySelector('small').textContent = selected ? '再次点击可移出' : '与其他记忆一起整理';
      button.querySelector('i').textContent = selected ? '✓' : '＋';
    });
  }

  let workbenchSelectionCloseTimer = 0;
  function setWorkbenchSelectionOpen(open) {
    const tray = document.querySelector('[data-workbench-selection]');
    const preview = tray?.querySelector('[data-workbench-selection-preview]');
    const toggle = tray?.querySelector('[data-workbench-selection-toggle]');
    if (!tray || !preview || !toggle) return;
    window.clearTimeout(workbenchSelectionCloseTimer);
    prototype.classList.toggle('workbench-selection-open', open);
    tray.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    preview.setAttribute('aria-hidden', String(!open));
    if (open) {
      preview.classList.remove('is-closing');
      preview.classList.add('is-open');
      return;
    }
    if (!preview.classList.contains('is-open')) return;
    preview.classList.remove('is-open');
    preview.classList.add('is-closing');
    const closeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')) || 150;
    workbenchSelectionCloseTimer = window.setTimeout(() => preview.classList.remove('is-closing'), closeMs);
  }

  function openSelectedWorkbench() {
    const records = [...selectedMemoryIds].map((id) => recordById.get(id)).filter(Boolean);
    if (records.length < 2) return;
    const candidates = records.map(selectedMemoryAsCandidate);
    showView('workbench');
    setMemoryWorkbenchView('integrate');
    mergeStepTabs.find((button) => button.dataset.mergeStep === 'compare')?.click();
    renderCluster({ source: candidates[0], neighbors: candidates.slice(1),
      selection: { reason: 'manually_selected', position: 1, skipped_newer: 0, manual: true } });
  }

  let activeStructureMemoryId = '';

  function structureRow(record, full = {}) {
    return {
      id: record.id,
      title: full.title || record.title,
      content: full.content || record.body,
      kind: record.type,
      tags: record.tags || [],
      occurred_at: record.createdAt,
      created_at: record.createdAt,
      structured_keywords: full.structured_keywords || record.structuredKeywords,
      service_area_suggestion: full.service_area_suggestion || record.serviceAreaSuggestion,
      service_area_assignment: full.service_area_assignment || record.serviceAreaAssignment
    };
  }

  function structureAreaEditor(row) {
    const confirmed = row.service_area_assignment;
    const suggested = row.service_area_suggestion?.areas || [];
    const confirmedAreas = Array.isArray(confirmed?.areas) ? confirmed.areas : [];
    const areaIds = [...new Set([...(confirmedAreas.length ? confirmedAreas : suggested.map(item => item.area)), ...suggested.map(item => item.area), ...candidatePrimaryAreaIds])];
    const selected = new Set(confirmedAreas.length ? confirmedAreas : suggested.map(item => item.area));
    const weights = Object.fromEntries(areaIds.map(area => [area, Number(confirmed?.weights?.[area] ?? suggested.find(item => item.area === area)?.weight ?? .5)]));
    return `<section class="candidate-area-editor"><header><strong>${confirmedAreas.length ? '分区修订' : '自动分区预览'}</strong><small>${confirmedAreas.length ? '已人工确认' : '系统建议 · 可手动更改'}</small></header><div>${areaIds.map(area => `<label><input type="checkbox" data-structure-area="${escapeHtml(area)}" ${selected.has(area) ? 'checked' : ''}><span>${escapeHtml(candidateAreaLabels[area] || area)}</span><input type="range" data-structure-area-weight="${escapeHtml(area)}" min="0" max="1" step="0.01" value="${weights[area]}"><output>${weights[area].toFixed(2)}</output></label>`).join('')}</div><footer><span>与候选区使用同一套分区与权重；不会改变记忆重要度。</span><button type="button" data-save-structure-areas>保存分区</button></footer></section>`;
  }

  function structureCandidateWorkspaceMarkup(row, { draft = false } = {}) {
    const finish = draft ? `<section class="draft-structure-finish"><label><span>给小机的备注 <small>可选</small></span><textarea rows="3" maxlength="3000" data-draft-agent-note placeholder="例如：保留语气，但让当前状态更容易召回"></textarea></label><div><button class="is-agent" type="button" data-draft-structure-agent>交给小机</button><button class="is-direct" type="button" data-draft-structure-direct>直接入库</button></div><small>交给小机会进入现有后端修订队列；直接入库会保存当前草稿与结构字段。</small></section>` : '<p class="structure-version-note">保存结构字段时保留原版本与回退入口。</p>';
    return `<div class="candidate-work-zone-main"><section class="candidate-step-workspace">${structuredKeywordStrip(row)}${structureAreaEditor(row)}${finish}</section></div>`;
  }

  async function renderStructureEditor(memoryId) {
    const editor = document.querySelector('[data-structure-editor]');
    const record = recordById.get(memoryId);
    if (!editor || !record) return;
    const studio = document.querySelector('[data-structure-studio]');
    if (studio) studio.dataset.hasMemory = 'true';
    activeStructureMemoryId = memoryId;
    editor.innerHTML = '<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在读取当前版本</h3><p>完整正文到齐后才开放修订。</p></div></div>';
    try {
      const response = await fetch(`/api/memory-preview/memories/${encodeURIComponent(memoryId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`memory_${response.status}`);
      const full = await response.json();
      const row = structureRow(record, full);
      try {
        const serviceAreaResponse = await fetch('/api/memory-preview/service-areas', { cache: 'no-store' });
        if (!serviceAreaResponse.ok) throw new Error(`service_areas_${serviceAreaResponse.status}`);
        const detected = await serviceAreaResponse.json();
        row.structured_keywords = detected.structured_keywords?.[memoryId] || row.structured_keywords;
        row.service_area_suggestion = { ...(row.service_area_suggestion || {}), areas: detected.suggestions?.[memoryId] || row.service_area_suggestion?.areas || [] };
        row.service_area_assignment = detected.assignments?.[memoryId] || row.service_area_assignment;
      } catch (_) {
        row.structured_keywords = candidateStructuredKeywords(row);
      }
      record.structuredKeywords = row.structured_keywords;
      record.serviceAreaSuggestion = row.service_area_suggestion;
      record.serviceAreaAssignment = row.service_area_assignment;
      editor.innerHTML = structureCandidateWorkspaceMarkup(row);

      editor.querySelector('[data-save-candidate-keywords]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const keywords = Object.fromEntries([...editor.querySelectorAll('[data-structured-keyword]')].map(input => [input.dataset.structuredKeyword, input.value.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean)]));
        button.disabled = true; button.textContent = '保存中…';
        try {
          const response = await fetch('/api/memory-preview/service-areas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'save_keywords', memory_id:memoryId, keywords, actor:'human:xiaoran', reason:'在结构修订工作台修订正式记忆关键词' }) });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || `keyword_${response.status}`);
          record.structuredKeywords = { ...keywords, confirmed:true, source:'human_override' };
          await renderStructureEditor(memoryId);
        } catch (error) { button.disabled = false; button.textContent = '保存关键词'; alert(`关键词没有保存：${error.message}`); }
      });

      editor.querySelectorAll('[data-structure-area-weight]').forEach(input => input.addEventListener('input', () => { input.nextElementSibling.value = Number(input.value).toFixed(2); }));
      editor.querySelector('[data-save-structure-areas]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const areas = [...editor.querySelectorAll('[data-structure-area]:checked')].map(input => input.dataset.structureArea);
        const weights = Object.fromEntries(areas.map(area => [area, Number(editor.querySelector(`[data-structure-area-weight="${CSS.escape(area)}"]`)?.value || .5)]));
        button.disabled = true; button.textContent = '保存中…';
        try {
          const response = await fetch('/api/memory-preview/service-areas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'save_assignment', memory_id:memoryId, areas, weights, actor:'human:xiaoran', reason:'在结构修订工作台确认正式记忆分区与权重' }) });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || `service_area_${response.status}`);
          record.serviceAreaAssignment = payload.state?.assignments?.[memoryId] || { areas, weights };
          await renderStructureEditor(memoryId);
        } catch (error) { button.disabled = false; button.textContent = '保存分区'; alert(`分区没有保存：${error.message}`); }
      });
    } catch (error) {
      editor.innerHTML = `<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">!</span><div><h3>当前版本没有读到</h3><p>${escapeHtml(error.message)}；原记忆没有变化。</p></div></div>`;
    }
  }

  function openStructureWorkbench(record) {
    if (!record) return;
    showView('workbench');
    setMemoryWorkbenchView('structure');
    renderStructureEditor(record.id);
  }

  function keywordTokens(value = '') {
    return [...new Set(String(value).split(/[、,，;；\s]+/).map(item => item.trim()).filter(item => item.length > 1).slice(0, 8))];
  }

  function keywordSuggestions() {
    const counts = new Map();
    memoryRecords.forEach(record => {
      const groups = record.structuredKeywords || {};
      const values = [...(record.tags || []), ...(groups.entities || []), ...(groups.actions || []), ...(groups.states || [])];
      values.forEach(value => {
        const keyword = String(value || '').trim();
        if (keyword.length < 2 || keyword.length > 12 || /^\d+$/.test(keyword)) return;
        counts.set(keyword, (counts.get(keyword) || 0) + 1);
      });
    });
    return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN')).slice(0, 12).map(item => item[0]);
  }

  function areaKeywordCandidates(area) {
    const counts = new Map();
    const generic = new Set(['完成', '确认', '当前', '独立', '选择', '决定', '保留', '修改', '开始', '停止', '新增', '恢复', '召回', '整合', '测试', '公开']);
    memoryRecords.forEach(record => {
      const belongs = (record.serviceAreaSuggestion?.areas || []).some(item => item.area === area.id);
      if (!belongs) return;
      const groups = record.structuredKeywords || {};
      const weighted = [[record.tags || [], 2], [groups.entities || [], 3], [groups.actions || [], 1], [groups.states || [], 1]];
      weighted.forEach(([values, weight]) => new Set(values.map(value => String(value || '').trim())
        .filter(keyword => keyword.length > 1 && keyword.length <= 12 && !/^\d+$/.test(keyword) && !generic.has(keyword)))
        .forEach(keyword => counts.set(keyword, (counts.get(keyword) || 0) + weight)));
    });
    const explicit = new Set(area.keywords || []);
    return [...new Set([...counts.keys(), ...explicit])].map(keyword => ({
      keyword,
      score: counts.get(keyword) || 0,
      explicit: explicit.has(keyword)
    })).sort((left, right) => Number(right.explicit) - Number(left.explicit)
      || right.score - left.score
      || left.keyword.localeCompare(right.keyword, 'zh-CN'));
  }

  function uniquelyOwnedAreaKeywords(areas) {
    const owners = new Map();
    areas.forEach((area, areaIndex) => areaKeywordCandidates(area).forEach((candidate, rank) => {
      const current = owners.get(candidate.keyword);
      const proposed = { ...candidate, area: area.id, areaIndex, rank };
      const shouldReplace = !current
        || Number(proposed.explicit) > Number(current.explicit)
        || (proposed.explicit === current.explicit && proposed.score > current.score)
        || (proposed.explicit === current.explicit && proposed.score === current.score && proposed.rank < current.rank)
        || (proposed.explicit === current.explicit && proposed.score === current.score && proposed.rank === current.rank && proposed.areaIndex < current.areaIndex);
      if (shouldReplace) owners.set(candidate.keyword, proposed);
    }));
    return areas.map(area => ({
      ...area,
      keywords: [...owners.values()].filter(item => item.area === area.id)
        .sort((left, right) => Number(right.explicit) - Number(left.explicit)
          || right.score - left.score
          || left.keyword.localeCompare(right.keyword, 'zh-CN'))
        .slice(0, 8).map(item => item.keyword)
    }));
  }

  function renderKeywordSuggestions() {
    const container = document.querySelector('[data-keyword-suggestions]');
    if (!container) return;
    const fallback = keywordSuggestions();
    const areas = keywordAreaRegistry.length
      ? uniquelyOwnedAreaKeywords(keywordAreaRegistry)
      : [{ id: 'common', label: '常见', keywords: fallback.slice(0, 8) }];
    const visibleAreas = areas.map(area => ({ ...area,
      keywords: (area.keywords || []).filter(keyword => !selectedWorkbenchKeywords.has(keyword))
    })).filter(area => area.keywords.length);
    container.innerHTML = visibleAreas.length
      ? visibleAreas.map(area => `<details class="keyword-area"><summary><span>${escapeHtml(area.label)}</span><small>${area.keywords.length} 个关键词</small><i aria-hidden="true">⌄</i></summary><div>${area.keywords.map(keyword => `<button type="button" data-suggest-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>`).join('')}</div></details>`).join('')
      : '<small>可以直接输入关键词</small>';
    container.querySelectorAll('[data-suggest-keyword]').forEach(button => button.addEventListener('click', () => addWorkbenchKeywords([button.dataset.suggestKeyword])));
  }

  async function loadKeywordAreaRegistry() {
    try {
      const response = await fetch('/api/memory-preview/service-areas', { cache: 'no-store' });
      if (!response.ok) throw new Error(`service_areas_${response.status}`);
      const payload = await response.json();
      keywordAreaRegistry = (payload.registry || []).map(area => ({ id: area.id, label: area.label || area.id,
        keywords: [...new Set((area.keywords || []).map(value => String(value).trim()).filter(Boolean))]
      })).filter(area => area.keywords.length);
      renderKeywordSuggestions();
    } catch (_) {
      keywordAreaRegistry = [];
      renderKeywordSuggestions();
    }
  }

  function renderSelectedWorkbenchKeywords() {
    const container = document.querySelector('[data-selected-keywords]');
    container.innerHTML = selectedWorkbenchKeywords.size
      ? [...selectedWorkbenchKeywords].map(keyword => `<button type="button" data-remove-keyword="${escapeHtml(keyword)}"><span>${escapeHtml(keyword)}</span><i aria-hidden="true">×</i></button>`).join('')
      : '<small>还没有选择关键词</small>';
    container.querySelectorAll('[data-remove-keyword]').forEach(button => button.addEventListener('click', () => {
      selectedWorkbenchKeywords.delete(button.dataset.removeKeyword);
      renderSelectedWorkbenchKeywords(); renderKeywordSuggestions(); searchWorkbenchKeywords();
    }));
  }

  async function searchWorkbenchKeywords() {
    const results = document.querySelector('[data-keyword-results]');
    const note = document.querySelector('[data-keyword-result-note]');
    const openButton = document.querySelector('[data-open-keyword-workset]');
    const keywords = [...selectedWorkbenchKeywords];
    const serial = ++keywordSearchSerial;
    if (!keywords.length) {
      results.innerHTML = '<small>选择关键词后，这里会显示相关记忆。</small>';
      note.textContent = '不会自动合并或改写正文'; openButton.disabled = true; return;
    }
    results.innerHTML = '<small>正在检索真实记忆原文……</small>';
    try {
      const payloads = await Promise.all(keywords.map(async keyword => {
        const response = await fetch(`/api/memory-preview/library?q=${encodeURIComponent(keyword)}&limit=1000&state=active`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`keyword_search_${response.status}`);
        return { keyword, payload: await response.json() };
      }));
      if (serial !== keywordSearchSerial) return;
      const matches = new Map();
      payloads.forEach(({ keyword, payload }) => (payload.memories || []).forEach(memory => {
        const row = matches.get(memory.id) || { memory, keywords: [] };
        row.keywords.push(keyword); matches.set(memory.id, row);
        if (!recordById.has(memory.id)) recordById.set(memory.id, adaptPreviewMemory(memory));
      }));
      const rows = [...matches.values()].sort((a, b) => b.keywords.length - a.keywords.length
        || String(b.memory.updated_at || '').localeCompare(String(a.memory.updated_at || ''))).slice(0, 40);
      results.innerHTML = rows.length ? rows.map(({ memory, keywords: hits }) => {
        const checked = selectedMemoryIds.has(memory.id);
        return `<label class="keyword-memory-result"><input type="checkbox" value="${escapeHtml(memory.id)}" ${checked ? 'checked' : ''}><span><strong>${escapeHtml(memory.title || '未命名记忆')}</strong><p>${escapeHtml(memory.preview || '暂无预览')}</p><small>${hits.map(keyword => `#${escapeHtml(keyword)}`).join(' ')} · 命中 ${hits.length}/${keywords.length}</small></span></label>`;
      }).join('') : '<small>没有找到命中这些关键词的记忆；可以删掉一个词或换种说法。</small>';
      results.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
        if (input.checked) selectedMemoryIds.add(input.value); else selectedMemoryIds.delete(input.value);
        updateWorkbenchSelection();
        openButton.disabled = selectedMemoryIds.size < 2;
        note.textContent = `当前工作集 ${selectedMemoryIds.size} 条 · 仍需人工核对`;
      }));
      note.textContent = `找到 ${rows.length} 条 · 当前工作集 ${selectedMemoryIds.size} 条`;
      openButton.disabled = selectedMemoryIds.size < 2;
    } catch (error) {
      if (serial !== keywordSearchSerial) return;
      results.innerHTML = `<small>检索暂时失败：${escapeHtml(error.message)}。真实记忆没有变化。</small>`;
    }
  }

  function addWorkbenchKeywords(values) {
    values.forEach(keyword => selectedWorkbenchKeywords.add(keyword));
    renderSelectedWorkbenchKeywords(); renderKeywordSuggestions(); searchWorkbenchKeywords();
  }

  function wireKeywordWorkset() {
    const input = document.querySelector('[data-keyword-input]');
    const add = () => { const tokens = keywordTokens(input.value); input.value = ''; if (tokens.length) addWorkbenchKeywords(tokens); };
    document.querySelector('[data-add-keyword]')?.addEventListener('click', add);
    input?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); add(); } });
    document.querySelector('[data-open-keyword-workset]')?.addEventListener('click', openSelectedWorkbench);
    renderSelectedWorkbenchKeywords(); renderKeywordSuggestions(); loadKeywordAreaRegistry();
  }

  function sentenceParts(value = '') {
    return String(value).split(/(?<=[。！？!?；;])\s*|\n+/).map((part) => part.trim()).filter(Boolean);
  }

  function sentenceKey(value = '') {
    return String(value).normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s_]+/gu, '');
  }

  function mechanicalDraft(cluster) {
    if (!window.MoraineRelationDraft) throw new Error('relation_draft_unavailable');
    const orderById = new Map(activeTimelineOrder.map((id, index) => [String(id), index]));
    return window.MoraineRelationDraft.build({ ...cluster.source,
      workset_order: orderById.get(String(cluster.source.id)) ?? 0 }, cluster.neighbors.map(memory => ({
      ...memory, workset_relation: worksetRelation(memory),
      workset_order: orderById.get(String(memory.id)) ?? Number.MAX_SAFE_INTEGER
    })));
  }

  async function applyLocalSemanticDedup(draft) {
    const timelineRows = draft.kept.filter(item => item.section === 'timeline');
    if (timelineRows.length < 2) return draft;
    const rowIds = new Map(timelineRows.map((row, index) => [row, `timeline-row-${index}`]));
    const response = await fetch('/api/memory-preview/semantic-dedup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: timelineRows.map(row => ({ id: rowIds.get(row), text: row.text })) })
    });
    if (!response.ok) throw new Error(`本地语义服务 ${response.status}`);
    const result = await response.json();
    const removedIds = new Set((result.removed || []).map(item => item.id));
    const removedById = new Map((result.removed || []).map(item => [item.id, item]));
    const semanticRemoved = timelineRows.filter(row => removedIds.has(rowIds.get(row))).map(row => {
      const match = removedById.get(rowIds.get(row));
      const keptRow = timelineRows.find(item => rowIds.get(item) === match?.kept_from);
      return { text: row.text, sourceId: row.sourceId, keptFrom: keptRow?.sourceId || match?.kept_from,
        reason: match?.reason === 'exact_duplicate' ? '完全重复' : `本地语义重复 ${Math.round(Number(match?.score || 0) * 100)}%`, section: 'timeline' };
    });
    draft.kept = draft.kept.filter(row => !removedIds.has(rowIds.get(row)));
    draft.sections = draft.sections.map(section => ({ ...section,
      rows: section.rows.filter(row => !removedIds.has(rowIds.get(row))) })).filter(section => section.rows.length);
    draft.removed = [...draft.removed, ...semanticRemoved];
    draft.content = draft.sections.map(section => `【${section.label}】\n${section.rows.map(row => row.text).join('\n')}`).join('\n\n');
    draft.semanticDedup = { model: result.model, threshold: result.threshold, removed: semanticRemoved.length };
    return draft;
  }

  async function openMechanicalDraft() {
    if (!activeCluster) return;
    activeDraftAction = '整合';
    const draft = await applyLocalSemanticDedup(mechanicalDraft(activeCluster));
    activeMechanicalDraft = draft;
    const editor = document.querySelector('[data-draft-editor]');
    editor.className = 'draft-form';
    const removed = draft.removed.length
      ? `<section class="mechanical-removed"><strong>本地语义标出的重复表达</strong><ul>${draft.removed.map((item) => `<li><del>${escapeHtml(item.text)}</del><small>${escapeHtml(item.reason || '重复')} · 来源 ${escapeHtml(item.sourceId)}</small></li>`).join('')}</ul></section>`
      : '';
    const currentStage = [activeCluster.source, ...activeCluster.neighbors].find(item => item.id === draft.currentSourceId) || activeCluster.source;
    editor.innerHTML = `<div class="integration-draft-canvas"><section class="integration-memory-pane" data-integration-draft-panel="memory"><label>标题<input data-draft-title value="${escapeHtml(draft.currentTitle || currentStage.title)}"></label><label>正文<textarea data-draft-content rows="12">${escapeHtml(draft.content)}</textarea></label>${removed}<section class="integration-draft-routes"><div class="is-single-route"><button class="is-structure-route" type="button" data-enter-draft-structure><strong>结构修订</strong></button></div></section></section></div>`;
    const draftViewButtons = [...editor.querySelectorAll('[data-integration-draft-view]')];
    const draftViewPanels = [...editor.querySelectorAll('[data-integration-draft-panel]')];
    const draftViewMedia = window.matchMedia('(max-width: 640px)');
    const selectDraftView = view => {
      draftViewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.integrationDraftView === view)));
      draftViewPanels.forEach(panel => { panel.hidden = false; });
    };
    draftViewButtons.forEach(button => button.addEventListener('click', () => selectDraftView(button.dataset.integrationDraftView)));
    draftViewMedia.addEventListener('change', () => {
      const selected = draftViewButtons.find(button => button.getAttribute('aria-pressed') === 'true');
      selectDraftView(selected?.dataset.integrationDraftView || 'timeline');
    });
    selectDraftView('timeline');
    editor.querySelector('[data-enter-draft-structure]').addEventListener('click', openDraftStructureRevision);
    mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'draft').click();
  }

  async function openDraftStructureRevision() {
    const draftEditor = document.querySelector('[data-draft-editor]');
    const title = draftEditor?.querySelector('[data-draft-title]')?.value.trim() || activeMechanicalDraft?.currentTitle || '未命名整合草稿';
    const content = draftEditor?.querySelector('[data-draft-content]')?.value.trim() || activeMechanicalDraft?.content || '';
    const studio = document.querySelector('[data-structure-studio]');
    const editor = document.querySelector('[data-structure-editor]');
    if (!studio || !editor) return;
    studio.dataset.hasMemory = 'true';
    studio.dataset.step = 'classify';
    mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'structure')?.click();
    editor.innerHTML = '<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在分析整合记忆</h3><p>按整合后的标题和正文生成关键词与系统分区。</p></div></div>';
    const draftRow = { id:`integration-draft:${Date.now()}`, title, content, tags: [], kind: 'event', occurred_at: new Date().toISOString() };
    try {
      const response = await fetch('/api/memory-preview/service-areas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'describe_draft', memory:draftRow }) });
      const detected = await response.json();
      if (!response.ok || !detected.ok) throw new Error(detected.error || `draft_structure_${response.status}`);
      draftRow.structured_keywords = activeMechanicalDraft?.structured_keywords?.confirmed
        ? activeMechanicalDraft.structured_keywords : detected.structured_keywords;
      draftRow.service_area_suggestion = detected.service_area_suggestion;
      draftRow.service_area_assignment = activeMechanicalDraft?.service_area_assignment || null;
      if (activeMechanicalDraft) {
        activeMechanicalDraft.structured_keywords = draftRow.structured_keywords;
        activeMechanicalDraft.service_area_suggestion = draftRow.service_area_suggestion;
      }
    } catch (_) {
      draftRow.structured_keywords = activeMechanicalDraft?.structured_keywords || candidateStructuredKeywords(draftRow);
      draftRow.service_area_assignment = activeMechanicalDraft?.service_area_assignment || null;
    }
    editor.innerHTML = structureCandidateWorkspaceMarkup(draftRow, { draft: true });
    editor.querySelector('[data-save-candidate-keywords]')?.addEventListener('click', event => {
      const keywords = Object.fromEntries([...editor.querySelectorAll('[data-structured-keyword]')].map(input => [input.dataset.structuredKeyword, input.value.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean)]));
      if (activeMechanicalDraft) activeMechanicalDraft.structured_keywords = { ...keywords, confirmed: true, source: 'human_override' };
      event.currentTarget.textContent = '已保存';
    });
    editor.querySelectorAll('[data-structure-area-weight]').forEach(input => input.addEventListener('input', () => { input.nextElementSibling.value = Number(input.value).toFixed(2); }));
    editor.querySelector('[data-save-structure-areas]')?.addEventListener('click', event => {
      const areas = [...editor.querySelectorAll('[data-structure-area]:checked')].map(input => input.dataset.structureArea);
      const weights = Object.fromEntries(areas.map(area => [area, Number(editor.querySelector(`[data-structure-area-weight="${CSS.escape(area)}"]`)?.value || .5)]));
      if (activeMechanicalDraft) activeMechanicalDraft.service_area_assignment = { areas, weights, confirmed_at: new Date().toISOString(), source: 'human_override' };
      event.currentTarget.textContent = '已保存';
    });
    editor.querySelector('[data-draft-structure-agent]').addEventListener('click', event => submitDraft(event, {
      agentRevision: true,
      instructions: editor.querySelector('[data-draft-agent-note]')?.value.trim() || ''
    }));
    editor.querySelector('[data-draft-structure-direct]').addEventListener('click', event => submitDraft(event));
  }

  function openDraft(action) {
    if (!activeCluster) return;
    activeDraftAction = action;
    const editor = document.querySelector('[data-draft-editor]');
    editor.className = 'draft-form';
    const destructive = action === '删除';
    editor.innerHTML = `<header><strong>${escapeHtml(action)}草稿</strong><small>仅保存在当前页面</small></header><label>新记忆标题<input data-draft-title value="${escapeHtml(activeCluster.source.title)}" ${destructive ? 'readonly' : ''}></label><label>整合说明<textarea data-draft-reason rows="4" placeholder="说明这组记忆如何整合">${action === '整合' ? `将中心记忆与 ${activeCluster.neighbors.length} 条相近记录整理为一条完整记忆，保留全部来源。` : action === '删除' ? '提议移入回收区；正式删除仍需共同审阅与冷静期。' : ''}</textarea></label><button type="button" data-submit-draft>提交共同审阅</button>`;
    editor.querySelector('[data-submit-draft]').addEventListener('click', submitDraft);
    mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'draft').click();
  }

  async function submitDraft(event, { agentRevision = false, instructions = '' } = {}) {
    const title = document.querySelector('[data-draft-title]').value.trim() || activeCluster.source.title;
    const content = document.querySelector('[data-draft-content]')?.value.trim() || activeMechanicalDraft?.content || '';
    const reason = document.querySelector('[data-draft-reason]')?.value.trim() || `提议对这组记忆进行${activeDraftAction}。`;
    activeReviewDraft = { title, content, reason };
    activeReviewKind = 'memory-change';
    const submitButton = event?.currentTarget || document.querySelector('[data-submit-draft]');
    const status = document.querySelector('[data-submit-status]');
    submitButton.disabled = true;
    submitButton.textContent = agentRevision ? '正在准备并交给小机…' : '正在复核并写入…';
    status.innerHTML = '<span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在写入真实记忆</h3><p>后端会先复核版本与整合边界。</p></div>';
    mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'confirm').click();
    try {
      const preview = await realActionRequest('preview', unifiedPreviewRequest());
      const executed = await realActionRequest('execute', {
        draft_id: preview.draft_id,
        confirmation_code: preview.confirmation_code
      });
      if (executed.memory?.id && activeMechanicalDraft) await syncMergeDraftStructure(activeMechanicalDraft, executed.memory.id);
      let agentQueueMessage = '';
      if (agentRevision && executed.memory?.id) {
        try {
          const response = await fetch('/api/memory-preview/backend-revisions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              memory_id: executed.memory.id,
              memory_title: executed.memory.title || title,
              strategies: ['smart_assessment'],
              instructions,
              must_keep: ''
            })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `request_${response.status}`);
          if (payload.revision?.id) backendRevisionStates.set(payload.revision.id, payload.revision.status);
          agentQueueMessage = '已经带着备注进入小机修订队列。';
        } catch (queueError) {
          agentQueueMessage = `整合记忆已经安全入库，但交给小机失败：${escapeHtml(queueError.message)}。可以从记忆库再次发起。`;
        }
      }
      status.innerHTML = `<span class="workbench-mark" aria-hidden="true">✓</span><div><h3>${agentRevision ? '整合已交给小机' : '整合已写入记忆库'}</h3><p>${(executed.archived_source_ids || []).length} 条来源已归档；48小时内可完整回退。${agentQueueMessage || '下一组仍从记忆库选取。'}</p></div>`;
      activeCluster = null;
      activeMechanicalDraft = null;
      activeReviewDraft = null;
      clusterOffset = 0;
      clusterHistory = [];
      await refreshAfterMemoryChange({ clearWorkbench: true });
      workbenchTabs.find((tab) => tab.dataset.workbenchStep === 'integrate')?.click();
      mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'cluster')?.click();
      renderCluster(null);
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = agentRevision ? '重新交给小机' : '重新确认整合并写入';
      status.innerHTML = `<span class="workbench-mark" aria-hidden="true">!</span><div><h3>没有写入</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function updateReviewState() {
    const card = document.querySelector('[data-review-card]');
    ['xiaoran', 'cairn'].forEach((owner) => {
      const section = card.querySelector(`[data-signature="${owner}"]`);
      const choice = reviewChoices[owner];
      section.dataset.choice = choice || '';
      section.querySelector('span').textContent = choice === 'approve' ? '已确认草稿' : choice === 'keep' ? '选择保持原状' : '待确认';
      section.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.choice === choice)));
    });
    const values = Object.values(reviewChoices);
    const verdict = card.querySelector('[data-review-verdict]');
    const build = card.querySelector('[data-build-plan]');
    if (values.every((value) => value === 'approve')) {
      verdict.textContent = '双方已确认草稿，可以生成安全执行计划。';
      verdict.dataset.state = 'approved';
      build.disabled = false;
    } else if (values.every(Boolean) && new Set(values).size > 1) {
      verdict.textContent = '双方意见不同：保持原记忆不变，草稿可退回继续修改。';
      verdict.dataset.state = 'disagree';
      build.disabled = true;
    } else if (values.every((value) => value === 'keep')) {
      verdict.textContent = '双方选择保持原状：这份草稿不会执行。';
      verdict.dataset.state = 'kept';
      build.disabled = true;
    } else {
      verdict.textContent = '两把钥匙都转动后，才会生成执行计划。';
      verdict.dataset.state = '';
      build.disabled = true;
    }
  }

  function unifiedPreviewRequest() {
    const signatures = { ...reviewChoices };
    if (activeReviewKind === 'weight') {
      const record = recordById.get(activeReviewDraft.memoryId);
      if (!record) throw new Error('找不到待赋权的真实记忆');
      return { action: 'weight', memory_id: record.id,
        importance: Number(activeReviewDraft.value) / 10,
        priority: record.priority == null ? .5 : record.priority,
        identity_weight: record.identityWeight == null ? .1 : record.identityWeight,
        actor: activeReviewDraft.actor === 'human' ? 'xiaoran' : 'cairn',
        strength_locked: activeReviewDraft.lock === true,
        reason: activeReviewDraft.reason, signatures };
    }
    if (activeDraftAction === '整合') {
      const includedNeighbors = (activeCluster?.neighbors || []).filter(item => worksetRelation(item) !== 'related');
      const memoryIds = [...new Set([activeCluster?.source?.id, ...includedNeighbors.map(item => item.id)].filter(Boolean))];
      const memberRelations = Object.fromEntries(includedNeighbors.map(item => [item.id, worksetRelation(item)]));
      const needsManualOverride = includedNeighbors.some(item =>
        ['related_only', 'possible_update_or_conflict', 'manually_selected'].includes(item.assessment));
      return { action: 'merge_many', memory_ids: memoryIds,
        actor: 'xiaoran',
        member_relations: memberRelations,
        boundary_override: needsManualOverride ? 'manual_review' : undefined,
        result_title: activeReviewDraft.title,
        result_content: activeReviewDraft.content,
        reason: activeReviewDraft.reason, signatures };
    }
    if (activeDraftAction === '更迭') {
      return { action: 'supersede', old_id: activeCluster?.source?.id,
        actor: 'xiaoran',
        replacement_id: activeCluster?.neighbors?.[0]?.id,
        reason: activeReviewDraft.reason, signatures };
    }
    if (activeDraftAction === '清理') {
      return { action: 'archive', memory_id: activeCluster?.source?.id,
        actor: 'xiaoran',
        reason: activeReviewDraft.reason, signatures };
    }
    throw new Error('当前草稿还没有真实执行映射');
  }

  function unifiedPreviewDescription(payload) {
    if (payload.action === 'weight') return `将「${payload.before.title}」的强度调整为 ${Math.round(Number(payload.changes.importance) * 100)} / 100；正文保持不变。`;
    if (payload.action === 'supersede') return `将「${payload.before.title}」标记为已被「${payload.replacement.title}」更迭；两条正文与版本历史都保留。`;
    if (payload.action === 'archive') return `将「${payload.before.title}」移入可恢复回收区并停止普通召回；正文与历史保留。`;
    return `以「${payload.target.title}」作为承载入口，按事件时间保存发展线；归档 ${payload.sources.length - (payload.protected_source_ids || []).length} 条普通来源，${(payload.protected_source_ids || []).length} 条受保护来源只建立引用。`;
  }

  function renderUnifiedRealPreview(payload, trigger) {
    const panel = document.querySelector('[data-execution-plan]');
    panel.hidden = false;
    panel.innerHTML = `<header><strong>真实执行核对</strong><small>尚未写入 · ${escapeHtml(payload.expires_at)}</small></header><p>${escapeHtml(unifiedPreviewDescription(payload))}</p><ol><li>执行前重新核对每条记忆版本；发生变化则整份拒绝</li><li>保留原文、版本历史与恢复凭据</li><li>只有输入本次六位确认码才会写入</li></ol><label>输入确认码 <b>${escapeHtml(payload.confirmation_code)}</b><input inputmode="numeric" maxlength="6" data-unified-confirm-code placeholder="六位确认码"></label><button class="real-primary" type="button" data-unified-execute>确认并写入真实记忆</button><p data-unified-result>尚未写入；刷新页面会放弃本次确认。</p>`;
    const execute = panel.querySelector('[data-unified-execute]');
    execute.addEventListener('click', async () => {
      const result = panel.querySelector('[data-unified-result]');
      const confirmationCode = panel.querySelector('[data-unified-confirm-code]').value.trim();
      if (confirmationCode !== payload.confirmation_code) { result.textContent = '确认码不匹配，没有写入。'; return; }
      execute.disabled = true;
      result.textContent = '正在复核版本并写入……';
      try {
        const executed = await realActionRequest('execute', { draft_id: payload.draft_id, confirmation_code: confirmationCode });
        result.textContent = executed.action === 'archive' ? '已进入可恢复回收区。'
          : executed.action === 'supersede' ? '更迭关系已写入，两条历史均已保留。'
            : executed.action === 'weight' ? '赋权已写入，并保留修改前版本。'
              : `整合已写入；${(executed.archived_source_ids || []).length} 条来源已归档。`;
        trigger.textContent = '真实写入已完成';
        await refreshAfterMemoryChange({ clearWorkbench: executed.action === 'merge_many', refreshCluster: executed.action === 'merge_many' });
      } catch (error) {
        execute.disabled = false;
        result.textContent = `没有写入：${error.message}`;
      }
    });
  }

  async function prepareUnifiedRealPreview(trigger) {
    const panel = document.querySelector('[data-execution-plan]');
    panel.hidden = false;
    panel.innerHTML = '<p>正在读取真实版本并生成最后核对稿……</p>';
    trigger.disabled = true;
    try {
      const payload = await realActionRequest('preview', unifiedPreviewRequest());
      renderUnifiedRealPreview(payload, trigger);
      trigger.textContent = '真实核对稿已生成';
      document.querySelector('[data-review-verdict]').textContent = '双方已确认；输入六位确认码后才会真实写入。';
    } catch (error) {
      panel.innerHTML = `<p>无法生成真实核对稿：${escapeHtml(error.message)}</p>`;
      trigger.disabled = false;
    }
  }

  function submitStrengthToReview(control, article, actor, value, lock, reason) {
    activeReviewKind = 'weight';
    activeReviewDraft = { memoryId: article.dataset.memoryId,
      title: article.querySelector('.memory-paper-copy > strong').textContent, value, lock, reason, actor };
    const current = Math.round(Number(article.dataset.memoryImportance || 0) * 10);
    const card = document.querySelector('[data-review-card]');
    document.querySelector('[data-review-empty]').hidden = true;
    card.hidden = false;
    card.querySelector('[data-review-action]').textContent = `${lock ? '核心锁定' : value >= 8 ? '高影响赋权' : '赋权'} · 待审阅`;
    card.querySelector('[data-review-original-label]').textContent = '当前强度';
    card.querySelector('[data-review-updated-label]').textContent = `${actor === 'machine' ? '小机' : '人类'}的提议`;
    card.querySelector('[data-review-original]').textContent = `${current} / 10`;
    card.querySelector('[data-review-original-body]').textContent = article.querySelector('.memory-paper-copy > strong').textContent;
    card.querySelector('[data-review-updated]').textContent = `${value} / 10${lock ? ' · 锁定核心' : ''}`;
    card.querySelector('[data-review-updated-body]').textContent = '保留正文、来源与旧权重，只新增一条可追溯的赋权记录。';
    card.querySelector('[data-review-reason]').textContent = reason;
    card.querySelector('[data-review-sources]').innerHTML = '<p>此草稿只调整权重元数据，不改写记忆正文。</p>';
    reviewChoices = actor === 'machine' ? { xiaoran: null, cairn: 'approve' } : { xiaoran: 'approve', cairn: null };
    card.querySelector('[data-execution-plan]').hidden = true;
    card.querySelector('[data-build-plan]').textContent = '生成真实核对稿';
    updateReviewState();
    control.querySelector('[data-strength-result]').textContent = '草稿已送往共同审阅，正在等待另一方确认。';
    window.setTimeout(() => showView('review'), 220);
  }

  function submitOperation(form, action) {
    const reason = form.querySelector('[data-operation-reason]').value.trim();
    const result = form.querySelector('[data-operation-result]');
    if (!reason) { result.textContent = '请先写下这次变更的理由。'; return; }
    if (action === '清理' && !form.querySelector('[data-operation-confirm]').checked) {
      result.textContent = '请先确认这次操作只进入可恢复回收区。';
      return;
    }
    const record = recordById.get(activeOperationMemoryId);
    if (!record) { result.textContent = '请先从具体记忆纸页发起清理。'; return; }
    const sources = [record];
    const title = '移入可恢复回收区';
    const content = '停止参与日常召回，正文、来源与历史继续保留。';
    activeCluster = { source: selectedMemoryAsCandidate(sources[0], 0), neighbors: sources.slice(1).map(selectedMemoryAsCandidate) };
    activeMechanicalDraft = null;
    activeDraftAction = action; activeReviewDraft = { title, content, reason }; activeReviewKind = 'memory-change';
    const card = document.querySelector('[data-review-card]');
    document.querySelector('[data-review-empty]').hidden = true; card.hidden = false;
    card.querySelector('[data-review-action]').textContent = `${action === '清理' ? '可恢复回收' : action} · 待审阅`;
    card.querySelector('[data-review-original-label]').textContent = action === '更迭' ? '旧记忆' : '当前版本';
    card.querySelector('[data-review-updated-label]').textContent = action === '清理' ? '回收结果' : '变更草稿';
    card.querySelector('[data-review-original]').textContent = sources[0].title;
    card.querySelector('[data-review-original-body]').textContent = sources[0].body || sources[0].summary || '';
    card.querySelector('[data-review-updated]').textContent = title;
    card.querySelector('[data-review-updated-body]').textContent = content;
    card.querySelector('[data-review-reason]').textContent = reason;
    card.querySelector('[data-review-sources]').innerHTML = `<p>${sources.length} 条来源记录；原文与版本历史全部保留。</p>`;
    reviewChoices = { xiaoran: null, cairn: null };
    card.querySelector('[data-execution-plan]').hidden = true;
    card.querySelector('[data-build-plan]').textContent = '生成执行计划';
    updateReviewState();
    document.querySelector('[data-draft-count]').textContent = '1';
    document.querySelector('[data-review-count]').textContent = '1';
    result.textContent = '草稿已送往共同审阅；真实记忆未修改。';
    window.setTimeout(() => showView('review'), 220);
  }

  function openCleanDraft(record) {
    showView('library');
    const paper = document.querySelector(`[data-memory-id="${CSS.escape(record.id)}"]`);
    if (!paper) return;
    if (!paper.classList.contains('is-open')) paper.querySelector('.memory-paper-summary')?.click();
    const panel = paper.querySelector('[data-inline-clean-panel]');
    const trigger = paper.querySelector('[data-inline-clean-toggle]');
    if (panel && trigger) {
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function submitReplacement(pair) {
    const oldRecord = adaptPreviewMemory(pair.old_memory);
    const newRecord = adaptPreviewMemory(pair.new_memory);
    activeCluster = { source: selectedMemoryAsCandidate(oldRecord, 0), neighbors: [selectedMemoryAsCandidate(newRecord, 1)] };
    activeMechanicalDraft = null;
    activeDraftAction = '更迭';
    activeReviewDraft = {
      title: newRecord.title,
      content: newRecord.body || newRecord.summary,
      reason: `砾砾发现两条记忆语义相近，记录时间相隔 ${Math.round(pair.gap_hours)} 小时；需要共同判断这是阶段变化、重复还是应当并存。`
    };
    activeReviewKind = 'memory-change';
    const card = document.querySelector('[data-review-card]');
    document.querySelector('[data-review-empty]').hidden = true;
    card.hidden = false;
    card.querySelector('[data-review-action]').textContent = '替换候选 · 待审阅';
    card.querySelector('[data-review-original-label]').textContent = '较早记忆';
    card.querySelector('[data-review-updated-label]').textContent = '较新记忆';
    card.querySelector('[data-review-original]').textContent = oldRecord.title;
    card.querySelector('[data-review-original-body]').textContent = oldRecord.body;
    card.querySelector('[data-review-updated]').textContent = newRecord.title;
    card.querySelector('[data-review-updated-body]').textContent = newRecord.body;
    card.querySelector('[data-review-reason]').textContent = activeReviewDraft.reason;
    card.querySelector('[data-review-sources]').innerHTML = '<p>候选只由相似度与时间差发现；砾砾没有裁决替换关系。</p>';
    reviewChoices = { xiaoran: null, cairn: null };
    card.querySelector('[data-execution-plan]').hidden = true;
    card.querySelector('[data-build-plan]').disabled = true;
    card.querySelector('[data-build-plan]').textContent = '生成执行计划';
    updateReviewState();
    document.querySelector('[data-review-count]').textContent = '1';
    showView('review');
  }

  async function loadReplacementCandidates() {
    const container = document.querySelector('[data-replacement-list]');
    try {
      const response = await fetch('/api/memory-preview/replacements', { cache: 'no-store' });
      if (!response.ok) throw new Error(`replacements_${response.status}`);
      const payload = await response.json();
      replacementPairs.clear();
      payload.candidates.forEach(pair => replacementPairs.set(pair.id, pair));
      if (!payload.candidates.length) {
        container.innerHTML = '<div class="workbench-loading"><span class="workbench-mark">✓</span><div><h3>目前没有替换候选</h3><p>砾砾没有发现同时满足相似度与 24 小时时间差的有效记忆。</p></div></div>';
        return;
      }
      container.className = 'replacement-list';
      container.innerHTML = payload.candidates.map(pair => `<article class="replacement-card"><header><span><small>${Math.round(pair.gap_hours)} 小时间隔 · 待判断</small><strong>可能是阶段变化，也可能只是相关</strong></span><b>${Math.round(pair.similarity * 100)}%</b></header><div class="replacement-pair"><section><small>较早</small><strong>${escapeHtml(pair.old_memory.title)}</strong></section><i>→</i><section><small>较新</small><strong>${escapeHtml(pair.new_memory.title)}</strong></section></div><p>砾砾只负责把它们放到一起；确认后仅建立“较新取代较早”的关系，旧记忆与历史仍保留。</p><label class="replacement-reason">替换理由<textarea rows="2" data-replacement-reason placeholder="为什么较新的记忆应取代较早的记忆"></textarea></label><button type="button" data-review-replacement="${escapeHtml(pair.id)}">生成真实替换核对</button><div data-replacement-result="${escapeHtml(pair.id)}"><p>尚未写入。</p></div></article>`).join('');
    } catch (_) {
      container.innerHTML = '<div class="workbench-loading"><span class="workbench-mark">!</span><div><h3>暂时无法读取替换候选</h3><p>真实记忆仍在原位，稍后可以安全重试。</p></div></div>';
    }
  }

  async function loadCleanupCandidates() {
    const candidates = document.querySelector('[data-cleanup-list]');
    const recycle = document.querySelector('[data-recycle-list]');
    if (!candidates || !recycle) return;
    try {
      const response = await fetch('/api/memory-preview/cleanup', { cache: 'no-store' });
      if (!response.ok) throw new Error(`cleanup_${response.status}`);
      const payload = await response.json();
      payload.candidates.forEach(item => recordById.set(item.memory.id, adaptPreviewMemory(item.memory)));
      (payload.near_duplicate_candidates || []).forEach(pair => {
        recordById.set(pair.older_memory.id, adaptPreviewMemory(pair.older_memory));
        recordById.set(pair.newer_memory.id, adaptPreviewMemory(pair.newer_memory));
      });
      const duplicateMarkup = (payload.near_duplicate_candidates || []).map(pair => `<article class="cleanup-candidate"><strong>${escapeHtml(pair.older_memory.title)} ↔ ${escapeHtml(pair.newer_memory.title)}</strong><small>${Math.round(pair.similarity * 100)}% 相似 · 间隔 ${pair.gap_hours} 小时 · 仅建议比较</small><div><button type="button" data-open-cleanup-candidate="${escapeHtml(pair.older_memory.id)}">检查较早记录</button><button type="button" data-open-cleanup-candidate="${escapeHtml(pair.newer_memory.id)}">检查较新记录</button></div></article>`).join('');
      const ordinaryMarkup = payload.candidates.map(item => `<article class="cleanup-candidate"><strong>${escapeHtml(item.memory.title)}</strong><small>${escapeHtml(item.reasons.join(' · '))}</small><button type="button" data-open-cleanup-candidate="${escapeHtml(item.memory.id)}">检查这条记忆</button></article>`).join('');
      candidates.innerHTML = duplicateMarkup || ordinaryMarkup
        ? `${duplicateMarkup}${ordinaryMarkup}`
        : '<p>目前没有达到保守条件的清理候选。系统没有为了填满队列降低门槛。</p>';
      recycle.innerHTML = payload.recycle.length
        ? payload.recycle.map(item => `<article class="cleanup-candidate"><strong>${escapeHtml(item.title)}</strong><small>正文、来源与历史仍在 · 可恢复</small><button type="button" data-restore-memory="${escapeHtml(item.id)}">提出恢复</button><div data-restore-result="${escapeHtml(item.id)}"></div></article>`).join('')
        : '<p>回收区目前是空的。</p>';
    } catch (_) {
      candidates.innerHTML = '<p>暂时无法读取清理候选；真实记忆没有变化。</p>';
      recycle.innerHTML = '<p>暂时无法读取回收区。</p>';
    }
  }

  async function loadRollbacks() {
    const container = document.querySelector('[data-rollback-list]');
    if (!container) return;
    try {
      const response = await fetch('/api/memory-preview/rollbacks', { cache: 'no-store' });
      if (!response.ok) throw new Error(`rollbacks_${response.status}`);
      const payload = await response.json();
      container.innerHTML = payload.rollbacks.length ? payload.rollbacks.map(item => `<article class="cleanup-candidate"><strong>${escapeHtml(item.action)}</strong><small>${item.memory_ids.length} 条记忆 · 截止 ${new Date(item.available_until).toLocaleString('zh-CN')}</small><button type="button" data-execute-rollback="${escapeHtml(item.id)}">完整回退</button><p data-rollback-result="${escapeHtml(item.id)}"></p></article>`).join('') : '<p>目前没有可用回退点。</p>';
    } catch (_) { container.innerHTML = '<p>暂时无法读取回退点。</p>'; }
  }

  async function loadWorkbenchCluster(attempt = 0, sourceId = '') {
    try {
      const anchor = sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : '';
      const related = includeRelatedClusters ? '&include_related=1' : '';
      const response = await fetch(`/api/memory-preview/clusters?offset=${clusterOffset}${anchor}${related}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`clusters_${response.status}`);
      renderCluster((await response.json()).clusters?.[0] || null);
      return true;
    } catch (_) {
      if (attempt < 2) {
        await new Promise(resolve => window.setTimeout(resolve, 900 * (attempt + 1)));
        return loadWorkbenchCluster(attempt + 1, sourceId);
      }
      document.querySelector('[data-cluster-list]').innerHTML = '<span class="workbench-mark" aria-hidden="true">!</span><div><h3>暂时无法读取记忆簇</h3><p>记忆仍在原位；稍后可以安全重试。</p></div>';
      return false;
    }
  }

  document.querySelector('[data-toggle-related]')?.addEventListener('click', async event => {
    includeRelatedClusters = !includeRelatedClusters;
    clusterOffset = 0;
    clusterHistory = [];
    activeCluster = null;
    event.currentTarget.textContent = includeRelatedClusters ? '返回精准候选' : '查看纯相关候选';
    const note = document.querySelector('[data-cluster-mode-note]');
    if (note) note.textContent = includeRelatedClusters
      ? '人工浏览不会自动合并；可以改判、移出或保持独立'
      : '默认只显示砾砾认为需要判断的簇';
    await loadWorkbenchCluster();
  });

  document.querySelector('[data-refresh-cluster]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const list = document.querySelector('[data-cluster-list]');
    button.disabled = true;
    button.textContent = '刷新中…';
    activeCluster = null;
    activeMechanicalDraft = null;
    activeReviewDraft = null;
    clusterOffset = 0;
    clusterHistory = [];
    document.querySelector('[data-real-diff]').hidden = true;
    list.className = 'workbench-loading';
    list.innerHTML = '<span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在刷新候选</h3><p>重新读取真实记忆与最新索引状态。</p></div>';
    mergeStepTabs.find(tab => tab.dataset.mergeStep === 'cluster')?.click();
    const refreshed = await refreshAfterMemoryChange({ refreshCluster: true });
    button.disabled = false;
    button.textContent = refreshed ? '已更新' : '部分刷新失败';
    window.setTimeout(() => { button.textContent = '刷新候选'; }, 1200);
  });

  document.querySelector('[data-cluster-previous]')?.addEventListener('click', async () => {
    clusterOffset = clusterHistory.pop() ?? 0;
    await loadWorkbenchCluster();
  });
  document.querySelector('[data-cluster-next]')?.addEventListener('click', async () => {
    if (activeCluster?.selection) clusterHistory.push(Number(activeCluster.selection.offset ?? clusterOffset));
    clusterOffset += 1;
    await loadWorkbenchCluster();
  });
  async function deferActiveCluster(button) {
    if (!activeCluster?.source?.id) return;
    button.disabled = true;
    try {
      await persistQueueAction('defer_source', activeCluster.source.id);
    } catch (_) {
      button.textContent = '暂缓失败，请重试';
      window.setTimeout(() => { button.textContent = '这簇暂不整合'; button.disabled = false; }, 1500);
      return;
    }
    if (!activeCluster?.selection?.has_next) {
      const nextDeferred = deferredClusterIds.find(id => id !== activeCluster.source.id);
      if (nextDeferred) {
        button.textContent = '转到本轮暂缓队尾…';
        await loadWorkbenchCluster(0, nextDeferred);
      } else {
        button.textContent = '已放到本轮队尾';
      }
      window.setTimeout(() => { button.textContent = '这簇暂不整合'; button.disabled = false; }, 1200);
      return;
    }
    button.textContent = '已暂缓，换下一簇…';
    clusterHistory.push(Number(activeCluster.selection.offset ?? clusterOffset));
    clusterOffset = Number(activeCluster.selection.offset || clusterOffset) + 1;
    await loadWorkbenchCluster();
    button.disabled = false;
    button.textContent = '这簇暂不整合';
  }
  document.querySelector('[data-cluster-defer]')?.addEventListener('click', event => deferActiveCluster(event.currentTarget));

  document.querySelector('[data-real-cluster-previous]')?.addEventListener('click', async () => {
    clusterOffset = clusterHistory.pop() ?? 0;
    await loadWorkbenchCluster();
  });
  document.querySelector('[data-real-cluster-next]')?.addEventListener('click', async () => {
    if (activeCluster?.selection) clusterHistory.push(Number(activeCluster.selection.offset ?? clusterOffset));
    clusterOffset += 1;
    await loadWorkbenchCluster();
  });
  document.querySelector('[data-real-cluster-defer]')?.addEventListener('click', event => deferActiveCluster(event.currentTarget));

  let candidateRows = [];
  let candidateAllRows = [];
  let candidateGroups = [];
  let candidateIndex = 0;
  let candidateShredPolicy = { enabled: true, retention_hours: 168 };
  let candidateExperiencePolicy = { mode: 'off', window_hours: 24, adoption_threshold: 2, max_recall: 1 };
  let candidateSchedulePolicy = { batch_times:['11:55','23:55'], settlement_time:'23:55', stats_days:6 };
  let identityRoutingPolicy = { enabled: true, retain_memory_copy: false };
  let backendRevisionPolicy = { archive_source_after_profile_routing: false };
  let profileRecallPolicy = { modules: {
    agent_profile: { conversation_enabled: true, growth_enabled: false },
    user_profile: { conversation_enabled: true, growth_enabled: false }
  } };
  let profileGrowthCandidates = [];
  let jevSettings = { enabled: false, configured: false, use_for_wakeup: true };
  const candidateWorkset = new Map();
  const candidateRelations = new Map();
  const candidateWorksetOpen = new Set();
  const mergeDraftPayloads = new Map();
  let candidateMasterId = '';
  const relationLabels = { duplicate: '重复', supplement: '补充', evolution: '阶段更迭', conflict: '真实冲突', related: '仅相关' };
  const candidateAreaLabels = { life: '生活', relations: '关系', action: '行动', self: '自我', interest: '兴趣', study: '学习', work: '行动', mail: '关系', game: '兴趣' };
  const candidatePrimaryAreaIds = ['life','relations','action','self','interest','study'];
  function candidateTimestamp(row) {
    return Date.parse(row?.occurred_at || row?.candidate_entered_at || row?.created_at || '') || 0;
  }
  function buildCandidateDisplayGroups(rows) {
    const streams = new Map();
    rows.forEach((row, index) => {
      const sourceRef = String(row?.source?.ref || '').trim();
      const key = sourceRef || `candidate:${row.id || index}`;
      if (!streams.has(key)) streams.set(key, []);
      streams.get(key).push(row);
    });
    const groups = [];
    streams.forEach((stream, sourceRef) => {
      const ordered = [...stream].sort((a, b) => candidateTimestamp(a) - candidateTimestamp(b));
      let members = [];
      let previousAt = 0;
      ordered.forEach(row => {
        const at = candidateTimestamp(row);
        if (members.length && at && previousAt && at - previousAt > 60 * 60 * 1000) {
          groups.push({ id:`${sourceRef}:${previousAt}`, sourceRef, members:[...members].reverse(), latestAt:previousAt });
          members = [];
        }
        members.push(row);
        previousAt = at || previousAt;
      });
      if (members.length) groups.push({ id:`${sourceRef}:${previousAt}`, sourceRef, members:[...members].reverse(), latestAt:previousAt });
    });
    return groups.sort((a, b) => b.latestAt - a.latestAt);
  }
  function candidateGroupFor(row) {
    return candidateGroups.find(group => group.members.some(member => member.id === row?.id));
  }
  function mergedDraftAreaSuggestion(sources) {
    const byArea = new Map();
    sources.forEach(source => (source.service_area_suggestion?.areas || []).forEach(item => {
      const area = String(item.area || '').trim();
      const weight = Number(item.weight || 0);
      if (!area || !Number.isFinite(weight)) return;
      const previous = byArea.get(area);
      if (!previous || weight > previous.weight) byArea.set(area, { ...item, area, weight });
    }));
    return {
      areas:[...byArea.values()].sort((left, right) => right.weight - left.weight),
      source:'merged_candidate_preview',
      confirmed:false
    };
  }
  function openMergeStructureDraft(payload) {
    const draftId = String(payload.draft_id || '');
    mergeDraftPayloads.set(draftId, payload);
    let row = candidateRows.find(item => item._merge_draft_id === draftId);
    if (!row) {
      const sources = [...candidateWorkset.values()];
      row = {
        id:`merge-draft:${draftId}`,
        _merge_draft_id:draftId,
        _is_merge_structure_draft:true,
        title:payload.result_preview?.title || '待修订的整合记忆',
        content:payload.result_preview?.content || '',
        kind:candidateWorkset.get(candidateMasterId)?.kind || 'event',
        tags:[...new Set(sources.flatMap(item => Array.isArray(item.tags) ? item.tags : []))],
        occurred_at:new Date().toISOString(),
        created_at:new Date().toISOString(),
        service_area_suggestion:mergedDraftAreaSuggestion(sources),
        neighbor_evidence:{candidate_neighbors:[],memory_neighbors:[]},
        event_match_suggestions:[]
      };
      candidateRows.push(row);
      candidateAllRows.push(row);
    }
    candidateIndex = candidateRows.indexOf(row);
    renderCandidate();
    document.querySelector('[data-candidate-studio-step="classify"]')?.click();
    return row;
  }
  async function syncMergeDraftStructure(row, memoryId) {
    if (!row || !memoryId) return;
    const jobs = [];
    if (row.structured_keywords?.confirmed) jobs.push(fetch('/api/memory-preview/service-areas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'save_keywords', memory_id:memoryId, keywords:{ subjects:row.structured_keywords.subjects || [], entities:row.structured_keywords.entities || [], actions:row.structured_keywords.actions || [], states:row.structured_keywords.states || [], times:row.structured_keywords.dates || row.structured_keywords.times || [] }, actor:'human:xiaoran', reason:'整合草稿完成结构修订后同步到正式记忆' }) }));
    if (row.service_area_assignment) jobs.push(fetch('/api/memory-preview/service-areas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'save_assignment', memory_id:memoryId, areas:row.service_area_assignment.areas || [], weights:row.service_area_assignment.weights || {}, actor:'human:xiaoran', reason:'整合草稿完成分区修订后同步到正式记忆' }) }));
    if (jobs.length) {
      const responses = await Promise.all(jobs);
      if (responses.some(response => !response.ok)) throw new Error('structure_sync_failed');
    }
  }
  async function executeCandidateMergeDraft(payload, code, status, button) {
    if (code !== payload.confirmation_code) { status.textContent = '确认码不匹配，没有写入。'; return; }
    button.disabled = true;
    status.textContent = '正在写入记忆库并同步结构修订……';
    try {
      const response = await fetch('/api/memory-preview/actions/execute', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ draft_id:payload.draft_id, confirmation_code:code }) });
      const executed = await response.json();
      if (!response.ok) throw new Error(executed.error || `execute_${response.status}`);
      const structureDraft = candidateRows.find(row => row._merge_draft_id === payload.draft_id);
      try {
        await syncMergeDraftStructure(structureDraft, executed.memory?.id);
        status.textContent = `已正式入库；${executed.concluded_candidate_ids.length} 条来源候选共同结案，可在48小时内回退。`;
      } catch (_) {
        status.textContent = `整合记忆已正式入库；${executed.concluded_candidate_ids.length} 条来源候选共同结案。结构旁路同步暂时失败，可稍后在正式记忆中重试。`;
      }
      placeWrittenMemoryInLibrary(executed.memory);
      mergeDraftPayloads.delete(payload.draft_id);
      clearCandidateMergeWorkspace();
      await loadCandidates();
      await refreshAfterMemoryChange({ skipLibrary:true });
    } catch (error) {
      button.disabled = false;
      status.textContent = `没有写入：${error.message}`;
    }
  }
  function clearCandidateMergeWorkspace() {
    candidateWorkset.clear();
    candidateRelations.clear();
    candidateWorksetOpen.clear();
    candidateMasterId = '';
    renderCandidateWorkset();
    const preview = document.querySelector('[data-candidate-workbench-preview]');
    if (preview) preview.innerHTML = '<p>本次整合已完成，可以重新添加候选。</p>';
    const trigger = document.querySelector('[data-preview-candidate-workset]');
    if (trigger) { trigger.disabled = true; trigger.textContent = '生成合并预览'; }
  }
  function renderCandidateWorkset() {
    const container = document.querySelector('[data-candidate-workset]');
    const rows = [...candidateWorkset.values()].sort((a,b) => {
      const aTime = Date.parse(a.occurred_at || a.created_at || '') || 0;
      const bTime = Date.parse(b.occurred_at || b.created_at || '') || 0;
      return aTime - bTime;
    });
    const eligibleRows = rows.filter(row => !['identity', 'relationship'].includes(row.kind));
    if (!candidateMasterId || !candidateWorkset.has(candidateMasterId)
      || ['identity', 'relationship'].includes(candidateWorkset.get(candidateMasterId)?.kind)) {
      candidateMasterId = eligibleRows[0]?.id || '';
    }
    const count = document.querySelector('[data-candidate-workset-count]');
    if (count) count.textContent = `${rows.length} 条`;
    document.querySelector('[data-preview-candidate-workset]').disabled = rows.length < 2 || !candidateMasterId;
    if (!rows.length) { container.innerHTML = '<p>先从上方候选卡加入至少两条。</p>'; return; }
    container.innerHTML = `${!candidateMasterId && rows.length >= 2 ? '<p>这些都是关系／身份候选，需要走专门归位复核；普通合并预览必须有一条可承载的事件、项目、决定、偏好或反思候选。</p>' : ''}${rows.map(row => { const protectedRow = ['identity','relationship'].includes(row.kind); const open = candidateWorksetOpen.has(row.id); return `<article class="candidate-workset-item t-acc" data-candidate-workset-id="${escapeHtml(row.id)}" data-open="${open}">
      <div class="candidate-workset-head"><button class="candidate-workset-summary t-acc-head" type="button" aria-expanded="${open}"><span class="candidate-workset-dot" aria-hidden="true"></span><span><strong>${escapeHtml(row.title)}</strong><small>${row.id === candidateMasterId ? '主候选' : protectedRow ? '受保护来源' : '候选成员'}</small></span></button><button class="candidate-workset-remove" type="button" data-remove-workset-candidate>移除</button></div>
      <div class="candidate-workset-panel t-acc-panel"><div class="candidate-workset-panel-inner t-acc-panel-inner">
        <p class="candidate-workset-content">${escapeHtml(row.content || '这条候选暂时没有正文。')}</p>
        <div class="candidate-workset-meta"><time>${escapeHtml(relativeTime(row.occurred_at || row.created_at))}</time><span>${escapeHtml(row.kind || '候选记忆')}</span></div>
        <label class="candidate-master-choice"><input type="radio" name="candidate-master" value="${escapeHtml(row.id)}" ${row.id === candidateMasterId ? 'checked' : ''} ${protectedRow ? 'disabled' : ''}><span><strong>作为合并后的承载候选</strong><small>${row.time_identity?.time_event_id ? escapeHtml(row.time_identity.time_event_id) : '时间证据不足，不自动判重'}</small></span></label>
      </div></div>
    </article>`; }).join('')}`;
    container.querySelectorAll('input[name="candidate-master"]').forEach(input => input.addEventListener('change', () => { candidateMasterId = input.value; renderCandidateWorkset(); }));
    container.querySelectorAll('[data-candidate-workset-id]').forEach(article => {
      const id = article.dataset.candidateWorksetId;
      article.querySelector('.candidate-workset-summary')?.addEventListener('click', event => {
        const open = article.dataset.open !== 'true';
        article.dataset.open = String(open);
        event.currentTarget.setAttribute('aria-expanded', String(open));
        if (open) candidateWorksetOpen.add(id); else candidateWorksetOpen.delete(id);
      });
      article.querySelector('[data-remove-workset-candidate]').addEventListener('click', () => { candidateWorkset.delete(id); candidateRelations.delete(id); candidateWorksetOpen.delete(id); renderCandidateWorkset(); });
    });
  }
  function addCandidateToWorkset(row) {
    if (!row || candidateWorkset.has(row.id)) return;
    const timeEventId = row.time_identity?.dedupe_eligible ? row.time_identity.time_event_id : null;
    const duplicate = timeEventId ? [...candidateWorkset.values()].find(item => item.time_identity?.dedupe_eligible && item.time_identity.time_event_id === timeEventId) : null;
    if (duplicate) {
      alert(`这条候选与「${duplicate.title}」拥有相同时间事件 ID，已阻止重复加入。若它们实际是不同事件，请先修订对象、动作或来源证据。`);
      return;
    }
    candidateWorkset.set(row.id, row);
    candidateRelations.set(row.id, 'supplement');
    if (!candidateMasterId && !['identity', 'relationship'].includes(row.kind)) candidateMasterId = row.id;
    renderCandidateWorkset();
  }
  function renderCandidateSearch(query = '') {
    const target = document.querySelector('[data-candidate-search-results]');
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) { target.innerHTML = '<small>输入关键词，从全部待判断候选中添加。</small>'; return; }
    const rows = candidateAllRows.filter(row => [row.title, row.content, ...(row.tags || [])].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(normalized))).slice(0, 8);
    target.innerHTML = rows.length ? rows.map(row => `<button type="button" data-add-search-candidate="${escapeHtml(row.id)}" ${candidateWorkset.has(row.id) ? 'disabled' : ''}><span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.kind || 'event')}</small></span><i>${candidateWorkset.has(row.id) ? '已添加' : '＋'}</i></button>`).join('') : '<small>没有找到匹配候选。</small>';
    target.querySelectorAll('[data-add-search-candidate]').forEach(button => button.addEventListener('click', () => { addCandidateToWorkset(candidateAllRows.find(row => row.id === button.dataset.addSearchCandidate)); renderCandidateSearch(query); }));
  }
  function candidateKeywordEvidence(row) {
    const routed = row.topic_evidence || {};
    const routedTopics = Array.isArray(routed.topics) ? routed.topics : [];
    if (routedTopics.length) {
      return { topics: routedTopics, fields: [String(row.title || ''), String(row.content || '')],
        spans: routedTopics.flatMap(topic => (topic.matched_spans || []).map(span => ({ ...span, topic_name: topic.name }))) };
    }
    const fields = [String(row.title || ''), String(row.content || '')];
    const terms = [...new Set((row.tags || []).map(tag => String(tag || '').trim()).filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    const matched = terms.filter(term => fields.some(field => field.toLocaleLowerCase('zh-CN').includes(term.toLocaleLowerCase('zh-CN'))));
    return { terms: matched, fields, topics: [], spans: [] };
  }
  function highlightCandidateKeywords(text, evidence, field) {
    const raw = String(text || '');
    const routedSpans = (evidence.spans || []).filter(span => span.field === field && span.start >= 0 && span.end <= raw.length)
      .sort((left, right) => left.start - right.start || right.end - left.end);
    if (routedSpans.length) {
      const rank = { veto: 4, exact: 3, alias: 2, supporting: 1 };
      const spans = [];
      for (const span of routedSpans) {
        const overlap = spans.find(old => span.start < old.end && span.end > old.start);
        if (!overlap) spans.push(span);
        else if ((rank[span.evidence] || 0) > (rank[overlap.evidence] || 0)) Object.assign(overlap, span);
      }
      spans.sort((left, right) => left.start - right.start);
      let cursor = 0;
      return spans.map(span => {
        const before = escapeHtml(raw.slice(cursor, span.start));
        const hit = `<mark class="candidate-keyword-hit is-${escapeHtml(span.evidence)}" title="${escapeHtml(span.topic_name || '')} · ${escapeHtml(span.evidence)}">${escapeHtml(raw.slice(span.start, span.end))}</mark>`;
        cursor = span.end;
        return before + hit;
      }).join('') + escapeHtml(raw.slice(cursor));
    }
    const terms = evidence.terms || [];
    const folded = raw.toLocaleLowerCase('zh-CN');
    const spans = [];
    for (const term of terms) {
      const needle = term.toLocaleLowerCase('zh-CN');
      let start = 0;
      while (needle && (start = folded.indexOf(needle, start)) !== -1) {
        const end = start + needle.length;
        if (!spans.some(span => start < span.end && end > span.start)) spans.push({ start, end });
        start = end;
      }
    }
    spans.sort((left, right) => left.start - right.start);
    let cursor = 0;
    return spans.map(span => {
      const before = escapeHtml(raw.slice(cursor, span.start));
      const hit = `<mark class="candidate-keyword-hit">${escapeHtml(raw.slice(span.start, span.end))}</mark>`;
      cursor = span.end;
      return before + hit;
    }).join('') + escapeHtml(raw.slice(cursor));
  }
  const structureActionWords = ['新增','加入','建立','接入','部署','发布','完成','修复','修改','升级','恢复','确认','决定','选择','拒绝','停止','开始','回复','发送','整合','拆分','归档','召回','认识','讨论','测试','验收'];
  const structureStateWords = ['完成','运行正常','已上线','已部署','已发布','已恢复','已确认','当前','持续','等待','暂停','关闭','失败','异常','未完成','尚未','不再','保留','独立','私密','公开'];
  function normalizedCandidateDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }
  function candidateStructuredKeywords(row) {
    const suppliedKeywords = row.structured_keywords;
    const suppliedHasValues = suppliedKeywords && ['subjects','entities','actions','states','dates','times']
      .some(field => Array.isArray(suppliedKeywords[field]) && suppliedKeywords[field].length);
    if (suppliedKeywords && (suppliedHasValues || suppliedKeywords.confirmed === true)) {
      const source = suppliedKeywords;
      const list = value => Array.isArray(value) ? value : [];
      return {
        ...source,
        subjects: list(source.subjects),
        entities: list(source.entities),
        actions: list(source.actions),
        states: list(source.states),
        // The current index calls this dimension `times`; older manually
        // reviewed records used `dates`. Accept both at the UI boundary.
        dates: list(source.dates).length ? list(source.dates) : list(source.times)
      };
    }
    const text = `${row.title || ''}\n${row.content || ''}`;
    const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 8);
    const actions = unique(structureActionWords.filter(word => text.includes(word)));
    const states = unique(structureStateWords.filter(word => text.includes(word)));
    const blocked = new Set([...actions, ...states, '事件', '项目', '决定', '偏好', '反思', '关系']);
    const entities = unique((row.tags || []).filter(tag => !blocked.has(String(tag)) && text.includes(String(tag))));
    const date = normalizedCandidateDate(row.occurred_at || row.created_at);
    return { subjects: [], entities, actions, states, dates: date ? [date] : [] };
  }
  function structuredKeywordStrip(row) {
    const groups = candidateStructuredKeywords(row);
    const rows = [['主体', 'subjects', groups.subjects], ['动作', 'actions', groups.actions], ['对象', 'entities', groups.entities], ['状态', 'states', groups.states], ['时间', 'times', groups.dates]];
    const visibleRows = rows.map(([label, key, values]) => [label, key, key === 'times' ? (values || []).slice(0, 1) : values]);
    const chips = visibleRows.flatMap(([label, key, values]) => (values || []).map(value => `<span class="structured-keyword-chip" data-keyword-kind="${key}"><i>${label}</i>${escapeHtml(value)}</span>`)).join('') || '<span class="structured-keyword-empty">暂无关键词</span>';
    return `<section class="candidate-structured-keywords" aria-label="结构关键词"><header><strong>关键词</strong><small>${groups.confirmed ? '已人工修订' : '系统自动分类 · 可不修改'}</small></header><div class="structured-keyword-line">${chips}</div><details class="structured-keyword-editor"><summary>修订分类（可选）</summary><div>${visibleRows.map(([label, key, values]) => `<label><b>${label}</b><input data-structured-keyword="${key}" value="${escapeHtml((values || []).join('、'))}" placeholder="用顿号或逗号分隔"></label>`).join('')}</div><footer><span>不需要手动修改；保持原样时系统会按主体→动作→对象→状态→时间自动分类，也不会改动记忆正文。</span><button type="button" data-save-candidate-keywords>保存关键词</button></footer></details></section>`;
  }
  function openCandidateWorkbench() {
    const button = document.querySelector('[data-candidate-overview-tab="workbench"]');
    if (button) setCandidateOverviewTab(button);
  }
  function mountCandidateSettings() {
    const mount = document.querySelector('[data-candidate-settings-mount]');
    if (!mount) return;
    const ids = ['candidateScheduleTitle', 'candidateRetentionTitle', 'candidateExperienceTitle', 'identityRoutingTitle', 'profileRecallTitle'];
    const sections = ids.map(id => document.getElementById(id)?.closest('.candidate-retention-settings')).filter(Boolean);
    sections.forEach((section, index) => {
      const heading = section.querySelector('h2');
      const eyebrow = section.querySelector('header small')?.textContent || 'CANDIDATE SETTING';
      const stage = section.querySelector('header > span, header .profile-policy-stage')?.textContent?.trim() || '可调整';
      const originalChildren = [...section.children];
      const preview = document.createElement('div');
      preview.className = 'candidate-setting-preview';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'candidate-setting-head t-acc-head';
      head.setAttribute('aria-expanded', 'false');
      head.innerHTML = `<i>${String(index + 1).padStart(2, '0')}</i><span><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(heading?.textContent || '候选设置')}</strong></span>`;
      const controls = document.createElement('div');
      controls.className = 'candidate-setting-controls';
      if (heading?.id === 'candidateScheduleTitle') {
        head.classList.add('candidate-schedule-head');
        const form = section.querySelector('[data-candidate-schedule-form]');
        if (form) controls.appendChild(form);
      } else if (heading?.id === 'candidateRetentionTitle') {
        section.querySelectorAll(':scope > .candidate-retention-main, :scope > .candidate-retention-options').forEach(node => controls.appendChild(node));
      } else if (heading?.id === 'candidateExperienceTitle') {
        const mode = section.querySelector(':scope > .governance-options');
        if (mode) controls.appendChild(mode);
      } else if (heading?.id === 'identityRoutingTitle') {
        section.querySelectorAll(':scope > .candidate-retention-main').forEach(node => controls.appendChild(node));
      } else if (heading?.id === 'profileRecallTitle') {
        section.querySelectorAll(':scope > .profile-policy-card').forEach(card => {
          const group = document.createElement('section');
          group.className = 'candidate-setting-profile-controls';
          group.dataset.profileControlModule = card.dataset.profileModule;
          const label = document.createElement('strong');
          label.textContent = card.querySelector(':scope > header strong')?.textContent || '档案';
          group.appendChild(label);
          card.querySelectorAll(':scope > .candidate-retention-main').forEach(node => group.appendChild(node));
          controls.appendChild(group);
        });
      }
      preview.append(head);
      if (controls.childElementCount) preview.append(controls);
      const panel = document.createElement('div');
      panel.className = 'candidate-setting-panel t-acc-panel';
      const inner = document.createElement('div');
      inner.className = 'candidate-setting-inner t-acc-panel-inner';
      originalChildren.filter(child => child.parentNode === section).forEach(child => inner.appendChild(child));
      panel.appendChild(inner);
      section.classList.add('candidate-setting-item', 't-acc');
      section.dataset.open = 'false';
      section.querySelectorAll(':scope > .candidate-retention-help-panel').forEach(help => { help.dataset.open = 'true'; });
      section.append(preview, panel);
      head.addEventListener('click', () => {
        const willOpen = section.dataset.open !== 'true';
        sections.forEach(other => {
          other.dataset.open = 'false';
          other.querySelector('.candidate-setting-head')?.setAttribute('aria-expanded', 'false');
        });
        section.dataset.open = String(willOpen);
        head.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) requestAnimationFrame(() => section.scrollIntoView({ behavior:'smooth', block:'nearest' }));
      });
      mount.appendChild(section);
    });
    auditCandidateSettingsBackends();
  }
  async function auditCandidateSettingsBackends() {
    const audit = document.querySelector('[data-candidate-settings-audit]');
    if (!audit) return;
    const endpoints = [
      '/api/memory-preview/candidates',
      '/api/memory-preview/candidate-experience-policy',
      '/api/memory-preview/candidate-schedule-policy',
      '/api/memory-preview/identity-relation-routing-policy',
      '/api/memory-preview/profile-recall-policy',
      '/api/memory-preview/profile-growth-candidates'
    ];
    const results = await Promise.allSettled(endpoints.map(endpoint => fetch(endpoint, { cache:'no-store' }).then(response => {
      if (!response.ok) throw new Error(`${endpoint}_${response.status}`);
      return response.json();
    })));
    const ready = results.filter(result => result.status === 'fulfilled').length;
    audit.textContent = ready === endpoints.length ? `${ready}/${endpoints.length} 条后端链路正常` : `${ready}/${endpoints.length} 条后端链路可用`;
    audit.dataset.ready = String(ready === endpoints.length);
  }
  mountCandidateSettings();
  function renderRoutingCandidates(routingPayload, profilePayload) {
    const routed = (routingPayload.items || routingPayload.candidates || []).filter(row => ['identity', 'relationship'].includes(row.kind)).map(row => ({
      ...row,
      destination: row.kind === 'identity' ? 'self-core' : '关系网'
    }));
    const profiles = (profilePayload.pending || []).filter(row => ['user_profile', 'xiaoran_profile'].includes(row.module)).map(row => ({
      ...row,
      destination: '用户画像',
      preview: row.content
    }));
    const groups = {
      relation_graph: routed.filter(row => row.kind === 'relationship'),
      self_core: routed.filter(row => row.kind === 'identity'),
      user_profile: profiles
    };
    const pendingTotal = Number(routingPayload.pending_protected_count || routed.length) + profiles.length;
    const total = document.querySelector('[data-candidate-routing-total]');
    if (total) total.textContent = `${pendingTotal} 条待确认`;
    Object.entries(groups).forEach(([destination, rows]) => {
      const target = document.querySelector(`[data-candidate-routing-list="${destination}"]`);
      const count = document.querySelector(`[data-candidate-routing-count="${destination}"]`);
      if (count) count.textContent = rows.length;
      if (!target) return;
      if (!rows.length) { target.innerHTML = '<p>当前轮次没有这一类候选。</p>'; return; }
      target.innerHTML = `<div class="candidate-routing-list">${rows.map(row => `<article class="candidate-routing-item"><div><strong>${escapeHtml(row.title || '未命名候选')}</strong><small>${escapeHtml(relativeTime(row.candidate_entered_at || row.created_at || row.occurred_at))} · 等待确认去向</small></div><span>${escapeHtml(row.destination)}</span></article>`).join('')}</div>`;
    });
  }
  async function loadRoutingCandidates() {
    try {
      const [routingResponse, profileResponse] = await Promise.all([
        fetch('/api/memory-preview/candidates', { cache:'no-store' }),
        fetch('/api/memory-preview/profile-growth-candidates', { cache:'no-store' })
      ]);
      if (!routingResponse.ok || !profileResponse.ok) throw new Error('routing_candidates_unavailable');
      renderRoutingCandidates(await routingResponse.json(), await profileResponse.json());
    } catch (_) {
      document.querySelectorAll('[data-candidate-routing-list]').forEach(target => { target.innerHTML = '<p>专项候选暂时没有读到，候选内容没有变化。</p>'; });
      document.querySelectorAll('[data-candidate-routing-count]').forEach(count => { count.textContent = '—'; });
      const total = document.querySelector('[data-candidate-routing-total]');
      if (total) total.textContent = '暂时无法读取';
    }
  }
  function renderCandidate() {
    const card = document.querySelector('[data-candidate-card]');
    const position = document.querySelector('[data-candidate-position]');
    const studio = document.querySelector('[data-candidate-studio]');
    const rail = document.querySelector('.candidate-studio-rail');
    // These persistent controls are moved into the rendered card. Move them
    // out before replacing the card so their listeners survive every refresh.
    if (rail && card.contains(rail)) studio?.prepend(rail);
    const row = candidateRows[candidateIndex];
    if (!row) { position.textContent = '没有待判断候选'; card.innerHTML = '<p>候选箱现在是空的。</p>'; return; }
    const sourceGroup = candidateGroupFor(row);
    const sourceMemberIndex = sourceGroup ? sourceGroup.members.findIndex(member => member.id === row.id) : -1;
    const sourceGroupStrip = sourceGroup?.members.length > 1 ? `<details class="candidate-source-group"><summary><span><strong>同一段对话来源</strong><small>${sourceGroup.members.length} 条候选 · 仅折叠展示，仍各自独立</small></span><em>展开</em></summary><div>${sourceGroup.members.map((member, index) => `<button type="button" data-source-group-member="${escapeHtml(member.id)}" class="${member.id === row.id ? 'is-current' : ''}"><span>${escapeHtml(member.title || '未命名候选')}</span><time>${escapeHtml(shortDate(member.occurred_at || member.created_at))}</time></button>`).join('')}</div></details>` : '';
    const candidateNeighbors = row.neighbor_evidence?.candidate_neighbors || [];
    const memoryNeighbors = row.neighbor_evidence?.memory_neighbors || [];
    const neighborList = [...candidateNeighbors.map(item => ({ ...item, origin: '候选' })), ...memoryNeighbors.map(item => ({ ...item, origin: '记忆库' }))];
    const keywordEvidence = candidateKeywordEvidence(row);
    const eventSuggestions = row.event_match_suggestions || [];
    const eventStrip = eventSuggestions.length ? `<section class="candidate-event-suggestions"><header><strong>可能属于同一事件</strong><small>仅供检查</small></header>${eventSuggestions.map(item => `<article><b>${escapeHtml(item.title || item.candidate_id)}</b><span>${escapeHtml((item.evidence?.shared_keywords || []).join('、') || '无共同词')} · 相隔 ${Number(item.evidence?.time_gap_minutes || 0)} 分钟</span><small>${item.blockers?.length ? `已阻断：${escapeHtml(item.blockers.join('、'))}` : '对象与动作连续性尚未确认'}</small></article>`).join('')}<footer>不会自动合篮；确认后仍保留来源与拆回能力。</footer></section>` : '';
    const confirmedAreas = row.service_area_assignment?.areas || [];
    const suggestedAreas = row.service_area_suggestion?.areas || [];
    const rankedAreaIds = suggestedAreas.map(item => item.area);
    const areaIds = [...new Set([...(confirmedAreas.length ? confirmedAreas : rankedAreaIds), ...rankedAreaIds, ...candidatePrimaryAreaIds])];
    const selectedAreas = new Set(confirmedAreas.length ? confirmedAreas : suggestedAreas.map(item => item.area));
    const areaWeights = Object.fromEntries(areaIds.map(area => [area, Number(row.service_area_assignment?.weights?.[area] ?? suggestedAreas.find(item => item.area === area)?.weight ?? .5)]));
    const suggestedAreaText = suggestedAreas.map(item => `${candidateAreaLabels[item.area] || item.area} ${Number(item.weight || 0).toFixed(2)}`).join(' · ');
    const suggestionNotice = confirmedAreas.length && suggestedAreaText ? `<p class="candidate-area-recalculated">新关键词建议：${escapeHtml(suggestedAreaText)}<small>仅供比较，不覆盖已确认分区</small></p>` : '';
    const areaStrip = `<section class="candidate-area-editor"><header><strong>${confirmedAreas.length ? '分区修订' : '自动分区预览'}</strong><small>${confirmedAreas.length ? '已人工确认' : '系统建议 · 可手动更改'}</small></header>${suggestionNotice}<div>${areaIds.map(area => `<label><input type="checkbox" data-candidate-area="${escapeHtml(area)}" ${selectedAreas.has(area) ? 'checked' : ''}><span>${escapeHtml(candidateAreaLabels[area] || area)}</span><input type="range" data-candidate-area-weight="${escapeHtml(area)}" min="0" max="1" step="0.01" value="${areaWeights[area]}"><output>${areaWeights[area].toFixed(2)}</output></label>`).join('')}</div><footer><span>不需要手动修改；保持默认就按这份预览分区。勾选和权重都可以调整，不改变记忆重要度，也不会自动合并。</span><button type="button" data-save-candidate-areas>保存分区</button></footer></section>`;
    const mergePayload = row._merge_draft_id ? mergeDraftPayloads.get(row._merge_draft_id) : null;
    const mergeDraftAdmission = mergePayload ? `<section class="merge-draft-admission"><header><strong>结构修订（可选）</strong><small>不修改也可以直接入库</small></header><label>输入确认码 <b>${escapeHtml(mergePayload.confirmation_code)}</b><input inputmode="numeric" maxlength="6" data-merge-draft-confirm-code placeholder="六位确认码"></label><button type="button" data-execute-merge-draft>确认并入库</button><small data-merge-draft-status>保持默认时，系统会根据整合后的正文自动生成关键词并分区；只有你保存过的修订才会覆盖默认结果。</small></section>` : '';
    position.textContent = `${candidateIndex + 1} / ${candidateRows.length} 组${sourceGroup?.members.length > 1 ? ` · 组内 ${sourceMemberIndex + 1} / ${sourceGroup.members.length}` : ''}`;
    const addState = row._is_merge_structure_draft ? ['整合草稿',true] : candidateWorkset.has(row.id) ? ['已添加',true] : ['添加当前记忆',false];
    const eventDate = shortDate(row.occurred_at || row.created_at);
    const candidateDate = shortDate(row.candidate_entered_at || row.created_at);
    card.innerHTML = `<article class="candidate-paper t-stagger${row._is_merge_structure_draft ? ' is-merge-structure-draft' : ''}"><section class="candidate-record-card"><h3 class="t-stagger-line t-stagger-line--1">${highlightCandidateKeywords(row.title, keywordEvidence, 'title')}</h3><p class="t-stagger-line t-stagger-line--2">${highlightCandidateKeywords(row.content, keywordEvidence, 'content')}</p><footer class="candidate-record-footer t-stagger-line t-stagger-line--3"><time class="candidate-record-time">事件 ${escapeHtml(eventDate)} · 进入候选 ${escapeHtml(candidateDate)}</time><button type="button" data-add-current-candidate ${addState[1] ? 'disabled' : ''}>${addState[0]}</button></footer></section>${sourceGroupStrip}<div class="candidate-work-zone"><div data-candidate-rail-slot></div><div class="candidate-work-zone-main"><section class="candidate-step-workspace">${structuredKeywordStrip(row)}${areaStrip}${mergeDraftAdmission}${eventStrip}<section class="candidate-neighbors"><header><strong>砾砾找到的线索</strong><small>关系仍未判断</small></header>${neighborList.length ? neighborList.map(item => { const neighborId = item.id || item.candidate_id || ''; return `<div><span><b>${escapeHtml(item.title || neighborId)}</b><small>${item.origin} · ${Math.round(Number(item.similarity || 0) * 100)}%</small></span>${item.origin === '候选' && neighborId ? `<button type="button" data-add-neighbor-candidate="${escapeHtml(neighborId)}">加入本次合并</button>` : '<em>已在记忆库</em>'}</div>`; }).join('') : '<p>目前没有超过门槛的相似线索。</p>'}</section><button class="candidate-independent-next" type="button" data-candidate-independent-next>无需合并，继续归类</button><button class="candidate-independent-admit" type="button" data-candidate-independent-admit>完成归类并入库</button><div class="candidate-independent-result" data-candidate-independent-result></div></section></div></div></article>`;
    const railSlot = card.querySelector('[data-candidate-rail-slot]');
    if (rail && railSlot) railSlot.appendChild(rail);
    const reveal = card.querySelector('.t-stagger');
    requestAnimationFrame(() => reveal?.classList.add('is-shown'));
    card.querySelectorAll('[data-source-group-member]').forEach(button => button.addEventListener('click', () => {
      const member = sourceGroup?.members.find(item => item.id === button.dataset.sourceGroupMember);
      if (!member) return;
      candidateRows[candidateIndex] = member;
      renderCandidate();
    }));
    card.querySelector('[data-add-current-candidate]')?.addEventListener('click', event => {
      addCandidateToWorkset(row);
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = '已添加';
    });
    card.querySelector('[data-execute-merge-draft]')?.addEventListener('click', async event => {
      const status = card.querySelector('[data-merge-draft-status]');
      const code = card.querySelector('[data-merge-draft-confirm-code]').value.trim();
      await executeCandidateMergeDraft(mergePayload, code, status, event.currentTarget);
    });
    card.querySelectorAll('[data-add-neighbor-candidate]').forEach(button => button.addEventListener('click', () => {
      const neighbor = candidateAllRows.find(item => item.id === button.dataset.addNeighborCandidate);
      if (!neighbor) { alert('这条语义邻居已不在待判断候选中，请刷新后再试。'); return; }
      addCandidateToWorkset(row); addCandidateToWorkset(neighbor);
      const mergeStep = document.querySelector('[data-candidate-studio-step="merge"]');
      if (mergeStep && candidateWorkset.size >= 2) mergeStep.click();
      else alert('其中一条候选被事件边界保护拦住了，没有自动进入合并。');
    }));
    card.querySelector('[data-candidate-independent-next]')?.addEventListener('click', () => {
      const classify = document.querySelector('[data-candidate-studio-step="classify"]');
      classify?.click();
    });
    card.querySelector('[data-candidate-independent-admit]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const result = card.querySelector('[data-candidate-independent-result]');
      button.disabled = true; button.textContent = '正在生成入库预览…';
      try {
        const response = await fetch('/api/memory-preview/actions/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'candidate_admit', actor:'xiaoran', reason:'确认候选保持独立，完成归类后正式入库', candidate_id:row.id }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `preview_${response.status}`);
        result.innerHTML = `<p><strong>${escapeHtml(payload.result_preview.title)}</strong><span>将作为独立记忆入库，不与其他候选合并。</span></p><label>输入确认码 <b>${escapeHtml(payload.confirmation_code)}</b><input inputmode="numeric" maxlength="6" data-independent-confirm-code placeholder="六位确认码"></label><button type="button" data-execute-independent-admit>确认入库</button><small data-independent-admit-status>尚未写入；草稿十分钟内有效。</small>`;
        result.querySelector('[data-execute-independent-admit]')?.addEventListener('click', async executeEvent => {
          const code = result.querySelector('[data-independent-confirm-code]').value.trim();
          const status = result.querySelector('[data-independent-admit-status]');
          if (code !== payload.confirmation_code) { status.textContent = '确认码不匹配，没有写入。'; return; }
          executeEvent.currentTarget.disabled = true; status.textContent = '正在写入记忆库……';
          try {
            const executeResponse = await fetch('/api/memory-preview/actions/execute', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ draft_id:payload.draft_id, confirmation_code:code }) });
            const executed = await executeResponse.json();
            if (!executeResponse.ok) throw new Error(executed.error || `execute_${executeResponse.status}`);
            status.textContent = '已作为独立记忆正式入库，可在48小时内回退。';
            placeWrittenMemoryInLibrary(executed.memory);
            await loadCandidates(); await refreshAfterMemoryChange({ skipLibrary:true });
          } catch (error) { executeEvent.currentTarget.disabled = false; status.textContent = `没有写入：${error.message}`; }
        });
      } catch (error) { result.textContent = `预览失败：${error.message}。候选没有变化。`; }
      finally { button.disabled = false; button.textContent = '完成归类并入库'; }
    });
    card.querySelector('[data-save-candidate-keywords]')?.addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = '保存中…';
      const keywords = Object.fromEntries([...card.querySelectorAll('[data-structured-keyword]')].map(input => [input.dataset.structuredKeyword, input.value.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean)]));
      if (row._is_merge_structure_draft) {
        row.structured_keywords = { ...keywords, confirmed:true, source:'human_override' };
        renderCandidate();
        return;
      }
      try {
        const response = await fetch('/api/memory-preview/service-areas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_keywords', memory_id: row.id, keywords, actor: 'human:xiaoran', reason: '在正式候选箱修订结构关键词' }) });
        const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || `keyword_${response.status}`);
        const refreshedResponse = await fetch('/api/memory-preview/candidates', { cache:'no-store' });
        const refreshedPayload = await refreshedResponse.json();
        const refreshed = (refreshedPayload.candidates || []).find(item => item.id === row.id);
        row.structured_keywords = refreshed?.structured_keywords || { ...keywords, confirmed: true, source: 'human_override' };
        if (refreshed?.service_area_suggestion) row.service_area_suggestion = refreshed.service_area_suggestion;
        renderCandidate();
      } catch (error) { button.disabled = false; button.textContent = '保存关键词'; alert(`关键词没有保存：${error.message}`); }
    });
    card.querySelectorAll('[data-candidate-area-weight]').forEach(input => input.addEventListener('input', () => { input.nextElementSibling.value = Number(input.value).toFixed(2); }));
    card.querySelector('[data-save-candidate-areas]')?.addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = '保存中…';
      const areas = [...card.querySelectorAll('[data-candidate-area]:checked')].map(input => input.dataset.candidateArea);
      const weights = Object.fromEntries(areas.map(area => [area, Number(card.querySelector(`[data-candidate-area-weight="${area}"]`)?.value || .5)]));
      if (row._is_merge_structure_draft) {
        row.service_area_assignment = { areas, weights, confirmed_at:new Date().toISOString(), source:'human_override' };
        renderCandidate();
        return;
      }
      try {
        const response = await fetch('/api/memory-preview/service-areas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_assignment', memory_id: row.id, areas, weights, actor: 'human:xiaoran', reason: '在正式候选箱确认整条候选记忆的服务分区与权重' }) });
        const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || `service_area_${response.status}`);
        row.service_area_assignment = payload.state.assignments?.[row.id] || null; renderCandidate();
      } catch (error) { button.disabled = false; button.textContent = '保存分区'; alert(`分区没有保存：${error.message}`); }
    });
  }
  function renderCandidateShred(payload) {
    const policy = payload.shred_policy || {};
    const archived = payload.archived || [];
    const eligible = archived.filter(row => row.shred?.eligible);
    const next = eligible.map(row => row.shred?.shred_after).filter(Boolean).sort()[0];
    candidateShredPolicy = { enabled: policy.enabled !== false, pending_enabled: policy.pending_enabled === true, retention_hours: 168 };
    const toggle = document.querySelector('[data-candidate-shred-toggle]');
    if (toggle) {
      toggle.dataset.on = String(candidateShredPolicy.enabled);
      toggle.setAttribute('aria-checked', String(candidateShredPolicy.enabled));
    }
    const pendingToggle = document.querySelector('[data-candidate-pending-shred-toggle]');
    if (pendingToggle) {
      pendingToggle.dataset.on = String(candidateShredPolicy.pending_enabled);
      pendingToggle.setAttribute('aria-checked', String(candidateShredPolicy.pending_enabled));
    }
    document.querySelectorAll('[data-candidate-shred-hours]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.candidateShredHours) === candidateShredPolicy.retention_hours)));
    const state = document.querySelector('[data-candidate-shred-state]');
    const pendingState = document.querySelector('[data-candidate-pending-shred-state]');
    const summary = document.querySelector('[data-candidate-shred-summary]');
    const retentionLabel = candidateShredPolicy.retention_hours % 24 === 0 ? `${candidateShredPolicy.retention_hours / 24} 天` : `${candidateShredPolicy.retention_hours} 小时`;
    if (state) state.textContent = candidateShredPolicy.enabled ? `已开启 · 保留 ${retentionLabel}` : '已关闭 · 结案候选继续保留';
    if (pendingState) pendingState.textContent = candidateShredPolicy.pending_enabled ? `已开启 · 保留 ${retentionLabel}` : '已关闭 · 未处理候选继续保留';
    if (summary) summary.textContent = candidateShredPolicy.enabled
      ? `${payload.counts?.shred_eligible || 0} 条正在倒计时 · ${payload.counts?.shred_protected || 0} 条受保护${next ? ` · 最早 ${new Date(next).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}`
      : `自动粉碎已关闭 · ${eligible.length} 条普通结案候选仍保留`;
  }
  async function saveCandidateShredPolicy(nextPolicy, controls = []) {
    controls.forEach(control => { control.disabled = true; });
    try {
      const response = await fetch('/api/memory-preview/candidate-shred-policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextPolicy) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `policy_${response.status}`);
      await loadCandidates();
    } catch (error) {
      const summary = document.querySelector('[data-candidate-shred-summary]');
      if (summary) summary.textContent = `设置没有保存：${error.message}`;
      renderCandidateShred({ shred_policy: candidateShredPolicy, archived: [], counts: {} });
    } finally { controls.forEach(control => { control.disabled = false; }); }
  }
  function renderCandidateExperience(payload = {}) {
    candidateExperiencePolicy = payload.policy || candidateExperiencePolicy;
    const select = document.querySelector('[data-candidate-experience-mode]');
    const summary = document.querySelector('[data-candidate-experience-summary]');
    const eligible = document.querySelector('[data-candidate-experience-eligible]');
    if (select) select.value = candidateExperiencePolicy.mode || 'off';
    if (summary) summary.textContent = candidateExperiencePolicy.mode === 'off'
      ? '已关闭 · 候选不会参与召回或累计采用证据'
      : `已开启预览 · 24小时内采用 ${candidateExperiencePolicy.adoption_threshold || 2} 次进入待整合簇 · 已记录 ${payload.evidence_count || 0} 次采用`;
    if (eligible) eligible.innerHTML = payload.eligible?.length
      ? payload.eligible.map(row => {
        const cluster = row.cluster || {};
        const terms = (cluster.common_topic_terms || []).map(escapeHtml).join(' · ') || '尚无重复主题词';
        const members = (cluster.member_ids || []).filter(id => id !== row.candidate_id).length;
        return `<article class="candidate-retention-explainer"><strong>${escapeHtml(row.title || row.candidate_id)}</strong><p>${row.adoption_count} 次独立采用 · ${members} 条重复出现的正式记忆</p><p>共同主题线索：${terms}</p><small>附加词只作关联证据；正文与固有标签仍待工作台确认。</small></article>`;
      }).join('')
      : '目前没有达到条件的候选。';
  }
  async function loadCandidateExperience() {
    try {
      const response = await fetch('/api/memory-preview/candidate-experience-policy', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `candidate_experience_${response.status}`);
      renderCandidateExperience(payload);
    } catch (error) {
      const summary = document.querySelector('[data-candidate-experience-summary]');
      if (summary) summary.textContent = `暂时无法读取设置：${error.message}`;
    }
  }
  async function saveCandidateExperience(mode) {
    const select = document.querySelector('[data-candidate-experience-mode]');
    if (select) select.disabled = true;
    try {
      const response = await fetch('/api/memory-preview/candidate-experience-policy', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `candidate_experience_${response.status}`);
      await loadCandidateExperience();
    } catch (error) {
      renderCandidateExperience({ policy: candidateExperiencePolicy });
      document.querySelector('[data-candidate-experience-summary]').textContent = `设置没有保存：${error.message}`;
    } finally { if (select) select.disabled = false; }
  }
  function renderCandidateSchedulePolicy(policy = candidateSchedulePolicy) {
    candidateSchedulePolicy = policy;
    const times = [...document.querySelectorAll('[data-candidate-schedule-time]')];
    times.forEach((input, index) => { input.value = policy.batch_times?.[index] || ['11:55','23:55'][index]; });
    const settlement = document.querySelector('[data-candidate-settlement-time]');
    if (settlement) {
      settlement.innerHTML = (policy.batch_times || []).map(time => `<option value="${escapeHtml(time)}">${escapeHtml(time)}</option>`).join('');
      settlement.value = policy.settlement_time;
    }
    const fresh = document.querySelector('[data-candidate-fresh-limit]');
    const backlog = document.querySelector('[data-candidate-backlog-limit]');
    const days = document.querySelector('[data-candidate-stats-days]');
    if (fresh) fresh.value = policy.fresh_limit;
    if (backlog) backlog.value = policy.backlog_limit;
    if (days) days.value = policy.stats_days;
    const summary = document.querySelector('[data-candidate-schedule-summary]');
    if (summary) summary.textContent = `${policy.batch_times.join('、')} 整理 · ${policy.settlement_time} 结算 · 合格候选不设数量上限 · 保留 ${policy.stats_days} 天统计`;
  }
  async function loadCandidateSchedulePolicy() {
    try {
      const response = await fetch('/api/memory-preview/candidate-schedule-policy', { cache:'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `candidate_schedule_${response.status}`);
      renderCandidateSchedulePolicy(payload.policy);
    } catch (error) {
      const summary = document.querySelector('[data-candidate-schedule-summary]');
      if (summary) summary.textContent = `暂时无法读取整理节奏：${error.message}`;
    }
  }
  async function saveCandidateSchedulePolicy(policy) {
    const form = document.querySelector('[data-candidate-schedule-form]');
    form?.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
    try {
      const response = await fetch('/api/memory-preview/candidate-schedule-policy', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(policy) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `candidate_schedule_${response.status}`);
      renderCandidateSchedulePolicy(payload.policy);
    } catch (error) {
      renderCandidateSchedulePolicy(candidateSchedulePolicy);
      document.querySelector('[data-candidate-schedule-summary]').textContent = `设置没有保存：${error.message}`;
    } finally { form?.querySelectorAll('button,input,select').forEach(control => { control.disabled = false; }); }
  }
  function renderIdentityRoutingPolicy(policy) {
    identityRoutingPolicy = { enabled: policy?.enabled !== false, retain_memory_copy: policy?.retain_memory_copy === true };
    const toggle = document.querySelector('[data-identity-routing-toggle]');
    const copy = document.querySelector('[data-identity-routing-copy]');
    const state = document.querySelector('[data-identity-routing-state]');
    const summary = document.querySelector('[data-identity-routing-summary]');
    if (toggle) { toggle.dataset.on = String(identityRoutingPolicy.enabled); toggle.setAttribute('aria-checked', String(identityRoutingPolicy.enabled)); }
    if (copy) {
      copy.dataset.on = String(identityRoutingPolicy.retain_memory_copy);
      copy.setAttribute('aria-checked', String(identityRoutingPolicy.retain_memory_copy));
      copy.disabled = !identityRoutingPolicy.enabled;
    }
    if (state) state.textContent = identityRoutingPolicy.enabled ? '已开启 · 与整合审阅同级' : '已关闭 · 留在普通候选箱';
    if (summary) summary.textContent = identityRoutingPolicy.enabled
      ? `由小机自己整理到 self-core 或关系网${identityRoutingPolicy.retain_memory_copy ? '，并保留普通记忆副本' : '，不重复写入普通记忆库'}`
      : '身份与关系候选不会自动进入小机工作台。';
  }
  async function loadIdentityRoutingPolicy() {
    try {
      const response = await fetch('/api/memory-preview/identity-relation-routing-policy', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `routing_policy_${response.status}`);
      renderIdentityRoutingPolicy(payload.policy);
    } catch (_) {
      const summary = document.querySelector('[data-identity-routing-summary]');
      if (summary) summary.textContent = '暂时无法读取设置；现有分流状态没有改变。';
    }
  }
  async function saveIdentityRoutingPolicy(nextPolicy, controls = []) {
    controls.forEach(control => { control.disabled = true; });
    try {
      const response = await fetch('/api/memory-preview/identity-relation-routing-policy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextPolicy, updated_by: 'xiaoran' })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `routing_policy_${response.status}`);
      renderIdentityRoutingPolicy(payload.policy);
    } catch (error) {
      renderIdentityRoutingPolicy(identityRoutingPolicy);
      const summary = document.querySelector('[data-identity-routing-summary]');
      if (summary) summary.textContent = `设置没有保存：${error.message}`;
    } finally { controls.forEach(control => { control.disabled = false; }); }
  }
  function renderBackendRevisionPolicy(policy) {
    backendRevisionPolicy = { archive_source_after_profile_routing: policy?.archive_source_after_profile_routing === true };
    const toggle = document.querySelector('[data-profile-routing-cleanup-toggle]');
    const state = document.querySelector('[data-profile-routing-cleanup-state]');
    const summary = document.querySelector('[data-profile-routing-cleanup-summary]');
    if (toggle) {
      toggle.dataset.on = String(backendRevisionPolicy.archive_source_after_profile_routing);
      toggle.setAttribute('aria-checked', String(backendRevisionPolicy.archive_source_after_profile_routing));
    }
    if (state) state.textContent = backendRevisionPolicy.archive_source_after_profile_routing
      ? '已开启 · 成功归位后移入可恢复回收区' : '已关闭 · 原记忆继续留在记忆库';
    if (summary) summary.textContent = backendRevisionPolicy.archive_source_after_profile_routing
      ? '用户画像、Self Core 与关系网全部写入成功后自动归档来源；普通修订不受影响。'
      : '只作用于用户画像、Self Core 与关系网归位；普通记忆修订不受影响。';
  }
  async function loadBackendRevisionPolicy() {
    if (!document.querySelector('[data-profile-routing-cleanup-toggle]')) return;
    try {
      const response = await fetch('/api/memory-preview/backend-revision-policy', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `backend_revision_policy_${response.status}`);
      renderBackendRevisionPolicy(payload.policy);
    } catch (_) {
      const state = document.querySelector('[data-profile-routing-cleanup-state]');
      if (state) state.textContent = '暂时无法读取设置 · 后端不会自动归档';
    }
  }
  async function saveBackendRevisionPolicy(enabled, button) {
    button.disabled = true;
    try {
      const response = await fetch('/api/memory-preview/backend-revision-policy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive_source_after_profile_routing: enabled, updated_by: 'xiaoran' })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `backend_revision_policy_${response.status}`);
      renderBackendRevisionPolicy(payload.policy);
    } catch (error) {
      renderBackendRevisionPolicy(backendRevisionPolicy);
      document.querySelector('[data-profile-routing-cleanup-state]').textContent = `设置没有保存：${error.message}`;
    } finally { button.disabled = false; }
  }
  function renderProfileRecallPolicy(policy) {
    profileRecallPolicy = policy || profileRecallPolicy;
    document.querySelectorAll('[data-profile-module]').forEach(card => {
      const state = profileRecallPolicy.modules?.[card.dataset.profileModule] || {};
      const conversation = card.querySelector('[data-profile-toggle="conversation"]');
      const growth = card.querySelector('[data-profile-toggle="growth"]');
      const conversationOn = state.conversation_enabled === true;
      const growthOn = state.growth_enabled === true;
      if (conversation) { conversation.dataset.on = String(conversationOn); conversation.setAttribute('aria-checked', String(conversationOn)); }
      if (growth) { growth.dataset.on = String(growthOn); growth.setAttribute('aria-checked', String(growthOn)); }
      const conversationState = card.querySelector('[data-profile-state="conversation"]');
      const growthState = card.querySelector('[data-profile-state="growth"]');
      if (conversationState) conversationState.textContent = conversationOn ? '只在确实相关时参与' : '已暂停参与普通对话';
      if (growthState) growthState.textContent = growthOn ? '稳定认识可进入审阅候选' : '已关闭 · 现有档案保持不变';
      const last = card.querySelector('[data-profile-last]');
      const recalled = Array.isArray(state.last_recalled) ? state.last_recalled.length : 0;
      const injected = Array.isArray(state.last_injected) ? state.last_injected.length : 0;
      last.textContent = profileRecallPolicy.connected_to_chat
        ? (injected ? `最近一次相关对话使用了 ${injected} 条档案` : '最近一次相关对话没有使用这个档案')
        : '最近没有在对话中使用这个档案。';
      renderProfileGrowthList(card, state);
    });
    document.querySelectorAll('[data-profile-control-module]').forEach(group => {
      const state = profileRecallPolicy.modules?.[group.dataset.profileControlModule] || {};
      const growth = group.querySelector('[data-profile-toggle="growth"]');
      const growthState = group.querySelector('[data-profile-state="growth"]');
      const growthOn = state.growth_enabled === true;
      if (growth) { growth.dataset.on = String(growthOn); growth.setAttribute('aria-checked', String(growthOn)); }
      if (growthState) growthState.textContent = growthOn ? '稳定认识可进入审阅候选' : '已关闭 · 现有档案保持不变';
    });
    const summary = document.querySelector('[data-profile-policy-summary]');
    if (summary) summary.textContent = profileRecallPolicy.connected_to_chat
      ? '参与对话已接入相关性门控；使用结果会留在这里。'
      : '档案控制暂未接入聊天链。';
  }
  function renderProfileGrowthList(card, state) {
    const container = card.querySelector('[data-profile-growth-list]');
    if (!container) return;
    const moduleKey = card.dataset.profileModule;
    const rows = profileGrowthCandidates.filter(row => row.module === moduleKey);
    if (state.growth_enabled !== true) { container.innerHTML = ''; return; }
    if (!rows.length) { container.innerHTML = '<p>目前没有等待审阅的新认识。</p>'; return; }
    container.innerHTML = rows.map(row => `<article data-profile-growth-id="${escapeHtml(row.id)}"><small>来自 ${escapeHtml(row.source_candidate_id || '有来源的记忆候选')}</small><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.content)}</p><footer><button type="button" data-profile-growth-action="ignore">忽略</button><button type="button" data-profile-growth-action="approve">确认写入</button></footer></article>`).join('');
    container.querySelectorAll('[data-profile-growth-action]').forEach(button => button.addEventListener('click', event => decideProfileGrowth(event.currentTarget)));
  }
  async function loadProfileGrowthCandidates() {
    try {
      const response = await fetch('/api/memory-preview/profile-growth-candidates', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `profile_growth_${response.status}`);
      profileGrowthCandidates = Array.isArray(payload.pending) ? payload.pending : [];
      renderProfileRecallPolicy(profileRecallPolicy);
    } catch (_) { profileGrowthCandidates = []; }
  }
  async function decideProfileGrowth(button) {
    const article = button.closest('[data-profile-growth-id]');
    const candidateId = article?.dataset.profileGrowthId;
    const action = button.dataset.profileGrowthAction;
    article.querySelectorAll('button').forEach(item => { item.disabled = true; });
    try {
      const response = await fetch('/api/memory-preview/profile-growth-candidates/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: candidateId, action, actor: 'user' }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `profile_growth_decision_${response.status}`);
      await loadProfileGrowthCandidates();
    } catch (error) {
      article.querySelectorAll('button').forEach(item => { item.disabled = false; });
      document.querySelector('[data-profile-policy-summary]').textContent = `候选处理失败：${error.message}`;
    }
  }
  async function loadProfileRecallPolicy() {
    try {
      const response = await fetch('/api/memory-preview/profile-recall-policy', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `profile_policy_${response.status}`);
      renderProfileRecallPolicy(payload.policy);
    } catch (_) {
      const summary = document.querySelector('[data-profile-policy-summary]');
      if (summary) summary.textContent = '暂时无法读取控制设置；现有聊天没有变化。';
    }
  }
  async function saveProfileRecallPolicy(moduleKey, field, enabled, button) {
    const current = profileRecallPolicy.modules?.[moduleKey] || {};
    const next = { ...current, [`${field}_enabled`]: enabled };
    button.disabled = true;
    try {
      const response = await fetch('/api/memory-preview/profile-recall-policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated_by: 'user', modules: { [moduleKey]: next } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `profile_policy_${response.status}`);
      renderProfileRecallPolicy(payload.policy);
    } catch (error) {
      renderProfileRecallPolicy(profileRecallPolicy);
      document.querySelector('[data-profile-policy-summary]').textContent = `设置没有保存：${error.message}`;
    } finally { button.disabled = false; renderProfileRecallPolicy(profileRecallPolicy); }
  }
  document.querySelectorAll('[data-profile-toggle]').forEach(button => button.addEventListener('click', event => {
    const target = event.currentTarget;
    const moduleKey = target.closest('[data-profile-control-module]')?.dataset.profileControlModule
      || target.closest('[data-profile-module]')?.dataset.profileModule;
    if (!moduleKey) return;
    const field = target.dataset.profileToggle;
    target.classList.add('is-init');
    saveProfileRecallPolicy(moduleKey, field, target.dataset.on !== 'true', target);
  }));
  if (document.querySelector('[data-profile-policy-summary]')) loadProfileRecallPolicy();
  if (document.querySelector('[data-profile-module]')) loadProfileGrowthCandidates();
  function renderJevSettings(settings) {
    jevSettings = settings || jevSettings;
    const toggle = document.querySelector('[data-jev-toggle]');
    const wakeup = document.querySelector('[data-jev-wakeup]');
    const configured = document.querySelector('[data-jev-configured]');
    const state = document.querySelector('[data-jev-state]');
    toggle.dataset.on = String(jevSettings.enabled === true);
    toggle.setAttribute('aria-checked', String(jevSettings.enabled === true));
    toggle.disabled = !jevSettings.configured;
    wakeup.dataset.on = String(jevSettings.use_for_wakeup === true);
    wakeup.setAttribute('aria-checked', String(jevSettings.use_for_wakeup === true));
    wakeup.disabled = !jevSettings.configured || !jevSettings.enabled;
    configured.textContent = jevSettings.configured ? 'Key 已配置' : '尚未配置 Key';
    state.textContent = jevSettings.enabled ? '已开启 · 作为可忽略的第二意见' : '已关闭 · 不会调用 Jev';
  }
  async function loadJevSettings() {
    try {
      const response = await fetch('/api/memory-preview/jev-settings', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `jev_settings_${response.status}`);
      renderJevSettings(payload.settings);
    } catch (error) {
      document.querySelector('[data-jev-summary]').textContent = `暂时无法读取 Jev 设置：${error.message}`;
    }
  }
  async function saveJevSettings(patch, controls = []) {
    controls.forEach(control => { control.disabled = true; });
    try {
      const response = await fetch('/api/memory-preview/jev-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `jev_settings_${response.status}`);
      document.querySelector('[data-jev-key]').value = '';
      renderJevSettings(payload.settings);
    } catch (error) {
      renderJevSettings(jevSettings);
      document.querySelector('[data-jev-summary]').textContent = `设置没有保存：${error.message}`;
    } finally { controls.forEach(control => { control.disabled = false; }); renderJevSettings(jevSettings); }
  }
  document.querySelector('[data-jev-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    saveJevSettings({ enabled: button.dataset.on !== 'true' }, [button]);
  });
  document.querySelector('[data-jev-wakeup]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    saveJevSettings({ use_for_wakeup: button.dataset.on !== 'true' }, [button]);
  });
  document.querySelector('[data-jev-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const key = document.querySelector('[data-jev-key]').value.trim();
    if (!key) { document.querySelector('[data-jev-summary]').textContent = '没有填写新 Key，现有 Key 保持不变。'; return; }
    saveJevSettings({ api_key: key, enabled: true }, [...event.currentTarget.querySelectorAll('button,input')]);
  });
  document.querySelector('[data-jev-clear]')?.addEventListener('click', event => {
    if (!confirm('清除保存的 Jev API Key，并停止调用小参谋？')) return;
    saveJevSettings({ clear_api_key: true }, [event.currentTarget]);
  });
  if (document.querySelector('[data-jev-summary]')) loadJevSettings();
  async function loadCandidates() {
    try {
      const response = await fetch('/api/memory-preview/candidates', { cache: 'no-store' });
      if (!response.ok) throw new Error(`candidates_${response.status}`);
      const payload = await response.json();
      candidateAllRows = payload.candidates || [];
      candidateGroups = buildCandidateDisplayGroups(candidateAllRows);
      candidateRows = candidateGroups.map(group => group.members[0]);
      candidateIndex = 0;
      const counts = payload.counts || {};
      renderCandidateBatchOverview(payload);
      const summary = document.querySelector('[data-candidate-flow-summary]');
      if (summary) summary.textContent = `今日产生 ${counts.today_generated || 0} 条候选 · 已入库 ${counts.today_persisted || 0} 条 · 等待批次 ${counts.waiting_batch || 0} 条 · 等待共同审阅 ${counts.needs_review || 0} 条`;
      Object.entries(payload.counts || {}).forEach(([key, value]) => { const target = document.querySelector(`[data-candidate-count="${key}"]`); if (target) target.textContent = value; });
      renderCandidateShred(payload);
      renderCandidate();
    } catch (_) {
      const summary = document.querySelector('[data-candidate-flow-summary]');
      if (summary) summary.textContent = '暂时无法读取候选流向；真实候选没有变化。';
      document.querySelector('[data-candidate-position]').textContent = '暂时无法读取';
      document.querySelector('[data-candidate-card]').innerHTML = '<p>候选没有发生变化，稍后可以安全重试。</p>';
    }
  }
  function candidateOverviewArea(row) {
    const assigned = row.service_area_assignment?.areas?.[0]?.area || row.service_area_suggestion?.areas?.[0]?.area;
    if (assigned === 'relations' || ['relationship','emotion'].includes(row.kind)) return ['情感照料', '#C9D8E2'];
    if (assigned === 'work' || ['project','work'].includes(row.kind)) return ['项目行动', '#AEC0CC'];
    if (['identity','boundary'].includes(row.kind)) return ['身份边界', '#99ABB8'];
    if (['reflection','decision'].includes(row.kind)) return ['反思决定', '#D5D7DC'];
    return ['日常生活', '#E3EBF0'];
  }
  function candidateOverviewBatchKey(row) {
    const raw = row.candidate_entered_at || row.occurred_at;
    const date = raw ? new Date(raw) : new Date();
    if (Number.isNaN(date.getTime())) return '未定|23:55';
    const local = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    const day = `${String(local.getUTCMonth()+1).padStart(2,'0')}.${String(local.getUTCDate()).padStart(2,'0')}`;
    return `${day}|${local.getUTCHours() < 12 ? '11:55' : '23:55'}`;
  }
  function renderCandidateBatchOverview(payload) {
    const all = payload.candidates || [];
    const total = all.length;
    const days = (payload.admission_daily_stats || []).filter(item => item.complete).slice(-6);
    const admitted = days.reduce((sum, item) => sum + Number(item.admitted_total || 0), 0);
    document.querySelector('[data-candidate-total]').textContent = total;
    document.querySelector('[data-candidate-total-inline]').textContent = total;
    document.querySelector('[data-recent-admitted]').textContent = admitted;
    const grid=document.querySelector('[data-candidate-batch-grid]');
    if(!days.length){ grid.innerHTML='<p>今晚 23:55 完成后会生成第一天的精确统计。</p>'; return; }
    const colors = Object.fromEntries(['情感照料','项目行动','身份边界','反思决定','日常生活'].map(name => [name, candidateOverviewArea({ kind: name === '情感照料' ? 'relationship' : name === '项目行动' ? 'project' : name === '身份边界' ? 'identity' : name === '反思决定' ? 'decision' : 'event' })[1]]));
    grid.innerHTML=days.map((day,columnIndex)=>{
      const areas=Object.entries(day.areas || {}).map(([name,value])=>({name,color:colors[name] || '#E3EBF0',candidates:Number(value.candidates||0),admitted:Number(value.admitted||0)}));
      const blocks=areas.sort((a,b)=>b.candidates-a.candidates).map((area,index)=>`<button type="button" class="candidate-batch-block" style="--c:${area.color};--h:${Math.round(Math.min(52,30+area.candidates*7)*.8)}px;--d:${columnIndex*55+index*65}ms" data-batch-area="${escapeHtml(area.name)}" data-batch-label="${escapeHtml(`${day.day} · 入库 ${day.admitted_total || 0} / 候选 ${day.candidate_total || 0}`)}" aria-pressed="false">${area.admitted}/${area.candidates}</button>`).join('');
      return `<div class="candidate-batch-column"><div class="candidate-batch-stack">${blocks}</div><time class="candidate-batch-time"><b>${escapeHtml(day.day.slice(5).replace('-', '.'))}</b><span>已完成</span></time></div>`;
    }).join('');
    grid.querySelectorAll('[data-batch-area]').forEach(button=>button.addEventListener('click',()=>{ grid.querySelectorAll('[data-batch-area]').forEach(item=>item.setAttribute('aria-pressed',String(item===button))); document.querySelector('[data-selected-candidate-area]').textContent=button.dataset.batchArea; document.querySelector('[data-selected-candidate-batch]').textContent=button.dataset.batchLabel; }));
  }
  function setCandidateOverviewTab(button) {
    const mode = button.dataset.candidateOverviewTab;
    document.querySelectorAll('[data-candidate-overview-tab]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    const allView = document.querySelector('[data-candidate-all-view]');
    const workbenchView = document.querySelector('[data-candidate-workbench-view]');
    const settingsView = document.querySelector('[data-candidate-settings-view]');
    const mergeView = document.querySelector('[data-candidate-merge-view]');
    if (allView) allView.hidden = mode !== 'preview';
    if (workbenchView) workbenchView.hidden = mode !== 'workbench';
    if (settingsView) settingsView.hidden = mode !== 'settings';
    if (mergeView) mergeView.hidden = mode !== 'merge';
    const target = mode === 'workbench' ? workbenchView : mode === 'settings' ? settingsView : mode === 'merge' ? mergeView : allView;
    target?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  document.querySelectorAll('[data-candidate-overview-tab]').forEach(button=>button.addEventListener('click',()=>setCandidateOverviewTab(button)));
  document.querySelectorAll('[data-open-candidate-workbench]').forEach(button=>button.addEventListener('click',openCandidateWorkbench));
  document.querySelectorAll('[data-candidate-studio-step]').forEach(button=>button.addEventListener('click',()=>{
    const studio = document.querySelector('[data-candidate-studio]');
    const stage = studio?.querySelector('.candidate-studio-stage');
    if (!studio || studio.dataset.step === button.dataset.candidateStudioStep) return;
    studio.dataset.step = button.dataset.candidateStudioStep;
    document.querySelectorAll('[data-candidate-studio-step]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    stage?.classList.remove('is-switching');
    requestAnimationFrame(()=>requestAnimationFrame(()=>stage?.classList.add('is-switching')));
    stage?.addEventListener('animationend',()=>stage.classList.remove('is-switching'),{once:true});
  }));
  document.querySelectorAll('[data-toggle-candidate-routing]').forEach(button=>button.addEventListener('click',event=>{
    const control = event.currentTarget.closest('[data-candidate-routing-workbench]');
    const open = control.dataset.open !== 'true';
    control.dataset.open = String(open);
    event.currentTarget.setAttribute('aria-expanded',String(open));
  }));
  document.querySelector('[data-candidate-previous]')?.addEventListener('click', () => { if (!candidateRows.length) return; candidateIndex = (candidateIndex - 1 + candidateRows.length) % candidateRows.length; renderCandidate(); });
  document.querySelector('[data-candidate-next]')?.addEventListener('click', () => { if (!candidateRows.length) return; candidateIndex = (candidateIndex + 1) % candidateRows.length; renderCandidate(); });
  document.querySelector('[data-candidate-workbench-search]')?.addEventListener('input', event => renderCandidateSearch(event.target.value));
  document.querySelector('[data-candidate-shred-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    button.classList.add('is-init');
    const enabled = button.dataset.on !== 'true';
    button.dataset.on = String(enabled);
    button.setAttribute('aria-checked', String(enabled));
    saveCandidateShredPolicy({ ...candidateShredPolicy, enabled }, [button]);
  });
  document.querySelector('[data-candidate-pending-shred-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    button.classList.add('is-init');
    const pendingEnabled = button.dataset.on !== 'true';
    button.dataset.on = String(pendingEnabled);
    button.setAttribute('aria-checked', String(pendingEnabled));
    saveCandidateShredPolicy({ ...candidateShredPolicy, pending_enabled: pendingEnabled, retention_hours: 168 }, [button]);
  });
  document.querySelectorAll('[data-candidate-shred-hours]').forEach(button => button.addEventListener('click', event => {
    const hours = Number(event.currentTarget.dataset.candidateShredHours);
    if (hours === candidateShredPolicy.retention_hours) return;
    document.querySelectorAll('[data-candidate-shred-hours]').forEach(option => option.setAttribute('aria-pressed', String(option === event.currentTarget)));
    saveCandidateShredPolicy({ ...candidateShredPolicy, retention_hours: hours }, [...document.querySelectorAll('[data-candidate-shred-hours]')]);
  }));
  document.querySelector('[data-candidate-shred-help]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const panel = document.querySelector('.candidate-retention-help-panel');
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
  });
  document.querySelector('[data-identity-routing-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const enabled = button.dataset.on !== 'true';
    saveIdentityRoutingPolicy({ ...identityRoutingPolicy, enabled }, [button, document.querySelector('[data-identity-routing-copy]')]);
  });
  document.querySelector('[data-profile-routing-cleanup-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    saveBackendRevisionPolicy(button.dataset.on !== 'true', button);
  });
  document.querySelector('[data-candidate-experience-mode]')?.addEventListener('change', event => {
    const requested = event.currentTarget.value;
    saveCandidateExperience(requested === 'auto' ? 'preview' : requested);
  });
  document.querySelector('[data-candidate-schedule-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const times = [...event.currentTarget.querySelectorAll('[data-candidate-schedule-time]')].map(input => input.value).sort();
    saveCandidateSchedulePolicy({ batch_times:times,
      settlement_time:event.currentTarget.querySelector('[data-candidate-settlement-time]').value,
      stats_days:Number(event.currentTarget.querySelector('[data-candidate-stats-days]').value) });
  });
  document.querySelectorAll('[data-candidate-schedule-time]').forEach(input => input.addEventListener('change', () => {
    const settlement = document.querySelector('[data-candidate-settlement-time]');
    const previous = settlement.value;
    const values = [...document.querySelectorAll('[data-candidate-schedule-time]')].map(item => item.value).filter(Boolean).sort();
    settlement.innerHTML = values.map(time => `<option value="${escapeHtml(time)}">${escapeHtml(time)}</option>`).join('');
    settlement.value = values.includes(previous) ? previous : values.at(-1);
  }));
  document.querySelector('[data-candidate-schedule-reset]')?.addEventListener('click', () => {
    saveCandidateSchedulePolicy({ batch_times:['11:55','23:55'], settlement_time:'23:55', stats_days:6 });
  });
  loadCandidateSchedulePolicy();
  document.querySelector('[data-identity-routing-copy]')?.addEventListener('click', event => {
    if (!identityRoutingPolicy.enabled) return;
    const button = event.currentTarget;
    saveIdentityRoutingPolicy({ ...identityRoutingPolicy, retain_memory_copy: button.dataset.on !== 'true' }, [button]);
  });
  document.querySelector('[data-identity-routing-help]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const panel = document.querySelector('#identityRoutingHelp');
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
  });
  document.querySelector('[data-run-candidate-shred]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch('/api/memory-preview/candidate-shred/run', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `shred_${response.status}`);
      await loadCandidates();
    } catch (error) { document.querySelector('[data-candidate-shred-summary]').textContent = `检查失败：${error.message}`; }
    finally { button.disabled = false; }
  });
  document.querySelector('[data-preview-candidate-workset]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const preview = document.querySelector('[data-candidate-workbench-preview]');
    const rows = [...candidateWorkset.values()];
    if (rows.length < 2) return;
    if (!candidateMasterId) {
      preview.innerHTML = '<p>当前选中的都是关系／身份候选。它们需要走关系归位或身份归位复核，不能作为普通合并记忆的承载候选；请加入一条事件、项目、决定、偏好或反思候选。</p>';
      return;
    }
    button.disabled = true; button.textContent = '正在生成预览…';
    const memberRelations = Object.fromEntries(rows.filter(row => row.id !== candidateMasterId).map(row => [row.id, candidateRelations.get(row.id) || 'supplement']));
    try {
      const response = await fetch('/api/memory-preview/actions/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'candidate_merge', actor:'xiaoran', reason:'人工核对候选关系后生成合并预览', candidate_ids:rows.map(row => row.id), master_id:candidateMasterId, member_relations:memberRelations }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `preview_${response.status}`);
      preview.innerHTML = `<header><small>正式入库前预览</small><strong>${escapeHtml(payload.result_preview.title)}</strong></header><p>${escapeHtml(payload.result_preview.content)}</p><ul>${payload.member_relations.map(item => `<li><b>${escapeHtml(candidateWorkset.get(item.id)?.title || item.id)}</b><span>${escapeHtml(item.relation === 'master' ? '承载候选' : relationLabels[item.relation] || item.relation)} · ${escapeHtml(item.disposition === 'reference_active' ? '保持独立' : '确认后退出候选')}</span></li>`).join('')}</ul><div class="candidate-execute"><label>输入确认码 <b>${escapeHtml(payload.confirmation_code)}</b><input inputmode="numeric" maxlength="6" data-candidate-confirm-code placeholder="六位确认码"></label><p class="candidate-structure-hint">结构修订不是必填：直接整合入库时，系统会根据整合后的正文自动生成关键词并分区。</p><div class="candidate-execute-actions"><button type="button" data-execute-candidate-workset>整合入库</button><button type="button" data-revise-candidate-structure>结构修订（可选）</button></div><small data-candidate-execute-result>尚未写入；草稿十分钟内有效。</small></div>`;
      preview.querySelector('[data-revise-candidate-structure]')?.addEventListener('click', () => {
        openMergeStructureDraft(payload);
      });
      preview.querySelector('[data-execute-candidate-workset]')?.addEventListener('click', async executeEvent => {
        const executeButton = executeEvent.currentTarget;
        const result = preview.querySelector('[data-candidate-execute-result]');
        const code = preview.querySelector('[data-candidate-confirm-code]').value.trim();
        await executeCandidateMergeDraft(payload, code, result, executeButton);
      });
    } catch (error) {
      const message = error.message === 'candidate_master_protected'
        ? '关系／身份候选不能作为普通合并的承载候选，请改选一条事件、项目、决定、偏好或反思候选'
        : error.message.startsWith('duplicate_candidate_time_identity:')
          ? '工作集中存在相同时间事件 ID 的候选，后端已阻止重复整合；请移出重复项，或先修订它的对象、动作与来源证据'
        : error.message;
      preview.innerHTML = `<p>预览失败：${escapeHtml(message)}。候选没有变化。</p>`;
    }
    finally { button.disabled = rows.length < 2 || !candidateMasterId; button.textContent = '生成合并预览'; }
  });
  renderCandidateWorkset();

  async function loadArchiveMemories() {
    const list = document.querySelector('[data-archive-list]');
    try {
      const response = await fetch('/api/memory-preview/library?page=1&limit=100&state=all', { cache: 'no-store' });
      if (!response.ok) throw new Error(`archive_${response.status}`);
      const payload = await response.json();
      const rows = (payload.memories || []).filter(memory => (memory.state || 'active') !== 'active');
      document.querySelector('[data-archive-count]').textContent = rows.length;
      list.innerHTML = rows.length ? rows.map(memory => `<article class="archive-memory panel"><div><small>${escapeHtml(memory.kind || 'event')} · ${escapeHtml(relativeTime(memory.occurred_at || memory.updated_at))}</small><strong>${escapeHtml(memory.title)}</strong><p>${escapeHtml(memory.preview || '暂无正文预览')}</p></div><span>${Number(memory.memory_integration?.node_count || 0) ? `整合主记忆 · ${Number(memory.memory_integration.node_count)} 个来源` : '正文与历史仍保留'}</span>${(memory.state || 'active') === 'archived' ? `<button type="button" data-archive-restore="${escapeHtml(memory.id)}">恢复到记忆库</button>` : ''}<div data-archive-restore-result="${escapeHtml(memory.id)}"></div></article>`).join('') : '<p>目前没有归档记忆。</p>';
    } catch (_) {
      document.querySelector('[data-archive-count]').textContent = '—';
      list.innerHTML = '<p>暂时无法读取归档；记忆没有变化。</p>';
    }
  }

  const shanghaiActivityDay = (value) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value));
  const activityDayLabel = (day) => {
    const today = shanghaiActivityDay(Date.now());
    const yesterday = shanghaiActivityDay(Date.now() - 86400000);
    if (day === today) return '今天';
    if (day === yesterday) return '昨天';
    return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
  };
  const activityTimeLabel = (value) => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));

  async function loadActivities(force = false) {
    if (activityLoaded && !force) return;
    const stream = document.querySelector('[data-activity-stream]');
    stream.innerHTML = '<p>正在读取生活痕迹。</p>';
    try {
      const response = await fetch('/api/memory-preview/activities?limit=120', { cache: 'no-store' });
      if (!response.ok) throw new Error(`activities_${response.status}`);
      const payload = await response.json();
      const groups = new Map();
      (payload.items || []).forEach(item => {
        const day = shanghaiActivityDay(item.occurred_at);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(item);
      });
      stream.innerHTML = groups.size ? [...groups.entries()].map(([day, items], index) => {
        const open = index < 2;
        return `<section class="activity-day t-acc" data-open="${open}"><button class="t-acc-head" type="button" aria-expanded="${open}"><span><strong>${escapeHtml(activityDayLabel(day))}</strong><small>${escapeHtml(day)}</small></span><span class="activity-day-state"><b>${items.length} 条</b><i class="t-acc-chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 6.5L8 10.5L12 6.5"/></svg></i></span></button><div class="t-acc-panel"><div class="t-acc-panel-inner"><div class="activity-day-body">${items.map(item => `<article class="activity-entry"><time datetime="${escapeHtml(item.occurred_at)}">${escapeHtml(activityTimeLabel(item.occurred_at))}</time><span class="activity-kind" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.kind_label)}</span><div><strong>${escapeHtml(item.place)}</strong><p>${escapeHtml(item.summary)}</p><small>${item.visibility === 'shared' ? '已共享' : '仅私人空间'}</small></div></article>`).join('')}</div></div></div></section>`;
      }).join('') : '<p class="activity-empty">还没有真正想留下的活动。</p>';
      activityLoaded = true;
    } catch (_) {
      stream.innerHTML = '<p class="activity-empty">暂时读不到活动记录；原账本没有被修改。</p>';
    }
  }
  document.querySelector('[data-activity-stream]')?.addEventListener('click', event => {
    const head = event.target.closest('.activity-day > .t-acc-head');
    if (!head) return;
    const item = head.closest('.activity-day');
    const open = item.getAttribute('data-open') === 'true';
    item.setAttribute('data-open', String(!open));
    head.setAttribute('aria-expanded', String(!open));
  });
  document.querySelector('[data-archive-list]')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-archive-restore]');
    if (!button) return;
    const result = document.querySelector(`[data-archive-restore-result="${CSS.escape(button.dataset.archiveRestore)}"]`);
    button.disabled = true;
    try {
      const preview = await realActionRequest('preview', { action: 'restore_archive', memory_id: button.dataset.archiveRestore,
        actor: 'xiaoran', reason: '从归档页恢复到有效记忆库', signatures: { xiaoran: 'approve', cairn: 'approve' } });
      wireActionConfirmation(result, preview, async () => { await loadArchiveMemories(); await loadReadOnlyMemories(); await loadOverview(); });
    } catch (error) { button.disabled = false; result.innerHTML = `<p>无法恢复：${escapeHtml(error.message)}</p>`; }
  });

  function showView(view) {
    const next = ['cairn', 'activity', 'calendar', 'candidates', 'library', 'archive', 'workbench', 'study', 'review', 'settings'].includes(view) ? view : 'overview';
    prototype.dataset.view = next;
    try {
      localStorage.setItem('moraine.activeView', next);
      const url = new URL(window.location.href);
      url.searchParams.set('view', next);
      window.history.replaceState({ ...(window.history.state || {}), view: next }, '', url);
    } catch (_) {
      // The visible page still changes if storage or history is unavailable.
    }
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('is-current', button.dataset.view === next);
    });
    closeSidebar();
    if (next !== 'library') setWorkbenchSelectionOpen(false);
    updateBackToTop();
    updatePageTitleCapsule(true);
    if (next === 'activity') loadActivities();
    if (next === 'library') window.setTimeout(() => librarySearch.focus(), 180);
  }

  function activeScrollablePage() {
    const view = prototype.dataset.view || 'overview';
    return document.querySelector(`#${CSS.escape(view)}.page`);
  }

  function syncWorkbenchStage() {
    const page = document.querySelector('#workbench.page');
    if (!page) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const progress = reduced ? 0 : Math.min(1, Math.max(0, page.scrollTop / 185));
    page.style.setProperty('--workbench-hero-shift', `${Math.round(progress * -48)}px`);
    page.style.setProperty('--workbench-hero-scale', String(1 - progress * .035));
    page.style.setProperty('--workbench-hero-opacity', String(1 - progress * .68));
    page.style.setProperty('--workbench-progress-shift', `${Math.round(progress * -72)}px`);
    page.style.setProperty('--workbench-progress-opacity', String(1 - progress * .94));
  }

  function updateBackToTop() {
    const page = activeScrollablePage();
    const visible = Boolean(page && page.scrollTop > 360);
    backToTop.dataset.visible = String(visible);
    backToTop.setAttribute('aria-hidden', String(!visible));
    backToTop.tabIndex = visible ? 0 : -1;
  }

  function updatePageTitleCapsule(syncTitle = false) {
    const page = activeScrollablePage();
    if (!page || !pageTitleCapsule || !pageTitleText) return;
    if (syncTitle) {
      const title = page.querySelector('.library-header h1')?.textContent?.trim() || '总览';
      pageTitleText.textContent = title;
      pageTitleMenu?.setAttribute('aria-label', `打开导航，当前页${title}`);
    }
    const threshold = syncTitle ? 108 : (pageTitleCollapsed ? 54 : 108);
    const collapsed = page.scrollTop > threshold;
    if (collapsed === pageTitleCollapsed && pageTitleCapsule.dataset.collapsed === String(collapsed)) return;
    pageTitleCollapsed = collapsed;
    pageTitleCapsule.dataset.collapsed = String(collapsed);
    pageTitleText.setAttribute('aria-hidden', String(collapsed));
  }

  function filterMemories() {
    const terms = memorySearchTerms().map(term => term.toLocaleLowerCase('zh-CN'));
    memoryItems.forEach((item) => {
      const haystack = item.dataset.memorySearch.toLocaleLowerCase('zh-CN');
      const matchesQuery = !terms.length || terms.every(term => haystack.includes(term));
      item.hidden = !matchesQuery;
    });

    document.querySelectorAll('[data-memory-group]').forEach((group) => {
      const groupVisible = [...group.querySelectorAll('[data-memory-item]')].filter((item) => !item.hidden).length;
      group.hidden = groupVisible === 0;
      group.querySelector('[data-group-count]').textContent = `${groupVisible} 条`;
    });

    const totalVisible = memoryItems.filter((item) => !item.hidden).length;
    if (memoryDataMode === 'real') {
      const total = Math.max(memoryActiveTotal, memoryRecords.length);
      visibleMemoryCount.textContent = memorySearchTerms().length
        ? `当前命中 ${totalVisible} 条 · 已加载 ${memoryRecords.length} / ${total}`
        : memoryFullyLoaded
          ? `共 ${total} 条有效记忆 · 已全部加载`
          : `已加载 ${memoryRecords.length} / 共 ${total} 条有效记忆`;
    } else {
      visibleMemoryCount.textContent = `${totalVisible} 条示例记忆`;
    }
    memoryEmpty.hidden = totalVisible !== 0;
    updateMemoryLoadState();
  }

  const memoryGroupDefinitions = {
    time: [
      ['today', '今天'],
      ['yesterday', '昨天'],
      ['earlier', '更早']
    ],
    weight: [
      ['high', '高分区权重'],
      ['medium', '中分区权重'],
      ['low', '低分区权重'],
      ['unset', '尚未计算']
    ],
    recent: [
      ['today', '今天修改'],
      ['yesterday', '昨天修改'],
      ['earlier', '更早修改']
    ]
  };

  function renderMemoryGroups() {
    memoryGroupsContainer.replaceChildren();
    if (activeMemoryView === 'time' || activeMemoryView === 'recent') {
      const group = document.createElement('section');
      const viewLabel = activeMemoryView === 'time' ? '事件时间' : '最近修改';
      group.className = 'memory-time-group';
      group.dataset.memoryGroup = '';
      group.setAttribute('aria-labelledby', `memoryGroup${activeMemoryView}`);
      group.innerHTML = `<header><h3 id="memoryGroup${activeMemoryView}">${viewLabel}</h3><span data-group-count>0 条</span></header>`;
      const direction = activeMemoryDirection === 'desc' ? -1 : 1;
      memoryItems.slice().sort((left, right) => {
        const leftDate = Date.parse(activeMemoryView === 'recent' ? left.dataset.memoryUpdatedAt : left.dataset.memoryCreatedAt) || 0;
        const rightDate = Date.parse(activeMemoryView === 'recent' ? right.dataset.memoryUpdatedAt : right.dataset.memoryCreatedAt) || 0;
        return direction * (leftDate - rightDate);
      }).forEach(item => group.append(item));
      memoryGroupsContainer.append(group);
      document.querySelector('.memory-list').setAttribute('aria-label', `按${viewLabel}浏览记忆`);
      document.querySelector('.memory-list > header h2').textContent = `按${viewLabel}浏览`;
      filterMemories();
      return;
    }
    const definitions = [...memoryGroupDefinitions[activeMemoryView]];
    if (activeMemoryDirection === 'asc') definitions.reverse();
    definitions.forEach(([key, label], index) => {
      const group = document.createElement('section');
      const titleId = `memoryGroup${activeMemoryView}${index}`;
      group.className = 'memory-time-group';
      group.dataset.memoryGroup = '';
      group.setAttribute('aria-labelledby', titleId);
      group.innerHTML = `<header><h3 id="${titleId}">${label}</h3><span data-group-count>0 条</span></header>`;
      const field = `memory${activeMemoryView[0].toUpperCase()}${activeMemoryView.slice(1)}`;
      memoryItems
        .filter((item) => item.dataset[field] === key)
        .sort((left, right) => {
          const direction = activeMemoryDirection === 'desc' ? -1 : 1;
          if (activeMemoryView === 'weight') {
            const leftWeight = left.dataset.memoryPartitionWeight === '' ? -1 : Number(left.dataset.memoryPartitionWeight);
            const rightWeight = right.dataset.memoryPartitionWeight === '' ? -1 : Number(right.dataset.memoryPartitionWeight);
            return direction * (leftWeight - rightWeight);
          }
          const leftDate = Date.parse(activeMemoryView === 'recent' ? left.dataset.memoryUpdatedAt : left.dataset.memoryCreatedAt) || 0;
          const rightDate = Date.parse(activeMemoryView === 'recent' ? right.dataset.memoryUpdatedAt : right.dataset.memoryCreatedAt) || 0;
          return direction * (leftDate - rightDate);
        })
        .forEach((item) => group.append(item));
      memoryGroupsContainer.append(group);
    });
    const viewLabel = activeMemoryView === 'time' ? '时间' : activeMemoryView === 'weight' ? '分区权重' : '最近修改';
    document.querySelector('.memory-list').setAttribute('aria-label', `按${viewLabel}浏览记忆`);
    document.querySelector('.memory-list > header h2').textContent = `按${viewLabel}浏览`;
    filterMemories();
  }

  document.querySelectorAll('[data-open-sidebar]').forEach((button) => {
    button.addEventListener('click', openSidebar);
  });
  document.querySelectorAll('.page').forEach((page) => page.addEventListener('scroll', () => {
    updateBackToTop();
    updatePageTitleCapsule();
    if (page.id === 'workbench') syncWorkbenchStage();
  }, { passive: true }));
  backToTop.addEventListener('click', () => {
    const page = activeScrollablePage();
    if (!page) return;
    page.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  document.querySelectorAll('[data-view-link]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.viewLink));
  });
  timeDirectionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.timeDirection === activeMemoryDirection) return;
      activeMemoryDirection = button.dataset.timeDirection;
      timeDirectionButtons.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === button)));
      moveTimeSortPill(button, true);
      visibleMemoryCount.textContent = `正在按${activeMemoryDirection === 'asc' ? '最早' : '最新'}顺序读取首批 ${memoryPageSize} 条记忆`;
      document.querySelector('#library')?.scrollTo({ top: 0, behavior: 'auto' });
      loadReadOnlyMemories();
    });
  });
  function setMemoryWorkbenchView(view) {
    const preview = document.querySelector('[data-memory-workbench-preview]');
    const content = document.querySelector('[data-memory-workbench-content]');
    if (preview) preview.hidden = true;
    if (content) content.hidden = false;
    memoryWorkbenchViewTabs.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.memoryWorkbenchView === view || (view === 'structure' && button.dataset.memoryWorkbenchView === 'integrate'))));
    if (view !== 'preview') {
      workbenchTabs.find((button) => button.dataset.workbenchStep === 'integrate')?.click();
      if (view === 'structure') mergeStepTabs.find((button) => button.dataset.mergeStep === 'structure')?.click();
      else if (view === 'integrate' && !mergeStepTabs.some((button) => button.getAttribute('aria-selected') === 'true' && !button.classList.contains('merge-internal-step'))) {
        mergeStepTabs.find((button) => button.dataset.mergeStep === 'compare')?.click();
      }
    }
  }
  memoryWorkbenchViewTabs.forEach((button) => button.addEventListener('click', () => setMemoryWorkbenchView(button.dataset.memoryWorkbenchView)));
  workbenchTabs.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.workbenchStep === 'structure') {
        workbenchTabs.find((candidate) => candidate.dataset.workbenchStep === 'integrate')?.click();
        mergeStepTabs.find((candidate) => candidate.dataset.mergeStep === 'structure')?.click();
        return;
      }
      workbenchTabs.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === button)));
      document.querySelectorAll('.workbench-stage > [data-workbench-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.workbenchPanel !== button.dataset.workbenchStep;
      });
      moveWorkbenchPill(button, true);
      centerWorkbenchTab(button);
    });
  });
  document.querySelectorAll('[data-structure-step]').forEach(button => button.addEventListener('click', () => {
    const studio = document.querySelector('[data-structure-studio]');
    if (!studio) return;
    studio.dataset.step = button.dataset.structureStep;
    document.querySelectorAll('[data-structure-step]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const stage = studio.querySelector('.structure-sync-stage');
    stage?.classList.remove('is-switching');
    requestAnimationFrame(() => requestAnimationFrame(() => stage?.classList.add('is-switching')));
    stage?.addEventListener('animationend', () => stage.classList.remove('is-switching'), { once:true });
  }));
  structureModeTabs.forEach(button => button.addEventListener('click', () => {
    structureModeTabs.forEach(candidate => candidate.setAttribute('aria-selected', String(candidate === button)));
    document.querySelectorAll('[data-structure-panel]').forEach(panel => {
      panel.hidden = panel.dataset.structurePanel !== button.dataset.structureMode;
    });
  }));
  if (document.querySelector('[data-study-review-count]')) fetch('/api/memory-preview/agent-workbench?manual=1&limit=20', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`request_${response.status}`)))
    .then((payload) => {
      const count = Math.max(0, Number(payload.review_todo_count) || 0);
      document.querySelector('[data-study-review-count]').textContent = count;
      document.querySelector('[data-study-review-note]').textContent = count
        ? '自主醒来时会少量核对；它们不是必须立刻清空的任务。'
        : '当前没有等待小机核对的整合记忆。';
    })
    .catch(() => {
      document.querySelector('[data-study-review-count]').textContent = '—';
      document.querySelector('[data-study-review-note]').textContent = '暂时无法读取审阅队列。';
    });
  mergeStepTabs.forEach((button) => {
    button.addEventListener('click', () => {
      mergeStepTabs.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === button)));
      document.querySelectorAll('[data-merge-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.mergePanel !== button.dataset.mergeStep;
      });
      if (button.dataset.mergeStep === 'structure' && !activeMechanicalDraft) loadStructureRevisionQueue();
    });
  });
  document.querySelectorAll('[data-sign]').forEach((button) => {
    button.addEventListener('click', () => {
      reviewChoices[button.dataset.sign] = button.dataset.choice;
      updateReviewState();
    });
  });
  document.querySelector('[data-return-draft]').addEventListener('click', () => {
    if (activeReviewKind === 'weight') { showView('library'); return; }
    showView('workbench');
    const structureMode = { '修订': 'content', '更迭': 'relation' }[activeDraftAction];
    if (structureMode) {
      workbenchTabs.find((tab) => tab.dataset.workbenchStep === 'integrate')?.click();
      mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'structure')?.click();
      structureModeTabs.find((tab) => tab.dataset.structureMode === structureMode)?.click();
      document.querySelector('.structure-manual-tools')?.setAttribute('open', '');
    } else mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'draft').click();
  });
  document.querySelector('[data-build-plan]').addEventListener('click', event => prepareUnifiedRealPreview(event.currentTarget));
  function syncLibrarySearchState() {
    librarySearchWrap.classList.toggle('has-value', Boolean(librarySearch.value));
  }
  librarySearch.addEventListener('input', () => {
    syncLibrarySearchState();
    refreshMemorySearch();
  });
  librarySearchClear.addEventListener('pointerdown', event => event.preventDefault());
  librarySearchClear.addEventListener('click', () => {
    librarySearch.value = '';
    syncLibrarySearchState();
    refreshMemorySearch();
    librarySearch.focus({ preventScroll: true });
  });
  document.querySelector('[data-load-more-memories]')?.addEventListener('click', () => loadNextMemoryPage());
  document.querySelector('[data-clear-memory-search]').addEventListener('click', () => {
    librarySearch.value = '';
    refreshMemorySearch();
    librarySearch.focus();
  });
  function wireMemoryPapers() {
    document.querySelectorAll('[data-memory-paper]').forEach((paper) => {
    if (paper.dataset.memoryWired === 'true') return;
    paper.dataset.memoryWired = 'true';
    const summary = paper.querySelector('.memory-paper-summary');
    const detail = paper.querySelector('.memory-paper-detail');
    const facetStage = paper.querySelector('[data-facet-stage]');
    const facetOrder = ['body', 'then', 'after'];
    let activeFacet = 'body';
    let dragStart = null;
    paper.addEventListener('click', event => {
      const flip = event.target.closest('[data-memory-reflection-flip]');
      if (!flip) return;
      event.stopPropagation();
      const shell = flip.closest('[data-memory-reflection-live]');
      shell.setAttribute('aria-pressed', String(shell.getAttribute('aria-pressed') !== 'true'));
    });
    function wireTimeline() {
      const timeline = paper.querySelector('[data-memory-timeline]');
      if (!timeline) return;
      const nodes = [...timeline.querySelectorAll('[data-timeline-node]')];
      const position = timeline.querySelector('[data-timeline-position]');
      const entries = timeline.querySelector('.timeline-entries');
      const swapDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')) || 150;
      let swapTimer = 0;
      nodes.forEach((node, index) => node.addEventListener('click', () => {
        const selected = node.dataset.timelineNode;
        nodes.forEach(candidate => {
          const current = candidate === node;
          candidate.classList.toggle('is-current', current);
          candidate.setAttribute('aria-pressed', String(current));
        });
        window.clearTimeout(swapTimer);
        const revealSelected = () => {
          timeline.querySelectorAll('[data-timeline-entry]').forEach(entry => { entry.hidden = entry.dataset.timelineEntry !== selected; });
          entries.classList.remove('is-exit');
          entries.classList.add('is-enter-start');
          void entries.offsetHeight;
          entries.classList.remove('is-enter-start');
        };
        if (swapDuration) {
          entries.classList.add('is-exit');
          swapTimer = window.setTimeout(revealSelected, swapDuration);
        } else revealSelected();
        position.textContent = selected === 'summary' ? '整合结论' : `${index + 1} / ${nodes.length - 1}`;
        const scroller = timeline.querySelector('.timeline-scroller');
        const left = node.offsetLeft - (scroller.clientWidth - node.offsetWidth) / 2;
        scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      }));
      const scroller = timeline.querySelector('.timeline-scroller');
      const current = timeline.querySelector('.timeline-node.is-current');
      requestAnimationFrame(() => {
        if (!current) return;
        scroller.scrollLeft = Math.max(0, current.offsetLeft - (scroller.clientWidth - current.offsetWidth) / 2);
      });
    }
    wireTimeline();

    paper.querySelector('[data-save-memory-keywords]')?.addEventListener('click', async event => {
      event.stopPropagation();
      const button = event.currentTarget; button.disabled = true; button.textContent = '保存中…';
      const keywords = Object.fromEntries([...paper.querySelectorAll('[data-structured-keyword]')].map(input => [input.dataset.structuredKeyword, input.value.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean)]));
      try {
        const response = await fetch('/api/memory-preview/service-areas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_keywords', memory_id: paper.dataset.memoryId, keywords, actor: 'human:xiaoran', reason: '在正式记忆库修订结构关键词' }) });
        const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || `keyword_${response.status}`);
        button.textContent = '已保存';
      } catch (error) { button.disabled = false; button.textContent = '保存关键词'; alert(`关键词没有保存：${error.message}`); }
    });

    function selectFacet(selectedFacet) {
      activeFacet = selectedFacet;
      paper.querySelectorAll('[data-facet]').forEach((candidate) => {
        const isActive = candidate.dataset.facet === selectedFacet;
        candidate.classList.toggle('is-active', isActive);
        candidate.setAttribute('aria-pressed', String(isActive));
      });
      paper.querySelectorAll('[data-facet-panel]').forEach((panel) => {
        const isActive = panel.dataset.facetPanel === selectedFacet;
        panel.classList.toggle('is-active', isActive);
        panel.hidden = !isActive;
      });
    }
    summary.addEventListener('click', async () => {
      const willExpand = summary.getAttribute('aria-expanded') !== 'true';
      summary.setAttribute('aria-expanded', String(willExpand));
      paper.dataset.open = String(willExpand);
      if (willExpand && paper.dataset.fullLoaded !== 'true') {
        const bodyPanel = paper.querySelector('[data-facet-panel="body"] p, .memory-facet p');
        if (bodyPanel) bodyPanel.textContent = '正在读取完整正文……';
        try {
          const response = await fetch(`/api/memory-preview/memories/${encodeURIComponent(paper.dataset.memoryId)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`detail_${response.status}`);
          const memory = await response.json();
          const record = recordById.get(paper.dataset.memoryId);
          if (record) {
            record.body = memory.content || '';
            record.timeline = Array.isArray(memory.timeline) ? memory.timeline : null;
            record.integrationSummary = memory.integration_summary || record.summary;
            const detail = paper.querySelector('.memory-paper-detail');
            detail.outerHTML = memoryDetailMarkup(record);
            wireTimeline();
          }
          paper.dataset.fullLoaded = 'true';
        } catch (error) {
          console.error('Unable to render the complete memory detail.', error);
          if (bodyPanel) bodyPanel.textContent = '暂时无法读取完整正文；没有使用示例内容替代。';
        }
      }
    });

    paper.querySelectorAll('[data-facet]').forEach((button) => {
      button.addEventListener('click', () => selectFacet(button.dataset.facet));
    });

    facetStage?.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      dragStart = { x: event.clientX, y: event.clientY, horizontal: null };
      facetStage.setPointerCapture(event.pointerId);
    });
    facetStage?.addEventListener('pointermove', (event) => {
      if (!dragStart) return;
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (dragStart.horizontal === null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        dragStart.horizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
      }
      if (!dragStart.horizontal) return;
      const activeIndex = facetOrder.indexOf(activeFacet);
      const atEdge = (activeIndex === 0 && dx > 0) || (activeIndex === facetOrder.length - 1 && dx < 0);
      const resistance = atEdge ? .2 : .48;
      facetStage.classList.add('is-dragging');
      facetStage.style.transform = `translateX(${Math.max(-34, Math.min(34, dx * resistance))}px)`;
    });
    const finishFacetDrag = (event) => {
      if (!dragStart) return;
      const dx = event.clientX - dragStart.x;
      const activeIndex = facetOrder.indexOf(activeFacet);
      if (dragStart.horizontal && Math.abs(dx) >= 42) {
        const nextIndex = dx < 0
          ? Math.min(facetOrder.length - 1, activeIndex + 1)
          : Math.max(0, activeIndex - 1);
        selectFacet(facetOrder[nextIndex]);
      }
      dragStart = null;
      facetStage.classList.remove('is-dragging');
      facetStage.style.transform = '';
    };
    facetStage?.addEventListener('pointerup', finishFacetDrag);
    facetStage?.addEventListener('pointercancel', () => {
      dragStart = null;
      facetStage.classList.remove('is-dragging');
      facetStage.style.transform = '';
    });

    const historyTrigger = paper.querySelector('[data-open-history]');
    let holdTimer;
    const cancelHold = () => window.clearTimeout(holdTimer);
    historyTrigger?.addEventListener('click', () => openHistory(historyTrigger));
    paper.querySelector('[data-propose-clean]')?.addEventListener('click', () => {
      const record = recordById.get(paper.dataset.memoryId);
      if (record) openCleanDraft(record);
    });
    paper.addEventListener('pointerdown', (event) => {
      if (!historyTrigger) return;
      if (event.pointerType === 'mouse' || event.target.closest('button, a, input')) return;
      holdTimer = window.setTimeout(() => openHistory(historyTrigger), 520);
    });
    paper.addEventListener('pointerup', cancelHold);
    paper.addEventListener('pointermove', cancelHold);
    paper.addEventListener('pointercancel', cancelHold);
    paper.addEventListener('pointerleave', cancelHold);
    });
  }

  document.querySelector('[data-open-selected-workbench]').addEventListener('click', openSelectedWorkbench);
  document.querySelector('[data-workbench-selection-toggle]').addEventListener('click', () => {
    const tray = document.querySelector('[data-workbench-selection]');
    setWorkbenchSelectionOpen(tray.dataset.open !== 'true');
  });
  document.querySelector('[data-workbench-selection-list]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-workbench-memory]');
    if (!button) return;
    selectedMemoryIds.delete(button.dataset.removeWorkbenchMemory);
    updateWorkbenchSelection();
  });
  document.addEventListener('pointerdown', (event) => {
    const tray = document.querySelector('[data-workbench-selection]');
    if (tray?.dataset.open === 'true' && !event.target.closest('[data-workbench-selection]')) setWorkbenchSelectionOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setWorkbenchSelectionOpen(false);
  });
  renderMemoryRecords();
  renderMemoryGroups();
  wireMemoryPapers();
  populateRealReviewChoices();
  wireRealReview();
  loadReadOnlyMemories();
  loadQueuePreferences();
  loadStructureRevisionQueue();
  loadCleanupCandidates();
  loadRollbacks();
  loadOverview();
  loadCalendar();
  loadCandidates();
  loadRoutingCandidates();
  loadCandidateExperience();
  loadIdentityRoutingPolicy();
  loadBackendRevisionPolicy();
  loadArchiveMemories();
  loadGovernancePreview();
  loadMemoryFlow();
  startBackendRevisionSync();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncBackendRevisionStatus();
  });
  window.addEventListener('focus', () => syncBackendRevisionStatus());
  document.querySelector('[data-revision-memory]')?.addEventListener('change', async event => {
    const result = document.querySelector('[data-revision-result]');
    if (!event.target.value) return;
    result.innerHTML = '<p>正在读取完整正文……</p>';
    try {
      const response = await fetch(`/api/memory-preview/memories/${encodeURIComponent(event.target.value)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`memory_${response.status}`);
      const payload = await response.json();
      document.querySelector('[data-revision-title]').value = payload.title || '';
      document.querySelector('[data-revision-content]').value = payload.content || '';
      result.innerHTML = '<p>已读取当前版本；修改后先生成差异草稿。</p>';
    } catch (error) { result.innerHTML = `<p>读取失败：${escapeHtml(error.message)}</p>`; }
  });
  document.querySelector('[data-preview-revision]')?.addEventListener('click', async () => {
    const result = document.querySelector('[data-revision-result]');
    try {
      const preview = await realActionRequest('preview', { action: 'content_revision',
        actor: 'xiaoran',
        memory_id: document.querySelector('[data-revision-memory]').value,
        title: document.querySelector('[data-revision-title]').value,
        content: document.querySelector('[data-revision-content]').value,
        reason: document.querySelector('[data-revision-reason]').value });
      wireActionConfirmation(result, preview, loadReadOnlyMemories);
    } catch (error) { result.innerHTML = `<p>未生成修订草稿：${escapeHtml(error.message)}</p>`; }
  });
  document.querySelector('[data-run-auto-weight]')?.addEventListener('click', async () => {
    const result = document.querySelector('[data-auto-weight-result]');
    result.innerHTML = '<p>正在按规则计算普通记忆；核心与锁定记录会自动留置。</p>';
    try {
      const preview = await realActionRequest('preview', { action: 'auto_weight', actor: 'system', reason: '按当前Moraine规则执行普通记忆自动赋权' });
      preview.result_preview = { title: `将更新 ${preview.summary.will_update} 条普通记忆`, content: `${preview.summary.held_for_review} 条核心、锁定或保护记忆保持不动。` };
      wireActionConfirmation(result, preview, loadReadOnlyMemories);
    } catch (error) { result.innerHTML = `<p>没有执行：${escapeHtml(error.message)}</p>`; }
  });
  document.querySelector('[data-governance-preview]')?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-manual-memory]');
    if (!trigger) return;
    const panel = document.querySelector('[data-manual-strength]');
    const current = Number(trigger.dataset.manualCurrent) || 50;
    panel.hidden = false;
    panel.innerHTML = `<header><span><small>真实赋权 · 先预览</small><strong>${escapeHtml(trigger.dataset.manualTitle)}</strong></span><b data-manual-value>${current}</b></header><label>提出者<select data-manual-actor><option value="cairn">Agent</option><option value="xiaoran">用户</option></select></label><label>记忆强度<input type="range" min="0" max="100" value="${current}" data-manual-range></label><label>赋权理由<textarea rows="3" data-manual-reason placeholder="为什么由你认领这个强度"></textarea></label><label class="governance-check"><input type="checkbox" data-manual-lock><span>锁定为核心记忆（需要80～100分）</span></label><label class="governance-check"><input type="checkbox" data-manual-xiaoran><span>用户确认高影响调整</span></label><label class="governance-check"><input type="checkbox" data-manual-cairn><span>Agent 确认高影响调整</span></label><button type="button" data-preview-manual-change>预览手动赋权</button><div data-manual-result><p>尚未写入。</p></div>`;
    const range = panel.querySelector('[data-manual-range]');
    range.addEventListener('input', () => { panel.querySelector('[data-manual-value]').textContent = range.value; });
    panel.querySelector('[data-preview-manual-change]').addEventListener('click', async () => {
      const value = Number(range.value);
      const lock = panel.querySelector('[data-manual-lock]').checked;
      const reason = panel.querySelector('[data-manual-reason]').value.trim();
      const result = panel.querySelector('[data-manual-result]');
      if (!reason) { result.innerHTML = '<p>请先写下由你认领这个强度的理由。</p>'; return; }
      if (lock && value < 80) { result.innerHTML = '<p>只有80～100分的核心记忆可以锁定。</p>'; return; }
      try {
        const preview = await realActionRequest('preview', { action: 'weight', memory_id: trigger.dataset.manualMemory,
          actor: panel.querySelector('[data-manual-actor]').value, importance: value / 100, priority: value / 100,
          identity_weight: value >= 80 ? value / 100 : .1, strength_locked: lock, reason,
          signatures: { xiaoran: panel.querySelector('[data-manual-xiaoran]').checked ? 'approve' : '', cairn: panel.querySelector('[data-manual-cairn]').checked ? 'approve' : '' } });
        wireActionConfirmation(result, preview, loadReadOnlyMemories);
      } catch (error) { result.innerHTML = `<p>未生成草稿：${escapeHtml(error.message)}</p>`; }
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelector('[data-governance-mode]')?.addEventListener('change', loadGovernancePreview);
  document.querySelector('[data-governance-only-missing]')?.addEventListener('change', loadGovernancePreview);

  function resetBackendRevisionForm() {
    backendRevisionForm.reset();
    backendRevisionForm.querySelectorAll('[data-revision-strategy]').forEach(button => button.setAttribute('aria-checked', 'false'));
    backendRevisionForm.querySelectorAll('[data-revision-destination]').forEach(button => button.setAttribute('aria-checked', 'false'));
    const status = backendRevisionForm.querySelector('[data-backend-revision-status]');
    status.textContent = '';
    status.className = 'backend-revision-status';
  }

  function openBackendRevision(record, trigger) {
    backendRevisionMemoryId = record.id;
    backendRevisionReturnFocus = trigger;
    resetBackendRevisionForm();
    backendRevisionForm.querySelector('[data-backend-revision-memory]').textContent = record.title;
    backendRevisionOverlay.hidden = false;
    document.body.classList.add('has-backend-revision');
    backendRevisionDialog.classList.remove('is-closing');
    requestAnimationFrame(() => {
      backendRevisionDialog.classList.add('is-open');
      backendRevisionDialog.querySelector('[data-revision-strategy]')?.focus();
    });
  }

  function closeBackendRevision() {
    if (backendRevisionOverlay.hidden) return;
    backendRevisionDialog.classList.remove('is-open');
    backendRevisionDialog.classList.add('is-closing');
    const style = getComputedStyle(document.documentElement);
    const duration = parseFloat(style.getPropertyValue('--modal-close-dur')) || 150;
    window.setTimeout(() => {
      backendRevisionDialog.classList.remove('is-closing');
      backendRevisionOverlay.hidden = true;
      document.body.classList.remove('has-backend-revision');
      backendRevisionReturnFocus?.focus();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration);
  }

  backendRevisionDialog.querySelectorAll('.t-check path').forEach(path => {
    path.style.setProperty('--check-len', String(Math.ceil(path.getTotalLength())));
  });
  backendRevisionDialog.addEventListener('click', event => {
    const option = event.target.closest('[data-revision-strategy], [data-revision-destination]');
    if (!option) return;
    option.setAttribute('aria-checked', String(option.getAttribute('aria-checked') !== 'true'));
  });
  backendRevisionOverlay.addEventListener('click', event => {
    if (event.target.closest('[data-backend-revision-close]')) closeBackendRevision();
  });
  backendRevisionForm.addEventListener('submit', async event => {
    event.preventDefault();
    const strategies = [...backendRevisionForm.querySelectorAll('[data-revision-strategy][aria-checked="true"]')]
      .map(button => button.dataset.revisionStrategy);
    const destinations = [...backendRevisionForm.querySelectorAll('[data-revision-destination][aria-checked="true"]')]
      .map(button => button.dataset.revisionDestination);
    const status = backendRevisionForm.querySelector('[data-backend-revision-status]');
    if (!strategies.length && !destinations.length) {
      status.textContent = '请选择至少一种加工方式或主页资料去向。';
      status.className = 'backend-revision-status is-error';
      return;
    }
    const submit = backendRevisionForm.querySelector('[type="submit"]');
    const record = recordById.get(backendRevisionMemoryId);
    submit.disabled = true;
    status.textContent = '正在交给小机……';
    status.className = 'backend-revision-status';
    try {
      const response = await fetch('/api/memory-preview/backend-revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          memory_id: backendRevisionMemoryId,
          memory_title: record?.title || '',
          strategies,
          destinations,
          instructions: backendRevisionForm.querySelector('[data-revision-instructions]').value,
          must_keep: backendRevisionForm.querySelector('[data-revision-must-keep]').value
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `request_${response.status}`);
      backendRevisionStates.set(payload.revision.id, payload.revision.status);
      status.textContent = destinations.length
        ? '已经送到小机后端。小机会整理来源并写入所选主页资料；记忆修订仍保留旧版本和回退。'
        : '已经进入小机的待修订队列。小机会直接完成修订并入库，旧版本仍可回退。';
      status.className = 'backend-revision-status is-success';
      window.setTimeout(closeBackendRevision, 900);
    } catch (error) {
      status.textContent = `没有提交成功：${error.message}`;
      status.className = 'backend-revision-status is-error';
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector('#library').addEventListener('click', async (event) => {
    const structureTrigger = event.target.closest('[data-open-structure-revision]');
    if (structureTrigger) {
      const paper = structureTrigger.closest('[data-memory-paper]');
      const record = recordById.get(paper?.dataset.memoryId);
      if (record) openStructureWorkbench(record);
      return;
    }
    const backendRevisionTrigger = event.target.closest('[data-backend-revision]');
    if (backendRevisionTrigger) {
      const paper = backendRevisionTrigger.closest('[data-memory-paper]');
      const record = recordById.get(paper?.dataset.memoryId);
      if (record) openBackendRevision(record, backendRevisionTrigger);
      return;
    }
    const workbenchTrigger = event.target.closest('[data-add-to-workbench]');
    if (workbenchTrigger) {
      const paper = workbenchTrigger.closest('[data-memory-paper]');
      if (!paper) return;
      const id = paper.dataset.memoryId;
      if (selectedMemoryIds.has(id)) selectedMemoryIds.delete(id);
      else selectedMemoryIds.add(id);
      updateWorkbenchSelection();
      return;
    }
    const cleanToggle = event.target.closest('[data-inline-clean-toggle]');
    if (cleanToggle) {
      const paper = cleanToggle.closest('[data-memory-paper]');
      const panel = paper.querySelector('[data-inline-clean-panel]');
      if (cleanToggle.dataset.guardedCleanup !== 'true') {
        cleanToggle.disabled = true;
        await quickArchiveMemory(paper, null);
        if (paper.isConnected) cleanToggle.disabled = false;
        return;
      }
      panel.hidden = !panel.hidden;
      cleanToggle.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    const cleanConfirm = event.target.closest('[data-inline-clean-confirm]');
    if (cleanConfirm) {
      const paper = cleanConfirm.closest('[data-memory-paper]');
      const panel = cleanConfirm.closest('[data-inline-clean-panel]');
      const result = panel.querySelector('[data-inline-clean-result]');
      cleanConfirm.disabled = true;
      await quickArchiveMemory(paper, result);
      if (paper.isConnected) cleanConfirm.disabled = false;
      return;
    }
    const control = event.target.closest('[data-strength-control]');
    if (!control) return;
    const editor = control.querySelector('[data-strength-editor]');
    if (event.target.closest('[data-open-strength]')) {
      editor.hidden = !editor.hidden;
      control.querySelector('[data-open-strength]').setAttribute('aria-expanded', String(!editor.hidden));
    }
    if (event.target.matches('[data-strength-range]')) control.querySelector('[data-strength-value]').textContent = event.target.value;
    if (event.target.closest('[data-submit-strength]')) {
      const value = Number(control.querySelector('[data-strength-range]').value);
      const actor = control.querySelector('[data-strength-actor]').value;
      const reason = control.querySelector('[data-strength-reason]').value.trim();
      const lock = control.querySelector('[data-strength-lock]').checked;
      const result = control.querySelector('[data-strength-result]');
      if (!reason) { result.textContent = '请先由提出者写下自己的理由。'; return; }
      if (lock && value < 8) { result.textContent = '只有 8～10 的核心记忆可以申请锁定。'; return; }
      submitStrengthToReview(control, control.closest('[data-memory-paper]'), actor, value, lock, reason);
    }
  });
  document.querySelector('#library').addEventListener('input', (event) => {
    if (!event.target.matches('[data-strength-range]')) return;
    event.target.closest('[data-strength-control]').querySelector('[data-strength-value]').textContent = event.target.value;
  });
  const workbenchWeightSelect = document.querySelector('[data-workbench-weight-memory]');
  const workbenchWeightRange = document.querySelector('[data-workbench-weight-range]');
  workbenchWeightRange?.addEventListener('input', () => {
    document.querySelector('[data-workbench-weight-value]').textContent = workbenchWeightRange.value;
  });
  workbenchWeightSelect?.addEventListener('change', () => {
    const memory = recordById.get(workbenchWeightSelect.value);
    if (!memory) return;
    const strength = Math.round(Number(memory.importance || 0) * 100);
    workbenchWeightRange.value = String(Math.min(79, Math.max(0, strength)));
    document.querySelector('[data-workbench-weight-value]').textContent = workbenchWeightRange.value;
  });
  document.querySelector('[data-workbench-weight-preview]')?.addEventListener('click', async event => {
    const result = document.querySelector('[data-workbench-weight-result]');
    const memory = recordById.get(workbenchWeightSelect?.value);
    const reason = document.querySelector('[data-workbench-weight-reason]').value.trim();
    if (!memory) { result.innerHTML = '<p>请先选择一条真实记忆。</p>'; return; }
    if (!reason) { result.innerHTML = '<p>请先写下调整强度的理由。</p>'; return; }
    event.currentTarget.disabled = true;
    result.innerHTML = '<p>正在读取当前版本并生成核对稿……</p>';
    try {
      const preview = await realActionRequest('preview', { action: 'weight', actor: 'xiaoran', memory_id: memory.id,
        importance: Number(workbenchWeightRange.value) / 100,
        priority: memory.priority ?? .5, identity_weight: memory.identityWeight ?? .1, reason });
      wireActionConfirmation(result, preview, loadReadOnlyMemories);
    } catch (error) {
      result.innerHTML = `<p>未生成赋权核对：${escapeHtml(error.message)}</p>`;
      event.currentTarget.disabled = false;
    }
  });
  document.querySelectorAll('[data-submit-operation]').forEach(button => button.addEventListener('click', () => {
    submitOperation(button.closest('[data-operation-form]'), button.dataset.submitOperation);
  }));
  document.querySelector('[data-replacement-list]')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-review-replacement]');
    if (!button) return;
    const pair = replacementPairs.get(button.dataset.reviewReplacement);
    if (!pair) return;
    const card = button.closest('.replacement-card');
    const result = card.querySelector('[data-replacement-result]');
    const reason = card.querySelector('[data-replacement-reason]').value.trim();
    if (!reason) { result.innerHTML = '<p>请先写下为什么这是替换，而不只是相关。</p>'; return; }
    button.disabled = true;
    try {
      const preview = await realActionRequest('preview', { action: 'supersede', old_id: pair.old_memory.id,
        replacement_id: pair.new_memory.id, actor: 'xiaoran', reason,
        signatures: { xiaoran: 'approve', cairn: 'approve' } });
      wireActionConfirmation(result, preview);
    } catch (error) {
      result.innerHTML = `<p>未生成替换核对：${escapeHtml(error.message)}</p>`;
      button.disabled = false;
    }
  });
  document.querySelector('[data-cleanup-list]')?.addEventListener('click', event => {
    const button = event.target.closest('[data-open-cleanup-candidate]');
    if (!button) return;
    const record = recordById.get(button.dataset.openCleanupCandidate);
    if (record) openCleanDraft(record);
  });
  document.querySelector('[data-recycle-list]')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-restore-memory]');
    if (!button) return;
    const result = document.querySelector(`[data-restore-result="${CSS.escape(button.dataset.restoreMemory)}"]`);
    try {
      const preview = await realActionRequest('preview', { action: 'restore_archive', memory_id: button.dataset.restoreMemory,
        actor: 'xiaoran',
        reason: '人工确认从可恢复回收区恢复', signatures: { xiaoran: 'approve', cairn: 'approve' } });
      wireActionConfirmation(result, preview);
    } catch (error) { result.innerHTML = `<p>无法恢复：${escapeHtml(error.message)}</p>`; }
  });
  document.querySelector('[data-rollback-list]')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-execute-rollback]');
    if (!button) return;
    const result = document.querySelector(`[data-rollback-result="${CSS.escape(button.dataset.executeRollback)}"]`);
    button.disabled = true;
    try {
      const response = await fetch(`/api/memory-preview/rollbacks/${encodeURIComponent(button.dataset.executeRollback)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `rollback_${response.status}`);
      result.textContent = `已完整恢复 ${payload.restored_ids.length} 条记忆。`;
      await refreshAfterMemoryChange({ clearWorkbench: true, refreshCluster: true });
    } catch (error) { result.textContent = `未回退：${error.message}`; button.disabled = false; }
  });
  ownershipTabs.forEach(tab => tab.addEventListener('click', () => {
    ownershipTabs.forEach(item => item.setAttribute('aria-selected', item === tab ? 'true' : 'false'));
    document.querySelectorAll('[data-ownership-panel]').forEach(panel => { panel.hidden = panel.dataset.ownershipPanel !== tab.dataset.ownershipMode; });
    moveOwnershipPill(tab, true);
  }));
  const directProfileResult = document.querySelector('[data-cairn-direct-result]');
  const directNameButton = document.querySelector('[data-edit-cairn-name]');
  const directNameInput = document.querySelector('[data-cairn-direct-name]');
  const directAvatarInput = document.querySelector('[data-cairn-direct-avatar]');
  const userAvatarInput = document.querySelector('[data-user-direct-avatar]');

  async function saveDirectProfile(changes, pendingLabel) {
    directProfileResult.textContent = pendingLabel;
    try {
      const response = await fetch('/api/cairn/profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...cairnProfile, ...changes })
      });
      if (!response.ok) throw new Error(`profile_${response.status}`);
      cairnProfile = normalizeInstanceProfile(await response.json());
      renderCairnProfile();
      directProfileResult.textContent = '已保存';
      window.setTimeout(() => { directProfileResult.textContent = '头像与资料均来自当前实例'; }, 1200);
      return true;
    } catch (_) {
      directProfileResult.textContent = '保存失败，原资料没有改变';
      return false;
    }
  }

  function closeDirectNameEditor() {
    directNameInput.hidden = true;
    directNameButton.hidden = false;
  }

  directNameButton?.addEventListener('click', () => {
    directNameInput.value = cairnProfile.display_name;
    directNameButton.hidden = true;
    directNameInput.hidden = false;
    directNameInput.focus();
    directNameInput.select();
  });
  directNameInput?.addEventListener('keydown', async event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDirectNameEditor(); return; }
    if (event.key === 'Enter') { event.preventDefault(); directNameInput.blur(); }
  });
  directNameInput?.addEventListener('blur', async () => {
    const displayName = directNameInput.value.trim();
    if (displayName && displayName !== cairnProfile.display_name) await saveDirectProfile({ display_name: displayName }, '正在保存名字……');
    closeDirectNameEditor();
  });
  document.querySelector('[data-resident-card-shell]')?.addEventListener('click', event => {
    if (event.target.closest('[data-edit-cairn-avatar]')) {
      event.stopPropagation();
      directAvatarInput.click();
    } else if (event.target.closest('[data-edit-user-avatar]')) {
      event.stopPropagation();
      userAvatarInput.click();
    }
  });
  const avatarCropOverlay = document.querySelector('[data-avatar-crop-overlay]');
  const avatarCropDialog = document.querySelector('[data-avatar-crop-dialog]');
  const avatarCropStage = document.querySelector('[data-avatar-crop-stage]');
  const avatarCropCanvas = document.querySelector('[data-avatar-crop-canvas]');
  const avatarCropZoom = document.querySelector('[data-avatar-crop-zoom]');
  const avatarCropContext = avatarCropCanvas?.getContext('2d');
  const avatarCropCloseMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')) || 150;
  let avatarCrop = null;

  function clampAvatarCrop() {
    if (!avatarCrop) return;
    const size = avatarCropCanvas.width;
    const width = avatarCrop.image.naturalWidth * avatarCrop.scale;
    const height = avatarCrop.image.naturalHeight * avatarCrop.scale;
    avatarCrop.x = Math.min(0, Math.max(size - width, avatarCrop.x));
    avatarCrop.y = Math.min(0, Math.max(size - height, avatarCrop.y));
  }

  function drawAvatarCrop() {
    if (!avatarCrop || !avatarCropContext) return;
    const size = avatarCropCanvas.width;
    avatarCropContext.clearRect(0, 0, size, size);
    avatarCropContext.drawImage(
      avatarCrop.image, avatarCrop.x, avatarCrop.y,
      avatarCrop.image.naturalWidth * avatarCrop.scale,
      avatarCrop.image.naturalHeight * avatarCrop.scale
    );
  }

  function closeAvatarCrop() {
    avatarCropDialog.classList.remove('is-open');
    avatarCropDialog.classList.add('is-closing');
    window.setTimeout(() => {
      avatarCropDialog.classList.remove('is-closing');
      avatarCropOverlay.hidden = true;
      document.body.classList.remove('has-avatar-crop');
      if (avatarCrop?.url) URL.revokeObjectURL(avatarCrop.url);
      avatarCrop = null;
    }, avatarCropCloseMs);
  }

  function openAvatarCrop(file, field, input) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
      directProfileResult.textContent = file.size > 20 * 1024 * 1024 ? '原图请不要超过 20MB' : '请选择图片文件';
      input.value = '';
      return;
    }
    if (avatarCrop?.url) URL.revokeObjectURL(avatarCrop.url);
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const size = avatarCropCanvas.width;
      const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      avatarCrop = {
        image, url, field, input, baseScale, scale: baseScale,
        x: (size - image.naturalWidth * baseScale) / 2,
        y: (size - image.naturalHeight * baseScale) / 2,
        drag: null
      };
      avatarCropZoom.value = '1';
      drawAvatarCrop();
      avatarCropOverlay.hidden = false;
      document.body.classList.add('has-avatar-crop');
      requestAnimationFrame(() => avatarCropDialog.classList.add('is-open'));
      input.value = '';
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      input.value = '';
      directProfileResult.textContent = '头像读取失败';
    };
    image.src = url;
  }

  directAvatarInput?.addEventListener('change', () => openAvatarCrop(directAvatarInput.files[0], 'avatar', directAvatarInput));
  userAvatarInput?.addEventListener('change', () => openAvatarCrop(userAvatarInput.files[0], 'user_avatar', userAvatarInput));
  avatarCropZoom?.addEventListener('input', () => {
    if (!avatarCrop) return;
    const size = avatarCropCanvas.width;
    const oldScale = avatarCrop.scale;
    const nextScale = avatarCrop.baseScale * Number(avatarCropZoom.value);
    avatarCrop.x = size / 2 - (size / 2 - avatarCrop.x) * (nextScale / oldScale);
    avatarCrop.y = size / 2 - (size / 2 - avatarCrop.y) * (nextScale / oldScale);
    avatarCrop.scale = nextScale;
    clampAvatarCrop();
    drawAvatarCrop();
  });
  avatarCropStage?.addEventListener('pointerdown', event => {
    if (!avatarCrop) return;
    avatarCrop.drag = { id:event.pointerId, clientX:event.clientX, clientY:event.clientY, x:avatarCrop.x, y:avatarCrop.y };
    avatarCropStage.setPointerCapture(event.pointerId);
  });
  avatarCropStage?.addEventListener('pointermove', event => {
    if (!avatarCrop?.drag || avatarCrop.drag.id !== event.pointerId) return;
    const ratio = avatarCropCanvas.width / avatarCropStage.getBoundingClientRect().width;
    avatarCrop.x = avatarCrop.drag.x + (event.clientX - avatarCrop.drag.clientX) * ratio;
    avatarCrop.y = avatarCrop.drag.y + (event.clientY - avatarCrop.drag.clientY) * ratio;
    clampAvatarCrop();
    drawAvatarCrop();
  });
  const finishAvatarDrag = event => {
    if (!avatarCrop?.drag || avatarCrop.drag.id !== event.pointerId) return;
    avatarCrop.drag = null;
    if (avatarCropStage.hasPointerCapture(event.pointerId)) avatarCropStage.releasePointerCapture(event.pointerId);
  };
  avatarCropStage?.addEventListener('pointerup', finishAvatarDrag);
  avatarCropStage?.addEventListener('pointercancel', finishAvatarDrag);
  document.querySelector('[data-avatar-crop-close]')?.addEventListener('click', closeAvatarCrop);
  avatarCropOverlay?.addEventListener('click', event => { if (event.target === avatarCropOverlay) closeAvatarCrop(); });
  document.querySelector('[data-avatar-crop-reselect]')?.addEventListener('click', () => avatarCrop?.input.click());
  document.querySelector('[data-avatar-crop-confirm]')?.addEventListener('click', async event => {
    if (!avatarCrop) return;
    const button = event.currentTarget;
    button.disabled = true;
    const field = avatarCrop.field;
    const cropped = avatarCropCanvas.toDataURL('image/webp', .9);
    const saved = await saveDirectProfile({ [field]: cropped }, field === 'avatar' ? '正在保存 self-core 头像……' : '正在保存用户头像……');
    button.disabled = false;
    if (saved) closeAvatarCrop();
  });
  document.querySelectorAll('[data-cairn-profile-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const result = form.querySelector('[data-cairn-profile-result]');
    result.textContent = '正在保存……';
    try {
      const avatar = await readAvatar(form.querySelector('[data-cairn-avatar-input]').files[0]);
      const response = await fetch('/api/cairn/profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: form.querySelector('[data-cairn-name-input]').value,
          status: form.querySelector('[data-cairn-status-input]').value,
          avatar
        })
      });
      if (!response.ok) throw new Error(`profile_${response.status}`);
      cairnProfile = normalizeInstanceProfile(await response.json());
      renderCairnProfile();
      form.querySelector('[data-cairn-avatar-input]').value = '';
      result.textContent = '已保存，侧栏与主页已同步。';
      if (form.closest('[data-cairn-inline-editor]')) window.setTimeout(() => { form.closest('[data-cairn-inline-editor]').hidden = true; }, 500);
    } catch (error) {
      result.textContent = error.message === 'avatar_too_large' ? '头像请不要超过 600KB。' : '保存失败，原资料没有改变。';
    }
  }));
  const migrationForm = document.querySelector('[data-migration-form]');
  const migrationResult = document.querySelector('[data-migration-result]');
  const migrationStatusLabel = status => ({ ready: '可迁入', duplicate: '已重复', held: '留待审阅', invalid: '无法读取' }[status] || status);
  const renderMigrationPreview = payload => {
    const { counts, rows } = payload.preview;
    migrationResult.innerHTML = `<div class="migration-summary"><strong>${counts.ready} 条可迁入</strong><span>${counts.duplicate} 条重复 · ${counts.held} 条保护暂缓 · ${counts.invalid} 条无效</span></div>
      <ul class="migration-rows">${rows.slice(0, 24).map(row => `<li data-status="${escapeHtml(row.status)}"><span><strong>${escapeHtml(row.title || `第 ${row.index + 1} 条`)}</strong><small>${escapeHtml(row.kind || '—')} · ${escapeHtml(row.warnings?.join('；') || '字段完整')}</small></span><b>${migrationStatusLabel(row.status)}</b></li>`).join('')}</ul>
      ${rows.length > 24 ? `<p class="migration-more">另有 ${rows.length - 24} 条已完成预检。</p>` : ''}
      ${counts.ready ? `<div class="migration-confirm"><label>输入确认码 <input inputmode="numeric" maxlength="6" autocomplete="off" data-migration-code placeholder="${escapeHtml(payload.confirmation_code)}"></label><button type="button" class="real-primary" data-migration-execute>确认迁入 ${counts.ready} 条</button></div>` : '<p class="migration-more">没有可直接写入的普通记忆。</p>'}`;
  };
  migrationForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const file = migrationForm.querySelector('[data-migration-file]').files[0];
    if (!file) return;
    if (file.size > 512 * 1024) { migrationResult.textContent = '文件超过 512KB，没有读取。'; return; }
    const button = migrationForm.querySelector('[data-migration-preview]');
    button.disabled = true; migrationResult.innerHTML = '<p>正在本地读取并与现有记忆核对……</p>';
    try {
      const response = await fetch('/api/memory-preview/migration/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content: await file.text(), format: 'auto',
          weight_mode: migrationForm.querySelector('[data-migration-weight]').value,
          only_missing: migrationForm.querySelector('[data-migration-only-missing]').checked }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `migration_${response.status}`);
      migrationDraft = payload; renderMigrationPreview(payload);
    } catch (error) { migrationDraft = null; migrationResult.innerHTML = `<p>预检失败：${escapeHtml(error.message)}</p>`; }
    finally { button.disabled = false; }
  });
  migrationResult?.addEventListener('click', async event => {
    const button = event.target.closest('[data-migration-execute]');
    if (!button || !migrationDraft) return;
    const code = migrationResult.querySelector('[data-migration-code]').value.trim();
    if (!code) { migrationResult.querySelector('[data-migration-code]').focus(); return; }
    button.disabled = true; button.textContent = '正在迁入……';
    try {
      const response = await fetch('/api/memory-preview/migration/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: migrationDraft.draft_id, confirmation_code: code }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `migration_${response.status}`);
      migrationDraft = null;
      migrationResult.innerHTML = `<div class="migration-success"><strong>已迁入 ${payload.imported} 条</strong><span>整批撤回凭据保留至 ${escapeHtml(new Date(payload.rollback.available_until).toLocaleString('zh-CN'))}，可在归档页执行。</span></div>`;
      migrationForm.reset(); await loadReadOnlyMemories();
    } catch (error) { button.disabled = false; button.textContent = '再次确认迁入';
      migrationResult.insertAdjacentHTML('beforeend', `<p class="migration-error">没有写入：${escapeHtml(error.message)}</p>`); }
  });
  const snapshotList = document.querySelector('[data-snapshot-list]');
  const snapshotResult = document.querySelector('[data-snapshot-result]');
  const renderSnapshots = snapshots => {
    snapshotList.innerHTML = snapshots.length ? snapshots.map(snapshot => `<article class="snapshot-card">
      <span><strong>${escapeHtml(snapshot.label)}</strong><small>${escapeHtml(new Date(snapshot.created_at).toLocaleString('zh-CN'))} · ${snapshot.count} 条 · ${(snapshot.bytes / 1024).toFixed(1)}KB</small></span>
      <button type="button" data-preview-snapshot="${escapeHtml(snapshot.id)}">安全恢复</button>
      <div data-snapshot-impact="${escapeHtml(snapshot.id)}"></div></article>`).join('') : '<p>还没有私有快照。</p>';
  };
  const loadSnapshots = async () => {
    try {
      const response = await fetch('/api/memory-preview/portability/snapshots', { cache: 'no-store' });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `snapshot_${response.status}`);
      renderSnapshots(payload.snapshots); snapshotResult.textContent = `共有 ${payload.snapshots.length} 份可校验快照。`;
    } catch (error) { snapshotResult.textContent = `快照暂不可用：${error.message}`; }
  };
  document.querySelector('[data-create-snapshot]')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; snapshotResult.textContent = '正在读取完整记忆并建立校验快照……';
    try {
      const response = await fetch('/api/memory-preview/portability/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '设置页手动快照' }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `snapshot_${response.status}`);
      snapshotResult.textContent = `已保存 ${payload.snapshot.count} 条，校验码 ${payload.snapshot.checksum.slice(0, 12)}…`;
      await loadSnapshots();
    } catch (error) { snapshotResult.textContent = `没有建立快照：${error.message}`; }
    finally { button.disabled = false; }
  });
  snapshotList?.addEventListener('click', async event => {
    const previewButton = event.target.closest('[data-preview-snapshot]');
    const executeButton = event.target.closest('[data-execute-snapshot]');
    if (previewButton) {
      const target = snapshotList.querySelector(`[data-snapshot-impact="${CSS.escape(previewButton.dataset.previewSnapshot)}"]`);
      previewButton.disabled = true; target.innerHTML = '<p>正在比较当前记忆……</p>';
      try {
        const response = await fetch(`/api/memory-preview/portability/snapshots/${encodeURIComponent(previewButton.dataset.previewSnapshot)}/restore-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `snapshot_${response.status}`);
        snapshotRestoreDraft = payload;
        target.innerHTML = `<p>将恢复 ${payload.impact.changed} 条、补回 ${payload.impact.missing} 条；${payload.impact.held} 条保护内容暂缓，${payload.impact.newer_preserved} 条后来新增记忆保留。</p>
          ${(payload.impact.changed + payload.impact.missing) ? `<div class="snapshot-confirm"><input inputmode="numeric" maxlength="6" data-snapshot-code placeholder="${escapeHtml(payload.confirmation_code)}"><button type="button" data-execute-snapshot="${escapeHtml(payload.draft_id)}">确认安全恢复</button></div>` : '<p>当前状态与快照一致，无需恢复。</p>'}`;
      } catch (error) { target.innerHTML = `<p>无法生成恢复预览：${escapeHtml(error.message)}</p>`; previewButton.disabled = false; }
      return;
    }
    if (executeButton && snapshotRestoreDraft?.draft_id === executeButton.dataset.executeSnapshot) {
      const target = executeButton.closest('[data-snapshot-impact]'); const code = target.querySelector('[data-snapshot-code]').value.trim();
      if (!code) { target.querySelector('[data-snapshot-code]').focus(); return; }
      executeButton.disabled = true;
      try {
        const response = await fetch('/api/memory-preview/portability/restore-execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft_id: snapshotRestoreDraft.draft_id, confirmation_code: code }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `snapshot_${response.status}`);
        snapshotRestoreDraft = null; target.innerHTML = `<p>已恢复 ${payload.restored} 条并补回 ${payload.recreated} 条；后来新增的 ${payload.newer_preserved} 条保持不变。48小时内可在归档页撤回本次恢复。</p>`;
        await loadReadOnlyMemories();
      } catch (error) { executeButton.disabled = false; target.insertAdjacentHTML('beforeend', `<p>没有恢复：${escapeHtml(error.message)}</p>`); }
    }
  });

  const studyPaperStack = document.querySelector('[data-study-paper-stack]');
  const studyPaperPage = document.querySelector('[data-study-paper-page]');
  const studyPaperTitle = document.querySelector('[data-study-paper-title]');
  const studyPaperDate = document.querySelector('[data-study-paper-date]');
  const studyPaperCopy = document.querySelector('[data-study-paper-copy]');
  const studyDiaryCount = document.querySelector('[data-study-diary-count]');
  let studyDiaries = [];
  let studyDiaryIndex = 0;
  let studyDiaryStartX = 0;
  let studyDiaryStartTime = 0;
  let studyDiaryDistance = 0;
  let studyDiaryDragging = false;
  let studyDiaryMoved = false;
  let studyDiarySwitching = false;
  const studyPaperPalette = {
    diary: ['#fbfcfc', 'rgba(104,112,116,.13)'], note: ['#eef3ee', 'rgba(111,137,116,.15)'],
    monologue: ['#f1f0ed', 'rgba(126,122,114,.14)'], promise: ['#f8eee9', 'rgba(178,116,96,.14)'],
    reflection: ['#f5f0e7', 'rgba(169,137,97,.14)'], agreement: ['#f1ece3', 'rgba(141,118,101,.14)']
  };
  const studyDiaryDateLabel = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
  };
  const renderStudyPaper = () => {
    const diary = studyDiaries[studyDiaryIndex];
    if (!diary) {
      studyPaperTitle.textContent = '暂无日记';
      studyPaperDate.textContent = '';
      studyPaperCopy.textContent = '去写下今天的心情吧。';
      studyPaperPage.dataset.href = '';
      return;
    }
    const [paper, line] = studyPaperPalette[diary.type] || studyPaperPalette.diary;
    studyPaperStack.style.setProperty('--diary-paper', paper);
    studyPaperStack.style.setProperty('--diary-line', line);
    studyPaperTitle.textContent = diary.title || '未命名的一页';
    studyPaperDate.textContent = studyDiaryDateLabel(diary.updatedAt || diary.createdAt);
    studyPaperCopy.textContent = diary.content || '这一页还没有正文。';
    studyPaperPage.dataset.href = diary.id ? `/diary/#diary-${diary.id}` : '/diary/';
    studyPaperPage.setAttribute('aria-label', `翻开日记：${studyPaperTitle.textContent}`);
  };
  const returnStudyPaper = () => {
    studyPaperStack.classList.remove('pulling');
    studyPaperPage.classList.remove('dragging');
    studyPaperPage.classList.add('returning');
    studyPaperPage.style.transform = '';
    studyPaperPage.style.opacity = '';
    window.setTimeout(() => {
      studyPaperPage.classList.remove('returning');
      studyPaperPage.style.transformOrigin = '';
    }, 410);
  };
  const switchStudyPaper = direction => {
    if (studyDiarySwitching) return;
    if (studyDiaries.length < 2) {
      returnStudyPaper();
      return;
    }
    studyDiarySwitching = true;
    studyPaperStack.classList.remove('pulling');
    studyPaperPage.classList.remove('dragging', 'returning');
    studyPaperPage.style.transform = '';
    studyPaperPage.style.opacity = '';
    studyPaperPage.classList.add(direction > 0 ? 'leave-left' : 'leave-right');
    studyPaperPage.addEventListener('animationend', () => {
      studyPaperPage.classList.remove('leave-left', 'leave-right');
      studyPaperPage.style.transformOrigin = '';
      studyDiaryIndex = (studyDiaryIndex + direction + studyDiaries.length) % studyDiaries.length;
      renderStudyPaper();
      studyPaperPage.classList.add('lifting');
      studyPaperPage.addEventListener('animationend', () => {
        studyPaperPage.classList.remove('lifting');
        studyDiarySwitching = false;
      }, { once: true });
    }, { once: true });
  };
  const loadStudyDiary = async () => {
    try {
      const response = await fetch('/api/diary', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`diary_${response.status}`);
      const payload = await response.json();
      studyDiaries = (Array.isArray(payload) ? payload : [])
        .filter(entry => entry && (entry.author === 'claude' || entry.author === 'shared'))
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      studyDiaryIndex = 0;
      studyDiaryCount.textContent = `${studyDiaries.length} 页`;
      renderStudyPaper();
    } catch (_) {
      studyDiaryCount.textContent = '未连接';
      studyPaperTitle.textContent = '暂未连接';
      studyPaperDate.textContent = '';
      studyPaperCopy.textContent = '日记暂时没有成功抵达。';
    }
  };
  studyPaperPage?.addEventListener('pointerdown', event => {
    if (studyDiarySwitching) return;
    studyDiaryDragging = true;
    studyDiaryMoved = false;
    studyDiaryDistance = 0;
    studyDiaryStartX = event.clientX;
    studyDiaryStartTime = performance.now();
    studyPaperPage.setPointerCapture(event.pointerId);
    studyPaperPage.classList.remove('returning');
    studyPaperPage.classList.add('dragging');
  });
  studyPaperPage?.addEventListener('pointermove', event => {
    if (!studyDiaryDragging) return;
    event.preventDefault();
    studyDiaryDistance = Math.max(-82, Math.min(82, event.clientX - studyDiaryStartX));
    if (Math.abs(studyDiaryDistance) > 4) {
      studyDiaryMoved = true;
      studyPaperStack.classList.add('pulling');
    }
    const rotation = studyDiaryDistance * .035;
    const tilt = Math.min(12, Math.abs(studyDiaryDistance) * .1) * (studyDiaryDistance < 0 ? 1 : -1);
    studyPaperPage.style.transformOrigin = studyDiaryDistance < 0 ? '100% 50%' : '0 50%';
    studyPaperPage.style.transform = `translate3d(${studyDiaryDistance}px,${Math.abs(studyDiaryDistance) * .025}px,6px) rotateY(${tilt}deg) rotateZ(${rotation}deg)`;
    studyPaperPage.style.opacity = String(1 - Math.abs(studyDiaryDistance) / 250);
  });
  const releaseStudyPaper = event => {
    if (!studyDiaryDragging) return;
    studyDiaryDragging = false;
    if (studyPaperPage.hasPointerCapture(event.pointerId)) studyPaperPage.releasePointerCapture(event.pointerId);
    const flick = performance.now() - studyDiaryStartTime < 230 && Math.abs(studyDiaryDistance) > 14;
    Math.abs(studyDiaryDistance) > 28 || flick ? switchStudyPaper(studyDiaryDistance < 0 ? 1 : -1) : returnStudyPaper();
  };
  studyPaperPage?.addEventListener('pointerup', releaseStudyPaper);
  studyPaperPage?.addEventListener('pointercancel', releaseStudyPaper);
  studyPaperPage?.addEventListener('click', event => {
    if (studyDiaryMoved) {
      event.preventDefault();
      studyDiaryMoved = false;
      return;
    }
    window.location.href = studyPaperPage.dataset.href || '/diary/';
  });
  studyPaperPage?.addEventListener('dragstart', event => event.preventDefault());
  scrim.addEventListener('click', closeSidebar);
  historyScrim.addEventListener('click', closeHistory);
  document.querySelector('[data-close-history]').addEventListener('click', closeHistory);
  const reflectionFlipCard = document.querySelector('[data-reflection-flip]');
  reflectionFlipCard?.addEventListener('click', () => {
    const showingReflection = reflectionFlipCard.getAttribute('aria-pressed') === 'true';
    reflectionFlipCard.setAttribute('aria-pressed', String(!showingReflection));
    reflectionFlipCard.setAttribute('aria-label', showingReflection ? '翻到 Cairn 的反思面' : '返回整合记忆正面');
  });
  const residentCard = document.querySelector('[data-resident-card]');
  const residentCardToggle = document.querySelector('[data-resident-card-toggle]');
  const residentSwapDuration = 150;
  function swapResidentText(node, text, asHtml = false) {
    if (!node) return;
    node.classList.add('is-exit');
    window.setTimeout(() => {
      if (asHtml) node.innerHTML = text;
      else node.textContent = text;
      node.classList.remove('is-exit');
      node.classList.add('is-enter-start');
      void node.offsetHeight;
      node.classList.remove('is-enter-start');
    }, residentSwapDuration);
  }
  residentCardToggle?.addEventListener('click', () => {
    const nextView = residentCard.dataset.currentView === 'self' ? 'user' : 'self';
    const next = residentCard._residentViews?.[nextView];
    if (!next) return;
    residentCard.dataset.currentView = nextView;
    residentCardToggle.setAttribute('aria-label', nextView === 'self' ? '切换到用户画像' : '切换到 self-core');
    residentCard.querySelectorAll('[data-resident-avatar]').forEach(avatar => {
      const isFront = avatar.dataset.residentAvatar === nextView;
      avatar.classList.toggle('is-front', isFront);
      avatar.classList.toggle('is-back', !isFront);
    });
    swapResidentText(document.querySelector('[data-resident-profile-copy]'), next.copy, true);
    swapResidentText(document.querySelector('[data-resident-profile-label]'), next.label);
    swapResidentText(document.querySelector('[data-resident-profile-now]'), next.now);
    swapResidentText(document.querySelector('[data-resident-profile-version]'), next.version);
  });
  document.querySelector('[data-achievement-map]')?.addEventListener('click', event => {
    const node = event.target.closest('[data-achievement-id]');
    if (node) showAchievement(node.dataset.achievementId);
  });
  document.querySelector('[data-achievement-detail]')?.addEventListener('click', event => {
    if (event.target.closest('[data-close-achievement]')) event.currentTarget.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backendRevisionOverlay.hidden) closeBackendRevision();
    else if (event.key === 'Escape' && !historySheet.hidden) closeHistory();
    else if (event.key === 'Escape') closeSidebar();
  });
  activityTabs.forEach(tab => tab.addEventListener('click', () => {
    activityTabs.forEach(item => item.setAttribute('aria-selected', String(item === tab)));
    moveActivityPill(tab);
    activeActivityMetric = tab.dataset.activityMetric;
    selectedActivityDay = null;
    const meta = activityMeta[activeActivityMetric];
    document.querySelector('[data-memory-activity]')?.style.setProperty('--activity-color', meta.color);
    document.querySelector('[data-activity-legend]').textContent = meta.legend;
    renderActivityGrid();
    renderActivitySummary();
  }));

  const initialParams = new URLSearchParams(window.location.search);
  const workbenchNow = new Date();
  const workbenchDateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'long', day: '2-digit' }).formatToParts(workbenchNow);
  const workbenchDateMap = Object.fromEntries(workbenchDateParts.map(part => [part.type, part.value]));
  const workbenchIsoParts = shanghaiToday();
  const workbenchDate = document.querySelector('[data-workbench-date]');
  if (workbenchDate) workbenchDate.dateTime = `${workbenchIsoParts.year}-${workbenchIsoParts.month}-${workbenchIsoParts.day}`;
  document.querySelector('[data-workbench-month]').textContent = (workbenchDateMap.month || '').toUpperCase();
  document.querySelector('[data-workbench-day]').textContent = workbenchIsoParts.day;
  document.querySelector('[data-workbench-weekday]').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(workbenchNow);
  syncWorkbenchStage();
  let restoredView = 'overview';
  try { restoredView = initialParams.get('view') || localStorage.getItem('moraine.activeView') || 'overview'; }
  catch (_) { restoredView = initialParams.get('view') || 'overview'; }
  showView(restoredView);
  const initialWorkbenchStep = initialParams.get('workbench');
  if (initialWorkbenchStep) {
    const normalizedWorkbenchStep = ['revise', 'supersede', 'weight'].includes(initialWorkbenchStep) ? 'structure' : initialWorkbenchStep;
    if (normalizedWorkbenchStep === 'integrate' || normalizedWorkbenchStep === 'structure') setMemoryWorkbenchView(normalizedWorkbenchStep);
    workbenchTabs.find((tab) => tab.dataset.workbenchStep === normalizedWorkbenchStep)?.click();
    const legacyStructureMode = { revise: 'content', supersede: 'relation', weight: 'weight' }[initialWorkbenchStep];
    if (legacyStructureMode) structureModeTabs.find((tab) => tab.dataset.structureMode === legacyStructureMode)?.click();
  }
  loadCairnProfile();
  loadRelationMap();
  loadLayeredRecall();
  loadSnapshots();
  if (document.querySelector('[data-development-lines]')) fetch('/api/memory-preview/development-lines', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(response => { if (!response.ok) throw new Error('development_lines_unavailable'); return response.json(); })
    .then(payload => {
      const lines = (payload.lines || []).filter(line => line.state === 'growing');
      const echoes = payload.echoes || [];
      document.querySelector('[data-development-count]').textContent = `${lines.length} / ${payload.active_limit || 3}`;
      document.querySelector('[data-development-lines]').innerHTML = lines.length ? lines.map(line => {
        const echo = [...echoes].reverse().find(item => item.line_id === line.id);
        return `<article class="development-line"><strong>${escapeHtml(line.title)}</strong><p>${escapeHtml(line.why)}</p>${echo ? `<small>最近回声 · ${escapeHtml(echo.note)}</small>` : '<small>还没有行动回声</small>'}</article>`;
      }).join('') : '<div class="development-empty">现在没有正在生长的发展线。空着也很好。</div>';
    })
    .catch(() => { document.querySelector('[data-development-lines]').innerHTML = '<div class="development-empty">暂时无法读取发展线，没有使用示例内容替代。</div>'; });
  if (studyPaperStack) loadStudyDiary();
  syncLibrarySearchState();
  requestAnimationFrame(() => moveTimeSortPill(timeDirectionButtons[0], false));
  requestAnimationFrame(() => moveWorkbenchPill(workbenchTabs[0], false));
  requestAnimationFrame(() => moveOwnershipPill(ownershipTabs[0], false));
  requestAnimationFrame(() => moveActivityPill(activityTabs.find(tab => tab.getAttribute('aria-selected') === 'true') || activityTabs[0], false));
  window.addEventListener('resize', () => {
    const activeTimeDirection = timeDirectionButtons.find((button) => button.getAttribute('aria-selected') === 'true') || timeDirectionButtons[0];
    moveTimeSortPill(activeTimeDirection, false);
    const activeWorkbench = workbenchTabs.find((button) => button.getAttribute('aria-selected') === 'true') || workbenchTabs[0];
    moveWorkbenchPill(activeWorkbench, false);
    const activeOwnership = ownershipTabs.find((button) => button.getAttribute('aria-selected') === 'true') || ownershipTabs[0];
    moveOwnershipPill(activeOwnership, false);
    const activeActivity = activityTabs.find((button) => button.getAttribute('aria-selected') === 'true') || activityTabs[0];
    moveActivityPill(activeActivity, false);
  });
})();
