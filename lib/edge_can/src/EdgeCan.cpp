#include "EdgeCan.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "driver/twai.h"
#include "config.h"
#include "pins.h"
#include "events.h"
#include "EdgeEventBus.h"
#include "EdgeNetwork.h"
#include "EdgeAlerts.h"

namespace edge {

static const size_t   RING_SIZE        = 20;
static const uint32_t MUTEX_TIMEOUT_MS = 10;

static CanFrame          s_ring[RING_SIZE];
static size_t            s_head  = 0;
static size_t            s_count = 0;
static SemaphoreHandle_t s_mutex = nullptr;

// ---------------------------------------------------------------------------

static void agregarAlRing(const CanFrame& f) {
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) return;
    s_ring[s_head] = f;
    s_head = (s_head + 1) % RING_SIZE;
    if (s_count < RING_SIZE) s_count++;
    xSemaphoreGive(s_mutex);
}

static void emitirEvento(const CanFrame& f) {
    AuditEvent ev;
    ev.type     = EventType::CAN_FRAME;
    ev.uptimeMs = f.lastSeenMs;
    ev.utc      = ahoraUTC();
    strncpy(ev.source, "can", sizeof(ev.source));
    snprintf(ev.detail, sizeof(ev.detail), "id=0x%X dlc=%u ext=%d",
             (unsigned)f.id, f.dlc, f.extendido ? 1 : 0);
    publicarEvento(ev);
}

static void procesarMensaje(const twai_message_t& msg) {
    CanFrame f;
    f.id         = msg.identifier;
    f.extendido  = msg.extd;
    f.dlc        = (msg.data_length_code > 8) ? 8 : msg.data_length_code;
    f.lastSeenMs = millis();
    for (uint8_t i = 0; i < f.dlc; i++) f.data[i] = msg.data[i];
    agregarAlRing(f);
    emitirEvento(f);
    notificarEntidad("can", f.id);
}

// ---------------------------------------------------------------------------

static bool instalarTwai() {
    twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(
        (gpio_num_t)PIN_CAN_TX, (gpio_num_t)PIN_CAN_RX, TWAI_MODE_LISTEN_ONLY);
    twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t fil = TWAI_FILTER_CONFIG_ACCEPT_ALL();
    if (twai_driver_install(&g, &t, &fil) != ESP_OK) return false;
    return twai_start() == ESP_OK;
}

static void canTask(void* /*arg*/) {
    if (!instalarTwai()) {
        Serial.println("[can] FALLO: no pudo instalar driver TWAI");
        vTaskDelete(nullptr);
        return;
    }
    Serial.println("[can] Listener iniciado (listen-only, 500kbps)");

    while (true) {
        twai_message_t msg;
        if (twai_receive(&msg, pdMS_TO_TICKS(1000)) == ESP_OK) {
            if (!msg.rtr) procesarMensaje(msg);  // ignora remote frames sin datos
        }
    }
}

// ---------------------------------------------------------------------------

bool initCan() {
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == nullptr) {
        Serial.println("[can] FALLO: no pudo crear mutex");
        return false;
    }
    BaseType_t ok = xTaskCreatePinnedToCore(
        canTask, "CanTask", 4096, nullptr,
        5,    // prioridad 5: captura tiempo real
        nullptr,
        1     // core 1
    );
    if (ok != pdPASS) {
        Serial.println("[can] FALLO: no pudo crear tarea");
        return false;
    }
    return true;
}

size_t obtenerTramasCan(CanFrame* out, size_t maxOut) {
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
