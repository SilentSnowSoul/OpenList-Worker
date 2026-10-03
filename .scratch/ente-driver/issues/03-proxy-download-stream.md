# 03: 代理下载解密流

**What to build:** 在 EnteShare 挂载里下载文件得到明文:向 v3 JSON 端点(`files/download/v3/:fileID`)取 S3 预签名 URL,fetch 后用 fileKey 做 secretstream 流式解密回传,`Content-Length` 取明文 `info.fileSize`;v1 不支持 Range,视频可顺序播放但不能拖动进度;请求头遵守约定(`X-Client-Package: io.ente.photos`、UA 不含 `go-resty`)。

**Blocked by:** 02

**Status:** resolved

- [x] fixture 密文经下载管线解出的字节与明文逐字节一致
- [x] `Content-Length` 等于明文大小;收到 Range 请求时回 200 全量而非 206
- [x] 大文件流式转发,不在内存中整体缓冲
- [x] 取预签名 URL 的请求头约定生效;仅使用 v3 JSON 端点(不用 v1 307)

## Answer

实现与测试全部完成(2026-10-02):

- `ente/util.ts` 新增 `enteDecryptStream(body, key, headerB64, cipherChunkSize = 4MB+17)`:接收端按固定密文块边界(上传端 4MB 明文分块 → 密文 4MB+17,末块为剩余全部)累积后逐块 `EnteDecryptor.pull`,TAG_FINAL 后关闭;网络分片边界与密文块边界解耦(合并到块边界才解密)。cipherChunkSize 参数仅测试注入缩小几何。
- `ente/client.ts` 新增 `getDownloadUrl(fileID)`(`/public-collection/files/download/v3/:fileID` JSON `{url}`,不用 v1 307)与 `fetchBinary(url)`(预签名 URL 由 S3 自鉴权,headers 传空,不携带 ente 头)。
- `ente_share/driver.ts` 新增 `createReadStream(physicalPath)`:findFile(缓存列表)→ getDownloadUrl → fetchBinary → enteDecryptStream;不做 per-file 列表请求。
- Range 语义:proxy.ts 新增 `DRIVER_NO_STREAM_RANGE = {enteshare, ente}` + `streamDriverNoRange()`;raw.ts createReadStream 分支收到 Range 且 `streamDriverNoRange(normDriver)` 时落回 200 全量(不带 Content-Range,也不发 Accept-Ranges 免得诱导客户端再发 Range)。对齐 ADR-0001(不做前缀解密式 Range)。
- 向量:生成器扩展 `streamFixtures()` —— f105 单块 TagFinal 流(key=0x45+i,明文 "hello ente"+300×0xAB+"tail" 共 314B)与均匀三块流(50B TagMessage/50B TagPush/"end" TagFinal,密文 67/67/21),生成侧经官方 NewDecryptor round-trip 自校验,TS 侧再次校验后回填测试。
- 测试:driver.test.ts 新增 2 个(均匀多块按块边界解密 + createReadStream 端到端:URL 序列 diff→v3→s3、v3 带 Access-Token、S3 无 ente 头、明文逐字节一致);新增 `server/raw_ente_range.test.ts`(/p 层:Range: bytes=0-9 → 200 全量、Content-Length=314、无 Content-Range、无 Accept-Ranges、body 明文一致)。15/15 通过;`pnpm lint` 无新增错误。
- 教训记录:长 b64 向量禁止手工复制进测试(两次截断致 MAC 失败),一律由脚本从生成器输出文件校验后回填。
