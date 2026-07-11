import { describe, expect, it, vi } from "vitest"

import {
  createOptimisticUserMessage,
  sendChatMessageOptimistically,
  shouldEndOptimisticRunAfterBridgeFailure,
} from "./optimistic-chat-send"

describe("optimistic chat send", () => {
  it("generates a collision-resistant client message id", () => {
    const { messageId } = createOptimisticUserMessage({
      attachments: [],
      context: { projectPath: "/workspace", sessionId: "session-1" },
      text: "hello",
    })

    expect(messageId).toMatch(
      /^user-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it("creates a renderer-safe user event without text attachment contents", () => {
    const { event, messageId } = createOptimisticUserMessage({
      attachments: [
        {
          id: "text-1",
          kind: "text",
          mediaType: "text/plain",
          name: "notes.txt",
          size: 5,
          text: "secret attachment body",
        },
        {
          id: "image-1",
          kind: "image",
          mediaType: "image/png",
          name: "screen.png",
          size: 4,
          dataBase64: "aW1hZ2U=",
        },
      ],
      context: { projectPath: "/workspace", sessionId: "session-1" },
      messageId: "user-client-1",
      text: "hello",
      timestamp: "2026-07-10T12:00:00.000Z",
    })

    expect(messageId).toBe("user-client-1")
    expect(event).toEqual({
      context: { projectPath: "/workspace", sessionId: "session-1" },
      type: "user_message",
      id: "user-client-1",
      text: "hello",
      delivery: "optimistic",
      attachments: [
        {
          id: "text-1",
          kind: "text",
          mediaType: "text/plain",
          name: "notes.txt",
          size: 5,
        },
        {
          id: "image-1",
          kind: "image",
          mediaType: "image/png",
          name: "screen.png",
          size: 4,
          dataBase64: "aW1hZ2U=",
        },
      ],
      timestamp: "2026-07-10T12:00:00.000Z",
    })
  })

  it("publishes locally before invoking an unresolved IPC send", async () => {
    const order: string[] = []
    let resolveSend!: (value: { ok: true }) => void
    const pendingSend = new Promise<{ ok: true }>((resolve) => {
      resolveSend = resolve
    })
    const onLocalEvent = vi.fn(() => order.push("local"))
    const send = vi.fn(() => {
      order.push("ipc")
      return pendingSend
    })
    const { event } = createOptimisticUserMessage({
      attachments: [],
      context: { projectPath: "/workspace", sessionId: "session-1" },
      messageId: "user-client-1",
      text: "hello",
      timestamp: "2026-07-10T12:00:00.000Z",
    })

    const result = sendChatMessageOptimistically({
      event,
      onLocalEvent,
      send,
    })

    expect(order).toEqual(["local", "ipc"])
    expect(onLocalEvent).toHaveBeenCalledWith(event)
    expect(send).toHaveBeenCalledOnce()
    resolveSend({ ok: true })
    await expect(result).resolves.toEqual({ ok: true })
  })

  it("does not mark an existing run idle when a steer bridge call fails", () => {
    expect(shouldEndOptimisticRunAfterBridgeFailure(true)).toBe(false)
    expect(shouldEndOptimisticRunAfterBridgeFailure(false)).toBe(true)
  })
})
