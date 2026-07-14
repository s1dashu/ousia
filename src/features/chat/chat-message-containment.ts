export const CHAT_MESSAGE_MEASURED_ATTRIBUTE =
  "data-chat-measured-block-size"
export const CHAT_MESSAGE_INTRINSIC_BLOCK_SIZE_PROPERTY =
  "--ousia-chat-message-intrinsic-block-size"

export function formatMeasuredChatMessageBlockSize(blockSize: number) {
  if (!Number.isFinite(blockSize) || blockSize <= 0) {
    throw new Error(
      `Chat message block size must be a positive finite number; received ${blockSize}.`,
    )
  }
  return `${Math.ceil(blockSize * 1000) / 1000}px`
}
