# 分记忆级 service_areas 规格 v0.1

状态：草案，待 Cairn 复审
基线：`beta/standalone@f6d8acf`
范围：本文件只描述设计。本轮不改源码、不读写真实记忆、不部署。

---

## 1. 对当前实现的核查结果

以下结论来自阅读基线代码，不是推测。

### 1.1 候选在整合后不会消失 —— 本规格最重要的一条

`beta_store.admit()` 把被整合的候选留在 `data["candidates"]` 里，只改状态：

```python
row["state"] = "associated" if relations[row["id"]] == "related_only" else "admitted"
row["memory_id"] = memory["id"]
row["decided_at"] = now
```

拆回时 `candidate_before` 快照把它们还原为 `pending`，**候选 ID 不变**。

因此 `candidate_id` 是一个**跨越整合、拆回、重新整合而稳定存在的分记忆身份**。

### 1.2 整合记忆已有三条来源引用

```python
"source_candidate_ids":     [...]   # relation != related_only
"associated_candidate_ids": [...]   # related_only
"timeline": [{"candidate_id", "occurred_at", "title"}, ...]
"consolidation": {"relations": {candidate_id: relation}, ...}
```

`timeline` 已经是一份按时间排序的分记忆目录，带 `candidate_id`。

### 1.3 重新整合会产生新的 memory_id

`admit()` 每次都 `memory_id = f"memory_{uuid4}"`。拆回后再整合，**记忆 ID 必然改变**。

→ 任何以 `memory_id` 为键的区域映射都会在拆回后丢失。以 `candidate_id` 为键则不受影响。

### 1.4 指纹与嵌入文本的构成

```python
core._FINGERPRINT_FIELDS = ("id", "title", "kind", "tags", "content")
core.document() 拼接 Title / Kind / Tags / Content
```

→ 只要 `service_areas` 不进入这两处，新增该字段**不会改变指纹、不触发重新嵌入、不改动向量**。这是第四节「不改写旧记忆」能够成立的技术前提，而不是需要额外努力去维持的约束。

### 1.5 标签在整合时取并集

```python
"tags": sorted({tag for row in ordered for tag in row.get("tags", [])})
```

→ 若区域照搬这个做法，跨区整合记忆会在每个入口整条出现。这正是本规格要避免的。

### 1.6 召回当前以整条记忆为单位

`continuity.build_layered_context()` 从 `snapshot["memories"]` 取行，`_matches()` 对整条记忆判定，`_fit()` 按整条装箱。

→ 分记忆级过滤需要在装箱前引入一个新的投影步骤，但不必改写 `_fit()` 本身。

### 1.7 kind 已承载安全语义

```python
beta_store.admit():        identity/relationship/boundary 不得带 memory_tier 整合
memory_tiering:            PROTECTED_KINDS 强制人工复核
decision_ledger:           PROTECTED_KINDS 保护判断
```

→ 确认第一节「保留 kind」的判断：`kind` 不能与 `service_areas` 合并，否则每新增一个生活入口都要重审全部保护逻辑。

---

## 2. 推荐数据结构

### 2.1 键的选择：`source_candidate_id`，不新造 segment_id

**结论：不需要 `segment_id`。**

理由见 1.1 与 1.3：`candidate_id` 已经稳定、已经持久、已经被 `timeline` 和 `consolidation.relations` 引用。新造一个并行 ID 会产生第二套来源模型，与第二节「不另造平行模型」冲突。

若将来出现「一条候选在整合时被切成多段正文」的需求，再引入 `segment_id`，其生命周期应为 `candidate_id` 的子级（`{candidate_id}#{ordinal}`），且 `candidate_id` 仍是区域权威键。本版不实现。

### 2.2 区域记录

区域权威挂在候选（分记忆）上，不在整合记忆上：

```jsonc
// data["candidates"][i] 上新增
"service_areas": [
  {
    "area": "work",
    "origin": "kind_default",        // kind_default | derived_shadow | manual
    "kind_at_time": "project",        // 写入当时的 kind，之后不随 kind 变化
    "assigned_at": "2026-10-02T08:00:00Z"
  },
  {
    "area": "relations",
    "origin": "manual",
    "kind_at_time": "project",
    "assigned_at": "2026-10-02T09:10:00Z",
    "assigned_by": "human:xiaoran"
  }
]
```

