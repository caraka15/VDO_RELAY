import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
const media = readFileSync(new URL("../src/lib/media.ts", import.meta.url), "utf8");
const create = source.slice(source.indexOf("async function handleCreate"), source.indexOf("async function handlePublishStart"));
const publish = source.slice(source.indexOf("async function handlePublishStart"), source.indexOf("function setPortraitMode"));

assert.match(create, /await openValidatedCapture\(/, "Create must validate the selected camera profile");
assert.match(create, /await createStream\(/, "Create must allocate the server job");
assert.ok(create.indexOf("await openValidatedCapture(") < create.indexOf("await createStream("), "Profile validation must happen before the server job is created");
assert.match(publish, /await openValidatedCapture\(/, "Every relay start must revalidate the selected profile");
assert.match(publish, /await updateStream\(/, "Relay start must persist profile changes without replacing the job");
assert.match(media, /frameRate: \{ exact: input\.fps \}/, "Camera FPS must be requested exactly");
assert.doesNotMatch(media, /settings\.width \|\| input\.width/, "Missing camera width must not fall back to the requested width");
assert.doesNotMatch(media, /settings\.height \|\| input\.height/, "Missing camera height must not fall back to the requested height");
assert.match(media, /video\.videoWidth \|\| settings\.width/, "Resolution must come from camera metadata or track settings");

console.log("preflight-first flow, reusable job, and strict camera profile checks: ok");
