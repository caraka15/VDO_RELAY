import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
const setup = readFileSync(new URL("../src/components/SetupView.svelte", import.meta.url), "utf8");
const media = readFileSync(new URL("../src/lib/media.ts", import.meta.url), "utf8");
const publisher = readFileSync(new URL("../src/lib/mediamtx-publisher.js", import.meta.url), "utf8");
const create = source.slice(source.indexOf("async function handleCreate"), source.indexOf("async function handlePublishStart"));
const publish = source.slice(source.indexOf("async function handlePublishStart"), source.indexOf("function setPortraitMode"));

assert.match(create, /await probeVideoCodecs\(input\.width, input\.height, input\.fps\)/, "Create must validate the output encoder profile");
assert.match(create, /await createStream\(/, "Create must allocate the server job");
assert.ok(create.indexOf("await probeVideoCodecs(") < create.indexOf("await createStream("), "Output validation must happen before the server job is created");
assert.match(create, /await handlePublishStart\(\)/, "A new job must automatically open the live controls");
assert.match(setup, /probeVideoCodecs\(width, height, targetFps\)/, "Setup must probe the selected output profile");
assert.match(setup, /outputSupported !== true/, "Create must stay disabled until the selected output profile passes");
assert.match(publish, /await openValidatedCapture\(/, "Every relay start must revalidate the selected profile");
assert.match(publish, /await updateStream\(/, "Relay start must persist profile changes without replacing the job");
assert.doesNotMatch(media, /frameRate: \{ exact: input\.fps \}/, "Camera FPS must not be confused with output FPS");
assert.match(media, /captureStream\(input\.fps\)/, "The final canvas must use the selected output FPS");
assert.match(media, /video\.videoWidth \|\| settings\.width/, "Source resolution must come from camera metadata or track settings");
assert.match(media, /maxWidth/, "Camera capability details must include maximum dimensions");
assert.match(media, /setPortraitMode/, "Framing must be changeable without rebuilding the capture session");
assert.match(media, /const rotate = \(sourceHeight > sourceWidth\) !== portraitMode/, "Framing orientation must rotate source content when needed");
assert.match(media, /context\.rotate\(Math\.PI \/ 2\)/, "Portrait and landscape framing must use a real canvas rotation");
assert.doesNotMatch(publisher, /fetch\(this\.#conf\.fingerprintUrl, \{\s*headers:/, "Fingerprint fetch must not send Authorization and trigger CORS preflight");

console.log("output preflight, automatic start, source capability, framing, and fingerprint CORS checks: ok");
