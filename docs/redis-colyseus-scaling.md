# Redis-backed Colyseus Scaling

Project Veil 现在支持通过 `REDIS_URL` 启用 Redis-backed Colyseus presence/driver，以及跨节点共享的匹配队列。

## 本地单进程兼容

不设置 `REDIS_URL` 时，服务端继续使用原有的本地内存实现：

- Colyseus: in-memory presence/driver
- Matchmaking: 进程内队列

这条路径适合本地开发和最小化调试，不需要额外基础设施。

## Docker Compose 启动 Redis

仓库根目录提供了 [`docker-compose.redis.yml`](../docker-compose.redis.yml)：

```bash
docker compose -f docker-compose.redis.yml up -d
```

默认会在本机暴露 `6379` 端口。

## 启动双节点

两个节点只要共享同一个 `REDIS_URL`，就会共享 Colyseus 房间发现与匹配队列：

```bash
REDIS_URL=redis://127.0.0.1:6379/0 PORT=2567 npm run dev -- server
REDIS_URL=redis://127.0.0.1:6379/0 PORT=2568 npm run dev -- server
```

说明：

- Colyseus `presence` / `driver` 会自动切到 Redis 实现
- `/api/matchmaking/*` 会自动切到 Redis-backed 队列
- 不设置 `REDIS_URL` 时不会触发这些 Redis 依赖

## 验证共享匹配

如果本机或环境里已经有 Redis，可直接运行：

```bash
REDIS_URL=redis://127.0.0.1:6379/0 npm run validate -- redis-scaling
```

该脚本会创建两个独立的 matchmaking service 实例，并验证：

- 两个节点共享等待队列
- 两个节点能读取到同一个匹配结果
- 同一个房间 ID 会返回给双方玩家

针对当前 Ranked PvP 匹配烟测，也可以直接跑下面两条定向验证：

```bash
node --import tsx --test apps/server/test/matchmaking-routes.test.ts
npx playwright test tests/e2e/pvp-matchmaking-lifecycle.spec.ts --config=playwright.multiplayer.config.ts
```

## 部署建议

- `REDIS_URL` 指向可被所有游戏节点访问的同一 Redis 实例或集群
- 多节点部署时，保持所有节点的 `REDIS_URL`、MySQL 配置和版本一致
- 如需更严格的持久化/高可用，建议把 Redis 替换为托管 Redis 或带 Sentinel/Cluster 的拓扑
