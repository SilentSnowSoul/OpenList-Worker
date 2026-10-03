# Ente 调研笔记(供 OpenList-Worker 新增 ente storage driver 参考)

> 调研产出目录:`.scratch/ente-driver/research/`。
> 所有引用均来自本仓库内的 ente 完整克隆(`ente/`),格式为 `ente/<path>:<line>`。未在克隆中找到的概念已明确标注。正文遵循仓库惯例使用中文,技术名词保留英文。

---

## 1. Architecture & API surface

**结论**:整个后端是一个 Go 单体服务 **museum**(生产环境即 `api.ente.com`),没有名为 "castor" 的服务(克隆内 grep 无结果);billing、cast(电视投屏)、public-collection、file-link、public-memory 都是 museum 内的 route group,而非独立服务。路由全部注册在 `ente/server/cmd/museum/main.go`(gin),handler 在 `ente/server/pkg/api/`,业务在 `ente/server/pkg/controller/`。

证据:

- 服务命名与定位:`ente/server/README.md:3-5`("API server for ente.com",Photos 与 Auth 共用同一 server)。
- 路由 group 定义(`ente/server/cmd/museum/main.go`):
  - `publicAPI` = `"/"`(无限定):main.go:544-545
  - `privateAPI` = `"/"` + `TokenAuthMiddleware`:main.go:547-548
  - `storageAPI` = privateAPI + `RejectAuthApp()`(拒绝 Ente-Auth app token 的存储类接口):main.go:549-550,实现见 `ente/server/pkg/middleware/auth.go:111-123`
  - `adminAPI` = `"/admin"`:main.go:552-553
  - `publicCollectionAPI` = `"/public-collection"`(匿名分享相册):main.go:561-565
  - `fileLinkApi` = `"/file-link"`(匿名单文件分享):main.go:566-570
  - `publicMemoryAPI` = `"/public-memory"`:main.go:572-576
  - `castAPI` = `"/cast"`(TV):main.go:846-850
- 只读客户端会用到的具体端点(均挂在上述 group 下,main.go):
  - 登录相关(public):`GET /users/srp/attributes`(main.go:712)、`POST /users/srp/create-session`(main.go:714)、`POST /users/srp/verify-session`(main.go:713)、`POST /users/ott`(main.go:693)、`POST /users/verify-email`(main.go:694)、`POST /users/two-factor/verify`(main.go:695)
  - collections(storageAPI):`GET /collections/v2`(main.go:758)、`GET /collections/v3`(带 limit,main.go:759)、`GET /collections/:collectionID`(main.go:755)、**`GET /collections/v2/diff`(按 collection+sinceTime 增量拉文件,main.go:776)**、`GET /collections/file`(main.go:777)
  - files(storageAPI):**`GET /files/download/v3/:fileID`(返回 JSON `{url}`,main.go:617)**、`GET /files/download/v2/:fileID`(main.go:616)、`GET /files/thumbnail/v3/:fileID`(main.go:620)、`GET /files/preview/:fileID`(307 重定向,main.go:618)、`POST /files/info`(main.go:644)、`GET /files/count`(public,main.go:649)
  - 回收站:`GET /trash/v2/diff`(main.go:657),响应 `{diff, hasMore}`(`ente/server/pkg/api/trash.go:19-33`)
  - 公开分享:`GET /public-collection/info`(main.go:807)、`GET /public-collection/diff`(main.go:806)、`GET /public-collection/files/download/v3/:fileID`(main.go:803)、`GET /public-collection/files/thumbnail/v3/:fileID`(main.go:801)、`POST /public-collection/verify-password`(main.go:811);单文件链接:`GET /file-link/info`(main.go:792)、`GET /file-link/file/v3`(main.go:797)、`GET /file-link/thumbnail/v3`(main.go:795)、`POST /file-link/verify-password`(main.go:798)

## 2. Auth model

**结论**:登录是两步式 —— password 用户走 **SRP-4096**(argon2id 先派生 KEK,再由 KEK 派生 16 字节 loginKey 作为 SRP 的 "password");email-MFA 或无 SRP 记录的用户走 email OTP;之后可能再叠加 TOTP/passkey。登录成功后拿到 `token` + `keyAttributes` + `encryptedToken`。**driver 可长期保存的凭证是:app token(放在 `X-Auth-Token` header)+ 已解密的 masterKey/secretKey/publicKey**;token 无固定 TTL,仅"365 天未使用才过期",所以只要 driver 定期使用即可视为长期有效。

证据:

- CLI 登录入口 `ente account add`:`ente/cli/pkg/account.go:38-53`(GET srp/attributes 返回 404 或 `IsEmailMFAEnabled` → 走 `validateEmail` OTP;否则 `signInViaPassword`),TOTM/passkey 补验 account.go:57-63。
- SRP 流程(`ente/cli/pkg/sign_in.go:17-50`):
  1. `DeriveArgonKey(password, kekSalt, memLimit, opsLimit)` 得 KEK(sign_in.go:24;argon2id 实现见 `ente/cli/internal/crypto/crypto.go:34-47`,`argon2.IDKey`);
  2. `DeriveLoginKey(keyEncKey)` — blake2b keyed subkey("loginctx", id=1)取前 16 字节(crypto.go:49-52, 54-75);
  3. `srp.GetParams(4096)` + `kong/go-srp` 客户端,`CreateSRPSession`(POST /users/srp/create-session)→ `VerifySRPSession`(POST /users/srp/verify-session)(sign_in.go:31-48;HTTP 封装 `ente/cli/internal/api/login.go:30-55, 57-84`)。
