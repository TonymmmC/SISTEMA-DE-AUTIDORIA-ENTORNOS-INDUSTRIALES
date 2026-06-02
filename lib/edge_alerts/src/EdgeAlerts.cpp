#include "EdgeAlerts.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <cstring>
#include "EdgeNetwork.h"

namespace edge {

static const size_t   RING_SIZE        = 32;
static const size_t   MAX_ENTIDADES    = 128;  // entidades distintas rastreadas
static const uint32_t MUTEX_TIMEOUT_MS = 10;

struct Entidad { char source[8]; uint32_t key; };

static AlertEntry        s_ring[RING_SIZE];
static size_t            s_head  = 0;
static size_t            s_count = 0;
static Entidad           s_seen[MAX_ENTIDADES];
static size_t            s_seenCount = 0;
static SemaphoreHandle_t s_mutex = nullptr;

// ---------------------------------------------------------------------------

uint32_t hashCadena(const char* s) {
    uint32_t h = 5381;
    for (; *s; s++) h = ((h << 5) + h) + (uint8_t)(*s);  // djb2
    return h;
}

static bool yaVista(const char* source, uint32_t key) {
    for (size_t i = 0; i < s_seenCount; i++) {
        if (s_seen[i].key == key && strncmp(s_seen[i].source, source, 8) == 0) {
            return true;
        }
    }
    return false;
}

static void registrarEntidad(const char* source, uint32_t key) {
    if (s_seenCount >= MAX_ENTIDADES) return;  // tabla llena: no re-alerta
    strncpy(s_seen[s_seenCount].source, source, sizeof(s_seen[s_seenCount].source) - 1);
    s_seen[s_seenCount].source[sizeof(s_seen[s_seenCount].source) - 1] = '\0';
    s_seen[s_seenCount].key = key;
    s_seenCount++;
}

static void componerMensaje(char* out, size_t len, const char* source, uint32_t key) {
    if (strcmp(source, "modbus") == 0) {
        snprintf(out, len, "Nueva direccion Modbus detectada: esclavo %u", (unsigned)key);
    } else if (strcmp(source, "can") == 0) {
        snprintf(out, len, "Nuevo ID CAN detectado: 0x%X", (unsigned)key);
    } else if (strcmp(source, "ble") == 0) {
        snprintf(out, len, "Nuevo dispositivo BLE detectado (id 0x%X)", (unsigned)key);
    } else {
        snprintf(out, len, "Nueva entidad en bus %s (clave 0x%X)", source, (unsigned)key);
    }
}

static void agregarAlerta(const char* source, uint32_t key) {
    AlertEntry a;
    a.uptimeMs = millis();
    a.utc      = ahoraUTC();
    strncpy(a.nivel, "WARNING", sizeof(a.nivel) - 1);
    a.nivel[sizeof(a.nivel) - 1] = '\0';
    componerMensaje(a.mensaje, sizeof(a.mensaje), source, key);
    s_ring[s_head] = a;
    s_head = (s_head + 1) % RING_SIZE;
    if (s_count < RING_SIZE) s_count++;
}

// ---------------------------------------------------------------------------

void notificarEntidad(const char* source, uint32_t key) {
    if (s_mutex == nullptr || source == nullptr) return;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(MUTEX_TIMEOUT_MS)) != pdTRUE) return;
    if (!yaVista(source, key)) {
        registrarEntidad(source, key);
        agregarAlerta(source, key);
    }
    xSemaphoreGive(s_mutex);
}

bool initAlerts() {
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == nullptr) {
        Serial.println("[alerts] FALLO: no pudo crear mutex");
        return false;
    }
    Serial.println("[alerts] Motor de alertas iniciado");
    return true;
}

size_t obtenerAlertas(AlertEntry* out, size_t maxOut) {
    if (s_mutex == nullptr) return 0;
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
