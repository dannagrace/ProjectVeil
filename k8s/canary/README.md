# Canary Rollout Baseline

这组清单提供一份最小可 review 的生产灰度基线：

- `project-veil-server-stable`
- `project-veil-server-canary`
- `project-veil-server-stable` / `project-veil-server-canary` services
- `project-veil-server-canary` ingress，使用 NGINX canary weight

默认权重是 `10%`，实际演练时可以通过：

```bash
kubectl annotate ingress project-veil-server-canary \
  nginx.ingress.kubernetes.io/canary-weight=10 \
  --overwrite \
  -n project-veil
```

配合 `npm run release:production:rollback-drill` 使用时：

1. 先 `kubectl apply -k k8s/canary`
2. 再把 canary deployment pin 到目标 image tag
3. 切入少量流量
4. smoke 失败后执行 `kubectl rollout undo deployment/project-veil-server-canary -n project-veil`
