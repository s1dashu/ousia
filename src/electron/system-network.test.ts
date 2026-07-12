import { describe, expect, it, vi } from "vitest"

import { createSystemProxyFetch } from "./system-network.js"

describe("system proxy fetch", () => {
  it("forwards URL requests through the Chromium fetch boundary", async () => {
    const response = new Response("ok", { status: 200 })
    const fetchWithSystemProxy = vi.fn(async () => response)
    const onFailure = vi.fn()
    const systemFetch = createSystemProxyFetch({
      fetchWithSystemProxy,
      onFailure,
    })
    const signal = new AbortController().signal

    await expect(
      systemFetch(new URL("https://api.example.com/v1/models?token=secret"), {
        method: "POST",
        signal,
      })
    ).resolves.toBe(response)
    expect(fetchWithSystemProxy).toHaveBeenCalledWith(
      "https://api.example.com/v1/models?token=secret",
      { method: "POST", signal }
    )
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("logs sanitized transport details and rethrows the original failure", async () => {
    const cause = Object.assign(
      new Error("connect ECONNRESET https://api.example.com/v1/chat?key=secret"),
      {
        address: "203.0.113.10",
        code: "ECONNRESET",
        errno: -54,
        port: 443,
        syscall: "connect",
      }
    )
    const failure = new TypeError("fetch failed", { cause })
    const fetchWithSystemProxy = vi.fn(async () => {
      throw failure
    })
    const onFailure = vi.fn()
    const times = [100, 107]
    const systemFetch = createSystemProxyFetch({
      fetchWithSystemProxy,
      now: () => times.shift()!,
      onFailure,
    })

    await expect(
      systemFetch("https://api.example.com/v1/chat?key=secret")
    ).rejects.toBe(failure)
    expect(onFailure).toHaveBeenCalledWith({
      cause: {
        address: "203.0.113.10",
        code: "ECONNRESET",
        errno: -54,
        message:
          "connect ECONNRESET https://api.example.com/[redacted]",
        name: "Error",
        port: 443,
        syscall: "connect",
      },
      durationMs: 7,
      error: {
        message: "fetch failed",
        name: "TypeError",
      },
      host: "api.example.com",
      method: "GET",
    })
  })
})
