# 02 — ADR 0002 补充说明更新

Status: resolved
Type: task
Blocked by: 01

## 目标

`docs/adr/0002-ente-login-externalized-to-apipages.md`「2026-10 补充」一节更新:
上游 Go 已支持 `token + password`(2fa 可选)组合(token 快速路径,失效回退 SRP);
Worker 侧 token 非空即凭证模式运行,密码字段仅保留配置,token 失效后指引
APIPages 或 Go backend,Worker 仍不做 SRP/argon2id。

## 验收

- ADR 表述与本 change 语义一致,无「email+password 才算密码模式」的旧说法。
