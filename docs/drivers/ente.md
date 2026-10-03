# Ente Driver

Read-only mounts for Ente (end-to-end encrypted photo service). Two drivers are provided:

- **EnteShare**: public share URL mount; the root directory lists all files in that album
- **Ente**: account long-term credential mount; each album in the account is a folder under the root directory

Both drivers are strictly read-only (upload/delete/rename always return not supported). Files and thumbnails are streamed as decrypted plaintext via forced Worker proxy, never exposing direct links to clients. See ADR-0001 and ADR-0002 (docs/adr/) for design decisions.

## EnteShare 配置

| 字段 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `share_url` | 是 | — | 公开分享 URL（`https://share.ente.io/c/<token>#<bs58(collectionKey)>`），fragment 内为相册密钥，不会发给 server |
| `endpoint` | 否 | `https://api.ente.com` | 自托管 museum server 的 API 地址 |

## Ente 配置

| 字段 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `token` | 是 | — | app token，请求头 `X-Auth-Token`；日常列表调用即保活（365 天未使用才过期） |
| `master_key` | 是 | — | base64 的 masterKey，解出各相册 collectionKey |
| `secret_key` | 否 | — | base64 的 box 私钥；共享相册的 collectionKey 以 sealed box 送达本人公钥，缺省时共享相册被跳过并输出告警日志 |
| `show_hidden` | 否 | `false` | 隐藏相册（私有 magic metadata `visibility == 2`）默认排除，开启后展示 |
| `endpoint` | 否 | `https://api.ente.com` | 自托管 museum server 的 API 地址 |

## 凭证获取

Worker 内不实现密码/SRP/passkey 登录（ADR-0002）。token 与 master_key 需经外部登录页获取：

1. 自建或使用 OpenList-APIPages 的 ente 登录页登录账号
2. 从登录结果中复制 token（访问令牌）与 masterKey（base64）
3. secret_key（box 私钥）同样由该登录流程导出，仅在需要访问共享相册时填写

注意：ente 官方 CLI 可导出 token，但不提供 masterKey 导出，因此 CLI 不适用于本驱动的凭证获取。

## 已知限制

- 无 Range：v1 secretstream 不支持随机访问，带 Range 的请求一律返回 200 全量——视频可顺序播放，不能拖动进度条
- 严格只读：一切写操作被拒绝
- 同名去重后缀加在扩展名之前：`日落.jpg` 冲突时生成 `日落 (2).jpg` 而非 `日落.jpg (2)`
- 密码保护分享不支持：EnteShare 遇到密码保护的分享 URL 返回明确错误，需改用无密码分享
- 设备位风险（EnteShare）：server 下发的 linkDeviceToken 会持久化到挂载配置以复用设备位；与 change spec 所写的 KV binding 不同，本实现落在 `addition.device_token`（OpenList-Worker 无 KV binding 机制，addition 即等价的持久层）。运行期仅在“新 token 覆盖未被消费的旧 token”这一可检测场景输出告警；isolate 被回收导致的未消费 token 丢失无法告警，可能重复占用分享的设备位
- owner 侧限制：分享所有者订阅失效（410）或设备数超限（403）时，错误以可读文案返回给管理员
