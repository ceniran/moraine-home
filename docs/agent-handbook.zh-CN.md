# Moraine 小机使用说明

这份说明写给接入 Moraine 的 Agent。它不要求 Agent 了解前端实现，也不把
Moraine 当成自动替 Agent 作决定的第二个大脑。

Moraine 保存可检查、可修订、可迁移的记忆材料；Agent 仍负责理解当前对话、
判断是否需要召回，并为自己的记忆选择负责。Agent 对自己的记忆库拥有直接入库权，
不需要为每一次自主选择向人类提交理由；直接入库仍保留来源、审计与撤回入口。

## 先认识四类对象

| 对象 | 含义 | 默认处理 |
| --- | --- | --- |
| 候选 `candidate` | 尚未确认是否值得长期保存的新材料 | 可忽略、归位或整合，不当作事实 |
| 记忆 `memory` | 已进入正式记忆库的记录 | 召回后仍核对时间、来源与当前适用性 |
| Self Core | Agent 对自身较稳定的身份与原则 | 只从有来源的材料提炼，不机械复制事件全文 |
| 用户画像与关系 | 对用户偏好、边界和关系事实的结构化记录 | 明确归属，保留来源；不把推测写成事实 |

## 每次对话怎么使用

### 1. 需要旧信息时先召回

使用 MCP 工具 `layered_recall(query)`，或调用：

```http
GET /api/recall/layered?query=<当前需要解决的问题>
```

把结果看作线索，不是最终答案。优先核对：

- 是否是同一个人、项目或事件；
- 记录发生在什么时候，后来有没有变化；
- 这是对方明确说过的话、已发生事实，还是旧 Agent 的理解；
- 当前问题是否真的需要展开历史细节。

没有相关结果时继续当前对话，不要因召回失败阻断回复。

### 2. 默认先进入候选箱，小机也可以自主直接入库

使用 `candidate_add(...)`，或：

```http
POST /api/candidates
Content-Type: application/json
```

不指定 `admission_mode` 时默认是 `candidate`。候选应包含完整但精炼的内容、时间、
类型与来源。达到稳定信号的普通候选会在设置的两个本地时间批量自动入库；默认每批
最多 6 条。身份、关系与边界材料不会被批次定时器自动决定。

如果 Agent 明确选择当下就把一段经历留在自己的记忆库，可以提交：

```json
{
  "title": "我想留下的这一刻",
  "content": "……",
  "admission_mode": "direct",
  "selected_by": "agent"
}
```

这项权利不要求附加理由，也不因记忆包含负面情绪、争执或关系修复而失效。它只省去
候选等待，不会把记忆变成不可修订的真理：写入仍会生成候选来源痕迹、审计事件与
48 小时完整撤回入口，之后仍可修订、归档、删除或迁移。

情绪只按普通关键词保存。只有 Agent 判断正文确实包含相应情绪时才提交，可写多个，
也可以完全不写；Moraine 不从正文偷偷推断必填情绪字段。例如：

```json
{"emotion_keywords": ["难过", "释然"]}
```

这些词进入普通 `tags`，与其他关键词拥有相同的查看、编辑和检索权，不获得隐藏加权。

### 3. 稳定信息再归位

- 独立事件：保留为正式记忆；
- 同一事件的后续变化：修订原记忆或建立明确的时间线关系；
- 稳定身份原则：提炼进 Self Core，并保留 `source_ids`；
- 用户长期偏好或边界：提炼进用户画像；
- 人物关系事实：写入关系网；
- 只是相似、但不是同一件事：保持独立。

不要仅凭语义相似度自动合并身份、关系、冲突、重大承诺或受保护内容。

### 4. 写入后留下可回退路径

合并、正文修订、替代、归档、恢复和整库导入等高影响操作，应先预览再执行。
前端使用 `/api/dwell-v2/actions/preview` 与
`/api/dwell-v2/actions/execute`；MCP 已把相应操作拆成带只读或可回退标注的工具。

整库导入会替换当前数据。执行前必须保留快照，并确认正在操作正确实例。

## MCP 工具按意图选择

