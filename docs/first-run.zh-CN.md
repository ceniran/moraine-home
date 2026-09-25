# Moraine 内测版：十分钟首次使用

当前内测版本：`v0.2.0-beta.1`。需要 Python 3.10 或更高版本。

## 1. 下载并创建本地配置

```bash
git clone https://github.com/ceniran/moraine.git
cd moraine
cp .env.example .env
```

默认配置只监听 `127.0.0.1`。本机试用可以保持令牌为空；VPS 或跨设备访问必须设置随机的 `MORAINE_BETA_TOKEN`、使用 HTTPS 反向代理，并且不能把 `4790` 端口直接暴露到公网。

## 2. 先启动工作台

```bash
scripts/run-beta.sh
```

打开 `http://127.0.0.1:4790/`。第一次进入的是合成示例，不包含 Cairn、Xiaoran 或其他真实用户的数据。

## 3. 需要语义搜索时再启动本地模型

另开一个终端：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
set -a
. ./.env
set +a
moraine
```

首次运行会下载 `BAAI/bge-small-zh-v1.5`。下载或语义服务不可用时，工作台仍能运行，并会明确降级为关键词搜索。

## 4. 跑完第一个可回退闭环

1. 在候选箱加入一条不含隐私的测试候选；
2. 预览整合草稿，确认来源、时间和关系类型；
3. 执行整合后，从记忆库搜索并展开时间线；
4. 在归档区尝试归档与恢复；
5. 在设置中导出 JSON，并把它保存到独立位置。

候选不是事实，召回不是真相。身份、关系、冲突和重大承诺不要只凭相似度自动决定。

## 5. 可选：连接本地 Agent

```bash
. .venv/bin/activate
pip install -e '.[mcp]'
codex mcp add moraine \
  --env MORAINE_MCP_URL=http://127.0.0.1:4790 \
  --env MORAINE_BETA_TOKEN="$MORAINE_BETA_TOKEN" \
  -- moraine-mcp
```

连接后重启或刷新 Agent 客户端，使其重新发现工具。MCP 不建立第二份记忆库，只访问正在运行的纯净工作台。

## 内测问题反馈

- 先记录版本 `v0.2.0-beta.1`、操作系统、Python 版本、安装方式和复现步骤；
- 只使用合成数据或彻底脱敏的样例；
- 不要上传导出文件、真实记忆、邮箱、访问令牌、API Key 或服务器路径；
- 当前首推 Python 本地安装。Docker Compose 尚标为实验性部署入口。

更完整的部署、MCP、数据迁移和安全边界见[纯净内测版说明](beta-standalone.zh-CN.md)。
