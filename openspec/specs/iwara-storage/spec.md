## Purpose

让 OpenList-Worker 以 IwaraZip 驱动挂载 iwara.zip（YetiShare 文件托管服务）账号，提供浏览、Raw URL、读写能力，Addition 字段与 Go 版保持一致。

## Requirements

### Requirement: 挂载与认证
用户 SHALL 能通过 endpoint、key1、key2（可选 root_folder_id）配置挂载 IwaraZip Storage；驱动 MUST 用 key1+key2 换取 access_token 并在失效时自动重取，且不得持久化 token。

#### Scenario: 首次挂载
- **WHEN** 用户填入正确的 endpoint/key1/key2 并保存
- **THEN** 挂载成功，根目录（或 root_folder_id 指定目录）可列出

#### Scenario: token 失效自动恢复
- **WHEN** 已缓存的 access_token 过期或被服务端拒绝
- **THEN** 驱动自动重新获取 token 并重试原请求一次，用户无感知

#### Scenario: 凭证错误
- **WHEN** key1/key2 无效
- **THEN** 挂载失败并显示 iwara 返回的原始错误信息

### Requirement: 目录浏览
驱动 SHALL 把 iwara.zip 账号的文件夹树映射为 virtual path 目录树（physical path 即 folder/file id）；列出目录时 MUST 返回该目录下全部文件夹与文件。

#### Scenario: 列出根目录
- **WHEN** 用户打开挂载根路径
- **THEN** 返回账号根文件夹的全部子文件夹与文件

### Requirement: Raw URL 解析
用户 SHALL 能获取挂载内文件的 Raw URL（直链）；驱动 MUST 经服务端接口把 file id 解析为签名下载 URL，不缓存，不登记为 Forced proxy。

#### Scenario: 获取 Raw URL
- **WHEN** 用户请求某文件的直链
- **THEN** 返回可下载的签名 URL

### Requirement: 写操作
用户 SHALL 能在挂载内新建文件夹、移动、重命名、复制、删除文件与文件夹（文件夹复制 MUST 明确报不支持）。

#### Scenario: 新建文件夹
- **WHEN** 用户在某目录下新建文件夹
- **THEN** 刷新后该文件夹出现在列表中

### Requirement: 上传
用户 SHALL 能向挂载内任意文件夹上传文件，整文件一次完成；失败时原始错误透传。

#### Scenario: 上传成功
- **WHEN** 用户上传一个未超套餐大小限制的文件
- **THEN** 上传完成且文件出现在目标文件夹列表中

### Requirement: 错误处理
驱动 MUST 检查响应体 _status 字段识别错误（即使 HTTP 200），透传 response 信息；对 429 MUST NOT 自动等待重试。

#### Scenario: HTTP 200 携带错误
- **WHEN** 服务端返回 HTTP 200 且 _status=error
- **THEN** 驱动按错误处理并透传 response 信息