- 响应结构 `AuthorizationResponse`:`token`、`keyAttributes`、`encryptedToken`(sealed box 加密的 token)、可选 `twoFactorSessionID`/`passkeySessionID`(`ente/cli/internal/api/login_type.go:35-45`)。注意:**如果用户开了 passkey/TOTP,server 返回的 token 为空,需二次验证后才发 token**(login_type.go:60-65;sign_in.go:120-136)。
- app token vs account token:token 按 app(photos/auth/locker,`ente/server/ente/app.go:6-8`)签发;storage 端点拒绝 auth app 的 token(`ente/server/pkg/middleware/auth.go:111-123`);`GET /users/accounts-token` 可换取 ACCOUNTS scope 的 JWT 用于 passkeys 端点(main.go:723, 736-737)。
- 请求携带方式:header `X-Auth-Token` 或 query `token`(`ente/server/pkg/utils/auth/`(grep 得 GetToken 99-105);CLI 常量 `TokenHeader = "X-Auth-Token"` `ente/cli/internal/api/client.go:12`,注入逻辑 client.go:88-99)。CLI 还强制发 `X-Client-Package`(如 `io.ente.photos`,`ente/cli/internal/api/enums.go:25-35`;server 端 `GetApp` 据此判定 app,`ente/server/pkg/utils/auth/` 78-88)。
- token 校验与过期:server 按 `sha256(token)` 查 `tokens` 表,`last_used_at` 距今超过 **365 天**视为 expired(`ente/server/pkg/repo/userauth.go:281-291`;session 缓存 `ente/server/pkg/controller/authsession/controller.go:16-35`)。没有 refresh-token 机制 —— 失效就重新登录;登出/吊销 `DELETE /users/session`(main.go:729)。每次请求会异步更新 `last_used_at`(middleware/auth.go:59-67),因此"定期使用即续命"。
- CLI 本地持久化形态(可参考的凭证存储方式):masterKey/secretKey/token 用 32 字节 deviceKey(OS keychain)以 XChaCha20-Poly1305 secretstream 加密后存 bolt(`ente/cli/pkg/account.go:83-107`;`ente/cli/pkg/model/enc_string.go:9-31`;`ente/cli/pkg/secrets/key_holder.go:13-29`)。解密后的内存形态 `AccSecretInfo{MasterKey, SecretKey, Token, PublicKey}`(`ente/cli/pkg/model/account.go:34-42`)。

## 3. E2EE key hierarchy

**结论**:层级为 `password →(argon2id)→ KEK →(secretbox 解开)→ masterKey`;`masterKey →(secretbox)→ 每个 collection 的 collectionKey`;共享相册的 collectionKey 用 Curve25519 sealed box 送来(需 secretKey);`collectionKey →(secretbox)→ fileKey`;`fileKey` 解密 file metadata(title/时间等)、magic metadata 以及文件本体(XChaCha20-Poly1305 secretstream)。**server 上一切"内容类"字段都是密文:collection 名、file metadata、文件字节、缩略图字节;明文的只有 ID、ownerID、updationTime、fileSize(info)**。只读列目录的客户端必须解开:collection 名(collectionKey)、fileKey(collectionKey)、file metadata 的 title/creationTime/modificationTime(fileKey)。

证据:

- 官方架构说明:masterKey 注册时生成、KEK 由密码派生、encryptedMasterKey 存 server(`ente/architecture/README.md:21-31, 33-49`)。
- KEK:argon2id(password, kekSalt, opsLimit, memLimit) — Go `argon2.IDKey`(`ente/cli/internal/crypto/crypto.go:34-47`);web 为 `sodium.crypto_pwhash(..., ALG_ARGON2ID13)`(`ente/web/packages/base/crypto/libsodium.ts:349-366`)。
- masterKey = `SecretBoxOpen(keyAttributes.encryptedKey, keyDecryptionNonce, KEK)`(`ente/cli/pkg/sign_in.go:80-82`);secretKey = `SecretBoxOpen(encryptedSecretKey, …, masterKey)`(sign_in.go:92-96);app token = `SealedBoxOpen(encryptedToken, publicKey, secretKey)`(sign_in.go:101-105)。
- SecretBox = libsodium `crypto_secretbox`(XSalsa20-Poly1305,24B nonce/32B key):Go `secretbox.Open`(`ente/cli/internal/crypto/crypto_native.go:61-77`);web `sodium.crypto_secretbox_open_easy`(`ente/web/packages/base/crypto/libsodium.ts:194-206`)。
- collectionKey:自己的相册用 masterKey secretbox 解;别人共享的用 sealed box(ephemeral Curve25519 + own keypair)解(`ente/cli/pkg/secrets/key_holder.go:49-68`;`crypto_native.go:79-96`)。
- collection 名:secretbox(collectionKey)(`ente/cli/pkg/mapper/photo.go:31-40`)。
- fileKey:secretbox(file.encryptedKey, keyDecryptionNonce, collectionKey)(`ente/cli/pkg/mapper/photo.go:80-86`;web 版 `ente/web/apps/share/src/services/collection-share.ts:142-148`)。
- file metadata(title、creationTime、modificationTime、lat/lon 等 JSON):XChaCha20-Poly1305 **secretstream** 单块解密(fileKey)(`ente/cli/pkg/mapper/photo.go:100-109`;secretstream 的 Go 实现 `ente/cli/internal/crypto/stream.go:10-22`(XChaCha nonce 24B)与 `crypto.go:77-92`;web `libsodium.ts:213-228`)。字段定义:`ente/web/packages/media/file-metadata.ts:13-15`。
- magic metadata(私有/公有,含 visibility、editedName 等)同样用 fileKey secretstream 解密(mapper/photo.go:110-129)。
- 文件字节与缩略图字节:fileKey + secretstream 分块流式解密(`ente/cli/internal/crypto/crypto_native.go:98-151`,4MB buffer `crypto.go:17`;web `libsodium.ts:238-296`)。
- server 端存的就是这些密文字段:`ente.File{EncryptedKey, KeyDecryptionNonce, File{EncryptedData,DecryptionHeader}, Thumbnail{…}, Metadata{…}, MagicMetadata, PubicMagicMetadata, Info{FileSize,ThumbnailSize}, UpdationTime}`(`ente/server/ente/file.go:10-30`;CLI 侧同构 `ente/cli/internal/api/file_type.go:3-27`)。`Info.fileSize`、ID、时间戳是明文 —— **列表页可以不解密就拿到大小/时间,但拿不到真实文件名**。

