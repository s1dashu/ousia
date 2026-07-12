import { describe, expect, it } from "vitest"

import { sanitizeSentryEvent } from "./sentry-privacy.js"

describe("sanitizeSentryEvent", () => {
  it("removes user content and preserves only a normalized diagnostic stack", () => {
    const event = sanitizeSentryEvent(
      {
        breadcrumbs: [{ message: "prompt content" }],
        contexts: {
          app: { app_name: "Ousia" },
          device: { name: "Sida's Mac" },
          trace: { span_id: "span", trace_id: "trace" },
        },
        exception: {
          values: [
            {
              type: "ProviderError",
              value: "Bearer secret-token and user prompt",
              stacktrace: {
                frames: [
                  {
                    abs_path: "/Users/sida/code/ousia/src/main.ts",
                    filename: "/home/sida/project/src/main.ts",
                    function: "runProvider",
                    vars: { authorization: "secret" },
                  },
                ],
              },
            },
          ],
        },
        extra: { prompt: "private" },
        message: "private message",
        request: { headers: { authorization: "Bearer token" } },
        server_name: "private-host",
        tags: { account_id: "private-account" },
        user: { email: "person@example.com" },
      },
      "ousia",
      "main"
    )

    expect(event).toMatchObject({
      contexts: {
        app: { app_name: "Ousia" },
        trace: { span_id: "span", trace_id: "trace" },
      },
      exception: {
        values: [
          {
            type: "ProviderError",
            value: "ProviderError",
            stacktrace: {
              frames: [
                {
                  abs_path: "~/code/ousia/src/main.ts",
                  filename: "~/project/src/main.ts",
                  function: "runProvider",
                },
              ],
            },
          },
        ],
      },
      tags: { process_type: "main", product_id: "ousia" },
    })
    expect(event.contexts).not.toHaveProperty("device")
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0]).not.toHaveProperty("vars")
    expect(event.message).toBeUndefined()
    expect(event.request).toBeUndefined()
    expect(event.user).toBeUndefined()
    expect(event.extra).toBeUndefined()
    expect(event.breadcrumbs).toBeUndefined()
  })
})
