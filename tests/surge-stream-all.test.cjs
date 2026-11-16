const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../Stream-All.js"), "utf8");
const names = ["ChatGPT", "Gemini", "Netflix", "Disney Plus+", "Youtube Premium"];
const reply = (body, status = 200, headers = {}) => ({
  status, headers, body: typeof body === "string" ? body : JSON.stringify(body)
});
function happy(url) {
  if (url.includes("netflix.com")) return reply({ isAvailable: true, requestCountry: { id: "JP" } });
  if (url.endsWith("/graphql")) return reply({ extensions: { sdk: { session: {
    inSupportedLocation: true, location: { countryCode: "JP" }
  } } } });
  if (url.endsWith("/trace")) return reply("loc=JP\n");
  if (url === "https://chatgpt.com/") return reply("<title>ChatGPT</title>");
  if (url.includes("youtube.com")) return reply('YouTube Premium {"GL":"JP"}');
  if (url.includes("gemini.google.com")) return reply('<title>Google Gemini</title>WIZ_global_data ,2,1,200,"JPN"');
  throw new Error("Unexpected endpoint");
}
async function run(override = () => undefined, options = {}) {
  const calls = [], outputs = [], logs = [], timers = [];
  let complete;
  const completed = new Promise(resolve => { complete = resolve; });
  function send(method, request, callback) {
    calls.push({ method, ...request });
    Promise.resolve().then(() => override(request.url, request)).then(changed => {
      const result = changed === undefined ? happy(request.url) : changed;
      if (result === null) return; // Simulate a transport that never invokes its callback.
      callback(null, { status: result.status, headers: result.headers }, result.body);
    }, error => callback(String(error), null, null));
  }
  const context = {
    $httpClient: { get: (r, cb) => send("GET", r, cb), post: (r, cb) => send("POST", r, cb) },
    $done: result => { outputs.push(result); complete(result); },
    console: { log: (...args) => logs.push(args) },
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, options.clock ? options.clock(ms) : ms === 12000 ? 80 : 20);
      timers.push(timer);
      return timer;
    },
    ...(options.noClear ? {} : { clearTimeout })
  };
  try {
    vm.runInNewContext(source, context, { timeout: 1000 });
    const output = await completed;
    if (options.settle) await new Promise(resolve => setTimeout(resolve, options.settle));
    return { output, calls, outputs, logs };
  } finally { timers.forEach(clearTimeout); }
}
function row(result, name) {
  return result.output.content.split("\n").find(line => line.startsWith(name + ":"));
}

test("native panel has the same five services in order and preserves existing routing", async () => {
  const r = await run();
  assert.deepEqual(r.output.content.split("\n").map(line => line.split(":")[0]), names);
  assert.equal(r.output.icon, "play.tv.fill");
  assert.equal(r.output["icon-color"], "#FF2D55");
  assert.equal(r.calls.length, 7);
  for (const name of names) assert.match(row(r, name), /支持.*🇯🇵/);
  assert.equal(r.calls.filter(c => c.method === "POST").length, 1);
  assert.match(r.calls.find(c => c.method === "POST").body, /mutation registerDevice/);
  for (const c of r.calls) {
    assert.equal(c.timeout, 7);
    assert.equal(c.insecure, false);
    assert.equal(c["auto-cookie"], false);
    assert.ok(!("policy" in c) && !("opts" in c));
  }
  assert.doesNotMatch(r.output.content, /<[^>]*>|undefined|Claude/);
  assert.deepEqual(r.logs, []);
  assert.equal(r.outputs.length, 1);
});

for (const [label, endpoint, response, expected] of [
  ["Netflix", "netflix.com", reply("login"), /检测异常/],
  ["Netflix", "netflix.com", reply("", 404), /未支持/],
  ["Netflix", "netflix.com", reply({ isAvailable: false }), /未支持/],
  ["Netflix", "netflix.com", reply({ isAvailable: true, other: { isAvailable: false } }), /检测异常/],
  ["ChatGPT", "chatgpt.com/", reply('"unsupported_country"', 403), /未支持/],
  ["ChatGPT", "chatgpt.com/", reply("<title>Just a moment</title>"), /需要验证/],
  ["Gemini", "gemini.google.com", reply("Gemini is not available in your country"), /未支持/],
  ["Gemini", "gemini.google.com", reply("<title>Gemini</title>WIZ_global_data", 200, { "X-Originating-URL": "https://consent.google.com/" }), /需要验证/],
  ["Gemini", "gemini.google.com", reply("login"), /检测异常/],
  ["Youtube Premium", "youtube.com", reply('YouTube Premium {"GL":"US"} Premium is not available in your country'), /未支持/],
  ["Youtube Premium", "youtube.com", reply("YouTube Premium"), /检测异常/],
  ["Youtube Premium", "youtube.com", reply("rate limited", 429), /检测异常/],
  ["Disney Plus+", "/graphql", reply({}), /检测异常/],
  ["Disney Plus+", "/graphql", reply("not-json"), /检测异常/],
  ["Disney Plus+", "/graphql", reply({ extensions: { session: { inSupportedLocation: null } } }), /检测异常/],
  ["Disney Plus+", "/graphql", reply({ extensions: { session: { inSupportedLocation: false } } }), /未支持/],
  ["Disney Plus+", "/graphql", reply({ errors: [{ code: "forbidden-location" }] }, 403), /未支持/]
]) {
  test(label + " classifies " + JSON.stringify(response) + " as " + expected, async () => {
    const r = await run(url => url.includes(endpoint) ? response : undefined);
    assert.match(row(r, label), expected);
    const unaffected = label === "Netflix" ? "Gemini" : "Netflix";
    assert.match(row(r, unaffected), /支持.*🇯🇵/);
  });
}

test("missing region stays unlabelled; TW matches the existing QuanX display convention", async () => {
  const r = await run(url => url.endsWith("/trace") ? reply("loc=TW\n") :
    url.endsWith("/graphql") ? reply({ extensions: { session: { inSupportedLocation: "true" } } }) : undefined);
  assert.match(row(r, "ChatGPT"), /🇨🇳/);
  assert.equal(row(r, "Disney Plus+"), "Disney Plus+: 支持 🎉");
});

test("transport failures are isolated and private error contents are never logged", async () => {
  const r = await run(url => {
    if (url.includes("gemini")) throw new Error("TLS failure SECRET-ENDPOINT");
    if (url.includes("youtube")) throw new Error("request timeout SECRET-ENDPOINT");
  });
  assert.match(row(r, "Gemini"), /检测异常/);
  assert.match(row(r, "Youtube Premium"), /检测超时/);
  assert.match(row(r, "Netflix"), /支持/);
  assert.doesNotMatch(JSON.stringify([r.output, r.logs]), /SECRET-ENDPOINT/);
});

test("hung callbacks finish once without clearTimeout (Surge native engine)", async () => {
  const r = await run(url => url.includes("youtube") ? null : undefined, { noClear: true, settle: 100 });
  assert.match(row(r, "Youtube Premium"), /检测超时/);
  assert.match(row(r, "Netflix"), /支持.*🇯🇵/);
  assert.equal(r.outputs.length, 1);
});

test("overall deadline retains completed checks and ignores late completions", async () => {
  const r = await run(url => url.includes("gemini") ? new Promise(resolve => setTimeout(() => resolve(happy(url)), 45)) : undefined,
    { clock: ms => ms === 12000 ? 15 : 65, settle: 80 });
  assert.match(row(r, "Gemini"), /检测超时/);
  assert.match(row(r, "Netflix"), /支持.*🇯🇵/);
  assert.equal(r.outputs.length, 1);
});