### 2.3 人工删除默认区域的留痕

第三节要求「人工删除后不得被重算恢复」。仅从列表移除无法表达这一点——重算时规则会再次产生它。

因此删除记为**显式排除项**，与区域列表并列：

```jsonc
"service_area_exclusions": [
  {
    "area": "life",
    "origin": "manual",
    "reason": "这条只跟项目有关",
    "assigned_by": "human:xiaoran",
    "assigned_at": "2026-10-02T09:12:00Z"
  }
]
```

**生效规则**：`exclusions` 优先于一切自动来源。任何 `origin != "manual"` 的派生结果若命中 `exclusions`，直接丢弃，不写入、不提示。人工若要恢复该区域，须显式添加一条 `origin: "manual"` 的区域记录，同时移除对应排除项，并留下新的 `assigned_at`。

### 2.4 整合层派生目录

整合记忆上只保存只读索引，不保存权威：

```jsonc
// data["memories"][i] 上新增
"service_area_index": {
  "derived": true,
  "authoritative": false,
  "areas": ["work", "relations"],                  // 仅由正文分记忆（source_candidate_ids）得出
  "by_area": {                                      // 正文分段：可见性与代表段的唯一来源
    "work":      ["candidate_a1", "candidate_b2"],
    "relations": ["candidate_b2"]
  },
  "associated_by_area": {                           // 关联分段：只建索引，不参与可见性
    "life": ["candidate_c3"]
  },
  "rebuilt_at": "2026-10-02T09:12:00Z",
  "source_rule_version": "areas-v1"
}
```

**`by_area` 只收 `source_candidate_ids`（relation != related_only）的候选。**
`related_only` 候选进入独立的 `associated_by_area`，两者在数据结构上就是分开的，
不依赖调用方自觉区分——理由见 2.5。

`by_area` 同时承担第八节要求的「哪个关键词指向哪段分记忆」的同类角色：它是一张指针表，不是加分来源。

**重建时机**：admit 之后、区域修订之后、拆回之后、导入之后。重建是纯函数：读各来源候选的 `service_areas` 与 `service_area_exclusions`，求并集。任何时候丢失都可以重算。

### 2.5 `related_only` 不是正文分记忆

`admit()` 已经把两类来源分开存：

```python
"source_candidate_ids":     [... if relations[id] != "related_only"]
"associated_candidate_ids": draft["associations"]
```

区域层**沿用这条既有分界，不在自己这一层把它们合回去**：

| | 进 `by_area` | 可被区域可见 | 可当代表段返回 | 可被 `_matches` 匹配 |
|---|---|---|---|---|
| `source_candidate_ids` | 是 | 是 | 是 | 是 |
| `associated_candidate_ids` | **否** | **否** | **否** | **否** |

`related_only` 候选只进 `associated_by_area`，**仅在调用方显式要求展开关联时**才带出来，
与 `expand_timeline` 同属显式意图，不由区域数量或命中情况触发。

**为什么不采用「参与但标记关系类型」**：那等于把区分责任交给每一个下游调用方。
只要 `related_only` 出现在 `by_area` 里，迟早会有某条路径把它当成代表段返回——
而它按定义只是「仅相关」，不是这条记忆在讲的事。
在数据结构上分开，这类错误就无法发生。

### 2.6 影子映射（旧记忆迁移，第四节）

离线生成，版本化，只读，单独文件，不写回记忆：

```jsonc
// 建议路径：<data_dir>/.service-area-shadow.json，权限 0600
{
  "rule_version": "areas-v1",
  "generated_at": "2026-10-02T10:00:00Z",
  "generator": "offline-derive",
  "source_snapshot_digest": "<sha256 of memories+candidates>",
  "entries": [
    {
      "candidate_id": "candidate_xxx",
      "memory_id": "memory_yyy",            // 仅供人工审阅定位，不作为键
      "kind_at_time": "project",
      "derived_areas": ["work"],
      "rule_hits": ["kind_default:project->work"],
      "confidence": "high",                  // high | low
      "flags": ["protected_kind"]            // 需人工注意的标记
    }
  ],
  "summary": {
    "total": 0, "no_area": 0, "multi_area": 0,
    "protected_kind": 0, "low_confidence": 0,
    "by_area": {}
  }
}
```

