# Moraine 纯净内测版

这是与私人生产实例隔离的独立运行层。它默认只读取仓库中的合成示例，并将数据写入 `data/beta-store.json`。它不会尝试连接 Telegram、邮箱、Dwell、私人书房或任何固定服务器路径。

## 当前已接通

- 候选记录进入事件篮子；
- 多条候选按原事件时间整理为一条带来源和时间线的长期记忆；
- 总览、当前记忆、候选箱和归档读取同一份本地数据；
- 归档和恢复保留审计事件；
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
4. **Docker Compose**：设置两个随机令牌后运行 `docker compose up -d`，工作台端口默认只映射到宿主机 `127.0.0.1`。

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
