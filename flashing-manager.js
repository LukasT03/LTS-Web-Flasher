import * as esptoolBundle from "https://unpkg.com/esptool-js@0.5.6/bundle.js";

window.ESPLoader = esptoolBundle.ESPLoader;
window.ESPLoaderTransport = esptoolBundle.Transport;
window.ESPHardReset = esptoolBundle.hardReset || null;


const userLang = navigator.language || navigator.userLanguage || "";
const langCandidates = (navigator.languages && navigator.languages.length)
  ? navigator.languages
  : [userLang];
const isGermanRegion = langCandidates.some(l => /^de(-|$)/i.test(l));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hardResetSerial(port) {
  if (!port || !port.setSignals) return;

  const pulse = async () => {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(120);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(120);
  };

  const tryOpen = async () => {
    try {
      if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
        await sleep(150);
      }
    } catch {}
  };

  await tryOpen();

  try {
    await pulse();
    return;
  } catch (err) {
    if (err && err.name === "InvalidStateError") {
      await tryOpen();
      try {
        await pulse();
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

  const unsupportedEl = document.getElementById("wbUnsupported");
  if (unsupportedEl) {
    unsupportedEl.innerHTML =
      "WebSerial wird in diesem Browser nicht unterstützt. Bitte verwende Chrome oder Edge auf einem Desktop-Computer.";
  }
}

if (isGermanRegion) {
  applyGermanTexts();
}

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
  progressLabel.textContent = isGermanRegion ? "Bereit für Verbindung" : "Ready for connection";
}
if (progressPercent) {
  progressPercent.textContent = "0 %";
}

if (!supportsWebSerial) {
  document.body.classList.add("no-webserial");
  if (connectBtn) connectBtn.classList.add("hidden");
  if (flashBtn) {
    flashBtn.classList.remove("hidden");
    flashBtn.disabled = true;
  }
  if (unsupportedEl) unsupportedEl.classList.remove("hidden");

  const ua = navigator.userAgent;
  const isSafari = ua.includes("Safari") && !ua.includes("Chrome") && !ua.includes("Chromium");
  const isDesktopSafari = isSafari && window.innerWidth > 1024;
  if (unsupportedEl && isDesktopSafari) {
    unsupportedEl.innerHTML +=
      isGermanRegion
        ? '<br><br>Du nutzt macOS? Lade das LTS Utility Programm <a href="https://download.lts-design.com/Apps/LTS-Utility.zip" target="_blank">hier</a> herunter.'
        : '<br><br>Using a Mac? Download the LTS Utility program <a href="https://download.lts-design.com/Apps/LTS-Utility.zip" target="_blank">here</a>.';
  }

  if (progressLabel) {
    progressLabel.textContent = isGermanRegion
      ? "Nicht unterstützt"
      : "Not supported";
  }
} else {
  if (connectBtn) connectBtn.classList.remove("hidden");
  if (flashBtn) {
    flashBtn.classList.remove("hidden");
    flashBtn.disabled = true;
  }
  if (unsupportedEl) unsupportedEl.classList.add("hidden");

  if (progressLabel) {
    progressLabel.textContent = isGermanRegion
      ? "Bereit für Verbindung"
      : "Ready for connection";
  }
}

const BIN_URLS = {
  dev: "https://download.lts-design.com/Firmware/ESP32-WROOM-32_latest.bin",
  v4:  "https://download.lts-design.com/Firmware/ControlBoard_V4_latest.bin"
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
    throw new Error(
      isGermanRegion
        ? "Keine serielle Verbindung offen"
        : "No serial connection open"
    );
  }

  const TransportCtor = window.ESPLoaderTransport;
  const LoaderCtor = window.ESPLoader;

  if (!TransportCtor || !LoaderCtor) {
    throw new Error(
      isGermanRegion
        ? "Flasher-Bibliothek nicht geladen"
        : "Flasher library not loaded"
    );
  }

  const transport = new TransportCtor(serialPort);
  loaderTransport = transport;
  espLoader = new LoaderCtor({
    transport,
    baudrate: 921600,
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
    await espLoader.main();
  } catch (err) {
    console.error("Failed to initialise loader", err);
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
  if (!supportsWebSerial) return;
  try {
    setProgress(0, isGermanRegion ? "Wähle einen seriellen Port" : "Please choose a serial port");
    const port = await navigator.serial.requestPort();
    serialPort = port;

    if (connectBtn) {
      connectBtn.disabled = true;
    }

    try {
      setProgress(0, isGermanRegion ? "Ermittle Board…" : "Detecting board…");
      await ensureLoader();
    } catch (e) {
      console.error(e);
    } finally {
      espLoader = null;
      try {
        if (loaderTransport && typeof loaderTransport.disconnect === "function") {
          await loaderTransport.disconnect();
        }
      } catch {}
      loaderTransport = null;
    }

    if (flashBtn) {
      flashBtn.disabled = false;
    }

    const detectedBoardLabel = (selectedValue === "v4") ? "Control Board" : "ESP32 DevKit";
    setProgress(0, isGermanRegion
      ? `Erfolgreich verbunden! (${detectedBoardLabel})`
      : `Connected successfully! (${detectedBoardLabel})`);
  } catch (err) {
    console.error(err);
    const detailsText = err && err.message ? err.message : String(err);
    const genericText = isGermanRegion ? "Fehler beim Verbinden!" : "Failed to connect!";
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
  }
}

async function handleFlashClick() {
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
        const msg = isGermanRegion
          ? "Firmware wird installiert..."
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
    const detailsText = err && err.message ? err.message : String(err);

    let genericText;
    if (detailsText.includes(isGermanRegion ? "Download fehlgeschlagen" : "Failed to download firmware")) {
      genericText = isGermanRegion
        ? "Download fehlgeschlagen!"
        : "Failed to download firmware!";
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
      "https://download.lts-design.com/Firmware/latest_board_firmware.txt",
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