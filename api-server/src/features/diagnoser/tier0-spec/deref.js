const MAX_DEPTH = 24;
const MAX_NODES = 10_000;

export function dereferenceLocalRefs(spec, root = spec) {
  let nodes = 0;
  const visit = (value, stack, depth) => {
    if (++nodes > MAX_NODES) throw new Error('spec_node_limit');
    if (depth > MAX_DEPTH) throw new Error('spec_depth_limit');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => visit(item, stack, depth + 1));
    if (typeof value.$ref === 'string') {
      if (!value.$ref.startsWith('#/')) throw new Error('remote_ref_not_allowed');
      if (stack.has(value.$ref)) throw new Error('cyclic_ref');
      const target = value.$ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
        .reduce((current, part) => current?.[part], root);
      if (!target) throw new Error('unresolved_ref');
      const nextStack = new Set(stack);
      nextStack.add(value.$ref);
      const resolved = visit(target, nextStack, depth + 1);
      const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref'));
      return Object.keys(siblings).length ? { ...resolved, ...visit(siblings, stack, depth + 1) } : resolved;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, stack, depth + 1)]));
  };
  return visit(spec, new Set(), 0);
}