## 4. Decryption feasibility on CF Workers

**结论**:登录(password→KEK)是唯一需要 argon2 的步骤,且其产物(masterKey/secretKey/token)可像 CLI 一样一次性导出、永久保存 —— Worker 内**不需要 argon2**。Worker 里需要的原语是:①XSalsa20-Poly1305 secretbox(解 collectionKey/fileKey/collection 名);②XChaCha20-Poly1305 secretstream(解 file metadata 与文件字节);③(仅共享相册)Curve25519 sealed-box open。WebCrypto 不提供 ①③;本仓库 `pnpm-lock.yaml` 里已有 `tweetnacl@0.14.5`,但只是 `bcrypt-pbkdf` 的传递依赖,不是直接依赖 —— 需要显式引入 tweetnacl(secretbox/box 都有,sealed box 可用 `nacl.box.open` + 临时公钥手动实现)。secretstream 则需要自行实现或引入 libsodium 系库;本仓库已有纯 JS 的 RFC 8439 ChaCha20-Poly1305(仅作静态加密,nonce 12B),与 ente 的 XChaCha20(24B nonce + HChaCha20)secretstream 不通用,不能直接复用。

证据:

- argon2 只在登录出现:`DeriveArgonKey` 仅被 `signInViaPassword`/`decryptAccSecretInfo` 调用(`ente/cli/pkg/sign_in.go:24, 70-71`);之后 CLI 全程只用已解密 keys(key_holder.go:31-42)。web 端 `deriveKey` 也只用于登录与密码验证场景(`libsodium.ts:349-366`)。
- 需要的对称原语清单(见第 3 节引用):secretbox(XSalsa20-Poly1305,crypto_native.go:61-77)、secretstream XChaCha20-Poly1305(stream.go:10-22;libsodium.ts:213-296)。
- web 官方实现用的是 WASM 的 `libsodium-wrappers-sumo@0.7.15`(`ente/web/packages/base/package.json:18`;`libsodium.ts:2-3`),在 CF Workers 中可用但体积/WASM 冷启动成本需评估。
- 本仓库依赖情况:`pnpm-lock.yaml:3990` `tweetnacl@0.14.5`,唯一引用者是 `bcrypt-pbkdf@1.0.2`(`pnpm-lock.yaml:6393-6395`);根 `package.json` 无直接 tweetnacl/libsodium 依赖(grep 无结果)。本仓库自带的 `chacha20-poly1305` 是 at-rest 静态加密用的 RFC 8439 实现(`package.json`:CIPHERS 描述),非 secretstream。
- 结论性提示:tweetnacl 的 `secretbox`/`box.open` 与 ente 的 secretbox/共享相册解密完全兼容(同一套 libsodium 原语);secretstream 需要 HChaCha20 + ChaCha20-Poly1305 分块逻辑(Go 参考实现就在 `ente/cli/internal/crypto/stream.go`,可移植为 TS)。

## 5. Public shares

**结论**:可以**零账号凭证**挂载公开分享。分享 URL 形如 `https://share.ente.io/c/<token>#<bs58(collectionKey)>`:token 在**路径**里,collection key 在 **URL fragment** 里(不发给 server);客户端用 token 作 `X-Auth-Access-Token`(或 `?accessToken=`)访问 `/public-collection/*` 系列端点,再用 fragment 里的 key 本地解密。Worker 只需持有"完整分享 URL"即可列出并解密整个相册(含下载文件字节),唯一额外加密需求是第 4 节的 ①② 原语;**密码保护的相册/新式单文件链接需要 argon2**(verify-password / 12 字符 secret 派生),应视为不支持或需离线预派生。注意:链接依赖 owner 的有效订阅,owner 停订即 410 Gone;还有设备数限制。

证据:

