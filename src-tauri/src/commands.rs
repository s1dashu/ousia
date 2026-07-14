use chrono::{TimeZone, Utc};
use serde_json::{Map, Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration as StdDuration, Instant as StdInstant},
};
use tauri::{AppHandle, State};
use tokio::time::{Instant, sleep};

use crate::{
    paths::pi_agent_dir,
    rpc::{AgentConfiguration, PiHost, PromptTrace, content_text, tools_for_mode},
    runtime::binary_on_login_path,
    state::{
        ChatContext, load_app_state_file, resolve_chat_context, save_app_state_file,
        write_json_atomic,
    },
};

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<Option<Value>, String> {
    load_app_state_file(&app)
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, state: Value) -> Result<(), String> {
    save_app_state_file(&app, &state)
}

#[tauri::command]
pub fn report_frontend_error(host: State<'_, PiHost>, payload: Value) -> Result<(), String> {
    let kind = required_string(&payload, "kind")?;
    let message = required_string(&payload, "message")?;
    let stack = payload.get("stack").and_then(Value::as_str);
    if kind.chars().count() > 64 {
        return Err("Frontend error kind exceeds 64 characters.".to_string());
    }
    if message.chars().count() > 32_768 {
        return Err("Frontend error message exceeds 32,768 characters.".to_string());
    }
    if stack.is_some_and(|value| value.chars().count() > 131_072) {
        return Err("Frontend error stack exceeds 131,072 characters.".to_string());
    }
    let data = payload.get("data").cloned();
    if data
        .as_ref()
        .is_some_and(|value| value.to_string().chars().count() > 131_072)
    {
        return Err("Frontend error data exceeds 131,072 characters.".to_string());
    }
    host.logger().record(
        "error",
        "frontend",
        message,
        Some(json!({ "data": data, "kind": kind, "stack": stack })),
    );
    Ok(())
}

#[tauri::command]
pub fn report_frontend_log(host: State<'_, PiHost>, payload: Value) -> Result<(), String> {
    let level = required_string(&payload, "level")?;
    let scope = required_string(&payload, "scope")?;
    let message = required_string(&payload, "message")?;
    if !matches!(level, "debug" | "info" | "warn") {
        return Err(format!("Unsupported frontend log level: {level}"));
    }
    if scope.chars().count() > 64 {
        return Err("Frontend log scope exceeds 64 characters.".to_string());
    }
    if message.chars().count() > 32_768 {
        return Err("Frontend log message exceeds 32,768 characters.".to_string());
    }
    let data = payload.get("data").cloned();
    if data
        .as_ref()
        .is_some_and(|value| value.to_string().chars().count() > 131_072)
    {
        return Err("Frontend log data exceeds 131,072 characters.".to_string());
    }
    host.logger().record(level, scope, message, data);
    Ok(())
}

#[tauri::command]
pub async fn prepare_chat_session(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let started = Instant::now();
    let session_id = payload
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let defer_configuration = payload
        .get("deferConfiguration")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let ticket = host.begin_prepare(&session_id).await;
    let result = async {
        let context = context_from_payload(&app, &payload)?;
        let tools = tools_from_payload(&payload)?;
        let configuration = if defer_configuration {
            None
        } else {
            Some(configuration_from_payload(&payload)?)
        };
        let client = host.prepare_client(context, &tools, &ticket).await?;
        let configuration_result = match configuration {
            Some(configuration) => client.configure(&configuration).await,
            None => Ok(()),
        };
        host.finish_prepare(&ticket, &client).await;
        configuration_result?;
        drop(client);
        if !host.is_prepare_current(&ticket).await {
            return Ok(json!({ "ok": true, "superseded": true }));
        }
        let released_clients = host.release_idle_except(&session_id).await?;
        Ok(json!({ "ok": true, "releasedIdleClients": released_clients }))
    }
    .await;

    if !host.is_prepare_current(&ticket).await {
        host.logger().record(
            "info",
            "pi.prepare.lifecycle",
            "Stopped a superseded Pi session preparation",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "configurationDeferred": defer_configuration,
                "sessionId": session_id,
            })),
        );
        return Ok(json!({ "ok": true, "superseded": true }));
    }

    match &result {
        Ok(_) => host.logger().record(
            "info",
            "pi.prepare.timing",
            "Prepared the selected Pi session",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "sessionId": session_id,
            })),
        ),
        Err(error) => host.logger().record(
            "error",
            "pi.prepare",
            "Failed to prepare the selected Pi session",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "configurationDeferred": defer_configuration,
                "error": error,
                "sessionId": session_id,
            })),
        ),
    }
    result
}

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let send_started = StdInstant::now();
    let message_id = required_string(&payload, "messageId")?.to_string();
    if message_id.is_empty() || message_id.chars().count() > 200 {
        return Err("Chat message id must contain between 1 and 200 characters.".to_string());
    }

    let context_started = StdInstant::now();
    let context = context_from_payload(&app, &payload)?;
    let context_milliseconds = context_started.elapsed().as_millis();
    let tools = tools_from_payload(&payload)?;
    let client_started = StdInstant::now();
    let client = host.client(context, &tools).await?;
    let client_milliseconds = client_started.elapsed().as_millis();
    let client_reused = client.reused_existing_client();
    let configuration = configuration_from_payload(&payload)?;
    let configuration_started = StdInstant::now();
    client.configure(&configuration).await?;
    let configuration_milliseconds = configuration_started.elapsed().as_millis();

    let mut message = required_string(&payload, "prompt")?.trim().to_string();
    let mut images = Vec::new();
    for attachment in payload
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match required_string(attachment, "kind")? {
            "image" => images.push(json!({
                "type": "image",
                "data": required_string(attachment, "dataBase64")?,
                "mimeType": attachment.get("mediaType").and_then(Value::as_str).unwrap_or("image/png"),
            })),
            "text" => {
                let name = required_string(attachment, "name")?;
                let media_type = attachment
                    .get("mediaType")
                    .and_then(Value::as_str)
                    .unwrap_or("text/plain");
                let size = attachment.get("size").and_then(Value::as_u64).unwrap_or(0);
                let text = required_string(attachment, "text")?;
                message.push_str(&format!(
                    "\n\n<attached_file name={name:?} mediaType={media_type:?} size={size}>\n{text}\n</attached_file>"
                ));
            }
            "file" => {
                let name = required_string(attachment, "name")?;
                let media_type = attachment
                    .get("mediaType")
                    .and_then(Value::as_str)
                    .unwrap_or("application/octet-stream");
                let size = attachment.get("size").and_then(Value::as_u64).unwrap_or(0);
                message.push_str(&format!(
                    "\n\nThe user attached a non-text file whose content is unavailable to this client: {name} ({media_type}, {size} bytes)."
                ));
            }
            kind => return Err(format!("Unsupported attachment kind: {kind}")),
        }
    }
    if message.trim().is_empty() && images.is_empty() {
        return Err("A chat message or image is required.".to_string());
    }

    let behavior = payload
        .get("sendBehavior")
        .and_then(Value::as_str)
        .unwrap_or("normal");
    let command = match behavior {
        "normal" => json!({ "type": "prompt", "message": message, "images": images }),
        "steer" => json!({ "type": "steer", "message": message, "images": images }),
        "followUp" => json!({ "type": "follow_up", "message": message, "images": images }),
        other => return Err(format!("Unsupported send behavior: {other}")),
    };
    let attachment_count = payload
        .get("attachments")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let prompt_started = StdInstant::now();
    let prompt_result = if behavior == "normal" {
        client
            .call_prompt(
                command,
                PromptTrace::new(&message_id, send_started, &configuration, client_reused),
            )
            .await
    } else {
        client.call(command).await
    };
    if let Err(error) = prompt_result {
        host.logger().record(
            "error",
            "pi.send",
            "Pi rejected the submitted chat message",
            Some(json!({
                "behavior": behavior,
                "clientReused": client_reused,
                "durationMilliseconds": send_started.elapsed().as_millis(),
                "error": error,
                "messageId": message_id,
                "sessionId": client.context.session_id,
            })),
        );
        return Err(error);
    }
    let prompt_milliseconds = prompt_started.elapsed().as_millis();
    host.logger().record(
        "info",
        "pi.send.timing",
        "Pi accepted the submitted chat message",
        Some(json!({
            "attachmentCount": attachment_count,
            "behavior": behavior,
            "clientMilliseconds": client_milliseconds,
            "clientReused": client_reused,
            "configurationMilliseconds": configuration_milliseconds,
            "contextMilliseconds": context_milliseconds,
            "hostToPromptAcceptedMilliseconds": send_started.elapsed().as_millis(),
            "messageId": &message_id,
            "modelId": configuration.model_id,
            "promptMilliseconds": prompt_milliseconds,
            "provider": configuration.provider,
            "sessionId": client.context.session_id,
        })),
    );
    let mapping_started = StdInstant::now();
    host.capture_mapping(&client).await?;
    host.logger().record(
        "info",
        "pi.send.timing",
        "Completed host-side chat submission work",
        Some(json!({
            "durationMilliseconds": send_started.elapsed().as_millis(),
            "mappingMilliseconds": mapping_started.elapsed().as_millis(),
            "messageId": &message_id,
            "sessionId": client.context.session_id,
        })),
    );
    Ok(json!({ "ok": true, "messageId": message_id }))
}

