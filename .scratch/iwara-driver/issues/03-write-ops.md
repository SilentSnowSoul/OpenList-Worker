# 03: 写操作（TS）

**What to build:** 用户可在 IwaraZip 挂载内新建文件夹、移动/重命名/复制/删除文件与文件夹，结果立即反映在列表中。

**Blocked by:** 01: IwaraZip 驱动骨架 + 认证 + List（TS）

**Status:** resolved

- [x] mkdir/remove/move/rename/copy 对应 /folder/create、/file|/folder 的 delete/move/edit、/file/copy
- [x] 测试覆盖各操作 API 参数组装
