import type { HTMLAttributes } from "react"

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: HTMLAttributes<Electron.WebviewTag> & {
        allowpopups?: boolean
        partition?: string
        src?: string
        webpreferences?: string
      }
    }
  }
}

export {}
