# 02 — ADR 0002 补充说明

Status: resolved
Type: task
Blocked by: 01

## 目标

在 `docs/adr/0002-ente-login-externalized-to-apipages.md` 追加注记：Go backend 已支持
密码登录，Worker 侧仅保留配置项对齐与显式拒绝，不做登录实现（内存限制不变）。

## 验收

- ADR 更新，说明 Worker 拒绝密码模式时的指引（APIPages 或 Go backend）。

## Answer

`docs/adr/0002-ente-login-externalized-to-apipages.md` 追加「2026-10 补充:Go backend
已支持密码登录」一节:Worker 仅保留配置项对齐与 init 显式拒绝(内存限制不变),
密码模式指引走 APIPages 凭证(token/master_key)或 OpenList Go backend。
