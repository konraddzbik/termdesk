declare module '@novnc/novnc' {
  interface RFBOptions {
    shared?: boolean
    credentials?: { username?: string; password?: string; target?: string }
    wsProtocols?: string[]
  }

  interface RFBEventMap {
    connect: CustomEvent<Record<string, never>>
    disconnect: CustomEvent<{ clean: boolean }>
    credentialsrequired: CustomEvent<{ types: string[] }>
    securityfailure: CustomEvent<{ status: number; reason: string }>
    rfberror: CustomEvent<{ message: string }>
    securitytype: CustomEvent<{ type: number }>
    serververification: CustomEvent<{ type: string; publickey: Uint8Array }>
    ra2phase: CustomEvent<{ phase: string }>
    clipboard: CustomEvent<{ text: string }>
    desktopname: CustomEvent<{ name: string }>
  }

  export default class RFB extends EventTarget {
    constructor(target: Element, url: string, options?: RFBOptions)

    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    qualityLevel: number
    compressionLevel: number
    showDotCursor: boolean
    background: string
    focusOnClick: boolean

    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void
    approveServer(): void
    sendCtrlAltDel(): void
    clipboardPasteFrom(text: string): void
    machineShutdown(): void
    machineReboot(): void
    machineReset(): void
    disconnect(): void
    focus(): void
    blur(): void

    addEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (event: RFBEventMap[K]) => void,
      options?: boolean | AddEventListenerOptions,
    ): void
    removeEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (event: RFBEventMap[K]) => void,
      options?: boolean | EventListenerOptions,
    ): void
  }
}
