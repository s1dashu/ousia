# Streamdown

## Usage

Assistant messages are rendered in `src/features/chat/ChatArea.tsx` with Vercel
Streamdown.

Current renderer configuration:

```tsx
<Streamdown
  mode={item.status === "streaming" ? "streaming" : "static"}
  animated
  isAnimating={item.status === "streaming"}
  linkSafety={{ enabled: false }}
  className="ousia-chat-markdown space-y-0 break-words text-sm leading-5"
>
  {item.text}
</Streamdown>
```

Ousia preserves Streamdown's per-word animation so slower providers still have
a natural streaming cadence. A fast provider can emit words faster than that
animation can play, however, leaving animation queued in an earlier paragraph
after later paragraphs are already visible. When a later Markdown block
appears, CSS completes any remaining animation in preceding blocks immediately.
This prevents animation work from crossing a paragraph/block boundary without
throttling provider output, delaying newer content, or flattening the active
block's word-by-word animation.

## Link Safety

Streamdown enables its link safety modal by default. The modal asks the user to confirm before opening a link, then calls the browser API `window.open(url, "_blank", "noreferrer")`.

Ousia disables this modal with `linkSafety={{ enabled: false }}` because chat links should behave like normal Markdown links without the extra Streamdown confirmation UI.

Streamdown itself does not provide an Electron default-browser integration. In Electron, Streamdown links create a new-window request through `target="_blank"` or `window.open()`. Ousia handles that as a general main-process window policy in `src/electron/window-host.ts`:

```ts
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (isExternalUrl(url)) {
    void shell.openExternal(url)
  }
  return { action: "deny" }
})
```

Do not add a renderer-to-main IPC API only for Streamdown links. If link behavior needs to change, prefer updating the general Electron window policy.

## Styling

Streamdown styles are imported in `src/features/chat/ChatArea.tsx`:

```ts
import "streamdown/styles.css"
```

Keep assistant message styling in the surrounding chat layout unless a Streamdown-specific override is required.

Ousia overrides Streamdown's root `space-y-4` rhythm in chat with `space-y-0`
and keeps prose-like Markdown nodes close to the compact `text-sm` chat cadence.
Block spacing and slightly roomier heading line-height are handled by
`.ousia-chat-markdown` in `src/index.css`.
