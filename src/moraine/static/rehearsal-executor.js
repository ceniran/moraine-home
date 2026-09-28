(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoraineRehearsalExecutor = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function execute(plan, currentMemories, options = {}) {
    if (!plan || plan.mode !== 'dry_run') throw new Error('only validated dry-run plans may enter rehearsal');
    const records = new Map((currentMemories || []).map((memory) => [memory.id, clone(memory)]));
    for (const expected of plan.preconditions.sources_unchanged) {
      const actual = records.get(expected.id);
      if (!actual) throw new Error(`source missing: ${expected.id}`);
      const version = actual.updated_at || actual.updatedAt || actual.recordedAt;
      if (version !== expected.expected_updated_at) throw new Error(`source changed: ${expected.id}`);
    }
    const before = [...records.values()].map(clone);
    const now = options.now || new Date().toISOString();
    let createdId = null;
    if (plan.create) {
      createdId = options.createdId || `rehearsal_${Date.now()}`;
      records.set(createdId, { id: createdId, title: plan.create.title, content: plan.create.content,
        state: 'active', source_ids: clone(plan.create.source_ids), created_at: now, updated_at: now });
    }
    for (const transition of plan.transition) {
      const memory = records.get(transition.id);
      memory.state = transition.to;
      memory.updated_at = now;
      memory.content_preserved = transition.preserve_content;
    }
    return {
      mode: 'rehearsal', executed_at: now, created_id: createdId,
      records: [...records.values()].map(clone),
      receipt: { source_ids: plan.transition.map(({ id }) => id), before, created_id: createdId }
    };
  }

  function restore(result) {
    if (!result?.receipt?.before) throw new Error('invalid rehearsal receipt');
    return { mode: 'restored', records: clone(result.receipt.before), removed_created_id: result.receipt.created_id || null };
  }

  return { execute, restore };
});
