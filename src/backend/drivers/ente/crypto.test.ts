import test from "node:test"
import assert from "node:assert/strict"
import {
  EnteDecryptor,
  TAG_FINAL,
  TAG_MESSAGE,
  TAG_PUSH,
  decryptMetadataB64,
  fromB64,
  sealedBoxOpen,
  secretboxOpenB64,
} from "./crypto"

// 向量来源一:ente 官方 crypto_test.go(TestSecretBoxOpenBase64)
const ENTE_OFFICIAL = {
  cipher:
    "KHwRN+RzvTu+jC7mCdkMsqnTPSLvevtZILmcR2OYFbIRPqDyjAl+m8KxD9B5fiEo",
  nonce: "jgfPDOsQh2VdIHWJVSBicMPF2sQW3HIY",
  key: "kercNpvGufMTTHmDwAhz26DgCAvznd1+/buBqKEkWr4=",
  plain: "O1ObUBMv+SCE1qWHD7+WViEIZcAeTp18Y+m9eMlDE1Y=",
}

// 向量来源二:与本模块字节语义一致的 Go 交叉生成器
// (golang.org/x/crypto chacha20/poly1305/nacl,secretstream 拷贝自 ente CLI stream.go)
const GO_VECTOR = {
  streamKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
  streamHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  chunk1: "jKA0U4lNkqZ7gTfna2+aAgc7QnPm/v2IxkHX",
  chunk2:
    "EMoz2K+S3Pufd5g1O9VgB2ALj1oNkc8/VoBb483AWxJ1rdD3/314x+pwNXCaxGt/+4C7TVKKouEIi1IoOLYR/W+OB3uoopGxwAQm1zqJBHoUV4SlufREPBfq+ds/qZaKh5T+4BFOsqUlIfmb65mR3rya6dGRsSsLT60X3Ur3JuivpvDBPH80wjPmGFMWwGUIpbKJmr9MHcFd+VTlF+htfYHdxcEMWhAsGkfmWTL/0xfbeCcgGlYuGIn5Q7epm0G6x+acYMBPW8TGc6ICQy4SaCYKha7drZPeRifiBPgyjZ2j3eoSjyCm5CFBS+EKNIRGJmqhjS/BdKfp7/+CjP/NRlKy0U2CmuHVQPu/ucD4b8tc0lqfhVWuE5NOo2fBzkrZdFx2Nn1fG/LTB9TV2zJQyd+RjpuBUjo9Fc5VQ3o=",
  chunk3: "OYwhyP0scStd4uUz8e41bNOdruWq",
  metaCipher:
    "j7NzS4xW3qY3z3DSYPeMnB3fJcQgp73Y2/Jz0g5fxg1zcpaSomd8tkDfzeBAqABwAbwaj577i7n13sDYWYQ1jAoUNRUZRLs0oHr9enR8fRrOpc4vL+0IdXmDAlZDclhymiGWFL1HWjc1Bf/JvrT15mcZMmBKwXHrYm+MhQ==",
  metaPlain:
    '{"title":"照片 001.jpg","creationTime":1728000000000000,"modificationTime":1728000000000000,"fileType":0}',
  sbKey: "yMfGxcTDwsHAv769vLu6ubi3trW0s7KxsK+urayrqqk=",
  sbNonce: "AAMGCQwPEhUYGx4hJCcqLTAzNjk8P0JF",
  sbCipher: "g0SCH0FwUOTSCqtg7G/GICY7T+HH5xc/X9FPjbbyfA6rmyl76Q==",
  boxPK: "3e61xxEn4GLG/2Pm5ZsfMxIHWsIp8g2SW7auyHxVAB8=",
  boxSK: "EGyImlC8eY6ZsO9Ku51ee+ciOW6Zdy1GxnDT4Vzqsw4=",
  boxSealed:
    "5TgH4cvfF2chnlxDQRjVzKpPoD8n/r5LmoA3THYylCaK0ViW1mV211yD+QOuN4N9sccp716+ZIAiCH/76cP7vPU69QNE",
}

test("secretbox open matches ente official vector", () => {
  const plain = secretboxOpenB64(
    ENTE_OFFICIAL.cipher,
    ENTE_OFFICIAL.nonce,
    fromB64(ENTE_OFFICIAL.key)
  )
  assert.equal(Buffer.from(plain).toString("base64"), ENTE_OFFICIAL.plain)
})

test("secretbox open matches go cross-generated vector", () => {
  const plain = secretboxOpenB64(
    GO_VECTOR.sbCipher,
    GO_VECTOR.sbNonce,
    fromB64(GO_VECTOR.sbKey)
  )
  assert.equal(Buffer.from(plain).toString("utf8"), "ente secretbox vector")
})

test("secretbox open rejects tampered ciphertext", () => {
  const cipher = fromB64(GO_VECTOR.sbCipher)
  cipher[3] ^= 0xff
  assert.throws(() =>
    secretboxOpenB64(
      Buffer.from(cipher).toString("base64"),
      GO_VECTOR.sbNonce,
      fromB64(GO_VECTOR.sbKey)
    )
  )
})
test("sealed box open matches go cross-generated vector", () => {
  const plain = sealedBoxOpen(
    fromB64(GO_VECTOR.boxSealed),
    fromB64(GO_VECTOR.boxPK),
    fromB64(GO_VECTOR.boxSK)
  )
  assert.equal(Buffer.from(plain).toString("utf8"), "ente sealedbox vector")
})

test("secretstream decrypts multi-chunk stream in order", () => {
  const d = new EnteDecryptor(
    fromB64(GO_VECTOR.streamKey),
    fromB64(GO_VECTOR.streamHeader)
  )
  const r1 = d.pull(fromB64(GO_VECTOR.chunk1))
  assert.equal(r1.tag, TAG_MESSAGE)
  assert.equal(Buffer.from(r1.plain).toString("utf8"), "hello ente")

  const r2 = d.pull(fromB64(GO_VECTOR.chunk2))
  assert.equal(r2.tag, TAG_PUSH)
  assert.equal(r2.plain.length, 300)
  assert.ok(r2.plain.every((b) => b === 0xab))

  const r3 = d.pull(fromB64(GO_VECTOR.chunk3))
  assert.equal(r3.tag, TAG_FINAL)
  assert.equal(Buffer.from(r3.plain).toString("utf8"), "tail")
})

test("secretstream rejects out-of-order chunk (state advance)", () => {
  const d = new EnteDecryptor(
    fromB64(GO_VECTOR.streamKey),
    fromB64(GO_VECTOR.streamHeader)
  )
  assert.throws(() => d.pull(fromB64(GO_VECTOR.chunk3)))
})

test("secretstream rejects tampered ciphertext", () => {
  const d = new EnteDecryptor(
    fromB64(GO_VECTOR.streamKey),
    fromB64(GO_VECTOR.streamHeader)
  )
  const c1 = fromB64(GO_VECTOR.chunk1)
  c1[5] ^= 0x01
  assert.throws(() => d.pull(c1))
})

test("metadata single-block decrypt returns final-tag plaintext", () => {
  const plain = decryptMetadataB64(
    fromB64(GO_VECTOR.streamKey),
    GO_VECTOR.streamHeader,
    GO_VECTOR.metaCipher
  )
  assert.equal(Buffer.from(plain).toString("utf8"), GO_VECTOR.metaPlain)
  const parsed = JSON.parse(Buffer.from(plain).toString("utf8"))
  assert.equal(parsed.title, "照片 001.jpg")
  assert.equal(parsed.creationTime, 1728000000000000)
})