#[tauri::command]
pub async fn generate_chat_title(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let started = Instant::now();
    if payload.get("agentProvider").and_then(Value::as_str) != Some("pi") {
        return Err("Only the Pi agent provider is supported.".to_string());
    }
    let context = context_from_payload(&app, &payload)?;
    let source_session_id = context.session_id.clone();
    let model = payload
        .get("model")
        .ok_or_else(|| "Title generation is missing model settings.".to_string())?;
    let configuration = AgentConfiguration {
        provider: required_string(model, "provider")?.to_string(),
        model_id: required_string(model, "modelId")?.to_string(),
        thinking_level: "off".to_string(),
        auto_compaction: false,
        auto_retry: true,
    };
    let language = payload
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("zh");
    let instruction = if language == "en" {
        "Create a concise title for the user's message. Return only the title, no quotes, no punctuation-only prefix, at most 8 words."
    } else {
        "请为用户消息生成一个简洁的会话标题。只返回标题本身，不要引号，不要解释，最多 16 个汉字。"
    };
    let prompt = required_string(&payload, "prompt")?;
    host.logger().record(
        "info",
        "pi.title.lifecycle",
        "Starting concurrent Pi title generation",
        Some(json!({ "sessionId": source_session_id })),
    );
    let client = match host.ephemeral(&context.cwd).await {
        Ok(client) => client,
        Err(error) => {
            host.logger().record(
                "error",
                "pi.title.lifecycle",
                "Failed to start concurrent Pi title generation",
                Some(json!({
                    "durationMilliseconds": started.elapsed().as_millis(),
                    "error": error,
                    "sessionId": source_session_id,
                })),
            );
            return Err(error);
        }
    };
    let ephemeral_session_id = client.context.session_id.clone();
    let result = async {
        client.configure(&configuration).await?;
        client
            .call(json!({
                "type": "prompt",
                "message": format!("{instruction}\n\n用户消息：\n{prompt}"),
            }))
            .await?;
        wait_until_idle(&client, StdDuration::from_secs(180)).await?;
        let response = client
            .call(json!({ "type": "get_last_assistant_text" }))
            .await?;
        let raw = response
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi did not return title text.".to_string())?;
        let title = normalize_title(raw)?;
        Ok(json!({ "ok": true, "title": title }))
    }
    .await;
    let stop_result = client.stop().await;
    let result = match (result, stop_result) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(stop_error)) => Err(format!(
            "{error} Additionally, the title-generation process could not be stopped: {stop_error}"
        )),
    };
    match &result {
        Ok(_) => host.logger().record(
            "info",
            "pi.title.timing",
            "Completed concurrent Pi title generation",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "ephemeralSessionId": ephemeral_session_id,
                "sessionId": source_session_id,
            })),
        ),
        Err(error) => host.logger().record(
            "error",
            "pi.title.lifecycle",
            "Concurrent Pi title generation failed",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "ephemeralSessionId": ephemeral_session_id,
                "error": error,
                "sessionId": source_session_id,
            })),
        ),
    }
    result
}

#[tauri::command]
pub async fn get_chat_history(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let started = Instant::now();
    let session_id = payload
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let reason = payload
        .get("reconciliationReason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let result = async {
        let context = context_from_payload(&app, &payload)?;
        let include_payloads = payload
            .get("includeToolPayloads")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let all_items = history_items_for_context(&host, &context, include_payloads).await?;
        let before = payload.get("beforeItemId").and_then(Value::as_str);
        let end = match before {
            Some(id) => all_items
                .iter()
                .position(|item| item.get("id").and_then(Value::as_str) == Some(id))
                .ok_or_else(|| format!("Unknown history cursor: {id}"))?,
            None => all_items.len(),
        };
        let limit = payload
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(100)
            .clamp(1, 500) as usize;
        let start = end.saturating_sub(limit);
        let items = all_items[start..end].to_vec();
        Ok(json!({
            "items": items,
            "hasMore": start > 0,
            "isPartial": start > 0 || end < all_items.len(),
            "nextCursor": if start > 0 { items.first().and_then(|item| item.get("id")).cloned() } else { None },
            "totalItems": all_items.len(),
        }))
    }
    .await;
    match &result {
        Ok(history) if reason.is_some() => host.logger().record(
            "info",
            "session.history.reconciliation",
            "Loaded authoritative Pi history for renderer reconciliation",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "hasMore": history.get("hasMore"),
                "itemCount": history.get("items").and_then(Value::as_array).map(Vec::len),
                "reason": reason,
                "sessionId": session_id,
                "totalItems": history.get("totalItems"),
            })),
        ),
        Err(error) => host.logger().record(
            "error",
            "session.history",
            "Failed to load Pi session history",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "error": error,
                "reason": reason,
                "sessionId": session_id,
            })),
        ),
        Ok(_) => {}
    }
    result
}

