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
#ifdef MODBUS_SIM
    // Escenario: PLC Schneider M221 sondeando 5 esclavos industriales.
    // Las tramas se construyen con CRC valido y se procesan por el mismo path
    // que usaria el hardware real -- procesarTrama() valida y rechazaria CRCs malos.
    struct SimEntry { uint8_t slave; uint8_t fc; uint8_t ah; uint8_t al; uint8_t ch; uint8_t cl; uint32_t ms; };
    static const SimEntry k_sim[] = {
        {1, 0x04, 0x00, 0x00, 0x00, 0x02,  800},  // esclavo 1: sensor temp/humedad (2 input regs)
        {2, 0x04, 0x00, 0x00, 0x00, 0x01, 1000},  // esclavo 2: sensor presion (1 input reg)
        {3, 0x03, 0x00, 0x00, 0x00, 0x04, 1200},  // esclavo 3: caudalimetro (4 holding regs)
        {5, 0x01, 0x00, 0x00, 0x00, 0x08,  600},  // esclavo 5: actuadores (8 coils)
        {7, 0x03, 0x00, 0x00, 0x00, 0x08, 2000},  // esclavo 7: medidor energia (8 holding regs)
        {5, 0x06, 0x00, 0x01, 0x00, 0x01, 5000},  // esclavo 5: escribir setpoint (FC06)
    };
    static const size_t N = sizeof(k_sim) / sizeof(k_sim[0]);
    static uint32_t last[N] = {};

    Serial.println("[modbus] Sniffer RTU iniciado (SIMULADO - sin hardware RS485)");

    while (true) {
        uint32_t now = millis();
        for (size_t i = 0; i < N; i++) {
            if (now - last[i] < k_sim[i].ms) continue;
            last[i] = now;
            uint8_t buf[8];
            buf[0] = k_sim[i].slave;
            buf[1] = k_sim[i].fc;
            buf[2] = k_sim[i].ah;
            buf[3] = k_sim[i].al;
            buf[4] = k_sim[i].ch;
            buf[5] = k_sim[i].cl;
            uint16_t crc = crc16Modbus(buf, 6);
            buf[6] = (uint8_t)(crc & 0xFF);
            buf[7] = (uint8_t)(crc >> 8);
            procesarTrama(buf, 8);
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
#else
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
#endif
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
