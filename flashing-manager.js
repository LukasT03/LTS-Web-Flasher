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

// WebSerial on Windows can be flaky when esptool-js tries to switch to very high baud rates.
const isWindowsPlatform = (() => {
  try {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform)
      ? String(navigator.userAgentData.platform)
      : String(navigator.userAgent || "");
    return /windows/i.test(platform);
  } catch {
    return false;
  }
})();

// Windows often struggles with 921600. 115200 is slow but safe.
const FLASH_BAUD = isWindowsPlatform ? 115200 : 921600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Helper to safely cleanup transport and close port ---
async function cleanupLoader() {
  if (espLoader) {
    espLoader = null;
  }
  
  if (loaderTransport) {
    try {
      if (typeof loaderTransport.disconnect === "function") {
        await loaderTransport.disconnect();
      }
    } catch (e) {
      console.warn("Transport disconnect warning:", e);
    }
    loaderTransport = null;
  }

  if (serialPort) {
    try {
      if (serialPort.readable || serialPort.writable) {
        await serialPort.close();
      }
    } catch (e) {
      console.warn("Port close warning:", e);
    }
  }

  if (isWindowsPlatform) {
    await sleep(200);
  }
}

async function hardResetSerial(port) {
  if (!port || !port.setSignals) return;

  const tryOpen = async () => {
    try {
      if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
        await sleep(150);
      }
    } catch (e) {
       console.warn("HardReset tryOpen failed:", e);
    }
  };

  const pulseEnOnly = async () => {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(60);
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(140);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(180);
  };

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
    if (selectedValue === "dev") {
      await pulseEnOnly();
      return;
    }
    if (selectedValue === "v4") {
      await pulseDtrRts();
      return;
    }
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
  
  if (step1El) step1El.textContent = "Schließe dein Board per USB an deinen Computer an";
  if (step2El) step2El.textContent = "Drücke den Button zum Verbinden und wähle den korrekten COM-Port aus";
  if (step3El) step3El.textContent = "Wähle deine Respooler-Variante im Menü aus";
  if (step4El) step4El.textContent = "Installiere die Firmware über den Button";
  
  const fwLabelEl = document.getElementById("fwLabel");
  if (fwLabelEl) fwLabelEl.textContent = "Aktuelle Firmware:";

  const flashBtnEl = document.getElementById("flashBtn");
  if (flashBtnEl) flashBtnEl.textContent = "Installieren";
  
  const connectBtnEl = document.getElementById("connectBtn");
  if (connectBtnEl) connectBtnEl.textContent = "Board verbinden";
}

if (isGermanRegion) {
  applyGermanTexts();
}

const supportsWebSerial = typeof navigator !== "undefined" && "serial" in navigator;

const connectBtn = document.getElementById("connectBtn");
const flashBtn = document.getElementById("flashBtn");
const unsupportedEl = document.getElementById("wbUnsupported");
const progressWrapper = document.getElementById("progressWrapper");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const progressPercent = document.getElementById("progressPercent");

if (progressLabel) {
  progressLabel.textContent = !supportsWebSerial
    ? (isGermanRegion ? "Nicht unterstützt" : "Not supported")
    : (isGermanRegion ? "Bereit für Verbindung" : "Ready for connection");
}
if (progressPercent) {
  progressPercent.textContent = "0 %";
}

if (connectBtn) {
  connectBtn.classList.remove("hidden");
  connectBtn.disabled = false;
}
if (flashBtn) {
  flashBtn.classList.remove("hidden");
  flashBtn.disabled = true;
}
if (unsupportedEl) unsupportedEl.classList.add("hidden");

