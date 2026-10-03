import assert from "node:assert/strict"
import { test } from "node:test"
import { Hono } from "hono"
import { rawRouter } from "./raw"
import { saveDb } from "../internal/model/db"

// EnteShare 下载端到端:secretstream 顺序解密不支持 Range,收到 Range 也必须回
// 200 全量(而非 206),Content-Length 取明文大小。

const COLLECTION_KEY_B58 =
  "4F85ZySpwyY6FuKqoUgmccbBRAXGrgb8pFyjpd5DcNrA"
const STREAM_CIPHER =
  "iB/auOp6LX43bGJ7cckztmJOlI6FrO9L+qHWkWB3/J9yokKyIECTKX0ZE3+Y9yEsmNO7dSDJM+shcFmNst3WAkQAN59wxrnmQnKEdq0Pzrng0QJjVc3Hc+PSh1ztYO8Pr/IEWggpGoxHCnEwlKh8H2/DWF+H1RwYK+8WkdS2IG4AEpSsUjouHcb53O4wlC+QpkCaE/IsE44Nduf7LzSrv/eniGm3k+ThR5vmMg2SSGiSvZB4Yby4ZeXMlzaKAIomXht/KLVZyzgSgAReyLcGzCV+q3nua/sUa5OI6+xZkIo9S+kFZbpYTDNGV5jJxLl+GDdvYYMg7LrQeHfYDDdtXgQKZktdm6ckMneCzmr1cwHV7Zq/YMAvin1qlamYZGV56Yj8m8GFw+Z7vVaFcaVbs/a40TRZz7KMoVZLJYLechns95dSbrXF7bDJew=="
const STREAM_HEADER = "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh"

// file 105:metadata 密文与 driver.test.ts 的 F105 相同向量
const DIFF_F105 = {
  id: 105,
  encryptedKey:
    "2SlMdM4yJlF4vFdbwRiyFDgqbHdG85LEvf2nxsgUizgI3B6PPXaJefenqFRwHFle",
  keyDecryptionNonce: "RUZHSElKS0xNTk9QUVJTVFVWV1hZWltc",
  file: { decryptionHeader: STREAM_HEADER, encryptedData: "eA==" },
  thumbnail: { decryptionHeader: STREAM_HEADER },
  metadata: {
    encryptedData:
      "iAydoO9hYX57IiWmswb9cueITxEMK2aDI28cTqKzOWCwZIw7sdoPsO6AiuYBbri1AUoi7LlOui3lv5tAcBUc3YbE8mCyAHdv0+gY7z6WVyB5SJv6zFRe6noEsOrESFCelID0oYRjhgShAA==",
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  pubMagicMetadata: {
    data: "iAydseJ8eX49Vma9v0CiP6GKU0xKZj3AJ2MZX6TyOkTtK8U77o9R9rPW7L1eOai9AwUxtRH5gaIoXopNwC/Zaovi",
    header: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  info: { fileSize: 314, thumbSize: 100 },
  isDeleted: false,
  updationTime: 900,
}

const EXPECTED_PLAIN = Buffer.concat([
  Buffer.from("hello ente"),
  Buffer.alloc(300, 0xab),
  Buffer.from("tail"),
])

const dbWith = () => ({
  settings: [],
  users: [
    {
      id: 1,
      username: "guest",
      password: "xxx",
      role: 1,
      permission: 0,
      base_path: "/",
      disabled: false,
    },
  ],
  storages: [
    {
      id: "s9e",
      driver: "EnteShare",
      mount_path: "/ente_share",
      addition: JSON.stringify({
        share_url: `https://share.ente.io/c/RangeTok1#${COLLECTION_KEY_B58}`,
      }),
      modified: "2026-10-02T00:00:00.000Z",
      disabled: false,
    },
  ],
  shares: [],
  metas: [],
})

test("/p EnteShare:Range 请求回 200 全量明文,Content-Length 为明文大小", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/public-collection/diff")) {
      return new Response(JSON.stringify({ diff: [DIFF_F105], hasMore: false }))
    }
    if (url.endsWith("/public-collection/files/download/v3/105")) {
      return new Response(JSON.stringify({ url: "https://s3.test/f105" }))
    }
    if (url === "https://s3.test/f105") {
      return new Response(Buffer.from(STREAM_CIPHER, "base64"))
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  try {
    const env: Record<string, unknown> = {}
    await saveDb(dbWith() as never, env)
    const app = new Hono()
    app.route("/api/p", rawRouter)

    const res = await app.request("/api/p/ente_share/holiday%20video.mp4", {
      headers: { Range: "bytes=0-9" },
    })
    assert.equal(res.status, 200, `expected 200 full body, got ${res.status}`)
    assert.equal(res.headers.get("Content-Length"), "314")
    assert.equal(res.headers.get("Content-Range"), null)
    assert.equal(res.headers.get("Accept-Ranges"), null)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), EXPECTED_PLAIN)
  } finally {
    globalThis.fetch = realFetch
  }
})

// f105 缩略图流密文(明文 JPEG 魔数 + 28×0x77,32B)
const THUMB_CIPHER =
  "iIhnK2Ziemwub3CnrRXvar6SSFJZcDOXJn0KTbyrIEOuL9NGy2LvtFHEDWI69Yncxg=="
const THUMB_PLAIN = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(28, 0x77),
])

test("/p thumb=1:走缩略图流,image/jpeg 且不带 Content-Length/Range", async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/public-collection/diff")) {
      return new Response(JSON.stringify({ diff: [DIFF_F105], hasMore: false }))
    }
    if (url.endsWith("/public-collection/files/thumbnail/v3/105")) {
      return new Response(JSON.stringify({ url: "https://s3.test/f105thumb" }))
    }
    if (url === "https://s3.test/f105thumb") {
      return new Response(Buffer.from(THUMB_CIPHER, "base64"))
    }
    if (url.endsWith("/public-collection/files/download/v3/105")) {
      throw new Error("thumb request must not hit download endpoint")
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  try {
    const env: Record<string, unknown> = {}
    await saveDb(
      {
        ...dbWith(),
        storages: [
          {
            id: "s9t",
            driver: "EnteShare",
            mount_path: "/ente_share",
            addition: JSON.stringify({
              share_url: `https://share.ente.io/c/ThumbTok1#${COLLECTION_KEY_B58}`,
            }),
            modified: "1",
          },
        ],
      } as never,
      env,
    )
    const app = new Hono()
    app.route("/api/p", rawRouter)

    const res = await app.request("/api/p/ente_share/holiday%20video.mp4?thumb=1", {
      headers: { Range: "bytes=0-9" },
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("Content-Type"), "image/jpeg")
    assert.equal(res.headers.get("Content-Length"), null)
    assert.equal(res.headers.get("Content-Range"), null)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), THUMB_PLAIN)
  } finally {
    globalThis.fetch = realFetch
  }
})
