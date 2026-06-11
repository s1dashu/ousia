import type { BrowserWindow } from "electron"
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { chmod, readFile, stat, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { homedir } from "node:os"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { randomBytes } from "node:crypto"

import { loadAppState } from "./app-state-store.js"
import type { OusiaWorkspaceAction } from "./chat-types.js"

const pdfEditorExtensionId = "extension.firstParty.pdfEditor"
const excalidrawExtensionId = "extension.firstParty.excalidraw"
const workspaceExtensions = [
  { id: "extension.firstParty.browser", title: "浏览器", aliases: ["browser", "web", "浏览器"] },
  { id: "extension.firstParty.editor", title: "编辑器", aliases: ["editor", "code", "file", "编辑器"] },
  { id: "extension.firstParty.terminal", title: "终端", aliases: ["terminal", "shell", "bash", "终端"] },
  { id: "extension.firstParty.pdfEditor", title: "PDF", aliases: ["pdf", "pdfeditor", "pdf-editor", "PDF", "PDF编辑器", "PDF 编辑器"] },
  { id: "extension.firstParty.excalidraw", title: "Excalidraw", aliases: ["excalidraw", "whiteboard", "画板", "白板"] },
  { id: "extension.firstParty.univerSheets", title: "表格", aliases: ["excel", "spreadsheet", "sheet", "sheets", "table", "univer", "表格", "电子表格"] },
]
const workspaceExtensionIds = new Set(
  workspaceExtensions.map((extension) => extension.id)
)
let bridgeEndpoint:
  | {
      host: string
      port: number
      token: string
    }
  | undefined

type CliInvokePayload = {
  extension?: string
  extensionId?: string
  action?: string
  args?: unknown
}

type CliBridgeOptions = {
  getMainWindow: () => BrowserWindow | undefined
  expandHomePath: (path: string) => string
  isPathInside: (parent: string, child: string) => boolean
}

type ExtensionActionHelp = {
  name: string
  description: string
  arguments?: Record<string, string>
  example: string
  notes?: string[]
}

function ousiaHomeDir() {
  return join(homedir(), ".ousia")
}

export function ousiaCliBinDir() {
  return join(ousiaHomeDir(), "bin")
}

function bridgeStatePath() {
  return join(ousiaHomeDir(), "desktop-bridge.json")
}

function cliPath() {
  return join(ousiaCliBinDir(), "ousia")
}

function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS,POST",
    "access-control-allow-headers": "authorization,content-type,range",
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

function textResponse(
  response: ServerResponse,
  statusCode: number,
  message: string
) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS,POST",
    "access-control-allow-headers": "authorization,content-type,range",
  })
  response.end(message)
}

function corsPreflightResponse(response: ServerResponse) {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS,POST",
    "access-control-allow-headers": "authorization,content-type,range",
    "access-control-max-age": "86400",
  })
  response.end()
}

function parseRangeHeader(range: string | undefined, size: number) {
  if (!range) {
    return null
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    return null
  }
  const startText = match[1]
  const endText = match[2]
  if (!startText && !endText) {
    return null
  }
  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null
    }
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }
  const start = Number(startText)
  const end = endText ? Number(endText) : size - 1
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null
  }
  return {
    start,
    end: Math.min(end, size - 1),
  }
}

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? (JSON.parse(text) as unknown) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function summarizeAction(action: Omit<OusiaWorkspaceAction, "requestId">) {
  const args = isRecord(action.args) ? action.args : {}
  if (
    action.extensionId === excalidrawExtensionId &&
    action.action === "openFile"
  ) {
    const scene = isRecord(args.scene) ? args.scene : undefined
    const elements = Array.isArray(scene?.elements) ? scene.elements : []
    return {
      ...action,
      args: {
        path: args.path,
        name: args.name,
        focus: args.focus,
        scene: {
          type: scene?.type,
          version: scene?.version,
          elements: elements.length,
        },
      },
    }
  }
  return action
}

