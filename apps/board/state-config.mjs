// Build-time state backend selection for the board app (HYP-1490).
// backend: 'baseline' | 'state-lib'. When allowUrlOverride is true the URL
// parameter ?stateBackend= may still pick baseline, state-lib or state-lib-cow.
// scripts/build.mjs and scripts/dev.mjs replace this file for explicit A/B builds.
export const STATE_CONFIG = Object.freeze({backend:'state-lib', allowUrlOverride:true});
