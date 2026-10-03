# 01 — 配置项 schema 对齐与密码模式拒绝

Status: resolved
Type: task

## 目标

- `src/backend/drivers/ente/types.ts` `DriverEnteAddition` 新增 `email` / `password` /
  `two_fa_secret`（可选），与 OpenList Go `drivers/ente/meta.go` 同名同序。
- `src/backend/server/admin.ts`（约 :4294-4340）Ente 表单字段列表同步新增三项，
  help 文案与 Go 侧一致。
- 驱动 `init()`：email+password 均非空时抛
  "password login is not implemented on Worker (memory limit); use APIPages
  credentials (token/master_key) or OpenList Go backend"。只填凭证模式字段行为不变。

## 验收

- admin 表单显示新字段，保存后配置含新字段。
- 密码模式 init 报上述错误；凭证模式不受影响。
- 相关既有测试（proxy / admin 字段快照类）更新通过。

## Answer

- `types.ts` `DriverEnteAddition` fields order aligned with Go: `endpoint`, `email`, `password`,
  `two_fa_secret`, `token`, `master_key`, `secret_key`, `show_hidden`.
- `admin.ts` Ente form follows the same order; password mode can leave token/master_key empty,
  and the credential-mode help text identifies token + master_key.
- `driver.ts` 新增 `init()`:email+password 均非空时抛
  "password login is not implemented on Worker (memory limit); use APIPages
  credentials (token/master_key) or OpenList Go backend";仅凭证模式行为不变。
- 新增回归测试 密码模式显式拒绝 + admin 表单字段断言,`npx tsx --test` 全过(26/26)。
