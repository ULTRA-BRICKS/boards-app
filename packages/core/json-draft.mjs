/** Experimental JSON COW engine. Reactive graph and history stay in the owning Runtime. */
const owned = new WeakSet(),
  tree = new WeakMap();
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
    for (const key of Object.keys(value)) {
      if (Array.isArray(value) && !index(key)) isTree = false;
      visit(value[key]);
    }
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
          if (value === node.base || value === node.proxy) {
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
      };
      const target = Array.isArray(value) ? [] : {};
      node.proxy = new Proxy(target, {
        get(_target, key) {
          const value = Reflect.get(latest(node), key, node.proxy);
          if (!object(value)) return value;
          if (!owned.has(value) && !proxies.has(value)) return value;
          return state(value, node, key).proxy;
        },
        set(_target, key, value) {
          if (key === '__proto__' && !Object.hasOwn(latest(node), key))
            throw new TypeError('JSON drafts do not support prototype mutation');
          const previous = latest(node)[key];
          if (Object.hasOwn(latest(node), key) && Object.is(previous, value)) return true;
          if (object(previous) || object(value) || (Array.isArray(node.base) && key !== 'length' && !index(key)))
            structural = true;
          mark(node);
          node.changed.add(key);
          const child = proxies.get(value);
          if (child) attach(child, node, key);
          return Reflect.set(node.copy, key, value);
        },
        deleteProperty(_target, key) {
          if (!Object.hasOwn(latest(node), key)) return true;
          if (object(latest(node)[key])) structural = true;
          mark(node);
          node.changed.delete(key);
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
      const node = proxies.get(value) ?? nodes.get(value);
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
