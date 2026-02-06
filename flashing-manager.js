import * as esptoolBundle from "https://unpkg.com/esptool-js@0.5.6/bundle.js";

window.ESPLoader = esptoolBundle.ESPLoader;
window.ESPLoaderTransport = esptoolBundle.Transport;
window.ESPHardReset = esptoolBundle.hardReset || null;
const primaryLang =
  (Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages[0]
    : (navigator.language || navigator.userLanguage || "")) ||
  "";

// English is the default. Only switch to German if the *primary* preferred language is German.
const isGermanRegion = /^de(-|$)/i.test(String(primaryLang).toLowerCase());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, timeoutError) {
  let t;
  const timeoutPromise = new Promise((_, reject) => {
    t = setTimeout(() => reject(timeoutError), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(t));
}

const KNOWN_ESP32_RELATED_USB_VIDS = new Set([
  0x10c4, // Silicon Labs (CP210x)
  0x1a86, // WCH (CH340/CH341)
  0x0403, // FTDI
  0x303a, // Espressif (native USB / USB-JTAG)
]);
function portLooksLikeEsp32Device(port) {
  // If WebSerial cannot provide VID/PID (or getInfo is missing), we can't pre-filter.
  if (!port || typeof port.getInfo !== "function") return true;

  try {
    const info = port.getInfo() || {};
    const vid = info.usbVendorId;
    if (typeof vid !== "number") return true;
    return KNOWN_ESP32_RELATED_USB_VIDS.has(vid);
  } catch {
    return true;
  }
}

const DRIVER_HELP_LINKS = {
  cp210x: "https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads",
  ch340: "https://www.wch-ic.com/downloads/ch341ser_exe.html",
  ftdi: "https://ftdichip.com/drivers/vcp-drivers/",
};
const DRIVER_HELP_TRIGGERS = [
  /\bno\s*esp32\b/i,
  /\bkein\s*esp32\b/i,
  /\bnot\s*detected\b/i,
  /\bnicht\s*erkannt\b/i,
  /\btimeout\b/i,
  /\bzeitüberschreitung\b/i,
  /failed\s+to\s+execute\s+'open'\s+on\s+'serialport'/i,
  /failed\s+to\s+open\s+serial\s+port/i,
  /serialport:\s*failed\s+to\s+open/i,
  /could\s+not\s+open\s+serial/i,
  /notallowederror/i,
  /networkerror/i,
];
function isLikelyDriverOrPortIssueMessage(msg) {
  const text = String(msg || "");
  return DRIVER_HELP_TRIGGERS.some((re) => re.test(text));
}

function buildDriverHelpData(options = {}) {
  const { fromStepLink = false } = options;
  const title = fromStepLink
    ? (isGermanRegion ? "Verbindungshilfe" : "Connection Help")
    : (isGermanRegion ? "Kein ESP32 Chip erkannt!" : "ESP32 not detected!");
  const body = fromStepLink
    ? (isGermanRegion
      ? "Es ist möglich, dass der richtige Port wegen fehlender Treiber nicht angezeigt wird. Der korrekte Port würde ungefähr so heißen:"
      : "It’s possible the correct port isn’t showing up because the required drivers are missing. The correct port would be named something like:")
    : (isGermanRegion
      ? "Am ausgewählten Port ist kein ESP32-basiertes Board angeschlossen. Es ist möglich, dass der richtige Port wegen fehlender Treiber nicht angezeigt wird. Der korrekte Port würde ungefähr so heißen:"
      : "No ESP32-based board is connected to the selected port. It’s possible the correct port isn’t showing up because the required drivers are missing. The correct port would be named something like:");
  const portExamples = [
    "CP2102 USB to UART Bridge Controller",
    "USB-SERIAL CH340 (COM3)",
    "USB JTAG/serial debug unit",
  ];
  const linksTitle = isGermanRegion ? "Treiber-Downloads:" : "Driver downloads:";
  const links = [
    { label: isGermanRegion ?
      "CP210x (häufig)" : "CP210x (common)", href: DRIVER_HELP_LINKS.cp210x },
    { label: isGermanRegion ?
      "CH340/CH341" : "CH340/CH341", href: DRIVER_HELP_LINKS.ch340 },
    { label: isGermanRegion ?
      "FTDI (selten)" : "FTDI (rare)", href: DRIVER_HELP_LINKS.ftdi },
  ];
  // UPDATED HINT: Added instructions for the BOOT button
  const hint = isGermanRegion
    ?
    "Tipp: Nutze ein USB-Datenkabel. Falls es trotzdem nicht geht, halte den BOOT-Button auf dem Board gedrückt, während du 'Verbinden' klickst, und lasse ihn erst los, wenn das Board erkannt wurde."
    : "Tip: Use a USB data cable. If it still fails, hold the BOOT button on the board while clicking 'Connect' and only release it once the board is detected.";
  return {
    title,
    body,
    portExamples,
    linksTitle,
    links,
    hint,
  };
}

const DRIVER_HELP_SESSION_KEY = "lts_driver_help_shown";

function hasShownDriverHelpThisSession() {
  try {
    return sessionStorage.getItem(DRIVER_HELP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markDriverHelpShownThisSession() {
  try {
    sessionStorage.setItem(DRIVER_HELP_SESSION_KEY, "1");
  } catch {}
}


function showDriverHelpPopup(options = {}) {
  const data = buildDriverHelpData(options);
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  // NOTE: This modal must be provided in HTML.
  // Required IDs: driverHelpModal, driverHelpTitle, driverHelpBody, driverHelpPorts,
  //              driverHelpLinksTitle, driverHelpLinks, driverHelpHint
  const backdrop = document.getElementById("driverHelpModal");
  if (!backdrop) {
    return;
  }

  // Wire events once.
  if (!backdrop.dataset.wired) {
    backdrop.dataset.wired = "1";

    const hide = () => {
      backdrop.hidden = true;
      backdrop.classList.remove("is-open");
    };

    const closeX = backdrop.querySelector(".modal-close");
    if (closeX) closeX.addEventListener("click", hide);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hide();
    });
  }

  const titleEl = document.getElementById("driverHelpTitle");
  const bodyEl = document.getElementById("driverHelpBody");
  const portsEl = document.getElementById("driverHelpPorts");
  const linksTitleEl = document.getElementById("driverHelpLinksTitle");
  const linksEl = document.getElementById("driverHelpLinks");
  const hintEl = document.getElementById("driverHelpHint");

  if (titleEl) titleEl.textContent = data.title;
  if (bodyEl) bodyEl.textContent = data.body;
  if (linksTitleEl) linksTitleEl.textContent = data.linksTitle;
  if (hintEl) hintEl.textContent = data.hint;


  if (portsEl) {
    portsEl.innerHTML = "";
    data.portExamples.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p;
      portsEl.appendChild(li);
    });
  }

  if (linksEl) {
    linksEl.innerHTML = "";
    data.links.forEach((l) => {
      const a = document.createElement("a");
      a.className = "mini-btn compact driver-help-link";
      a.href = l.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = l.label;
      linksEl.appendChild(a);
    });
  }

  backdrop.hidden = false;
  backdrop.classList.add("is-open");
}

async function hardResetSerial(port) {
  if (!port || !port.setSignals) return;
  const tryOpen = async () => {
    try {
      if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
        await sleep(150);
      }
    } catch {}
  };
  // Two reset strategies because classic ESP32 DevKits (USB-UART) and native-USB
  // ESP32-S3 boards often behave differently with WebSerial signal polarity.
  //
  // Strategy A (DevKit-friendly): keep IO0 HIGH (DTR deasserted) and pulse EN via RTS.
  const pulseEnOnly = async () => {
    // release both first
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(60);
    // EN low (RTS asserted)
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(140);
    // EN high
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(180);
  };
  // Strategy B (often works well on native-USB ESP32-S3 designs with auto-reset wiring)
  // Toggle both DTR and RTS in a common sequence.
  const pulseDtrRts = async () => {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(120);
    await port.setSignals({ dataTerminalReady: true, requestToSend: false });
    await sleep(120);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(120);
  };
  await tryOpen();

  const doPulse = async () => {
    // If a board is explicitly selected, prefer a matching strategy.
    if (selectedValue === "dev") {
      await pulseEnOnly();
      return;
    }
    if (selectedValue === "v4") {
      await pulseDtrRts();
      return;
    }

    // Fallback: try both.
    try {
      await pulseEnOnly();
    } catch {
      await pulseDtrRts();
    }
  };

  try {
    await doPulse();
    return;
  } catch (err) {
    if (err && err.name === "InvalidStateError") {
      await tryOpen();
      try {
        await doPulse();
        return;
      } catch (err2) {
        console.error("Hard reset via Web Serial failed", err2);
        return;
      }
    }
    console.error("Hard reset via Web Serial failed", err);
  }
}