#[tauri::command]
pub async fn get_chat_tool_payload(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let context = context_from_payload(&app, &payload)?;
    let item_id = required_string(&payload, "itemId")?;
    let items = history_items_for_context(&host, &context, true).await?;
    let item = items
        .into_iter()
        .find(|item| {
            item.get("id").and_then(Value::as_str) == Some(item_id)
                && item.get("role").and_then(Value::as_str) == Some("tool")
        })
        .ok_or_else(|| format!("Unknown tool history item: {item_id}"))?;
    Ok(json!({ "ok": true, "item": item }))
}

#[tauri::command]
pub async fn branch_chat(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let source = context_from_payload(&app, &payload)?;
    let target_session_id = required_string(&payload, "targetSessionId")?;
    let target = resolve_chat_context(&app, target_session_id, &source.project_path)?;
    if host.mapping(target_session_id)?.is_some() {
        return Err(format!(
            "Target Pi session already exists: {target_session_id}"
        ));
    }
    let mapping = host
        .resumable_mapping(&source.session_id)
        .await?
        .ok_or_else(|| {
            "The current conversation has no persisted Pi history to branch.".to_string()
        })?;
    let branch = load_active_branch(Path::new(&mapping.session_file))?;
    let message_id = required_string(&payload, "messageId")?;
    let entry_id = base_entry_id(message_id);
    if !branch.iter().any(|entry| entry.id == entry_id) {
        host.logger().record(
            "error",
            "session.branch",
            "Rejected a branch request whose message ID is not in the active Pi branch",
            Some(json!({
                "activeBranchEntryCount": branch.len(),
                "entryId": entry_id,
                "messageId": message_id,
                "sessionFile": mapping.session_file,
                "sessionId": source.session_id,
                "targetSessionId": target_session_id,
            })),
        );
        return Err(format!(
            "Pi session entry was not found for message: {message_id}"
        ));
    }

    let client = host
        .client(source.clone(), &tools_for_mode(Some("standard"), None)?)
        .await?;
    let result = client
        .call(json!({ "type": "fork", "entryId": entry_id }))
        .await?;
    if result.get("cancelled").and_then(Value::as_bool) == Some(true) {
        return Err("Pi extension cancelled the branch operation.".to_string());
    }
    let state = client.call(json!({ "type": "get_state" })).await?;
    let target_file = state
        .get("sessionFile")
        .and_then(Value::as_str)
        .ok_or_else(|| "Pi did not report the branched session file.".to_string())?;
    let items = history_items_from_branch(&load_active_branch(Path::new(target_file))?, true)?;
    host.remap_after_fork(
        &source.session_id,
        &target.session_id,
        &target.cwd,
        target_file,
    )
    .await?;
    Ok(json!({ "ok": true, "items": items }))
}

#[tauri::command]
pub async fn move_chat_session(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let session_id = required_string(&payload, "sessionId")?;
    let source_path = required_string(&payload, "sourceProjectPath")?;
    let source = resolve_chat_context(&app, session_id, source_path)?;
    let target_path = required_string(&payload, "targetProjectPath")?;
    let target = validate_move_target(&app, &payload, target_path)?;
    if source.cwd == target {
        return Ok(json!({ "ok": true, "moved": false }));
    }
    let moved = host.update_project_path(session_id, &target).await?;
    Ok(json!({ "ok": true, "moved": moved }))
}

#[tauri::command]
pub async fn get_chat_context_usage(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let context = context_from_payload(&app, &payload)?;
    if host.mapping(&context.session_id)?.is_none() {
        return Ok(json!({ "ok": true }));
    }
    let client = host
        .client(context, &tools_for_mode(Some("standard"), None)?)
        .await?;
    let stats = client.call(json!({ "type": "get_session_stats" })).await?;
    Ok(json!({ "ok": true, "usage": stats.get("contextUsage").cloned() }))
}

#[tauri::command]
pub async fn export_chat(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let context = context_from_payload(&app, &payload)?;
    let format = required_string(&payload, "format")?;
    let output_path = PathBuf::from(required_string(&payload, "outputPath")?);
    if output_path.as_os_str().is_empty() {
        return Err("Export output path cannot be empty.".to_string());
    }
    match format {
        "markdown" => {
            let markdown = required_string(&payload, "markdown")?;
            fs::write(&output_path, markdown).map_err(|error| {
                format!(
                    "Failed to export Markdown to {}: {error}",
                    output_path.display()
                )
            })?;
        }
        "jsonl" => {
            let mapping = host
                .resumable_mapping(&context.session_id)
                .await?
                .ok_or_else(|| {
                    "The conversation has no persisted Pi JSONL session to export.".to_string()
                })?;
            fs::copy(&mapping.session_file, &output_path).map_err(|error| {
                format!(
                    "Failed to export Pi session {} to {}: {error}",
                    mapping.session_file,
                    output_path.display()
                )
            })?;
        }
        other => return Err(format!("Unsupported export format: {other}")),
    }
    Ok(json!({ "ok": true, "path": output_path }))
}

