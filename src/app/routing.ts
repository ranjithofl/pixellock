const normalizedBase = import.meta.env.BASE_URL.replace(/\/$/, "") || "";

export function getAppPath(pathname = window.location.pathname) {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;

  if (!normalizedBase) return normalizedPathname || "/";
  if (normalizedPathname === normalizedBase) return "/";
  if (normalizedPathname.startsWith(`${normalizedBase}/`)) {
    return normalizedPathname.slice(normalizedBase.length) || "/";
  }

  return normalizedPathname || "/";
}

export function appHref(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}` || "/";
}