- URL 解析:token 取自路径 `/c/<token>`(`ente/web/apps/share/src/hooks/use-collection-share.ts:23-29, 239-251`);key 取自 `url.hash`,`bs58.decode` → base64 key(`ente/web/packages/gallery/services/share.ts:15-18`;生成侧 `appendCollectionKeyToShareURL` share.ts:4-13)。
- 访问凭证:仅 `accessToken`(即路径里的 token),放 header `X-Auth-Access-Token` 或 query `accessToken`(`ente/server/pkg/utils/auth/`(grep 得 GetAccessToken 107-113));server 中间件校验 token→collection、owner 订阅、有效期、密码、设备数(`ente/server/pkg/middleware/collection_link.go:51-172`;owner 无有效订阅 → 410,collection_link.go:83-88)。
- 列表与解密(官方匿名 viewer 的完整流程):`/public-collection/info` 拿加密 collection → `decryptRemoteCollection(collectionKey)`(`ente/web/apps/share/src/services/collection-share.ts:288-316`;解密函数 `ente/web/packages/media/collection.ts:132-152`);`/public-collection/diff` 循环分页(sinceTime+hasMore)拉全部文件(collection-share.ts:225-262);每个文件 `decryptBox(encryptedKey, collectionKey)` 得 fileKey、再 `decryptMetadataJSON` 得 title/size/时间(collection-share.ts:138-223)。下载:`fetchPublicCollectionFile` + 流式解密(collection-share.ts:338-360)。
- 单文件链接 `/file-link/*`:token 也是 `X-Auth-Access-Token`(`ente/web/packages/base/file-download.ts:143-153`);key 同样在 fragment,但有三种形态:12 字符 base62 secret(**需 server 提供的 kdfNonce/opsLimit/memLimit 做 argon2 派生**)、legacy base58 raw key、hex raw key(`ente/web/apps/share/src/services/file-share.ts:29-52`);secret 形态的派生与解包见 file-share.ts:230-263(`deriveKey` = argon2)。
- 密码保护相册:客户端本地 `deriveKey(password, nonce, ops, mem)`(argon2)后 POST passHash 到 `/public-collection/verify-password` 换 accessTokenJWT(collection-share.ts:264-286);server 端 handler `ente/server/pkg/api/public_collection.go:199-211`。
- `/public-collection/files/download/v3/:fileID` 返回 JSON `{url}`(同 v3 语义,`ente/server/pkg/api/public_collection.go:240-251` + controller `GetPublicOrCastFileURL` `ente/server/pkg/controller/file.go:443-445`)。

## 6. Data model

**结论**:核心实体是 Collection(album)与 File(photo)。File 携带加密的 fileKey、加密 metadata(title/creationTime/modificationTime)、magic metadata、明文 `info.fileSize`、`updationTime`、`isDeleted`。同步模型是**按 collection 的 sinceTime 增量 diff**(`GET /collections/v2/diff?collectionID=&sinceTime=`,每页上限 2500 条,`hasMore` 翻页;deleted 项以 `isDeleted` 标记);回收站有独立的 `/trash/v2/diff`。"隐藏相册"= collection 私有 magic metadata 的 `visibility == 2`;`file.encryptedData == "-"` 表示已从相册移除。

证据:

- Collection 字段:`ente/cli/internal/api/collection_type.go:3-19`(encryptedKey/keyDecryptionNonce/encryptedName/nameDecryptionNonce/magicMetadata/pubMagicMetadata/sharedMagicMetadata/updationTime/isDeleted)。
- File 字段:`ente/cli/internal/api/file_type.go:3-27`;`IsRemovedFromAlbum()` = `isDeleted || file.encryptedData == "-"`(file_type.go:20-22);`FileInfo{fileSize, thumbSize}` 明文(file_type.go:24-27)。server 侧同构 `ente/server/ente/file.go:10-49`。
- 解密后的业务模型:标题优先 `pubMagicMetadata.editedName`,否则 `metadata.title`(`ente/cli/pkg/model/remote.go:112-123`);时间同理 `editedTime`/`creationTime`,微秒时间戳(remote.go:136-148);隐藏相册判断 `privateMeta["visibility"] == 2`(remote.go:50-55)。
- 分页/diff:`GET /collections/v2/diff` 响应 `{diff: File[], hasMore}`(`ente/cli/internal/api/collection.go:26-44`);server 端 `CollectionDiffLimit = 2500`(`ente/server/pkg/controller/collections/collection.go:25`),多取 1 条判断 hasMore、并用最后一条的 updationTime 过滤同版本(files_diff.go:82-90)。collections 列表本身也有 v2/v3 增量(cli collection.go:8-24;main.go:757-759)。
- CLI 增量同步算法(可直接抄):记录每 collection 的 lastSyncTime,循环拉 diff 直到 `!hasMore`,`maxUpdated` 推进水位(`ente/cli/pkg/remote_sync.go:70-148`);collections 水位同理 remote_sync.go:15-68。
- 回收站:`GET /trash/v2/diff` 返回 `{diff, hasMore}`(`ente/server/pkg/api/trash.go:19-33`);文件回收站语义:进入 trash 的文件不再出现在 collection diff,而在 trash diff 中。

## 7. Download path

**结论**:下载分两跳:①`GET /files/download/v3/:fileID`(带 `X-Auth-Token`)→ JSON `{url}`(S3 预签名 URL,代码中有效期 7 天;v1 是 307 直接重定向);②GET 该 URL 得到**密文**字节,需用 fileKey 做 secretstream 流式解密才能给用户明文。缩略图同路径(`/files/thumbnail/v3/...`)。CLI 对官方 hosted 环境还会走 `https://files.ente.com/?fileID=<id>` 下载代理(带 X-Auth-Token)。**Worker 代理必须处理:重定向或 JSON 取 URL、以及"密文→明文"的整流解密(secretstream 不支持随机访问,Range 请求需整段顺序解密或降级不支持)**。

