# drivers/ente-config Specification

## Purpose
Worker 侧 ente 驱动配置项与 Go backend 对齐，密码模式显式拒绝，不做登录实现。

## Requirements

### Requirement: 配置项与 Go backend 对齐
Worker ente 驱动配置 SHALL 包含 `email`、`password`、`two_fa_secret` 可选字段，命名与顺序与 OpenList Go `drivers/ente/meta.go` 一致；`token`、`master_key` 字段保持不变。

#### Scenario: 表单展示新字段
- **WHEN** 管理员打开 ente 存储编辑表单
- **THEN** 可见并保存 email / password / two_fa_secret 三个新字段

### Requirement: 密码模式显式拒绝
Worker 驱动 SHALL 按 `token` 判定模式:token 非空时一律按凭证模式工作,
email / password / two_fa_secret 仅作为配置保留,不做登录,行为与纯凭证模式
一致(对齐上游 Go 的 `token + password`(2fa 可选)合法组合)。仅当 token 为空
且 email 或 password 任一非空时,驱动初始化 SHALL 报错,说明密码登录在 Worker
上未实现(内存限制),并指引使用 APIPages 凭证或 OpenList Go backend。

#### Scenario: token + password 组合按凭证模式工作
- **WHEN** 配置含 token 与 password(可含 two_fa_secret,无 email)并初始化
- **THEN** 初始化成功,列表与文件访问行为与仅 token + master_key 时一致

#### Scenario: token + password 组合按凭证模式工作
- **WHEN** 配置含 token 与 password(可含 two_fa_secret,无 email)并初始化
- **THEN** 初始化成功,列表与文件访问行为与仅 token + master_key 时一致

#### Scenario: 密码模式被拒绝
- **WHEN** token 为空且 email 或 password 任一非空并初始化
- **THEN** 返回 "password login is not implemented on Worker" 类错误信息

#### Scenario: 凭证模式不受影响
- **WHEN** 仅配置 token 与 master_key
- **THEN** 行为与变更前一致
