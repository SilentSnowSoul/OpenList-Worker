import {
  DriverIwaraAddition,
  IwaraEnvelope,
  IwaraFile,
  IwaraFolder,
} from "./types"

const DEFAULT_ENDPOINT = "https://www.iwara.zip"
const TOKEN_IDLE_TIMEOUT = 60 * 60 * 1000
type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return "Iwara API request failed"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function tokenInvalid(status: number, response: unknown): boolean {
  if (status === 401) return true
  return typeof response === "string" && /could not validate access_token|token expired|invalid token|unauthorized|authentication/i.test(response)
}

class IwaraRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}
function envelope<T>(value: unknown): IwaraEnvelope<T> {
  if (!isObject(value)) return {}
  const result: IwaraEnvelope<T> = {}
  if ("data" in value) result.data = value.data as T
  if (typeof value._status === "string") result._status = value._status
  if (typeof value.status === "string") result.status = value.status
  if ("response" in value) result.response = value.response
  return result
}

function objectData(value: unknown): JsonObject {
  return isObject(value) ? value : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

export class ClientIwara {
  private readonly endpoint: string
  private readonly apiKey1: string
  private readonly apiKey2: string
  private token = ""
  private accountId = ""
  private tokenUsed = 0
  private authPromise?: Promise<void>

  constructor(addition: DriverIwaraAddition) {
    this.endpoint = (addition.endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, "")
    this.apiKey1 = (addition.api_key_1 || "").trim()
    this.apiKey2 = (addition.api_key_2 || "").trim()
  }

  async init(): Promise<void> {
    if (!this.endpoint) throw new Error("[IwaraZip] endpoint is required")
    if (!this.apiKey1 || !this.apiKey2) throw new Error("[IwaraZip] api_key_1 and api_key_2 are required")
    await this.authorize()
  }

  private async post<T = unknown>(method: string, body: URLSearchParams | FormData): Promise<IwaraEnvelope<T>> {
    const headers = body instanceof URLSearchParams
      ? { "Content-Type": "application/x-www-form-urlencoded" }
      : undefined
    const response = await fetch(`${this.endpoint}/api/v2/${method}`, {
      method: "POST",
      headers,
      body,
    })
    const result = envelope<T>(await response.json().catch(() => null))
    const status = result._status || result.status
    if (response.status === 429) {
      throw new IwaraRequestError(errorMessage(result.response || "API rate limit reached (HTTP 429)"), response.status)
    }
    if (status === "error") {
      throw new IwaraRequestError(errorMessage(result.response), response.status)
    }
    if (!response.ok) throw new IwaraRequestError(errorMessage(result.response) || `[IwaraZip] HTTP ${response.status}`, response.status)
    return result
  }

  private async authorize(): Promise<void> {
    if (this.authPromise) return this.authPromise
    this.authPromise = (async () => {
      const form = new URLSearchParams({ key1: this.apiKey1, key2: this.apiKey2 })
      const result = await this.post<JsonObject>("authorize", form)
      const data = objectData(result.data)
      this.token = stringValue(data.access_token)
      this.accountId = stringValue(data.account_id)
      this.tokenUsed = Date.now()
      if (!this.token || !this.accountId) {
        throw new Error("[IwaraZip] authorize response missing access_token or account_id")
      }
    })()
    try {
      await this.authPromise
    } finally {
      this.authPromise = undefined
    }
  }

  private invalidate(token: string): void {
    if (this.token === token) {
      this.token = ""
      this.accountId = ""
      this.tokenUsed = 0
    }
  }

  private async ensureToken(): Promise<void> {
    if (this.token && this.accountId && Date.now() - this.tokenUsed < TOKEN_IDLE_TIMEOUT) return
    await this.authorize()
  }

  private async request<T = unknown>(method: string, params: Record<string, string> = {}, retried = false): Promise<T> {
    await this.ensureToken()
    const token = this.token
    const accountId = this.accountId
    const form = new URLSearchParams({ access_token: token, account_id: accountId })
    for (const [key, value] of Object.entries(params)) form.set(key, value)
    try {
      const result = await this.post<T>(method, form)
      this.tokenUsed = Date.now()
      return result.data as T
    } catch (error) {
      if (!retried && error instanceof IwaraRequestError && tokenInvalid(error.status, error.message)) {
        this.invalidate(token)
        await this.ensureToken()
        return this.request(method, params, true)
      }
      throw error
    }
  }

  async listFolder(folderId?: string): Promise<{ folders: IwaraFolder[]; files: IwaraFile[] }> {
    const data = objectData(await this.request("folder/listing", { parent_folder_id: folderId || "" }))
    const folders = Array.isArray(data.folders) ? data.folders : []
    const files = Array.isArray(data.files) ? data.files : []
    return {
      folders: folders.filter(isObject) as unknown as IwaraFolder[],
      files: files.filter(isObject) as unknown as IwaraFile[],
    }
  }

  async download(fileId: string): Promise<string> {
    const data = objectData(await this.request("file/download", { file_id: fileId }))
    return stringValue(data.download_url)
  }

  async createFolder(parentId: string | undefined, name: string): Promise<void> {
    await this.request("folder/create", { folder_name: name, parent_id: parentId || "" })
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request("file/delete", { file_id: fileId })
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.request("folder/delete", { folder_id: folderId })
  }

  async editFile(fileId: string, name: string): Promise<void> {
    await this.request("file/edit", { file_id: fileId, filename: name })
  }

  async editFolder(folderId: string, name: string): Promise<void> {
    await this.request("folder/edit", { folder_id: folderId, folder_name: name })
  }

  async moveFile(fileId: string, folderId: string | undefined): Promise<void> {
    await this.request("file/move", { file_id: fileId, new_parent_folder_id: folderId || "" })
  }

  async moveFolder(folderId: string, parentId: string | undefined): Promise<void> {
    await this.request("folder/move", { folder_id: folderId, new_parent_folder_id: parentId || "" })
  }

  async copyFile(fileId: string, folderId: string | undefined): Promise<void> {
    await this.request("file/copy", { file_id: fileId, copy_to_folder_id: folderId || "" })
  }

  async upload(folderId: string | undefined, filename: string, content: Buffer, retried = false): Promise<void> {
    await this.ensureToken()
    const token = this.token
    const accountId = this.accountId
    const form = new FormData()
    form.append("access_token", token)
    form.append("account_id", accountId)
    form.append("folder_id", folderId || "")
    form.append("upload_file", new Blob([new Uint8Array(content)], { type: "application/octet-stream" }), filename)
    try {
      await this.post("file/upload", form)
      this.tokenUsed = Date.now()
    } catch (error) {
      if (!retried && error instanceof IwaraRequestError && tokenInvalid(error.status, error.message)) {
        this.invalidate(token)
        await this.ensureToken()
        return this.upload(folderId, filename, content, true)
      }
      throw error
    }
  }
}
