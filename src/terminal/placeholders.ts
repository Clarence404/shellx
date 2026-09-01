/** `${name}` placeholders inside a snippet command: a snippet like
 *  `systemctl restart ${服务名}` asks for its blanks before going to
 *  the terminal. */

/** Unique placeholder names, in order of first appearance. */
export function extractPlaceholders(command: string): string[] {
  const names: string[] = [];
  for (const m of command.matchAll(/\$\{([^}]+)\}/g)) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Every `${name}` replaced with its value; unknown names are left
 *  as-is so a typo is visible rather than silently blank. */
export function fillPlaceholders(command: string, values: Record<string, string>): string {
  return command.replace(/\$\{([^}]+)\}/g, (whole, raw: string) => {
    const name = raw.trim();
    return name in values ? values[name] : whole;
  });
}
