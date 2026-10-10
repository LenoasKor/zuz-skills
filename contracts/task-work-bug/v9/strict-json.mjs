// JSON.parse accepts duplicate keys and rounds large integer literals. Neither is
// safe for a version-file rewrite which must preserve unrelated project values.
export function parseStrictJson(source) {
  const tokens = source.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]|\s+|./gu) ?? [];
  let cursor = 0;
  const fail = () => {
    const error = new Error("ambiguous_json_source"); error.code = "ambiguous_json_source"; throw error;
  };
  const next = () => {
    while (tokens[cursor] && /^\s+$/u.test(tokens[cursor])) cursor += 1;
    return tokens[cursor++];
  };
  const value = (token, depth = 0) => {
    if (depth > 100) fail();
    if (token === "{") {
      const keys = new Set();
      let key = next();
      if (key === "}") return;
      for (;;) {
        if (!key?.startsWith('"')) fail();
        const decoded = JSON.parse(key);
        if (keys.has(decoded)) fail();
        keys.add(decoded);
        if (next() !== ":") fail();
        value(next(), depth + 1);
        const separator = next();
        if (separator === "}") return;
        if (separator !== ",") fail();
        key = next();
      }
    }
    if (token === "[") {
      let item = next();
      if (item === "]") return;
      for (;;) {
        value(item, depth + 1);
        const separator = next();
        if (separator === "]") return;
        if (separator !== ",") fail();
        item = next();
      }
    }
    if (!token) fail();
    const parsed = JSON.parse(token);
    if (parsed && typeof parsed === "object") fail();
    if (typeof parsed === "number" && (!Number.isFinite(parsed)
        || (Number.isInteger(parsed) && !Number.isSafeInteger(parsed))
        || String(parsed) !== token)) fail();
  };
  value(next());
  if (next() !== undefined) fail();
  return JSON.parse(source);
}
