# Ente 登录外置到 OpenList-APIPages,驱动只收长期凭证

ente 密码登录需 argon2id 派生 KEK,内存参数由服务端在账号注册时写死为 256MB 或 1GB(更新密钥亦强制 ≥128MB),超过 CF Workers 128MB 内存硬上限,Worker 内用户名密码登录不可行;passkey 登录还必须完成浏览器 WebAuthn 仪式。

因此本仓库 `ente` 驱动配置只接受 `token` + `master_key`(+可选 `secret_key`,用于共享相册),SRP/argon2/TOTP/passkey 登录页属 OpenList-APIPages(浏览器端 KDF 或 Docker 模式)的后续工作。token 无 TTL、365 天未使用才过期,driver 定期使用即保活;失效后重跑登录页换新。

## 2026-10 补充:Go backend 已支持密码登录

OpenList(Go)侧 ente 驱动现已实现密码登录(`email` + `password`,可选 `two_fa_secret`
自动 TOTP),并支持 `token + password`(2fa 可选)组合:token 走快速路径,失效才
回退 SRP。Worker 受同一 128MB 内存限制,不引入 SRP/argon2id,仅做两件事:

- 配置项 schema 与 Go `drivers/ente/meta.go` 对齐(`email` / `password` /
  `two_fa_secret` 为可选字段),从 Go 侧迁移过来的配置不至于丢字段。
- 驱动按 `token` 判定模式:token 非空一律按凭证模式工作,密码字段仅保留配置;
  仅当 token 为空且 email 或 password 任一非空时,`init()` 显式报错指引:
  "password login is not implemented on Worker (memory limit); use APIPages
  credentials (token/master_key) or OpenList Go backend"。

即 Worker 只支持 token/master_key 凭证模式;纯密码模式请用 APIPages 登录页或
OpenList Go backend。

