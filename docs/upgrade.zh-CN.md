# Moraine 安全升级说明

本说明覆盖源码、Python wheel、systemd、Docker Compose 与 Zeabur 部署。升级只替换程序文件，不应删除或重新初始化数据目录。

## 所有部署方式都先做这三件事

1. 在工作台设置页建立快照，并下载一份完整导出；
2. 记下当前版本和部署目录；
3. 保留原数据目录、持久卷、`.env`、访问令牌与其他 Secret。不要执行 `docker compose down -v`，不要删除 `data/`，也不要重新生成令牌覆盖旧配置。

升级完成后打开工作台，并检查：

```bash
curl http://127.0.0.1:4790/api/health
```

响应应包含 `"ok": true`。远程实例仍应通过 HTTPS 与鉴权访问，不要把 4790 端口直接开放到公网。

## GitHub 源码版

在原仓库目录执行：

```bash
git status --short
git pull --ff-only origin main
. .venv/bin/activate
python -m pip install -e '.[mcp]'
```

如果 `git status` 显示本地修改，先自行备份或提交，不要用 `reset --hard` 覆盖它们。直接使用 `scripts/run-beta.sh` 的本机实例，停止旧进程后重新运行脚本；由 systemd 管理时按下方重启服务。

## Release wheel 版

从 GitHub Release 下载与你的 Python 环境匹配的新 wheel，然后在原虚拟环境中执行：

```bash
. .venv/bin/activate
python -m pip install --upgrade ./moraine_home-0.3.0b17-py3-none-any.whl
```

不要新建数据目录。安装完成后按原方式重新启动 `moraine-beta`；若同时使用 MCP，也重启 MCP 客户端以重新载入工具。

## 自管 VPS / systemd

先用源码或 wheel 方法更新程序，再执行：

```bash
sudo systemctl restart moraine-beta.service
sudo systemctl restart moraine.service
systemctl --no-pager --full status moraine-beta.service moraine.service
```

只重启实际启用的服务。原环境文件和受保护凭证文件继续复用，不要复制到命令行、聊天或仓库。

## Docker Compose

如果使用发布镜像：

```bash
docker compose pull
docker compose up -d
```

如果从仓库本地构建：

```bash
git pull --ff-only origin main
docker compose build --pull
docker compose up -d
```

随后运行 `docker compose ps` 和健康检查。必须保留原 volume 与 Secret；不要使用 `down -v`。

## Zeabur

- GitHub 部署：在服务控制台选择最新 Release 标签或最新 `main`，触发一次 Redeploy；
- Docker 部署：更新镜像标签后重新部署；
- 检查持久卷挂载路径与所有 Secret 仍然存在，再查看健康检查与启动日志。

不要删除旧服务后新建，否则可能丢失未挂入持久卷的数据。

## 回退

程序升级失败时，先停止服务，把代码、wheel 或镜像退回升级前的版本，再使用原数据目录启动。不要为解决启动错误直接清空数据。

只有新版本确实迁移了数据且无法向后读取时，才从升级前快照恢复；恢复前仍应保留当前故障状态的副本，便于排查。

## v0.3.0-beta.17 的变化

- 新增通用聊天宿主桥：`/api/host/turn/prepare` 在回复前构造有预算、有来源的召回上下文，`/api/host/turn/commit` 在回复后处理显式记忆标记并返回可见正文；
- MCP 新增 `conversation_prepare` 与 `conversation_commit`，Telegram 等宿主无需自行重复实现解析和写入协议；
- 单轮支持零到八条记忆，候选与小机自主直入可以并存；单条格式或写入失败不会阻断其他记忆及普通回复；
- 本地关键词降级增加中文长句片段匹配，语义服务不可用时也能处理常见承接式表达；
- 私人身份、日记、书房、唤醒调度和主动消息仍不进入通用发行核心。

## v0.3.0-beta.16 的变化

- 新材料仍默认进入候选箱；达到稳定信号且不属于身份、关系、边界的候选，可按两个可配置本地时间自动分批入库；
- 记忆库所属的小机可用 `admission_mode: direct` 自主直接入库，无需理由，同时保留来源审计与48小时撤回；
- 新增可选的多值 `emotion_keywords`，写入后就是普通关键词；不要求每条记忆都有，也不从正文自动猜测或单独加权；
- 新增自动入库状态与执行 API、MCP 工具，并把权利边界和回退语义写入小机说明书。

## v0.3.0-beta.15 的变化

- 清理公开源码、测试语料与默认界面中的部署者私人称呼，示例统一为合成人物或通用 Agent／用户标签；
- 移除文档中的真实服务地址，改为不可解析的占位域名，并扩大发行前隐私与凭证扫描；
- 补全浏览器端第三方依赖声明，为 CDN 脚本补齐子资源完整性校验；
- 明确本项目采用 PolyForm Noncommercial，是源代码可用／非商业开放软件，不是 OSI 定义的开源软件；
- 保留旧数据中的历史字段别名以兼容既有实例，但新界面和合成示例不再把维护者身份当作默认配置。

## v0.3.0-beta.14 的变化

- 默认入口切换为新的 `dwell-release` 前端，旧 `/dwell-v2/` 继续作为可回退入口；
- 新版前端与旧版回退资源都随 wheel 分发，不依赖源码目录或私人 Dwell 部署；
- 新增通用小机主页、活动记录、重做后的事件日历、工作台后端接入进度与发行边界适配层；
- 私人日记、书房、发展线、定时唤醒与 Agent 后端修订队列不进入通用发行包；
- 增加发行版后端契约、小机说明书、旧版功能差异与安全回退说明。

## v0.3.0-beta.6 的变化

- 纯净内测版采用与 Dwell 记忆页一致的完整前端结构、原版样式与移动端布局；
- 总览、事件日历、候选箱和记忆库通过隔离适配器读取 Moraine 数据；
- 补回合成候选的预览、确认码执行和可回退入库链路；
- 旧界面保留在发布包的 `legacy-v1/` 中，便于出现前端兼容问题时排查；
- 不迁移或读取任何私人 Dwell 数据，也不改变既有 Moraine 数据目录。
- 实例空间标题读取各部署者自己的资料，未设置时显示 `Moraine`；关系网中心类型读取实例配置，未设置时显示 `Agent`，不再固定为 Cairn 或 Codex。