证据:

- URL 获取:v3 返回 JSON(`writeFileURLV3`,`ente/server/pkg/api/file.go:272-278`);`Get`/`GetThumbnail`(v1)为 307 redirect(file.go:218-227, 245-254)。CLI 用 v3(`ente/cli/internal/api/files.go:24-44`)。
- URL 是对象存储预签名:`getSignedURLForAccessibleObject` → minio `Presign(PreSignedRequestValidityDuration)`(`ente/server/pkg/controller/file.go:474-493, 923`;常量 `= 7*24h`,`ente/server/pkg/controller/object_cleanup.go:28`)。server 会按 User-Agent 是否含 `go-resty` 区分 CLI 与 App 走不同 DC/桶(file.go:553-556)。
- hosted 下载代理:`downloadHost = "https://files.ente.com/?fileID="`,仅当 endpoint 是官方 api 时启用,请求带 token(files.go:13, 19-22, 52-54)。
- 字节解密:下载后 `crypto.DecryptFile(key, fileDecryptionHeader)` 整文件顺序解密(`ente/cli/pkg/download.go:14-39`;`crypto_native.go:98-151`);web 为 chunked pull(`libsodium.ts:238-296`)。缩略图同样加密(Thumbnail FileAttributes,file.go:11/19)。
- Range/流式:secretstream 是顺序 chunk 流(Go 实现按 4MB buffer 顺序 pull,crypto_native.go:119-145),无随机访问;S3 预签名 URL 本身支持 Range,但对密文做 Range 无意义 —— 代理层需自己顺序解密再向客户端分块输出。

## 8. Existing read-only precedents

**结论**:仓库内最成熟的"账号登录 → 解密 → 全量列举 → 下载解密"先例就是 **ente CLI**(`ente account add` + `ente export`);它把全部 keys/token 落地本地,然后只调用只读端点完成同步与导出 —— 这正是 driver 架构 A/C 应模仿的代码路径。仓库内没有 WebDAV 或第三方 lister(grep "webdav" 无结果)。

证据:

- `ente export` 命令与过滤(shared/hidden/albums):`ente/cli/cmd/export.go:8-37`。
- 导出主循环 = 第 6 节的增量 diff 同步(remote_sync.go:15-148)+ 每文件下载解密(download.go:14-39)。
- 账号添加与凭证落地:account.go:18-107(见第 2 节)。
- 匿名只读先例 = web `share` 应用(第 5 节),零凭证、纯 secretbox/secretstream 解密。

---

## 可行性结论(feasibility)

**方案 B(公开分享链接,零账号凭证)— 最可行,推荐首选。**
输入只需一个分享 URL(token 在路径、collectionKey 在 fragment,`share.ts:15-18`)。Worker 调 `/public-collection/info` + `/public-collection/diff` 列目录,`/public-collection/files/download/v3/:fileID` 取预签名 URL,secretbox+secretstream 解密(collection-share.ts:138-360)。
代价/阻塞:①只覆盖 owner 主动分享的相册,不能浏览全账号;②owner 订阅失效即 410(collection_link.go:83-88)、有设备数限制;③密码保护相册需 argon2(verify-password,264-286),建议不支持;④需在 TS 里实现 secretbox(tweetnacl,仓库 lock 中已有传递副本)+ secretstream(可移植 `ente/cli/internal/crypto/stream.go`)。

**方案 A(账号级全量解密,Worker 内 E2EE)— 可行但成本高。**
一次性在本地(ente CLI 或小型登录 helper)完成 SRP 登录,导出 `token + masterKey(+secretKey/publicKey,若要含共享相册)`(AccSecretInfo,account.go:34-42);Worker 用 `X-Auth-Token` + `X-Client-Package: io.ente.photos` 调 `/collections/v2`、`/collections/v2/diff`、`/files/download/v3`,本地解密层级见第 3 节。token 365 天未用才过期,定期 list 即可保活(userauth.go:281-291)。
代价/阻塞:①需在凭证中保存 masterKey(等于交出账号全部解密能力,泄密面大);②共享相册 sealed-box open 需 Curve25519(tweetnacl box.open 可实现);③大文件代理必须整流 secretstream 解密,CF Workers CPU 时间/内存(128MB)限制下大文件是硬风险;④2FA/passkey 账号无法自动化登录(必须人工在 CLI 完成,login_type.go:60-65)。

**方案 C(离线 CLI 导出索引 + 代理)— 折中,实时性差。**
用 `ente export` 生成已解密索引(文件名/大小/时间/fileID/fileKey 可从 CLI 的 bolt store 导出,account.go:83-107、remote_sync.go),Worker 读索引列目录,下载时仍需 fileKey + `/files/download/v3` + secretstream 解密(即仍需方案 A 的解密代码与 token)。
代价/阻塞:①索引会陈旧,需定时重跑 CLI;②并未省掉任何 Worker 端解密/凭证需求(仍要 token 与 fileKey);③相比 A 只是把"列目录"离线化 —— 若 Worker 端解密代码无论如何都要写,增量收益主要在避免每次列表的 diff API 调用。

综合:**B 为第一优先**(零凭证、风险最小、官方匿名 viewer 已验证全部端点);**A 为进阶**(全账号覆盖,接受凭证与运行时成本);**C 仅当 A 的列表 API 调用成为瓶颈时才有意义**。

## 9. 第三方 client 复刻限制

