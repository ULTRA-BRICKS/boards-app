/** Experimental JSON COW engine. Reactive graph and history stay in the owning Runtime. */
const owned = new WeakSet(),
  tree = new WeakMap(),
  denseArrays = new WeakSet();
const standardArrayIterator = Array.prototype.values;
const arrayIteratorPrototype = Object.getPrototypeOf(standardArrayIterator.call([]));
const standardArrayNext = arrayIteratorPrototype.next;
const intrinsicArrayFrom = Array.from,
  intrinsicArraySlice = Array.prototype.slice;
const message = 'Document snapshots must be acyclic JSON data';
const object = (value) => value !== null && typeof value === 'object';
const scalar = (value) =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));
const index = (key) => typeof key === 'string' && String(key >>> 0) === key && key !== '4294967295';
const mutableCopy = (value) => (Array.isArray(value) ? value.slice() : { ...value });
function certify(root) {
  const active = new WeakSet(),
    seen = new WeakSet();
  let isTree = true;
  function visit(value) {
    if (!object(value)) {
      if (!scalar(value)) throw new TypeError(message);
      return;
    }
    if (active.has(value)) throw new TypeError(message);
    if (seen.has(value)) {
      isTree = false;
      return;
    }
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new TypeError(message);
    seen.add(value);
    active.add(value);
    const keys = Object.keys(value);
    const dense = Array.isArray(value) && keys.length === value.length && keys.every(index);
    for (const key of keys) {
      if (Array.isArray(value) && !index(key)) isTree = false;
      visit(value[key]);
    }
    if (dense) denseArrays.add(value);
    active.delete(value);
    Object.freeze(value);
    owned.add(value);
  }
  visit(root);
  if (object(root)) tree.set(root, isTree);
  return root;
}
/** Import once at the external document boundary; never trust frozen-ness alone. */
export function ownJson(value) {
  let copy;
  try {
    copy = structuredClone(value);
  } catch (cause) {
    throw new TypeError(message, { cause });
  }
  return certify(copy);
}
/** Full-copy oracle and conservative fallback for shared-reference input graphs. */
export function beginCopiedJson(base) {
  const draft = structuredClone(base);
  return { draft, strategy: 'copy', finish: () => ownJson(draft), abort() {} };
}
/** Supported fast commands: JSON assignments/deletions and ordinary array helpers.
 * Descriptor/prototype mutation is explicitly outside this experimental grammar.
 * Draft references remain detached and writable after commit, matching the app oracle.
 */