function normalizeLookupText(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

function resolveWorkspaceExtensionId(value: string | undefined) {
  if (!value) {
    return undefined
  }
  if (workspaceExtensionIds.has(value)) {
    return value
  }
  const normalized = normalizeLookupText(value)
  return workspaceExtensions.find((extension) => {
    if (normalizeLookupText(extension.title) === normalized) {
      return true
    }
    return extension.aliases.some(
      (alias) => normalizeLookupText(alias) === normalized
    )
  })?.id
}

function extensionActionHelp(extensionId: string): ExtensionActionHelp[] {
  const actions: ExtensionActionHelp[] = [
    {
      name: "help",
      description:
        "Return the supported actions, arguments, examples, and current limitations for this extension. Call this before choosing an action.",
      example: `ousia extension invoke --extension ${extensionId} --action help`,
    },
    {
      name: "openAndFocus",
      description:
        "Open a workspace tab for this extension if needed, then focus it.",
      example: `ousia extension invoke --extension ${extensionId} --action openAndFocus`,
    },
  ]

  if (extensionId === pdfEditorExtensionId) {
    actions.push({
      name: "openFile",
      description:
        "Open an existing PDF from the current Ousia project or default work directory in the PDF editor.",
      arguments: {
        path: "Required string. Relative to the current Ousia project/default work directory, or an absolute path inside that directory.",
      },
      example: `ousia extension invoke --extension ${extensionId} --action openFile --json '{"path":"relative-or-absolute.pdf"}'`,
      notes: [
        "Only .pdf files are supported.",
        "The file must already exist.",
        "For safety, the file must be inside the current Ousia project or default work directory.",
        "Current PDF editor actions do not support search, text lookup, page lookup, page jump, current-file inspection, or document state inspection.",
        "If the user mentions a loose folder name such as document/Documents, search the filesystem for the file path first. If the matching PDF is outside the current Ousia project/default work directory, explain that openFile cannot open it until the project/default work directory includes that file.",
      ],
    })
  }

  if (extensionId === excalidrawExtensionId) {
    actions.push({
      name: "openFile",
      description:
        "Open an existing .excalidraw scene file from a registered Ousia project or the default work directory in Excalidraw.",
      arguments: {
        path: "Required string. Relative to the default work directory, or an absolute path inside a registered Ousia project/default work directory.",
      },
      example: `ousia extension invoke --extension ${extensionId} --action openFile --json '{"path":"relative-or-absolute.excalidraw"}'`,
      notes: [
        "Only .excalidraw files are supported.",
        "The file must already exist.",
        "For safety, the file must be inside a registered Ousia project or the default work directory.",
        "The file must contain an Excalidraw scene JSON object with an elements array.",
      ],
    })
  }

  return actions
}

function extensionHelp(extensionId: string) {
  const extension = workspaceExtensions.find((item) => item.id === extensionId)
  return {
    ok: true,
    extension: extension ?? { id: extensionId },
    actions: extensionActionHelp(extensionId),
    workflow: [
      "Call help before invoking extension-specific actions.",
      "Use only action names listed in this help response.",
      "Do not invent actions. If the needed capability is not listed, explain the limitation and use filesystem or project tools when appropriate.",
    ],
  }
}

async function selectedProjectPath(expandHomePath: (path: string) => string) {
  const state = await loadAppState()
  const selectedProject = state.projects.find(
    (project) => project.id === state.selectedProjectId
  )
  return resolve(expandHomePath(selectedProject?.path ?? state.settings.defaultWorkDir))
}

async function accessibleProjectRoots(expandHomePath: (path: string) => string) {
  const state = await loadAppState()
  return [
    resolve(expandHomePath(state.settings.defaultWorkDir)),
    ...state.projects.map((project) => resolve(expandHomePath(project.path))),
  ]
}

async function normalizePdfPath(
  filePath: string,
  options: Pick<CliBridgeOptions, "expandHomePath" | "isPathInside">
) {
  const projectRoot = await selectedProjectPath(options.expandHomePath)
  const absolutePath = isAbsolute(options.expandHomePath(filePath))
    ? resolve(options.expandHomePath(filePath))
    : resolve(projectRoot, filePath)

  if (!options.isPathInside(projectRoot, absolutePath)) {
    throw new Error("PDF 文件必须位于当前 Ousia 项目或默认工作目录内。")
  }
  if (!existsSync(absolutePath) || extname(absolutePath).toLowerCase() !== ".pdf") {
    throw new Error("只能打开已存在的 PDF 文件。")
  }

  return {
    projectRoot,
    absolutePath,
    path: relative(projectRoot, absolutePath),
    name: basename(absolutePath),
  }
}

async function normalizeExcalidrawPath(
  filePath: string,
  options: Pick<CliBridgeOptions, "expandHomePath" | "isPathInside">
) {
  const projectRoots = await accessibleProjectRoots(options.expandHomePath)
  const fallbackRoot = projectRoots[0]
  const absolutePath = isAbsolute(options.expandHomePath(filePath))
    ? resolve(options.expandHomePath(filePath))
    : resolve(fallbackRoot, filePath)
  const projectRoot = projectRoots.find((root) =>
    options.isPathInside(root, absolutePath)
  )

  if (!projectRoot) {
    throw new Error(
      "Excalidraw 文件必须位于已注册的 Ousia 项目或默认工作目录内。"
    )
  }
  if (
    !existsSync(absolutePath) ||
    extname(absolutePath).toLowerCase() !== ".excalidraw"
  ) {
    throw new Error("只能打开已存在的 .excalidraw 文件。")
  }

  const text = await readFile(absolutePath, "utf8")
  let scene: unknown
  try {
    scene = JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `无法解析 Excalidraw 文件 ${absolutePath}：${error.message}。文件可能被截断或不是有效 JSON。`
      )
    }
    throw error
  }
  if (
    !isRecord(scene) ||
    scene.type !== "excalidraw" ||
    !Array.isArray(scene.elements)
  ) {
    throw new Error(
      `Excalidraw 文件 ${absolutePath} 必须包含有效的 scene JSON。`
    )
  }

  return {
    projectRoot,
    absolutePath,
    path: relative(projectRoot, absolutePath),
    name: basename(absolutePath),
    scene,
  }
}