**结论**:对只读第三方 client,最大的硬约束是**公开分享的设备数/订阅检查**(可 403/410 拒绝)与**passkey 登录无法无头完成**;其余皆为软约束:分层限流(429)、公开端点 10 req/min/IP 的登录族限制、thumbnail 由 client 生成(只读无负担)、UA 只影响 DC 路由不影响鉴权。代码中**没有任何 client attestation/签名/captcha**,`X-Client-Package` 未知值不会被拒(默认按 photos app 处理)。

### 9.1 Rate limiting

**结论**:museum 有三层限流,全部在 middleware 实现、代码内写死(非配置文件):进程级全局限流、路由级全局限流、按路径的 per-IP / per-user 限流。超限统一返回 429 + `{"error":"Rate limit breached, try later"}`,并(除少数路径外)向 Ente 的 Discord 发 abuse 通知。对第三方 driver 最重要的两条:①登录族端点每 IP 仅 10 req/min(脚本化重试登录会被快速掐掉);②thumbnail/preview 700 req/s,其余列表/下载 API(`collections/v2/diff`、`files/download/v3` 等)没有专门的 per-IP/per-user 限流,只受进程级 1000 req/s 兜底。

证据:

- middleware 定义:`ente/server/pkg/middleware/rate_limit.go:24-33`(五种 scope:ip / collection / user / route_global / process_global)。
- 进程级全局:`GlobalRateLimiter()` 计数器超限即 429(rate_limit.go:88-100);实例化参数为 1000 次/秒(`ente/server/cmd/museum/main.go:231`),应用于全部请求(main.go:540-541)。
- 路由级全局:仅 `/events*` 120/H、`/paste/*` 300/M(rate_limit.go:178-186)。
- 按路径 per-IP(公开路径)/per-user(鉴权路径):
  - 登录族(`/users/ott`、`/users/verify-email`、`/users/srp/*` 前缀、`/users/two-factor/*` 前缀、recover-account、family invite 等)= **10 req/min**(rate_limit.go:301-321);verify-password(相册/文件链接)同属 10/M(rate_limit.go:306-307)。
  - thumbnail/preview = **700 req/s**(rate_limit.go:236-240)。
  - 鉴权上传 URL 族 = 500 req/min(rate_limit.go:281-283);公开分享上传 URL = 250 req/min(rate_limit.go:284-286)。
  - 其余路径 `getLimiter` 返回 nil,即无限流(rate_limit.go:330)。
- keying:公开路径按 `clientIP-path`(rate_limit.go:195-197),鉴权中间件按 `userID-path`(rate_limit.go:123-145, 134-139);公开 collection 上传按 collection 计(rate_limit.go:199-209)。
- 429 响应体与 Discord 通知:rate_limit.go:147-168(166 行 JSON;157-159 `NotifyPotentialAbuse`,`shouldNotifyPotentialAbuse` 只豁免 IP-scope 的 `/users/srp/attributes`,rate_limit.go:170-172)。
- 挂载位置:global 在最外层,其余 route group 用 `APIRateLimitMiddleware` / `APIRateLimitForUserMiddleware`(main.go:540-541, 545, 548, 559, 564, 569, 575)。

### 9.2 账号侧 token/设备数量

**结论**:代码中**没有**对账号同时有效 token 数量的上限,也没有"设备"概念绑定到普通 API token —— 每次登录直接插入新 token,旧 token 保留直到 365 天未使用过期或被显式吊销。第三方 client 登录一次即得一个长期 token,不会挤掉用户现有会话。

证据:

- `AddToken` 无条件 INSERT,无数量检查(`ente/server/pkg/repo/userauth.go:170-175`);token 表只记 user/app/hash/ip/UA。
- 过期仅按 `last_used_at` 365 天空闲判定(`ente/server/pkg/repo/userauth.go:281-291`);无 TTL、无 refresh。
- 会话管理端点:`GET /users/sessions`(列出,按当前 app 过滤)、`DELETE /users/session`(吊销)(`ente/server/cmd/museum/main.go:728-729`;实现 `ente/server/pkg/controller/user/userauth.go:404-416`)。
- 唯一的数量型限制是 OTT(email OTP)请求频率:`too many OTT requests` → `ErrTooManyBadRequest`(`ente/server/pkg/controller/user/userauth.go:99, 123, 131`;错误定义 `ente/server/ente/errors.go:33`)。

### 9.3 公开分享的设备数限制

**结论**:设备数限制只作用于**两个入口端点**(`/public-collection/info` 与 `/diff`),"设备"= **(IP, User-Agent) 去重对**;超限返回 **403**(`ErrLinkDeviceLimitExceeded`)。通过持久化 server 下发的 **linkDeviceToken**(JWT,响应 header)可让同一 client 永久占用一个设备名额并自动续期 —— 第三方 driver 应保存它。另外 Ente 自己的 CF worker 出口 IP 被显式豁免;免费用户的分享链接设备上限被强制为 10(legacy 5)。

证据:

- 只在 info/diff 做设备准入:`shouldCheckCollectionLinkDeviceLimit`(`ente/server/pkg/middleware/collection_link.go:203-209`),其余路由(下载/缩略图)沿用已准入会话。
- 计数机制:先查 `(shareID, ip, ua)` 是否历史访问过(`AccessedInPast`,过的直接放行),再看去重访问数是否 ≥ deviceLimit,未超则 `RecordAccessHistory`(`ente/server/pkg/middleware/collection_link.go:232-268`)。
- CF worker IP 跳过:`network.IsCFWorkerIP` 只匹配 Ente 自己的固定 IP `2a06:98c0:3600::103`(collection_link.go:234-237;`ente/server/pkg/utils/network/network.go:12-14`)。
- 超限错误:403 `Public link device limit reached`(`ente/server/ente/errors.go:215-218`)。
- 免费/付费上限:free user 分享强制 `FreeUserDeviceLimit=10`(legacy 5),`DeviceLimitThreshold=50` 被乘 10 放行为 500(`ente/server/pkg/controller/public/collection_link.go:25-38`;middleware 侧 collection_link.go:174-179, 253-256);超过 2000 设备还会触发 Discord 告警(collection_link.go:258-262)。
- linkDeviceToken:info/diff 时校验/下发/临期自动续期(collection_link.go:181-201, 184-193);web 端把它存 localStorage 以免重复占用设备位(`ente/web/apps/share/src/hooks/use-collection-share.ts:96-111`)。

### 9.4 Client 身份校验

**结论**:server **不校验** client 身份的真实性:`X-Client-Package` 仅用于把请求归到 photos/auth/locker 三种 app,**未知 package 名不会被拒绝**(默认按 photos);User-Agent 只被两处用作启发式(CLI 判定影响 DC 路由)。没有 client attestation、请求签名或 captcha。唯一硬性要求:storage 端点拒绝 auth-app 的 token —— 第三方 client 应声明 `io.ente.photos`。

证据:

- `GetApp`:按 `X-Client-Package` 前缀映射,`io.ente.auth`→auth、`io.ente.locker`→locker,**其余一律 photos**(不报错)(`ente/server/pkg/utils/auth/auth.go:78-88`);CLI 常量同样三个包名(`ente/cli/internal/api/enums.go:25-35`)。
- storage route group 挂 `RejectAuthApp`:`ente/server/pkg/middleware/auth.go:111-123`(main.go:549-550)。
- UA 仅影响路由:UA 含 `go-resty` → 按 CLI 处理(Wasabi 桶/DC)(`ente/server/pkg/controller/file.go:553-556`);hosted 场景按 `CF-IPCountry` 头取国家(`ente/server/pkg/utils/network/network.go:16-18`)。
- attestation 仅存在于 passkey/WebAuthn 存储层(credential 元数据),与普通 API 无关(`ente/server/pkg/repo/passkey/credential.go:47, 67`);全库 grep 无 captcha/recaptcha/turnstile(server/pkg 内无结果)。

### 9.5 缩略图生成责任

**结论**:缩略图完全由 **client 生成并加密后作为独立对象上传**;server 在 file create 时强制要求 thumbnail 有自己的 objectKey 与 decryptionHeader,并从对象存储实测其大小。**只读 client 零负担**:server 只对已存在的小图对象做 presign(`/files/thumbnail/v3/:fileID`),拿到的仍是密文,用 fileKey 解密即可。

证据:

- create 校验:file 与 thumbnail 的 objectKey 都必须以 `<userID>/` 开头、二者不得相同、都必须有 DecryptionHeader(`ente/server/pkg/controller/file.go:95-111`);server 并发拉取两对象真实大小并写入 `Info{FileSize, ThumbnailSize}`(file.go:143-173, 200-203)。
- web 端缩略图上限 100KB(`ente/web/packages/gallery/services/upload/thumbnail.ts:15`)。
- 只读路径:`GET /files/thumbnail/v3/:fileID` 返回 presigned JSON(main.go:620;`ente/server/pkg/controller/file.go:406-408` 同 download 共用 presign 逻辑);缩略图字节与主文件同用 fileKey secretstream 解密(见第 3 节)。

### 9.6 Upload 管线(未来写操作评估)

**结论**:server 只做 presign + 事后校验,**全部 structuring(切块、加密、缩略图、metadata、multipart 分片决策)都在 client 侧**。流程:①`POST /files/upload-urls`(带 contentLength+contentMD5)拿 PUT presign(小文件)或 `POST /files/multipart-upload-urls`(≤10000 片)拿 part URLs + complete URL;②client 加密并 PUT 密文;③`POST /files` 上报全部加密元数据,server 回查对象大小、限额、去重。参考阈值:流加密块 4MB,web 客户端 5 块/分片(≈20MB/片)。

证据:

- 小文件 presign:UploadURLRequest 要求 `contentLength`、`contentMD5`(binding:required)(`ente/server/ente/file.go:143-146`);handler `GetUploadURLs`(`ente/server/pkg/api/file.go:134-139`;路由 main.go:610-649)。
- multipart:片数 1..10000(`maxMultipartPartCount`,`ente/server/pkg/controller/file.go:70, 1103-1105`);server 调 S3 CreateMultipartUpload 并 presign 各 part + complete URL(file.go:1103-1156);带 metadata 变体要求 contentLength>0 且 ≤MaxFileSize(file.go:1159-1168)。
- 大小与配额:MaxFileSize 10GB(内部用户 20GB)(file.go:64-66);create 时上报 size 与实测不符即 ErrBadRequest,总用量经 `CanUploadFile` 校验(file.go:182-198)。
- client 侧 structuring:流加密块 4MB(`ente/web/packages/base/crypto/types.ts:6`);multipart 5 块/片(`multipartChunksPerPart`,`ente/web/packages/gallery/services/upload/upload-service.ts:92, 1337`)。
- presign URL 有效期常量 7 天(`PreSignedRequestValidityDuration`,`ente/server/pkg/controller/object_cleanup.go:28`;presign 调用 file.go:923, 937, 1092, 1150)。