function applyGermanTexts() {
  const titleEl = document.getElementById("pageTitle");
  if (titleEl) titleEl.textContent = "Web Flasher";

  const step1El = document.getElementById("step1");
  const step2El = document.getElementById("step2");
  const step3El = document.getElementById("step3");
  const step4El = document.getElementById("step4");
  if (step1El) step1El.textContent = "Schließe dein Board per USB an deinen Computer an.";
  if (step2El) step2El.textContent = "Drücke den Button zum Verbinden und wähle den korrekten COM-Port aus.";
  if (step3El) {
    step3El.innerHTML = "Wähle deine Respooler-Variante im Menü aus. <a id=\"step3DriverHelpLink\" class=\"step-inline-help-link\" href=\"#\">Wird nicht <span class=\"step-inline-help-link-tail\">angezeigt<span class=\"step-inline-help-link-q\">?</span></span></a>";
  }
  if (step4El) step4El.textContent = "Installiere die Firmware über den Button.";
  const fwLabelEl = document.getElementById("fwLabel");
  if (fwLabelEl) fwLabelEl.textContent = "Aktuelle Firmware:";

  const flashBtnEl = document.getElementById("flashBtn");
  if (flashBtnEl) flashBtnEl.textContent = "Installieren";
  const connectBtnEl = document.getElementById("connectBtn");
  if (connectBtnEl) connectBtnEl.textContent = "Board verbinden";

}

