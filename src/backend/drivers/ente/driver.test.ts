import assert from "node:assert/strict"

import { test } from "node:test"

import { driverConfigs } from "../../server/admin"
import { driverMustProxy } from "../../internal/driver/proxy"
import { getDriver } from "../../internal/op/storage"
import { DriverEnte } from "./driver"
import { EnteTransport } from "./client"
import { fromB64 } from "./crypto"
import { enteDecryptStream } from "./util"

// 向量由 Go 交叉生成器产出(生成侧自校验):
// masterKey 0x30..0x4F,相册 A key 0x41..0x60,相册 B key 0x50..0x6F,
// file 201/202 fileKey 0x46../0x47..(以相册 A key 封装)。
const MASTER_KEY_B64 = "MDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk8="
const BOX_SK_B64 = "5ofJ9bTbiYvoZrju4m9JN+OlwCRPrSIcxOWG+p3v6Nw="

const ALBUM_A = {
  id: 9001,
  owner: { id: 1 },
  encryptedKey:
    "JrsA7ZBGK6ky0JlsfAAceY/43PqZYalQFCO7+Kkp9G2H9lu2hv1mPQESt/jj3EaT",
  keyDecryptionNonce: "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3",
  encryptedName: "tZKjtQly3bNkb8lJOjRe7MVlF8lQyr+P17jy",
  nameDecryptionNonce: "cHFyc3R1dnd4eXp7fH1+f4CBgoOEhYaH",
  type: "album",
  updationTime: 5000000000000,
}

