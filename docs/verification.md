# 验证说明

## Deploy

```bash
docker compose up -d --build
docker compose ps
```

预期：`frontend`、`backend`、`collector`、`postgres` 均处于运行状态。

## Frontend

访问：

```text
http://localhost:8088
http://localhost:8088/history
```

预期：首页和历史统计页面可以正常打开。

## Backend

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/db/status
```

预期：健康检查正常，数据库状态为 `connected`。

## Collector

```bash
docker compose logs collector
```

预期：日志中持续出现指定网卡的 `download_speed=... bytes/s` 和 `upload_speed=... bytes/s`，且没有连接 `http://backend:8000` 的日志。

## PostgreSQL

数据持久化目录：

```text
./data/postgres
```

确认数据写入：

```bash
docker compose exec postgres psql -U nasnetstats -d nasnetstats -c "select interface_name, rx_bytes, tx_bytes, download_speed, upload_speed, created_at from traffic_records order by created_at desc limit 5;"
```
