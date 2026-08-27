import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  // SameSite=None requires Secure, and browsers silently drop cookies that
  // set Secure without an actual HTTPS connection. So: secure connections
  // (HTTPS, or behind a proxy that sets x-forwarded-proto: https) get
  // SameSite=None+Secure (works cross-site); plain HTTP connections
  // (local dev on http://localhost) get Lax+non-secure so the session
  // cookie still persists.
  // Previously SameSite=None+Secure on HTTPS, "for cross-site support" —
  // but CareDesk is single-origin (no embedding, no separate frontend
  // domain calling this API), so that was more permissive than the app
  // needs for a session cookie carrying access to patient data. Lax is the
  // right default here; it still works for normal top-level navigation
  // (login redirects, etc.) and doesn't get sent on cross-site requests.
  if (isSecureRequest(req)) {
    return {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    };
  }

  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  };
}
