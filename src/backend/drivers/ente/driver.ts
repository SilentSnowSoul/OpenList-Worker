import { StorageDriver, FileItem, calcFileType } from "../../internal/driver/base"
import { sortFileItems } from "../../internal/driver/sort"
import { EnteClient, ENTE_DEFAULT_ENDPOINT, EnteTransport } from "./client"
import { DriverEnteAddition } from "./types"
import {
  EnteDecryptedCollection,
  EnteDecryptedFile,
  decryptEnteCollection,
  decryptEnteFile,
  dedupeNames,
  enteDecryptStream,
  paginateEnteDiff,
} from "./util"
import { fromB64 } from "./crypto"

const LIST_CACHE_TTL_MS = 60_000

/** 只读账号挂载:根目录每个 collection 一文件夹 */
export class DriverEnte implements StorageDriver {
  private client: EnteClient
  private masterKey!: Uint8Array
  private secretKey?: Uint8Array
  private showHidden: boolean
  // 键含 token/secret_key/endpoint:不同凭证配置不得互相污染缓存
  private cacheKey: string
  // token 非空即凭证模式:密码字段仅保留配置,对齐上游 token+password 合法组合
  // token 为空的纯密码模式:Worker 不实现登录,init 显式拒绝
  private passwordLogin: boolean

  // per-isolate 缓存,键含 token 防跨账号串扰
  private static collectionsCache = new Map<
    string,
    { collections: EnteDecryptedCollection[]; expires: number }
  >()
  private static filesCache = new Map<
    string,
    { files: EnteDecryptedFile[]; expires: number }
  >()

  constructor(addition: DriverEnteAddition, transport?: EnteTransport) {
    this.passwordLogin = !addition.token && !!(addition.email || addition.password)
    if (!this.passwordLogin) {
      this.masterKey = fromB64(addition.master_key)
      this.secretKey = addition.secret_key
        ? fromB64(addition.secret_key)
        : undefined
    }
    this.showHidden = !!addition.show_hidden
    this.cacheKey = `${addition.token}|${addition.secret_key || ""}|${addition.endpoint || ENTE_DEFAULT_ENDPOINT}`
    this.client = new EnteClient({
      endpoint: addition.endpoint || ENTE_DEFAULT_ENDPOINT,
      accessToken: addition.token,
      tokenHeader: "X-Auth-Token",
      transport,
    })
  }

  async init(): Promise<void> {
    if (this.passwordLogin) {
      throw new Error(
        "password login is not implemented on Worker (memory limit); use APIPages credentials (token/master_key) or OpenList Go backend",
      )
    }
  }

  // 缓存解密后未过滤的 collection,hidden 按实例配置过滤
  private async fetchCollections(): Promise<EnteDecryptedCollection[]> {
    const cached = DriverEnte.collectionsCache.get(this.cacheKey)
    if (cached && cached.expires > Date.now()) {
      return cached.collections.filter((a) => this.showHidden || !a.hidden)
    }

    const { collections } = await this.client.getCollections()
    const decrypted: EnteDecryptedCollection[] = []
    for (const c of collections) {
      if (c.isDeleted) continue
      try {
        decrypted.push(decryptEnteCollection(c, this.masterKey, this.secretKey))
      } catch (e) {
        console.warn(`[Ente] skip collection ${c.id}:`, (e as Error).message)
      }
    }
    decrypted.sort((a, b) => a.modifiedMs - b.modifiedMs || a.id - b.id)
    dedupeNames(decrypted)
    DriverEnte.collectionsCache.set(this.cacheKey, {
      collections: decrypted,
      expires: Date.now() + LIST_CACHE_TTL_MS,
    })
    return decrypted.filter((a) => this.showHidden || !a.hidden)
  }

  private async fetchFiles(collection: EnteDecryptedCollection): Promise<EnteDecryptedFile[]> {
    const cacheKey = `${this.cacheKey}:${collection.id}`
    const cached = DriverEnte.filesCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.files

    const files = (await paginateEnteDiff((t) =>
      this.client.getCollectionDiff(collection.id, t),
    )).map((f) => decryptEnteFile(f, collection.key))
    dedupeNames(files)
    DriverEnte.filesCache.set(cacheKey, {
      files,
      expires: Date.now() + LIST_CACHE_TTL_MS,
    })
    return files
  }

  private toFileItem(f: EnteDecryptedFile, virtualPath: string): FileItem {
    return {
      name: f.name,
      size: f.size,
      is_dir: false,
      modified: new Date(f.modifiedMs).toISOString(),
      sign: String(f.id),
      type: calcFileType(f.name, false),
      thumb: f.hasThumb
        ? `/api/p${virtualPath === "/" ? "" : virtualPath}/${encodeURIComponent(f.name)}?thumb=1`
        : "",
      raw_url: "",
    }
  }