function wireStep3DriverHelpLink() {
  if (typeof document === "undefined") return;
  if (document.documentElement.dataset.step3DriverHelpWired === "1") return;
  document.documentElement.dataset.step3DriverHelpWired = "1";

  document.addEventListener("click", (event) => {
    const target = event.target;
    const linkEl =
      target && typeof target.closest === "function"
        ? target.closest("#step3DriverHelpLink")
        : null;
    if (!linkEl) return;
    event.preventDefault();
    showDriverHelpPopup({ fromStepLink: true });
  });
}

if (isGermanRegion) {
  applyGermanTexts();
}
wireStep3DriverHelpLink();

const supportsWebSerial =
  typeof navigator !== "undefined" && "serial" in navigator;

const connectBtn = document.getElementById("connectBtn");
const flashBtn = document.getElementById("flashBtn");
const unsupportedEl = document.getElementById("wbUnsupported");
const progressWrapper = document.getElementById("progressWrapper");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const progressPercent = document.getElementById("progressPercent");
if (progressLabel) {
  progressLabel.textContent = !supportsWebSerial
    ?
    (isGermanRegion ? "Nicht unterstützt" : "Not supported")
    : (isGermanRegion ? "Bereit für Verbindung" : "Ready for connection");
}
if (progressPercent) {
  progressPercent.textContent = "0 %";
}

// Keep UI consistent across browsers (even if WebSerial is unsupported).
if (connectBtn) {
  connectBtn.classList.remove("hidden");
  // In case the HTML has `disabled` set by default, ensure it is clickable.
  connectBtn.disabled = false;
}
if (flashBtn) {
  flashBtn.classList.remove("hidden");
  flashBtn.disabled = true;
}
if (unsupportedEl) unsupportedEl.classList.add("hidden");
if (progressLabel) {
  progressLabel.textContent = !supportsWebSerial
    ?
    (isGermanRegion ? "Nicht unterstützt" : "Not supported")
    : (isGermanRegion ? "Bereit für Verbindung" : "Ready for connection");
}

