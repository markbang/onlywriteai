export function isDevelopmentApiPath(pathname: string) {
  return (
    pathname === "/models" ||
    pathname.startsWith("/agent/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/documents") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/sources")
  );
}