export function beginJsonDraft(base) {
  if (!object(base) || !owned.has(base) || tree.get(base) !== true) return beginCopiedJson(base);
  const nodes = new WeakMap(),
    proxies = new WeakMap();
  let closed = false,
    structural = false,
    copiedContainers = 0;
  const latest = (node) => node.copy ?? node.base;
  function copy(node) {
    if (!node.copy || (closed && !node.detached)) {
      node.copy = mutableCopy(latest(node));
      node.detached = closed;
      copiedContainers++;
    }
    return node.copy;
  }
  function mark(node) {
    if (node.marking || (node.copy && (!closed || node.detached))) return;
    node.marking = true;
    copy(node);
    try {
      for (const [parent, keys] of node.parents)
        for (const key of keys) {
          const value = latest(parent)[key];
          if (!parent.raw.has(key) && (value === node.base || value === node.proxy)) {
            mark(parent);
            Reflect.set(parent.copy, key, node.proxy);
            parent.changed.add(key);
          }
        }
    } finally {
      node.marking = false;
    }
  }
  function attach(node, parent, key) {
    let keys = node.parents.get(parent);
    if (!keys) {
      keys = new Set();
      node.parents.set(parent, keys);
    }
    keys.add(key);
  }
  function state(value, parent, key) {
    let node = proxies.get(value) ?? nodes.get(value);
    if (!node) {
      node = {
        base: value,
        copy: null,
        parents: new Map(),
        detached: false,
        marking: false,
        proxy: null,
        changed: new Set(),
        raw: new Set(),
      };
      const target = Array.isArray(value) ? [] : {};
      node.proxy = new Proxy(target, {
        get(_target, key) {
          const value = Reflect.get(latest(node), key, node.proxy);
          if (!object(value) || node.raw.has(key)) return value;
          if (!owned.has(value) && !proxies.has(value)) return value;
          return state(value, node, key).proxy;
        },
        set(_target, key, value) {
          if (key === '__proto__' && !Object.hasOwn(latest(node), key))
            throw new TypeError('JSON drafts do not support prototype mutation');
          // An explicit historical value is not a handle to the active draft.
          const child = proxies.get(value);
          if (object(value) && !child) node.raw.add(key);
          else node.raw.delete(key);
          const previous = latest(node)[key];
          if (Object.hasOwn(latest(node), key) && Object.is(previous, value)) return true;
          if (object(previous) || object(value) || (Array.isArray(node.base) && key !== 'length' && !index(key)))
            structural = true;
          mark(node);
          node.changed.add(key);
          if (child) attach(child, node, key);
          return Reflect.set(node.copy, key, value);
        },
        deleteProperty(_target, key) {
          if (!Object.hasOwn(latest(node), key)) return true;
          if (object(latest(node)[key])) structural = true;
          mark(node);
          node.changed.delete(key);
          node.raw.delete(key);
          return Reflect.deleteProperty(node.copy, key);
        },
        has(_target, key) {
          return Reflect.has(latest(node), key);
        },
        ownKeys() {
          return Reflect.ownKeys(latest(node));
        },
        getOwnPropertyDescriptor(_target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(latest(node), key);
          if (!descriptor) return undefined;
          if (key === 'length' && Array.isArray(value)) return { ...descriptor, writable: true };
          return { ...descriptor, configurable: true, writable: true };
        },
        getPrototypeOf() {
          return Reflect.getPrototypeOf(latest(node));
        },
        defineProperty() {
          throw new TypeError('JSON drafts support assignment and deletion, not property descriptors');
        },
        setPrototypeOf() {
          throw new TypeError('JSON drafts do not support prototype mutation');
        },
        preventExtensions() {
          throw new TypeError('JSON drafts cannot be sealed or frozen inside a command');
        },
      });
      nodes.set(value, node);
      proxies.set(node.proxy, node);
    }
    if (parent) attach(node, parent, key);
    return node;
  }
  const root = state(base);
  function finish() {
    if (closed) throw new Error('JSON draft is already finished');
    const visiting = new WeakSet(),
      finished = new WeakMap(),
      imported = new WeakMap();
    function resolve(value) {
      if (!object(value)) {
        if (!scalar(value)) throw new TypeError(message);
        return value;
      }
      const node = proxies.get(value);
      if (node) {
        if (finished.has(node)) return finished.get(node);
        if (visiting.has(node)) throw new TypeError(message);
        if (!node.copy) return node.base;
        visiting.add(node);
        const result = node.copy;
        for (const key of node.changed) {
          if (typeof key === 'symbol') {
            Reflect.deleteProperty(result, key);
            continue;
          }
          if (!Object.hasOwn(result, key)) continue;
          Reflect.set(result, key, resolve(result[key]));
        }
        for (const key of Object.getOwnPropertySymbols(result)) Reflect.deleteProperty(result, key);
        visiting.delete(node);
        Object.freeze(result);
        owned.add(result);
        finished.set(node, result);
        return result;
      }
      if (owned.has(value)) return value;
      if (visiting.has(value)) throw new TypeError(message);
      if (imported.has(value)) return imported.get(value);
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new TypeError(message);
      visiting.add(value);
      const result = Array.isArray(value) ? new Array(value.length) : {};
      for (const key of Object.keys(value))
        Object.defineProperty(result, key, {
          value: resolve(value[key]),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      visiting.delete(value);
      Object.freeze(result);
      owned.add(result);
      imported.set(value, result);
      return result;
    }
    try {
      copy(root);
      const result = resolve(root.proxy);
      if (structural) certify(result);
      else tree.set(result, true);
      return result;
    } finally {
      closed = true;
    }
  }
  return {
    draft: root.proxy,
    strategy: 'cow',
    finish,
    abort() {
      closed = true;
    },
    get copiedContainers() {
      return copiedContainers;
    },
  };
}

/** Copy only certified dense arrays through the engine's native iterable fast path.
 * Sparse or untrusted arrays retain indexed slice semantics. The result is private,
 * not an owned snapshot until an audited command finishes constructing it.
 */
export function copyJsonArrayForCommand(value) {
  if (!Array.isArray(value)) throw new TypeError('Command copy requires an array');
  const dense =
    owned.has(value) &&
    denseArrays.has(value) &&
    value[Symbol.iterator] === standardArrayIterator &&
    arrayIteratorPrototype.next === standardArrayNext;
  const result = dense ? intrinsicArrayFrom.call(Array, value) : intrinsicArraySlice.call(value);
  if (dense) denseArrays.add(result);
  return result;
}
const commandCopy = (value) => (Array.isArray(value) ? copyJsonArrayForCommand(value) : { ...value });

/** Read-only ownership check for the existing Runtime publication boundary. */
export function isOwnedJsonSnapshot(value) {
  return object(value) && owned.has(value);
}
function commandPath(path) {
  if (!Array.isArray(path)) throw new TypeError('Command path must be an array');
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (typeof key !== 'string' && !(Number.isSafeInteger(key) && key >= 0))
      throw new TypeError('Command path must contain strings or nonnegative integer indices');
  }
  return path;
}

function commandChild(node, key) {
  if (!object(node) || !Object.hasOwn(node, key)) throw new TypeError('Command path must name existing own data');
  if (
    Array.isArray(node) &&
    !(typeof key === 'number' ? Number.isInteger(key) && key >= 0 && key < 4294967295 : index(key))
  )
    throw new TypeError('Command paths do not mutate array metadata');
  return node[key];
}
/** Only private trusted operators receive this construction context. */
function jsonConstruction(base) {
  const fast = object(base) && owned.has(base) && tree.get(base) === true;
  let root = fast ? base : structuredClone(base),
    closed = false,
    copied = 0;
  const privateNodes = new WeakSet(),
    created = [];
  const abort = () => {
    closed = true;
    root = null;
    created.length = 0;
  };
  const run = (fn) => {
    if (closed) throw new Error('JSON command is already finished or aborted');
    try {
      return fn();
    } catch (error) {
      abort();
      throw error;
    }
  };
  const clone = (node) => {
    if (!object(node)) throw new TypeError('Command path must address a container');
    if (!fast || privateNodes.has(node)) return node;
    const next = commandCopy(node);
    privateNodes.add(next);
    created.push(next);
    copied++;
    return next;
  };
  const read = (path) => {
    let node = root;
    for (const key of path) node = commandChild(node, key);
    return node;
  };
  const writable = (path) => {
    root = clone(root);
    let node = root;
    for (const key of path) {
      const next = clone(commandChild(node, key));
      node[key] = next;
      node = next;
    }
    return node;
  };
  const finish = () =>
    run(() => {
      let result;
      if (!fast) result = ownJson(root);
      else {
        root = clone(root);
        for (let i = created.length - 1; i >= 0; i--) {
          Object.freeze(created[i]);
          owned.add(created[i]);
        }
        tree.set(root, true);
        result = root;
      }
      abort();
      return result;
    });
  return {
    strategy: fast ? 'builder' : 'copy',
    run,
    read,
    clone,
    writable,
    finish,
    abort,
    get copiedContainers() {
      return copied;
    },
  };
}
function scalarCommand(context, path, value) {
  commandPath(path);
  if (!path.length || !scalar(value)) throw new TypeError('Command set requires a scalar value and nonempty path');
  const old = context.read(path);
  if (!scalar(old)) throw new TypeError('Command set replaces an existing scalar field');
  if (!Object.is(old, value)) context.writable(path.slice(0, -1))[path.at(-1)] = value;
}
function toggleCommand(context, path) {
  commandPath(path);
  const old = context.read(path);
  if (typeof old !== 'boolean') throw new TypeError('Toggle requires boolean data');
  scalarCommand(context, path, !old);
}
function batchArguments(field, value, stride) {
  if (typeof field !== 'string' || !scalar(value) || !Number.isSafeInteger(stride) || stride < 1)
    throw new TypeError('Batch command requires a field, scalar value and positive stride');
}
function rowsCommand(context, path, field, value, stride = 1) {
  commandPath(path);
  batchArguments(field, value, stride);
  const rows = context.read(path);
  if (!Array.isArray(rows)) throw new TypeError('Batch path must address an array');
  let target;
  for (let i = 0; i < rows.length; i += stride) {
    const row = commandChild(rows, i),
      old = commandChild(row, field);
    if (!scalar(old)) throw new TypeError('Batch command replaces scalar fields');
    if (Object.is(old, value)) continue;
    target ??= context.writable(path);
    const next = context.clone(target[i]);
    next[field] = value;
    target[i] = next;
  }
}
function groupsCommand(context, path, itemsField, field, value, stride = 1) {
  commandPath(path);
  batchArguments(field, value, stride);
  if (typeof itemsField !== 'string') throw new TypeError('Grouped batch requires an item field');
  const groups = context.read(path);
  if (!Array.isArray(groups)) throw new TypeError('Grouped batch path must address an array');
  for (let i = 0; i < groups.length; i++) rowsCommand(context, [...path, i, itemsField], field, value, stride);
}
function moveCommand(context, fromPath, fromIndex, toPath, toIndex) {
  commandPath(fromPath);
  commandPath(toPath);
  const prefix = (a, b) => a.length < b.length && a.every((key, i) => String(key) === String(b[i]));
  if (prefix(fromPath, toPath) || prefix(toPath, fromPath)) throw new TypeError('Move paths must not overlap');
  const from = context.read(fromPath),
    to = context.read(toPath);
  if (!Array.isArray(from) || !Array.isArray(to)) throw new TypeError('Move paths must address arrays');
  const same = from === to;
  if (
    !Number.isSafeInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex >= from.length ||
    !Object.hasOwn(from, fromIndex) ||
    !Number.isSafeInteger(toIndex) ||
    toIndex < 0 ||
    toIndex > to.length - Number(same)
  )
    throw new RangeError('Move indices must be inside the source and post-removal destination');
  if (same && fromIndex === toIndex) return;
  const source = context.writable(fromPath),
    target = same ? source : context.writable(toPath);
  const [item] = source.splice(fromIndex, 1);
  target.splice(toIndex, 0, item);
}
/** No mutable context escapes through the public command API. */
export function beginJsonCommand(base) {
  const context = jsonConstruction(base);
  return {
    strategy: context.strategy,
    set: (path, value) => context.run(() => scalarCommand(context, path, value)),
    toggle: (path) => context.run(() => toggleCommand(context, path)),
    assignEach: (path, field, value, stride = 1) => context.run(() => rowsCommand(context, path, field, value, stride)),
    assignGroups: (path, items, field, value, stride = 1) =>
      context.run(() => groupsCommand(context, path, items, field, value, stride)),
    move: (from, fromIndex, to, toIndex) => context.run(() => moveCommand(context, from, fromIndex, to, toIndex)),
    finish: context.finish,
    abort: context.abort,
    get copiedContainers() {
      return context.copiedContainers;
    },
  };
}
// Internal helpers for the already-tested immutable command operations.
function treeOwned(base) {
  return object(base) && owned.has(base) && tree.get(base) === true;
}
function frozenOwned(value) {
  Object.freeze(value);
  owned.add(value);
  return value;
}
function traceCommand(root, path, validated = false) {
  if (!validated) commandPath(path);
  const parents = new Array(path.length + 1);
  parents[0] = root;
  for (let i = 0; i < path.length; i++) parents[i + 1] = commandChild(parents[i], path[i]);
  return parents;
}
function liftCommand(parents, path, value, stop = 0) {
  for (let i = path.length - 1; i >= stop; i--) {
    const parent = commandCopy(parents[i]);
    parent[path[i]] = value;
    value = frozenOwned(parent);
  }
  return value;
}
function finishDirect(root, fast) {
  if (!fast) return certify(root);
  tree.set(root, true);
  return root;
}
function unchangedRoot(root, fast) {
  return fast ? frozenOwned(commandCopy(root)) : root;
}
function directScalar(base, path, value, toggle = false) {
  if ((!toggle && !scalar(value)) || !Array.isArray(path) || !path.length)
    throw new TypeError('Command set requires a scalar and nonempty path');
  const fast = treeOwned(base),
    root = fast ? base : structuredClone(base),
    parents = traceCommand(root, path);
  const old = parents[parents.length - 1];
  if (!scalar(old)) throw new TypeError('Command set replaces an existing scalar field');
  if (toggle) {
    if (typeof old !== 'boolean') throw new TypeError('Toggle requires boolean data');
    value = !old;
  }
  let next;
  if (Object.is(old, value)) next = unchangedRoot(root, fast);
  else if (fast) next = liftCommand(parents, path, value);
  else {
    parents[parents.length - 2][path.at(-1)] = value;
    next = root;
  }
  return finishDirect(next, fast);
}
function directRows(rows, field, value, stride, fast) {
  if (!Array.isArray(rows)) throw new TypeError('Batch path must address an array');
  let output = rows;
  for (let i = 0; i < rows.length; i += stride) {
    const row = commandChild(rows, i),
      old = commandChild(row, field);
    if (!scalar(old)) throw new TypeError('Batch command replaces scalar fields');
    if (Object.is(old, value)) continue;
    if (fast) {
      if (output === rows) output = copyJsonArrayForCommand(rows);
      const next = commandCopy(row);
      next[field] = value;
      output[i] = frozenOwned(next);
    } else row[field] = value;
  }
  return fast && output !== rows ? frozenOwned(output) : output;
}
export function setJsonEach(base, path, field, value, stride = 1) {
  batchArguments(field, value, stride);
  const fast = treeOwned(base),
    root = fast ? base : structuredClone(base),
    parents = traceCommand(root, path);
  const before = parents[parents.length - 1],
    after = directRows(before, field, value, stride, fast);
  const next = fast && before !== after ? liftCommand(parents, path, after) : unchangedRoot(root, fast);
  return finishDirect(next, fast);
}
export function setJsonGroups(base, path, items, field, value, stride = 1) {
  batchArguments(field, value, stride);
  if (typeof items !== 'string') throw new TypeError('Grouped batch requires an item field');
  const fast = treeOwned(base),
    root = fast ? base : structuredClone(base),
    parents = traceCommand(root, path);
  const groups = parents[parents.length - 1];
  if (!Array.isArray(groups)) throw new TypeError('Grouped batch path must address an array');
  let output = groups;
  for (let i = 0; i < groups.length; i++) {
    const group = commandChild(groups, i),
      before = commandChild(group, items);
    const after = directRows(before, field, value, stride, fast);
    if (fast && before !== after) {
      if (output === groups) output = copyJsonArrayForCommand(groups);
      const next = commandCopy(group);
      next[items] = after;
      output[i] = frozenOwned(next);
    }
  }
  const next = fast && output !== groups ? liftCommand(parents, path, frozenOwned(output)) : unchangedRoot(root, fast);
  return finishDirect(next, fast);
}
export function moveJsonItem(base, fromPath, fromIndex, toPath, toIndex) {
  commandPath(fromPath);
  commandPath(toPath);
  let common = 0;
  while (
    common < fromPath.length &&
    common < toPath.length &&
    (fromPath[common] === toPath[common] || String(fromPath[common]) === String(toPath[common]))
  )
    common++;
  if (fromPath.length !== toPath.length && common === Math.min(fromPath.length, toPath.length))
    throw new TypeError('Move paths must not overlap');
  const fast = treeOwned(base),
    root = fast ? base : structuredClone(base);
  const fromTrace = traceCommand(root, fromPath, true);
  const toTrace = fromTrace.slice(0, common + 1);
  for (let i = common; i < toPath.length; i++) toTrace.push(commandChild(toTrace[toTrace.length - 1], toPath[i]));
  const from = fromTrace[fromTrace.length - 1],
    to = toTrace[toTrace.length - 1];
  if (!Array.isArray(from) || !Array.isArray(to)) throw new TypeError('Move paths must address arrays');
  const same = from === to;
  if (
    !Number.isSafeInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex >= from.length ||
    !Object.hasOwn(from, fromIndex) ||
    !Number.isSafeInteger(toIndex) ||
    toIndex < 0 ||
    toIndex > to.length - Number(same)
  )
    throw new RangeError('Move indices must be inside the source and post-removal destination');
  if (same && fromIndex === toIndex) return finishDirect(unchangedRoot(root, fast), fast);
  let source, target;
  if (fast && !same && from.length === 1 && to.length === 0) {
    source = [];
    target = [from[0]];
    denseArrays.add(source);
    denseArrays.add(target);
  } else {
    source = fast ? copyJsonArrayForCommand(from) : from;
    target = same ? source : fast ? copyJsonArrayForCommand(to) : to;
    const [item] = source.splice(fromIndex, 1);
    target.splice(toIndex, 0, item);
  }
  if (!fast) return finishDirect(root, false);
  frozenOwned(source);
  if (same) return finishDirect(liftCommand(fromTrace, fromPath, source), true);
  frozenOwned(target);
  const left = liftCommand(fromTrace, fromPath, source, common + 1);
  const right = liftCommand(toTrace, toPath, target, common + 1);
  const ancestor = commandCopy(fromTrace[common]);
  ancestor[fromPath[common]] = left;
  ancestor[toPath[common]] = right;
  return finishDirect(liftCommand(fromTrace, fromPath.slice(0, common), frozenOwned(ancestor)), true);
}
export function copyJsonRoot(base) {
  if (treeOwned(base)) return finishDirect(frozenOwned(commandCopy(base)), true);
  return ownJson(base);
}

export const setJsonScalar = (base, path, value) => directScalar(base, path, value);
export const toggleJsonScalar = (base, path) => directScalar(base, path, undefined, true);

/** Reusable synchronous multi-operation recipe; native single-operation code imports narrower helpers. */
export function defineJsonCommand(execute) {
  if (typeof execute !== 'function') throw new TypeError('A command recipe must be callable');
  return function applyCommand(base, args) {
    const tx = beginJsonCommand(base);
    try {
      const result = execute(tx, args);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError('JSON command recipes must be synchronous');
      }
      return tx.finish();
    } catch (error) {
      tx.abort();
      throw error;
    }
  };
}
