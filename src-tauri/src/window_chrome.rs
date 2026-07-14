use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, State, WebviewWindow, WindowEvent};

use crate::logging::RuntimeLogger;

const ELECTRON_ZOOM_FACTOR_BASE: f64 = 1.2;
const ELECTRON_ZOOM_LEVEL_STEP: f64 = 0.5;
const ALIGNMENT_TOLERANCE: f64 = 0.5;
const GEOMETRY_SCALE_RELATIVE_TOLERANCE: f64 = 0.005;
// Match Ousia's macOS traffic-light left inset. Vertical alignment remains
// renderer-measured because it must track the live sidebar-toggle center.
const MAC_TRAFFIC_LIGHT_LEFT_INSET: f64 = 14.0;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum WindowZoomAction {
    #[serde(rename = "in")]
    In,
    #[serde(rename = "out")]
    Out,
    #[serde(rename = "reset")]
    Reset,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowZoomEvent {
    zoom_percent: i64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTrafficLightGeometry {
    actual_left_from_window_left: f64,
    actual_center_from_window_top: f64,
    button_height: f64,
    renderer_center_y: f64,
    renderer_to_native_scale: f64,
    target_left_from_window_left: f64,
    target_center_from_window_top: f64,
    viewport_height: f64,
    webview_top_from_window_top: f64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeferredTrafficLightGeometry {
    actual_renderer_to_native_scale: f64,
    expected_renderer_to_native_scale: f64,
    renderer_center_y: f64,
    viewport_height: f64,
    webview_height: f64,
    webview_top_from_window_top: f64,
}

#[cfg(target_os = "macos")]
enum NativeTrafficLightSync {
    Aligned(NativeTrafficLightGeometry),
    Deferred(DeferredTrafficLightGeometry),
}

pub struct WindowChrome {
    zoom_level: Mutex<f64>,
    zoom_operation: tokio::sync::Mutex<()>,
    alignment_operation: tokio::sync::Mutex<()>,
    last_logged_alignment: Mutex<Option<(f64, f64, f64)>>,
    deferred_alignment_count: Mutex<u32>,
    last_fullscreen: Mutex<Option<bool>>,
    logger: RuntimeLogger,
}

impl WindowChrome {
    pub fn new(logger: RuntimeLogger) -> Self {
        Self {
            zoom_level: Mutex::new(0.0),
            zoom_operation: tokio::sync::Mutex::new(()),
            alignment_operation: tokio::sync::Mutex::new(()),
            last_logged_alignment: Mutex::new(None),
            deferred_alignment_count: Mutex::new(0),
            last_fullscreen: Mutex::new(None),
            logger,
        }
    }

    pub fn initialize(&self) {
        self.logger.record(
            "info",
            "window.chrome",
            "Window chrome initialized; waiting for renderer geometry",
            None,
        );
    }

    pub fn handle_window_event(&self, window: &WebviewWindow, event: &WindowEvent) {
        if !matches!(event, WindowEvent::Resized(_)) {
            return;
        }

        let is_fullscreen = match window.is_fullscreen() {
            Ok(value) => value,
            Err(error) => {
                self.logger.record(
                    "error",
                    "window.chrome",
                    "Failed to read fullscreen state after resize",
                    Some(serde_json::json!({ "error": error.to_string() })),
                );
                return;
            }
        };
        let should_emit = match self.last_fullscreen.lock() {
            Ok(mut last_fullscreen) => {
                let changed = *last_fullscreen != Some(is_fullscreen);
                *last_fullscreen = Some(is_fullscreen);
                changed
            }
            Err(_) => {
                self.logger.record(
                    "error",
                    "window.chrome",
                    "Window fullscreen state mutex was poisoned",
                    None,
                );
                return;
            }
        };
        if !should_emit {
            return;
        }
        if let Err(error) = window.emit(
            "ousia:window:fullscreen",
            serde_json::json!({ "isFullscreen": is_fullscreen }),
        ) {
            self.logger.record(
                "error",
                "window.chrome",
                "Failed to emit fullscreen state",
                Some(serde_json::json!({ "error": error.to_string() })),
            );
        }
    }

    fn zoom_event(&self) -> Result<WindowZoomEvent, String> {
        Ok(zoom_event_for_factor(self.zoom_factor()?))
    }

    fn zoom_factor(&self) -> Result<f64, String> {
        let zoom_level = *self
            .zoom_level
            .lock()
            .map_err(|_| "Window zoom state mutex was poisoned".to_string())?;
        Ok(zoom_factor_for_level(zoom_level))
    }

    async fn set_zoom(
        &self,
        window: &WebviewWindow,
        action: WindowZoomAction,
    ) -> Result<WindowZoomEvent, String> {
        let _operation = self.zoom_operation.lock().await;
        let current_zoom_level = *self
            .zoom_level
            .lock()
            .map_err(|_| "Window zoom state mutex was poisoned".to_string())?;
        let next_zoom_level = match action {
            WindowZoomAction::In => current_zoom_level + ELECTRON_ZOOM_LEVEL_STEP,
            WindowZoomAction::Out => current_zoom_level - ELECTRON_ZOOM_LEVEL_STEP,
            WindowZoomAction::Reset => 0.0,
        };
        let zoom_factor = zoom_factor_for_level(next_zoom_level);

        apply_webview_zoom(window, zoom_factor).await?;
        *self
            .zoom_level
            .lock()
            .map_err(|_| "Window zoom state mutex was poisoned".to_string())? = next_zoom_level;

        let event = zoom_event_for_factor(zoom_factor);
        window
            .emit("ousia:window:zoom", event)
            .map_err(|error| format!("Failed to emit window zoom state: {error}"))?;
        self.logger.record(
            "info",
            "window.zoom",
            "Window zoom changed; renderer geometry sync requested",
            Some(serde_json::json!({
                "action": action,
                "zoomFactor": zoom_factor,
                "zoomPercent": event.zoom_percent,
            })),
        );
        Ok(event)
    }

    async fn sync_traffic_lights(
        &self,
        window: &WebviewWindow,
        renderer_center_y: f64,
        viewport_height: f64,
    ) -> Result<serde_json::Value, String> {
        validate_renderer_geometry(renderer_center_y, viewport_height)?;
        let _operation = self.alignment_operation.lock().await;
        let expected_renderer_to_native_scale = self.zoom_factor()?;
        let outcome = align_traffic_lights(
            window,
            renderer_center_y,
            viewport_height,
            expected_renderer_to_native_scale,
        )
        .await?;

        #[cfg(target_os = "macos")]
        {
            let geometry = match outcome {
                NativeTrafficLightSync::Deferred(geometry) => {
                    let mut deferred_count =
                        self.deferred_alignment_count.lock().map_err(|_| {
                            "Window deferred-alignment counter mutex was poisoned".to_string()
                        })?;
                    *deferred_count += 1;
                    if *deferred_count == 1 {
                        self.logger.record(
                            "info",
                            "window.chrome",
                            "Deferred macOS traffic-light alignment until renderer and native geometry agree",
                            Some(serde_json::json!(geometry)),
                        );
                    }
                    return Ok(serde_json::json!({
                        "status": "deferred",
                        "actualRendererToNativeScale": geometry.actual_renderer_to_native_scale,
                        "expectedRendererToNativeScale": geometry.expected_renderer_to_native_scale,
                    }));
                }
                NativeTrafficLightSync::Aligned(geometry) => geometry,
            };
            let deferred_count = {
                let mut count = self.deferred_alignment_count.lock().map_err(|_| {
                    "Window deferred-alignment counter mutex was poisoned".to_string()
                })?;
                std::mem::take(&mut *count)
            };
            let signature = (
                geometry.target_center_from_window_top,
                geometry.renderer_to_native_scale,
                geometry.webview_top_from_window_top,
            );
            let mut last = self
                .last_logged_alignment
                .lock()
                .map_err(|_| "Window alignment log mutex was poisoned".to_string())?;
            let materially_changed = last.is_none_or(|previous| {
                (previous.0 - signature.0).abs() > ALIGNMENT_TOLERANCE
                    || (previous.1 - signature.1).abs() > 0.001
                    || (previous.2 - signature.2).abs() > ALIGNMENT_TOLERANCE
            });
            if materially_changed || deferred_count > 0 {
                self.logger.record(
                    "info",
                    "window.chrome",
                    "Aligned macOS traffic lights to renderer sidebar toggle",
                    Some(serde_json::json!({
                        "deferredAttemptCount": deferred_count,
                        "geometry": geometry,
                    })),
                );
                *last = Some(signature);
            }
            return Ok(serde_json::json!({
                "status": "aligned",
            }));
        }

        #[cfg(not(target_os = "macos"))]
        Ok(outcome)
    }
}

#[tauri::command]
pub fn get_window_zoom_state(state: State<'_, WindowChrome>) -> Result<WindowZoomEvent, String> {
    state.zoom_event()
}

#[tauri::command]
pub async fn set_window_zoom(
    window: WebviewWindow,
    state: State<'_, WindowChrome>,
    action: WindowZoomAction,
) -> Result<WindowZoomEvent, String> {
    state.set_zoom(&window, action).await
}

#[tauri::command]
pub async fn sync_window_traffic_lights(
    window: WebviewWindow,
    state: State<'_, WindowChrome>,
    renderer_center_y: f64,
    viewport_height: f64,
) -> Result<serde_json::Value, String> {
    state
        .sync_traffic_lights(&window, renderer_center_y, viewport_height)
        .await
}

fn validate_renderer_geometry(renderer_center_y: f64, viewport_height: f64) -> Result<(), String> {
    if !renderer_center_y.is_finite() || !viewport_height.is_finite() {
        return Err("Renderer window geometry must contain finite numbers".to_string());
    }
    if viewport_height <= 0.0 {
        return Err("Renderer viewport height must be positive".to_string());
    }
    if renderer_center_y < 0.0 || renderer_center_y > viewport_height {
        return Err(format!(
            "Renderer toggle center {renderer_center_y} is outside viewport height {viewport_height}"
        ));
    }
    Ok(())
}

fn resolve_native_target_center(
    renderer_center_y: f64,
    viewport_height: f64,
    webview_top_from_window_top: f64,
    webview_height: f64,
) -> (f64, f64) {
    let renderer_to_native_scale = webview_height / viewport_height;
    (
        webview_top_from_window_top + renderer_center_y * renderer_to_native_scale,
        renderer_to_native_scale,
    )
}

fn renderer_geometry_scale_is_stable(
    actual_renderer_to_native_scale: f64,
    expected_renderer_to_native_scale: f64,
) -> bool {
    if !actual_renderer_to_native_scale.is_finite()
        || !expected_renderer_to_native_scale.is_finite()
        || expected_renderer_to_native_scale <= 0.0
    {
        return false;
    }
    let tolerance = expected_renderer_to_native_scale.abs() * GEOMETRY_SCALE_RELATIVE_TOLERANCE;
    (actual_renderer_to_native_scale - expected_renderer_to_native_scale).abs() <= tolerance
}

fn zoom_factor_for_level(zoom_level: f64) -> f64 {
    ELECTRON_ZOOM_FACTOR_BASE.powf(zoom_level)
}

fn zoom_event_for_factor(zoom_factor: f64) -> WindowZoomEvent {
    WindowZoomEvent {
        zoom_percent: (zoom_factor * 100.0).round() as i64,
    }
}

#[cfg(target_os = "macos")]
async fn apply_webview_zoom(window: &WebviewWindow, zoom_factor: f64) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let result = unsafe { set_native_webview_zoom(webview.inner(), zoom_factor) };
            let _ = sender.send(result);
        })
        .map_err(|error| format!("Failed to schedule native window zoom: {error}"))?;
    receiver
        .await
        .map_err(|_| "Native window zoom callback was dropped".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn apply_webview_zoom(window: &WebviewWindow, zoom_factor: f64) -> Result<(), String> {
    window
        .set_zoom(zoom_factor)
        .map_err(|error| format!("Failed to set WebView zoom to {zoom_factor}: {error}"))
}

#[cfg(target_os = "macos")]
async fn align_traffic_lights(
    window: &WebviewWindow,
    renderer_center_y: f64,
    viewport_height: f64,
    expected_renderer_to_native_scale: f64,
) -> Result<NativeTrafficLightSync, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let result = unsafe {
                align_native_traffic_lights(
                    webview.inner(),
                    webview.ns_window(),
                    renderer_center_y,
                    viewport_height,
                    expected_renderer_to_native_scale,
                )
            };
            let _ = sender.send(result);
        })
        .map_err(|error| format!("Failed to schedule native traffic-light alignment: {error}"))?;
    receiver
        .await
        .map_err(|_| "Native traffic-light alignment callback was dropped".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn align_traffic_lights(
    _window: &WebviewWindow,
    renderer_center_y: f64,
    viewport_height: f64,
    expected_renderer_to_native_scale: f64,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "platform": std::env::consts::OS,
        "rendererCenterY": renderer_center_y,
        "status": "aligned",
        "viewportHeight": viewport_height,
        "expectedRendererToNativeScale": expected_renderer_to_native_scale,
    }))
}

