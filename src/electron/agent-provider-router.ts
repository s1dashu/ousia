import { resolve } from "node:path"

import type {
  OusiaAgentProvider,
  OusiaAppState,
  OusiaChatBranchPayload,
  OusiaChatBranchResult,
  OusiaChatClearQueueResult,
  OusiaChatCompactPayload,
  OusiaChatCompactResult,
  OusiaChatContext,
  OusiaChatContextUsageResult,
  OusiaChatExportPayload,
  OusiaChatExportResult,
  OusiaChatHistoryPayload,
  OusiaChatHistoryResult,
  OusiaChatInterruptPayload,
  OusiaChatInterruptResult,
  OusiaChatMovePayload,
  OusiaChatMoveResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaChatToolPayloadPayload,
  OusiaChatToolPayloadResult,
  OusiaSessionRecord,
} from "./chat-types.js"
import { loadAppState } from "./app-state-store.js"
import { expandHomePath } from "./host-paths.js"
import { writeRuntimeLog } from "./runtime-logger.js"

export type AgentConversationProvider = {
  branchChat(payload: OusiaChatBranchPayload): Promise<OusiaChatBranchResult>
  clearChatQueue(
    context: OusiaChatContext
  ): Promise<OusiaChatClearQueueResult>
  compactChat(payload: OusiaChatCompactPayload): Promise<OusiaChatCompactResult>
  exportChat(
    payload: OusiaChatExportPayload,
    outputPath: string
  ): Promise<OusiaChatExportResult>
  getContextUsage(
    context: OusiaChatContext
  ): Promise<OusiaChatContextUsageResult>
  getChatHistory(
    payload: OusiaChatHistoryPayload
  ): Promise<OusiaChatHistoryResult>
  getChatToolPayload(
    payload: OusiaChatToolPayloadPayload
  ): Promise<OusiaChatToolPayloadResult>
  interruptChat(
    payload: OusiaChatInterruptPayload
  ): Promise<OusiaChatInterruptResult>
  moveChatSession(payload: OusiaChatMovePayload): Promise<OusiaChatMoveResult>
  sendChatMessage(payload: OusiaChatSendPayload): Promise<OusiaChatSendResult>
}

type AgentProviderRouterOptions = {
  codex: AgentConversationProvider
  pi: AgentConversationProvider
}

export type CanonicalAgentContext = {
  agentProvider: OusiaAgentProvider
  context: OusiaChatContext
}

function absoluteProjectPath(projectPath: string, label: string) {
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error(`${label} cannot be empty.`)
  }
  return resolve(expandHomePath(projectPath))
}

function canonicalProjectPathForSession(
  state: OusiaAppState,
  session: OusiaSessionRecord
) {
  if (!session.projectId) {
    return state.settings.defaultWorkDir
  }
  const project = state.projects.find(
    (candidate) => candidate.id === session.projectId
  )
  if (!project) {
    writeRuntimeLog("agent.context", "error", {
      message: "Session references an unknown canonical project",
      projectId: session.projectId,
      sessionId: session.id,
    })
    throw new Error(
      `Unknown project: ${session.projectId} (session: ${session.id})`
    )
  }
  return project.path
}

function canonicalAgentContextFromState(
  state: OusiaAppState,
  requestedContext: OusiaChatContext
): CanonicalAgentContext {
  const session = state.sessions.find(
    (candidate) => candidate.id === requestedContext.sessionId
  )
  if (!session) {
    writeRuntimeLog("agent.context", "error", {
      message: "Rejected agent context for unknown session",
      sessionId: requestedContext.sessionId,
    })
    throw new Error(`Unknown session: ${requestedContext.sessionId}`)
  }

  const canonicalProjectPath = canonicalProjectPathForSession(state, session)
  const requestedAbsolutePath = absoluteProjectPath(
    requestedContext.projectPath,
    "Requested project path"
  )
  const canonicalAbsolutePath = absoluteProjectPath(
    canonicalProjectPath,
    "Canonical project path"
  )
  if (requestedAbsolutePath !== canonicalAbsolutePath) {
    writeRuntimeLog("agent.context", "warn", {
      message: "Rejected non-canonical agent project path",
      canonicalProjectPath,
      requestedProjectPath: requestedContext.projectPath,
      sessionId: session.id,
    })
    throw new Error(`Project path mismatch for session: ${session.id}`)
  }
  if (requestedContext.projectPath !== canonicalProjectPath) {
    writeRuntimeLog("agent.context", "debug", {
      message: "Canonicalized equivalent agent project path",
      canonicalProjectPath,
      requestedProjectPath: requestedContext.projectPath,
      sessionId: session.id,
    })
  }

  return {
    agentProvider: session.agentProvider,
    context: {
      projectPath: canonicalProjectPath,
      sessionId: session.id,
    },
  }
}

