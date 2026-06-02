#include "EdgeStorage.h"
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "pins.h"
#include "EdgeNetwork.h"

namespace edge {

static SPIClass         s_spiSD(VSPI);
static bool             s_sdOk    = false;
static SemaphoreHandle_t s_sdMutex = nullptr;

static const char* AUDIT_DIR  = "/audit";
static const char* CSV_HEADER = "utc,uptime_ms,source,type,detail\n";
static const uint32_t SD_MUTEX_TIMEOUT_MS = 2000;

static bool crearDirSiNoExiste() {
    if (!SD.exists(AUDIT_DIR)) {
        return SD.mkdir(AUDIT_DIR);
    }
    return true;
}

bool initStorage() {
    s_sdMutex = xSemaphoreCreateMutex();
    if (s_sdMutex == nullptr) {
        Serial.println("[sd] FALLO: no pudo crear mutex SD");
        return false;
    }

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

// Calcula la ruta del archivo del dia (UTC) o unsynced.csv si no hay hora.
static void rutaArchivoDelDia(char* path, size_t len) {
    time_t t = ahoraUTC();
    if (t > 0) {
        struct tm tm_info;
        gmtime_r(&t, &tm_info);
        snprintf(path, len, "%s/%04d-%02d-%02d.csv",
                 AUDIT_DIR,
                 tm_info.tm_year + 1900,
                 tm_info.tm_mon + 1,
                 tm_info.tm_mday);
    } else {
        snprintf(path, len, "%s/unsynced.csv", AUDIT_DIR);
    }
}

// Devuelve el basename (lo que sigue al ultimo '/'). Segun la version del core,
// File::name() puede devolver la ruta completa "/audit/x.csv" en vez de "x.csv".
static const char* basename(const char* ruta) {
    const char* ultimo = strrchr(ruta, '/');
    return ultimo ? (ultimo + 1) : ruta;
}

bool appendAuditBatch(const char* const* lineas, size_t count) {
    if (!s_sdOk || lineas == nullptr || count == 0) return false;
    if (xSemaphoreTake(s_sdMutex, pdMS_TO_TICKS(SD_MUTEX_TIMEOUT_MS)) != pdTRUE) {
        return false;
    }

    char path[40];
    rutaArchivoDelDia(path, sizeof(path));
    bool archivoNuevo = !SD.exists(path);

    File f = SD.open(path, FILE_APPEND);
    if (!f) {
        xSemaphoreGive(s_sdMutex);
        return false;
    }
    if (archivoNuevo) f.print(CSV_HEADER);
    for (size_t i = 0; i < count; i++) f.print(lineas[i]);
    f.close();

    xSemaphoreGive(s_sdMutex);
    return true;
}

bool appendAuditLine(const char* linea) {
    return appendAuditBatch(&linea, 1);
}

size_t listarArchivosAudit(void (*cb)(const char* nombre, size_t bytes)) {
    if (!s_sdOk || cb == nullptr) return 0;
    if (xSemaphoreTake(s_sdMutex, pdMS_TO_TICKS(SD_MUTEX_TIMEOUT_MS)) != pdTRUE) {
        return 0;
    }

    File dir = SD.open(AUDIT_DIR);
    if (!dir) {
        xSemaphoreGive(s_sdMutex);
        return 0;
    }

    size_t count = 0;
    File entry = dir.openNextFile();
    while (entry) {
        if (!entry.isDirectory()) {
            cb(basename(entry.name()), (size_t)entry.size());
            count++;
        }
        entry.close();
        entry = dir.openNextFile();
    }
    dir.close();

    xSemaphoreGive(s_sdMutex);
    return count;
}

bool auditExists(const char* nombre) {
    if (!s_sdOk || nombre == nullptr) return false;
    if (xSemaphoreTake(s_sdMutex, pdMS_TO_TICKS(SD_MUTEX_TIMEOUT_MS)) != pdTRUE) {
        return false;
    }
    char path[40];
    snprintf(path, sizeof(path), "%s/%s", AUDIT_DIR, nombre);
    bool existe = SD.exists(path);
    xSemaphoreGive(s_sdMutex);
    return existe;
}

}  // namespace edge