#[tauri::command]
pub async fn interrupt_chat(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let context = context_from_payload(&app, &payload)?;
    if host.mapping(&context.session_id)?.is_none() {
        return Ok(json!({ "ok": true }));
    }
    let client = host
        .client(context, &tools_for_mode(Some("standard"), None)?)
        .await?;
    client.call(json!({ "type": "abort" })).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn clear_chat_queue(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let context = context_from_payload(&app, &payload)?;
    if host.mapping(&context.session_id)?.is_none() {
        return Ok(json!({ "ok": true }));
    }
    let client = host
        .client(context.clone(), &tools_for_mode(Some("standard"), None)?)
        .await?;
    if client.is_streaming() {
        client.call(json!({ "type": "abort" })).await?;
    }
    // Pi RPC currently exposes queue inspection but not clearQueue. Restarting an idle
    // RPC process clears only its in-memory steering/follow-up queue while retaining
    // the authoritative JSONL conversation.
    host.release(&context.session_id).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn compact_chat(
    app: AppHandle,
    host: State<'_, PiHost>,
    payload: Value,
) -> Result<Value, String> {
    let context = context_from_payload(&app, &payload)?;
    let tools = tools_from_payload(&payload)?;
    let client = host.client(context, &tools).await?;
    client
        .configure(&configuration_from_payload(&payload)?)
        .await?;
    client.call(json!({ "type": "compact" })).await?;
    host.capture_mapping(&client).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn list_models(host: State<'_, PiHost>) -> Result<Value, String> {
    match discover_models(&host).await {
        Ok(models) => Ok(model_registry(&host, &models, None)?),
        Err(error) => {
            host.logger().record(
                "error",
                "models.discovery",
                "Failed to discover models from user-installed Pi",
                Some(json!({ "error": error })),
            );
            Ok(json!({
                "configuredProviders": [],
                "configuredProviderIds": [],
                "providers": [],
                "error": error,
            }))
        }
    }
}

#[tauri::command]
pub async fn check_pi_environment(host: State<'_, PiHost>) -> Result<Value, String> {
    let agent_dir = pi_agent_dir(host.environment())?;
    let auth_path = agent_dir.join("auth.json");
    let models_path = agent_dir.join("models.json");
    let settings_path = agent_dir.join("settings.json");
    let (default_provider, default_model) = pi_default_model(&settings_path)?;
    let configured_stored = stored_provider_ids(&auth_path)?;
    let ownership = host.runtime().ownership_status()?;
    let prerequisites = host.runtime().prerequisites(host.environment()).await;
    let resolved = match host.runtime().resolve_binary(host.environment()) {
        Ok(binary) => binary,
        Err(error) => {
            return Ok(json!({
                "available": false,
                "runtime": "local",
                "agentDir": agent_dir,
                "authJsonExists": auth_path.exists(),
                "canInstall": prerequisites.error.is_none() && ownership["isManagedInstall"] != true,
                "configDirExists": agent_dir.exists(),
                "configuredProviderIds": configured_stored,
                "defaultModel": default_model,
                "defaultProvider": default_provider,
                "hasConfiguredCredential": !configured_stored.is_empty(),
                "installPrerequisiteError": prerequisites.error,
                "isManagedInstall": ownership["isManagedInstall"],
                "isOnPath": false,
                "isPathManaged": ownership["isPathManaged"],
                "managedBinaryPath": ownership["managedBinaryPath"],
                "modelCount": 0,
                "modelsJsonExists": models_path.exists(),
                "nodePath": prerequisites.node_path,
                "nodeVersion": prerequisites.node_version,
                "npmPath": prerequisites.npm_path,
                "npmVersion": prerequisites.npm_version,
                "pathLinkPath": ownership["pathLinkPath"],
                "settingsJsonExists": settings_path.exists(),
                "shellConfigPath": ownership["shellConfigPath"],
                "error": error,
            }));
        }
    };
    let version_output = Command::new(&resolved.path)
        .arg("--version")
        .envs(&host.environment().values)
        .output()
        .map_err(|error| {
            format!(
                "Failed to run {} --version: {error}",
                resolved.path.display()
            )
        })?;
    if !version_output.status.success() {
        return Err(format!(
            "{} --version failed with {}: {}",
            resolved.path.display(),
            version_output.status,
            String::from_utf8_lossy(&version_output.stderr).trim()
        ));
    }
    let version = String::from_utf8(version_output.stdout)
        .map_err(|error| format!("Pi version output was not UTF-8: {error}"))?
        .trim()
        .to_string();
    let model_result = discover_models(&host).await;
    let (models, discovery_error) = match model_result {
        Ok(models) => (models, None),
        Err(error) => (Vec::new(), Some(error)),
    };
    let mut provider_ids = configured_stored.clone();
    for model in &models {
        if let Some(provider) = model.get("provider").and_then(Value::as_str) {
            if !provider_ids.iter().any(|id| id == provider) {
                provider_ids.push(provider.to_string());
            }
        }
    }
    provider_ids.sort();
    Ok(json!({
        "available": true,
        "runtime": "local",
        "agentDir": agent_dir,
        "authJsonExists": auth_path.exists(),
        "binaryPath": resolved.path,
        "binarySource": resolved.source,
        "canInstall": prerequisites.error.is_none() && ownership["isManagedInstall"] != true,
        "configDirExists": agent_dir.exists(),
        "configuredProviderIds": provider_ids,
        "defaultModel": default_model,
        "defaultProvider": default_provider,
        "hasConfiguredCredential": !provider_ids.is_empty(),
        "installPrerequisiteError": prerequisites.error,
        "isManagedInstall": ownership["isManagedInstall"],
        "isOnPath": binary_on_login_path(host.environment(), &resolved.path),
        "isPathManaged": ownership["isPathManaged"],
        "managedBinaryPath": ownership["managedBinaryPath"],
        "modelCount": models.len(),
        "modelsJsonExists": models_path.exists(),
        "nodePath": prerequisites.node_path,
        "nodeVersion": prerequisites.node_version,
        "npmPath": prerequisites.npm_path,
        "npmVersion": prerequisites.npm_version,
        "pathLinkPath": ownership["pathLinkPath"],
        "settingsJsonExists": settings_path.exists(),
        "shellConfigPath": ownership["shellConfigPath"],
        "version": version,
        "error": discovery_error,
    }))
}

#[tauri::command]
pub async fn select_pi_binary(host: State<'_, PiHost>, payload: Value) -> Result<Value, String> {
    host.release_all().await?;
    host.runtime()
        .select_binary(
            host.environment(),
            PathBuf::from(required_string(&payload, "path")?),
        )
        .await?;
    let status = check_pi_environment(host.clone()).await?;
    Ok(json!({ "ok": true, "status": status }))
}

#[tauri::command]
pub async fn install_pi_runtime(host: State<'_, PiHost>) -> Result<Value, String> {
    host.release_all().await?;
    host.runtime().install(host.environment()).await?;
    let status = check_pi_environment(host.clone()).await?;
    Ok(json!({ "ok": true, "status": status }))
}

#[tauri::command]
pub async fn uninstall_pi_runtime(host: State<'_, PiHost>) -> Result<Value, String> {
    host.release_all().await?;
    host.runtime().uninstall().await?;
    let status = check_pi_environment(host.clone()).await?;
    Ok(json!({ "ok": true, "status": status }))
}

#[tauri::command]
pub async fn add_pi_to_shell_path(host: State<'_, PiHost>) -> Result<Value, String> {
    host.runtime().add_to_shell_path(host.environment()).await?;
    let status = check_pi_environment(host.clone()).await?;
    Ok(json!({ "ok": true, "status": status }))
}

#[tauri::command]
pub async fn remove_pi_from_shell_path(host: State<'_, PiHost>) -> Result<Value, String> {
    host.runtime().remove_from_shell_path().await?;
    let status = check_pi_environment(host.clone()).await?;
    Ok(json!({ "ok": true, "status": status }))
}

#[tauri::command]
pub fn save_pi_retry_settings(host: State<'_, PiHost>, payload: Value) -> Result<Value, String> {
    let enabled = payload
        .get("autoRetryOnFailure")
        .and_then(Value::as_bool)
        .ok_or_else(|| "autoRetryOnFailure must be a boolean.".to_string())?;
    let settings_path = pi_agent_dir(host.environment())?.join("settings.json");
    update_json_object_locked(&settings_path, |settings| {
        settings.insert("retry".to_string(), json!({ "enabled": enabled }));
        Ok(())
    })?;
    host.logger().record(
        "info",
        "settings",
        "Updated Pi retry setting",
        Some(json!({ "enabled": enabled })),
    );
    Ok(json!({ "ok": true, "autoRetryOnFailure": enabled }))
}

#[tauri::command]
pub fn open_directory_in_finder(payload: Value) -> Result<Value, String> {
    let path = PathBuf::from(required_string(&payload, "path")?);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Directory {} is unavailable: {error}", path.display()))?;
    if !metadata.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }
    open_path(&path, false)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn show_file_in_finder(payload: Value) -> Result<Value, String> {
    let path = PathBuf::from(required_string(&payload, "path")?);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("File {} is unavailable: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {}", path.display()));
    }
    open_path(&path, true)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn release_pi_sessions(
    host: State<'_, PiHost>,
    session_ids: Vec<String>,
) -> Result<(), String> {
    for session_id in session_ids {
        host.release(&session_id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_pi_sessions(
    host: State<'_, PiHost>,
    session_ids: Vec<String>,
) -> Result<(), String> {
    for session_id in session_ids {
        host.delete(&session_id).await?;
    }
    Ok(())
}

async fn discover_models(host: &PiHost) -> Result<Vec<Value>, String> {
    let cwd = std::env::current_dir()
        .map_err(|error| format!("Failed to resolve current directory: {error}"))?;
    let client = host.ephemeral(&cwd).await?;
    let result = client.call(json!({ "type": "get_available_models" })).await;
    let stop_result = client.stop().await;
    let data = result?;
    stop_result?;
    data.get("models")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| "Pi get_available_models response is malformed.".to_string())
}

fn model_registry(host: &PiHost, models: &[Value], error: Option<String>) -> Result<Value, String> {
    let auth_path = pi_agent_dir(host.environment())?.join("auth.json");
    let stored: HashSet<_> = stored_provider_ids(&auth_path)?.into_iter().collect();
    let mut groups: Vec<(String, Vec<Value>)> = Vec::new();
    for model in models {
        let provider = required_string(model, "provider")?.to_string();
        let model_id = required_string(model, "id")?;
        let name = model
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(model_id);
        let thinking_levels = thinking_levels_for_model(model);
        let input: Vec<&str> = model
            .get("input")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|kind| matches!(*kind, "text" | "image"))
            .collect();
        let available = json!({
            "provider": provider,
            "providerName": provider_display_name(&provider),
            "modelId": model_id,
            "name": name,
            "label": name,
            "input": input,
            "thinkingLevels": thinking_levels,
        });
        if let Some((_, items)) = groups.iter_mut().find(|(id, _)| id == &provider) {
            items.push(available);
        } else {
            groups.push((provider, vec![available]));
        }
    }
    groups.sort_by(|left, right| left.0.cmp(&right.0));
    let providers: Vec<Value> = groups
        .iter()
        .map(
            |(id, models)| json!({ "id": id, "name": provider_display_name(id), "models": models }),
        )
        .collect();
    let configured_provider_ids: Vec<String> = groups.iter().map(|(id, _)| id.clone()).collect();
    let configured_providers: Vec<Value> = configured_provider_ids
        .iter()
        .map(|id| {
            if stored.contains(id) {
                json!({ "id": id, "authSource": "stored" })
            } else {
                json!({ "id": id })
            }
        })
        .collect();
    Ok(json!({
        "configuredProviders": configured_providers,
        "configuredProviderIds": configured_provider_ids,
        "providers": providers,
        "error": error,
    }))
}

fn thinking_levels_for_model(model: &Value) -> Vec<&'static str> {
    if model.get("reasoning").and_then(Value::as_bool) != Some(true) {
        return vec!["off"];
    }
    let mut levels = vec!["off", "minimal", "low", "medium", "high"];
    if model
        .get("thinkingLevelMap")
        .and_then(|map| map.get("xhigh"))
        .is_some_and(|value| !value.is_null())
    {
        levels.push("xhigh");
    }
    if let Some(map) = model.get("thinkingLevelMap").and_then(Value::as_object) {
        levels.retain(|level| map.get(*level).is_none_or(|value| !value.is_null()));
    }
    levels
}

fn provider_display_name(provider: &str) -> String {
    provider
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn context_from_payload(app: &AppHandle, payload: &Value) -> Result<ChatContext, String> {
    resolve_chat_context(
        app,
        required_string(payload, "sessionId")?,
        required_string(payload, "projectPath")?,
    )
}

fn configuration_from_payload(payload: &Value) -> Result<AgentConfiguration, String> {
    let model = payload
        .get("model")
        .ok_or_else(|| "Chat request is missing model settings.".to_string())?;
    let thinking_level = required_string(payload, "thinkingLevel")?;
    if !["off", "minimal", "low", "medium", "high", "xhigh"].contains(&thinking_level) {
        return Err(format!("Unsupported Pi thinking level: {thinking_level}"));
    }
    Ok(AgentConfiguration {
        provider: required_string(model, "provider")?.to_string(),
        model_id: required_string(model, "modelId")?.to_string(),
        thinking_level: thinking_level.to_string(),
        auto_compaction: payload
            .get("autoCompactContext")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        auto_retry: payload
            .get("autoRetryOnFailure")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn tools_from_payload(payload: &Value) -> Result<Vec<String>, String> {
    let custom = payload
        .get("customAgentTools")
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .map(|tool| {
                    tool.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| "Agent tool names must be strings.".to_string())
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    tools_for_mode(
        payload.get("agentMode").and_then(Value::as_str),
        custom.as_deref(),
    )
}

async fn wait_until_idle(
    client: &crate::rpc::RpcClient,
    duration: StdDuration,
) -> Result<(), String> {
    let deadline = Instant::now() + duration;
    loop {
        let state = client.call(json!({ "type": "get_state" })).await?;
        if state.get("isStreaming").and_then(Value::as_bool) == Some(false)
            && state.get("isCompacting").and_then(Value::as_bool) == Some(false)
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Pi did not become idle within {} seconds.",
                duration.as_secs()
            ));
        }
        sleep(StdDuration::from_millis(100)).await;
    }
}

fn normalize_title(value: &str) -> Result<String, String> {
    let title = value
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_matches(['"', '\'', '`', '“', '”', '「', '」'])
        .trim()
        .to_string();
    if title.is_empty() {
        return Err("Pi returned an empty title.".to_string());
    }
    Ok(title.chars().take(80).collect())
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Missing or empty string field: {key}"))
}

#[derive(Clone, Debug)]
struct BranchEntry {
    id: String,
    timestamp: Option<String>,
    message: Option<Value>,
}

fn load_active_branch(path: &Path) -> Result<Vec<BranchEntry>, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read Pi session {}: {error}", path.display()))?;
    let mut raw_entries = Vec::new();
    let mut saw_header = false;
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            return Err(format!(
                "Pi session {} contains an empty JSONL record at line {}.",
                path.display(),
                index + 1
            ));
        }
        let value: Value = serde_json::from_str(line).map_err(|error| {
            format!(
                "Invalid Pi session JSON in {} at line {}: {error}",
                path.display(),
                index + 1
            )
        })?;
        if index == 0 {
            if value.get("type").and_then(Value::as_str) != Some("session") {
                return Err(format!(
                    "Pi session {} has no valid header.",
                    path.display()
                ));
            }
            saw_header = true;
            continue;
        }
        let id = required_string(&value, "id")?.to_string();
        let parent_id = value
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string);
        raw_entries.push((id, parent_id, value));
    }
    if !saw_header {
        return Err(format!("Pi session is empty: {}", path.display()));
    }
    let Some((last_id, _, _)) = raw_entries.last() else {
        return Ok(Vec::new());
    };
    let by_id: HashMap<_, _> = raw_entries
        .iter()
        .enumerate()
        .map(|(index, (id, _, _))| (id.as_str(), index))
        .collect();
    let mut chain = Vec::new();
    let mut current = Some(last_id.as_str());
    let mut visited = HashSet::new();
    while let Some(id) = current {
        if !visited.insert(id.to_string()) {
            return Err(format!("Cycle detected in Pi session tree at entry {id}."));
        }
        let index = by_id
            .get(id)
            .copied()
            .ok_or_else(|| format!("Broken parent link in Pi session: {id}"))?;
        let (entry_id, parent_id, value) = &raw_entries[index];
        chain.push(BranchEntry {
            id: entry_id.clone(),
            timestamp: value
                .get("timestamp")
                .and_then(Value::as_str)
                .map(str::to_string),
            message: if value.get("type").and_then(Value::as_str) == Some("message") {
                value.get("message").cloned()
            } else {
                None
            },
        });
        current = parent_id.as_deref();
    }
    chain.reverse();
    Ok(chain)
}