async function serveProjectPdf(
  request: IncomingMessage,
  response: ServerResponse,
  options: Pick<CliBridgeOptions, "expandHomePath" | "isPathInside">
) {
  if (!bridgeEndpoint) {
    textResponse(response, 503, "Ousia bridge is not ready.")
    return
  }
  const url = new URL(request.url ?? "/", `http://${bridgeEndpoint.host}`)
  if (url.searchParams.get("token") !== bridgeEndpoint.token) {
    textResponse(response, 404, "Not found")
    return
  }
  const requestedPath = url.searchParams.get("path")
  if (!requestedPath) {
    textResponse(response, 400, "Missing PDF path.")
    return
  }
  try {
    const file = await normalizePdfPath(requestedPath, options)
    const fileStat = await stat(file.absolutePath)
    const range = parseRangeHeader(request.headers.range, fileStat.size)
    const baseHeaders = {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,HEAD,OPTIONS,POST",
      "access-control-allow-headers": "authorization,content-type,range",
      "access-control-expose-headers":
        "accept-ranges,content-length,content-range",
    }
    if (range) {
      response.writeHead(206, {
        ...baseHeaders,
        "content-length": String(range.end - range.start + 1),
        "content-range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
      })
      if (request.method !== "HEAD") {
        createReadStream(file.absolutePath, range).pipe(response)
      } else {
        response.end()
      }
      return
    }
    response.writeHead(200, {
      ...baseHeaders,
      "content-length": String(fileStat.size),
    })
    if (request.method !== "HEAD") {
      createReadStream(file.absolutePath).pipe(response)
    } else {
      response.end()
    }
  } catch (error) {
    textResponse(
      response,
      400,
      error instanceof Error ? error.message : String(error)
    )
  }
}

function pdfSourceUrl(path: string) {
  if (!bridgeEndpoint) {
    throw new Error("Ousia CLI bridge 尚未就绪。")
  }
  const url = new URL(`http://${bridgeEndpoint.host}:${bridgeEndpoint.port}/project-pdf`)
  url.searchParams.set("token", bridgeEndpoint.token)
  url.searchParams.set("path", path)
  return url.toString()
}

async function normalizeExtensionInvoke(
  payload: CliInvokePayload,
  options: Pick<CliBridgeOptions, "expandHomePath" | "isPathInside">
): Promise<Omit<OusiaWorkspaceAction, "requestId">> {
  const requestedExtension = payload.extensionId ?? payload.extension
  const extensionId = resolveWorkspaceExtensionId(requestedExtension)
  if (!extensionId) {
    throw new Error(`未知 Ousia workspace extension：${requestedExtension ?? ""}`)
  }
  if (payload.action === "openAndFocus") {
    return {
      type: "extension.invoke",
      extensionId,
      action: "openAndFocus",
      args: {},
    }
  }
  if (payload.action === "openFile") {
    if (extensionId !== pdfEditorExtensionId) {
      if (extensionId !== excalidrawExtensionId) {
        throw new Error("openFile 当前仅支持 PDF 编辑器和 Excalidraw。")
      }
      if (!isRecord(payload.args) || typeof payload.args.path !== "string") {
        throw new Error(
          "Excalidraw openFile 需要 JSON 参数：{\"path\":\"file.excalidraw\"}。"
        )
      }
      const file = await normalizeExcalidrawPath(payload.args.path, options)
      return {
        type: "extension.invoke",
        extensionId,
        action: "openFile",
        args: {
          ...payload.args,
          path: file.path,
          name: file.name,
          projectPath: file.projectRoot,
          scene: file.scene,
          focus: true,
        },
      }
    }
    if (!isRecord(payload.args) || typeof payload.args.path !== "string") {
      throw new Error("openFile 需要 JSON 参数：{\"path\":\"file.pdf\"}。")
    }
    const file = await normalizePdfPath(payload.args.path, options)
    return {
      type: "extension.invoke",
      extensionId,
      action: "openFile",
      args: {
        ...payload.args,
        path: file.path,
        name: file.name,
        projectPath: file.projectRoot,
        src: pdfSourceUrl(file.path),
        focus: true,
      },
    }
  }
  throw new Error(`未知扩展动作：${payload.action}`)
}