export async function resolveCanonicalAgentContext(
  requestedContext: OusiaChatContext
): Promise<CanonicalAgentContext> {
  return canonicalAgentContextFromState(await loadAppState(), requestedContext)
}

function canonicalPayload<T extends OusiaChatContext>(
  payload: T,
  context: OusiaChatContext
): T {
  return { ...payload, ...context }
}

export function createAgentProviderRouter({
  codex,
  pi,
}: AgentProviderRouterOptions): AgentConversationProvider {
  const providers: Record<OusiaAgentProvider, AgentConversationProvider> = {
    codex,
    pi,
  }

  function providerForRoute(route: CanonicalAgentContext) {
    const provider = providers[route.agentProvider]
    if (!provider) {
      throw new Error(`Unknown agent provider: ${String(route.agentProvider)}`)
    }
    writeRuntimeLog("agent.route", "debug", {
      agentProvider: route.agentProvider,
      projectPath: route.context.projectPath,
      sessionId: route.context.sessionId,
    })
    return provider
  }

  async function routeForContext(context: OusiaChatContext) {
    const route = await resolveCanonicalAgentContext(context)
    return { provider: providerForRoute(route), route }
  }

  return {
    async branchChat(payload) {
      const state = await loadAppState()
      const route = canonicalAgentContextFromState(state, payload)
      const targetRoute = canonicalAgentContextFromState(state, {
        projectPath: route.context.projectPath,
        sessionId: payload.targetSessionId,
      })
      if (targetRoute.agentProvider !== route.agentProvider) {
        throw new Error(
          `Branch target provider mismatch: ${payload.targetSessionId}`
        )
      }
      return providerForRoute(route).branchChat(
        canonicalPayload(payload, route.context)
      )
    },
    async clearChatQueue(context) {
      const { provider, route } = await routeForContext(context)
      return provider.clearChatQueue(route.context)
    },
    async compactChat(payload) {
      const { provider, route } = await routeForContext(payload)
      return provider.compactChat(canonicalPayload(payload, route.context))
    },
    async exportChat(payload, outputPath) {
      const { provider, route } = await routeForContext(payload)
      return provider.exportChat(
        canonicalPayload(payload, route.context),
        outputPath
      )
    },
    async getContextUsage(context) {
      const { provider, route } = await routeForContext(context)
      return provider.getContextUsage(route.context)
    },
    async getChatHistory(payload) {
      const { provider, route } = await routeForContext(payload)
      return provider.getChatHistory(canonicalPayload(payload, route.context))
    },
    async getChatToolPayload(payload) {
      const { provider, route } = await routeForContext(payload)
      return provider.getChatToolPayload(
        canonicalPayload(payload, route.context)
      )
    },
    async interruptChat(payload) {
      const { provider, route } = await routeForContext(payload)
      return provider.interruptChat(canonicalPayload(payload, route.context))
    },
    async moveChatSession(payload) {
      const state = await loadAppState()
      const route = canonicalAgentContextFromState(state, {
        projectPath: payload.sourceProjectPath,
        sessionId: payload.sessionId,
      })
      const targetProjectPath =
        payload.targetProjectId !== undefined
        ? state.projects.find(
            (candidate) => candidate.id === payload.targetProjectId
          )?.path
        : state.settings.defaultWorkDir
      if (!targetProjectPath) {
        writeRuntimeLog("agent.context", "error", {
          message: "Rejected move to unknown canonical project",
          projectId: payload.targetProjectId,
          sessionId: payload.sessionId,
        })
        throw new Error(`Unknown project: ${payload.targetProjectId}`)
      }
      if (
        absoluteProjectPath(payload.targetProjectPath, "Requested target path") !==
        absoluteProjectPath(targetProjectPath, "Canonical target path")
      ) {
        writeRuntimeLog("agent.context", "warn", {
          message: "Rejected non-canonical move target path",
          canonicalProjectPath: targetProjectPath,
          projectId: payload.targetProjectId,
          requestedProjectPath: payload.targetProjectPath,
          sessionId: payload.sessionId,
        })
        throw new Error(`Target project path mismatch for session: ${payload.sessionId}`)
      }
      return providerForRoute(route).moveChatSession({
        ...payload,
        sourceProjectPath: route.context.projectPath,
        targetProjectPath,
      })
    },
    async sendChatMessage(payload) {
      const { provider, route } = await routeForContext(payload)
      return provider.sendChatMessage(canonicalPayload(payload, route.context))
    },
  }
}
