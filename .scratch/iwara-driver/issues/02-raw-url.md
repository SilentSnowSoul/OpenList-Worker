# 02: Raw URL 直链解析（TS）

**What to build:** 用户请求 IwaraZip 挂载内文件的 Raw URL 时，驱动经 /file/download 解析签名 URL 返回，供 302 转发。驱动不登记为 Forced proxy。

**Blocked by:** 01: IwaraZip 驱动骨架 + 认证 + List（TS）

**Status:** resolved

- [x] 两步解析：file id → /file/download → 签名 URL
- [x] 签名 URL 不缓存
- [x] 测试覆盖两步解析与失败透传
