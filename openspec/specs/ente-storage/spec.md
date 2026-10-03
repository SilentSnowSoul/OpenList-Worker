## Purpose

为 OpenList-Worker 提供 Ente(端到端加密相册服务)的只读挂载能力:通过公开分享 URL 或账号长期凭证浏览相册,并经 Worker 强制代理流出解密后的明文文件与缩略图。

## Requirements


### Requirement: Share URL read-only mount
系统 SHALL 支持以一条 Ente 公开分享 URL(可配自托管 endpoint)创建只读挂载,根目录列出该相册全部文件,文件名/大小/时间为解密后的真实值。列表 MUST NOT 发出任何 per-file 网络请求;已删除项与墓碑项(`encryptedData == "-"`)MUST NOT 出现在列表中;同名文件 MUST 获得确定性的去重后缀。

#### Scenario: List a shared album
- **WHEN** 管理员以合法 Share URL 创建 EnteShare 挂载并请求根目录列表
- **THEN** 返回该相册全部文件的解密文件名、明文大小与时间,整个过程仅调用按 collection 的分页列表端点

#### Scenario: Tombstoned files are hidden
- **WHEN** 相册中某文件被移出(响应含墓碑)后请求列表
- **THEN** 该文件不出现在结果中

### Requirement: Account-level mount
系统 SHALL 支持以 Ente 账号的长期凭证(token + master_key,可选 secret_key)创建只读账号级挂载:根目录下每个 collection(相册)为一文件夹。隐藏相册 MUST 默认排除,`show_hidden` 开启时展示;缺少 secret_key 时共享相册 MUST 被跳过并告警,提供 secret_key 时其文件可列出。

#### Scenario: Albums as folders
- **WHEN** 以有效 token + master_key 请求根目录
- **THEN** 每个 collection 显示为一个文件夹,进入后列出其解密后的文件

#### Scenario: Hidden album toggle
- **WHEN** 账号存在隐藏相册且 `show_hidden` 未开启
- **THEN** 该相册不出现在根目录;开启后出现

### Requirement: Plaintext proxy download
Ente 驱动的文件与缩略图 MUST 以强制代理方式流出:Worker 取预签名 URL 后流式解密回传明文,响应 `Content-Length` 取明文大小;MUST NOT 向客户端暴露直链或以 302 重定向出密文。v1 不支持 Range:收到 Range 请求时 MUST 回 200 全量。

#### Scenario: Download returns plaintext
- **WHEN** 下载 EnteShare 挂载中的任一文件
- **THEN** 收到的字节与该文件的原始明文逐字节一致,`Content-Length` 等于明文大小

#### Scenario: Video plays without seeking
- **WHEN** 网页播放器请求带 Range 头的视频
- **THEN** 返回 200 与完整明文字节,视频可顺序播放

### Requirement: Decrypted thumbnails
列表中的图片文件 SHALL 提供经解密的缩略图,由 Worker 经同一代理路径流出明文小图。

#### Scenario: Thumbnail renders in web UI
- **WHEN** 网页渲染 Ente 挂载中的图片列表
- **THEN** 缩略图请求返回解密后的明文小图

### Requirement: linkDeviceToken persistence
EnteShare 驱动 MUST 持久化 server 下发的 linkDeviceToken 并在后续请求中复用;运行环境提供 KV binding 时落 KV,否则 per-isolate 缓存并输出设备位风险告警。

#### Scenario: Token reused across requests
- **WHEN** 同一分享连续发起多次列表请求且 KV 可用
- **THEN** 仅首次请求触发设备位占用,后续请求复用既有 token

### Requirement: Readable error mapping
ente 侧错误 MUST 映射为可读的驱动级错误:owner 订阅失效(410)、设备数超限(403)、密码保护分享不支持,均给出面向管理员的明确原因说明。

#### Scenario: Password-protected share rejected clearly
- **WHEN** 以密码保护的分享 URL 创建挂载
- **THEN** 返回明确的不支持错误而非密文或模糊失败

### Requirement: Write operations rejected
两个 Ente 驱动 MUST 为严格只读:一切写操作(新建/删除/改名/上传)返回明确的 not supported 错误。

#### Scenario: Upload rejected
- **WHEN** 对 Ente 挂载发起上传或删除
- **THEN** 收到明确的 not supported 错误,挂载状态不变

### Requirement: Self-hosted endpoint
两个驱动 SHALL 支持通过 `endpoint` 配置指向自托管 Ente server,缺省为官方 `https://api.ente.com`。

#### Scenario: Custom endpoint used
- **WHEN** 配置了自托管 endpoint 的挂载发起任何请求
- **THEN** 全部请求指向该 endpoint

### Requirement: Credential model
Ente 账号驱动 MUST 只接受长期凭证(token + master_key,可选 secret_key),MUST NOT 在 Worker 内实现密码/SRP/passkey 登录;token 依靠驱动的日常使用自然保活。

#### Scenario: No in-worker login
- **WHEN** 管理员查看 Ente 驱动的配置项
- **THEN** 只有 endpoint、token、master_key、secret_key、show_hidden 等字段,无用户名/密码字段
