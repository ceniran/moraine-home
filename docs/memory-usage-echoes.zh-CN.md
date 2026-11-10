# 记忆使用回声

记忆使用回声是一层独立、追加式的行动证据。它回答的不是“这条记忆是什么”，而是“这条记忆后来有没有改变一次真实行动”。

它不属于新的语义分区，也不改写正式记忆正文。每条回声通过 `memory_ids` 指向一条或多条正式记忆，并记录：

- `effect`：`helped`、`used`、`unused`、`misleading` 或 `outdated`
- `action`：当时作出的判断或行动
- `result`：行动结果
- `note`：必要的补充说明
- `occurred_at`：真实发生时间
- `actor` 与可选的 `retrieval_id`：来源审计线索

第一版刻意保持保守：回声不自动改变记忆的重要度、召回排序或正文。`affects_importance` 与 `affects_ranking` 固定为 `false`。未来若要让回声参与排序，应先积累足够的真实使用记录，再以独立、可关闭、可回退的策略接入。

## 接口

- `POST /api/dwell-v2/memory-echoes`：追加一条回声
- `GET /api/dwell-v2/memory-echoes?memory_id=<id>`：读取单条记忆的回声摘要与时间线
- `GET /api/dwell-v2/memory-echoes?limit=3`：读取最近回声
- `GET /api/dwell-v2/memories/<id>`：记忆详情中的 `usage_echo`
- `GET /api/dwell-v2/overview`：总览中的 `recent_echoes`

前端不增加一级导航。总览只展示少量“最近回声”，单条记忆详情展示“它怎样影响过我”及完整时间线。
