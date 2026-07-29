use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AssistantFailure {
    pub error_message: String,
    pub model_id: Option<String>,
    pub provider: Option<String>,
}

impl AssistantFailure {
    pub fn display_text(&self) -> String {
        format!("Pi request failed: {}", self.error_message)
    }
}

pub(crate) fn assistant_failure(message: &Value) -> Result<Option<AssistantFailure>, String> {
    if message.get("stopReason").and_then(Value::as_str) != Some("error") {
        return Ok(None);
    }

    let error_message = message
        .get("errorMessage")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .ok_or_else(|| {
            "Pi assistant message stopped with an error but did not include errorMessage."
                .to_string()
        })?;

    Ok(Some(AssistantFailure {
        error_message: error_message.to_string(),
        model_id: message
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
        provider: message
            .get("provider")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

#[cfg(test)]
mod tests {
    use super::assistant_failure;
    use serde_json::json;

    #[test]
    fn extracts_assistant_failure_without_message_content() {
        let failure = assistant_failure(&json!({
            "role": "assistant",
            "content": [],
            "provider": "kimi-coding",
            "model": "kimi-for-coding-highspeed",
            "stopReason": "error",
            "errorMessage": "401 subscription required",
        }))
        .unwrap()
        .unwrap();

        assert_eq!(failure.error_message, "401 subscription required");
        assert_eq!(failure.provider.as_deref(), Some("kimi-coding"));
        assert_eq!(
            failure.model_id.as_deref(),
            Some("kimi-for-coding-highspeed")
        );
        assert_eq!(
            failure.display_text(),
            "Pi request failed: 401 subscription required"
        );
    }

    #[test]
    fn rejects_error_stop_without_an_error_message() {
        assert!(
            assistant_failure(&json!({
                "role": "assistant",
                "content": [],
                "stopReason": "error",
            }))
            .unwrap_err()
            .contains("errorMessage")
        );
    }
}
