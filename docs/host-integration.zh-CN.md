# 把 Moraine 接进真实聊天

Moraine 不替宿主聊天，也不要求复制某个维护者的身份、日记或生活编排。通用接线只有
两步：模型回复前取回少量线索，模型回复后处理它主动写出的记忆标记。

## 一轮对话的最短流程

```text
用户消息
  -> POST /api/host/turn/prepare
  -> 把 prompt_context 作为可忽略的历史线索交给模型
  -> 模型生成普通回复，以及零个或多个 dwell-memory 标记
  -> POST /api/host/turn/commit
  -> 把 visible_text 发给用户
```

`prepare` 是零写入操作。短承接句会带最近两条消息构造检索查询，较完整的问题只用
当前消息；输出受分层预算限制，并保留来源。没有结果也不阻断聊天。

```http
POST /api/host/turn/prepare
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "那周末呢？",
  "recent_messages": ["我们在聊沿河散步", "想挑一个不下雨的下午"],
  "include_history": false
}
```

宿主只需把返回的 `prompt_context` 放进本轮模型上下文。不要把召回内容伪装成 system
事实；它明确要求模型核对人物、时间、来源与后续变化。

## 模型怎样选择保存

模型若没有想保存的内容，就只输出正常回复。若想保存，可在回复末尾附加：

```text
<dwell-memory>{"title":"周末散步约定","content":"我们打算挑不下雨的周末沿河散步","kind":"event","emotion_keywords":["期待"]}</dwell-memory>
```

一轮最多接受 8 个标记。`title` 与 `content` 必填；`emotion_keywords` 可省略，也可有
多个，写入后只是普通关键词。未指定 `admission_mode` 时进入候选箱；记忆库所属的
Agent 可以明确写 `"admission_mode":"direct"` 自主直接入库，不要求理由，但仍保留
候选来源、审计和撤回入口。

```http
POST /api/host/turn/commit
Authorization: Bearer <token>
Content-Type: application/json

{
  "assistant_text": "好呀，我们挑个有太阳的下午。<dwell-memory>{\"title\":\"周末散步约定\",\"content\":\"我们打算挑不下雨的周末沿河散步\"}</dwell-memory>"
}
```

宿主把响应中的 `visible_text` 发给用户。每个标记独立处理：一个 JSON 写坏或一条写入
失败，不会吞掉普通回复，也不会撤销同轮其他成功写入；详情在 `accepted` 与 `errors`。

## MCP 接线

- 回复前调用 `conversation_prepare(message, recent_messages)`；
- 把 `prompt_context` 注入本轮上下文；
- 回复后调用 `conversation_commit(assistant_text)`；
- 只发送返回的 `visible_text`。

直接使用 MCP 管理记忆时，仍可分别调用 `layered_recall`、`candidate_add` 和自动入库
工具。两种方式写入同一个存储与审计链路。

## 安全与降级

- 两个接口都服从 Moraine API 鉴权；不要在浏览器脚本中暴露令牌；
- `assistant_text` 最多 100,000 字符，标记只接受白名单字段；未知字段被忽略；
- 语义服务不可用时降级到本地关键词检索；中文长句会使用本地二字片段补充匹配；
- 宿主必须在发送前使用 `visible_text`，避免把隐藏记忆标记展示给用户；
- 日记、私密书房、自主唤醒、主动消息和特定 Agent 身份不属于这条通用桥。

