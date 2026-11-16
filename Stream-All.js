/**
 * Surge native panel: ChatGPT, Gemini, Netflix, Disney Plus+, Youtube Premium.
 * Adapted from Howaboutcoffee/QuantumultX Scripts/streaming-ui-check.js
 * (KOP-XIAO, Hyseen, AtlantisGawrGura, CoiaPrant, Netflixxp).
 * Panel contract and Disney registerDevice: Rabbit-Spec / LucaLin233 Stream-All.
 * Anonymous checks only; no login, conversation or playback verification.
 * Use type=generic, timeout=15. Requests follow existing Surge routing.
 */
const REQUEST_TIMEOUT = 7000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// Public Disney browser client identifier, inherited from the upstream checker.
// This is not a subscriber credential. Anonymous device tokens stay in memory.
const DISNEY_CLIENT = "ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";

function bounded(promise, ms = REQUEST_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("检测超时，无法判断")), ms);
    Promise.resolve(promise).then(value => {
      if (typeof clearTimeout === "function") clearTimeout(timer);
      resolve(value);
    }, error => {
      if (typeof clearTimeout === "function") clearTimeout(timer);
      reject(error);
    });
  });
}

async function request(url, options = {}) {
  try {
    return await bounded(new Promise((resolve, reject) => {
      const method = options.method === "POST" ? "post" : "get";
      $httpClient[method]({
        url,
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...options.headers },
        ...(options.body === undefined ? {} : { body: options.body }),
        timeout: REQUEST_TIMEOUT / 1000,
        "auto-cookie": false,
        insecure: false
      }, (error, response, body) => {
        if (error) return reject(new Error(String(error)));
        if (!response) return reject(new Error("Missing response"));
        resolve({ statusCode: response.status, headers: response.headers || {}, body: body || "" });
      });
    }));
  } catch (error) {
    if (error && error.message === "检测超时，无法判断") throw error;
    const reason = String(error && error.message || "");
    if (/timed?\s*out|timeout|超时|-1001/i.test(reason)) throw new Error("检测超时，无法判断");
    throw new Error("网络或 TLS 异常，无法判断");
  }
}

function httpError(response) {
  const code = response.statusCode;
  if (code === 429) return "请求受限（HTTP 429），请稍后重试";
  if (code === 403) return "访问被拒绝或需要验证（HTTP 403），无法判断";
  if (code === 401) return "检测接口未授权（HTTP 401），无法判断";
  if (code >= 300 && code < 400) return "请求发生重定向，无法判断";
  return "接口异常（HTTP " + code + "），无法判断";
}

function requireOK(response, accepted = [200]) {
  if (!accepted.includes(response.statusCode)) throw new Error(httpError(response));
  if (/cf-chl-|challenge-platform|<title>\s*Just a moment/i.test(response.body || "")) {
    throw new Error("需要网页验证，无法判断");
  }
}

function regionLabel(region) {
  return typeof region === "string" && /^[A-Z]{2}$/i.test(region)
    ? " · " + region.toUpperCase() : " · 地区未知";
}

