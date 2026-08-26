const productionPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' blob: data:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const developmentPolicy = productionPolicy
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");

export function securityHeaders({ development = false } = {}) {
  return {
    "Cache-Control": development ? "no-store" : "no-cache",
    "Content-Security-Policy": development
      ? developmentPolicy
      : productionPolicy,
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy": [
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "microphone=()",
      "payment=()",
      "serial=()",
      "usb=()",
    ].join(", "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}
