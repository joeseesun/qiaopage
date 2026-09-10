"use strict";
// Vercel env pull redacts protected variables. Redaction is not a new value.
function mergePulledEnvironment(pulled, previous) {
  const result = {...pulled};
  for (const [key,value] of Object.entries(result)) {
    if (value === "[SENSITIVE]" && previous[key] && previous[key] !== "[SENSITIVE]")
      result[key] = previous[key];
  }
  // The Vercel adapter requires this backend; its name is not a credential.
  if (result.OBJECT_STORE === "[SENSITIVE]") result.OBJECT_STORE = "vercel-blob";
  return result;
}
module.exports = {mergePulledEnvironment};
