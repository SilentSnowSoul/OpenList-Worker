## Purpose

Worker 侧 ente 驱动配置项与 Go backend 对齐，密码模式显式拒绝，不做登录实现。

## ADDED Requirements

### Requirement: 配置项与 Go backend 对齐
Worker ente 驱动配置 SHALL 包含 `email`、`password`、`two_fa_secret` 可选字段，命名与顺序与 OpenList Go `drivers/ente/meta.go` 一致；`token`、`master_key` 字段保持不变。

#### Scenario: 表单展示新字段
- **WHEN** 管理员打开 ente 存储编辑表单
- **THEN** 可见并保存 email / password / two_fa_secret 三个新字段

### Requirement: 密码模式显式拒绝
Worker 驱动初始化 SHALL 在 email 与 password 均非空时报错，说明密码登录在 Worker 上未实现（内存限制），并指引使用 APIPages 凭证或 OpenList Go backend；凭证模式行为 SHALL 不变。

#### Scenario: 密码模式被拒绝
- **WHEN** 配置中 email 与 password 均非空并初始化
- **THEN** 返回 "password login is not implemented on Worker" 类错误信息

#### Scenario: 凭证模式不受影响
- **WHEN** 仅配置 token 与 master_key
- **THEN** 行为与变更前一致
