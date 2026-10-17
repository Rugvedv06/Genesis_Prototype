export function resolveMutationTool(mutation, tools = []) {
  const route = mutation?.route;
  if (!route || typeof route.path !== 'string') return null;
  const method = String(route.method ?? 'POST').toUpperCase();
  const tool = tools.find((item) => String(item.method ?? 'POST').toUpperCase() === method && item.path === route.path);
  if (!tool) return null;
  const fixtureArgs = mutation?.fixture?.args;
  return {
    name: tool.name,
    args: fixtureArgs && typeof fixtureArgs === 'object' && !Array.isArray(fixtureArgs) ? fixtureArgs : {},
  };
}