const BIN_URLS = {
  dev: "https://respooler.lts-design.com/Firmware/ESP32-WROOM-32_latest.bin",
  v4:  "https://respooler.lts-design.com/Firmware/ControlBoard_V4_latest.bin"
};
const CHIP_FAMILY = {
  dev: "ESP32",
  v4:  "ESP32-S3"
};

let latestVersion = "0.0.0";
let selectedValue = "dev";
let selectedVariant = "v4";

const varSeg = document.getElementById("variantSegment");
const varIndicator = varSeg ? varSeg.querySelector(".seg-indicator") : null;
const varButtons = varSeg ? Array.from(varSeg.querySelectorAll("button[data-value]")) : [];

function updateVariantIndicator() {
  if (!varIndicator) return;
  const index = selectedVariant === "v4" ? 0 : 1;
  varIndicator.style.transform = `translateX(${index * 100}%)`;
}

function applyBoardSelection(val) {
  if (val !== "dev" && val !== "v4") return;
  selectedValue = val;
  try { localStorage.setItem("lts_respooler_board", selectedValue);
  } catch {}
}

try {
  const saved = localStorage.getItem("lts_respooler_variant");
  if (saved === "v4" || saved === "pro") selectedVariant = saved;
} catch {}
try {
  const savedBoard = localStorage.getItem("lts_respooler_board");
  if (savedBoard === "dev" || savedBoard === "v4") selectedValue = savedBoard;
} catch {}

varButtons.forEach(b => b.classList.toggle("is-selected", b.dataset.value === selectedVariant));
updateVariantIndicator();

varButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const val = btn.dataset.value;
    if (val && val !== selectedVariant) {
      selectedVariant = val;
      varButtons.forEach(b => b.classList.toggle("is-selected", b === btn));
      updateVariantIndicator();
      try { localStorage.setItem("lts_respooler_variant", selectedVariant); } catch {}
    }
  });
});
let serialPort = null;
let espLoader = null;
let loaderTransport = null;
let lastErrorMessage = "";
function setProgress(percent, labelText) {
  if (!progressWrapper || !progressBar || !progressLabel) return;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  progressBar.style.width = clamped + "%";
  if (progressPercent) {
    progressPercent.textContent = clamped + " %";
  }

  if (labelText != null) {
    progressLabel.textContent = labelText;
  }
}

async function sendVariantOverSerial() {
  if (!serialPort) return;

  const payload = selectedVariant === "pro"
    ?
    '{"SET":{"VAR":"PRO"}}\n'
    : '{"SET":{"VAR":"STD"}}\n';

  const start = performance.now();
  while (performance.now() - start < 5000) {
    try {
      if (serialPort.writable) break;
    } catch {}
    await sleep(100);
  }

  try {
    if (!serialPort.writable) {
      await serialPort.open({ baudRate: 115200 });
    }
  } catch (e) {
    console.error("Failed to open serial for VAR", e);
    return;
  }

  try {
    const writer = serialPort.writable.getWriter();
    const data = new TextEncoder().encode(payload);
    await writer.write(data);
    writer.releaseLock();
  } catch (e) {
    console.error("Failed to send VAR over serial", e);
  }

  await sleep(200);
}

