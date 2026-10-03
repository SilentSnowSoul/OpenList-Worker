# Ente 驱动采用强制代理 + Worker 内流式解密

ente 文件与缩略图字节均为 E2EE 密文,server 只返回 S3 预签名 URL,直链对客户端无意义。因此 `ente`/`enteshare` 登记进 `DRIVER_FORCE_PROXY`(OnlyProxy + NoLinkURL),由 Worker 拉取预签名 URL、用 fileKey 做 XChaCha20-Poly1305 secretstream 顺序解密后回传明文,`Content-Length` 取明文 `info.fileSize`。

secretstream 无随机访问,v1 不支持 Range(视频拖动进度不可用);"解密丢弃前缀"式 Range 的 CPU 成本随 seek 位置线性增长,受 CF Workers CPU 限额约束而推迟,留作后续 ticket。
