# 01: Ente crypto 模块与测试向量

**What to build:** Ente E2EE 解密原语的 TypeScript 实现,可独立于任何驱动验证:secretbox 开箱(collectionKey、fileKey、metadata key 各层级)、Curve25519 sealed box 开箱(共享相册 collectionKey)、XChaCha20-Poly1305 secretstream 的单块与流式解密;密文/密钥/nonce 均 base64 编码,时间戳为微秒。依赖落地:tweetnacl 转直接依赖,新增 `@noble/ciphers` 作基件。

**Blocked by:** None(can start immediately)

**Status:** resolved

- [x] secretbox open 与 sealed box open 通过固定测试向量(与 ente 官方实现交叉生成)
- [x] secretstream 多块流式解密、单块(metadata)解密通过固定向量;流式实现不依赖 Node 专属 API,可在 CF Workers runtime 使用
- [x] 依赖写入 package.json 并同步 lock(tweetnacl 直接依赖、`@noble/ciphers`、`@noble/hashes` 新增)
- [x] 单测零外部测试依赖,遵循仓库现有测试 runner 惯例

## Answer

- `src/backend/drivers/ente/crypto.test.ts` 8/8 通过;向量两组:ente 官方 crypto_test.go 的 secretbox 向量 + Go 交叉生成器(x/crypto chacha20/poly1305/nacl/box,secretstream 拷贝自 ente CLI stream.go,生成侧经官方 NewDecryptor 自校验)。
- 关键字节语义(修正了移植笔记的两处误读):MAC 第一段 = `[encTag ‖ keystream块1[1:64]]`(63 字节为 keystream 非 0);输出密文首字节是加密后的 tag。sealed box nonce = blake2b-24(epk‖recipientPK)(x/crypto 实现,非 libsodium 的 sha256),故引入 `@noble/hashes`。
- `_poly1305` 为 noble 私有导出(1.x 内稳定),已在源码注释标注升级需回归向量。
- `pnpm lint` 仅剩 2 个既有错误(db_cipher.test.ts 重复标识符,已提交文件,与本票无关);本地调研克隆 ente/ 已移至 `../ente` 避免污染 typecheck。
