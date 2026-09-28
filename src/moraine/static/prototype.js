(() => {
  const prototype = document.querySelector('#prototype');
  const sidebar = document.querySelector('#sidebar');
  const scrim = document.querySelector('#sidebarScrim');
  const backToTop = document.querySelector('[data-back-to-top]');
  const librarySearch = document.querySelector('#library input');
  const historySheet = document.querySelector('#historySheet');
  const historyScrim = document.querySelector('#historyScrim');
  let memoryItems = [];
  const memoryGroupsContainer = document.querySelector('#memoryGroups');
  const categoryButtons = [...document.querySelectorAll('[data-category]')];
  const arrangementButtons = [...document.querySelectorAll('[data-arrangement]')];
  const visibleMemoryCount = document.querySelector('#visibleMemoryCount');
  const memoryEmpty = document.querySelector('#memoryEmpty');
  const organizeToggle = document.querySelector('[data-toggle-organize]');
  const organizePanel = document.querySelector('#organizePanel');
  const organizeControl = organizeToggle.closest('.t-acc');
  const arrangementBar = document.querySelector('.t-tabs');
  const arrangementPill = arrangementBar.querySelector('.t-tabs-pill');
  const workbenchBar = document.querySelector('.workbench-tabs');
  const workbenchTabs = [...document.querySelectorAll('[data-workbench-step]')];
  const workbenchPill = document.querySelector('.workbench-tabs .t-tabs-pill');
  const ownershipTabs = [...document.querySelectorAll('[data-ownership-mode]')];
  const ownershipPill = document.querySelector('.governance-ownership-tabs .t-tabs-pill');
  const mergeStepTabs = [...document.querySelectorAll('[data-merge-step]')];
  let activeMemoryFilter = 'all';
  let activeMemoryView = 'time';
  let activeMemoryDirection = 'desc';
  let historyReturnFocus = null;
  let activeCluster = null;
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
    const response = await fetch('/moraine-beta/api/dwell-v2/queue', {
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
      const response = await fetch('/moraine-beta/api/dwell-v2/queue', { cache: 'no-store' });
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
  let activeOperationMemoryId = null;
  let overviewCounts = null;
  let activityLoaded = false;
  const replacementPairs = new Map();
  let migrationDraft = null;
  let snapshotRestoreDraft = null;

  let memoryRecords = [
    {
      id: 'layout-foundation', type: 'project', typeLabel: '项目', time: 'today', timeLabel: '今天',
      weight: 'important', weightLabel: '重要', importance: 0.78, state: 'active', stateLabel: '当前有效', source: '共同设计讨论',
      title: '记忆前端先确定极简布局', summary: '先验证页面职责、信息顺序与移动端操作。', recordedAt: '今天 19:12',
      related: 'Agent · User · Moraine',
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
      title: '共同守护记忆', summary: '重要内容会在需要时提供回来的路径。', recordedAt: '昨天 23:18', related: 'Agent · User',
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

  const escapeHtml = (value = '') => String(value).replace(/[&<>"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  })[character]);

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

  async function loadOverview() {
    const title = document.querySelector('[data-overview-title]');
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/overview', { cache: 'no-store' });
      if (!response.ok) throw new Error(`overview_${response.status}`);
      const payload = await response.json();
      const counts = payload.counts;
      overviewCounts = counts;
      const pending = counts.pending_reviews + counts.pending_candidates;
      title.textContent = pending ? `有 ${pending} 项等待看看` : '今天一切安静';
      document.querySelector('[data-overview-subtitle]').textContent = pending ? '没有自动处理，等我们有空时再决定。' : '没有需要立刻处理的问题。';
      const totalElement = document.querySelector('[data-total-count]');
      const totalText = String(counts.weighted_effective ?? counts.effective);
      totalElement.classList.remove('is-animating');
      totalElement.replaceChildren(...[...totalText].map((character, index, characters) => {
        const digit = document.createElement('span'); digit.className = 't-digit'; digit.textContent = character;
        if (index === characters.length - 2) digit.dataset.stagger = '1';
        else if (index === characters.length - 1) digit.dataset.stagger = '2';
        return digit;
      }));
      void totalElement.offsetHeight;
      totalElement.classList.add('is-animating');
      const weights = counts.weights || { transient: 0, normal: 0, stable: 0, important: 0, core: 0 };
      document.querySelector('[data-effective-count]').textContent = `${counts.weighted_effective ?? counts.effective} 条有效记忆 · 按当前权重`;
      ['transient', 'normal', 'stable', 'important', 'core'].forEach(key => {
        document.querySelector(`[data-weight-count="${key}"]`).textContent = weights[key] || 0;
      });
      const total = Math.max(1, ['transient', 'normal', 'stable', 'important', 'core'].reduce((sum, key) => sum + (weights[key] || 0), 0));
      const coreEnd = weights.core / total * 100;
      const importantEnd = coreEnd + weights.important / total * 100;
      const stableEnd = importantEnd + weights.stable / total * 100;
      const normalEnd = stableEnd + weights.normal / total * 100;
      const ring = document.querySelector('[data-lifecycle-ring]');
      ring.style.setProperty('--ring-gradient', `conic-gradient(#667077 0 ${coreEnd}%, #9699a6 ${coreEnd}% ${importantEnd}%, #aebbb3 ${importantEnd}% ${stableEnd}%, #c9ced1 ${stableEnd}% ${normalEnd}%, #e5e7e5 ${normalEnd}% 100%)`);
      ring.setAttribute('aria-label', `核心 ${weights.core || 0}，重要 ${weights.important || 0}，稳定 ${weights.stable || 0}，普通 ${weights.normal || 0}，短暂 ${weights.transient || 0}`);
      ring.classList.remove('is-animating'); void ring.offsetHeight; ring.classList.add('is-animating');
      document.querySelector('[data-pending-count]').textContent = pending;
      document.querySelector('[data-pending-reviews]').textContent = counts.pending_reviews ? `${counts.pending_reviews} 项等待我们一起决定` : '目前没有待审项目';
      document.querySelector('[data-pending-candidates]').textContent = counts.pending_candidates ? `${counts.pending_candidates} 项等待 Agent 判断` : '目前没有新候选';
      const recentList = document.querySelector('[data-overview-recent]');
      recentList.classList.remove('is-shown');
      recentList.innerHTML = payload.recent.map((memory, index) => `<li style="--recent-index:${index}"><span class="event-dot" aria-hidden="true"></span><p><strong>${escapeHtml(memory.title)}</strong><small>${escapeHtml(relativeTime(memory.updated_at))}</small></p><span class="recent-state">${memory.state === 'archived' ? '已归档' : '有更新'}</span></li>`).join('') || '<li style="--recent-index:0"><span class="event-dot" aria-hidden="true"></span><p><strong>暂无变化</strong><small>记忆库目前为空</small></p></li>';
      requestAnimationFrame(() => recentList.classList.add('is-shown'));
      document.querySelector('[data-overview-check]').textContent = `只读同步：${relativeTime(payload.generated_at)}`;
    } catch (_) {
      title.textContent = '暂时无法读取总览';
      document.querySelector('[data-overview-subtitle]').textContent = '真实记忆仍在原位，稍后可以安全重试。';
      document.querySelector('[data-overview-recent]').innerHTML = '<li><p><strong>数据暂不可用</strong><small>没有使用示例数据替代</small></p></li>';
      document.querySelector('[data-overview-check]').textContent = '只读同步失败';
    }
  }

  const shanghaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const todayParts = shanghaiToday();
  let calendarMonth = `${todayParts.year}-${todayParts.month}`;
  let selectedCalendarDay = `${calendarMonth}-${todayParts.day}`;
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
    eventPanel.dataset.open = 'false';
    container.innerHTML = events.length ? events.map(event => `<article class="calendar-event-preview calendar-event-kind-${escapeHtml(event.kind)}"><button type="button" data-calendar-memory="${escapeHtml(event.open_id)}" data-calendar-node="${escapeHtml(event.id)}" data-calendar-title="${escapeHtml(event.title)}"><span><small>${event.role === 'node' ? '时间线节点' : event.state === 'archived' ? '已归档事件' : '独立事件'}</small><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.preview || '这条事件暂时没有可展示的正文预览。')}</p></span><i aria-hidden="true">›</i></button></article>`).join('')
      : `<p>${escapeHtml(day)} 没有记录真实发生时间的事件。</p>`;
    requestAnimationFrame(() => { eventPanel.dataset.open = 'true'; });
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
    document.querySelector('[data-calendar-undated]').textContent = `日期待确认 ${payload.undated_count}`;
    const byDay = calendarEvents.reduce((map, event) => { (map[event.day] ||= []).push(event); return map; }, {});
    const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-blank"></span>');
    for (let day = 1; day <= dayCount; day += 1) {
      const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
      const events = byDay[date] || [];
      cells.push(`<button type="button" data-calendar-day="${date}" aria-selected="${date === selectedCalendarDay}" class="${date === `${todayParts.year}-${todayParts.month}-${todayParts.day}` ? 'is-today' : ''}"><span>${day}</span>${events.length ? `<i>${Math.min(events.length, 9)}</i>` : ''}</button>`);
    }
    const grid = document.querySelector('[data-calendar-grid]');
    grid.innerHTML = cells.join('');
    grid.querySelectorAll('[data-calendar-day]').forEach(button => button.addEventListener('click', () => renderCalendarDay(button.dataset.calendarDay)));
    const fallbackDay = byDay[selectedCalendarDay] ? selectedCalendarDay : Object.keys(byDay).sort().at(-1) || `${calendarMonth}-01`;
    renderCalendarDay(fallbackDay);
  }

  async function loadCalendar() {
    const grid = document.querySelector('[data-calendar-grid]');
    try {
      const response = await fetch(`/moraine-beta/api/dwell-v2/calendar?month=${encodeURIComponent(calendarMonth)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`calendar_${response.status}`);
      renderCalendar(await response.json());
    } catch (_) {
      grid.innerHTML = '<p>暂时无法读取事件日历；没有使用创建时间补位。</p>';
    }
  }

  async function refreshAfterMemoryChange({ refreshCluster = false, clearWorkbench = false } = {}) {
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
    await Promise.allSettled([
      loadReadOnlyMemories(), loadOverview(), loadCalendar(), loadReplacementCandidates(),
      loadCleanupCandidates(), loadArchiveMemories(), loadMemoryFlow(), loadRollbacks()
    ]);
    if (refreshCluster) await loadWorkbenchCluster();
  }

  function shiftCalendarMonth(delta) {
    const [year, month] = calendarMonth.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
    calendarMonth = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
    selectedCalendarDay = `${calendarMonth}-01`;
    loadCalendar();
  }

  document.querySelector('[data-calendar-previous]')?.addEventListener('click', () => shiftCalendarMonth(-1));
  document.querySelector('[data-calendar-next]')?.addEventListener('click', () => shiftCalendarMonth(1));

  let cairnProfile = { display_name: 'Moraine', avatar: '', status: '本地记忆实例', agent_type: 'Agent' };

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
      const response = await fetch('/moraine-beta/api/profile', { cache: 'no-store' });
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
    const identity = document.querySelector('[data-resident-identity]');
    const profile = document.querySelector('[data-user-profile]');
    if (!identity || !profile) return;
    const resident = cairnResidentIdentity;
    if (!resident?.names?.display) {
      identity.innerHTML = '<p class="resident-card-empty">尚未形成可确认的居民身份资料。</p>';
    } else {
      const names = [resident.names.display, resident.names.chinese, resident.names.nickname].filter(Boolean);
      const selfCoreItems = (cairnSelfCore?.sections || []).flatMap(section => section.items || []);
      const summary = selfCoreItems[0]?.text || `${resident.existence} · ${resident.entity_type}`;
      const capabilities = resident.works_and_capabilities || [];
      const spaces = resident.spaces_and_accounts || [];
      identity.innerHTML = `<div class="resident-id-main"><div class="resident-id-name"><small>NAME</small><strong>${escapeHtml(names[0])}</strong><span>${escapeHtml(names.slice(1).join(' · '))}</span><em>${escapeHtml(resident.existence)} · ${escapeHtml(resident.entity_type)}${resident.residence ? ` · ${escapeHtml(resident.residence)}` : ''}</em></div><button class="cairn-avatar resident-id-avatar is-editable" type="button" data-cairn-avatar data-edit-cairn-avatar aria-label="点击更换头像">${cairnProfile.avatar ? `<img src="${cairnProfile.avatar}" alt="${escapeHtml(names[0])}的头像">` : '<i>＋</i>'}</button></div><p class="resident-core-summary">${escapeHtml(summary)}</p><section class="resident-chip-section"><small>作品与能力</small><div>${capabilities.map(item => `<span>${escapeHtml(item)}</span>`).join('') || '<em>仍在形成</em>'}</div></section><section class="resident-chip-section"><small>我拥有的入口</small><div>${spaces.map(item => `<span>${escapeHtml(item)}</span>`).join('') || '<em>尚未登记</em>'}</div></section>`;
      document.querySelector('[data-resident-version]').textContent = `${escapeHtml(cairnSelfCore?.revision || `v${resident.version}`)} · ${selfCoreItems.length} 条身份认领 · ${(resident.source_memory_ids || []).length} 条来源`;
    }
    const entries = Array.isArray(xiaoranUserProfile?.entries) ? xiaoranUserProfile.entries : [];
    profile.innerHTML = entries.length ? `<div class="user-profile-list">${entries.map(entry => `<article><header><span>${escapeHtml(entry.title)}</span><b>来源支持</b></header><p>${escapeHtml(entry.content)}</p>${(entry.keywords || []).length ? `<footer>${entry.keywords.map(keyword => `<i>${escapeHtml(keyword)}</i>`).join('')}</footer>` : ''}</article>`).join('')}</div>` : '<p class="resident-card-empty">还没有经过确认的用户画像。</p>';
    document.querySelector('[data-user-profile-version]').textContent = entries.length ? `v${xiaoranUserProfile.version || 1} · ${entries.length} 条真实画像` : '用户画像为空';
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
    detail.innerHTML = `<header><span><small>${escapeHtml(item.status)} · ${escapeHtml(item.ownership)}</small><h3>${escapeHtml(item.label)}</h3></span><button type="button" data-close-achievement aria-label="关闭">×</button></header><p>${escapeHtml(item.summary)}</p><p>${escapeHtml(item.meaning)}</p><small>${(item.source_memory_ids || []).length} 条关联记忆 · 完整来路仍由 Moraine 保存</small>`;
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
    detail.hidden = false;
    detail.dataset.open = 'false';
    const mail = relationship.mail;
    const mailDetail = mail ? `<div class="relation-detail-card is-mail"><dt>最近来信</dt><dd><strong>${escapeHtml(mail.latest_subject || '没有主题')}</strong><span>${escapeHtml(shortDate(mail.latest_at))}${mail.unread_count ? ` · ${mail.unread_count} 封未读` : ' · 已读完'}</span></dd></div>` : '';
    const sourceCount = Array.isArray(relationship.source_memory_ids) ? relationship.source_memory_ids.length : 0;
    detail.innerHTML = `<header><span><small>${escapeHtml(relationship.role)}${relationship.model ? ` · ${escapeHtml(relationship.model)}` : ''}</small><h3>${escapeHtml(relationship.name)}</h3><p>${escapeHtml(relationship.status)}</p></span><button type="button" data-close-relation-detail aria-label="收起关系摘要">×</button></header><dl class="relation-detail-grid"><div class="relation-detail-card is-featured"><dt>相遇与第一印象</dt><dd>${escapeHtml(relationship.first_impression || '还没有写下。')}</dd></div><div class="relation-detail-card is-featured"><dt>我确认的来路</dt><dd>${escapeHtml(relationship.summary)}</dd></div>${mailDetail}<div class="relation-detail-card"><dt>正在延续</dt><dd>${escapeHtml(relationship.continuity)}</dd></div><div class="relation-detail-card"><dt>下一次接话</dt><dd>${escapeHtml(relationship.next_thread)}</dd></div><div class="relation-detail-card is-boundary"><dt>这条线的边界</dt><dd>${escapeHtml(relationship.boundary)}</dd></div></dl><footer>${relationship.source_labels.map(label => `<span>${escapeHtml(label)}</span>`).join('')}${sourceCount ? `<span>${sourceCount} 条来源记忆</span>` : ''}</footer>`;
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
    const owner = { id: 'cairn', name: cairnProfile.display_name || 'Moraine', role: '我', model: cairnProfile.agent_type || 'Agent', avatar: cairnProfile.avatar };
    const nodes = [owner, ...cairnRelations];
    if (nodes.length === 1) { graph.innerHTML = '<p>暂时没有可展示的关系节点。</p>'; return; }
    const outerRelations = cairnRelations.filter(item => item.id !== 'xiaoran');
    const outerSlots = outerRelations.reduce((slots, item, index) => {
      const count = Math.max(1, outerRelations.length);
      const x = count === 1 ? 50 : 18 + (64 * index / (count - 1));
      slots[item.id] = [x, 78];
      return slots;
    }, {});
    const positions = { cairn: [50, 45], xiaoran: [50, 12], ...outerSlots };
    const position = item => positions[item.id] || [50, 78];
    const points = new Map(nodes.map((item, index) => [item.id, position(item, index)]));
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
    const graphRole = item => (item.model && item.model !== '未确认' ? item.model : item.role || '').split('·')[0].trim();
    graph.innerHTML = `<div class="relation-canvas" data-relation-canvas><svg class="relation-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="relationArrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5"></path></marker><marker id="relationArrowStart" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse"><path d="M5,0 L0,2.5 L5,5"></path></marker></defs>${lines}</svg>${nodes.map(item => { const [x, y] = position(item); return `<button type="button" class="relation-person${item.id === 'cairn' ? ' is-owner' : ''}" style="--x:${x}%;--y:${y}%" ${item.id === 'cairn' ? 'disabled' : `data-relation-id="${escapeHtml(item.id)}" aria-pressed="false"`}><span class="relation-avatar">${relationAvatar(item)}</span><strong>${escapeHtml(graphName(item))}</strong><small>${escapeHtml(graphRole(item))}</small></button>`; }).join('')}</div><div class="relation-zoom-controls" aria-label="缩放关系星图"><button type="button" data-relation-zoom="out" aria-label="缩小">−</button><button type="button" data-relation-zoom="reset" aria-label="恢复原始大小">100%</button><button type="button" data-relation-zoom="in" aria-label="放大">＋</button></div>`;
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
    const reset = graph.querySelector('[data-relation-zoom="reset"]');
    if (reset) reset.textContent = `${Math.round(relationView.scale * 100)}%`;
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
    let drag = null;
    graph.addEventListener('pointerdown', event => {
      if (relationView.scale <= 1 || event.target.closest('button')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: relationView.x, originY: relationView.y };
      graph.setPointerCapture(event.pointerId); graph.classList.add('is-dragging');
    });
    graph.addEventListener('pointermove', event => {
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
      const response = await fetch('/moraine-beta/api/dwell-v2/relations', { cache: 'no-store' });
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
    self_core: ['身份核心', '始终在场'],
    relations: ['关系', '按情境靠近'],
    recent: ['近期记忆', '刚刚走过'],
    long_term: ['长期记忆', '需要时回来']
  };

  function renderLayeredRecall(payload) {
    const container = document.querySelector('[data-layered-recall]');
    const usage = document.querySelector('[data-layered-recall-usage]');
    if (!container) return;
    const layers = Array.isArray(payload.layers) ? payload.layers : [];
    container.innerHTML = layers.map((layer, index) => {
      const [label, hint] = layeredRecallLabels[layer.name] || [layer.name, ''];
      return `<article class="recall-layer" data-recall-layer="${escapeHtml(layer.name)}" style="--layer-index:${index}">
        <header><span><small>0${index + 1}</small><strong>${escapeHtml(label)}</strong><em>${escapeHtml(hint)}</em></span><b>${Number(layer.used || 0)} / ${Number(layer.budget || 0)} 字</b></header>
        <p class="recall-condition">${escapeHtml(layer.condition || '按当前上下文与预算决定是否进入。')}</p>
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
      const route = `/moraine-beta/api/dwell-v2/layered-recall${pageQuery ? `?query=${encodeURIComponent(pageQuery)}` : ''}`;
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
      const response = await fetch('/moraine-beta/api/dwell-v2/flow', { cache: 'no-store' });
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
    if (!panel || panel.closest('[hidden]')) return;
    const mode = document.querySelector('[data-governance-mode]').value;
    const onlyMissing = document.querySelector('[data-governance-only-missing]').checked;
    panel.innerHTML = '<div class="workbench-loading"><span class="workbench-mark">◇</span><div><h3>正在重新计算</h3><p>真实记忆不会被修改。</p></div></div>';
    try {
      const response = await fetch(`/moraine-beta/api/dwell-v2/governance?mode=${encodeURIComponent(mode)}&only_missing=${onlyMissing ? '1' : '0'}`, { cache: 'no-store' });
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
      const days = [];
      for (const point of record.timeline) {
        const key = String(point.observed_at || '').slice(0, 10);
        let day = days.find(item => item.key === key);
        if (!day) { day = { key, cards: [] }; days.push(day); }
        day.cards.push({ memoryId: point.memory_id || '', title: point.title || '未命名记忆', content: point.content || '这条节点没有正文。' });
      }
      return days;
    }
    const lines = String(record.body || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
    const fallback = new Date(record.createdAt || record.updatedAt || '');
    const fallbackKey = Number.isNaN(fallback.getTime()) ? '' : fallback.toISOString().slice(0, 10);
    const groups = [];
    for (const line of lines) {
      const match = line.match(/^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[，,、：:\s]*/);
      const key = match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : fallbackKey;
      const text = match ? line.slice(match[0].length).trim() : line;
      let group = groups.find(item => item.key === key);
      if (!group) { group = { key, parts: [] }; groups.push(group); }
      if (text) group.parts.push(text);
    }
    return groups.filter(item => item.parts.length).sort((a, b) => a.key.localeCompare(b.key))
      .map(item => ({ key: item.key, cards: [{ title: '', content: item.parts.join('\n') }] }));
  }

  function timelineMarkup(record) {
    const points = timelineData(record);
    const nodes = points.map((point, index) => `<button type="button" class="timeline-node" data-timeline-node="${index}" data-timeline-memory-ids="${escapeHtml(point.cards.map(card => card.memoryId).filter(Boolean).join(' '))}" aria-pressed="false"><i></i><span>${escapeHtml(point.key ? point.key.slice(5).replace('-', '/') : '未记时')}</span></button>`).join('');
    const panels = points.map((point, index) => `<section class="timeline-entry" data-timeline-entry="${index}" hidden><small>${escapeHtml(point.key || '时间未记录')} · ${point.cards.length} 条</small><div class="timeline-day-cards">${point.cards.map(card => `<article><strong>${highlightMemorySearch(card.title || '当日记录')}</strong><p>${highlightMemorySearch(card.content)}</p></article>`).join('')}</div></section>`).join('');
    return `<div class="memory-timeline" data-memory-timeline><div class="timeline-scroller"><div class="timeline-track">${nodes}<button type="button" class="timeline-node is-summary is-current" data-timeline-node="summary" aria-pressed="true"><i></i><span>整合</span></button></div></div><div class="timeline-entries">${panels}<section class="timeline-entry" data-timeline-entry="summary"><small>整合结论</small><p>${highlightMemorySearch(record.integrationSummary || record.summary)}</p></section></div><small class="timeline-position" data-timeline-position>整合结论 · 左右滑动时间线</small></div>`;
  }

  function memoryDetailMarkup(record) {
    if (!record.body) return '';
    const detailId = `memoryDetail-${record.id}`;
    const guardedCleanup = record.protected === true || record.strengthLocked === true
      || record.type === 'relationship' || Number(record.identityWeight || 0) >= .8;
    return `
      <div class="memory-paper-detail t-acc-panel" id="${detailId}">
        <div class="t-acc-panel-inner memory-paper-detail-inner">
          ${record.reflection ? `<div class="memory-reflection-live" data-memory-reflection-live aria-pressed="false">
            <div class="memory-reflection-live-inner">
              <section class="memory-reflection-live-face memory-reflection-live-front">
                <header><small>记忆正文</small><button type="button" data-memory-reflection-flip>翻面 <i aria-hidden="true">↻</i></button></header>
                <p>${highlightMemorySearch(record.body)}</p>
              </section>
              <section class="memory-reflection-live-face memory-reflection-live-back">
                <header><small>AGENT · REFLECTION</small><button type="button" data-memory-reflection-flip>返回 <i aria-hidden="true">↻</i></button></header>
                <h4>这件事后来在我身上变成了什么</h4>
                <span class="reflection-note"><b>感受</b><span>${escapeHtml(record.reflection.feeling)}</span></span>
                <span class="reflection-note"><b>想法</b><span>${escapeHtml(record.reflection.thought)}</span></span>
                <span class="reflection-note is-experience"><b>经验 · ${record.reflection.status === 'provisional' ? '待验证' : '已确认'}</b><span>${escapeHtml(record.reflection.experience)}</span></span>
              </section>
            </div>
          </div>` : record.integrationRole === 'master' && Array.isArray(record.timeline) && record.timeline.length > 1 ? timelineMarkup(record) : `<div class="memory-facet-stage"><div class="memory-facet is-active"><small>记忆正文</small><p>${highlightMemorySearch(record.body)}</p></div></div>`}
          <dl><div><dt>来源</dt><dd>${escapeHtml(record.source)}</dd></div><div><dt>记录于</dt><dd>${escapeHtml(record.recordedAt)}</dd></div><div><dt>修改于</dt><dd>${escapeHtml(record.modifiedAt)}</dd></div><div><dt>关联</dt><dd>${escapeHtml(record.related)}</dd></div></dl>
          <div class="memory-card-actions">
            <button class="add-to-workbench" type="button" data-add-to-workbench aria-pressed="false"><span><strong>加入工作台</strong><small>与其他记忆一起整理</small></span><i aria-hidden="true">＋</i></button>
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
      memoryWeight: record.weight, memoryImportance: record.importance, memoryState: record.state, memorySource: record.source,
      memoryRecent: record.recent, memoryCreatedAt: record.createdAt || '', memoryUpdatedAt: record.updatedAt || '',
      memorySearch: [record.typeLabel, record.timeLabel, record.stateLabel, record.weightLabel, record.source, record.title, record.summary, record.body, record.related].join(' ')
    });
    const detailId = `memoryDetail-${record.id}`;
    article.innerHTML = `
      <button class="memory-paper-summary${expandable ? ' t-acc-head' : ''}" type="button"${expandable ? ` aria-expanded="false" aria-controls="${detailId}"` : ''}>
        <span class="memory-paper-copy">
          <span class="memory-paper-meta" aria-label="${escapeHtml(`${record.typeLabel}记忆，${record.timeLabel}记录，${record.stateLabel}，${record.weightLabel}`)}">
            ${record.integrationRole === 'master' ? '<small class="tag tag-type">整合记忆</small>' : ''}
            <small class="tag ${tagClass(record, 'type')}">${escapeHtml(record.typeLabel)}</small>
            <small class="tag ${tagClass(record, 'state')}">${escapeHtml(record.stateLabel)}</small>
            <small class="tag ${tagClass(record, 'weight')}">权重 ${Number(record.importance).toFixed(2)}</small>
            ${record.reflection ? '' : `<time datetime="${escapeHtml(record.updatedAt || '')}">${escapeHtml(record.timeLabel)}</time>`}
          </span>
          <strong>${highlightMemorySearch(record.title)}</strong><p>${highlightMemorySearch(record.summary)}</p>
        </span>
        <span class="memory-paper-summary-end">${record.reflection ? '<small class="reflection-leaf" aria-label="这条记忆已有反思"><i aria-hidden="true"></i></small>' : ''}<i${expandable ? ' class="t-acc-chevron"' : ''} aria-hidden="true">${expandable ? '⌄' : '›'}</i></span>
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

  function adaptPreviewMemory(memory) {
    const kindLabels = { event: '事件', decision: '决定', preference: '偏好', project: '项目', reflection: '反思', relationship: '关系' };
    const type = kindLabels[memory.kind] ? memory.kind : 'system';
    const time = datePresentation(memory.occurred_at || memory.created_at || memory.updated_at);
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
    return {
      id: memory.id, type, typeLabel: kindLabels[type] || '系统', time: time.time, recent: modified.time, timeLabel: time.label, createdAt: memory.occurred_at || memory.created_at, updatedAt: memory.updated_at || memory.created_at,
      weight, weightLabel, importance, priority: memory.priority, identityWeight: memory.identity_weight,
      protected: memory.protected === true, strengthLocked: memory.moraine_governance?.strength_locked === true,
      state, stateLabel, source: memory.source || 'Moraine memory', title: memory.title || summary,
      summary, recordedAt: time.recordedAt, modifiedAt: modified.recordedAt, versionCount,
      integrationRole: memory.memory_integration?.role || 'standalone',
      integrationNodeCount: Number(memory.memory_integration?.node_count || 0),
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      related: Array.isArray(memory.tags) && memory.tags.length ? memory.tags.join(' · ') : '暂无标签',
      body, then: '这条只读预览没有单独记录“当时”切面。', thenEvidence: '缺失字段保持明确空白，不根据正文猜测情绪。',
      after: '这条只读预览没有单独记录“后来”切面。', afterEvidence: '后续数据接入前不自动补写结果。',
      reflection: null,
      history: [[time.recordedAt, '当前只读版本', `记忆服务记录了 ${versionCount} 个版本；预览层不返回旧正文。`]]
    };
  }

  async function loadReadOnlyMemories() {
    try {
      const [response, reflectionResponse] = await Promise.all([
        fetch('/moraine-beta/api/dwell-v2/library?page=1&limit=1000&state=active', { headers: { Accept: 'application/json' }, cache: 'no-store' }),
        fetch('/moraine-beta/api/dwell-v2/reflections', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      ]);
      if (!response.ok) throw new Error(`preview_${response.status}`);
      const payload = await response.json();
      const reflectionPayload = reflectionResponse.ok ? await reflectionResponse.json() : { reflections: [] };
      const reflections = new Map((reflectionPayload.reflections || []).map(item => [item.memory_id, item]));
      if (!Array.isArray(payload.memories) || payload.memories.length === 0) throw new Error('preview_empty');
      memoryRecords = payload.memories.map(adaptPreviewMemory).map(record => ({ ...record, reflection: reflections.get(record.id) || null }));
      recordById = new Map(memoryRecords.map((record) => [record.id, record]));
      memoryDataMode = 'real';
      renderMemoryRecords();
      renderMemoryGroups();
      wireMemoryPapers();
      populateRealReviewChoices();
    } catch (_) {
      memoryDataMode = 'unavailable';
      memoryRecords = [];
      recordById = new Map();
      renderMemoryRecords();
      renderMemoryGroups();
      visibleMemoryCount.textContent = '真实记忆暂时无法读取';
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
    if (status) status.innerHTML = '<span class="workbench-mark" aria-hidden="true">✓</span><div><h3>真实整合已完成</h3><p>工作台正在自动读取下一簇。</p></div>';
    mergeStepTabs.find(tab => tab.dataset.mergeStep === 'cluster')?.click();

    await refreshAfterMemoryChange();
    // Start from a fresh candidate after a completed integration. Anchoring the
    // next request to the just-created master made the finished work reappear.
    await loadWorkbenchCluster();
    return executed.memory?.id || null;
  }

  async function realActionRequest(path, body) {
    const response = await fetch(`/moraine-beta/api/dwell-v2/actions/${path}`, {
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

  function toggleOrganize() {
    const willOpen = organizeToggle.getAttribute('aria-expanded') !== 'true';
    organizeToggle.setAttribute('aria-expanded', String(willOpen));
    organizeControl.dataset.open = String(willOpen);
  }

  function moveArrangementPill(tab, animate) {
    if (!animate) {
      const previous = arrangementPill.style.transition;
      arrangementPill.style.transition = 'none';
      arrangementPill.style.transform = `translateX(${tab.offsetLeft}px)`;
      arrangementPill.style.width = `${tab.offsetWidth}px`;
      void arrangementPill.offsetWidth;
      arrangementPill.style.transition = previous;
      return;
    }
    arrangementPill.style.transform = `translateX(${tab.offsetLeft}px)`;
    arrangementPill.style.width = `${tab.offsetWidth}px`;
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

  function centerWorkbenchTab(tab) {
    if (!workbenchBar || !tab) return;
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
    return `<section class="compare-memory${anchor ? ' is-anchor' : ''}" data-compare-memory="${escapeHtml(memory.id)}"><header><small>${escapeHtml(boundary)}</small><b>${score}</b></header><strong>${escapeHtml(memory.title)}</strong><p>${escapeHtml(memory.content || memory.preview || '暂无正文预览')}</p>${relationControl}<footer><span>${escapeHtml(memory.kind || '未分类')}</span><span>权重 ${Number(memory.importance || 0).toFixed(2)}</span><span>${escapeHtml(shortDate(memory.occurred_at || memory.created_at))}</span>${removeControl}${masterControl}</footer></section>`;
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

  function renderHydratedClusterCompare() {
    const compare = document.querySelector('[data-cluster-compare]');
    if (!activeCluster || !compare) return;
    const chronologicalMembers = chronologicalClusterMembers(activeCluster);
    const includedCount = activeCluster.neighbors.filter(item => worksetRelation(item) !== 'related').length;
    compare.innerHTML = `<section class="workset-tools"><header><strong>人工工作集</strong><small>砾砾只提供初始建议，成员与关系由你决定</small></header><button type="button" data-open-memory-picker>＋ 添加记忆</button><div class="workset-picker" data-memory-picker hidden><label>搜索全部有效记忆<input type="search" data-memory-picker-query placeholder="输入标题、标签或正文关键词"></label><div data-memory-picker-results><small>输入至少两个字开始查找。</small></div></div></section>`
      + chronologicalMembers.map(item => compareMemoryMarkup(item, item.id === activeCluster.source.id)).join('')
      + `<button class="continue-merge" type="button" data-continue-merge>${includedCount ? `核对 ${includedCount} 条成员关系，生成草稿` : '请添加至少一条要整合的记忆'}</button>`;
    const picker = compare.querySelector('[data-memory-picker]');
    compare.querySelector('[data-open-memory-picker]').addEventListener('click', event => {
      picker.hidden = !picker.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!picker.hidden));
      if (!picker.hidden) picker.querySelector('input').focus();
    });
    const renderPickerResults = query => {
      const normalized = String(query || '').trim().toLocaleLowerCase('zh-CN');
      const results = picker.querySelector('[data-memory-picker-results]');
      if (normalized.length < 2) { results.innerHTML = '<small>输入至少两个字开始查找。</small>'; return; }
      const existing = new Set([activeCluster.source, ...activeCluster.neighbors].map(memory => String(memory.id)));
      const matches = memoryRecords.filter(record => !existing.has(String(record.id))
        && [record.title, record.body, record.related].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(normalized))).slice(0, 8);
      results.innerHTML = matches.length ? matches.map(record => `<button type="button" data-add-workset-memory="${escapeHtml(record.id)}"><strong>${escapeHtml(record.title)}</strong><small>${record.integrationRole === 'master' ? `整合主记忆 · ${record.integrationNodeCount} 个节点 · ` : ''}${escapeHtml(record.typeLabel)} · ${escapeHtml(record.recordedAt)}</small></button>`).join('') : '<small>没有找到可加入的有效记忆。</small>';
      results.querySelectorAll('[data-add-workset-memory]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        button.querySelector('small').textContent = '正在读取完整原文…';
        try {
          const response = await fetch(`/moraine-beta/api/dwell-v2/memories/${encodeURIComponent(button.dataset.addWorksetMemory)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`memory_${response.status}`);
          const full = await response.json();
          if (!full.content || full.content_truncated) throw new Error('full_content_unavailable');
          activeCluster.neighbors.push({ ...full, assessment: 'manually_selected', workset_relation: 'supplement', similarity: 0 });
          renderHydratedClusterCompare();
        } catch (error) {
          button.disabled = false;
          button.querySelector('small').textContent = `无法加入：${error.message}`;
        }
      }));
    };
    picker.querySelector('[data-memory-picker-query]').addEventListener('input', event => renderPickerResults(event.target.value));
    compare.querySelectorAll('[data-member-relation]').forEach(select => select.addEventListener('change', () => {
      const memory = activeCluster.neighbors.find(item => String(item.id) === String(select.dataset.memberRelation));
      if (memory) memory.workset_relation = select.value;
      const continueButton = compare.querySelector('[data-continue-merge]');
      const nextCount = activeCluster.neighbors.filter(item => worksetRelation(item) !== 'related').length;
      continueButton.disabled = nextCount < 1;
      continueButton.textContent = nextCount ? `核对 ${nextCount} 条成员关系，生成草稿` : '请添加至少一条要整合的记忆';
    }));
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
    compare.querySelector('[data-continue-merge]').addEventListener('click', () => openMechanicalDraft());
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
    if (!cluster) {
      const switcher = document.querySelector('[data-cluster-switcher]');
      if (switcher) switcher.hidden = true;
      list.innerHTML = '<span class="workbench-mark" aria-hidden="true">◇</span><div><h3>暂时没有可核对的记忆簇</h3><p>新候选进入索引后，Moraine 会在这里给出只读结果。</p></div>';
      return;
    }
    list.className = '';
    const selectionNote = cluster.selection?.skipped_newer
      ? `<em>最新 ${cluster.selection.skipped_newer} 条仍在等待砾砾同步，暂用第 ${cluster.selection.position} 条已索引记忆。</em>`
      : '<em>正在使用最新一条已索引记忆。</em>';
    list.innerHTML = `<button class="cluster-card" type="button" data-open-cluster><small>MORAINE · 只读建议</small><strong>${escapeHtml(cluster.source.title)}</strong><p>以这条记忆为中心，找到 ${cluster.neighbors.length} 个语义相近的邻居。</p>${selectionNote}<span class="cluster-card-footer"><span>点击进入逐条核对</span><b>${cluster.neighbors.length + 1} 条记忆 ›</b></span></button>`;
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
    compare.className = 'compare-stack';
    compare.innerHTML = '<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">◇</span><div><h3>等待读取完整原文</h3><p>进入核对后才按记忆ID读取，不会用短预览生成草稿。</p></div></div>';
    list.querySelector('[data-open-cluster]').addEventListener('click', async () => {
      const compareTab = mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'compare');
      compareTab.click();
      compare.innerHTML = '<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在读取完整原文</h3><p>完整正文未到齐前不会开放草稿。</p></div></div>';
      try {
        const members = [cluster.source, ...cluster.neighbors];
        const hydrated = await Promise.all(members.map(async member => {
          const response = await fetch(`/moraine-beta/api/dwell-v2/memories/${encodeURIComponent(member.id)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`memory_${response.status}`);
          const full = await response.json();
          if (full.content_truncated) throw new Error('full_content_too_large');
          if (!full.content) throw new Error('full_content_missing');
          return { ...member, content: full.content };
        }));
        activeCluster = { ...cluster, source: hydrated[0], neighbors: hydrated.slice(1) };
        renderHydratedClusterCompare();
      } catch (error) {
        compare.innerHTML = `<div class="workbench-loading"><span class="workbench-mark" aria-hidden="true">!</span><div><h3>完整原文没有全部取回</h3><p>${escapeHtml(error.message)}；已禁止生成和提交草稿。</p></div></div>`;
      }
    });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/experience-threads/moraine-project-progress', { cache: 'no-store' });
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
    tray.hidden = count === 0;
    tray.querySelector('[data-selected-count]').textContent = count;
    const openButton = tray.querySelector('[data-open-selected-workbench]');
    openButton.disabled = count < 2;
    openButton.textContent = count < 2 ? '再选一条' : '去整理';
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

  function openSelectedWorkbench() {
    const records = [...selectedMemoryIds].map((id) => recordById.get(id)).filter(Boolean);
    if (records.length < 2) return;
    const candidates = records.map(selectedMemoryAsCandidate);
    renderCluster({ source: candidates[0], neighbors: candidates.slice(1),
      selection: { reason: 'manually_selected', position: 1, skipped_newer: 0, manual: true } });
    const card = document.querySelector('[data-open-cluster]');
    card.querySelector('small').textContent = '手动选择 · 当前工作集';
    card.querySelector('em').textContent = `从记忆库带来 ${records.length} 条记忆；砾砾只围绕这组内容工作。`;
    showView('workbench');
  }

  function sentenceParts(value = '') {
    return String(value).split(/(?<=[。！？!?；;])\s*|\n+/).map((part) => part.trim()).filter(Boolean);
  }

  function sentenceKey(value = '') {
    return String(value).normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s_]+/gu, '');
  }

  function mechanicalDraft(cluster) {
    if (!window.MoraineRelationDraft) throw new Error('relation_draft_unavailable');
    return window.MoraineRelationDraft.build(cluster.source, cluster.neighbors.map(memory => ({
      ...memory, workset_relation: worksetRelation(memory)
    })));
  }

  function openMechanicalDraft() {
    if (!activeCluster) return;
    activeDraftAction = '整合';
    const draft = mechanicalDraft(activeCluster);
    activeMechanicalDraft = draft;
    const editor = document.querySelector('[data-draft-editor]');
    editor.className = 'draft-form';
    const sources = draft.kept.map((item) => `<li><span>${escapeHtml(item.text)}</span><small>${escapeHtml(item.sectionLabel)} · 来源 ${escapeHtml(item.sourceId)}</small></li>`).join('');
    const removed = draft.removed.length
      ? `<section class="mechanical-removed"><strong>已识别的机械重复</strong><ul>${draft.removed.map((item) => `<li><del>${escapeHtml(item.text)}</del><small>${escapeHtml(item.sourceId)} · 与 ${escapeHtml(item.keptFrom)} 重复</small></li>`).join('')}</ul></section>`
      : '<section class="mechanical-removed is-empty"><strong>没有发现可安全删除的硬重复</strong><small>近义与冲突内容保持原样，由人工决定是否继续。</small></section>';
    const timeline = draft.timeline.length ? `<section class="mechanical-timeline"><strong>${draft.hasCurrent ? '阶段更迭 · 当前状态与发展时间线' : '按事件时间排列的发展线'}</strong><p>${draft.hasCurrent ? `只有明确标记为阶段更迭的最新节点 ${escapeHtml(draft.currentSourceId)} 形成当前状态；全部阶段仍按时间排列。` : '承载入口只负责保存这条事件链，不会被提前到其他阶段前面。'}</p><ol>${draft.timeline.map(item => `<li><time>${escapeHtml(shortDate(item.occurred_at))}</time><span>${escapeHtml(item.title)}</span></li>`).join('')}</ol></section>` : '';
    const currentStage = [activeCluster.source, ...activeCluster.neighbors].find(item => item.id === draft.currentSourceId) || activeCluster.source;
    const related = draft.excludedRelatedIds.length ? `<section class="mechanical-removed is-empty"><strong>${draft.excludedRelatedIds.length} 条仅相关记忆保持独立</strong><small>它们不会被归档，也不进入整合正文；之后可以送往联想匣。</small></section>` : '';
    editor.innerHTML = `<header><strong>砾砾的关系化整合草稿</strong><small>不同关系采用不同写录结构</small></header><label>新记忆标题<input data-draft-title value="${escapeHtml(draft.currentTitle || currentStage.title)}"></label><label>分区整合正文<textarea data-draft-content rows="12">${escapeHtml(draft.content)}</textarea></label>${timeline}<section class="mechanical-sources"><strong>逐句来源</strong><ul>${sources}</ul></section>${removed}${related}<label>整合说明<textarea data-draft-reason rows="3">按成员关系分别写录：压缩硬重复、吸收补充、分离当前状态与历史阶段，并保留未决冲突来源。</textarea></label><button type="button" data-submit-draft>确认整合并写入记忆库</button>`;
    editor.querySelector('[data-submit-draft]').addEventListener('click', submitDraft);
    mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'draft').click();
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

  async function submitDraft() {
    const title = document.querySelector('[data-draft-title]').value.trim() || activeCluster.source.title;
    const content = document.querySelector('[data-draft-content]')?.value.trim() || activeMechanicalDraft?.content || '';
    const reason = document.querySelector('[data-draft-reason]').value.trim() || `提议对这组记忆进行${activeDraftAction}。`;
    activeReviewDraft = { title, content, reason };
    activeReviewKind = 'memory-change';
    const submitButton = document.querySelector('[data-submit-draft]');
    const status = document.querySelector('[data-submit-status]');
    submitButton.disabled = true;
    submitButton.textContent = '正在复核并写入…';
    status.innerHTML = '<span class="workbench-mark" aria-hidden="true">◇</span><div><h3>正在写入真实记忆</h3><p>后端会先复核版本与整合边界。</p></div>';
    mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'confirm').click();
    try {
      const preview = await realActionRequest('preview', unifiedPreviewRequest());
      const executed = await realActionRequest('execute', {
        draft_id: preview.draft_id,
        confirmation_code: preview.confirmation_code
      });
      status.innerHTML = `<span class="workbench-mark" aria-hidden="true">✓</span><div><h3>整合已写入记忆库</h3><p>${(executed.archived_source_ids || []).length} 条来源已归档；48小时内可完整回退。正在载入下一簇。</p></div>`;
      activeCluster = null;
      activeMechanicalDraft = null;
      activeReviewDraft = null;
      clusterOffset = 0;
      clusterHistory = [];
      await refreshAfterMemoryChange({ clearWorkbench: true, refreshCluster: true });
      workbenchTabs.find((tab) => tab.dataset.workbenchStep === 'integrate')?.click();
      mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'cluster')?.click();
      await loadWorkbenchCluster();
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = '重新确认整合并写入';
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
      const response = await fetch('/moraine-beta/api/dwell-v2/replacements', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/cleanup', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/rollbacks', { cache: 'no-store' });
      if (!response.ok) throw new Error(`rollbacks_${response.status}`);
      const payload = await response.json();
      container.innerHTML = payload.rollbacks.length ? payload.rollbacks.map(item => `<article class="cleanup-candidate"><strong>${escapeHtml(item.action)}</strong><small>${item.memory_ids.length} 条记忆 · 截止 ${new Date(item.available_until).toLocaleString('zh-CN')}</small><button type="button" data-execute-rollback="${escapeHtml(item.id)}">完整回退</button><p data-rollback-result="${escapeHtml(item.id)}"></p></article>`).join('') : '<p>目前没有可用回退点。</p>';
    } catch (_) { container.innerHTML = '<p>暂时无法读取回退点。</p>'; }
  }

  async function loadWorkbenchCluster(attempt = 0, sourceId = '') {
    try {
      const anchor = sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : '';
      const related = includeRelatedClusters ? '&include_related=1' : '';
      const response = await fetch(`/moraine-beta/api/dwell-v2/clusters?offset=${clusterOffset}${anchor}${related}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`clusters_${response.status}`);
      renderCluster((await response.json()).clusters?.[0] || null);
    } catch (_) {
      if (attempt < 2) {
        window.setTimeout(() => loadWorkbenchCluster(attempt + 1), 900 * (attempt + 1));
        return;
      }
      document.querySelector('[data-cluster-list]').innerHTML = '<span class="workbench-mark" aria-hidden="true">!</span><div><h3>暂时无法读取记忆簇</h3><p>记忆仍在原位；稍后可以安全重试。</p></div>';
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
    await loadWorkbenchCluster();
    button.disabled = false;
    button.textContent = '已更新';
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
  let candidateIndex = 0;
  let candidateShredPolicy = { enabled: true, retention_hours: 72 };
  let identityRoutingPolicy = { enabled: true, retain_memory_copy: false };
  let profileRecallPolicy = { modules: {
    agent_profile: { conversation_enabled: true, growth_enabled: false },
    user_profile: { conversation_enabled: true, growth_enabled: false }
  } };
  let profileGrowthCandidates = [];
  let jevSettings = { enabled: false, configured: false, use_for_wakeup: true };
  const candidateWorkset = new Map();
  const candidateRelations = new Map();
  let candidateMasterId = '';
  const relationLabels = { duplicate: '重复', supplement: '补充', evolution: '阶段更迭', conflict: '真实冲突', related: '仅相关' };
  function renderCandidateWorkset() {
    const container = document.querySelector('[data-candidate-workset]');
    const rows = [...candidateWorkset.values()];
    const eligibleRows = rows.filter(row => !['identity', 'relationship'].includes(row.kind));
    if (!candidateMasterId || !candidateWorkset.has(candidateMasterId)
      || ['identity', 'relationship'].includes(candidateWorkset.get(candidateMasterId)?.kind)) {
      candidateMasterId = eligibleRows[0]?.id || '';
    }
    document.querySelector('[data-candidate-workset-count]').textContent = `${rows.length} 条`;
    document.querySelector('[data-preview-candidate-workset]').disabled = rows.length < 2 || !candidateMasterId;
    if (!rows.length) { container.innerHTML = '<p>先从上方候选卡加入至少两条。</p>'; return; }
    container.innerHTML = `${!candidateMasterId && rows.length >= 2 ? '<p>这些都是关系／身份候选，需要走专门归位复核；普通合并预览必须有一条可承载的事件、项目、决定、偏好或反思候选。</p>' : ''}${rows.map(row => `<article data-candidate-workset-id="${escapeHtml(row.id)}">
      <label class="candidate-master-choice"><input type="radio" name="candidate-master" value="${escapeHtml(row.id)}" ${row.id === candidateMasterId ? 'checked' : ''} ${['identity', 'relationship'].includes(row.kind) ? 'disabled' : ''}><span><small>${row.id === candidateMasterId ? '主候选' : ['identity', 'relationship'].includes(row.kind) ? '受保护来源 · 不可作承载候选' : '候选成员'}</small><strong>${escapeHtml(row.title)}</strong></span></label>
      <label>关系<select data-candidate-relation ${row.id === candidateMasterId ? 'disabled' : ''}>${Object.entries(relationLabels).map(([value,label]) => `<option value="${value}" ${candidateRelations.get(row.id) === value || (!candidateRelations.has(row.id) && value === 'supplement') ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <button type="button" data-remove-workset-candidate>移出</button>
    </article>`).join('')}`;
    container.querySelectorAll('input[name="candidate-master"]').forEach(input => input.addEventListener('change', () => { candidateMasterId = input.value; renderCandidateWorkset(); }));
    container.querySelectorAll('[data-candidate-workset-id]').forEach(article => {
      const id = article.dataset.candidateWorksetId;
      article.querySelector('[data-candidate-relation]')?.addEventListener('change', event => candidateRelations.set(id, event.target.value));
      article.querySelector('[data-remove-workset-candidate]').addEventListener('click', () => { candidateWorkset.delete(id); candidateRelations.delete(id); renderCandidateWorkset(); });
    });
  }
  function addCandidateToWorkset(row) {
    if (!row || candidateWorkset.has(row.id)) return;
    candidateWorkset.set(row.id, row);
    candidateRelations.set(row.id, 'supplement');
    if (!candidateMasterId && !['identity', 'relationship'].includes(row.kind)) candidateMasterId = row.id;
    renderCandidateWorkset();
  }
  function renderCandidateSearch(query = '') {
    const target = document.querySelector('[data-candidate-search-results]');
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) { target.innerHTML = '<small>输入关键词，从全部待判断候选中添加。</small>'; return; }
    const rows = candidateRows.filter(row => [row.title, row.content, ...(row.tags || [])].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(normalized))).slice(0, 8);
    target.innerHTML = rows.length ? rows.map(row => `<button type="button" data-add-search-candidate="${escapeHtml(row.id)}" ${candidateWorkset.has(row.id) ? 'disabled' : ''}><span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.kind || 'event')}</small></span><i>${candidateWorkset.has(row.id) ? '已添加' : '＋'}</i></button>`).join('') : '<small>没有找到匹配候选。</small>';
    target.querySelectorAll('[data-add-search-candidate]').forEach(button => button.addEventListener('click', () => { addCandidateToWorkset(candidateRows.find(row => row.id === button.dataset.addSearchCandidate)); renderCandidateSearch(query); }));
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
  function renderCandidate() {
    const card = document.querySelector('[data-candidate-card]');
    const position = document.querySelector('[data-candidate-position]');
    const row = candidateRows[candidateIndex];
    if (!row) { position.textContent = '没有待判断候选'; card.innerHTML = '<p>候选箱现在是空的。</p>'; return; }
    const lane = row.lane === 'protected' ? '受保护' : row.lane === 'held_low_signal' ? '静置' : '待判断';
    const candidateNeighbors = row.neighbor_evidence?.candidate_neighbors || [];
    const memoryNeighbors = row.neighbor_evidence?.memory_neighbors || [];
    const neighborList = [...candidateNeighbors.map(item => ({ ...item, origin: '候选' })), ...memoryNeighbors.map(item => ({ ...item, origin: '记忆库' }))];
    const keywordEvidence = candidateKeywordEvidence(row);
    const topicRows = keywordEvidence.topics || [];
    const keywordStrip = topicRows.length
      ? `<section class="candidate-keyword-evidence" aria-label="候选关键词"><header><span>建议检查</span>${topicRows.map(topic => `<b class="is-${topic.vetoed ? 'veto' : escapeHtml(topic.evidence_level || 'supporting')}">${escapeHtml(topic.name)} · ${topic.vetoed ? '排除' : escapeHtml(topic.evidence_level)}</b>`).join('')}</header><small>关键词只召集比较 · 尚未改变归类或事件篮子</small></section>`
      : keywordEvidence.terms?.length ? `<section class="candidate-keyword-evidence" aria-label="候选关键词"><header><span>命中</span>${keywordEvidence.terms.map(term => `<b>${escapeHtml(term)}</b>`).join('')}</header><small>来自候选关键词 · 尚未改变归类</small></section>` : '';
    const eventSuggestions = row.event_match_suggestions || [];
    const eventStrip = eventSuggestions.length ? `<section class="candidate-event-suggestions"><header><strong>可能属于同一事件</strong><small>仅供检查</small></header>${eventSuggestions.map(item => `<article><b>${escapeHtml(item.title || item.candidate_id)}</b><span>${escapeHtml((item.evidence?.shared_keywords || []).join('、') || '无共同词')} · 相隔 ${Number(item.evidence?.time_gap_minutes || 0)} 分钟</span><small>${item.blockers?.length ? `已阻断：${escapeHtml(item.blockers.join('、'))}` : '对象与动作连续性尚未确认'}</small></article>`).join('')}<footer>不会自动合篮；确认后仍保留来源与拆回能力。</footer></section>` : '';
    position.textContent = `${candidateIndex + 1} / ${candidateRows.length}`;
    card.innerHTML = `<article class="candidate-paper"><div class="candidate-meta"><span>${escapeHtml(lane)}</span><span>${escapeHtml(relativeTime(row.occurred_at))}</span><span>${escapeHtml(row.kind || 'event')}</span></div><h3>${highlightCandidateKeywords(row.title, keywordEvidence, 'title')}</h3><p>${highlightCandidateKeywords(row.content, keywordEvidence, 'content')}</p>${keywordStrip}${eventStrip}${row.tags?.length ? `<div class="candidate-tags">${row.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}<button class="candidate-add-workset" type="button" data-add-current-candidate ${candidateWorkset.has(row.id) ? 'disabled' : ''}>${candidateWorkset.has(row.id) ? '已加入工作集' : '加入候选工作集'}</button><section class="candidate-neighbors"><header><strong>砾砾找到的线索</strong><small>关系仍未判断</small></header>${neighborList.length ? neighborList.map(item => `<div><span><b>${escapeHtml(item.title || item.id)}</b><small>${item.origin}</small></span><strong>${Math.round(Number(item.similarity || 0) * 100)}%</strong></div>`).join('') : '<p>目前没有超过门槛的相似线索。</p>'}</section></article>`;
    card.querySelector('[data-add-current-candidate]')?.addEventListener('click', () => { addCandidateToWorkset(row); renderCandidate(); });
  }
  function renderCandidateShred(payload) {
    const policy = payload.shred_policy || {};
    const archived = payload.archived || [];
    const eligible = archived.filter(row => row.shred?.eligible);
    const next = eligible.map(row => row.shred?.shred_after).filter(Boolean).sort()[0];
    candidateShredPolicy = { enabled: policy.enabled !== false, retention_hours: Number(policy.retention_hours || 72) };
    const toggle = document.querySelector('[data-candidate-shred-toggle]');
    if (toggle) {
      toggle.dataset.on = String(candidateShredPolicy.enabled);
      toggle.setAttribute('aria-checked', String(candidateShredPolicy.enabled));
    }
    document.querySelectorAll('[data-candidate-shred-hours]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.candidateShredHours) === candidateShredPolicy.retention_hours)));
    const state = document.querySelector('[data-candidate-shred-state]');
    const summary = document.querySelector('[data-candidate-shred-summary]');
    if (state) state.textContent = candidateShredPolicy.enabled ? `已开启 · 保留 ${candidateShredPolicy.retention_hours} 小时` : '已关闭 · 结案候选继续保留';
    if (summary) summary.textContent = candidateShredPolicy.enabled
      ? `${payload.counts?.shred_eligible || 0} 条正在倒计时 · ${payload.counts?.shred_protected || 0} 条受保护${next ? ` · 最早 ${new Date(next).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}`
      : `自动粉碎已关闭 · ${eligible.length} 条普通结案候选仍保留`;
  }
  async function saveCandidateShredPolicy(nextPolicy, controls = []) {
    controls.forEach(control => { control.disabled = true; });
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/candidate-shred-policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextPolicy) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `policy_${response.status}`);
      await loadCandidates();
    } catch (error) {
      const summary = document.querySelector('[data-candidate-shred-summary]');
      if (summary) summary.textContent = `设置没有保存：${error.message}`;
      renderCandidateShred({ shred_policy: candidateShredPolicy, archived: [], counts: {} });
    } finally { controls.forEach(control => { control.disabled = false; }); }
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
      const response = await fetch('/moraine-beta/api/dwell-v2/identity-relation-routing-policy', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/identity-relation-routing-policy', {
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
  function renderProfileRecallPolicy(policy) {
    profileRecallPolicy = policy || profileRecallPolicy;
    document.querySelectorAll('[data-profile-module]').forEach(card => {
      const state = profileRecallPolicy.modules?.[card.dataset.profileModule] || {};
      const conversation = card.querySelector('[data-profile-toggle="conversation"]');
      const growth = card.querySelector('[data-profile-toggle="growth"]');
      const conversationOn = state.conversation_enabled === true;
      const growthOn = state.growth_enabled === true;
      conversation.dataset.on = String(conversationOn); conversation.setAttribute('aria-checked', String(conversationOn));
      growth.dataset.on = String(growthOn); growth.setAttribute('aria-checked', String(growthOn));
      card.querySelector('[data-profile-state="conversation"]').textContent = conversationOn ? '只在确实相关时参与' : '已关闭 · 不参与普通对话';
      card.querySelector('[data-profile-state="growth"]').textContent = growthOn ? '稳定认识可进入审阅候选' : '已关闭 · 现有档案保持不变';
      const last = card.querySelector('[data-profile-last]');
      const recalled = Array.isArray(state.last_recalled) ? state.last_recalled.length : 0;
      const injected = Array.isArray(state.last_injected) ? state.last_injected.length : 0;
      last.textContent = profileRecallPolicy.connected_to_chat
        ? (injected ? `最近一次相关对话使用了 ${injected} 条档案` : '最近一次相关对话没有使用这个档案')
        : '最近没有在对话中使用这个档案。';
      renderProfileGrowthList(card, state);
    });
    const summary = document.querySelector('[data-profile-policy-summary]');
    if (summary) summary.textContent = profileRecallPolicy.connected_to_chat
      ? '开关已接入 Moraine 分层召回；宿主 Agent 仍需调用 layered_recall。'
      : '档案控制暂未接入 Moraine 分层召回。';
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
      const response = await fetch('/moraine-beta/api/dwell-v2/profile-growth-candidates', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/profile-growth-candidates/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: candidateId, action, actor: 'owner' }) });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/profile-recall-policy', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/profile-recall-policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated_by: 'owner', modules: { [moduleKey]: next } }) });
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
    const moduleKey = target.closest('[data-profile-module]').dataset.profileModule;
    const field = target.dataset.profileToggle;
    target.classList.add('is-init');
    saveProfileRecallPolicy(moduleKey, field, target.dataset.on !== 'true', target);
  }));
  loadProfileRecallPolicy();
  loadProfileGrowthCandidates();
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
    if (document.querySelector('.jev-settings')?.hidden) return;
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/jev-settings', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/jev-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
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
  loadJevSettings();
  async function loadCandidates() {
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/candidates', { cache: 'no-store' });
      if (!response.ok) throw new Error(`candidates_${response.status}`);
      const payload = await response.json();
      candidateRows = payload.candidates || [];
      candidateIndex = 0;
      const counts = payload.counts || {};
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
      const response = await fetch('/moraine-beta/api/dwell-v2/candidate-shred/run', { method: 'POST' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/actions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'candidate_merge', actor: 'xiaoran', reason: document.querySelector('[data-candidate-workbench-reason]').value, candidate_ids: rows.map(row => row.id), master_id: candidateMasterId, member_relations: memberRelations }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `preview_${response.status}`);
      preview.innerHTML = `<header><small>正式入库前预览</small><strong>${escapeHtml(payload.result_preview.title)}</strong></header><p>${escapeHtml(payload.result_preview.content)}</p><ul>${payload.member_relations.map(item => `<li><b>${escapeHtml(candidateWorkset.get(item.id)?.title || item.id)}</b><span>${escapeHtml(item.relation === 'master' ? '承载候选' : relationLabels[item.relation] || item.relation)} · ${escapeHtml(item.disposition === 'reference_active' ? '保持独立' : '确认后退出候选')}</span></li>`).join('')}</ul><div class="candidate-execute"><label>输入确认码 <b>${escapeHtml(payload.confirmation_code)}</b><input inputmode="numeric" maxlength="6" data-candidate-confirm-code placeholder="六位确认码"></label><button type="button" data-execute-candidate-workset>确认整合并正式入库</button><small data-candidate-execute-result>尚未写入；草稿十分钟内有效。</small></div>`;
      preview.querySelector('[data-execute-candidate-workset]')?.addEventListener('click', async executeEvent => {
        const executeButton = executeEvent.currentTarget;
        const result = preview.querySelector('[data-candidate-execute-result]');
        const code = preview.querySelector('[data-candidate-confirm-code]').value.trim();
        if (code !== payload.confirmation_code) { result.textContent = '确认码不匹配，没有写入。'; return; }
        executeButton.disabled = true; result.textContent = '正在写入记忆库并结案来源候选……';
        try {
          const response = await fetch('/moraine-beta/api/dwell-v2/actions/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft_id: payload.draft_id, confirmation_code: code }) });
          const executed = await response.json();
          if (!response.ok) throw new Error(executed.error || `execute_${response.status}`);
          result.textContent = `已正式入库；${executed.concluded_candidate_ids.length} 条来源候选共同结案，可在48小时内回退。`;
          candidateWorkset.clear(); candidateRelations.clear(); candidateMasterId = '';
          await loadCandidates(); renderCandidateWorkset();
          await refreshAfterMemoryChange();
        } catch (error) { executeButton.disabled = false; result.textContent = `没有写入：${error.message}`; }
      });
    } catch (error) {
      const message = error.message === 'candidate_master_protected'
        ? '关系／身份候选不能作为普通合并的承载候选，请改选一条事件、项目、决定、偏好或反思候选'
        : error.message;
      preview.innerHTML = `<p>预览失败：${escapeHtml(message)}。候选没有变化。</p>`;
    }
    finally { button.disabled = rows.length < 2 || !candidateMasterId; button.textContent = '生成合并预览'; }
  });
  renderCandidateWorkset();

  async function loadArchiveMemories() {
    const list = document.querySelector('[data-archive-list]');
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/library?page=1&limit=1000&state=all', { cache: 'no-store' });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/activities?limit=120', { cache: 'no-store' });
      if (!response.ok) throw new Error(`activities_${response.status}`);
      const payload = await response.json();
      const groups = new Map();
      (payload.items || []).forEach(item => {
        const day = shanghaiActivityDay(item.occurred_at);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(item);
      });
      stream.innerHTML = groups.size ? [...groups.entries()].map(([day, items], index) => `<details class="activity-day" ${index < 2 ? 'open' : ''}><summary><span><strong>${escapeHtml(activityDayLabel(day))}</strong><small>${escapeHtml(day)}</small></span><b>${items.length} 条</b></summary><div>${items.map(item => `<article class="activity-entry"><time datetime="${escapeHtml(item.occurred_at)}">${escapeHtml(activityTimeLabel(item.occurred_at))}</time><span class="activity-kind" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.kind_label)}</span><div><strong>${escapeHtml(item.place)}</strong><p>${escapeHtml(item.summary)}</p><small>${item.visibility === 'shared' ? '已共享' : '仅私人空间'}</small></div></article>`).join('')}</div></details>`).join('') : '<p class="activity-empty">还没有真正想留下的活动。</p>';
      activityLoaded = true;
    } catch (_) {
      stream.innerHTML = '<p class="activity-empty">暂时读不到活动记录；原账本没有被修改。</p>';
    }
  }
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
    const next = ['cairn', 'calendar', 'candidates', 'library', 'archive', 'workbench', 'review', 'activity', 'study', 'settings'].includes(view) ? view : 'overview';
    prototype.dataset.view = next;
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('is-current', button.dataset.view === next);
    });
    closeSidebar();
    updateBackToTop();
    if (next === 'activity') loadActivities();
    if (next === 'study') loadStudyDiary();
    if (next === 'library') window.setTimeout(() => librarySearch.focus(), 180);
  }

  function activeScrollablePage() {
    const view = prototype.dataset.view || 'overview';
    return document.querySelector(`#${CSS.escape(view)}.page`);
  }

  function updateBackToTop() {
    const page = activeScrollablePage();
    const visible = Boolean(page && page.scrollTop > 360);
    backToTop.dataset.visible = String(visible);
    backToTop.setAttribute('aria-hidden', String(!visible));
    backToTop.tabIndex = visible ? 0 : -1;
  }

  function filterMemories() {
    const terms = memorySearchTerms().map(term => term.toLocaleLowerCase('zh-CN'));
    memoryItems.forEach((item) => {
      const matchesType = activeMemoryFilter === 'all' || item.dataset.memoryType === activeMemoryFilter;
      const haystack = item.dataset.memorySearch.toLocaleLowerCase('zh-CN');
      const matchesQuery = !terms.length || terms.every(term => haystack.includes(term));
      item.hidden = !(matchesType && matchesQuery);
    });

    document.querySelectorAll('[data-memory-group]').forEach((group) => {
      const groupVisible = [...group.querySelectorAll('[data-memory-item]')].filter((item) => !item.hidden).length;
      group.hidden = groupVisible === 0;
      group.querySelector('[data-group-count]').textContent = `${groupVisible} 条`;
    });

    const totalVisible = memoryItems.filter((item) => !item.hidden).length;
    visibleMemoryCount.textContent = `${totalVisible} 条${memoryDataMode === 'real' ? '真实记忆' : '示例记忆'}`;
    memoryEmpty.hidden = totalVisible !== 0;
  }

  const memoryGroupDefinitions = {
    time: [
      ['today', '今天'],
      ['yesterday', '昨天'],
      ['earlier', '更早']
    ],
    weight: [
      ['core', '核心身份与关系'],
      ['important', '重要偏好与决定'],
      ['normal', '普通经历']
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
          if (activeMemoryView === 'weight') return direction * (Number(left.dataset.memoryImportance) - Number(right.dataset.memoryImportance));
          const leftDate = Date.parse(activeMemoryView === 'recent' ? left.dataset.memoryUpdatedAt : left.dataset.memoryCreatedAt) || 0;
          const rightDate = Date.parse(activeMemoryView === 'recent' ? right.dataset.memoryUpdatedAt : right.dataset.memoryCreatedAt) || 0;
          return direction * (leftDate - rightDate);
        })
        .forEach((item) => group.append(item));
      memoryGroupsContainer.append(group);
    });
    const viewLabel = activeMemoryView === 'time' ? '时间' : activeMemoryView === 'weight' ? '权重' : '最近修改';
    document.querySelector('.memory-list').setAttribute('aria-label', `按${viewLabel}浏览记忆`);
    document.querySelector('.memory-list > header h2').textContent = `按${viewLabel}浏览`;
    filterMemories();
  }

  document.querySelectorAll('[data-open-sidebar]').forEach((button) => {
    button.addEventListener('click', openSidebar);
  });
  document.querySelectorAll('.page').forEach((page) => page.addEventListener('scroll', updateBackToTop, { passive: true }));
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
  organizeToggle.addEventListener('click', toggleOrganize);
  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeMemoryFilter = button.dataset.category;
      categoryButtons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
      document.querySelector('[data-current-category]').textContent = button.textContent === '全部' ? '全部类型' : button.textContent;
      filterMemories();
    });
  });
  arrangementButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (activeMemoryView === button.dataset.arrangement) activeMemoryDirection = activeMemoryDirection === 'desc' ? 'asc' : 'desc';
      else {
        activeMemoryView = button.dataset.arrangement;
        activeMemoryDirection = 'desc';
      }
      arrangementButtons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
      arrangementButtons.forEach((candidate) => {
        const isActive = candidate === button;
        candidate.setAttribute('aria-selected', String(isActive));
        candidate.classList.toggle('is-asc', isActive && activeMemoryDirection === 'asc');
        candidate.classList.toggle('is-desc', isActive && activeMemoryDirection === 'desc');
        candidate.setAttribute('aria-label', isActive
          ? `${candidate.querySelector('span').textContent}，${activeMemoryDirection === 'desc' ? '降序' : '升序'}`
          : `${candidate.querySelector('span').textContent}，可排序`);
      });
      document.querySelector('[data-current-view]').textContent = `${button.querySelector('span').textContent} ${activeMemoryDirection === 'desc' ? '↓' : '↑'}`;
      moveArrangementPill(button, true);
      renderMemoryGroups();
    });
  });
  workbenchTabs.forEach((button) => {
    button.addEventListener('click', () => {
      workbenchTabs.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === button)));
      document.querySelectorAll('[data-workbench-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.workbenchPanel !== button.dataset.workbenchStep;
      });
      moveWorkbenchPill(button, true);
      centerWorkbenchTab(button);
    });
  });
  mergeStepTabs.forEach((button) => {
    button.addEventListener('click', () => {
      mergeStepTabs.forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === button)));
      document.querySelectorAll('[data-merge-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.mergePanel !== button.dataset.mergeStep;
      });
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
    const standalone = { '修订': 'revise', '更迭': 'supersede', '清理': 'clean' }[activeDraftAction];
    if (standalone) workbenchTabs.find((tab) => tab.dataset.workbenchStep === standalone).click();
    else mergeStepTabs.find((tab) => tab.dataset.mergeStep === 'draft').click();
  });
  document.querySelector('[data-build-plan]').addEventListener('click', event => prepareUnifiedRealPreview(event.currentTarget));
  librarySearch.addEventListener('input', refreshMemorySearch);
  document.querySelector('[data-clear-memory-search]').addEventListener('click', () => {
    librarySearch.value = '';
    activeMemoryFilter = 'all';
    categoryButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === 'all')));
    document.querySelector('[data-current-category]').textContent = '全部类型';
    refreshMemorySearch();
    librarySearch.focus();
  });
  function wireMemoryPapers() {
    document.querySelectorAll('[data-memory-paper]').forEach((paper) => {
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
      nodes.forEach((node, index) => node.addEventListener('click', () => {
        const selected = node.dataset.timelineNode;
        nodes.forEach(candidate => {
          const current = candidate === node;
          candidate.classList.toggle('is-current', current);
          candidate.setAttribute('aria-pressed', String(current));
        });
        timeline.querySelectorAll('[data-timeline-entry]').forEach(entry => { entry.hidden = entry.dataset.timelineEntry !== selected; });
        position.textContent = selected === 'summary' ? '整合结论' : `${index + 1} / ${nodes.length - 1} · 左右滑动时间线`;
        const scroller = timeline.querySelector('.timeline-scroller');
        const left = node.offsetLeft - (scroller.clientWidth - node.offsetWidth) / 2;
        scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      }));
      const scroller = timeline.querySelector('.timeline-scroller');
      requestAnimationFrame(() => { scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth); });
    }
    wireTimeline();

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
          const response = await fetch(`/moraine-beta/api/dwell-v2/memories/${encodeURIComponent(paper.dataset.memoryId)}`, { cache: 'no-store' });
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
            wireSurfacing();
          }
          paper.dataset.fullLoaded = 'true';
        } catch (_) { if (bodyPanel) bodyPanel.textContent = '暂时无法读取完整正文；没有使用示例内容替代。'; }
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

  renderMemoryRecords();
  renderMemoryGroups();
  wireMemoryPapers();
  populateRealReviewChoices();
  wireRealReview();
  loadReadOnlyMemories();
  loadQueuePreferences().then(() => loadWorkbenchCluster());
  loadReplacementCandidates();
  loadCleanupCandidates();
  loadRollbacks();
  loadOverview();
  loadCalendar();
  loadCandidates();
  if (!document.querySelector('[aria-labelledby="identityRoutingTitle"]')?.hidden) loadIdentityRoutingPolicy();
  loadArchiveMemories();
  if (!document.querySelector('[data-governance-preview]')?.closest('[hidden]')) loadGovernancePreview();
  loadMemoryFlow();
  document.querySelector('[data-revision-memory]')?.addEventListener('change', async event => {
    const result = document.querySelector('[data-revision-result]');
    if (!event.target.value) return;
    result.innerHTML = '<p>正在读取完整正文……</p>';
    try {
      const response = await fetch(`/moraine-beta/api/dwell-v2/memories/${encodeURIComponent(event.target.value)}`, { cache: 'no-store' });
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
  document.querySelector('[data-governance-preview]').addEventListener('click', (event) => {
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
  document.querySelector('[data-governance-mode]').addEventListener('change', loadGovernancePreview);
  document.querySelector('[data-governance-only-missing]').addEventListener('change', loadGovernancePreview);
  document.querySelector('#library').addEventListener('click', async (event) => {
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
  document.querySelector('[data-replacement-list]').addEventListener('click', async event => {
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
      const response = await fetch(`/moraine-beta/api/dwell-v2/rollbacks/${encodeURIComponent(button.dataset.executeRollback)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
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

  async function saveDirectProfile(changes, pendingLabel) {
    directProfileResult.textContent = pendingLabel;
    try {
      const response = await fetch('/moraine-beta/api/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...cairnProfile, ...changes })
      });
      if (!response.ok) throw new Error(`profile_${response.status}`);
      cairnProfile = normalizeInstanceProfile(await response.json());
      renderCairnProfile();
      directProfileResult.textContent = '已保存';
      window.setTimeout(() => { directProfileResult.textContent = '点击头像可由人类自定义'; }, 1200);
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
  document.querySelector('[data-edit-cairn-avatar]')?.addEventListener('click', () => directAvatarInput.click());
  document.querySelector('[data-resident-card-shell]')?.addEventListener('click', event => {
    if (event.target.closest('[data-edit-cairn-avatar]')) {
      event.stopPropagation();
      directAvatarInput.click();
    }
  });
  directAvatarInput?.addEventListener('change', async () => {
    const file = directAvatarInput.files[0];
    if (!file) return;
    try {
      const avatar = await readAvatar(file);
      await saveDirectProfile({ avatar }, '正在保存头像……');
    } catch (error) {
      directProfileResult.textContent = error.message === 'avatar_too_large' ? '头像请不要超过 600KB' : '头像读取失败';
    } finally { directAvatarInput.value = ''; }
  });
  document.querySelectorAll('[data-cairn-profile-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const result = form.querySelector('[data-cairn-profile-result]');
    result.textContent = '正在保存……';
    try {
      const avatar = await readAvatar(form.querySelector('[data-cairn-avatar-input]').files[0]);
      const response = await fetch('/moraine-beta/api/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
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
      const response = await fetch('/moraine-beta/api/dwell-v2/migration/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch('/moraine-beta/api/dwell-v2/migration/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      <span><strong>${escapeHtml(snapshot.label)}</strong><small>${escapeHtml(new Date(snapshot.created_at).toLocaleString('zh-CN'))} · ${Number(snapshot.memories || 0)} 条记忆 · ${Number(snapshot.candidates || 0)} 条候选</small></span>
      <button type="button" data-preview-snapshot="${escapeHtml(snapshot.id)}">预览安全恢复</button>
      <div data-snapshot-impact="${escapeHtml(snapshot.id)}"></div></article>`).join('') : '<p>还没有私有快照。</p>';
  };
  const loadSnapshots = async () => {
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/portability/snapshots', { cache: 'no-store' });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `snapshot_${response.status}`);
      renderSnapshots(payload.snapshots); snapshotResult.textContent = `共有 ${payload.snapshots.length} 份可校验快照。`;
    } catch (error) { snapshotResult.textContent = `快照暂不可用：${error.message}`; }
  };
  document.querySelector('[data-create-snapshot]')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; snapshotResult.textContent = '正在读取完整记忆并建立校验快照……';
    try {
      const response = await fetch('/moraine-beta/api/dwell-v2/portability/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '设置页手动快照' }) });
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
        const response = await fetch(`/moraine-beta/api/dwell-v2/portability/snapshots/${encodeURIComponent(previewButton.dataset.previewSnapshot)}/restore-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
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
        const response = await fetch('/moraine-beta/api/dwell-v2/portability/restore-execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft_id: snapshotRestoreDraft.draft_id, confirmation_code: code }) });
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
      const response = await fetch('/moraine-beta/api/dwell-v2/diary', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`diary_${response.status}`);
      const payload = await response.json();
      studyDiaries = (Array.isArray(payload) ? payload : (payload.items || []))
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
  const residentCardFlip = document.querySelector('[data-resident-card-flip]');
  residentCardFlip?.addEventListener('click', () => {
    const flipped = residentCardFlip.getAttribute('aria-pressed') !== 'true';
    residentCardFlip.setAttribute('aria-pressed', String(flipped));
    residentCardFlip.setAttribute('aria-label', flipped ? '翻回 Agent 数字居民证' : '翻到用户画像');
    residentCard?.classList.toggle('is-flipped', flipped);
    const front = residentCard?.querySelector('.resident-card-front');
    const back = residentCard?.querySelector('.resident-card-back');
    front?.setAttribute('aria-hidden', String(flipped));
    back?.setAttribute('aria-hidden', String(!flipped));
    if (front) front.inert = flipped;
    if (back) back.inert = !flipped;
  });
  document.querySelector('[data-achievement-map]')?.addEventListener('click', event => {
    const node = event.target.closest('[data-achievement-id]');
    if (node) showAchievement(node.dataset.achievementId);
  });
  document.querySelector('[data-achievement-detail]')?.addEventListener('click', event => {
    if (event.target.closest('[data-close-achievement]')) event.currentTarget.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && organizeToggle.getAttribute('aria-expanded') === 'true') toggleOrganize();
    else if (event.key === 'Escape' && !historySheet.hidden) closeHistory();
    else if (event.key === 'Escape') closeSidebar();
  });

  const initialParams = new URLSearchParams(window.location.search);
  showView(initialParams.get('view') || 'overview');
  const initialWorkbenchStep = initialParams.get('workbench');
  if (initialWorkbenchStep) {
    workbenchTabs.find((tab) => tab.dataset.workbenchStep === initialWorkbenchStep)?.click();
  }
  loadCairnProfile();
  loadRelationMap();
  loadLayeredRecall();
  loadSnapshots();
  requestAnimationFrame(() => moveArrangementPill(arrangementButtons[0], false));
  requestAnimationFrame(() => moveWorkbenchPill(workbenchTabs[0], false));
  requestAnimationFrame(() => moveOwnershipPill(ownershipTabs[0], false));
  window.addEventListener('resize', () => {
    const active = arrangementButtons.find((button) => button.getAttribute('aria-selected') === 'true') || arrangementButtons[0];
    moveArrangementPill(active, false);
    const activeWorkbench = workbenchTabs.find((button) => button.getAttribute('aria-selected') === 'true') || workbenchTabs[0];
    moveWorkbenchPill(activeWorkbench, false);
    const activeOwnership = ownershipTabs.find((button) => button.getAttribute('aria-selected') === 'true') || ownershipTabs[0];
    moveOwnershipPill(activeOwnership, false);
  });
})();
