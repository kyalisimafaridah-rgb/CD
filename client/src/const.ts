export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const LOGIN_PATH = "/login";
export const REGISTER_PATH = "/register";

// Kept for backward compatibility with existing call sites - returns the
// internal login route instead of redirecting to an external OAuth portal.
export const getLoginUrl = () => LOGIN_PATH;
