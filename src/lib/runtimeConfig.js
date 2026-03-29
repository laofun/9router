import os from "os";
import path from "path";

function isTruthy(value) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isLanMode() {
  return isTruthy(process.env.LAN_MODE || "");
}

export function isInternetOutputDisabled() {
  if (isTruthy(process.env.DISABLE_INTERNET_OUTPUT || "")) {
    return true;
  }
  return isLanMode();
}

export function isTunnelFeatureAvailable() {
  if (isTruthy(process.env.TUNNEL_FEATURE_ENABLED || "")) {
    return true;
  }
  if (process.env.TUNNEL_FEATURE_ENABLED === "false") {
    return false;
  }
  return !isInternetOutputDisabled();
}

export function getTunnelDisabledReason() {
  if (isTruthy(process.env.TUNNEL_FEATURE_ENABLED || "")) {
    return "";
  }
  if (process.env.TUNNEL_FEATURE_ENABLED === "false") {
    return "Tunnel feature is disabled by configuration.";
  }
  if (isInternetOutputDisabled()) {
    return "Tunnel is disabled in LAN mode to avoid public internet exposure.";
  }
  return "";
}

export function isVersionCheckEnabled() {
  if (isTruthy(process.env.VERSION_CHECK_ENABLED || "")) {
    return true;
  }
  if (process.env.VERSION_CHECK_ENABLED === "false") {
    return false;
  }
  return !isInternetOutputDisabled();
}

export function getAppDataDir() {
  if (process.env.DATA_DIR?.trim()) {
    return process.env.DATA_DIR.trim();
  }
  return path.join(os.homedir(), ".9router");
}
