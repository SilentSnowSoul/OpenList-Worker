import { test } from "node:test"
import assert from "node:assert/strict"
import { decryptedSize, parseShareUrl } from "./util"

// bs58 of 32 zero bytes
const key = "1".repeat(32)

test("parseShareUrl accepts both share URL shapes", () => {
  assert.equal(parseShareUrl(`https://share.ente.io/c/tok#${key}`).token, "tok")
  assert.equal(parseShareUrl(`https://albums.ente.com/?t=tok#${key}`).token, "tok")
})

test("parseShareUrl rejects missing token", () => {
  assert.throws(() => parseShareUrl(`https://albums.ente.com/#${key}`), /\[EnteShare\] invalid share URL/)
})

test("decryptedSize 扣除每 chunk 的 secretstream 开销", () => {
  assert.equal(decryptedSize(0), 0)
  assert.equal(decryptedSize(-5), 0)
  assert.equal(decryptedSize(17), 0)
  assert.equal(decryptedSize(4 * 1024 * 1024 + 17), 4 * 1024 * 1024)
  // 两个完整 chunk + 一个 1 字节尾 chunk
  assert.equal(decryptedSize(2 * (4 * 1024 * 1024 + 17) + 18), 2 * 4 * 1024 * 1024 + 1)
})
