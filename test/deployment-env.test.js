"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {mergePulledEnvironment}=require("../lib/deployment-env");
test("cloud installer retains private credentials across redacted environment pulls",()=>{
  const previous={QUICKSHARE_TOKEN:"saved-private-test-value",REMOVED:"obsolete"};
  const pulled={QUICKSHARE_TOKEN:"[SENSITIVE]",OBJECT_STORE:"[SENSITIVE]",TURSO_DATABASE_URL:"libsql://example.invalid"};
  const merged=mergePulledEnvironment(pulled,previous);
  assert.equal(merged.QUICKSHARE_TOKEN,previous.QUICKSHARE_TOKEN);
  assert.equal(merged.OBJECT_STORE,"vercel-blob");
  assert.equal(merged.REMOVED,undefined);
  assert.equal(pulled.QUICKSHARE_TOKEN,"[SENSITIVE]");
  assert.equal(mergePulledEnvironment(pulled,{}).QUICKSHARE_TOKEN,"[SENSITIVE]");
  assert.equal(mergePulledEnvironment({QUICKSHARE_TOKEN:"new-value"},previous).QUICKSHARE_TOKEN,"new-value");
});
