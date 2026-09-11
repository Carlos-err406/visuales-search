import ignore from "ignore";
import { expand } from "brace-expansion";

// Keep the CLI's comma/brace shorthand without losing gitignore escapes or rule order.
export function splitIgnoreRules(patterns: string[]): string[] {
  return patterns.flatMap((pattern) =>
    pattern.split(/\r?\n/).flatMap((line) => {
      if (!line.trim()) return [];
      if (line.startsWith("#")) return [line];
      const parts: string[] = [];
      let current = "";
      let braces = 0;
      let brackets = 0;
      let escaped = false;
      for (const char of line) {
        if (escaped) {
          current += char;
          escaped = false;
          continue;
        }
        if (char === "\\") escaped = true;
        if (char === "[") brackets++;
        if (char === "]") brackets = Math.max(0, brackets - 1);
        if (!brackets) {
          if (char === "{") braces++;
          if (char === "}") braces = Math.max(0, braces - 1);
        }
        if (char === "," && !braces && !brackets) {
          parts.push(current);
          current = "";
        } else current += char;
      }
      parts.push(current);
      return parts.filter((part) => part.trim());
    })
  );
}

export function createIgnoreMatcher(patterns: string[]): (relativePath: string) => boolean {
  const rules = ignore({ ignorecase: true });
  for (const pattern of splitIgnoreRules(patterns)) {
    if (pattern.startsWith("#")) continue;
    const expanded = expand(pattern, { max: 1001, maxLength: pattern.length * 1001 });
    if (expanded.length > 1000) throw new Error("An ignore rule must expand to at most 1000 patterns.");
    rules.add(expanded);
  }
  return (relativePath) => rules.ignores(relativePath.replace(/\\/g, "/"));
}
