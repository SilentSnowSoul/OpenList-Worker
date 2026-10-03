# OpenList-Worker

文件列表程序(OpenList 的 TypeScript / Cloudflare Workers port):把多种远端存储挂载成统一目录树,支持代理下载与直链转发。

## Language

**Storage**:
挂载在某个挂载点下的远端存储实例,由驱动类型与 Addition 配置共同描述。
_Avoid_: drive、网盘实例

**Driver**:
面向一种后端的适配器,实现 `StorageDriver` 接口(`list`/`get` 等)。
_Avoid_: backend、provider

**Addition**:
Storage 的驱动专属 JSON 配置块,字段名即代码中的 `addition`。
_Avoid_: credentials、driver config

**Virtual path**:
用户可见的挂载内路径。
_Avoid_: mount path

**Physical path**:
驱动内部的后端原生路径或 ID 寻址,与 virtual path 成对出现。
_Avoid_: real path

**Raw URL(直链)**:
驱动为文件解析出的可直接下载 URL,302 转发目标;强制代理驱动没有。
_Avoid_: download link

**Forced proxy(强制代理)**:
内容必须经 Worker 流式转发的驱动类别(OnlyProxy + NoLinkURL,登记于 `DRIVER_FORCE_PROXY`,如 Mega、ProtonDrive)。
_Avoid_: proxy-only

### Ente 域

**Ente**:
端到端加密相册服务;server 为单体服务 museum,生产环境即 `api.ente.com`。

**Collection(相册)**:
ente 的相册实体,位于"账号 → collection → file"两层模型的中间层。代码与注释一律用 collection;面向用户的文案用 相册/album。
_Avoid_: album(代码内)、folder

**Share URL**:
ente 公开分享链接:path 段携带 share token,URL fragment 携经 bs58 编码的 collectionKey。
_Avoid_: share link

**linkDeviceToken**:
ente 在公开分享响应 header 下发的 JWT,为该分享持久占住一个设备名额并自动续期。

**masterKey**:
账号级根解密密钥,解开各 collection 的 collectionKey。
**secretKey**:
Curve25519 私钥,解开他人共享相册经 sealed box 送达的 collectionKey。
