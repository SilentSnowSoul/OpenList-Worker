import {
  StorageDriver,
  FileItem,
  calcFileType,
} from "../../internal/driver/base"
import { sortFileItems } from "../../internal/driver/sort"
import { EnteClient, ENTE_DEFAULT_ENDPOINT, EnteTransport } from "../ente/client"
import { DriverEnteShareAddition } from "../ente/types"
import {
  EnteDecryptedFile,
  decryptEnteFile,
  dedupeNames,
  enteDecryptStream,
  paginateEnteDiff,
  parseShareUrl,
} from "../ente/util"

const LIST_CACHE_TTL_MS = 60_000

/** 只读公开分享挂载 */
export class DriverEnteShare implements StorageDriver {
  private client: EnteClient
  private collectionKey: Uint8Array
  private cacheKey: string
  private pendingDeviceToken: string | null = null

  // per-isolate 列表缓存,避免每次 get/下载都重拉 diff
  private static listCache = new Map<
    string,
    { files: EnteDecryptedFile[]; expires: number }
  >()

  constructor(addition: DriverEnteShareAddition, transport?: EnteTransport) {
    const { token, collectionKey } = parseShareUrl(addition.share_url)
    this.collectionKey = collectionKey
    // 键含 endpoint:同 URL 不同服务端的挂载不得互相污染缓存
    this.cacheKey = `${addition.share_url}|${addition.endpoint || ENTE_DEFAULT_ENDPOINT}`
    this.client = new EnteClient({
      endpoint: addition.endpoint || ENTE_DEFAULT_ENDPOINT,
      accessToken: token,
      tokenHeader: "X-Auth-Access-Token",
      deviceToken: addition.device_token,
      onDeviceToken: (t) => {
        // 上一 token 未被 flushPendingDriverState 消费说明未持久化,设备位可能重复占用
        if (this.pendingDeviceToken) {
          console.warn(
            "[EnteShare] linkDeviceToken 未持久化,设备位可能被重复占用",
          )
        }
        this.pendingDeviceToken = t
      },
      transport,
    })
  }

  // flushPendingDriverState 消费后写入 storage addition 持久化
  consumePendingDeviceToken(): string | null {
    const token = this.pendingDeviceToken
    this.pendingDeviceToken = null
    return token
  }

  private async fetchFiles(): Promise<EnteDecryptedFile[]> {
    const cached = DriverEnteShare.listCache.get(this.cacheKey)
    if (cached && cached.expires > Date.now()) return cached.files

    const files = (await paginateEnteDiff((t) => this.client.getPublicDiff(t))).map(
      (f) => decryptEnteFile(f, this.collectionKey),
    )
    dedupeNames(files)
    DriverEnteShare.listCache.set(this.cacheKey, {
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
      // 缩略图密文需解密,thumb 指向 /p 代理路径
      thumb: f.hasThumb
        ? `/api/p${virtualPath === "/" ? "" : virtualPath}/${encodeURIComponent(f.name)}?thumb=1`
        : "",
      raw_url: "",
    }
  }

  async list(virtualPath: string, physicalPath: string): Promise<FileItem[]> {
    if (physicalPath && physicalPath !== "/") return []
    const files = await this.fetchFiles()
    return sortFileItems(
      files.map((f) => this.toFileItem(f, virtualPath)),
      "name",
      "asc",
    )
  }

  private async findFile(physicalPath: string): Promise<EnteDecryptedFile> {
    const name = physicalPath.split("/").filter(Boolean).pop() || ""
    const files = await this.fetchFiles()
    const f = files.find((x) => x.name === name)
    if (!f) throw new Error(`[EnteShare] file not found: ${name}`)
    return f
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
    return this.toFileItem(await this.findFile(physicalPath), virtualPath)
  }

  // v1 secretstream 不支持随机访问,Range 语义由 server 层回退 200 全量
  async createReadStream(
    _physicalPath: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const f = await this.findFile(_physicalPath)
    const url = await this.client.getDownloadUrl(f.id)
    const body = await this.client.fetchBinary(url)
    return enteDecryptStream(body, f.fileKey, f.fileDecryptionHeader)
  }

  async createThumbStream(
    physicalPath: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const f = await this.findFile(physicalPath)
    if (!f.hasThumb) throw new Error(`[EnteShare] no thumbnail: ${f.name}`)
    const url = await this.client.getThumbUrl(f.id)
    const body = await this.client.fetchBinary(url)
    return enteDecryptStream(body, f.fileKey, f.thumbnailDecryptionHeader)
  }

  async mkdir(_virtualPath: string, _physicalPath: string): Promise<void> {
    throw new Error("[EnteShare] read-only storage")
  }

  async rename(
    _virtualPath: string,
    _physicalPath: string,
    _newName: string,
  ): Promise<void> {
    throw new Error("[EnteShare] read-only storage")
  }

  async remove(
    _virtualPath: string,
    _physicalPath: string,
    _names: string[],
  ): Promise<void> {
    throw new Error("[EnteShare] read-only storage")
  }

  async move(
    _srcDir: string,
    _dstDir: string,
    _names: string[],
    _srcPhys: string,
    _dstPhys: string,
  ): Promise<void> {
    throw new Error("[EnteShare] read-only storage")
  }

  async copy(
    _srcDir: string,
    _dstDir: string,
    _names: string[],
    _srcPhys: string,
    _dstPhys: string,
  ): Promise<void> {
    throw new Error("[EnteShare] read-only storage")
  }

  async put(
    _virtualPath: string,
    _physicalPath: string,
    _content: Buffer,
  ): Promise<void> {
    throw new Error("[EnteShare] read-only storage")
  }
}