async fn history_items_for_context(
    host: &PiHost,
    context: &ChatContext,
    include_payloads: bool,
) -> Result<Vec<Value>, String> {
    let Some(mapping) = host.resumable_mapping(&context.session_id).await? else {
        return Ok(Vec::new());
    };
    if PathBuf::from(&mapping.project_path) != context.cwd {
        return Err(format!(
            "Pi session mapping directory mismatch for {}: mapped {}, canonical {}.",
            context.session_id,
            mapping.project_path,
            context.cwd.display()
        ));
    }
    history_items_from_branch(
        &load_active_branch(Path::new(&mapping.session_file))?,
        include_payloads,
    )
}

fn history_items_from_branch(
    branch: &[BranchEntry],
    include_payloads: bool,
) -> Result<Vec<Value>, String> {
    let mut items = Vec::new();
    let mut tool_indexes = HashMap::new();
    for entry in branch {
        let Some(message) = &entry.message else {
            continue;
        };
        append_message_items(
            &mut items,
            &mut tool_indexes,
            message,
            &entry.id,
            entry.timestamp.as_deref(),
            include_payloads,
        )?;
    }
    Ok(items)
}

fn append_message_items(
    items: &mut Vec<Value>,
    tool_indexes: &mut HashMap<String, usize>,
    message: &Value,
    entry_id: &str,
    entry_timestamp: Option<&str>,
    include_payloads: bool,
) -> Result<(), String> {
    let role = required_string(message, "role")?;
    let timestamp = entry_timestamp
        .map(str::to_string)
        .or_else(|| timestamp_from_message(message));
    match role {
        "user" => {
            let attachments = attachment_summaries(message);
            items.push(json!({
                "id": entry_id,
                "isPersisted": true,
                "role": "user",
                "text": content_text(message.get("content").unwrap_or(&Value::Null)),
                "attachments": if attachments.is_empty() { None } else { Some(attachments) },
                "status": "finished",
                "timestamp": timestamp,
            }));
        }
        "assistant" => {
            let content = message
                .get("content")
                .and_then(Value::as_array)
                .ok_or_else(|| "Pi assistant message content must be an array.".to_string())?;
            let orphan_status =
                if message.get("stopReason").and_then(Value::as_str) == Some("aborted") {
                    "finished"
                } else {
                    "running"
                };
            for (index, block) in content.iter().enumerate() {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                        if !text.is_empty() {
                            items.push(json!({
                                "id": format!("{entry_id}-text-{index}"),
                                "isPersisted": true,
                                "role": "assistant",
                                "text": text,
                                "status": "finished",
                                "timestamp": timestamp,
                            }));
                        }
                    }
                    Some("thinking") => {
                        let text = block.get("thinking").and_then(Value::as_str).unwrap_or("");
                        if !text.is_empty() {
                            items.push(json!({
                                "id": format!("{entry_id}-thinking-{index}"),
                                "isPersisted": true,
                                "role": "thinking",
                                "text": text,
                                "status": "finished",
                                "timestamp": timestamp,
                            }));
                        }
                    }
                    Some("toolCall") => {
                        let id = block
                            .get("id")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("{entry_id}-tool-{index}"));
                        let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                        let input =
                            serde_json::to_string(block.get("arguments").unwrap_or(&Value::Null))
                                .map_err(|error| format!("Failed to encode tool input: {error}"))?;
                        let rendered_input = if include_payloads {
                            input.clone()
                        } else {
                            preview_tool_input(&input)?
                        };
                        tool_indexes.insert(id.clone(), items.len());
                        items.push(json!({
                            "id": id,
                            "isPersisted": true,
                            "role": "tool",
                            "name": name,
                            "text": rendered_input,
                            "input": rendered_input,
                            "payloadOmitted": if include_payloads { None } else { Some(true) },
                            "status": orphan_status,
                        }));
                    }
                    Some(_) | None => {}
                }
            }
        }
        "toolResult" => {
            let id = message
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or(entry_id)
                .to_string();
            let index = tool_indexes.get(&id).copied();
            let existing = index.and_then(|index| items.get(index)).cloned();
            let name = message
                .get("toolName")
                .and_then(Value::as_str)
                .or_else(|| {
                    existing
                        .as_ref()
                        .and_then(|item| item.get("name"))
                        .and_then(Value::as_str)
                })
                .unwrap_or("tool");
            let result = content_text(message.get("content").unwrap_or(&Value::Null));
            let is_error = message
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let input = existing
                .as_ref()
                .and_then(|item| item.get("input"))
                .cloned();
            let item = json!({
                "id": id,
                "isPersisted": true,
                "role": "tool",
                "name": name,
                "text": if include_payloads { result.clone() } else { preview_text(&result) },
                "input": input,
                "output": if include_payloads && !is_error { Some(result.clone()) } else { None },
                "errorText": if include_payloads && is_error { Some(result) } else { None },
                "payloadOmitted": if include_payloads { None } else { Some(true) },
                "status": if is_error { "failed" } else { "finished" },
            });
            if let Some(index) = index {
                items[index] = item;
            } else {
                tool_indexes.insert(id, items.len());
                items.push(item);
            }
        }
        "bashExecution" => {
            let command = message.get("command").and_then(Value::as_str).unwrap_or("");
            let output = message.get("output").and_then(Value::as_str).unwrap_or("");
            let text = format!("$ {command}\n{output}").trim().to_string();
            let failed = message.get("exitCode").and_then(Value::as_i64).unwrap_or(0) != 0;
            let input = if command.is_empty() {
                None
            } else if include_payloads {
                Some(command.to_string())
            } else {
                Some(preview_text(command))
            };
            items.push(json!({
                "id": entry_id,
                "isPersisted": true,
                "role": "tool",
                "name": "bash",
                "text": if include_payloads { text.clone() } else { preview_text(&text) },
                "input": input,
                "output": if include_payloads && !failed { Some(output) } else { None },
                "errorText": if include_payloads && failed { Some(output) } else { None },
                "payloadOmitted": if include_payloads { None } else { Some(true) },
                "status": if failed { "failed" } else { "finished" },
            }));
        }
        "custom" => {
            if message.get("display").and_then(Value::as_bool) != Some(false) {
                let text = content_text(message.get("content").unwrap_or(&Value::Null));
                if !text.is_empty() {
                    items.push(json!({
                        "id": entry_id,
                        "isPersisted": true,
                        "role": "system",
                        "text": text,
                        "status": "finished",
                        "timestamp": timestamp,
                    }));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn attachment_summaries(message: &Value) -> Vec<Value> {
    let mut attachments = Vec::new();
    if let Some(items) = message.get("attachments").and_then(Value::as_array) {
        for attachment in items {
            if attachment.get("type").and_then(Value::as_str) == Some("image") {
                attachments.push(json!({
                    "id": attachment.get("id").cloned().unwrap_or_else(|| json!(format!("image-{}", attachments.len()))),
                    "kind": "image",
                    "mediaType": attachment.get("mimeType").cloned().unwrap_or_else(|| json!("image/png")),
                    "name": attachment.get("fileName").cloned().unwrap_or_else(|| json!("image")),
                    "size": attachment.get("size").cloned().unwrap_or_else(|| json!(0)),
                    "dataBase64": attachment.get("content").cloned(),
                }));
            }
        }
    }
    if let Some(blocks) = message.get("content").and_then(Value::as_array) {
        for block in blocks {
            if block.get("type").and_then(Value::as_str) == Some("image") {
                let data = block.get("data").and_then(Value::as_str).unwrap_or("");
                attachments.push(json!({
                    "id": format!("image-{}", attachments.len()),
                    "kind": "image",
                    "mediaType": block.get("mimeType").and_then(Value::as_str).unwrap_or("image/png"),
                    "name": "image",
                    "size": data.len() * 3 / 4,
                    "dataBase64": data,
                }));
            }
        }
    }
    attachments
}

fn timestamp_from_message(message: &Value) -> Option<String> {
    if let Some(text) = message.get("timestamp").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    message
        .get("timestamp")
        .and_then(Value::as_i64)
        .and_then(|millis| Utc.timestamp_millis_opt(millis).single())
        .map(|time| time.to_rfc3339())
}

fn preview_text(text: &str) -> String {
    const LIMIT: usize = 180;
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let preview = chars.by_ref().take(LIMIT).collect::<String>();
    if chars.next().is_some() {
        format!("{}...", preview.trim_end())
    } else {
        preview
    }
}

fn preview_tool_input(text: &str) -> Result<String, String> {
    const SUMMARY_KEYS: [&str; 11] = [
        "path",
        "filePath",
        "file_path",
        "target",
        "cwd",
        "command",
        "cmd",
        "shell",
        "pattern",
        "query",
        "search",
    ];
    let fallback = preview_text(if text.is_empty() { "{}" } else { text });
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Ok(fallback);
    };
    let Some(record) = value.as_object() else {
        return Ok(fallback);
    };
    let mut summary = Map::new();
    for key in SUMMARY_KEYS {
        let Some(field) = record.get(key).and_then(Value::as_str) else {
            continue;
        };
        if field.trim().is_empty() {
            continue;
        }
        summary.insert(key.to_string(), Value::String(preview_text(field)));
    }
    if summary.is_empty() {
        return Ok(fallback);
    }
    serde_json::to_string(&summary)
        .map_err(|error| format!("Failed to encode lightweight tool input: {error}"))
}

fn base_entry_id(message_id: &str) -> &str {
    for marker in ["-text-", "-thinking-"] {
        if let Some((base, suffix)) = message_id.rsplit_once(marker) {
            if suffix.chars().all(|character| character.is_ascii_digit()) {
                return base;
            }
        }
    }
    message_id
}

fn stored_provider_ids(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let value = read_json_object(path)?;
    let mut ids: Vec<_> = value.keys().cloned().collect();
    ids.sort();
    Ok(ids)
}

fn pi_default_model(path: &Path) -> Result<(Option<String>, Option<String>), String> {
    if !path.exists() {
        return Ok((None, None));
    }
    let settings = read_json_object(path)?;
    let read_optional = |key: &str| -> Result<Option<String>, String> {
        match settings.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(value)) if !value.trim().is_empty() => {
                Ok(Some(value.trim().to_string()))
            }
            Some(Value::String(_)) => Ok(None),
            Some(_) => Err(format!("{} field {key} must be a string.", path.display())),
        }
    };
    Ok((
        read_optional("defaultProvider")?,
        read_optional("defaultModel")?,
    ))
}

