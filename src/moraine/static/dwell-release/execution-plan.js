(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoraineExecutionPlan = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const ACTIONS = new Set(['整合', '修订', '更迭', '清理', '删除']);

  function text(value, name) {
    const result = String(value || '').trim();
    if (!result) throw new Error(`${name} is required`);
    return result;
  }

  function buildExecutionPlan({ action, sourceMemories, draft, signatures, now = new Date().toISOString() }) {
    if (!ACTIONS.has(action)) throw new Error('unsupported action');
    if (!Array.isArray(sourceMemories) || sourceMemories.length === 0) throw new Error('source memories are required');
    if (signatures?.xiaoran !== 'approve' || signatures?.cairn !== 'approve') throw new Error('both approvals are required');

    const sources = sourceMemories.map((memory) => ({
      id: text(memory.id, 'source id'),
      expected_updated_at: text(memory.updated_at || memory.updatedAt || memory.recordedAt, 'source version')
    }));
    if (new Set(sources.map(({ id }) => id)).size !== sources.length) throw new Error('duplicate source id');

    const cleanup = action === '清理' || action === '删除';
    const create = action === '整合' || action === '修订';
    const transition = action === '更迭'
      ? [{ id: sources[0].id, to: 'superseded', preserve_content: true,
          succeeded_by: sources[1].id }]
      : sources.map(({ id }) => ({
          id,
          to: cleanup ? 'recycle_bin' : action === '修订' ? 'superseded' : 'merged',
          preserve_content: true
        }));
    if (action === '更迭' && sources.length !== 2) throw new Error('supersession requires exactly two memories');

    const plan = {
      version: 1,
      mode: 'dry_run',
      action,
      created_at: now,
      preconditions: {
        signatures: { xiaoran: 'approve', cairn: 'approve' },
        sources_unchanged: sources
      },
      create: create ? {
        title: text(draft?.title, 'draft title'),
        content: text(draft?.content, 'draft content'),
        source_ids: sources.map(({ id }) => id),
        reason: text(draft?.reason, 'draft reason')
      } : null,
      transition,
      candidate_refresh: {
        invalidate_source_ids: transition.map(({ id }) => id),
        requery_created_record: create
      },
      rollback: {
        strategy: 'restore_snapshot',
        restore_source_ids: sources.map(({ id }) => id),
        remove_created_record: create
      }
    };
    return Object.freeze(plan);
  }

  return { buildExecutionPlan };
});