#[cfg(target_os = "macos")]
unsafe fn set_native_webview_zoom(
    webview: *mut std::ffi::c_void,
    zoom_factor: f64,
) -> Result<(), String> {
    use objc2_web_kit::WKWebView;

    if webview.is_null() {
        return Err("Tauri returned a null WKWebView pointer".to_string());
    }
    let webview: &WKWebView = unsafe { &*webview.cast() };
    unsafe { webview.setPageZoom(zoom_factor) };
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn align_native_traffic_lights(
    webview: *mut std::ffi::c_void,
    ns_window: *mut std::ffi::c_void,
    renderer_center_y: f64,
    viewport_height: f64,
    expected_renderer_to_native_scale: f64,
) -> Result<NativeTrafficLightSync, String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
    use objc2_web_kit::WKWebView;

    if webview.is_null() || ns_window.is_null() {
        return Err("Tauri returned a null WKWebView or NSWindow pointer".to_string());
    }
    let webview: &WKWebView = unsafe { &*webview.cast() };
    let window: &NSWindow = unsafe { &*ns_window.cast() };
    let close = window
        .standardWindowButton(NSWindowButton::CloseButton)
        .ok_or_else(|| "macOS close button is unavailable".to_string())?;
    let minimize = window
        .standardWindowButton(NSWindowButton::MiniaturizeButton)
        .ok_or_else(|| "macOS minimize button is unavailable".to_string())?;
    let zoom = window
        .standardWindowButton(NSWindowButton::ZoomButton)
        .ok_or_else(|| "macOS zoom button is unavailable".to_string())?;
    let button_container = unsafe { close.superview() }
        .ok_or_else(|| "macOS close button has no container view".to_string())?;
    let title_bar_container = unsafe { button_container.superview() }
        .ok_or_else(|| "macOS traffic-light container has no title-bar view".to_string())?;

    let window_height = window.frame().size.height;
    let webview_in_window = webview.convertRect_toView(NSView::bounds(webview), None);
    let webview_top_from_window_top =
        window_height - webview_in_window.origin.y - webview_in_window.size.height;
    let (target_center_from_window_top, renderer_to_native_scale) = resolve_native_target_center(
        renderer_center_y,
        viewport_height,
        webview_top_from_window_top,
        webview_in_window.size.height,
    );
    if !renderer_geometry_scale_is_stable(
        renderer_to_native_scale,
        expected_renderer_to_native_scale,
    ) {
        return Ok(NativeTrafficLightSync::Deferred(
            DeferredTrafficLightGeometry {
                actual_renderer_to_native_scale: renderer_to_native_scale,
                expected_renderer_to_native_scale,
                renderer_center_y,
                viewport_height,
                webview_height: webview_in_window.size.height,
                webview_top_from_window_top,
            },
        ));
    }

    let close_in_window = close.convertRect_toView(NSView::bounds(&close), None);
    let current_center_from_window_top =
        window_height - close_in_window.origin.y - close_in_window.size.height / 2.0;
    let center_delta = target_center_from_window_top - current_center_from_window_top;
    if center_delta.abs() > ALIGNMENT_TOLERANCE {
        let mut title_bar_frame = NSView::frame(&title_bar_container);
        let next_height = title_bar_frame.size.height + center_delta;
        if next_height <= close_in_window.size.height {
            return Err(format!(
                "Measured renderer center would collapse native title bar to {next_height}"
            ));
        }
        title_bar_frame.size.height = next_height;
        title_bar_frame.origin.y -= center_delta;
        title_bar_container.setFrame(title_bar_frame);
    }

    let close_frame = NSView::frame(&close);
    let button_spacing = NSView::frame(&minimize).origin.x - close_frame.origin.x;
    if button_spacing <= close_frame.size.width {
        return Err(format!(
            "macOS traffic-light spacing {button_spacing} is not wider than the close button {}",
            close_frame.size.width
        ));
    }
    for (index, button) in [close.clone(), minimize, zoom].into_iter().enumerate() {
        let mut frame = NSView::frame(&button);
        frame.origin.x = MAC_TRAFFIC_LIGHT_LEFT_INSET + index as f64 * button_spacing;
        button.setFrameOrigin(frame.origin);
    }

    let aligned_close = close.convertRect_toView(NSView::bounds(&close), None);
    let actual_left_from_window_left = aligned_close.origin.x;
    let actual_center_from_window_top =
        window_height - aligned_close.origin.y - aligned_close.size.height / 2.0;
    let remaining_error = (actual_center_from_window_top - target_center_from_window_top).abs();
    if remaining_error > ALIGNMENT_TOLERANCE {
        return Err(format!(
            "Native traffic-light alignment missed renderer center by {remaining_error:.3} points"
        ));
    }
    let remaining_horizontal_error =
        (actual_left_from_window_left - MAC_TRAFFIC_LIGHT_LEFT_INSET).abs();
    if remaining_horizontal_error > ALIGNMENT_TOLERANCE {
        return Err(format!(
            "Native traffic-light horizontal alignment missed Ousia inset by {remaining_horizontal_error:.3} points"
        ));
    }

    Ok(NativeTrafficLightSync::Aligned(
        NativeTrafficLightGeometry {
            actual_left_from_window_left,
            actual_center_from_window_top,
            button_height: aligned_close.size.height,
            renderer_center_y,
            renderer_to_native_scale,
            target_left_from_window_left: MAC_TRAFFIC_LIGHT_LEFT_INSET,
            target_center_from_window_top,
            viewport_height,
            webview_top_from_window_top,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_renderer_center_through_actual_webview_geometry() {
        assert_eq!(
            resolve_native_target_center(20.0, 900.0, 8.0, 900.0),
            (28.0, 1.0)
        );
    }

    #[test]
    fn mapping_tracks_zoom_without_a_fixed_titlebar_coordinate() {
        let (target, scale) = resolve_native_target_center(20.0, 750.0, 8.0, 900.0);
        assert!((target - 32.0).abs() < f64::EPSILON);
        assert!((scale - 1.2).abs() < f64::EPSILON);
    }

    #[test]
    fn defers_geometry_that_does_not_match_the_active_zoom() {
        assert!(renderer_geometry_scale_is_stable(0.997, 1.0));
        assert!(renderer_geometry_scale_is_stable(
            1.096,
            zoom_factor_for_level(0.5)
        ));
        assert!(!renderer_geometry_scale_is_stable(0.74, 1.0));
        assert!(!renderer_geometry_scale_is_stable(1.23, 1.0));
        assert!(!renderer_geometry_scale_is_stable(f64::NAN, 1.0));
    }

    #[test]
    fn rejects_renderer_centers_outside_the_viewport() {
        assert!(validate_renderer_geometry(901.0, 900.0).is_err());
        assert!(validate_renderer_geometry(f64::NAN, 900.0).is_err());
    }

    #[test]
    fn matches_ousia_zoom_step_percentages() {
        assert_eq!(
            zoom_event_for_factor(zoom_factor_for_level(0.5)).zoom_percent,
            110
        );
        assert_eq!(
            zoom_event_for_factor(zoom_factor_for_level(-0.5)).zoom_percent,
            91
        );
        assert_eq!(
            zoom_event_for_factor(zoom_factor_for_level(0.0)).zoom_percent,
            100
        );
    }
}
