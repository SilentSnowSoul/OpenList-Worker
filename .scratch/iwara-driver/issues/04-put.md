# 04: 上传（TS）

**What to build:** 用户经 OpenList-Worker 向 IwaraZip 挂载上传文件，成功后 list 可见；失败原始错误透传。

**Blocked by:** 01: IwaraZip 驱动骨架 + 认证 + List（TS）

**Status:** resolved

- [x] /file/upload multipart 整文件
- [x] 测试覆盖 multipart 组装与错误透传
