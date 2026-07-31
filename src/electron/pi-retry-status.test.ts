import { describe, expect, it } from "vitest"

import { describePiFailure, describePiRetry } from "./pi-retry-status"

describe("Pi retry status", () => {
  it("identifies a structured 503 as a model-provider failure", () => {
    expect(
      describePiRetry({
        attempt: 1,
        delayMs: 2000,
        errorMessage:
          '503: {"message":"Service is too busy.","type":"service_unavailable_error","param":null,"code":"service_unavailable_error"}',
        maxAttempts: 3,
        provider: "deepseek",
      })
    ).toEqual({
      detail: "Service is too busy.",
      errorCode: "service_unavailable_error",
      errorType: "service_unavailable_error",
      httpStatus: 503,
      source: "provider",
      text: "模型服务端 · DeepSeek 服务繁忙（HTTP 503 · service_unavailable_error）：Service is too busy.；2 秒后自动重试（1/3）…",
      transportCode: undefined,
    })
  })

  it("identifies authentication failures as client configuration issues", () => {
    const result = describePiRetry({
      attempt: 1,
      delayMs: 500,
      errorMessage:
        'HTTP 401: {"error":{"message":"Incorrect API key.","type":"authentication_error","code":"invalid_api_key"}}',
      maxAttempts: 2,
      provider: "openai",
    })

    expect(result.source).toBe("client_auth")
    expect(result.text).toBe(
      "客户端配置 · OpenAI 认证或权限失败（HTTP 401 · invalid_api_key · authentication_error）：Incorrect API key.；500 毫秒后自动重试（1/2）…"
    )
  })

  it("identifies transport errors without pretending they came from the provider", () => {
    const result = describePiRetry({
      attempt: 2,
      delayMs: 4000,
      errorMessage: "fetch failed: getaddrinfo ENOTFOUND api.deepseek.com",
      maxAttempts: 3,
      provider: "deepseek",
    })

    expect(result.source).toBe("network")
    expect(result.httpStatus).toBeUndefined()
    expect(result.transportCode).toBe("ENOTFOUND")
    expect(result.text).toContain("网络连接 · 客户端与模型服务之间的连接异常")
    expect(result.text).toContain("ENOTFOUND")
    expect(result.text).toContain("4 秒后自动重试（2/3）")
  })

  it("redacts credential-like values and bounds provider details", () => {
    const result = describePiRetry({
      errorMessage: `500: {"message":"Authorization: Bearer secret-token api_key=sk-1234567890abcdefghijklmnop ${"x".repeat(
        240
      )}"}`,
      provider: "deepseek",
    })

    expect(result.detail).toContain("[REDACTED]")
    expect(result.detail).toContain("api_key=[REDACTED]")
    expect(result.detail).not.toContain("secret-token")
    expect(result.detail).not.toContain("sk-1234567890abcdefghijklmnop")
    expect(result.detail!.length).toBeLessThanOrEqual(180)
  })

  it("handles malformed provider bodies without swallowing the error context", () => {
    const result = describePiRetry({
      attempt: 1,
      errorMessage: "502: upstream connection reset",
      maxAttempts: 3,
      provider: "custom-provider",
    })

    expect(result).toMatchObject({
      detail: "upstream connection reset",
      httpStatus: 502,
      source: "provider",
    })
    expect(result.text).toContain(
      "模型服务端 · custom-provider 暂时不可用（HTTP 502）"
    )
  })

  it.each([
    {
      errorMessage:
        '429: {"error":{"message":"Too many requests.","type":"rate_limit_error","code":"rate_limit_exceeded"}}',
      expected: "模型服务端 · DeepSeek 请求限流",
      source: "provider",
    },
    {
      errorMessage:
        '400: {"error":{"message":"Unknown model.","type":"invalid_request_error","code":"model_not_found"}}',
      expected: "客户端请求 · DeepSeek 请求参数或模型配置错误",
      source: "client_request",
    },
  ])("classifies $source failures for terminal errors", (fixture) => {
    const result = describePiFailure({
      errorMessage: fixture.errorMessage,
      provider: "deepseek",
    })

    expect(result.source).toBe(fixture.source)
    expect(result.text).toContain(fixture.expected)
  })
})