async function testNetflix() {
  const samples = await Promise.all(["81280792", "70143836"].map(async id => {
    try {
      const response = await request("https://www.netflix.com/title/" + id);
      if (response.statusCode === 404) return { available: false };
      requireOK(response);
      const body = (response.body || "").replace(/\\"/g, '"');
      const matches = [...body.matchAll(/"isAvailable"\s*:\s*(true|false)/g)];
      const values = [...new Set(matches.map(m => m[1]))];
      if (values.length !== 1) throw new Error("片目页面格式变化，无法判断");
      const country = body.match(/"requestCountry"\s*:\s*\{[^}]*?"id"\s*:\s*"([A-Z]{2})"/i);
      return { available: values[0] === "true", country: country ? country[1] : "" };
    } catch (error) { return { error: error.message }; }
  }));
  const available = samples.filter(s => s.available === true);
  const countries = [...new Set(samples.map(s => s.country).filter(Boolean))];
  const suffix = countries.length === 1 ? regionLabel(countries[0]) : " · 地区未确认";
  if (available.length) {
    return "非自制片样本可用 " + available.length + "/2" + suffix +
      (samples.some(s => s.error) ? "；另一项检测异常" : "") + "（未验证播放）";
  }
  const failed = samples.find(s => s.error);
  if (failed) return failed.error;
  return "两个样本均不可用" + suffix + "；可能为片库差异或访问限制，不能据此认定仅自制";
}

function checkDisneyResponse(response, accepted = [200]) {
  let data;
  try { data = JSON.parse(response.body); } catch (_) { /* requireOK diagnoses HTTP errors first */ }
  if (data && /"forbidden-location"|"unsupported-location"/i.test(JSON.stringify(data))) {
    throw new Error("地区受限（服务明确返回）");
  }
  requireOK(response, accepted);
  if (!data || typeof data !== "object") throw new Error("Disney 接口格式变化，无法判断");
  return data;
}

async function testDisney() {
  // Preserve the working Surge upstream's anonymous registerDevice endpoint.
  const data = checkDisneyResponse(await request("https://disney.api.edge.bamgrid.com/graph/v1/device/graphql", {
    method: "POST",
    headers: { Authorization: DISNEY_CLIENT, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "mutation registerDevice($input: RegisterDeviceInput!) { registerDevice(registerDevice: $input) { grant { grantType assertion } } }",
      variables: { input: {
        applicationRuntime: "chrome",
        attributes: {
          browserName: "chrome", browserVersion: "94.0.4606",
          manufacturer: "apple", model: null, operatingSystem: "macintosh",
          operatingSystemVersion: "10.15.7", osDeviceIds: []
        },
        deviceFamily: "browser", deviceLanguage: "en", deviceProfile: "macosx"
      } }
    })
  }));
  const session = data.extensions && (data.extensions.sdk ? data.extensions.sdk.session : data.extensions.session);
  if (!session || ![true, false, "true", "false"].includes(session.inSupportedLocation)) {
    throw new Error("Disney 地区字段缺失，无法判断");
  }
  const region = regionLabel(session.location && session.location.countryCode);
  return session.inSupportedLocation === true || session.inSupportedLocation === "true"
    ? "地区检测通过" + region + "（未验证播放）" : "地区不支持" + region;
}

async function testChatGPT() {
  const [page, trace] = await Promise.all([
    request("https://chatgpt.com/"),
    request("https://chatgpt.com/cdn-cgi/trace").catch(() => null)
  ]);
  const body = page.body || "";
  if (/"unsupported_country"|unsupported_country_region_territory|not available in your country|not available in your region/i.test(body)) {
    return "地区受限（服务明确返回）";
  }
  requireOK(page);
  if (!/chatgpt/i.test(body)) return "页面内容未识别，无法判断";
  const match = trace && trace.statusCode === 200 && String(trace.body).match(/^loc=([A-Z]{2})\s*$/m);
  return "网页可访问" + regionLabel(match ? match[1] : "") + "（未验证登录或对话）";
}

async function testYouTube() {
  const response = await request("https://www.youtube.com/premium");
  requireOK(response);
  const body = response.body || "";
  if (body.includes("Premium is not available in your country")) return "Premium 地区不支持";
  const region = body.match(/"GL"\s*:\s*"([A-Z]{2})"/i);
  if (!region || !/youtube/i.test(body)) return "页面内容未识别，无法判断";
  return "Premium 网页可访问" + regionLabel(region[1]) + "（未验证订阅资格）";
}

