export const OUSIA_TITLE_BAR_HEIGHT = 40
export const MAC_TRAFFIC_LIGHT_BUTTON_SIZE = 12
export const MAC_TRAFFIC_LIGHT_X = 14
// hiddenInset's native traffic-light anchor is slightly below the DOM centerline.
const MAC_TRAFFIC_LIGHT_NATIVE_Y_ALIGNMENT = -1

export function resolveMacTrafficLightPosition(zoomFactor = 1) {
  const scaledTitleBarCenterY = (OUSIA_TITLE_BAR_HEIGHT * zoomFactor) / 2
  return {
    x: MAC_TRAFFIC_LIGHT_X,
    y: Math.round(
      scaledTitleBarCenterY -
        MAC_TRAFFIC_LIGHT_BUTTON_SIZE / 2 +
        MAC_TRAFFIC_LIGHT_NATIVE_Y_ALIGNMENT
    ),
  } as const
}

export const MAIN_WINDOW_MIN_WIDTH = 340
export const MAIN_WINDOW_MIN_HEIGHT = 400
