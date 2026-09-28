'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoraineRelationDraft = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const parts = value => String(value || '').split(/(?<=[。！？!?；;])\s*|\n+/).map(text => text.trim()).filter(Boolean);
  const key = value => String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s_]+/gu, '');
  const timestamp = memory => Date.parse(memory.occurred_at || memory.created_at || memory.updated_at || '');
  const chronological = memories => memories.map((memory, index) => ({ memory, index })).sort((left, right) => {
    const a = timestamp(left.memory); const b = timestamp(right.memory);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
    if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1;
    return left.index - right.index;
  }).map(item => item.memory);

  const expand = memory => Array.isArray(memory.timeline) && memory.timeline.length
    ? memory.timeline.map((point, index) => ({
      ...memory,
      id: point.memory_id || `${memory.id}:timeline:${index}`,
      parent_id: memory.id,
      title: point.title || memory.title,
      content: point.content || point.preview || '',
      occurred_at: point.observed_at || point.occurred_at || '',
      created_at: '',
      updated_at: ''
    })).filter(point => point.content)
    : [memory];

  function build(source, neighbors = []) {
    const relation = memory => memory.workset_relation || 'supplement';
    const groups = { duplicate: [], supplement: [], supersede: [], conflict: [], related: [] };
    neighbors.forEach(memory => (groups[relation(memory)] || groups.supplement).push(memory));
    const stageRows = chronological([
      ...expand({ ...source, workset_relation: 'master' }),
      ...groups.duplicate.flatMap(memory => expand({ ...memory, workset_relation: 'duplicate' })),
      ...groups.supplement.flatMap(memory => expand({ ...memory, workset_relation: 'supplement' })),
      ...groups.supersede.flatMap(memory => expand({ ...memory, workset_relation: 'supersede' }))
    ]);
    const evolutionStages = stageRows.filter(memory => memory.workset_relation === 'supersede');
    const current = evolutionStages.at(-1) || null;
    const kept = []; const removed = []; const seen = new Map(); const sections = [];
    const add = (name, label, memories) => {
      const rows = [];
      chronological(memories).forEach(memory => parts(memory.content).forEach(text => {
        const normalized = key(text);
        if (!normalized) return;
        if (seen.has(normalized)) {
          removed.push({ text, sourceId: memory.id, keptFrom: seen.get(normalized), reason: '完全重复', section: name });
          return;
        }
        seen.set(normalized, memory.id);
        const row = { text, sourceId: memory.id, section: name, sectionLabel: label };
        kept.push(row); rows.push(row);
      }));
      if (rows.length) sections.push({ name, label, rows });
    };
    add('timeline', '发展时间线', stageRows);
    add('conflict', '尚未裁定的并存记录', groups.conflict.flatMap(expand));
    if (current) {
      const rows = parts(current.content).map(text => ({ text, sourceId: current.id,
        section: 'current', sectionLabel: '当前状态' }));
      kept.push(...rows);
      if (rows.length) sections.push({ name: 'current', label: '当前状态', rows });
    }
    const content = sections.map(section => `【${section.label}】\n${section.rows.map(row => row.text).join('\n')}`).join('\n\n');
    return {
      kept, removed, sections, content, hasCurrent: Boolean(current),
      currentSourceId: current?.id || source.id, currentTitle: current?.title || source.title,
      timeline: stageRows.length > 1 ? stageRows.map(memory => ({ id: memory.id, title: memory.title,
        occurred_at: memory.occurred_at || memory.created_at || memory.updated_at })) : [],
      excludedRelatedIds: groups.related.map(memory => memory.id),
      sourceIds: [...new Set(kept.map(row => row.sourceId))]
    };
  }

  return { build };
}));