function responseHeader(response, name) {
  const headers = response.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

async function testGemini() {
  const page = await request("https://gemini.google.com/", { headers: { "Accept-Language": "en-US,en;q=0.9" } });
  const body = page.body || "";
  const finalURL = responseHeader(page, "X-Originating-URL") || page.url || "";
  if (/Gemini (?:is(?: currently)? not|isn['’]t(?: currently)?|is not currently) (?:available|supported) in (?:your|this) (?:country|region)|Gemini (?:is )?(?:currently )?unavailable in (?:your|this) (?:country|region)/i.test(body) ||
      /45631641\s*,\s*null\s*,\s*false/.test(body)) {
    return "地区受限（服务明确返回）";
  }
  requireOK(page);
  if (/consent.google.com|accounts.google.com/.test(finalURL) ||
      /Our systems have detected unusual traffic|<title>\s*Before you continue/i.test(body)) {
    throw new Error("需要网页验证，无法判断");
  }
  // The older numeric availability flag can disappear. Recognize the actual
  // application bootstrap as well; never treat a generic 200/login page as success.
  const legacyAvailable = /45631641\s*,\s*null\s*,\s*true/.test(body);
  const appPage = /<title[^>]*>[^<]*Gemini/i.test(body) && /WIZ_global_data/.test(body);
  if (!legacyAvailable && !appPage) return "Gemini 页面格式变化，无法判断";
  const country = body.match(/,\s*2\s*,\s*1\s*,\s*200\s*,\s*"([A-Z]{3})"/);
  // Map common platform country codes; leave unknown codes unlabelled rather
  // than guessing from a different domain that may use another unlock route.
  const countries = {
    USA: "US", CAN: "CA", GBR: "GB", IRL: "IE", AUS: "AU", NZL: "NZ",
    JPN: "JP", SGP: "SG", HKG: "HK", TWN: "TW", KOR: "KR", CHN: "CN",
    IND: "IN", IDN: "ID", MYS: "MY", THA: "TH", VNM: "VN", PHL: "PH",
    DEU: "DE", FRA: "FR", NLD: "NL", ITA: "IT", ESP: "ES", PRT: "PT",
    CHE: "CH", SWE: "SE", NOR: "NO", FIN: "FI", DNK: "DK", POL: "PL",
    AUT: "AT", BEL: "BE", CZE: "CZ", ROU: "RO", TUR: "TR", BRA: "BR",
    MEX: "MX", ARG: "AR", CHL: "CL", ZAF: "ZA", ARE: "AE", ISR: "IL"
  };
  return "网页可访问" + regionLabel(country ? countries[country[1]] : "") + "（未验证登录或对话）";
}

// Match the compact status labels used by our Quantumult X checker.
function displayResult(value) {
  if (/地区受限|地区不支持|两个样本均不可用/.test(value)) return "未支持 🚫";
  const positive = /样本可用|地区检测通过|网页可访问/.test(value);
  if (positive) {
    const country = value.match(/ · ([A-Z]{2})\b/);
    const flagCode = country ? (country[1] === "TW" ? "CN" : country[1]) : "";
    const flag = [...flagCode].map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join("");
    return "支持" + (flag ? " ➟ ⟦" + flag + "⟧" : "") + " 🎉";
  }
  if (/超时/.test(value)) return "检测超时 🚦";
  if (/网页验证|需要验证/.test(value)) return "需要验证 ❗️";
  return "检测异常 ❗️";
}

async function main() {
  const checks = [
    ["ChatGPT", testChatGPT], ["Gemini", testGemini],
    ["Netflix", testNetflix], ["Disney Plus+", testDisney], ["Youtube Premium", testYouTube]
  ];
  const rows = checks.map(([name]) => [name, "检测超时，无法判断"]);
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (typeof clearTimeout === "function") clearTimeout(deadline);
    $done({
      title: "流媒体解锁检测",
      content: rows.map(([name, result]) => name + ": " + displayResult(result)).join("\n"),
      icon: "play.tv.fill",
      "icon-color": "#FF2D55"
    });
  }
  const deadline = setTimeout(finish, 12000);
  try {
    await Promise.all(checks.map(async ([name, check], index) => {
      try { rows[index] = [name, await check()]; }
      catch (error) { rows[index] = [name, error.message || "检测异常，无法判断"]; }
    }));
  } finally { finish(); }
}
main();
