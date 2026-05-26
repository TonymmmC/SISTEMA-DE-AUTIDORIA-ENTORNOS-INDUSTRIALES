#include "EdgeLogger.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "EdgeEventBus.h"
#include "EdgeStorage.h"

namespace edge {

static const size_t   RING_SIZE        = 64;
static const size_t   BATCH_MAX        = 16;
static const uint32_t FLUSH_INTERVAL_MS = 5000;
static const uint32_t MUTEX_TIMEOUT_MS  = 10;

static AuditEvent        s_ring[RING_SIZE];
static size_t            s_ringHead  = 0;  // indice del proximo slot a escribir
static size_t            s_ringCount = 0;  // eventos validos en el ring
static SemaphoreHandle_t s_mutex     = nullptr;

// Batch pendiente de flush a SD
static char   s_batch[BATCH_MAX][128];
static size_t s_batchLen = 0;

// ---------------------------------------------------------------------------

static void agregarAlRing(const AuditEvent& ev) {
    s_ring[s_ringHead] = ev;
    s_ringHead = (s_ringHead + 1) % RING_SIZE;
    if (s_ringCount < RING_SIZE) s_ringCount++;
}

static void formatearLineaCSV(const AuditEvent& ev, char* buf, size_t bufLen) {
    const char* typeName = "UNKNOWN";
    if (ev.type == EventType::BLE_DEVICE_FOUND) typeName = "BLE_DEVICE_FOUND";

    snprintf(buf, bufLen, "%lu,%lu,%s,%s,%s\n",
             (unsigned long)ev.utc,
             (unsigned long)ev.uptimeMs,
             ev.source,
             typeName,
             ev.detail);
}

static void agregarAlBatch(const AuditEvent& ev) {
    if (s_batchLen >= BATCH_MAX) return;
    formatearLineaCSV(ev, s_batch[s_batchLen], sizeof(s_batch[s_batchLen]));
    s_batchLen++;
}

static void flushBatch() {
    for (size_t i = 0; i < s_batchLen; i++) {
        appendAuditLine(s_batch[i]);
    }
    s_batchLen = 0;
}

// ---------------------------------------------------------------------------

static void loggerTask(void* /*arg*/) {
    uint32_t lastFlushMs = millis();

    while (true) {
        AuditEvent ev;
        bool got = recibirEvento(ev, 1000);

        if (got) {
            if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) == pdTRUE) {
                agregarAlRing(ev);
                xSemaphoreGive(s_mutex);
            }
            agregarAlBatch(ev);
        }

        uint32_t ahora = millis();
        bool tiempoDeFlush = (ahora - lastFlushMs) >= FLUSH_INTERVAL_MS;
        bool batchLleno    = s_batchLen >= BATCH_MAX;

        if ((tiempoDeFlush || batchLleno) && s_batchLen > 0) {
            if (sdDisponible()) flushBatch();
            else s_batchLen = 0;
            lastFlushMs = ahora;
        }
    }
}

// ---------------------------------------------------------------------------

bool initLogger() {
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == nullptr) {
        Serial.println("[log] FALLO: no pudo crear mutex");
        return false;
    }

    BaseType_t ok = xTaskCreatePinnedToCore(
        loggerTask,
        "LoggerTask",
        4096,
        nullptr,
        3,      // prioridad 3
        nullptr,
        0       // core 0
    );

    if (ok != pdPASS) {
        Serial.println("[log] FALLO: no pudo crear tarea logger");
        return false;
    }

    Serial.println("[log] Logger iniciado");
    return true;
}

size_t obtenerEventosRecientes(AuditEvent* out, size_t maxOut) {
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) {
        return 0;
    }

    size_t n = (s_ringCount < maxOut) ? s_ringCount : maxOut;
    // Copia en orden inverso: el mas reciente primero
    for (size_t i = 0; i < n; i++) {
        size_t idx = (s_ringHead + RING_SIZE - 1 - i) % RING_SIZE;
        out[i] = s_ring[idx];
    }

    xSemaphoreGive(s_mutex);
    return n;
}

}  // namespace edge