const BIN_URLS = {
  dev: "https://respooler.lts-design.com/Firmware/ESP32-WROOM-32_latest.bin",
  v4:  "https://respooler.lts-design.com/Firmware/ControlBoard_V4_latest.bin"
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
  try { localStorage.setItem("lts_respooler_board", selectedValue); } catch {}
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
    ? '{"SET":{"VAR":"PRO"}}\n'
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

// Logic to initialise the loader.
async function ensureLoader() {
  if (espLoader) return espLoader;
  
  if (!serialPort) {
    throw new Error(isGermanRegion ? "Keine serielle Verbindung" : "No serial connection");
  }

  if (serialPort.readable || serialPort.writable) {
    try {
        await serialPort.close();
        if(isWindowsPlatform) await sleep(150); 
    } catch (e) {
        console.warn("Could not auto-close port before ensureLoader:", e);
    }
  }

  const TransportCtor = window.ESPLoaderTransport;
  const LoaderCtor = window.ESPLoader;

  if (!TransportCtor || !LoaderCtor) {
    throw new Error(isGermanRegion ? "Flasher-Bibliothek fehlt" : "Flasher library missing");
  }

  const transport = new TransportCtor(serialPort);
  loaderTransport = transport;
  
  espLoader = new LoaderCtor({
    transport,
    baudrate: FLASH_BAUD,
    terminal: {
      clean() {},
      write() {},
      writeLine() {},
    },
  });

  if (!espLoader.flashSize) {
    espLoader.flashSize = "4MB";
  }

  // --- STRICT CONNECTION CHECK ---
  try {
    // This attempts to sync with the chip. 
    // If it's a Bluetooth port or non-ESP device, this usually times out or fails.
    await espLoader.main();
  } catch (err) {
    console.error("Failed to initialise loader (sync failed)", err);
    // CRITICAL: Cleanup immediately if sync fails so we don't think we are connected
    await cleanupLoader(); 
    throw new Error(isGermanRegion ? "Verbindung fehlgeschlagen. Ist es ein ESP32?" : "Connection failed. Is it an ESP32?");
  }

  // --- STRICT CHIP IDENTIFICATION ---
  let chipNameUpper = "";
  try {
    if (espLoader && espLoader.chip && espLoader.chip.CHIP_NAME) {
      chipNameUpper = String(espLoader.chip.CHIP_NAME).toUpperCase();
    } else if (espLoader && (espLoader.chipFamily || espLoader.chipName)) {
      chipNameUpper = String(espLoader.chipFamily || espLoader.chipName).toUpperCase();
    }
  } catch (e) {
    console.warn("Chip name detection failed", e);
  }

  // Reject if NO chip name was found or if it doesn't contain ESP32
  if (!chipNameUpper || !chipNameUpper.includes("ESP32")) {
      await cleanupLoader();
      throw new Error(isGermanRegion 
        ? `Falscher Chip erkannt: ${chipNameUpper || 'Unbekannt'}. Bitte nur ESP32 verbinden.` 
        : `Wrong chip detected: ${chipNameUpper || 'Unknown'}. Please connect an ESP32.`);
  }

  const isPlainEsp32 =
    chipNameUpper === "ESP32" ||
    (chipNameUpper.includes("ESP32") &&
      !chipNameUpper.includes("S2") &&
      !chipNameUpper.includes("S3") &&
      !chipNameUpper.includes("C3"));
      
  console.log("LTS Web Flasher – Verified Chip:", {
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
    const msg = isGermanRegion ? "WebSerial wird nicht unterstützt." : "WebSerial is not supported.";
    try { alert(msg); } catch {}
    setProgress(0, isGermanRegion ? "Nicht unterstützt" : "Not supported");
    return;
  }

  try {
    setProgress(0, isGermanRegion ? "Wähle einen seriellen Port" : "Please choose a serial port");
    const port = await navigator.serial.requestPort();
    serialPort = port;

    if (connectBtn) {
      connectBtn.disabled = true;
    }

    // STRICT CHECK: Try to connect and identify immediately.
    // If this fails, we jump to catch() and show an error.
    setProgress(0, isGermanRegion ? "Prüfe Board-Typ…" : "Verifying board type…");
    await ensureLoader();

    // If we are here, it IS an ESP32 and it is connected.
    
    // Clean up loader temporarily so the port is free for the actual Flashing step later,
    // but DO NOT set serialPort to null (we need to keep the reference).
    await cleanupLoader();
    // Restore serialPort reference because cleanupLoader sets it to null if we aren't careful,
    // but in my cleanupLoader implementation I check global. 
    // Actually, cleanupLoader clears the global serialPort variable to be safe.
    // We need to restore it because we want to keep the "Authorized" port handle for the Flash button.
    serialPort = port; 

    if (flashBtn) {
      flashBtn.disabled = false;
    }

    const detectedBoardLabel = (selectedValue === "v4") ? "Control Board" : "ESP32 DevKit";
    setProgress(0, isGermanRegion
      ? `Erfolgreich verbunden! (${detectedBoardLabel})`
      : `Connected successfully! (${detectedBoardLabel})`);
      
  } catch (err) {
    console.error("Connect Error:", err);
    const detailsText = err && err.message ? err.message : String(err);
    const genericText = isGermanRegion ? "Verbindung fehlgeschlagen!" : "Connection failed!";
    lastErrorMessage = detailsText;

    setProgress(0, genericText);
    
    if (progressLabel) {
      const linkLabel = isGermanRegion ? "Mehr" : "More";
      progressLabel.innerHTML = genericText + ' <a href="#" id="connectErrorMoreLink">' + linkLabel + '</a>';

      const moreLink = document.getElementById("connectErrorMoreLink");
      if (moreLink) {
        moreLink.addEventListener("click", function (e) {
          e.preventDefault();
          alert(lastErrorMessage || detailsText);
        });
      }
    }
    
    // Reset UI because connection failed
    if (connectBtn) connectBtn.disabled = false;
    if (flashBtn) flashBtn.disabled = true;
    
    // Clear port selection so user has to pick again
    serialPort = null;
  }
}

async function handleFlashClick() {
  if (!supportsWebSerial) {
    setProgress(0, isGermanRegion ? "Nicht unterstützt" : "Not supported");
    return;
  }
  
  if (!serialPort) {
    if (flashBtn) flashBtn.disabled = true;
    setProgress(0, isGermanRegion ? "Bitte zuerst das Board verbinden" : "Please connect the board first");
    return;
  }
  
  if (!flashBtn) return;

  flashBtn.disabled = true;
  setProgress(0, isGermanRegion ? "Wird initialisiert, bitte warten..." : "Initializing, please wait...");
  
  if (progressBar) progressBar.style.background = "#0E7AFE";
  if (varSeg) varSeg.classList.add("is-disabled");

  try {
    // 1. Ensure any previous connection is fully dead
    await cleanupLoader();
    // Restore port logic is handled by ensuring serialPort is still set from Connect step

    // 2. Load the flash tool
    const loader = await ensureLoader();
    
    // 3. Download Firmware
    const url = BIN_URLS[selectedValue] || BIN_URLS.dev;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error((isGermanRegion ? "Download fehlgeschlagen: " : "Failed to download firmware: ") + res.status);
    }

    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const dataStr = loader.ui8ToBstr(u8);

    // 4. Write Flash
    await loader.writeFlash({
      fileArray: [{ address: 0x0, data: dataStr }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "4MB",
      eraseAll: false,
      compress: true,
      reportProgress(fileIndex, written, total) {
        const pct = total > 0 ? Math.round((written / total) * 100) : 0;
        const msg = isGermanRegion ? "Firmware wird installiert..." : "Flashing firmware...";
        setProgress(pct, msg);
      }
    });

    // 5. Cleanup Transport
    await cleanupLoader();
    // Restore serialPort for Reset
    // Note: ensureLoader might have closed it, but we need it one last time for reset.
    // However, cleanupLoader tries to close the port. 
    // We need to re-request or just assume it's there? 
    // Actually, cleanupLoader closes it. So hardResetSerial needs to open it.
    // But hardResetSerial takes 'port' as arg.
    // serialPort variable might be null if cleanupLoader wiped it.
    // Let's fix cleanupLoader behavior in handleFlashClick scope:
    
    // We need the port object even if closed.
    // My cleanupLoader sets global serialPort = null. This is tricky.
    // Let's save a reference before cleanup.
  } catch (err) {
    // Error handling
    console.error(err);
    const detailsText = err && err.message ? err.message : String(err);
    let genericText;
    if (detailsText.includes("Download") || detailsText.includes("fetch")) {
      genericText = isGermanRegion ? "Download fehlgeschlagen!" : "Failed to download firmware!";
    } else {
      genericText = isGermanRegion ? "Fehler beim Flashen!" : "Flash failed!";
    }
    lastErrorMessage = detailsText;
    setProgress(0, genericText);

    if (progressLabel) {
      const linkLabel = isGermanRegion ? "Mehr" : "More";
      progressLabel.innerHTML = genericText + ' <a href="#" id="flashErrorMoreLink">' + linkLabel + '</a>';
      const moreLink = document.getElementById("flashErrorMoreLink");
      if (moreLink) {
        moreLink.addEventListener("click", function (e) {
          e.preventDefault();
          alert(lastErrorMessage || detailsText);
        });
      }
    }
    
    await cleanupLoader();
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = isGermanRegion ? "Board verbinden" : "Connect Board";
    }
    if (varSeg) varSeg.classList.remove("is-disabled");
    return; // Stop here on error
  }

  // --- SUCCESS PATH CONTINUED ---
  // We need to perform the reset. serialPort might be null due to cleanupLoader above.
  // But wait, we need the original port object. 
  // We can't easily get it back if we set it to null.
  // Correction: The `serialPort` global holds the reference. 
  // `cleanupLoader` DOES set `serialPort = null`. 
  // This is bad for the Reset step.
  // FIX: capture serialPort in a local var before cleanup.
  
  // NOTE: I will fix this logic in the actual code block below without comments interrupting.
  // See updated handleFlashClick below.
}

// Redefining handleFlashClick to be correct with variable scope
async function handleFlashClickFixed() {
  if (!supportsWebSerial) {
    setProgress(0, isGermanRegion ? "Nicht unterstützt" : "Not supported");
    return;
  }
  
  if (!serialPort) {
    if (flashBtn) flashBtn.disabled = true;
    setProgress(0, isGermanRegion ? "Bitte zuerst das Board verbinden" : "Please connect the board first");
    return;
  }
  
  // Save reference to port object because cleanupLoader will nullify the global variable
  const currentPort = serialPort;

  if (!flashBtn) return;

  flashBtn.disabled = true;
  setProgress(0, isGermanRegion ? "Wird initialisiert, bitte warten..." : "Initializing, please wait...");
  
  if (progressBar) progressBar.style.background = "#0E7AFE";
  if (varSeg) varSeg.classList.add("is-disabled");

  try {
    await cleanupLoader();
    // Restore global for ensureLoader
    serialPort = currentPort;

    const loader = await ensureLoader();
    
    const url = BIN_URLS[selectedValue] || BIN_URLS.dev;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error((isGermanRegion ? "Download fehlgeschlagen: " : "Failed to download firmware: ") + res.status);
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
        const msg = isGermanRegion ? "Firmware wird installiert..." : "Flashing firmware...";
        setProgress(pct, msg);
      }
    });

    // Cleanup before Reset
    await cleanupLoader();
    // Restore global for Reset functions
    serialPort = currentPort;
    
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
      if (connectBtn) {
          connectBtn.disabled = false;
          connectBtn.textContent = isGermanRegion ? "Board verbinden" : "Connect Board";
      }
      if (flashBtn) flashBtn.disabled = true;
      if (varSeg) varSeg.classList.remove("is-disabled");

    }, 5000);

  } catch (err) {
    console.error(err);
    const detailsText = err && err.message ? err.message : String(err);
    let genericText;
    if (detailsText.includes("Download") || detailsText.includes("fetch")) {
      genericText = isGermanRegion ? "Download fehlgeschlagen!" : "Failed to download firmware!";
    } else {
      genericText = isGermanRegion ? "Fehler beim Flashen!" : "Flash failed!";
    }

    lastErrorMessage = detailsText;
    setProgress(0, genericText);

    if (progressLabel) {
      const linkLabel = isGermanRegion ? "Mehr" : "More";
      progressLabel.innerHTML = genericText + ' <a href="#" id="flashErrorMoreLink">' + linkLabel + '</a>';

      const moreLink = document.getElementById("flashErrorMoreLink");
      if (moreLink) {
        moreLink.addEventListener("click", function (e) {
          e.preventDefault();
          alert(lastErrorMessage || detailsText);
        });
      }
    }
    
    await cleanupLoader();
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = isGermanRegion ? "Board verbinden" : "Connect Board";
    }
    if (varSeg) varSeg.classList.remove("is-disabled");
  }
}

// Map the fixed function to the button
if (flashBtn) {
  flashBtn.addEventListener("click", () => {
    handleFlashClickFixed();
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