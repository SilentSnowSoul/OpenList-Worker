import {
  StorageDriver,
  FileItem,
  calcFileType,
} from "../../internal/driver/base"
import { DriverIwaraAddition, IwaraFile, IwaraFolder } from "./types"
import { ClientIwara } from "./util"

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return fallback
}

function number(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function folderName(folder: IwaraFolder): string {
  return text(folder.folderName || folder.folder_name || folder.name, "folder")
}

function fileName(file: IwaraFile): string {
  return text(file.filename || file.file_name || file.name, "file")
}

function folderDate(folder: IwaraFolder): string {
  return text(folder.date_updated || folder.updated_at || folder.date_added || folder.created_at, new Date().toISOString())
}

function fileDate(file: IwaraFile): string {
  return text(file.date_updated || file.updated_at || file.date_added || file.created_at, new Date().toISOString())
}

function id(value: string | number): string {
  return String(value)
}

function folderItem(folder: IwaraFolder): FileItem {
  const name = folderName(folder)
  return {
    name,
    size: number(folder.size ?? folder.totalSize ?? folder.total_size),
    is_dir: true,
    modified: folderDate(folder),
    sign: id(folder.id),
    type: 1,
    raw_url: "",
  }
}

function fileItem(file: IwaraFile): FileItem {
  const name = fileName(file)
  return {
    name,
    size: number(file.size ?? file.fileSize ?? file.file_size),
    is_dir: false,
    modified: fileDate(file),
    sign: id(file.id),
    type: calcFileType(name, false),
    raw_url: "",
  }
}

interface Entry {
  id: string
  isDir: boolean
  name: string
}

export class DriverIwara implements StorageDriver {
  private readonly client: ClientIwara
  private readonly rootFolderId?: string

  constructor(addition: DriverIwaraAddition) {
    this.client = new ClientIwara(addition)
    this.rootFolderId = addition.root_folder_id || undefined
  }

  async init(): Promise<void> {
    await this.client.init()
  }

  async list(_virtualPath: string, physicalPath: string): Promise<FileItem[]> {
    const folderId = await this.resolveFolderId(physicalPath)
    const listing = await this.client.listFolder(folderId)
    return [...listing.folders.map(folderItem), ...listing.files.map(fileItem)]
  }

  async get(_virtualPath: string, physicalPath: string): Promise<FileItem> {
    const clean = this.cleanPath(physicalPath)
    const name = clean.split("/").filter(Boolean).pop() || "root"
    if (!clean) {
      return {
        name,
        size: 0,
        is_dir: true,
        modified: new Date().toISOString(),
        sign: this.rootFolderId || "",
        type: 1,
        raw_url: "",
      }
    }
    const entry = await this.resolveEntry(clean)
    const listing = await this.client.listFolder(this.parentPath(clean) ? await this.resolveFolderId(this.parentPath(clean)) : this.rootFolderId)
    const file = listing.files.find((candidate) => id(candidate.id) === entry.id)
    if (file) return fileItem(file)
    const folder = listing.folders.find((candidate) => id(candidate.id) === entry.id)
    if (folder) return folderItem(folder)
    throw new Error(`[IwaraZip] '${name}' not found`)
  }

  async link(_virtualPath: string, physicalPath: string): Promise<{ url: string; headers?: Record<string, string> }> {
    const entry = await this.resolveEntry(this.cleanPath(physicalPath))
    if (entry.isDir) throw new Error("[IwaraZip] cannot get link for a folder")
    const url = await this.client.download(entry.id)
    if (!url) throw new Error("[IwaraZip] download response missing signed URL")
    return { url }
  }

  async mkdir(_virtualPath: string, physicalPath: string): Promise<void> {
    const clean = this.cleanPath(physicalPath)
    const parts = clean.split("/").filter(Boolean)
    const name = parts.pop() || "new_folder"
    const parentId = await this.resolveFolderId("/" + parts.join("/"))
    await this.client.createFolder(parentId, name)
  }

  async rename(_virtualPath: string, physicalPath: string, newName: string): Promise<void> {
    const entry = await this.resolveEntry(this.cleanPath(physicalPath))
    if (entry.isDir) await this.client.editFolder(entry.id, newName)
    else await this.client.editFile(entry.id, newName)
  }

  async remove(_virtualPath: string, physicalPath: string, _names: string[]): Promise<void> {
    const entry = await this.resolveEntry(this.cleanPath(physicalPath))
    if (entry.isDir) await this.client.deleteFolder(entry.id)
    else await this.client.deleteFile(entry.id)
  }

  async move(
    _srcDir: string,
    dstDir: string,
    _names: string[],
    srcPhysical: string,
    _dstPhysical: string,
  ): Promise<void> {
    const entry = await this.resolveEntry(this.cleanPath(srcPhysical))
    const destination = await this.resolveFolderId(dstDir)
    if (entry.isDir) await this.client.moveFolder(entry.id, destination)
    else await this.client.moveFile(entry.id, destination)
  }

  async copy(
    _srcDir: string,
    dstDir: string,
    _names: string[],
    srcPhysical: string,
    _dstPhysical: string,
  ): Promise<void> {
    const entry = await this.resolveEntry(this.cleanPath(srcPhysical))
    if (entry.isDir) throw new Error("[IwaraZip] folder copy not supported")
    const destination = await this.resolveFolderId(dstDir)
    await this.client.copyFile(entry.id, destination)
  }

  async put(_virtualPath: string, physicalPath: string, content: Buffer): Promise<void> {
    const clean = this.cleanPath(physicalPath)
    const parts = clean.split("/").filter(Boolean)
    const filename = parts.pop() || "upload"
    const folderId = await this.resolveFolderId("/" + parts.join("/"))
    await this.client.upload(folderId, filename, content)
  }

  private cleanPath(path: string): string {
    return "/" + path.split("/").filter(Boolean).join("/")
  }

  private parentPath(path: string): string {
    const parts = this.cleanPath(path).split("/").filter(Boolean)
    parts.pop()
    return "/" + parts.join("/")
  }

  private async resolveFolderId(path: string): Promise<string | undefined> {
    const parts = this.cleanPath(path).split("/").filter(Boolean)
    let current = this.rootFolderId
    for (const part of parts) {
      const listing = await this.client.listFolder(current)
      const folder = listing.folders.find((candidate) => folderName(candidate) === part)
      if (!folder) {
        if (parts.length === 1) return part
        throw new Error(`[IwaraZip] folder '${part}' not found`)
      }
      current = id(folder.id)
    }
    return current
  }

  private async resolveEntry(path: string): Promise<Entry> {
    const clean = this.cleanPath(path)
    const name = clean.split("/").filter(Boolean).pop()
    if (!name) throw new Error("[IwaraZip] cannot resolve root entry")
    const parent = this.parentPath(clean)
    const listing = await this.client.listFolder(await this.resolveFolderId(parent))
    const file = listing.files.find((candidate) => fileName(candidate) === name)
    if (file) return { id: id(file.id), isDir: false, name }
    const folder = listing.folders.find((candidate) => folderName(candidate) === name)
    if (folder) return { id: id(folder.id), isDir: true, name }
    if (clean.split("/").filter(Boolean).length === 1) {
      return { id: name, isDir: false, name }
    }
    throw new Error(`[IwaraZip] '${name}' not found`)
  }
}
