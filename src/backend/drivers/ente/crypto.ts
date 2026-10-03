import nacl from "tweetnacl"
import { chacha20, hchacha } from "@noble/ciphers/chacha"
// _poly1305 为 noble 私有导出,1.x 内保持稳定;升级主版本需回归本文件测试向量
import { poly1305 } from "@noble/ciphers/_poly1305"
import { u32, utf8ToBytes, equalBytes } from "@noble/ciphers/utils"
import { blake2b } from "@noble/hashes/blake2b"

export const ABYTES = 17
export const TAG_MESSAGE = 0
export const TAG_PUSH = 1
export const TAG_REKEY = 2
export const TAG_FINAL = TAG_PUSH | TAG_REKEY

export function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"))
}

export function secretboxOpenB64(
  cipherB64: string,
  nonceB64: string,
  key: Uint8Array
): Uint8Array {
  const plain = nacl.secretbox.open(
    fromB64(cipherB64),
    fromB64(nonceB64),
    key
  )
  if (!plain) throw new Error("ente: secretbox open failed")
  return plain
}

// x/crypto box.SealAnonymous:nonce = blake2b-24(epk ‖ recipientPK)
export function sealedBoxOpen(
  cipher: Uint8Array,
  publicKey: Uint8Array,
  secretKey: Uint8Array
): Uint8Array {
  if (cipher.length < 48) throw new Error("ente: sealed box too short")
  const epk = cipher.subarray(0, 32)
  const nonceInput = new Uint8Array(64)
  nonceInput.set(epk, 0)
  nonceInput.set(publicKey, 32)
  const nonce = blake2b(nonceInput, { dkLen: 24 })
  const plain = nacl.box.open(cipher.subarray(32), nonce, epk, secretKey)
  if (!plain) throw new Error("ente: sealed box open failed")
  return plain
}

export function boxPublicKey(secretKey: Uint8Array): Uint8Array {
  return nacl.box.keyPair.fromSecretKey(secretKey).publicKey
}

const CHACHA_CONST = u32(utf8ToBytes("expand 32-byte k"))

function le64(n: number): Uint8Array {
  const b = new Uint8Array(8)
  let v = n
  for (let i = 0; i < 8; i++) {
    b[i] = v & 0xff
    v = Math.floor(v / 256)
  }
  return b
}

const LE64_ZERO = le64(0)

// ente 自定义 secretstream(libsodium secretstream 的 Go 移植),字节布局:
// 密文 = [tag^ks1[0]] ‖ [明文^ks(128..)] ‖ [mac16]
// mac 输入 = [encTag ‖ ks1[1:64]] ‖ cipher[1:1+mlen] ‖ pad(mlen&15) ‖ le64(0) ‖ le64(64+mlen)
export class EnteDecryptor {
  private key: Uint8Array
  private nonce: Uint8Array

  constructor(key: Uint8Array, header: Uint8Array) {
    if (key.length !== 32) throw new Error("ente: key must be 32 bytes")
    if (header.length !== 24) throw new Error("ente: header must be 24 bytes")
    const o32 = new Uint32Array(8)
    hchacha(CHACHA_CONST, u32(key), u32(header.subarray(0, 16)), o32)
    this.key = new Uint8Array(o32.buffer, o32.byteOffset, 32)
    this.nonce = new Uint8Array(12)
    this.nonce[0] = 1
    this.nonce.set(header.subarray(16, 24), 4)
  }

  pull(cipher: Uint8Array): { plain: Uint8Array; tag: number } {
    if (cipher.length < ABYTES) {
      throw new Error("ente: ciphertext too short")
    }
    const mlen = cipher.length - ABYTES
    const block01 = chacha20(
      this.key,
      this.nonce,
      new Uint8Array(128),
      undefined,
      0
    )
    const mac = poly1305.create(block01.subarray(0, 32))
    const macBlock = new Uint8Array(64)
    macBlock[0] = cipher[0]
    macBlock.set(block01.subarray(65, 128), 1)
    mac.update(macBlock)
    mac.update(cipher.subarray(1, 1 + mlen))
    if (mlen & 15) mac.update(new Uint8Array(mlen & 15))
    mac.update(LE64_ZERO)
    mac.update(le64(64 + mlen))
    const digest = mac.digest()
    if (!equalBytes(digest, cipher.subarray(1 + mlen))) {
      throw new Error("ente: MAC verification failed")
    }
    const tag = cipher[0] ^ block01[64]
    const plain = chacha20(
      this.key,
      this.nonce,
      cipher.subarray(1, 1 + mlen),
      undefined,
      2
    )
    // nonce 前进:nonce[4:12] ^= mac;nonce[0:4] 小端 +1(带进位)
    for (let i = 4; i < 12; i++) this.nonce[i] ^= digest[i - 4]
    let c = 1
    for (let i = 0; i < 4; i++) {
      c += this.nonce[i]
      this.nonce[i] = c & 0xff
      c >>>= 8
    }
    return { plain, tag }
  }
}

// 文件 metadata 为单块 secretstream,tag 必须为 TagFinal
export function decryptMetadataB64(
  key: Uint8Array,
  headerB64: string,
  cipherB64: string
): Uint8Array {
  const d = new EnteDecryptor(key, fromB64(headerB64))
  const { plain, tag } = d.pull(fromB64(cipherB64))
  if (tag !== TAG_FINAL) throw new Error("ente: metadata tag is not final")
  return plain
}
