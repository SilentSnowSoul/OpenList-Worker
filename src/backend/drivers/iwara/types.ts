// iwara.zip (YetiShare) API types

export interface DriverIwaraAddition {
  /** iwara.zip address; defaults to the official site. */
  endpoint?: string
  api_key_1: string
  api_key_2: string
  root_folder_id?: string
}

export interface IwaraFolder {
  id: string | number
  parentId?: string | number | null
  parent_folder_id?: string | number | null
  folderName?: string
  folder_name?: string
  name?: string
  size?: string | number
  totalSize?: string | number
  total_size?: string | number
  isPublic?: string | number
  date_added?: string | null
  date_updated?: string | null
  created_at?: string | null
  updated_at?: string | null
  url_folder?: string
}

export interface IwaraFile {
  id: string | number
  filename?: string
  file_name?: string
  name?: string
  shortUrl?: string
  fileType?: string
  extension?: string
  size?: string | number
  fileSize?: string | number
  file_size?: string | number
  downloads?: string | number
  folderId?: string | number | null
  folder_id?: string | number | null
  date_added?: string | null
  date_updated?: string | null
  created_at?: string | null
  updated_at?: string | null
  url_file?: string
}

export interface IwaraEnvelope<T = unknown> {
  data?: T
  _status?: string
  status?: string
  response?: unknown
}
