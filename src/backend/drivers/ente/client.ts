import { EnteCollection, EnteDiffResponse } from "./types"

export interface EnteRequest {
  headers: Record<string, string>
}

// transport 注入供测试 mock;默认走全局 fetch
export type EnteTransport = (
  url: string,
  init: EnteRequest,
) => Promise<Response>

export const ENTE_DEFAULT_ENDPOINT = "https://api.ente.com"

export interface EnteClientOptions {
  endpoint: string
  accessToken?: string
  // 分享用 X-Auth-Access-Token,账号用 X-Auth-Token
  tokenHeader?: "X-Auth-Access-Token" | "X-Auth-Token"
  // 公开分享的 linkDeviceToken,携带可复用设备位
  deviceToken?: string
  onDeviceToken?: (token: string) => void
  transport?: EnteTransport
}

export class EnteClient {
  private endpoint: string
  private headers: Record<string, string>
  private transport: EnteTransport
  private deviceToken: string
  private onDeviceToken?: (token: string) => void

  constructor(opts: EnteClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "")
    this.headers = { "X-Client-Package": "io.ente.photos" }
    if (opts.accessToken) {
      this.headers[opts.tokenHeader || "X-Auth-Token"] = opts.accessToken
    }
    this.deviceToken = opts.deviceToken || ""
    this.onDeviceToken = opts.onDeviceToken
    this.transport =
      opts.transport || ((url, init) => fetch(url, { headers: init.headers }))
  }

  private authHeaders(): Record<string, string> {
    if (!this.deviceToken) return this.headers
    return { ...this.headers, "X-Auth-Link-Device-Token": this.deviceToken }
  }

  // museum server 经 X-Link-Device-Token 下发/续期
  private captureDeviceToken(res: Response): void {
    const token = res.headers.get("X-Link-Device-Token")
    if (token && token !== this.deviceToken) {
      this.deviceToken = token
      this.onDeviceToken?.(token)
    }
  }

  private async send(path: string): Promise<Response> {
    const res = await this.transport(this.endpoint + path, {
      headers: this.authHeaders(),
    })
    this.captureDeviceToken(res)
    return res
  }

  // 状态码语义见 museum server collection_link.go 中间件
  private async mapError(path: string, res: Response): Promise<Error> {
    const body = await res.text().catch(() => "")
    if (res.status === 410) {
      // 账号驱动 410 为账号订阅失效,分享驱动 410 为分享被停用
      if ("X-Auth-Token" in this.headers) {
        return new Error("[Ente] 账号订阅已失效(410),请续费或更新凭证")
      }
      return new Error("[Ente] 分享已过期(所有者订阅失效或分享已停用)")
    }
    if (res.status === 403 && /device limit/i.test(body)) {
      return new Error("[Ente] 分享设备数已达上限,请让所有者清理设备")
    }
    if (res.status === 401) {
      if ("X-Auth-Access-Token" in this.headers) {
        let probe: Response | null = null
        try {
          probe = await this.send("/public-collection/info")
        } catch {
          probe = null
        }
        if (probe?.ok) {
          return new Error("[Ente] 分享受密码保护,暂不支持,请使用无密码分享")
        }
        // 探测失败时无法区分密码保护与 token 失效,文案如实告知
        return new Error(
          probe
            ? "[Ente] token 无效或已失效"
            : "[Ente] token 无效或已失效,且密码保护探测失败无法确认原因",
        )
      }
      return new Error("[Ente] token 无效或已失效")
    }
    return new Error(`[Ente] GET ${path} failed: ${res.status} ${body}`)
  }

  // 账号驱动:X-Auth-Token 鉴权
  async getFileDownloadUrl(fileID: number): Promise<string> {
    const data = await this.getJSON<{ url: string }>(
      `/files/download/v3/${fileID}`,
    )
    return data.url
  }

  async getFileThumbUrl(fileID: number): Promise<string> {
    const data = await this.getJSON<{ url: string }>(
      `/files/thumbnail/v3/${fileID}`,
    )
    return data.url
  }

  async getCollections(): Promise<{ collections: EnteCollection[] }> {
    return this.getJSON<{ collections: EnteCollection[] }>(
      "/collections/v2?sinceTime=0",
    )
  }

  // 分享模式匿名分页
  getPublicDiff(sinceTime: number): Promise<EnteDiffResponse> {
    return this.getJSON<EnteDiffResponse>(
      `/public-collection/diff?sinceTime=${sinceTime}`,
    )
  }

  // 账号模式按相册分页
  getCollectionDiff(
    collectionID: number,
    sinceTime: number,
  ): Promise<EnteDiffResponse> {
    return this.getJSON<EnteDiffResponse>(
      `/collections/v2/diff?collectionID=${collectionID}&sinceTime=${sinceTime}`,
    )
  }

  async getJSON<T>(path: string): Promise<T> {
    const res = await this.send(path)
    if (!res.ok) {
      throw await this.mapError(path, res)
    }
    return res.json()
  }

  // 预签名 URL 由 S3 自鉴权,不得携带 ente 头
  async fetchBinary(url: string): Promise<ReadableStream<Uint8Array>> {
    const res = await this.transport(url, { headers: {} })
    if (!res.ok || !res.body) {
      throw new Error(`[Ente] binary fetch failed: ${res.status}`)
    }
    return res.body
  }

  // v3 JSON 端点;v1 307 重定向不使用
  async getDownloadUrl(fileID: number): Promise<string> {
    const data = await this.getJSON<{ url: string }>(
      `/public-collection/files/download/v3/${fileID}`,
    )
    return data.url
  }

  async getThumbUrl(fileID: number): Promise<string> {
    const data = await this.getJSON<{ url: string }>(
      `/public-collection/files/thumbnail/v3/${fileID}`,
    )
    return data.url
  }

}
