import assert from "node:assert/strict"

import { test } from "node:test"

import { driverConfigs } from "../../server/admin"
import { driverMustProxy } from "../../internal/driver/proxy"
import { getDriver } from "../../internal/op/storage"
import { DriverEnteShare } from "./driver"
import { EnteTransport } from "../ente/client"
import { fromB64 } from "../ente/crypto"
import { enteDecryptStream } from "../ente/util"

// 向量由 Go 交叉生成器产出(ente/cli 官方 crypto 实现,生成侧自校验):
// collectionKey 0x30..0x4F,fileKey 0x41+i/0x42+i/0x45+i,nonce 同 keySeed 起步。
const COLLECTION_KEY_B58 =
  "4F85ZySpwyY6FuKqoUgmccbBRAXGrgb8pFyjpd5DcNrA"

const F101 = {
  id: 101,
  encryptedKey:
    "42gbAI24STbGiTKDQWTwDb7yiTOwuOG6U01APz9+m5id4c8z93sW9C7ZXgnMhAx7",
  keyDecryptionNonce: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldY",
  file: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==", encryptedData: "eA==" },
  thumbnail: { decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh" },
  metadata: {
    encryptedData:
      "Vkx2AcemVk2HMzYIVEtyG7Y80HVJdr215ImyFMeEuHS5+7vnIvyhsDA+rn0db0/D2h0XIjk3MHO+S7FJ5iNM1zEDnhj4/JXofGTM8iPkEaj2T6//Vbkq/tu+UABw8jxmKMACBDOVofln1AvgfR7AWm5G4nPt",
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  pubMagicMetadata: {
    data: "Vkx2EMq7Tk3BR3UsfC4XC2CZQazp+6aApN6hFo+Ruz/hvLzBLvCw+2VhzSZIO1zI2hsUKzg2MXK/BpSdEn2a9vOMA+jsKFkAqag=",
    header: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  info: { fileSize: 12345, thumbSize: 100 },
  isDeleted: false,
  updationTime: 1000,
}

const F102 = {
  id: 102,
  encryptedKey:
    "47FcYuaf1B1QYlWIT9tJA9wDtQstNo2tRvmdGjkkMnlAPYmArzMJ5YUfR9c8dsDE",
  keyDecryptionNonce: "QkNERUZHSElKS0xNTk9QUVJTVFVWV1hZ",
  file: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==", encryptedData: "eA==" },
  thumbnail: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==" },
  metadata: {
    encryptedData:
      "W9jSAOYeSC8IdzfQSI/EDgocDp2g5H3zC2iz+StVCnKul5OwJm8jgirRB8jSZSKjaa87xr2na9iNzehDb0t4YtseMFPIvoolKSr+6t0DEQiuC/8zZjtpIYimmWkDiCfF4+gIJnokNMZbrms=",
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  info: { fileSize: 222 },
  isDeleted: false,
  updationTime: 1050,
}

const F105 = {
  id: 105,
  encryptedKey:
    "2SlMdM4yJlF4vFdbwRiyFDgqbHdG85LEvf2nxsgUizgI3B6PPXaJefenqFRwHFle",
  keyDecryptionNonce: "RUZHSElKS0xNTk9QUVJTVFVWV1hZWltc",
  file: { decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh", encryptedData: "eA==" },
  thumbnail: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==" },
  metadata: {
    encryptedData:
      "iAydoO9hYX57IiWmswb9cueITxEMK2aDI28cTqKzOWCwZIw7sdoPsO6AiuYBbri1AUoi7LlOui3lv5tAcBUc3YbE8mCyAHdv0+gY7z6WVyB5SJv6zFRe6noEsOrESFCelID0oYRjhgShAA==",
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  pubMagicMetadata: {
    data: "iAydseJ8eX49Vma9v0CiP6GKU0xKZj3AJ2MZX6TyOkTtK8U77o9R9rPW7L1eOai9AwUxtRH5gaIoXopNwC/Zaovi",
    header: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  info: { fileSize: 999999 },
  isDeleted: false,
  updationTime: 900,
}

// isDeleted 墓碑:字段残缺也不应触发任何解密
const F103_DELETED = {
  id: 103,
  isDeleted: true,
  updationTime: 1100,
}

// encryptedData == "-" 墓碑(已移出相册)
const F104_REMOVED = {
  ...F102,
  id: 104,
  updationTime: 1080,
  file: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==", encryptedData: "-" },
}

interface Recorded {
  urls: string[]
  headerByPath: Record<string, Record<string, string>>
}

// 页按 sinceTime 索引;页外请求直接抛错,断言分页终止行为
function transportWith(
  pages: Record<string, object>,
  rec: Recorded,
): EnteTransport {
  return async (url, init) => {
    rec.urls.push(url)
    rec.headerByPath[url] = init.headers
    const since = new URL(url).searchParams.get("sinceTime") || ""
    const page = pages[since]
    if (!page) throw new Error(`unexpected request sinceTime=${since}`)
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
}

// 页1 hasMore=true 且水位推进到 1100;页2 全部条目 updationTime < 1100,
// 水位不前进 → 必须终止,不得发起第三次请求
const PAGES = {
  "0": { diff: [F101, F103_DELETED, F105], hasMore: true },
  "1100": { diff: [F102, F104_REMOVED], hasMore: true },
}

function makeDriver(token: string, rec: Recorded): DriverEnteShare {
  return new DriverEnteShare(
    { share_url: `https://share.ente.io/c/${token}#${COLLECTION_KEY_B58}` },
    transportWith(PAGES, rec),
  )
}

test("list 解密名称/大小/时间,过滤墓碑,同名去重,死循环终止", async () => {
  const rec: Recorded = { urls: [], headerByPath: {} }
  const driver = makeDriver("Fxtoken1", rec)

  const items = await driver.list("/", "/")

  assert.equal(items.length, 3)
  const bySize = new Map(items.map((i) => [i.size, i]))
  assert.equal(bySize.get(12345 - 17)?.name, "日落.jpg")
  assert.equal(bySize.get(12345 - 17)?.modified, "2024-10-05T06:51:51.111Z")
  assert.equal(bySize.get(222 - 17)?.name, "日落 (2).jpg")
  assert.equal(bySize.get(222 - 17)?.modified, "2024-10-04T00:00:00.000Z")
  // editedTime 为 0 时回退 creationTime;editedName 覆盖 title
  assert.equal(bySize.get(999999 - 17)?.name, "holiday video.mp4")
  assert.equal(bySize.get(999999 - 17)?.modified, "2024-10-06T13:43:42.222Z")
  for (const item of items) {
    assert.equal(item.is_dir, false)
    assert.notEqual(item.type, 0)
    assert.equal(item.raw_url, "")
  }
  assert.deepEqual(
    items.map((i) => i.name).sort(),
    ["holiday video.mp4", "日落 (2).jpg", "日落.jpg"],
  )
  assert.equal(bySize.get(12345 - 17)?.sign, "101")

  // 恰好两页;第三次请求会被 mock 抛错,此处兜底断言请求数
  assert.equal(rec.urls.length, 2)
  assert.match(rec.urls[0], /\/public-collection\/diff\?sinceTime=0$/)
  assert.match(rec.urls[1], /sinceTime=1100/)
  const h = rec.headerByPath[rec.urls[0]]
  assert.equal(h["X-Auth-Access-Token"], "Fxtoken1")
  assert.equal(h["X-Client-Package"], "io.ente.photos")
})

test("get 复用列表缓存,不产生 per-file 请求", async () => {
  const rec: Recorded = { urls: [], headerByPath: {} }
  const driver = makeDriver("Fxtoken2", rec)

  const item = await driver.get("/", "/日落.jpg")
  assert.equal(item.sign, "101")
  assert.equal(item.size, 12345 - 17)
  assert.equal(rec.urls.length, 2)

  const root = await driver.get("/", "/")
  assert.equal(root.is_dir, true)
  assert.equal(rec.urls.length, 2)

  await assert.rejects(() => driver.get("/", "/nope.jpg"), /not found/)
})

test("写操作全部拒绝", async () => {
  const driver = makeDriver("Fxtoken3", { urls: [], headerByPath: {} })
  await assert.rejects(() => driver.mkdir("/", "/x"), /read-only/)
  await assert.rejects(() => driver.rename("/", "/x", "y"), /read-only/)
  await assert.rejects(() => driver.remove("/", "/", ["x"]), /read-only/)
  await assert.rejects(() => driver.move("/", "/", ["x"], "/", "/"), /read-only/)
  await assert.rejects(() => driver.copy("/", "/", ["x"], "/", "/"), /read-only/)
  await assert.rejects(() => driver.put("/", "/x", Buffer.alloc(0)), /read-only/)
})

test("注册:admin 元数据、强制代理、驱动工厂", async () => {
  const cfg = driverConfigs.EnteShare
  assert.ok(cfg)
  assert.equal(cfg.config.only_proxy, true)
  assert.equal(cfg.config.no_upload, true)
  assert.equal(cfg.default_mount_path, "/ente_share")
  assert.ok(cfg.additional.find((f: { name: string }) => f.name === "share_url"))

  assert.equal(driverMustProxy("EnteShare"), true)

  const driver = await getDriver("EnteShare", {
    id: 990001,
    modified: "1",
    driver: "EnteShare",
    addition: JSON.stringify({
      share_url: `https://share.ente.io/c/Fxreg1#${COLLECTION_KEY_B58}`,
    }),
  })
  assert.ok(driver instanceof DriverEnteShare)
})

// f105 单块 TagFinal 流密文(明文 "hello ente" + 300×0xAB + "tail",314B)
const F105_STREAM_CIPHER =
  "iB/auOp6LX43bGJ7cckztmJOlI6FrO9L+qHWkWB3/J9yokKyIECTKX0ZE3+Y9yEsmNO7dSDJM+shcFmNst3WAkQAN59wxrnmQnKEdq0Pzrng0QJjVc3Hc+PSh1ztYO8Pr/IEWggpGoxHCnEwlKh8H2/DWF+H1RwYK+8WkdS2IG4AEpSsUjouHcb53O4wlC+QpkCaE/IsE44Nduf7LzSrv/eniGm3k+ThR5vmMg2SSGiSvZB4Yby4ZeXMlzaKAIomXht/KLVZyzgSgAReyLcGzCV+q3nua/sUa5OI6+xZkIo9S+kFZbpYTDNGV5jJxLl+GDdvYYMg7LrQeHfYDDdtXgQKZktdm6ckMneCzmr1cwHV7Zq/YMAvin1qlamYZGV56Yj8m8GFw+Z7vVaFcaVbs/a40TRZz7KMoVZLJYLechns95dSbrXF7bDJew=="

// 均匀三块流(50B TagMessage + 50B TagPush + "end" TagFinal),密文块几何 67/67/21
const UNIFORM_KEY_B64 = "4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8="
const UNIFORM_HEADER_B64 = "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh"
const UNIFORM_CHUNKS = [
  "Askkcj8p5lO0J3zbGxN1emvwHq7qz5aKIqsYVcE326keGNikEhW2eBhzO7OLRzntdMQ3EQnQgoGdrDx297S4e1ehJQ==",
  "g6nrG76yAEen5phHKK0iDio/xajaWQbUwo0hZ5bX5C+28gvasGgoz3ahOBx9nzdQYBBxM0tE0sLKv+D0IAecLa34hA==",
  "xmThEqyj0lwxHbSwvA1OKsIy9Qo=",
]

function fragmentStream(
  data: Uint8Array,
  size: number,
): ReadableStream<Uint8Array> {
  let off = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (off >= data.length) {
        controller.close()
        return
      }
      const end = Math.min(off + size, data.length)
      controller.enqueue(data.slice(off, end))
      off = end
    },
  })
}

async function readAll(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = s.getReader()
  const parts: Buffer[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(Buffer.from(value))
  }
  return Buffer.concat(parts)
}

test("enteDecryptStream 按固定块边界解均匀多块流", async () => {
  const cipher = Buffer.concat(UNIFORM_CHUNKS.map((c) => Buffer.from(c, "base64")))
  // 5 字节一片喂入,跨块边界,验证累积到块边界才 pull
  const stream = enteDecryptStream(
    fragmentStream(cipher, 5),
    fromB64(UNIFORM_KEY_B64),
    UNIFORM_HEADER_B64,
    50 + 17,
  )
  const expected = Buffer.concat([
    Buffer.alloc(50, 0x11),
    Buffer.alloc(50, 0x22),
    Buffer.from("end"),
  ])
  assert.deepEqual(await readAll(stream), expected)
})

test("createReadStream:v3 端点取预签名 URL,密文流解出明文", async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const transport: EnteTransport = async (url, init) => {
    seen.push({ url, headers: init.headers })
    if (url.includes("/public-collection/diff")) {
      const since = new URL(url).searchParams.get("sinceTime") || ""
      if (since === "0") {
        return new Response(JSON.stringify({ diff: [F105], hasMore: false }))
      }
      throw new Error(`unexpected diff page sinceTime=${since}`)
    }
    if (url.endsWith("/public-collection/files/download/v3/105")) {
      return new Response(JSON.stringify({ url: "https://s3.test/f105" }))
    }
    if (url === "https://s3.test/f105") {
      // 7 字节一片,验证解密端不依赖网络分片边界
      return new Response(
        fragmentStream(Buffer.from(F105_STREAM_CIPHER, "base64"), 7),
      )
    }
    throw new Error(`unexpected url: ${url}`)
  }
  const driver = new DriverEnteShare(
    { share_url: `https://share.ente.io/c/Fxtoken4#${COLLECTION_KEY_B58}` },
    transport,
  )

  const out = await readAll(await driver.createReadStream("/holiday video.mp4"))
  const expected = Buffer.concat([
    Buffer.from("hello ente"),
    Buffer.alloc(300, 0xab),
    Buffer.from("tail"),
  ])
  assert.deepEqual(out, expected)

  assert.deepEqual(
    seen.map((s) => s.url),
    [
      "https://api.ente.com/public-collection/diff?sinceTime=0",
      "https://api.ente.com/public-collection/files/download/v3/105",
      "https://s3.test/f105",
    ],
  )
  assert.equal(seen[1].headers["X-Auth-Access-Token"], "Fxtoken4")
  assert.equal(seen[2].headers["X-Client-Package"], undefined)
})

// f101 缩略图单块流(明文 JPEG 魔数 + 28×0x77,32B)
const F101_THUMB_CIPHER =
  "VsiMik6lTV/SfmM2bntaXvF5kzMOMf+do870TdqDqCHiD7TWncAsWHiNCQGBylM84w=="
const THUMB_PLAIN = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(28, 0x77),
])

test("缩略图:thumbnail v3 端点同管线解密,list/get thumb 指向代理路径", async () => {
  const transport: EnteTransport = async (url) => {
    if (url.includes("/public-collection/diff")) {
      return new Response(JSON.stringify({ diff: [F101, F102], hasMore: false }))
    }
    if (url.endsWith("/public-collection/files/thumbnail/v3/101")) {
      return new Response(JSON.stringify({ url: "https://s3.test/f101thumb" }))
    }
    if (url === "https://s3.test/f101thumb") {
      return new Response(fragmentStream(Buffer.from(F101_THUMB_CIPHER, "base64"), 9))
    }
    throw new Error(`unexpected url: ${url}`)
  }
  const driver = new DriverEnteShare(
    { share_url: `https://share.ente.io/c/Fxthumb1#${COLLECTION_KEY_B58}` },
    transport,
  )

  const out = await readAll(await driver.createThumbStream("/日落.jpg"))
  assert.deepEqual(out, THUMB_PLAIN)
  await assert.rejects(() => driver.createThumbStream("/日落 (2).jpg"), /no thumbnail/)

  const items = await driver.list("/", "/")
  assert.equal(
    items.find((i) => i.name === "日落.jpg")?.thumb,
    "/api/p/%E6%97%A5%E8%90%BD.jpg?thumb=1",
  )
  assert.equal(items.find((i) => i.name === "日落 (2).jpg")?.thumb, "")

  const item = await driver.get("/", "/日落.jpg")
  assert.equal(item.thumb, "/api/p/%E6%97%A5%E8%90%BD.jpg?thumb=1")
})

test("linkDeviceToken:下发捕获、addition 种子回放、consume 单次", async () => {
  const seen: Array<Record<string, string>> = []
  const transport: EnteTransport = async (url, init) => {
    seen.push(init.headers)
    if (url.includes("/public-collection/diff")) {
      return new Response(JSON.stringify({ diff: [], hasMore: false }), {
        headers: { "X-Link-Device-Token": "jwt-issued" },
      })
    }
    throw new Error(`unexpected url: ${url}`)
  }
  const addition = {
    share_url: `https://share.ente.io/c/Fxdev1#${COLLECTION_KEY_B58}`,
    device_token: "jwt-seeded",
  }
  const driver = new DriverEnteShare(addition, transport)
  await driver.list("/", "/")

  assert.equal(seen[0]["X-Auth-Link-Device-Token"], "jwt-seeded")
  assert.equal(driver.consumePendingDeviceToken(), "jwt-issued")
  assert.equal(driver.consumePendingDeviceToken(), null)
})

test("错误映射:410/403 设备超限/401 密码保护/401 token 失效", async () => {
  const errorDriver = (
    status: number,
    body: string,
    infoStatus: number,
    token: string,
  ) => {
    const transport: EnteTransport = async (url) => {
      if (url.endsWith("/public-collection/info")) {
        return new Response(infoStatus === 200 ? "{}" : "unauthorized", {
          status: infoStatus,
        })
      }
      return new Response(body, { status })
    }
    return new DriverEnteShare(
      { share_url: `https://share.ente.io/c/${token}#${COLLECTION_KEY_B58}` },
      transport,
    )
  }

  await assert.rejects(
    () => errorDriver(410, "expired", 200, "Fxerr1").list("/", "/"),
    /分享已过期/,
  )
  await assert.rejects(
    () =>
      errorDriver(403, "Public link device limit reached", 200, "Fxerr2").list("/", "/"),
    /设备数已达上限/,
  )
  await assert.rejects(
    () => errorDriver(401, "auth required", 200, "Fxerr3").list("/", "/"),
    /密码保护/,
  )
  await assert.rejects(
    () => errorDriver(401, "auth required", 401, "Fxerr4").list("/", "/"),
    /token 无效/,
  )
})