**最小审计字段**：`rule_version`、`generated_at`、`source_snapshot_digest`、每条的 `rule_hits`。
有了 `rule_version` + `source_snapshot_digest`，任何一份映射都能判断它是针对哪一版规则、哪一份数据生成的；整份文件可删除、可重建、可按版本并存。

**人工审阅前，影子映射不得进入召回过滤。** 审阅通过后的转正方式见 5.5。

---

## 3. 各阶段数据流

### 3.1 写入（创建候选）

```
add_candidate(value)
  → kind = value.kind
  → 查 kind→area 默认映射表，取得 default_areas
  → 写入 service_areas = [{area, origin:"kind_default", kind_at_time:kind, assigned_at:now}]
  → 此后不再跟随映射表变化
```

映射表本身带版本号。修改映射表**不追溯**已有记录。

### 3.2 整合（admit）

```
admit(candidate_ids, ...)
  → 现有逻辑完全不变
  → 额外：rebuild_service_area_index(memory)
       areas  = ⋃ 各来源候选的有效区域
       by_area = {area: [候选 ID]}
```

**不修改**：`tags` 并集逻辑、`source_candidate_ids`、`timeline`、`consolidation`、指纹、嵌入。

### 3.3 区域修订

```
set_candidate_areas(candidate_id, add=[], remove=[], actor, reason)
  → 修改该候选的 service_areas / service_area_exclusions
  → 对所有引用该候选的记忆重建 service_area_index
  → 写审计事件 service_areas_updated（只记 candidate_id、area 名、origin，不记正文）
```

修订的是来源映射，不是整合层。这满足第二节「修改区域时应修改对应来源映射，再重建整合层目录」。

### 3.4 拆回（rollback）

```
rollback_admission(rollback_id)
  → 现有逻辑恢复 candidate_before
  → 候选 ID 不变 → service_areas 自动跟随，无需任何迁移动作
  → 删除被撤销记忆的 service_area_index
```

这是选择 `candidate_id` 作为键的直接收益：**拆回路径上区域逻辑无代码**。

### 3.5 重新整合

新 `memory_id`，但来源候选 ID 相同 → 重建索引即可得到与之前一致的区域分布。

### 3.6 清除候选正文（shred）

**区域随正文一起清除，不进保留白名单。**

现有实现已经表明了态度：

```python
keep = {key: row[key] for key in ("id", "memory_id", "routed_to", "routed_target", "decided_at") if key in row}
row.clear()
row.update(keep, state="shredded", original_state=original_state, shredded_at=now)
```

白名单之外的一切都被 `row.clear()` 清掉。`service_areas` 与 `service_area_exclusions`
不在白名单里，因此**不需要任何额外代码就会被清除**；真正需要克制的是不要把它们加进白名单。

**为什么不能保留**：区域本身就是内容。一条候选被标为 `relations + mail`，
即使正文已清空，这两个标签仍然透露了它讲的是什么。为了避免派生索引出现悬空指针
而保留区域，等于用隐私强度去换数据结构整洁——方向是反的。

**因此 shred 之后：**

```
shred_eligible_candidates()
  → 现有清除逻辑不变（service_areas 自然随 row.clear() 消失）
  → 额外：对所有引用这些候选的记忆重建 service_area_index
       被清除的候选 ID 从 by_area / associated_by_area 中移除
       areas 并集相应收窄
  → 不保留「这段曾属于哪个区域」的任何痕迹
```

**派生索引的收窄是预期行为，不是数据损坏。** 一条记忆的全部来源候选都被 shred 后，
它的 `by_area` 会变空，于是在任何指定区域的入口都不可见——这与 5.1「没有区域信息时
不猜测」一致，也正确反映了「我们已经不再保留这段的归属信息」这一事实。

正式审计流只记录 `candidate_content_shredded` 事件与候选 ID（现有行为），
**不记录被清除的区域名**。

### 3.7 召回

见第 4 节。

### 3.8 导出 / MCP

