# 05: Ente 账号驱动

**What to build:** 管理员用 `token` + `master_key`(+可选 `secret_key`、`show_hidden`,可配自托管 endpoint)创建账号级挂载:根目录每个 collection 一文件夹;masterKey → collectionKey → fileKey 层级解密;共享相册的 collectionKey 经 sealed box 送达,有 `secret_key` 时解出、缺省时跳过该相册并告警;隐藏相册(私有 magic metadata `visibility == 2`)默认排除,`show_hidden: true` 时展示;列表调用本身即 token 保活(token 365 天未使用才过期)。文件名/时间规则与 EnteShare 一致(`editedName || title`、`editedTime || creationTime` 微秒转 ISO)。

**Blocked by:** 04

**Status:** resolved

- [x] fixture 测试:两个相册各含若干文件,层级/名称/大小/时间正确
- [x] 隐藏相册默认不出现,`show_hidden: true` 时出现
- [x] 无 `secret_key` 时共享相册被跳过且有告警日志;有 `secret_key` 时其文件可列出
- [x] admin 可见 Ente 驱动(默认挂载路径 `/ente`);下载/缩略图复用既有解密管线

## Answer

实现与测试完成(2026-10-03):

- `ente/driver.ts` `DriverEnte`:`/collections/v2?sinceTime=0` 拉相册,`decryptEnteCollection`(util.ts)按 `keyDecryptionNonce` 有无分流 masterKey secretbox / sealed box(+secret_key,缺省 throw → fetchAlbums 捕获并 `console.warn("[Ente] skip collection <id>")` 跳过);隐藏判定解私有 `magicMetadata` 的 `visibility == 2`。
- 相册分页复用 EnteShare 语义:`/collections/v2/diff?collectionID&sinceTime`,Map 覆盖、isDeleted 删除、`-` 墓碑过滤、水位不前进终止;文件复用 `decryptEnteFile`/`dedupeNames`,下载/缩略图走 `files/download|thumbnail/v3/:id` + `enteDecryptStream`。
- 修复三处:(1) albumsCache 键由 token 扩为 `token|secret_key` 且缓存未过滤相册、hidden 按实例过滤——否则同 token 不同凭证配置互相污染缓存;(2) `DRIVER_FORCE_PROXY` 补 `"ente"`;(3) 测试期望的 µs→ms 换算曾算错(向量末位 2 是 2µs 非 2ms),生成器 F202 creationTime 改为 `1728000000002000`(→ `.002Z`)使转换可被真正检验;名称顺序断言改集合比较(依赖 ICU localeCompare)。
- 测试:`ente/driver.test.ts` 4 测试(根目录/隐藏/共享相册三态、相册内文件层级+墓碑+水位、get/createReadStream/createThumbStream 端到端、三处注册);向量由 Go 生成器(`%TEMP%/entevec/main.go`)扩展。ente 全家 23/23 绿,`tsc --noEmit` 无新增错误。
