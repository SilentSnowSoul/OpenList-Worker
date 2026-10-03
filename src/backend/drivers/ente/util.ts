import {
  ABYTES,
  EnteDecryptor,
  TAG_FINAL,
  decryptMetadataB64,
  fromB64,
  secretboxOpenB64,
  sealedBoxOpen,
  boxPublicKey,
} from "./crypto"
import { EnteCollection, EnteDiffFile, EnteDiffResponse } from "./types"

const BS58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

export function bs58Decode(s: string): Uint8Array {
  let num = 0n
  for (const c of s) {
    const v = BS58_ALPHABET.indexOf(c)
    if (v < 0) throw new Error(`invalid base58 character: ${c}`)
    num = num * 58n + BigInt(v)
  }
  const bytes: number[] = []
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn))
    num >>= 8n
  }
  for (const c of s) {
    if (c !== "1") break
    bytes.unshift(0)
  }
  return new Uint8Array(bytes)
}

export interface EnteShareTarget {
  token: string
  collectionKey: Uint8Array
}

// https://share.ente.io/c/<token>#<bs58(collectionKey)> 或
// https://albums.ente.com/?t=<token>#<bs58(collectionKey)>;fragment 不发给 server
export function parseShareUrl(shareUrl: string): EnteShareTarget {
  const u = new URL(shareUrl)
  const m = u.pathname.match(/\/c\/([^/?#]+)/)
  const token = m ? m[1] : u.searchParams.get("t") ?? ""
  if (!token || !u.hash) throw new Error("[EnteShare] invalid share URL")
  const collectionKey = bs58Decode(decodeURIComponent(u.hash.slice(1)))
  if (collectionKey.length !== 32) {
    throw new Error("[EnteShare] invalid collection key in share URL")
  }
  return { token, collectionKey }
}

export interface EnteDecryptedFile {
  id: number
  name: string
  size: number
  modifiedMs: number
  fileKey: Uint8Array
  fileDecryptionHeader: string
  thumbnailDecryptionHeader: string
  hasThumb: boolean
}

function parseJson(b64Header: string, b64Cipher: string, key: Uint8Array) {
  const plain = decryptMetadataB64(key, b64Header, b64Cipher)
  return JSON.parse(new TextDecoder().decode(plain))
}

export function decryptEnteFile(
  f: EnteDiffFile,
  collectionKey: Uint8Array,
): EnteDecryptedFile {
  const fileKey = secretboxOpenB64(
    f.encryptedKey,
    f.keyDecryptionNonce,
    collectionKey,
  )
  const meta =
    f.metadata?.encryptedData && f.metadata.decryptionHeader
      ? parseJson(f.metadata.decryptionHeader, f.metadata.encryptedData, fileKey)
      : {}
  let pubMagic: Record<string, unknown> = {}
  if (f.pubMagicMetadata?.data) {
    try {
      pubMagic = parseJson(
        f.pubMagicMetadata.header,
        f.pubMagicMetadata.data,
        fileKey,
      )
    } catch {
      pubMagic = {}
    }
  }
  const editedName = pubMagic.editedName
  const editedTime = pubMagic.editedTime
  const name =
    (typeof editedName === "string" && editedName) ||
    (typeof meta.title === "string" && meta.title) ||
    `Ente-${f.id}`
  const timeUs =
    (typeof editedTime === "number" && editedTime) ||
    (typeof meta.creationTime === "number" && meta.creationTime) ||
    f.updationTime
  return {
    id: f.id,
    // 名称中的路径分隔符替换,防止逃逸挂载根
    name: name.replace(/\//g, "_"),
    size: decryptedSize(f.info?.fileSize || 0),
    modifiedMs: Math.floor(timeUs / 1000),
    fileKey,
    fileDecryptionHeader: f.file?.decryptionHeader || "",
    thumbnailDecryptionHeader: f.thumbnail?.decryptionHeader || "",
    hasThumb: (f.info?.thumbSize || 0) > 0 && !!f.thumbnail?.decryptionHeader,
  }
}

// 同名文件确定性追加 " (2)"(置于扩展名前);入参须已按稳定顺序排列
// museum 的 fileSize/thumbSize 是密文大小:每 chunk(4MiB 明文)含 ABYTES
// 字节 secretstream 开销,明文大小须按 chunk 数扣除;对齐 Go 侧 decryptedSize
export function decryptedSize(encryptedSize: number): number {
  if (encryptedSize <= 0) return 0
  const cipherChunkSize = 4 * 1024 * 1024 + ABYTES
  const chunks = Math.ceil(encryptedSize / cipherChunkSize)
  return encryptedSize - chunks * ABYTES
}

export function dedupeNames<T extends { name: string }>(files: T[]): void {
  const seen = new Map<string, number>()
  for (const f of files) {
    const n = seen.get(f.name) || 0
    seen.set(f.name, n + 1)
    if (n > 0) {
      const dot = f.name.lastIndexOf(".")
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name
      const ext = dot > 0 ? f.name.slice(dot) : ""
      f.name = `${stem} (${n + 1})${ext}`
    }
  }
}

// diff 分页公共循环:Map 按 id 覆盖、isDeleted 删除、`-` 墓碑过滤,
// 水位不前进即终止防死循环;返回按稳定顺序排列的存活条目
export async function paginateEnteDiff(
  fetchPage: (sinceTime: number) => Promise<EnteDiffResponse>,
): Promise<EnteDiffFile[]> {
  const byID = new Map<number, EnteDiffFile>()
  let sinceTime = 0
  let hasMore = true
  while (hasMore) {
    const prev = sinceTime
    const page = await fetchPage(sinceTime)
    for (const f of page.diff || []) {
      sinceTime = Math.max(sinceTime, f.updationTime || 0)
      if (f.isDeleted) byID.delete(f.id)
      else byID.set(f.id, f)
    }
    hasMore = page.hasMore
    if (hasMore && sinceTime === prev) break
  }
  return [...byID.values()]
    .filter((f) => f.file?.encryptedData !== "-")
    .sort((a, b) => a.updationTime - b.updationTime || a.id - b.id)
}

// collection(账号驱动):collectionKey 解出后用于 collection 名/文件元数据
export interface EnteDecryptedCollection {
  id: number
  key: Uint8Array
  name: string
  hidden: boolean
  modifiedMs: number
}

// keyDecryptionNonce 有值为自有 collection(masterKey secretbox),无值为共享 collection
// (sealed box 送达本人公钥,需 secret_key)
export function decryptEnteCollection(
  c: EnteCollection,
  masterKey: Uint8Array,
  secretKey?: Uint8Array,
): EnteDecryptedCollection {
  const key = c.keyDecryptionNonce
    ? secretboxOpenB64(c.encryptedKey, c.keyDecryptionNonce, masterKey)
    : secretKey
      ? sealedBoxOpen(
          fromB64(c.encryptedKey),
          boxPublicKey(secretKey),
          secretKey,
        )
      : throwNoSecretKey()
  const plainName =
    c.name ||
    (c.encryptedName && c.nameDecryptionNonce
      ? new TextDecoder().decode(
          secretboxOpenB64(c.encryptedName, c.nameDecryptionNonce, key),
        )
      : "")
  let hidden = false
  if (c.magicMetadata?.data) {
    try {
      hidden = parseJson(c.magicMetadata.header, c.magicMetadata.data, key).visibility === 2
    } catch {
      hidden = false
    }
  }
  return {
    id: c.id,
    key,
    name: (plainName || `Ente-${c.id}`).replace(/\//g, "_"),
    hidden,
    modifiedMs: Math.floor(c.updationTime / 1000),
  }
}

function throwNoSecretKey(): never {
  throw new Error("[Ente] 共享相册需要 secret_key")
}

// ente 上传端按 4MB 明文分块,接收端须按固定密文边界(4MB+ABYTES)逐块 pull,
// 末块为剩余全部;cipherChunkSize 仅测试注入
export function enteDecryptStream(
  body: ReadableStream<Uint8Array>,
  key: Uint8Array,
  headerB64: string,
  cipherChunkSize = 4 * 1024 * 1024 + ABYTES,
): ReadableStream<Uint8Array> {
  const dec = new EnteDecryptor(key, fromB64(headerB64))
  const reader = body.getReader()
  let pending = new Uint8Array(0)
  let finished = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        controller.close()
        return
      }
      while (pending.length < cipherChunkSize) {
        const { done, value } = await reader.read()
        if (!value) break
        const merged = new Uint8Array(pending.length + value.length)
        merged.set(pending)
        merged.set(value, pending.length)
        pending = merged
        if (done) break
      }
      if (pending.length === 0) {
        throw new Error("[Ente] stream ended before final tag")
      }
      const take = Math.min(pending.length, cipherChunkSize)
      const { plain, tag } = dec.pull(pending.subarray(0, take))
      pending = pending.subarray(take)
      controller.enqueue(plain)
      if (tag === TAG_FINAL) {
        finished = true
        controller.close()
      }
    },
    cancel() {
      reader.cancel().catch(() => {})
    },
  })
}
