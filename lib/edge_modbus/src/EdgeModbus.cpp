#include "EdgeModbus.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "modbus_rtu.h"
#include "config.h"
#include "pins.h"
#include "events.h"
#include "EdgeEventBus.h"
#include "EdgeNetwork.h"
#include "EdgeAlerts.h"

namespace edge {

static const size_t   RING_SIZE        = 20;
static const size_t   RX_BUF_SIZE      = 256;  // trama Modbus RTU maxima
static const uint32_t MUTEX_TIMEOUT_MS = 10;

static ModbusFrame       s_ring[RING_SIZE];
static size_t            s_head  = 0;
static size_t            s_count = 0;
static SemaphoreHandle_t s_mutex = nullptr;

// ---------------------------------------------------------------------------

static void agregarAlRing(const ModbusFrame& f) {
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) return;
    s_ring[s_head] = f;
    s_head = (s_head + 1) % RING_SIZE;
    if (s_count < RING_SIZE) s_count++;
    xSemaphoreGive(s_mutex);
}

static void emitirEvento(const ModbusFrame& f) {
    AuditEvent ev;
    ev.type     = EventType::MODBUS_FRAME;
    ev.uptimeMs = f.lastSeenMs;
    ev.utc      = ahoraUTC();
    strncpy(ev.source, "modbus", sizeof(ev.source));
    snprintf(ev.detail, sizeof(ev.detail), "slave=%u fc=0x%02X len=%u",
             f.slave, f.function, f.len);
    publicarEvento(ev);
}

static void procesarTrama(const uint8_t* buf, size_t len) {
    ParsedFrame p = parsearTramaModbus(buf, len);
    if (!p.crcValido) return;  // descarta ruido del bus; solo tramas reales
    ModbusFrame f;
    f.slave      = p.slave;
    f.function   = p.function;
    f.len        = (uint8_t)len;
    f.crcValido  = p.crcValido;
    f.lastSeenMs = millis();
    agregarAlRing(f);
    emitirEvento(f);
    notificarEntidad("modbus", f.slave);
}

// ---------------------------------------------------------------------------

static void modbusTask(void* /*arg*/) {
    // Listen-only: RX en GPIO36, TX sin asignar (-1). El bus nunca se conduce.
    Serial2.begin(MODBUS_BAUD, SERIAL_8N1, PIN_RS485_RX, -1);

    static uint8_t buf[RX_BUF_SIZE];
    size_t   idx        = 0;
    uint32_t lastByteMs = 0;

    while (true) {
        while (Serial2.available()) {
            uint8_t b = (uint8_t)Serial2.read();
            if (idx < RX_BUF_SIZE) buf[idx++] = b;
            lastByteMs = millis();
        }
        bool gapDetectado = (idx > 0) && ((millis() - lastByteMs) >= MODBUS_GAP_MS);
        if (gapDetectado) {
            procesarTrama(buf, idx);
            idx = 0;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// ---------------------------------------------------------------------------

bool initModbus() {
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == nullptr) {
        Serial.println("[modbus] FALLO: no pudo crear mutex");
        return false;
    }

    BaseType_t ok = xTaskCreatePinnedToCore(
        modbusTask, "ModbusTask", 4096, nullptr,
        5,    // prioridad 5: captura tiempo real
        nullptr,
        1     // core 1
    );
    if (ok != pdPASS) {
        Serial.println("[modbus] FALLO: no pudo crear tarea");
        return false;
    }
    Serial.println("[modbus] Sniffer RTU iniciado (listen-only)");
    return true;
}

size_t obtenerTramasModbus(ModbusFrame* out, size_t maxOut) {
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) {
        return 0;
    }
    size_t n = (s_count < maxOut) ? s_count : maxOut;
    for (size_t i = 0; i < n; i++) {
        size_t idx = (s_head + RING_SIZE - 1 - i) % RING_SIZE;
        out[i] = s_ring[idx];
    }
    xSemaphoreGive(s_mutex);
    return n;
}

}  // namespace edge
