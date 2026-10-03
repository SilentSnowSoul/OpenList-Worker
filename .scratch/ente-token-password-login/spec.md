# Spec: token + password 组合准入

上游 OpenList Go ente 驱动放宽密码模式准入:`token + password`(2fa 可选)是合法
配置——token 走快速路径,失效才回退 SRP 密码登录。Worker 侧对齐:token 非空时
一律按凭证模式工作,email/password/two_fa_secret 仅作为配置保留;只有 token 为空
的纯密码模式(email 或 password 任一非空)才显式拒绝。
