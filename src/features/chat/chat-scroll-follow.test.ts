import { describe, expect, it } from "vitest"

import {
  canScrollInDirection,
  chatBottomClearanceForOverlay,
  classifyChatScrollMovement,
  decideChatScrollFollow,
  decideFilePreviewFollowState,
  isScrollAtLatest,
} from "./chat-scroll-follow"

describe("chat scroll following", () => {
  it("restores the bottom after a layout-driven scroll change", () => {
    expect(
      decideChatScrollFollow({
        hasPendingProgrammaticScroll: false,
        isAtLatest: false,
        isFollowingLatest: true,
        isScrollingTowardHistory: false,
        manualScrollAwayFromLatest: false,
        manualScrollIntent: false,
      }),
    ).toBe("restore")
  })

  it("stops only when an explicit scroll intent moves away from the bottom", () => {
    expect(
      decideChatScrollFollow({
        hasPendingProgrammaticScroll: false,
        isAtLatest: false,
        isFollowingLatest: true,
        isScrollingTowardHistory: true,
        manualScrollAwayFromLatest: true,
        manualScrollIntent: true,
      }),
    ).toBe("stop")
    expect(
      decideChatScrollFollow({
        hasPendingProgrammaticScroll: false,
        isAtLatest: true,
        isFollowingLatest: true,
        isScrollingTowardHistory: false,
        manualScrollAwayFromLatest: false,
        manualScrollIntent: true,
      }),
    ).toBe("follow")
  })

  it("stops following when actual upward movement reveals missed wheel intent", () => {
    expect(
      decideChatScrollFollow({
        hasPendingProgrammaticScroll: false,
        isAtLatest: false,
        isFollowingLatest: true,
        isScrollingTowardHistory: true,
        manualScrollAwayFromLatest: false,
        manualScrollIntent: false,
      }),
    ).toBe("stop-observed-history-scroll")
  })

  it("does not mistake a pending programmatic correction for user scrolling", () => {
    expect(
      decideChatScrollFollow({
        hasPendingProgrammaticScroll: true,
        isAtLatest: false,
        isFollowingLatest: true,
        isScrollingTowardHistory: true,
        manualScrollAwayFromLatest: false,
        manualScrollIntent: false,
      }),
    ).toBe("restore")
  })

  it("adds only the clearance not already provided by bottom padding", () => {
    expect(
      chatBottomClearanceForOverlay({
        existingBottomPadding: 64,
        overlay: { top: 680, bottom: 820 },
        viewport: { top: 100, bottom: 800 },
      }),
    ).toBe(56)
    expect(
      chatBottomClearanceForOverlay({
        existingBottomPadding: 64,
        overlay: { top: 750, bottom: 820 },
        viewport: { top: 100, bottom: 800 },
      }),
    ).toBe(0)
  })

  it("does not treat layout-driven upward movement as user intent", () => {
    expect(
      classifyChatScrollMovement(
        { clientHeight: 500, scrollHeight: 1500, scrollTop: 1000 },
        { clientHeight: 500, scrollHeight: 1400, scrollTop: 900 },
      ),
    ).toEqual({
      geometryChanged: true,
      isScrollingTowardHistory: true,
      isUnexplainedHistoryScroll: false,
    })
  })

  it("keeps upward movement authoritative when scroll geometry is unchanged", () => {
    expect(
      classifyChatScrollMovement(
        { clientHeight: 500, scrollHeight: 1500, scrollTop: 1000 },
        { clientHeight: 500, scrollHeight: 1500, scrollTop: 900 },
      ).isUnexplainedHistoryScroll,
    ).toBe(true)
  })

  it("recognizes when a nested file preview can consume the wheel delta", () => {
    const middle = { clientHeight: 200, scrollHeight: 600, scrollTop: 200 }
    expect(canScrollInDirection(middle, -10)).toBe(true)
    expect(canScrollInDirection(middle, 10)).toBe(true)
    expect(canScrollInDirection({ ...middle, scrollTop: 0 }, -10)).toBe(false)
    expect(canScrollInDirection({ ...middle, scrollTop: 400 }, 10)).toBe(false)
  })

  it("uses a tolerance for fractional bottom positions", () => {
    expect(
      isScrollAtLatest({
        clientHeight: 500,
        scrollHeight: 1023.5,
        scrollTop: 500,
      }),
    ).toBe(true)
  })

  it("keeps a file preview following while asynchronous rendering grows it", () => {
    expect(
      decideFilePreviewFollowState({
        hasScrollableContent: true,
        isAtLatest: false,
        isFollowingLatest: true,
      }),
    ).toEqual({
      isFollowingLatest: true,
      showScrollToLatest: false,
    })
  })

  it("shows the file preview latest button only after following was opted out", () => {
    expect(
      decideFilePreviewFollowState({
        hasScrollableContent: true,
        isAtLatest: false,
        isFollowingLatest: false,
      }),
    ).toEqual({
      isFollowingLatest: false,
      showScrollToLatest: true,
    })
    expect(
      decideFilePreviewFollowState({
        hasScrollableContent: true,
        isAtLatest: true,
        isFollowingLatest: false,
      }),
    ).toEqual({
      isFollowingLatest: true,
      showScrollToLatest: false,
    })
  })
})
