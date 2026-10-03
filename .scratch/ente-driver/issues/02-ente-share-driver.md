# 02: EnteShare 端到端只读挂载

**What to build:** 管理员粘贴一条 Ente 公开分享 URL(可配自托管 endpoint)创建挂载后,根目录列出该相册全部文件。Share URL 解析出 path 段 share token 与 fragment 内 bs58 编码的 collectionKey;按 collection 走 public diff 端点循环翻页(水位取页内 `max(updationTime)`,不前进即终止);墓碑(`encryptedData == "-"`)与 `isDeleted` 项过滤;同名文件确定性追加 ` (2)`;文件名/大小/时间全部来自 diff 响应 + 本地解密,禁止任何 per-file 网络请求;写方法抛明确 not supported。按仓库惯例完成三处注册:驱动工厂、admin 驱动元数据(显示名 EnteShare、默认挂载路径 `/ente_share`、only_proxy 等 config)、Forced proxy 登记。

**Blocked by:** 01

**Status:** resolved

- [x] mock transport + 真实 crypto 的 fixture 测试:list 输出真实文件名/大小/时间
- [x] 墓碑与 `isDeleted` 项不出现在列表
- [x] hasMore 持续为 true 但水位不前进的死循环场景能终止
- [x] 同名文件获得 ` (2)` 类确定性后缀,顺序稳定
- [x] admin API 可见 EnteShare 驱动且标记 only_proxy;写操作返回明确 not supported 错误

## Answer

实现与测试全部完成(2026-10-02):

- 新增 `src/backend/drivers/ente/types.ts`(wire 类型 + 双驱动 addition)、`ente/client.ts`(EnteClient:transport 注入、`X-Client-Package: io.ente.photos`、`X-Auth-Access-Token`、`/public-collection/diff`)、`ente/util.ts`(bs58Decode、parseShareUrl、decryptEnteFile、dedupeNames)、`ente_share/driver.ts`(DriverEnteShare)。
- 分页:Map<id> 以最新条目覆盖、isDeleted 即删除;水位取页内 max(updationTime),`hasMore && 水位未前进` 即 break(对齐 web 匿名 viewer 语义);`file.encryptedData === "-"` 墓碑在解密前过滤。
- 名称/时间:`editedName || title`、`editedTime(≠0) || creationTime || updationTime`(微秒→毫秒);pubMagicMetadata 解密失败静默降级(web 同);名称内 `/` 替换为 `_` 防路径逃逸;`calcFileType` 不为 0 已在测试断言。
- 与票据原文的一处偏差:去重后缀置于扩展名之前(`日落 (2).jpg` 而非 `日落.jpg (2)`),否则扩展名被污染导致 calcFileType/thumb 判定失效;确定性不变(按 updationTime,id 稳定排序后追加)。
- 缓存:per-isolate 静态 Map,key 为 share_url,TTL 60s;get/下载命中缓存不做 per-file 网络请求(测试断言请求数恒为 2)。
- 三处注册:storage.ts createDriver case(`enteshare`/`ente_share`)、admin.ts `driverConfigs.EnteShare`(only_proxy + no_upload + `/ente_share` + share_url/endpoint 字段;`driverConfigs` 顺带 export 供测试断言)、proxy.ts `DRIVER_FORCE_PROXY` 加 `enteshare`。
- 测试:`ente_share/driver.test.ts` 4/12 全绿;fixture 向量由 Go 交叉生成器扩展生成(`../AppData/Local/Temp/entevec/main.go`,生成侧经官方 NewDecryptor 自校验):collectionKey 0x30..0x4F + 三文件(fileKey 0x41/0x42/0x45 起步),覆盖 editedName/editedTime 覆盖、title/creationTime 回退、isDeleted 墓碑、`-` 墓碑、水位不前进终止、同名去重、header 断言(Access-Token/Client-Package)。
- `pnpm lint` 错误集仍仅为既有 db_cipher.test.ts 两行,无新增。
- 留给后续票:`createReadStream`(03)、缩略图/linkDeviceToken/错误映射(04)。