见第 6 节。

---

## 4. 召回过滤伪码

### 4.1 设计约束复述

- **区域过滤早于关键词匹配**，不只是早于 `_fit()` 装箱（见 4.2）
- 匹配的段、返回的段、装箱的段必须是同一段
- 一条整合记忆一次最多贡献一段
- 区域数量不参与排序
- 被区域排除的要可统计
- 保护类型不因区域绕过人工复核

### 4.2 顺序约束（v0.1 修订）

**区域过滤必须早于关键词匹配。**

v0.1 初稿的伪码先用整条整合记忆跑 `_matches(query, row)`，再投影到本区分段。这是错的：
查询可能命中工作段的正文，使整条记忆通过匹配，而在「生活」入口返回的却是生活段——
**匹配的段与返回的段不是同一段**，调用方拿到的是与查询无关的内容，却被当作命中结果。

根因是把区域当成了事后筛选。区域实际上**决定候选集本身**：在某个入口里，
跨区记忆的他区分段根本不应该进入比较视野。

正确顺序：

```
取本区分记忆  →  只用这些分记忆匹配查询  →  按记忆聚合，每条最多一段  →  装箱
```

### 4.3 伪码（修订版）

```python
# continuity.py 新增；不修改 _fit() 本身

def area_segments(snapshot, area):
    """展开成「本区可见的分记忆」列表。区域在此一次性决定候选集。

    area=None 时不过滤，直接返回按整条记忆组成的伪分段，保证现状行为不变。
    本函数只读。
    """
    candidates_by_id = {c["id"]: c for c in snapshot.get("candidates", [])}
    rows = []
    for memory in snapshot.get("memories", []):
        if memory.get("state", "active") != "active" or _expired(memory):
            continue
        if area is None:
            rows.append(as_segment(memory, segment=None, matched_area=None))
            continue
        index = memory.get("service_area_index") or {}
        # 只取正文分段。related_only 候选在 associated_by_area 里，
        # 不参与可见性、不能当代表段，只在显式展开关联时另行取出。
        segment_ids = (index.get("by_area") or {}).get(area) or []
        for cid in segment_ids:
            segment = candidates_by_id.get(cid)
            if segment is None:
                continue          # 索引陈旧：当作不可见，不猜测
            rows.append(as_segment(memory, segment=segment, matched_area=area))
    return rows


def build_layered_context(snapshot, *, query="", area=None,
                          expand_timeline=False, expand_associations=False, ...):
    ...
    # 1) 区域先行：候选集只含本区分记忆
    segments = area_segments(snapshot, area)

    # 2) 匹配只看分记忆自己的文本，绝不看整条整合记忆
    matched = [row for row in segments if _matches(query, row.segment_text)]

    # 3) 按记忆聚合：一条记忆最多贡献一段，且必须是真正命中的那段
    best = {}
    for row in matched:
        current = best.get(row.memory_id)
        if current is None or relevance(row, query) > relevance(current, query):
            best[row.memory_id] = row
    active = list(best.values())

    if expand_timeline:
        # 仅由调用方显式意图触发；绝不能由 len(areas) 或段数触发。
        # 展开时仍只展开本区正文分段，不跨区取段，也不带入关联段。
        active = expand_to_all_matched_segments(matched, limit_to_area=area)

    if expand_associations:
        # 独立的显式意图。关联段在此才首次出现，且永远作为附属列出，
        # 不进入 best（代表段）、不参与排序、不占据代表位。
        attach_associated_segments(active, snapshot, area)

    # 4) 统计：区分「不在当前区域」与「不存在」
    if area is not None:
        visible_ids = {row.memory_id for row in segments}
        area_skipped_ids = [
            memory["id"] for memory in snapshot.get("memories", [])
            if memory.get("state", "active") == "active"
            and not _expired(memory)
            and memory["id"] not in visible_ids
        ]
    else:
        area_skipped_ids = []

    # 5) 排序键保持不变：时间。不含区域数量、不含段数、不含可见段数
    active.sort(key=lambda row: str(row.occurred_at or row.updated_at or ""), reverse=True)

    # 以下 _fit()、预算、层划分、skipped 统计全部沿用现有实现；
    # 装箱文本就是上面匹配到的那一段，不是整条整合记忆
    ...
    return {
        ...,
        "area": area,
        "area_skipped_count": len(area_skipped_ids),
        "area_skipped_ids": area_skipped_ids,
        "persisted": False,
    }
```

