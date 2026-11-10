# Moraine Agent Memory 参赛核心

参赛运行时只包含无人值守的 `Add`、自动治理和 `Search` 链路。候选箱、人工确认、网页工作台、私人身份与生活功能不在评测请求路径中。

独立进程使用 `moraine-aml` 启动，只提供公开的 `GET /health` 与需要鉴权的 `POST /add`、`POST /search`，不加载网页或家用数据存储。

当前隔离部署入口：

- Health：`https://aml.dwell.wiki/health`
- Add：`https://aml.dwell.wiki/add`
- Search：`https://aml.dwell.wiki/search`

2026-10-18 已由旧的内测网页进程切换到 `moraine.aml_server`。公网验收确认健康检查、同步Add、幂等重试、立即Search、跨用户隔离及根路径无前端暴露均正常。旧systemd主文件与数据目录配置分别保留 `.before-competition-v1` 备份，旧评测数据未覆盖。

```bash
MORAINE_AML_TOKEN='使用部署平台的密钥注入' \
MORAINE_AML_DATA_DIR='./data/aml-evaluation' \
MORAINE_AML_SEMANTIC=1 \
moraine-aml
```

密钥不得写入仓库、URL、截图或诊断日志。正式提交前需在与比赛相同的资源限制下重新运行 Smoke、困难留出集与多用户耐久测试。

## 2026-10-18 本地冻结验收

- 接口、自动治理、隔离与关系图单元测试：34 项通过。
- 基础语义集：20/20 Top-1，MRR 1.0。
- 困难集与冻结留出集合并：40/40 Top-1，MRR 1.0。
- 多用户耐久：3 个隔离用户、180 条消息、24/24 Top-1；幂等重试、未知用户隔离与 `top_k=100` 均通过。
- 耐久样本延迟：Add 中位数 129.15ms、P95 139.73ms；Search 中位数 55.81ms、P95 105.84ms。

这些结果只证明仓库内冻结合成场景，不等同于官方隐藏集成绩。正式提交前仍需在最终部署机器上复跑。

```bash
PYTHONPATH=src python -m unittest \
  tests.test_aml_adapter tests.test_aml_server \
  tests.test_aml_capability_regression tests.test_aml_shadow
PYTHONPATH=src python scripts/run-aml-synthetic.py --cache ./models --hard --holdout --json
PYTHONPATH=src python scripts/run-aml-endurance.py --cache ./models
```

## 自动审阅

1. 原始消息按 `user_id` 隔离并在成功响应前持久化。
2. 关键词只召集证据，不能单独裁决合并。
3. 只有规范化完全重复、强同事件补充或具有充分共同事件证据的明确状态更迭进入同一事件账本。
4. 重复证据在检索时折叠，原始来源仍保存在审计记录中。
5. 状态更迭形成从早到晚的时间线和当前节点；Search 仍返回原始证据，不把派生摘要伪装成事实来源。
6. 仅相关、因果、同日或主体相同不会自动合并。
7. 遗忘请求使目标证据退出检索，但保留最小治理审计。
8. 正反陈述等真实冲突建立未决记录并共同参与冲突查询，不自动覆盖或揉合。
9. 当前、历史和发展过程查询使用事件账本重排原始证据，而不是生成无来源答案。

## 与家用版本的边界

家用版本继续保留人工审阅与可视化工作台。参赛核心不读取家用记忆库，不包含私人名称、真实记忆、关系网、自主醒来或前端资源。
