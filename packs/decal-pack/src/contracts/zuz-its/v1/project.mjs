const PRODUCT_KINDS = new Set(["task", "work", "bug", "incident"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function positiveTaskId(value) {
  const source = String(value ?? "");
  const digits = source.startsWith("TASK-") ? source.slice(5) : source;
  if (!/^[0-9]+$/u.test(digits) || !/[1-9]/u.test(digits)) fail("zuz_its_task_id_invalid");
  return digits.replace(/^0+/u, "");
}

function prefixedId(value, prefix) {
  const source = String(value ?? "");
  const match = source.match(new RegExp(`^${prefix}-([0-9]{3,})$`, "u"));
  if (!match || !/[1-9]/u.test(match[1])) fail(`zuz_its_${prefix.toLowerCase()}_id_invalid`);
  return `${prefix}-${match[1]}`;
}

export function projectZuzItsIdentity(productKind, id) {
  if (!PRODUCT_KINDS.has(productKind)) fail("zuz_its_product_kind_unknown");
  if (productKind === "task") {
    const canonicalId = positiveTaskId(id);
    return {
      schema: "zuz.its.ticket-identity/v1",
      ticketKind: "task",
      issueKind: null,
      legacyProductKind: "task",
      canonicalId,
      displayKey: `TASK-${canonicalId.padStart(3, "0")}`,
    };
  }
  if (productKind === "work") {
    const canonicalId = prefixedId(id, "WORK");
    return {
      schema: "zuz.its.ticket-identity/v1",
      ticketKind: "work",
      issueKind: null,
      legacyProductKind: "work",
      canonicalId,
      displayKey: canonicalId,
    };
  }
  const prefix = productKind === "bug" ? "BUG" : "INC";
  const canonicalId = prefixedId(id, prefix);
  return {
    schema: "zuz.its.ticket-identity/v1",
    ticketKind: "issue",
    issueKind: productKind,
    legacyProductKind: productKind,
    canonicalId,
    displayKey: canonicalId,
  };
}

export function projectZuzItsRecord(record) {
  if (!record || typeof record !== "object") fail("zuz_its_record_invalid");
  const identity = projectZuzItsIdentity(record.productKind, record.id);
  return {
    ...identity,
    title: record.title,
    status: record.status,
    priority: record.priority,
    taskRefs: [...(record.taskRefs ?? [])],
    settlement: record.settlement ?? null,
  };
}

export function projectZuzItsInventory(records) {
  if (!Array.isArray(records)) fail("zuz_its_inventory_invalid");
  return {
    schema: "zuz.its.inventory/v1",
    records: records.map(projectZuzItsRecord),
  };
}
