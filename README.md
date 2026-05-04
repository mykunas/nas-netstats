# NAS NetStats

> 🤖 **本项目由 AI 辅助开发** — 使用 Cline (AI 编程助手) 在 VS Code 中生成。

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-18+-61DAFB?logo=react" alt="React">
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Docker-部署-2496ED?logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/GitHub-mykunas%2Fnas--netstats-181717?logo=github" alt="GitHub">
</p>

<p align="center">
  <b>轻量级 NAS 实时网速与历史流量统计工具</b><br>
  一键 Docker 部署，网页端即可查看 NAS 整体上下行速率与流量统计。
</p>

<p align="center">
  <a href="https://github.com/mykunas/nas-netstats">📦 GitHub 仓库</a>
</p>

---

## 📖 目录

- [项目介绍](#-项目介绍)
- [功能特点](#-功能特点)
- [技术架构](#-技术架构)
- [项目结构](#-项目结构)
- [快速开始](#-快速开始)
- [配置说明](#-配置说明)
- [访问方式](#-访问方式)
- [管理命令](#-管理命令)
- [常见问题](#-常见问题)
- [安全说明](#-安全说明)

---

## 📌 项目介绍

NAS NetStats 是一个专注于 **NAS 本机网卡整体流量** 的轻量级统计工具。它通过 Python 采集器读取 `/proc/net/dev` 获取网卡收发字节数，由 FastAPI 后端进行流量计算与统计，最终在 React 前端以实时仪表盘和历史图表的形式呈现。

> 🎯 **核心定位**：简单、轻量、开箱即用 —— 只关注 NAS 实时速率与流量历史，不做复杂分析。

---

## ✨ 功能特点

### 📊 实时监控

- **⬇️ 实时下载速度** — 当前下行速率（Kbps/Mbps）
- **⬆️ 实时上传速度** — 当前上行速率（Kbps/Mbps）
- **实时速率刷新** — 自动刷新，实时更新

### 📈 今日统计

| 指标 | 说明 |
|------|------|
| 今日下载流量 | 当日累计下行数据量 |
| 今日上传流量 | 当日累计上行数据量 |
| 今日总流量 | 当日上下行合计 |

### 📅 本月统计

| 指标 | 说明 |
|------|------|
| 本月下载流量 | 当月累计下行数据量 |
| 本月上传流量 | 当月累计上行数据量 |
| 本月总流量 | 当月上下行合计 |

### 🗂️ 历史视图

- **日视图** — 按小时查看流量分布
- **周视图** — 按天查看流量趋势
- **月视图** — 按日查看月度流量
- **年视图** — 按月查看年度流量
- **条形图 + 日历热力图** — 直观展示流量变化

### 🚀 部署特性

- **Docker Compose 一键部署** — 三分钟启动
- **科技感仪表盘** — 深色/浅色双主题，卡片化布局
- **移动端适配** — 桌面、平板、手机均可正常使用
- **配置灵活** — 支持指定网卡、调整采集间隔

---

## 🏗️ 技术架构

```
┌──────────────────────────────────────────────┐
│                  Frontend                     │
│         React + Vite + TypeScript            │
│               ECharts 图表                    │
│                   │                          │
│              REST API                         │
│                   │                          │
│          ┌────────▼────────┐                  │
│          │    Backend      │                  │
│          │    FastAPI      │                  │
│          └────────┬────────┘                  │
│                   │                          │
│          ┌────────▼────────┐                  │
│          │  PostgreSQL     │                  │
│          │    数据库       │                  │
│          └────────┬────────┘                  │
│                   │                          │
│          ┌────────▼────────┐                  │
│          │   Collector     │                  │
│          │   Python 采集    │                  │
│          │  /host/proc/net/dev                │
│          └─────────────────┘                  │
└──────────────────────────────────────────────┘
```

| 组件 | 技术 | 职责 |
|------|------|------|
| **collector** | Python | 定时采集宿主机网卡流量数据 |
| **backend** | FastAPI | 提供流量统计 REST API |
| **frontend** | React + Vite + TypeScript | 科技感仪表盘展示 |
| **database** | PostgreSQL 15+ | 存储流量采样数据 |

---

## 📂 项目结构

```
AI_NAS_NetStats/
├── backend/              # FastAPI 后端
│   ├── app/              # API 应用代码
│   ├── Dockerfile        # 后端构建文件
│   └── requirements.txt  # Python 依赖
├── collector/            # 流量采集器
│   ├── collector.py      # 采集主程序
│   ├── Dockerfile        # 采集器构建文件
│   └── requirements.txt  # Python 依赖
├── frontend/             # React 前端
│   ├── src/              # 前端源码
│   ├── index.html        # 入口 HTML
│   ├── nginx.conf        # Nginx 配置
│   ├── vite.config.ts    # Vite 构建配置
│   └── package.json      # 前端依赖
├── docs/                 # 文档
│   └── verification.md   # 验证指南
├── docker-compose.yml    # Docker Compose 部署配置
├── .env.example          # 环境变量示例
└── README.md             # 本文件
```

---

## 🚀 快速开始

### 前置要求

- 安装了 **Docker** 和 **Docker Compose** 的 NAS 或 Linux 服务器

### 步骤

**1. 克隆项目**

```bash
git clone https://github.com/mykunas/nas-netstats.git
cd nas-netstats
```

**2. 复制配置文件**

```bash
cp .env.example .env
```

**3. 修改配置（可选）**

编辑 `.env` 文件，按需调整参数：

```env
# 自动推荐一个主网卡，或指定初始网卡如 eth0
NAS_INTERFACE=auto

# 采集间隔（秒），默认 5 秒
COLLECT_INTERVAL=5
```

> 💡 **提示**：`NAS_INTERFACE` 只作为首次启动时的初始默认网卡。启动后可以在网页端切换监控网卡，切换后不需要重启容器。

**4. 启动服务**

```bash
docker compose up -d --build
```

**5. 确认启动成功**

```bash
docker compose ps
```

所有容器状态应为 `Up`。

**6. 更新项目**

如果你已经通过 GitHub 仓库部署了 NAS NetStats，后续可以通过 `git pull` 拉取最新代码，并重新构建 Docker 容器完成更新。


---

## 更新项目

如果你已经通过 GitHub 仓库部署了 NAS NetStats，后续可以通过 `git pull` 拉取最新代码，并重新构建 Docker 容器完成更新。

当前项目仓库：https://github.com/mykunas/nas-netstats

## ⚙️ 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `NAS_INTERFACE` | `auto` | 初始监控网卡。`auto` 会优先推荐疑似物理网卡，也可以填写 `eth0`、`enp3s0`、`bond0` 等具体网卡 |
| `COLLECT_INTERVAL` | `5` | 数据采集间隔（秒） |
| `POSTGRES_DB` | `nas_netstats` | PostgreSQL 数据库名 |
| `POSTGRES_USER` | `nas_netstats` | PostgreSQL 用户名 |
| `POSTGRES_PASSWORD` | `nas_netstats` | PostgreSQL 密码 |

### 如何查看 NAS 网卡名称

在 NAS SSH 终端执行以下任一命令：

```bash
ip addr
# 或
cat /proc/net/dev
```

常见网卡名称参考：

| 名称 | 常见场景 |
|------|---------|
| `eth0` | 传统以太网卡 |
| `ens18` | Proxmox VE 虚拟网卡 |
| `enp3s0` | PCIe 网卡 |
| `bond0` | 网卡绑定聚合 |
| `br0` | Docker 网桥 / Open vSwitch 网桥 |

> 如果不确定，可以查看 `cat /proc/net/dev` 中收发字节数明显的网卡。

### 如何选择监控网卡

NAS、虚拟机、旁路由和 Docker 同时运行时，系统里经常会出现 `eth0`、`br0`、`docker0`、`vnet0`、`tap0`、`virbr0`、`lo` 等多个网卡。如果把所有网卡流量加总，同一份数据可能同时经过物理网卡、桥接网卡或虚拟机网卡，导致统计结果重复放大。

建议在网页端选择一个 NAS 主网卡进行统计：

1. 打开首页顶部的“切换网卡”。
2. 优先选择绿色“推荐”的物理网卡，例如 `eth0`、`enp3s0`、`ens18`、`eno1`、`bond0`。
3. 不建议选择 `docker0`、`vnet0`、`tap0`、`virbr0`、`lo`，这些网卡通常不是 NAS 总流量入口，可能造成重复统计或无意义数据。
4. 如果你的 NAS 使用桥接网络，例如 `br0` 或 `vmbr0`，需要结合实际网络结构确认是否会和物理网卡重复统计。
5. 网页端切换后会保存到数据库，collector 会在约 10 秒内自动切换到新网卡，不需要重启容器。

历史统计、实时曲线和首页汇总默认只统计当前选中的网卡。切换网卡后，新采集记录会使用新的 `interface_name`，避免把旧网卡和新网卡的数据混在一起。

---

## 🌐 访问方式

> 将 `NAS_IP` 替换为你的 NAS 局域网 IP 地址。

| 服务 | 地址 |
|------|------|
| **前端仪表盘** | `http://NAS_IP:8088` |
| **后端健康检查** | `http://NAS_IP:8000/api/health` |

健康检查正常返回：

```json
{"status": "ok"}
```

---

## 🛠️ 管理命令

### 查看容器状态

```bash
docker compose ps
```

### 查看日志

| 组件 | 命令 |
|------|------|
| 采集器 | `docker compose logs -f collector` |
| 后端 | `docker compose logs -f backend` |
| 前端 | `docker compose logs -f frontend` |

### 重启服务

```bash
docker compose up -d
```

### 停止服务

```bash
docker compose down
```

### 完全重建

```bash
docker compose down
docker compose up -d --build
```

---

## ❓ 常见问题

### ❌ 为什么没有数据？

先检查容器是否正常运行：

```bash
docker compose ps
```

再查看采集器日志是否有异常：

```bash
docker compose logs -f collector
```

可能的原因：

1. collector 未正常运行
2. `/host/proc/net/dev` 挂载失败
3. 当前监控的网卡没有流量变化

### 🔧 网卡名称填错了怎么办？

可以直接在网页端点击“切换网卡”重新选择，不需要重启。也可以修改 `.env` 中的 `NAS_INTERFACE` 作为首次启动默认值，然后重启：

```bash
docker compose up -d
```

### 📊 为什么统计和路由器不一致？

NAS NetStats 统计的是 NAS **本机可采集网卡** 看到的整体收发字节数。

路由器则按 WAN 口、LAN 口、NAT 转换、协议开销等规则统计，两者统计口径不同，数值存在差异是正常现象。

### 💾 NAS 重启后数据还在吗？

PostgreSQL 数据持久化保存在：

```text
./data/postgres
```

只要不删除该目录，历史数据会保留。重启 NAS 或容器后数据依然存在。

### ⏱️ 如何修改采集间隔？

编辑 `.env` 文件，单位秒：

```env
COLLECT_INTERVAL=5
```

修改后重启服务：

```bash
docker compose up -d
```

---

## 🔒 安全说明

> ⚠️ **NAS NetStats 无用户认证机制，建议仅在内网使用，不要直接暴露到公网。**

如需远程访问，建议通过以下方式：

- **VPN**（推荐）：通过 WireGuard / OpenVPN 接入内网后访问
- **反向代理 + 认证**：使用 Nginx/Caddy + HTTP Basic Auth 或 OAuth Proxy

---

<p align="center">
  <b>NAS NetStats</b> — 轻量级 NAS 流量统计工具<br>
  <sub>Built with ❤️ for NAS enthusiasts</sub>
</p>
