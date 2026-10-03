import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { DriverIwara } from "./driver"

const originalFetch = globalThis.fetch
const originalDateNow = Date.now

afterEach(() => {
  globalThis.fetch = originalFetch
  Date.now = originalDateNow
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (init?.body instanceof URLSearchParams) return Object.fromEntries(init.body.entries())
  if (typeof init?.body !== "string") return {}
  return JSON.parse(init.body) as Record<string, unknown>
}

test("Iwara authenticates, lists entries, and reacquires an invalid token once", async () => {
  const calls: string[] = []
  let authorizationCount = 0
  let listingCount = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith("/authorize")) {
      authorizationCount++
      return json({ data: { access_token: `token-${authorizationCount}`, account_id: "account" } })
    }
    listingCount++
    if (listingCount === 1) return json({ _status: "error", response: "Could not validate access_token and account_id" })
    const request = bodyOf(init)
    assert.equal(request.access_token, "token-2")
    return json({
      data: {
        folders: [{ id: 7, folder_name: "Pictures", size: "84", date_updated: "2026-01-01" }],
        files: [{ id: 8, filename: "photo.jpg", size: "42", date_added: "2026-01-02" }],
      },
    })
  }) as typeof fetch

  const driver = new DriverIwara({ api_key_1: "one", api_key_2: "two" })
  const items = await driver.list("/", "/")
  assert.equal(authorizationCount, 2)
  assert.equal(items[0].sign, "7")
  assert.equal(items[0].size, 84)
  assert.equal(items[1].name, "photo.jpg")
  assert.equal(items[1].size, 42)
  assert.equal(calls.every((url) => url.includes("/api/v2/")), true)
})

test("Iwara retries a non-401 token-expired error only once", async () => {
  let authorizationCount = 0
  let listingCount = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/authorize")) {
      authorizationCount++
      return json({ data: { access_token: `token-${authorizationCount}`, account_id: "account" } })
    }
    listingCount++
    return json({ _status: "error", response: "Token expired" })
  }) as typeof fetch

  const driver = new DriverIwara({ api_key_1: "one", api_key_2: "two" })
  await assert.rejects(() => driver.list("/", "/"), /Token expired/)
  assert.equal(authorizationCount, 2)
  assert.equal(listingCount, 2)
})

test("Iwara reauthorizes after one hour without token use", async () => {
  let now = 1_000_000
  Date.now = () => now
  let authorizationCount = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/authorize")) {
      authorizationCount++
      return json({ data: { access_token: `token-${authorizationCount}`, account_id: "account" } })
    }
    return json({ data: { folders: [], files: [] } })
  }) as typeof fetch

  const driver = new DriverIwara({ api_key_1: "one", api_key_2: "two" })
  await driver.init()
  now += 59 * 60 * 1000
  await driver.list("/", "/")
  now += 60 * 60 * 1000 + 1
  await driver.list("/", "/")
  assert.equal(authorizationCount, 2)
})

test("Iwara preserves non-token API errors and resolves links without caching", async () => {
  const downloads: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/authorize")) {
      return json({ data: { access_token: "token", account_id: "account" } })
    }
    if (url.endsWith("/folder/listing")) {
      return json({ data: { folders: [], files: [{ id: 3, filename: "a.txt", file_size: 1 }] } })
    }
    if (url.endsWith("/file/download")) {
      downloads.push(String(bodyOf(init).file_id))
      return json({ data: { download_url: `https://signed.example/${downloads.length}` } })
    }
    return json({ _status: "error", response: "quota exceeded" })
  }) as typeof fetch

  const driver = new DriverIwara({ api_key_1: "one", api_key_2: "two" })
  const first = await driver.link("/a.txt", "/a.txt")
  const second = await driver.link("/a.txt", "/a.txt")
  assert.equal(first.url, "https://signed.example/1")
  assert.equal(second.url, "https://signed.example/2")
  await assert.rejects(() => driver.mkdir("/", "/new"), /quota exceeded/)
})

test("Iwara write operations send physical IDs and upload multipart content", async () => {
  const requests: { method: string; body: unknown }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/authorize")) return json({ data: { access_token: "token", account_id: "account" } })
    if (url.endsWith("/folder/listing")) {
      const request = bodyOf(init)
      const folder = String(request.parent_folder_id || "")
      return json({ data: folder === "" ? { folders: [{ id: 9, folderName: "dest" }], files: [{ id: 4, filename: "old.txt" }] } : { folders: [], files: [] } })
    }
    requests.push({ method: url.split("/api/v2/")[1], body: init?.body })
    return json({ data: {} })
  }) as typeof fetch

  const driver = new DriverIwara({ api_key_1: "one", api_key_2: "two" })
  await driver.rename("/old.txt", "/old.txt", "new.txt")
  await driver.move("/", "/dest", ["old.txt"], "/old.txt", "/dest/old.txt")
  await driver.copy("/", "/dest", ["old.txt"], "/old.txt", "/dest/old.txt")
  await driver.put("/upload.txt", "/upload.txt", Buffer.from("payload"))
  assert.deepEqual(requests.slice(0, 3).map((entry) => entry.method), ["file/edit", "file/move", "file/copy"])
  const upload = requests[3].body
  assert.equal(upload instanceof FormData, true)
  assert.equal((upload as FormData).get("folder_id"), "")
  assert.equal((upload as FormData).get("access_token"), "token")
  assert.equal((upload as FormData).get("upload_file") instanceof Blob, true)
})