async function ensureLoader() {
  if (espLoader) return espLoader;
  if (!serialPort) {
    throw new Error("No serial connection open");
  }

  const TransportCtor = window.ESPLoaderTransport;
  const LoaderCtor = window.ESPLoader;
  if (!TransportCtor || !LoaderCtor) {
    throw new Error("Flasher library not loaded");
  }

  const transport = new TransportCtor(serialPort);
  loaderTransport = transport;

  // FIX: Separate Baudrates
  // "v4" (S3 / Native USB) -> 921600 (High Speed)
  // "dev" (Classic ESP32) -> 115200 (Robust/Low Speed)
  const robustBaud = (selectedValue === "v4") ? 921600 : 115200;

  espLoader = new LoaderCtor({
    transport,
    baudrate: robustBaud, 
    terminal: {
      clean() {},
      write() {},
      writeLine() {},
    },
  });
  if (!espLoader.flashSize) {
    espLoader.flashSize = "4MB";
  }

  try {
    const timeoutErr = new Error("No ESP32 detected (sync timeout)");
    // UPDATED: Timeout increased to 15000ms (15s) to allow manual BOOT press
    await withTimeout(espLoader.main(), 15000, timeoutErr);
  } catch (err) {
    console.error("Failed to initialise loader", err);
    // Important on Windows: cancel any pending reads and fully release the port.
    // Otherwise the promise chain can appear to "hang" on subsequent attempts.
    try {
      if (loaderTransport && typeof loaderTransport.disconnect === "function") {
        await loaderTransport.disconnect();
      }
    } catch {}
    try {
      if (serialPort && (serialPort.readable || serialPort.writable)) {
        await serialPort.close();
      }
    } catch {}

    espLoader = null;
    loaderTransport = null;

    throw err;
  }

  let chipNameUpper = "";
  try {
    if (espLoader && espLoader.chip && espLoader.chip.CHIP_NAME) {
      chipNameUpper = String(espLoader.chip.CHIP_NAME).toUpperCase();
    } else if (espLoader && (espLoader.chipFamily || espLoader.chipName)) {
      chipNameUpper = String(
        espLoader.chipFamily || espLoader.chipName
      ).toUpperCase();
    }
  } catch (e) {
    console.warn("Chip name detection failed", e);
  }

  // Strict validation: if we can't identify an ESP chip, treat this as a wrong port selection.
  if (!chipNameUpper || !chipNameUpper.includes("ESP32")) {
    throw new Error("No ESP32 detected (invalid chip)");
  }

  const isPlainEsp32 =
    chipNameUpper === "ESP32" ||
    (chipNameUpper.includes("ESP32") &&
      !chipNameUpper.includes("S2") &&
      !chipNameUpper.includes("S3") &&
      !chipNameUpper.includes("C3"));
  console.log("LTS Web Flasher – simple chip check", {
    selectedValue,
    chipNameUpper,
    isPlainEsp32,
  });
  const autoSelected = isPlainEsp32 ? "dev" : "v4";
  if (autoSelected !== selectedValue) {
    applyBoardSelection(autoSelected);
  }

  return espLoader;
}

