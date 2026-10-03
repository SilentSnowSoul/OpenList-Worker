# Ente driver

Status: ready-for-agent

## Problem Statement

用户把照片存放在 Ente(端到端加密相册服务)。Ente 没有面向第三方的只读接入方式:官方 client 之外,没有任何办法列出相册、看到真实文件名、或下载到明文文件。用户希望像挂载其它网盘一样,把 Ente 挂进 OpenList-Worker 浏览与下载。

## Solution

新增两个只读驱动,共享同一套 Ente crypto 与 API client 模块:

- **EnteShare**:挂载一条公开分享 Share URL(零账号凭证)——解析 path 里的 share token 与 fragment 里的 collectionKey,经 `/public-collection/*` 端点列出并解密整个相册。v1 优先交付。
- **Ente**:账号级挂载——配置长期 `token` + `master_key`(可选 `secret_key` 以支持共享相册),浏览全部 collection。

两者都作为强制代理驱动(Forced proxy):下载与缩略图由 Worker 拉取 server 下发的 S3 预签名 URL,用 fileKey 做 secretstream 流式解密后回传明文。登录(SRP/argon2/passkey)外置到 OpenList-APIPages,本仓库驱动只接受粘贴的长期凭证。

## User Stories

1. As an OpenList 管理员, I want 用一条 Ente 公开分享 URL 创建只读挂载, so that 无需交出任何账号凭证即可对外提供相册内容。
2. As an OpenList 管理员, I want 用 Ente 账号的 token + master_key 创建账号级挂载, so that 浏览账号下全部相册。
3. As a 挂载访问者, I want 相册显示为文件夹, so that 按 Ente 客户端的心智浏览。
4. As a 挂载访问者, I want 看到解密后的真实文件名、大小与时间, so that 不必打开文件就知道内容。
5. As a 挂载访问者, I want 下载得到明文文件, so that 直接可用。
6. As a 挂载访问者, I want 网页缩略图为解密后的小图, so that 图片挂载有正常的视觉体验。
7. As a 挂载访问者, I want 在网页播放器里直接播放视频, so that 无需下载(接受 v1 不能拖动进度的限制)。
8. As an OpenList 管理员, I want 共享给我的相册也能列出(提供 secret_key 时), so that 账号级挂载覆盖全部可见内容。
9. As an OpenList 管理员, I want 隐藏相册默认排除、可选展示, so that 与官方客户端一致。
10. As an OpenList 管理员, I want 自定义 Ente endpoint, so that 自托管 museum 也能挂载。
11. As an OpenList 管理员, I want token 长期自动保活, so that 不需要频繁重新配置(365 天未使用才过期)。
12. As an OpenList 管理员, I want 对密码保护的分享得到明确的不支持提示, so that 知道该分享无法挂载而非报错迷雾。
13. As an OpenList 管理员, I want owner 订阅失效(410)与设备数超限(403)映射为可读错误, so that 能向用户解释原因。
14. As an Ente 分享者, I want 我的 linkDeviceToken 被驱动持久化, so that 代理访问只占一个设备名额、不因出口 IP 变化累积。
15. As a 挂载访问者, I want 同名文件获得确定性的去重后缀, so that 文件不互相覆盖。
16. As a 挂载访问者, I want 已删除相册、已移出相册的文件不出现在列表里, so that 列表与真实内容一致。
17. As a 挂载访问者, I want Live Photo 显示为照片与视频两个文件, so that 内容不丢失(v1 不做合并)。
18. As a 挂载访问者, I want 写操作(新建/删除/改名/上传)返回明确的 not supported 错误, so that 不误以为操作成功。
19. As an OpenList 管理员, I want 大相册分页拉全而不是截断, so that 列表完整。
20. As an OpenList 管理员, I want 回收站内容不展示, so that 与官方客户端一致。

## Implementation Decisions

- 双驱动拆分:`EnteShare`(`enteshare`)与 `Ente`(`ente`)各自注册,遵循仓库既有 `*_share` 惯例;共享的 crypto/client 模块放在 `ente` 驱动目录内由两者复用。不实现"离线索引"第三方案。
- 三处注册与既有驱动一致:驱动工厂、admin 驱动元数据(显示名 `EnteShare`/`Ente`,默认挂载路径 `/ente_share`/`/ente`,`only_proxy` 等 config 对齐 Mega、ProtonDrive)、Forced proxy 登记(OnlyProxy + NoLinkURL)。
- 配置字段:
  - EnteShare:`share_url`(完整分享 URL)、`endpoint`(默认官方 `https://api.ente.com`)。
  - Ente:`endpoint`、`token`、`master_key`(hex/base64)、`secret_key`(可选;缺省时共享相册跳过并告警)、`show_hidden`(默认 false)。
