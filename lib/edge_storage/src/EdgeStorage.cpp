#include "EdgeStorage.h"
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include "pins.h"
#include "EdgeNetwork.h"

namespace edge {

static SPIClass s_spiSD(VSPI);
static bool     s_sdOk = false;

static const char* AUDIT_DIR = "/audit";
static const char* CSV_HEADER = "utc,uptime_ms,source,type,detail\n";

static bool crearDirSiNoExiste() {
    if (!SD.exists(AUDIT_DIR)) {
        return SD.mkdir(AUDIT_DIR);
    }
    return true;
}

bool initStorage() {
    s_spiSD.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_SPI_CS);
    if (!SD.begin(PIN_SPI_CS, s_spiSD)) {
        Serial.println("[sd] microSD no presente, eventos solo en RAM");
        s_sdOk = false;
        return false;
    }
    if (!crearDirSiNoExiste()) {
        Serial.println("[sd] FALLO: no pudo crear /audit");
        s_sdOk = false;
        return false;
    }
    s_sdOk = true;
    Serial.println("[sd] microSD lista");
    return true;
}

bool sdDisponible() {
    return s_sdOk;
}

bool appendAuditLine(const char* linea) {
    if (!s_sdOk) return false;

    char path[40];
    time_t t = ahoraUTC();
    if (t > 0) {
        struct tm tm_info;
        gmtime_r(&t, &tm_info);
        snprintf(path, sizeof(path), "%s/%04d-%02d-%02d.csv",
                 AUDIT_DIR,
                 tm_info.tm_year + 1900,
                 tm_info.tm_mon + 1,
                 tm_info.tm_mday);
    } else {
        snprintf(path, sizeof(path), "%s/unsynced.csv", AUDIT_DIR);
    }

    bool archivoNuevo = !SD.exists(path);
    File f = SD.open(path, FILE_APPEND);
    if (!f) return false;

    if (archivoNuevo) f.print(CSV_HEADER);
    f.print(linea);
    f.close();
    return true;
}

size_t listarArchivosAudit(void (*cb)(const char* nombre, size_t bytes)) {
    if (!s_sdOk || cb == nullptr) return 0;

    File dir = SD.open(AUDIT_DIR);
    if (!dir) return 0;

    size_t count = 0;
    File entry = dir.openNextFile();
    while (entry) {
        if (!entry.isDirectory()) {
            cb(entry.name(), (size_t)entry.size());
            count++;
        }
        entry.close();
        entry = dir.openNextFile();
    }
    dir.close();
    return count;
}

}  // namespace edge