### 4.4 这一改顺带解决的两件事

- **匹配段 == 返回段 == 装箱段**，三者现在恒等。调用方拿到的理由和内容对得上。
- `_matches()` 不再面对跨区整合记忆这种「不该存在于当前入口」的对象，
  它的语义回到「这段文字是否命中查询」，不掺区域逻辑。

### 4.5 为什么这样能防「贴多个区域更容易被召回」

- `by_area` 只决定**可见性**（布尔），不产生分数
- 排序键里没有任何与区域有关的项
- 一条记忆最多贡献一段，所以跨区记忆**不会因为段多而占据更多预算**
- 他区分段根本不进入当前入口的候选集，因此也无法通过「整条记忆命中」间接抬升可见性
- 这三条合起来保证：把一条记忆贴到 5 个区域，它在任何单一入口的排名和占位与贴 1 个区域时完全相同

建议把这四条各写一个测试用例，因为它们是最容易在后续重构中被悄悄破坏的部分。

**另需一条 shred 隐私回归测试**：对一条已 shred 的候选，断言其 `service_areas`
与 `service_area_exclusions` 均不存在，且它已从所属记忆的 `by_area`、
`associated_by_area` 与 `areas` 中移除；同时断言审计事件中不含任何区域名。

**另需一条关联段回归测试**：构造一条整合记忆，其 `related_only` 来源候选的正文
恰好命中查询。断言普通召回（不传 `expand_associations`）结果中**不出现该段**，
且它没有占据该记忆的代表段位置。

**另需一条串区回归测试**：构造一条同时含工作段与生活段的整合记忆，
用只命中工作段正文的查询在「生活」入口召回，断言结果为空——
而不是返回生活段。这正是 v0.1 初稿的缺陷。

### 4.6 保护类型

`project_memory_for_area` 不对 `identity / relationship / boundary` 做任何特殊放行。这些类型的人工复核要求由现有 `memory_tiering` 与 `decision_ledger` 路径负责，区域过滤只能让它们**更少出现**，不能让它们**跳过复核**。

---

## 5. 兼容与回退

### 5.1 字段缺失即视为「不参与区域过滤」

- 候选无 `service_areas` → 该段在任何指定区域的入口都不可见，但在 `area=None` 的全局召回中正常可见
- 记忆无 `service_area_index` → 同上

**默认行为是保守的：没有区域信息时不猜测，只在不过滤的入口出现。**

### 5.2 `area=None` 保持现状

不传 `area` 时，`build_layered_context` 行为与当前实现逐字节一致。这是回退开关，也是对照基线。

### 5.3 旧客户端兼容

- `service_areas`、`service_area_index` 都是**新增可选字段**，旧客户端忽略未知键即可正常工作
- 旧客户端不会传 `area`，于是走 5.2 的现状路径
- 导出文件增加字段不影响旧版导入：导入端对未知键采取忽略策略

### 5.4 功能开关

建议 `MORAINE_SERVICE_AREAS_ENABLED`，关闭时：
- 不写入 `service_areas`
- 不重建 `service_area_index`
- `area` 参数被忽略
- 已存在的字段保留不动，不删除

关闭即完全恢复当前行为。

### 5.5 影子映射转正

影子映射**不自动生效**。人工审阅后，转正是一次显式的离线动作：

```
promote_shadow_areas(shadow_file, rule_version)
  → 对每条 entry，若对应候选尚无 service_areas，
    写入 origin="derived_shadow" 的区域记录
  → 已有 manual 记录或命中 exclusions 的，跳过
  → 重建受影响记忆的 service_area_index
```

转正前后都可以整体删除影子文件并重新生成，不影响已转正的数据（已转正的 `origin="derived_shadow"` 留在候选上）。

---

## 6. 导出与 MCP

### 6.1 可以返回，但必须自述身份

沿用项目既有的自述常量写法（`persisted: false`、`recall_is_evidence_not_fact`）：