fn read_json_object(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str::<Value>(&content)
        .map_err(|error| format!("Invalid JSON in {}: {error}", path.display()))?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{} must contain a JSON object.", path.display()))
}

fn update_json_object_locked<F>(path: &Path, update: F) -> Result<(), String>
where
    F: FnOnce(&mut Map<String, Value>) -> Result<(), String>,
{
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}.", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!(
                "Failed to protect configuration directory {}: {error}",
                parent.display()
            )
        })?;
    }
    if !path.exists() {
        fs::write(path, b"{}")
            .map_err(|error| format!("Failed to initialize {}: {error}", path.display()))?;
    }
    let lock_path = PathBuf::from(format!("{}.lock", path.display()));
    acquire_lock_directory(&lock_path)?;
    let operation = (|| {
        let mut object = read_json_object(path)?;
        update(&mut object)?;
        write_json_atomic(path, &object)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Failed to protect {}: {error}", path.display()))?;
        }
        Ok(())
    })();
    let release = fs::remove_dir(&lock_path).map_err(|error| {
        format!(
            "Failed to release configuration lock {}: {error}",
            lock_path.display()
        )
    });
    match (operation, release) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Err(operation_error), Err(release_error)) => {
            Err(format!("{operation_error}; additionally, {release_error}"))
        }
    }
}

