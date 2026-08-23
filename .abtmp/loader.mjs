export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  return nextResolve(specifier, context);
}