```jsonc
"service_area_index": {
  "derived": true,
  "authoritative": false,
  "is_recall_routing_metadata": true,
  "not_a_semantic_classification": true,
  "areas": [...],
  "by_area": {...}
}
```

### 6.2 下游禁止事项（写进工具描述）

区域**不得**用于自动改写 `kind`、正文、身份、关系或边界。
区域**不得**作为隐私或访问控制依据——隐私隔离继续走既有的物理分文件 + 独立能力令牌机制。

### 6.3 旧客户端

见 5.3。额外一条：MCP 工具描述中应说明「未传 area 时返回全部区域的内容」，避免旧客户端误以为自己拿到的是某个区域的子集。

---

## 7. 最小实施顺序

每步独立可回退，每步结束时系统仍可用。

| 步 | 内容 | 产出 |
|---|---|---|
| 1 | 定义 `kind→area` 默认映射表 + 区域枚举 | 配置与常量，无行为变化 |
| 2 | `add_candidate` 写入 `service_areas` | 只写不读，无行为变化 |
| 3 | `admit` / `rollback` 重建 `service_area_index` | 只写不读，无行为变化 |
| 4 | 离线影子映射生成器 + 分布报告 | **只读**，输出给人审阅 |
| 5 | `project_memory_for_area` + `area` 参数 | 默认 `area=None`，行为不变 |
| 6 | 前端区域标签展示（见第 8 节） | 只显示，不过滤 |
| 7 | 人工审阅通过后转正影子映射 | 需显式动作 |
| 8 | 入口启用区域过滤 | 可由开关一键关闭 |

1–4 步不改变任何现有行为，可以先行合并。

---

## 8. 前端契约要点

- `kind`：单个实心标签，紧邻标题
- `service_areas`：多个描边标签，卡片下部
- 当前入口对应区域高亮，其余弱化
- `identity / relationship / boundary` 保留或加强现有保护视觉，不得与普通记忆同形
- **整合记忆预览按分记忆分别显示区域**，不展示整合层并集
- 修订入口操作的是具体来源候选，并显示该区域的 `origin`（默认 / 派生 / 人工）

---

## 9. 与关键词证据层的关系

- 关键词负责**找到并比较分记忆**；`service_areas` 只决定该分记忆**在哪些入口可见**
- 区域**不进入**任何证据累加。它是布尔可见性，不是分数
- 同一主题下的不同分记忆可以服务不同区域，这是正常状态，不构成整合理由
- 整合判断仍只依据同一事件、连续发展、重复、补充、更迭、冲突，**区域不参与**
- 整合层的 `by_area` 与可能的关键词指针表都是**派生索引**，用于定位，不用于加分

这样 `service_areas` 不会成为新的弱信号来源，也就不会参与「影子图」式累加。

---

## 10. 需要先做决定的未决问题

1. **区域枚举的初始集合与边界**：`work / life / relations / mail / game / study` 是示例，实际集合需要确定。区域一旦投入使用，重命名的迁移成本高于预期。

2. ~~`related_only` 来源算不算分记忆~~ —— **已定（2026-10-02，Cairn）**：不算。
   只进 `associated_by_area`，不参与区域可见性，不能作为代表段，仅在调用方显式
   要求展开关联时带出。见 2.5。

3. ~~候选被 shred 后区域怎么办~~ —— **已定（2026-10-02，Cairn）**：区域随正文一同清除，
   不进保留白名单，并重建受影响记忆的派生索引。派生索引收窄是预期结果，
   不得为了避免悬空指针而削弱删除语义。见 3.6。

4. **一条记忆在全部区域都被排除时的行为**：是完全不可见，还是落到某个「未分类」入口？本规格暂定完全不可见（5.1），需要确认这是否符合预期。

5. **`expand_timeline` 的触发方式**：由谁判定「问题明确要求完整时间线」？建议由调用方显式传参，不做意图识别。需要确认。

6. **影子映射的保留期**：参照影子评测日志的 45 天，还是长期保留直至转正？

7. **区域修订是否计入正式审计流**：建议计入，但只记 `candidate_id` 与区域名，不记正文；需要确认与现有审计脱敏要求一致。
