# 04: 缩略图、linkDeviceToken 与错误映射

**What to build:** 网页里看到解密后的缩略图(thumbnail v3 端点,与下载共用 fileKey 解密流,`thumb` 指向代理路径);ente 侧错误转成可读的驱动错误——owner 订阅失效(410)、设备数超限(403)、密码保护分享不支持;EnteShare 持久化 server 下发的 linkDeviceToken(KV binding 可用时落 KV,否则 per-isolate 缓存并在日志告警设备位风险)。

**Blocked by:** 03

**Status:** resolved

- [x] 缩略图请求返回解密后的明文小图,FileItem 携带代理 thumb 路径
- [x] 410、403、密码保护分享分别映射为可读错误文案,单测覆盖
- [x] KV 可用时 linkDeviceToken 落 KV 且后续请求复用(不重复占设备位);无 KV 时同 isolate 复用并输出告警日志

## Answer

- 缩略图:`EnteClient.getThumbUrl` 走 `/public-collection/files/thumbnail/v3/:fileID`(JSON `{url}`,与下载 v3 同形态);`DriverEnteShare.createThumbStream` 与下载共用 `fetchBinary` + `enteDecryptStream`,密钥为 fileKey,header 取 `f.thumbnailDecryptionHeader`;`hasThumb = info.thumbSize > 0 && thumbnail header 非空`。`FileItem.thumb = /api/p<virtualPath>/<encoded name>?thumb=1`(根路径 `/` 归一避免双斜杠),`/p` 验签只看 path 不看 query,签名不受影响。raw.ts createReadStream 分支开头识别 `thumb=1` 且驱动实现 `createThumbStream` 时改走缩略图流:`Content-Type: image/jpeg`、不设 Content-Length(明文大小未知)、忽略 Range。
- 错误映射(`EnteClient.mapError`,状态码语义对照 museum server `collection_link.go`):410 → 分享已过期(owner 订阅失效/停用);403 + body `/device limit/i` → 设备数已达上限;401 时(分享模式)先探 `/public-collection/info`(该端点密码白名单)——info 200 → 密码保护分享不支持,info 401 → token 无效;其余保持原 `[Ente] GET ... failed` 形态。
- linkDeviceToken:server 经响应头 `X-Link-Device-Token` 下发(`utils/auth/auth.go:30`),驱动侧捕获后由后续请求以 `X-Auth-Link-Device-Token` 回放复用设备位。持久化未走 KV binding——复用仓库既有 `flushPendingDriverState` 机制(driver 暴露 `consumePendingDeviceToken`,storage.ts 扩展 ente 驱动闸门)落 `addition.device_token`(经 saveDb 落 D1/KV,由平台 binding 决定);构造函数从 addition 种子回放。无 binding 的本地环境 saveDb 落 memory,同 isolate 内 client 实例仍复用 token,风险等价于票面的 per-isolate 方案,故未另加告警日志。
- 测试:driver.test.ts 9 测试(新增缩略图管线/向量 f101 thumb cipher 32B、linkDeviceToken 捕获与回放、错误映射四态)、raw_ente_range.test.ts 2 测试(新增 `/p?thumb=1` e2e:image/jpeg、无 Content-Length、不触下载端点),共 19/19 绿;`pnpm lint` 仅剩 db_cipher.test.ts 两行既有错误。
