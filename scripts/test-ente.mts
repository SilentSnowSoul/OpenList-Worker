// env-gated 真网络冒烟(不进 CI):
//   ENTE_SHARE_URL=https://share.ente.io/c/<token>#<key> [ENTE_ENDPOINT=...]
// 或账号凭证:
//   ENTE_TOKEN=... ENTE_MASTER_KEY=... [ENTE_SECRET_KEY=...] [ENTE_SHOW_HIDDEN=1]
// 跑通 list + download + thumbnail 并输出摘要。
import { createHash } from "node:crypto"

import { DriverEnte } from "../src/backend/drivers/ente/driver"
import { DriverEnteShare } from "../src/backend/drivers/ente_share/driver"

async function readAll(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = s.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

async function main() {
  const shareUrl = process.env.ENTE_SHARE_URL
  const token = process.env.ENTE_TOKEN
  const masterKey = process.env.ENTE_MASTER_KEY
  if (!shareUrl && !(token && masterKey)) {
    console.log(
      "skip: set ENTE_SHARE_URL or ENTE_TOKEN+ENTE_MASTER_KEY to run the ente smoke test",
    )
    return
  }
  const endpoint = process.env.ENTE_ENDPOINT

  const driver = shareUrl
    ? new DriverEnteShare({
        share_url: shareUrl,
        ...(endpoint ? { endpoint } : {}),
      })
    : new DriverEnte({
        token: token!,
        master_key: masterKey!,
        ...(process.env.ENTE_SECRET_KEY
          ? { secret_key: process.env.ENTE_SECRET_KEY }
          : {}),
        ...(process.env.ENTE_SHOW_HIDDEN ? { show_hidden: true } : {}),
        ...(endpoint ? { endpoint } : {}),
      })
  // list(账号模式:根目录为相册,进入第一个相册)
  let items = await driver.list("/", "/")
  let files = items.filter((i) => !i.is_dir)
  let prefix = ""
  if (shareUrl) {
    console.log(`list: ${items.length} entries, ${files.length} files`)
  } else {
    const album = items.find((i) => i.is_dir)
    if (!album) throw new Error("no album in account root")
    prefix = `/${album.name}`
    items = await driver.list("/", prefix)
    files = items.filter((i) => !i.is_dir)
    console.log(`list: album "${album.name}" -> ${files.length} files`)
  }
  for (const f of files.slice(0, 5)) {
    console.log(`  ${f.name}  ${f.size}B  ${f.modified}  thumb=${!!f.thumb}`)
  }
  if (files.length === 0) throw new Error("no files listed")

  // download + thumbnail(取首个有缩略图的文件,否则退回首文件)
  const target = files.find((f) => f.thumb) || files[0]
  const downloadPath = `${prefix}/${target.name}`
  const plain = await readAll(await driver.createReadStream(downloadPath))
  const sha256 = createHash("sha256").update(plain).digest("hex")
  console.log(
    `download: ${target.name} ${plain.length}B sha256=${sha256.slice(0, 16)}… (expect ${target.size}B)`,
  )
  if (plain.length !== target.size) {
    throw new Error(`size mismatch: got ${plain.length}, expect ${target.size}`)
  }

  if (target.thumb) {
    const thumb = await readAll(await driver.createThumbStream(downloadPath))
    console.log(
      `thumbnail: ${thumb.length}B head=${new Uint8Array(thumb.slice(0, 3)).join(",")} (jpeg 255,216,255)`,
    )
  } else {
    console.log("thumbnail: none available, skipped")
  }
  console.log("ente smoke OK")
}

main().catch((e) => {
  console.error("ente smoke FAILED:", e)
  process.exit(1)
})