// 隐藏相册(magicMetadata visibility=2),key 与相册 A 相同
const ALBUM_HIDDEN = {
  ...ALBUM_A,
  id: 9003,
  updationTime: 7000000000000,
  magicMetadata: {
    data: "Vkx2A8ehU0rMZX01YC4XG/vrz88XWTbDwMfNugrG0BhF",
    header: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
}

// 共享相册(sealed box,无 keyDecryptionNonce)
const ALBUM_B = {
  id: 9002,
  owner: { id: 2 },
  encryptedKey:
    "eMolMegYpR4eFvqkNK3t5x9MXd9hEhEf2VGsIHBlexT4Zn7jp5ZcQoCg04bvEjwqfcLbkNZ5jLBGECtWALta2fIH0jcBWUW+Exo26ypJbtM=",
  encryptedName: "6yejXEej6slfscu4I6kdCzZMFY88M0GrSeixXw==",
  nameDecryptionNonce: "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaX",
  type: "album",
  updationTime: 6000000000000,
}

const F201 = {
  id: 201,
  encryptedKey:
    "Pdsr040fkgp9Ebj91NOpmDQ4kz21LWO82wStHXT3vaUiqnN9A3X3zlFBny5o0GTm",
  keyDecryptionNonce: "RkdISUpLTE1OT1BRUlNUVVZXWFlaW1xd",
  file: {
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
    encryptedData: "eA==",
  },
  thumbnail: { decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh" },
  metadata: {
    encryptedData:
      "ttnMWS2RgZy0q4dMPwHIPR8RaQ3QXw9RMyh0GPeE5JuDtFY+BRaxGKyGNvFbk7TDMwMat9WAfvl932FKw+WCPoIlaDq2zh1XDjnK6VOWJAXxCzMLEjUfO7qOChQhf59GR2JmS7SaEOVP+CD9",
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  pubMagicMetadata: {
    data: "ttnMSCCMmZzy38RoF2StL8eU4YIvj8vrlq+9y7ia/ZPPzB02BF3/TP/gZ6wOgb7CNAESttSBf+Rugz8fm7LaIER/3nlOg46F1fqZHcUiTUM=",
    header: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  info: { fileSize: 12345, thumbSize: 100 },
  isDeleted: false,
  updationTime: 1000,
}

const F202 = {
  id: 202,
  encryptedKey:
    "PRBsq9qgnmzXoqxvs1bzA7kMCRzYjz+byfwoFCs0Nrs0lxNhWk7BBczuzdqWlxLg",
  keyDecryptionNonce: "R0hJSktMTU5PUFFSU1RVVldYWVpbXF1e",
  file: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==", encryptedData: "eA==" },
  metadata: {
    encryptedData:
      "yhn2nQFByEKIcFpUw7LNeKUZP0/Ly7PFkLrB146DEGtR3/PDW1ob5DVxsMBLmbGziIp6jUwCijD3nJlUNjsJJueQawCvFcUDWx4xyCgV49rwHNCPHFgbeL6xTrDkNXT+QgAKdLSVMwqbq/Lt",
    decryptionHeader: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  },
  info: { fileSize: 222 },
  isDeleted: false,
  updationTime: 1050,
}

// 同名墓碑与已移出相册条目:不得触发解密
const F203_DELETED = { id: 203, isDeleted: true, updationTime: 1100 }
const F204_REMOVED = {
  ...F202,
  id: 204,
  updationTime: 1080,
  file: { decryptionHeader: "AAAAAAAAAAAAAAAAAAAAAA==", encryptedData: "-" },
}

const DIFF_A = {
  "0": { diff: [F201, F203_DELETED], hasMore: true },
  "1100": { diff: [F202, F204_REMOVED], hasMore: false },
}
// 相册 B(共享)与隐藏相册:单文件,复用 201 向量之外的独立页
const DIFF_B = {
  "0": { diff: [], hasMore: false },
}

const STREAM_201 = {
  header: "AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qh",
  cipher: "tsONTjDIno3k9MRoX3SnPHeoi8kKcsiRSs3ssIDeyBs=",
  plain: "acct-stream-201",
}

interface Recorded {
  urls: string[]
  headers: Record<string, Record<string, string>>
}

function transportWith(
  collections: object[],
  diffs: Record<string, object>,
  rec: Recorded,
): EnteTransport {
  return async (url, init) => {
    rec.urls.push(url)
    rec.headers[url] = init.headers
    const u = new URL(url)
    if (u.pathname === "/collections/v2") {
      return jsonResponse({ collections })
    }
    if (u.pathname === "/collections/v2/diff") {
      const key = `${u.searchParams.get("collectionID")}:${u.searchParams.get("sinceTime")}`
      const page =
        diffs[`${u.searchParams.get("collectionID")}:${u.searchParams.get("sinceTime")}`]
      if (!page) throw new Error(`unexpected diff request ${key}`)
      return jsonResponse(page)
    }
    if (
      u.pathname === "/files/download/v3/201" ||
      u.pathname === "/files/thumbnail/v3/201"
    ) {
      return jsonResponse({ url: "https://bin.test/bin" })
    }
    if (u.pathname === "/bin") {
      const bin = Uint8Array.from(fromB64(STREAM_201.cipher))
      return new Response(bin, { status: 200 })
    }
    throw new Error(`unexpected request ${url}`)
  }
}

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function makeDriver(
  rec: Recorded,
  opts: {
    collections?: object[]
    diffs?: Record<string, object>
    secretKey?: string
    showHidden?: boolean
    token?: string
  } = {},
): DriverEnte {
  return new DriverEnte(
    {
      token: opts.token || "Fxacct1",
      master_key: MASTER_KEY_B64,
      secret_key: opts.secretKey,
      show_hidden: opts.showHidden,
    },
    transportWith(
      opts.collections || [ALBUM_A, ALBUM_B, ALBUM_HIDDEN],
      opts.diffs || {
        "9001:0": DIFF_A["0"],
        "9001:1100": DIFF_A["1100"],
        "9002:0": DIFF_B["0"],
        "9003:0": DIFF_B["0"],
      },
      rec,
    ),
  )
}

async function readAll(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = s.getReader()
  const out: number[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(...value)
  }
  return Uint8Array.from(out)
}

test("list 根目录为相册目录,隐藏默认排除,共享相册需 secret_key", async () => {
  const rec: Recorded = { urls: [], headers: {} }
  const warns: string[] = []
  const origWarn = console.warn
  console.warn = (msg: string) => warns.push(String(msg))

  let driver = makeDriver(rec)
  let items = await driver.list("/", "/")
  assert.deepEqual(
    items.map((i) => i.name),
    ["旅行 2024"],
  )
  // 无 secret_key:共享相册跳过 + console.warn
  driver = makeDriver(rec, { secretKey: BOX_SK_B64, token: "Fxacct2" })
  assert.match(warns[0], /9002/)
  console.warn = origWarn

  driver = makeDriver(rec, { secretKey: BOX_SK_B64 })
  // 顺序依赖 ICU localeCompare,断言集合
  assert.deepEqual(
    (await driver.list("/", "/")).map((i) => i.name).sort(),
    ["Shared Album", "旅行 2024"],
  )

  // show_hidden:隐藏相册出现(与相册 A 同密文,dedupe 追加 " (2)")
  driver = makeDriver(rec, {
    secretKey: BOX_SK_B64,
    showHidden: true,
    token: "Fxacct3",
  })
  assert.deepEqual(
    (await driver.list("/", "/")).map((i) => i.name).sort(),
    ["Shared Album", "旅行 2024", "旅行 2024 (2)"],
  )
})

test("list 相册目录解密文件层级,墓碑过滤与水位终止", async () => {
  const rec: Recorded = { urls: [], headers: {} }
  const driver = makeDriver(rec, { secretKey: BOX_SK_B64, token: "Fxacct4" })

  const items = await driver.list("/ente/旅行 2024", "/旅行 2024")
  // 名称顺序依赖 ICU localeCompare,断言集合而非顺序
  assert.deepEqual(
    items.map((i) => i.name).sort(),
    ["IMG_002.jpg", "账号文件.jpg"],
  )
  const byName = new Map(items.map((i) => [i.name, i]))
  assert.equal(byName.get("账号文件.jpg")?.size, 12345 - 17)
  assert.equal(byName.get("账号文件.jpg")?.modified, "2024-10-05T06:51:51.111Z")
  assert.equal(byName.get("账号文件.jpg")?.sign, "201")
  assert.equal(byName.get("IMG_002.jpg")?.modified, "2024-10-04T00:00:00.002Z")
  assert.equal(
    byName.get("账号文件.jpg")?.thumb,
    "/api/p/ente/旅行 2024/%E8%B4%A6%E5%8F%B7%E6%96%87%E4%BB%B6.jpg?thumb=1",
  )
  assert.equal(byName.get("IMG_002.jpg")?.thumb, "")

  // 账号端点 + X-Auth-Token
  assert.ok(
    rec.urls.some((u) => u.includes("/collections/v2?sinceTime=0")),
  )
  assert.ok(rec.urls.some((u) => u.includes("/collections/v2/diff?collectionID=9001&sinceTime=1100")))
  const collUrl = rec.urls.find((u) => u.includes("/collections/v2?"))!
  assert.equal(rec.headers[collUrl]["X-Auth-Token"], "Fxacct4")
})

test("get 三级路径与 createReadStream/createThumbStream 复用下载管线", async () => {
  const rec: Recorded = { urls: [], headers: {} }
  const driver = makeDriver(rec, { secretKey: BOX_SK_B64, token: "Fxacct5" })

  const root = await driver.get("/", "/")
  assert.ok(root.is_dir)

  const collection = await driver.get("/ente", "/旅行 2024")
  assert.equal(collection.name, "旅行 2024")
  assert.ok(collection.is_dir)

  const file = await driver.get("/ente", "/旅行 2024/账号文件.jpg")
  assert.equal(file.size, 12345 - 17)

  await assert.rejects(driver.get("/ente", "/不存在"), /not found/)

  const stream = await driver.createReadStream("/旅行 2024/账号文件.jpg")
  const plain = await readAll(stream)
  assert.equal(new TextDecoder().decode(plain), STREAM_201.plain)

  const thumb = await driver.createThumbStream("/旅行 2024/账号文件.jpg")
  const thumbPlain = await readAll(thumb)
  assert.equal(new TextDecoder().decode(thumbPlain), STREAM_201.plain)

  assert.ok(rec.urls.some((u) => u.endsWith("/files/download/v3/201")))
  assert.ok(rec.urls.some((u) => u.endsWith("/files/thumbnail/v3/201")))

  // 只读
  await assert.rejects(driver.put("/", "/", Buffer.alloc(0)), /read-only/)
})

test("注册:storage/admin/proxy 三处可见", async () => {
  assert.ok("Ente" in driverConfigs)
  assert.equal(driverConfigs.Ente.default_mount_path, "/ente")
  assert.ok(driverMustProxy("ente"))
  assert.ok(driverMustProxy("Ente"))
})

test("密码模式显式拒绝;凭证模式不受影响", async () => {
  const passwordDriver = new DriverEnte(
    {
      token: "",
      master_key: "not-base64",
      secret_key: "also-not-base64",
      email: "user@example.com",
      password: "secret",
      two_fa_secret: "JBSWY3DPEHPK3PXP",
    },
    transportWith([], {}, { urls: [], headers: {} }),
  )
  await assert.rejects(
    passwordDriver.init(),
    /password login is not implemented on Worker \(memory limit\)/,
  )

  const credentialDriver = makeDriver({ urls: [], headers: {} })
  await credentialDriver.init()
})

test("token+password 组合按凭证模式工作;纯密码模式仍拒绝", async () => {
  const mixedDriver = new DriverEnte(
    {
      token: "Fxmixed",
      master_key: MASTER_KEY_B64,
      email: "",
      password: "secret",
      two_fa_secret: "JBSWY3DPEHPK3PXP",
    },
    transportWith([ALBUM_A], { "9001:0": DIFF_A["0"] }, { urls: [], headers: {} }),
  )
  await mixedDriver.init()

  const passwordOnlyDriver = new DriverEnte(
    {
      token: "",
      master_key: MASTER_KEY_B64,
      email: "user@example.com",
      password: "",
    },
    transportWith([], {}, { urls: [], headers: {} }),
  )
  await assert.rejects(
    passwordOnlyDriver.init(),
    /password login is not implemented on Worker \(memory limit\)/,
  )
})

test("admin 表单含 email/password/two_fa_secret 字段", () => {
  const fields = driverConfigs.Ente.additional as { name: string; required: boolean }[]
  const names = fields.map((f) => f.name)
  assert.deepEqual(
    names,
    ["endpoint", "email", "password", "two_fa_secret", "token", "master_key", "secret_key", "show_hidden"],
  )
  assert.equal(fields.find((f) => f.name === "token")?.required, false)
  assert.equal(fields.find((f) => f.name === "master_key")?.required, false)
})
