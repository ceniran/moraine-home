# Moraine 升级指南

本文适用于已经部署过 Moraine、希望升级到 `v0.3.0-beta.4` 的用户。升级不会要求重建记忆库，但操作前仍应先从界面导出数据，或复制持久化数据目录。

## 升级前必须保留

- 数据目录或容器持久卷；
- `.env`、访问令牌和平台 Secret；
- 最近一次导出的 JSON 备份。

不要执行 `docker compose down -v`，也不要删除或覆盖现有数据目录。

## Git 源码部署

```bash
git status
git pull --ff-only origin main
. .venv/bin/activate
python -m pip install -e '.[mcp]'
```

随后按原来的方式重启 Moraine 服务。若 `git status` 显示本地修改，请先备份并处理这些修改，不要强行覆盖。

## Wheel 安装

下载新 Release 中的 wheel，然后在原虚拟环境执行：

```bash
python -m pip install --upgrade ./moraine_home-0.3.0b4-py3-none-any.whl
```

安装完成后重启原服务。

## systemd 部署

先按 Git 或 wheel 方式更新代码，再执行：

```bash
sudo systemctl restart moraine-beta
sudo systemctl status moraine-beta --no-pager
```

服务名若不是 `moraine-beta`，请使用安装时采用的名称。

## Docker Compose 部署

使用远程镜像时拉取新镜像；从源码构建时重新构建，然后仅重建容器：

```bash
docker compose pull
docker compose up -d
```

或：

```bash
docker compose build --pull
docker compose up -d
```

确认 compose 文件仍挂载原来的数据卷，并保留原 Secret。

## Zeabur 等托管平台

从仓库部署的实例选择最新 Release 或 `main` 后重新部署；从镜像部署的实例更新镜像标签后重新部署。不要新建空卷替代旧卷，环境变量和 Secret 也应继续沿用。

## 本版变化

- 换用统一的 Moraine 前端，同时保留旧界面于 `/legacy-v1/`；
- 新前端通过兼容接口读取原有记忆、候选、日历、身份与关系数据；
- 候选整合继续要求先预览、再输入确认码执行；
- 默认身份文案改为中性的 `Agent`，不会把部署者固定写成 Cairn 或 Codex。

升级后请先检查 `/api/health`，再打开首页确认原有记忆数量、候选数量和关系节点。若需要回滚，恢复升级前的代码或 wheel 并继续挂载同一份数据；不要导入空白数据覆盖原库。
