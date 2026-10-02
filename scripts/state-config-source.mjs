// Shared by scripts/build.mjs and scripts/dev.mjs: validates a state backend
// name and renders the generated state-config.mjs for an explicit A/B choice.
export const STATE_BACKENDS = Object.freeze(['baseline', 'state-lib']);

/** Returns the backend or throws a message that names the accepted values. */
export function assertStateBackend(value) {
  if (!STATE_BACKENDS.includes(value)) {
    throw new Error(`Invalid state backend ${JSON.stringify(value)}; expected one of: ${STATE_BACKENDS.join(', ')}.`);
  }
  return value;
}

/** Explicitly chosen backends are frozen into the build: the URL cannot flip them. */
export function renderStateConfig(backend) {
  assertStateBackend(backend);
  return `// Generated for an explicit state backend build. Do not edit.\n`
    + `export const STATE_CONFIG = Object.freeze({backend:'${backend}', allowUrlOverride:false});\n`;
}
