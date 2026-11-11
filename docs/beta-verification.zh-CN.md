# 纯净内测版验收记录

验收对象：`v0.3.0-beta.15` 独立工作台、新版 `dwell-release` 前端、合成示例、MCP 适配器与 Moraine 本地向量服务。

## 已验证

- 在全新 Python 虚拟环境安装 `.[mcp]`，仓库完整测试共 251 项与 19 个子测试通过；
- 构建 wheel 与 sdist 后，在隔离虚拟环境直接安装 wheel，并确认实际导入路径来自 `site-packages`；
- 安装包内同时包含新版 `dwell-release` 前端与旧版 `dwell-v2` 回退前端，不依赖源码目录补文件；
- 真实启动已安装的工作台：根入口进入 `/dwell-release/`，旧 `/dwell-v2/` 可访问，关键 JS/CSS、健康检查、总览、候选箱和日历接口均返回 200；
- 纯净版定向测试：候选、五类关系整合、时间线、修订、替换、事件日历、赋权、身份资料、关系节点、审计、归档恢复、导入快照、HTTP 鉴权与静态页面；
- 从远程模型仓库首次下载 `BAAI/bge-small-zh-v1.5`，使用合成记忆成功建立 1 条本地索引；
- 工作台通过配置的本地语义 API 查询，返回 `mode: semantic`、合成记忆 ID 与余弦分数；
- 语义服务不可用时返回 `mode: keyword`，页面明确显示降级；
- 390×844 无头浏览器渲染通过，页面无横向主体溢出，主要卡片和署名可见；
- 发布扫描未发现私人生产路径、邮箱、私钥头或常见令牌样式。

## 尚需外部环境复验

- 当前验收主机没有 Docker CLI，因此 `compose.yaml` 已审阅但尚未在该主机真实拉起；Docker 在本版标为实验性入口；
- 公网部署必须由测试者自行配置 HTTPS 与可信反向代理，项目不自动开放公网端口。

可重复运行：

```bash
scripts/check-release.sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . pytest
pytest -q
```
