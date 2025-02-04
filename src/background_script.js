const chromeUAStringManager = new ChromeUAStringManager();
const enabledHostnames = new EnabledHostnamesList();
let contentScriptHandle = null;

function matchPatternsForHostnames(hostnames) {
  return hostnames.map((n) => `*://${n}/*`);
}

async function contentScriptSetup() {
  const oldHostnames = new Set(enabledHostnames.get_values());

  await enabledHostnames.load();

  const hostsToAdd = new Set();
  const hostsToRemove = new Set(oldHostnames.keys());
  for (const hostname of enabledHostnames.get_values()) {
    if (oldHostnames.has(hostname)) {
      hostsToRemove.delete(hostname);
    } else {
      hostsToAdd.add(hostname);
    }
  }

  if (contentScriptHandle) {
    contentScriptHandle.unregister();
    contentScriptHandle = null;
  }

  if ([...enabledHostnames.get_values()].length > 0) {
    contentScriptHandle = await browser.contentScripts.register({
      allFrames: true,
      js: [{ file: "content_script.js" }],
      matches: matchPatternsForHostnames([...enabledHostnames.get_values()]),
      runAt: "document_start",
    });
  }

  setupOnBeforeSendHeaders();

  const changedHostnames = [...hostsToAdd, ...hostsToRemove];
  const affectedTabs = await browser.tabs.query({ url: matchPatternsForHostnames(changedHostnames) });
  for (const tab of affectedTabs) {
    browser.tabs.reload(tab.id, { bypassCache: true });
  }
}

function onBeforeSendHeadersHandler(details) {
  for (const header of details.requestHeaders) {
    if (header.name.toLowerCase() === "user-agent") {
      header.value = chromeUAStringManager.getUAString();
    }
  }

  return { requestHeaders: details.requestHeaders };
}

function setupOnBeforeSendHeaders() {
  if (browser.webRequest.onBeforeSendHeaders.hasListener(onBeforeSendHeadersHandler)) {
    browser.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeadersHandler);
  }

  if ([...enabledHostnames.get_values()].length < 1) {
    return;
  }

  browser.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeadersHandler,
    { urls: matchPatternsForHostnames([...enabledHostnames.get_values()]) },
    ["blocking", "requestHeaders"],
  );
}

async function init() {
  browser.runtime.onMessage.addListener(async (msg) => {
    switch (msg.action) {
      case "enabled_hostnames_changed":
        await contentScriptSetup();
        break;
      default:
        throw new Error("unexpected message received", msg);
    }
  });

  await chromeUAStringManager.init();
  await contentScriptSetup();
  setupOnBeforeSendHeaders();
}

init();
