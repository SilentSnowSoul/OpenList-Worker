# 01 — 密码模式判定放宽为 token 判定

Status: resolved
Type: task

## 目标

- `src/backend/drivers/ente/driver.ts`:模式判定从 `email && password` 改为按
  `token` 判定——token 非空即凭证模式,email/password/two_fa_secret 仅保留配置,
  不影响运行;token 为空且 email 或 password 任一非空时,`init()` 抛既有
  "password login is not implemented on Worker" 错误。
- `src/backend/server/admin.ts` Ente 表单 help 文案同步:token+password(2fa 可选)
  为合法组合,password 字段说明注明 Worker 不做密码登录、token 失效后请走
  APIPages 或 Go backend。
- 回归测试更新:
  - token+password(无 email)初始化成功且走凭证模式;
  - token+password+two_fa_secret 同上;
  - 仅 email+password(无 token)仍被拒绝;
  - 纯 token+master_key 行为不变。

## 验收

- `npx tsx --test` 全过。
