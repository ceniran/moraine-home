# Moraine 纯净内测版

这是与私人生产实例隔离的独立运行层。它默认只读取仓库中的合成示例，并将数据写入 `data/beta-store.json`。它不会尝试连接 Telegram、邮箱、Dwell、私人书房或任何固定服务器路径。

## 当前已接通

- 候选记录进入事件篮子；
- 多条候选按原事件时间整理为一条带来源和时间线的长期记忆；
- 总览、当前记忆、候选箱和归档读取同一份本地数据；
- 归档和恢复保留审计事件；
- 候选整合后保留48小时完整撤回入口；若记忆或来源候选后来发生变化，旧回退会被安全拒绝；
- 设置页可创建、查看并恢复本地快照，恢复前会再次保存当前状态；
- 可选的候选保留策略只粉碎已结案且到期的候选正文，待审候选不受影响；
- 可选的身份与关系归位允许明确把候选送入 self-core 或关系网，默认关闭；
- 重复、补充、更迭、冲突与仅相关采用不同整合结构；
- 修订保留旧版本，替换保留事实变化链；
- 通用个人空间可维护 self-core 与关系节点，但不包含任何真实人物资料；
- 整库 JSON 导出与导入；
- 手机优先的本地前端；
- 独立的 Moraine 本地向量服务仍可通过原有 `moraine` 命令运行。

纯净版包含不绑定具体人物的关系网；邮箱同步、个人书房正文与自主醒来属于私人或可选集成，不在发布包中默认启用。

## 启动

需要 Python 3.10 或更高版本。第一次试用工作台本身不要求安装向量模型依赖：

```bash
cp .env.example .env
chmod +x scripts/run-beta.sh
scripts/run-beta.sh
```

随后在同一台机器打开 `http://127.0.0.1:4790/`。服务默认只监听本机。如果需要从其他设备访问，请放在带 HTTPS 和鉴权的可信反向代理之后；不要直接把工作台端口暴露到公网。启用 `MORAINE_BETA_TOKEN` 后，可在浏览器工作台“设置”中输入令牌；它只保存在当前浏览器会话。

需要本地语义检索时，再创建虚拟环境并安装完整依赖：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
moraine
```

首次运行会下载配置的本地嵌入模型。低配机器建议保留默认的小批量与双线程设置。

## 数据与迁移

- `src/moraine/data/beta-seed.json` 只含合成示例，可以删除或替换；
- `data/beta-store.json` 是工作台的权威数据文件；
- 导出文件包含 `schema`、记忆、候选与审计事件，可在另一实例中导入；
- 导入是全量替换操作，界面会要求明确确认并先生成快照。

当前是内测版，不承诺数据库级并发、多人权限或公网安全托管。请保留自己的备份。私人实例与发布包的详细边界见 [迁移清单](private-to-standalone-migration.zh-CN.md)。

## 四种部署方式

1. **直接运行**：`scripts/run-beta.sh`，适合本机快速体验工作台；
2. **Python 虚拟环境**：`pip install -e .` 后分别运行 `moraine-beta` 与 `moraine`，适合开发和调试；
3. **systemd**：使用 `deploy/moraine-beta.service`、`deploy/moraine.service` 与各自环境文件，适合长期运行的 Linux 服务器；
4. **Docker Compose（实验性）**：设置两个随机令牌后运行 `docker compose up -d`，工作台端口默认只映射到宿主机 `127.0.0.1`。当前发布主机尚未完成真实 Docker 拉起验收，首次内测优先使用前两种 Python 方式。

## 让 Agent 通过 MCP 使用

MCP 适配器不会另外保存一份记忆；它只把 Agent 的工具调用转发到正在运行的纯净版 API。先启动 `moraine-beta`，再安装 MCP 可选依赖：

```bash
. .venv/bin/activate
pip install -e '.[mcp]'
```

Codex CLI 可以这样连接本机实例：

```bash
codex mcp add moraine \
  --env MORAINE_MCP_URL=http://127.0.0.1:4790 \
  --env MORAINE_BETA_TOKEN="$MORAINE_BETA_TOKEN" \
  -- moraine-mcp
```

也可以写入 Codex 的 `config.toml`：

```toml
[mcp_servers.moraine]
command = "moraine-mcp"
env_vars = ["MORAINE_MCP_URL", "MORAINE_BETA_TOKEN"]
default_tools_approval_mode = "writes"
```

MCP 向记忆库所属的 Agent 开放与人类工作台等价的能力：总览、搜索与读取、候选治理、整合预览与执行、赋权、修订、替换、归档恢复、审计、日历、self-core、关系网、审阅模式及整库导入导出。Moraine 后端本身没有永久删除接口，因此 MCP 也不伪造一个不可恢复的删除能力。

这些工具不额外要求人类替 Agent 批准。自主模式下，Agent 可以依据说明管理自己的记忆；共同模式下，双方按自己的约定共同审阅。工具描述会持续提醒：候选不是事实、召回不是真相、权重不是感情分数，整合前应先预览，整库导入前应核对来源；导入时后端会先建立恢复快照。

若客户端找不到工具，先确认纯净版 API 正常、`MORAINE_MCP_URL` 可达且令牌一致，再重启客户端刷新 MCP 工具列表。不要把令牌写进仓库或聊天内容。

## 可选的 Jev 小参谋凭证

设置页可以把 Jev API Key 经工作台鉴权连接保存到后端的独立0600文件，供 Agent 运行层或自动唤醒编排器按需读取。它不恢复旧版的“Jev 召回复核”：Moraine 的关键词、向量、排序和写入不会调用 Jev，也不会自动向外发送查询或记忆候选。

状态接口只返回是否已配置、是否启用及是否允许用于自动唤醒，永不回显密钥。密钥不属于便携记忆数据，不进入导出文件或MCP工具结果。远程填写时应使用HTTPS；需要迁移运行层配置时，应通过服务器的安全凭证通道单独迁移，而不是放进聊天或记忆备份。

Docker Compose 示例：

```bash
cp .env.example .env
python3 - <<'PY'
import secrets
with open('.env', 'a', encoding='utf-8') as file:
    file.write(f"\nMORAINE_BETA_TOKEN={secrets.token_urlsafe(32)}\n")
    file.write(f"MORAINE_API_TOKEN={secrets.token_urlsafe(32)}\n")
PY
docker compose up -d
```

远程或容器部署开启令牌后，在前端“设置”中输入工作台令牌；令牌只保存在当前浏览器会话，不写入页面或导出文件。
