#include "EdgeHousekeeping.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "config.h"

namespace edge {

static volatile uint32_t s_heapMin = UINT32_MAX;

uint32_t heapLibre() {
    return ESP.getFreeHeap();
}

uint32_t heapMinimo() {
    return (s_heapMin == UINT32_MAX) ? ESP.getFreeHeap() : s_heapMin;
}

static void reportarHeap() {
    uint32_t libre = ESP.getFreeHeap();
    if (libre < s_heapMin) s_heapMin = libre;
    Serial.printf("[hk] heap libre=%u min=%u\n", libre, s_heapMin);
}

static void housekeepingTask(void* /*arg*/) {
    while (true) {
        reportarHeap();
        vTaskDelay(pdMS_TO_TICKS(HEAP_MONITOR_INTERVAL_MS));
    }
}

bool initHousekeeping() {
    s_heapMin = ESP.getFreeHeap();
    BaseType_t ok = xTaskCreatePinnedToCore(
        housekeepingTask, "Housekeeping", 2560, nullptr,
        1,    // prioridad 1: housekeeping
        nullptr,
        0     // core 0
    );
    if (ok != pdPASS) {
        Serial.println("[hk] FALLO: no pudo crear tarea housekeeping");
        return false;
    }
    Serial.println("[hk] Housekeeping iniciado");
    return true;
}

}  // namespace edge