### 9.7 hosted vs self-host 差异与 UA 选择

**结论**:hosted 上 server 按 UA 是否含 `go-resty` 把 CLI 导去不同桶/DC(Wasabi),官方 app 走 hot DC;self-host 单桶无差异。第三方 client **任何非 `go-resty` UA + `X-Client-Package: io.ente.photos` 即等价于官方 app 行为**(拿到 hot-DC presign URL);用 `go-resty` 也合法,只是拿到直连 Wasabi 的 URL。`files.ente.com` 下载代理是 CLI 专属逻辑(endpoint==api.ente.com 时才启用),第三方应直接用 v3 presign。

证据:

- `isCliRequest` = UA 含 "go-resty" → CLI 桶/DC presign(`ente/server/pkg/controller/file.go:553-556`,与 474-568 的 DC 选择逻辑);app 走 `GetHotDataCenter()`(file.go:162)。
- CLI 代理开关:`downloadHost = "https://files.ente.com/?fileID="` 仅当 endpoint 为官方 api(`ente/cli/internal/api/files.go:13, 19-22, 52-54`);该代理请求需带 `X-Auth-Token`(files.go:52-54)。
- v1 download 端点(307 redirect)对携带 token 的跨服务重定向会 `logBadRedirect` 告警 —— 第三方应用 v3 JSON 端点规避(`ente/server/pkg/api/file.go:472-475`;调用点 file.go:225, 252)。
- self-host:DC/hot-DC 配置为空时全部落同一 bucket(`ente/server/config/local.yaml` 与 example.yaml 的 storage 配置;单桶示例见 `ente/server/config/example.yaml`)。

### 9.8 无头登录约束

**结论**:SRP(password)完全可无头;OTT(email OTP)需要读邮箱(无法纯机器完成,除非有邮箱程序化接口);TOTP 协议是普通 POST、有 TOTP secret 即可无头(CLI 只是交互式提问);**passkey 无法无头** —— 必须在浏览器完成 WebAuthn 仪式(accounts web app),CLI 也是开浏览器 + 轮询。**server 端没有 captcha**,失败重试只受 9.1 的 10 req/min/IP 限流约束。

证据:

- SRP 全流程 HTTP 化、无人工环节(`ente/cli/pkg/sign_in.go:17-50`)。
- OTT:`POST /users/ott` 发码 + `POST /users/verify-email` 验码(main.go:693-694);CLI 循环人工输入 6 位码(`ente/cli/pkg/sign_in.go:162-179`);发送频率有 `too many OTT requests` 保护(userauth.go:99, 123, 131)。
- TOTP:`POST /users/two-factor/verify`(main.go:695);CLI 交互式 `GetCode("Enter TOTP", 6)` + `VerifyTotp`(sign_in.go:120-136)—— 协议本身无人工依赖。
- passkey:server 要求 `passkeySessionID` 时必须返回 `accountsUrl`(校验:`ente/cli/internal/api/login_type.go:53-55`);CLI 打开 `<accountsUrl>/passkeys/verify?...` 浏览器页并轮询 `CheckPasskeyStatus`(sign_in.go:138-160)。且 **passkey 账号首次 SRP/OTT 成功后不返回 token**,必须完成 passkey 验证才发 token(login_type.go:60-65 语义,见第 2 节)。
- captcha:全库无(grep `captcha|recaptcha|turnstile` 在 `ente/server/pkg` 仅 passkey attestation 命中,repo/passkey/*)。

### 9.9 其它会咬到第三方 client 的坑

**结论**:①diff 分页的水位必须取本页 **max(updationTime)** 而非"最后一条",且 server 会丢弃与页边界 updationTime 相同的条目 —— 若 `hasMore=true` 而水位不前进会死循环(web 端加了 break 保护);②`encryptedData == "-"` 是"已从相册移除"墓碑;③所有时间戳是**微秒**精度 Unix 时间;④token 也接受 query 参数(避免写进日志/Referer);⑤Live Photo 是两个独立 file 靠 magic metadata 配对,列表端不做合并。

证据:

- 分页语义:server 取 `CollectionDiffLimit+1` 条并用最后一条 updationTime 过滤同刻条目(`ente/server/pkg/controller/collections/files_diff.go:82-90`;limit 2500 见 `collection.go:25`);web 匿名 viewer 在 `hasMore` 且 sinceTime 未前进时 break(`ente/web/apps/share/src/services/collection-share.ts:256-258`);CLI 用 maxUpdated 推进水位(`ente/cli/pkg/remote_sync.go:109-135`)。
- 墓碑:`IsRemovedFromAlbum()` = `isDeleted || encryptedData == "-"`(`ente/cli/internal/api/file_type.go:20-22`)。
- 微秒时间:解析用 `time.UnixMicro`(`ente/cli/pkg/model/remote.go:136-148`)。
- token 可放 query `?token=`(`ente/server/pkg/utils/auth/auth.go` GetToken 同时读 header/query;CLI 常量 `TokenHeader` `ente/cli/internal/api/client.go:12`)。
- Live Photo 配对逻辑在 client:`ente/cli/pkg/live_photo.go`(存在配对/合并处理及其测试 live_photo_test.go);server 无合并语义。
- 隐藏相册 = collection 私有 magic metadata `visibility == 2`(remote.go:50-55)—— 列表时注意过滤。