async function handleConnectClick() {
  if (!supportsWebSerial || !navigator.serial || typeof navigator.serial.requestPort !== "function") {
    const msg = isGermanRegion
      ?
      "WebSerial wird nicht unterstützt."
      : "WebSerial is not supported.";
    try { alert(msg);
    } catch {}
    setProgress(0, isGermanRegion ? "Nicht unterstützt" : "Not supported");
    return;
  }

  // If we have a stale port reference, try to close it first.
  if (serialPort) {
    try {
      if (serialPort.readable || serialPort.writable) {
        await serialPort.close();
      }
    } catch {}
  }

  try {
    setProgress(0, isGermanRegion ? "Wähle einen seriellen Port" : "Please choose a serial port");
    const port = await navigator.serial.requestPort();
    serialPort = port;

    // Windows/Chrome can hang indefinitely when esptool-js tries to sync on a completely wrong COM port.
    // If VID is available and clearly not ESP-related, abort early and let the existing driver-help popup handle it.
    if (!portLooksLikeEsp32Device(port)) {
      // Keep this message in English so it reliably matches DRIVER_HELP_TRIGGERS.
      throw new Error("No ESP32 detected");
    }

    if (connectBtn) connectBtn.disabled = true;
    // Strict check: only succeed if we can sync and identify an ESP32-family chip.
    setProgress(0, isGermanRegion ? "Ermittle Board…" : "Detecting board…");
    
    // UPDATED: Main timeout logic is now handled inside ensureLoader (15s)
    await ensureLoader();
    // Keep the transport + port OPEN here.
    // Closing the port between “Connect” and “Install” can toggle DTR/RTS and reset the board,
    // causing the subsequent flash sync to fail (especially on ESP32-S3 / some host setups).
    if (flashBtn) flashBtn.disabled = false;
    const detectedBoardLabel = (selectedValue === "v4") ? "Control Board" : "ESP32 DevKit";
    setProgress(0,
      isGermanRegion
        ? `Erfolgreich verbunden! (${detectedBoardLabel})`
        : `Connected successfully! (${detectedBoardLabel})`
    );
  } catch (err) {
    console.error(err);

    // Ensure we never leave the UI in a false-connected state.
    try {
      if (loaderTransport && typeof loaderTransport.disconnect === "function") {
        await loaderTransport.disconnect();
      }
    } catch {}
    loaderTransport = null;
    espLoader = null;
    try {
      if (serialPort && (serialPort.readable || serialPort.writable)) {
        await serialPort.close();
      }
    } catch {}

    const detailsText = err && err.message ? err.message : String(err);
    const genericText = isGermanRegion ? "Verbindung fehlgeschlagen!" : "Connection failed!";
    lastErrorMessage = detailsText;

    const isDriverHelpCase = isLikelyDriverOrPortIssueMessage(detailsText);
    // Auto-open only once per tab/session.
    if (isDriverHelpCase && !hasShownDriverHelpThisSession()) {
      markDriverHelpShownThisSession();
      try { showDriverHelpPopup();
      } catch {}
    }

    setProgress(0, genericText);
    if (progressLabel) {
      const linkLabel = isGermanRegion ? "Mehr" : "More";
      progressLabel.innerHTML = genericText + ' <a href="#" id="connectErrorMoreLink">' + linkLabel + '</a>';

      const moreLink = document.getElementById("connectErrorMoreLink");
      if (moreLink) {
        moreLink.addEventListener("click", function (e) {
          e.preventDefault();
          if (isDriverHelpCase) {
            try { showDriverHelpPopup(); } catch {}
          } else {
            // Keep legacy behavior for non-detection errors.
            alert(lastErrorMessage || detailsText);
    
          }
        });
      }
    }

    // Force the user to pick a port again.
    serialPort = null;
    if (connectBtn) connectBtn.disabled = false;
    if (flashBtn) flashBtn.disabled = true;
  }
}