fn acquire_lock_directory(path: &Path) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..10 {
        match fs::create_dir(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_error = Some(error);
                std::thread::sleep(StdDuration::from_millis(20 * (attempt + 1)));
            }
            Err(error) => {
                return Err(format!(
                    "Failed to acquire configuration lock {}: {error}",
                    path.display()
                ));
            }
        }
    }
    Err(format!(
        "Configuration file remained locked at {}: {}",
        path.display(),
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown lock error".to_string())
    ))
}

fn validate_move_target(
    app: &AppHandle,
    payload: &Value,
    supplied_target_path: &str,
) -> Result<PathBuf, String> {
    let state = load_app_state_file(app)?
        .ok_or_else(|| "App state has not been initialized yet.".to_string())?;
    let configured =
        if let Some(project_id) = payload.get("targetProjectId").and_then(Value::as_str) {
            state
                .get("projects")
                .and_then(Value::as_array)
                .and_then(|projects| {
                    projects.iter().find(|project| {
                        project.get("id").and_then(Value::as_str) == Some(project_id)
                    })
                })
                .and_then(|project| project.get("path"))
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Unknown target project: {project_id}"))?
        } else {
            state
                .get("settings")
                .and_then(|settings| settings.get("defaultSessionDir"))
                .and_then(Value::as_str)
                .ok_or_else(|| "App settings are missing defaultSessionDir.".to_string())?
        };
    let configured = crate::paths::expand_home(configured)?;
    let supplied = crate::paths::expand_home(supplied_target_path)?;
    let configured = absolute_path(&configured)?;
    let supplied = absolute_path(&supplied)?;
    if configured != supplied {
        return Err(format!(
            "Rejected mismatched move target: expected {}, received {}.",
            configured.display(),
            supplied.display()
        ));
    }
    if payload.get("targetProjectId").is_none() {
        fs::create_dir_all(&configured).map_err(|error| {
            format!(
                "Failed to create default session directory {}: {error}",
                configured.display()
            )
        })?;
    }
    if !configured.is_dir() {
        return Err(format!(
            "Move target is not a directory: {}",
            configured.display()
        ));
    }
    Ok(configured)
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Failed to resolve current directory: {error}"))?
            .join(path)
    };
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    Ok(result)
}

