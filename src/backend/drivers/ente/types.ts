// Ente wire 类型(museum server JSON 响应)与驱动 addition。

export interface DriverEnteShareAddition {
  share_url: string
  endpoint?: string
  // museum server 下发的 linkDeviceToken,持久化以复用设备位
  device_token?: string
}

export interface DriverEnteAddition {
  endpoint?: string
  email?: string
  password?: string
  two_fa_secret?: string
  token: string
  master_key: string
  secret_key?: string
  show_hidden?: boolean
}

export interface EnteCollectionUser {
  id: number
  email?: string
}

export interface EnteCollection {
  id: number
  owner: EnteCollectionUser
  encryptedKey: string
  keyDecryptionNonce?: string
  name?: string
  encryptedName?: string
  nameDecryptionNonce?: string
  type: string
  updationTime: number
  isDeleted?: boolean
  magicMetadata?: EnteMagicMetadata
  pubMagicMetadata?: EnteMagicMetadata
  sharedMagicMetadata?: EnteMagicMetadata
}

export interface EnteFileAttributes {
  encryptedData?: string
  decryptionHeader: string
}

export interface EnteFileInfo {
  fileSize?: number
  thumbSize?: number
}

export interface EnteMagicMetadata {
  data: string
  header: string
}

export interface EnteDiffFile {
  id: number
  ownerID?: number
  collectionID?: number
  encryptedKey: string
  keyDecryptionNonce: string
  file: EnteFileAttributes
  thumbnail?: EnteFileAttributes
  metadata: EnteFileAttributes
  isDeleted?: boolean
  updationTime: number
  magicMetadata?: EnteMagicMetadata
  pubMagicMetadata?: EnteMagicMetadata
  info?: EnteFileInfo
}

export interface EnteDiffResponse {
  diff: EnteDiffFile[]
  hasMore: boolean
}