async function handleFlashClick() {
  if (!supportsWebSerial || !navigator.serial || typeof navigator.serial.requestPort !== "function") {
    setProgress(0, isGermanRegion ? "Nicht unterstützt" : "Not supported");
    return;
  }
  if (!serialPort) {
    if (flashBtn) {
      flashBtn.disabled = true;
    }
    setProgress(
      0,
      isGermanRegion
        ? "Bitte zuerst das Board verbinden"
        : "Please connect the board first"
    );
    return;
  }
  if (!flashBtn) return;

  flashBtn.disabled = true;
  setProgress(0, isGermanRegion ? "Wird initialisiert, bitte warten..." : "Initializing, please wait...");
  if (progressBar) {
    progressBar.style.background = "#0E7AFE";
  }
  if (varSeg) {
    varSeg.classList.add("is-disabled");
  }

  try {
    const loader = await ensureLoader();
    const url = BIN_URLS[selectedValue] || BIN_URLS.dev;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Failed to download firmware: " + res.status);
    }

    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const dataStr = loader.ui8ToBstr(u8);
    await loader.writeFlash({
      fileArray: [{ address: 0x0, data: dataStr }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "4MB",
      eraseAll: false,
      compress: true,
      reportProgress(fileIndex, written, total) {
        const pct = total > 0 ? Math.round((written / total) * 100) : 0;
        const msg = isGermanRegion
          ? 
          "Firmware wird installiert..."
          : "Flashing firmware...";
        setProgress(pct, msg);
      }
    });
    try {
      if (loaderTransport && typeof loaderTransport.disconnect === "function") {
        await loaderTransport.disconnect();
      }
    } catch (e) {
      console.error("Failed to disconnect transport", e);
    }
    espLoader = null;
    loaderTransport = null;

    await sleep(500);
    setProgress(100, isGermanRegion ? "Konfiguration wird übertragen…" : "Applying configuration…");

    await hardResetSerial(serialPort);
    await sleep(500);
    await sendVariantOverSerial();
    await sleep(150);
    await hardResetSerial(serialPort);
    setProgress(100, isGermanRegion ? "Erfolgreich installiert!" : "Flashed successfully!");
    if (progressBar) {
      progressBar.style.background = "rgb(52,199,89)";
    }

    setTimeout(() => {
      if (progressBar) {
        progressBar.style.width = "0%";
        progressBar.style.background = "#0E7AFE";
      }
      if (progressPercent) {
        progressPercent.textContent = "0 %";
      }
      if (progressLabel) {
        progressLabel.textContent = (isGermanRegion ? "Bereit für Verbindung" : "Ready for connection");
      }
   
    }, 5000);
  } catch (err) {
    console.error(err);
    const detailsText = err && err.message ?
    err.message : String(err);

    let genericText;
    if (detailsText.includes(isGermanRegion ? "Download fehlgeschlagen" : "Failed to download firmware")) {
      genericText = isGermanRegion
        ?
        "Download fehlgeschlagen!"
        : "Failed to download firmware!";
    } else {
      genericText = isGermanRegion ?
      "Fehler beim Flashen!" : "Flash failed!";
    }

    lastErrorMessage = detailsText;

    const isDriverHelpCase = isLikelyDriverOrPortIssueMessage(detailsText);
    // Auto-open only once per tab/session.
    if (isDriverHelpCase && !hasShownDriverHelpThisSession()) {
      markDriverHelpShownThisSession();
      try { showDriverHelpPopup();
      } catch {}
    }

    setProgress(0, genericText);
    if (progressLabel) {
      const linkLabel = isGermanRegion ? "Mehr" : "More";
      progressLabel.innerHTML = genericText + ' <a href="#" id="flashErrorMoreLink">' + linkLabel + '</a>';

      const moreLink = document.getElementById("flashErrorMoreLink");
      if (moreLink) {
        moreLink.addEventListener("click", function (e) {
          e.preventDefault();
          if (isDriverHelpCase) {
            try { showDriverHelpPopup(); } catch {}
          } else {
            // Keep legacy behavior for non-detection errors.
            alert(lastErrorMessage || detailsText);
    
          }
        });
      }
    }
  } finally {
    try {
      if (loaderTransport && typeof loaderTransport.disconnect === "function") {
        await loaderTransport.disconnect();
      } else if (serialPort) {
        await serialPort.close();
      }
    } catch (closeErr) {
      console.error("Failed to close serial port or transport", closeErr);
    }
    serialPort = null;
    espLoader = null;
    loaderTransport = null;
    if (connectBtn) {
      connectBtn.textContent = isGermanRegion ? "Board verbinden" : "Connect Board";
      connectBtn.disabled = false;
    }
    if (flashBtn) {
      flashBtn.disabled = true;
    }
    if (varSeg) {
      varSeg.classList.remove("is-disabled");
    }
  }
}

if (connectBtn) {
  connectBtn.addEventListener("click", () => {
    handleConnectClick();
  });
}

if (flashBtn) {
  flashBtn.addEventListener("click", () => {
    handleFlashClick();
  });
}

async function loadFirmwareVersion() {
  const el = document.getElementById("fwVersionValue");
  try {
    const res = await fetch(
      "https://respooler.lts-design.com/Firmware/latest_board_firmware.txt",
      { cache: "no-store" }
    );
    const txt = (await res.text()).trim().split(/\s+/)[0];
    latestVersion = txt;
    if (el) el.textContent = txt;
  } catch {
    latestVersion = "0.0.0";
    if (el) el.textContent = "0.0.0";
  }
}

loadFirmwareVersion();
