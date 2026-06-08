#include "EdgeCan.h"
#include <Arduino.h>
#include <cstring>
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

#ifndef CAN_SIM
static bool instalarTwai() {
    twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(
        (gpio_num_t)PIN_CAN_TX, (gpio_num_t)PIN_CAN_RX, TWAI_MODE_LISTEN_ONLY);
    twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t fil = TWAI_FILTER_CONFIG_ACCEPT_ALL();
    if (twai_driver_install(&g, &t, &fil) != ESP_OK) return false;
    return twai_start() == ESP_OK;
}
#endif

static void canTask(void* /*arg*/) {
#ifdef CAN_SIM
    // Escenario: bus CANopen + J1939 en maquinaria industrial.
    // Los mensajes se construyen como twai_message_t reales y pasan por procesarMensaje()
    // identico al path del driver TWAI -- sin tocar el hardware TWAI.
    //
    // Nodos CANopen simulados:
    //   0x701 - heartbeat nodo 1 (1 byte, 0x05 = operational), 1 s
    //   0x181 - PDO1 nodo 1: velocidad (int16, rpm) + posicion (int32, pulsos), 100 ms
    //   0x182 - PDO1 nodo 2: temperatura (int16, 0.01 C) + humedad (uint16, 0.01%), 200 ms
    //   0x583 - SDO respuesta nodo 3: objeto identidad (idx 0x1000), 5 s
    //
    // Mensajes J1939 simulados (extended ID de 29 bits):
    //   0x18F00400 - EEC1 PGN 0xF004: velocidad motor (SPN 190, rpm), 100 ms
    //   0x18FE0900 - VD PGN 0xFE09: distancia total (SPN 917, m), 1 s

    struct SimEntry { uint32_t id; bool extd; uint8_t dlc; uint32_t ms; };
    static const SimEntry k_sim[] = {
        {0x00000701, false, 1, 1000},
        {0x00000181, false, 6,  100},
        {0x00000182, false, 4,  200},
        {0x18F00400, true,  8,  100},
        {0x18FE0900, true,  8, 1000},
        {0x00000583, false, 8, 5000},
    };
    static const size_t N = sizeof(k_sim) / sizeof(k_sim[0]);
    static uint32_t last[N] = {};
    uint32_t tick = 0;

    Serial.println("[can] Listener iniciado (SIMULADO - sin hardware TWAI)");

    while (true) {
        uint32_t now = millis();
        tick++;

        for (size_t i = 0; i < N; i++) {
            if (now - last[i] < k_sim[i].ms) continue;
            last[i] = now;

            twai_message_t msg;
            memset(&msg, 0, sizeof(msg));
            msg.identifier       = k_sim[i].id;
            msg.extd             = k_sim[i].extd ? 1u : 0u;
            msg.data_length_code = k_sim[i].dlc;

            switch (i) {
                case 0:  // CANopen heartbeat nodo 1: 0x05 = pre-operational->operational
                    msg.data[0] = 0x05;
                    break;
                case 1: { // CANopen PDO1 nodo 1: velocidad variable + posicion acumulada
                    int16_t  spd = (int16_t)(1200 + (int32_t)(tick % 401) - 200);
                    int32_t  pos = (int32_t)(tick * 17);
                    memcpy(&msg.data[0], &spd, 2);
                    memcpy(&msg.data[2], &pos, 4);
                    break;
                }
                case 2: { // CANopen PDO1 nodo 2: temperatura +/- 0.5 C, humedad estable
                    int16_t  temp = (int16_t)(2500 + (int32_t)(tick % 101) - 50);
                    uint16_t hum  = (uint16_t)(6000 + tick % 201);
                    memcpy(&msg.data[0], &temp, 2);
                    memcpy(&msg.data[2], &hum,  2);
                    break;
                }
                case 3: { // J1939 EEC1: SPN 190 velocidad motor (0.125 rpm/bit)
                    // 1500 rpm = 12000 unidades; variamos +/- 250 rpm
                    uint16_t rpm = (uint16_t)(12000 + (int32_t)(tick % 4001) - 2000);
                    msg.data[0] = 0xFF;  // SPN 899 no disponible
                    msg.data[1] = 0xFF;  // SPN 512 no disponible
                    msg.data[2] = 0xFF;  // SPN 513 no disponible
                    memcpy(&msg.data[3], &rpm, 2);
                    msg.data[5] = 0xFF;
                    msg.data[6] = 0xFF;
                    msg.data[7] = 0xFF;
                    break;
                }
                case 4: { // J1939 VD: SPN 917 distancia total (0.125 m/bit)
                    uint32_t dist = tick * 8u;  // ~1 m por tick a 1 s de intervalo
                    memcpy(&msg.data[0], &dist, 4);
                    msg.data[4] = 0xFF;
                    msg.data[5] = 0xFF;
                    msg.data[6] = 0xFF;
                    msg.data[7] = 0xFF;
                    break;
                }
                case 5:  // CANopen SDO: respuesta lectura objeto identidad 0x1000 sub0
                    msg.data[0] = 0x43;
                    msg.data[1] = 0x00; msg.data[2] = 0x10; msg.data[3] = 0x00;
                    msg.data[4] = 0x95; msg.data[5] = 0x07; msg.data[6] = 0x00; msg.data[7] = 0x00;
                    break;
            }

            procesarMensaje(msg);
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
#else
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
#endif
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
