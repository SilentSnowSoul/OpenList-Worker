# IwaraZip Driver Spec (OpenList-Worker)

## Problem Statement

用户在 iwara.zip（YetiShare 文件托管服务）存有文件，但 OpenList-Worker 无法挂载它：没有对应驱动，用户无法在 Worker 环境浏览、下载、管理自己的 iwara.zip 文件。

## Solution

在 OpenList-Worker 新增 `IwaraZip` 驱动，实现 StorageDriver 接口（list/get 等及写操作），Addition 字段与 Go 版（OpenList 主仓库）完全一致：endpoint/key1/key2/root_folder_id。挂载后 iwara.zip 账号的文件夹树即 virtual path 目录树，支持浏览、Raw URL 解析、建文件夹、移动、重命名、复制、删除、上传。

## User Stories

1. 作为 OpenList-Worker 用户，我想把 iwara.zip 账号挂载为 Storage，以便在统一目录树中访问我的文件。
2. 作为 OpenList-Worker 用户，我想只填 endpoint/key1/key2 三项就能完成配置，以便无需注册流程即可使用。
3. 作为 OpenList-Worker 用户，我想浏览根目录和任意子文件夹，以便查看我账号下的全部内容。
4. 作为 OpenList-Worker 用户，我想复制文件或文件夹的 Raw URL（直链），以便在其他工具中直接下载。
5. 作为 OpenList-Worker 用户，我想新建文件夹，以便整理我的文件。
6. 作为 OpenList-Worker 用户，我想上传文件，以便向 iwara.zip 存入内容。
7. 作为 OpenList-Worker 用户，我想移动/复制文件与文件夹，以便在文件夹间整理内容。
8. 作为 OpenList-Worker 用户，我想重命名文件与文件夹，以便修正命名。
9. 作为 OpenList-Worker 用户，我想删除文件与文件夹，以便清理空间。
10. 作为 OpenList-Worker 用户，我想在 token 过期后无需手动干预即可继续操作，以便长时间挂载稳定可用。
11. 作为 OpenList-Worker 用户，我想在 API 出错时看到来自 iwara 的原始错误信息，以便自行诊断。
12. 作为 OpenList-Worker 用户，我想指定 root_folder_id 从任意子文件夹挂载，以便只暴露部分目录。

## Implementation Decisions

- iwara.zip 为 YetiShare 系文件托管服务，API 基址 `/api/v2/`，全部 POST，UTF-8。
- 认证：key1+key2 调 `/authorize` 换 access_token + account_id；token 内存缓存，空闲过期或 401/_status=error 时重新获取，不持久化。
- 每个请求携带 access_token 与 account_id。
- virtual path 直接映射账号文件夹树（physical path 即 folder id / file id）；根 = parent_folder_id 为空或 Addition 的 root_folder_id。
- `/folder/listing` 一次返回整文件夹 folders[]+files[]，无分页。
- Raw URL 两步解析：file id → `/file/download` → 签名 URL；短时效不缓存。
- 上传：`/file/upload` multipart 整文件，无分块；超限错误透传。
- 错误处理：必须检查响应体 `_status` 字段（HTTP 200 也可能报错）；`response` 信息透传；429 不等待重试。
- Addition 字段与 Go 版保持一致：`endpoint`（默认 `https://www.iwara.zip`）、`key1`、`key2`（必填）、`root_folder_id`。
- 该驱动不属于 Forced proxy 类别（可出直链），不登记 `DRIVER_FORCE_PROXY`。
- 不实现：远程 URL 导入、分享管理、账号信息查询。

## Testing Decisions

- 只测外部行为：通过 StorageDriver 接口对伪造的 iwara API（fetch 层 mock）断言请求参数与结果映射。
- 重点用例：token 获取与过期重取、_status=error 错误透传、对象映射、两步 Raw URL 解析。
- 参考仓库内既有 driver 测试写法，保持零外部测试依赖。

## Out of Scope

- Go 版（OpenList 主仓库）实现，另有独立 spec。
- 通用 YetiShare 驱动。
- 上传分块、下载限速/等待处理、URL 导入。

## Further Notes

- 免费套餐的下载等待/限速/每日限额属站点侧行为，驱动不绕过。