async function handleInvoke(
  payload: CliInvokePayload,
  options: CliBridgeOptions
) {
  const requestedExtension = payload.extensionId ?? payload.extension
  const extensionId = resolveWorkspaceExtensionId(requestedExtension)
  if (!extensionId) {
    throw new Error(`未知 Ousia workspace extension：${requestedExtension ?? ""}`)
  }
  if (payload.action === "help") {
    return extensionHelp(extensionId)
  }

  const mainWindow = options.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Ousia 主窗口不可用。")
  }

  const action = await normalizeExtensionInvoke(payload, options)
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send("ousia:workspace:action", {
    ...action,
    requestId: `cli-${Date.now()}-${randomBytes(4).toString("hex")}`,
  } satisfies OusiaWorkspaceAction)
  return { ok: true, action: summarizeAction(action) }
}

async function installCliShim() {
  mkdirSync(ousiaCliBinDir(), { recursive: true })
  const source = `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")

function usage() {
  console.error("Usage:")
  console.error("  ousia extension list")
  console.error("  ousia extension invoke --extension <id> --action <name> [--json '<payload>']")
  console.error("  ousia extension invoke --extension <id> --action <name> [--json-file payload.json]")
  console.error("  ousia extension invoke --extension <id> --action help")
  process.exit(2)
}

const workspaceExtensions = ${JSON.stringify(workspaceExtensions)}

function readBridge() {
  const bridgePath = path.join(os.homedir(), ".ousia", "desktop-bridge.json")
  return JSON.parse(fs.readFileSync(bridgePath, "utf8"))
}

function parseArgs(argv) {
  if (argv[0] !== "extension") usage()
  if (argv[1] === "list") {
    return { mode: "list" }
  }
  if (argv[1] !== "invoke") usage()
  const result = {}
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--extension" || arg === "--extension-id") {
      result.extensionId = next
      index += 1
    } else if (arg === "--action") {
      result.action = next
      index += 1
    } else if (arg === "--json") {
      result.args = JSON.parse(next || "{}")
      index += 1
    } else if (arg === "--json-file") {
      result.args = JSON.parse(fs.readFileSync(next || "", "utf8"))
      index += 1
    } else {
      usage()
    }
  }
  if (!result.extensionId || !result.action) usage()
  result.mode = "invoke"
  return result
}

function postJson(bridge, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const request = http.request({
      hostname: bridge.host,
      port: bridge.port,
      method: "POST",
      path: "/extension/invoke",
      headers: {
        "authorization": "Bearer " + bridge.token,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8")
        if (response.statusCode >= 400) {
          reject(new Error(text.trim() || "Ousia CLI request failed"))
          return
        }
        resolve(text)
      })
    })
    request.on("error", reject)
    request.end(body)
  })
}

async function main() {
  const payload = parseArgs(process.argv.slice(2))
  if (payload.mode === "list") {
    process.stdout.write(JSON.stringify({
      extensions: workspaceExtensions
    }, null, 2) + "\\n")
    return
  }
  const bridge = readBridge()
  const text = await postJson(bridge, payload)
  process.stdout.write(text)
}

main().catch((error) => {
  console.error(error.message || String(error))
  process.exit(1)
})
`
  await writeFile(cliPath(), source, "utf8")
  await chmod(cliPath(), 0o755)
}

export async function startCliBridge(options: CliBridgeOptions) {
  await installCliShim()
  const token = randomBytes(24).toString("hex")
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        corsPreflightResponse(response)
        return
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        request.url?.startsWith("/project-pdf")
      ) {
        await serveProjectPdf(request, response, options)
        return
      }
      if (
        request.method !== "POST" ||
        request.url !== "/extension/invoke" ||
        request.headers.authorization !== `Bearer ${token}`
      ) {
        jsonResponse(response, 404, { ok: false, error: "Not found" })
        return
      }
      const payload = (await readRequestJson(request)) as CliInvokePayload
      jsonResponse(response, 200, await handleInvoke(payload, options))
    } catch (error) {
      jsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await new Promise<void>((resolveServer) => {
    server.listen(0, "127.0.0.1", resolveServer)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("无法启动 Ousia CLI bridge。")
  }
  bridgeEndpoint = {
    host: "127.0.0.1",
    port: address.port,
    token,
  }
  mkdirSync(dirname(bridgeStatePath()), { recursive: true })
  writeFileSync(
    bridgeStatePath(),
    `${JSON.stringify(
      bridgeEndpoint,
      null,
      2
    )}\n`,
    "utf8"
  )
  return server
}
