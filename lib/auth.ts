const AUTH_KEY = "dfir_authenticated";
const AUTH_EMAIL_KEY = "dfir_auth_email";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(AUTH_KEY) === "true";
}

export function setAuthenticated(value: boolean, email?: string): void {
  if (typeof window === "undefined") return;
  if (value) {
    sessionStorage.setItem(AUTH_KEY, "true");
    if (email !== undefined) sessionStorage.setItem(AUTH_EMAIL_KEY, email);
  } else {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_EMAIL_KEY);
  }
}

export function getAuthEmail(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(AUTH_EMAIL_KEY);
}
