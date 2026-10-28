import type { MessageKey } from "~/i18n";

export const PREVIEW_RECENT_URL_LIMIT = 10;

export const PREVIEW_ERROR_CODE_MESSAGES: Readonly<Record<string, MessageKey>> = Object.freeze({
  ERR_NAME_NOT_RESOLVED: "workspace.preview.error.dnsNotFound",
  ERR_NAME_RESOLUTION_FAILED: "workspace.preview.error.dnsNotFound",
  ERR_CONNECTION_REFUSED: "workspace.preview.error.connectionRefused",
  ERR_CONNECTION_RESET: "workspace.preview.error.connectionReset",
  ERR_CONNECTION_CLOSED: "workspace.preview.error.connectionClosed",
  ERR_CONNECTION_TIMED_OUT: "workspace.preview.error.timedOut",
  ERR_INTERNET_DISCONNECTED: "workspace.preview.error.noInternet",
  ERR_TIMED_OUT: "workspace.preview.error.timedOut",
  ERR_CERT_AUTHORITY_INVALID: "workspace.preview.error.certAuthority",
  ERR_CERT_COMMON_NAME_INVALID: "workspace.preview.error.certHostname",
  ERR_CERT_DATE_INVALID: "workspace.preview.error.certDate",
  ERR_TOO_MANY_REDIRECTS: "workspace.preview.error.tooManyRedirects",
});
