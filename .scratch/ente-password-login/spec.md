# Spec: ente driver 密码登录配置项（Worker 侧）

## 背景

OpenList（Go）侧新增 ente 密码登录（见 OpenList 仓库同名 change）。Worker 受
Cloudflare 128MB 内存限制无法运行 argon2id（见 `docs/adr/0002-ente-login-externalized-to-apipages.md`），
不实现登录逻辑，只将配置项 schema 与 Go backend 对齐。

## 需求

### R1 配置项对齐

`src/backend/drivers/ente/types.ts` 的 `DriverEnteAddition` 与
`src/backend/server/admin.ts` 的 Ente 表单字段列表新增与 Go `meta.go` 同名同序的：

- `email`（可选）
- `password`（可选）
- `two_fa_secret`（可选，TOTP secret）

`token` / `master_key` 保持现有字段，help 文案与 Go 侧一致地说明两种登录方式。

### R2 密码模式显式拒绝

Worker 驱动 `init()` 检测到 email+password 均非空（密码模式）时，抛出错误：
"password login is not implemented on Worker (memory limit); use APIPages
credentials (token/master_key) or OpenList Go backend"。不静默忽略。

### 非目标

- 任何 SRP / argon2id / sealed box 代码。
- 密码模式的可用性——仅配置项与错误提示。

## 验收

- admin 表单出现三个新字段，保存后配置含新字段。
- 只填 token/master_key（凭证模式）行为不变。
- 填 email+password 时 init 返回上述错误信息。
