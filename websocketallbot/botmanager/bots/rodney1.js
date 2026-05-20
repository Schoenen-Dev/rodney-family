// version3_websocket_fast_accept.js
// Requirements: Chrome + chromedriver + npm install selenium-webdriver
// NOTE: update credentials if needed.

const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");

function getTimestamp() {
  return new Date().toLocaleString();
}
function minutesSince(date) {
  return (Date.now() - date) / (1000 * 60);
}

(async function run() {
  // --------- Configure Chrome options ---------
  const options = new chrome.Options();
  // run headless? comment out if you want to see the browser
  options.addArguments("--headless=new");
  options.addArguments("--no-sandbox");
  options.addArguments("--disable-dev-shm-usage");
  options.addArguments("--disable-gpu");
  options.addArguments("--window-size=1920,1080");
  options.addArguments("--disable-extensions");
  options.addArguments("--disable-background-networking"); 
  // optional: disable images to save bandwidth (uncomment if desired)
  // options.addArguments("--blink-settings=imagesEnabled=false");

  const chromeBin = process.env.CHROME_BIN;
  if (chromeBin) options.setChromeBinaryPath(chromeBin);
  const service = process.env.CHROMEDRIVER_PATH
    ? new chrome.ServiceBuilder(process.env.CHROMEDRIVER_PATH).build()
    : undefined;
  let driver = await new Builder().forBrowser("chrome").setChromeOptions(options)
    .setChromeService(service)
    .build();
  let lastLoginTime = Date.now();
  let lastRefresh = Date.now();

  // ---------------- LOGIN ----------------
  async function login() {
    console.log(`[${getTimestamp()}] 🔐 Attempting login...`);
    await driver.get("https://orders.valuenet.com/Collaterals/");

    try {
      await driver.wait(until.elementLocated(By.id("ctl00_ContentPlaceHolder1_txtLogin")), 10000);

      await driver.findElement(By.id("ctl00_ContentPlaceHolder1_txtLogin")).sendKeys("hrampersad");
      await driver.findElement(By.id("ctl00_ContentPlaceHolder1_txtPassword")).sendKeys("@Groundworks1957");
      await driver.findElement(By.id("ctl00_ContentPlaceHolder1_btnsubmit")).click();

      // quick checks for success/failure
      try {
        await driver.wait(until.urlContains("Dashboard"), 6000);
        console.log(`[${getTimestamp()}] ✅ Login successful`);
      } catch {
        // check invalid credentials
        try {
          await driver.wait(
            until.elementLocated(By.xpath("//*[contains(text(),'Invalid') or contains(text(),'incorrect')]")),
            3000
          );
          console.log(`[${getTimestamp()}] ❌ Invalid credentials — exiting`);
          const shot = await driver.takeScreenshot();
          fs.writeFileSync("/tmp/invalid_credentials.png", shot, "base64");
          await driver.quit();
          process.exit(1);
        } catch {}
        // check for challenge element
        try {
          await driver.wait(until.elementLocated(By.id("ctl00_ContentPlaceHolder1_txtChallenge")), 3000);
          console.log(`[${getTimestamp()}] 🚨 Verification required. Please complete manually. Exiting.`);
          const shot = await driver.takeScreenshot();
          fs.writeFileSync("/tmp/verification_required.png", shot, "base64");
          await driver.quit();
          process.exit(1);
        } catch {}
      }
      lastLoginTime = Date.now();
    } catch (err) {
      console.log(`[${getTimestamp()}] ❌ Login error: ${err.message}`);
      await driver.quit();
      process.exit(1);
    }
  }

  // ---------------- LOGOUT ----------------
  async function logout() {
    try {
      await driver.findElement(By.id("ctl00_userLogged")).click();
      await driver.sleep(300);
      await driver.findElement(By.id("ctl00_btnSignout")).click();
      await driver.wait(until.elementLocated(By.id("ctl00_ContentPlaceHolder1_txtLogin")), 8000);
      console.log(`[${getTimestamp()}] ✅ Logged out`);
    } catch (err) {
      console.log(`[${getTimestamp()}] ❌ Logout failed: ${err.message}`);
    }
  }

  // ---------------- Inject WS/EventSource/fetch hooks ----------------
  // This injection wraps the native WebSocket and EventSource to push received data into window.__vn_ws_messages
  async function injectNetworkSniffer() {
    const injectScript = `
      if (!window.__VN_SNIFER_INSTALLED__) {
        window.__VN_SNIFER_INSTALLED__ = true;
        // queue to hold incoming messages
        window.__vn_ws_messages = window.__vn_ws_messages || [];

        // Wrap WebSocket
        (function(){
          const NativeWS = window.WebSocket;
          function WrappedWebSocket(url, protocols) {
            const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
            try {
              ws.addEventListener('message', function(e) {
                try {
                  // store raw data
                  window.__vn_ws_messages.push({type:'ws', url: url, data: e.data, ts: Date.now()});
                } catch(err) {}
              });
            } catch(err){}
            return ws;
          }
          // copy prototype so instanceof checks still work
          WrappedWebSocket.prototype = NativeWS.prototype;
          WrappedWebSocket.CONNECTING = NativeWS.CONNECTING;
          WrappedWebSocket.OPEN = NativeWS.OPEN;
          WrappedWebSocket.CLOSING = NativeWS.CLOSING;
          WrappedWebSocket.CLOSED = NativeWS.CLOSED;
          window.WebSocket = WrappedWebSocket;
        })();

        // Wrap EventSource (Server-Sent Events)
        (function(){
          if (!window.EventSource) return;
          const NativeES = window.EventSource;
          function WrappedEventSource(url, options) {
            const es = new NativeES(url, options);
            try {
              es.addEventListener('message', function(e){
                try {
                  window.__vn_ws_messages.push({type:'es', url: url, data: e.data, ts: Date.now()});
                } catch(err){}
              });
            } catch(err){}
            return es;
          }
          WrappedEventSource.prototype = NativeES.prototype;
          window.EventSource = WrappedEventSource;
        })();

        // Wrap fetch responses to capture JSON bodies (best-effort; can be heavy - minimal)
        (function(){
          if (!window.fetch) return;
          const nativeFetch = window.fetch;
          window.fetch = function(){ 
            return nativeFetch.apply(this, arguments).then(async function(response){
              try {
                // clone to avoid consuming original stream
                const clone = response.clone();
                // only attempt for json/text small responses
                const contentType = clone.headers.get && clone.headers.get('content-type') || '';
                if (contentType.includes('json') || contentType.includes('text')) {
                  // attempt to read text safely with size guard
                  const txt = await clone.text().catch(()=>null);
                  if (txt && txt.length < 10000) {
                    window.__vn_ws_messages.push({type:'fetch', url: arguments[0], data: txt, ts: Date.now()});
                  }
                }
              } catch(e){}
              return response;
            });
          };
        })();

        // lightweight console notice
        console.log("VN network sniffer installed: WebSocket/EventSource/fetch hooks active.");
      }
      return true;
    `;

    try {
      await driver.executeScript(injectScript);
      // create a fast DOM observer too (fallback)
      const moInject = `
        if (!window.__VN_OBSERVER_ACTIVE__) {
          window.__VN_OBSERVER_ACTIVE__ = true;
          const obs = new MutationObserver(muts => {
            for (const m of muts) {
              if (m.addedNodes && m.addedNodes.length) {
                m.addedNodes.forEach(n => {
                  try {
                    if (n.querySelectorAll) {
                      const btns = n.querySelectorAll("#grabItBoardOrdersWidget a#lnkAcceptOrder, #newOrdersWidget a#lnkAcceptOrder");
                      if (btns && btns.length) {
                        // record discovered button hit in queue so Node loop can click if injection couldn't
                        window.__vn_ws_messages.push({type:'dom_detect', note:'dom_btn', ts:Date.now()});
                      }
                    }
                  } catch(e){}
                });
              }
            }
          });
          obs.observe(document.body, { childList:true, subtree:true });
          console.log("MutationObserver fallback installed for VN.");
        }
        return true;
      `;
      await driver.executeScript(moInject);
      console.log(`[${getTimestamp()}] 🧩 Network + DOM hooks injected`);
    } catch (err) {
      console.log(`[${getTimestamp()}] ❌ Injection failed: ${err.message}`);
    }
  }

  // ---------------- Parse intercepted messages for "order-like" signs ----------------
  // This function uses heuristics — customize keywords if you know the feed structure.
  function looksLikeOrderMessage(raw) {
    if (!raw) return false;
    // raw might be object {type, url, data}
    let txt = raw.data ? raw.data.toString() : raw.toString();
    // lower for easier matching
    const l = txt.toLowerCase();

    // heuristic keywords (tweak these to match your server messages)
    const keywords = [
      "neworder", "new order", "order_created", "orderid", "order_id", "lnkacceptorder",
      "grabit", "grab it", "notifyorder", "order_added", "orders", "order"
    ];

    // If JSON, parse and search keys
    try {
      const j = JSON.parse(txt);
      // if it is object, quick heuristic checks
      if (typeof j === "object") {
        const s = JSON.stringify(j).toLowerCase();
        for (const kw of keywords) if (s.includes(kw)) return true;
      }
    } catch (e) {
      // not json — fall back to substring matching
      for (const kw of keywords) if (l.includes(kw)) return true;
    }
    return false;
  }

  // ---------------- click-first accept action ----------------
  async function tryClickAcceptImmediate() {
    try {
      // Find any accept button on both boards
      const selectors = [
        "#grabItBoardOrdersWidget a#lnkAcceptOrder",
        "#grabItBoardDisplay a#lnkAcceptOrder",
        "#newOrdersWidget a#lnkAcceptOrder",
        "#newOrdersDisplay a#lnkAcceptOrder"
      ];
      for (const sel of selectors) {
        const elems = await driver.findElements(By.css(sel));
        if (elems.length > 0) {
          const btn = elems[0];
          try {
            await driver.executeScript("arguments[0].scrollIntoView(true);", btn);
            await driver.executeScript("arguments[0].click();", btn); // direct click via JS
            console.log(`[${getTimestamp()}] ⚡ CLICKED accept -websocket (selector ${sel})`);
            // log AFTER click
            try {
              const row = await btn.findElement(By.xpath("./ancestor::tr"));
              const txt = await row.getText();
              fs.appendFileSync(process.env.LOG_DIR ? require('path').join(process.env.LOG_DIR, 'valuenet_log.txt') : '/tmp/valuenet_log.txt', `[${getTimestamp()}] ACCEPTED - Websocket\n${txt}\n-----------------\n`);
            } catch (e) {
              fs.appendFileSync(process.env.LOG_DIR ? require('path').join(process.env.LOG_DIR, 'valuenet_log.txt') : '/tmp/valuenet_log.txt', `[${getTimestamp()}] ACCEPTED — row not readable\n-----------------\n`);
            }
            // short cooldown to prevent double click the same order
            await new Promise(r => setTimeout(r, 350));
            return true;
          } catch (clickErr) {
            console.log(`[${getTimestamp()}] ⚠️ Click failed: ${clickErr.message}`);
          }
        }
      }
    } catch (err) {
      console.log(`[${getTimestamp()}] ⚠️ tryClickAcceptImmediate error: ${err.message}`);
    }
    return false;
  }

  // ---------------- Main flow ----------------
  try {
    await login();
    await driver.get("https://orders.valuenet.com/Collaterals/Site/VendorServices/DataCollectorDashboard");
    await injectNetworkSniffer();
    lastRefresh = Date.now();
    console.log(`[${getTimestamp()}] 📄 Dashboard loaded — sniffer active`);

    // main event loop: poll the injected message queue fast and respond immediately
    while (true) {
      // refresh every 8 seconds (only)
      if (Date.now() - lastRefresh >= 8000) {
        try {
          await driver.get("https://orders.valuenet.com/Collaterals/Site/VendorServices/DataCollectorDashboard");
          await injectNetworkSniffer(); // reinject hooks after reload
          lastRefresh = Date.now();
          console.log(`[${getTimestamp()}] 🔄 Dashboard refreshed`);
        } catch (rerr) {
          console.log(`[${getTimestamp()}] ⚠️ Refresh failed: ${rerr.message}`);
        }
      }

      // auto re-login every 30 minutes if needed
      if (minutesSince(lastLoginTime) >= 30) {
        await logout();
        await login();
        await driver.get("https://orders.valuenet.com/Collaterals/Site/VendorServices/DataCollectorDashboard");
        await injectNetworkSniffer();
        lastRefresh = Date.now();
      }

      // 1) Inspect network message queue quickly
      try {
        // pull up to 50 queued items at once and clear them on the page
        const queued = await driver.executeScript(`
          try {
            if (!window.__vn_ws_messages) return [];
            const items = window.__vn_ws_messages.splice(0, 50);
            return items;
          } catch(e) { return []; }
        `);

        // queued is an array of objects like {type, url, data, ts}
        if (queued && queued.length) {
          // iterate messages and check if any look like an order
          let foundOrder = false;
          for (const q of queued) {
            try {
              if (looksLikeOrderMessage(q)) {
                foundOrder = true;
                break;
              }
              // also treat dom_detect hints as triggers
              if (q && q.type === 'dom_detect') {
                foundOrder = true;
                break;
              }
            } catch (e) {}
          }

          if (foundOrder) {
            // CLICK FIRST - highest priority
            const clicked = await tryClickAcceptImmediate();
            if (!clicked) {
              // fallback: attempt a brief DOM scan and click
              try {
                const btns = await driver.findElements(By.css("#grabItBoardOrdersWidget a#lnkAcceptOrder, #newOrdersWidget a#lnkAcceptOrder"));
                if (btns.length > 0) {
                  await driver.executeScript("arguments[0].click();", btns[0]);
                  console.log(`[${getTimestamp()}] ⚡ Clicked accept via fallback - websocket`);
                }
              } catch (e) { console.log(`[${getTimestamp()}] ⚠️ Fallback click failed: ${e.message}`); }
            }
          }
        }
      } catch (err) {
        console.log(`[${getTimestamp()}] ⚠️ Error reading queue: ${err.message}`);
      }

      // 2) As a safety net, short DOM scan to catch visible accept buttons (very fast)
      try {
        const hasBtn = await driver.findElements(By.css("#grabItBoardOrdersWidget a#lnkAcceptOrder, #newOrdersWidget a#lnkAcceptOrder"));
        if (hasBtn.length > 0) {
          await tryClickAcceptImmediate();
        }
      } catch (e) {}

      // micro sleep - keep this small to be responsive but not CPU suicidal
      await new Promise(r => setTimeout(r, 25));
    }

  } catch (fatal) {
    console.log(`[${getTimestamp()}] ❌ Fatal error: ${fatal}`);
  } finally {
    // do not quit automatically — script intends to run long-lived
    // If you want cleanup after a condition, call driver.quit() from outside or modify here.
  }

})();