  private toCollectionItem(a: EnteDecryptedCollection): FileItem {
    return {
      name: a.name,
      size: 0,
      is_dir: true,
      modified: new Date(a.modifiedMs).toISOString(),
      sign: String(a.id),
      type: 1,
      raw_url: "",
    }
  }

  async list(virtualPath: string, physicalPath: string): Promise<FileItem[]> {
    if (!physicalPath || physicalPath === "/") {
      return sortFileItems(
        (await this.fetchCollections()).map((a) => this.toCollectionItem(a)),
        "name",
        "asc",
      )
    }
    const collection = await this.findCollection(physicalPath)
    if (!collection) return []
    if (physicalPath.split("/").filter(Boolean).length > 1) return []
    const files = await this.fetchFiles(collection)
    return sortFileItems(
      files.map((f) => this.toFileItem(f, virtualPath)),
      "name",
      "asc",
    )
  }

  private async findCollection(
    physicalPath: string,
  ): Promise<EnteDecryptedCollection | undefined> {
    const name = physicalPath.split("/").filter(Boolean)[0]
    if (!name) return undefined
    const collections = await this.fetchCollections()
    return collections.find((a) => a.name === name)
  }

  private async findFile(
    physicalPath: string,
  ): Promise<{ collection: EnteDecryptedCollection; file: EnteDecryptedFile }> {
    const parts = physicalPath.split("/").filter(Boolean)
    const name = parts[parts.length - 1]
    const collectionName = parts[0]
    const collections = await this.fetchCollections()
    const collection = collections.find((a) => a.name === collectionName)
    if (!collection) throw new Error(`[Ente] collection not found: ${collectionName}`)
    const files = await this.fetchFiles(collection)
    const file = files.find((x) => x.name === name)
    if (!file) throw new Error(`[Ente] file not found: ${name}`)
    return { collection, file }
  }

  async get(virtualPath: string, physicalPath: string): Promise<FileItem> {
    if (!physicalPath || physicalPath === "/") {
      return {
        name: "root",
        size: 0,
        is_dir: true,
        modified: new Date().toISOString(),
        sign: "",
        type: 1,
        raw_url: "",
      }
    }
    const parts = physicalPath.split("/").filter(Boolean)
    if (parts.length === 1) {
      const collection = await this.findCollection(physicalPath)
      if (!collection) throw new Error(`[Ente] collection not found: ${parts[0]}`)
      return this.toCollectionItem(collection)
    }
    const { file } = await this.findFile(physicalPath)
    return this.toFileItem(file, virtualPath)
  }

  // v1 secretstream 不支持随机访问,Range 语义由 server 层回退 200 全量
  async createReadStream(
    physicalPath: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const { file } = await this.findFile(physicalPath)
    const url = await this.client.getFileDownloadUrl(file.id)
    const body = await this.client.fetchBinary(url)
    return enteDecryptStream(body, file.fileKey, file.fileDecryptionHeader)
  }

  async createThumbStream(
    physicalPath: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const { file } = await this.findFile(physicalPath)
    if (!file.hasThumb) throw new Error(`[Ente] no thumbnail: ${file.name}`)
    const url = await this.client.getFileThumbUrl(file.id)
    const body = await this.client.fetchBinary(url)
    return enteDecryptStream(body, file.fileKey, file.thumbnailDecryptionHeader)
  }

  async mkdir(_virtualPath: string, _physicalPath: string): Promise<void> {
    throw new Error("[Ente] read-only storage")
  }

  async rename(
    _virtualPath: string,
    _physicalPath: string,
    _newName: string,
  ): Promise<void> {
    throw new Error("[Ente] read-only storage")
  }

  async remove(
    _virtualPath: string,
    _physicalPath: string,
    _names: string[],
  ): Promise<void> {
    throw new Error("[Ente] read-only storage")
  }

  async move(
    _srcDir: string,
    _dstDir: string,
    _names: string[],
    _srcPhys: string,
    _dstPhys: string,
  ): Promise<void> {
    throw new Error("[Ente] read-only storage")
  }

  async copy(
    _srcDir: string,
    _dstDir: string,
    _names: string[],
    _srcPhys: string,
    _dstPhys: string,
  ): Promise<void> {
    throw new Error("[Ente] read-only storage")
  }

  async put(
    _virtualPath: string,
    _physicalPath: string,
    _content: Buffer,
  ): Promise<void> {
    throw new Error("[Ente] read-only storage")
  }
}
