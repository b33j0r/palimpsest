export function parentPath(path) {
  const cleanPath = path === "." ? "" : path.replace(/\/+$/, "");
  if (!cleanPath || cleanPath === ".") {
    return null;
  }
  const parts = cleanPath.split("/");
  parts.pop();
  return parts.length ? parts.join("/") : ".";
}

export function fileKindLabel(entry) {
  if (entry.kind === "directory") {
    return "DIR";
  }
  return (entry.suffix || "FILE").replace(".", "").toUpperCase();
}