- 密码学:tweetnacl(转为直接依赖,提供 secretbox 与 Curve25519 box)+ @noble/ciphers(新增依赖,XChaCha20-Poly1305 基件),在其上移植 secretstream(参考 ente CLI 的 Go 实现);argon2 与 SRP 不进 Worker(见 ADR-0002)。
- 请求约定:`X-Auth-Token`(账号)/ `X-Auth-Access-Token`(分享)、`X-Client-Package: io.ente.photos`;UA 不含 `go-resty` 以获得与官方 app 一致的 hot-DC 预签名行为;下载一律用 v3 JSON 端点,不用会触发跨服务重定向告警的 v1 307 端点。
- 列表策略:无状态全量拉取(collection 列表 + 按 collection 的 diff 循环翻页),per-isolate 内存缓存短 TTL;diff 水位取页内 `max(updationTime)` 并在水位不前进时终止,规避 server 分页语义造成的死循环;过滤 `isDeleted` 与 `encryptedData == "-"` 墓碑。
- 列表性能契约:`list` 只做按 collection 的 diff 端点调用,单次响应即含 fileKey 密文、metadata 密文与明文 `info.fileSize`/`updationTime`,文件名与时间在本地解密;禁止 per-file 网络请求(缩略图/下载是渲染时才触发的 lazy 请求,不计入 list)。
- 命名与时间:文件名取 `editedName || title`,冲突时确定性追加 ` (2)`;时间取 `editedTime || creationTime`(微秒转 ISO)。隐藏相册按私有 magic metadata `visibility == 2` 判定。
- 下载与缩略图:统一走代理解密流——v3 端点取预签名 URL → fetch → secretstream 流式解密回传明文,`Content-Length` 取明文 `info.fileSize`;v1 不支持 Range(见 ADR-0001);缩略图走 thumbnail v3 端点同管线,`thumb` 指向代理路径。
- linkDeviceToken:EnteShare 持久化 server 下发的 JWT(KV binding 可用时落 KV;否则 per-isolate 缓存并在日志告警设备位风险)。
- 错误映射:410(owner 订阅失效)、403 设备数超限、密码保护分享不支持,均转成可读的驱动级错误。
- 写操作:全部抛出明确的 not supported 错误。
- 决策记录:ADR-0001(强制代理 + 流式解密 + v1 无 Range)、ADR-0002(登录外置、凭证模型)。

## Testing Decisions

- 只测外部行为,不测实现细节;测试零外部依赖、可在所有支持平台运行。
- 最高既有 seam:驱动类的 `list`/`get`,对 mock 的 HTTP transport + 真实 crypto 模块 + 预生成密文 fixture 断言解密后的名字/大小/时间/下载流。先例:Mega 驱动的 mock client 测试、ProtonDrive 的纯 crypto 测试。
- crypto 模块单测用固定测试向量(secretbox、secretstream、sealed box open),向量与 ente 官方实现交叉生成,防止移植漂移。
- 真实网络冒烟仅以 env-gated 手动脚本形式提供(沿用仓库 `scripts/test-*.mts` 惯例),不进 CI。

## Out of Scope

- 一切写操作(上传、删除、移动、改名)。
- Range 支持(视频拖动进度)——前缀解密式 Range 留作后续评估。
- 密码保护分享相册(其 KDF 为 64MB argon2,Workers 边缘可行,留作后续 ticket)。
- file-link 单文件分享挂载。
- Worker 内用户名密码登录,以及 OpenList-APIPages 的 Ente 登录页(另一仓库的后续工作)。
- 回收站、"全部照片"虚拟目录、Live Photo 合并、KV 增量同步水位。

## Further Notes

- 完整调研(端点、密钥层级、分页语义、限流、设备数机制等,均带 ente 源码行号引用):`.scratch/ente-driver/research/ente.md`。
- 术语以根目录 `CONTEXT.md` 为准(collection/相册、Share URL、linkDeviceToken 等)。