fn open_path(path: &Path, reveal: bool) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        if reveal {
            command.arg("-R");
        }
        command.arg(path);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        if reveal {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(if reveal {
            path.parent().unwrap_or(path)
        } else {
            path
        });
        command
    };
    let status = command
        .status()
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    if !status.success() {
        return Err(format!("System file opener failed with status {status}."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        BranchEntry, base_entry_id, history_items_from_branch, normalize_title, preview_tool_input,
        thinking_levels_for_model,
    };
    use serde_json::{Value, json};

    #[test]
    fn recovers_pi_entry_id_from_rendered_block_id() {
        assert_eq!(base_entry_id("abc-text-2"), "abc");
        assert_eq!(base_entry_id("abc-thinking-0"), "abc");
        assert_eq!(base_entry_id("call-with-dashes"), "call-with-dashes");
    }

    #[test]
    fn marks_every_rendered_session_item_as_persisted() {
        let branch = vec![
            BranchEntry {
                id: "user-entry".to_string(),
                timestamp: Some("2026-07-14T00:00:00Z".to_string()),
                message: Some(json!({
                    "role": "user",
                    "content": [{"type": "text", "text": "hello"}],
                })),
            },
            BranchEntry {
                id: "assistant-entry".to_string(),
                timestamp: Some("2026-07-14T00:00:01Z".to_string()),
                message: Some(json!({
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "thinking": "plan"},
                        {"type": "text", "text": "done"},
                        {"type": "toolCall", "id": "call-1", "name": "read", "arguments": {}},
                    ],
                    "stopReason": "stop",
                })),
            },
        ];

        let items = history_items_from_branch(&branch, false).unwrap();
        assert!(!items.is_empty());
        assert!(
            items
                .iter()
                .all(|item| item.get("isPersisted").and_then(Value::as_bool) == Some(true))
        );
        assert_eq!(
            items[0].get("id").and_then(Value::as_str),
            Some("user-entry")
        );
        assert!(items.iter().any(|item| {
            item.get("id").and_then(Value::as_str) == Some("assistant-entry-text-1")
        }));
    }

    #[test]
    fn lightweight_tool_history_preserves_ousia_input_summary() {
        let branch = vec![
            BranchEntry {
                id: "assistant-entry".to_string(),
                timestamp: Some("2026-07-14T00:00:00Z".to_string()),
                message: Some(json!({
                    "role": "assistant",
                    "content": [{
                        "type": "toolCall",
                        "id": "call-1",
                        "name": "bash",
                        "arguments": {
                            "command": "printf alpha",
                            "description": "must not enter the lightweight summary"
                        }
                    }],
                    "stopReason": "toolUse",
                })),
            },
            BranchEntry {
                id: "tool-entry".to_string(),
                timestamp: Some("2026-07-14T00:00:01Z".to_string()),
                message: Some(json!({
                    "role": "toolResult",
                    "toolCallId": "call-1",
                    "toolName": "bash",
                    "content": [{"type": "text", "text": "alpha"}],
                    "isError": false,
                })),
            },
        ];

        let lightweight = history_items_from_branch(&branch, false).unwrap();
        assert_eq!(lightweight.len(), 1);
        assert_eq!(
            lightweight[0].get("input").and_then(Value::as_str),
            Some(r#"{"command":"printf alpha"}"#)
        );
        assert_eq!(
            lightweight[0].get("text").and_then(Value::as_str),
            Some("alpha")
        );
        assert_eq!(
            lightweight[0]
                .get("payloadOmitted")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert!(lightweight[0].get("output").is_some_and(Value::is_null));

        let full = history_items_from_branch(&branch, true).unwrap();
        let full_input: Value = serde_json::from_str(
            full[0]
                .get("input")
                .and_then(Value::as_str)
                .expect("full tool input"),
        )
        .unwrap();
        assert_eq!(
            full_input.get("description").and_then(Value::as_str),
            Some("must not enter the lightweight summary")
        );
        assert_eq!(full[0].get("output").and_then(Value::as_str), Some("alpha"));
    }

    #[test]
    fn tool_input_preview_matches_ousia_whitespace_and_length_rules() {
        let long_command = format!("printf   {}", "x".repeat(200));
        let encoded = serde_json::to_string(&json!({
            "command": long_command,
            "ignored": "not summarized",
        }))
        .unwrap();
        let preview = preview_tool_input(&encoded).unwrap();
        let parsed: Value = serde_json::from_str(&preview).unwrap();
        let command = parsed.get("command").and_then(Value::as_str).unwrap();

        assert!(command.starts_with("printf "));
        assert!(!command.contains("  "));
        assert!(command.ends_with("..."));
        assert!(parsed.get("ignored").is_none());
    }

    #[test]
    fn title_normalization_is_bounded_and_rejects_empty_output() {
        assert_eq!(normalize_title("  “A title”\nmore").unwrap(), "A title");
        assert!(normalize_title(" \n ").is_err());
    }

    #[test]
    fn model_thinking_map_removes_unsupported_levels() {
        assert_eq!(
            thinking_levels_for_model(&json!({
                "reasoning": true,
                "thinkingLevelMap": { "minimal": null, "xhigh": "xhigh" }
            })),
            vec!["off", "low", "medium", "high", "xhigh"]
        );
    }
}
