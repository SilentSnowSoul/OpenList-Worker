# 01: IwaraZip 驱动骨架 + 认证 + List（TS）

**What to build:** 用户填入 endpoint/key1/key2（可选 root_folder_id）挂载 IwaraZip Storage 后，能在 virtual path 下浏览 iwara.zip 账号的文件夹与文件（根或指定 root_folder_id）。token 自动获取、失效重取；_status=error 错误透传。Addition 字段名与 Go 版完全一致。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 驱动以 `IwaraZip` 注册（StorageDriver 接口），Addition：endpoint（默认 https://www.iwara.zip）/key1/key2（必填）/root_folder_id
- [x] key1+key2 → /authorize → access_token + account_id，内存缓存，失效自动重取一次
- [x] list 消费 /folder/listing 的 folders[]+files[]，映射为目录树对象（physical path 即 folder/file id）
- [x] _status=error 检查与透传；429 不重试
- [x] 测试覆盖：token 重取、错误透传、对象映射（mock fetch）