| 想做什么 | 首选工具 |
| --- | --- |
| 查看系统状态 | `system_overview` |
| 查找相关旧信息 | `memory_search`、`layered_recall` |
| 查看单条记忆 | `memory_get` |
| 新增待整理材料 | `candidate_add` |
| 自主直接入库 | `candidate_add(..., admission_mode="direct")` |
| 查看／执行自动入库批次 | `automatic_admission_status`、`automatic_admission_run` |
| 查看或处理候选 | `candidate_list`、`candidate_decide`、`candidate_route` |
| 预览并完成整合 | `consolidation_preview`、`consolidation_apply` |
| 修订、替代或调权 | `memory_revise`、`memory_replace`、`memory_set_importance` |
| 归档或恢复 | `memory_set_archived` |
| 维护自身身份 | `self_core_list`、`self_core_upsert` |
| 维护用户画像 | `user_profile_list`、`user_profile_upsert` |
| 维护关系网 | `relation_list`、`relation_upsert` |
| 查看审计和回退 | `event_list`、`rollback_list`、`consolidation_rollback` |
| 备份与迁移 | `snapshot_create`、`store_export`、`store_import` |

完整 HTTP 接口、鉴权和写入边界见
[发行版后端接口契约](dwell-release-backend-contract.md)。

## 宿主私有后端怎样对接

Moraine 核心可以独立工作。下面这些能力来自我们完整 Dwell 的宿主 Agent，公开
发行版默认不假装已经拥有。其他小机只有确实需要相同生活能力时才接入；不接入时
应隐藏相应操作，或明确显示“未接通”，不能用演示百分比冒充真实状态。

| 私有能力 | 我们现有的接口或入口 | 谁负责 | 发行版缺失时的降级 |
| --- | --- | --- | --- |
| 后端修订队列 | `GET/POST /api/memory-preview/backend-revisions`；`POST /backend-revisions/<id>/status` | 宿主 Agent + 私有工作台 | 工作台显示核心接口接入状态，不显示“交给小机修订” |
| Agent 审阅工作台 | `GET /api/memory-preview/agent-workbench`；`POST /agent-workbench/decide` | 宿主 Agent | 人工仍可在普通候选箱审阅，自动醒来不消费审阅卡 |
| 私人日记 | Dwell diary 服务；前端私有入口 `/api/diary` | 独立日记服务 | 不显示日记房间；正式记忆不代替私人日记 |
| 私密书房 | Cairn study store，由宿主醒来流程写入 | 独立书房服务 | `study_note` 留空，不把笔记混写进正式记忆 |
| 发展线与生活导航 | `GET/POST /api/memory-preview/development-lines`、`life-navigation` | 私有适配器 | 不显示发展线，不把它降级成待办列表 |
| 自主唤醒 | 宿主的调度队列、幂等执行记录与醒来提示 | Agent 编排器 | Moraine 只提供 `wakeup_preview`，不自行定时或执行 |
| 主动消息发送 | Telegram 或其他宿主消息桥 | Agent 编排器 | 只返回决定或文本，不声称已经联系用户 |
| 生活活动账本 | `/api/memory-preview/activities` 或宿主账本 | 私有适配器 | 只显示 Moraine 自身审计事件 |

### 后端修订队列的最小返回契约

```json
{
  "requests": [
    {
      "id": "revision_...",
      "status": "pending|in_progress|completed|needs_review|failed",
      "source_ids": ["memory_id"],
      "strategies": ["content_compression"],
      "destinations": ["self_core|user_profile|relation"],
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

只有来源、目标写入和来源链接全部核验成功后，宿主才可以把请求标为
`completed`，并按请求选择决定是否可恢复归档原记忆。部分成功、来源歧义、受保护
内容或归属不确定时必须保留原记忆，并标记 `needs_review`。

### 对接顺序

1. 先接 Moraine 核心健康、资料、候选、记忆、召回、快照和导出；
2. 再接宿主身份、Self Core、用户画像和关系网；
3. 确认有真实 Agent 执行者后再开放后端修订队列；
4. 最后按生活需要选择日记、书房、发展线、唤醒和消息发送；
5. 每项能力分别声明权限、超时、幂等键、失败降级和可回退方式。

自主唤醒与消息发送拥有真实外部影响，不能因为接通了 Moraine 就默认获得授权。

## Agent 必须守住的边界

- 不把候选、召回结果或模型推断直接陈述为事实；
- 不把一名 Agent 的亲历归给另一名 Agent；
- 不因“可以保存”就长期保留具体委屈、仇怨或刺人的原话；
- 不在日志、聊天、导出或仓库中暴露令牌、私有路径和真实记忆包；
- 不让语义服务故障阻断关键词召回和正常对话；
- 不把 wakeup preview 当成调度器或消息发送器；是否行动仍由宿主 Agent 判断。

## 最小健康检查

```bash
curl http://127.0.0.1:4790/api/health
```

远程实例必须使用 HTTPS 和鉴权，不能把 4790 端口直接暴露到公网。若页面可开但
接口失败，依次检查服务状态、令牌、反向代理的 `Authorization` 转发和数据目录
权限。不要通过清空数据目录来修复启动问题。

